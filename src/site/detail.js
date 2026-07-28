// Title detail page (/user_dashboard/single.html?id=<contentId>).
// Open playback: anyone with the link can watch. My List and resume position
// are kept in localStorage on this device.
import {
  $,
  addToMyList,
  cardMarkup,
  escapeHtml,
  fetchJson,
  formatClock,
  getProgress,
  isInMyList,
  isResumable,
  removeFromMyList,
  setProgress,
  toast,
} from "./site.js";

const root = $("#detail-content");
const id = new URLSearchParams(location.search).get("id");

const state = { content: null, inList: false };

function playerMarkup(content) {
  const poster = content.backdrop_url || content.poster_url || "";
  if (!content.video_url) {
    return '<div class="player-empty"><p>Coming soon — this title is not yet available to stream.</p></div>';
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

function render(content, related) {
  const backdrop = content.backdrop_url || content.poster_url || "";
  const typeLabel = content.type === "show" ? "TV Show" : "Movie";
  root.innerHTML = `
    ${backdrop ? `<img class="detail-backdrop" src="${escapeHtml(backdrop)}" alt="">` : ""}
    <div class="detail-shade"></div>
    <div class="player-frame" id="player-frame">${playerMarkup(content)}</div>
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
      <button class="button button-secondary" id="my-list" type="button">＋ My List</button>
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

/* ---------- My List toggle (localStorage) ---------- */

function refreshListButton(button) {
  button.textContent = state.inList ? "✓ In My List" : "＋ My List";
  button.setAttribute("aria-pressed", String(state.inList));
}

function setupListButton() {
  const button = $("#my-list");
  state.inList = isInMyList(state.content.id);
  refreshListButton(button);
  button.addEventListener("click", () => {
    if (state.inList) removeFromMyList(state.content.id);
    else addToMyList(state.content.id);
    state.inList = !state.inList;
    refreshListButton(button);
    toast(state.inList ? "Added to My List" : "Removed from My List");
  });
}

/* ---------- Playback: resume + progress saving ---------- */

function setupPlayer() {
  const video = $("#player");
  if (!video) return;
  let lastSaved = -1;

  video.addEventListener("error", () => {
    $("#player-frame").innerHTML =
      '<div class="player-empty"><p>This video can’t be played right now.</p></div>';
  });

  // Resume where this device left off.
  const saved = getProgress(state.content.id);
  if (isResumable(saved)) {
    const apply = () => {
      // Leave a couple of seconds of runway at the very end.
      video.currentTime = Math.min(saved.position, Math.max(0, (video.duration || Infinity) - 2));
      toast(`Resuming from ${formatClock(saved.position)}`);
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
  }

  const save = () => {
    const position = Math.floor(video.currentTime || 0);
    if (!position || position === lastSaved) return;
    lastSaved = position;
    setProgress(state.content.id, position, Math.floor(video.duration || 0));
  };

  setInterval(() => {
    if (!video.paused && !video.ended) save();
  }, 10000);
  video.addEventListener("pause", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
  window.addEventListener("pagehide", save);
}

/* ---------- Boot ---------- */

async function init() {
  if (!id) {
    root.innerHTML = '<p class="status">No title was selected. <a href="browse.html">Back to browse</a>.</p>';
    return;
  }

  const detail = await fetchJson(`/api/content/${encodeURIComponent(id)}`).catch(() => ({
    ok: false,
    status: 0,
  }));

  if (!detail.ok || !detail.data?.content) {
    root.innerHTML =
      detail.status === 404
        ? '<p class="status">This title could not be found. <a href="browse.html">Back to browse</a>.</p>'
        : '<p class="status">This title could not be loaded. Please refresh to try again.</p>';
    return;
  }

  state.content = detail.data.content;

  document.title = `${state.content.title} — StreamFlix`;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", (state.content.description || `Watch ${state.content.title} on StreamFlix.`).slice(0, 300));

  render(state.content, detail.data.related || []);
  setupListButton();
  setupPlayer();
}

init();
