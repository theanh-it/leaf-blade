# Benchmarks

Run all commands with Bun:

```bash
bun benchmark/bench.ts
bun benchmark/ssr.ts --output /tmp/leaf-blade-ssr.json
bun benchmark/ssr.ts --baseline /absolute/path/to/before/src/index.ts --output /tmp/leaf-blade-comparison.json
```

The optional baseline must expose the shared/provider API so every variant can produce identical HTML. It is loaded from a separate checkout or source snapshot; no package installation or publishing is performed.

## SSR comparison — 2026-10-19

Apple M1, macOS arm64, Bun 1.2.8. Each configuration has 1,000 warmup requests and seven samples of 10,000 sequential requests. Variants rotate their position between rounds. Full collection is requested before each sample; collection during rendering remains part of measured elapsed time.

The workload renders a layout, header/footer, metadata and a ten-item list through Elysia `app.handle()`, creates each Request and consumes each response body. Every variant must produce exactly the same HTML. Provider call counts are checked after measurement. `cache: true`, `minify: false`, concurrency 1. Providers return preloaded public layout data; no HTTP socket, database or network work is included.

The baseline is the source snapshot immediately before the engine/cache optimizations, with shared/providers already implemented. Both versions run in the same process. Values below are median throughput, not production HTTP capacity. These results do not establish p95/p99 behavior under concurrent load or performance with minification enabled.

| API | Data configuration | Before (renders/s) | After (renders/s) | Change |
|---|---|---:|---:|---:|
| bladeView | none | 90,717 | 142,570 | +57.2% |
| bladeView | shared | 91,219 | 141,839 | +55.5% |
| bladeView | sync | 90,419 | 142,677 | +57.8% |
| bladeView | async | 89,986 | 138,332 | +53.7% |
| render | none | 98,063 | 157,381 | +60.5% |
| render | shared | 97,821 | 159,903 | +63.5% |
| render | sync | 97,886 | 156,843 | +60.2% |
| render | async | 97,373 | 154,674 | +58.8% |

Raw samples and environment: [results/ssr-2026-10-19.json](results/ssr-2026-10-19.json).

## Renderer microbenchmark

`bench.ts` compares cached `BladeRenderer.renderSync`, cached `CompiledBlade.renderString`, and compiled EJS functions. This isolates renderer work and is a different workload from Elysia SSR. Its short, single-sample timings are sensitive to warmup and noise.

The Blade cold measurement now creates a fresh renderer and includes file reads, parsing and compilation of two templates. The EJS cold measurement compiles two already-loaded strings; their I/O costs differ, so the cold numbers are not an equal-work comparison. The Medium summary now uses the Medium measurement rather than repeating Simple.

Historical v1.1.0 compiled-renderer numbers predate layout/include parity, shared escaping and expression guards; they should not be used as current plugin throughput estimates.
