import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { after, before, test } from "node:test";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE = ".wrangler/test-state";
const ADMIN_PASSWORD = "test-admin-password";

let worker;

// Minimal cookie jar per logical client.
function client() {
  const cookies = new Map();
  return async function request(path, { method = "GET", body, headers = {}, raw = false } = {}) {
    const requestHeaders = { ...headers };
    if (cookies.size) {
      requestHeaders.cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    }
    if (body !== undefined && !(body instanceof Uint8Array)) {
      requestHeaders["content-type"] = "application/json";
      body = JSON.stringify(body);
    }
    const response = await fetch(`${BASE}${path}`, { method, body, headers: requestHeaders });
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (value) cookies.set(name.trim(), value);
      else cookies.delete(name.trim());
    }
    if (raw) return response;
    const data = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : await response.text();
    return { status: response.status, data, headers: response.headers };
  };
}

before(async () => {
  rmSync(STATE, { recursive: true, force: true });
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "streamflix", "--local", "--persist-to", STATE], {
    stdio: "ignore",
  });
  worker = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(PORT),
      "--persist-to",
      STATE,
      "--var",
      `ADMIN_PASSWORD:${ADMIN_PASSWORD}`,
      "--var",
      "SESSION_SECRET:test-session-secret-0123456789-0123456789",
      "--var",
      "PBKDF2_ITERATIONS:1000",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("wrangler dev did not become ready");
});

after(() => {
  worker?.kill("SIGTERM");
});

test("health and security headers", async () => {
  const response = await fetch(`${BASE}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("strict-transport-security"));
});

test("public catalog payload shape", async () => {
  const api = client();
  const { status, data } = await api("/api/content");
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.content));
  assert.ok(Array.isArray(data.collections));
  assert.ok(data.settings.site_name);
});

test("signup, session, csrf enforcement, my list, progress", async () => {
  const api = client();
  const email = `viewer-${Date.now()}@example.com`;

  const signup = await api("/api/auth/signup", { method: "POST", body: { email, password: "hunter2hunter2" } });
  assert.equal(signup.status, 201);
  const csrf = signup.data.csrf;
  assert.ok(csrf);

  const session = await api("/api/auth/session");
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.user.email, email);

  const duplicate = await api("/api/auth/signup", { method: "POST", body: { email, password: "hunter2hunter2" } });
  assert.equal(duplicate.status, 409);

  // Mutations without CSRF must fail.
  const noCsrf = await api("/api/me/progress/our-golden-night", {
    method: "PUT",
    body: { position: 10, duration: 100 },
  });
  assert.equal(noCsrf.status, 403);

  const progress = await api("/api/me/progress/our-golden-night", {
    method: "PUT",
    body: { position: 65, duration: 100 },
    headers: { "x-csrf-token": csrf },
  });
  assert.equal(progress.status, 200);

  const continueRow = await api("/api/me/continue");
  assert.equal(continueRow.data.items.length, 1);
  assert.equal(continueRow.data.items[0].id, "our-golden-night");

  const add = await api("/api/me/list/our-golden-night", { method: "PUT", headers: { "x-csrf-token": csrf } });
  assert.equal(add.status, 200);
  const list = await api("/api/me/list");
  assert.equal(list.data.items.length, 1);
  const remove = await api("/api/me/list/our-golden-night", {
    method: "DELETE",
    headers: { "x-csrf-token": csrf },
  });
  assert.equal(remove.status, 200);
});

test("subscription gating on video media", async () => {
  const admin = client();
  const login = await admin("/api/admin/login", { method: "POST", body: { password: ADMIN_PASSWORD } });
  assert.equal(login.status, 200);
  const adminCsrf = login.data.csrf;

  // Upload a tiny fake-but-valid mp4 (magic bytes: size box + 'ftyp').
  const bytes = new Uint8Array(64);
  bytes.set([0x00, 0x00, 0x00, 0x20], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4); // "ftypisom"
  const init = await admin("/api/admin/upload?action=init", {
    method: "POST",
    body: { contentId: "gate-test", kind: "video", contentType: "video/mp4", fileSize: bytes.length },
    headers: { "x-csrf-token": adminCsrf },
  });
  assert.equal(init.status, 200);
  const { key, uploadId } = init.data;
  const part = await admin(
    `/api/admin/upload?action=part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
    { method: "PUT", body: bytes, headers: { "x-csrf-token": adminCsrf } },
  );
  assert.equal(part.status, 200);
  const complete = await admin(
    `/api/admin/upload?action=complete&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
    { method: "POST", body: { parts: [part.data], duration: 1 }, headers: { "x-csrf-token": adminCsrf } },
  );
  assert.equal(complete.status, 200);

  const created = await admin("/api/admin/content", {
    method: "POST",
    body: { title: "Gate Test", type: "movie", video_key: key, published: true },
    headers: { "x-csrf-token": adminCsrf },
  });
  assert.equal(created.status, 201);

  // Anonymous viewers can see images but not stream video.
  const anonymous = client();
  const blocked = await anonymous(`/media/${key}`);
  assert.equal(blocked.status, 403);

  // A subscribed viewer can stream.
  const viewer = client();
  const signup = await viewer("/api/auth/signup", {
    method: "POST",
    body: { email: `sub-${Date.now()}@example.com`, password: "hunter2hunter2" },
  });
  const csrf = signup.data.csrf;
  const stillBlocked = await viewer(`/media/${key}`);
  assert.equal(stillBlocked.status, 403);

  const activate = await viewer("/api/billing/dev-activate", {
    method: "POST",
    body: { plan: "monthly" },
    headers: { "x-csrf-token": csrf },
  });
  assert.equal(activate.status, 200);
  assert.equal(activate.data.subscription.entitled, true);

  const allowed = await viewer(`/media/${key}`, { raw: true });
  assert.equal(allowed.status, 200);

  const me = await viewer("/api/me");
  assert.equal(me.data.subscription.status, "active");

  const cancel = await viewer("/api/billing/cancel", { method: "POST", headers: { "x-csrf-token": csrf } });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.subscription.cancel_at_period_end, true);
  // Still entitled until period end.
  assert.equal(cancel.data.subscription.entitled, true);

  // Admin cleanup of the test title.
  const removed = await admin("/api/admin/content/gate-test", {
    method: "DELETE",
    headers: { "x-csrf-token": adminCsrf },
  });
  assert.equal(removed.status, 200);
});

test("upload magic-byte validation rejects mismatched files", async () => {
  const admin = client();
  const login = await admin("/api/admin/login", { method: "POST", body: { password: ADMIN_PASSWORD } });
  const adminCsrf = login.data.csrf;
  const bytes = new TextEncoder().encode("this is not a png at all, just text padding to 64 bytes....!");
  const init = await admin("/api/admin/upload?action=init", {
    method: "POST",
    body: { contentId: "bad-file", kind: "poster", contentType: "image/png", fileSize: bytes.length },
    headers: { "x-csrf-token": adminCsrf },
  });
  const { key, uploadId } = init.data;
  const part = await admin(
    `/api/admin/upload?action=part&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
    { method: "PUT", body: bytes, headers: { "x-csrf-token": adminCsrf } },
  );
  const complete = await admin(
    `/api/admin/upload?action=complete&key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}`,
    { method: "POST", body: { parts: [part.data] }, headers: { "x-csrf-token": adminCsrf } },
  );
  assert.equal(complete.status, 422);
});

test("admin collections lifecycle and settings", async () => {
  const admin = client();
  const login = await admin("/api/admin/login", { method: "POST", body: { password: ADMIN_PASSWORD } });
  const csrf = login.data.csrf;
  const headers = { "x-csrf-token": csrf };

  const created = await admin("/api/admin/collections", {
    method: "POST",
    body: { title: "Test Row" },
    headers,
  });
  assert.equal(created.status, 201);
  const id = created.data.id;

  const renamed = await admin(`/api/admin/collections/${id}`, {
    method: "PUT",
    body: { title: "Renamed Row", published: false },
    headers,
  });
  assert.equal(renamed.status, 200);

  const items = await admin(`/api/admin/collections/${id}/items`, {
    method: "PUT",
    body: { content_ids: ["our-golden-night"] },
    headers,
  });
  assert.equal(items.status, 200);

  const order = await admin("/api/admin/collections/order", {
    method: "PUT",
    body: { ids: [id, "featured", "trending", "popular", "movies", "shows"] },
    headers,
  });
  assert.equal(order.status, 200);

  const listed = await admin("/api/admin/collections");
  assert.equal(listed.data.collections[0].id, id);

  const settings = await admin("/api/admin/settings", {
    method: "PUT",
    body: { seo_description: "Test description" },
    headers,
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.settings.seo_description, "Test description");

  const audit = await admin("/api/admin/audit");
  assert.ok(audit.data.entries.length > 0);

  const deleted = await admin(`/api/admin/collections/${id}`, { method: "DELETE", headers });
  assert.equal(deleted.status, 200);
});

test("login rate limiting", async () => {
  const api = client();
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await api("/api/auth/login", {
      method: "POST",
      body: { email: "nobody@example.com", password: "wrong-password" },
    });
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429);
});
