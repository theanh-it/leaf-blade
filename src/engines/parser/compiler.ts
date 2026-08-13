/**
 * Compiler using the lexer → parser → codegen pipeline.
 *
 * `parse()` is the main API, used by `BladeRenderer` (native runtime) to
 * obtain the AST and evaluate it directly.
 *
 * `compile()` / `compilePure()` produce an EJS source string (kept for
 * users who want to reuse the lexer/parser/codegen pipeline independently
 * of the runtime — for example for debugging or external tooling);
 * `BladeRenderer` does not use these methods.
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
   * Throws BladeTemplateError with line/column when the template is invalid.
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
   * Parse template into an AST — used for testing or integration
   * with the native runtime.
   */
  parse(templateContent: string, templatePath?: string) {
    const lexer = new BladeLexer(templateContent, { templatePath });
    const tokens = lexer.tokenize();
    const parser = new BladeParser(tokens, { templatePath });
    return parser.parse();
  }

  /**
   * Compile with full EJS output (including directive execution).
   * Returns pure EJS source; no BLADE_* markers.
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
