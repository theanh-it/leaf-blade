/** Generate control flow once; pass expressions as data to the shared evaluator. */
import type { ASTNode } from "../parser/ast.js";
import { compileNodes, type Op } from "./codegen.js";
import type { CompiledRuntime } from "./compiled-runtime.js";
import type { RenderFunction } from "../template-engine.js";

export function compileRenderFunction(nodes: ASTNode[], runtime: CompiledRuntime): RenderFunction {
  let counter = 0;
  const { maxDepth, maxIterations } = runtime.limits;
  const literal = JSON.stringify;
  const evaluate = (expr: string, scope: string) => `_eval(${literal(expr)},${scope})`;
  function generate(ops: Op[], scope: string, depth: number): string {
    if (ops.length === 0) return "";
    if (depth > maxDepth) return 'throw new Error("Maximum recursion depth exceeded");';
    const parts: string[] = [];
    for (const op of ops) {
      switch (op.t) {
        case "T": parts.push(`_p.push(${literal(op.v)});`); break;
        case "E": parts.push(`_p.push(${op.s ? "_escape" : "_raw"}(${literal(op.e)},${scope}));`); break;
        case "JS": parts.push(`_exec(${literal(op.code)},${scope});`); break;
        case "I": parts.push(`if(${evaluate(op.c, scope)}){${generate(op.b, scope, depth + 1)}}else{${generate(op.el ?? [], scope, depth + 1)}}`); break;
        case "IS": {
          const child = `_s${counter++}`;
          parts.push(`{const ${child}=_child(${scope},${evaluate(op.d, scope)});${generate(op.b, child, depth + 1)}}`);
          break;
        }
        case "FE": {
          const id = counter++;
          const items = `_items${id}`, keys = `_keys${id}`, index = `_i${id}`, child = `_s${id}`, key = `_k${id}`;
          parts.push(`{const ${items}=${evaluate(op.c, scope)};if(${items}&&typeof ${items}==="object"){const ${keys}=Array.isArray(${items})?null:Object.keys(${items});const _n${id}=${keys}?${keys}.length:${items}.length;for(let ${index}=0;${index}<_n${id};${index}++){if(${index}>=${maxIterations})throw new Error("Loop exceeded maximum iterations: ${maxIterations}");const ${key}=${keys}?${keys}[${index}]:${index};const ${child}=Object.create(${scope});${child}[${literal(op.v)}]=${items}[${key}];${op.k ? `${child}[${literal(op.k)}]=${key};` : ""}${generate(op.b, child, depth + 1)}}}}`);
          break;
        }
        case "FR": {
          const id = counter++, child = `_s${counter++}`;
          parts.push(`{const ${child}=Object.create(${scope});_exec(${literal(op.i)},${child});let _n${id}=0;while(${evaluate(op.c, child)}){if(_n${id}++>=${maxIterations})throw new Error("Loop exceeded maximum iterations: ${maxIterations}");${generate(op.b, child, depth + 1)}_exec(${literal(op.u)},${child});}}`);
          break;
        }
        case "W": {
          const id = counter++;
          parts.push(`{let _n${id}=0;while(${evaluate(op.c, scope)}){if(_n${id}++>=${maxIterations})throw new Error("Loop exceeded maximum iterations: ${maxIterations}");${generate(op.b, scope, depth + 1)}}}`);
          break;
        }
      }
    }
    return parts.join("");
  }
  // Expressions and variable names are data, never code in this layer.
  const code = `return function(_s){const _p=[];${generate(compileNodes(nodes), "_s", 1)}return _p.join("");}`;
  const create = new Function("_eval", "_exec", "_escape", "_raw", "_child", code) as (
    evaluate: typeof runtime.evaluate,
    execute: typeof runtime.executeStatement,
    escaped: typeof runtime.evalAndEscape,
    raw: typeof runtime.evalToString,
    child: typeof runtime.createIncludeScope,
  ) => RenderFunction;
  return create(runtime.evaluate.bind(runtime), runtime.executeStatement.bind(runtime), runtime.evalAndEscape.bind(runtime), runtime.evalToString.bind(runtime), runtime.createIncludeScope.bind(runtime));
}
