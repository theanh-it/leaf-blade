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
} from "./plugins/blade";

// Export engines
export { BladeCompiler } from "./engines/compiler";
export { BladeRenderer } from "./engines/renderer";
export { SimpleRenderer } from "./engines/simple-renderer";
