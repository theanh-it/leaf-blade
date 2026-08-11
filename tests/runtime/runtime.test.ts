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

  test('prevents infinite loop', async () => {
    const runtime = new BladeRuntime({ maxIterations: 10 });
    const node: ASTNode = {
      type: 'While',
      condition: 'true',
      body: [text('x')],
      start: loc,
      end: loc,
    };
    await expect(runtime.evaluate([node], {})).rejects.toThrow('maximum iterations');
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
});
