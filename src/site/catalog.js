// Catalog shell shared by every /user_dashboard/ view; data-view selects the page.
// Everything here is open — no sign-in, no entitlement checks.
import {
  $,
  cardMarkup,
  detailUrl,
  escapeHtml,
  fetchJson,
  getMyList,
  listProgress,
  removeFromMyList,
  toast,
} from "./site.js";

const view = document.documentElement.dataset.view || "home";
const state = {
  payload: null,
  query: "",
};

const VIEW_TITLES = {
  home: "Browse",
  movies: "Movies",
  shows: "TV Shows",
  latest: "Latest",
  mylist: "My List",
  search: "Search",
};

const contentById = (id) =>
  (state.payload?.content || []).find((item) => item.id === id) || null;

/* ---------- Loading / error states ---------- */

function renderSkeletons() {
  const cards = '<div class="skeleton-card"></div>'.repeat(6);
  $("#catalog-rows").innerHTML = `
    <section class="catalog-row" aria-hidden="true">
      <div class="skeleton-line"></div>
      <div class="card-grid">${cards}</div>
    </section>
    <section class="catalog-row" aria-hidden="true">
      <div class="skeleton-line"></div>
      <div class="card-grid">${cards}</div>
    </section>`;
}

function showError(message) {
  $("#catalog-status").textContent = "";
  $("#catalog-rows").innerHTML = "";
  $("#catalog-error-message").textContent = message;
  $("#catalog-error").hidden = false;
  $("#hero-title").textContent = "Something went wrong";
  $("#hero-description").textContent = "We could not load the catalog right now.";
}

/* ---------- Rows ---------- */

// Items may carry a `progress_fraction` (0–1) for the Continue Watching row.
function row(title, items, { removable = false } = {}) {
  if (!items.length) return "";
  const cards = items
    .map((item) => {
      const card = cardMarkup(item, { progress: item.progress_fraction });
      if (!removable) return card;
      return `
        <div class="card-holder">
          ${card}
          <button class="card-remove" type="button" data-remove="${escapeHtml(item.id)}"
            aria-label="Remove ${escapeHtml(item.title)} from My List">✕</button>
        </div>`;
    })
    .join("");
  return `
    <section class="catalog-row">
      <div class="row-head">
        <h2>${escapeHtml(title)}</h2>
        <span>${items.length} title${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="card-grid">${cards}</div>
    </section>`;
}

function filteredContent() {
  const all = state.payload?.content || [];
  if (view === "movies") return all.filter((item) => item.type === "movie");
  if (view === "shows") return all.filter((item) => item.type === "show");
  if (view === "latest") return [...all].sort((a, b) => (b.year || 0) - (a.year || 0));
  if (view === "search") {
    const query = state.query.toLowerCase();
    return query
      ? all.filter((item) =>
          `${item.title} ${item.description}`.toLowerCase().includes(query))
      : all;
  }
  return all;
}

/* ---------- Local state rows (My List, Continue Watching) ---------- */

function myListItems() {
  return getMyList()
    .map(contentById)
    .filter(Boolean);
}

function continueItems() {
  return listProgress(12)
    .map((entry) => {
      const item = contentById(entry.id);
      if (!item) return null;
      return {
        ...item,
        progress_fraction:
          entry.duration > 0 ? entry.position / entry.duration : undefined,
      };
    })
    .filter(Boolean);
}

function renderMyList() {
  const target = $("#catalog-rows");
  const items = myListItems();
  target.innerHTML = items.length
    ? row("My List", items, { removable: true })
    : '<div class="empty">Nothing saved yet — tap the ＋ on any title.</div>';
  target.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      removeFromMyList(button.dataset.remove);
      toast("Removed from My List");
      renderMyList();
    });
  });
}

/* ---------- View rendering ---------- */

function renderRows() {
  const target = $("#catalog-rows");
  $("#catalog-status").textContent = "";
  $("#catalog-error").hidden = true;

  if (view === "mylist") {
    renderMyList();
    return;
  }

  if (view === "home") {
    const resumable = continueItems();
    const continueRow = resumable.length ? row("Continue Watching", resumable) : "";
    const rows = (state.payload?.collections || [])
      .filter((collection) => collection.slug !== "featured")
      .map((collection) => row(collection.title, collection.items))
      .join("");
    target.innerHTML =
      continueRow + rows || '<div class="empty">No published collections yet. Check back soon.</div>';
    return;
  }

  const labels = {
    movies: "Movies",
    shows: "TV Shows",
    latest: "Latest releases",
    search: state.query ? `Results for “${state.query}”` : "Browse all titles",
  };
  const items = filteredContent();
  const emptyMessage =
    view === "search" && state.query
      ? `No results for “${escapeHtml(state.query)}”. Try a different search.`
      : "No titles here yet. Check back soon.";
  target.innerHTML = items.length
    ? row(labels[view] || "Titles", items)
    : `<div class="empty">${emptyMessage}</div>`;
}

/* ---------- Hero ---------- */

function renderHero() {
  const content = state.payload?.content || [];
  const hero = content.find((item) => item.featured) || content[0];
  if (!hero) {
    $("#hero-title").textContent = "Nothing is streaming yet";
    $("#hero-description").textContent = "New movies and shows are on the way.";
    return;
  }

  $("#hero-title").textContent = hero.title;
  $("#hero-description").textContent = hero.description || "";
  $("#hero-kicker").textContent = state.payload.settings?.hero_kicker || "Featured today";
  $("#hero-play").href = detailUrl(hero);
  $("#hero-info").href = detailUrl(hero);
  $("#hero-actions").hidden = false;
  $("#hero-meta").innerHTML = [
    hero.match_score ? `<span class="match">${Number(hero.match_score) || 0}% Match</span>` : "",
    hero.year ? `<span>${escapeHtml(hero.year)}</span>` : "",
    hero.maturity_rating ? `<span>${escapeHtml(hero.maturity_rating)}</span>` : "",
    hero.duration ? `<span>${escapeHtml(hero.duration)}</span>` : "",
  ].join("");

  $("#hero-logo").innerHTML = hero.logo_url
    ? `<img src="${escapeHtml(hero.logo_url)}" alt="${escapeHtml(hero.title)}">`
    : "";

  const heroMedia = $("#hero-media");
  const still = hero.backdrop_url || hero.poster_url || "";
  if (hero.video_url) {
    heroMedia.innerHTML = `
      <video muted loop playsinline poster="${escapeHtml(still)}">
        <source src="${escapeHtml(hero.video_url)}">
      </video>`;
    const video = heroMedia.querySelector("video");
    // Fall back to the still if the browser refuses to autoplay the preview.
    video.addEventListener("error", () => {
      if (still) heroMedia.innerHTML = `<img src="${escapeHtml(still)}" alt="">`;
    });
    setTimeout(() => video.play().catch(() => {}), 1200);
  } else if (still) {
    heroMedia.innerHTML = `<img src="${escapeHtml(still)}" alt="">`;
  }
}

/* ---------- Load ---------- */

function applySiteName() {
  const siteName = state.payload?.settings?.site_name || "StreamFlix";
  document.title = `${VIEW_TITLES[view] || "Browse"} — ${siteName}`;
  document.querySelectorAll("[data-site-name]").forEach((node) => {
    node.textContent = siteName.toUpperCase();
  });
  document.querySelectorAll("[data-site-name-plain]").forEach((node) => {
    node.textContent = siteName;
  });
  const attribution = state.payload?.settings?.attribution;
  if (attribution) {
    const node = $("#footer-attribution");
    node.textContent = attribution;
    node.hidden = false;
  }
}

async function load() {
  $("#catalog-error").hidden = true;
  $("#catalog-status").textContent = "Loading titles…";
  renderSkeletons();

  const catalog = await fetchJson("/api/content").catch(() => ({ ok: false }));
  if (!catalog.ok || !catalog.data) {
    showError("The catalog could not be loaded. Check your connection and try again.");
    return;
  }
  state.payload = catalog.data;
  applySiteName();
  renderHero();
  renderRows();
}

/* ---------- Chrome wiring ---------- */

document.querySelector(`[data-route="${view}"]`)?.classList.add("active");

window.addEventListener("scroll", () => {
  $("#topbar").classList.toggle("scrolled", window.scrollY > 30);
});

$(".nav-toggle").addEventListener("click", (event) => {
  const nav = $(".main-nav");
  const open = nav.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

$("#catalog-retry").addEventListener("click", load);

if (view === "search") {
  $("#search-panel").hidden = false;
  const input = $("#catalog-search");
  input.addEventListener("input", () => {
    state.query = input.value.trim();
    if (state.payload) renderRows();
  });
  input.focus();
}

load();
