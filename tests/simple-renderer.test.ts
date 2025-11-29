import { test, expect } from "bun:test";
import { SimpleRenderer } from "../src/engines/simple-renderer";

// SimpleRenderer tests
{
  test("render plain text", () => {
    const template = "Hello World";
    const result = SimpleRenderer.render(template);
    expect(result).toBe("Hello World");
  });

  test("render escaped variable", () => {
    const template = "<%= name %>";
    const data = { name: "John" };
    const result = SimpleRenderer.render(template, data);
    expect(result).toBe("John");
  });

  test("escape HTML in variables", () => {
    const template = "<%= html %>";
    const data = { html: "<script>alert('xss')</script>" };
    const result = SimpleRenderer.render(template, data);
    expect(result).toBe("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  test("render raw variable", () => {
    const template = "<%- html %>";
    const data = { html: "<strong>Bold</strong>" };
    const result = SimpleRenderer.render(template, data);
    expect(result).toBe("<strong>Bold</strong>");
  });

  test("render with code block", () => {
    const template = "<% let sum = a + b; %>Result: <%= sum %>";
    const data = { a: 5, b: 3 };
    const result = SimpleRenderer.render(template, data);
    expect(result).toBe("Result: 8");
  });

  test("render with loop", () => {
    const template = "<% for(let i = 0; i < items.length; i++) { %>Item <%= i %>: <%= items[i] %><% } %>";
    const data = { items: ["A", "B", "C"] };
    const result = SimpleRenderer.render(template, data);
    expect(result).toBe("Item 0: AItem 1: BItem 2: C");
  });

  test("render with condition", () => {
    const template = "<% if (show) { %>Visible<% } else { %>Hidden<% } %>";
    const data1 = { show: true };
    const data2 = { show: false };
    expect(SimpleRenderer.render(template, data1)).toBe("Visible");
    expect(SimpleRenderer.render(template, data2)).toBe("Hidden");
  });

  test("handle null and undefined", () => {
    const template = "<%= value %>";
    expect(SimpleRenderer.render(template, { value: null })).toBe("");
    expect(SimpleRenderer.render(template, { value: undefined })).toBe("");
  });

  test("render complex template", () => {
    const template = `
      <h1><%= title %></h1>
      <ul>
        <% for(let i = 0; i < items.length; i++) { %>
          <li><%= items[i] %></li>
        <% } %>
      </ul>
    `;
    const data = {
      title: "My List",
      items: ["Item 1", "Item 2", "Item 3"],
    };
    const result = SimpleRenderer.render(template, data);
    expect(result).toContain("My List");
    expect(result).toContain("Item 1");
    expect(result).toContain("Item 2");
    expect(result).toContain("Item 3");
  });
}

