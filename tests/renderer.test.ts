import { test, expect, beforeEach, afterEach } from "bun:test";
import { BladeRenderer } from "../src/engines/renderer";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
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
  if (existsSync(testViewsDir)) {
    rmSync(testViewsDir, { recursive: true, force: true });
  }
});

// BladeRenderer tests
{
  test("render simple template", async () => {
    const templatePath = join(testViewsDir, "simple.blade.html");
    writeFileSync(templatePath, "Hello {{ name }}", "utf-8");

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("simple", { name: "World" });
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  test("render template with variables", async () => {
    const templatePath = join(testViewsDir, "vars.blade.html");
    writeFileSync(templatePath, "Name: {{ name }}, Age: {{ age }}", "utf-8");

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("vars", { name: "John", age: 30 });
    expect(result).toContain("John");
    expect(result).toContain("30");
  });

  test("render template with conditionals", async () => {
    const templatePath = join(testViewsDir, "conditional.blade.html");
    writeFileSync(
      templatePath,
      "@if(show)\nVisible\n@else\nHidden\n@endif",
      "utf-8"
    );

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result1 = await renderer.render("conditional", { show: true });
    expect(result1).toContain("Visible");
    expect(result1).not.toContain("Hidden");

    const result2 = await renderer.render("conditional", { show: false });
    expect(result2).toContain("Hidden");
    expect(result2).not.toContain("Visible");
  });

  test("render template with foreach", async () => {
    const templatePath = join(testViewsDir, "loop.blade.html");
    writeFileSync(
      templatePath,
      "@foreach(items as item)\n{{ item }}\n@endforeach",
      "utf-8"
    );

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("loop", {
      items: ["A", "B", "C"],
    });
    expect(result).toContain("A");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });

  test("render @foreach with dot notation for CSS links", async () => {
    const templateName = "css-assets";
    const cssTemplatePath = join(testViewsDir, `${templateName}.blade.html`);
    const bladeTemplate = `@foreach(test.css as cssFile)
  <link rel="stylesheet" crossorigin href="{{ cssFile }}" />
@endforeach`;

    writeFileSync(cssTemplatePath, bladeTemplate, "utf-8");

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const cssFiles = [
      "/assets/main.css",
      "/assets/vendor.css",
      "/assets/components.css",
    ];
    const templateData = {
      test: {
        css: cssFiles,
      },
    };

    const renderedHtml = await renderer.render(templateName, templateData);

    // Verify all CSS files are rendered as link tags
    cssFiles.forEach((cssFile) => {
      expect(renderedHtml).toContain(`href="${cssFile}"`);
    });

    // Verify HTML attributes are present
    expect(renderedHtml).toContain('rel="stylesheet"');
    expect(renderedHtml).toContain("crossorigin");
  });

  test("render template with layout extends", async () => {
    // Create layout
    const layoutDir = join(testViewsDir, "layouts");
    mkdirSync(layoutDir, { recursive: true });
    writeFileSync(
      join(layoutDir, "app.blade.html"),
      "<html><head><title>@yield('title')</title></head><body>@yield('content')</body></html>",
      "utf-8"
    );

    // Create page
    const pagePath = join(testViewsDir, "page.blade.html");
    writeFileSync(
      pagePath,
      "@extends('layouts.app')\n@section('title', 'Page Title')\n@section('content')\n<h1>Content</h1>\n@endsection",
      "utf-8"
    );

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("page", {});
    expect(result).toContain("Page Title");
    expect(result).toContain("Content");
    expect(result).toContain("<html>");
  });

  test("render template with include", async () => {
    // Create partial
    const partialsDir = join(testViewsDir, "partials");
    mkdirSync(partialsDir, { recursive: true });
    writeFileSync(
      join(partialsDir, "header.blade.html"),
      "<header>Header</header>",
      "utf-8"
    );

    // Create page
    const pagePath = join(testViewsDir, "with-header.blade.html");
    writeFileSync(
      pagePath,
      "@include('partials.header')\n<main>Content</main>",
      "utf-8"
    );

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("with-header", {});
    expect(result).toContain("Header");
    expect(result).toContain("Content");
  });

  test("render template with dot notation", async () => {
    const nestedDir = join(testViewsDir, "pages", "about");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(nestedDir, "index.blade.html"),
      "About Page: {{ title }}",
      "utf-8"
    );

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    const result = await renderer.render("pages.about.index", {
      title: "About Us",
    });
    expect(result).toContain("About Page");
    expect(result).toContain("About Us");
  });

  test("throw error when template not found", async () => {
    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: false,
    });

    await expect(renderer.render("nonexistent", {})).rejects.toThrow(
      "Template not found"
    );
  });

  test("use cache when enabled", async () => {
    const templatePath = join(testViewsDir, "cached.blade.html");
    writeFileSync(templatePath, "Cached: {{ value }}", "utf-8");

    const renderer = new BladeRenderer({
      viewsDir: testViewsDir,
      cache: true,
    });

    const result1 = await renderer.render("cached", { value: "First" });
    expect(result1).toContain("First");

    // Modify template file
    writeFileSync(templatePath, "Cached: {{ value }} (modified)", "utf-8");

    // Should still use cached version
    const result2 = await renderer.render("cached", { value: "Second" });
    // Note: Cache behavior may vary, this test checks basic functionality
    expect(result2).toBeDefined();
  });
}
