import { describe, expect, test } from "bun:test";
import ejs from "ejs";
import { BladeLexer } from "@/engines/parser/lexer";
import { BladeParser } from "@/engines/parser/parser";
import { BladeCodeGenerator, transformExpression } from "@/engines/parser/codegen";

function compile(input: string, preserveMarkers = true): string {
  const lexer = new BladeLexer(input);
  const tokens = lexer.tokenize();
  const ast = new BladeParser(tokens).parse();
  const gen = new BladeCodeGenerator({ preserveMarkers });
  return gen.generate(ast);
}

describe("parser/codegen", () => {
  test("escaped expression becomes <%= %>", () => {
    expect(compile("{{ name }}")).toBe("<%= name %>");
  });

  test("raw expression becomes <%- %>", () => {
    expect(compile("{!! html !!}")).toBe("<%- html %>");
  });

  test("if/else/endif compiles to EJS blocks", () => {
    const out = compile("@if(a)1@else2@endif");
    expect(out).toContain("<% if (a) { %>");
    expect(out).toContain("<% } else { %>");
    expect(out).toContain("<% } %>");
  });

  test("foreach compiles to for-of loop", () => {
    const out = compile("@foreach(items as item){{ item }}@endforeach");
    expect(out).toContain("<% for (const item of (items || [])) { %>");
  });

  test("foreach with key compiles to Object.entries loop", () => {
    const out = compile("@foreach(items as k => item){{ item }}@endforeach");
    expect(out).toContain("<% for (const [k, item] of Object.entries(items || [])) { %>");
  });

  test("for compiles three-part expression", () => {
    const out = compile("@for(i = 0; i < 10; i++){{ i }}@endfor");
    expect(out).toContain("<% for (i = 0; i < 10; i++) { %>");
  });

  test("while compiles", () => {
    const out = compile("@while(cond)x@endwhile");
    expect(out).toContain("<% while (cond) { %>");
  });

  test("extends is emitted as marker", () => {
    const out = compile("@extends('layouts.app')");
    expect(out).toBe("<!-- BLADE_EXTENDS:layouts.app -->");
  });

  test("yield is emitted as marker", () => {
    const out = compile("@yield('content')");
    expect(out).toBe("<!-- BLADE_YIELD:content -->");
  });

  test("yield with default includes BLADE_DEFAULT", () => {
    const out = compile("@yield('content', 'fallback')");
    expect(out).toBe("<!-- BLADE_YIELD:content --><!-- BLADE_DEFAULT:fallback -->");
  });

  test("include compiles to marker", () => {
    const out = compile("@include('partials.header')");
    expect(out).toBe("<!-- BLADE_INCLUDE:partials.header -->");
  });

  test("comments are removed", () => {
    expect(compile("a{{-- b --}}c")).toBe("ac");
  });

  test("transformExpression keeps optional chaining", () => {
    expect(transformExpression("user.name")).toBe("user?.name");
  });

  test("transformExpression removes $ prefix", () => {
    expect(transformExpression("$user.name")).toBe("user?.name");
  });

  test("transformExpression does not break on decimals", () => {
    expect(transformExpression("price + 1.5")).toBe("price + 1.5");
  });

  test("renders with ejs", () => {
    const src = compile("Hello {{ name }}");
    const html = ejs.render(src, { name: "World" });
    expect(html).toBe("Hello World");
  });

  test("renders if/else via ejs", () => {
    const src = compile("@if(show)yes@else no@endif");
    expect(ejs.render(src, { show: true }).trim()).toBe("yes");
    expect(ejs.render(src, { show: false }).trim()).toBe("no");
  });

  test("renders foreach via ejs", () => {
    const src = compile("@foreach(items as item){{ item }}@endforeach");
    const html = ejs.render(src, { items: ["a", "b"] });
    expect(html).toBe("ab");
  });

  test("renders nested if/foreach via ejs", () => {
    const src = compile("@if(items)@foreach(items as item){{ item }}@endforeach@endif");
    const html = ejs.render(src, { items: ["x", "y"] });
    expect(html).toBe("xy");
  });
});
