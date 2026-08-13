/**
 * Public entry point for the parser module.
 *
 * `BladeCompiler.parse()` is the main API, used by `BladeRenderer` to
 * obtain the AST and evaluate it directly through the native runtime.
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
