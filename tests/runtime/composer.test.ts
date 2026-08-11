/**
 * Tests for TemplateComposer
 * 
 * Test @extends/@section/@yield layout inheritance system
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { TemplateComposer, type TemplateLoader } from '../../src/engines/runtime/composer';
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

describe('TemplateComposer', () => {
  let loader: MockTemplateLoader;
  let composer: TemplateComposer;

  beforeEach(() => {
    loader = new MockTemplateLoader();
    composer = new TemplateComposer({ loader });
  });

  test('returns template as-is when no @extends', async () => {
    const ast: ASTNode[] = [
      { type: 'Text', value: 'Hello World', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 11, offset: 11 } },
    ];

    const result = await composer.compose(ast, 'test.blade.html');
    expect(result).toEqual(ast);
  });

  test('basic @extends and @section/@yield', async () => {
    // Child template
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'Section',
        name: 'content',
        inlineValue: null,
        body: [{ type: 'Text', value: 'Child content', start: { line: 2, column: 1, offset: 21 }, end: { line: 2, column: 14, offset: 34 } }],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 3, column: 1, offset: 35 },
      },
    ];

    // Layout template
    const layout: ASTNode[] = [
      { type: 'Text', value: '<html><body>', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 12, offset: 12 } },
      { type: 'Yield', name: 'content', start: { line: 2, column: 1, offset: 13 }, end: { line: 2, column: 20, offset: 32 } },
      { type: 'Text', value: '</body></html>', start: { line: 3, column: 1, offset: 33 }, end: { line: 3, column: 15, offset: 47 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ type: 'Text', value: '<html><body>' });
    expect(result[1]).toMatchObject({ type: 'Text', value: 'Child content' });
    expect(result[2]).toMatchObject({ type: 'Text', value: '</body></html>' });
  });

  test('inline section syntax', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'Section',
        name: 'title',
        inlineValue: 'My Title',
        body: [],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 2, column: 30, offset: 50 },
      },
    ];

    const layout: ASTNode[] = [
      { type: 'Text', value: '<title>', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 7, offset: 7 } },
      { type: 'Yield', name: 'title', start: { line: 1, column: 8, offset: 8 }, end: { line: 1, column: 22, offset: 22 } },
      { type: 'Text', value: '</title>', start: { line: 1, column: 23, offset: 23 }, end: { line: 1, column: 31, offset: 31 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result[1]).toMatchObject({ type: 'Text', value: 'My Title' });
  });

  test('multiple sections', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'Section',
        name: 'header',
        inlineValue: null,
        body: [{ type: 'Text', value: 'Header', start: { line: 2, column: 1, offset: 21 }, end: { line: 2, column: 7, offset: 27 } }],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 3, column: 1, offset: 28 },
      },
      {
        type: 'Section',
        name: 'content',
        inlineValue: null,
        body: [{ type: 'Text', value: 'Content', start: { line: 4, column: 1, offset: 29 }, end: { line: 4, column: 8, offset: 36 } }],
        start: { line: 4, column: 1, offset: 29 },
        end: { line: 5, column: 1, offset: 37 },
      },
    ];

    const layout: ASTNode[] = [
      { type: 'Yield', name: 'header', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 18, offset: 18 } },
      { type: 'Yield', name: 'content', start: { line: 2, column: 1, offset: 19 }, end: { line: 2, column: 19, offset: 37 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Header' });
    expect(result[1]).toMatchObject({ type: 'Text', value: 'Content' });
  });

  test('@yield with default value when section missing', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
    ];

    const layout: ASTNode[] = [
      { type: 'Yield', name: 'title', defaultValue: 'Default Title', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 30, offset: 30 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Default Title' });
  });

  test('@yield renders nothing when section missing and no default', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
    ];

    const layout: ASTNode[] = [
      { type: 'Text', value: 'Before', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
      { type: 'Yield', name: 'missing', start: { line: 2, column: 1, offset: 7 }, end: { line: 2, column: 19, offset: 25 } },
      { type: 'Text', value: 'After', start: { line: 3, column: 1, offset: 26 }, end: { line: 3, column: 6, offset: 31 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Before' });
    expect(result[1]).toMatchObject({ type: 'Text', value: 'After' });
  });

  test('nested layouts (layout extends another layout)', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'middle', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'Section',
        name: 'content',
        inlineValue: null,
        body: [{ type: 'Text', value: 'Child', start: { line: 2, column: 1, offset: 21 }, end: { line: 2, column: 6, offset: 26 } }],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 3, column: 1, offset: 27 },
      },
    ];

    const middle: ASTNode[] = [
      { type: 'Extends', layout: 'base', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 18, offset: 18 } },
      {
        type: 'Section',
        name: 'body',
        inlineValue: null,
        body: [
          { type: 'Text', value: '<main>', start: { line: 2, column: 1, offset: 19 }, end: { line: 2, column: 7, offset: 25 } },
          { type: 'Yield', name: 'content', start: { line: 3, column: 1, offset: 26 }, end: { line: 3, column: 19, offset: 44 } },
          { type: 'Text', value: '</main>', start: { line: 4, column: 1, offset: 45 }, end: { line: 4, column: 8, offset: 52 } },
        ],
        start: { line: 2, column: 1, offset: 19 },
        end: { line: 5, column: 1, offset: 53 },
      },
    ];

    const base: ASTNode[] = [
      { type: 'Text', value: '<html>', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 6, offset: 6 } },
      { type: 'Yield', name: 'body', start: { line: 2, column: 1, offset: 7 }, end: { line: 2, column: 16, offset: 22 } },
      { type: 'Text', value: '</html>', start: { line: 3, column: 1, offset: 23 }, end: { line: 3, column: 8, offset: 30 } },
    ];

    loader.addTemplate('middle', middle);
    loader.addTemplate('base', base);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ type: 'Text', value: '<html>' });
    expect(result[1]).toMatchObject({ type: 'Text', value: '<main>' });
    expect(result[2]).toMatchObject({ type: 'Text', value: 'Child' });
    expect(result[3]).toMatchObject({ type: 'Text', value: '</main>' });
    expect(result[4]).toMatchObject({ type: 'Text', value: '</html>' });
  });

  test('throws on circular extends', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'parent', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
    ];

    const parent: ASTNode[] = [
      { type: 'Extends', layout: 'child', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 19, offset: 19 } },
    ];

    loader.addTemplate('parent', parent);
    loader.addTemplate('child', child);

    await expect(composer.compose(child, 'child.blade.html')).rejects.toThrow('Circular extends detected');
  });

  test('throws on max extends depth exceeded', async () => {
    const composerWithLimit = new TemplateComposer({ loader, maxExtendsDepth: 2 });

    const child: ASTNode[] = [
      { type: 'Extends', layout: 'l1', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    const l1: ASTNode[] = [
      { type: 'Extends', layout: 'l2', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    const l2: ASTNode[] = [
      { type: 'Extends', layout: 'l3', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 15, offset: 15 } },
    ];

    const l3: ASTNode[] = [
      { type: 'Text', value: 'Final', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 5, offset: 5 } },
    ];

    loader.addTemplate('l1', l1);
    loader.addTemplate('l2', l2);
    loader.addTemplate('l3', l3);

    await expect(composerWithLimit.compose(child, 'child')).rejects.toThrow('exceeded maximum depth');
  });

  test('handles sections in nested @if', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'If',
        branches: [
          {
            kind: 'if',
            condition: 'true',
            body: [
              {
                type: 'Section',
                name: 'content',
                inlineValue: null,
                body: [{ type: 'Text', value: 'In If', start: { line: 3, column: 1, offset: 40 }, end: { line: 3, column: 6, offset: 45 } }],
                start: { line: 3, column: 1, offset: 40 },
                end: { line: 4, column: 1, offset: 46 },
              },
            ],
            start: { line: 2, column: 1, offset: 21 },
            end: { line: 5, column: 1, offset: 47 },
          },
        ],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 5, column: 1, offset: 47 },
      },
    ];

    const layout: ASTNode[] = [
      { type: 'Yield', name: 'content', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 19, offset: 19 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child.blade.html');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'In If' });
  });

  test('template not found throws error', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'missing', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 21, offset: 21 } },
    ];

    await expect(composer.compose(child, 'child')).rejects.toThrow('Template not found: missing');
  });

  test('section definitions removed from final output', async () => {
    const child: ASTNode[] = [
      { type: 'Extends', layout: 'layout', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 20, offset: 20 } },
      {
        type: 'Section',
        name: 'content',
        inlineValue: null,
        body: [{ type: 'Text', value: 'Content', start: { line: 2, column: 1, offset: 21 }, end: { line: 2, column: 8, offset: 28 } }],
        start: { line: 2, column: 1, offset: 21 },
        end: { line: 3, column: 1, offset: 29 },
      },
      { type: 'Text', value: 'After Section', start: { line: 4, column: 1, offset: 30 }, end: { line: 4, column: 14, offset: 43 } },
    ];

    const layout: ASTNode[] = [
      { type: 'Yield', name: 'content', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 19, offset: 19 } },
    ];

    loader.addTemplate('layout', layout);

    const result = await composer.compose(child, 'child');
    
    // Should only have the yield replacement, not "After Section"
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'Text', value: 'Content' });
  });
});
