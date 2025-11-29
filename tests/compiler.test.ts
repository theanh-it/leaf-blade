import { test, expect, beforeEach, afterEach } from "bun:test";
import { BladeCompiler } from "../src/engines/compiler";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const testViewsDir = join(process.cwd(), "tests", "fixtures", "views");
const testCacheDir = join(process.cwd(), "tests", "fixtures", "cache");

// Setup và cleanup
beforeEach(() => {
  if (!existsSync(testViewsDir)) {
    mkdirSync(testViewsDir, { recursive: true });
  }
  if (!existsSync(testCacheDir)) {
    mkdirSync(testCacheDir, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(testCacheDir)) {
    rmSync(testCacheDir, { recursive: true, force: true });
  }
});

// BladeCompiler tests
{
  test("compile variables {{ }}", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "Hello {{ name }}";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("name");
  });

  test("compile raw variables {!! !!}", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "Content: {!! html !!}";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("html");
  });

  test("compile comments {{-- --}}", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "Hello {{-- comment --}} World";
    const result = compiler.compile(template, "test.blade.html");
    // Comments are processed - they may be converted to EJS format or removed
    // Just verify compilation succeeds and doesn't contain the raw Blade comment syntax
    expect(result).toBeDefined();
    expect(result).not.toContain("{{--");
    expect(result).not.toContain("--}}");
  });

  test("compile @if directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@if(condition)\nContent\n@endif";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("if");
  });

  test("compile @foreach directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@foreach(items as item)\n{{ item }}\n@endforeach";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("for");
  });

  test("compile @for directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@for(i = 0; i < 10; i++)\n{{ i }}\n@endfor";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("for");
  });

  test("compile @extends directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@extends('layouts.app')";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_EXTENDS");
  });

  test("compile @section directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@section('title')\nPage Title\n@endsection";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_SECTION");
  });

  test("compile @section with short syntax", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@section('title', 'Page Title')";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_SECTION");
  });

  test("compile @include directive", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@include('partials.header')";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_INCLUDE");
  });

  test("compile @include with data", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@include('partials.header', { title: 'Header' })";
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_INCLUDE");
  });

  test("compile complex template", () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = `
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
    const result = compiler.compile(template, "test.blade.html");
    expect(result).toContain("BLADE_EXTENDS");
    expect(result).toContain("BLADE_SECTION");
    expect(result).toContain("if");
    expect(result).toContain("for");
  });

  test("compile @js directive", async () => {
    const compiler = new BladeCompiler({
      viewsDir: testViewsDir,
      cacheDir: testCacheDir,
    });
    const template = "@js\nconst x = 1;\nconst y = 2;\n@endjs";
    const result = await compiler.compile(template, "test.blade.html");
    expect(result).toContain("const x = 1");
    expect(result).toContain("const y = 2");
    expect(result).not.toContain("@js");
    expect(result).not.toContain("@endjs");
  });
}

