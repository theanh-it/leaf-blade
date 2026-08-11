/**
 * Code generator: AST → EJS source.
 *
 * @remarks
 * `BladeRenderer` (native runtime, v1.0.0+) evaluate AST trực tiếp và
 * KHÔNG dùng module này. Codegen được giữ lại như một pipeline độc lập
 * (lexer → parser → codegen) sinh ra EJS source thuần, hữu ích cho debug,
 * so sánh output, hoặc tái sử dụng ở nơi khác cần EJS string thay vì AST.
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
   * Khi `true` (mặc định), sinh thêm marker `<!-- BLADE_* -->` bên cạnh EJS
   * cho layout/section/yield/include — hữu ích khi cần xử lý layout ở tầng
   * ngoài EJS. Khi `false`, output chỉ chứa EJS thuần (dùng cho
   * `compilePure()`).
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
        // Layout sẽ được renderer xử lý, không sinh EJS
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
        // Comments luôn bị loại bỏ
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
    // @js body được renderer cũ xử lý trước; ở giai đoạn này chỉ cần
    // sinh marker hoặc EJS execution tương đương.
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
 * Trong EJS, `%` ngay sau `<%` mở có thể gây nhầm với `%>` đóng. Ở đây
 * chúng tôi chỉ escape backslash và newline; logic literal escape đã
 * có `<%=` và `<%-`. Hàm này được giữ để dễ mở rộng nếu cần escape EJS
 * delimiter trong TEXT (hiện tại Blade TEXT không chứa `<%` nên chưa cần).
 */
function escapeEjsText(text: string): string {
  return text;
}
