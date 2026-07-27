import { $, apiWrite, fetchSession, safeNextPath } from "./site.js";

const mode = document.body.dataset.auth === "signup" ? "signup" : "login";
const next = new URLSearchParams(location.search).get("next");
const destination = safeNextPath(next);

// Carry ?next= across the login/signup cross-link.
const alt = $("#alt-link");
if (alt && next) alt.href += `?next=${encodeURIComponent(next)}`;

// Already signed in? Skip the form.
fetchSession().then((session) => {
  if (session.authenticated) location.replace(destination);
});

const form = $("#auth-form");
const errorBox = $("#auth-error");

function showError(message) {
  errorBox.textContent = message || "";
  errorBox.hidden = !message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

  const email = $("#email").value.trim();
  const password = $("#password").value;
  if (!email || !email.includes("@")) return showError("Enter a valid email address.");
  if (password.length < 8) return showError("Your password must be at least 8 characters.");
  if (mode === "signup" && $("#confirm").value !== password) {
    return showError("Passwords do not match.");
  }

  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const { ok, status, data } = await apiWrite(path, { body: { email, password } });
    if (!ok) {
      const fallback =
        status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "Something went wrong. Please try again.";
      showError(data?.error || fallback);
      return;
    }
    location.replace(destination);
  } catch {
    showError("Could not reach StreamFlix. Check your connection and try again.");
  } finally {
    submit.disabled = false;
  }
});
