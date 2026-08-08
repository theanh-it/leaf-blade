/**
 * Leaf Blade - Blade Template Engine
 * Laravel Blade-like syntax for JavaScript/TypeScript
 */

// Export plugin, helpers, and types
export {
  bladePlugin,
  bladeView,
  type BladeOptions,
  type BladeViewData,
  type BladeContext,
  type BladeContextExtensions,
} from "./plugins/blade.js";

// Export engines
export { BladeCompiler } from "./engines/compiler.js";
export { BladeRenderer } from "./engines/renderer.js";
export { SimpleRenderer } from "./engines/simple-renderer.js";

// Export parser module (v2)
export {
  BladeCompilerV2,
  type BladeCompileOptionsV2,
  BladeLexer,
  type BladeToken,
  type BladeTokenType,
  type LexerOptions,
  BladeParser,
  type ParseOptions,
  BladeCodeGenerator,
  type CodeGenOptions,
  transformExpression,
  BladeTemplateError,
  formatDiagnostic,
  type BladeDiagnostic,
  type BladeDiagnosticCode,
  type BladeSourceLocation,
} from "./engines/parser/index.js";
