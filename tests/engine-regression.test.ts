import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BladeRenderer, CompiledBlade, ExpressionEvaluator } from "../src/index";
import type { ASTNode } from "../src/engines/parser/ast";
import type { RenderFunction } from "../src/engines/template-engine";

const root = mkdtempSync(join(tmpdir(), "leaf-blade-engines-"));
const viewsDir = join(root, "views");
mkdirSync(viewsDir);
beforeAll(async () => {
  const views = {
    page: "@extends('layout')@section('body')<main>@foreach(users as user)@include('card', { user, label: title })@endforeach</main>@endsection",
    layout: "<html>{{ title }}@include('header')@yield('body')@include('footer')</html>",
    header: "<header>{{ title }}</header>", footer: "<footer>{{ title }}</footer>",
    card: "<p>{{ user.name }}:{{ label }}</p>",
    home: "FILE {{ name }}",
    cycle: "@include('cycle')",
    traversal: "@include('../outside')",
    error: "<p>before</p>{{ fail() }}",
  };
  await Promise.all(Object.entries(views).flatMap(([name, content]) =>
    [".blade.html", ".blade.php"].map(ext => Bun.write(join(viewsDir, name + ext), content))
  ));
  await Bun.write(join(root, "outside.blade.php"), "OUTSIDE");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

for (const Engine of [BladeRenderer, CompiledBlade]) {
  describe(Engine.name, () => {
    test("composes layout/include and isolates concurrent cold/warm data", async () => {
      const engine = new Engine({ viewsDir, cache: true });
      for (let round = 0; round < 2; round++) {
        const results = await Promise.all(["A", "B"].map(title => engine.render("page", {
          title, users: [{ name: `${title}1` }, { name: `${title}2` }],
        })));
        expect(results).toEqual(["A", "B"].map(title => `<html>${title}<header>${title}</header><main><p>${title}1:${title}</p><p>${title}2:${title}</p></main><footer>${title}</footer></html>`));
      }
    });

    test("keeps file and string caches separate in both directions", async () => {
      const engine = new Engine({ viewsDir, cache: true });
      expect(engine.renderString("home")).toBe("home");
      expect(await engine.render("home", { name: "A" })).toBe("FILE A");
      expect(engine.renderString("home")).toBe("home");
      expect(engine.renderSync("home", { name: "B" })).toBe("FILE B");
      expect(engine.renderString("../literal/path")).toBe("../literal/path");
      engine.clearCache();
      expect(() => engine.renderSync("home")).toThrow("not compiled");
    });

    test("escapes quotes/Unicode separators and keeps raw HTML explicit", () => {
      const engine = new Engine({ viewsDir });
      expect(engine.renderString("<input value='{{ value }}'>|{!! raw !!}", {
        value: "'\"<&>\u2028\u2029", raw: "<b>OK</b>",
      })).toBe("<input value='&#039;&quot;&lt;&amp;&gt;&#8232;&#8233;'>|<b>OK</b>");
    });

    test("propagates rendering errors instead of embedding error HTML", async () => {
      const engine = new Engine({ viewsDir });
      const data = { fail: () => { throw new Error("failure"); } };
      expect(() => engine.renderString("before{{ fail() }}", data)).toThrow("failure");
      await expect(engine.render("error", data)).rejects.toThrow("failure");
    });

    test("rejects lexical traversal, absolute outside paths and outside includes", async () => {
      const engine = new Engine({ viewsDir });
      await expect(engine.render("../outside.blade.php")).rejects.toThrow("inside viewsDir");
      await expect(engine.render(join(root, "outside.blade.php"))).rejects.toThrow("inside viewsDir");
      await expect(engine.render("traversal")).rejects.toThrow("inside viewsDir");
    });

    test("rejects symlinks outside the view root", async () => {
      if (process.platform === "win32") return;
      const file = `linked-${Engine.name}.blade.php`;
      symlinkSync(join(root, "outside.blade.php"), join(viewsDir, file));
      await expect(new Engine({ viewsDir }).render(file)).rejects.toThrow("inside viewsDir");
    });

    test("rejects cycles and unsupported file directives in standalone source", async () => {
      const engine = new Engine({ viewsDir });
      await expect(engine.render("cycle")).rejects.toThrow("Circular include");
      expect(() => engine.renderString("@include('header')")).toThrow("use render()");
      expect(() => engine.compile("@extends('layout')")).toThrow("use render()");
    });

    test("handles arrays, objects, null collections and loop scopes consistently", () => {
      const engine = new Engine({ viewsDir });
      expect(engine.renderString("@foreach(items as key => item){{ key }}={{ item }}:{{ title }};@endforeach", { items: { one: 1, two: 2 }, title: "T" })).toBe("one=1:T;two=2:T;");
      expect(engine.renderString("@foreach(items as item){{ item }}@endforeach", { items: null })).toBe("");
      expect(engine.renderString("@foreach(items as item){{ item }}@endforeach|{{ item }}", { items: [1, 2], item: "outer" })).toBe("12|outer");
      expect(engine.renderString("@js x = 0 @endjs@while(x < 3){{ x }}@js x++ @endjs@endwhile")).toBe("012");
      expect(engine.renderString("@for(i = 0; i < 3; i++){{ i }}@endfor")).toBe("012");
    });

    test("does not let data shadow generated helper names", () => {
      const engine = new Engine({ viewsDir });
      expect(engine.renderString("{{ _p }}|{{ _eval }}|{{ title }}", {
        _p: "data", _eval: "value", title: "Title",
      })).toBe("data|value|Title");
    });

    test("applies security guards and permits opting out explicitly", () => {
      const engine = Engine === BladeRenderer
        ? new BladeRenderer({ viewsDir, runtime: { security: true } })
        : new CompiledBlade({ viewsDir, security: true });
      expect(() => engine.renderString('{{ Object["con" + "structor"]("return 1")() }}')).toThrow("dangerous pattern");
      const unguarded = Engine === BladeRenderer
        ? new BladeRenderer({ viewsDir, runtime: { security: false } })
        : new CompiledBlade({ viewsDir, security: false });
      expect(unguarded.renderString('{{ Object["con" + "structor"]("return 1")() }}')).toBe("1");
    });

    test("bounds file caches and recompiles an evicted template", async () => {
      const engine = new Engine({ viewsDir, maxCacheSize: 2 });
      await engine.render("home", { name: "A" });
      await engine.render("header", { title: "T" });
      await engine.render("footer", { title: "T" });
      expect(() => engine.renderSync("home")).toThrow("not compiled");
      expect(await engine.render("home", { name: "B" })).toBe("FILE B");
      for (const key of ["astCache", "templateCache", "compiledCache", "pathCache"]) {
        expect((engine as unknown as Record<string, Map<string, unknown>>)[key]!.size).toBeLessThanOrEqual(2);
      }
      expect(() => new Engine({ viewsDir, maxCacheSize: 0 })).toThrow("positive safe integer");
    });
  });
}

test("string caches are bounded and concurrent cold renders compile once", async () => {
  class CountingRenderer extends BladeRenderer {
    compilations = 0;
    protected override compileProgram(ast: ASTNode[]): RenderFunction {
      this.compilations++;
      return super.compileProgram(ast);
    }
  }
  const engine = new CountingRenderer({ viewsDir, maxCacheSize: 2 });
  const output = await Promise.all(["A", "B", "C"].map(name => engine.render("home", { name })));
  expect(output).toEqual(["FILE A", "FILE B", "FILE C"]);
  expect(engine.compilations).toBe(1);
  for (const text of ["one", "two", "three"]) expect(engine.renderString(text)).toBe(text);
  expect(engine.renderString("one")).toBe("one");
  expect(engine.compilations).toBe(5);
});

test("a rejected cold compilation can be retried", async () => {
  const engine = new CompiledBlade({ viewsDir });
  await expect(engine.render("retry")).rejects.toThrow();
  await Bun.write(join(viewsDir, "retry.blade.php"), "RETRY {{ name }}");
  expect(await engine.render("retry", { name: "OK" })).toBe("RETRY OK");
});

test("clearCache does not let an older in-flight render repopulate the compiled cache", async () => {
  let entered!: () => void, release!: () => void;
  const loading = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  class PausedRenderer extends BladeRenderer {
    override async load(name: string): Promise<ASTNode[]> {
      const ast = await super.load(name);
      entered();
      await resume;
      return ast;
    }
  }
  const source = join(viewsDir, "inflight.blade.html");
  await Bun.write(source, "@extends('layout')@section('body')OLD@endsection");
  const engine = new PausedRenderer({ viewsDir });
  const pending = engine.render("inflight", { title: "T" });
  await loading;
  engine.clearCache();
  await Bun.write(source, "@extends('layout')@section('body')NEW@endsection");
  release();
  expect(await pending).toContain("OLD");
  expect(() => engine.renderSync("inflight")).toThrow("not compiled");
  expect(await engine.render("inflight", { title: "T" })).toContain("NEW");
});

test("compiled loops enforce iteration and depth limits", () => {
  const engine = new CompiledBlade({ viewsDir, maxIterations: 2, maxDepth: 2 });
  expect(() => engine.renderString("@while(true)x@endwhile")).toThrow("maximum iterations");
  expect(() => engine.renderString("@for(i = 0; i < 4; i++)x@endfor")).toThrow("maximum iterations");
  expect(() => engine.renderString("@foreach(items as item){{ item }}@endforeach", { items: [1, 2, 3] })).toThrow("maximum iterations");
  expect(() => engine.renderString("@if(true)@if(true)x@endif@endif")).toThrow("Maximum recursion depth");
  const shallow = new CompiledBlade({ viewsDir, maxDepth: 1 });
  expect(shallow.renderString("@if(false)x@endif")).toBe("");
  expect(() => new CompiledBlade({ viewsDir, maxIterations: 0 })).toThrow("positive safe integer");
});

test("evaluators reject root globals and constant-computed prototype access", () => {
  const evaluator = new ExpressionEvaluator();
  for (const expression of ["this", "globalThis", 'Object["con" + "str" + "uctor"]("return 1")()']) {
    expect(() => evaluator.evaluate(expression, {})).toThrow("dangerous pattern");
  }
  expect(evaluator.evaluate("user.name", Object.create({ user: { name: "inherited" } }))).toBe("inherited");
});
