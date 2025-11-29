/**
 * Simple Template Renderer
 * Thay thế EJS với renderer tự viết, không phụ thuộc EJS
 */

export class SimpleRenderer {
  /**
   * Render template string với data
   * Hỗ trợ: <%= var %>, <%- var %>, <% code %>
   */
  static render(template: string, data: Record<string, any> = {}): string {
    // Escape function để tránh XSS
    const escape = (str: any): string => {
      if (str == null) return "";
      const s = String(str);
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };

    // Tạo context với data và helper functions
    const context = {
      ...data,
      escape,
    };

    // Build function body
    let code = "let output = [];\n";
    code += "with(context) {\n";

    // Parse template
    let cursor = 0;
    const regex = /<%([\s\S]*?)%>/g;
    let match;

    while ((match = regex.exec(template)) !== null) {
      // Add text before tag
      if (match.index > cursor) {
        const text = template.substring(cursor, match.index);
        code += `output.push(${JSON.stringify(text)});\n`;
      }

      const content = match[1].trim();

      // <%= var %> - escaped output
      if (content.startsWith("=")) {
        const expr = content.substring(1).trim();
        code += `output.push(escape(${expr}));\n`;
      }
      // <%- var %> - raw output
      else if (content.startsWith("-")) {
        const expr = content.substring(1).trim();
        code += `output.push(String(${expr} || ''));\n`;
      }
      // <% code %> - execute code
      else {
        code += `${content}\n`;
      }

      cursor = match.index + match[0].length;
    }

    // Add remaining text
    if (cursor < template.length) {
      const text = template.substring(cursor);
      code += `output.push(${JSON.stringify(text)});\n`;
    }

    code += "}\n";
    code += "return output.join('');";

    // Execute
    try {
      const renderFunction = new Function("context", code);
      return renderFunction(context);
    } catch (error: any) {
      throw new Error(`Template render error: ${error.message}\nCode: ${code}`);
    }
  }
}

