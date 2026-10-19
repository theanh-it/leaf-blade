/** Function renderer sharing file loading, composition and cache rules with BladeRenderer. */
import { TemplateEngine, type TemplateEngineOptions, type RenderFunction } from "./template-engine.js";
import { CompiledRuntime } from "./runtime/compiled-runtime.js";
import { compileRenderFunction } from "./runtime/function-codegen-v2.js";
import type { ASTNode } from "./parser/ast.js";

export interface CompiledBladeOptions extends TemplateEngineOptions {
  security?: boolean;
  maxIterations?: number;
  maxDepth?: number;
}

export class CompiledBlade extends TemplateEngine {
  private runtime: CompiledRuntime;
  constructor(options: CompiledBladeOptions) {
    // Preserve the legacy .blade.php default; explicit .blade.html also works.
    super(options, ".blade.php");
    this.runtime = new CompiledRuntime(options);
  }
  protected compileProgram(ast: ASTNode[]): RenderFunction {
    return compileRenderFunction(ast, this.runtime);
  }
}
