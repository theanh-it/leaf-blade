/**
 * Function Codegen: Generate compiled JavaScript functions from AST.
 *
 * Ultra-fast approach: compile-time variable resolution with Proxy.
 */

import type { ASTNode, IfNode, ForEachNode, ForNode, WhileNode, IncludeScopeNode } from '../parser/ast.js';

/**
 * Generate render function from AST.
 */
export function generateRenderFunction(nodes: ASTNode[]): string {
  const parts: string[] = [];
  generateNodes(nodes, parts);
  return parts.join('');
}

function generateNodes(nodes: ASTNode[], parts: string[]): void {
  for (const node of nodes) {
    generateNode(node, parts);
  }
}

function generateNode(node: ASTNode, parts: string[]): void {
  switch (node.type) {
    case 'Text':
      if (node.value) parts.push(generateText(node.value));
      return;

    case 'EscapedExpression':
      parts.push(`__a(_e(${node.expression}));`);
      return;

    case 'RawExpression':
      parts.push(`__a(${node.expression});`);
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
  return `__a('${escaped}');`;
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

  parts.push(`(function(_a){if(_a){if(Array.isArray(_a)){for(var _i=0;_i<_a.length;_i++){var ${valueVar}=_a[_i];var ${keyVar}=_i;${bodyCode}}}else{for(var _ek in _a){if(_a.hasOwnProperty(_ek)){var ${valueVar}=_a[_ek];var ${keyVar}=_ek;${bodyCode}}}}}})(${node.collection});`);
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
 * Ultra-fast wrapper: Proxy for property access, avoids with() deoptimization.
 */
export function wrapRenderFunction(code: string): string {
  return `(function(_s){
  _s=_s||{};
  var __p=[];
  var __push=__p.push.bind(__p);
  var _s=new Proxy(_s,{get:function(t,n){if(n==='__a'||n==='_e'||n==='__push')return t[n];return t[n]}});
  function __a(v){if(v!=null)__push(typeof v==='string'?v:String(v));}
  function _e(v){if(v==null)return'';if(typeof v!=='string')v=String(v);return v.replace(/[&<>"]/g,function(c){switch(c){case'&':return'&amp;';case'<':return'&lt;';case'>':return'&gt;';case'"':return'&quot;';default:return c;}});}
  try{
    ${code}
  }catch(e){
    __push('[Error: '+e.message+']');
  }
  return __p.join('');
})`;
}
