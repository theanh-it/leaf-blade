/**
 * Expression Evaluator
 * 
 * Safe evaluation của JavaScript expressions trong template context.
 * Security-first design với sandboxing và whitelist approach.
 */

export interface EvaluatorOptions {
  /**
   * Allow access to these globals
   * @default ['Math', 'Date', 'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object']
   */
  allowedGlobals?: string[];

  /**
   * Enable strict mode evaluation
   * @default true
   */
  strictMode?: boolean;
}

export class ExpressionEvaluator {
  private allowedGlobals: Set<string>;

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
        'console', // For debugging
      ]
    );
    // options.strictMode reserved (evaluator dùng `with`, không thể strict).
    void options.strictMode;
  }

  /**
   * Evaluate expression và return value
   *
   * Sử dụng `with(scope)` + Proxy để:
   *  - Bare identifier (name, user, ...) resolve từ context.
   *  - Biến không tồn tại → `undefined` (không throw ReferenceError),
   *    hỗ trợ optional chaining `user?.name` khi `user` chưa được định nghĩa.
   */
  evaluate(expression: string, context: Record<string, any>): any {
    if (!expression || expression.trim() === '') {
      return undefined;
    }

    // Security check
    this.validateExpression(expression);

    // Compile (có thể throw "Invalid expression syntax")
    const func = this.compile(expression, /* isStatement */ false);

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
   *
   * Assignment tới biến trong context được ghi ngược lại context object
   * thông qua Proxy `set` trap, nên mutation được giữ lại giữa các lần gọi.
   */
  execute(statement: string, context: Record<string, any>): void {
    if (!statement || statement.trim() === '') {
      return;
    }

    this.validateExpression(statement);

    const func = this.compile(statement, /* isStatement */ true);

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
   * Dùng `with` để identifier resolve qua Proxy scope.
   */
  private compile(code: string, isStatement: boolean): (scope: any) => any {
    const body = isStatement
      ? `with (__scope__) {\n${code}\n}`
      : `with (__scope__) {\nreturn (${code});\n}`;

    try {
      // Không dùng "use strict" vì cần `with`.
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
    const globals = this.buildSafeGlobals();

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
          if (Object.prototype.hasOwnProperty.call(globals, key)) {
            return globals[key];
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
   * Build safe global objects
   */
  private buildSafeGlobals(): Record<string, any> {
    const globals: Record<string, any> = {};

    // Only include whitelisted globals
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
    // Check for dangerous patterns
    const dangerousPatterns = [
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
    ];

    for (const pattern of dangerousPatterns) {
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
