/**
 * AST node cho Blade template.
 *
 * Parser sẽ chuyển đổi luồng token thành cây AST, có đầy đủ thông tin
 * vị trí để diagnostics và code generator có thể xuất EJS với line/column.
 */
import type { BladeSourceLocation } from "./diagnostics.js";

export type ASTNode =
  | TextNode
  | EscapedExpressionNode
  | RawExpressionNode
  | IfNode
  | ForEachNode
  | ForNode
  | WhileNode
  | ExtendsNode
  | SectionNode
  | YieldNode
  | IncludeNode
  | JsNode
  | CommentNode;

export interface BaseNode {
  start: BladeSourceLocation;
  end: BladeSourceLocation;
}

export interface TextNode extends BaseNode {
  type: "Text";
  value: string;
}

export interface EscapedExpressionNode extends BaseNode {
  type: "EscapedExpression";
  expression: string;
}

export interface RawExpressionNode extends BaseNode {
  type: "RawExpression";
  expression: string;
}

export interface IfNode extends BaseNode {
  type: "If";
  /** Danh sách các nhánh: if, elseif*, else? */
  branches: Array<
    | { kind: "if" | "elseif"; condition: string; body: ASTNode[]; start: BladeSourceLocation; end: BladeSourceLocation }
    | { kind: "else"; body: ASTNode[]; start: BladeSourceLocation; end: BladeSourceLocation }
  >;
}

export interface ForEachNode extends BaseNode {
  type: "ForEach";
  collection: string;
  value: string;
  key?: string;
  body: ASTNode[];
}

export interface ForNode extends BaseNode {
  type: "For";
  init: string;
  condition: string;
  update: string;
  body: ASTNode[];
}

export interface WhileNode extends BaseNode {
  type: "While";
  condition: string;
  body: ASTNode[];
}

export interface ExtendsNode extends BaseNode {
  type: "Extends";
  layout: string;
}

export interface SectionNode extends BaseNode {
  type: "Section";
  name: string;
  /** null = long form (@section ... @endsection), string = short form */
  inlineValue: string | null;
  body: ASTNode[];
}

export interface YieldNode extends BaseNode {
  type: "Yield";
  name: string;
  defaultValue?: string;
}

export interface IncludeNode extends BaseNode {
  type: "Include";
  partial: string;
  /** Raw expression object (chỉ được parser set nếu cú pháp an toàn) */
  dataExpression?: string;
}

export interface JsNode extends BaseNode {
  type: "Js";
  code: string;
}

export interface CommentNode extends BaseNode {
  type: "Comment";
  value: string;
}
