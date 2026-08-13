/**
 * Lexer cho Blade template.
 *
 * Token hóa source thành hai luồng chính:
 *  - TEXT: text node thường (giữ nguyên để in ra)
 *  - Directives: @if, @foreach, @include, @section, ... có args
 *  - Expressions: {{ expr }} (escaped) và {!! expr !!} (raw)
 *  - Comments: {{-- ... --}}
 *  - Block markers: @endxxx, @else, @elseif
 *
 * Lexer KHÔNG hiểu JS expression; expression sẽ được validate lại
 * ở giai đoạn parser với code generator đi kèm.
 */
import type { BladeSourceLocation } from "./diagnostics.js";

// Known directives list - used in both isDirectiveStart() and isInterestingAhead()
// Extracted to constant to avoid duplication
const DIRECTIVE_NAMES = 'if|elseif|else|endif|foreach|endforeach|for|endfor|while|endwhile|js|endjs|include|section|endsection|extends|yield';

export type BladeTokenType =
  | "TEXT"
  | "COMMENT"
  | "DIRECTIVE"
  | "BLOCK_DIRECTIVE"
  | "ELSEIF"
  | "ELSE"
  | "END"
  | "EXPRESSION_ESCAPED"
  | "EXPRESSION_RAW"
  | "EOF";

export interface BladeToken {
  type: BladeTokenType;
  /** Văn bản gốc (raw) dùng cho diagnostics */
  value: string;
  /** Giá trị đã chuẩn hoá; với directive chứa args, đây là chuỗi args */
  args?: string;
  /** Tên directive không bao gồm tiền tố `@` */
  directive?: string;
  /** Vị trí bắt đầu của token trong source */
  start: BladeSourceLocation;
  /** Vị trí ngay sau token */
  end: BladeSourceLocation;
}

export interface LexerOptions {
  // Reserved for future diagnostics propagation
}

export class BladeLexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 0;

  constructor(source: string, _options: LexerOptions = {}) {
    this.source = source;
  }

  tokenize(): BladeToken[] {
    const tokens: BladeToken[] = [];
    while (true) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === "EOF") break;
    }
    return tokens;
  }

  nextToken(): BladeToken {
    const start = this.currentLocation();

    if (this.pos >= this.source.length) {
      return this.makeToken("EOF", "", start, start);
    }

    // {{-- comment --}}
    if (this.startsWith("{{--")) {
      return this.lexComment();
    }

    // {{ expr }}
    if (this.startsWith("{{")) {
      return this.lexEscapedExpression();
    }

    // {!! expr !!}
    if (this.startsWith("{!!")) {
      return this.lexRawExpression();
    }

    // @directive (chỉ khi @ đứng ở đầu dòng logic, hoặc ký tự trước là
    // whitespace; tránh false positive trong email/HTML href).
    if (this.peek(0) === "@" && this.isDirectiveStart()) {
      return this.lexDirective();
    }

    // Text thường — bao gồm cả whitespace, chỉ dừng ở directive/comment/expression
    const text = this.consumeUntilInteresting();
    return this.makeToken("TEXT", text, start, this.locationFromEnd(text));
  }

  private isDirectiveStart(): boolean {
    // @ hợp lệ nếu tiếp theo là một directive đã biết (name là a-zA-Z_)
    // và ký tự sau directive name không phải [a-zA-Z_].
    const rest = this.source.slice(this.pos);
    return new RegExp(`^(${DIRECTIVE_NAMES})(?![a-zA-Z_])`).test(rest.slice(1));
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private lexComment(): BladeToken {
    const start = this.currentLocation();
    this.advance(4); // Tiêu thụ {{--
    const bodyStart = this.pos;
    while (this.pos < this.source.length) {
      if (this.startsWithMatch(this.pos, "--}}")) {
        const body = this.source.slice(bodyStart, this.pos);
        this.advance(4);
        return this.makeToken("COMMENT", body, start, this.currentLocation());
      }
      this.advance(1);
    }

    return this.makeToken(
      "COMMENT",
      this.source.slice(bodyStart),
      start,
      this.currentLocation()
    );
  }

  private lexEscapedExpression(): BladeToken {
    const start = this.currentLocation();
    this.advance(2); // Tiêu thụ {{
    const bodyStart = this.pos;
    const exprStart = this.currentLocation();

    while (this.pos < this.source.length) {
      if (this.startsWith("}}")) {
        const expr = this.source.slice(bodyStart, this.pos).trim();
        this.advance(2);
        return this.makeToken("EXPRESSION_ESCAPED", expr, start, this.currentLocation(), {
          args: expr,
          startHint: exprStart,
        });
      }
      this.advance(1);
    }

    return this.makeToken(
      "EXPRESSION_ESCAPED",
      this.source.slice(bodyStart).trim(),
      start,
      this.currentLocation(),
      { args: this.source.slice(bodyStart).trim(), startHint: exprStart }
    );
  }

  private lexRawExpression(): BladeToken {
    const start = this.currentLocation();
    this.advance(3); // Tiêu thụ {!!
    const bodyStart = this.pos;
    const exprStart = this.currentLocation();

    while (this.pos < this.source.length) {
      if (this.startsWith("!!}")) {
        const expr = this.source.slice(bodyStart, this.pos).trim();
        this.advance(3);
        return this.makeToken("EXPRESSION_RAW", expr, start, this.currentLocation(), {
          args: expr,
          startHint: exprStart,
        });
      }
      this.advance(1);
    }

    return this.makeToken(
      "EXPRESSION_RAW",
      this.source.slice(bodyStart).trim(),
      start,
      this.currentLocation(),
      { args: this.source.slice(bodyStart).trim(), startHint: exprStart }
    );
  }

  private lexDirective(): BladeToken {
    const start = this.currentLocation();
    this.advance(1); // @

    // Đọc tên directive: a-zA-Z_ (digit ở giữa tên không phải Blade-style;
    // tránh `@else3` bị đọc thành directive).
    const nameStart = this.pos;
    while (this.pos < this.source.length && /[a-zA-Z_]/.test(this.peek(0))) {
      this.advance(1);
    }
    const name = this.source.slice(nameStart, this.pos);

    if (name.length === 0) {
      // @ đứng một mình — xử lý như text bình thường
      return this.makeToken("TEXT", "@", start, this.locationFromEnd("@"));
    }

    const end = this.currentLocation();

    // Phân loại directive
    if (name === "else") {
      // @else không nhận args
      return this.makeToken("ELSE", name, start, end);
    }

    if (name.startsWith("end")) {
      return this.makeToken("END", name, start, end, { directive: name });
    }

    // @js không nhận args; toàn bộ nội dung tới @endjs là body (text).
    // Không capture inline args để tránh nuốt dòng code đầu tiên.
    if (name === "js") {
      return this.makeToken("DIRECTIVE", name, start, end, { directive: name });
    }

    // elseif cũng nhận args (`@elseif(condition)`); nếu không có args thì rỗng.
    // Block directives (if/foreach/for/while/include/section/yield/extends/js)
    // cũng được xử lý tại đây.
    const args = this.captureInlineArgs();

    if (name === "elseif") {
      return this.makeToken("ELSEIF", name, start, this.currentLocation(), {
        args,
      });
    }

    return this.makeToken("DIRECTIVE", name, start, this.currentLocation(), {
      args,
      directive: name,
    });
  }

  /**
   * Đọc phần args theo sau directive.
   *
   * Quy tắc:
   *  - Nếu directive bắt đầu bằng `(` thì đọc đến `)` tương ứng (depth=0).
   *  - Nếu directive không có `(` thì đọc đến newline hoặc directive khác.
   *  - Luôn tôn trọng string literal `'`, `"`, `` ` `` để không đếm ngoặc
   *    trong string.
   */
  private captureInlineArgs(): string {
    while (this.pos < this.source.length && this.isWhitespace(this.peek(0))) {
      this.advance(1);
    }

    const argsStart = this.pos;
    let depth = 0;
    let stringQuote: string | null = null;
    let seenOpen = false;

    while (this.pos < this.source.length) {
      const ch = this.peek(0);

      // Nếu đang trong string → chỉ theo dõi đóng string
      if (stringQuote !== null) {
        if (ch === "\\") {
          this.advance(2);
          continue;
        }
        if (ch === stringQuote) {
          stringQuote = null;
        }
        this.advance(1);
        continue;
      }

      if (ch === "'" || ch === '"' || ch === "`") {
        stringQuote = ch;
        this.advance(1);
        continue;
      }

      if (ch === "(") {
        depth++;
        seenOpen = true;
        this.advance(1);
        continue;
      }
      if (ch === "{" || ch === "[") {
        depth++;
        seenOpen = true;
        this.advance(1);
        continue;
      }

      // Đóng ngoặc tương ứng
      if (ch === ")" || ch === "}" || ch === "]") {
        if (depth > 0) {
          depth--;
          this.advance(1);
          if (depth === 0) {
            // Đóng xong ngoặc ngoài cùng → dừng; stripOuterParens sẽ
            // bỏ `)` này khỏi args.
            break;
          }
          continue;
        }
        // depth==0 mà vẫn gặp đóng ngoặc → stop parsing
        break;
      }

      // Khi chưa mở ngoặc: gặp newline hoặc directive mới → kết thúc
      if (!seenOpen) {
        if (ch === "\n" || ch === "\r") break;
        if (ch === "@" && this.isStandaloneDirectiveAhead()) break;
      }

      this.advance(1);
    }

    return stripOuterParens(this.source.slice(argsStart, this.pos).trim());
  }

  private isStandaloneDirectiveAhead(): boolean {
    const rest = this.source.slice(this.pos);
    // Directive name: [a-zA-Z_]+ theo sau bởi ( char thuộc nhóm dừng ).
    // Trong Blade, directive luôn kết thúc ở space, tab, newline, `(`, `)`,
    // `{`, `}`, `,`, `:`, hoặc ký tự toán tử. Nếu tiếp theo là digit/letter
    // Nếu @ không match directive pattern, vẫn cần check xem có phải là
    // @expression ({{ ... }}) hay chỉ là text thường. Cách nhanh nhất là
    // thử match với pattern đầy đủ (bao gồm @ prefix). Nếu match → text
    // bình thường (không phải directive). Nếu không match → @expression.
    return new RegExp(`^@(${DIRECTIVE_NAMES})(?![a-zA-Z_])`).test(rest);
  }

  private consumeUntilInteresting(): string {
    const start = this.pos;
    while (this.pos < this.source.length) {
      const ch = this.peek(0);
      if (ch === "@" || ch === "{") {
        if (this.isInterestingAhead()) break;
      }
      this.advance(1);
    }
    return this.source.slice(start, this.pos);
  }

  private isInterestingAhead(): boolean {
    const rest = this.source.slice(this.pos);
    if (rest.startsWith("{{--")) return true;
    if (rest.startsWith("{{")) return true;
    if (rest.startsWith("{!!")) return true;
    return this.isStandaloneDirectiveAhead();
  }

  private isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
  }

  private peek(offset: number): string {
    return this.source[this.pos + offset] ?? "";
  }

  /** Kiểm tra xem source từ pos hiện tại có khớp với chuỗi đã cho hay không */
  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.pos);
  }

  private startsWithMatch(pos: number, text: string): boolean {
    return this.source.startsWith(text, pos);
  }

  private advance(n: number): void {
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.source.length) return;
      const ch = this.source[this.pos];
      if (ch === "\n") {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }
      this.pos++;
    }
  }

  private currentLocation(): BladeSourceLocation {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private locationFromEnd(text: string): BladeSourceLocation {
    let line = this.line;
    let column = this.column;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        line++;
        column = 0;
      } else {
        column++;
      }
    }
    return { line, column, offset: this.pos };
  }

  private makeToken(
    type: BladeTokenType,
    value: string,
    start: BladeSourceLocation,
    end: BladeSourceLocation,
    extra: { args?: string; directive?: string; startHint?: BladeSourceLocation } = {}
  ): BladeToken {
    return {
      type,
      value,
      args: extra.args,
      directive: extra.directive,
      start: extra.startHint ?? start,
      end,
    };
  }
}

function stripOuterParens(value: string): string {
  if (value.length < 2) return value;
  if (value[0] !== "(") return value;
  if (value[value.length - 1] !== ")") return value;
  // Đảm bảo dấu `)` cuối cùng khớp với `(` đầu tiên, không phải cặp khác
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inString !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && i !== value.length - 1) {
        // `)` đóng không phải của `(` đầu tiên
        return value;
      }
    }
  }
  if (depth === 0) {
    return value.slice(1, -1).trim();
  }
  return value;
}

// Helper function to tokenize
export function tokenize(source: string, options?: LexerOptions): BladeToken[] {
  const lexer = new BladeLexer(source, options);
  return lexer.tokenize();
}
