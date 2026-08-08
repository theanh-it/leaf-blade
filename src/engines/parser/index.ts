/**
 * Public entry point cho parser module.
 *
 * Hiện tại module parser chạy song song với compiler cũ.
 * Renderer cũ (`BladeRenderer`) vẫn dùng `BladeCompiler` cũ, nhưng
 * người dùng có thể chọn dùng `BladeCompilerV2` thông qua API export này.
 */
export {
  BladeCompilerV2,
  type BladeCompileOptionsV2,
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
