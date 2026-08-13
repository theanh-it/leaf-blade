/**
 * Expression Evaluator
 *
 * Safe evaluation của JavaScript expressions trong template context.
 * Security-first design với sandboxing và whitelist approach.
 * Performance-optimized với LRU expression caching và fast-path.
 */

export interface EvaluatorOptions {
  /**
   * Enable security features (dangerous prop blocking, sandboxing)
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
   * Security: Performs dangerous-prop check inline. Returns FAST_PATH_MISS
   * if expression contains operators or unsafe properties, falling through
   * to validateExpression() in the slow path.
   */
  evaluate(expression: string, context: Record<string, any>): any {
    if (!expression || (expression = expression.trim()) === '') {
      return undefined;
    }

    // Fast-path: simple property access (very common in templates)
    // Cached: skip regex check after first call if expression is simple
    let cachedKind = this.fastPathCache.get(expression);
    if (cachedKind === undefined) {
      cachedKind = ExpressionEvaluator.isSimpleExpression(expression) ? 1 : 0;
      // Evict oldest entry if cache is full
      if (this.fastPathCache.size >= ExpressionEvaluator.FAST_PATH_CACHE_MAX) {
        const firstKey = this.fastPathCache.keys().next().value;
        if (firstKey !== undefined) this.fastPathCache.delete(firstKey);
      }
      this.fastPathCache.set(expression, cachedKind);
    }
    if (cachedKind === 1) {
      const fastResult = this.evaluateSimple(expression, context);
      if (fastResult !== ExpressionEvaluator.FAST_PATH_MISS) {
        return fastResult;
      }
    }

    // Slow path: full evaluation with Proxy
    return this.evaluateWithProxy(expression, context);
  }

  // Cache to skip regex test on repeated calls (bounded to prevent memory leak)
  private static readonly FAST_PATH_CACHE_MAX = 1000;
  private fastPathCache: Map<string, number> = new Map();

  /**
   * Quick check: is this a simple identifier chain (a.b.c or a?.b.c)?
   * Used for fast-path caching - faster than full evaluateSimple check.
   */
  private static isSimpleExpression(expr: string): boolean {
    return /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*|\?\.[a-zA-Z_$][\w$]*)*$/.test(expr);
  }

  /**
   * Fast-path evaluation for simple property chains.
   * Returns FAST_PATH_MISS if not applicable, otherwise the value or undefined.
   *
   * Walks both user context AND safeGlobals (so custom globals like
   * `{{ MyHelper }}` work without going through slow-path).
   */
  private evaluateSimple(expr: string, context: Record<string, any>): any {
    // Must start with identifier character (not a literal like 'true', 'null', '123')
    if (!/^[a-zA-Z_$]/.test(expr)) {
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    // Block literal keywords - these need Proxy evaluation
    if (LITERAL_KEYWORDS.has(expr)) {
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    // Single identifier: check context first, then globals
    if (expr.indexOf('.') === -1 && expr.indexOf('?') === -1) {
      if (Object.prototype.hasOwnProperty.call(context, expr)) {
        return context[expr];
      }
      if (Object.prototype.hasOwnProperty.call(this.safeGlobals, expr)) {
        return this.safeGlobals[expr];
      }
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    // Security: check each segment for dangerous properties (skip if security disabled)
    const parts = expr.split('.');
    if (this.securityEnabled) {
      for (const part of parts) {
        const key = part.endsWith('?') ? part.slice(0, -1) : part;
        if (ExpressionEvaluator.DANGEROUS_PROPS.has(key)) {
          return ExpressionEvaluator.FAST_PATH_MISS;
        }
      }
    }

    // Resolve first key
    const firstKey = parts[0].endsWith('?') ? parts[0].slice(0, -1) : parts[0];

    if (!Object.prototype.hasOwnProperty.call(context, firstKey)) {
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    // Walk the property chain
    let current: any = context[firstKey];
    let pendingOptional = false;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (pendingOptional && current == null) return undefined;

      const hasTrailingOptional = part[part.length - 1] === '?';
      const key = hasTrailingOptional ? part.slice(0, -1) : part;

      if (hasTrailingOptional) {
        pendingOptional = true;
        current = current?.[key];
      } else {
        current = current?.[key];
        pendingOptional = false;
      }
    }

    return current;
  }

  private static readonly FAST_PATH_MISS = Symbol('FAST_PATH_MISS');

  /**
   * Slow-path: full evaluation with Proxy (for complex expressions).
   * Security validation happens here, before compilation.
   */
  private evaluateWithProxy(expression: string, context: Record<string, any>): any {
    if (this.securityEnabled) {
      this.validateExpression(expression);
    }

    let func = this.expressionCache.get(expression);
    if (!func) {
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

    if (this.securityEnabled) {
      this.validateExpression(statement);
    }

    let func = this.statementCache.get(statement);
    if (!func) {
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
    for (const pattern of ExpressionEvaluator.DANGEROUS_PATTERNS) {
      if (pattern.test(expression)) {
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
