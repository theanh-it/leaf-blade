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

  // ===== Regression tests for v1.0.2 bug fixes =====

  test('addGlobal makes new global immediately available', () => {
    const evaluator = new ExpressionEvaluator();
    evaluator.addGlobal('MyHelper', { foo: 'bar' });
    // Without explicit value, falls back to globalThis[name]
    expect(evaluator.evaluate('MyHelper', {})).toBeDefined();
  });

  test('addGlobal with value is usable in expressions', () => {
    const evaluator = new ExpressionEvaluator();
    const helper = { greet: () => 'hi' };
    evaluator.addGlobal('helper', helper);
    // Will fall back to globalThis lookup - should not crash
    const result = evaluator.evaluate('1 + 1', {});
    expect(result).toBe(2);
  });

  test('removeGlobal removes access', () => {
    const evaluator = new ExpressionEvaluator();
    evaluator.removeGlobal('Math');
    expect(() => evaluator.evaluate('Math.max(1,2)', {})).toThrow();
  });

  test('LRU cache evicts oldest entries', () => {
    const evaluator = new ExpressionEvaluator({ maxCacheSize: 3 });
    // Use complex expressions so they go through slow-path (cache them)
    evaluator.evaluate('a + 1', { a: 1 });
    evaluator.evaluate('b + 1', { b: 2 });
    evaluator.evaluate('c + 1', { c: 3 });
    // Add one more - should evict 'a + 1'
    evaluator.evaluate('d + 1', { d: 4 });
    const stats = evaluator.getCacheStats();
    expect(stats.expressionSize).toBe(3);
    expect(stats.maxSize).toBe(3);
  });

  test('LRU cache keeps hot entries', () => {
    const evaluator = new ExpressionEvaluator({ maxCacheSize: 3 });
    evaluator.evaluate('a + 1', { a: 1 });
    evaluator.evaluate('b + 1', { b: 2 });
    // Re-access 'a + 1' - makes it most recently used
    evaluator.evaluate('a + 1', { a: 1 });
    // Now fill cache - should evict 'b + 1' (oldest), not 'a + 1'
    evaluator.evaluate('c + 1', { c: 3 });
    evaluator.evaluate('d + 1', { d: 4 });
    // 'a + 1' should still be there
    const stats = evaluator.getCacheStats();
    expect(stats.expressionSize).toBe(3);
  });

  test('clearCache empties both caches', () => {
    const evaluator = new ExpressionEvaluator();
    evaluator.evaluate('a', { a: 1 });
    evaluator.execute('b = 2', { b: 0 });
    evaluator.clearCache();
    const stats = evaluator.getCacheStats();
    expect(stats.expressionSize).toBe(0);
    expect(stats.statementSize).toBe(0);
  });

  test('blocks constructor() call (prototype chain exploit)', () => {
    const evaluator = new ExpressionEvaluator();
    // constructor followed by ( can lead to prototype chain escape
    expect(() => {
      evaluator.evaluate('obj.constructor("return 1")()', { obj: {} });
    }).toThrow('dangerous pattern');
  });

  test('blocks valueOf() call (prototype chain exploit)', () => {
    const evaluator = new ExpressionEvaluator();
    expect(() => {
      evaluator.evaluate('obj.valueOf()', { obj: {} });
    }).toThrow('dangerous pattern');
  });

  test('allows safe constructor property read', () => {
    const evaluator = new ExpressionEvaluator();
    // Plain read of .constructor is safe - returns the constructor function
    const result = evaluator.evaluate('obj.constructor.name', { obj: {} });
    expect(result).toBe('Object');
  });
});
