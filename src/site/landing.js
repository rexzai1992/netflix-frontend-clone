fetch("/api/content")
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unavailable")))
  .then(({ settings }) => {
    const siteName = settings.site_name || "StreamFlix";
    document.title = siteName;
    document.querySelector("[data-site-name]").textContent = siteName.toUpperCase();
    document.querySelector("#landing-title").textContent =
      settings.landing_title || "Unlimited movies, TV shows, and more.";
    document.querySelector("#landing-subtitle").textContent =
      settings.landing_subtitle || "Watch anywhere. Cancel anytime.";
  })
  .catch(() => {});
