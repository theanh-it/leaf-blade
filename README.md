# 🌿 Leaf Blade

Blade template engine for Leaf framework - Laravel Blade-like syntax for JavaScript/TypeScript.

![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
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
      cacheDir: path.join(process.cwd(), "storage/blade"),
      minify: process.env.NODE_ENV === "production",
    })
  )
  .listen(3000);
```

### 2. Use in Routes

```typescript
import { Elysia } from "elysia";
import { bladeView } from "leaf-blade";
import type { BladeContext } from "leaf-blade";

const app = new Elysia().get("/", async (ctx: BladeContext) => {
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
import type { BladeContext } from "leaf-blade";

app.get("/page", async (ctx: BladeContext) => {
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

## ⚙️ Options

### BladeOptions

```typescript
interface BladeOptions {
  viewsDir?: string; // Directory containing templates (default: "views/blade")
  cache?: boolean; // Enable/disable cache (default: true)
  cacheDir?: string; // Cache directory (default: "storage/blade")
  minify?: boolean; // Enable/disable HTML minification (default: false)
}
```

## ✨ Features

### Template Syntax

- ✅ **Layout inheritance**: `@extends`, `@section`, `@yield`
- ✅ **Partials**: `@include` with data support
- ✅ **Conditionals**: `@if`, `@elseif`, `@else`, `@endif`
- ✅ **Loops**: `@foreach`, `@for`, `@while`
- ✅ **Variables**: `{{ }}` (escaped), `{!! !!}` (raw)
- ✅ **Comments**: `{{-- --}}`
- ✅ **JavaScript blocks**: `@js` ... `@endjs` (execute JavaScript code)

### Performance

- ✅ **In-memory caching**: Compiled templates cached in memory
- ✅ **File-based caching**: Compiled templates saved to disk
- ✅ **HTML minification**: Automatically minify HTML in production
- ✅ **Async I/O**: Uses async file operations

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
{{-- This is a comment, removed in production --}}
{{-- Comments can span multiple lines
     and will be removed when rendered --}}
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
await renderer.clearCache();
```

## 📋 Changelog

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

## 📝 License

ISC
