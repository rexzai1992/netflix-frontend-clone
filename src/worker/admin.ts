import {
  Env,
  HttpError,
  audit,
  decorateContent,
  error,
  hashPassword,
  json,
  mediaUrl,
  readJson,
  slug,
} from "./lib";
import { verifyAdminPassword } from "./auth";
import { getCollections, getSettings } from "./public";
import { handleUpload } from "./uploads";

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
  captions_key?: string | null;
  featured?: boolean | number;
  published?: boolean | number;
  sort_order?: number;
  collection_ids?: string[];
};

const SETTINGS_KEYS = new Set([
  "site_name",
  "hero_kicker",
  "landing_title",
  "landing_subtitle",
  "landing_backdrop_key",
  "seo_description",
  "social_image_key",
]);

function mediaKey(value: unknown) {
  if (value == null || value === "") return null;
  const key = String(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,300}$/.test(key) || key.includes("..")) {
    throw new HttpError("Invalid media key");
  }
  return key;
}

function normalizedContent(input: ContentInput, existingId?: string) {
  const title = String(input.title || "").trim();
  if (!title) throw new HttpError("Title is required");
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
    poster_key: mediaKey(input.poster_key),
    backdrop_key: mediaKey(input.backdrop_key),
    logo_key: mediaKey(input.logo_key),
    video_key: mediaKey(input.video_key),
    captions_key: mediaKey(input.captions_key),
    featured: input.featured ? 1 : 0,
    published: input.published === false || input.published === 0 ? 0 : 1,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
    collection_ids: Array.isArray(input.collection_ids) ? input.collection_ids.map(String) : [],
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

async function clearOtherFeatured(env: Env, keepId: string) {
  await env.DB.prepare("UPDATE content SET featured = 0 WHERE id != ? AND featured = 1")
    .bind(keepId)
    .run();
}

async function handleContent(request: Request, env: Env, url: URL): Promise<Response> {
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
    const value = normalizedContent(await readJson<ContentInput>(request));
    await env.DB.prepare(
      `INSERT INTO content
       (id, type, title, description, year, maturity_rating, duration, match_score,
        poster_key, backdrop_key, logo_key, video_key, captions_key, featured, published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        value.captions_key,
        value.featured,
        value.published,
        value.sort_order,
      )
      .run();
    await syncCollections(env, value.id, value.collection_ids);
    if (value.featured) await clearOtherFeatured(env, value.id);
    await audit(env, "admin", "content.create", value.id, value.title);
    return json({ ok: true, id: value.id }, { status: 201 });
  }

  if (!id) return error("Content id is required", 400);

  if (request.method === "PUT") {
    const value = normalizedContent(await readJson<ContentInput>(request), id);
    const result = await env.DB.prepare(
      `UPDATE content SET
       type = ?, title = ?, description = ?, year = ?, maturity_rating = ?,
       duration = ?, match_score = ?, poster_key = ?, backdrop_key = ?,
       logo_key = ?, video_key = ?, captions_key = ?, featured = ?, published = ?, sort_order = ?,
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
        value.captions_key,
        value.featured,
        value.published,
        value.sort_order,
        id,
      )
      .run();
    if (!result.meta.changes) return error("Content not found", 404);
    await syncCollections(env, id, value.collection_ids);
    if (value.featured) await clearOtherFeatured(env, id);
    await audit(env, "admin", "content.update", id, value.title);
    return json({ ok: true, id });
  }

  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM content WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return error("Content not found", 404);
    await audit(env, "admin", "content.delete", id);
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleCollections(request: Request, env: Env, url: URL): Promise<Response> {
  const segments = url.pathname.split("/").filter(Boolean); // ["api","admin","collections",...]
  const id = segments[3] ? decodeURIComponent(segments[3]) : null;

  if (request.method === "GET" && !id) {
    return json({ collections: await getCollections(env, true) });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson<{ title?: string; id?: string; published?: boolean }>(request);
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError("Collection title is required");
    const collectionId = slug(String(body.id || title));
    if (!collectionId) throw new HttpError("Collection id is required");
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM collections")
      .first<{ max_order: number }>();
    await env.DB.prepare(
      "INSERT INTO collections (id, title, slug, sort_order, published) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(collectionId, title, collectionId, (max?.max_order || 0) + 10, body.published === false ? 0 : 1)
      .run();
    await audit(env, "admin", "collection.create", collectionId, title);
    return json({ ok: true, id: collectionId }, { status: 201 });
  }

  if (request.method === "PUT" && url.pathname === "/api/admin/collections/order") {
    const body = await readJson<{ ids?: string[] }>(request);
    if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError("ids array is required");
    await env.DB.batch(
      body.ids.map((collectionId, index) =>
        env.DB.prepare("UPDATE collections SET sort_order = ? WHERE id = ?").bind(
          (index + 1) * 10,
          String(collectionId),
        ),
      ),
    );
    await audit(env, "admin", "collection.reorder", "", body.ids.join(","));
    return json({ ok: true });
  }

  if (id && segments[4] === "items" && request.method === "PUT") {
    const body = await readJson<{ content_ids?: string[] }>(request);
    if (!Array.isArray(body.content_ids)) throw new HttpError("content_ids array is required");
    await env.DB.prepare("DELETE FROM collection_items WHERE collection_id = ?").bind(id).run();
    if (body.content_ids.length) {
      await env.DB.batch(
        body.content_ids.map((contentId, index) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO collection_items (collection_id, content_id, sort_order) VALUES (?, ?, ?)",
          ).bind(id, String(contentId), (index + 1) * 10),
        ),
      );
    }
    await audit(env, "admin", "collection.items", id, `${body.content_ids.length} items`);
    return json({ ok: true });
  }

  if (id && request.method === "PUT") {
    const body = await readJson<{ title?: string; published?: boolean }>(request);
    const title = String(body.title || "").trim().slice(0, 120);
    if (!title) throw new HttpError("Collection title is required");
    const result = await env.DB.prepare(
      "UPDATE collections SET title = ?, published = ? WHERE id = ?",
    )
      .bind(title, body.published === false ? 0 : 1, id)
      .run();
    if (!result.meta.changes) return error("Collection not found", 404);
    await audit(env, "admin", "collection.update", id, title);
    return json({ ok: true });
  }

  if (id && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id).run();
    if (!result.meta.changes) return error("Collection not found", 404);
    await audit(env, "admin", "collection.delete", id);
    return json({ ok: true });
  }

  return error("Method not allowed", 405);
}

async function handleSettings(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT") return error("Method not allowed", 405);
  const values = await readJson<Record<string, unknown>>(request);
  const statements = Object.entries(values)
    .filter(([key]) => SETTINGS_KEYS.has(key))
    .map(([key, value]) =>
      env.DB.prepare(
        `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      ).bind(key, String(value ?? "").slice(0, 500)),
    );
  if (statements.length) await env.DB.batch(statements);
  await audit(env, "admin", "settings.update", "", Object.keys(values).join(","));
  return json({ ok: true, settings: await getSettings(env) });
}

async function referencedKeys(env: Env) {
  const keys = new Set<string>();
  const content = await env.DB.prepare(
    "SELECT poster_key, backdrop_key, logo_key, video_key, captions_key FROM content",
  ).all<Record<string, string | null>>();
  for (const row of content.results) {
    for (const value of Object.values(row)) if (value) keys.add(value);
  }
  const settings = await getSettings(env);
  for (const key of ["landing_backdrop_key", "social_image_key"]) {
    if (settings[key]) keys.add(settings[key]);
  }
  return keys;
}

async function handleMedia(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/admin/media" && request.method === "GET") {
    const referenced = await referencedKeys(env);
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const page: R2Objects = await env.MEDIA.list({ cursor, limit: 500, include: ["httpMetadata"] });
      for (const object of page.objects) {
        items.push({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded,
          content_type: object.httpMetadata?.contentType || "",
          url: mediaUrl(object.key),
          in_use: referenced.has(object.key),
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && items.length < 5000);
    return json({ items, truncated: items.length >= 5000 });
  }

  if (url.pathname === "/api/admin/media" && request.method === "DELETE") {
    const key = url.searchParams.get("key") || "";
    if (!key) return error("key is required");
    const referenced = await referencedKeys(env);
    if (referenced.has(key)) return error("That file is still in use", 409);
    await env.MEDIA.delete(key);
    await env.DB.prepare("DELETE FROM media_assets WHERE key = ?").bind(key).run();
    await audit(env, "admin", "media.delete", key);
    return json({ ok: true });
  }

  if (url.pathname === "/api/admin/media/cleanup" && request.method === "POST") {
    // Deletes completed uploads under uploads/ that nothing references anymore.
    const referenced = await referencedKeys(env);
    const doomed: string[] = [];
    let cursor: string | undefined;
    do {
      const page: R2Objects = await env.MEDIA.list({ cursor, limit: 500, prefix: "uploads/" });
      for (const object of page.objects) {
        if (!referenced.has(object.key)) doomed.push(object.key);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    for (let index = 0; index < doomed.length; index += 100) {
      const batch = doomed.slice(index, index + 100);
      await env.MEDIA.delete(batch);
      await env.DB.batch(
        batch.map((key) => env.DB.prepare("DELETE FROM media_assets WHERE key = ?").bind(key)),
      );
    }
    await audit(env, "admin", "media.cleanup", "", `deleted ${doomed.length}`);
    return json({ ok: true, deleted: doomed.length });
  }

  return error("Method not allowed", 405);
}

async function handlePassword(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT") return error("Method not allowed", 405);
  const body = await readJson<{ current?: string; next?: string }>(request);
  const next = String(body.next || "");
  if (next.length < 12 || next.length > 200) {
    throw new HttpError("New password must be at least 12 characters");
  }
  if (!(await verifyAdminPassword(env, String(body.current || "")))) {
    throw new HttpError("Current password is incorrect", 401);
  }
  await env.DB.prepare(
    `INSERT INTO admin_credentials (id, password_hash, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(await hashPassword(env, next))
    .run();
  await audit(env, "admin", "admin.password_change");
  return json({ ok: true });
}

export async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  csrf: string,
  tokenHash: string,
): Promise<Response> {
  if (url.pathname === "/api/admin/session" && request.method === "GET") {
    return json({ authenticated: true, csrf });
  }
  if (url.pathname.startsWith("/api/admin/content")) {
    return handleContent(request, env, url);
  }
  if (url.pathname.startsWith("/api/admin/collections")) {
    return handleCollections(request, env, url);
  }
  if (url.pathname === "/api/admin/settings") {
    return handleSettings(request, env);
  }
  if (url.pathname === "/api/admin/upload") {
    return handleUpload(request, env, url);
  }
  if (url.pathname.startsWith("/api/admin/media")) {
    return handleMedia(request, env, url);
  }
  if (url.pathname === "/api/admin/password") {
    const response = await handlePassword(request, env);
    // Password change signs out every other admin session.
    if (response.ok) {
      await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash != ?").bind(tokenHash).run();
    }
    return response;
  }
  if (url.pathname === "/api/admin/audit" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, actor, action, entity, details, created_at FROM audit_log ORDER BY id DESC LIMIT 200",
    ).all();
    return json({ entries: rows.results });
  }
  return error("Admin endpoint not found", 404);
}
