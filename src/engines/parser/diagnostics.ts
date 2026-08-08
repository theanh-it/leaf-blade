/**
 * Diagnostic cho parser/lexer/codegen.
 *
 * Mỗi lỗi đi kèm vị trí (line/column), mã lỗi, đường dẫn file template
 * (nếu có) và đoạn trích template xung quanh vị trí lỗi.
 */
export type BladeDiagnosticCode =
  | "BLADE_UNTERMINATED_COMMENT"
  | "BLADE_UNTERMINATED_ESCAPED"
  | "BLADE_UNTERMINATED_RAW"
  | "BLADE_UNTERMINATED_BLOCK"
  | "BLADE_UNEXPECTED_DIRECTIVE"
  | "BLADE_UNEXPECTED_END"
  | "BLADE_MISSING_END"
  | "BLADE_EMPTY_DIRECTIVE"
  | "BLADE_INVALID_DIRECTIVE_SYNTAX"
  | "BLADE_INVALID_EXPRESSION"
  | "BLADE_INVALID_SECTION_ARGS"
  | "BLADE_INVALID_INVOKE"
  | "BLADE_INVALID_INCLUDE_ARGS"
  | "BLADE_INVALID_YIELD_ARGS"
  | "BLADE_INVALID_FOREACH"
  | "BLADE_INVALID_FOR"
  | "BLADE_INVALID_WHILE"
  | "BLADE_INVALID_IF";

export interface BladeSourceLocation {
  /** 1-indexed line */
  line: number;
  /** 0-indexed column (ký tự) */
  column: number;
  /** Vị trí offset trong source gốc */
  offset: number;
}

export interface BladeDiagnostic {
  code: BladeDiagnosticCode;
  message: string;
  location: BladeSourceLocation;
  templatePath?: string;
  /** Đoạn trích ngắn để gỡ lỗi */
  snippet?: string;
}

export class BladeTemplateError extends Error {
  public readonly code: BladeDiagnosticCode;
  public readonly location: BladeSourceLocation;
  public readonly templatePath?: string;
  public readonly snippet?: string;

  constructor(diagnostic: BladeDiagnostic) {
    super(formatDiagnostic(diagnostic));
    this.name = "BladeTemplateError";
    this.code = diagnostic.code;
    this.location = diagnostic.location;
    this.templatePath = diagnostic.templatePath;
    this.snippet = diagnostic.snippet;
  }
}

export function formatDiagnostic(diagnostic: BladeDiagnostic): string {
  const where = diagnostic.templatePath
    ? `${diagnostic.templatePath}:${diagnostic.location.line}:${diagnostic.location.column + 1}`
    : `${diagnostic.location.line}:${diagnostic.location.column + 1}`;

  const base = `BladeTemplateError [${diagnostic.code}] at ${where}\n${diagnostic.message}`;
  if (!diagnostic.snippet) return base;
  return `${base}\n  ${diagnostic.snippet.replace(/\n/g, "\n  ")}`;
}
