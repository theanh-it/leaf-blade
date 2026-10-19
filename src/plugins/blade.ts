/**
 * Blade Plugin for Elysia
 * Template engine giống Laravel Blade
 */

import type { Elysia, Context } from "elysia";
import path from "node:path";
import { BladeRenderer } from "../engines/renderer.js";
import { minify } from "html-minifier-terser";

/** Static SSR data. Nested objects are shared by reference and must be immutable. */
export type BladeSharedData = Readonly<Record<string, unknown>>;

/** Called once per application render, never cached by the plugin. */
export type BladeDataProvider<TContext extends Context = Context> = (
  ctx: TContext,
  template: string
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface BladeOptions<TContext extends Context = Context> {
  viewsDir?: string;
  cache?: boolean;
  /** Maximum entries in each template cache. @default 500 */
  maxCacheSize?: number;
  /** @deprecated Reserved for backward compatibility. Blade only uses in-memory caches. */
  cacheDir?: string;
  minify?: boolean;
  /**
   * Enable expression guards; templates must remain developer-owned code.
   * @default true
   */
  security?: boolean;
  /** Shallow snapshot taken at plugin creation; nested values must not be mutated. */
  shared?: BladeSharedData;
  /** Runs only when rendering. Errors propagate to the application. */
  resolveData?: BladeDataProvider<TContext>;
}

/** Vite assets supplied by the application; CSS may be a URL or a list of URLs. */
export interface BladeViteAssets {
  main: string;
  css: string | readonly string[];
  imports?: readonly string[];
}

export interface BladeContextExtensions {
  vite?: BladeViteAssets;
  status: Context["status"];
  blade?: {
    render: (template: string, data?: Record<string, unknown>) => Promise<string>;
  };
}

export type BladeContext = Context & BladeContextExtensions;

export interface BladeViewData {
  [key: string]: unknown;
  title?: string;
  description?: string;
  lang?: string;
}

/** Shallow assignment: undefined never erases a lower-priority value. */
function assignDefined(
  target: Record<string, unknown>,
  source: Readonly<Record<string, unknown>>
): void {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return value !== null && (typeof value === "object" || typeof value === "function")
    && typeof (value as PromiseLike<T>).then === "function";
}

export const bladePlugin = <TContext extends Context = Context>(
  options: BladeOptions<TContext> = {}
) => {
  if (options.shared !== undefined && (
    options.shared === null || typeof options.shared !== "object" || Array.isArray(options.shared)
  )) throw new TypeError("bladePlugin: shared must be a data object");
  if (options.resolveData !== undefined && typeof options.resolveData !== "function") {
    throw new TypeError("bladePlugin: resolveData must be a function");
  }
  // Validate and set viewsDir
  const viewsDir = options.viewsDir || path.join(process.cwd(), "views/blade");
  if (typeof viewsDir !== "string") {
    throw new Error("bladePlugin: viewsDir must be a string");
  }

  // Validate cache option
  const cache = options.cache ?? true;
  if (typeof cache !== "boolean") {
    throw new Error("bladePlugin: cache must be a boolean");
  }

  // Validate minify option
  const shouldMinify = options.minify ?? process.env.NODE_ENV === "production";
  if (typeof shouldMinify !== "boolean") {
    throw new Error("bladePlugin: minify must be a boolean");
  }

  // Snapshot static data once. A null prototype also keeps arbitrary data keys
  // (including __proto__) from invoking inherited setters during merging.
  const staticData: Record<string, unknown> = Object.assign(Object.create(null), {
    title: "Leaf App",
    description: "Ứng dụng Leaf với SSR và Vue 3",
    lang: "vi",
  });
  if (options.shared) assignDefined(staticData, options.shared);
  Object.freeze(staticData);
  const resolveData = options.resolveData;

  // Create Blade renderer
  const renderer = new BladeRenderer({
    viewsDir,
    cache,
    maxCacheSize: options.maxCacheSize,
    runtime: {
      security: options.security,
    },
  });

  return (app: Elysia) => {
    return app.derive((ctx) => {
      /**
       * Render Blade template
       */
      const render = async (
        template: string,
        data: Record<string, unknown> = {}
      ) => {
        // Only this request closure retains ctx. The shared renderer and its
        // template/AST caches never retain provider results or request data.
        const renderData: Record<string, unknown> = Object.assign(
          Object.create(null), staticData
        );
        if (resolveData) {
          // The application must install any extensions required by TContext
          // before rendering. They cannot be inferred from this plugin alone.
          const provided = resolveData(ctx as TContext, template);
          // A synchronous provider does not need an extra Promise continuation.
          const resolved = isPromiseLike(provided) ? await provided : provided;
          if (resolved === null || typeof resolved !== "object" || Array.isArray(resolved)) {
            throw new TypeError("bladePlugin: resolveData must return a data object");
          }
          assignDefined(renderData, resolved);
        }
        assignDefined(renderData, data);

        // Reserved keys always come from the current context, as in bladeView.
        const vite = (ctx as BladeContext).vite || { main: "", css: "" };
        renderData.vite = vite;
        renderData.js = vite.main;
        renderData.css = vite.css;

        let html = await renderer.render(template, renderData);

        // Minify HTML nếu được bật
        if (shouldMinify) {
          html = await minify(html, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true,
            minifyCSS: true,
            minifyJS: true,
          });
        }

        return html;
      };

      return {
        blade: {
          render,
        },
      };
    });
  };
};

/**
 * Blade View Helper
 * Render Blade templates (giống Laravel view())
 * 
 * @example
 * // Đơn giản nhất
 * return bladeView(ctx, 'home', { title: 'Home Page' });
 * 
 * // Với data
 * return bladeView(ctx, 'posts.show', {
 *   title: post.title,
 *   post: post
 * });
 */
export async function bladeView(
  ctx: BladeContext | Context,
  template: string,
  data: BladeViewData = {}
): Promise<Response> {
  const bladeCtx = ctx as BladeContext;

  // Check if blade plugin is registered
  if (!bladeCtx.blade) {
    throw new Error(
      "bladeView: Blade plugin not registered. " +
      "Make sure to .use(bladePlugin()) before using bladeView()."
    );
  }

  // Delegate unchanged: the plugin owns the single data/provider pipeline.
  const html = await bladeCtx.blade.render(template, data);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
