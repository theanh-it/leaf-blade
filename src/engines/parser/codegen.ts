/**
 * Code generator: AST → EJS source.
 *
 * @remarks
 * `BladeRenderer` (native runtime, v1.0.0+) evaluates the AST directly and
 * does NOT use this module. The codegen pipeline is exposed as an
 * independent utility (lexer → parser → codegen) that produces pure EJS
 * source — useful for debugging, output comparison, or downstream tooling
 * that consumes an EJS string instead of an AST.
 */
import type {
  ASTNode,
  EscapedExpressionNode,
  ForEachNode,
  ForNode,
  IfNode,
  IncludeNode,
  JsNode,
  RawExpressionNode,
  SectionNode,
  TextNode,
  WhileNode,
  YieldNode,
} from "./ast.js";

export interface CodeGenOptions {
  /**
   * When `true` (default), emit `<!-- BLADE_* -->` markers alongside the
   * EJS output for layout/section/yield/include — useful when layout
   * handling lives outside EJS. When `false`, output is pure EJS
   * (used by `compilePure()`).
   */
  preserveMarkers?: boolean;
}

export class BladeCodeGenerator {
  private output: string[] = [];
  private readonly preserveMarkers: boolean;

  constructor(options: CodeGenOptions = {}) {
    this.preserveMarkers = options.preserveMarkers ?? true;
  }

  generate(nodes: ASTNode[]): string {
    this.output = [];
    for (const node of nodes) {
      this.generateNode(node);
    }
    return this.output.join("");
  }

  private generateNode(node: ASTNode): void {
    switch (node.type) {
      case "Text":
        return this.generateText(node);
      case "EscapedExpression":
        return this.generateEscaped(node);
      case "RawExpression":
        return this.generateRaw(node);
      case "If":
        return this.generateIf(node);
      case "ForEach":
        return this.generateForEach(node);
      case "For":
        return this.generateFor(node);
      case "While":
        return this.generateWhile(node);
      case "Extends":
        // Layout is handled by the renderer; no EJS emitted here
        if (this.preserveMarkers) {
          this.output.push(`<!-- BLADE_EXTENDS:${node.layout} -->`);
        }
        return;
      case "Section":
        return this.generateSection(node);
      case "Yield":
        return this.generateYield(node);
      case "Include":
        return this.generateInclude(node);
      case "Js":
        return this.generateJs(node);
      case "Comment":
        // Comments are always stripped
        return;
      default:
        return;
    }
  }

  private generateText(node: TextNode): void {
    this.output.push(escapeEjsText(node.value));
  }

  private generateEscaped(node: EscapedExpressionNode): void {
    this.output.push(`<%= ${transformExpression(node.expression)} %>`);
  }

  private generateRaw(node: RawExpressionNode): void {
    this.output.push(`<%- ${transformExpression(node.expression)} %>`);
  }

  private generateIf(node: IfNode): void {
    for (const branch of node.branches) {
      if (branch.kind === "if") {
        this.output.push(
          `<% if (${transformExpression(branch.condition)}) { %>`
        );
      } else if (branch.kind === "elseif") {
        this.output.push(
          `<% } else if (${transformExpression(branch.condition)}) { %>`
        );
      } else {
        this.output.push(`<% } else { %>`);
      }
      for (const child of branch.body) {
        this.generateNode(child);
      }
    }
    this.output.push(`<% } %>`);
  }

  private generateForEach(node: ForEachNode): void {
    const collection = transformExpression(node.collection);
    if (node.key) {
      this.output.push(
        `<% for (const [${node.key}, ${node.value}] of Object.entries(${collection} || [])) { %>`
      );
    } else {
      this.output.push(
        `<% for (const ${node.value} of (${collection} || [])) { %>`
      );
    }
    for (const child of node.body) {
      this.generateNode(child);
    }
    this.output.push(`<% } %>`);
  }

  private generateFor(node: ForNode): void {
    const init = transformExpression(node.init);
    const condition = transformExpression(node.condition);
    const update = transformExpression(node.update);
    this.output.push(`<% for (${init}; ${condition}; ${update}) { %>`);
    for (const child of node.body) {
      this.generateNode(child);
    }
    this.output.push(`<% } %>`);
  }

  private generateWhile(node: WhileNode): void {
    this.output.push(`<% while (${transformExpression(node.condition)}) { %>`);
    for (const child of node.body) {
      this.generateNode(child);
    }
    this.output.push(`<% } %>`);
  }

  private generateSection(node: SectionNode): void {
    if (this.preserveMarkers) {
      if (node.inlineValue !== null) {
        this.output.push(
          `<!-- BLADE_SECTION_START:${node.name} -->${node.inlineValue}<!-- BLADE_SECTION_END:${node.name} -->`
        );
      } else {
        this.output.push(`<!-- BLADE_SECTION_START:${node.name} -->`);
        for (const child of node.body) {
          this.generateNode(child);
        }
        this.output.push(`<!-- BLADE_SECTION_END:${node.name} -->`);
      }
    }
  }

  private generateYield(node: YieldNode): void {
    if (this.preserveMarkers) {
      const defaultMarker = node.defaultValue
        ? `<!-- BLADE_DEFAULT:${node.defaultValue} -->`
        : "";
      this.output.push(`<!-- BLADE_YIELD:${node.name} -->${defaultMarker}`);
    }
  }

  private generateInclude(node: IncludeNode): void {
    if (this.preserveMarkers) {
      if (node.dataExpression) {
        this.output.push(
          `<!-- BLADE_INCLUDE_WITH:${node.partial}:${node.dataExpression} -->`
        );
      } else {
        this.output.push(`<!-- BLADE_INCLUDE:${node.partial} -->`);
      }
    }
  }

  private generateJs(node: JsNode): void {
    // @js body was processed by the legacy renderer; here we only need
    // to emit a marker or the equivalent EJS execution
    if (this.preserveMarkers) {
      this.output.push(`<!-- BLADE_JS_START -->`);
      const cleanCode = node.code.replace(/^\s*return\s+/gm, "");
      this.output.push(`<% ${cleanCode} %>`);
      this.output.push(`<!-- BLADE_JS_END -->`);
    } else {
      const cleanCode = node.code.replace(/^\s*return\s+/gm, "");
      this.output.push(`<% ${cleanCode} %>`);
    }
  }
}

/**
 * Áp dụng cùng biến đổi expression giống compiler cũ:
 *  - Bỏ `$` đầu biến
 *  - Chuyển `a.b.c` → `a?.b?.c` (optional chaining)
 *  - Tránh `a?.&&` → `a &&`
 *
 * @remarks
 * Vì phần expression có thể chứa code JavaScript tùy ý (function call,
 * template literal, regex), hàm này chỉ thực hiện các phép thay thế an
 * toàn tương đương. Khi cần parser JS đầy đủ, hãy thay thế hàm này.
 */
export function transformExpression(expr: string): string {
  let parsed = expr.trim();

  // Bỏ tiền tố `$` khỏi tên biến
  parsed = parsed.replace(/\$(\w+)/g, "$1");

  // Chuyển dot-notation → optional chaining (bỏ qua số thập phân)
  parsed = parsed.replace(/(\w+)\.(\w+)/g, (match, obj, prop) => {
    if (!isNaN(Number(obj))) {
      return match;
    }
    return `${obj}?.${prop}`;
  });

  // Tránh `a?.&&` → `a &&`
  parsed = parsed.replace(/(\w+)\?\.(\s*)([&|])/g, "$1 $2$3");
  parsed = parsed.replace(/(\w+)\?\.(\s*)([=!<>])/g, "$1 $2$3");

  return parsed;
}

/**
 * Reserved for future use: a `%` immediately after `<%` could clash with
 * the closing `%>` delimiter in some EJS parsers. Currently Blade TEXT
 * cannot contain `<%`, so the body of this helper is intentionally a
 * no-op and is kept here to make future EJS-delimiter escaping trivial.
 */
function escapeEjsText(text: string): string {
  return text;
}

// Helper function to generate code
export function generateCode(nodes: ASTNode[], options?: CodeGenOptions): string {
  const generator = new BladeCodeGenerator(options);
  return generator.generate(nodes);
}
