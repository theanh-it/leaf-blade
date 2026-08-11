/**
 * Compiler dùng pipeline lexer → parser → codegen.
 *
 * `parse()` là API chính, được `BladeRenderer` (native runtime) dùng để
 * lấy AST rồi evaluate trực tiếp (không qua EJS).
 *
 * `compile()`/`compilePure()` sinh ra EJS source string (giữ lại cho ai
 * muốn tái sử dụng pipeline lexer/parser/codegen độc lập với runtime,
 * ví dụ debug hoặc tooling khác); `BladeRenderer` không dùng các method này.
 */
import { createHash } from "node:crypto";
import { BladeLexer } from "./lexer.js";
import { BladeParser } from "./parser.js";
import { BladeCodeGenerator } from "./codegen.js";
import { BladeTemplateError } from "./diagnostics.js";

export interface BladeCompileOptions {
  viewsDir: string;
  /** @deprecated Reserved for backward compatibility. */
  cacheDir?: string;
  cache?: boolean;
  /**
   * Khi `true` (mặc định), `compile()` sinh thêm marker `BLADE_*` bên cạnh
   * EJS cho layout/section/yield/include. `BladeRenderer` không dùng
   * `compile()`/marker này — chỉ ảnh hưởng khi gọi trực tiếp compiler này.
   */
  compatibilityMode?: boolean;
}

export class BladeCompiler {
  private cache: boolean;
  private compatibilityMode: boolean;
  private compiledCache = new Map<string, string>();

  constructor(options: BladeCompileOptions) {
    if (!options.viewsDir || typeof options.viewsDir !== "string") {
      throw new Error("BladeCompiler: viewsDir is required and must be a string");
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
        `BladeCompiler: Failed to compile ${templatePath}: ${
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
