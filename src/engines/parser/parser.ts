/**
 * Parser từ tokens thành AST.
 *
 * Parser này chỉ phụ trách:
 *  - Cấu trúc block directives (if/elseif/else/endif, foreach, for, while, js, section).
 *  - Validate directive arguments có cân bằng dấu ngoặc.
 *  - Báo lỗi vị trí chi tiết khi directive sai/lệch.
 *
 * Expression JavaScript vẫn được giữ nguyên dạng raw và được chuyển cho
 * codegen. Lý do: expression có thể chứa cú pháp tự do (function call,
 * template literal, v.v.) — chúng tôi không viết JS parser.
 */
import {
  BladeTemplateError,
  type BladeDiagnosticCode,
  type BladeSourceLocation,
} from "./diagnostics.js";
import type { BladeToken } from "./lexer.js";
import type { ASTNode, IfNode, SectionNode } from "./ast.js";

export interface ParseOptions {
  templatePath?: string;
}

interface IfFrame {
  kind: "if";
  node: IfNode;
}
interface BodyFrame {
  kind: "foreach" | "for" | "while" | "js";
  body: ASTNode[];
  start: BladeSourceLocation;
}
interface SectionFrame {
  kind: "section";
  node: SectionNode;
  body: ASTNode[];
}

type StackFrame = IfFrame | BodyFrame | SectionFrame;

const KNOWN_DIRECTIVES = new Set([
  "if",
  "elseif",
  "else",
  "endif",
  "foreach",
  "endforeach",
  "for",
  "endfor",
  "while",
  "endwhile",
  "js",
  "endjs",
  "include",
  "section",
  "endsection",
  "extends",
  "yield",
]);

export class BladeParser {
  private tokens: BladeToken[];
  private index = 0;
  private readonly templatePath?: string;

  constructor(tokens: BladeToken[], options: ParseOptions = {}) {
    this.tokens = tokens;
    this.templatePath = options.templatePath;
  }

  parse(): ASTNode[] {
    const root: ASTNode[] = [];
    const stack: StackFrame[] = [];
    let pendingAppend: ASTNode[] = root;

    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];

      if (token.type === "EOF") break;

      if (token.type === "TEXT") {
        if (token.value.length > 0) {
          pendingAppend.push({
            type: "Text",
            value: token.value,
            start: token.start,
            end: token.end,
          });
        }
        this.index++;
        continue;
      }

      if (token.type === "COMMENT") {
        // Comments luôn bị loại bỏ khỏi output, không giữ lại trong AST
        this.index++;
        continue;
      }

      if (token.type === "EXPRESSION_ESCAPED") {
        pendingAppend.push({
          type: "EscapedExpression",
          expression: token.args ?? token.value,
          start: token.start,
          end: token.end,
        });
        this.index++;
        continue;
      }

      if (token.type === "EXPRESSION_RAW") {
        pendingAppend.push({
          type: "RawExpression",
          expression: token.args ?? token.value,
          start: token.start,
          end: token.end,
        });
        this.index++;
        continue;
      }

      if (token.type === "DIRECTIVE") {
        const directive = token.directive ?? "";
        const args = token.args ?? "";
        this.index++;

        if (directive === "extends") {
          this.requireArgs("extends", args, token.start, "BLADE_INVALID_DIRECTIVE_SYNTAX");
          const layout = this.parseStringLiteral(args, "extends", token.start);
          pendingAppend.push({
            type: "Extends",
            layout,
            start: token.start,
            end: token.end,
          });
          continue;
        }

        if (directive === "include") {
          this.requireArgs("include", args, token.start, "BLADE_INVALID_INCLUDE_ARGS");
          const { partial, dataExpression } = this.parseIncludeArgs(args, token.start);
          pendingAppend.push({
            type: "Include",
            partial,
            dataExpression,
            start: token.start,
            end: token.end,
          });
          continue;
        }

        if (directive === "yield") {
          this.requireArgs("yield", args, token.start, "BLADE_INVALID_YIELD_ARGS");
          const { name, defaultValue } = this.parseYieldArgs(args, token.start);
          pendingAppend.push({
            type: "Yield",
            name,
            defaultValue,
            start: token.start,
            end: token.end,
          });
          continue;
        }

        if (directive === "section") {
          this.requireArgs("section", args, token.start, "BLADE_INVALID_SECTION_ARGS");
          const { name, inlineValue } = this.parseSectionHeader(args, token.start);
          const node: SectionNode = {
            type: "Section",
            name,
            inlineValue,
            body: [],
            start: token.start,
            end: token.end,
          };
          if (inlineValue !== null) {
            pendingAppend.push(node);
          } else {
            pendingAppend.push(node);
            stack.push({ kind: "section", node, body: node.body });
            pendingAppend = node.body;
          }
          continue;
        }

        if (directive === "if") {
          this.requireArgs("if", args, token.start, "BLADE_INVALID_IF");
          const cond = this.requireBalancedCondition(args, token.start);
          const body: ASTNode[] = [];
          const branches: IfNode["branches"] = [
            { kind: "if", condition: cond, body, start: token.start, end: token.end },
          ];
          const node: IfNode = {
            type: "If",
            branches,
            start: token.start,
            end: token.end,
          };
          pendingAppend.push(node);
          stack.push({ kind: "if", node });
          pendingAppend = body;
          continue;
        }

        if (directive === "foreach") {
          this.requireArgs("foreach", args, token.start, "BLADE_INVALID_FOREACH");
          const { collection, key, value } = this.parseForeachHead(args, token.start);
          const body: ASTNode[] = [];
          stack.push({ kind: "foreach", body, start: token.start });
          pendingAppend.push({
            type: "ForEach",
            collection,
            key,
            value,
            body,
            start: token.start,
            end: token.end,
          });
          pendingAppend = body;
          continue;
        }

        if (directive === "for") {
          this.requireArgs("for", args, token.start, "BLADE_INVALID_FOR");
          const { init, condition, update } = this.parseForHead(args, token.start);
          const body: ASTNode[] = [];
          stack.push({ kind: "for", body, start: token.start });
          pendingAppend.push({
            type: "For",
            init,
            condition,
            update,
            body,
            start: token.start,
            end: token.end,
          });
          pendingAppend = body;
          continue;
        }

        if (directive === "while") {
          this.requireArgs("while", args, token.start, "BLADE_INVALID_WHILE");
          const condition = this.requireBalancedCondition(args, token.start);
          const body: ASTNode[] = [];
          stack.push({ kind: "while", body, start: token.start });
          pendingAppend.push({
            type: "While",
            condition,
            body,
            start: token.start,
            end: token.end,
          });
          pendingAppend = body;
          continue;
        }

        if (directive === "js") {
          const body: ASTNode[] = [];
          stack.push({ kind: "js", body, start: token.start });
          pendingAppend.push({
            type: "Js",
            code: "",
            start: token.start,
            end: token.start,
          });
          pendingAppend = body;
          continue;
        }

        throw this.error("BLADE_UNEXPECTED_DIRECTIVE", `Unknown directive @${directive}`, token.start);
      }

      if (token.type === "ELSEIF") {
        const frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "if") {
          throw this.error("BLADE_UNEXPECTED_END", `@elseif outside of @if`, token.start);
        }
        const condition = this.requireBalancedCondition(token.args ?? "", token.start);
        const body: ASTNode[] = [];
        frame.node.branches.push({
          kind: "elseif",
          condition,
          body,
          start: token.start,
          end: token.end,
        });
        pendingAppend = body;
        this.index++;
        continue;
      }

      if (token.type === "ELSE") {
        const frame = stack[stack.length - 1];
        if (!frame || frame.kind !== "if") {
          throw this.error("BLADE_UNEXPECTED_END", `@else outside of @if`, token.start);
        }
        const body: ASTNode[] = [];
        frame.node.branches.push({
          kind: "else",
          body,
          start: token.start,
          end: token.end,
        });
        pendingAppend = body;
        this.index++;
        continue;
      }

      if (token.type === "END") {
        const directive = token.directive ?? "";
        this.index++;

        if (directive === "endif") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "if") {
            throw this.error("BLADE_UNEXPECTED_END", `@endif without matching @if`, token.start);
          }
          frame.node.end = token.end;
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (directive === "endforeach") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "foreach") {
            throw this.error("BLADE_UNEXPECTED_END", `@endforeach without matching @foreach`, token.start);
          }
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (directive === "endfor") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "for") {
            throw this.error("BLADE_UNEXPECTED_END", `@endfor without matching @for`, token.start);
          }
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (directive === "endwhile") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "while") {
            throw this.error("BLADE_UNEXPECTED_END", `@endwhile without matching @while`, token.start);
          }
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (directive === "endjs") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "js") {
            throw this.error("BLADE_UNEXPECTED_END", `@endjs without matching @js`, token.start);
          }
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (directive === "endsection") {
          const frame = stack[stack.length - 1];
          if (!frame || frame.kind !== "section") {
            throw this.error("BLADE_UNEXPECTED_END", `@endsection without matching @section`, token.start);
          }
          frame.node.end = token.end;
          stack.pop();
          pendingAppend = this.ownerBody(stack, root);
          continue;
        }

        if (KNOWN_DIRECTIVES.has(directive)) {
          throw this.error(
            "BLADE_MISSING_END",
            `Unexpected @${directive} without matching opening directive`,
            token.start
          );
        }

        throw this.error("BLADE_UNEXPECTED_DIRECTIVE", `Unknown directive @${directive}`, token.start);
      }

      this.index++;
    }

    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      const start = this.startOf(top);
      throw this.error(
        "BLADE_MISSING_END",
        `Unterminated block directive: expected matching @end${this.expectedEnd(top)}`,
        start
      );
    }

    return root;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private startOf(frame: StackFrame): BladeSourceLocation {
    switch (frame.kind) {
      case "if":
        return frame.node.start;
      case "foreach":
      case "for":
      case "while":
      case "js":
        return frame.start;
      case "section":
        return frame.node.start;
    }
  }

  private expectedEnd(frame: StackFrame): string {
    switch (frame.kind) {
      case "if":
        return "if";
      case "foreach":
        return "foreach";
      case "for":
        return "for";
      case "while":
        return "while";
      case "js":
        return "js";
      case "section":
        return "section";
    }
  }

  private ownerBody(stack: StackFrame[], root: ASTNode[]): ASTNode[] {
    if (stack.length === 0) return root;
    const top = stack[stack.length - 1];
    switch (top.kind) {
      case "if":
        return top.node.branches[top.node.branches.length - 1].body;
      case "foreach":
      case "for":
      case "while":
      case "js":
        return top.body;
      case "section":
        return top.body;
    }
  }

  private requireArgs(
    directive: string,
    args: string,
    location: BladeSourceLocation,
    code: BladeDiagnosticCode
  ): void {
    if (args.length === 0) {
      throw this.error(code, `@${directive} requires arguments`, location);
    }
  }

  /**
   * Kiểm tra ngoặc của expression có cân bằng. Lexer đã cắt đến khi gặp
   * newline ngoài dấu ngoặc, nhưng vẫn có thể thiếu `)` ở cuối.
   */
  private requireBalancedCondition(args: string, location: BladeSourceLocation): string {
    const trimmed = args.trim();
    if (trimmed.length === 0) {
      throw this.error("BLADE_INVALID_EXPRESSION", `Empty expression`, location);
    }

    let depth = 0;
    let stringQuote: string | null = null;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (stringQuote !== null) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === stringQuote) stringQuote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        stringQuote = ch;
        continue;
      }
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
    }

    if (depth !== 0) {
      throw this.error(
        "BLADE_INVALID_EXPRESSION",
        `Unbalanced parentheses in expression: ${trimmed}`,
        location
      );
    }

    return trimmed;
  }

  /**
   * Parse string literal an toàn: chấp nhận dạng `'foo'` hoặc `"foo"`.
   */
  private parseStringLiteral(value: string, directive: string, location: BladeSourceLocation): string {
    const trimmed = value.trim();
    const match = /^(['"])([^'"]*)\1$/.exec(trimmed);
    if (!match) {
      throw this.error(
        "BLADE_INVALID_DIRECTIVE_SYNTAX",
        `@${directive} expects a string literal (e.g. 'layouts.app')`,
        location
      );
    }
    return match[2];
  }

  private parseSectionHeader(
    args: string,
    location: BladeSourceLocation
  ): { name: string; inlineValue: string | null } {
    const trimmed = args.trim();
    const namedWithValue = /^(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3\s*$/.exec(trimmed);
    if (namedWithValue) {
      return { name: namedWithValue[2], inlineValue: namedWithValue[4] };
    }
    const namedOnly = /^(['"])([^'"]+)\1\s*$/.exec(trimmed);
    if (namedOnly) {
      return { name: namedOnly[2], inlineValue: null };
    }
    throw this.error(
      "BLADE_INVALID_SECTION_ARGS",
      `@section expects ('name', 'value') or ('name')`,
      location
    );
  }

  private parseYieldArgs(
    args: string,
    location: BladeSourceLocation
  ): { name: string; defaultValue?: string } {
    const trimmed = args.trim();
    const withDefault = /^(['"])([^'"]+)\1\s*,\s*(['"])([^'"]*)\3\s*$/.exec(trimmed);
    if (withDefault) {
      return { name: withDefault[2], defaultValue: withDefault[4] };
    }
    const only = /^(['"])([^'"]+)\1\s*$/.exec(trimmed);
    if (only) {
      return { name: only[2] };
    }
    throw this.error(
      "BLADE_INVALID_YIELD_ARGS",
      `@yield expects ('name') or ('name', 'default')`,
      location
    );
  }

  private parseIncludeArgs(
    args: string,
    location: BladeSourceLocation
  ): { partial: string; dataExpression?: string } {
    const trimmed = args.trim();
    const withData = /^(['"])([^'"]+)\1\s*,\s*(\{[\s\S]*\})\s*$/.exec(trimmed);
    if (withData) {
      return { partial: withData[2], dataExpression: withData[3] };
    }
    const only = /^(['"])([^'"]+)\1\s*$/.exec(trimmed);
    if (only) {
      return { partial: only[2] };
    }
    throw this.error(
      "BLADE_INVALID_INCLUDE_ARGS",
      `@include expects ('partial') or ('partial', { ... })`,
      location
    );
  }

  private parseForeachHead(
    args: string,
    location: BladeSourceLocation
  ): { collection: string; key?: string; value: string } {
    const trimmed = args.trim();
    const keyMatch = /^([\w$.]+)\s+as\s+(\w+)\s*=>\s*(\w+)\s*$/.exec(trimmed);
    if (keyMatch) {
      return { collection: keyMatch[1], key: keyMatch[2], value: keyMatch[3] };
    }
    const simple = /^([\w$.]+)\s+as\s+(\w+)\s*$/.exec(trimmed);
    if (simple) {
      return { collection: simple[1], value: simple[2] };
    }
    throw this.error(
      "BLADE_INVALID_FOREACH",
      `@foreach expects "items as item" or "items as key => item"`,
      location
    );
  }

  private parseForHead(
    args: string,
    location: BladeSourceLocation
  ): { init: string; condition: string; update: string } {
    const trimmed = args.trim();
    const parts = trimmed.split(";");
    if (parts.length !== 3) {
      throw this.error(
        "BLADE_INVALID_FOR",
        `@for expects three parts separated by ';' (init; condition; update)`,
        location
      );
    }
    return {
      init: parts[0].trim(),
      condition: parts[1].trim(),
      update: parts[2].trim(),
    };
  }

  private error(
    code: BladeDiagnosticCode,
    message: string,
    location: BladeSourceLocation
  ): BladeTemplateError {
    return new BladeTemplateError({
      code,
      message,
      location,
      templatePath: this.templatePath,
    });
  }
}
