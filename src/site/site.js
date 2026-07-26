// Shared helpers for the StreamFlix public pages.

export const $ = (selector, scope = document) => scope.querySelector(selector);

export const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

// Builds a same-origin media URL from an R2 key, encoding each segment.
export function mediaUrl(key) {
  if (!key) return "";
  return "/media/" + String(key).split("/").map(encodeURIComponent).join("/");
}

export function detailUrl(item) {
  return `/user_dashboard/single.html?id=${encodeURIComponent(item.id)}`;
}

// fetch wrapper that always resolves to { ok, status, data } for JSON APIs.
export async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some responses (e.g. 204) carry no JSON body.
  }
  return { ok: response.ok, status: response.status, data };
}

export async function fetchSession() {
  try {
    const { ok, data } = await fetchJson("/api/auth/session");
    return ok && data ? data : { authenticated: false };
  } catch {
    return { authenticated: false };
  }
}

export async function fetchMe() {
  try {
    const { ok, data } = await fetchJson("/api/me");
    return ok ? data : null;
  } catch {
    return null;
  }
}

// JSON write helper; pass csrf for everything outside /api/auth/*.
export function apiWrite(path, { method = "POST", csrf, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  return fetchJson(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Only allow same-origin path redirects (e.g. "/account/"), never "//host" or URLs.
export function safeNextPath(raw, fallback = "/user_dashboard/browse.html") {
  if (typeof raw === "string" && /^\/(?!\/)/.test(raw)) return raw;
  return fallback;
}

export function formatDate(unixSeconds) {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// Small transient message pinned to the bottom of the viewport.
export function toast(message, duration = 4000) {
  const node = document.createElement("div");
  node.className = "toast";
  node.setAttribute("role", "status");
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), duration);
}

// Card used by catalog rows, related rows, and continue-watching.
export function cardMarkup(item, { progress } = {}) {
  const media = item.poster_url
    ? `<img src="${escapeHtml(item.poster_url)}" alt="${escapeHtml(item.title)}" loading="lazy">`
    : `<div class="card-fallback">${escapeHtml(item.title)}</div>`;
  const fraction =
    typeof progress === "number" && progress > 0 ? Math.min(progress, 1) : null;
  return `
    <a class="content-card" href="${detailUrl(item)}" aria-label="View ${escapeHtml(item.title)}">
      ${media}
      <span class="card-info">
        <span class="card-title">${escapeHtml(item.title)}</span>
        <span class="card-meta">${escapeHtml(item.year || "")} · ${escapeHtml(item.maturity_rating || item.type || "")}</span>
        ${fraction === null ? "" : `<span class="card-progress"><span style="width:${Math.round(fraction * 100)}%"></span></span>`}
      </span>
    </a>`;
}
