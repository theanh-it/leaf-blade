/**
 * Template Composer
 * 
 * Xử lý @extends/@section/@yield để compose template layouts.
 * Đây là phần quan trọng của Blade template inheritance.
 */

import type { ASTNode, ExtendsNode } from "../parser/ast.js";

export interface TemplateLoader {
  /**
   * Load và parse template thành AST
   */
  load(templateName: string): Promise<ASTNode[]>;
}

export interface ComposerOptions {
  /**
   * Template loader để load layout và includes
   */
  loader: TemplateLoader;

  /**
   * Maximum depth cho extends chain (prevent circular extends)
   */
  maxExtendsDepth?: number;
}

export class TemplateComposer {
  private loader: TemplateLoader;
  private maxExtendsDepth: number;

  constructor(options: ComposerOptions) {
    this.loader = options.loader;
    this.maxExtendsDepth = options.maxExtendsDepth || 10;
  }

  /**
   * Compose template với layout inheritance.
   *
   * Process:
   * 1. Nếu không có @extends → trả nguyên trạng.
   * 2. Đi ngược chuỗi @extends: child → parent → ... → base.
   *    Tại mỗi cấp, gom @section (child định nghĩa trước sẽ thắng).
   * 3. Khi tới template gốc (không còn @extends), inject tất cả section
   *    vào @yield (đệ quy để xử lý @yield lồng trong section).
   */
  async compose(ast: ASTNode[], templatePath: string): Promise<ASTNode[]> {
    // Không @extends → trả nguyên trạng.
    if (!this.findExtends(ast)) {
      return ast;
    }

    // Section tích luỹ; định nghĩa gặp trước (gần child nhất) thắng.
    const sections = new Map<string, ASTNode[]>();

    // Danh sách template đã ghé để phát hiện vòng lặp.
    const visited = new Set<string>([templatePath]);

    let currentAst = ast;
    let currentPath = templatePath;
    let depth = 0;

    // Đi ngược chuỗi extends cho tới template gốc.
    while (true) {
      if (depth++ >= this.maxExtendsDepth) {
        throw new Error(
          `Template extends chain exceeded maximum depth: ${this.maxExtendsDepth}\n` +
          `Template: ${currentPath}`
        );
      }

      // Gom section từ template hiện tại (không ghi đè section đã có).
      this.collectSections(currentAst, sections);

      const extendsNode = this.findExtends(currentAst);
      if (!extendsNode) {
        // Đã tới template gốc → inject section vào yield.
        return this.injectSections(currentAst, sections);
      }

      const layoutName = extendsNode.layout;
      if (visited.has(layoutName)) {
        throw new Error(
          `Circular extends detected: ${layoutName}\n` +
          `Extends chain: ${Array.from(visited).join(' -> ')} -> ${layoutName}`
        );
      }
      visited.add(layoutName);

      currentAst = await this.loader.load(layoutName);
      currentPath = layoutName;
    }
  }

  /**
   * Find @extends directive in AST
   */
  private findExtends(ast: ASTNode[]): ExtendsNode | null {
    for (const node of ast) {
      if (node.type === 'Extends') {
        return node;
      }
    }
    return null;
  }

  /**
   * Gom tất cả @section vào `sections`.
   * Không ghi đè key đã tồn tại (child định nghĩa trước sẽ thắng parent).
   */
  private collectSections(ast: ASTNode[], sections: Map<string, ASTNode[]>): void {
    const traverse = (nodes: ASTNode[]) => {
      for (const node of nodes) {
        if (node.type === 'Section') {
          if (!sections.has(node.name)) {
            if (node.inlineValue !== null) {
              // @section('name', 'value') - inline
              sections.set(node.name, [
                {
                  type: 'Text',
                  value: node.inlineValue,
                  start: node.start,
                  end: node.end,
                },
              ]);
            } else {
              // @section('name') ... @endsection - block.
              // Trim whitespace ở biên (newline sau @section / trước
              // @endsection) để output gọn: <title>Foo</title>.
              sections.set(node.name, trimSectionBody(node.body));
            }
          }
        }

        // Traverse nested nodes
        if (node.type === 'If') {
          node.branches.forEach(branch => traverse(branch.body));
        } else if (node.type === 'ForEach' || node.type === 'For' || node.type === 'While') {
          traverse(node.body);
        }
      }
    };

    traverse(ast);
  }

  /**
   * Replace @yield directives với section content
   */
  private injectSections(layoutAst: ASTNode[], sections: Map<string, ASTNode[]>): ASTNode[] {
    const inject = (nodes: ASTNode[]): ASTNode[] => {
      const result: ASTNode[] = [];

      for (const node of nodes) {
        if (node.type === 'Yield') {
          // Replace yield với section content (đệ quy để xử lý @yield lồng
          // bên trong nội dung section, ví dụ nested layouts).
          const sectionContent = sections.get(node.name);
          if (sectionContent) {
            result.push(...inject(sectionContent));
          } else if (node.defaultValue) {
            // Use default value if section not found
            result.push({
              type: 'Text',
              value: node.defaultValue,
              start: node.start,
              end: node.end,
            });
          }
          // Otherwise, yield renders nothing
        } else if (node.type === 'If') {
          // Process nested nodes
          result.push({
            ...node,
            branches: node.branches.map(branch => ({
              ...branch,
              body: inject(branch.body),
            })),
          });
        } else if (node.type === 'ForEach') {
          result.push({
            ...node,
            body: inject(node.body),
          });
        } else if (node.type === 'For') {
          result.push({
            ...node,
            body: inject(node.body),
          });
        } else if (node.type === 'While') {
          result.push({
            ...node,
            body: inject(node.body),
          });
        } else if (node.type === 'Section') {
          // Remove section nodes from layout (they're definitions, not output)
          // Skip
        } else {
          result.push(node);
        }
      }

      return result;
    };

    return inject(layoutAst);
  }
}

/**
 * Trim whitespace ở biên của section body: xoá whitespace đầu của text
 * node đầu tiên và whitespace cuối của text node cuối cùng. Không mutate
 * node gốc (tạo bản sao) vì AST có thể được cache.
 */
function trimSectionBody(body: ASTNode[]): ASTNode[] {
  if (body.length === 0) return body;

  const result = body.slice();

  const first = result[0];
  if (first.type === 'Text') {
    result[0] = { ...first, value: first.value.replace(/^\s+/, '') };
  }

  const lastIndex = result.length - 1;
  const last = result[lastIndex];
  if (last.type === 'Text') {
    result[lastIndex] = { ...last, value: last.value.replace(/\s+$/, '') };
  }

  return result;
}
