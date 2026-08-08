/**
 * Compiler mới dùng pipeline lexer → parser → codegen.
 *
 * API tương thích với `BladeCompiler` cũ:
 *  - Constructor(options)
 *  - compile(content, path) → string EJS
 *  - clearCache()
 *
 * Compiler này KHÔNG thay thế `BladeCompiler` cũ. Nó chạy song song để
 * người dùng có thể từng bước chuyển đổi. Khi cờ `COMPATIBILITY_MODE`
 * được bật, codegen vẫn sinh ra các marker `BLADE_*` để renderer cũ
 * hiểu được (extends, section, yield, include).
 *
 * Khi chuyển sang renderer mới, có thể tắt compat mode để renderer
 * đọc thẳng AST.
 */
import { createHash } from "node:crypto";
import { BladeLexer } from "./lexer.js";
import { BladeParser } from "./parser.js";
import { BladeCodeGenerator } from "./codegen.js";
import { BladeTemplateError } from "./diagnostics.js";

export interface BladeCompileOptionsV2 {
  viewsDir: string;
  /** @deprecated Reserved for backward compatibility. */
  cacheDir?: string;
  cache?: boolean;
  /**
   * Khi `true` (mặc định), codegen sinh ra marker `BLADE_*` để renderer cũ
   * xử lý layout/include/section. Khi `false`, output chỉ chứa EJS.
   */
  compatibilityMode?: boolean;
}

export class BladeCompilerV2 {
  private cache: boolean;
  private compatibilityMode: boolean;
  private compiledCache = new Map<string, string>();

  constructor(options: BladeCompileOptionsV2) {
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeCompilerV2: viewsDir is required and must be a string");
    }
    this.cache = options.cache ?? true;
    this.compatibilityMode = options.compatibilityMode ?? true;
  }

  /**
   * Compile Blade template → EJS source.
   * Throw lỗi BladeTemplateError với line/column khi template sai.
   */
  compile(templateContent: string, templatePath: string): string {
    const contentHash = this.contentHash(templateContent);
    const cacheKey = `${templatePath}:${contentHash}`;

    if (this.cache && this.compiledCache.has(cacheKey)) {
      return this.compiledCache.get(cacheKey)!;
    }

    let result: string;
    try {
      result = this.compileUncached(templateContent, templatePath);
    } catch (error) {
      if (error instanceof BladeTemplateError) {
        throw error;
      }
      throw new Error(
        `BladeCompilerV2: Failed to compile ${templatePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (this.cache) {
      this.compiledCache.set(cacheKey, result);
      if (this.compiledCache.size > 1000) {
        const firstKey = this.compiledCache.keys().next().value;
        if (firstKey) this.compiledCache.delete(firstKey);
      }
    }

    return result;
  }

  clearCache(): void {
    this.compiledCache.clear();
  }

  /**
   * Parse template thành AST — dùng cho test hoặc integration với renderer mới.
   */
  parse(templateContent: string, templatePath?: string) {
    const lexer = new BladeLexer(templateContent, { templatePath });
    const tokens = lexer.tokenize();
    const parser = new BladeParser(tokens, { templatePath });
    return parser.parse();
  }

  /**
   * Compile với output EJS đầy đủ (bao gồm cả directive execution).
   * Trả về EJS source thuần; không có marker BLADE_*.
   */
  compilePure(templateContent: string, templatePath: string): string {
    const ast = this.parse(templateContent, templatePath);
    const generator = new BladeCodeGenerator({ preserveMarkers: false });
    return generator.generate(ast);
  }

  private compileUncached(templateContent: string, templatePath: string): string {
    const ast = this.parse(templateContent, templatePath);
    const generator = new BladeCodeGenerator({
      preserveMarkers: this.compatibilityMode,
    });
    return generator.generate(ast);
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("base64url");
  }
}
