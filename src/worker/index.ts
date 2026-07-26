interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  APP_NAME: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  SESSION_TTL_SECONDS?: string;
}

type ContentInput = {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  year?: number | null;
  maturity_rating?: string;
  duration?: string;
  match_score?: number;
  poster_key?: string | null;
  backdrop_key?: string | null;
  logo_key?: string | null;
  video_key?: string | null;
  featured?: boolean | number;
  published?: boolean | number;
  sort_order?: number;
  collection_ids?: string[];
};

const json = (data: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
};

const error = (message: string, status = 400) =>
  json({ error: message }, { status });

const base64url = {
  encode(value: ArrayBuffer | string) {
    const bytes =
      typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  },
  decode(value: string) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  },
};

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url.encode(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

async function safeEqual(left: string, right: string) {
  const leftHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(left));
  const rightHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(right));
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let result = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    result |= a[index] ^ b[index];
  }
  return result === 0;
}

function cookie(request: Request, name: string) {
  const source = request.headers.get("cookie") || "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function createSession(env: Env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  const payload = base64url.encode(
    JSON.stringify({
      exp:
        Math.floor(Date.now() / 1000) +
        Number.parseInt(env.SESSION_TTL_SECONDS || "43200", 10),
      nonce: crypto.randomUUID(),
    }),
  );
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function isAdmin(request: Request, env: Env) {
  if (!env.SESSION_SECRET) return false;
  const token = cookie(request, "streamflix_admin");
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!(await safeEqual(await hmac(env.SESSION_SECRET, payload), signature))) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(base64url.decode(payload))) as {
      exp: number;
    };
    return data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function mediaUrl(key: unknown) {
  return typeof key === "string" && key ? `/media/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

function decorateContent(row: Record<string, unknown>) {
  return {
    ...row,
    featured: Boolean(row.featured),
    published: Boolean(row.published),
    poster_url: mediaUrl(row.poster_key),
    backdrop_url: mediaUrl(row.backdrop_key),
    logo_url: mediaUrl(row.logo_key),
    video_url: mediaUrl(row.video_key),
  };
}

async function getSettings(env: Env) {
  const result = await env.DB.prepare("SELECT key, value FROM site_settings ORDER BY key").all<{
    key: string;
    value: string;
  }>();
  return Object.fromEntries(result.results.map((row) => [row.key, row.value]));
}

async function getCollections(env: Env, includeDrafts = false) {
  const collectionFilter = includeDrafts ? "" : "WHERE c.published = 1";
  const itemFilter = includeDrafts ? "" : "AND i.published = 1";
  const collections = await env.DB.prepare(
    `SELECT c.* FROM collections c ${collectionFilter} ORDER BY c.sort_order, c.title`,
  ).all<Record<string, unknown>>();
  const result = [];
  for (const collection of collections.results) {
    const items = await env.DB.prepare(
      `SELECT i.* FROM collection_items ci
       JOIN content i ON i.id = ci.content_id
       WHERE ci.collection_id = ? ${itemFilter}
       ORDER BY ci.sort_order, i.sort_order, i.title`,
    )
      .bind(collection.id)
      .all<Record<string, unknown>>();
    result.push({
      ...collection,
      published: Boolean(collection.published),
      items: items.results.map(decorateContent),
    });
  }
  return result;
}

async function publicPayload(env: Env, url: URL) {
  const type = url.searchParams.get("type");
  const query = url.searchParams.get("q")?.trim();
  const where = ["published = 1"];
  const bindings: unknown[] = [];
  if (type === "movie" || type === "show") {
    where.push("type = ?");
    bindings.push(type);
  }
  if (query) {
    where.push("(title LIKE ? OR description LIKE ?)");
    bindings.push(`%${query}%`, `%${query}%`);
  }
  const statement = env.DB.prepare(
    `SELECT * FROM content WHERE ${where.join(" AND ")}
     ORDER BY featured DESC, sort_order, updated_at DESC`,
  ).bind(...bindings);
  const [content, settings, collections] = await Promise.all([
    statement.all<Record<string, unknown>>(),
    getSettings(env),
    getCollections(env),
  ]);
  return {
    settings,
    content: content.results.map(decorateContent),
    collections,
  };
}

function normalizedContent(input: ContentInput, existingId?: string) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Title is required");
  const type = input.type === "show" ? "show" : "movie";
  const id = existingId || slug(String(input.id || title)) || crypto.randomUUID();
  return {
    id,
    type,
    title: title.slice(0, 160),
    description: String(input.description || "").trim().slice(0, 4000),
    year: input.year ? Math.max(1888, Math.min(2200, Number(input.year))) : null,
    maturity_rating: String(input.maturity_rating || "").trim().slice(0, 20),
    duration: String(input.duration || "").trim().slice(0, 40),
    match_score: Math.max(0, Math.min(100, Number(input.match_score || 0))),
    poster_key: input.poster_key || null,
    backdrop_key: input.backdrop_key || null,
    logo_key: input.logo_key || null,
    video_key: input.video_key || null,
    featured: input.featured ? 1 : 0,
    published: input.published === false || input.published === 0 ? 0 : 1,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    collection_ids: Array.isArray(input.collection_ids) ? input.collection_ids : [],
  };
}

async function syncCollections(env: Env, contentId: string, collectionIds: string[]) {
  await env.DB.prepare("DELETE FROM collection_items WHERE content_id = ?").bind(contentId).run();
  if (!collectionIds.length) return;
  const statements = collectionIds.map((collectionId, index) =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO collection_items (collection_id, content_id, sort_order) VALUES (?, ?, ?)",
    ).bind(collectionId, contentId, (index + 1) * 10),
  );
  await env.DB.batch(statements);
}

async function handleContentAdmin(request: Request, env: Env, url: URL) {
  const segments = url.pathname.split("/").filter(Boolean);
  const id = segments[3] ? decodeURIComponent(segments[3]) : null;

  if (request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT c.*,
        COALESCE(GROUP_CONCAT(ci.collection_id), '') AS collection_ids_csv
       FROM content c
       LEFT JOIN collection_items ci ON ci.content_id = c.id
       GROUP BY c.id
       ORDER BY c.featured DESC, c.sort_order, c.updated_at DESC`,
    ).all<Record<string, unknown>>();
    return json({
      content: result.results.map((row) => ({
        ...decorateContent(row),
        collection_ids: String(row.collection_ids_csv || "")
          .split(",")
          .filter(Boolean),
      })),
      collections: await getCollections(env, true),
      settings: await getSettings(env),
    });
  }

  if (request.method === "POST") {
    const value = normalizedContent(await request.json<ContentInput>());
    await env.DB.prepare(
      `INSERT INTO content
       (id, type, title, description, year, maturity_rating, duration, match_score,
        poster_key, backdrop_key, logo_key, video_key, featured, published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        value.id,
        value.type,
        value.title,
        value.description,
        value.year,
        value.maturity_rating,
        value.duration,
        value.match_score,
        value.poster_key,
        value.backdrop_key,
        value.logo_key,
        value.video_key,
        value.featured,
        value.published,
        value.sort_order,
      )
      .run();
    await syncCollections(env, value.id, value.collection_ids);
    return json({ ok: true, id: value.id }, { status: 201 });
  }

  if (!id) return error("Content id is required", 400);

  if (request.method === "PUT") {
    const input = await request.json<ContentInput>();
    const value = normalizedContent(input, id);
    const result = await env.DB.prepare(
      `UPDATE content SET
       type = ?, title = ?, description = ?, year = ?, maturity_rating = ?,
       duration = ?, match_score = ?, poster_key = ?, backdrop_key = ?,
       logo_key = ?, video_key = ?, featured = ?, published = ?, sort_order = ?,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(
        value.type,
        value.title,
        value.description,
        value.year,
        value.maturity_rating,
        value.duration,
        value.match_score,
        value.poster_key,
        value.backdrop_key,
        value.logo_key,
        value.video_key,
        value.featured,
        value.published,
        value.sort_order,
        id,
      )
      .run();
    if (!result.meta.changes) return error("Content not found", 404);
    await syncCollections(env, id, value.collection_ids);
    return json({ ok: true, id });
  }

  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM content WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return error("Content not found", 404);
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleSettings(request: Request, env: Env) {
  if (request.method !== "PUT") return error("Method not allowed", 405);
  const values = await request.json<Record<string, unknown>>();
  const allowed = new Set(["site_name", "hero_kicker", "landing_title", "landing_subtitle"]);
  const statements = Object.entries(values)
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) =>
      env.DB.prepare(
        `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(key, String(value).slice(0, 500)),
    );
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, settings: await getSettings(env) });
}

const mediaKinds = new Set(["poster", "backdrop", "logo", "video"]);
const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
]);

function uploadDescriptor(data: Record<string, unknown>) {
  const type = String(data.contentType || "");
  const kind = String(data.kind || "");
  const extension = allowedTypes.get(type);
  if (!extension) throw new Error("Unsupported file type");
  if (!mediaKinds.has(kind)) throw new Error("Invalid media kind");
  if (kind === "video" && !type.startsWith("video/")) throw new Error("Video media requires a video file");
  if (kind !== "video" && !type.startsWith("image/")) throw new Error("Image media requires an image file");
  const contentId = slug(String(data.contentId || "new-content")) || "new-content";
  return {
    key: `uploads/${contentId}/${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`,
    type,
  };
}

async function handleUpload(request: Request, env: Env, url: URL) {
  if (request.method === "POST" && url.searchParams.get("action") === "init") {
    const descriptor = uploadDescriptor(await request.json<Record<string, unknown>>());
    const upload = await env.MEDIA.createMultipartUpload(descriptor.key, {
      httpMetadata: {
        contentType: descriptor.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return json({ ...descriptor, uploadId: upload.uploadId });
  }

  const key = url.searchParams.get("key");
  if (!key || !key.startsWith("uploads/")) return error("Invalid upload key");

  if (request.method === "PUT" && url.searchParams.get("action") === "part") {
    const uploadId = url.searchParams.get("uploadId");
    const partNumber = Number(url.searchParams.get("partNumber"));
    if (!uploadId || !request.body || !Number.isInteger(partNumber) || partNumber < 1) {
      return error("Invalid multipart request");
    }
    const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json(part);
  }

  if (request.method === "POST" && url.searchParams.get("action") === "complete") {
    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return error("Missing upload id");
    const body = await request.json<{ parts?: R2UploadedPart[] }>();
    if (!Array.isArray(body.parts) || !body.parts.length) return error("Missing upload parts");
    const object = await env.MEDIA.resumeMultipartUpload(key, uploadId).complete(body.parts);
    return json({ key: object.key, url: mediaUrl(object.key) });
  }

  if (request.method === "DELETE" && url.searchParams.get("action") === "abort") {
    const uploadId = url.searchParams.get("uploadId");
    if (!uploadId) return error("Missing upload id");
    await env.MEDIA.resumeMultipartUpload(key, uploadId).abort();
    return new Response(null, { status: 204 });
  }

  return error("Unsupported upload operation", 405);
}

async function serveMedia(request: Request, env: Env, key: string) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error("Method not allowed", 405);
  }
  const options: R2GetOptions = {};
  if (request.headers.has("range")) options.range = request.headers;
  if (request.headers.has("if-none-match")) options.onlyIf = request.headers;
  const object = await env.MEDIA.get(key, options);
  if (!object) return new Response("Not found", { status: 404 });
  if ("body" in object === false) return new Response(null, { status: 304 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", headers.get("cache-control") || "public, max-age=31536000, immutable");

  let status = 200;
  if (request.headers.has("range") && object.range) {
    const range = object.range as { offset?: number; length?: number };
    if (typeof range.offset === "number" && typeof range.length === "number") {
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      );
      headers.set("content-length", String(range.length));
      status = 206;
    }
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status, headers });
}

async function router(request: Request, env: Env) {
  const url = new URL(request.url);

  if (url.pathname === "/admin") {
    return Response.redirect(`${url.origin}/admin/`, 308);
  }
  if (url.pathname.startsWith("/media/")) {
    const key = url.pathname
      .slice("/media/".length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    return serveMedia(request, env, key);
  }
  if (url.pathname === "/api/content" && request.method === "GET") {
    return json(await publicPayload(env, url), {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
    });
  }
  if (url.pathname.startsWith("/api/content/") && request.method === "GET") {
    const id = decodeURIComponent(url.pathname.slice("/api/content/".length));
    const row = await env.DB.prepare("SELECT * FROM content WHERE id = ? AND published = 1")
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? json({ content: decorateContent(row) }) : error("Content not found", 404);
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return error("Admin authentication is not configured", 503);
    }
    const body = await request.json<{ password?: string }>();
    if (!(await safeEqual(String(body.password || ""), env.ADMIN_PASSWORD))) {
      return error("Incorrect password", 401);
    }
    const headers = new Headers();
    headers.set(
      "set-cookie",
      `streamflix_admin=${await createSession(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${env.SESSION_TTL_SECONDS || "43200"}`,
    );
    return json({ ok: true }, { headers });
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return json(
      { ok: true },
      {
        headers: {
          "set-cookie":
            "streamflix_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
        },
      },
    );
  }
  if (url.pathname.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) return error("Authentication required", 401);
    if (url.pathname === "/api/admin/session" && request.method === "GET") {
      return json({ authenticated: true });
    }
    if (url.pathname.startsWith("/api/admin/content")) {
      return handleContentAdmin(request, env, url);
    }
    if (url.pathname === "/api/admin/settings") {
      return handleSettings(request, env);
    }
    if (url.pathname === "/api/admin/upload") {
      return handleUpload(request, env, url);
    }
    return error("Admin endpoint not found", 404);
  }
  if (url.pathname.startsWith("/api/")) return error("API endpoint not found", 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await router(request, env);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unexpected error";
      console.error(message);
      if (message.includes("UNIQUE constraint failed")) return error("That id already exists", 409);
      return error(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;
