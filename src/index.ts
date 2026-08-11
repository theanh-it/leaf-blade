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

// Export main renderer (native runtime, không phụ thuộc EJS)
export {
  BladeRenderer,
  type BladeRendererOptions,
} from "./engines/renderer.js";

// Export runtime internals (dùng khi cần custom expression evaluation,
// custom layout composer, hoặc test)
export {
  BladeRuntime,
  RuntimeContext,
  ExpressionEvaluator,
  TemplateComposer,
  IncludeProcessor,
  type RuntimeOptions,
  type EvaluatorOptions,
  type ComposerOptions,
  type TemplateLoader,
  type IncludeProcessorOptions
} from "./engines/runtime/index.js";

// Export parser module
export {
  BladeCompiler,
  type BladeCompileOptions,
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
