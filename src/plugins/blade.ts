/**
 * Blade Plugin for Elysia
 * Template engine giống Laravel Blade
 */

import type { Elysia, Context } from "elysia";
import path from "node:path";
import { BladeRenderer } from "../engines/renderer.js";
import { minify } from "html-minifier-terser";

// Types
export interface BladeOptions {
  viewsDir?: string;
  cache?: boolean;
  /** @deprecated Reserved for backward compatibility. Blade only uses in-memory caches. */
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
