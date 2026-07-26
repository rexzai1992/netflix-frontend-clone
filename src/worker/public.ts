import { Env, decorateContent, error, json } from "./lib";

export async function getSettings(env: Env) {
  const result = await env.DB.prepare("SELECT key, value FROM site_settings ORDER BY key").all<{
    key: string;
    value: string;
  }>();
  return Object.fromEntries(result.results.map((row) => [row.key, row.value]));
}

export async function getCollections(env: Env, includeDrafts = false) {
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

export async function handlePublic(request: Request, env: Env, url: URL): Promise<Response> {
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
    if (!row) return error("Content not found", 404);
    const related = await env.DB.prepare(
      `SELECT DISTINCT c.* FROM collection_items mine
       JOIN collection_items peers ON peers.collection_id = mine.collection_id
       JOIN content c ON c.id = peers.content_id
       WHERE mine.content_id = ? AND peers.content_id != ? AND c.published = 1
       ORDER BY c.match_score DESC, c.sort_order LIMIT 10`,
    )
      .bind(id, id)
      .all<Record<string, unknown>>();
    return json(
      { content: decorateContent(row), related: related.results.map(decorateContent) },
      { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } },
    );
  }
  return error("Not found", 404);
}
