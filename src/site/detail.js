// Title detail page (/user_dashboard/single.html?id=<contentId>).
import {
  $,
  apiWrite,
  cardMarkup,
  escapeHtml,
  fetchJson,
  fetchMe,
  fetchSession,
  formatClock,
  toast,
} from "./site.js";

const root = $("#detail-content");
const id = new URLSearchParams(location.search).get("id");
const herePath = location.pathname + location.search;
const signInHref = `/login.html?next=${encodeURIComponent(herePath)}`;

const state = { content: null, me: null, inList: false };

const entitled = () => Boolean(state.me?.subscription?.entitled);

function lockedMarkup(poster, heading, message, ctaLabel, ctaHref) {
  return `
    <div class="player-locked">
      ${poster ? `<img src="${escapeHtml(poster)}" alt="">` : ""}
      <div class="player-locked-inner">
        <h2>${escapeHtml(heading)}</h2>
        <p>${escapeHtml(message)}</p>
        <a class="button button-primary" href="${escapeHtml(ctaHref)}">${escapeHtml(ctaLabel)}</a>
      </div>
    </div>`;
}

function playerMarkup(content, authenticated) {
  const poster = content.backdrop_url || content.poster_url || "";
  if (!content.video_url) {
    return '<div class="player-empty"><p>Coming soon — this title is not yet available to stream.</p></div>';
  }
  if (!authenticated) {
    return lockedMarkup(
      poster,
      "Sign in to watch",
      "You need a StreamFlix account to stream this title.",
      "Sign In",
      signInHref
    );
  }
  if (!entitled()) {
    return lockedMarkup(
      poster,
      "Subscribe to watch",
      "Your account does not have an active subscription. Pick a plan to unlock playback.",
      "Choose a plan",
      "/account/"
    );
  }
  const captions = content.captions_url
    ? `<track kind="captions" label="English" srclang="en" src="${escapeHtml(content.captions_url)}" default>`
    : "";
  return `
    <video class="player" id="player" controls playsinline preload="metadata"
      poster="${escapeHtml(poster)}" src="${escapeHtml(content.video_url)}">
      ${captions}
    </video>`;
}

function render(content, related, authenticated) {
  const backdrop = content.backdrop_url || content.poster_url || "";
  const typeLabel = content.type === "show" ? "TV Show" : "Movie";
  root.innerHTML = `
    ${backdrop ? `<img class="detail-backdrop" src="${escapeHtml(backdrop)}" alt="">` : ""}
    <div class="detail-shade"></div>
    <div class="player-frame" id="player-frame">${playerMarkup(content, authenticated)}</div>
    <div class="detail-copy">
      ${
        content.logo_url
          ? `<img class="detail-logo" src="${escapeHtml(content.logo_url)}" alt="">
             <h1 class="sr-only">${escapeHtml(content.title)}</h1>`
          : `<h1>${escapeHtml(content.title)}</h1>`
      }
      <div class="detail-meta">
        ${content.match_score ? `<span class="match">${Number(content.match_score) || 0}% Match</span>` : ""}
        ${content.year ? `<span>${escapeHtml(content.year)}</span>` : ""}
        ${content.maturity_rating ? `<span>${escapeHtml(content.maturity_rating)}</span>` : ""}
        ${content.duration ? `<span>${escapeHtml(content.duration)}</span>` : ""}
        <span>${typeLabel}</span>
      </div>
      <p class="detail-description">${escapeHtml(content.description || "")}</p>
      <button class="button button-secondary list-button" id="my-list" type="button">＋ My List</button>
    </div>
    ${
      related.length
        ? `<section class="related-row">
             <div class="row-head"><h2>More like this</h2></div>
             <div class="card-grid">${related.map((item) => cardMarkup(item)).join("")}</div>
           </section>`
        : ""
    }`;
}

/* ---------- My List toggle ---------- */

function refreshListButton(button) {
  button.textContent = state.inList ? "✓ In My List" : "＋ My List";
  button.setAttribute("aria-pressed", String(state.inList));
}

async function setupListButton(authenticated) {
  const button = $("#my-list");
  if (!authenticated) {
    button.addEventListener("click", () => {
      location.href = signInHref;
    });
    return;
  }
  const { ok, data } = await fetchJson("/api/me/list").catch(() => ({ ok: false }));
  if (ok) state.inList = (data?.items || []).some((item) => item.id === state.content.id);
  refreshListButton(button);
  button.addEventListener("click", async () => {
    button.disabled = true;
    const method = state.inList ? "DELETE" : "PUT";
    const result = await apiWrite(`/api/me/list/${encodeURIComponent(state.content.id)}`, {
      method,
      csrf: state.me?.csrf,
    });
    button.disabled = false;
    if (result.ok) {
      state.inList = !state.inList;
      refreshListButton(button);
      toast(state.inList ? "Added to My List" : "Removed from My List");
    } else {
      toast(result.data?.error || "Could not update your list. Please try again.");
    }
  });
}

/* ---------- Playback: resume + progress reporting ---------- */

function setupPlayer() {
  const video = $("#player");
  if (!video) return;
  const csrf = state.me?.csrf;
  const progressPath = `/api/me/progress/${encodeURIComponent(state.content.id)}`;
  let lastReported = -1;

  // The media route returns 403 when the subscription has lapsed since /api/me
  // was cached — swap the player for the subscribe overlay instead of a dead box.
  video.addEventListener("error", () => {
    $("#player-frame").innerHTML = lockedMarkup(
      state.content.backdrop_url || state.content.poster_url || "",
      "Subscribe to watch",
      "Playback is available to subscribers. Pick a plan to keep watching.",
      "Choose a plan",
      "/account/"
    );
  });

  // Resume where the viewer left off.
  fetchJson(progressPath)
    .then(({ ok, data }) => {
      const saved = ok ? data?.progress : null;
      if (!saved) return;
      const position = Number(saved.position_seconds) || 0;
      const duration = Number(saved.duration_seconds) || 0;
      if (position <= 20 || (duration > 0 && position / duration >= 0.95)) return;
      const apply = () => {
        // Leave a couple of seconds of runway at the very end.
        video.currentTime = Math.min(position, Math.max(0, (video.duration || Infinity) - 2));
        toast(`Resuming from ${formatClock(position)}`);
      };
      if (video.readyState >= 1) apply();
      else video.addEventListener("loadedmetadata", apply, { once: true });
    })
    .catch(() => {});

  const report = (keepalive = false) => {
    const position = Math.floor(video.currentTime || 0);
    const duration = Math.floor(video.duration || 0);
    if (!position || position === lastReported) return;
    lastReported = position;
    fetch(progressPath, {
      method: "PUT",
      keepalive,
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({ position, duration }),
    }).catch(() => {});
  };

  setInterval(() => {
    if (!video.paused && !video.ended) report();
  }, 10000);
  video.addEventListener("pause", () => report());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report(true);
  });
  window.addEventListener("pagehide", () => report(true));
}

/* ---------- Boot ---------- */

async function init() {
  if (!id) {
    root.innerHTML = '<p class="status">No title was selected. <a href="browse.html">Back to browse</a>.</p>';
    return;
  }

  const [detail, session] = await Promise.all([
    fetchJson(`/api/content/${encodeURIComponent(id)}`).catch(() => ({ ok: false, status: 0 })),
    fetchSession(),
  ]);

  if (!detail.ok || !detail.data?.content) {
    root.innerHTML =
      detail.status === 404
        ? '<p class="status">This title could not be found. <a href="browse.html">Back to browse</a>.</p>'
        : '<p class="status">This title could not be loaded. Please refresh to try again.</p>';
    return;
  }

  state.content = detail.data.content;
  if (session.authenticated) state.me = await fetchMe();

  document.title = `${state.content.title} — StreamFlix`;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", (state.content.description || `Watch ${state.content.title} on StreamFlix.`).slice(0, 300));

  render(state.content, detail.data.related || [], session.authenticated);
  setupListButton(session.authenticated);
  if (session.authenticated && entitled()) setupPlayer();
}

init();
