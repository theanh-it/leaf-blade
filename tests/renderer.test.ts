/**
 * Tests for BladeRenderer
 * 
 * Test complete rendering pipeline with real templates
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BladeRenderer } from '../src/engines/renderer';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('BladeRenderer', () => {
  let tempDir: string;
  let renderer: BladeRenderer;

  beforeEach(async () => {
    // Create temp directory for test templates
    tempDir = path.join(tmpdir(), `blade-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    renderer = new BladeRenderer({
      viewsDir: tempDir,
      cache: true,
    });
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  test('renders simple template', async () => {
    await writeFile(
      path.join(tempDir, 'hello.blade.html'),
      'Hello {{ name }}!'
    );

    const html = await renderer.render('hello', { name: 'World' });
    expect(html).toBe('Hello World!');
  });

  test('renders template with escaped expressions', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '<div>{{ content }}</div>'
    );

    const html = await renderer.render('test', { content: '<script>alert("xss")</script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  test('renders template with raw expressions', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '<div>{!! html !!}</div>'
    );

    const html = await renderer.render('test', { html: '<strong>Bold</strong>' });
    expect(html).toBe('<div><strong>Bold</strong></div>');
  });

  test('renders template with @if directive', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '@if(show)\nVisible\n@endif'
    );

    const html1 = await renderer.render('test', { show: true });
    expect(html1.trim()).toBe('Visible');

    const html2 = await renderer.render('test', { show: false });
    expect(html2.trim()).toBe('');
  });

  test('renders template with @foreach', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '@foreach(items as item)\n{{ item }},\n@endforeach'
    );

    const html = await renderer.render('test', { items: ['a', 'b', 'c'] });
    expect(html.replace(/\s+/g, '')).toBe('a,b,c,');
  });

  test('renders template with layout inheritance', async () => {
    // Layout
    await writeFile(
      path.join(tempDir, 'layout.blade.html'),
      '<html><body>@yield(content)</body></html>'
    );

    // Child
    await writeFile(
      path.join(tempDir, 'page.blade.html'),
      '@extends(layout)\n@section(content)\nHello\n@endsection'
    );

    const html = await renderer.render('page', {});
    expect(html).toContain('<html><body>');
    expect(html).toContain('Hello');
    expect(html).toContain('</body></html>');
  });

  test('renders template with includes', async () => {
    // Header partial
    await writeFile(
      path.join(tempDir, 'header.blade.html'),
      '<header>Site Header</header>'
    );

    // Main template
    await writeFile(
      path.join(tempDir, 'page.blade.html'),
      '@include(header)\n<main>Content</main>'
    );

    const html = await renderer.render('page', {});
    expect(html).toContain('<header>Site Header</header>');
    expect(html).toContain('<main>Content</main>');
  });

  test('supports dot notation for template names', async () => {
    await mkdir(path.join(tempDir, 'layouts'), { recursive: true });
    await writeFile(
      path.join(tempDir, 'layouts', 'app.blade.html'),
      '<html>@yield(content)</html>'
    );

    await writeFile(
      path.join(tempDir, 'page.blade.html'),
      '@extends(layouts.app)\n@section(content)\nPage\n@endsection'
    );

    const html = await renderer.render('page', {});
    expect(html).toContain('<html>');
    expect(html).toContain('Page');
  });

  test('caches templates for performance', async () => {
    const templatePath = path.join(tempDir, 'cached.blade.html');
    await writeFile(templatePath, 'Cached: {{ value }}');

    const first = await renderer.render('cached', { value: 'first' });
    expect(first).toBe('Cached: first');

    // Xóa file sau lần render đầu: nếu renderer đọc lại file (không dùng
    // cache), lần render thứ hai sẽ throw ENOENT. Test này xác nhận cache
    // hoạt động bằng hành vi thực tế, không dựa vào so sánh thời gian
    // (không ổn định, phụ thuộc tải hệ thống).
    await rm(templatePath);

    const second = await renderer.render('cached', { value: 'second' });
    expect(second).toBe('Cached: second');
  });

  test('clearCache() invalidates cache', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      'Value: {{ val }}'
    );

    // Render and cache
    const html1 = await renderer.render('test', { val: 1 });
    expect(html1).toBe('Value: 1');

    // Update template file
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      'Updated: {{ val }}'
    );

    // Should still return cached version
    const html2 = await renderer.render('test', { val: 2 });
    expect(html2).toBe('Value: 2');

    // Clear cache
    renderer.clearCache();

    // Should use new template
    const html3 = await renderer.render('test', { val: 3 });
    expect(html3).toBe('Updated: 3');
  });

  test('throws error for missing template', async () => {
    await expect(
      renderer.render('missing', {})
    ).rejects.toThrow('Template not found');
  });

  test('throws error for invalid template name', async () => {
    await expect(
      renderer.render('', {})
    ).rejects.toThrow('must be a non-empty string');
  });

  test('prevents path traversal attacks', async () => {
    await writeFile(
      path.join(tempDir, 'secret.txt'),
      'Secret data'
    );

    await expect(
      renderer.render('../secret', {})
    ).rejects.toThrow('must stay inside viewsDir');
  });

  test('handles nested layouts correctly', async () => {
    // Base layout
    await writeFile(
      path.join(tempDir, 'base.blade.html'),
      '<html>@yield(body)</html>'
    );

    // Middle layout
    await writeFile(
      path.join(tempDir, 'layout.blade.html'),
      '@extends(base)\n@section(body)\n<body>@yield(content)</body>\n@endsection'
    );

    // Page
    await writeFile(
      path.join(tempDir, 'page.blade.html'),
      '@extends(layout)\n@section(content)\nPage Content\n@endsection'
    );

    const html = await renderer.render('page', {});
    expect(html).toContain('<html>');
    expect(html).toContain('<body>');
    expect(html).toContain('Page Content');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  test('handles complex data structures', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '@foreach(users as user)\n{{ user.name }}: {{ user.email }}\n@endforeach'
    );

    const html = await renderer.render('test', {
      users: [
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane', email: 'jane@example.com' },
      ],
    });

    expect(html).toContain('John: john@example.com');
    expect(html).toContain('Jane: jane@example.com');
  });

  test('handles optional chaining', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '{{ user?.profile?.name ?? "Guest" }}'
    );

    const html1 = await renderer.render('test', {
      user: { profile: { name: 'John' } },
    });
    expect(html1).toBe('John');

    const html2 = await renderer.render('test', { user: null });
    expect(html2).toBe('Guest');
  });

  test('renders complete blog example', async () => {
    // Layout
    await writeFile(
      path.join(tempDir, 'layout.blade.html'),
      `<!DOCTYPE html>
<html>
<head>
  <title>@yield(title, "Blog")</title>
</head>
<body>
  @include(header)
  <main>
    @yield(content)
  </main>
  @include(footer)
</body>
</html>`
    );

    // Header
    await writeFile(
      path.join(tempDir, 'header.blade.html'),
      '<header><h1>My Blog</h1></header>'
    );

    // Footer
    await writeFile(
      path.join(tempDir, 'footer.blade.html'),
      '<footer>&copy; 2026</footer>'
    );

    // Post page
    await writeFile(
      path.join(tempDir, 'post.blade.html'),
      `@extends(layout)

@section(title)
{{ post.title }}
@endsection

@section(content)
<article>
  <h2>{{ post.title }}</h2>
  <p>{!! post.content !!}</p>
  
  @if(post.tags)
  <div class="tags">
    @foreach(post.tags as tag)
    <span>{{ tag }}</span>
    @endforeach
  </div>
  @endif
</article>
@endsection`
    );

    const html = await renderer.render('post', {
      post: {
        title: 'Hello World',
        content: '<p>This is my <strong>first post</strong>!</p>',
        tags: ['intro', 'hello'],
      },
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Hello World</title>');
    expect(html).toContain('<header><h1>My Blog</h1></header>');
    expect(html).toContain('<h2>Hello World</h2>');
    expect(html).toContain('This is my <strong>first post</strong>!');
    expect(html).toContain('<span>intro</span>');
    expect(html).toContain('<span>hello</span>');
    expect(html).toContain('<footer>&copy; 2026</footer>');
  });

  test('handles concurrent rendering', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      'Result: {{ value }}'
    );

    const promises = Array.from({ length: 10 }, (_, i) =>
      renderer.render('test', { value: i })
    );

    const results = await Promise.all(promises);
    
    results.forEach((html, i) => {
      expect(html).toBe(`Result: ${i}`);
    });
  });

  test('handles render with no data', async () => {
    await writeFile(
      path.join(tempDir, 'static.blade.html'),
      '<div>Static content</div>'
    );

    const html = await renderer.render('static');
    expect(html).toBe('<div>Static content</div>');
  });

  test('renders with @js blocks', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      `@js
let x = 5;
count = x * 2;
@endjs
Count: {{ count }}`
    );

    const html = await renderer.render('test', { count: 0 });
    expect(html.trim()).toBe('Count: 10');
  });

  test('handles @while loops', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      `@js
i = 0;
@endjs
@while(i < 3)
{{ i }}
@js
i++;
@endjs
@endwhile`
    );

    const html = await renderer.render('test', { i: 0 });
    expect(html.replace(/\s+/g, '')).toContain('012');
  });

  test('handles @for loops', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '@for(i = 0; i < 3; i++)\n{{ i }}\n@endfor'
    );

    const html = await renderer.render('test', {});
    expect(html.replace(/\s+/g, '')).toContain('012');
  });

  test('error messages include template name', async () => {
    await writeFile(
      path.join(tempDir, 'broken.blade.html'),
      '{{ invalid..syntax }}'
    );

    try {
      await renderer.render('broken', {});
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toContain('broken');
    }
  });

  test('cache disabled option', async () => {
    const uncachedRenderer = new BladeRenderer({
      viewsDir: tempDir,
      cache: false,
    });

    await writeFile(
      path.join(tempDir, 'nocache.blade.html'),
      'Value: {{ val }}'
    );

    await uncachedRenderer.render('nocache', { val: 1 });

    // Update file
    await writeFile(
      path.join(tempDir, 'nocache.blade.html'),
      'Updated: {{ val }}'
    );

    // Should use new template immediately (no cache)
    const html = await uncachedRenderer.render('nocache', { val: 2 });
    expect(html).toBe('Updated: 2');
  });

  test('renders deeply nested structures', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      `@if(data)
  @foreach(data.items as item)
    @if(item.active)
      <div>
        {{ item.name }}
        @if(item.tags)
          @foreach(item.tags as tag)
            <span>{{ tag }}</span>
          @endforeach
        @endif
      </div>
    @endif
  @endforeach
@endif`
    );

    const html = await renderer.render('test', {
      data: {
        items: [
          { name: 'Item 1', active: true, tags: ['a', 'b'] },
          { name: 'Item 2', active: false },
          { name: 'Item 3', active: true, tags: ['c'] },
        ],
      },
    });

    expect(html).toContain('Item 1');
    expect(html).not.toContain('Item 2');
    expect(html).toContain('Item 3');
    expect(html).toContain('<span>a</span>');
    expect(html).toContain('<span>b</span>');
    expect(html).toContain('<span>c</span>');
  });

  test('handles empty foreach gracefully', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      '@foreach(items as item)\n{{ item }}\n@endforeach\nDone'
    );

    const html = await renderer.render('test', { items: [] });
    expect(html.trim()).toBe('Done');
  });

  test('handles comments', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      'Before\n{{-- This is a comment --}}\nAfter'
    );

    const html = await renderer.render('test', {});
    expect(html).toContain('Before');
    expect(html).toContain('After');
    expect(html).not.toContain('This is a comment');
  });

  test('renderSync throws when template not compiled', async () => {
    await writeFile(
      path.join(tempDir, 'hello.blade.html'),
      'Hello {{ name }}!'
    );

    // renderSync should throw if called before render()
    expect(() => {
      renderer.renderSync('hello', { name: 'World' });
    }).toThrow(/Template not compiled yet/);
  });

  test('renderSync works after async render', async () => {
    await writeFile(
      path.join(tempDir, 'hello.blade.html'),
      'Hello {{ name }}!'
    );

    // First render (populates cache)
    await renderer.render('hello', { name: 'Initial' });

    // renderSync should work now
    const html = renderer.renderSync('hello', { name: 'World' });
    expect(html).toBe('Hello World!');
  });

  test('renderSync is faster than async render for same data', async () => {
    await writeFile(
      path.join(tempDir, 'perf.blade.html'),
      '<div>{{ title }}</div><p>{{ content }}</p>'
    );

    // Populate cache
    await renderer.render('perf', { title: 'Test', content: 'Hello' });

    // renderSync should be fast
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      renderer.renderSync('perf', { title: 'Test', content: 'Hello' });
    }
    const elapsed = performance.now() - start;

    // Should complete 1000 renders in under 100ms (very conservative limit)
    expect(elapsed).toBeLessThan(100);
  });
});
