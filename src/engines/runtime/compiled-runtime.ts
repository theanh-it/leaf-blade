/**
 * CompiledRuntime - Fast interpreter for compiled ops.
 *
 * Replaces BladeRuntime AST-walking interpreter with a tight loop over
 * pre-flattened ops. Key wins:
 *
 * 1. No switch on node.type per node (use op tag character)
 * 2. No object allocation per text/escape
 * 3. Direct array access (better cache locality)
 * 4. Inlined simple ops (text, expr) without function call overhead
 *
 * Maintains feature parity with BladeRuntime:
 * - HTML escaping
 * - @if/@elseif/@else
 * - @foreach (arrays + objects)
 * - @for / @while
 * - @js (mutations)
 * - @include scopes
 * - maxIterations, maxDepth
 * - Error context (depth)
 */
import type { Op } from './codegen.js';
import { ExpressionEvaluator } from './expression-evaluator.js';

export interface CompiledRuntimeOptions {
  maxIterations?: number;
  maxDepth?: number;
  evaluator?: ExpressionEvaluator;
}

export class CompiledRuntime {
  private evaluator: ExpressionEvaluator;
  private maxIterations: number;
  private maxDepth: number;
  private currentDepth = 0;

  // Pre-built HTML escape table (matches runtime.ts)
  private static readonly HTML_ESCAPE_TABLE: ReadonlyArray<string> = (() => {
    const table = new Array(128).fill('');
    table[38] = '&amp;';
    table[60] = '&lt;';
    table[62] = '&gt;';
    table[34] = '&quot;';
    table[39] = '&#039;';
    return table;
  })();

  constructor(options: CompiledRuntimeOptions = {}) {
    this.evaluator = options.evaluator || new ExpressionEvaluator();
    this.maxIterations = options.maxIterations || 10000;
    this.maxDepth = options.maxDepth || 100;
  }

  /**
   * Execute a compiled ops array, returning the rendered string.
   */
  execute(ops: Op[], scope: Record<string, any>): string {
    // Pre-allocate parts array (avoid resizing for typical templates)
    const parts: string[] = [];
    this.executeOps(ops, scope, parts);
    return parts.join('');
  }

  /**
   * Tight loop over ops - the hot path. Tracks depth for maxDepth check.
   */
  private executeOps(ops: Op[], scope: Record<string, any>, parts: string[]): void {
    this.currentDepth++;
    try {
      this.checkDepth();
      for (let i = 0, len = ops.length; i < len; i++) {
        const op = ops[i];
        switch (op.t) {
          case 'T':
            if (op.v.length > 0) parts.push(op.v);
            break;

          case 'E':
            if (op.s) {
              parts.push(this.evalAndEscape(op.e, scope));
            } else {
              parts.push(this.evalToString(op.e, scope));
            }
            break;

          case 'I':
            this.executeIf(op, scope, parts);
            break;

          case 'FE':
            this.executeForEach(op, scope, parts);
            break;

          case 'FR':
            this.executeFor(op, scope, parts);
            break;

          case 'W':
            this.executeWhile(op, scope, parts);
            break;

          case 'JS':
            this.evaluator.execute(op.code, scope);
            break;

          case 'IS':
            this.executeIncludeScope(op, scope, parts);
            break;
        }
      }
    } finally {
      this.currentDepth--;
    }
  }

  private evalToString(expr: string, scope: Record<string, any>): string {
    const v = this.evaluator.evaluate(expr, scope);
    return this.coerceToString(v);
  }

  private evalAndEscape(expr: string, scope: Record<string, any>): string {
    const v = this.evaluator.evaluate(expr, scope);
    return this.escapeHtml(this.coerceToString(v));
  }

  private executeIf(
    op: { c: string; b: Op[]; el?: Op[] },
    scope: Record<string, any>,
    parts: string[]
  ): void {
    if (this.isTruthy(this.evaluator.evaluate(op.c, scope))) {
      this.executeOps(op.b, scope, parts);
    } else if (op.el) {
      this.executeOps(op.el, scope, parts);
    }
  }

  private executeForEach(
    op: { c: string; v: string; k?: string; b: Op[] },
    scope: Record<string, any>,
    parts: string[]
  ): void {
    const items = this.evaluator.evaluate(op.c, scope);
    if (!items || typeof items !== 'object') return;

    const entries: Array<[any, any]> = Array.isArray(items)
      ? items.map((value, index) => [index, value] as [any, any])
      : Object.entries(items);

    let iteration = 0;
    for (let e = 0, eLen = entries.length; e < eLen; e++) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }
      const entry = entries[e];
      const loopScope: Record<string, any> = Object.create(scope);
      loopScope[op.v] = entry[1];
      if (op.k) loopScope[op.k] = entry[0];
      this.executeOps(op.b, loopScope, parts);
    }
  }

  private executeFor(
    op: { i: string; c: string; u: string; b: Op[] },
    scope: Record<string, any>,
    parts: string[]
  ): void {
    const loopScope: Record<string, any> = Object.create(scope);
    this.evaluator.execute(op.i, loopScope);
    let iteration = 0;
    while (this.evaluator.evaluate(op.c, loopScope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }
      this.executeOps(op.b, loopScope, parts);
      this.evaluator.execute(op.u, loopScope);
    }
  }

  private executeWhile(
    op: { c: string; b: Op[] },
    scope: Record<string, any>,
    parts: string[]
  ): void {
    let iteration = 0;
    while (this.evaluator.evaluate(op.c, scope)) {
      if (iteration++ >= this.maxIterations) {
        throw new Error(`Loop exceeded maximum iterations: ${this.maxIterations}`);
      }
      this.executeOps(op.b, scope, parts);
    }
  }

  private executeIncludeScope(
    op: { d: string; b: Op[] },
    scope: Record<string, any>,
    parts: string[]
  ): void {
    const data = this.evaluator.evaluate(op.d, scope);
    const childScope: Record<string, any> = Object.create(scope);
    if (data && typeof data === 'object') {
      for (const key in data) {
        childScope[key] = data[key];
      }
    }
    this.executeOps(op.b, childScope, parts);
  }

  /**
   * Coerce value to string. Handles edge cases (BigInt, Symbol, etc.)
   * Same logic as runtime.ts - kept in sync.
   */
  private coerceToString(value: any): string {
    if (value === undefined || value === null) return '';
    const type = typeof value;
    if (type === 'string') return value;
    if (type === 'number') return value === value ? String(value) : 'NaN';
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'bigint') return `${value.toString()}n`;
    if (type === 'symbol') return value.description ? `Symbol(${value.description})` : 'Symbol()';
    if (type === 'function') {
      const src = value.toString();
      return src.length > 80 ? `${src.slice(0, 77)}...` : src;
    }

    // Special object types
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
      return `${(value as any).constructor.name}(${(value as any).length})`;
    }

    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      try {
        const s = value.toString();
        return s === '[object Object]' ? '[Object]' : s;
      } catch {
        return '[Unserializable]';
      }
    }
  }

  /**
   * Fast HTML escape with early-exit scan.
   * Returns original string if no escaping needed.
   */
  private escapeHtml(value: string): string {
    const len = value.length;
    // Fast-path scan: find first char needing escape
    let firstEscaped = -1;
    for (let i = 0; i < len; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) {
        if (CompiledRuntime.HTML_ESCAPE_TABLE[code] !== '') {
          firstEscaped = i;
          break;
        }
      } else if (code === 8232 || code === 8233) {
        firstEscaped = i;
        break;
      }
    }
    if (firstEscaped === -1) return value;

    // Build escaped output
    const parts: string[] = [];
    if (firstEscaped > 0) parts.push(value.slice(0, firstEscaped));
    let lastIndex = firstEscaped;

    for (let i = firstEscaped; i < len; i++) {
      const code = value.charCodeAt(i);
      if (code < 128) {
        const escaped = CompiledRuntime.HTML_ESCAPE_TABLE[code];
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

  private isTruthy(value: any): boolean {
    return Boolean(value);
  }

  private checkDepth(): void {
    if (this.currentDepth > this.maxDepth) {
      throw new Error(`Maximum recursion depth exceeded: ${this.maxDepth}`);
    }
  }
}
