// Shared helpers for the StreamFlix pages. No accounts, no sessions — every
// viewer-specific bit of state (My List, playback progress) lives in
// localStorage on the device that made it.

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

/* ---------- Local storage: My List + playback progress ---------- */

const MY_LIST_KEY = "streamflix_mylist";
const PROGRESS_KEY = "streamflix_progress";

// Private browsing and disabled storage both throw — degrade to "no state".
function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do — the page still works without saved state.
  }
}

// My List is a JSON array of content ids, in the order they were saved.
export function getMyList() {
  const stored = readStore(MY_LIST_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id) => typeof id === "string" && id !== "");
}

export function isInMyList(id) {
  return getMyList().includes(String(id));
}

export function addToMyList(id) {
  const list = getMyList();
  const key = String(id);
  if (!list.includes(key)) list.push(key);
  writeStore(MY_LIST_KEY, list);
  return list;
}

export function removeFromMyList(id) {
  const key = String(id);
  const list = getMyList().filter((entry) => entry !== key);
  writeStore(MY_LIST_KEY, list);
  return list;
}

// Progress is a JSON object: contentId -> { position, duration, updated }.
function getProgressMap() {
  const stored = readStore(PROGRESS_KEY, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored;
}

function normalizeProgress(id, entry) {
  if (!entry || typeof entry !== "object") return null;
  return {
    id: String(id),
    position: Number(entry.position) || 0,
    duration: Number(entry.duration) || 0,
    updated: Number(entry.updated) || 0,
  };
}

export function getProgress(id) {
  return normalizeProgress(id, getProgressMap()[String(id)]);
}

export function setProgress(id, position, duration) {
  const map = getProgressMap();
  map[String(id)] = {
    position: Math.max(0, Math.floor(Number(position) || 0)),
    duration: Math.max(0, Math.floor(Number(duration) || 0)),
    updated: Date.now(),
  };
  writeStore(PROGRESS_KEY, map);
}

// Worth resuming: past the opening seconds, not effectively finished.
export function isResumable(entry) {
  if (!entry || !(entry.position > 20)) return false;
  if (entry.duration > 0 && entry.position / entry.duration >= 0.95) return false;
  return true;
}

// Most recently watched first, for the Continue Watching row.
export function listProgress(limit = 12) {
  return Object.entries(getProgressMap())
    .map(([id, entry]) => normalizeProgress(id, entry))
    .filter((entry) => entry && isResumable(entry))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, limit);
}

/* ---------- Formatting + chrome ---------- */

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
