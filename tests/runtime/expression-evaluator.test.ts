/**
 * Tests for ExpressionEvaluator
 */
import { describe, test, expect } from 'bun:test';
import { ExpressionEvaluator } from '../../src/engines/runtime/expression-evaluator';

describe('ExpressionEvaluator', () => {
  test('evaluates simple variable', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('name', { name: 'John' });
    expect(result).toBe('John');
  });

  test('evaluates arithmetic', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('a + b', { a: 5, b: 3 });
    expect(result).toBe(8);
  });

  test('evaluates property access', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('user.name', { user: { name: 'Jane' } });
    expect(result).toBe('Jane');
  });

  test('evaluates optional chaining', () => {
    const evaluator = new ExpressionEvaluator();
    const result1 = evaluator.evaluate('user?.name', { user: { name: 'John' } });
    expect(result1).toBe('John');
    
    const result2 = evaluator.evaluate('user?.name', { user: null });
    expect(result2).toBeUndefined();
  });

  test('evaluates nullish coalescing', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('name ?? "Guest"', { name: null });
    expect(result).toBe('Guest');
  });

  test('evaluates ternary operator', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('age >= 18 ? "adult" : "minor"', { age: 20 });
    expect(result).toBe('adult');
  });

  test('evaluates array access', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('items[1]', { items: ['a', 'b', 'c'] });
    expect(result).toBe('b');
  });

  test('evaluates method calls', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('name.toUpperCase()', { name: 'hello' });
    expect(result).toBe('HELLO');
  });

  test('evaluates Math functions', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('Math.max(a, b)', { a: 5, b: 10 });
    expect(result).toBe(10);
  });

  test('blocks eval()', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('eval("alert(1)")', {});
    }).toThrow('dangerous pattern');
  });

  test('blocks Function constructor', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('Function("return 1")()', {});
    }).toThrow('dangerous pattern');
  });

  test('blocks __proto__', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('obj.__proto__', { obj: {} });
    }).toThrow('dangerous pattern');
  });

  test('blocks process access', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('process.exit()', {});
    }).toThrow('dangerous pattern');
  });

  test('blocks require()', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('require("fs")', {});
    }).toThrow('dangerous pattern');
  });

  test('executes statements', () => {
    const evaluator = new ExpressionEvaluator();
    const context = { count: 0 };
    evaluator.execute('count = count + 1', context);
    expect(context.count).toBe(1);
  });

  test('executes multiple statements', () => {
    const evaluator = new ExpressionEvaluator();
    const context = { x: 1, y: 2 };
    evaluator.execute('x = x + 1; y = y * 2', context);
    expect(context.x).toBe(2);
    expect(context.y).toBe(4);
  });

  test('handles empty expression', () => {
    const evaluator = new ExpressionEvaluator();
    const result = evaluator.evaluate('', {});
    expect(result).toBeUndefined();
  });

  test('throws on invalid syntax', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('invalid syntax !!!', {});
    }).toThrow('Invalid expression syntax');
  });
});
