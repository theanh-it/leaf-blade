/**
 * Blade Compiler
 * Compile Blade-like syntax thành executable code
 * Tương tự Laravel Blade nhưng phù hợp với JavaScript/TypeScript
 */

import { createHash } from "node:crypto";

export interface BladeCompileOptions {
  viewsDir: string;
  /** @deprecated Reserved for backward compatibility. Blade only uses in-memory caches. */
  cacheDir?: string;
  cache?: boolean;
}

export class BladeCompiler {
  private cache: boolean;
  private compiledCache = new Map<string, string>();

  constructor(options: BladeCompileOptions) {
    // Validate viewsDir
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeCompiler: viewsDir is required and must be a string");
    }

    this.cache = options.cache ?? true;

    // cacheDir is kept as a no-op option so existing applications can upgrade
    // without a type or runtime break. This compiler has no disk cache.
    if (options.cacheDir !== undefined && typeof options.cacheDir !== "string") {
      throw new Error("BladeCompiler: cacheDir must be a string");
    }
  }

  /**
   * Generate a collision-resistant hash for the compiled-template cache key.
   */
  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("base64url");
  }

  /**
   * Compile Blade template thành executable JavaScript code
   * Có cache để tránh compile lại nhiều lần
   */
  compile(templateContent: string, templatePath: string): string {
    // Generate cache key
    const contentHash = this.hashContent(templateContent);
    const cacheKey = `${templatePath}:${contentHash}`;

    // Check cache
    if (this.cache && this.compiledCache.has(cacheKey)) {
      return this.compiledCache.get(cacheKey)!;
    }

    // Blade comments must be removed before any directive/expression pass.
    // Otherwise comment contents can be turned into executable EJS.
    let compiled = this.compileComments(templateContent);

    // 1. @extends directive
    compiled = this.compileExtends(compiled);

    // 2. @section/@yield directives
    compiled = this.compileSections(compiled);

    // 3. @include directive
    compiled = this.compileInclude(compiled);

    // 4. @if/@elseif/@else/@endif
    compiled = this.compileConditionals(compiled);

    // 5. @foreach/@endforeach
    compiled = this.compileForeach(compiled);

    // 6. @for/@endfor
    compiled = this.compileFor(compiled);

    // 7. @while/@endwhile
    compiled = this.compileWhile(compiled);

    // 8. Variables: {{ }} và {!! !!}
    compiled = this.compileVariables(compiled);

    // 9. @js/@endjs (execute JavaScript code)
    compiled = this.compileJs(compiled);

    // Cache compiled result
    if (this.cache) {
      this.compiledCache.set(cacheKey, compiled);
      // Limit cache size to prevent memory leak
      if (this.compiledCache.size > 1000) {
        const firstKey = this.compiledCache.keys().next().value;
        if (firstKey) {
          this.compiledCache.delete(firstKey);
        }
      }
    }

    return compiled;
  }

  /**
   * Clear compiled cache
   */
  clearCache(): void {
    this.compiledCache.clear();
  }

  /**
   * Compile @extends directive
   * @extends('layout') → layout inheritance
   */
  private compileExtends(content: string): string {
    const extendsRegex = /@extends\(['"]([^'"]+)['"]\)/g;
    return content.replace(extendsRegex, (_match, layoutName) => {
      // Mark extends - sẽ xử lý trong render function
      return `<!-- BLADE_EXTENDS:${layoutName} -->`;
    });
  }

  /**
   * Compile @section/@yield directives
   * @section('name') ... @endsection → section definition
   * @section('name', 'value') → short syntax
   * @yield('name') → render section
   */
  private compileSections(content: string): string {
    // Compile @section with short syntax: @section('name', 'value')
    content = content.replace(
      /@section\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/g,
      (_match, name, value) => {
        return `<!-- BLADE_SECTION_START:${name} -->${value}<!-- BLADE_SECTION_END:${name} -->`;
      }
    );

    // Compile @section with long syntax: @section('name') ... @endsection
    content = content.replace(
      /@section\(['"]([^'"]+)['"]\)([\s\S]*?)@endsection/g,
      (_match, name, body) => {
        return `<!-- BLADE_SECTION_START:${name} -->${body}<!-- BLADE_SECTION_END:${name} -->`;
      }
    );

    // Compile @yield
    // Hỗ trợ: @yield('name') và @yield('name', 'default')
    content = content.replace(/@yield\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]*)['"])?\s*\)/g, (_match, name, defaultValue) => {
      const defaultVal = defaultValue ? `<!-- BLADE_DEFAULT:${defaultValue} -->` : "";
      return `<!-- BLADE_YIELD:${name} -->${defaultVal}`;
    });

    return content;
  }

  /**
   * Compile @include directive
   * @include('partial') → include partial
   */
  private compileInclude(content: string): string {
    // @include('partial')
    content = content.replace(/@include\(['"]([^'"]+)['"]\)/g, (_match, partial) => {
      return `<!-- BLADE_INCLUDE:${partial} -->`;
    });

    // @include('partial', { data })
    content = content.replace(/@include\(['"]([^'"]+)['"],\s*({[^}]+})\)/g, (_match, partial, data) => {
      return `<!-- BLADE_INCLUDE_WITH:${partial}:${data} -->`;
    });

    return content;
  }

  /**
   * Compile conditional statements
   * @if/@elseif/@else/@endif
   */
  private compileConditionals(content: string): string {
    // @if
    content = content.replace(/@if\s*\(([^)]+)\)/g, (_match, condition) => {
      return `<% if (${this.parseExpression(condition)}) { %>`;
    });

    // @elseif
    content = content.replace(/@elseif\s*\(([^)]+)\)/g, (_match, condition) => {
      return `<% } else if (${this.parseExpression(condition)}) { %>`;
    });

    // @else
    content = content.replace(/@else\b/g, () => {
      return `<% } else { %>`;
    });

    // @endif
    content = content.replace(/@endif\b/g, () => {
      return `<% } %>`;
    });

    return content;
  }

  /**
   * Compile @foreach directive
   * @foreach($items as $item) ... @endforeach
   * @foreach(items as item) ... @endforeach (without $)
   */
  private compileForeach(content: string): string {
    // @foreach($items as $item) hoặc @foreach(items as item)
    content = content.replace(/@foreach\s*\(([^)]+)\)/g, (match, expression) => {
      // Parse: $items as $item hoặc items as item hoặc ($items as $key => $item)
      // Remove $ từ expression trước khi parse
      const cleanExpr = expression.replace(/\$/g, "").trim();
      
      // Pattern: items as item hoặc items as key => item
      // Hỗ trợ dot notation: test.css as cssFile
      const asMatch = cleanExpr.match(/^\s*(\w+(?:\.\w+)*)\s+as\s+(?:(\w+)\s*=>\s*)?(\w+)\s*$/);
      if (asMatch) {
        const [, items, key, item] = asMatch;
        // Parse dot notation thành JavaScript property access
        const jsItems = this.parseExpression(items);
        if (key) {
          return `<% for (const [${key}, ${item}] of Object.entries(${jsItems} || [])) { %>`;
        } else {
          return `<% for (const ${item} of (${jsItems} || [])) { %>`;
        }
      }
      return match; // Fallback
    });

    // @endforeach
    content = content.replace(/@endforeach\b/g, () => {
      return `<% } %>`;
    });

    return content;
  }

  /**
   * Compile @for directive
   * @for($i = 0; $i < 10; $i++) ... @endfor
   */
  private compileFor(content: string): string {
    content = content.replace(/@for\s*\(([^)]+)\)/g, (_match, expression) => {
      // Parse PHP-style for loop: $i = 0; $i < 10; $i++
      const jsExpression = expression
        .replace(/\$(\w+)/g, "$1") // Remove $ from variables
        .replace(/;/g, ";"); // Keep semicolons
      return `<% for (${jsExpression}) { %>`;
    });

    content = content.replace(/@endfor\b/g, () => {
      return `<% } %>`;
    });

    return content;
  }

  /**
   * Compile @while directive
   */
  private compileWhile(content: string): string {
    content = content.replace(/@while\s*\(([^)]+)\)/g, (_match, condition) => {
      return `<% while (${this.parseExpression(condition)}) { %>`;
    });

    content = content.replace(/@endwhile\b/g, () => {
      return `<% } %>`;
    });

    return content;
  }

  /**
   * Compile variables
   * {{ $var }} → escaped output
   * {!! $var !!} → raw output
   * Support expressions: {{ $var + 1 }}, {{ $user.name }}
   */
  private compileVariables(content: string): string {
    // {{ expression }} - escaped (support complex expressions)
    content = content.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression) => {
      const jsExpr = this.parseExpression(expression);
      return `<%= ${jsExpr} %>`;
    });

    // {!! expression !!} - raw
    content = content.replace(/\{!!\s*([^!]+)\s*!!\}/g, (_match, expression) => {
      const jsExpr = this.parseExpression(expression);
      return `<%- ${jsExpr} %>`;
    });

    return content;
  }

  /**
   * Compile comments
   * {{-- comment --}} → HTML comment hoặc remove
   */
  private compileComments(content: string): string {
    return content.replace(/\{\{--([\s\S]*?)--\}\}/g, "");
  }

  /**
   * Compile @js directive (execute JavaScript code)
   * Lưu ý: Không cho phép return statement trong @js
   */
  private compileJs(content: string): string {
    content = content.replace(/@js\s*([\s\S]*?)@endjs/g, (_match, code) => {
      // Remove return statements nếu có (không hợp lệ trong EJS template)
      const cleanCode = code.replace(/^\s*return\s+/gm, "").trim();
      // Execute as JavaScript
      return `<% ${cleanCode} %>`;
    });

    return content;
  }

  /**
   * Parse expression (remove $, convert PHP syntax to JS)
   * Support: $var, $var.property, expressions
   */
  private parseExpression(expression: string): string {
    let parsed = expression.trim();
    
    // Remove $ from variables: $user → user
    parsed = parsed.replace(/\$(\w+)/g, "$1");
    
    // Convert dot notation to optional chaining: user.name → user?.name
    // Nhưng phải cẩn thận:
    // 1. Không replace số (1.5)
    // 2. Chỉ replace khi có word character trước và sau dấu chấm
    // 3. Không replace nếu có operator ngay sau dấu chấm
    parsed = parsed.replace(/(\w+)\.(\w+)/g, (match, obj, prop) => {
      // Kiểm tra xem có phải là số không (ví dụ: 1.5)
      if (!isNaN(Number(obj))) {
        return match; // Giữ nguyên nếu là số
      }
      return `${obj}?.${prop}`;
    });
    
    // Fix: Nếu có optional chaining ngay trước operator (không hợp lệ)
    // Ví dụ: "features?.&&" → "features &&"
    // Hoặc "features?.>" → "features >"
    parsed = parsed.replace(/(\w+)\?\.(\s*)([&|])/g, "$1 $2$3");
    parsed = parsed.replace(/(\w+)\?\.(\s*)([=!<>])/g, "$1 $2$3");
    
    return parsed;
  }
}
