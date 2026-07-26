import { Env, HttpError, error, json } from "./lib";
import {
  getAdmin,
  handleAdminLogin,
  handleAdminLogout,
  handleAuth,
  requireCsrf,
} from "./auth";
import { handleAdmin } from "./admin";
import { handleBilling } from "./billing";
import { handleMe } from "./me";
import { handlePublic } from "./public";
import { serveMedia } from "./media";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  const type = headers.get("content-type") || "";
  if (type.includes("text/html")) headers.set("content-security-policy", CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function router(request: Request, env: Env): Promise<Response> {
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
  if (url.pathname === "/api/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, time: new Date().toISOString() });
  }
  if (url.pathname === "/api/content" || url.pathname.startsWith("/api/content/")) {
    return handlePublic(request, env, url);
  }
  if (url.pathname.startsWith("/api/auth/")) {
    return handleAuth(request, env, url);
  }
  if (url.pathname === "/api/me" || url.pathname.startsWith("/api/me/")) {
    return handleMe(request, env, url);
  }
  if (url.pathname.startsWith("/api/billing/")) {
    return handleBilling(request, env, url);
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    return handleAdminLogin(request, env);
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return handleAdminLogout(request, env);
  }
  if (url.pathname.startsWith("/api/admin/")) {
    const admin = await getAdmin(request, env);
    if (!admin) return error("Authentication required", 401);
    if (request.method !== "GET" && request.method !== "HEAD") {
      await requireCsrf(request, admin.csrf);
    }
    return handleAdmin(request, env, url, admin.csrf, admin.tokenHash);
  }
  if (url.pathname.startsWith("/api/")) return error("API endpoint not found", 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return withSecurityHeaders(await router(request, env));
    } catch (cause) {
      if (cause instanceof HttpError) {
        return withSecurityHeaders(error(cause.message, cause.status));
      }
      const message = cause instanceof Error ? cause.message : "Unexpected error";
      console.error("Unhandled error:", message);
      if (message.includes("UNIQUE constraint failed")) {
        return withSecurityHeaders(error("That id already exists", 409));
      }
      return withSecurityHeaders(error("Internal error", 500));
    }
  },
} satisfies ExportedHandler<Env>;
