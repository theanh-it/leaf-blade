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
  async evaluate(nodes: ASTNode[], data: Record<string, any> = {}): Promise<string> {
    const scope: Record<string, any> = data ?? {};
    return this.evaluateNodes(nodes, scope);
  }

  /**
   * Evaluate một list nodes - optimized with array accumulation
   */
  private async evaluateNodes(nodes: ASTNode[], scope: Record<string, any>): Promise<string> {
    const parts: string[] = [];

    for (const node of nodes) {
      this.checkDepth();
      const result = await this.evaluateNode(node, scope);
      if (result) {
        parts.push(result);
      }
    }

    return parts.join('');
  }

  /**
   * Evaluate một node dựa trên type
   */
  private async evaluateNode(node: ASTNode, scope: Record<string, any>): Promise<string> {
    switch (node.type) {
      case 'Text':
        return node.value;

      case 'EscapedExpression':
        return this.evaluateExpression(node.expression, scope, true);

      case 'RawExpression':
        return this.evaluateExpression(node.expression, scope, false);

      case 'If':
        return await this.evaluateIf(node, scope);

      case 'ForEach':
        return await this.evaluateForeach(node, scope);

      case 'For':
        return await this.evaluateFor(node, scope);

      case 'While':
        return await this.evaluateWhile(node, scope);

      case 'Js':
        return this.evaluateJs(node.code, scope);

      case 'IncludeScope':
        return await this.evaluateIncludeScope(node, scope);

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
    const value = this.evaluator.evaluate(expression, scope);
    const stringValue = this.coerceToString(value);

    // Escape nếu là {{ }}, raw nếu là {!! !!}
    return escaped ? this.escapeHtml(stringValue) : stringValue;
  }

  /**
   * Evaluate @if/@elseif/@else
   */
  private async evaluateIf(node: IfNode, scope: Record<string, any>): Promise<string> {
    // Iterate through branches: if, elseif*, else?
    for (const branch of node.branches) {
      if (branch.kind === 'else') {
        // Else branch always executes
        return await this.evaluateNodes(branch.body, scope);
      }

      // If or elseif - check condition
      const condition = this.evaluator.evaluate(branch.condition, scope);
      if (this.isTruthy(condition)) {
        return await this.evaluateNodes(branch.body, scope);
      }
    }

    return '';
  }

  /**
   * Evaluate @foreach - optimized with array accumulation
   */
  private async evaluateForeach(node: ForEachNode, scope: Record<string, any>): Promise<string> {
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

      this.currentDepth++;
      const result = await this.evaluateNodes(node.body, loopScope);
      if (result) {
        parts.push(result);
      }
      this.currentDepth--;
    }

    return parts.join('');
  }

  /**
   * Evaluate @for - optimized with array accumulation
   */
  private async evaluateFor(node: ForNode, scope: Record<string, any>): Promise<string> {
    const loopScope: Record<string, any> = Object.create(scope);
    this.evaluator.execute(node.init, loopScope);

    const parts: string[] = [];
    let iteration = 0;

    while (this.evaluator.evaluate(node.condition, loopScope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }

      this.currentDepth++;
      const result = await this.evaluateNodes(node.body, loopScope);
      if (result) {
        parts.push(result);
      }
      this.currentDepth--;

      this.evaluator.execute(node.update, loopScope);
    }

    return parts.join('');
  }

  /**
   * Evaluate @while - optimized with array accumulation
   */
  private async evaluateWhile(node: WhileNode, scope: Record<string, any>): Promise<string> {
    const parts: string[] = [];
    let iteration = 0;

    while (this.evaluator.evaluate(node.condition, scope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }

      this.currentDepth++;
      const result = await this.evaluateNodes(node.body, scope);
      if (result) {
        parts.push(result);
      }
      this.currentDepth--;
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
  private async evaluateIncludeScope(node: IncludeScopeNode, scope: Record<string, any>): Promise<string> {
    const data = this.evaluator.evaluate(node.dataExpression, scope);
    const childScope: Record<string, any> = Object.create(scope);
    if (data && typeof data === 'object') {
      Object.assign(childScope, data);
    }
    return this.evaluateNodes(node.body, childScope);
  }

  /**
   * HTML escape (XSS protection) - optimized with lookup table
   * Benchmarked: ~3x faster than multiple replace() calls
   */
  private escapeHtml(value: string): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
      result += BladeRuntime.HTML_ESCAPE_TABLE[value.charCodeAt(i)] || value[i];
    }
    return result;
  }

  // Pre-built lookup table for HTML escaping (index = char code)
  private static readonly HTML_ESCAPE_TABLE: ReadonlyArray<string> = (() => {
    const table = new Array(128).fill('');
    table[38] = '&amp;';  // &
    table[60] = '&lt;';   // <
    table[62] = '&gt;';   // >
    table[34] = '&quot;'; // "
    table[39] = '&#039;'; // '
    return table;
  })();

  /**
   * Coerce value to string
   */
  private coerceToString(value: any): string {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      // Arrays and objects: JSON stringify
      return JSON.stringify(value);
    }
    return String(value);
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
    if (this.currentDepth >= this.maxDepth) {
      throw new Error(`Maximum recursion depth exceeded: ${this.maxDepth}`);
    }
  }
}
