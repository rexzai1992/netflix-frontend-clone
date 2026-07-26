const view = document.documentElement.dataset.view || "home";
const state = { payload: null, query: "" };

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

function detailUrl(item) {
  return `single.html?id=${encodeURIComponent(item.id)}`;
}

function mediaMarkup(item) {
  if (item.poster_url) {
    return `<img src="${escapeHtml(item.poster_url)}" alt="" loading="lazy">`;
  }
  return `<div class="card-fallback">${escapeHtml(item.title)}</div>`;
}

function card(item) {
  return `
    <a class="content-card" href="${detailUrl(item)}" aria-label="View ${escapeHtml(item.title)}">
      ${mediaMarkup(item)}
      <span class="card-info">
        <span class="card-title">${escapeHtml(item.title)}</span>
        <span class="card-meta">${escapeHtml(item.year || "")} · ${escapeHtml(item.maturity_rating || item.type)}</span>
      </span>
    </a>`;
}

function row(title, items) {
  if (!items.length) return "";
  return `
    <section class="catalog-row">
      <div class="row-head">
        <h2>${escapeHtml(title)}</h2>
        <span>${items.length} title${items.length === 1 ? "" : "s"}</span>
      </div>
      <div class="card-grid">${items.map(card).join("")}</div>
    </section>`;
}

function filteredContent() {
  const all = state.payload?.content || [];
  if (view === "movies") return all.filter((item) => item.type === "movie");
  if (view === "shows") return all.filter((item) => item.type === "show");
  if (view === "latest") {
    return [...all].sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  if (view === "mylist") {
    const saved = new Set(JSON.parse(localStorage.getItem("streamflix_mylist") || "[]"));
    return all.filter((item) => saved.has(item.id));
  }
  if (view === "search") {
    const query = state.query.toLowerCase();
    return query
      ? all.filter((item) =>
          `${item.title} ${item.description}`.toLowerCase().includes(query))
      : all;
  }
  return all;
}

function renderRows() {
  const target = $("#catalog-rows");
  const status = $("#catalog-status");
  if (view === "home") {
    const rows = (state.payload?.collections || [])
      .filter((collection) => collection.slug !== "featured")
      .map((collection) => row(collection.title, collection.items))
      .join("");
    target.innerHTML = rows || '<div class="empty">No published collections yet.</div>';
  } else {
    const labels = {
      movies: "Movies",
      shows: "TV Shows",
      latest: "Latest releases",
      mylist: "My List",
      search: state.query ? `Results for “${state.query}”` : "Browse all titles",
    };
    const items = filteredContent();
    target.innerHTML = items.length
      ? row(labels[view] || "Titles", items)
      : '<div class="empty">No matching titles found. Add or publish content from the Manage page.</div>';
  }
  status.textContent = "";
}

function renderHero() {
  const content = state.payload?.content || [];
  const hero =
    content.find((item) => item.featured) ||
    content[0];
  if (!hero) {
    $("#hero-title").textContent = "Your catalog is ready for content";
    $("#hero-description").textContent = "Open Manage to add the first title.";
    return;
  }

  $("#hero-title").textContent = hero.title;
  $("#hero-description").textContent = hero.description;
  $("#hero-kicker").textContent =
    state.payload.settings.hero_kicker || "Featured today";
  $("#hero-play").href = detailUrl(hero);
  $("#hero-info").href = detailUrl(hero);
  $("#hero-meta").innerHTML = [
    hero.match_score ? `<span class="match">${hero.match_score}% Match</span>` : "",
    hero.year ? `<span>${hero.year}</span>` : "",
    hero.maturity_rating ? `<span>${escapeHtml(hero.maturity_rating)}</span>` : "",
    hero.duration ? `<span>${escapeHtml(hero.duration)}</span>` : "",
  ].join("");

  $("#hero-logo").innerHTML = hero.logo_url
    ? `<img src="${escapeHtml(hero.logo_url)}" alt="${escapeHtml(hero.title)}">`
    : "";
  const heroMedia = $("#hero-media");
  if (hero.video_url) {
    heroMedia.innerHTML = `
      <video muted loop playsinline poster="${escapeHtml(hero.backdrop_url || hero.poster_url || "")}">
        <source src="${escapeHtml(hero.video_url)}">
      </video>`;
    const video = heroMedia.querySelector("video");
    setTimeout(() => video.play().catch(() => {}), 1200);
  } else if (hero.backdrop_url || hero.poster_url) {
    heroMedia.innerHTML = `<img src="${escapeHtml(hero.backdrop_url || hero.poster_url)}" alt="">`;
  }
}

async function load() {
  try {
    const response = await fetch("/api/content");
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    state.payload = await response.json();
    const siteName = state.payload.settings.site_name || "StreamFlix";
    document.title = `${siteName} — Watch movies and shows`;
    document.querySelectorAll("[data-site-name]").forEach((node) => {
      node.textContent = siteName.toUpperCase();
    });
    renderHero();
    renderRows();
  } catch (cause) {
    $("#catalog-status").textContent = cause.message;
    $("#catalog-rows").innerHTML =
      '<div class="empty">The catalog could not be loaded. Please try again shortly.</div>';
  }
}

document.querySelector(`[data-route="${view}"]`)?.classList.add("active");
window.addEventListener("scroll", () => {
  $("#topbar").classList.toggle("scrolled", window.scrollY > 30);
});
$(".nav-toggle").addEventListener("click", (event) => {
  const nav = $(".main-nav");
  const open = nav.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

if (view === "search") {
  $("#search-panel").hidden = false;
  $("#catalog-search").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderRows();
  });
}

load();
