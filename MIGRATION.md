# Migration Guide: v0.0.4 → v1.0.0

This guide helps you migrate from `leaf-blade@0.0.4` to `v1.0.0`.

## Overview

v1.0.0 is a **drop-in replacement** for most users. If you're using the public API (`BladeRenderer`, `bladePlugin`, `bladeView`), your code will work without modification.

However, v1.0.0 introduces a completely new architecture with breaking changes if you were using internal APIs.

## Breaking Changes

### 1. EJS No Longer Required

**Before**: `ejs` was a runtime dependency.

**After**: EJS is only in `devDependencies` (used only for tests). You can safely remove it from your `package.json`:

```bash
npm uninstall ejs
```

### 2. Internal API Changes

If you were using internal APIs from `leaf-blade`, here are the changes:

| Old API | New API | Notes |
|---------|---------|-------|
| `BladeCompilerV2` | `BladeCompiler` | Renamed |
| `BladeRendererV2` | `BladeRenderer` | Renamed |
| `BladeCodeGenerator` | Removed | No longer needed |
| `SimpleRenderer` | Removed | Use `BladeRenderer` instead |

### 3. No Disk Cache

The `cacheDir` option is now deprecated and has no effect:

```typescript
// Still works, but cacheDir is ignored
const renderer = new BladeRenderer({
  viewsDir: "./views",
  cacheDir: "./cache", // Deprecated - ignored
});
```

Cache is now **memory-only**. Templates are cached in memory until `clearCache()` is called.

## New Features

### 1. Correct `@include` Data Scoping

v1.0.0 fixes a long-standing issue with `@include` in loops:

```blade
{{-- v1.0.0+ --}}
@foreach(items as item)
    @include('partial', { item: item })  {{-- ✅ item is accessible --}}
@endforeach
```

In v0.0.4, the `item` variable might not be available inside the included partial due to scope issues.

### 2. Native AST Evaluation

The engine no longer generates EJS code. Templates are:

1. Lexed → Tokenized
2. Parsed → AST built
3. Composed → Layout inheritance resolved
4. Inlined → Includes resolved
5. Evaluated → AST executed to HTML

This means:
- **Faster** for most templates (no EJS compilation overhead)
- **Correct scoping** (native JavaScript execution)
- **Better error messages** (source locations preserved)

### 3. Expression Sandboxing

The `ExpressionEvaluator` now uses `Proxy` + `with` scope to safely evaluate expressions:

```blade
{{-- Safe - dangerous globals are blocked --}}
{{ process }}           {{-- ❌ Blocked --}}
{{ eval("...") }}       {{-- ❌ Blocked --}}
{{ require("fs") }}      {{-- ❌ Blocked --}}

{{-- Normal expressions work fine --}}
{{ user.name }}
{{ items.length }}
{{ Math.max(a, b) }}
```

### 4. Loop & Recursion Limits

To prevent runaway templates:

- `@foreach`: Maximum 10,000 iterations per loop
- `@for`: Maximum 10,000 iterations
- `@while`: Maximum 10,000 iterations
- Template recursion: Maximum 100 nested includes

You can customize these limits:

```typescript
const renderer = new BladeRenderer({
  viewsDir: "./views",
  maxLoopIterations: 50000,
  maxIncludeDepth: 200,
});
```

## Template Compatibility

### 100% Compatible Templates

These templates work identically in v1.0.0:

```blade
{{-- Basic variables --}}
{{ user.name }}
{!! user.html !!}

{{-- Conditionals --}}
@if(user.isAdmin)
    <p>Admin</p>
@else
    <p>User</p>
@endif

{{-- Loops --}}
@foreach(items as item)
    <p>{{ item.name }}</p>
@endforeach

{{-- Layouts --}}
@extends('layouts.app')

@section('title', 'Page Title')

@section('content')
    Content here
@endsection

{{-- Includes --}}
@include('partials.header')
```

### Behavior Changes

| Feature | v0.0.4 | v1.0.0 | Notes |
|---------|--------|--------|-------|
| `@include` with data in loop | May not see loop scope | ✅ Works correctly | Fixed |
| Expression sandboxing | ❌ | ✅ | Security improvement |
| Cache type | Memory + disk | Memory only | `cacheDir` deprecated |
| Bundle size | 54 KB | 59.5 KB | Increased due to runtime |

## Upgrading Steps

### Step 1: Update Dependency

```bash
npm install leaf-blade@1.0.0
```

### Step 2: Remove EJS (Optional)

```bash
npm uninstall ejs
```

If you have other packages depending on EJS, keep it. It's only needed at runtime if you have it explicitly required.

### Step 3: Test Your Templates

Run your existing test suite:

```bash
bun test
```

All 162 tests should pass. If you have custom templates, verify they render correctly.

### Step 4: Check for Deprecation Warnings

The `cacheDir` option is deprecated. You can safely remove it:

```typescript
// Before
const renderer = new BladeRenderer({
  viewsDir: "./views",
  cacheDir: "./cache", // Remove this
});

// After
const renderer = new BladeRenderer({
  viewsDir: "./views",
});
```

### Step 5: Verify `@include` in Loops

If you use `@include` with dynamic data inside loops, verify the data is accessible:

```blade
@foreach(items as item)
    @include('card', { item: item })
        {{-- Verify 'item' is available in card.blade.html --}}
@endforeach
```

## Troubleshooting

### "Cannot find module 'ejs'"

If you see this error, reinstall EJS as a dev dependency:

```bash
npm install --save-dev ejs
```

### "Maximum loop iterations exceeded"

Your template has a loop running too many times. Either:
1. Fix the loop condition to exit earlier
2. Increase `maxLoopIterations` in options

### "Maximum include depth exceeded"

Your templates have too many nested `@include` calls. Either:
1. Flatten your template structure
2. Increase `maxIncludeDepth` in options

### Layout Not Rendering

If layouts stopped working, check:

1. `@extends` path is correct (dot notation: `layouts.app`)
2. `@section` names match `@yield` names
3. Sections are properly closed with `@endsection`

## Need Help?

- **Issues**: https://github.com/theanh-it/leaf-blade/issues
- **Documentation**: https://github.com/theanh-it/leaf-blade#readme
- **Changelog**: See CHANGELOG.md in the repo
