/**
 * Blade Runtime Interpreter
 * 
 * Native runtime để evaluate AST thành HTML, thay thế EJS.
 * Được thiết kế để:
 * - Fast: Direct AST interpretation
 * - Safe: Sandboxed expression evaluation
 * - Lightweight: Minimal dependencies
 */

import type { ASTNode, IfNode, ForEachNode, ForNode, WhileNode, IncludeScopeNode } from "../parser/ast.js";
import { ExpressionEvaluator } from "./expression-evaluator.js";

export interface RuntimeOptions {
  /**
   * Maximum iterations for loops (prevent infinite loops)
   * @default 10000
   */
  maxIterations?: number;

  /**
   * Maximum recursion depth for nested structures
   * @default 100
   */
  maxDepth?: number;

  /**
   * Custom expression evaluator
   */
  evaluator?: ExpressionEvaluator;
}

export class BladeRuntime {
  private evaluator: ExpressionEvaluator;
  private maxIterations: number;
  private maxDepth: number;
  private currentDepth = 0;
  // Stack of AST nodes currently being evaluated (for error context)
  private nodeStack: ASTNode[] = [];

  constructor(options: RuntimeOptions = {}) {
    this.evaluator = options.evaluator || new ExpressionEvaluator();
    this.maxIterations = options.maxIterations || 10000;
    this.maxDepth = options.maxDepth || 100;
  }

  /**
   * Evaluate AST nodes thành HTML string.
   *
   * `data` được dùng trực tiếp làm scope gốc. Loop và @js mutation ghi vào
   * scope (hoặc child scope tạo bằng Object.create) để giữ ngữ nghĩa
   * lexical scope.
   */
  evaluate(nodes: ASTNode[], data: Record<string, any> = {}): string {
    const scope: Record<string, any> = data ?? {};
    return this.evaluateNodes(nodes, scope);
  }

  /**
   * Evaluate một list nodes - optimized with array accumulation
   * Tracks depth at entry so all node types (@if, @foreach, etc.) are bounded.
   */
  private evaluateNodes(nodes: ASTNode[], scope: Record<string, any>): string {
    this.currentDepth++;
    try {
      this.checkDepth();
      const parts: string[] = [];
      for (const node of nodes) {
        const result = this.evaluateNode(node, scope);
        if (result) {
          parts.push(result);
        }
      }
      return parts.join('');
    } finally {
      this.currentDepth--;
    }
  }

  /**
   * Evaluate một node dựa trên type.
   * Lightweight try/catch tracks node stack for error context.
   * The try/catch overhead when no error is negligible in modern V8.
   */
  private evaluateNode(node: ASTNode, scope: Record<string, any>): string {
    this.nodeStack.push(node);
    try {
      return this.dispatchNode(node, scope);
    } catch (err) {
      throw this.enrichError(err);
    } finally {
      this.nodeStack.pop();
    }
  }

  private dispatchNode(node: ASTNode, scope: Record<string, any>): string {
    switch (node.type) {
      case 'Text':
        return node.value;

      case 'EscapedExpression':
        return this.evaluateExpression(node.expression, scope, true);

      case 'RawExpression':
        return this.evaluateExpression(node.expression, scope, false);

      case 'If':
        return this.evaluateIf(node, scope);

      case 'ForEach':
        return this.evaluateForeach(node, scope);

      case 'For':
        return this.evaluateFor(node, scope);

      case 'While':
        return this.evaluateWhile(node, scope);

      case 'Js':
        return this.evaluateJs(node.code, scope);

      case 'IncludeScope':
        return this.evaluateIncludeScope(node, scope);

      case 'Comment':
        // Comments are stripped, return empty
        return '';

      case 'Extends':
      case 'Section':
      case 'Yield':
      case 'Include':
        // These are handled by renderer/composer, not runtime
        return '';

      default:
        // Unknown node type, skip silently
        return '';
    }
  }

  /**
   * Evaluate expression: {{ }} hoặc {!! !!}
   *
   * Lỗi cú pháp/đánh giá được ném ra để renderer bọc kèm tên template.
   */
  private evaluateExpression(expression: string, scope: Record<string, any>, escaped: boolean): string {
    // Hot path: no try/catch wrapping. Errors will propagate naturally with
    // minimal context. For full error context, callers can enable debug mode.
    const value = this.evaluator.evaluate(expression, scope);
    const stringValue = this.coerceToString(value);
    return escaped ? this.escapeHtml(stringValue) : stringValue;
  }

  /**
   * Evaluate @if/@elseif/@else
   */
  private evaluateIf(node: IfNode, scope: Record<string, any>): string {
    // Iterate through branches: if, elseif*, else?
    for (const branch of node.branches) {
      if (branch.kind === 'else') {
        // Else branch always executes
        return this.evaluateNodes(branch.body, scope);
      }

      // If or elseif - check condition
      const condition = this.evaluator.evaluate(branch.condition, scope);
      if (this.isTruthy(condition)) {
        return this.evaluateNodes(branch.body, scope);
      }
    }

    return '';
  }

/**
   * Evaluate @foreach - optimized with array accumulation
   */
  private evaluateForeach(node: ForEachNode, scope: Record<string, any>): string {
    const items = this.evaluator.evaluate(node.collection, scope);

    if (!items || typeof items !== 'object') {
      return '';
    }

    const parts: string[] = [];
    let iteration = 0;

    const entries: Array<[any, any]> = Array.isArray(items)
      ? items.map((value, index) => [index, value] as [any, any])
      : Object.entries(items);

    for (const [key, value] of entries) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }

      const loopScope: Record<string, any> = Object.create(scope);
      loopScope[node.value] = value;
      if (node.key) {
        loopScope[node.key] = key;
      }

      const result = this.evaluateNodes(node.body, loopScope);
      if (result) {
        parts.push(result);
      }
    }

    return parts.join('');
  }

  /**
   * Evaluate @for - optimized with array accumulation
   */
  private evaluateFor(node: ForNode, scope: Record<string, any>): string {
    const loopScope: Record<string, any> = Object.create(scope);
    this.evaluator.execute(node.init, loopScope);

    const parts: string[] = [];
    let iteration = 0;

    while (this.evaluator.evaluate(node.condition, loopScope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }

      const result = this.evaluateNodes(node.body, loopScope);
      if (result) {
        parts.push(result);
      }

      this.evaluator.execute(node.update, loopScope);
    }

    return parts.join('');
  }

  /**
   * Evaluate @while - optimized with array accumulation
   */
  private evaluateWhile(node: WhileNode, scope: Record<string, any>): string {
    const parts: string[] = [];
    let iteration = 0;

    while (this.evaluator.evaluate(node.condition, scope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }

      const result = this.evaluateNodes(node.body, scope);
      if (result) {
        parts.push(result);
      }
    }

    return parts.join('');
  }

  /**
   * Evaluate @js block
   */
  private evaluateJs(code: string, scope: Record<string, any>): string {
    // Execute JavaScript code trong scope (mutation được giữ lại)
    this.evaluator.execute(code, scope);
    return '';
  }

  /**
   * Evaluate @include('partial', { data }) — kết quả của IncludeProcessor.
   *
   * `dataExpression` được evaluate ngay tại đây (không phải lúc include-
   * processing) để có thể tham chiếu biến loop hiện tại (ví dụ `user` trong
   * `@foreach(users as user) @include('card', { user }) @endforeach`).
   * Data trở thành scope riêng cho partial (kế thừa scope ngoài qua
   * Object.create, giống @foreach/@for).
   */
  private evaluateIncludeScope(node: IncludeScopeNode, scope: Record<string, any>): string {
    const data = this.evaluator.evaluate(node.dataExpression, scope);
    const childScope: Record<string, any> = Object.create(scope);
    if (data && typeof data === 'object') {
      Object.assign(childScope, data);
    }
    return this.evaluateNodes(node.body, childScope);
  }

  /**
   * HTML escape (XSS protection) - optimized with array join
   * 
   * Unicode-safe: Uses String.prototype.replace() with a regex that handles
   * all characters, not just ASCII. This prevents XSS via Unicode bypass
   * (e.g., U+2028, U+2029 LINE/PARAGRAPH SEPARATOR which break JS strings).
   * 
   * Performance: array.push + join is ~3x faster than string += in loop.
   */
  private escapeHtml(value: string): string {
    const len = value.length;
    // Fast-path scan: only allocate array if escaping is actually needed
    let firstEscaped = -1;
    for (let i = 0; i < len; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) {
        if (BladeRuntime.HTML_ESCAPE_TABLE[code] !== '') {
          firstEscaped = i;
          break;
        }
      } else if (code === 8232 || code === 8233) {
        firstEscaped = i;
        break;
      }
    }
    if (firstEscaped === -1) return value; // Nothing to escape - return original

    // Build escaped output starting from firstEscaped
    const parts: string[] = [];
    if (firstEscaped > 0) parts.push(value.slice(0, firstEscaped));
    let lastIndex = firstEscaped;

    for (let i = firstEscaped; i < len; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) {
        const escaped = BladeRuntime.HTML_ESCAPE_TABLE[code];
        if (escaped) {
          if (i > lastIndex) parts.push(value.slice(lastIndex, i));
          parts.push(escaped);
          lastIndex = i + 1;
        }
      } else if (code === 8232 || code === 8233) {
        if (i > lastIndex) parts.push(value.slice(lastIndex, i));
        parts.push(`&#${code};`);
        lastIndex = i + 1;
      }
    }

    if (lastIndex < len) parts.push(value.slice(lastIndex));
    return parts.join('');
  }

  // Pre-built lookup table for HTML escaping (index = char code)
  // Index 38=&, 60=<, 62=>, 34=", 39='
  private static readonly HTML_ESCAPE_TABLE: ReadonlyArray<string> = (() => {
    const table = new Array(128).fill('');
    table[38] = '&amp;';
    table[60] = '&lt;';
    table[62] = '&gt;';
    table[34] = '&quot;';
    table[39] = '&#039;';
    return table;
  })();

  /**
   * Coerce value to string.
   * 
   * Handles edge cases that would otherwise crash or produce useless output:
   * - BigInt → numeric suffix
   * - Symbol → description
   * - Function → source preview
   * - Date, RegExp, Map, Set, Error → meaningful text
   * - Circular references → fallback to "..." (no crash)
   * - Objects with throwing toString → fallback
   */
  private coerceToString(value: any): string {
    // Handle null/undefined first (avoids `typeof null === 'object'` quirk)
    if (value === undefined) return '';
    if (value === null) return '';

    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number') {
      if (value === value) return String(value); // normal (covers -0, ±Infinity)
      return 'NaN';
    }
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'bigint') return `${value.toString()}n`;
    if (type === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol()';
    if (type === 'function') {
      // Avoid rendering huge source - cap at 80 chars
      const src = value.toString();
      return src.length > 80 ? `${src.slice(0, 77)}...` : src;
    }

    // From here, type === 'object'
    // Special types with meaningful toString
    if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (value instanceof Map) {
      const entries: string[] = [];
      try {
        for (const [k, v] of value) {
          entries.push(`${this.coerceToString(k)} => ${this.coerceToString(v)}`);
        }
      } catch {
        return '[Map]';
      }
      return `Map(${entries.length}) { ${entries.join(', ')} }`;
    }
    if (value instanceof Set) {
      const entries: string[] = [];
      try {
        for (const v of value) entries.push(this.coerceToString(v));
      } catch {
        return '[Set]';
      }
      return `Set(${entries.length}) { ${entries.join(', ')} }`;
    }
    if (ArrayBuffer.isView(value)) {
      // TypedArray / DataView
      return `${(value as any).constructor.name}(${(value as any).length})`;
    }

    // Try safe JSON.stringify (handles circular refs and BigInt)
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Fallback: try .toString() in a guarded way
      try {
        const s = value.toString();
        return s === '[object Object]' ? '[Object]' : s;
      } catch {
        return '[Unserializable]';
      }
    }
  }

  /**
   * Check if value is truthy (JavaScript semantics)
   */
  private isTruthy(value: any): boolean {
    return Boolean(value);
  }

  /**
   * Check recursion depth
   */
  private checkDepth(): void {
    if (this.currentDepth > this.maxDepth) {
      throw this.enrichError(
        new Error(`Maximum recursion depth exceeded: ${this.maxDepth}`)
      );
    }
  }

  /**
   * Enrich an error with runtime context (depth, node type, location).
   */
  private enrichError(err: unknown): Error {
    if (!(err instanceof Error)) {
      return new Error(String(err));
    }
    if ((err as any).__leafBladeEnriched) {
      return err;
    }

    const ctxParts: string[] = [];
    const top = this.nodeStack[this.nodeStack.length - 1];
    if (top) {
      const loc = (top as any).start;
      const locStr = loc ? ` line ${loc.line}, col ${loc.column}` : '';
      const expr = (top as any).expression || (top as any).condition;
      const exprStr = expr ? ` "${expr}"` : '';
      ctxParts.push(`in <${top.type}>${exprStr}${locStr}`);
    }
    if (this.currentDepth > 0) {
      ctxParts.push(`depth ${this.currentDepth}/${this.maxDepth}`);
    }

    if (ctxParts.length > 0) {
      err.message = `[${ctxParts.join(' | ')}] ${err.message}`;
    }
    (err as any).__leafBladeEnriched = true;
    return err;
  }
}
