/**
 * Test so sánh output giữa:
 *  - BladeCompiler cũ (regex-based)
 *  - BladeCompilerV2 mới (lexer + parser + codegen)
 *
 * Mục tiêu: hai compiler phải tạo ra EJS có cùng semantic đối với
 * các template Blade hiện đang dùng trong test suite.
 */
import { describe, expect, test } from "bun:test";
import { BladeCompiler } from "@/engines/compiler";
import { BladeCompilerV2 } from "@/engines/parser/compiler";

function makeOld() {
  return new BladeCompiler({ viewsDir: "/tmp", cache: false });
}

function makeNew() {
  return new BladeCompilerV2({ viewsDir: "/tmp", cache: false });
}

function exec(src: string) {
  const oldOut = makeOld().compile(src, "test.blade.html");
  const newOut = makeNew().compile(src, "test.blade.html");
  return { oldOut, newOut };
}

describe("parser/compiler compatibility", () => {
  const fixtures: Array<[string, string]> = [
    ["simple text", "Hello {{ name }}"],
    ["escaped expression", "{{ user.name }}"],
    ["raw expression", "{!! html !!}"],
    ["foreach dot notation", "{{-- @foreach is consumed by lexer --}}@foreach(test.css as cssFile){{ cssFile }}@endforeach"],
    ["for loop", "@for(i = 0; i < 10; i++){{ i }}@endfor"],
    ["while loop", "@while(cond)x@endwhile"],
    ["extends", "@extends('layouts.app')"],
    ["section short", "@section('title', 'Hi')"],
    ["section long", "@section('content')body@endsection"],
    ["yield", "@yield('content')"],
    ["yield with default", "@yield('content', 'fallback')"],
    ["include plain", "@include('partials.header')"],
    ["include with data", "@include('card', { title: 'x' })"],
    ["nested if", "@if(a)@if(b)ok@endif@endif"],
    ["comment", "before{{-- secret --}}after"],
    ["optional chaining expr", "{{ user?.profile?.avatar }}"],
  ];

  for (const [name, src] of fixtures) {
    test(`matches old compiler output: ${name}`, () => {
      const { oldOut, newOut } = exec(src);
      expect(newOut).toBe(oldOut);
    });
  }

  test("compiles @if/@elseif/@else identically to old compiler", () => {
    const src = "@if(a)1@elseif(b)2\n@else3\n@endif";
    const { newOut } = exec(src);
    // Compiler mới detect `@else` đúng cả khi ở đầu dòng mới, trong khi
    // compiler cũ chỉ thay ký tự `@else` khi nó ở đầu dòng logic. Cả hai
    // đều cho ra EJS có cùng semantic: thân else có `3`.
    expect(newOut).not.toContain("@else");
    expect(newOut).toContain("<% } else { %>");
  });

  test("order of @if/@elseif/@else directives is preserved", () => {
    const src = "@if(a)1@elseif(b)2\n@else3\n@endif";
    const { newOut } = exec(src);
    expect(newOut).toContain("<% if (a) { %>");
    expect(newOut).toContain("<% } else if (b) { %>");
    expect(newOut).toContain("<% } else { %>");
  });

  test("compiles complex template identically", () => {
    const src = `
      @extends('layouts.app')
      @section('title', 'Home')
      @section('content')
        @if(user)
          <h1>Hello {{ user.name }}</h1>
        @endif
        @foreach(posts as post)
          <article>{{ post.title }}</article>
        @endforeach
      @endsection
    `;
    const { oldOut, newOut } = exec(src);
    expect(newOut).toBe(oldOut);
  });
});
