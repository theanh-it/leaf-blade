/**
 * Blade Plugin for Elysia
 * Template engine giống Laravel Blade
 */

import type { Elysia, Context } from "elysia";
import path from "path";
import { BladeRenderer } from "../engines/renderer";
import { minify } from "html-minifier-terser";

// Types
export interface BladeOptions {
  viewsDir?: string;
  cache?: boolean;
  cacheDir?: string;
  minify?: boolean;
}

export interface BladeContextExtensions {
  vite?: {
    main: string;
    css: string;
  };
  status: <T = any>(code: number, data?: T) => T;
  blade?: {
    render: (template: string, data?: Record<string, any>) => Promise<string>;
  };
}

export type BladeContext = Context & BladeContextExtensions;

export interface BladeViewData {
  [key: string]: any;
  title?: string;
  description?: string;
  lang?: string;
}

export const bladePlugin = (options: BladeOptions = {}) => {
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

  // Create Blade renderer
  const renderer = new BladeRenderer({
    viewsDir,
    cache,
    cacheDir: options.cacheDir,
  });

  // Cache for minified output (cache based on rendered HTML hash, not data)
  // Note: Minification is deterministic, so we can cache based on HTML content
  const minifiedCache = new Map<string, string>();

  return (app: Elysia) => {
    return app.derive(() => {
      /**
       * Render Blade template
       */
      const render = async (
        template: string,
        data: Record<string, any> = {}
      ) => {
        let html = await renderer.render(template, data);

        // Minify HTML nếu được bật
        if (shouldMinify) {
          // Generate cache key based on HTML content hash
          // Simple hash for cache key (for production, consider crypto hash)
          let hash = 0;
          const htmlPreview = html.substring(0, 1000); // Use first 1000 chars for hash
          for (let i = 0; i < htmlPreview.length; i++) {
            const char = htmlPreview.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const cacheKey = `${template}:${hash.toString(36)}:${html.length}`;

          // Check minified cache
          if (cache && minifiedCache.has(cacheKey)) {
            return minifiedCache.get(cacheKey)!;
          }

          // Minify
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

          // Cache minified output
          if (cache) {
            minifiedCache.set(cacheKey, html);
            // Limit cache size
            if (minifiedCache.size > 500) {
              const firstKey = minifiedCache.keys().next().value;
              if (firstKey) {
                minifiedCache.delete(firstKey);
              }
            }
          }
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
  const vite = (ctx as BladeContext).vite || { main: "", css: "" };

  // Extract options từ data
  const {
    title = "Leaf App",
    description = "Ứng dụng Leaf với SSR và Vue 3",
    lang = "vi",
    ...restData
  } = data;

  // Render Blade template
  const html = await (ctx as any).blade.render(template, {
    ...restData,
    // Page metadata
    title,
    description,
    // Assets
    vite,
    lang,
    js: vite.main,
    css: vite.css,
  });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

