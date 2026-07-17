/**
 * Blade Renderer
 * Composes Blade templates into EJS source and renders exactly once.
 */

import { constants, type Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import ejs from "ejs";
import { BladeCompiler } from "./compiler.js";

export interface BladeRenderOptions {
  viewsDir: string;
  cache?: boolean;
  /** @deprecated Reserved for backward compatibility. Blade only uses in-memory caches. */
  cacheDir?: string;
}

class BladePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BladePathError";
  }
}

interface TemplateFileStats {
  realPath: string;
  mtime: number;
  ctime: number;
  size: number;
  dev: number;
  ino: number;
}

export class BladeRenderer {
  private compiler: BladeCompiler;
  private viewsDir: string;
  private cache: boolean;
  private templateCache = new Map<string, string>();
  private fileStatsCache = new Map<string, TemplateFileStats>();
  private realViewsDir?: string;

  constructor(options: BladeRenderOptions) {
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeRenderer: viewsDir is required and must be a string");
    }

    this.viewsDir = path.resolve(options.viewsDir);
    this.cache = options.cache ?? true;

    this.compiler = new BladeCompiler({
      viewsDir: this.viewsDir,
      cacheDir: options.cacheDir,
      cache: options.cache,
    });
  }

  /**
   * Return true only when target is a child of base. Prefix checks are unsafe
   * here because directories such as `/views-private` also start with `/views`.
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
   * Resolve symlinks before reading so a link inside viewsDir cannot point to
   * a template outside the configured root.
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

  private sameFileVersion(left: Stats, right: Stats): boolean {
    return (
      left.dev === right.dev &&
      left.ino === right.ino &&
      left.mtimeMs === right.mtimeMs &&
      left.ctimeMs === right.ctimeMs &&
      left.size === right.size
    );
  }

  private matchesCachedVersion(
    cached: TemplateFileStats,
    realPath: string,
    current: Stats
  ): boolean {
    return (
      cached.realPath === realPath &&
      cached.dev === current.dev &&
      cached.ino === current.ino &&
      cached.mtime === current.mtimeMs &&
      cached.ctime === current.ctimeMs &&
      cached.size === current.size
    );
  }

  private async openedTemplateMatchesPath(
    templatePath: string,
    expectedRealPath: string,
    openedStats: Stats
  ): Promise<boolean> {
    const currentRealPath = await this.resolveRealTemplatePath(templatePath);
    if (currentRealPath !== expectedRealPath) {
      return false;
    }

    const currentStats = await stat(currentRealPath);
    return currentStats.isFile() && this.sameFileVersion(openedStats, currentStats);
  }

  /**
   * Read through one file descriptor so path replacement cannot mix content
   * from one file with metadata from another.
   */
  private async readStableTemplate(
    templatePath: string
  ): Promise<{ content: string; realPath: string; stats: Stats }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const realTemplatePath = await this.resolveRealTemplatePath(templatePath);
      const safeOpenFlags =
        process.platform === "win32"
          ? 0
          : constants.O_NOFOLLOW | constants.O_NONBLOCK;
      const handle = await open(
        realTemplatePath,
        constants.O_RDONLY | safeOpenFlags
      );

      try {
        const before = await handle.stat();
        if (!before.isFile()) {
          throw new Error(`Template is not a regular file: ${realTemplatePath}`);
        }

        if (
          !(await this.openedTemplateMatchesPath(
            templatePath,
            realTemplatePath,
            before
          ))
        ) {
          continue;
        }

        const content = await handle.readFile({ encoding: "utf8" });
        const after = await handle.stat();

        if (
          this.sameFileVersion(before, after) &&
          (await this.openedTemplateMatchesPath(
            templatePath,
            realTemplatePath,
            after
          ))
        ) {
          return { content, realPath: realTemplatePath, stats: after };
        }
      } finally {
        await handle.close();
      }
    }

    throw new Error(`Template changed while being read: ${templatePath}`);
  }

  /**
   * Load template source with stat-based in-memory cache invalidation.
   */
  private async loadTemplate(templatePath: string): Promise<string> {
    try {
      const realTemplatePath = await this.resolveRealTemplatePath(templatePath);

      if (this.cache && this.templateCache.has(templatePath)) {
        const stats = await stat(realTemplatePath);
        const cached = this.fileStatsCache.get(templatePath);

        if (
          stats.isFile() &&
          cached &&
          this.matchesCachedVersion(cached, realTemplatePath, stats)
        ) {
          return this.templateCache.get(templatePath)!;
        }
      }

      const { content, realPath, stats } = await this.readStableTemplate(
        templatePath
      );

      if (this.cache) {
        this.templateCache.set(templatePath, content);
        this.fileStatsCache.set(templatePath, {
          realPath,
          mtime: stats.mtimeMs,
          ctime: stats.ctimeMs,
          size: stats.size,
          dev: stats.dev,
          ino: stats.ino,
        });

        if (this.templateCache.size > 500) {
          const firstKey = this.templateCache.keys().next().value;
          if (firstKey) {
            this.templateCache.delete(firstKey);
            this.fileStatsCache.delete(firstKey);
          }
        }
      }

      return content;
    } catch (error: unknown) {
      if (error instanceof BladePathError) {
        throw error;
      }

      if (this.errorCode(error) === "ENOENT") {
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
   * Resolve a template name under viewsDir and reject lexical traversal.
   */
  private resolveTemplate(template: string): string {
    if (!template || typeof template !== "string") {
      throw new Error("BladeRenderer: template must be a non-empty string");
    }

    let templatePath = template;
    if (!template.endsWith(".blade.html") && !template.endsWith(".blade")) {
      if (
        template.includes(".") &&
        !template.includes("/") &&
        !template.includes("\\")
      ) {
        templatePath = template.replace(/\./g, "/");
      }
      templatePath = `${templatePath}.blade.html`;
    }

    const resolved = path.resolve(this.viewsDir, templatePath);
    this.assertWithinViews(resolved, template);
    return resolved;
  }

  /**
   * Replace compiled @yield markers with compiled section source.
   */
  private processYields(
    content: string,
    sections: Map<string, string>
  ): string {
    content = content.replace(
      /<!--\s*BLADE_YIELD:([^>]+)\s*-->(?:<!--\s*BLADE_DEFAULT:([^>]+)\s*-->)?/g,
      (_match, name, defaultValue) => {
        const sectionName = name.trim();
        if (sections.has(sectionName)) {
          return sections.get(sectionName)!;
        }
        return defaultValue ? defaultValue.trim() : "";
      }
    );

    return content.replace(
      /@yield\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"])?\s*\)/g,
      (_match, name, defaultValue) => {
        const sectionName = name.trim();
        if (sections.has(sectionName)) {
          return sections.get(sectionName)!;
        }
        return defaultValue ? defaultValue.trim() : "";
      }
    );
  }

  private circularCompositionError(
    stack: readonly string[],
    nextPath: string
  ): Error {
    const chain = [...stack, nextPath]
      .map((item) => path.relative(this.viewsDir, item) || item)
      .join(" -> ");
    return new Error(`BladeRenderer: Circular template composition detected: ${chain}`);
  }

  /**
   * Inline compiled partial source. No partial is rendered here; the final
   * composed EJS source is evaluated once by render().
   */
  private async processIncludes(
    content: string,
    stack: readonly string[]
  ): Promise<string> {
    const includeWithRegex =
      /<!-- BLADE_INCLUDE_WITH:([^:>]+):(\{[^}]+\}) -->/g;

    for (const match of [...content.matchAll(includeWithRegex)]) {
      const [, partial, dataExpression] = match;
      const partialPath = this.resolveTemplate(partial.trim());
      if (stack.includes(partialPath)) {
        throw this.circularCompositionError(stack, partialPath);
      }

      const partialContent = await this.loadTemplate(partialPath);
      const compiledPartial = await this.compileTemplateSource(
        partialContent,
        partialPath,
        [...stack, partialPath]
      );
      const scopedPartial =
        `<% { with ((` +
        dataExpression +
        `) || {}) { %>` +
        compiledPartial +
        `<% } } %>`;

      content = content.replace(match[0], () => scopedPartial);
    }

    const includeRegex = /<!-- BLADE_INCLUDE:([^>]+) -->/g;
    for (const match of [...content.matchAll(includeRegex)]) {
      const [, partial] = match;
      const partialPath = this.resolveTemplate(partial.trim());
      if (stack.includes(partialPath)) {
        throw this.circularCompositionError(stack, partialPath);
      }

      const partialContent = await this.loadTemplate(partialPath);
      const compiledPartial = await this.compileTemplateSource(
        partialContent,
        partialPath,
        [...stack, partialPath]
      );

      // A block keeps declarations in one partial from colliding with another.
      const isolatedPartial = `<% { %>${compiledPartial}<% } %>`;
      content = content.replace(match[0], () => isolatedPartial);
    }

    return content;
  }

  private stripBladeComments(content: string): string {
    return content.replace(/\{\{--[\s\S]*?--\}\}/g, "");
  }

  /**
   * Compose a raw Blade template into executable EJS source without rendering.
   */
  private async compileTemplateSource(
    rawContent: string,
    templatePath: string,
    stack: readonly string[]
  ): Promise<string> {
    const content = this.stripBladeComments(rawContent);
    const extendsMatch = content.match(/@extends\(['"]([^'"]+)['"]\)/);
    const layoutName = extendsMatch ? extendsMatch[1] : null;
    const contentWithoutExtends = content.replace(
      /@extends\(['"][^'"]+['"]\)\s*/g,
      ""
    );

    const rawSections = new Map<string, string>();
    const shortSectionRegex =
      /@section\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/g;
    let sectionMatch: RegExpExecArray | null;

    while ((sectionMatch = shortSectionRegex.exec(contentWithoutExtends)) !== null) {
      const [, name, value] = sectionMatch;
      rawSections.set(name, value);
    }

    const longSectionRegex =
      /@section\(['"]([^'"]+)['"]\)([\s\S]*?)@endsection/g;
    while ((sectionMatch = longSectionRegex.exec(contentWithoutExtends)) !== null) {
      const [, name, body] = sectionMatch;
      if (!rawSections.has(name)) {
        rawSections.set(name, body.trim());
      }
    }

    let contentBody = contentWithoutExtends;
    rawSections.forEach((_sectionBody, sectionName) => {
      const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const shortRegex = new RegExp(
        `@section\\(['"]${escapedName}['"]\\s*,\\s*['"][^'"]*['"]\\)`,
        "g"
      );
      const longRegex = new RegExp(
        `@section\\(['"]${escapedName}['"]\\)[\\s\\S]*?@endsection`,
        "g"
      );
      contentBody = contentBody.replace(shortRegex, "").replace(longRegex, "");
    });
    contentBody = contentBody.trim();

    const compiledSections = new Map<string, string>();
    for (const [name, sectionBody] of rawSections.entries()) {
      const compiledSection = this.compiler.compile(sectionBody, templatePath);
      compiledSections.set(
        name,
        await this.processIncludes(compiledSection, stack)
      );
    }

    if (!rawSections.has("content")) {
      const compiledContent = contentBody
        ? this.compiler.compile(contentBody, templatePath)
        : "";
      compiledSections.set(
        "content",
        await this.processIncludes(compiledContent, stack)
      );
    }

    if (layoutName) {
      const layoutPath = this.resolveTemplate(layoutName);
      if (stack.includes(layoutPath)) {
        throw this.circularCompositionError(stack, layoutPath);
      }

      const layoutContent = await this.loadTemplate(layoutPath);
      let compiledLayout = this.compiler.compile(layoutContent, layoutPath);
      compiledLayout = this.processYields(compiledLayout, compiledSections);
      return this.processIncludes(compiledLayout, [...stack, layoutPath]);
    }

    return compiledSections.get("content") ?? "";
  }

  /**
   * Render Blade template after composing all source into one EJS program.
   */
  async render(
    template: string,
    data: Record<string, any> = {}
  ): Promise<string> {
    const templatePath = this.resolveTemplate(template);
    const content = await this.loadTemplate(templatePath);
    const compiled = await this.compileTemplateSource(content, templatePath, [
      templatePath,
    ]);

    try {
      return ejs.render(compiled, data, {
        filename: templatePath,
        root: this.viewsDir,
        async: false,
      });
    } catch (error: unknown) {
      throw new Error(
        `Failed to render template: ${templatePath}\n` +
        `Error: ${this.errorMessage(error)}\n` +
        `This usually means there's a syntax error in the compiled template or missing data.\n` +
        `Check the template at: ${templatePath}`
      );
    }
  }

  /** Clear all in-memory source and compiler caches. */
  clearCache(): void {
    this.templateCache.clear();
    this.fileStatsCache.clear();
    this.realViewsDir = undefined;
    this.compiler.clearCache();
  }
}
