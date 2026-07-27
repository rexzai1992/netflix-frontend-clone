// Catalog shell shared by every /user_dashboard/ view; data-view selects the page.
import {
  $,
  apiWrite,
  cardMarkup,
  detailUrl,
  escapeHtml,
  fetchJson,
  fetchMe,
  fetchSession,
  toast,
} from "./site.js";

const view = document.documentElement.dataset.view || "home";
const state = {
  payload: null,
  query: "",
  session: { authenticated: false },
  me: null, // /api/me payload when authenticated (csrf + subscription)
  continueItems: [],
  myList: null, // null until loaded; [] when empty
};

const VIEW_TITLES = {
  home: "Browse",
  movies: "Movies",
  shows: "TV Shows",
  latest: "Latest",
  mylist: "My List",
  search: "Search",
};

const entitled = () => Boolean(state.me?.subscription?.entitled);

/* ---------- Header / user menu ---------- */

function renderUserMenu() {
  const menu = $("#user-menu");
  if (!state.session.authenticated) {
    menu.innerHTML = `<a class="pill-link" href="/login.html?next=${encodeURIComponent(
      location.pathname
    )}">Sign In</a>`;
    return;
  }
  menu.innerHTML = `
    <a class="pill-link" href="/account/">Account</a>
    <button class="pill-link" id="sign-out" type="button">Sign Out</button>`;
  $("#sign-out").addEventListener("click", async () => {
    try {
      await apiWrite("/api/auth/logout");
    } catch {
      // Send the viewer home regardless.
    }
    location.href = "/";
  });
}

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

function row(title, items, { progress = false, removable = false } = {}) {
  if (!items.length) return "";
  const cards = items
    .map((item) => {
      const fraction =
        progress && item.duration_seconds > 0
          ? item.position_seconds / item.duration_seconds
          : undefined;
      const card = cardMarkup(item, { progress: fraction });
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

function renderMyList() {
  const target = $("#catalog-rows");
  if (!state.session.authenticated) {
    target.innerHTML = `
      <div class="empty empty-cta">
        <p>Sign in to keep a list of titles you want to watch.</p>
        <a class="button button-primary" href="/login.html?next=${encodeURIComponent(
          location.pathname
        )}">Sign In</a>
      </div>`;
    return;
  }
  const items = state.myList || [];
  target.innerHTML = items.length
    ? row("My List", items, { removable: true })
    : '<div class="empty">Your list is empty. Browse the catalog and tap “＋ My List” on any title.</div>';
  target.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      const id = button.dataset.remove;
      const { ok, data } = await apiWrite(`/api/me/list/${encodeURIComponent(id)}`, {
        method: "DELETE",
        csrf: state.me?.csrf,
      });
      if (ok) {
        state.myList = (state.myList || []).filter((item) => item.id !== id);
        toast("Removed from My List");
        renderMyList();
      } else {
        button.disabled = false;
        toast(data?.error || "Could not update your list. Please try again.");
      }
    });
  });
}

function renderRows() {
  const target = $("#catalog-rows");
  $("#catalog-status").textContent = "";
  $("#catalog-error").hidden = true;

  if (view === "mylist") {
    renderMyList();
    return;
  }

  if (view === "home") {
    const continueRow =
      state.session.authenticated && state.continueItems.length
        ? row("Continue Watching", state.continueItems, { progress: true })
        : "";
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
  // Autoplaying the preview requests the media file, which is gated to
  // subscribers — only try when we know this viewer is entitled.
  if (hero.video_url && entitled()) {
    heroMedia.innerHTML = `
      <video muted loop playsinline poster="${escapeHtml(still)}">
        <source src="${escapeHtml(hero.video_url)}">
      </video>`;
    const video = heroMedia.querySelector("video");
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

  const [session, catalog] = await Promise.all([fetchSession(), fetchJson("/api/content").catch(() => ({ ok: false }))]);
  state.session = session;
  renderUserMenu();

  if (session.authenticated) {
    const wantsContinue = view === "home";
    const wantsList = view === "mylist";
    const [me, cont, list] = await Promise.all([
      fetchMe(),
      wantsContinue ? fetchJson("/api/me/continue").catch(() => ({ ok: false })) : null,
      wantsList ? fetchJson("/api/me/list").catch(() => ({ ok: false })) : null,
    ]);
    state.me = me;
    state.continueItems = cont?.ok ? cont.data?.items || [] : [];
    state.myList = list?.ok ? list.data?.items || [] : [];
  }

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
