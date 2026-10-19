import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia, type Context } from "elysia";
import {
  bladePlugin,
  bladeView,
  type BladeContext,
  type BladeDataProvider,
  type BladeOptions,
  type BladeSharedData,
  type BladeViewData,
  type BladeViteAssets,
} from "../src/index";

const viewsDir = mkdtempSync(join(tmpdir(), "leaf-blade-shared-"));
const defaults = "Leaf App|Ứng dụng Leaf với SSR và Vue 3|vi";

beforeAll(async () => {
  const views = {
    metadata: "{{ title }}|{{ description }}|{{ lang }}",
    base: "<html>{{ siteName }}|{{ siteLayout.header }}@yield('body')@include('footer')</html>",
    layout: "@extends('base')@section('body')<main>@yield('content')</main>@endsection",
    page: "@extends('layout')@section('content'){{ siteName }}|{{ siteLayout.header }}|{{ userId }}@endsection",
    footer: "<footer>{{ siteName }}|{{ siteLayout.footer }}|{{ userId }}</footer>",
    values: "{{ value }}|{{ zero }}|{{ flag }}|{{ empty }}|{{ nullable === null }}|{{ settings.a }}|{{ settings.b }}",
    assets: "{{ vite.main }}|{{ js }}|{{ css }}|{{ vite.imports }}",
    mutate: "@js title = 'template'; value = 'changed'; localOnly = 'local'; @endjs{{ title }}|{{ value }}|{{ same(settings) }}",
    isolated: "{{ siteName }}|{{ userId }}|{{ sequence }}",
    branches: "@if(show)@include('footer')@else@include('footer')@endif",
  };
  await Promise.all(Object.entries(views).map(([name, content]) =>
    Bun.write(join(viewsDir, `${name}.blade.html`), content)
  ));
});

afterAll(() => rmSync(viewsDir, { recursive: true, force: true }));

function request(path = "/") {
  return new Request(`http://localhost${path}`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const api of ["bladeView", "ctx.blade.render"] as const) {
  describe(api, () => {
    function createApp(options: BladeOptions = {}, data: BladeViewData = {}, template = "metadata") {
      return new Elysia()
        .use(bladePlugin({ viewsDir, cache: true, minify: false, ...options }))
        .get("/", (ctx) => api === "bladeView"
          ? bladeView(ctx, template, data)
          : ctx.blade.render(template, data));
    }

    test("uses existing metadata defaults without shared/provider", async () => {
      const response = await createApp().handle(request());
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(defaults);
      if (api === "bladeView") {
        expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
      }
    });

    test("inherits shared data through nested layouts and includes, including warm cache", async () => {
      const app = createApp({ shared: {
        siteName: "Shared site",
        siteLayout: { header: "Header", footer: "Footer" },
      } }, { userId: "visitor" }, "page");
      for (let i = 0; i < 2; i++) {
        const response = await app.handle(request());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("<html>Shared site|Header<main>Shared site|Header|visitor</main><footer>Shared site|Footer|visitor</footer></html>");
      }
    });

    for (const asyncProvider of [false, true]) {
      test(`${asyncProvider ? "async" : "sync"} provider runs once per render and receives context/template`, async () => {
        let calls = 0;
        const provider: BladeDataProvider = (ctx, template) => {
          calls++;
          expect(ctx.request.url).toBe("http://localhost/");
          expect(template).toBe("page");
          const result = {
            siteLayout: { header: "Dynamic header", footer: "Dynamic footer" },
            userId: String(calls),
          };
          return asyncProvider ? Promise.resolve(result) : result;
        };
        const app = createApp({ shared: { siteName: "Site" }, resolveData: provider }, {}, "page");
        for (let i = 1; i <= 2; i++) {
          const response = await app.handle(request());
          expect(response.status).toBe(200);
          expect(await response.text()).toBe(`<html>Site|Dynamic header<main>Site|Dynamic header|${i}</main><footer>Site|Dynamic footer|${i}</footer></html>`);
          expect(calls).toBe(i);
        }
      });
    }

    const precedenceCases: Array<{
      name: string;
      shared?: BladeSharedData;
      provided?: Record<string, unknown>;
      data?: BladeViewData;
      expected: string;
    }> = [
      { name: "shared overrides defaults", shared: { title: "S", description: "SD", lang: "en" }, expected: "S|SD|en" },
      { name: "provider overrides shared", shared: { title: "S", description: "SD", lang: "en" }, provided: { title: "P", description: "PD", lang: "fr" }, expected: "P|PD|fr" },
      { name: "caller overrides provider", shared: { title: "S", description: "SD", lang: "en" }, provided: { title: "P", description: "PD", lang: "fr" }, data: { title: "R", description: "RD", lang: "de" }, expected: "R|RD|de" },
      { name: "undefined never erases defaults", shared: { title: undefined, description: undefined, lang: undefined }, provided: { title: undefined, description: undefined, lang: undefined }, data: { title: undefined, description: undefined, lang: undefined }, expected: defaults },
      { name: "undefined preserves each lower layer", shared: { title: "S", description: "SD", lang: "en" }, provided: { title: undefined, description: "PD", lang: "fr" }, data: { title: undefined, description: undefined, lang: "de" }, expected: "S|PD|de" },
      { name: "empty strings override metadata", provided: { title: "P", description: "PD", lang: "fr" }, data: { title: "", description: "", lang: "" }, expected: "||" },
    ];
    for (const entry of precedenceCases) {
      test(entry.name, async () => {
        const app = createApp({ shared: entry.shared, resolveData: () => entry.provided ?? {} }, entry.data);
        const response = await app.handle(request());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(entry.expected);
      });
    }

    test("shallow merges, skips undefined, and preserves null/false/zero/empty string", async () => {
      const response = await createApp({
        shared: { value: "shared", zero: 2, flag: true, empty: "x", nullable: "x", settings: { a: "A", b: "B" } },
        resolveData: () => ({ value: "provider", settings: { a: "replacement" } }),
      }, { value: undefined, zero: 0, flag: false, empty: "", nullable: null }, "values").handle(request());
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("provider|0|false||true|replacement|");
    });

    test("reserved vite/js/css use context even when all data layers override them", async () => {
      const spoofed = { vite: { main: "bad", css: "bad" }, js: "bad", css: "bad" };
      const vite: BladeViteAssets = {
        main: "/main.js", css: ["/one.css", "/two.css"], imports: ["/chunk.js"],
      };
      const app = new Elysia()
        .use(bladePlugin({ viewsDir, minify: false, shared: spoofed, resolveData: () => spoofed }))
        .get("/", (ctx) => {
          (ctx as BladeContext).vite = vite;
          return api === "bladeView" ? bladeView(ctx, "assets", spoofed) : ctx.blade.render("assets", spoofed);
        });
      const response = await app.handle(request());
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('/main.js|/main.js|[&quot;/one.css&quot;,&quot;/two.css&quot;]|[&quot;/chunk.js&quot;]');
      // No context assets: retain the existing empty-string fallback.
      const fallback = await createApp({ shared: spoofed, resolveData: () => spoofed }, spoofed, "assets").handle(request());
      expect(await fallback.text()).toBe("|||");
    });

    test("does not mutate inputs and snapshots shared top-level values once", async () => {
      const settings = Object.freeze({ label: "immutable" });
      const shared = { title: "initial", settings, same: (value: unknown) => value === settings };
      const provided = Object.freeze({ value: "provided", title: "provided" });
      const data = Object.freeze({ value: "caller" });
      const app = createApp({ shared, resolveData: () => provided }, data, "mutate");
      shared.title = "changed after initialization";
      for (let i = 0; i < 2; i++) {
        const response = await app.handle(request());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("template|changed|true");
      }
      expect(shared).toEqual({ title: "changed after initialization", settings, same: shared.same });
      expect(provided).toEqual({ value: "provided", title: "provided" });
      expect(data).toEqual({ value: "caller" });
      const snapshotApp = createApp({ shared }, {}, "metadata");
      shared.title = "changed again";
      expect(await (await snapshotApp.handle(request())).text()).toBe("changed after initialization|Ứng dụng Leaf với SSR và Vue 3|vi");
    });

    for (const asyncProvider of [false, true]) {
      test(`propagates ${asyncProvider ? "async" : "sync"} provider errors unchanged to onError`, async () => {
        const failure = new Error("layout unavailable");
        let received: unknown;
        const app = new Elysia()
          .onError(({ error, set }) => {
            received = error;
            set.status = 503;
            return "Application fallback";
          })
          .use(bladePlugin({ viewsDir, resolveData: () => {
            if (asyncProvider) return Promise.reject(failure);
            throw failure;
          } }))
          .get("/", async (ctx) => api === "bladeView"
            ? bladeView(ctx, "metadata")
            : ctx.blade.render("metadata"));
        const response = await app.handle(request());
        expect(response.status).toBe(503);
        expect(await response.text()).toBe("Application fallback");
        expect(received).toBe(failure);
      });
    }

    for (const cache of [false, true]) {
      test(`concurrent cold/warm renders keep request data isolated (cache: ${cache})`, async () => {
        const entered = deferred();
        const releaseFirst = deferred();
        let calls = 0;
        const app = createApp({ cache, shared: { siteName: "Site" }, resolveData: async (ctx) => {
          calls++;
          const userId = ctx.request.headers.get("x-user")!;
          if (userId === "first") {
            entered.resolve();
            await releaseFirst.promise;
          } else {
            await entered.promise;
            releaseFirst.resolve();
          }
          return { userId, siteLayout: { header: userId, footer: userId } };
        } }, {}, "page");
        for (let round = 0; round < 2; round++) {
          const responses = await Promise.all(["first", "second"].map((user) => app.handle(new Request("http://localhost/", { headers: { "x-user": user } }))));
          for (const [index, user] of ["first", "second"].entries()) {
            expect(responses[index]!.status).toBe(200);
            expect(await responses[index]!.text()).toBe(`<html>Site|${user}<main>Site|${user}|${user}</main><footer>Site|${user}|${user}</footer></html>`);
          }
        }
        expect(calls).toBe(4);
      });
    }
  });
}

test("API and static requests never call provider", async () => {
  let calls = 0;
  const app = new Elysia()
    .use(bladePlugin({ viewsDir, resolveData: () => { calls++; throw new Error("must not run"); } }))
    .get("/api", () => ({ ok: true }))
    .get("/static.css", () => new Response("body{}"));
  expect(calls).toBe(0);
  expect(await (await app.handle(request("/api"))).json()).toEqual({ ok: true });
  expect(await (await app.handle(request("/static.css"))).text()).toBe("body{}");
  expect((await app.handle(request("/missing"))).status).toBe(404);
  expect(calls).toBe(0);
});

test("two renders in one request call provider independently", async () => {
  let calls = 0;
  const app = new Elysia()
    .use(bladePlugin({ viewsDir, minify: false, resolveData: () => ({ title: String(++calls) }) }))
    .get("/", async (ctx) => {
      const first = await bladeView(ctx, "metadata");
      const second = await ctx.blade.render("metadata");
      return `${await first.text()}\n${second}`;
    });
  expect(await (await app.handle(request())).text()).toBe("1|Ứng dụng Leaf với SSR và Vue 3|vi\n2|Ứng dụng Leaf với SSR và Vue 3|vi");
  expect(calls).toBe(2);
});

test("two plugin instances within one application keep their own static data/providers", async () => {
  const counts = [0, 0];
  const makeRoutes = (index: number, siteName: string) => new Elysia()
    .use(bladePlugin({ viewsDir, minify: false, shared: { siteName }, resolveData: (ctx) => ({
      userId: ctx.request.headers.get("x-user"), sequence: ++counts[index]!,
    }) }))
    .get(`/${siteName}`, (ctx) => bladeView(ctx, "isolated"));
  const app = new Elysia().use(makeRoutes(0, "A")).use(makeRoutes(1, "B"));
  const responses = await Promise.all(["A", "B", "A", "B"].map((site, i) =>
    app.handle(new Request(`http://localhost/${site}`, { headers: { "x-user": `user${i}` } }))
  ));
  expect(await Promise.all(responses.map((response) => response.text()))).toEqual([
    "A|user0|1", "B|user1|1", "A|user2|2", "B|user3|2",
  ]);
  expect(counts).toEqual([2, 2]);
});

test("exported generic options/providers support extended Elysia contexts and asset arrays", async () => {
  type AppContext = Context & { user: { id: string } };
  const provider: BladeDataProvider<AppContext> = (ctx, template) => ({ title: `${ctx.user.id}:${template}` });
  const shared: BladeSharedData = Object.freeze({ lang: "en" });
  const options: BladeOptions<AppContext> = { viewsDir, minify: false, shared, resolveData: provider };
  const app = new Elysia()
    .use(bladePlugin(options))
    .derive(() => ({ user: { id: "extended" }, vite: { main: "/main.js", css: ["/app.css"], imports: ["/chunk.js"] } }))
    .get("/", (ctx) => bladeView(ctx, "metadata"));
  expect(await (await app.handle(request())).text()).toBe("extended:metadata|Ứng dụng Leaf với SSR và Vue 3|en");
  // Compile-time contract: callback data must be an object.
  // @ts-expect-error Providers cannot return a string.
  const invalidProvider: BladeDataProvider = () => "invalid";
  // @ts-expect-error An extended context must still be an Elysia context.
  type InvalidOptions = BladeOptions<{ user: string }>;
  void invalidProvider;
  const invalid: InvalidOptions | undefined = undefined;
  void invalid;
});

test("parallel conditional branches can include the same partial", async () => {
  const app = new Elysia().use(bladePlugin({ viewsDir, minify: false, shared: {
    siteName: "Site", userId: "user", siteLayout: { footer: "Footer" },
  } })).get("/", (ctx) => ctx.blade.render("branches", { show: true }));
  const response = await app.handle(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("<footer>Site|Footer|user</footer>");
});

test("rejects invalid JavaScript provider results through the application error handler", async () => {
  for (const invalid of [null, undefined, "invalid", [], 42]) {
    const app = new Elysia().onError(({ error, set }) => {
      set.status = 503;
      return error instanceof Error ? error.message : String(error);
    }).use(bladePlugin({ viewsDir, resolveData: (() => invalid) as unknown as BladeDataProvider }))
      .get("/", (ctx) => bladeView(ctx, "metadata"));
    const response = await app.handle(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("resolveData must return a data object");
  }
});
