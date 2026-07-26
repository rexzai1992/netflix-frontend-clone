import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build emits the public and admin entry points", async () => {
  await access("dist/index.html");
  await access("dist/user_dashboard/browse.html");
  await access("dist/admin/index.html");
});

test("build does not package large videos as static assets", async () => {
  await assert.rejects(access("dist/images/movies/videos/Murder Mystery - Trailer - Netflix.mp4"));
});

test("deployed catalog is API-driven", async () => {
  const html = await readFile("dist/user_dashboard/browse.html", "utf8");
  assert.match(html, /content\/catalog\.js/);
  assert.match(html, /data-view="home"/);
  assert.doesNotMatch(html, /Never Have I Ever - Official Trailer/);
});
