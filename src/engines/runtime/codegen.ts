/**
 * Codegen: Flatten AST thành "ops array" để execute nhanh hơn.
 *
 * Tại sao nhanh hơn?
 * - Loại bỏ dispatch overhead (no switch trên node.type mỗi call)
 * - Cache locality tốt hơn (array of compact objects)
 * - Coalesce consecutive text nodes (1 push thay vì n)
 * - Pre-extract trường cần thiết (không phải object property access mỗi iteration)
 *
 * Trade-off:
 * - Mất 1 lần conversion overhead (cached after first render)
 * - Phức tạp hơn interpreter
 *
 * Approach này safe (không dùng eval/Function) - vẫn giữ expression evaluation
 * thông qua ExpressionEvaluator (sandboxed).
 */

/**
 * Op types - compact discriminated union
 */
export type Op =
  | { t: 'T'; v: string }                         // Text (already a string)
  | { t: 'E'; e: string; s: 0 | 1 }               // Expression, s=1 escaped, s=0 raw
  | { t: 'I'; c: string; b: Op[]; el?: Op[] }     // If (condition, body, elseBody?)
  | { t: 'FE'; c: string; v: string; k?: string; b: Op[] } // ForEach
  | { t: 'FR'; i: string; c: string; u: string; b: Op[] }   // For
  | { t: 'W'; c: string; b: Op[] }                // While
  | { t: 'JS'; code: string }                     // JS code (statement)
  | { t: 'IS'; d: string; b: Op[] }               // IncludeScope
  ;

// Re-export type tag for clarity
export type OpType = Op['t'];

/**
 * Compile AST nodes thành flat ops array.
 */
export function compileNodes(nodes: import('../parser/ast.js').ASTNode[]): Op[] {
  const ops: Op[] = [];
  for (const node of nodes) {
    compileNode(node, ops);
  }
  return ops;
}

function compileNode(node: import('../parser/ast.js').ASTNode, ops: Op[]): void {
  switch (node.type) {
    case 'Text':
      // Coalesce consecutive text nodes
      if (node.value.length === 0) return;
      const last = ops[ops.length - 1];
      if (last && last.t === 'T') {
        last.v += node.value;
      } else {
        ops.push({ t: 'T', v: node.value });
      }
      return;

    case 'EscapedExpression':
      ops.push({ t: 'E', e: node.expression, s: 1 });
      return;

    case 'RawExpression':
      ops.push({ t: 'E', e: node.expression, s: 0 });
      return;

    case 'If': {
      // Flatten if/elseif/else into nested IFs.
      // Build the "else chain" first (innermost first), then wrap with outer branches.
      //
      // Strategy: process from last branch to first, accumulating the chain.
      // - Start with else body (or empty)
      // - For each elseif/if (from last to first), wrap: {t:'I', c:cond, b:body, el:[chain]}
      const branches = node.branches;
      if (branches.length === 0) return;

      // Start from last branch, work backwards
      let chain: Op[] = [];
      // The final else (if any) becomes the chain
      const lastBranch = branches[branches.length - 1];
      if (lastBranch.kind === 'else') {
        chain = compileNodes(lastBranch.body);
      }

      // Wrap from second-to-last back to first
      for (let i = branches.length - (lastBranch.kind === 'else' ? 2 : 1); i >= 0; i--) {
        const branch = branches[i];
        if (branch.kind === 'else') continue; // Already handled
        const newIf: Op = {
          t: 'I',
          c: branch.condition,
          b: compileNodes(branch.body),
          el: chain.length > 0 ? chain : undefined,
        };
        chain = [newIf];
      }

      // Push the outer IF (chain has 1 element - the outermost)
      if (chain.length > 0) {
        ops.push(chain[0]);
      }
      return;
    }

    case 'ForEach':
      ops.push({
        t: 'FE',
        c: node.collection,
        v: node.value,
        k: node.key,
        b: compileNodes(node.body),
      });
      return;

    case 'For':
      ops.push({
        t: 'FR',
        i: node.init,
        c: node.condition,
        u: node.update,
        b: compileNodes(node.body),
      });
      return;

    case 'While':
      ops.push({ t: 'W', c: node.condition, b: compileNodes(node.body) });
      return;

    case 'Js':
      ops.push({ t: 'JS', code: node.code });
      return;

    case 'IncludeScope':
      ops.push({ t: 'IS', d: node.dataExpression, b: compileNodes(node.body) });
      return;

    case 'Comment':
    case 'Extends':
    case 'Section':
    case 'Yield':
    case 'Include':
      // These are handled by composer/include-processor before codegen
      // Comments are stripped
      return;

    default:
      // Unknown - skip
      return;
  }
}
