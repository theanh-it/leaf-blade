# 🌿 Leaf Blade

Blade template engine for Leaf framework — Laravel Blade-like syntax for JavaScript/TypeScript.

![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Bun](https://img.shields.io/badge/Bun-latest-black.svg)

> 📖 [Tiếng Việt](README.vi.md) | English

## 📦 Installation

```bash
npm install leaf-blade
```

## 🚀 Usage

### 1. Setup Plugin

```typescript
import { Elysia } from "elysia";
import { bladePlugin } from "leaf-blade";
import path from "path";

const app = new Elysia()
  .use(
    bladePlugin({
      viewsDir: path.join(process.cwd(), "views/blade"),
      cache: true,
      minify: process.env.NODE_ENV === "production",
    })
  )
  .listen(3000);
```

### 2. Use in Routes

```typescript
import { bladeView } from "leaf-blade";

app.get("/", async (ctx) => {
  return bladeView(ctx, "home", {
    title: "Home Page",
    description: "Welcome to Leaf",
    features: [
      { title: "Fast", description: "Built with Bun" },
      { title: "Modern", description: "Vue 3 + TypeScript" },
    ],
  });
});
```

### 3. Direct Usage

```typescript
app.get("/page", async (ctx) => {
  const html = await ctx.blade.render("template", {
    title: "Page Title",
    data: { ... }
  });
  return html;
});
```

### 4. Use Engine Directly

```typescript
import { BladeRenderer } from "leaf-blade";
import path from "path";

const renderer = new BladeRenderer({
  viewsDir: path.join(process.cwd(), "views/blade"),
  cache: true,
});

const html = await renderer.render("template", {
  title: "Page Title",
});
```

### 5. Sync Render (Hot Path)

For maximum throughput after the first render (ops are cached):

```typescript
// First call: loads + compiles (async I/O)
await renderer.render("template", { title: "Hello" });

// Subsequent calls: pure execution, no I/O
const html = renderer.renderSync("template", { title: "Hello" });
```

This is the fastest path — the compiled ops array bypasses AST traversal entirely.

## ⚙️ Options

### BladeOptions

```typescript
interface BladeOptions<TContext extends Context = Context> {
  viewsDir?: string; // Directory containing templates (default: "views/blade")
  cache?: boolean; // Enable/disable cache (default: true)
  maxCacheSize?: number; // Maximum entries per template cache (default: 500)
  cacheDir?: string; // Deprecated compatibility option; no disk cache is created
  minify?: boolean; // Defaults to true only when NODE_ENV="production"
  security?: boolean; // Default: true
  shared?: BladeSharedData;
  resolveData?: BladeDataProvider<TContext>;
}
```

## Shared SSR data and providers

Register static data once on the plugin. Routes can keep calling the existing helper:

```typescript
app.use(bladePlugin({
  viewsDir: "./views/blade",
  cache: true,
  shared: { siteName: "My website", lang: "vi" },
}));

app.get("/", (ctx) => bladeView(ctx, "home", { title: "Home" }));
```

For dynamic header/footer data in a long-running Bun + Leaf/Elysia application, call an application service from the provider:

```typescript
import { Elysia } from "elysia";
import { bladePlugin, bladeView } from "leaf-blade";
import { getSiteLayout } from "./services/site-layout";

const app = new Elysia()
  .onError(({ error, set }) => {
    console.error(error);
    set.status = 503;
    return "Page temporarily unavailable";
  })
  .use(bladePlugin({
    viewsDir: "./views/blade",
    cache: true, // Template/AST cache only
    shared: { siteName: "My website", lang: "vi" },
    resolveData: async (ctx, template) => ({
      siteLayout: await getSiteLayout(),
      currentPath: new URL(ctx.request.url).pathname,
      currentTemplate: template,
    }),
  }))
  .get("/", (ctx) => bladeView(ctx, "home", { title: "Home" }))
  .get("/about", (ctx) => bladeView(ctx, "about", { title: "About" }))
  .get("/fragment", (ctx) => ctx.blade.render("partials.header"))
  .get("/api/health", () => ({ ok: true }))
  .listen(3000);
```

The service, database access, cache lifetime, and invalidation belong to your application. For example, this service keeps public header/footer data for 60 seconds (replace the repository with your own):

```typescript
// Application file: services/site-layout.ts (not part of leaf-blade)
import { layoutRepository } from "../repositories/layout";

type SiteLayout = {
  header: { label: string };
  footer: { text: string };
};
let cached: { value: SiteLayout; expiresAt: number } | undefined;

export async function getSiteLayout(): Promise<SiteLayout> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value: SiteLayout = await layoutRepository.loadHeaderAndFooter();
  cached = { value, expiresAt: Date.now() + 60_000 };
  return value;
}
```

Cache only public layout data in this example; keep user-specific data scoped to the request. Treat cached values as immutable. The package adds no database or business cache and never caches provider results.

```blade
{{-- layouts/app.blade.html --}}
<html lang="{{ lang }}">
  <head><title>{{ title }} | {{ siteName }}</title></head>
  <body>
    @include('partials.header')
    @yield('content')
    <footer>{{ siteLayout.footer.text }}</footer>
  </body>
</html>

{{-- partials/header.blade.html --}}
<header>{{ siteName }} — {{ siteLayout.header.label }}</header>
```

### Precedence and reserved keys

Both `bladeView(ctx, template, data)` and `ctx.blade.render(template, data)` use one pipeline, from lowest to highest priority:

1. Defaults: `title: "Leaf App"`, `description: "Ứng dụng Leaf với SSR và Vue 3"`, `lang: "vi"`.
2. `shared`.
3. The object returned by `resolveData(ctx, template)`.
4. Data passed to the render call.

Merging is shallow and uses own enumerable string keys. At every layer, `undefined` is ignored and preserves the lower-priority value. Explicit `null`, `false`, `0`, and `""` are retained; nested objects replace earlier objects as a whole.

`vite`, `js`, and `css` are **reserved keys**, assigned after merging from the current Elysia context: `vite = ctx.vite || { main: "", css: "" }`, `js = vite.main`, `css = vite.css`. Data layers cannot override them. `BladeViteAssets` supports `main: string`, `css: string | readonly string[]`, and optional `imports: readonly string[]`; imports remain accessible as `vite.imports`. Direct context renders now receive the same metadata defaults and context assets as the helper.

### Lifecycle, isolation, and types

- Providers may return an object synchronously or a `Promise` of an object. They run once per application render call, including when the template is cached. API/static requests that do not render never invoke them.
- Layouts, `@extends`, and `@include` inherit the data from that render and do not run the provider again. An include may still override its local data. Two independent renders in one request invoke the provider separately.
- Provider errors propagate unchanged; register the application's Elysia `onError` handler before its routes. No partial render is used as a fallback by the plugin.
- Each plugin instance prepares a shallow static snapshot once and reuses one renderer with its existing template/AST caches. Each render gets a fresh top-level data object. The plugin does not mutate caller objects, keep request contexts/results in a singleton, or add a global data registry.
- Nested `shared` objects are passed by reference: **templates and providers must never mutate them**. There is no per-request deep clone, deep merge, or recursive freeze. The same reference rule applies to nested objects passed by the caller/provider; avoid mutating those values too.
- Exported types: `BladeSharedData`, `BladeDataProvider<TContext>`, `BladeOptions<TContext>`, `BladeViteAssets`, `BladeViewData`, and the existing context types. Provider context defaults to Elysia's `Context`. For extensions, use e.g. `bladePlugin<Context & { user: { id: string } }>(...)` (import `Context` from `elysia`); your application must install those extensions before rendering. The generic describes that contract; it cannot verify the order of other plugins.

This feature only injects data into **Blade SSR**. It does not automatically synchronize anything with Vue or Pinia. Any client-side serialization and hydration must be implemented explicitly by the application. Direct `BladeRenderer` / `CompiledBlade` instances remain independent and do not run plugin providers.

## ✨ Features

### Template Syntax

- ✅ **Layout inheritance**: `@extends`, `@section`, `@yield`
- ✅ **Partials**: `@include` with data support (including dynamic loop-scope data)
- ✅ **Conditionals**: `@if`, `@elseif`, `@else`, `@endif`
- ✅ **Loops**: `@foreach`, `@for`, `@while`
- ✅ **Variables**: `{{ }}` (escaped), `{!! !!}` (raw)
- ✅ **Comments**: `{{-- --}}`
- ✅ **JavaScript blocks**: `@js` ... `@endjs` (execute JavaScript code)

### Current rendering architecture

Both renderers share safe file loading, layout/include composition, and bounded caches:

```
Template → lexer/parser → compose layout → expand includes
         → BladeRenderer: cached ops → CompiledRuntime
         → CompiledBlade: generated control flow → shared evaluator/escaping
```

The plugin continues to use `BladeRenderer`. `CompiledBlade` supports layouts, includes, `@js`, scopes, loop limits, and propagated errors rather than embedding errors into HTML. Expressions are passed as data to the evaluator, not interpolated into the generated control flow.

### Performance (v1.1.0)

The historical numbers below describe v1.1.0 before runtime parity changes; they do not represent the current plugin. See [benchmark/README.md](benchmark/README.md) for current benchmark commands.

- ✅ **Function codegen**: AST → optimized JavaScript function
- ✅ **Zero-overhead caching**: Template string as cache key (no hashing)
- ✅ **Simple for-of loops**: V8-optimized iteration (no complex indexed loops)
- ✅ **Coalesced text output**: Minimized function calls
- ✅ **HTML minification**: Automatically minifies HTML in production
- ✅ **Async I/O**: Non-blocking file reads with symlink + path-traversal checks

**Benchmark (10,000 iterations, Bun 1.2.5)**:

| Template | ops/s |
|----------|-------|
| Simple (static + 2 vars) | 724,663 |
| Medium (conditionals) | 733,165 |
| List (100-item loop) | 12,729 |
| Complex (10 sections × 10 items) | 11,584 |
| Heavy (500-row table) | 1,116 |

### Security

- ✅ **XSS protection**: `{{ }}` HTML-escapes output by default
- ✅ **Path traversal prevention**: All template paths confined to `viewsDir`
- ✅ **Symlink protection**: Symlinks resolving outside `viewsDir` are rejected
- ✅ **Expression guards**: `ExpressionEvaluator` checks known dangerous access patterns; templates must be developer-owned JavaScript, not untrusted user templates
- ✅ **Loop / recursion limits**: Prevents runaway templates from exhausting memory

### Caching and execution limits

- `maxCacheSize` bounds entries in **each** path, source, AST, file-render, and string-render cache (FIFO, default `500`, positive integer). It is not a byte limit or a provider-data cache. Available on the plugin and both renderers.
- Caches do not stat files on every render. Entries remain until eviction or renderer `clearCache()`; use `cache: false` during development. `renderSync()` can report an uncompiled template after eviction.
- File and string caches are separate. Concurrent cold renders of the same file share compilation work, never data or HTML.
- `CompiledBlade` preserves its default `.blade.php` suffix and accepts explicit `.blade.html` filenames. `renderString()` / `compile()` accept standalone source; file directives such as `@extends` / `@include` throw an error directing you to `render()`.
- `CompiledBlade` accepts `maxIterations` (default `10000`) and `maxDepth` (default `100`); `BladeRenderer` accepts them inside `runtime`. Limits must be positive integers.
- `security` provides defense in depth, **not a JavaScript isolation sandbox**. Directive limits do not interrupt arbitrary loops in `@js` or application helpers. Do not run user-authored templates in a long-running Bun process.
- Minification runs on each rendered result; measure with real templates before enabling it. Request HTML is not cached.

## 📖 Detailed Guide

### 1. Layout Inheritance (`@extends` + `@section` + `@yield`)

```blade
{{-- layouts/app.blade.html --}}
<!DOCTYPE html>
<html>
<head>
    <title>@yield('title', 'Default Title')</title>
</head>
<body>
    @yield('content')
</body>
</html>

{{-- pages/home.blade.html --}}
@extends('layouts.app')

@section('title', 'Home Page')

@section('content')
    <h1>Welcome!</h1>
@endsection
```

### 2. Include Partials (`@include`)

```blade
{{-- Include simple --}}
@include('partials.header')

{{-- Include with data --}}
@include('partials.user-card', { user: user, showEmail: true })
```

### 3. Conditionals (`@if`, `@elseif`, `@else`, `@endif`)

```blade
@if(user)
    <p>Welcome, {{ user.name }}!</p>
@elseif(guest)
    <p>Please login</p>
@else
    <p>Hello guest</p>
@endif
```

### 4. Loops (`@foreach`, `@for`, `@while`)

```blade
{{-- Foreach --}}
@foreach(posts as post)
    <article>
        <h2>{{ post.title }}</h2>
    </article>
@endforeach

{{-- Foreach with key --}}
@foreach(items as key => item)
    <div>{{ key }}: {{ item }}</div>
@endforeach

{{-- For loop --}}
@for(i = 0; i < 10; i++)
    <span>Item {{ i }}</span>
@endfor

{{-- While loop --}}
@while(condition)
    <p>Content</p>
@endwhile
```

### 5. Variables

```blade
{{-- Escaped output (default) - XSS safe --}}
{{ user.name }}
{{ post.title }}

{{-- Raw output (HTML) - only for trusted content --}}
{!! user.bio !!}
{!! post.content !!}

{{-- Optional chaining support --}}
{{ user?.profile?.avatar }}
{{ post?.author?.name }}
```

### 6. Comments

```blade
{{-- This is a comment and is never rendered --}}
{{-- Comments can span multiple lines and may safely contain Blade syntax --}}
```

### 7. JavaScript Blocks (`@js` ... `@endjs`)

```blade
@js
const items = ['apple', 'banana', 'orange'];
const count = items.length;
@endjs

<p>Total: {{ count }} items</p>

@js
let sum = 0;
for (let i = 0; i < items.length; i++) {
  sum += items[i].length;
}
@endjs

<p>Total characters: {{ sum }}</p>
```

**Note**: Do not use `return` statements in `@js` blocks.

## 📝 Detailed Examples

### Layout Template

```blade
{{-- views/blade/layouts/app.blade.html --}}
<!DOCTYPE html>
<html lang="{{ lang || 'en' }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>@yield('title', 'Leaf App')</title>

    @if(css)
    <link rel="stylesheet" href="{{ css }}">
    @endif
</head>
<body>
    @include('partials.header')

    <main>
        @yield('content')
    </main>

    @include('partials.footer')

    @if(js)
    <script type="module" src="{{ js }}"></script>
    @endif
</body>
</html>
```

### Page Template

```blade
{{-- views/blade/home.blade.html --}}
@extends('layouts.app')

@section('title', 'Home - Leaf App')

@section('content')
<div id="app">
    <h1>Welcome to Leaf!</h1>

    @if(features && features.length > 0)
    <div class="features">
        @foreach(features as feature)
        <div class="feature-card">
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.description }}</p>
        </div>
        @endforeach
    </div>
    @endif
</div>
@endsection
```

### Partial Template

```blade
{{-- views/blade/partials/header.blade.html --}}
<header>
    <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
    </nav>
</header>
```

## 📁 Recommended Directory Structure

```
views/blade/
├── layouts/
│   ├── app.blade.html          # Main layout
│   └── admin.blade.html        # Admin layout
├── partials/
│   ├── header.blade.html
│   ├── footer.blade.html
│   └── nav.blade.html
├── components/
│   ├── button.blade.html
│   └── card.blade.html
└── pages/
    ├── home.blade.html
    └── about.blade.html
```

## 🔄 Comparison with Laravel Blade

| Laravel Blade               | Leaf Blade                    | Note                    |
| --------------------------- | ----------------------------- | ----------------------- |
| `@extends('layout')`        | `@extends('layouts.app')`     | ✅ Same                 |
| `@section('name')`          | `@section('name')`            | ✅ Same                 |
| `@yield('name')`            | `@yield('name')`              | ✅ Same                 |
| `@include('partial')`       | `@include('partials.header')` | ✅ Same                 |
| `{{ $var }}`                | `{{ user.name }}`             | ⚠️ No `$` in JavaScript |
| `{!! $html !!}`             | `{!! html !!}`                | ✅ Same                 |
| `@if($condition)`           | `@if(condition)`              | ⚠️ No `$`               |
| `@foreach($items as $item)` | `@foreach(items as item)`     | ⚠️ No `$`               |
| `@php ... @endphp`          | `@js ... @endjs`              | ✅ Equivalent           |

**Note**: Since JavaScript doesn't use `$` for variables, the syntax has been adjusted accordingly.

## ⚡ Best Practices

### 1. Organize Templates

- **Layouts**: `layouts/` - Page structure
- **Partials**: `partials/` - Reusable UI pieces
- **Components**: `components/` - UI components
- **Pages**: Root or `pages/` - Page templates

### 2. Naming Convention

- Use `kebab-case` for file names: `user-profile.blade.html`
- Use `camelCase` for variables in templates: `{{ userName }}`

### 3. Performance

- Enable cache in production: `cache: true`
- Enable minification: `minify: true`
- Use partials to avoid duplicate code
- For hot paths: warm up the cache once, then call `renderSync()` for max throughput

### 4. Security

- Always use `{{ }}` for user input (escaped)
- Only use `{!! !!}` for trusted HTML content

## 🎯 Advanced Features

### Nested Sections

```blade
@extends('layouts.app')

@section('title', 'Page Title')

@section('content')
    <div class="container">
        @section('inner-content')
            <p>Default inner content</p>
        @endsection
    </div>
@endsection
```

### Conditional Includes

```blade
@if(user)
    @include('partials.user-menu', { user: user })
@else
    @include('partials.guest-menu')
@endif
```

### Loop Variables

```blade
@foreach(items as index => item)
    @if(index === 0)
        <div class="first">{{ item }}</div>
    @else
        <div>{{ item }}</div>
    @endif
@endforeach
```

## 🐛 Troubleshooting

### Template not found

```typescript
// Make sure viewsDir is correct
bladePlugin({
  viewsDir: path.join(process.cwd(), "views/blade"),
});
```

### Section not rendering

```blade
{{-- Make sure @yield exists in layout --}}
@yield('content')

{{-- And @section in page --}}
@section('content')
    Content here
@endsection
```

### Include not found

```blade
{{-- Use relative path from viewsDir --}}
@include('partials.header')  ✅
@include('views/blade/partials/header')  ❌
```

### Cache issues

```typescript
// Clear cache programmatically
const renderer = new BladeRenderer({ ... });
renderer.clearCache();
```

## 📋 Changelog

### Unreleased

- Share safe loading/composition across renderers; fix `CompiledBlade` traversal, symlinks, single-quote escaping, and errors embedded in HTML.
- Bound all template caches with FIFO eviction, separate file/string caches, coalesce concurrent cold compilation, and cache resolved paths.
- Cache parsed property paths, reduce foreach allocation, and avoid an extra await for synchronous providers.
- Guard constant-computed constructor access; clarify developer-owned templates and the limits of `security`.
- Add regression tests and a multi-round SSR benchmark; correct the existing cold measurement and Medium summary row.

### [1.2.0] - 2026-10-19

- Add static `shared` data and synchronous/asynchronous `resolveData(ctx, template)` providers for Blade SSR.
- Unify helper/context render data precedence, metadata defaults and reserved context assets; ignore `undefined` overrides.
- Isolate request data and include traversal state across concurrent renders and plugin instances; keep template caches unchanged.
- Export provider/shared/options types and support Vite CSS/import arrays. Document application-owned caching and SSR-only injection.

### [1.1.0] - 2026-08-13

🚀 **Minor Release: Optimized Function Codegen**

#### ⚡ Performance

- **Function codegen pipeline**: AST is compiled directly into optimized JavaScript functions at first render. The generated function is cached by template source (no hashing) and reused on subsequent renders.
- **V8-optimized iteration**: Replaces indexed loop patterns with simple `for…of` for faster string-based dispatch.
- **Coalesced text output**: Adjacent text/values are merged into single push calls, reducing output-buffer overhead.
- **Zero-overhead caching**: Template source string is used directly as the cache key, avoiding per-render hashing.

#### ✨ New Components

- **`FunctionCodegen`** (`src/engines/runtime/function-codegen.ts`): AST → optimized JavaScript function compiler
  - Generates a single function per template using the `Function` constructor
  - Inlines expression evaluation, loops, conditionals, and helpers
- **`CompiledBlade`** (`src/engines/compiled-blade.ts`): Executes the generated function against a runtime context
  - Replaces the per-node AST walk with a single function call

#### 📊 Benchmark

| Template | ops/s |
|----------|-------|
| Simple (static + 2 vars) | 724,663 |
| Medium (conditionals) | 733,165 |
| List (100-item loop) | 12,729 |
| Complex (10 sections × 10 items) | 11,584 |
| Heavy (500-row table) | 1,116 |

#### 📦 Bundle & Tests

- **Tests**: 233 tests, all passing
- **API compatibility**: 100% backward compatible with v1.0.1

### [1.0.1] - 2026-08-11

🚀 **Performance Release: Full AST Codegen Optimization**

#### ⚡ Performance

- **Full AST codegen**: AST is flattened into a compact ops array (`{t: 'T'|'E'|'I'|'FE'|'FR'|'W'|'JS'|'IS', ...}`) at first render and cached. Subsequent renders execute a tight switch-based loop over the flat array instead of walking the AST tree.
- **3.7x throughput improvement**: Real-world template benchmark
  - v1.0.0: 1993 renders/sec (0.502ms/render)
  - v1.0.1: **7381 renders/sec (0.135ms/render)** — **+270%**
- **Eliminates AST dispatch overhead**: No more `switch (node.type)` per node — ops use 1-char type tags (`T`, `E`, `I`, `FE`, `FR`, `W`, `JS`, `IS`) for fast V8 string comparison.
- **Coalesced text nodes**: Adjacent `Text` nodes are merged into a single string during codegen, reducing `parts.push()` calls.
- **Compacted if/elseif/else chains**: Branch chains are flattened recursively into nested `IF` ops with `else-body` field, avoiding intermediate node objects.

#### ✨ New Components

- **`compileNodes()`** (`src/engines/runtime/codegen.ts`): AST → ops array compiler
  - Flattens AST, coalesces text, inlines expression data
  - Returns compact `Op[]` (1-char type tags + primitive fields)
- **`CompiledRuntime`** (`src/engines/runtime/compiled-runtime.ts`): Fast ops interpreter
  - Tight switch loop over ops, no AST walking
  - Same security/error semantics as `BladeRuntime`
  - Tracks `currentDepth` for `maxDepth` enforcement
- **`renderSync()`** API: Synchronous render after first async render (populates compiled-ops cache). Useful for hot-path rendering when file I/O isn't needed.

#### 🔧 Implementation

- `BladeRenderer` caches compiled ops per template path in `opsCache` (alongside existing `astCache` + `templateCache`).
- `CompiledRuntime` is initialized alongside `BladeRuntime`; render() delegates execution to it after the first call.
- Original `BladeRuntime` retained for API compatibility (still exported).

#### 📦 Bundle & Tests

- **Bundle size**: 78.68 KB (was 59.5 KB in v1.0.0; +19 KB for codegen + CompiledRuntime)
- **Tests**: 230 tests (was 162), all passing — 28 new tests for codegen correctness
- **API compatibility**: 100% backward compatible with v1.0.0 — no breaking changes

#### 📚 Documentation

- Updated README with codegen architecture diagram
- Added performance benchmark section
- New "Sync hot path" note for `renderSync()`

### [1.0.0] - 2026-08-11

🎉 **Major Release: Native AST Runtime — Zero EJS Dependency**

#### 🚀 Breaking Changes

- **Removed EJS dependency**: The engine now uses a fully native AST interpreter. EJS is no longer required at runtime and has been moved to `devDependencies`.
- **Removed old engine components**:
  - `BladeCompiler` (regex-based, EJS-generating) → replaced by `BladeCompiler` (AST-based)
  - `BladeRenderer` (EJS-based) → replaced by `BladeRenderer` (native runtime)
  - `SimpleRenderer` → removed (superseded by native runtime)
- **API remains unchanged**: If you were using `BladeRenderer` or `bladePlugin`, your code will work without modification. The new components use the same names and APIs.

#### ✨ New Architecture

**Native Pipeline**:
```
Template → Lexer → Parser → AST → Composer → Include Processor → Runtime → HTML
```

**Core Components**:
- **`BladeLexer`**: Tokenizes Blade syntax with line/column tracking
- **`BladeParser`**: Builds typed AST from tokens with full validation
- **`BladeRuntime`**: Evaluates AST directly using native JavaScript execution
- **`TemplateComposer`**: Resolves `@extends`, `@section`, and `@yield` at AST level
- **`IncludeProcessor`**: Inlines `@include` directives with correct lexical scoping
- **`ExpressionEvaluator`**: Safely evaluates expressions using `Proxy` + `with` scope
- **`RuntimeContext`**: Manages template scope with parent-child relationships

#### 🐛 Fixes

- **Fixed `@include` with data in loops**: `@include('partial', { item: item })` now correctly accesses loop variables. Previously, data expressions were evaluated too early and couldn't see dynamic scope.
- **Fixed nested section accumulation**: Child templates extending layouts with their own `@extends` now correctly accumulate sections without duplication.
- **Fixed circular layout detection**: Proper detection and error reporting for circular `@extends` chains.

#### 🔒 Security Improvements

- **Expression sandboxing**: `ExpressionEvaluator` blocks access to dangerous globals (`process`, `require`, `eval`, `Function`, etc.)
- **Loop limits**: Prevents infinite loops with configurable iteration limits
- **Recursion limits**: Guards against stack overflow from deeply nested templates
- **Safer scope isolation**: Include data is properly isolated using `Object.create()` for child scopes

#### 📦 Bundle & Performance

- **Bundle size**: 59.5 KB (was 54 KB in v0.0.4, increase due to complete runtime)
- **Test coverage**: 162 tests (was 116), all passing
- **Native evaluation**: AST evaluation is faster than EJS compilation + execution for most templates
- **Naive caching**: Templates are cached until explicit `clearCache()` — no automatic file stat checks for maximum performance

#### 📚 Documentation

- Updated README with v1.0.0 architecture overview
- Added detailed security and performance notes
- Documented all new runtime components in public API
- See `MIGRATION.md` for upgrade guide from v0.0.4 → v1.0.0

#### 🙏 Migration Notes

For most users, v1.0.0 is a drop-in replacement. If you were using internal APIs:
- `BladeCompilerV2` → `BladeCompiler` (same API, renamed)
- `BladeRendererV2` → `BladeRenderer` (same API, renamed)
- Old regex-based compiler removed (use `BladeCompiler.compile()` for EJS output if needed)

### [0.0.4] - 2026-08-08

#### Added

- **Parser Module v2**: Complete lexer, parser, and code generator architecture
  - `BladeLexer`: Tokenization with line/column tracking
  - `BladeParser`: Parse tokens into AST with full validation
  - `BladeCodeGenerator`: Generate EJS code from AST
  - `BladeCompilerV2`: New compiler with detailed error diagnostics
  - `BladeTemplateError`: Custom error with source location
- Full parser module exports via public API
- 62 new tests for parser module (116 tests total)
- Complete type definitions for all parser components

#### Improvements

- Bundle size increased from 22KB to 54KB (due to parser module addition)
- More detailed error messages with line/column information
- Compatibility tests between old and new compiler

#### Notes

- Parser v2 is optional, BladeRenderer defaults to old compiler
- Users can opt-in to `BladeCompilerV2` for better error reporting
- 100% backward compatible with v0.0.3

### [0.0.3] - 2026-07-17

#### Security

- Corrected output semantics: `{{ value }}` is HTML-escaped and `{!! value !!}` is raw.
- Removed Blade comments before compiling directives or expressions.
- Composed includes as source and rendered the final template exactly once, preventing included output from being evaluated as EJS again.
- Removed rendered-include and minified-response caches that could leak data across requests.
- Rejected template traversal and symlinks that resolve outside `viewsDir`.
- Replaced `Bun.file` with `node:fs/promises` for Node-compatible template loading.
- Replaced the collision-prone compiled-template hash with SHA-256.

#### Upgrade note

The escaping behavior now matches the documented Blade syntax. Applications that worked around the old reversed behavior must change trusted raw HTML from `{{ html }}` to `{!! html !!}` and untrusted values from `{!! value !!}` to `{{ value }}`. The `cacheDir` option remains accepted for compatibility but is deprecated and has no effect.

Template lookup is now confined to `viewsDir`. If an application used `../` paths or symlinks to shared templates outside that directory, move those templates under a common root and configure that root as `viewsDir`. Do not rely on raw values or included output being evaluated as EJS a second time; they are now treated as output. Blade comments are always removed and no longer leave a development placeholder.

### [0.0.2] - 2026-01-15

#### Fixed

- Added dot-notation collection support to `@foreach`, such as `@foreach(assets.css as cssFile)`.

### [0.0.1] - 2025-11-29

#### Added

- Initial release of Leaf Blade template engine
- Laravel Blade-like syntax support
- Layout inheritance (`@extends`, `@section`, `@yield`)
- Partials support (`@include`)
- Conditionals (`@if`, `@elseif`, `@else`, `@endif`)
- Loops (`@foreach`, `@for`, `@while`)
- Variables (`{{ }}`, `{!! !!}`)
- Comments (`{{-- --}}`)
- JavaScript blocks (`@js` ... `@endjs`)
- HTML minification support
- Template caching (in-memory + file-based)
- Async file I/O
- TypeScript support
- Elysia plugin integration
- Comprehensive test suite (38 tests)
- Documentation

#### Performance

- Multi-layer caching system
  - Compiled code cache
  - Template content cache
  - Includes cache
  - Minified output cache
- Async file I/O (non-blocking)
- File stats cache for cache validation
- Optimized compilation with regex caching

#### Features

- Dot notation for template paths (`layouts.app` → `layouts/app.blade.html`)
- Auto-escaping by default
- Raw HTML output support
- Optional chaining in expressions
- Error handling with context

## 🧪 Testing

```bash
bun test
```

The v1.1.0 test suite contains **233 tests** covering:
- **Lexer**: Tokenization, error handling, edge cases
- **Parser**: AST generation, validation, error diagnostics
- **Runtime**: Expression evaluation, scope management, execution
- **Composer**: Layout inheritance, section accumulation, circular detection
- **Include Processor**: Partial inlining, data expressions, scope isolation
- **Codegen (v1.1.0+)**: Function generation, optimized loops, text coalescing, zero-overhead caching
- **Renderer**: End-to-end template rendering with all features
- **Security**: XSS prevention, path traversal, symlink protection, expression sandboxing
- **Integration**: Complete real-world scenarios (blog, dashboard, e-commerce)

All tests pass with 100% success rate.

## 📝 License

ISC
