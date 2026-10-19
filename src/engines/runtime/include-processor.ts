/**
 * Include Processor
 * 
 * Xử lý @include directives để inline partial templates.
 */

import type { ASTNode, IncludeNode } from "../parser/ast.js";
import type { TemplateLoader } from "./composer.js";
import type { RuntimeContext } from "./context.js";

export interface IncludeProcessorOptions {
  /**
   * Template loader
   */
  loader: TemplateLoader;

  /**
   * Maximum include depth (prevent circular includes)
   */
  maxIncludeDepth?: number;
}

export class IncludeProcessor {
  private loader: TemplateLoader;
  private maxIncludeDepth: number;

  constructor(options: IncludeProcessorOptions) {
    this.loader = options.loader;
    this.maxIncludeDepth = options.maxIncludeDepth || 10;
  }

  /**
   * Process all @include directives trong AST
   *
   * @include('partial') → inline partial AST
   * @include('partial', { data }) → inline, bọc trong IncludeScopeNode để
   * runtime evaluate `dataExpression` đúng lúc (hỗ trợ tham chiếu biến loop
   * như `@foreach(users as user) @include('x', { user }) @endforeach`).
   *
   * `context` được giữ trong signature cho khả năng tương thích API; việc
   * xử lý include không cần evaluate expression nào tại giai đoạn này.
   */
  async processIncludes(
    ast: ASTNode[],
    _context: RuntimeContext,
    currentPath: string,
    depth = 0
  ): Promise<ASTNode[]> {
    return this.walk(ast, currentPath, depth, new Set());
  }

  private async walk(
    ast: ASTNode[],
    currentPath: string,
    depth: number,
    ancestors: ReadonlySet<string>
  ): Promise<ASTNode[]> {
    if (depth >= this.maxIncludeDepth) {
      throw new Error(
        `Include depth exceeded maximum: ${this.maxIncludeDepth}\n` +
        `Current template: ${currentPath}`
      );
    }

    const result: ASTNode[] = [];

    for (const node of ast) {
      if (node.type === 'Include') {
        const includedAst = await this.processInclude(node, depth, ancestors);
        result.push(...includedAst);
      } else if (node.type === 'If') {
        result.push({
          ...node,
          branches: await Promise.all(
            node.branches.map(async branch => ({
              ...branch,
              body: await this.walk(branch.body, currentPath, depth, ancestors),
            }))
          ),
        });
      } else if (node.type === 'ForEach') {
        result.push({ ...node, body: await this.walk(node.body, currentPath, depth, ancestors) });
      } else if (node.type === 'For') {
        result.push({ ...node, body: await this.walk(node.body, currentPath, depth, ancestors) });
      } else if (node.type === 'While') {
        result.push({ ...node, body: await this.walk(node.body, currentPath, depth, ancestors) });
      } else {
        result.push(node);
      }
    }

    return result;
  }

  /**
   * Process single @include directive
   */
  private async processInclude(
    node: IncludeNode,
    depth: number,
    ancestors: ReadonlySet<string>
  ): Promise<ASTNode[]> {
    // Check circular includes
    if (ancestors.has(node.partial)) {
      throw new Error(
        `Circular include detected: ${node.partial}\n` +
        `Include chain: ${Array.from(ancestors).join(' -> ')} -> ${node.partial}`
      );
    }

    // Each include chain has its own ancestors. Concurrent renders and sibling
    // @if branches may load the same partial without creating a cycle.
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.partial);

    // Load partial template
    let partialAst = await this.loader.load(node.partial);

    // Process nested includes recursively
    partialAst = await this.walk(partialAst, node.partial, depth + 1, nextAncestors);

    // Nếu include có data expression, bọc trong IncludeScopeNode.
    // KHÔNG evaluate dataExpression ở đây: expression có thể tham chiếu
    // biến loop (@foreach(users as user) @include('x', { user }) ...)
    // chỉ tồn tại trong scope lúc runtime evaluate, không tồn tại ở
    // giai đoạn include-processing (chạy 1 lần trước khi vào loop).
    if (node.dataExpression) {
      return [
        {
          type: 'IncludeScope',
          dataExpression: node.dataExpression,
          body: partialAst,
          start: node.start,
          end: node.end,
        },
      ];
    }

    return partialAst;
  }

  /**
   * @deprecated Kept for compatibility. Include stacks are now local to each
   * traversal, so there is no instance state to clear.
   */
  clearStack(): void {}
}
