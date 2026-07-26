import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("build emits every public and admin entry point", async () => {
  for (const path of [
    "dist/index.html",
    "dist/login.html",
    "dist/signup.html",
    "dist/account/index.html",
    "dist/user_dashboard/browse.html",
    "dist/user_dashboard/movies.html",
    "dist/user_dashboard/tvshow.html",
    "dist/user_dashboard/latest.html",
    "dist/user_dashboard/mylist.html",
    "dist/user_dashboard/search.html",
    "dist/user_dashboard/single.html",
    "dist/admin/index.html",
  ]) {
    await access(path);
  }
});

test("deployed catalog is API-driven", async () => {
  const html = await readFile("dist/user_dashboard/browse.html", "utf8");
  assert.match(html, /content\/catalog\.js/);
  assert.match(html, /data-view="home"/);
});

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

test("no legacy branding, trademarks, or dead asset paths ship in dist", async () => {
  for await (const path of walk("dist")) {
    if (!/\.(html|css|js|svg)$/.test(path)) continue;
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /netflix/i, `${path} references Netflix`);
    assert.doesNotMatch(text, /(src|href)="\/(images|assets)\//, `${path} references deleted legacy assets`);
  }
});

test("no inline scripts or handlers (CSP: script-src 'self')", async () => {
  for await (const path of walk("dist")) {
    if (!path.endsWith(".html")) continue;
    const text = await readFile(path, "utf8");
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)/i, `${path} has an inline <script>`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=\s*["']/i, `${path} has inline event handlers`);
  }
});
