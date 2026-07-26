import {
  Env,
  HttpError,
  audit,
  clearCookie,
  clientIp,
  cookie,
  hashPassword,
  json,
  rateLimit,
  randomToken,
  readJson,
  safeEqual,
  setCookie,
  sha256Hex,
  verifyPassword,
} from "./lib";

export const USER_COOKIE = "streamflix_session";
export const ADMIN_COOKIE = "streamflix_admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type SessionUser = {
  id: string;
  email: string;
  display_name: string;
  csrf: string;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function userTtl(env: Env) {
  return Number.parseInt(env.USER_SESSION_TTL_SECONDS || "2592000", 10);
}

function adminTtl(env: Env) {
  return Number.parseInt(env.SESSION_TTL_SECONDS || "43200", 10);
}

export async function getUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = cookie(request, USER_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.csrf_token, s.expires_at, u.id, u.email, u.display_name
     FROM user_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(await sha256Hex(token))
    .first<{ csrf_token: string; expires_at: number; id: string; email: string; display_name: string }>();
  if (!row || row.expires_at <= nowSeconds()) return null;
  return { id: row.id, email: row.email, display_name: row.display_name, csrf: row.csrf_token };
}

export async function getAdmin(request: Request, env: Env): Promise<{ csrf: string; tokenHash: string } | null> {
  const token = cookie(request, ADMIN_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT csrf_token, expires_at FROM admin_sessions WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<{ csrf_token: string; expires_at: number }>();
  if (!row || row.expires_at <= nowSeconds()) return null;
  return { csrf: row.csrf_token, tokenHash };
}

export async function requireCsrf(request: Request, expected: string) {
  const provided = request.headers.get("x-csrf-token") || "";
  if (!provided || !(await safeEqual(provided, expected))) {
    throw new HttpError("Invalid or missing CSRF token", 403);
  }
}

async function createUserSession(env: Env, userId: string) {
  const token = randomToken();
  const csrf = randomToken(16);
  await env.DB.prepare(
    "INSERT INTO user_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), userId, csrf, nowSeconds() + userTtl(env))
    .run();
  return { token, csrf };
}

export async function createAdminSession(env: Env) {
  const token = randomToken();
  const csrf = randomToken(16);
  await env.DB.prepare(
    "INSERT INTO admin_sessions (token_hash, csrf_token, expires_at) VALUES (?, ?, ?)",
  )
    .bind(await sha256Hex(token), csrf, nowSeconds() + adminTtl(env))
    .run();
  return { token, csrf };
}

async function pruneExpiredSessions(env: Env) {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start <= ?").bind(now - 86400),
  ]);
}

async function normalizedCredentials(body: { email?: unknown; password?: unknown }) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new HttpError("Enter a valid email address");
  if (password.length < 8 || password.length > 200) {
    throw new HttpError("Password must be at least 8 characters");
  }
  return { email, password };
}

export async function verifyAdminPassword(env: Env, password: string) {
  const stored = await env.DB.prepare(
    "SELECT password_hash FROM admin_credentials WHERE id = 1",
  ).first<{ password_hash: string }>();
  if (stored?.password_hash) return verifyPassword(env, password, stored.password_hash);
  if (!env.ADMIN_PASSWORD) throw new HttpError("Admin authentication is not configured", 503);
  return safeEqual(password, env.ADMIN_PASSWORD);
}

export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const ip = clientIp(request);

  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    const user = await getUser(request, env);
    if (!user) return json({ authenticated: false });
    return json({
      authenticated: true,
      user: { email: user.email, display_name: user.display_name },
      csrf: user.csrf,
    });
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    await rateLimit(env, `signup:${ip}`, 8, 3600);
    const { email, password } = await normalizedCredentials(await readJson(request));
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) throw new HttpError("An account with that email already exists", 409);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
    )
      .bind(id, email, await hashPassword(env, password), email.split("@")[0].slice(0, 40))
      .run();
    const session = await createUserSession(env, id);
    await audit(env, id, "user.signup", email);
    return json(
      { ok: true, csrf: session.csrf },
      { status: 201, headers: { "set-cookie": setCookie(USER_COOKIE, session.token, userTtl(env)) } },
    );
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    await rateLimit(env, `login:${ip}`, 10, 900);
    const { email, password } = await normalizedCredentials(await readJson(request));
    await rateLimit(env, `login:${email}`, 10, 900);
    const user = await env.DB.prepare(
      "SELECT id, password_hash FROM users WHERE email = ?",
    )
      .bind(email)
      .first<{ id: string; password_hash: string }>();
    if (!user || !(await verifyPassword(env, password, user.password_hash))) {
      throw new HttpError("Incorrect email or password", 401);
    }
    const session = await createUserSession(env, user.id);
    await pruneExpiredSessions(env);
    return json(
      { ok: true, csrf: session.csrf },
      { headers: { "set-cookie": setCookie(USER_COOKIE, session.token, userTtl(env)) } },
    );
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const token = cookie(request, USER_COOKIE);
    if (token) {
      await env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?")
        .bind(await sha256Hex(token))
        .run();
    }
    return json({ ok: true }, { headers: { "set-cookie": clearCookie(USER_COOKIE) } });
  }

  throw new HttpError("Not found", 404);
}

export async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  await rateLimit(env, `admin-login:${clientIp(request)}`, 10, 900);
  const body = await readJson<{ password?: string }>(request);
  if (!(await verifyAdminPassword(env, String(body.password || "")))) {
    await audit(env, "admin", "admin.login_failed", clientIp(request));
    throw new HttpError("Incorrect password", 401);
  }
  const session = await createAdminSession(env);
  await pruneExpiredSessions(env);
  await audit(env, "admin", "admin.login", clientIp(request));
  return json(
    { ok: true, csrf: session.csrf },
    { headers: { "set-cookie": setCookie(ADMIN_COOKIE, session.token, adminTtl(env), "Strict") } },
  );
}

export async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const token = cookie(request, ADMIN_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
      .bind(await sha256Hex(token))
      .run();
  }
  return json({ ok: true }, { headers: { "set-cookie": clearCookie(ADMIN_COOKIE) } });
}
