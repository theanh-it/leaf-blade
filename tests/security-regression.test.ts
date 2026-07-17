import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Elysia } from "elysia";
import { BladeCompiler } from "../src/engines/compiler";
import { BladeRenderer } from "../src/engines/renderer";
import { bladePlugin } from "../src/plugins/blade";

const testRoot = mkdtempSync(join(tmpdir(), "leaf-blade-security-"));
const viewsDir = join(testRoot, "views");
const cacheDir = join(testRoot, "cache");

function writeView(relativePath: string, content: string): string {
  const fullPath = join(viewsDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

function createRenderer(cache: boolean): BladeRenderer {
  return new BladeRenderer({ viewsDir, cacheDir, cache });
}

beforeAll(() => {
  mkdirSync(viewsDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("security regressions", () => {
  test("escapes {{ ... }} output and leaves {!! ... !!} output raw", async () => {
    writeView(
      "escaping.blade.html",
      "escaped=[{{ value }}]\nraw=[{!! value !!}]"
    );
    const payload = `<script>alert("x")</script>&'"`;

    const html = await createRenderer(false).render("escaping", { value: payload });

    expect(html).toContain(
      "escaped=[&lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt;&amp;&#39;&#34;]"
    );
    expect(html).toContain(`raw=[${payload}]`);
  });

  test("removes Blade comments before compiling expressions inside them", async () => {
    writeView(
      "comments.blade.html",
      "before|{{-- {{ missingSecret }} {!! otherMissing !!} <script>do-not-leak</script> --}}|after"
    );

    const html = await createRenderer(false).render("comments");

    expect(html).toContain("before|");
    expect(html).toContain("|after");
    expect(html).not.toContain("missingSecret");
    expect(html).not.toContain("otherMissing");
    expect(html).not.toContain("do-not-leak");
    expect(html).not.toContain("<script>");
  });

  test("does not evaluate rendered include output as a second EJS template", async () => {
    writeView(
      "partials/payload.blade.html",
      "partial-before{!! payload !!}partial-after"
    );
    writeView(
      "include-payload.blade.html",
      "parent-before@include('partials.payload')parent-after"
    );
    const payload = "<%= 6 * 7 %>";

    const html = await createRenderer(false).render("include-payload", { payload });

    expect(html).toBe(
      `parent-beforepartial-before${payload}partial-afterparent-after`
    );
    expect(html).not.toContain("partial-before42partial-after");
  });

  test("does not reuse a rendered include across different render data", async () => {
    writeView("partials/profile.blade.html", "private-user={{ user }}");
    writeView("include-profile.blade.html", "@include('partials.profile')");
    const renderer = createRenderer(true);

    const aliceHtml = await renderer.render("include-profile", {
      user: "alice-private",
    });
    const bobHtml = await renderer.render("include-profile", {
      user: "bob-private",
    });

    expect(aliceHtml).toBe("private-user=alice-private");
    expect(bobHtml).toBe("private-user=bob-private");
    expect(bobHtml).not.toContain("alice-private");
  });

  test("invalidates cached include content when the partial changes", async () => {
    const partialPath = writeView(
      "partials/version.blade.html",
      "old={{ user }}"
    );
    const originalStats = statSync(partialPath);
    writeView("include-version.blade.html", "@include('partials.version')");
    const renderer = createRenderer(true);

    const oldHtml = await renderer.render("include-version", { user: "Ada" });
    const replacementPath = join(dirname(partialPath), "version-next.blade.html");
    writeFileSync(replacementPath, "new={{ user }}", "utf8");
    utimesSync(replacementPath, originalStats.atime, originalStats.mtime);
    renameSync(replacementPath, partialPath);
    const newHtml = await renderer.render("include-version", { user: "Ada" });

    expect(oldHtml).toBe("old=Ada");
    expect(newHtml).toBe("new=Ada");
  });

  test("does not collide minified output for equal-length private data after a shared prefix", async () => {
    const sharedPrefix = "x".repeat(1_200);
    writeView(
      "minified-private.blade.html",
      `<!doctype html><html><body><div>${sharedPrefix}</div><p>{{ privateValue }}</p></body></html>`
    );

    const app = new Elysia()
      .use(
        bladePlugin({
          viewsDir,
          cacheDir,
          cache: true,
          minify: true,
        })
      )
      .get("/", async (context: any) => {
        return context.blade.render("minified-private", {
          privateValue: context.query.value,
        });
      });

    const firstResponse = await app.handle(
      new Request("http://localhost/?value=ALICE-SECRET")
    );
    const secondResponse = await app.handle(
      new Request("http://localhost/?value=BOBBY-SECRET")
    );
    const firstHtml = await firstResponse.text();
    const secondHtml = await secondResponse.text();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstHtml).toContain("ALICE-SECRET");
    expect(secondHtml).toContain("BOBBY-SECRET");
    expect(secondHtml).not.toContain("ALICE-SECRET");
  });

  test("rejects traversal for top-level templates and includes", async () => {
    writeFileSync(
      join(testRoot, "outside.blade.html"),
      "outside-secret",
      "utf8"
    );
    writeView(
      "include-traversal.blade.html",
      "@include('../outside')"
    );
    const renderer = createRenderer(false);

    await expect(renderer.render("../outside")).rejects.toThrow();
    await expect(renderer.render("include-traversal")).rejects.toThrow();
  });

  test("evaluates include data inside the runtime loop scope", async () => {
    writeView(
      "partials/runtime-user.blade.html",
      "<span>{{ user.name }}:{{ enabled }}</span>"
    );
    writeView(
      "runtime-loop.blade.html",
      "@foreach(users as user)@include('partials.runtime-user', { user: user, enabled: true })@endforeach"
    );

    const html = await createRenderer(false).render("runtime-loop", {
      users: [{ name: "Ada" }, { name: "Grace" }],
    });

    expect(html).toBe("<span>Ada:true</span><span>Grace:true</span>");
  });

  test("does not evaluate include expressions in a false conditional branch", async () => {
    writeView("partials/lazy.blade.html", "{{ missingValue }}");
    writeView(
      "conditional-include.blade.html",
      "@if(show)@include('partials.lazy')@endif"
    );

    const html = await createRenderer(false).render("conditional-include", {
      show: false,
    });

    expect(html).toBe("");
  });

  test("rejects a template symlink that resolves outside viewsDir", async () => {
    if (process.platform === "win32") return;

    const outsidePath = join(testRoot, "symlink-secret.blade.html");
    writeFileSync(outsidePath, "symlink-secret", "utf8");
    symlinkSync(outsidePath, join(viewsDir, "linked-secret.blade.html"));

    await expect(
      createRenderer(false).render("linked-secret")
    ).rejects.toThrow("inside viewsDir");
  });

  test("invalidates source cache when an in-root symlink is retargeted", async () => {
    if (process.platform === "win32") return;

    const firstTarget = writeView("targets/first.blade.html", "FIRST");
    const secondTarget = writeView("targets/other.blade.html", "OTHER");
    const sharedTime = new Date(Date.now() - 10_000);
    utimesSync(firstTarget, sharedTime, sharedTime);
    utimesSync(secondTarget, sharedTime, sharedTime);
    const linkPath = join(viewsDir, "switch.blade.html");
    symlinkSync(firstTarget, linkPath);
    const renderer = createRenderer(true);

    expect(await renderer.render("switch")).toBe("FIRST");

    unlinkSync(linkPath);
    symlinkSync(secondTarget, linkPath);
    expect(await renderer.render("switch")).toBe("OTHER");
  });

  test("rejects an outside symlink target after the source cache is primed", async () => {
    if (process.platform === "win32") return;

    const safeTarget = writeView("targets/cached-safe.blade.html", "SAFE!!");
    const outsideTarget = join(testRoot, "cached-secret.blade.html");
    writeFileSync(outsideTarget, "SECRET", "utf8");
    const sharedTime = new Date(Date.now() - 10_000);
    utimesSync(safeTarget, sharedTime, sharedTime);
    utimesSync(outsideTarget, sharedTime, sharedTime);
    const linkPath = join(viewsDir, "cached-link.blade.html");
    symlinkSync(safeTarget, linkPath);
    const renderer = createRenderer(true);

    expect(await renderer.render("cached-link")).toBe("SAFE!!");

    unlinkSync(linkPath);
    symlinkSync(outsideTarget, linkPath);
    await expect(renderer.render("cached-link")).rejects.toThrow(
      "inside viewsDir"
    );
  });

  test("rejects circular include composition", async () => {
    writeView("cycles/a.blade.html", "@include('cycles.b')");
    writeView("cycles/b.blade.html", "@include('cycles.a')");

    await expect(createRenderer(false).render("cycles.a")).rejects.toThrow(
      "Circular template composition"
    );
  });

  test("does not reuse compiled output for known hash-collision strings", () => {
    const compiler = new BladeCompiler({ viewsDir, cacheDir, cache: true });

    expect(compiler.compile("Aa", "collision.blade.html")).toBe("Aa");
    expect(compiler.compile("BB", "collision.blade.html")).toBe("BB");
  });

  test("keeps cacheDir compatible without creating a disk cache", () => {
    const unusedCacheDir = join(testRoot, "deprecated-cache-dir");
    expect(existsSync(unusedCacheDir)).toBe(false);

    new BladeRenderer({
      viewsDir,
      cache: false,
      cacheDir: unusedCacheDir,
    });

    expect(existsSync(unusedCacheDir)).toBe(false);
  });
});
