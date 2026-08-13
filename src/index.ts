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

// Export main renderer (native AST runtime)
export {
  BladeRenderer,
  type BladeRendererOptions,
} from "./engines/renderer.js";

// Export compiled renderer (fast path via generated functions)
export {
  CompiledBlade,
  type CompiledBladeOptions,
} from "./engines/compiled-blade.js";

// Export runtime internals (for custom expression evaluation,
// custom layout composer, or testing)
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
