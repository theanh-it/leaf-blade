/**
 * Blade Renderer
 * Render compiled Blade templates với layout system
 */

import path from "path";
import ejs from "ejs";
import { BladeCompiler } from "./compiler";

export interface BladeRenderOptions {
  viewsDir: string;
  cache?: boolean;
  cacheDir?: string;
}

export class BladeRenderer {
  private compiler: BladeCompiler;
  private viewsDir: string;
  private cache: boolean;
  private templateCache = new Map<string, string>();
  private compiledIncludesCache = new Map<string, string>();
  private fileStatsCache = new Map<string, { mtime: number; size: number }>();

  constructor(options: BladeRenderOptions) {
    // Validate viewsDir
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeRenderer: viewsDir is required and must be a string");
    }

    // Check if viewsDir exists (async check will be done on first template load)
    this.viewsDir = options.viewsDir;
    this.cache = options.cache ?? true;

    this.compiler = new BladeCompiler({
      viewsDir: options.viewsDir,
      cacheDir: options.cacheDir,
      cache: options.cache,
    });
  }

  /**
   * Load template file asynchronously
   */
  private async loadTemplate(templatePath: string): Promise<string> {
    // Check in-memory cache first
    if (this.cache && this.templateCache.has(templatePath)) {
      // Verify file hasn't changed (check mtime)
      try {
        const stats = await Bun.file(templatePath).stat();
        const cached = this.fileStatsCache.get(templatePath);
        
        if (cached && cached.mtime === stats.mtime.getTime() && cached.size === stats.size) {
          return this.templateCache.get(templatePath)!;
        }
      } catch {
        // File might not exist, fall through to read
      }
    }

    // Read file asynchronously
    try {
      const file = Bun.file(templatePath);
      const exists = await file.exists();
      
      if (!exists) {
        throw new Error(`Template not found: ${templatePath}`);
      }

      const content = await file.text();
      const stats = await file.stat();

      // Cache content and stats
      if (this.cache) {
        this.templateCache.set(templatePath, content);
        this.fileStatsCache.set(templatePath, {
          mtime: stats.mtime.getTime(),
          size: stats.size,
        });
        
        // Limit cache size
        if (this.templateCache.size > 500) {
          const firstKey = this.templateCache.keys().next().value;
          if (firstKey) {
            this.templateCache.delete(firstKey);
            this.fileStatsCache.delete(firstKey);
          }
        }
      }

      return content;
    } catch (error: any) {
      if (error.message?.includes("No such file") || error.message?.includes("not found")) {
        throw new Error(
          `Template not found: ${templatePath}\n` +
          `Make sure the template exists and viewsDir is correct: ${this.viewsDir}\n` +
          `Tip: Use dot notation like 'layouts.app' or full path like 'layouts/app.blade.html'`
        );
      }
      throw new Error(
        `Failed to load template: ${templatePath}\n` +
        `Error: ${error.message}\n` +
        `Views directory: ${this.viewsDir}`
      );
    }
  }

  /**
   * Resolve template path
   * Support extension: .blade.html
   * Support dot notation: layouts.app → layouts/app.blade.html
   */
  private resolveTemplate(template: string): string {
    // Nếu đã có extension .blade.html hoặc .blade, dùng luôn
    if (template.endsWith(".blade.html") || template.endsWith(".blade")) {
      return path.join(this.viewsDir, template);
    }
    
    // Convert dot notation to path: layouts.app → layouts/app
    // Nhưng giữ nguyên nếu đã có path separator
    let templatePath = template;
    if (template.includes(".") && !template.includes("/") && !template.includes("\\")) {
      templatePath = template.replace(/\./g, "/");
    }
    
    // Mặc định dùng extension .blade.html
    return path.join(this.viewsDir, `${templatePath}.blade.html`);
  }

  /**
   * Extract extends directive
   */
  private extractExtends(content: string): string | null {
    const match = content.match(/<!-- BLADE_EXTENDS:([^>]+) -->/);
    return match ? match[1] : null;
  }

  /**
   * Extract sections từ template
   */
  private extractSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const sectionRegex =
      /<!-- BLADE_SECTION_START:([^>]+) -->([\s\S]*?)<!-- BLADE_SECTION_END:\1 -->/g;

    let match;
    while ((match = sectionRegex.exec(content)) !== null) {
      const [, name, body] = match;
      sections.set(name, body.trim());
    }

    return sections;
  }

  /**
   * Process @yield trong layout
   */
  private processYields(
    content: string,
    sections: Map<string, string>
  ): string {
    // Process @yield với default value
    // Tìm cả markers đã compile và raw @yield (nếu chưa được compile)
    
    // 1. Process compiled markers: <!-- BLADE_YIELD:name --><!-- BLADE_DEFAULT:default -->
    // Lưu ý: markers có thể có whitespace, cần trim
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
    
    // 2. Process raw @yield nếu chưa được compile (fallback)
    // Điều này xử lý trường hợp layout chưa được compile đúng
    content = content.replace(
      /@yield\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"])?\s*\)/g,
      (_match, name, defaultValue) => {
        const sectionName = name.trim();
        if (sections.has(sectionName)) {
          return sections.get(sectionName)!;
        }
        return defaultValue ? defaultValue.trim() : "";
      }
    );

    return content;
  }

  /**
   * Process @include directives với cache
   */
  private async processIncludes(
    content: string,
    _templatePath: string,
    data: Record<string, any>
  ): Promise<string> {
    // Process @include with data
    const includeWithRegex =
      /<!-- BLADE_INCLUDE_WITH:([^:>]+):(\{[^}]+\}) -->/g;
    for (const match of content.matchAll(includeWithRegex)) {
      const [, partial, dataStr] = match;
      const partialData = this.parseDataString(dataStr, data);
      const partialPath = this.resolveTemplate(partial);
      
      // Generate cache key for include with data
      const dataKey = JSON.stringify(partialData);
      const includeCacheKey = `${partialPath}:${dataKey}`;
      
      // Check cache
      if (this.cache && this.compiledIncludesCache.has(includeCacheKey)) {
        content = content.replace(match[0], this.compiledIncludesCache.get(includeCacheKey)!);
        continue;
      }

      const partialContent = await this.loadTemplate(partialPath);
      const compiledPartial = await this.compileAndRender(
        partialContent,
        partialPath,
        { ...data, ...partialData }
      );
      
      // Cache compiled include
      if (this.cache) {
        this.compiledIncludesCache.set(includeCacheKey, compiledPartial);
        // Limit cache size
        if (this.compiledIncludesCache.size > 500) {
          const firstKey = this.compiledIncludesCache.keys().next().value;
          if (firstKey) {
            this.compiledIncludesCache.delete(firstKey);
          }
        }
      }
      
      content = content.replace(match[0], compiledPartial);
    }

    // Process simple @include
    const includeRegex = /<!-- BLADE_INCLUDE:([^>]+) -->/g;
    for (const match of content.matchAll(includeRegex)) {
      const [, partial] = match;
      const partialPath = this.resolveTemplate(partial);
      
      // Cache key for simple include
      const includeCacheKey = `${partialPath}:{}`;
      
      // Check cache
      if (this.cache && this.compiledIncludesCache.has(includeCacheKey)) {
        content = content.replace(match[0], this.compiledIncludesCache.get(includeCacheKey)!);
        continue;
      }

      const partialContent = await this.loadTemplate(partialPath);
      const compiledPartial = await this.compileAndRender(
        partialContent,
        partialPath,
        data
      );
      
      // Cache compiled include
      if (this.cache) {
        this.compiledIncludesCache.set(includeCacheKey, compiledPartial);
        if (this.compiledIncludesCache.size > 500) {
          const firstKey = this.compiledIncludesCache.keys().next().value;
          if (firstKey) {
            this.compiledIncludesCache.delete(firstKey);
          }
        }
      }
      
      content = content.replace(match[0], compiledPartial);
    }

    return content;
  }

  /**
   * Parse data string thành object
   */
  private parseDataString(
    dataStr: string,
    context: Record<string, any>
  ): Record<string, any> {
    try {
      // Simple parser - support basic object syntax
      // { key: value, key2: value2 }
      const obj: Record<string, any> = {};
      const pairs = dataStr.replace(/[{}]/g, "").split(",");

      for (const pair of pairs) {
        const [key, value] = pair.split(":").map((s) => s.trim());
        if (key && value) {
          // Remove quotes
          const cleanValue = value.replace(/^['"]|['"]$/g, "");
          // Try to get from context or use as literal
          obj[key] = context[cleanValue] ?? cleanValue;
        }
      }

      return obj;
    } catch {
      return {};
    }
  }

  /**
   * Compile và render template (recursive cho layouts)
   */
  private async compileAndRender(
    content: string,
    templatePath: string,
    data: Record<string, any>
  ): Promise<string> {
    // Extract @extends từ raw content (trước khi compile)
    const extendsMatch = content.match(/@extends\(['"]([^'"]+)['"]\)/);
    const layoutName = extendsMatch ? extendsMatch[1] : null;
    
    // Remove @extends directive từ raw content
    const contentWithoutExtends = content.replace(
      /@extends\(['"][^'"]+['"]\)\s*/g,
      ""
    );

    // Extract sections từ raw content (trước khi compile)
    // Tìm @section('name') ... @endsection hoặc @section('name', 'value')
    const rawSections = new Map<string, string>();
    
    // Extract @section('name', 'value') - short syntax
    const shortSectionRegex = /@section\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/g;
    let match;
    while ((match = shortSectionRegex.exec(contentWithoutExtends)) !== null) {
      const [, name, value] = match;
      rawSections.set(name, value);
    }
    
    // Extract @section('name') ... @endsection - long syntax
    const longSectionRegex = /@section\(['"]([^'"]+)['"]\)([\s\S]*?)@endsection/g;
    while ((match = longSectionRegex.exec(contentWithoutExtends)) !== null) {
      const [, name, body] = match;
      if (!rawSections.has(name)) {
        rawSections.set(name, body.trim());
      }
    }

    // Extract content không nằm trong section markers
    let contentBody = contentWithoutExtends;
    rawSections.forEach((_sectionBody, sectionName) => {
      // Remove @section('name', 'value') - short syntax
      const shortRegex = new RegExp(
        `@section\\(['"]${sectionName}['"]\\s*,\\s*['"][^'"]*['"]\\)`,
        "g"
      );
      contentBody = contentBody.replace(shortRegex, "");
      
      // Remove @section('name') ... @endsection - long syntax
      const longRegex = new RegExp(
        `@section\\(['"]${sectionName}['"]\\)[\\s\\S]*?@endsection`,
        "g"
      );
      contentBody = contentBody.replace(longRegex, "");
    });
    contentBody = contentBody.trim();

    // Compile sections (sectionBody đã là raw content, cần compile)
    const compiledSections = new Map<string, string>();
    for (const [name, sectionBody] of rawSections.entries()) {
      // Section body là raw content, cần compile
      let compiledSection = this.compiler.compile(sectionBody, templatePath);
      // Process includes trong section
      compiledSection = await this.processIncludes(
        compiledSection,
        templatePath,
        data
      );
      compiledSections.set(name, compiledSection);
    }

    // Nếu không có section 'content' nhưng có content body, dùng làm content
    if (!rawSections.has("content") && contentBody) {
      let compiledContent = this.compiler.compile(contentBody, templatePath);
      compiledContent = await this.processIncludes(
        compiledContent,
        templatePath,
        data
      );
      compiledSections.set("content", compiledContent);
    } else if (!rawSections.has("content")) {
      // Nếu không có content, dùng empty string
      compiledSections.set("content", "");
    }

    // If extends layout, render with layout
    if (layoutName) {
      const layoutPath = this.resolveTemplate(layoutName);
      const layoutContent = await this.loadTemplate(layoutPath);

      // Compile layout (cached automatically by compiler)
      let compiledLayout = this.compiler.compile(layoutContent, layoutPath);

      // Process yields với compiled sections
      compiledLayout = this.processYields(compiledLayout, compiledSections);

      // Process includes in layout
      compiledLayout = await this.processIncludes(
        compiledLayout,
        layoutPath,
        data
      );

      // Render layout
      try {
        return ejs.render(compiledLayout, data, {
          filename: layoutPath,
          root: this.viewsDir,
          async: false, // EJS sync mode
        });
      } catch (error: any) {
        throw new Error(
          `Failed to render layout: ${layoutPath}\n` +
          `Error: ${error.message}\n` +
          `This usually means there's a syntax error in the compiled template or missing data.\n` +
          `Check the template at: ${layoutPath}`
        );
      }
    }

    // Render without layout - compile all sections into final HTML
    let finalContent = "";
    if (compiledSections.has("content")) {
      finalContent = compiledSections.get("content")!;
    } else {
      // Compile content body if no sections
      finalContent = this.compiler.compile(contentBody, templatePath);
      finalContent = await this.processIncludes(
        finalContent,
        templatePath,
        data
      );
    }

    try {
      return ejs.render(finalContent, data, {
        filename: templatePath,
        root: this.viewsDir,
        async: false, // EJS sync mode
      });
    } catch (error: any) {
      throw new Error(
        `Failed to render template: ${templatePath}\n` +
        `Error: ${error.message}\n` +
        `This usually means there's a syntax error in the compiled template or missing data.\n` +
        `Check the template at: ${templatePath}`
      );
    }
  }

  /**
   * Render Blade template
   */
  async render(
    template: string,
    data: Record<string, any> = {}
  ): Promise<string> {
    const templatePath = this.resolveTemplate(template);
    const content = await this.loadTemplate(templatePath);
    return this.compileAndRender(content, templatePath, data);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.templateCache.clear();
    this.compiledIncludesCache.clear();
    this.fileStatsCache.clear();
    this.compiler.clearCache();
  }
}
