/**
 * Shared template loading, composition and bounded caches
 *
 * Native runtime renderer (v1.0.0+): parse → compose (@extends/@section/
 * @yield) → process @include → evaluate AST.
 */

import { constants, type Stats } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { BladeCompiler } from "./parser/compiler.js";
import { TemplateComposer, type TemplateLoader } from "./runtime/composer.js";
import { IncludeProcessor } from "./runtime/include-processor.js";
import type { ASTNode } from "./parser/ast.js";
import { RuntimeContext } from "./runtime/context.js";
import { BoundedCache } from "./bounded-cache.js";

export type RenderFunction = (data: Record<string, unknown>) => string;

export interface TemplateEngineOptions {
  /**
   * Directory containing template files
   */
  viewsDir: string;

  /**
   * Enable template caching
   * @default true
   */
  cache?: boolean;

  /** Maximum entries in each template cache. @default 500 */
  maxCacheSize?: number;
}

class BladePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BladePathError";
  }
}

export abstract class TemplateEngine implements TemplateLoader {
  private viewsDir: string;
  private cache: boolean;
  protected compiler: BladeCompiler;
  private composer: TemplateComposer;
  private includeProcessor: IncludeProcessor;

  private astCache: BoundedCache<string, ASTNode[]>;
  private templateCache: BoundedCache<string, string>;
  private compiledCache: BoundedCache<string, RenderFunction>;
  private stringCache: BoundedCache<string, RenderFunction>;
  private pathCache: BoundedCache<string, string>;
  // Compilation tasks only: never request data or rendered HTML.
  private pending = new Map<string, Promise<RenderFunction>>();
  private generation = 0;
  private realViewsDir?: string;

  constructor(options: TemplateEngineOptions, private extension = ".blade.html") {
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeRenderer: viewsDir is required and must be a string");
    }

    this.viewsDir = path.resolve(options.viewsDir);
    this.cache = options.cache ?? true;
    const limit = options.maxCacheSize ?? 500;
    this.astCache = new BoundedCache(limit);
    this.templateCache = new BoundedCache(limit);
    this.compiledCache = new BoundedCache(limit);
    this.stringCache = new BoundedCache(limit);
    this.pathCache = new BoundedCache(limit);

    // Initialize compiler
    this.compiler = new BladeCompiler({
      viewsDir: this.viewsDir,
      cache: this.cache,
      compatibilityMode: false, // v1.0.0 không cần compatibility
    });

    // Initialize composer
    this.composer = new TemplateComposer({
      loader: this,
      maxExtendsDepth: 10,
    });

    // Initialize include processor
    this.includeProcessor = new IncludeProcessor({
      loader: this,
      maxIncludeDepth: 10,
    });
  }

  /**
   * Render template thành HTML
   */
  protected abstract compileProgram(ast: ASTNode[]): RenderFunction;

  async render(template: string, data: Record<string, unknown> = {}): Promise<string> {
    try {
      const templatePath = this.resolveTemplate(template);
      const cached = this.cache ? this.compiledCache.get(templatePath) : undefined;
      if (cached) return cached(data);
      let task = this.cache ? this.pending.get(templatePath) : undefined;
      if (!task) {
        task = this.prepare(templatePath);
        if (this.cache) this.pending.set(templatePath, task);
      }
      try {
        const render = await task;
        return render(data);
      } finally {
        if (this.pending.get(templatePath) === task) this.pending.delete(templatePath);
      }
    } catch (error) {
      if (error instanceof BladePathError) throw error;
      throw new Error(
        `Failed to render template: ${template}\nError: ${this.errorMessage(error)}`,
        { cause: error }
      );
    }
  }

  private async prepare(templatePath: string): Promise<RenderFunction> {
    const generation = this.generation;
    let ast = await this.loadAndParseTemplate(templatePath);
    ast = await this.composer.compose(ast, templatePath);
    ast = await this.includeProcessor.processIncludes(ast, new RuntimeContext(), templatePath);
    const render = this.compileProgram(ast);
    if (this.cache && generation === this.generation) this.compiledCache.set(templatePath, render);
    return render;
  }

  /** Render a file already compiled by render(); no filesystem I/O. */
  renderSync(template: string, data: Record<string, unknown> = {}): string {
    const render = this.compiledCache.get(this.resolveTemplate(template));
    if (!render) {
      throw new Error(`Template not compiled yet: ${template}\nCall render() first (async) to populate the compiled cache.`);
    }
    return render(data);
  }

  /** Compile standalone source. File directives require async render(). */
  compile(source: string): RenderFunction {
    const ast = this.compiler.parse(source);
    this.assertStandalone(ast);
    return this.compileProgram(ast);
  }

  renderString(source: string, data: Record<string, unknown> = {}): string {
    const cached = this.cache ? this.stringCache.get(source) : undefined;
    if (cached) return cached(data);
    const render = this.compile(source);
    if (this.cache) this.stringCache.set(source, render);
    return render(data);
  }

  private assertStandalone(nodes: ASTNode[]): void {
    for (const node of nodes) {
      if (["Extends", "Include", "Section", "Yield"].includes(node.type)) {
        throw new Error(`${node.type} requires file rendering; use render() instead of renderString()/compile().`);
      }
      if (node.type === "If") {
        for (const branch of node.branches) this.assertStandalone(branch.body);
      } else if (node.type === "ForEach" || node.type === "For" || node.type === "While" || node.type === "IncludeScope") {
        this.assertStandalone(node.body);
      }
    }
  }

  /**
   * TemplateLoader implementation - load template AST
   */
  async load(templateName: string): Promise<ASTNode[]> {
    const templatePath = this.resolveTemplate(templateName);
    return this.loadAndParseTemplate(templatePath);
  }

  /**
   * Load và parse template thành AST với caching.
   *
   * Cache là "naive": một khi template đã được cache, nó được giữ cho tới
   * khi bị eviction hoặc `clearCache()` được gọi (không tự stat file để invalidate). Điều
   * này cho hiệu năng ổn định; dùng `cache: false` cho môi trường dev.
   */
  private async loadAndParseTemplate(templatePath: string): Promise<ASTNode[]> {
    const generation = this.generation;
    const cached = this.cache ? this.astCache.get(templatePath) : undefined;
    if (cached) return cached;

    // Load template source
    const source = await this.loadTemplateSource(templatePath);

    // Parse to AST
    const ast = this.compiler.parse(source, templatePath);

    if (this.cache && generation === this.generation) this.astCache.set(templatePath, ast);
    return ast;
  }

  /**
   * Load template source code
   */
  private async loadTemplateSource(templatePath: string): Promise<string> {
    try {
      const generation = this.generation;
      const cached = this.cache ? this.templateCache.get(templatePath) : undefined;
      if (cached !== undefined) return cached;

      // Read file
      const { content } = await this.readStableTemplate(templatePath);

      // Cache source
      if (this.cache && generation === this.generation) this.templateCache.set(templatePath, content);

      return content;
    } catch (error: unknown) {
      if (error instanceof BladePathError) {
        throw error;
      }

      const code = this.errorCode(error);
      if (code === "ENOENT") {
        throw new Error(
          `Template not found: ${templatePath}\n` +
          `Make sure the template exists and viewsDir is correct: ${this.viewsDir}\n` +
          `Tip: Use dot notation like 'layouts.app' or full path like 'layouts/app.blade.html'`
        );
      }

      throw new Error(
        `Failed to load template: ${templatePath}\n` +
        `Error: ${this.errorMessage(error)}\n` +
        `Views directory: ${this.viewsDir}`
      );
    }
  }

  /**
   * Resolve template name to absolute path
   */
  private resolveTemplate(template: string): string {
    if (!template || typeof template !== "string") {
      throw new Error("BladeRenderer: template must be a non-empty string");
    }

    const cached = this.pathCache.get(template);
    if (cached) return cached;
    let templatePath = template;
    
    // Convert dot notation: layouts.app → layouts/app.blade.html
    if (!template.endsWith(".blade.html") && !template.endsWith(".blade.php") && !template.endsWith(".blade")) {
      if (template.includes(".") && !template.includes("/") && !template.includes("\\")) {
        templatePath = template.replace(/\./g, "/");
      }
      templatePath = `${templatePath}${this.extension}`;
    }

    const resolved = path.resolve(this.viewsDir, templatePath);
    this.assertWithinViews(resolved, template);
    this.pathCache.set(template, resolved);
    return resolved;
  }

  /**
   * Security: Check path is within viewsDir
   */
  private isWithinDirectory(base: string, target: string): boolean {
    const relative = path.relative(base, target);
    return (
      relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  private assertWithinViews(target: string, templateName: string): void {
    if (!this.isWithinDirectory(this.viewsDir, target)) {
      throw new BladePathError(
        `BladeRenderer: Template path must stay inside viewsDir: ${templateName}`
      );
    }
  }

  /**
   * Resolve symlinks và check security
   */
  private async resolveRealTemplatePath(templatePath: string): Promise<string> {
    const realRoot = this.realViewsDir ?? (await realpath(this.viewsDir));
    this.realViewsDir = realRoot;

    const realTemplate = await realpath(templatePath);
    if (!this.isWithinDirectory(realRoot, realTemplate)) {
      throw new BladePathError(
        `BladeRenderer: Resolved template path must stay inside viewsDir: ${templatePath}`
      );
    }

    return realTemplate;
  }

  /**
   * Read file với stability check
   */
  private async readStableTemplate(
    templatePath: string
  ): Promise<{ content: string; realPath: string; stats: Stats }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const realTemplatePath = await this.resolveRealTemplatePath(templatePath);
      const safeOpenFlags =
        process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
      
      const handle = await open(realTemplatePath, constants.O_RDONLY | safeOpenFlags);

      try {
        const before = await handle.stat();
        if (!before.isFile()) {
          throw new Error(`Template is not a regular file: ${realTemplatePath}`);
        }

        const content = await handle.readFile({ encoding: "utf8" });
        const after = await handle.stat();

        if (this.sameFileVersion(before, after)) {
          return { content, realPath: realTemplatePath, stats: after };
        }
      } finally {
        await handle.close();
      }
    }

    throw new Error(`Template changed while being read: ${templatePath}`);
  }

  private sameFileVersion(left: Stats, right: Stats): boolean {
    return (
      left.dev === right.dev &&
      left.ino === right.ino &&
      left.mtimeMs === right.mtimeMs &&
      left.ctimeMs === right.ctimeMs &&
      left.size === right.size
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private errorCode(error: unknown): string | undefined {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === "string" ? code : undefined;
    }
    return undefined;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.astCache.clear();
    this.templateCache.clear();
    this.compiledCache.clear();
    this.stringCache.clear();
    this.pathCache.clear();
    this.pending.clear();
    this.generation++;
    this.realViewsDir = undefined;
    this.compiler.clearCache();
  }
}
