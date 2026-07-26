const state = {
  content: [],
  collections: [],
  settings: {},
  editing: null,
  uploads: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer)) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...options, headers });
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok) {
    const failure = new Error(payload?.error || `Request failed (${response.status})`);
    failure.status = response.status;
    throw failure;
  }
  return payload;
}

function message(node, value = "", kind = "") {
  node.textContent = value;
  node.className = `form-message ${kind}`.trim();
}

async function authenticate() {
  try {
    await api("/api/admin/session");
    await enterStudio();
  } catch {
    $("#login-screen").hidden = false;
  }
}

async function enterStudio() {
  $("#login-screen").hidden = true;
  $("#studio").hidden = false;
  await refresh();
}

async function refresh() {
  const data = await api("/api/admin/content");
  state.content = data.content;
  state.collections = data.collections;
  state.settings = data.settings;
  renderLibrary();
  renderSettings();
  renderCollectionOptions();
}

function filteredLibrary() {
  const query = $("#library-search").value.trim().toLowerCase();
  const filter = $("#library-filter").value;
  return state.content.filter((item) => {
    if (query && !`${item.title} ${item.description}`.toLowerCase().includes(query)) return false;
    if (filter === "draft") return !item.published;
    if (filter && item.type !== filter) return false;
    return true;
  });
}

function renderLibrary() {
  const items = filteredLibrary();
  $("#library-summary").textContent =
    `${items.length} shown · ${state.content.filter((item) => item.published).length} published · ` +
    `${state.content.filter((item) => !item.published).length} drafts`;
  $("#library-grid").innerHTML = items.length
    ? items.map((item) => `
      <article class="library-card" data-id="${escapeHtml(item.id)}" tabindex="0">
        <div class="library-poster">
          ${item.poster_url ? `<img src="${escapeHtml(item.poster_url)}" alt="">` : "No poster"}
          <span class="badge">${escapeHtml(item.type)}</span>
          ${item.published ? "" : '<span class="badge draft">Draft</span>'}
        </div>
        <div class="library-copy">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.year || "No year")} · Order ${escapeHtml(item.sort_order)}</p>
        </div>
      </article>`).join("")
    : '<p class="muted">No titles match this filter.</p>';

  $$(".library-card").forEach((card) => {
    const open = () => openEditor(state.content.find((item) => item.id === card.dataset.id));
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") open();
    });
  });
}

function renderSettings() {
  for (const [key, value] of Object.entries(state.settings)) {
    const input = $(`#settings-form [name="${CSS.escape(key)}"]`);
    if (input) input.value = value;
  }
}

function renderCollectionOptions() {
  $("#collection-options").innerHTML = state.collections.map((collection) => `
    <label>
      <input type="checkbox" name="collection_ids" value="${escapeHtml(collection.id)}">
      ${escapeHtml(collection.title)}
    </label>`).join("");
}

function setPreview(field, url, kind) {
  const preview = $(".media-preview", field);
  if (!url) {
    preview.innerHTML = "No file";
  } else if (kind === "video") {
    preview.innerHTML = `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
  } else {
    preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
  }
}

function openEditor(item = null) {
  state.editing = item;
  const form = $("#content-form");
  form.reset();
  message($("#content-message"));
  $("#editor-mode").textContent = item ? "Edit content" : "New content";
  $("#editor-title").textContent = item ? item.title : "Add a title";
  $("#delete-content").hidden = !item;

  const values = item || {
    type: "movie",
    match_score: 90,
    published: true,
    featured: false,
    sort_order: state.content.length * 10 + 10,
    collection_ids: [],
  };
  for (const [key, value] of Object.entries(values)) {
    const input = form.elements.namedItem(key);
    if (!input || key === "collection_ids") continue;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  }
  $$('[name="collection_ids"]', form).forEach((input) => {
    input.checked = values.collection_ids?.includes(input.value) || false;
  });
  $$(".media-field", form).forEach((field) => {
    const kind = field.dataset.kind;
    setPreview(field, values[`${kind}_url`], kind);
    $(".upload-state", field).textContent = values[`${kind}_key`] ? "Stored in R2" : "";
  });
  $("#drawer-backdrop").hidden = false;
  $("#editor").hidden = false;
  form.elements.title.focus();
}

function closeEditor() {
  if (state.uploads) return;
  $("#drawer-backdrop").hidden = true;
  $("#editor").hidden = true;
  state.editing = null;
}

function contentId() {
  if (state.editing?.id) return state.editing.id;
  const title = $("#content-form").elements.title.value.trim();
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-content";
}

async function uploadFile(file, kind, field) {
  const status = $(".upload-state", field);
  state.uploads += 1;
  status.textContent = "Preparing upload…";
  try {
    const init = await api("/api/admin/upload?action=init", {
      method: "POST",
      body: JSON.stringify({
        contentId: contentId(),
        kind,
        contentType: file.type,
        filename: file.name,
      }),
    });
    const partSize = 8 * 1024 * 1024;
    const parts = [];
    const count = Math.ceil(file.size / partSize);
    for (let index = 0; index < count; index += 1) {
      const partNumber = index + 1;
      const chunk = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
      status.textContent = `Uploading ${Math.round((index / count) * 100)}%…`;
      const part = await api(
        `/api/admin/upload?action=part&key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
        { method: "PUT", body: chunk, headers: { "content-type": "application/octet-stream" } },
      );
      parts.push(part);
    }
    const complete = await api(
      `/api/admin/upload?action=complete&key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}`,
      { method: "POST", body: JSON.stringify({ parts }) },
    );
    $(`[name="${kind}_key"]`, field).value = complete.key;
    setPreview(field, complete.url, kind);
    status.textContent = "Upload complete";
  } catch (error) {
    status.textContent = error.message;
    status.style.color = "#ff7c84";
    throw error;
  } finally {
    state.uploads -= 1;
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type=submit]", form);
  button.disabled = true;
  message($("#login-message"), "Signing in…");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    form.reset();
    await enterStudio();
  } catch (error) {
    message($("#login-message"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
});

$$(".nav-button").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".nav-button").forEach((node) => node.classList.toggle("active", node === button));
    $$(".panel").forEach((panel) => panel.classList.remove("active"));
    $(`#${button.dataset.panel}-panel`).classList.add("active");
    $("#panel-title").textContent =
      button.dataset.panel === "library" ? "Content library" : "Site settings";
    $("#new-content").hidden = button.dataset.panel !== "library";
  });
});

$("#library-search").addEventListener("input", renderLibrary);
$("#library-filter").addEventListener("change", renderLibrary);
$("#new-content").addEventListener("click", () => openEditor());
$("#close-editor").addEventListener("click", closeEditor);
$("#cancel-editor").addEventListener("click", closeEditor);
$("#drawer-backdrop").addEventListener("click", closeEditor);

$$(".media-field input[type=file]").forEach((input) => {
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const field = input.closest(".media-field");
    try {
      await uploadFile(file, field.dataset.kind, field);
      input.value = "";
    } catch {
      // The field-level message already explains the failure.
    }
  });
});

$("#content-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.uploads) {
    message($("#content-message"), "Wait for uploads to finish.", "error");
    return;
  }
  const form = event.currentTarget;
  const submit = $('button[type="submit"]', $(".editor-actions"));
  submit.disabled = true;
  message($("#content-message"), "Saving…");
  const data = Object.fromEntries(new FormData(form).entries());
  data.year = data.year ? Number(data.year) : null;
  data.match_score = Number(data.match_score || 0);
  data.sort_order = Number(data.sort_order || 0);
  data.published = form.elements.published.checked;
  data.featured = form.elements.featured.checked;
  data.collection_ids = $$('[name="collection_ids"]:checked', form).map((input) => input.value);
  try {
    const path = state.editing
      ? `/api/admin/content/${encodeURIComponent(state.editing.id)}`
      : "/api/admin/content";
    await api(path, {
      method: state.editing ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    message($("#content-message"), "Saved", "success");
    await refresh();
    setTimeout(closeEditor, 350);
  } catch (error) {
    message($("#content-message"), error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

$("#delete-content").addEventListener("click", async () => {
  if (!state.editing) return;
  if (!confirm(`Delete “${state.editing.title}”? Uploaded media will remain in R2.`)) return;
  try {
    await api(`/api/admin/content/${encodeURIComponent(state.editing.id)}`, { method: "DELETE" });
    await refresh();
    closeEditor();
  } catch (error) {
    message($("#content-message"), error.message, "error");
  }
});

$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  message($("#settings-message"), "Saving…");
  try {
    const settings = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    state.settings = result.settings;
    message($("#settings-message"), "Saved", "success");
  } catch (error) {
    message($("#settings-message"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

authenticate();
