import { Env, HttpError, audit, decorateContent, hashPassword, json, readJson, sha256Hex, verifyPassword, cookie } from "./lib";
import { USER_COOKIE, getUser, requireCsrf } from "./auth";
import { getSubscription, publicSubscription } from "./billing";

export async function handleMe(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await getUser(request, env);
  if (!user) throw new HttpError("Sign in required", 401);
  if (request.method !== "GET") await requireCsrf(request, user.csrf);
  const segments = url.pathname.split("/").filter(Boolean); // ["api", "me", ...]

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({
      user: { email: user.email, display_name: user.display_name },
      csrf: user.csrf,
      subscription: publicSubscription(await getSubscription(env, user.id)),
    });
  }

  if (url.pathname === "/api/me/password" && request.method === "PUT") {
    const body = await readJson<{ current?: string; next?: string }>(request);
    const next = String(body.next || "");
    if (next.length < 8 || next.length > 200) {
      throw new HttpError("New password must be at least 8 characters");
    }
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(env, String(body.current || ""), row.password_hash))) {
      throw new HttpError("Current password is incorrect", 401);
    }
    const currentTokenHash = await sha256Hex(cookie(request, USER_COOKIE) || "");
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(
        await hashPassword(env, next),
        user.id,
      ),
      // Session rotation: signing out every other device.
      env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ? AND token_hash != ?").bind(
        user.id,
        currentTokenHash,
      ),
    ]);
    await audit(env, user.id, "user.password_change");
    return json({ ok: true });
  }

  if (url.pathname === "/api/me/list" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT c.* FROM my_list m JOIN content c ON c.id = m.content_id
       WHERE m.user_id = ? AND c.published = 1
       ORDER BY m.added_at DESC`,
    )
      .bind(user.id)
      .all<Record<string, unknown>>();
    return json({ items: rows.results.map(decorateContent) });
  }

  if (segments[2] === "list" && segments[3] && (request.method === "PUT" || request.method === "DELETE")) {
    const contentId = decodeURIComponent(segments[3]);
    if (request.method === "PUT") {
      const exists = await env.DB.prepare("SELECT id FROM content WHERE id = ? AND published = 1")
        .bind(contentId)
        .first();
      if (!exists) throw new HttpError("Title not found", 404);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO my_list (user_id, content_id) VALUES (?, ?)",
      )
        .bind(user.id, contentId)
        .run();
    } else {
      await env.DB.prepare("DELETE FROM my_list WHERE user_id = ? AND content_id = ?")
        .bind(user.id, contentId)
        .run();
    }
    return json({ ok: true });
  }

  if (url.pathname === "/api/me/continue" && request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT c.*, w.position_seconds, w.duration_seconds, w.updated_at AS watched_at
       FROM watch_progress w JOIN content c ON c.id = w.content_id
       WHERE w.user_id = ? AND w.completed = 0 AND w.position_seconds > 20
       ORDER BY w.updated_at DESC LIMIT 12`,
    )
      .bind(user.id)
      .all<Record<string, unknown>>();
    return json({ items: rows.results.map(decorateContent) });
  }

  if (segments[2] === "progress" && segments[3]) {
    const contentId = decodeURIComponent(segments[3]);
    if (request.method === "GET") {
      const row = await env.DB.prepare(
        "SELECT position_seconds, duration_seconds, completed FROM watch_progress WHERE user_id = ? AND content_id = ?",
      )
        .bind(user.id, contentId)
        .first();
      return json({ progress: row || null });
    }
    if (request.method === "PUT") {
      const body = await readJson<{ position?: number; duration?: number }>(request);
      const position = Math.max(0, Number(body.position) || 0);
      const duration = Math.max(0, Number(body.duration) || 0);
      const completed = duration > 0 && position / duration > 0.95 ? 1 : 0;
      await env.DB.prepare(
        `INSERT INTO watch_progress (user_id, content_id, position_seconds, duration_seconds, completed, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, content_id) DO UPDATE SET
           position_seconds = excluded.position_seconds,
           duration_seconds = excluded.duration_seconds,
           completed = excluded.completed,
           updated_at = CURRENT_TIMESTAMP`,
      )
        .bind(user.id, contentId, position, duration, completed)
        .run();
      return json({ ok: true });
    }
  }

  throw new HttpError("Not found", 404);
}
