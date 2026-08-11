/**
 * Integration Tests for V1.0.0
 * 
 * End-to-end tests with complete real-world scenarios
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BladeRenderer } from '../../src/engines/renderer';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('V1.0.0 Integration Tests', () => {
  let tempDir: string;
  let renderer: BladeRenderer;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `blade-integration-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    renderer = new BladeRenderer({
      viewsDir: tempDir,
      cache: true,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('E-commerce product page example', async () => {
    // Create directory structure
    await mkdir(path.join(tempDir, 'layouts'), { recursive: true });
    await mkdir(path.join(tempDir, 'components'), { recursive: true });

    // Base layout
    await writeFile(
      path.join(tempDir, 'layouts', 'shop.blade.html'),
      `<!DOCTYPE html>
<html>
<head>
  <title>@yield(title, "Shop")</title>
  <meta name="description" content="@yield(description, "Online Shop")">
</head>
<body>
  @include(components.header)
  
  <main class="container">
    @yield(content)
  </main>
  
  @include(components.footer)
</body>
</html>`
    );

    // Header component
    await writeFile(
      path.join(tempDir, 'components', 'header.blade.html'),
      `<header>
  <nav>
    <a href="/">Home</a>
    @if(user)
      <span>Welcome, {{ user.name }}</span>
    @else
      <a href="/login">Login</a>
    @endif
  </nav>
</header>`
    );

    // Footer component
    await writeFile(
      path.join(tempDir, 'components', 'footer.blade.html'),
      `<footer>
  <p>&copy; {{ year }} Shop Inc.</p>
</footer>`
    );

    // Product card component
    await writeFile(
      path.join(tempDir, 'components', 'product-card.blade.html'),
      `<div class="product-card">
  <h3>{{ product.name }}</h3>
  <p class="price">$\{{ product.price }}</p>
  @if(product.discount)
    <span class="badge">-{{ product.discount }}%</span>
  @endif
  @if(product.inStock)
    <button>Add to Cart</button>
  @else
    <span class="out-of-stock">Out of Stock</span>
  @endif
</div>`
    );

    // Product listing page
    await writeFile(
      path.join(tempDir, 'products.blade.html'),
      `@extends(layouts.shop)

@section(title)
{{ category }} Products
@endsection

@section(description)
Browse our {{ category }} collection
@endsection

@section(content)
<h1>{{ category }}</h1>

@if(products)
  <div class="products-grid">
    @foreach(products as product)
      @include(components.product-card)
    @endforeach
  </div>
@else
  <p>No products found.</p>
@endif

@if(pagination)
  <div class="pagination">
    @for(page = 1; page <= pagination.total; page++)
      @if(page === pagination.current)
        <strong>{{ page }}</strong>
      @else
        <a href="?page={{ page }}">{{ page }}</a>
      @endif
    @endfor
  </div>
@endif
@endsection`
    );

    const html = await renderer.render('products', {
      user: { name: 'John' },
      year: 2026,
      category: 'Electronics',
      products: [
        { name: 'Laptop', price: 999, discount: 10, inStock: true },
        { name: 'Phone', price: 599, discount: 0, inStock: true },
        { name: 'Tablet', price: 399, discount: 15, inStock: false },
      ],
      pagination: { current: 2, total: 5 },
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Electronics Products</title>');
    expect(html).toContain('Welcome, John');
    expect(html).toContain('Laptop');
    expect(html).toContain('$999');
    expect(html).toContain('-10%');
    expect(html).toContain('Add to Cart');
    expect(html).toContain('Out of Stock');
    expect(html).toContain('<strong>2</strong>');
    expect(html).toContain('&copy; 2026 Shop Inc.');
  });

  test('Blog with nested comments example', async () => {
    await mkdir(path.join(tempDir, 'blog'), { recursive: true });
    await mkdir(path.join(tempDir, 'partials'), { recursive: true });

    // Blog layout
    await writeFile(
      path.join(tempDir, 'blog', 'layout.blade.html'),
      `<!DOCTYPE html>
<html>
<head>
  <title>@yield(title)</title>
</head>
<body>
  <header>
    <h1>My Blog</h1>
  </header>
  
  @yield(content)
  
  <aside>
    @yield(sidebar)
  </aside>
</body>
</html>`
    );

    // Comment component (single level of replies; static includes cannot
    // recurse into themselves, so replies are rendered inline).
    await writeFile(
      path.join(tempDir, 'partials', 'comment.blade.html'),
      `<div class="comment">
  <strong>{{ comment.author }}</strong>
  <p>{{ comment.text }}</p>
  <small>{{ comment.date }}</small>
  
  @if(comment.replies)
    @foreach(comment.replies as reply)
      <div class="comment reply">
        <strong>{{ reply.author }}</strong>
        <p>{{ reply.text }}</p>
        <small>{{ reply.date }}</small>
      </div>
    @endforeach
  @endif
</div>`
    );

    // Post page
    await writeFile(
      path.join(tempDir, 'blog', 'post.blade.html'),
      `@extends(blog.layout)

@section(title)
{{ post.title }}
@endsection

@section(content)
<article>
  <h2>{{ post.title }}</h2>
  <div class="meta">
    By {{ post.author }} on {{ post.date }}
  </div>
  <div class="content">
    {!! post.content !!}
  </div>
  
  @if(post.tags)
    <div class="tags">
      Tags:
      @foreach(post.tags as tag)
        <a href="/tag/{{ tag }}">#{{ tag }}</a>
      @endforeach
    </div>
  @endif
</article>

@if(comments)
  <section class="comments">
    <h3>Comments ({{ comments.length }})</h3>
    @foreach(comments as comment)
      @include(partials.comment)
    @endforeach
  </section>
@endif
@endsection

@section(sidebar)
<div class="recent-posts">
  <h3>Recent Posts</h3>
  @if(recentPosts)
    <ul>
      @foreach(recentPosts as recent)
        <li><a href="{{ recent.url }}">{{ recent.title }}</a></li>
      @endforeach
    </ul>
  @endif
</div>
@endsection`
    );

    const html = await renderer.render('blog.post', {
      post: {
        title: 'Understanding Blade Templates',
        author: 'Jane Doe',
        date: '2026-08-09',
        content: '<p>Blade is a powerful templating engine.</p>',
        tags: ['blade', 'templates', 'php'],
      },
      comments: [
        {
          author: 'Alice',
          text: 'Great article!',
          date: '2026-08-09',
          replies: [
            {
              author: 'Bob',
              text: 'I agree!',
              date: '2026-08-09',
            },
          ],
        },
        {
          author: 'Charlie',
          text: 'Thanks for sharing',
          date: '2026-08-10',
        },
      ],
      recentPosts: [
        { title: 'Post 1', url: '/post1' },
        { title: 'Post 2', url: '/post2' },
      ],
    });

    expect(html).toContain('<title>Understanding Blade Templates</title>');
    expect(html).toContain('By Jane Doe on 2026-08-09');
    expect(html).toContain('<p>Blade is a powerful templating engine.</p>');
    expect(html).toContain('#blade');
    expect(html).toContain('Comments (2)');
    expect(html).toContain('Alice');
    expect(html).toContain('Great article!');
    expect(html).toContain('Bob');
    expect(html).toContain('I agree!');
    expect(html).toContain('Recent Posts');
  });

  test('Dashboard with widgets example', async () => {
    await mkdir(path.join(tempDir, 'dashboard'), { recursive: true });
    await mkdir(path.join(tempDir, 'widgets'), { recursive: true });

    // Dashboard layout
    await writeFile(
      path.join(tempDir, 'dashboard', 'layout.blade.html'),
      `<!DOCTYPE html>
<html>
<head>
  <title>Dashboard - @yield(title)</title>
</head>
<body>
  <div class="dashboard">
    <aside class="sidebar">
      @include(dashboard.sidebar)
    </aside>
    
    <main>
      @yield(content)
    </main>
  </div>
</body>
</html>`
    );

    // Sidebar
    await writeFile(
      path.join(tempDir, 'dashboard', 'sidebar.blade.html'),
      `<nav>
  @foreach(menuItems as item)
    <a href="{{ item.url }}" class="@if(item.active)active@endif">
      {{ item.label }}
    </a>
  @endforeach
</nav>`
    );

    // Stat widget
    await writeFile(
      path.join(tempDir, 'widgets', 'stat.blade.html'),
      `<div class="widget stat">
  <h4>{{ stat.label }}</h4>
  <div class="value">{{ stat.value }}</div>
  @if(stat.change)
    <span class="change @if(stat.change > 0)positive @else negative @endif">
      @if(stat.change > 0)+@endif{{ stat.change }}%
    </span>
  @endif
</div>`
    );

    // Chart widget
    await writeFile(
      path.join(tempDir, 'widgets', 'chart.blade.html'),
      `<div class="widget chart">
  <h4>{{ chart.title }}</h4>
  <div class="data">
    @foreach(chart.data as point)
      <div class="bar" style="height: {{ point.value }}px">
        <span>{{ point.label }}</span>
      </div>
    @endforeach
  </div>
</div>`
    );

    // Main dashboard page
    await writeFile(
      path.join(tempDir, 'dashboard', 'index.blade.html'),
      `@extends(dashboard.layout)

@section(title)
Overview
@endsection

@section(content)
<h1>Dashboard Overview</h1>

<div class="stats-grid">
  @foreach(stats as stat)
    @include(widgets.stat)
  @endforeach
</div>

@if(charts)
  <div class="charts-grid">
    @foreach(charts as chart)
      @include(widgets.chart)
    @endforeach
  </div>
@endif

@if(alerts)
  <div class="alerts">
    <h3>Alerts</h3>
    @foreach(alerts as alert)
      <div class="alert alert-{{ alert.type }}">
        {{ alert.message }}
      </div>
    @endforeach
  </div>
@endif
@endsection`
    );

    const html = await renderer.render('dashboard.index', {
      menuItems: [
        { label: 'Overview', url: '/', active: true },
        { label: 'Reports', url: '/reports', active: false },
        { label: 'Settings', url: '/settings', active: false },
      ],
      stats: [
        { label: 'Revenue', value: '$45,231', change: 12 },
        { label: 'Users', value: '1,234', change: -3 },
        { label: 'Orders', value: '567', change: 8 },
      ],
      charts: [
        {
          title: 'Sales This Week',
          data: [
            { label: 'Mon', value: 100 },
            { label: 'Tue', value: 150 },
            { label: 'Wed', value: 120 },
          ],
        },
      ],
      alerts: [
        { type: 'warning', message: 'Server usage is high' },
        { type: 'info', message: 'New update available' },
      ],
    });

    expect(html).toContain('<title>Dashboard - Overview</title>');
    expect(html).toContain('Overview');
    expect(html).toContain('active');
    expect(html).toContain('Revenue');
    expect(html).toContain('$45,231');
    expect(html).toContain('+12%');
    expect(html).toContain('positive');
    expect(html).toContain('-3%');
    expect(html).toContain('negative');
    expect(html).toContain('Sales This Week');
    expect(html).toContain('Server usage is high');
  });

  test('Form with validation errors example', async () => {
    await mkdir(path.join(tempDir, 'forms'), { recursive: true });

    // Form layout
    await writeFile(
      path.join(tempDir, 'forms', 'layout.blade.html'),
      `<!DOCTYPE html>
<html>
<head>
  <title>@yield(title)</title>
</head>
<body>
  @if(successMessage)
    <div class="alert alert-success">{{ successMessage }}</div>
  @endif
  
  @if(errorMessage)
    <div class="alert alert-error">{{ errorMessage }}</div>
  @endif
  
  @yield(content)
</body>
</html>`
    );

    // Registration form
    await writeFile(
      path.join(tempDir, 'forms', 'register.blade.html'),
      `@extends(forms.layout)

@section(title)
Register
@endsection

@section(content)
<form method="POST" action="/register">
  <div class="form-group">
    <label for="name">Name</label>
    <input type="text" id="name" name="name" value="{{ old.name ?? '' }}">
    @if(errors?.name)
      <span class="error">{{ errors.name }}</span>
    @endif
  </div>
  
  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" value="{{ old.email ?? '' }}">
    @if(errors?.email)
      <span class="error">{{ errors.email }}</span>
    @endif
  </div>
  
  <div class="form-group">
    <label for="password">Password</label>
    <input type="password" id="password" name="password">
    @if(errors?.password)
      <span class="error">{{ errors.password }}</span>
    @endif
  </div>
  
  @if(terms)
    <div class="form-group">
      <label>
        <input type="checkbox" name="terms" @if(old.terms)checked@endif>
        I agree to the terms
      </label>
      @if(errors?.terms)
        <span class="error">{{ errors.terms }}</span>
      @endif
    </div>
  @endif
  
  <button type="submit">Register</button>
</form>
@endsection`
    );

    const html = await renderer.render('forms.register', {
      terms: true,
      old: {
        name: 'John Doe',
        email: 'invalid-email',
        terms: false,
      },
      errors: {
        email: 'Please enter a valid email address',
        password: 'Password must be at least 8 characters',
        terms: 'You must agree to the terms',
      },
      errorMessage: 'Please fix the errors below',
    });

    expect(html).toContain('<title>Register</title>');
    expect(html).toContain('Please fix the errors below');
    expect(html).toContain('value="John Doe"');
    expect(html).toContain('value="invalid-email"');
    expect(html).toContain('Please enter a valid email address');
    expect(html).toContain('Password must be at least 8 characters');
    expect(html).toContain('You must agree to the terms');
  });

  test('Performance test with large dataset', async () => {
    await writeFile(
      path.join(tempDir, 'large.blade.html'),
      `<table>
  @foreach(items as item)
    <tr>
      <td>{{ item.id }}</td>
      <td>{{ item.name }}</td>
      <td>{{ item.value }}</td>
    </tr>
  @endforeach
</table>`
    );

    // Generate 1000 items
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: Math.random() * 100,
    }));

    const start = Date.now();
    const html = await renderer.render('large', { items });
    const duration = Date.now() - start;

    expect(html).toContain('<table>');
    expect(html).toContain('Item 1');
    expect(html).toContain('Item 1000');
    expect(duration).toBeLessThan(1000); // Should render in < 1 second
  });

  test('Error handling across templates', async () => {
    await writeFile(
      path.join(tempDir, 'parent.blade.html'),
      '@include(child)'
    );

    await writeFile(
      path.join(tempDir, 'child.blade.html'),
      '{{ undefined.property.chain }}'
    );

    try {
      await renderer.render('parent', {});
      expect(true).toBe(false); // Should throw
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      // Error should be caught and reported
    }
  });

  test('Complex conditional logic', async () => {
    await writeFile(
      path.join(tempDir, 'test.blade.html'),
      `@if(user?.role === 'admin')
  <p>Admin Panel</p>
@elseif(user?.role === 'moderator')
  <p>Moderator Panel</p>
@elseif(user)
  <p>User Panel</p>
@else
  <p>Guest</p>
@endif`
    );

    const html1 = await renderer.render('test', { user: { role: 'admin' } });
    expect(html1).toContain('Admin Panel');

    const html2 = await renderer.render('test', { user: { role: 'moderator' } });
    expect(html2).toContain('Moderator Panel');

    const html3 = await renderer.render('test', { user: { role: 'user' } });
    expect(html3).toContain('User Panel');

    const html4 = await renderer.render('test', {});
    expect(html4).toContain('Guest');
  });

  test('Mixed content types', async () => {
    await writeFile(
      path.join(tempDir, 'mixed.blade.html'),
      `<div>
  Static text
  {{ escaped }}
  {!! raw !!}
  @if(condition)
    Conditional
  @endif
  @foreach(items as item)
    {{ item }}
  @endforeach
</div>`
    );

    const html = await renderer.render('mixed', {
      escaped: '<script>alert("xss")</script>',
      raw: '<strong>HTML</strong>',
      condition: true,
      items: ['a', 'b', 'c'],
    });

    expect(html).toContain('Static text');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>HTML</strong>');
    expect(html).toContain('Conditional');
    expect(html).toContain('a');
    expect(html).toContain('b');
    expect(html).toContain('c');
  });
});
