import {
  $,
  apiWrite,
  escapeHtml,
  fetchJson,
  fetchSession,
  formatDate,
} from "./site.js";

const state = { me: null, csrf: null, plans: null, billingMode: null };

const PLAN_LABELS = { monthly: "Monthly", yearly: "Yearly" };

function notice(message, warn = false) {
  const box = $("#checkout-notice");
  box.textContent = message || "";
  box.hidden = !message;
  box.classList.toggle("warn", warn);
}

function price(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function loadPlans() {
  if (state.plans) return state.plans;
  const { ok, data } = await fetchJson("/api/billing/plans");
  if (ok && data) {
    state.plans = data.plans || [];
    state.billingMode = data.mode;
  } else {
    state.plans = [];
  }
  return state.plans;
}

function subscriptionFacts(sub) {
  const badge = sub.entitled
    ? '<span class="badge badge-ok">Entitled to watch</span>'
    : '<span class="badge badge-off">Not entitled</span>';
  const renewal = sub.cancel_at_period_end
    ? `Cancels at ${escapeHtml(formatDate(sub.current_period_end))}`
    : `Renews ${escapeHtml(formatDate(sub.current_period_end))}`;
  return `
    <dl class="sub-facts">
      <div><dt>Plan</dt><dd>${escapeHtml(PLAN_LABELS[sub.plan] || sub.plan || "—")}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(sub.status || "—")} ${badge}</dd></div>
      <div><dt>${sub.cancel_at_period_end ? "Ends" : "Renewal"}</dt><dd>${renewal}</dd></div>
    </dl>`;
}

async function renderSubscription() {
  const body = $("#subscription-body");
  const sub = state.me?.subscription;

  if (sub && sub.entitled) {
    body.innerHTML = `
      ${subscriptionFacts(sub)}
      ${
        sub.cancel_at_period_end
          ? '<p class="hint">Your subscription is set to end — you keep access until then.</p>'
          : '<button class="button button-danger" id="cancel-sub" type="button">Cancel subscription</button>'
      }`;
    $("#cancel-sub")?.addEventListener("click", cancelSubscription);
    return;
  }

  body.innerHTML = `
    ${sub ? subscriptionFacts(sub) : ""}
    <p class="hint">You need a subscription to watch. Pick a plan to get started:</p>
    <div class="plan-grid" id="plan-grid"><p class="hint">Loading plans…</p></div>`;

  const plans = await loadPlans();
  const grid = $("#plan-grid");
  if (!plans.length) {
    grid.innerHTML = '<p class="hint">Plans are unavailable right now. Please try again later.</p>';
    return;
  }
  grid.innerHTML = plans
    .map(
      (plan) => `
        <div class="plan-card">
          <h3>${escapeHtml(plan.name || PLAN_LABELS[plan.id] || plan.id)}</h3>
          <span class="plan-price">${price(plan.price_cents)} <small>/ ${escapeHtml(plan.interval || plan.id)}</small></span>
          <button class="button button-primary" type="button" data-plan="${escapeHtml(plan.id)}">Subscribe</button>
        </div>`
    )
    .join("");
  grid.querySelectorAll("[data-plan]").forEach((button) => {
    button.addEventListener("click", () => startCheckout(button.dataset.plan, button));
  });
}

async function startCheckout(plan, button) {
  notice("");
  button.disabled = true;
  try {
    const { ok, data } = await apiWrite("/api/billing/checkout", {
      csrf: state.csrf,
      body: { plan },
    });
    if (!ok) {
      notice(data?.error || "Checkout could not be started. Please try again.", true);
      return;
    }
    if (data.mode === "stripe" && data.url) {
      location.href = data.url;
      return;
    }
    showDemoCheckout(data.plan || plan);
  } catch {
    notice("Could not reach StreamFlix. Please try again.", true);
  } finally {
    button.disabled = false;
  }
}

function showDemoCheckout(plan) {
  const body = $("#subscription-body");
  const panel = document.createElement("div");
  panel.className = "demo-panel";
  panel.innerHTML = `
    <h3>Demo checkout</h3>
    <p>This is a demo environment — no real payment will be taken. Activate the ${escapeHtml(
      (PLAN_LABELS[plan] || plan || "").toLowerCase()
    )} plan to unlock playback.</p>
    <div class="demo-actions">
      <button class="button button-primary" id="demo-activate" type="button">Activate plan</button>
      <button class="button button-secondary" id="demo-back" type="button">Back</button>
    </div>`;
  body.querySelector(".demo-panel")?.remove();
  body.append(panel);
  $("#demo-back").addEventListener("click", () => panel.remove());
  $("#demo-activate").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const { ok, data } = await apiWrite("/api/billing/dev-activate", {
      csrf: state.csrf,
      body: { plan },
    });
    if (ok) {
      state.me.subscription = data.subscription;
      notice("Your subscription is active. Enjoy!");
      renderSubscription();
    } else {
      notice(data?.error || "Activation failed. Please try again.", true);
      event.target.disabled = false;
    }
  });
}

async function cancelSubscription(event) {
  const confirmed = confirm(
    "Cancel your subscription? You keep access until the end of the current billing period."
  );
  if (!confirmed) return;
  event.currentTarget.disabled = true;
  const { ok, data } = await apiWrite("/api/billing/cancel", { csrf: state.csrf });
  if (ok) {
    state.me.subscription = data.subscription;
    notice("Your subscription will end at the end of the current period.", true);
  } else {
    notice(data?.error || "Cancelation failed. Please try again.", true);
  }
  renderSubscription();
}

function setupPasswordForm() {
  const form = $("#password-form");
  const errorBox = $("#password-error");
  const messageBox = $("#password-message");
  const show = (box, message) => {
    box.textContent = message || "";
    box.hidden = !message;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show(errorBox, "");
    show(messageBox, "");

    const current = $("#current-password").value;
    const next = $("#new-password").value;
    if (next.length < 8) return show(errorBox, "Your new password must be at least 8 characters.");
    if ($("#confirm-password").value !== next) return show(errorBox, "New passwords do not match.");

    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const { ok, data } = await apiWrite("/api/me/password", {
        method: "PUT",
        csrf: state.csrf,
        body: { current, next },
      });
      if (!ok) {
        show(errorBox, data?.error || "Password change failed. Please try again.");
        return;
      }
      form.reset();
      show(messageBox, "Password updated. Your other devices have been signed out.");
      // The session may have been rotated — refresh the CSRF token.
      const refreshed = await fetchJson("/api/me");
      if (refreshed.ok) {
        state.me = refreshed.data;
        state.csrf = refreshed.data.csrf;
      }
    } catch {
      show(errorBox, "Could not reach StreamFlix. Please try again.");
    } finally {
      submit.disabled = false;
    }
  });
}

function setupSignOut() {
  $("#sign-out").addEventListener("click", async () => {
    try {
      await apiWrite("/api/auth/logout");
    } catch {
      // Even if the request fails, send the viewer home.
    }
    location.href = "/";
  });
}

function handleCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get("checkout");
  if (!outcome) return;
  if (outcome === "success") {
    notice("Payment complete — your subscription is being activated.");
  } else if (outcome === "canceled") {
    notice("Checkout canceled — you have not been charged.", true);
  }
  history.replaceState(null, "", location.pathname);
}

async function init() {
  setupSignOut();
  handleCheckoutReturn();

  const session = await fetchSession();
  if (!session.authenticated) {
    location.replace(`/login.html?next=${encodeURIComponent("/account/")}`);
    return;
  }

  const { ok, status, data } = await fetchJson("/api/me");
  if (!ok) {
    if (status === 401) {
      location.replace(`/login.html?next=${encodeURIComponent("/account/")}`);
      return;
    }
    $("#account-status").textContent = "Your account could not be loaded. Please refresh to try again.";
    return;
  }

  state.me = data;
  state.csrf = data.csrf;
  $("#account-status").textContent = "";
  $("#account-email").textContent = data.user?.display_name
    ? `${data.user.display_name} (${data.user.email})`
    : data.user?.email || "";

  ["#profile-panel", "#subscription-panel", "#password-panel"].forEach((id) => {
    $(id).hidden = false;
  });
  setupPasswordForm();
  renderSubscription();
}

init();
