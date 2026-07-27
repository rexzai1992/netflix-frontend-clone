"use strict";

/* ------------------------------------------------------------------ */
/* State and small helpers                                            */
/* ------------------------------------------------------------------ */

const state = {
  csrf: null,
  content: [],
  collections: [],
  settings: {},
  editing: null,
  uploads: 0,
  selectedCollectionId: null,
  media: [],
  mediaTruncated: false,
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = size;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${index === 0 || scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return "";
  let raw = String(value);
  // D1 CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) raw = `${raw.replace(" ", "T")}Z`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function mediaUrlFor(key) {
  return key
    ? `/media/${String(key).split("/").map(encodeURIComponent).join("/")}`
    : null;
}

function message(node, value = "", kind = "") {
  node.textContent = value;
  node.className = `form-message ${kind}`.trim();
}

function toast(text, kind = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`.trim();
  node.textContent = text;
  $("#toasts").append(node);
  setTimeout(() => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 400);
  }, 3800);
}

/* ------------------------------------------------------------------ */
/* API plumbing (CSRF, 401 -> login, 403 -> refresh session + retry)  */
/* ------------------------------------------------------------------ */

function showLogin(notice = "") {
  state.csrf = null;
  $("#studio").hidden = true;
  $("#login-screen").hidden = false;
  if (notice) message($("#login-message"), notice, "error");
}

async function refreshCsrf() {
  try {
    const response = await fetch("/api/admin/session");
    if (!response.ok) return false;
    const data = await response.json();
    if (data && data.csrf) {
      state.csrf = data.csrf;
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

async function api(path, options = {}, retried = false) {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (typeof options.body === "string") headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", state.csrf || "");
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && options.session !== false) {
      showLogin("Your session ended. Sign in again.");
    } else if (response.status === 403 && method !== "GET" && !retried) {
      // Stale CSRF token: refetch the session token and retry once.
      if (await refreshCsrf()) return api(path, options, true);
    }
    const failure = new Error((payload && payload.error) || `Request failed (${response.status})`);
    failure.status = response.status;
    throw failure;
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Auth + data loading                                                */
/* ------------------------------------------------------------------ */

async function authenticate() {
  try {
    const session = await api("/api/admin/session", { session: false });
    state.csrf = session.csrf;
    await enterStudio();
  } catch {
    $("#login-screen").hidden = false;
  }
}

async function enterStudio() {
  $("#login-screen").hidden = true;
  $("#studio").hidden = false;
  try {
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function refreshData() {
  const data = await api("/api/admin/content");
  state.content = data.content;
  state.collections = data.collections;
  state.settings = data.settings;
  renderLibrary();
  renderSettings();
  renderCollectionOptions();
  renderCollections();
  renderCollectionItems();
}

/* ------------------------------------------------------------------ */
/* Panel navigation                                                   */
/* ------------------------------------------------------------------ */

const PANEL_TITLES = {
  library: "Content library",
  collections: "Collections",
  site: "Site settings",
  media: "Media library",
  activity: "Activity",
  security: "Security",
};

function switchPanel(name) {
  $$(".nav-button").forEach((node) => node.classList.toggle("active", node.dataset.panel === name));
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${name}-panel`));
  $("#panel-title").textContent = PANEL_TITLES[name] || name;
  $("#new-content").hidden = name !== "library";
  if (name === "media") loadMedia();
  if (name === "activity") loadAudit();
}

/* ------------------------------------------------------------------ */
/* Library                                                            */
/* ------------------------------------------------------------------ */

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
      <article class="library-card" data-id="${escapeHtml(item.id)}" tabindex="0" role="button">
        <div class="library-poster">
          ${item.poster_url ? `<img src="${escapeHtml(item.poster_url)}" alt="" loading="lazy">` : "No poster"}
          <span class="badge">${escapeHtml(item.type)}</span>
          <span class="poster-badges">
            ${item.featured ? '<span class="badge hero">★ Hero</span>' : ""}
            ${item.published ? "" : '<span class="badge draft">Draft</span>'}
          </span>
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
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Media fields (shared by editor drawer and Site panel)              */
/* ------------------------------------------------------------------ */

const uploadContexts = new Map();

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const IMAGE_KINDS = new Set(["poster", "backdrop", "logo", "landing", "social"]);
const CROP_ASPECTS = { poster: 2 / 3, backdrop: 16 / 9, landing: 16 / 9, social: 16 / 9 };
const CROP_LABELS = { poster: "2:3", backdrop: "16:9", landing: "16:9", social: "16:9" };
const IMAGE_LIMIT = 15 * 1024 * 1024;
const VIDEO_LIMIT = 2 * 1024 * 1024 * 1024;
const CAPTIONS_LIMIT = 2 * 1024 * 1024;
const PART_SIZE = 8 * 1024 * 1024;

function fieldKeyInput(field) {
  return $('input[type="hidden"]', field);
}

function setFieldState(field, text, isError = false) {
  const node = $(".upload-state", field);
  node.textContent = text;
  node.classList.toggle("error", isError);
}

function setPreview(field, url, kind) {
  const preview = $(".media-preview", field);
  if (!url) {
    preview.innerHTML = "No file";
  } else if (kind === "video") {
    preview.innerHTML = `<video src="${escapeHtml(url)}" controls preload="metadata"></video>`;
  } else if (kind === "captions") {
    preview.innerHTML = `<span class="file-chip">WebVTT captions</span>`;
  } else {
    preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
  }
}

function uploadOwnerId(field) {
  if (field.closest("#settings-form")) return "site";
  if (state.editing && state.editing.id) return state.editing.id;
  const title = $("#content-form").elements.title.value.trim();
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-content";
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.addEventListener("load", () => resolve({ img, url }));
    img.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    });
    img.src = url;
  });
}

function videoMetadata(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    const finish = (meta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    video.addEventListener("loadedmetadata", () =>
      finish({
        duration: Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      }));
    video.addEventListener("error", () => finish({}));
    video.src = url;
  });
}

async function chooseFile(field, file) {
  const kind = field.dataset.kind;
  if (uploadContexts.has(field)) {
    toast("Finish or cancel the current upload first.", "error");
    return;
  }
  let blob = file;
  let contentType = file.type;
  let meta = {};

  if (IMAGE_KINDS.has(kind)) {
    if (!IMAGE_TYPES.has(file.type)) {
      setFieldState(field, "Use a JPG, PNG, WebP, or AVIF image.", true);
      return;
    }
    if (file.size > IMAGE_LIMIT) {
      setFieldState(field, "Images are limited to 15 MB.", true);
      return;
    }
    let loaded;
    try {
      loaded = await loadImage(file);
    } catch (error) {
      setFieldState(field, error.message, true);
      return;
    }
    const aspect = CROP_ASPECTS[kind];
    if (aspect) {
      const result = await openCropModal(loaded.img, aspect, kind);
      if (!result) {
        URL.revokeObjectURL(loaded.url);
        return; // cancelled in the crop step
      }
      if (result.original) {
        meta = { width: loaded.img.naturalWidth, height: loaded.img.naturalHeight };
      } else {
        blob = result.blob;
        contentType = "image/webp";
        meta = { width: result.width, height: result.height };
      }
    } else {
      meta = { width: loaded.img.naturalWidth, height: loaded.img.naturalHeight };
    }
    URL.revokeObjectURL(loaded.url);
    if (blob.size > IMAGE_LIMIT) {
      setFieldState(field, "The prepared image is still over 15 MB.", true);
      return;
    }
  } else if (kind === "video") {
    if (!VIDEO_TYPES.has(file.type)) {
      setFieldState(field, "Use an MP4 or WebM video.", true);
      return;
    }
    if (file.size > VIDEO_LIMIT) {
      setFieldState(field, "Videos are limited to 2 GB.", true);
      return;
    }
    setFieldState(field, "Reading video metadata…");
    meta = await videoMetadata(file);
  } else if (kind === "captions") {
    if (file.type !== "text/vtt" && !/\.vtt$/i.test(file.name)) {
      setFieldState(field, "Captions must be a WebVTT (.vtt) file.", true);
      return;
    }
    if (file.size > CAPTIONS_LIMIT) {
      setFieldState(field, "Caption files are limited to 2 MB.", true);
      return;
    }
    contentType = "text/vtt";
  }

  await startUpload(field, kind, blob, contentType, meta);
}

/* ------------------------------------------------------------------ */
/* Uploads: XHR per ~8 MB part, progress, cancel, retry x3 + manual   */
/* ------------------------------------------------------------------ */

function paintProgress(context, currentPartLoaded) {
  const total = context.blob.size || 1;
  const done = Math.min(total, context.uploadedBytes + currentPartLoaded);
  const pct = Math.min(100, Math.round((done / total) * 100));
  $(".progress-fill", context.field).style.width = `${pct}%`;
  setFieldState(context.field, `Uploading ${pct}% · ${formatBytes(done)} of ${formatBytes(total)}`);
}

function sendPart(context, partNumber, chunk) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    context.xhr = xhr;
    const query =
      `action=part&key=${encodeURIComponent(context.key)}` +
      `&uploadId=${encodeURIComponent(context.uploadId)}&partNumber=${partNumber}`;
    xhr.open("PUT", `/api/admin/upload?${query}`);
    xhr.setRequestHeader("x-csrf-token", state.csrf || "");
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      paintProgress(context, Math.min(event.loaded || 0, chunk.size));
    });
    xhr.addEventListener("load", () => {
      context.xhr = null;
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.partNumber) {
        resolve(body);
      } else {
        const failure = new Error((body && body.error) || `Chunk ${partNumber} failed (${xhr.status})`);
        failure.status = xhr.status;
        reject(failure);
      }
    });
    xhr.addEventListener("error", () => {
      context.xhr = null;
      reject(new Error("Network error while uploading."));
    });
    xhr.addEventListener("abort", () => {
      context.xhr = null;
      reject(Object.assign(new Error("Upload cancelled."), { cancelled: true }));
    });
    xhr.send(chunk);
  });
}

async function startUpload(field, kind, blob, contentType, meta) {
  const context = {
    field,
    kind,
    blob,
    contentType,
    meta,
    key: null,
    uploadId: null,
    parts: [],
    partIndex: 0,
    uploadedBytes: 0,
    xhr: null,
    cancelled: false,
  };
  uploadContexts.set(field, context);
  state.uploads += 1;
  $('input[type="file"]', field).disabled = true;
  $(".upload-ui", field).hidden = false;
  $(".upload-retry", field).hidden = true;
  $(".progress-fill", field).style.width = "0%";
  setFieldState(field, "Requesting upload…");
  try {
    const init = await api("/api/admin/upload?action=init", {
      method: "POST",
      body: JSON.stringify({
        contentId: uploadOwnerId(field),
        kind,
        contentType,
        fileSize: blob.size,
      }),
    });
    if (context.cancelled) return;
    context.key = init.key;
    context.uploadId = init.uploadId;
    await runUpload(context);
  } catch (error) {
    if (!context.cancelled) failUpload(context, error, Boolean(context.uploadId));
  }
}

async function runUpload(context) {
  const total = context.blob.size;
  const count = Math.max(1, Math.ceil(total / PART_SIZE));
  while (context.partIndex < count) {
    if (context.cancelled) return;
    const index = context.partIndex;
    const chunk = context.blob.slice(index * PART_SIZE, Math.min(total, (index + 1) * PART_SIZE));
    let part = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !part; attempt += 1) {
      if (context.cancelled) return;
      if (attempt) {
        setFieldState(context.field, `Retrying part ${index + 1} of ${count}…`);
        await delay(600 * 2 ** attempt);
        if (lastError && lastError.status === 403) await refreshCsrf();
      }
      try {
        part = await sendPart(context, index + 1, chunk);
      } catch (error) {
        if (error.cancelled || context.cancelled) return;
        lastError = error;
      }
    }
    if (!part) {
      failUpload(context, lastError || new Error("Upload failed."), true);
      return;
    }
    context.parts.push({ partNumber: part.partNumber, etag: part.etag });
    context.uploadedBytes += chunk.size;
    context.partIndex += 1;
    paintProgress(context, 0);
  }

  setFieldState(context.field, "Finalizing upload…");
  try {
    const done = await api(
      `/api/admin/upload?action=complete&key=${encodeURIComponent(context.key)}` +
        `&uploadId=${encodeURIComponent(context.uploadId)}`,
      { method: "POST", body: JSON.stringify({ parts: context.parts, ...context.meta }) },
    );
    finishUpload(context, done);
  } catch (error) {
    if (context.cancelled) return;
    // 422 means the stored bytes did not match the declared type; the
    // worker already deleted the object, so a retry cannot succeed.
    failUpload(context, error, error.status !== 422);
  }
}

function teardownUpload(context) {
  uploadContexts.delete(context.field);
  state.uploads = Math.max(0, state.uploads - 1);
  $('input[type="file"]', context.field).disabled = false;
  $(".upload-ui", context.field).hidden = true;
}

function finishUpload(context, done) {
  fieldKeyInput(context.field).value = done.key;
  context.field.dataset.dirty = "1";
  setPreview(context.field, done.url, context.kind);
  teardownUpload(context);
  setFieldState(context.field, "Upload complete — save to apply.");
  toast("Upload complete.", "success");
}

function failUpload(context, error, canRetry) {
  setFieldState(context.field, error.message || "Upload failed.", true);
  if (canRetry) {
    // Keep the context alive so Retry can resume from the failed part.
    $(".upload-retry", context.field).hidden = false;
  } else {
    abortRemote(context);
    teardownUpload(context);
  }
  toast(error.message || "Upload failed.", "error");
}

function abortRemote(context) {
  if (!context.key || !context.uploadId) return;
  api(
    `/api/admin/upload?action=abort&key=${encodeURIComponent(context.key)}` +
      `&uploadId=${encodeURIComponent(context.uploadId)}`,
    { method: "DELETE" },
  ).catch(() => {});
}

function cancelUpload(field) {
  const context = uploadContexts.get(field);
  if (!context) return;
  context.cancelled = true;
  if (context.xhr) context.xhr.abort();
  abortRemote(context);
  teardownUpload(context);
  setFieldState(field, "Upload cancelled.");
}

function retryUpload(field) {
  const context = uploadContexts.get(field);
  if (!context || context.cancelled) return;
  $(".upload-retry", field).hidden = true;
  setFieldState(field, "Retrying…");
  runUpload(context).catch((error) => failUpload(context, error, true));
}

function wireMediaFields() {
  $$(".media-field").forEach((field) => {
    const input = $('input[type="file"]', field);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) chooseFile(field, file);
    });
    $(".media-remove", field).addEventListener("click", () => {
      if (uploadContexts.has(field)) {
        toast("Cancel the upload before removing this file.", "error");
        return;
      }
      fieldKeyInput(field).value = "";
      field.dataset.dirty = "1";
      setPreview(field, null, field.dataset.kind);
      setFieldState(field, "Reference cleared — save to apply. The file stays in storage until you run Media → Clean up unused uploads.");
    });
    $(".upload-cancel", field).addEventListener("click", () => cancelUpload(field));
    $(".upload-retry", field).addEventListener("click", () => retryUpload(field));
  });
}

/* ------------------------------------------------------------------ */
/* Crop modal                                                         */
/* ------------------------------------------------------------------ */

const cropState = { img: null, aspect: 1, settle: null };

function cropRect(img, aspect, t) {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  let cw = width;
  let ch = height;
  let x = 0;
  let y = 0;
  if (width / height > aspect) {
    cw = Math.max(1, Math.round(height * aspect));
    x = Math.round((width - cw) * t);
  } else {
    ch = Math.max(1, Math.round(width / aspect));
    y = Math.round((height - ch) * t);
  }
  return { x, y, cw, ch };
}

function drawCrop() {
  if (!cropState.img) return;
  const canvas = $("#crop-canvas");
  const t = Number($("#crop-offset").value) / 100;
  const rect = cropRect(cropState.img, cropState.aspect, t);
  const maxWidth = 460;
  const maxHeight = 320;
  let width = Math.min(maxWidth, maxHeight * cropState.aspect);
  let height = width / cropState.aspect;
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  canvas.getContext("2d").drawImage(
    cropState.img,
    rect.x, rect.y, rect.cw, rect.ch,
    0, 0, canvas.width, canvas.height,
  );
}

function openCropModal(img, aspect, kind) {
  return new Promise((resolve) => {
    cropState.img = img;
    cropState.aspect = aspect;
    cropState.settle = resolve;
    $("#crop-hint").textContent =
      `This slot uses a ${CROP_LABELS[kind] || ""} frame. Slide to choose which part of the image is kept, ` +
      "or keep the original file untouched.";
    $("#crop-offset").value = 50;
    const needsCrop = Math.abs(img.naturalWidth / img.naturalHeight - aspect) > 0.01;
    $("#crop-slider-row").hidden = !needsCrop;
    drawCrop();
    $("#crop-backdrop").hidden = false;
  });
}

function settleCrop(result) {
  $("#crop-backdrop").hidden = true;
  const settle = cropState.settle;
  cropState.settle = null;
  cropState.img = null;
  if (settle) settle(result);
}

function exportCrop() {
  const img = cropState.img;
  const aspect = cropState.aspect;
  const t = Number($("#crop-offset").value) / 100;
  const rect = cropRect(img, aspect, t);
  const scale = Math.min(1, 2560 / rect.cw, 2560 / rect.ch);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.cw * scale));
  canvas.height = Math.max(1, Math.round(rect.ch * scale));
  canvas.getContext("2d").drawImage(img, rect.x, rect.y, rect.cw, rect.ch, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null),
      "image/webp",
      0.9,
    );
  });
}

function wireCropModal() {
  $("#crop-offset").addEventListener("input", drawCrop);
  $("#crop-cancel").addEventListener("click", () => settleCrop(null));
  $("#crop-original").addEventListener("click", () => settleCrop({ original: true }));
  $("#crop-use").addEventListener("click", async () => {
    const result = await exportCrop();
    if (!result) {
      toast("Could not export the cropped image.", "error");
      settleCrop(null);
      return;
    }
    settleCrop(result);
  });
  $("#crop-backdrop").addEventListener("click", (event) => {
    if (event.target === $("#crop-backdrop")) settleCrop(null);
  });
}

/* ------------------------------------------------------------------ */
/* Content editor drawer                                              */
/* ------------------------------------------------------------------ */

function renderCollectionOptions() {
  $("#collection-options").innerHTML = state.collections.length
    ? state.collections.map((collection) => `
      <label>
        <input type="checkbox" name="collection_ids" value="${escapeHtml(collection.id)}">
        ${escapeHtml(collection.title)}${collection.published ? "" : ' <span class="muted">(hidden)</span>'}
      </label>`).join("")
    : '<p class="muted">No collections yet — create some in the Collections panel.</p>';
}

function editorBusy() {
  for (const field of uploadContexts.keys()) {
    if (field.closest("#editor")) return true;
  }
  return false;
}

function settingsBusy() {
  for (const field of uploadContexts.keys()) {
    if (field.closest("#settings-form")) return true;
  }
  return false;
}

function openEditor(item = null) {
  state.editing = item;
  const form = $("#content-form");
  form.reset();
  message($("#content-message"));
  $("#editor-mode").textContent = item ? "Edit content" : "New content";
  $("#editor-title").textContent = item ? item.title : "Add a title";
  $("#delete-content").hidden = !item;

  const hero = state.content.find((entry) => entry.featured);
  const note = $("#hero-note");
  if (item && hero && hero.id === item.id) {
    note.textContent = " This title is the current hero.";
  } else if (hero) {
    note.textContent = ` Current hero: “${hero.title}”.`;
  } else {
    note.textContent = " No hero is set yet.";
  }

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
    input.checked = (values.collection_ids || []).includes(input.value);
  });
  $$(".media-field", form).forEach((field) => {
    const kind = field.dataset.kind;
    delete field.dataset.dirty;
    fieldKeyInput(field).value = values[`${kind}_key`] || "";
    setPreview(field, values[`${kind}_url`], kind);
    setFieldState(field, values[`${kind}_key`] ? "Stored" : "");
  });
  $("#drawer-backdrop").hidden = false;
  $("#editor").hidden = false;
  form.elements.title.focus();
}

function closeEditor() {
  if (editorBusy()) {
    message($("#content-message"), "Wait for uploads to finish, or cancel them.", "error");
    return;
  }
  $("#drawer-backdrop").hidden = true;
  $("#editor").hidden = true;
  state.editing = null;
}

function wireEditor() {
  $("#new-content").addEventListener("click", () => openEditor());
  $("#close-editor").addEventListener("click", closeEditor);
  $("#cancel-editor").addEventListener("click", closeEditor);
  $("#drawer-backdrop").addEventListener("click", closeEditor);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#crop-backdrop").hidden) settleCrop(null);
    else if (!$("#editor").hidden) closeEditor();
  });

  $("#content-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (editorBusy()) {
      message($("#content-message"), "Wait for uploads to finish.", "error");
      return;
    }
    const form = event.currentTarget;
    const submit = $('.editor-actions button[type="submit"]');
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
      await api(path, { method: state.editing ? "PUT" : "POST", body: JSON.stringify(data) });
      message($("#content-message"), "Saved", "success");
      toast(state.editing ? "Title updated." : "Title created.", "success");
      await refreshData();
      setTimeout(closeEditor, 350);
    } catch (error) {
      message($("#content-message"), error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  $("#delete-content").addEventListener("click", async () => {
    if (!state.editing) return;
    if (!confirm(`Delete “${state.editing.title}”? Uploaded files stay in storage until Media cleanup.`)) return;
    try {
      await api(`/api/admin/content/${encodeURIComponent(state.editing.id)}`, { method: "DELETE" });
      toast("Title deleted.", "success");
      await refreshData();
      closeEditor();
    } catch (error) {
      message($("#content-message"), error.message, "error");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Collections panel                                                  */
/* ------------------------------------------------------------------ */

function renderCollections() {
  const list = $("#collection-list");
  if (!state.collections.length) {
    list.innerHTML = '<li class="muted empty">No collections yet. Create one above.</li>';
    return;
  }
  list.innerHTML = state.collections.map((collection, index) => `
    <li class="collection-row${collection.id === state.selectedCollectionId ? " selected" : ""}"
        data-id="${escapeHtml(collection.id)}">
      <div class="collection-main">
        <button type="button" class="collection-select">${escapeHtml(collection.title)}</button>
        <span class="collection-meta">${collection.items.length} title${collection.items.length === 1 ? "" : "s"}${collection.published ? "" : " · hidden from site"}</span>
      </div>
      <div class="collection-tools">
        <button type="button" class="mini-button move-up" ${index === 0 ? "disabled" : ""} aria-label="Move up" title="Move up">↑</button>
        <button type="button" class="mini-button move-down" ${index === state.collections.length - 1 ? "disabled" : ""} aria-label="Move down" title="Move down">↓</button>
        <button type="button" class="mini-button rename">Rename</button>
        <label class="mini-toggle" title="Published on the homepage">
          <input type="checkbox" class="publish-toggle" ${collection.published ? "checked" : ""}>Live
        </label>
        <button type="button" class="mini-button danger delete">Delete</button>
      </div>
    </li>`).join("");

  $$(".collection-row", list).forEach((row) => {
    const id = row.dataset.id;
    const collection = state.collections.find((entry) => entry.id === id);
    $(".collection-select", row).addEventListener("click", () => {
      state.selectedCollectionId = id;
      renderCollections();
      renderCollectionItems();
    });
    $(".move-up", row).addEventListener("click", () => moveCollection(id, -1));
    $(".move-down", row).addEventListener("click", () => moveCollection(id, 1));
    $(".rename", row).addEventListener("click", () => startRename(row, collection));
    $(".publish-toggle", row).addEventListener("change", async (event) => {
      try {
        await api(`/api/admin/collections/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ title: collection.title, published: event.target.checked }),
        });
        toast(event.target.checked ? "Collection published." : "Collection hidden.", "success");
        await refreshData();
      } catch (error) {
        toast(error.message, "error");
        renderCollections();
      }
    });
    $(".delete", row).addEventListener("click", async () => {
      if (!confirm(`Delete the “${collection.title}” collection? Its titles stay in the library.`)) return;
      try {
        await api(`/api/admin/collections/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (state.selectedCollectionId === id) state.selectedCollectionId = null;
        toast("Collection deleted.", "success");
        await refreshData();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

function startRename(row, collection) {
  const main = $(".collection-main", row);
  main.innerHTML = `<input class="rename-input" maxlength="120" aria-label="Collection title">`;
  const input = $(".rename-input", main);
  input.value = collection.title;
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (!title || title === collection.title) {
      renderCollections();
      return;
    }
    try {
      await api(`/api/admin/collections/${encodeURIComponent(collection.id)}`, {
        method: "PUT",
        body: JSON.stringify({ title, published: collection.published }),
      });
      toast("Collection renamed.", "success");
      await refreshData();
    } catch (error) {
      toast(error.message, "error");
      renderCollections();
    }
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      done = true;
      renderCollections();
    }
  });
  input.addEventListener("blur", commit);
}

async function moveCollection(id, delta) {
  const ids = state.collections.map((collection) => collection.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  try {
    await api("/api/admin/collections/order", { method: "PUT", body: JSON.stringify({ ids }) });
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  }
}

function selectedCollection() {
  return state.collections.find((collection) => collection.id === state.selectedCollectionId) || null;
}

async function saveCollectionItems(contentIds) {
  const collection = selectedCollection();
  if (!collection) return;
  try {
    await api(`/api/admin/collections/${encodeURIComponent(collection.id)}/items`, {
      method: "PUT",
      body: JSON.stringify({ content_ids: contentIds }),
    });
    await refreshData();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderCollectionItems() {
  const collection = selectedCollection();
  $("#collection-items-empty").hidden = Boolean(collection);
  $("#collection-items-manager").hidden = !collection;
  if (!collection) return;
  $("#collection-items-title").textContent = collection.title;
  const list = $("#collection-items");
  list.innerHTML = collection.items.length
    ? collection.items.map((item, index) => `
      <li data-id="${escapeHtml(item.id)}">
        <span class="item-title">${escapeHtml(item.title)}
          <small>${escapeHtml(item.type)}${item.year ? ` · ${escapeHtml(item.year)}` : ""}${item.published ? "" : " · draft"}</small>
        </span>
        <span class="item-tools">
          <button type="button" class="mini-button item-up" ${index === 0 ? "disabled" : ""} aria-label="Move up" title="Move up">↑</button>
          <button type="button" class="mini-button item-down" ${index === collection.items.length - 1 ? "disabled" : ""} aria-label="Move down" title="Move down">↓</button>
          <button type="button" class="mini-button danger item-remove">Remove</button>
        </span>
      </li>`).join("")
    : '<li class="muted empty">No titles yet — search above to add some.</li>';

  $$("li[data-id]", list).forEach((row) => {
    const id = row.dataset.id;
    const ids = () => collection.items.map((item) => item.id);
    const up = $(".item-up", row);
    const down = $(".item-down", row);
    if (up) up.addEventListener("click", () => {
      const order = ids();
      const index = order.indexOf(id);
      if (index > 0) {
        [order[index - 1], order[index]] = [order[index], order[index - 1]];
        saveCollectionItems(order);
      }
    });
    if (down) down.addEventListener("click", () => {
      const order = ids();
      const index = order.indexOf(id);
      if (index >= 0 && index < order.length - 1) {
        [order[index], order[index + 1]] = [order[index + 1], order[index]];
        saveCollectionItems(order);
      }
    });
    const remove = $(".item-remove", row);
    if (remove) remove.addEventListener("click", () => {
      saveCollectionItems(ids().filter((entry) => entry !== id));
    });
  });

  renderTitlePicker();
}

function renderTitlePicker() {
  const collection = selectedCollection();
  const results = $("#add-title-results");
  const query = $("#add-title-search").value.trim().toLowerCase();
  if (!collection || !query) {
    results.hidden = true;
    results.innerHTML = "";
    return;
  }
  const present = new Set(collection.items.map((item) => item.id));
  const matches = state.content
    .filter((item) => !present.has(item.id) && item.title.toLowerCase().includes(query))
    .slice(0, 8);
  results.innerHTML = matches.length
    ? matches.map((item) => `
      <button type="button" class="picker-result" data-id="${escapeHtml(item.id)}">
        ${escapeHtml(item.title)}
        <small>${escapeHtml(item.type)}${item.year ? ` · ${escapeHtml(item.year)}` : ""}${item.published ? "" : " · draft"}</small>
      </button>`).join("")
    : '<p class="muted picker-empty">No matching titles.</p>';
  results.hidden = false;
  $$(".picker-result", results).forEach((button) => {
    button.addEventListener("click", () => {
      const active = selectedCollection();
      if (!active) return;
      $("#add-title-search").value = "";
      results.hidden = true;
      saveCollectionItems([...active.items.map((item) => item.id), button.dataset.id]);
    });
  });
}

function wireCollections() {
  $("#collection-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) return;
    try {
      const created = await api("/api/admin/collections", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      input.value = "";
      state.selectedCollectionId = created.id;
      toast("Collection created.", "success");
      await refreshData();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#add-title-search").addEventListener("input", renderTitlePicker);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".picker")) $("#add-title-results").hidden = true;
  });
}

/* ------------------------------------------------------------------ */
/* Site settings panel                                                */
/* ------------------------------------------------------------------ */

const SETTINGS_FIELDS = [
  "site_name",
  "hero_kicker",
  "landing_title",
  "landing_subtitle",
  "seo_description",
];

function renderSettings() {
  const form = $("#settings-form");
  for (const name of SETTINGS_FIELDS) {
    const input = form.elements.namedItem(name);
    if (input && document.activeElement !== input) input.value = state.settings[name] || "";
  }
  $$(".media-field", form).forEach((field) => {
    if (uploadContexts.has(field) || field.dataset.dirty) return;
    const key = state.settings[field.dataset.keyName] || "";
    fieldKeyInput(field).value = key;
    setPreview(field, mediaUrlFor(key), field.dataset.kind);
    setFieldState(field, key ? "Stored" : "");
  });
}

function wireSettings() {
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (settingsBusy()) {
      message($("#settings-message"), "Wait for uploads to finish.", "error");
      return;
    }
    const form = event.currentTarget;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    message($("#settings-message"), "Saving…");
    try {
      const settings = Object.fromEntries(new FormData(form).entries());
      const result = await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      state.settings = result.settings;
      $$(".media-field", form).forEach((field) => delete field.dataset.dirty);
      renderSettings();
      message($("#settings-message"), "Saved", "success");
      toast("Site settings saved.", "success");
    } catch (error) {
      message($("#settings-message"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Media panel                                                        */
/* ------------------------------------------------------------------ */

async function loadMedia() {
  $("#media-summary").textContent = "Loading media…";
  try {
    const data = await api("/api/admin/media");
    state.media = data.items;
    state.mediaTruncated = Boolean(data.truncated);
    renderMedia();
  } catch (error) {
    $("#media-summary").textContent = error.message;
  }
}

function renderMedia() {
  const filter = $("#media-filter").value;
  const items = state.media.filter((item) => filter !== "unused" || !item.in_use);
  const unused = state.media.filter((item) => !item.in_use).length;
  const totalBytes = state.media.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  $("#media-summary").textContent =
    `${state.media.length} file${state.media.length === 1 ? "" : "s"} · ${formatBytes(totalBytes)} total · ` +
    `${unused} unused${state.mediaTruncated ? " · list truncated at 5000 entries" : ""}`;

  $("#media-rows").innerHTML = items.length
    ? items.map((item) => {
        const type = String(item.content_type || "");
        const thumb = type.startsWith("image/")
          ? `<img class="media-thumb" src="${escapeHtml(item.url)}" alt="" loading="lazy">`
          : `<span class="media-icon">${type.startsWith("video/") ? "VIDEO" : type.includes("vtt") ? "VTT" : "FILE"}</span>`;
        return `
        <tr data-key="${escapeHtml(item.key)}">
          <td>${thumb}</td>
          <td class="key-cell"><code>${escapeHtml(item.key)}</code></td>
          <td>${escapeHtml(formatBytes(item.size))}</td>
          <td>${escapeHtml(formatDate(item.uploaded))}</td>
          <td><span class="pill ${item.in_use ? "in-use" : "unused"}">${item.in_use ? "In use" : "Unused"}</span></td>
          <td>
            <button type="button" class="mini-button danger media-delete" ${item.in_use ? 'disabled title="Referenced by a title or site setting"' : ""}>Delete</button>
          </td>
        </tr>`;
      }).join("")
    : '<tr><td colspan="6" class="muted">No files match this filter.</td></tr>';

  $$("#media-rows .media-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = button.closest("tr").dataset.key;
      if (!confirm(`Permanently delete “${key}”?`)) return;
      try {
        await api(`/api/admin/media?key=${encodeURIComponent(key)}`, { method: "DELETE" });
        toast("File deleted.", "success");
        await loadMedia();
      } catch (error) {
        toast(error.message, "error");
        if (error.status === 409) await loadMedia();
      }
    });
  });
}

function wireMediaPanel() {
  $("#media-filter").addEventListener("change", renderMedia);
  $("#media-cleanup").addEventListener("click", async () => {
    const unused = state.media.filter((item) => !item.in_use).length;
    if (!confirm(`Permanently delete every unused uploaded file${unused ? ` (about ${unused})` : ""}? This cannot be undone.`)) return;
    try {
      const result = await api("/api/admin/media/cleanup", { method: "POST" });
      toast(`Deleted ${result.deleted} unused file${result.deleted === 1 ? "" : "s"}.`, "success");
      await loadMedia();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#media-abort-stale").addEventListener("click", async () => {
    try {
      const result = await api("/api/admin/upload?action=cleanup", { method: "POST" });
      toast(`Aborted ${result.aborted} stale upload${result.aborted === 1 ? "" : "s"}.`, "success");
      await loadMedia();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Activity panel                                                     */
/* ------------------------------------------------------------------ */

async function loadAudit() {
  $("#audit-summary").textContent = "Loading activity…";
  try {
    const data = await api("/api/admin/audit");
    $("#audit-summary").textContent =
      `${data.entries.length} recent event${data.entries.length === 1 ? "" : "s"} (newest first)`;
    $("#audit-rows").innerHTML = data.entries.length
      ? data.entries.map((entry) => `
        <tr>
          <td class="nowrap">${escapeHtml(formatDate(entry.created_at))}</td>
          <td>${escapeHtml(entry.actor)}</td>
          <td><code>${escapeHtml(entry.action)}</code></td>
          <td>${escapeHtml(entry.entity || "")}</td>
          <td class="details-cell">${escapeHtml(entry.details || "")}</td>
        </tr>`).join("")
      : '<tr><td colspan="5" class="muted">No activity recorded yet.</td></tr>';
  } catch (error) {
    $("#audit-summary").textContent = error.message;
  }
}

function wireActivity() {
  $("#audit-refresh").addEventListener("click", loadAudit);
}

/* ------------------------------------------------------------------ */
/* Security panel                                                     */
/* ------------------------------------------------------------------ */

function wireSecurity() {
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const current = form.elements.current.value;
    const next = form.elements.next.value;
    const confirmation = form.elements.confirm.value;
    if (next.length < 12) {
      message($("#password-message"), "The new password must be at least 12 characters.", "error");
      return;
    }
    if (next !== confirmation) {
      message($("#password-message"), "The new passwords do not match.", "error");
      return;
    }
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    message($("#password-message"), "Updating…");
    try {
      // session:false — a 401 here means the current password is wrong,
      // not that the session expired.
      await api("/api/admin/password", {
        method: "PUT",
        body: JSON.stringify({ current, next }),
        session: false,
      });
      form.reset();
      message($("#password-message"), "Password updated. Every other admin session was signed out.", "success");
      toast("Admin password updated.", "success");
    } catch (error) {
      message($("#password-message"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Login / logout / nav wiring                                        */
/* ------------------------------------------------------------------ */

function wireShell() {
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    message($("#login-message"), "Signing in…");
    try {
      const result = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: form.elements.password.value }),
        session: false,
      });
      state.csrf = result.csrf;
      form.reset();
      message($("#login-message"));
      await enterStudio();
    } catch (error) {
      message($("#login-message"), error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      /* signing out locally regardless */
    }
    location.reload();
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchPanel(button.dataset.panel));
  });

  $("#library-search").addEventListener("input", renderLibrary);
  $("#library-filter").addEventListener("change", renderLibrary);

  window.addEventListener("beforeunload", (event) => {
    if (state.uploads > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

wireShell();
wireEditor();
wireCollections();
wireSettings();
wireMediaPanel();
wireActivity();
wireSecurity();
wireMediaFields();
wireCropModal();
authenticate();
