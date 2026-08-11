/**
 * Tests for codegen (AST → ops) and CompiledRuntime
 */
import { describe, test, expect } from 'bun:test';
import { compileNodes } from '../../src/engines/runtime/codegen.ts';
import { CompiledRuntime } from '../../src/engines/runtime/compiled-runtime.ts';
import { BladeCompiler } from '../../src/engines/parser/compiler.ts';
import type { ASTNode } from '../../src/engines/parser/ast.ts';

const compiler = new BladeCompiler({ viewsDir: '/tmp' });
const runtime = new CompiledRuntime();

const loc = { line: 1, column: 1, offset: 0 };

describe('codegen - basic compilation', () => {
  test('compiles text node', () => {
    const ast = compiler.parse('hello world');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ t: 'T', v: 'hello world' });
  });

  test('coalesces consecutive text nodes', () => {
    const ast: ASTNode[] = [
      { type: 'Text', value: 'hello ', start: loc, end: loc },
      { type: 'Text', value: 'world', start: loc, end: loc },
    ];
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ t: 'T', v: 'hello world' });
  });

  test('compiles escaped expression', () => {
    const ast = compiler.parse('{{ name }}');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ t: 'E', e: 'name', s: 1 });
  });

  test('compiles raw expression', () => {
    const ast = compiler.parse('{!! html !!}');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ t: 'E', e: 'html', s: 0 });
  });

  test('skips comments', () => {
    const ast = compiler.parse('{{-- comment --}}');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(0);
  });
});

describe('codegen - control flow', () => {
  test('compiles if/else', () => {
    const ast = compiler.parse('@if(x)A@else B@endif');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0].t).toBe('I');
  });

  test('compiles if/elseif/else chain', () => {
    const ast = compiler.parse(`@if(a)A@elseif(b)B@elseif(c)C@else D@endif`);
    const ops = compileNodes(ast);
    // Should be 1 outer IF with nested IF in el
    expect(ops).toHaveLength(1);
    const outer = ops[0] as any;
    expect(outer.t).toBe('I');
    expect(outer.c).toBe('a');
    expect(outer.el).toBeDefined();
    expect(outer.el[0].c).toBe('b');
    expect(outer.el[0].el[0].c).toBe('c');
    expect(outer.el[0].el[0].el[0].t).toBe('T'); // else body
  });

  test('compiles foreach with key', () => {
    const ast = compiler.parse('@foreach(items as item)i={{ item }}@endforeach');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0].t).toBe('FE');
  });

  test('compiles for loop', () => {
    const ast = compiler.parse('@for(i = 0; i < 10; i++)x@endfor');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0].t).toBe('FR');
  });

  test('compiles while loop', () => {
    const ast = compiler.parse('@while(i < 10)x@endwhile');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0].t).toBe('W');
  });

  test('compiles js block', () => {
    const ast = compiler.parse('@js x = 5\n@endjs');
    const ops = compileNodes(ast);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ t: 'JS', code: 'x = 5' });
  });
});

describe('CompiledRuntime - execution', () => {
  test('executes text', () => {
    const ops = compileNodes(compiler.parse('hello'));
    expect(runtime.execute(ops, {})).toBe('hello');
  });

  test('executes simple expression with escape', () => {
    const ops = compileNodes(compiler.parse('{{ x }}'));
    expect(runtime.execute(ops, { x: '<b>' })).toBe('&lt;b&gt;');
  });

  test('executes raw expression', () => {
    const ops = compileNodes(compiler.parse('{!! x !!}'));
    expect(runtime.execute(ops, { x: '<b>' })).toBe('<b>');
  });

  test('executes if true branch', () => {
    const ops = compileNodes(compiler.parse('@if(x)YES@else NO@endif'));
    expect(runtime.execute(ops, { x: true })).toBe('YES');
  });

  test('executes if false branch', () => {
    const ops = compileNodes(compiler.parse('@if(x)YES@else NO@endif'));
    // Parser captures the space after @else in body text
    expect(runtime.execute(ops, { x: false }).trim()).toBe('NO');
  });

  test('executes elseif chain', () => {
    const ops = compileNodes(compiler.parse(
      '@if(a)A@elseif(b)B@elseif(c)C@else D@endif'
    ));
    expect(runtime.execute(ops, { a: true }).trim()).toBe('A');
    expect(runtime.execute(ops, { a: false, b: true }).trim()).toBe('B');
    expect(runtime.execute(ops, { a: false, b: false, c: true }).trim()).toBe('C');
    expect(runtime.execute(ops, { a: false, b: false, c: false }).trim()).toBe('D');
  });

  test('executes foreach over array', () => {
    const ops = compileNodes(compiler.parse('@foreach(items as item){{ item }}@endforeach'));
    expect(runtime.execute(ops, { items: ['a', 'b', 'c'] })).toBe('abc');
  });

  test('executes foreach over object', () => {
    const ops = compileNodes(compiler.parse('@foreach(obj as val){{ val }}@endforeach'));
    expect(runtime.execute(ops, { obj: { a: 1, b: 2 } })).toBe('12');
  });

  test('executes for loop', () => {
    const ops = compileNodes(compiler.parse('@for(i = 0; i < 3; i++){{ i }}@endfor'));
    expect(runtime.execute(ops, {})).toBe('012');
  });

  test('executes while loop', () => {
    // While loop needs explicit increment in body
    const ops = compileNodes(compiler.parse('@while(i < 3){{ i }}@js i++@endjs@endwhile'));
    expect(runtime.execute(ops, { i: 0 })).toBe('012');
  });

  test('executes js block', () => {
    const ops = compileNodes(compiler.parse('@js x = 5@endjs{{ x }}'));
    expect(runtime.execute(ops, {})).toBe('5');
  });

  test('respects maxIterations', () => {
    const rt = new CompiledRuntime({ maxIterations: 3 });
    const ops = compileNodes(compiler.parse('@while(true)x@endwhile'));
    expect(() => rt.execute(ops, {})).toThrow('maximum iterations');
  });

  test('respects maxDepth', () => {
    const rt = new CompiledRuntime({ maxDepth: 3 });
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
    const ops = compileNodes(buildNested(10));
    expect(() => rt.execute(ops, {})).toThrow(/Maximum recursion depth/);
  });

  test('handles null/undefined gracefully', () => {
    const ops = compileNodes(compiler.parse('{{ x }}'));
    expect(runtime.execute(ops, { x: null })).toBe('');
    expect(runtime.execute(ops, { x: undefined })).toBe('');
  });

  test('handles special types', () => {
    const ops = compileNodes(compiler.parse('{{ x }}'));
    expect(runtime.execute(ops, { x: Symbol('test') })).toBe('Symbol(test)');
    expect(runtime.execute(ops, { x: 10n })).toBe('10n');
    expect(runtime.execute(ops, { x: true })).toBe('true');
    expect(runtime.execute(ops, { x: false })).toBe('false');
    expect(runtime.execute(ops, { x: NaN })).toBe('NaN');
  });

  test('handles Map/Set/Date', () => {
    const ops = compileNodes(compiler.parse('{{ x }}'));
    expect(runtime.execute(ops, { x: new Date('2025-01-01T00:00:00Z') })).toBe('2025-01-01T00:00:00.000Z');
    expect(runtime.execute(ops, { x: new Map([['a', 1]]) })).toContain('Map(1)');
    expect(runtime.execute(ops, { x: new Set([1, 2]) })).toContain('Set(2)');
    expect(runtime.execute(ops, { x: /test/gi })).toBe('/test/gi');
  });
});

describe('codegen - performance characteristics', () => {
  test('op count is smaller than AST node count', () => {
    const source = '@if(x)A@elseif(y)B@else C@endif';
    const ast = compiler.parse(source);
    const ops = compileNodes(ast);
    function countNodes(nodes: ASTNode[]): number {
      let count = 0;
      for (const node of nodes) {
        count++;
        if (node.type === 'If') {
          for (const branch of node.branches) {
            count += countNodes(branch.body);
          }
        } else if (node.type === 'ForEach' || node.type === 'For' || node.type === 'While') {
          count += countNodes(node.body);
        }
      }
      return count;
    }
    const astSize = countNodes(ast);
    expect(ops.length).toBeLessThan(astSize / 2);
  });
});
