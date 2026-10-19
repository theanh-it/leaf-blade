/**
 * Expression Evaluator
 *
 * Evaluation of developer-owned JavaScript template expressions.
 * Guards provide defense in depth, not isolation for untrusted JavaScript.
 * Performance-optimized với LRU expression caching và fast-path.
 */

export interface EvaluatorOptions {
  /**
   * Enable expression guards; this is not isolation for untrusted JavaScript.
   * @default true
   */
  security?: boolean;

  /**
   * Allow access to these globals
   * @default ['Math', 'Date', 'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object', 'console']
   */
  allowedGlobals?: string[];

  /**
   * Maximum compiled expressions cached (LRU eviction)
   * @default 1000
   */
  maxCacheSize?: number;
}

// JavaScript literals that should NOT go through fast-path (they need real JS evaluation)
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

/**
 * Simple LRU Cache using Map's insertion-order semantics.
 * get() updates order (marks as recently used), set() evicts oldest on overflow.
 */
class LRUCache<V> {
  private map = new Map<string, V>();

  constructor(private maxSize: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first inserted)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export class ExpressionEvaluator {
  private allowedGlobals: Set<string>;
  private safeGlobals: Record<string, any>;
  private maxCacheSize: number;
  private securityEnabled: boolean;
  // LRU caches - guarantees hot entries aren't evicted under concurrent load
  private expressionCache: LRUCache<(scope: any) => any>;
  private statementCache: LRUCache<(scope: any) => any>;

  // Pre-compiled dangerous patterns for validation
  private static readonly DANGEROUS_PATTERNS = [
    /\beval\s*\(/i,
    /\bFunction\s*\(/i,
    /\bsetTimeout\s*\(/i,
    /\bsetInterval\s*\(/i,
    /\bexecScript\s*\(/i,
    /\b__proto__\b/,
    /\bconstructor\b\s*[\(\[]/,  // constructor( or constructor[
    /\bprototype\b/,             // .prototype access (avoid prototype pollution)
    /\bprocess\s*\./,
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /\bglobal\s*\./,
    /\bwindow\s*\./,
    /\bdocument\s*\./,
    /\bglobalThis\b/,
    /\bthis\b/,
    /\bvalueOf\b\s*\(/,          // valueOf() can be exploited
  ] as const;

  // Dangerous property names that should never be accessible
  private static readonly DANGEROUS_PROPS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'valueOf',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ]);

  constructor(options: EvaluatorOptions = {}) {
    this.allowedGlobals = new Set(
      options.allowedGlobals || [
        'Math',
        'Date',
        'JSON',
        'String',
        'Number',
        'Boolean',
        'Array',
        'Object',
        'console',
      ]
    );
    this.maxCacheSize = options.maxCacheSize ?? 1000;
    this.securityEnabled = options.security ?? true;
    this.safeGlobals = this.buildSafeGlobals();
    this.expressionCache = new LRUCache(this.maxCacheSize);
    this.statementCache = new LRUCache(this.maxCacheSize);
  }

  /**
   * Fast-path evaluator: bypasses Proxy overhead for simple property access.
   * Handles: `name`, `user.name`, `user?.name`, `a.b.c`
   *
   * Parse/check a property path once. Complex expressions and guarded property
   * names fall back to validation and cached JavaScript evaluation.
   */
  evaluate(expression: string, context: Record<string, any>): any {
    if (!expression || (expression = expression.trim()) === '') {
      return undefined;
    }

    // Parse and validate identifier paths once, including inherited loop/include
    // scopes. Do not allocate a new parts array on each evaluation.
    let parts = this.fastPathCache.get(expression);
    if (parts === undefined) {
      const simple = !LITERAL_KEYWORDS.has(expression) && /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\?\.[a-zA-Z_$][\w$]*)*$/.test(expression);
      parts = simple ? expression.replace(/\?/g, "").split(".") : null;
      if (parts && this.securityEnabled && parts.some(key => ExpressionEvaluator.DANGEROUS_PROPS.has(key))) parts = null;
      if (this.fastPathCache.size >= ExpressionEvaluator.FAST_PATH_CACHE_MAX) {
        const oldest = this.fastPathCache.keys().next();
        if (!oldest.done) this.fastPathCache.delete(oldest.value);
      }
      this.fastPathCache.set(expression, parts);
    }
    if (parts) {
      const first = parts[0];
      let value: unknown;
      if (first in context) value = context[first];
      else if (Object.prototype.hasOwnProperty.call(this.safeGlobals, first)) value = this.safeGlobals[first];
      else return this.evaluateWithProxy(expression, context);
      for (let i = 1; i < parts.length; i++) {
        if (value == null) return undefined;
        value = (value as Record<string, unknown>)[parts[i]];
      }
      return value;
    }
    return this.evaluateWithProxy(expression, context);
  }

  private static readonly FAST_PATH_CACHE_MAX = 1000;
  private fastPathCache = new Map<string, readonly string[] | null>();

  /**
   * Slow-path: full evaluation with Proxy (for complex expressions).
   * Security validation happens here, before compilation.
   */
  private evaluateWithProxy(expression: string, context: Record<string, any>): any {
    let func = this.expressionCache.get(expression);
    if (!func) {
      if (this.securityEnabled) this.validateExpression(expression);
      func = this.compile(expression, false);
      this.expressionCache.set(expression, func);
    }

    try {
      const scope = this.makeScope(context);
      return func(scope);
    } catch (error) {
      throw new Error(
        `Failed to evaluate expression: ${expression}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute statement (không return value)
   * Dùng cho @js blocks và @for init/increment.
   */
  execute(statement: string, context: Record<string, any>): void {
    if (!statement || (statement = statement.trim()) === '') {
      return;
    }

    let func = this.statementCache.get(statement);
    if (!func) {
      if (this.securityEnabled) this.validateExpression(statement);
      func = this.compile(statement, true);
      this.statementCache.set(statement, func);
    }

    try {
      const scope = this.makeScope(context);
      func(scope);
    } catch (error) {
      throw new Error(
        `Failed to execute statement: ${statement}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Compile expression/statement thành function nhận `__scope__`.
   * Validation đã được gọi trước khi vào đây.
   */
  private compile(code: string, isStatement: boolean): (scope: any) => any {
    const body = isStatement
      ? `with (__scope__) {\n${code}\n}`
      : `with (__scope__) {\nreturn (${code});\n}`;

    try {
      return new Function('__scope__', body) as (scope: any) => any;
    } catch {
      throw new Error(
        `Invalid ${isStatement ? 'statement' : 'expression'} syntax: ${code}`
      );
    }
  }

  /**
   * Tạo Proxy scope bao quanh context.
   *
   * Security: Strictly blocks Object.prototype pollution methods.
   * Other prototype-chain lookups are allowed (needed for @foreach/@for).
   *
   * Performance: Pre-builds a Set of safeGlobals keys for O(1) lookup.
   */
  private makeScope(context: Record<string, any>): any {
    const self = this;
    return new Proxy(context, {
      has(): boolean {
        return true;
      },
      get: (target, key: string | symbol): any => {
        if (key === Symbol.unscopables) {
          return undefined;
        }
        if (typeof key === 'string') {
          // Block dangerous keys early
          if (ExpressionEvaluator.DANGEROUS_PROPS.has(key)) {
            return undefined;
          }
          // Check own property first
          if (Object.prototype.hasOwnProperty.call(target, key)) {
            return (target as any)[key];
          }
          // Walk prototype chain (stops at Object.prototype implicitly
          // because DANGEROUS_PROPS blocks sentinel methods)
          let proto = Object.getPrototypeOf(target);
          while (proto !== null) {
            if (Object.prototype.hasOwnProperty.call(proto, key)) {
              return (proto as any)[key];
            }
            proto = Object.getPrototypeOf(proto);
          }
          // Fallback to safeGlobals
          if (Object.prototype.hasOwnProperty.call(self.safeGlobals, key)) {
            return self.safeGlobals[key];
          }
          return undefined;
        }
        return (target as any)[key];
      },
      set: (target, key: string | symbol, value: any): boolean => {
        (target as any)[key] = value;
        return true;
      },
    });
  }

  /**
   * Build safe global objects - computed once in constructor
   * (and rebuilt after addGlobal/removeGlobal)
   */
  private buildSafeGlobals(): Record<string, any> {
    const globals: Record<string, any> = {};

    if (this.allowedGlobals.has('Math')) globals.Math = Math;
    if (this.allowedGlobals.has('Date')) globals.Date = Date;
    if (this.allowedGlobals.has('JSON')) globals.JSON = JSON;
    if (this.allowedGlobals.has('String')) globals.String = String;
    if (this.allowedGlobals.has('Number')) globals.Number = Number;
    if (this.allowedGlobals.has('Boolean')) globals.Boolean = Boolean;
    if (this.allowedGlobals.has('Array')) globals.Array = Array;
    if (this.allowedGlobals.has('Object')) globals.Object = Object;
    if (this.allowedGlobals.has('console')) globals.console = console;

    return globals;
  }

  /**
   * Validate expression for security
   */
  private validateExpression(expression: string): void {
    // Fold adjacent simple string literals for validation only, so a computed
    // constructor name cannot bypass the guard merely by splitting the string.
    let normalized = expression;
    let previous: string;
    do {
      previous = normalized;
      normalized = normalized.replace(
        /(["'])([^"'\\]*)\1\s*\+\s*(["'])([^"'\\]*)\3/g,
        (_match, _leftQuote: string, left: string, _rightQuote: string, right: string) => JSON.stringify(left + right)
      );
    } while (normalized !== previous);
    if (/\[\s*(["'])(?:constructor|__proto__|prototype)\1\s*\]/.test(normalized)) {
      throw new Error("Expression contains dangerous pattern: computed prototype access");
    }
    for (const pattern of ExpressionEvaluator.DANGEROUS_PATTERNS) {
      if (pattern.test(normalized)) {
        throw new Error(
          `Expression contains dangerous pattern: ${pattern.source}\n` +
          `Expression: ${expression}`
        );
      }
    }
  }

  /**
   * Add custom global to whitelist.
   * Rebuilds safeGlobals so the new entry is immediately usable in templates.
   *
   * @param name - Global identifier name
   * @param value - Optional explicit value (defaults to globalThis[name])
   */
  addGlobal(name: string, value?: any): void {
    this.allowedGlobals.add(name);
    // Always set the explicit value (or fall back to globalThis lookup)
    this.safeGlobals[name] = value !== undefined ? value : (globalThis as any)[name];
  }

  /**
   * Remove global from whitelist
   */
  removeGlobal(name: string): void {
    this.allowedGlobals.delete(name);
    delete this.safeGlobals[name];
  }

  /**
   * Clear all compiled caches (useful for memory-constrained environments)
   */
  clearCache(): void {
    this.expressionCache.clear();
    this.statementCache.clear();
    this.fastPathCache.clear();
  }

  /**
   * Get current cache statistics
   */
  getCacheStats(): { expressionSize: number; statementSize: number; maxSize: number } {
    return {
      expressionSize: this.expressionCache.size,
      statementSize: this.statementCache.size,
      maxSize: this.maxCacheSize,
    };
  }
}
