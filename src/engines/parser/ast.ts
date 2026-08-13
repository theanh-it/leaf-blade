/**
 * AST node for Blade templates.
 *
 * The parser converts the token stream into an AST tree that carries
 * full position information for diagnostics, and that the code generator
 * can serialize with line/column metadata.
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
  | IncludeScopeNode
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

/**
 * Kết quả của việc xử lý `@include('partial', { data })` ở giai đoạn
 * IncludeProcessor: AST của partial được inline vào `body`, còn
 * `dataExpression` được giữ nguyên (chưa evaluate) để runtime evaluate
 * đúng lúc — vì data có thể tham chiếu biến loop (`@foreach(users as user)`)
 * chỉ tồn tại trong scope lúc runtime, không tồn tại lúc include-processing.
 */
export interface IncludeScopeNode extends BaseNode {
  type: "IncludeScope";
  dataExpression: string;
  body: ASTNode[];
}

export interface JsNode extends BaseNode {
  type: "Js";
  code: string;
}

export interface CommentNode extends BaseNode {
  type: "Comment";
  value: string;
}
