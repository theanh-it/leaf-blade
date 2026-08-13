/**
 * Benchmark Results
 * 
 * Run: bun benchmark/bench.ts
 * 
 * Results (2026-08-12):
 * 
 * | Engine      | Simple (cached) | Medium (cached) | Cold render |
 * |-------------|----------------|-----------------|-------------|
 * | Leaf-Blade  | 372K ops/s     | 82K ops/s      | 0.08ms      |
 * | EJS         | 1.1M ops/s    | 110K ops/s     | 0.43ms      |
 * 
 * Analysis:
 * - EJS compiles to JS functions (V8 JIT optimized)
 * - Leaf-Blade interprets ops (safe but slower)
 * - Security features cost ~30% performance
 * - Leaf-Blade wins at cold render (5x faster)
 * 
 * For most web apps, both are fast enough.
 */
