import { $, escapeHtml, mediaUrl, fetchSession, detailUrl } from "./site.js";

const setMeta = (selector, value) => {
  if (value) document.querySelector(selector)?.setAttribute("content", value);
};

function applySession(session) {
  if (!session.authenticated) return;
  const browse = '<a class="button button-primary" href="/user_dashboard/browse.html">Browse</a>';
  $("#landing-actions").innerHTML = browse;
  const top = $("#top-auth");
  top.textContent = "Browse";
  top.href = "/user_dashboard/browse.html";
}

function applyContent(payload) {
  const settings = payload.settings || {};
  const content = (payload.content || []).filter((item) => item.published);

  const siteName = settings.site_name || "StreamFlix";
  document.title = `${siteName} — Unlimited movies, TV shows, and more`;
  document.querySelectorAll("[data-site-name]").forEach((node) => {
    node.textContent = siteName.toUpperCase();
  });
  document.querySelectorAll("[data-site-name-plain]").forEach((node) => {
    node.textContent = siteName;
  });

  if (settings.attribution) {
    const attribution = $("#footer-attribution");
    attribution.textContent = settings.attribution;
    attribution.hidden = false;
  }

  if (settings.hero_kicker) $("#landing-kicker").textContent = settings.hero_kicker;
  if (settings.landing_title) $("#landing-title").textContent = settings.landing_title;
  if (settings.landing_subtitle) $("#landing-subtitle").textContent = settings.landing_subtitle;

  // SEO/meta refinements from runtime settings.
  setMeta('meta[name="description"]', settings.seo_description);
  setMeta('meta[property="og:description"]', settings.seo_description);
  setMeta('meta[name="twitter:description"]', settings.seo_description);
  setMeta('meta[property="og:site_name"]', settings.site_name);
  if (settings.social_image_key) {
    setMeta('meta[property="og:image"]', mediaUrl(settings.social_image_key));
  }

  // Hero backdrop: settings key, else the featured title's backdrop, else the CSS gradient.
  const featured = content.find((item) => item.featured) || content[0];
  const backdrop = settings.landing_backdrop_key
    ? mediaUrl(settings.landing_backdrop_key)
    : featured?.backdrop_url || "";
  if (backdrop) {
    $("#landing-hero").style.backgroundImage = `url("${encodeURI(backdrop).replace(/"/g, "%22")}")`;
  }

  // Poster teaser row.
  const teasers = content.filter((item) => item.poster_url).slice(0, 10);
  if (teasers.length) {
    $("#teaser-row").innerHTML = teasers
      .map(
        (item) => `
          <a href="${detailUrl(item)}" aria-label="View ${escapeHtml(item.title)}">
            <img src="${escapeHtml(item.poster_url)}" alt="${escapeHtml(item.title)}" loading="lazy">
          </a>`
      )
      .join("");
    $("#landing-teaser").hidden = false;
  }
}

async function init() {
  const [session, payload] = await Promise.all([
    fetchSession(),
    fetch("/api/content")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
  ]);
  applySession(session);
  if (payload) applyContent(payload);
}

init();
