# 🌿 Leaf Blade

Blade template engine cho Leaf framework - Laravel Blade-like syntax cho JavaScript/TypeScript.

![Version](https://img.shields.io/badge/version-0.0.3-blue.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)
![Bun](https://img.shields.io/badge/Bun-latest-black.svg)

> 📖 Tiếng Việt | [English](README.md)

## 📦 Cài Đặt

```bash
npm install leaf-blade
```

## 🚀 Sử Dụng

### 1. Cài Đặt Plugin

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

### 2. Sử Dụng trong Routes

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

### 3. Sử Dụng Trực Tiếp

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

### 4. Sử Dụng Engine Trực Tiếp

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

## ⚙️ Tùy Chọn

### BladeOptions

```typescript
interface BladeOptions {
  viewsDir?: string; // Thư mục chứa templates (mặc định: "views/blade")
  cache?: boolean; // Bật/tắt cache (mặc định: true)
  cacheDir?: string; // Tùy chọn tương thích đã deprecated; không tạo disk cache
  minify?: boolean; // Mặc định chỉ bật khi NODE_ENV="production"
}
```

## ✨ Tính Năng

### Template Syntax

- ✅ **Layout inheritance**: `@extends`, `@section`, `@yield`
- ✅ **Partials**: `@include` với hỗ trợ data
- ✅ **Conditionals**: `@if`, `@elseif`, `@else`, `@endif`
- ✅ **Loops**: `@foreach`, `@for`, `@while`
- ✅ **Variables**: `{{ }}` (escaped), `{!! !!}` (raw)
- ✅ **Comments**: `{{-- --}}`
- ✅ **JavaScript blocks**: `@js` ... `@endjs` (chạy JavaScript code)

### Performance

- ✅ **In-memory cache an toàn**: Chỉ cache source và kết quả compile
- ✅ **HTML minification**: Tự động minify HTML trong production
- ✅ **Async I/O**: Sử dụng async file operations

## 📖 Hướng Dẫn Chi Tiết

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

{{-- Include với data --}}
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
{{-- Escaped output (default) - an toàn với XSS --}}
{{ user.name }}
{{ post.title }}

{{-- Raw output (HTML) - chỉ dùng cho nội dung đáng tin cậy --}}
{!! user.bio !!}
{!! post.content !!}

{{-- Hỗ trợ optional chaining --}}
{{ user?.profile?.avatar }}
{{ post?.author?.name }}
```

### 6. Comments

```blade
{{-- Comment này không bao giờ được render --}}
{{-- Comment có thể nhiều dòng và chứa Blade syntax an toàn --}}
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

**Lưu ý**: Không được sử dụng `return` statement trong `@js` blocks.

## 📝 Ví Dụ Chi Tiết

### Layout Template

```blade
{{-- views/blade/layouts/app.blade.html --}}
<!DOCTYPE html>
<html lang="{{ lang || 'vi' }}">
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
    <h1>Chào mừng đến với Leaf!</h1>

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

## 📁 Cấu Trúc Thư Mục Đề Xuất

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

## 🔄 So Sánh với Laravel Blade

| Laravel Blade               | Leaf Blade                    | Ghi chú                    |
| --------------------------- | ----------------------------- | -------------------------- |
| `@extends('layout')`        | `@extends('layouts.app')`     | ✅ Giống nhau              |
| `@section('name')`          | `@section('name')`            | ✅ Giống nhau              |
| `@yield('name')`            | `@yield('name')`              | ✅ Giống nhau              |
| `@include('partial')`       | `@include('partials.header')` | ✅ Giống nhau              |
| `{{ $var }}`                | `{{ user.name }}`             | ⚠️ Bỏ `$` trong JavaScript |
| `{!! $html !!}`             | `{!! html !!}`                | ✅ Giống nhau              |
| `@if($condition)`           | `@if(condition)`              | ⚠️ Bỏ `$`                  |
| `@foreach($items as $item)` | `@foreach(items as item)`     | ⚠️ Bỏ `$`                  |
| `@php ... @endphp`          | `@js ... @endjs`              | ✅ Tương đương             |

**Lưu ý**: Vì JavaScript không dùng `$` cho variables, nên syntax đã được điều chỉnh để phù hợp.

## ⚡ Best Practices

### 1. Tổ Chức Templates

- **Layouts**: `layouts/` - Page structure
- **Partials**: `partials/` - Reusable UI pieces
- **Components**: `components/` - UI components
- **Pages**: Root hoặc `pages/` - Page templates

### 2. Naming Convention

- Use `kebab-case` cho file names: `user-profile.blade.html`
- Use `camelCase` cho variables trong templates: `{{ userName }}`

### 3. Performance

- Enable cache trong production: `cache: true`
- Enable minification: `minify: true`
- Use partials để tránh duplicate code

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
// Đảm bảo viewsDir đúng
bladePlugin({
  viewsDir: path.join(process.cwd(), "views/blade"),
});
```

### Section not rendering

```blade
{{-- Đảm bảo có @yield trong layout --}}
@yield('content')

{{-- Và @section trong page --}}
@section('content')
    Content here
@endsection
```

### Include not found

```blade
{{-- Sử dụng relative path từ viewsDir --}}
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

### [0.0.3] - 2026-07-17

#### Bảo mật

- Sửa đúng output semantics: `{{ value }}` được HTML escape và `{!! value !!}` là raw.
- Loại Blade comments trước khi compile directive hoặc expression.
- Compose include ở dạng source và chỉ render template cuối đúng một lần, ngăn output của partial bị thực thi lại như EJS.
- Loại cache HTML include và response minified có thể làm rò dữ liệu giữa request.
- Chặn template traversal và symlink trỏ ra ngoài `viewsDir`.
- Thay `Bun.file` bằng `node:fs/promises` để việc đọc template tương thích Node.
- Thay hash cache dễ collision bằng SHA-256.

#### Lưu ý nâng cấp

Hành vi escape giờ khớp với Blade syntax đã document. Ứng dụng từng workaround hành vi bị đảo ở bản cũ cần đổi trusted raw HTML từ `{{ html }}` sang `{!! html !!}`, và dữ liệu không tin cậy từ `{!! value !!}` sang `{{ value }}`. `cacheDir` vẫn được chấp nhận để tương thích nhưng đã deprecated và không còn tác dụng.

Việc tìm template giờ bị giới hạn trong `viewsDir`. Nếu ứng dụng từng dùng đường dẫn `../` hoặc symlink tới template dùng chung nằm ngoài thư mục này, hãy chuyển các template đó vào một thư mục gốc chung và cấu hình thư mục ấy làm `viewsDir`. Không dựa vào raw value hoặc output của include để thực thi lại như EJS lần hai; giờ chúng chỉ được coi là output. Blade comment luôn bị loại bỏ và không còn để lại placeholder ở môi trường development.

### [0.0.2] - 2026-01-15

#### Đã sửa

- Hỗ trợ collection dạng dot notation trong `@foreach`, ví dụ `@foreach(assets.css as cssFile)`.

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

Test suite hiện có 54 tests, bao gồm regression tests cho escaping, include composition, cache isolation và path traversal.

## 📝 License

ISC
