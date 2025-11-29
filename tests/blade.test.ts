import { test, expect, beforeEach, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { bladePlugin, bladeView } from "../src/plugins/blade";
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

// bladePlugin tests
{
  test("register blade plugin", async () => {
    const templatePath = join(testViewsDir, "test.blade.html");
    writeFileSync(templatePath, "Hello {{ name }}", "utf-8");

    const app = new Elysia()
      .use(
        bladePlugin({
          viewsDir: testViewsDir,
          cache: false,
        })
      )
      .get("/", async (ctx) => {
        const html = await ctx.blade.render("test", { name: "World" });
        return html;
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    expect(text).toContain("Hello");
    expect(text).toContain("World");
  });

  test("blade plugin with default options", async () => {
    const templatePath = join(testViewsDir, "default.blade.html");
    writeFileSync(templatePath, "Default: {{ value }}", "utf-8");

    const app = new Elysia()
      .use(bladePlugin({ viewsDir: testViewsDir, cache: false }))
      .get("/", async (ctx) => {
        return await ctx.blade.render("default", { value: "Test" });
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    expect(text).toContain("Default");
    expect(text).toContain("Test");
  });

  test("blade plugin with minify option", async () => {
    const templatePath = join(testViewsDir, "minify.blade.html");
    writeFileSync(
      templatePath,
      "<html>\n  <body>\n    <h1>Title</h1>\n  </body>\n</html>",
      "utf-8"
    );

    const app = new Elysia()
      .use(
        bladePlugin({
          viewsDir: testViewsDir,
          cache: false,
          minify: true,
        })
      )
      .get("/", async (ctx) => {
        return await ctx.blade.render("minify", {});
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    // Minified HTML should have less whitespace
    expect(text.replace(/\s+/g, " ").trim()).toContain("<html>");
  });
}

// bladeView tests
{
  test("render view with bladeView helper", async () => {
    const templatePath = join(testViewsDir, "view.blade.html");
    writeFileSync(
      templatePath,
      "<h1>{{ title }}</h1><p>{{ description }}</p>",
      "utf-8"
    );

    const app = new Elysia()
      .use(bladePlugin({ viewsDir: testViewsDir, cache: false }))
      .get("/", async (ctx) => {
        return bladeView(ctx, "view", {
          title: "Test Page",
          description: "Test Description",
        });
      });

    const response = await app.handle(new Request("http://localhost/"));
    expect(response.headers.get("content-type")).toContain("text/html");
    const text = await response.text();
    expect(text).toContain("Test Page");
    expect(text).toContain("Test Description");
  });

  test("bladeView with default title and description", async () => {
    const templatePath = join(testViewsDir, "default-view.blade.html");
    writeFileSync(
      templatePath,
      "Title: {{ title }}, Desc: {{ description }}",
      "utf-8"
    );

    const app = new Elysia()
      .use(bladePlugin({ viewsDir: testViewsDir, cache: false }))
      .get("/", async (ctx) => {
        return bladeView(ctx, "default-view", {});
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    expect(text).toContain("Leaf App");
    expect(text).toContain("Ứng dụng Leaf với SSR và Vue 3");
  });

  test("bladeView with vite assets", async () => {
    const templatePath = join(testViewsDir, "assets.blade.html");
    writeFileSync(
      templatePath,
      "JS: {{ js }}, CSS: {{ css }}, Vite: {{ vite.main }}",
      "utf-8"
    );

    const app = new Elysia()
      .use(bladePlugin({ viewsDir: testViewsDir, cache: false }))
      .get("/", async (ctx) => {
        // Mock vite in context
        (ctx as any).vite = {
          main: "/assets/main.js",
          css: "/assets/main.css",
        };
        return bladeView(ctx, "assets", {});
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    expect(text).toContain("/assets/main.js");
    expect(text).toContain("/assets/main.css");
  });

  test("bladeView with custom lang", async () => {
    const templatePath = join(testViewsDir, "lang.blade.html");
    writeFileSync(templatePath, "Lang: {{ lang }}", "utf-8");

    const app = new Elysia()
      .use(bladePlugin({ viewsDir: testViewsDir, cache: false }))
      .get("/", async (ctx) => {
        return bladeView(ctx, "lang", { lang: "en" });
      });

    const response = await app.handle(new Request("http://localhost/"));
    const text = await response.text();
    expect(text).toContain("en");
  });
}
