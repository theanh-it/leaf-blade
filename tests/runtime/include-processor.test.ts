/**
 * Tests for IncludeProcessor
 * 
 * Test @include directive processing
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { IncludeProcessor } from '../../src/engines/runtime/include-processor';
import { RuntimeContext } from '../../src/engines/runtime/context';
import type { TemplateLoader } from '../../src/engines/runtime/composer';
import type { ASTNode } from '../../src/engines/parser/ast';

// Mock template loader
class MockTemplateLoader implements TemplateLoader {
  private templates = new Map<string, ASTNode[]>();

  addTemplate(name: string, ast: ASTNode[]): void {
    this.templates.set(name, ast);
  }

  async load(templateName: string): Promise<ASTNode[]> {
    const ast = this.templates.get(templateName);
    if (!ast) {
      throw new Error(`Template not found: ${templateName}`);
    }
    return ast;
  }

  clear(): void {
    this.templates.clear();
  }
}

describe('IncludeProcessor', () => {
  let loader: MockTemplateLoader;
  let processor: IncludeProcessor;
  let context: RuntimeContext;

  beforeEach(() => {
    loader = new MockTemplateLoader();
    processor = new IncludeProcessor({ loader });
    context = new RuntimeContext({ user: 'John' });
  });

  test('returns AST as-is when no @include', async () => {
    const ast: ASTNode[] = [
      { type: 'Text', value: 'Hello World', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 11, offset: 11 } },
    ];

    const result = await processor.processIncludes(ast, context, 'test.blade.html');
    expect(result).toEqual(ast);
  });

  test('basic @include without data', async () => {
    const ast: ASTNode[] = [
      { type: 'Text', value: 'Before', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
      { type: 'Include', partial: 'header', start: { line: 2, column: 1, offset: 7 }, end: { line: 2, column: 23, offset: 29 } },
      { type: 'Text', value: 'After', start: { line: 3, column: 1, offset: 30 }, end: { line: 3, column: 5, offset: 35 } },
    ];

    const header: ASTNode[] = [
      { type: 'Text', value: '<header>Logo</header>', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 21, offset: 21 } },
    ];

    loader.addTemplate('header', header);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Before' });
    expect(result[1]).toMatchObject({ type: 'Text', value: '<header>Logo</header>' });
    expect(result[2]).toMatchObject({ type: 'Text', value: 'After' });
  });

  test('@include with data expression', async () => {
    const ast: ASTNode[] = [
      {
        type: 'Include',
        partial: 'card',
        dataExpression: '{ title: "Test", count: 42 }',
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 50, offset: 50 },
      },
    ];

    const card: ASTNode[] = [
      { type: 'Text', value: 'Card:', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 5, offset: 5 } },
      { type: 'EscapedExpression', expression: 'title', start: { line: 1, column: 6, offset: 6 }, end: { line: 1, column: 17, offset: 17 } },
    ];

    loader.addTemplate('card', card);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');

    // Should wrap partial trong IncludeScopeNode, giữ dataExpression để
    // runtime evaluate đúng lúc (hỗ trợ biến loop).
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('IncludeScope');
    const scopeNode = result[0] as any;
    expect(scopeNode.dataExpression).toBe('{ title: "Test", count: 42 }');
    expect(scopeNode.body).toHaveLength(2);
    expect(scopeNode.body[0]).toMatchObject({ type: 'Text', value: 'Card:' });
    expect(scopeNode.body[1]).toMatchObject({ type: 'EscapedExpression', expression: 'title' });
  });

  test('nested includes', async () => {
    const ast: ASTNode[] = [
      { type: 'Include', partial: 'outer', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 22, offset: 22 } },
    ];

    const outer: ASTNode[] = [
      { type: 'Text', value: 'Outer-', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
      { type: 'Include', partial: 'inner', start: { line: 2, column: 1, offset: 7 }, end: { line: 2, column: 22, offset: 28 } },
    ];

    const inner: ASTNode[] = [
      { type: 'Text', value: 'Inner', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 5, offset: 5 } },
    ];

    loader.addTemplate('outer', outer);
    loader.addTemplate('inner', inner);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Outer-' });
    expect(result[1]).toMatchObject({ type: 'Text', value: 'Inner' });
  });

  test('include in @if conditional', async () => {
    const ast: ASTNode[] = [
      {
        type: 'If',
        branches: [
          {
            kind: 'if',
            condition: 'showHeader',
            body: [
              { type: 'Include', partial: 'header', start: { line: 2, column: 1, offset: 20 }, end: { line: 2, column: 25, offset: 44 } },
            ],
            start: { line: 1, column: 1, offset: 0 },
            end: { line: 3, column: 1, offset: 45 },
          },
        ],
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 1, offset: 45 },
      },
    ];

    const header: ASTNode[] = [
      { type: 'Text', value: 'Header', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
    ];

    loader.addTemplate('header', header);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('If');
    expect((result[0] as any).branches[0].body[0]).toMatchObject({ type: 'Text', value: 'Header' });
  });

  test('include in @foreach loop', async () => {
    const ast: ASTNode[] = [
      {
        type: 'ForEach',
        collection: 'items',
        value: 'item',
        body: [
          { type: 'Include', partial: 'item', start: { line: 2, column: 1, offset: 30 }, end: { line: 2, column: 22, offset: 51 } },
        ],
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 1, offset: 52 },
      },
    ];

    const itemTemplate: ASTNode[] = [
      { type: 'Text', value: '<li>', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 4 } },
      { type: 'EscapedExpression', expression: 'item', start: { line: 1, column: 5, offset: 5 }, end: { line: 1, column: 15, offset: 15 } },
      { type: 'Text', value: '</li>', start: { line: 1, column: 16, offset: 16 }, end: { line: 1, column: 21, offset: 21 } },
    ];

    loader.addTemplate('item', itemTemplate);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('ForEach');
    
    const body = (result[0] as any).body;
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ type: 'Text', value: '<li>' });
    expect(body[1]).toMatchObject({ type: 'EscapedExpression', expression: 'item' });
    expect(body[2]).toMatchObject({ type: 'Text', value: '</li>' });
  });

  test('throws on circular includes', async () => {
    const ast: ASTNode[] = [
      { type: 'Include', partial: 'a', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    const templateA: ASTNode[] = [
      { type: 'Include', partial: 'b', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    const templateB: ASTNode[] = [
      { type: 'Include', partial: 'a', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    loader.addTemplate('a', templateA);
    loader.addTemplate('b', templateB);

    await expect(
      processor.processIncludes(ast, context, 'main.blade.html')
    ).rejects.toThrow('Circular include detected');
  });

  test('throws on max include depth exceeded', async () => {
    const processorWithLimit = new IncludeProcessor({ loader, maxIncludeDepth: 2 });

    const ast: ASTNode[] = [
      { type: 'Include', partial: 'l1', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 17, offset: 17 } },
    ];

    const l1: ASTNode[] = [
      { type: 'Include', partial: 'l2', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 17, offset: 17 } },
    ];

    const l2: ASTNode[] = [
      { type: 'Include', partial: 'l3', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 17, offset: 17 } },
    ];

    const l3: ASTNode[] = [
      { type: 'Text', value: 'Deep', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 4 } },
    ];

    loader.addTemplate('l1', l1);
    loader.addTemplate('l2', l2);
    loader.addTemplate('l3', l3);

    await expect(
      processorWithLimit.processIncludes(ast, context, 'main.blade.html')
    ).rejects.toThrow('Include depth exceeded maximum');
  });

  test('template not found throws error', async () => {
    const ast: ASTNode[] = [
      { type: 'Include', partial: 'missing', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 23, offset: 23 } },
    ];

    await expect(
      processor.processIncludes(ast, context, 'main.blade.html')
    ).rejects.toThrow('Template not found: missing');
  });

  test('multiple includes in sequence', async () => {
    const ast: ASTNode[] = [
      { type: 'Include', partial: 'header', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 23, offset: 23 } },
      { type: 'Include', partial: 'content', start: { line: 2, column: 1, offset: 24 }, end: { line: 2, column: 25, offset: 48 } },
      { type: 'Include', partial: 'footer', start: { line: 3, column: 1, offset: 49 }, end: { line: 3, column: 23, offset: 71 } },
    ];

    loader.addTemplate('header', [
      { type: 'Text', value: 'Header', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
    ]);
    loader.addTemplate('content', [
      { type: 'Text', value: 'Content', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 7, offset: 7 } },
    ]);
    loader.addTemplate('footer', [
      { type: 'Text', value: 'Footer', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
    ]);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Header' });
    expect(result[1]).toMatchObject({ type: 'Text', value: 'Content' });
    expect(result[2]).toMatchObject({ type: 'Text', value: 'Footer' });
  });

  test('include with complex nested structure', async () => {
    const ast: ASTNode[] = [
      {
        type: 'ForEach',
        collection: 'users',
        value: 'user',
        body: [
          {
            type: 'If',
            branches: [
              {
                kind: 'if',
                condition: 'user.active',
                body: [
                  { type: 'Include', partial: 'user-card', start: { line: 3, column: 1, offset: 50 }, end: { line: 3, column: 30, offset: 79 } },
                ],
                start: { line: 2, column: 1, offset: 20 },
                end: { line: 4, column: 1, offset: 80 },
              },
            ],
            start: { line: 2, column: 1, offset: 20 },
            end: { line: 4, column: 1, offset: 80 },
          },
        ],
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 5, column: 1, offset: 81 },
      },
    ];

    loader.addTemplate('user-card', [
      { type: 'Text', value: '<div class="card">', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 18, offset: 18 } },
      { type: 'EscapedExpression', expression: 'user.name', start: { line: 1, column: 19, offset: 19 }, end: { line: 1, column: 34, offset: 34 } },
      { type: 'Text', value: '</div>', start: { line: 1, column: 35, offset: 35 }, end: { line: 1, column: 41, offset: 41 } },
    ]);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('ForEach');
    
    const foreachBody = (result[0] as any).body;
    expect(foreachBody[0].type).toBe('If');
    
    const ifBody = foreachBody[0].branches[0].body;
    expect(ifBody).toHaveLength(3);
    expect(ifBody[0]).toMatchObject({ type: 'Text', value: '<div class="card">' });
  });

  test('clearStack() resets circular detection', async () => {
    const ast1: ASTNode[] = [
      { type: 'Include', partial: 'partial', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 24, offset: 24 } },
    ];

    loader.addTemplate('partial', [
      { type: 'Text', value: 'Content', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 7, offset: 7 } },
    ]);

    // First call
    await processor.processIncludes(ast1, context, 'main.blade.html');

    // Clear stack
    processor.clearStack();

    // Second call should work (stack cleared)
    const result = await processor.processIncludes(ast1, context, 'main.blade.html');
    expect(result).toHaveLength(1);
  });

  test('include in @while loop', async () => {
    const ast: ASTNode[] = [
      {
        type: 'While',
        condition: 'count < 3',
        body: [
          { type: 'Include', partial: 'item', start: { line: 2, column: 1, offset: 25 }, end: { line: 2, column: 22, offset: 46 } },
        ],
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 1, offset: 47 },
      },
    ];

    loader.addTemplate('item', [
      { type: 'Text', value: 'Item', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 4, offset: 4 } },
    ]);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('While');
    expect((result[0] as any).body[0]).toMatchObject({ type: 'Text', value: 'Item' });
  });

  test('include in @for loop', async () => {
    const ast: ASTNode[] = [
      {
        type: 'For',
        init: 'i = 0',
        condition: 'i < 5',
        update: 'i++',
        body: [
          { type: 'Include', partial: 'number', start: { line: 2, column: 1, offset: 35 }, end: { line: 2, column: 25, offset: 59 } },
        ],
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 3, column: 1, offset: 60 },
      },
    ];

    loader.addTemplate('number', [
      { type: 'EscapedExpression', expression: 'i', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 7, offset: 7 } },
    ]);

    const result = await processor.processIncludes(ast, context, 'main.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('For');
    expect((result[0] as any).body[0]).toMatchObject({ type: 'EscapedExpression', expression: 'i' });
  });
});
