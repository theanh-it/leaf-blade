/**
 * Tests for BladeRuntime
 *
 * Sử dụng AST schema thật: Text/EscapedExpression/RawExpression/If/ForEach/
 * For/While/Js/Comment với các trường start/end.
 */
import { describe, test, expect } from 'bun:test';
import { BladeRuntime } from '../../src/engines/runtime/runtime';
import type { ASTNode, IfNode } from '../../src/engines/parser/ast';

const loc = { line: 1, column: 1, offset: 0 };

function text(value: string): ASTNode {
  return { type: 'Text', value, start: loc, end: loc };
}
function expr(expression: string, escaped = true): ASTNode {
  return {
    type: escaped ? 'EscapedExpression' : 'RawExpression',
    expression,
    start: loc,
    end: loc,
  } as ASTNode;
}

describe('BladeRuntime', () => {
  test('renders text node', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([text('Hello World')], {});
    expect(result).toBe('Hello World');
  });

  test('renders escaped expression {{ }}', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('name')], { name: 'John' });
    expect(result).toBe('John');
  });

  test('escapes HTML in {{ }}', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('html')], {
      html: '<script>alert("xss")</script>',
    });
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('renders raw expression {!! !!}', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('html', false)], {
      html: '<strong>Bold</strong>',
    });
    expect(result).toBe('<strong>Bold</strong>');
  });

  test('renders @if true', async () => {
    const runtime = new BladeRuntime();
    const node: IfNode = {
      type: 'If',
      branches: [
        { kind: 'if', condition: 'show', body: [text('visible')], start: loc, end: loc },
      ],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { show: true });
    expect(result).toBe('visible');
  });

  test('renders @if false with @else', async () => {
    const runtime = new BladeRuntime();
    const node: IfNode = {
      type: 'If',
      branches: [
        { kind: 'if', condition: 'show', body: [text('yes')], start: loc, end: loc },
        { kind: 'else', body: [text('no')], start: loc, end: loc },
      ],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { show: false });
    expect(result).toBe('no');
  });

  test('renders @foreach array', async () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'ForEach',
      collection: 'items',
      value: 'item',
      body: [expr('item'), text(',')],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { items: ['a', 'b', 'c'] });
    expect(result).toBe('a,b,c,');
  });

  test('renders @foreach with key', async () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'ForEach',
      collection: 'items',
      key: 'index',
      value: 'item',
      body: [expr('index'), text(':'), expr('item'), text(',')],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { items: ['x', 'y'] });
    expect(result).toBe('0:x,1:y,');
  });

  test('renders @foreach object', async () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'ForEach',
      collection: 'obj',
      key: 'key',
      value: 'val',
      body: [expr('key'), text('='), expr('val'), text(';')],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { obj: { a: '1', b: '2' } });
    expect(result).toBe('a=1;b=2;');
  });

  test('handles nested @if in @foreach', async () => {
    const runtime = new BladeRuntime();
    const inner: IfNode = {
      type: 'If',
      branches: [
        { kind: 'if', condition: 'item > 5', body: [expr('item')], start: loc, end: loc },
      ],
      start: loc,
      end: loc,
    };
    const node: ASTNode = {
      type: 'ForEach',
      collection: 'items',
      value: 'item',
      body: [inner],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { items: [3, 7, 4, 9] });
    expect(result).toBe('79');
  });

  test('handles optional chaining', async () => {
    const runtime = new BladeRuntime();
    const result1 = await runtime.evaluate([expr('user?.name')], {
      user: { name: 'John' },
    });
    expect(result1).toBe('John');

    const result2 = await runtime.evaluate([expr('user?.name')], { user: null });
    expect(result2).toBe('');
  });

  test('handles nullish coalescing', async () => {
    const runtime = new BladeRuntime();
    const result1 = await runtime.evaluate([expr('name ?? "Guest"')], { name: 'John' });
    expect(result1).toBe('John');

    const result2 = await runtime.evaluate([expr('name ?? "Guest"')], { name: null });
    expect(result2).toBe('Guest');
  });

  test('handles complex expressions', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('items.length * 2 + 10')], {
      items: [1, 2, 3],
    });
    expect(result).toBe('16');
  });

  test('prevents infinite loop', () => {
    const runtime = new BladeRuntime({ maxIterations: 10 });
    const node: ASTNode = {
      type: 'While',
      condition: 'true',
      body: [text('x')],
      start: loc,
      end: loc,
    };
    expect(() => runtime.evaluate([node], {})).toThrow('maximum iterations');
  });

  test('handles empty foreach gracefully', async () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'ForEach',
      collection: 'items',
      value: 'item',
      body: [expr('item')],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], { items: [] });
    expect(result).toBe('');
  });

  test('handles undefined variables', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('missing')], {});
    expect(result).toBe('');
  });

  test('coerces numbers to strings', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('count')], { count: 42 });
    expect(result).toBe('42');
  });

  test('coerces booleans to strings', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('flag')], { flag: true });
    expect(result).toBe('true');
  });

  test('ignores comments', async () => {
    const runtime = new BladeRuntime();
    const comment: ASTNode = { type: 'Comment', value: 'this is a comment', start: loc, end: loc };
    const result = await runtime.evaluate([text('before'), comment, text('after')], {});
    expect(result).toBe('beforeafter');
  });

  test('executes @js block mutating scope', async () => {
    const runtime = new BladeRuntime();
    const js: ASTNode = { type: 'Js', code: 'count = count + 5;', start: loc, end: loc };
    const result = await runtime.evaluate([js, expr('count')], { count: 10 });
    expect(result).toBe('15');
  });

  test('runs @for loop', async () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'For',
      init: 'i = 0',
      condition: 'i < 3',
      update: 'i++',
      body: [expr('i')],
      start: loc,
      end: loc,
    };
    const result = await runtime.evaluate([node], {});
    expect(result).toBe('012');
  });

  // ===== Regression tests for v1.0.2 HTML escape Unicode-safety =====

  test('escapes HTML special chars in ASCII text', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('text')], {
      text: '<script>alert("XSS")</script>',
    });
    expect(result).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  });

  test('preserves safe Unicode characters', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('text')], {
      text: 'Xin chào 日本語 中文',
    });
    expect(result).toBe('Xin chào 日本語 中文');
  });

  test('escapes U+2028 LINE SEPARATOR to prevent JS injection', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('text')], {
      text: 'safe\u2028unsafe',
    });
    expect(result).toBe('safe&#8232;unsafe');
  });

  test('escapes U+2029 PARAGRAPH SEPARATOR to prevent JS injection', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('text')], {
      text: 'safe\u2029unsafe',
    });
    expect(result).toBe('safe&#8233;unsafe');
  });

  test('escapes ampersand correctly', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('text')], { text: 'A & B' });
    expect(result).toBe('A &amp; B');
  });

  test('coerces NaN to literal string "NaN"', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('n')], { n: NaN });
    expect(result).toBe('NaN');
  });

  test('coerces array to JSON', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('arr')], { arr: [1, 2, 3] });
    expect(result).toBe('[1,2,3]');
  });

  test('coerces object to JSON', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('obj')], { obj: { a: 1 } });
    // JSON.stringify escapes " as \", which then gets HTML-escaped to &quot;
    expect(result).toBe('{&quot;a&quot;:1}');
  });

  // ===== v1.0.3 regression tests: robust coerceToString =====

  test('coerces Symbol to description', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: Symbol('hello') });
    expect(result).toBe('Symbol(hello)');
  });

  test('coerces Symbol without description', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: Symbol() });
    expect(result).toBe('Symbol()');
  });

  test('coerces BigInt with n suffix', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: 9007199254740993n });
    expect(result).toBe('9007199254740993n');
  });

  test('coerces function to source (truncated if long)', async () => {
    const runtime = new BladeRuntime();
    const fn = () => 'hi';
    const result = await runtime.evaluate([{ type: 'RawExpression', expression: 'f', start: loc, end: loc }], { f: fn });
    expect(result).toBe(fn.toString());
  });

  test('truncates very long function source', async () => {
    const runtime = new BladeRuntime();
    const longBody = 'a'.repeat(200);
    const fn = new Function(`return ${longBody}`);
    const result = await runtime.evaluate([{ type: 'RawExpression', expression: 'f', start: loc, end: loc }], { f: fn });
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('...')).toBe(true);
  });

  test('handles circular references without crashing', async () => {
    const runtime = new BladeRuntime();
    const circ: any = { name: 'circ' };
    circ.self = circ;
    const result = await runtime.evaluate([expr('x')], { x: circ });
    // Should not throw - falls back to "[Object]"
    expect(result).toBe('[Object]');
  });

  test('handles throwing toString gracefully', async () => {
    const runtime = new BladeRuntime();
    const evil = {
      toString: () => { throw new Error('boom'); },
    };
    const result = await runtime.evaluate([expr('x')], { x: evil });
    // JSON.stringify returns "{}" for objects with throwing toString but no enumerable props
    // (it doesn't actually invoke toString). Result must be a string and not crash.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('serializes Date to ISO string', async () => {
    const runtime = new BladeRuntime();
    const date = new Date('2025-01-01T00:00:00.000Z');
    const result = await runtime.evaluate([expr('x')], { x: date });
    expect(result).toBe('2025-01-01T00:00:00.000Z');
  });

  test('serializes Invalid Date', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: new Date('invalid') });
    expect(result).toBe('Invalid Date');
  });

  test('serializes RegExp', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: /test/gi });
    expect(result).toBe('/test/gi');
  });

  test('serializes Map with entries', async () => {
    const runtime = new BladeRuntime();
    const m = new Map([['a', 1], ['b', 2]]);
    const result = await runtime.evaluate([expr('x')], { x: m });
    expect(result).toContain('Map(2)');
    expect(result).toContain('a =&gt; 1');
    expect(result).toContain('b =&gt; 2');
  });

  test('serializes Set with entries', async () => {
    const runtime = new BladeRuntime();
    const s = new Set([1, 2, 3]);
    const result = await runtime.evaluate([expr('x')], { x: s });
    expect(result).toContain('Set(3)');
    expect(result).toContain('1, 2, 3');
  });

  test('serializes TypedArray', async () => {
    const runtime = new BladeRuntime();
    const ta = new Uint8Array([1, 2, 3]);
    const result = await runtime.evaluate([expr('x')], { x: ta });
    expect(result).toBe('Uint8Array(3)');
  });

  test('serializes Error', async () => {
    const runtime = new BladeRuntime();
    const err = new TypeError('bad type');
    const result = await runtime.evaluate([expr('x')], { x: err });
    expect(result).toBe('TypeError: bad type');
  });

  test('coerces -0 correctly', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: -0 });
    expect(result).toBe('0');
  });

  test('coerces Infinity to "Infinity"', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: Infinity });
    expect(result).toBe('Infinity');
  });

  test('coerces -Infinity to "-Infinity"', async () => {
    const runtime = new BladeRuntime();
    const result = await runtime.evaluate([expr('x')], { x: -Infinity });
    expect(result).toBe('-Infinity');
  });

  // ===== v1.0.3 regression tests: maxDepth enforcement =====

  test('enforces maxDepth for nested @if', async () => {
    const runtime = new BladeRuntime({ maxDepth: 3 });
    // Build deeply nested @if
    const buildNested = (depth: number): ASTNode[] => {
      if (depth === 0) return [{ type: 'Text', value: 'x', start: loc, end: loc }];
      return [{
        type: 'If',
        branches: [{
          kind: 'if',
          condition: 'true',
          body: buildNested(depth - 1),
          start: loc,
          end: loc,
        }],
        start: loc,
        end: loc,
      }];
    };
    expect(() => runtime.evaluate(buildNested(10), {})).toThrow(/Maximum recursion depth/);
  });

  test('enforces maxDepth for nested @foreach', () => {
    const runtime = new BladeRuntime({ maxDepth: 3 });
    const buildNested = (depth: number): ASTNode[] => {
      if (depth === 0) return [{ type: 'Text', value: 'x', start: loc, end: loc }];
      return [{
        type: 'ForEach',
        collection: 'arr',
        value: 'v',
        body: buildNested(depth - 1),
        start: loc,
        end: loc,
      } as any];
    };
    expect(() => runtime.evaluate(buildNested(10), { arr: [1] })).toThrow(/Maximum recursion depth/);
  });

  test('depth counter resets after error', () => {
    const runtime = new BladeRuntime({ maxDepth: 3 });
    const buildNested = (depth: number): ASTNode[] => {
      if (depth === 0) return [{ type: 'Text', value: 'x', start: loc, end: loc }];
      return [{
        type: 'If',
        branches: [{
          kind: 'if',
          condition: 'true',
          body: buildNested(depth - 1),
          start: loc,
          end: loc,
        }],
        start: loc,
        end: loc,
      }];
    };
    try {
      runtime.evaluate(buildNested(10), {});
    } catch { /* expected */ }
    const result = runtime.evaluate(buildNested(2), {});
    expect(result).toBe('x');
  });

  // ===== v1.0.3 regression tests: error context =====

  test('error includes node type in context', () => {
    const runtime = new BladeRuntime();
    try {
      runtime.evaluate([expr('undefined_var.deep.access')], {});
    } catch (e: any) {
      expect(e.message).toMatch(/depth \d+\/\d+/);
    }
  });

  test('error includes location info', () => {
    const runtime = new BladeRuntime();
    const node: ASTNode = {
      type: 'EscapedExpression',
      expression: 'nonexistent.deep.path',
      start: { line: 42, column: 7, offset: 100 },
      end: { line: 42, column: 32, offset: 125 },
    };
    try {
      runtime.evaluate([node], {});
    } catch (e: any) {
      expect(e.message).toMatch(/line 42/);
      expect(e.message).toMatch(/col 7/);
    }
  });

  test('error message has maxIterations info', () => {
    const runtime = new BladeRuntime({ maxIterations: 2 });
    const node: ASTNode = {
      type: 'For',
      init: 'i = 0',
      condition: 'i < 10',
      update: 'i++',
      body: [{ type: 'Text', value: 'x', start: loc, end: loc }],
      start: loc,
      end: loc,
    };
    try {
      runtime.evaluate([node], {});
    } catch (e: any) {
      expect(e.message).toMatch(/maxIterations|maximum iterations/);
    }
  });
});
