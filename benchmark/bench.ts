/**
 * Benchmark: leaf-blade vs other template engines
 * Run: bun benchmark/bench.ts
 */
import { BladeRenderer } from '../src/engines/renderer';
import { CompiledBlade } from '../src/engines/compiled-blade';
import ejs from 'ejs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const ITERATIONS = 10000;

// Test data
const data = {
  title: 'Benchmark Test',
  user: { name: 'John Doe', email: 'john@example.com' },
  items: ['apple', 'banana', 'orange', 'grape', 'mango'],
  count: 42,
  isActive: true,
  description: 'This is a test description',
};

// Template strings
const simpleTemplate = 'Hello {{ user.name }}!';

const mediumTemplate = `
<!DOCTYPE html>
<html>
<head><title>{{ title }}</title></head>
<body>
  <h1>{{ title }}</h1>
  <p>Welcome, {{ user.name }}!</p>
  <p>Email: {{ user.email }}</p>
  <p>Count: {{ count }}</p>
  <p>Active: {{ isActive ? "Yes" : "No" }}</p>
  <p>{{ description }}</p>
  <ul>
  @foreach(items as item)
    <li>{{ item }}</li>
  @endforeach
  </ul>
</body>
</html>
`;

const ejsMediumTemplate = `
<!DOCTYPE html>
<html>
<head><title><%= title %></title></head>
<body>
  <h1><%= title %></h1>
  <p>Welcome, <%= user.name %>!</p>
  <p>Email: <%= user.email %></p>
  <p>Count: <%= count %></p>
  <p>Active: <%= isActive ? "Yes" : "No" %></p>
  <p><%= description %></p>
  <ul>
  <% items.forEach(function(item) { %>
    <li><%= item %></li>
  <% }); %>
  </ul>
</body>
</html>
`;

async function setup() {
  const tempDir = path.join(tmpdir(), `bench-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  await writeFile(path.join(tempDir, 'simple.blade.html'), simpleTemplate);
  await writeFile(path.join(tempDir, 'medium.blade.html'), mediumTemplate);
  await writeFile(path.join(tempDir, 'medium.ejs'), ejsMediumTemplate);
  await writeFile(path.join(tempDir, 'simple.ejs'), 'Hello <%= user.name %>!');
  return tempDir;
}

async function teardown(dir: string) {
  await rm(dir, { recursive: true, force: true });
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

async function run() {
  console.log('🚀 Template Engine Benchmark\n');
  console.log(`Iterations: ${formatNumber(ITERATIONS)}\n`);
  console.log('=' .repeat(60));

  const tempDir = await setup();

  try {
    // ─── Leaf-Blade ───────────────────────────────────────────────
    console.log('\n📄 Leaf-Blade (blade-ts)\n');

    const bladeRenderer = new BladeRenderer({ viewsDir: tempDir, cache: true });

    // Simple template
    await bladeRenderer.render('simple', data);
    let start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      bladeRenderer.renderSync('simple', data);
    }
    const bladeSimpleMs = performance.now() - start;

    // Medium template
    await bladeRenderer.render('medium', data);
    start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      bladeRenderer.renderSync('medium', data);
    }
    const bladeMediumMs = performance.now() - start;

    // First render (cold)
    start = performance.now();
    await bladeRenderer.render('simple', data);
    await bladeRenderer.render('medium', data);
    const bladeColdMs = performance.now() - start;

    console.log(`  Simple (cached):  ${bladeSimpleMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / bladeSimpleMs * 1000).toFixed(0).padStart(6)} ops/sec)`);
    console.log(`  Medium (cached): ${bladeMediumMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / bladeMediumMs * 1000).toFixed(0).padStart(6)} ops/sec)`);
    console.log(`  Cold render:     ${bladeColdMs.toFixed(2).padStart(8)} ms`);

    // ─── EJS ──────────────────────────────────────────────────────
    console.log('\n📄 EJS\n');

    // Simple template
    const ejsSimpleFn = ejs.compile('Hello <%= user.name %>!');
    start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      ejsSimpleFn(data);
    }
    const ejsSimpleMs = performance.now() - start;

    // Medium template
    const ejsMediumFn = ejs.compile(ejsMediumTemplate);
    start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      ejsMediumFn(data);
    }
    const ejsMediumMs = performance.now() - start;

    // First render (cold)
    start = performance.now();
    ejs.compile('Hello <%= user.name %>!')(data);
    ejs.compile(ejsMediumTemplate)(data);
    const ejsColdMs = performance.now() - start;

    console.log(`  Simple (cached): ${ejsSimpleMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / ejsSimpleMs * 1000).toFixed(0).padStart(6)} ops/sec)`);
    console.log(`  Medium (cached): ${ejsMediumMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / ejsMediumMs * 1000).toFixed(0).padStart(6)} ops/sec)`);
    console.log(`  Cold render:     ${ejsColdMs.toFixed(2).padStart(8)} ms`);

    // ─── Leaf-Blade (Compiled) ───────────────────────────────────────
    console.log('\n📄 Leaf-Blade (Compiled)\n');

    const bladeCompiled = new CompiledBlade({ viewsDir: tempDir, cache: true });

    // Simple template
    bladeCompiled.renderString(simpleTemplate, data);
    start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      bladeCompiled.renderString(simpleTemplate, data);
    }
    const bladeCompSimpleMs = performance.now() - start;

    // Medium template
    bladeCompiled.renderString(mediumTemplate, data);
    start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      bladeCompiled.renderString(mediumTemplate, data);
    }
    const bladeCompMediumMs = performance.now() - start;

    console.log(`  Simple (compiled): ${bladeCompSimpleMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / bladeCompSimpleMs * 1000).toFixed(0).padStart(6)} ops/sec)`);
    console.log(`  Medium (compiled):${bladeCompMediumMs.toFixed(2).padStart(8)} ms  (${(ITERATIONS / bladeCompMediumMs * 1000).toFixed(0).padStart(6)} ops/sec)`);

    // ─── Comparison ───────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Comparison Summary\n');

    const simpleVsEjs = ejsSimpleMs / bladeCompSimpleMs;
    const mediumVsEjs = ejsMediumMs / bladeCompMediumMs;

    console.log('Template  | BladeInterpreter | BladeCompiled | EJS      | vs EJS');
    console.log('----------|------------------|---------------|----------|-------');
    console.log(`Simple    | ${(ITERATIONS / bladeSimpleMs * 1000).toFixed(0).padStart(14)} | ${(ITERATIONS / bladeCompSimpleMs * 1000).toFixed(0).padStart(13)} | ${(ITERATIONS / ejsSimpleMs * 1000).toFixed(0).padStart(8)} | ${simpleVsEjs > 1 ? '+' : ''}${((simpleVsEjs - 1) * 100).toFixed(0)}%`);
    console.log(`Medium    | ${(ITERATIONS / bladeSimpleMs * 1000).toFixed(0).padStart(14)} | ${(ITERATIONS / bladeCompMediumMs * 1000).toFixed(0).padStart(13)} | ${(ITERATIONS / ejsMediumMs * 1000).toFixed(0).padStart(8)} | ${mediumVsEjs > 1 ? '+' : ''}${((mediumVsEjs - 1) * 100).toFixed(0)}%`);

  } finally {
    await teardown(tempDir);
  }
}

run().catch(console.error);
