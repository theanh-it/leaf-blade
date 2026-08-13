/**
 * CompiledBlade - High-performance Blade renderer using generated functions.
 *
 * Instead of interpreting an ops array, this compiles templates directly to
 * optimized JavaScript functions.
 *
 * Usage:
 * ```js
 * import { CompiledBlade } from 'leaf-blade';
 *
 * const blade = new CompiledBlade({ viewsDir: './views' });
 * const html = await blade.render('template.blade.php', { name: 'World' });
 * ```
 */

import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { BladeCompiler } from './parser/compiler.js';
import {
  generateRenderFunction,
  wrapRenderFunction,
} from './runtime/function-codegen-v2.js';

export interface CompiledBladeOptions {
  /**
   * Directory containing template files.
   */
  viewsDir: string;

  /**
   * Enable template caching.
   * @default true
   */
  cache?: boolean;

  /**
   * Enable security features.
   * @default true
   */
  security?: boolean;
}

export class CompiledBlade {
  private viewsDir: string;
  private cache: boolean;
  private compiledCache = new Map<string, (scope: Record<string, any>) => string>();

  constructor(options: CompiledBladeOptions) {
    if (!options.viewsDir) {
      throw new Error('CompiledBlade: viewsDir is required');
    }
    this.viewsDir = path.resolve(options.viewsDir);
    this.cache = options.cache ?? true;
  }

  /**
   * Render a template file.
   */
  async render(template: string, data: Record<string, any> = {}): Promise<string> {
    const templatePath = await this.resolveTemplate(template);

    // Check cache
    if (this.cache && this.compiledCache.has(templatePath)) {
      return this.compiledCache.get(templatePath)!(data);
    }

    // Load and compile
    const source = await this.loadTemplate(templatePath);
    const fn = this.compile(source);

    if (this.cache) {
      this.compiledCache.set(templatePath, fn);
    }

    return fn(data);
  }

  /**
   * Render a string template directly.
   */
  renderString(template: string, data: Record<string, any> = {}): string {
    // Use template string directly as key (faster than hashing)
    // For very long templates, this uses more memory but is much faster
    if (this.cache && this.compiledCache.has(template)) {
      return this.compiledCache.get(template)!(data);
    }

    const fn = this.compile(template);

    if (this.cache) {
      this.compiledCache.set(template, fn);
    }

    return fn(data);
  }

  /**
   * Compile template source to a render function.
   */
  compile(source: string): (scope: Record<string, any>) => string {
    // Parse to AST
    const compiler = new BladeCompiler({ viewsDir: this.viewsDir });
    const ast = compiler.parse(source);

    // Generate function code
    const bodyCode = generateRenderFunction(ast);
    const wrappedCode = wrapRenderFunction(bodyCode);

    // Create function (this is the "compilation" step - happens once)
    // eslint-disable-next-line no-new-func
    return new Function('return ' + wrappedCode)() as (scope: Record<string, any>) => string;
  }

  /**
   * Resolve template path relative to viewsDir.
   */
  private async resolveTemplate(template: string): Promise<string> {
    // If already absolute path
    if (path.isAbsolute(template)) {
      return realpath(template);
    }

    // Try with .blade.php extension
    const withExt = template.endsWith('.blade.php') ? template : `${template}.blade.php`;
    const fullPath = path.join(this.viewsDir, withExt);

    try {
      return await realpath(fullPath);
    } catch {
      // Try without extension
      if (template.endsWith('.blade.php')) {
        try {
          return await realpath(template);
        } catch {
          throw new Error(`CompiledBlade: Template not found: ${template}`);
        }
      }
      throw new Error(`CompiledBlade: Template not found: ${template}`);
    }
  }

  /**
   * Load template source from file.
   */
  private async loadTemplate(templatePath: string): Promise<string> {
    const file = await open(templatePath);
    try {
      const content = await file.readFile('utf-8');
      return content;
    } finally {
      await file.close();
    }
  }

  /**
   * Clear compiled template cache.
   */
  clearCache(): void {
    this.compiledCache.clear();
  }
}
