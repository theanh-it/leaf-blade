import { describe, expect, test } from "bun:test";
import { BladeLexer } from "@/engines/parser/lexer";

describe("parser/lexer", () => {
  test("tokenizes plain text", () => {
    const lexer = new BladeLexer("Hello world");
    const tokens = lexer.tokenize();
    expect(tokens.map((t) => t.type)).toEqual(["TEXT", "EOF"]);
    expect(tokens[0].value).toBe("Hello world");
  });

  test("tokenizes @if directive", () => {
    const lexer = new BladeLexer("@if(user && user.name)Hi@endif");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("DIRECTIVE");
    expect(tokens[0].directive).toBe("if");
    expect(tokens[0].args).toBe("user && user.name");
    expect(tokens[1].type).toBe("TEXT");
    expect(tokens[1].value).toBe("Hi");
    expect(tokens[2].type).toBe("END");
    expect(tokens[2].directive).toBe("endif");
  });

  test("tokenizes escaped and raw expressions", () => {
    const lexer = new BladeLexer("{{ name }} and {!! html !!}");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("EXPRESSION_ESCAPED");
    expect(tokens[0].args).toBe("name");
    expect(tokens[1].type).toBe("TEXT");
    expect(tokens[1].value).toBe(" and ");
    expect(tokens[2].type).toBe("EXPRESSION_RAW");
    expect(tokens[2].args).toBe("html");
  });

  test("tokenizes blade comments", () => {
    const lexer = new BladeLexer("before{{-- secret --}}after");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("TEXT");
    expect(tokens[0].value).toBe("before");
    expect(tokens[1].type).toBe("COMMENT");
    expect(tokens[1].value).toBe(" secret ");
    expect(tokens[2].type).toBe("TEXT");
    expect(tokens[2].value).toBe("after");
  });

  test("tokenizes @foreach with key", () => {
    const lexer = new BladeLexer("@foreach(items as key => item){{ key }}@endforeach");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("DIRECTIVE");
    expect(tokens[0].directive).toBe("foreach");
    expect(tokens[0].args).toBe("items as key => item");
  });

  test("tokenizes @section short and long form", () => {
    const lexer = new BladeLexer("@section('title', 'Hi')@section('body')x@endsection");
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("DIRECTIVE");
    expect(tokens[0].directive).toBe("section");
    expect(tokens[0].args).toBe("'title', 'Hi'");
    expect(tokens[1].type).toBe("DIRECTIVE");
    expect(tokens[1].directive).toBe("section");
    expect(tokens[1].args).toBe("'body'");
    expect(tokens[2].type).toBe("TEXT");
    expect(tokens[3].type).toBe("END");
    expect(tokens[3].directive).toBe("endsection");
  });

  test("tokenizes @elseif and @else", () => {
    const lexer = new BladeLexer("@if(a)1@elseif(b)2@else3@endif");
    const tokens = lexer.tokenize();
    console.log("TOKENS:", tokens.map(t => `${t.type}:${t.directive ?? t.value}`));
    expect(tokens[0].type).toBe("DIRECTIVE");
    expect(tokens[0].directive).toBe("if");
    expect(tokens[1].type).toBe("TEXT");
    expect(tokens[2].type).toBe("ELSEIF");
    expect(tokens[3].type).toBe("TEXT");
    expect(tokens[4].type).toBe("ELSE");
    expect(tokens[5].type).toBe("TEXT");
    expect(tokens[6].type).toBe("END");
  });

  test("captures line and column for diagnostics", () => {
    const source = "hello\n@if(true)";
    const lexer = new BladeLexer(source);
    const tokens = lexer.tokenize();
    const ifToken = tokens.find((t) => t.type === "DIRECTIVE");
    expect(ifToken).toBeDefined();
    expect(ifToken!.start).toMatchObject({ line: 2, column: 0 });
  });

  test("keeps string literal with parentheses inside expression", () => {
    const source = "@if(items.find(')'))body@endif";
    const lexer = new BladeLexer(source);
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe("DIRECTIVE");
    expect(tokens[0].args).toBe("items.find(')')");
  });
});
