/**
 * Function Codegen V2: Ultra-optimized code generation.
 *
 * Key optimizations:
 * 1. Coalesce consecutive static text into a single append
 * 2. Use a null-safe `__append()` helper for safe concatenation
 * 3. Inline loops with cached length
 * 4. Pre-cache collection references
 * 5. Minimal with() scope
 */

import type { ASTNode, IfNode, ForEachNode, ForNode, WhileNode, IncludeScopeNode, TextNode } from '../parser/ast.js';

let varCounter = 0;
function resetVarCounter(): void { varCounter = 0; }

/**
* Generate render function from AST.
*/
export function generateRenderFunction(nodes: ASTNode[]): string {
  resetVarCounter();
  const parts: string[] = [];
  generateNodes(nodes, parts);
  return parts.join('');
}

function generateNodes(nodes: ASTNode[], parts: string[]): void {
  // Coalesce consecutive text nodes and minimize __append calls
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];

    if (node.type === 'Text') {
      // Collect consecutive text nodes
      const textNode = node as TextNode;
      let textBuffer = textNode.value || '';
      let j = i + 1;
      while (j < nodes.length && nodes[j].type === 'Text') {
        const next = nodes[j] as TextNode;
        textBuffer += next.value || '';
        j++;
      }
      if (textBuffer) {
        const escaped = textBuffer
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
        parts.push(`__append('${escaped}');`);
      }
      i = j;
    } else {
      generateNode(node, parts);
      i++;
    }
  }
}

function generateNode(node: ASTNode, parts: string[]): void {
  switch (node.type) {
    case 'Text':
      if (node.value) parts.push(generateText(node.value));
      return;

    case 'EscapedExpression':
      parts.push(`__append(_e(${node.expression}));`);
      return;

    case 'RawExpression':
      parts.push(`__append(${node.expression});`);
      return;

    case 'If':
      generateIf(node as IfNode, parts);
      return;

    case 'ForEach':
      generateForeach(node as ForEachNode, parts);
      return;

    case 'For':
      generateFor(node as ForNode, parts);
      return;

    case 'While':
      generateWhile(node as WhileNode, parts);
      return;

    case 'IncludeScope':
      generateIncludeScope(node as IncludeScopeNode, parts);
      return;

    default:
      return;
  }
}

function generateText(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `__append('${escaped}');`;
}

function generateIf(node: IfNode, parts: string[]): void {
  const branches = node.branches;
  if (branches.length === 0) return;

  let code = '';
  for (let i = branches.length - 1; i >= 0; i--) {
    const branch = branches[i];
    const bodyParts: string[] = [];
    generateNodes(branch.body, bodyParts);
    const bodyCode = bodyParts.join('');

    if (branch.kind === 'else') {
      code = bodyCode;
    } else {
      code = `if(${branch.condition}){${bodyCode}}else{${code || ''}}`;
    }
  }

  parts.push(code);
}

function generateForeach(node: ForEachNode, parts: string[]): void {
  const valueVar = node.value;
  const keyVar = node.key || '_k';
  const bodyParts: string[] = [];
  generateNodes(node.body, bodyParts);
  const bodyCode = bodyParts.join('');

  // Simple for-of: V8 optimizes this well
  // Only use indexed loop if the key is explicitly needed
  if (node.key) {
    // User needs index, use indexed loop
    const collectionVar = `_c${varCounter++}`;
    const indexVar = `_i${varCounter++}`;
    const lengthVar = `_l${varCounter++}`;
    parts.push(`var ${collectionVar}=${node.collection};if(${collectionVar}){if(Array.isArray(${collectionVar})){for(var ${indexVar}=0,${lengthVar}=${collectionVar}.length;${indexVar}<${lengthVar};${indexVar}++){var ${valueVar}=${collectionVar}[${indexVar}];var ${keyVar}=${indexVar};${bodyCode}}}else{for(var ${keyVar} in ${collectionVar}){if(${collectionVar}.hasOwnProperty(${keyVar})){var ${valueVar}=${collectionVar}[${keyVar}];${bodyCode}}}}}`);
  } else {
    // Simple for-of (much faster)
    parts.push(`for(const ${valueVar} of ${node.collection}){${bodyCode}}`);
  }
}

function generateFor(node: ForNode, parts: string[]): void {
  const bodyParts: string[] = [];
  generateNodes(node.body, bodyParts);
  const bodyCode = bodyParts.join('');

  parts.push(`for(${node.init};${node.condition};${node.update}){${bodyCode}}`);
}

function generateWhile(node: WhileNode, parts: string[]): void {
  const bodyParts: string[] = [];
  generateNodes(node.body, bodyParts);
  const bodyCode = bodyParts.join('');

  parts.push(`while(${node.condition}){${bodyCode}}`);
}

function generateIncludeScope(node: IncludeScopeNode, parts: string[]): void {
  const bodyParts: string[] = [];
  generateNodes(node.body, bodyParts);
  const bodyCode = bodyParts.join('');

  parts.push(`(function(_c){var _oc=_s;_s=Object.create(_s);Object.assign(_s,_c||{});${bodyCode}_s=_oc;})(${node.dataExpression});`);
}

/**
 * Wrapper that emits the `__append()` helper for safe null/undefined
 * concatenation in the generated render function.
 */
export function wrapRenderFunction(code: string): string {
  return `(function(_s){
  _s=_s||{};
  var __output='';
  function __append(s){if(s!==undefined&&s!==null)__output+=s;}
  function _e(v){if(v==null)return'';if(typeof v!=='string')v=String(v);return v.replace(/[&<>"]/g,function(c){switch(c){case'&':return'&amp;';case'<':return'&lt;';case'>':return'&gt;';case'"':return'&quot;';default:return c;}});}
  try{
    with(_s){${code}}
  }catch(e){
    __append('[Error: '+e.message+']');
  }
  return __output;
})`;
}
