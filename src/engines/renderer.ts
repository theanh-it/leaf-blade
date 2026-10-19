/** Native Blade renderer: composed templates executed as cached ops. */
import { TemplateEngine, type TemplateEngineOptions, type RenderFunction } from "./template-engine.js";
import { CompiledRuntime } from "./runtime/compiled-runtime.js";
import { compileNodes } from "./runtime/codegen.js";
import type { RuntimeOptions } from "./runtime/runtime.js";
import type { ASTNode } from "./parser/ast.js";

export interface BladeRendererOptions extends TemplateEngineOptions {
  runtime?: RuntimeOptions;
}

export class BladeRenderer extends TemplateEngine {
  private runtime: CompiledRuntime;
  constructor(options: BladeRendererOptions) {
    super(options);
    this.runtime = new CompiledRuntime(options.runtime);
  }
  protected compileProgram(ast: ASTNode[]): RenderFunction {
    const ops = compileNodes(ast);
    return (data) => this.runtime.execute(ops, data);
  }
}
