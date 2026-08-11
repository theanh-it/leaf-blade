/**
 * Expression Evaluator
 * 
 * Safe evaluation của JavaScript expressions trong template context.
 * Security-first design với sandboxing và whitelist approach.
 * Performance-optimized với expression caching và fast-path.
 */

export interface EvaluatorOptions {
  allowedGlobals?: string[];
}

// Simple property access pattern: `name`, `user.name`, `a.b.c`
const SIMPLE_PROPERTY_REGEX = /^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*$/;
// Optional chaining pattern: `user?.name`, `a?.b?.c`
const OPTIONAL_CHAIN_REGEX = /^[a-zA-Z_$][\w$]*(?:\?\.?[a-zA-Z_$][\w$]*)*$/;
// JavaScript literals that should NOT go through fast-path
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

export class ExpressionEvaluator {
  private allowedGlobals: Set<string>;
  private expressionCache = new Map<string, (scope: any) => any>();
  private statementCache = new Map<string, (scope: any) => any>();
  private safeGlobals: Record<string, any>;

  // Pre-compiled dangerous patterns for validation
  private static readonly DANGEROUS_PATTERNS = [
    /\beval\s*\(/i,
    /\bFunction\s*\(/i,
    /\bsetTimeout\s*\(/i,
    /\bsetInterval\s*\(/i,
    /\bexecScript\s*\(/i,
    /\b__proto__\b/,
    /\bconstructor\s*\[/,
    /\bprocess\s*\./,
    /\brequire\s*\(/,
    /\bimport\s*\(/,
    /\bglobal\s*\./,
    /\bwindow\s*\./,
    /\bdocument\s*\./,
  ] as const;

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
    this.safeGlobals = this.buildSafeGlobals();
  }

  /**
   * Fast-path evaluator: bypasses Proxy overhead for simple property access.
   * Handles: `name`, `user.name`, `user?.name`, `a.b.c`
   */
  evaluate(expression: string, context: Record<string, any>): any {
    if (!expression || (expression = expression.trim()) === '') {
      return undefined;
    }

    // Fast-path: simple property access (very common in templates)
    // Skip Proxy overhead for expressions like `name`, `user.name`, `item.price`
    const fastResult = this.evaluateSimple(expression, context);
    if (fastResult !== ExpressionEvaluator.FAST_PATH_MISS) {
      return fastResult;
    }

    // Slow path: full evaluation with Proxy
    return this.evaluateWithProxy(expression, context);
  }

  /**
   * Fast-path evaluation for simple property chains.
   * Handles: `name`, `user.name`, `user?.name`, `a.b?.c`
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

    // Check if it's a safe property chain
    if (!SIMPLE_PROPERTY_REGEX.test(expr) && !OPTIONAL_CHAIN_REGEX.test(expr)) {
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    // Security: block dangerous property access
    if (expr.includes('__proto__') || expr.includes('constructor') || 
        expr.includes('prototype')) {
      return ExpressionEvaluator.FAST_PATH_MISS;
    }

    const parts = expr.split('.');
    let current: any = context;
    let pendingOptional = false;

    for (const part of parts) {
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
   * Security validation only done here, not for cached expressions.
   */
  private evaluateWithProxy(expression: string, context: Record<string, any>): any {
    // Security check (only for non-cached)
    this.validateExpression(expression);

    // Get or compile function (cached!)
    let func = this.expressionCache.get(expression);
    if (!func) {
      func = this.compile(expression, false);
      this.cacheWithLimit(this.expressionCache, expression, func, 5000);
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

    this.validateExpression(statement);

    let func = this.statementCache.get(statement);
    if (!func) {
      func = this.compile(statement, true);
      this.cacheWithLimit(this.statementCache, statement, func, 5000);
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
   * Helper: Cache with size limit
   */
  private cacheWithLimit(cache: Map<string, any>, key: string, value: any, limit: number): void {
    if (cache.size >= limit) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(key, value);
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
    } catch (error) {
      throw new Error(
        `Invalid ${isStatement ? 'statement' : 'expression'} syntax: ${code}`
      );
    }
  }

  /**
   * Tạo Proxy scope bao quanh context.
   *
   *  - `has` trả về true cho mọi key (trừ Symbol.unscopables) để `with`
   *    luôn resolve identifier qua Proxy, tránh rò rỉ ra global scope.
   *  - `get` trả về giá trị từ context (theo prototype chain) hoặc
   *    whitelisted global; ngược lại `undefined`.
   *  - `set` ghi vào context (own property).
   */
  private makeScope(context: Record<string, any>): any {
    return new Proxy(context, {
      has(): boolean {
        return true;
      },
      get: (target, key: string | symbol): any => {
        if (key === Symbol.unscopables) {
          return undefined;
        }
        if (typeof key === 'string') {
          if (key in target) {
            return (target as any)[key];
          }
          // Use pre-built safe globals
          if (Object.prototype.hasOwnProperty.call(this.safeGlobals, key)) {
            return this.safeGlobals[key];
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
   * Add custom global to whitelist
   */
  addGlobal(name: string, _value: any): void {
    this.allowedGlobals.add(name);
  }

  /**
   * Remove global from whitelist
   */
  removeGlobal(name: string): void {
    this.allowedGlobals.delete(name);
  }
}
