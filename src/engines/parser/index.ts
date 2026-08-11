/**
 * Public entry point cho parser module.
 *
 * `BladeCompiler.parse()` là API chính, được `BladeRenderer` dùng để lấy
 * AST và evaluate trực tiếp qua native runtime (không qua EJS).
 */
export {
  BladeCompiler,
  type BladeCompileOptions,
} from "./compiler.js";

export { BladeLexer, type BladeToken, type BladeTokenType, type LexerOptions } from "./lexer.js";

export { BladeParser, type ParseOptions } from "./parser.js";

export {
  BladeCodeGenerator,
  type CodeGenOptions,
  transformExpression,
} from "./codegen.js";

export {
  BladeTemplateError,
  formatDiagnostic,
  type BladeDiagnostic,
  type BladeDiagnosticCode,
  type BladeSourceLocation,
} from "./diagnostics.js";
