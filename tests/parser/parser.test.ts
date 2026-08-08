import { describe, expect, test } from "bun:test";
import { BladeLexer } from "@/engines/parser/lexer";
import { BladeParser } from "@/engines/parser/parser";
import { BladeTemplateError } from "@/engines/parser/diagnostics";

function parse(input: string) {
  const lexer = new BladeLexer(input);
  const tokens = lexer.tokenize();
  return new BladeParser(tokens).parse();
}

describe("parser/parser", () => {
  test("parses text + expression", () => {
    const ast = parse("Hello {{ name }}");
    expect(ast).toHaveLength(2);
    expect(ast[0].type).toBe("Text");
    expect(ast[1].type).toBe("EscapedExpression");
  });

  test("parses if/elseif/else", () => {
    const ast = parse("@if(a)1@elseif(b)2@else3@endif");
    expect(ast).toHaveLength(1);
    const ifNode = ast[0];
    if (ifNode.type !== "If") throw new Error("expected if");
    expect(ifNode.branches.map((b) => b.kind)).toEqual(["if", "elseif", "else"]);
  });

  test("parses foreach with key", () => {
    const ast = parse("@foreach(items as k => item){{ item }}@endforeach");
    const node = ast[0];
    if (node.type !== "ForEach") throw new Error("expected foreach");
    expect(node.key).toBe("k");
    expect(node.value).toBe("item");
  });

  test("parses nested directives", () => {
    const ast = parse("@if(a)@if(b)ok@endif@endif");
    const outer = ast[0];
    if (outer.type !== "If") throw new Error("expected if");
    const inner = outer.branches[0].body[0];
    if (inner.type !== "If") throw new Error("expected nested if");
    expect(inner.branches[0].body[0].type).toBe("Text");
  });

  test("throws with line/column for missing @endif", () => {
    expect(() => parse("@if(true)\n  Body\n")).toThrow(BladeTemplateError);
    try {
      parse("@if(true)\n  Body\n");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(e.code).toBe("BLADE_MISSING_END");
      expect(e.location.line).toBe(1);
    }
  });

  test("throws with line/column for unmatched @endif", () => {
    try {
      parse("before\n@endif");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(e.code).toBe("BLADE_UNEXPECTED_END");
      expect(e.location.line).toBe(2);
    }
  });

  test("throws for mismatched @endforeach", () => {
    try {
      parse("@if(x)@endforeach");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(["BLADE_UNEXPECTED_END", "BLADE_MISSING_END"]).toContain(e.code);
    }
  });

  test("throws on invalid foreach syntax", () => {
    try {
      parse("@foreach(items)body@endforeach");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(e.code).toBe("BLADE_INVALID_FOREACH");
    }
  });

  test("throws on missing include name", () => {
    try {
      parse("@include()");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
    }
  });

  test("throws on bad section header", () => {
    try {
      parse("@section");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(e.code).toBe("BLADE_INVALID_SECTION_ARGS");
    }
  });

  test("parses long-form section with body", () => {
    const ast = parse("@section('content')body@endsection");
    const node = ast[0];
    if (node.type !== "Section") throw new Error("expected section");
    expect(node.inlineValue).toBeNull();
    expect(node.body).toHaveLength(1);
  });

  test("parses short-form section inline value", () => {
    const ast = parse("@section('title', 'Hello')");
    const node = ast[0];
    if (node.type !== "Section") throw new Error("expected section");
    expect(node.inlineValue).toBe("Hello");
  });

  test("parses @yield with default", () => {
    const ast = parse("@yield('content', 'default')");
    const node = ast[0];
    if (node.type !== "Yield") throw new Error("expected yield");
    expect(node.defaultValue).toBe("default");
  });

  test("parses @include with data", () => {
    const ast = parse("@include('card', { title: 'x' })");
    const node = ast[0];
    if (node.type !== "Include") throw new Error("expected include");
    expect(node.partial).toBe("card");
    expect(node.dataExpression).toBe("{ title: 'x' }");
  });

  test("throws on unbalanced expression in @if", () => {
    try {
      parse("@if(foo(bar) body@endif");
    } catch (err) {
      expect(err).toBeInstanceOf(BladeTemplateError);
      const e = err as BladeTemplateError;
      expect(e.code).toBe("BLADE_INVALID_EXPRESSION");
    }
  });
});
