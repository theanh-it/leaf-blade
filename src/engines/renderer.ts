/**
 * Blade Renderer
 *
 * Native runtime renderer (v1.0.0+): parse → compose (@extends/@section/
 * @yield) → process @include → evaluate AST. Không phụ thuộc EJS.
 */

import { constants, type Stats } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { BladeCompiler } from "./parser/compiler.js";
import { BladeRuntime, type RuntimeOptions } from "./runtime/runtime.js";
import { CompiledRuntime } from "./runtime/compiled-runtime.js";
import { compileNodes, type Op } from "./runtime/codegen.js";
import { TemplateComposer, type TemplateLoader } from "./runtime/composer.js";
import { IncludeProcessor } from "./runtime/include-processor.js";
import type { ASTNode } from "./parser/ast.js";

export interface BladeRendererOptions {
  /**
   * Directory containing template files
   */
  viewsDir: string;

  /**
   * Enable template caching
   * @default true
   */
  cache?: boolean;

  /**
   * Runtime options
   */
  runtime?: RuntimeOptions;
}

class BladePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BladePathError";
  }
}

export class BladeRenderer implements TemplateLoader {
  private viewsDir: string;
  private cache: boolean;
  private compiler: BladeCompiler;
  private runtime: BladeRuntime;
  private compiledRuntime: CompiledRuntime;
  private composer: TemplateComposer;
  private includeProcessor: IncludeProcessor;

  // Caches (naive: giữ tới khi clearCache)
  private astCache = new Map<string, ASTNode[]>();
  private templateCache = new Map<string, string>();
  // Codegen cache: compiled ops for fast execution (v1.0.4+)
  private opsCache = new Map<string, Op[]>();

  private realViewsDir?: string;

  constructor(options: BladeRendererOptions) {
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeRenderer: viewsDir is required and must be a string");
    }

    this.viewsDir = path.resolve(options.viewsDir);
    this.cache = options.cache ?? true;

    // Initialize compiler
    this.compiler = new BladeCompiler({
      viewsDir: this.viewsDir,
      cache: this.cache,
      compatibilityMode: false, // v1.0.0 không cần compatibility
    });

    // Initialize runtime
    this.runtime = new BladeRuntime(options.runtime);
    this.compiledRuntime = new CompiledRuntime(options.runtime);

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
  async render(template: string, data: Record<string, any> = {}): Promise<string> {
    try {
      // 1. Resolve template path
      const templatePath = this.resolveTemplate(template);

      // 2. Check compiled ops cache (v1.0.4+ fast path)
      let ops: Op[];
      if (this.cache && this.opsCache.has(templatePath)) {
        ops = this.opsCache.get(templatePath)!;
      } else {
        // 3. Load and parse to AST
        let ast = await this.loadAndParseTemplate(templatePath);

        // 4. Process @extends and @section/@yield
        ast = await this.composer.compose(ast, templatePath);

        // 5. Process @include directives
        const { RuntimeContext } = await import('./runtime/context.js');
        ast = await this.includeProcessor.processIncludes(
          ast,
          new RuntimeContext(data),
          templatePath
        );

        // 6. Compile AST to ops (one-time cost, cached)
        ops = compileNodes(ast);

        // Cache compiled ops
        if (this.cache) {
          this.opsCache.set(templatePath, ops);
        }
      }

      // 7. Execute with compiled runtime (fast path)
      return this.compiledRuntime.execute(ops, data);
    } catch (error) {
      if (error instanceof BladePathError) {
        throw error;
      }

      throw new Error(
        `Failed to render template: ${template}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync render for already-compiled templates (no I/O).
   * Use after first async render() to avoid async overhead.
   *
   * @throws if template hasn't been compiled yet (call async render first)
   */
  renderSync(template: string, data: Record<string, any> = {}): string {
    const templatePath = this.resolveTemplate(template);

    if (!this.opsCache.has(templatePath)) {
      throw new Error(
        `Template not compiled yet: ${template}\n` +
        `Call render() first (async) to populate the compiled cache.`
      );
    }

    const ops = this.opsCache.get(templatePath)!;
    return this.compiledRuntime.execute(ops, data);
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
   * khi `clearCache()` được gọi (không tự stat file để invalidate). Điều
   * này cho hiệu năng ổn định; dùng `cache: false` cho môi trường dev.
   */
  private async loadAndParseTemplate(templatePath: string): Promise<ASTNode[]> {
    // Check AST cache (naive: giữ cho tới khi clearCache)
    if (this.cache && this.astCache.has(templatePath)) {
      return this.astCache.get(templatePath)!;
    }

    // Load template source
    const source = await this.loadTemplateSource(templatePath);

    // Parse to AST
    const ast = this.compiler.parse(source, templatePath);

    // Cache AST
    if (this.cache) {
      this.astCache.set(templatePath, ast);

      // Limit cache size
      if (this.astCache.size > 500) {
        const firstKey = this.astCache.keys().next().value;
        if (firstKey) {
          this.astCache.delete(firstKey);
        }
      }
    }

    return ast;
  }

  /**
   * Load template source code
   */
  private async loadTemplateSource(templatePath: string): Promise<string> {
    try {
      // Check source cache (naive)
      if (this.cache && this.templateCache.has(templatePath)) {
        return this.templateCache.get(templatePath)!;
      }

      // Read file
      const { content } = await this.readStableTemplate(templatePath);

      // Cache source
      if (this.cache) {
        this.templateCache.set(templatePath, content);
      }

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

    let templatePath = template;
    
    // Convert dot notation: layouts.app → layouts/app.blade.html
    if (!template.endsWith(".blade.html") && !template.endsWith(".blade")) {
      if (template.includes(".") && !template.includes("/") && !template.includes("\\")) {
        templatePath = template.replace(/\./g, "/");
      }
      templatePath = `${templatePath}.blade.html`;
    }

    const resolved = path.resolve(this.viewsDir, templatePath);
    this.assertWithinViews(resolved, template);
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
    this.opsCache.clear();
    this.realViewsDir = undefined;
    this.compiler.clearCache();
  }
}
