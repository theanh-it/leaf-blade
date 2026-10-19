/** Bun benchmark/ssr.ts [--baseline /absolute/src/index.ts] [--output /tmp/result.json] */
import { Elysia } from "elysia";
import { bladePlugin, bladeView } from "../src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";

const argument = (name: string) => {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? undefined : Bun.argv[index + 1];
};
const versions = [{ name: "current", bladePlugin, bladeView }];
const baseline = argument("--baseline");
if (baseline) versions.push({ name: "baseline", ...await import(pathToFileURL(baseline).href) });
const iterations = 10_000, rounds = 7, warmup = 1_000;
const viewsDir = mkdtempSync(join(tmpdir(), "leaf-blade-ssr-bench-"));
const layout = { header: "Header", footer: "Footer" };
const shared = { siteName: "Leaf", lang: "vi" };
const pageData = { title: "Benchmark", user: { name: "Visitor" }, items: Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}` })) };
const vite = { main: "/main.js", css: ["/main.css"], imports: ["/chunk.js"] };
const targets = [];
let consumed = 0;

try {
  await Promise.all(Object.entries({
    layout: '<html lang="{{ lang }}"><head><title>{{ title }}|{{ siteName }}</title></head><body>@include(\'header\')@yield(\'body\')<footer>{{ siteLayout.footer }}</footer><script src="{{ js }}"></script></body></html>',
    header: "<header>{{ siteName }}: {{ siteLayout.header }}</header>",
    page: "@extends('layout')@section('body')<h1>{{ title }}</h1><p>{{ user.name }}</p><ul>@foreach(items as item)<li>{{ item.name }}</li>@endforeach</ul>@endsection",
  }).map(([name, text]) => Bun.write(join(viewsDir, `${name}.blade.html`), text)));

  for (const version of versions) for (const api of ["bladeView", "render"]) for (const kind of ["none", "shared", "sync", "async"]) {
    let calls = 0;
    const resolveData = kind === "sync" ? () => { calls++; return { siteLayout: layout }; }
      : kind === "async" ? async () => { calls++; return { siteLayout: layout }; } : undefined;
    const staticData = kind === "none" ? undefined : kind === "shared" ? { ...shared, siteLayout: layout } : shared;
    const data = kind === "none" ? { ...pageData, ...shared, siteLayout: layout } : pageData;
    const app = new Elysia().derive(() => ({ vite }))
      .use(version.bladePlugin({ viewsDir, cache: true, minify: false, shared: staticData, resolveData }))
      .get("/", ctx => api === "bladeView" ? version.bladeView(ctx, "page", data) : ctx.blade.render("page", data));
    targets.push({ version: version.name, api, kind, app, samples: [] as number[], calls: () => calls });
  }
  const makeRequest = () => new Request("http://localhost/");
  let expected: string | undefined;
  for (const target of targets) {
    const response = await target.app.handle(makeRequest());
    assert.equal(response.status, 200);
    const html = await response.text();
    expected ??= html;
    assert.equal(html, expected);
    for (let i = 0; i < warmup; i++) consumed += (await (await target.app.handle(makeRequest())).text()).length;
  }
  for (let round = 0; round < rounds; round++) {
    const offset = round % targets.length;
    for (const target of targets.slice(offset).concat(targets.slice(0, offset))) {
      Bun.gc(true);
      const start = performance.now();
      for (let i = 0; i < iterations; i++) consumed += (await (await target.app.handle(makeRequest())).text()).length;
      target.samples.push(performance.now() - start);
    }
    console.log(`Round ${round + 1}/${rounds}`);
  }
  const results = targets.map(target => {
    const samples = [...target.samples].sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)]!;
    assert.equal(target.calls(), ["sync", "async"].includes(target.kind) ? 1 + warmup + iterations * rounds : 0);
    return { version: target.version, api: target.api, kind: target.kind,
      ops_sec: Math.round(iterations / median * 1000), us_render: +(median / iterations * 1000).toFixed(2),
      min_us: +(samples[0]! / iterations * 1000).toFixed(2), max_us: +(samples.at(-1)! / iterations * 1000).toFixed(2),
      samples_ms: target.samples, provider_calls: target.calls() };
  });
  const report = { environment: { bun: Bun.version, cpu: cpus()[0]?.model, platform: platform(), arch: arch() },
    setup: { iterations, rounds, warmup, cache: true, minify: false, concurrency: 1,
      transport: "app.handle + Request + response.text; no HTTP socket, DB or network", output_bytes: Buffer.byteLength(expected!) },
    results, consumed };
  const output = argument("--output");
  if (output) await Bun.write(output, JSON.stringify(report, null, 2));
  console.table(results.map(({ version, api, kind, ops_sec, us_render, min_us, max_us }) => ({ version, api, kind, ops_sec, us_render, min_us, max_us })));
} finally {
  rmSync(viewsDir, { recursive: true, force: true });
}
process.exit(0);
