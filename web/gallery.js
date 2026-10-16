/**
 * Image Gallery Loader - front end.
 *
 * Adds an inline, mobile-gallery-style browser to the ImageGalleryLoader node,
 * plus a settings window where folder paths and gallery preferences are configured.
 *
 * READ-ONLY: this file never asks the server to delete, move, rename, copy or
 * create anything, and it never uploads a file. It browses, previews, selects.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "ImageGalleryLoader";
const EXT_NAME = "comfy.imagegalleryloader";
const PREFIX = "/image_gallery"; // the server mirrors this to /api/...

const VIEW_MODES = ["large", "medium", "small", "details"];
const VIEW_LABELS = { large: "Large", medium: "Medium", small: "Small", details: "Details" };

const DEFAULT_SIZE = { w: 430, h: 470 };
let closeActiveContextMenu = null;

// --------------------------------------------------------------------------
// stylesheet: injected as a <link> so it is never rendered as a DOM widget
// --------------------------------------------------------------------------

function injectStylesheet() {
  try {
    if (document.querySelector("link[data-igl-style]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./gallery.css", import.meta.url).href;
    link.dataset.iglStyle = "1";
    document.head.appendChild(link);
  } catch (err) {
    console.warn("[ImageGalleryLoader] could not inject stylesheet", err);
  }
}

// --------------------------------------------------------------------------
// api helpers
// --------------------------------------------------------------------------

function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  return usp.toString();
}

async function jsonRequest(path, options) {
  const res = await api.fetchApi(path, options);
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    const message = (payload && payload.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return payload;
}

const Api = {
  getConfig: () => jsonRequest(`${PREFIX}/config`),
  saveConfig: (body) =>
    jsonRequest(`${PREFIX}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  validatePath: (path, index) => jsonRequest(`${PREFIX}/validate?${qs({ path, index })}`),
  list: (root, path, sort, direction) =>
    jsonRequest(`${PREFIX}/list?${qs({ root, path, sort, direction })}`),
  thumbUrl: (root, path, size) => `${PREFIX}/thumb?${qs({ root, path, size })}`,
  folderThumbUrl: (root, path, size) => `${PREFIX}/folder_thumb?${qs({ root, path, size })}`,
  imageUrl: (root, path) => `${PREFIX}/image?${qs({ root, path })}`,
  image: async (root, path) => {
    const res = await api.fetchApi(Api.imageUrl(root, path));
    if (!res.ok) {
      let message = `Could not open image (${res.status})`;
      try {
        const payload = await res.json();
        if (payload && payload.error) message = payload.error;
      } catch {}
      throw new Error(message);
    }
    return res.blob();
  },
};

// --------------------------------------------------------------------------
// dom helpers
// --------------------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const ICON = {
  check: "M20 6L9 17l-5-5",
  folder: "M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  eyeOff: "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.7M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.4 0 2.7-.3 3.8-.8",
};

function svgIcon(pathData, size = 14) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", pathData);
  svg.appendChild(p);
  return svg;
}

function formatBytes(n) {
  if (n === undefined || n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function formatDate(seconds) {
  if (!seconds) return "—";
  try {
    return new Date(seconds * 1000).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function imageTooltip(image, dimensions) {
  return [
    image.name,
    dimensions || "Resolution: unavailable",
    `Size: ${formatBytes(image.size)}`,
    `Date: ${formatDate(image.mtime)}`,
  ].join("\n");
}

function basename(p) {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(p);
}

function joinPath(dir, rel) {
  if (!dir) return rel || "";
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + String(rel).replace(/^[\\/]+/, "");
}

function normPath(p) {
  return String(p || "").replace(/\\/g, "/").toLowerCase();
}

/** Uploads make no sense in a read-only browser, so refuse the drop. */
function blockFileDrop(element) {
  element.addEventListener("dragover", (e) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes("Files") && e.dataTransfer.dropEffect !== "none") {
      e.dataTransfer.dropEffect = "none";
    }
  });
  element.addEventListener("drop", (e) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes("Files")) e.preventDefault();
  });
}

// --------------------------------------------------------------------------
// the in-node gallery
// --------------------------------------------------------------------------

class GalleryView {
  constructor(node, state) {
    this.node = node;
    this.state = state;

    const savedRoot = node.properties && node.properties.iglRootIndex;
    this.rootIndex =
      Number.isInteger(savedRoot) && savedRoot >= 0 ? savedRoot : null;
    this.rel = (node.properties && node.properties.iglRel) || "";
    this.sort = state.sort || "name";
    this.direction = state.direction || "asc";
    this.filter = "";
    this.rootFilter = "";
    this.mode = state.view_mode || "medium";
    this.thumbSize = state.thumbSize || 256;

    this.roots = [];
    this.folders = [];
    this.images = [];
    this.breadcrumb = [];
    this.rootName = "";
    this.rootPath = "";
    this.selected = state.image_path || "";
    this.privacyByFolder = new Set();
    this.supported = [];

    this.loadToken = 0;
    this.objectUrls = [];
    this.tileObserver = null;
    this.tileInfo = new WeakMap();
    this.footerToken = 0;
    this.footerObjectUrl = "";
    this.closed = false;

    this.element = this._build();
    this.refreshConfig().then(() => this.reload());
  }

  // ------------------------------------------------------------------ markup

  _build() {
    const root = el("div", { class: "igl-root igl-gallery" });

    this.btnBack = el("button", {
      class: "igl-btn igl-icon",
      type: "button",
      title: "Back",
      text: "\u2190",
      onclick: () => this.goBack(),
    });

    this.crumbs = el("div", { class: "igl-crumbs" });

    this.modeGroup = el("div", { class: "igl-modes", role: "group", "aria-label": "View mode" });
    this.modeButtons = {};
    for (const mode of VIEW_MODES) {
      const btn = el("button", {
        class: "igl-mode",
        type: "button",
        title: VIEW_LABELS[mode] + " icons",
        text: VIEW_LABELS[mode][0],
        onclick: () => this.setMode(mode),
      });
      this.modeButtons[mode] = btn;
      this.modeGroup.appendChild(btn);
    }

    this.sortSelect = el(
      "select",
      {
        class: "igl-select",
        title: "Sort by",
        onchange: () => {
          this.sort = this.sortSelect.value;
          this.state.sort = this.sort;
          this._persistPrefs();
          this.reload();
        },
      },
      [
        el("option", { value: "name", text: "Name" }),
        el("option", { value: "date", text: "Date" }),
        el("option", { value: "size", text: "Size" }),
        el("option", { value: "type", text: "Type" }),
      ],
    );
    this.sortSelect.value = this.sort;

    this.dirBtn = el("button", {
      class: "igl-btn igl-icon",
      type: "button",
      title: "Toggle sort direction",
      text: this.direction === "asc" ? "\u2191" : "\u2193",
      onclick: () => {
        this.direction = this.direction === "asc" ? "desc" : "asc";
        this.dirBtn.textContent = this.direction === "asc" ? "\u2191" : "\u2193";
        this.state.direction = this.direction;
        this._persistPrefs();
        this.reload();
      },
    });

    this.search = el("input", {
      class: "igl-input igl-search",
      type: "search",
      placeholder: "Filter\u2026",
      title: "Filter the images in this folder by name",
      oninput: () => {
        this.filter = this.search.value.trim().toLowerCase();
        this.render();
      },
    });

    this.folderSearch = el("input", {
      class: "igl-input igl-search",
      type: "search",
      placeholder: "Search folders\u2026",
      title: "Filter configured folders by name or path",
      oninput: () => {
        this.rootFilter = this.folderSearch.value.trim().toLowerCase();
        this._renderRoots();
        this._renderFooter();
      },
    });

    this.btnRefresh = el("button", {
      class: "igl-btn igl-icon",
      type: "button",
      title: "Refresh",
      text: "\u27f3",
      onclick: () => this.reload(),
    });

    this.privacyBtn = el("button", {
      class: "igl-btn igl-icon",
      type: "button",
      title: "Blur previews in this folder",
      onclick: () => this.togglePrivacy(),
    }, [svgIcon(ICON.eye, 15)]);

    this.countLabel = el("span", { class: "igl-count" });

    const toolbar = el("div", { class: "igl-toolbar" }, [
      this.btnBack,
      this.crumbs,
      this.modeGroup,
      this.sortSelect,
      this.dirBtn,
      this.folderSearch,
      this.search,
      this.privacyBtn,
      this.btnRefresh,
    ]);

    this.status = el("div", { class: "igl-status" });
    this.body = el("div", { class: "igl-body" });

    this.footerThumb = el("img", { class: "igl-footer-preview", alt: "" });
    this.footerName = el("div", { class: "igl-footer-name", text: "No image selected" });
    this.footerMeta = el("div", { class: "igl-footer-meta", text: "Pick a folder to begin." });
    const footer = el("div", { class: "igl-footer" }, [
      this.footerThumb,
      el("div", { class: "igl-footer-text" }, [this.footerName, this.footerMeta]),
      this.countLabel,
    ]);

    root.appendChild(toolbar);
    root.appendChild(this.status);
    root.appendChild(this.body);
    root.appendChild(footer);

    blockFileDrop(root);
    this._syncModeButtons();
    return root;
  }

  // ------------------------------------------------------------------- state

  async refreshConfig() {
    try {
      const cfg = await Api.getConfig();
      this.applyState(cfg);
      return true;
    } catch (err) {
      this.setStatus(`Could not load settings: ${err.message}`, "error");
      return false;
    }
  }

  applyState(cfg) {
    if (!cfg) return;
    this.state.folders = cfg.folders || [];
    this.state.view_mode = cfg.view_mode || this.state.view_mode;
    this.state.showFolders = cfg.show_folders !== false;
    this.state.folderThumbnails = cfg.folder_thumbnails !== false;
    this.state.imageContextMenu = cfg.image_context_menu !== false;
    this.state.keepCache = cfg.keep_cache === true;
    this.state.slots = cfg.slots || this.state.slots || 15;
    this.state.configPath = cfg.config_path || "";
    this.state.folderStatus = cfg.folder_status || [];
    this.mode = cfg.view_mode || this.mode;
    this.thumbSize = cfg.thumb_size || this.thumbSize;
    this.state.thumbSize = this.thumbSize;
    this.supported = cfg.supported_extensions || [];
    this.roots = cfg.roots || [];

    if (!this._prefsTouched) {
      this.sort = cfg.sort || this.sort;
      this.direction = cfg.direction || this.direction;
      this.sortSelect.value = this.sort;
      this.dirBtn.textContent = this.direction === "asc" ? "\u2191" : "\u2193";
    }
    this._syncModeButtons();

    // The folder we were browsing may have just been removed from the config.
    if (this.rootIndex !== null && !this.roots.some((r) => r.index === this.rootIndex)) {
      this.rootIndex = null;
      this.rel = "";
    }
  }

  async _persistPrefs() {
    this._prefsTouched = true;
    try {
      await Api.saveConfig({ view_mode: this.mode, sort: this.sort, direction: this.direction });
    } catch (err) {
      console.warn("[ImageGalleryLoader] could not save preferences", err);
    }
  }

  setMode(mode) {
    if (!VIEW_MODES.includes(mode)) mode = "medium";
    this.mode = mode;
    this.state.view_mode = mode;
    this._syncModeButtons();
    this._persistPrefs();
    this.render();
  }

  _syncModeButtons() {
    for (const mode of VIEW_MODES) {
      const btn = this.modeButtons[mode];
      if (btn) btn.classList.toggle("igl-active", mode === this.mode);
    }
  }

  // ------------------------------------------------------------------ status

  setStatus(message, kind) {
    if (!message) {
      this.status.className = "igl-status";
      this.status.textContent = "";
      return;
    }
    this.status.className = "igl-status igl-show" + (kind ? " igl-" + kind : "");
    this.status.textContent = message;
  }

  // -------------------------------------------------------------------- data

  async reload() {
    if (this.closed) return;
    await this.refreshConfig();
    if (this.rootIndex === null || this.closed) {
      this.render();
      return;
    }

    const token = ++this.loadToken;
    try {
      const data = await Api.list(this.rootIndex, this.rel, this.sort, this.direction);
      if (token !== this.loadToken || this.closed) return;
      this.folders = data.folders || [];
      this.images = data.images || [];
      this.breadcrumb = data.breadcrumb || [];
      this.rootName = data.root_name || "";
      this.rootPath = data.root_path || "";
      this.rel = data.rel || "";
      this.setStatus(null);
    } catch (err) {
      if (token !== this.loadToken || this.closed) return;
      this.folders = [];
      this.images = [];
      this.setStatus(
        err.status === 403 || err.status === 404
          ? err.message
          : `Could not read this folder: ${err.message}`,
        "error",
      );
    }
    this.render();
  }

  async enterRoot(index) {
    this.rootIndex = index;
    this.rel = "";
    this._saveBrowseLocation();
    this.filter = "";
    this.search.value = "";
    this.render();
    await this.reload();
  }

  async browse(rel) {
    if (this.rootIndex === null) return;
    this.rel = rel || "";
    this._saveBrowseLocation();
    this.filter = "";
    this.search.value = "";
    this.render();
    await this.reload();
  }

  goBack() {
    if (this.rootIndex === null) return;
    if (this.rel) {
      const parts = this.rel.split("/").filter(Boolean);
      parts.pop();
      this.browse(parts.join("/"));
    } else {
      this.goHome();
    }
  }

  goHome() {
    this.rootIndex = null;
    this.rel = "";
    this._saveBrowseLocation();
    this.folders = [];
    this.images = [];
    this.breadcrumb = [];
    this.filter = "";
    if (this.search) this.search.value = "";
    this._clearObjectUrls();
    this.render();
  }

  // --------------------------------------------------------------- selection

  select(image, absolutePath) {
    this.selected = absolutePath;
    this.node.setGalleryValue(absolutePath);
    this.body.querySelectorAll(".igl-selected").forEach((item) => item.classList.remove("igl-selected"));
    this.body.querySelectorAll("[data-image-path]").forEach((item) => {
      if (normPath(item.dataset.imagePath) === normPath(absolutePath)) {
        item.classList.add("igl-selected");
      }
    });
    this._renderFooter();
  }

  _saveBrowseLocation() {
    if (!this.node.properties) this.node.properties = {};
    this.node.properties.iglRootIndex = this.rootIndex;
    this.node.properties.iglRel = this.rel;
    this.node.setDirtyCanvas(true, true);
  }

  togglePrivacy() {
    if (this.rootIndex === null) return;
    const key = `${this.rootIndex}:${this.rel}`;
    if (this.privacyByFolder.has(key)) this.privacyByFolder.delete(key);
    else this.privacyByFolder.add(key);
    this._syncPrivacy();
  }

  _syncPrivacy() {
    const key = `${this.rootIndex}:${this.rel}`;
    const blurred = this.privacyByFolder.has(key);
    this.body.classList.toggle("igl-private", blurred);
    this.element.classList.toggle("igl-private", blurred);
    this.privacyBtn.replaceChildren(svgIcon(blurred ? ICON.eyeOff : ICON.eye, 15));
    this.privacyBtn.title = blurred ? "Show previews" : "Blur previews in this folder";
    this.privacyBtn.disabled = this.rootIndex === null;
  }

  isSelected(absPath) {
    return !!absPath && !!this.selected && normPath(absPath) === normPath(this.selected);
  }

  // -------------------------------------------------------------- thumbnails

  _clearObjectUrls() {
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    this.objectUrls = [];
    if (this.tileObserver) {
      this.tileObserver.disconnect();
      this.tileObserver = null;
      this.tileInfo = new WeakMap();
    }
  }

  _loadTile(tile, url, onDone) {
    const token = this.loadToken;
    api
      .fetchApi(url)
      .then(async (res) => {
        if (token !== this.loadToken || this.closed) return;
        if (!res.ok) {
          tile.classList.add("igl-missing");
          onDone({ missing: true });
          return;
        }
        const placeholder = res.headers.get("X-Placeholder") === "1";
        const width = res.headers.get("X-Img-W");
        const height = res.headers.get("X-Img-H");
        const blob = await res.blob();
        if (token !== this.loadToken || this.closed) return;
        const objectUrl = URL.createObjectURL(blob);
        this.objectUrls.push(objectUrl);
        const img = tile.querySelector("img.igl-thumb");
        if (img) img.src = objectUrl;
        if (placeholder) tile.classList.add("igl-missing");
        onDone({ placeholder, width, height });
      })
      .catch(() => {
        if (token !== this.loadToken || this.closed) return;
        tile.classList.add("igl-missing");
        onDone({ error: true });
      });
  }

  _observeTile(tile, url, onDone) {
    if (typeof IntersectionObserver === "undefined") {
      this._loadTile(tile, url, onDone);
      return;
    }
    if (!this.tileObserver) {
      this.tileObserver = new IntersectionObserver(
        (entries, obs) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            obs.unobserve(entry.target);
            const info = this.tileInfo.get(entry.target);
            if (info) this._loadTile(entry.target, info.url, info.onDone);
          }
        },
        { root: this.body, rootMargin: "300px 0px" },
      );
    }
    this.tileInfo.set(tile, { url, onDone });
    this.tileObserver.observe(tile);
  }

  _loadFolderPreview(img, root, path) {
    api.fetchApi(Api.folderThumbUrl(root, path, 128)).then(async (res) => {
      if (!res.ok || this.closed || !img.isConnected) return;
      const url = URL.createObjectURL(await res.blob());
      this.objectUrls.push(url);
      img.src = url;
    }).catch(() => {});
  }

  _showImageMenu(event, image) {
    if (closeActiveContextMenu) closeActiveContextMenu();
    const menu = el("div", { class: "igl-context-menu" });
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", onKey, true);
      if (closeActiveContextMenu === closeMenu) closeActiveContextMenu = null;
    };
    const close = (e) => {
      if (!menu.contains(e.target)) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };
    const open = el("button", {
      type: "button",
      text: "Open",
      onclick: () => {
        closeMenu();
        this._showViewer(image);
      },
    });
    const newTab = el("button", {
      type: "button",
      text: "Open in new tab",
      onclick: () => {
        closeMenu();
        const tab = window.open("about:blank", "_blank");
        if (!tab) {
          this.setStatus("Allow pop-ups to open images in a new tab.", "error");
          return;
        }
        tab.document.title = image.name;
        tab.document.body.textContent = "Loading image\u2026";
        Api.image(this.rootIndex, image.rel)
          .then((blob) => {
            if (tab.closed) return;
            tab.location.href = URL.createObjectURL(blob);
          })
          .catch((err) => {
            if (tab.closed) return;
            tab.document.body.textContent = `Could not open image: ${err.message}`;
          });
      },
    });
    menu.append(open, newTab);
    document.body.appendChild(menu);
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8)}px`;
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", onKey, true);
    closeActiveContextMenu = closeMenu;
  }

  _showViewer(image) {
    let viewerUrl = "";
    const onKey = (event) => {
      if (event.key === "Escape") closeViewer();
    };
    const closeViewer = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    };
    const backdrop = el("div", {
      class: "igl-viewer-backdrop",
      onclick: (event) => {
        if (event.target === backdrop) closeViewer();
      },
    });
    const close = el("button", {
      class: "igl-btn igl-viewer-close",
      type: "button",
      text: "×",
      title: "Close",
      onclick: closeViewer,
    });
    const img = el("img", {
      class: "igl-viewer-image",
      alt: image.name,
    });
    const status = el("div", { class: "igl-viewer-error" });
    backdrop.append(close, img, el("div", { class: "igl-viewer-name", text: image.name }), status);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    close.focus();
    Api.image(this.rootIndex, image.rel)
      .then((blob) => {
        if (!backdrop.isConnected) return;
        viewerUrl = URL.createObjectURL(blob);
        img.src = viewerUrl;
      })
      .catch((err) => {
        if (backdrop.isConnected) status.textContent = `Could not open image: ${err.message}`;
      });
  }

  // ------------------------------------------------------------------ render

  render() {
    if (this.closed) return;
    this._clearObjectUrls();
    this.body.textContent = "";
    this._syncPrivacy();

    this.btnBack.disabled = this.rootIndex === null;
    this.folderSearch.style.display = this.rootIndex === null ? "" : "none";
    this.search.style.display = this.rootIndex === null ? "none" : "";

    this._renderCrumbs();

    if (this.rootIndex === null) this._renderRoots();
    else if (this.mode === "details") this._renderDetails();
    else this._renderGrid();

    this._renderFooter();
    this.node.setDirtyCanvas(true, true);
  }

  _renderCrumbs() {
    this.crumbs.textContent = "";
    if (this.rootIndex === null) {
      this.crumbs.appendChild(el("span", { class: "igl-crumb igl-last", text: "Folders" }));
      return;
    }

    this.crumbs.appendChild(
      el("span", {
        class: "igl-crumb",
        text: this.rootName || "root",
        title: this.rootPath || "",
        onclick: () => this.goHome(),
      }),
    );

    const crumbs = this.breadcrumb || [];
    crumbs.forEach((crumb, i) => {
      this.crumbs.appendChild(el("span", { class: "igl-sep", text: "/" }));
      const isLast = i === crumbs.length - 1;
      this.crumbs.appendChild(
        el("span", {
          class: isLast ? "igl-crumb igl-last" : "igl-crumb",
          text: crumb.name,
          title: crumb.rel,
          onclick: isLast ? null : () => this.browse(crumb.rel),
        }),
      );
    });
  }

  _renderRoots() {
    this.body.textContent = "";
    if (!this.roots.length) {
      this.body.appendChild(
        el("div", { class: "igl-empty" }, [
          el("div", { class: "igl-empty-title", text: "No folders configured" }),
          el("div", {
            class: "igl-empty-hint",
            text:
              "Open settings to add folder paths to browse. " +
              "Empty or invalid paths are hidden automatically.",
          }),
          el("button", {
            class: "igl-btn igl-primary",
            type: "button",
            text: "\u2699 Open settings",
            onclick: () => this.node.openSettings(),
          }),
        ]),
      );
      return;
    }

    const roots = this.roots.filter((root) => {
      const needle = this.rootFilter;
      return !needle || root.name.toLowerCase().includes(needle) || root.path.toLowerCase().includes(needle);
    });
    if (!roots.length) {
      this.body.appendChild(
        el("div", { class: "igl-empty" }, [
          el("div", { class: "igl-empty-title", text: "No matching folders" }),
          el("div", { class: "igl-empty-hint", text: "Try another folder name or path." }),
        ]),
      );
      return;
    }

    const grid = el("div", { class: "igl-roots" });
    for (const root of roots) {
      const card = el(
          "button",
          {
            class: "igl-root-card",
            type: "button",
            title: root.path,
            onclick: () => this.enterRoot(root.index),
          },
          [
            this.state.folderThumbnails
              ? el("span", { class: "igl-folder-preview" }, [el("img", { alt: "" })])
              : svgIcon(ICON.folder, 18),
            el("span", { class: "igl-root-text" }, [
              el("span", { class: "igl-root-name", text: root.name }),
              el("span", {
                class: "igl-root-sub",
                text: root.image_count === 1 ? "1 image" : root.image_count + " images",
              }),
            ]),
          ],
        );
      if (this.state.folderThumbnails) this._loadFolderPreview(card.querySelector("img"), root.index, "");
      grid.appendChild(card);
    }
    this.body.appendChild(grid);
  }

  _filteredImages() {
    if (!this.filter) return this.images;
    return this.images.filter((img) => img.name.toLowerCase().includes(this.filter));
  }

  _renderGrid() {
    const showFolders = this.state.showFolders !== false;

    if (showFolders && this.folders.length) {
      const strip = el("div", { class: "igl-folder-strip" });
      for (const folder of this.folders) {
        strip.appendChild(
          el(
            "button",
            {
              class: "igl-folder",
              type: "button",
              title: folder.name,
              onclick: () => this.browse(folder.rel),
            },
            [
              this.state.folderThumbnails
                ? el("span", { class: "igl-folder-preview" }, [el("img", { alt: "" })])
                : svgIcon(ICON.folder, 13),
              el("span", { class: "igl-folder-name", text: folder.name }),
            ],
          ),
        );
        if (this.state.folderThumbnails) {
          const button = strip.lastElementChild;
          this._loadFolderPreview(button.querySelector("img"), this.rootIndex, folder.rel);
        }
      }
      this.body.appendChild(strip);
    }

    const images = this._filteredImages();
    if (!images.length) {
      this.body.appendChild(
        el("div", { class: "igl-empty" }, [
          el("div", {
            class: "igl-empty-title",
            text: this.filter ? "No matches" : "No images in this folder",
          }),
          el("div", {
            class: "igl-empty-hint",
            text: this.filter
              ? "Try a different filter."
              : "Supported types: " + (this.supported || []).join(", "),
          }),
        ]),
      );
      return;
    }

    const grid = el("div", { class: "igl-grid igl-" + this.mode });
    const size = this.mode === "large" ? 320 : this.mode === "medium" ? 240 : 144;

    for (const image of images) {
      const abs = joinPath(this.rootPath, image.rel);
      const tile = el("button", {
        class: "igl-tile" + (this.isSelected(abs) ? " igl-selected" : ""),
        type: "button",
        title: imageTooltip(image),
        "data-image-path": abs,
        onclick: () => this.select(image, abs),
        oncontextmenu: (event) => {
          if (this.state.imageContextMenu) {
            event.preventDefault();
            this._showImageMenu(event, image);
          }
        },
      });

      tile.appendChild(el("img", { class: "igl-thumb", alt: "" }));
      if (this.mode !== "small") {
        tile.appendChild(el("span", { class: "igl-name", text: image.name }));
      }
      tile.appendChild(el("span", { class: "igl-check" }, [svgIcon(ICON.check, 14)]));

      this._observeTile(tile, Api.thumbUrl(this.rootIndex, image.rel, size), (info) => {
        const dimensions =
          info.width && info.height ? `Resolution: ${info.width} × ${info.height}` : "Resolution: unavailable";
        tile.title = imageTooltip(image, dimensions);
      });
      grid.appendChild(tile);
    }

    this.body.appendChild(grid);
  }

  _renderDetails() {
    const images = this._filteredImages();
    if (!images.length) {
      this.body.appendChild(
        el("div", { class: "igl-empty" }, [
          el("div", {
            class: "igl-empty-title",
            text: this.filter ? "No matches" : "No images in this folder",
          }),
        ]),
      );
      return;
    }

    const table = el("table", { class: "igl-details" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "", title: "Selected" }),
          el("th", { text: "Name" }),
          el("th", { text: "Type" }),
          el("th", { text: "Size" }),
          el("th", { text: "Modified" }),
          el("th", { text: "Dimensions" }),
        ]),
      ]),
    ]);

    const tbody = el("tbody");
    for (const image of images) {
      const abs = joinPath(this.rootPath, image.rel);
      const dims = el("td", { class: "igl-d-num", text: "\u2026" });
      const row = el(
        "tr",
        {
          class: this.isSelected(abs) ? "igl-selected" : "",
          title: imageTooltip(image),
          "data-image-path": abs,
          onclick: () => this.select(image, abs),
          oncontextmenu: (event) => {
            if (this.state.imageContextMenu) {
              event.preventDefault();
              this._showImageMenu(event, image);
            }
          },
        },
        [
          el("td", {}, [el("span", { class: "igl-d-check" })]),
          el("td", { class: "igl-d-name", text: image.name }),
          el("td", { text: (image.ext || "").toUpperCase() }),
          el("td", { class: "igl-d-num", text: formatBytes(image.size) }),
          el("td", { class: "igl-d-num", text: formatDate(image.mtime) }),
          dims,
        ],
      );

      // Dimensions come from the thumbnail response headers, so Details view
      // never downloads a full-size image.
      api
        .fetchApi(Api.thumbUrl(this.rootIndex, image.rel, 64))
        .then((res) => {
          if (this.closed) return;
          if (!res.ok) {
            dims.textContent = "\u2014";
            return;
          }
          const w = res.headers.get("X-Img-W");
          const h = res.headers.get("X-Img-H");
          row.title = imageTooltip(
            image,
            w && h ? `Resolution: ${w} × ${h}` : "Resolution: unavailable",
          );
          dims.textContent =
            res.headers.get("X-Placeholder") === "1"
              ? "unreadable"
              : w && h
                ? w + " \u00d7 " + h
                : "\u2014";
        })
        .catch(() => {
          if (!this.closed) dims.textContent = "\u2014";
        });

      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    this.body.appendChild(table);
  }

  _renderFooter() {
    const footerToken = ++this.footerToken;
    const total = this.images.length;
    const shown = this._filteredImages().length;
    const visibleRoots = this.roots.filter((root) => {
      const needle = this.rootFilter;
      return !needle || root.name.toLowerCase().includes(needle) || root.path.toLowerCase().includes(needle);
    }).length;
    this.countLabel.textContent =
      this.rootIndex === null
        ? visibleRoots + " folder" + (visibleRoots === 1 ? "" : "s")
        : this.filter
          ? shown + " of " + total
          : total + " image" + (total === 1 ? "" : "s");

    if (!this.selected) {
      if (this.footerObjectUrl) URL.revokeObjectURL(this.footerObjectUrl);
      this.footerObjectUrl = "";
      this.footerThumb.style.visibility = "hidden";
      this.footerThumb.removeAttribute("src");
      this.footerName.textContent = "No image selected";
      this.footerMeta.className = "igl-footer-meta";
      this.footerMeta.textContent =
        this.rootIndex === null ? "Pick a folder to begin." : "Click an image to select it.";
      this.footerMeta.title = "";
      return;
    }

    this.footerThumb.style.visibility = "visible";
    this.footerName.textContent = basename(this.selected);
    this.footerMeta.className = "igl-footer-meta";
    this.footerMeta.textContent = this.selected;
    this.footerMeta.title = this.selected;

    const root = this.roots.find((r) => {
      const base = normPath(r.path).replace(/\/+$/, "");
      return normPath(this.selected) === base || normPath(this.selected).startsWith(base + "/");
    });
    if (!root) return;

    const rel = this.selected
      .slice(root.path.length)
      .replace(/^[\\/]+/, "")
      .split(/[\\/]/)
      .join("/");

    api
      .fetchApi(Api.thumbUrl(root.index, rel, 128))
      .then(async (res) => {
        if (footerToken !== this.footerToken || this.closed) return;
        if (!res.ok) {
          this.footerMeta.className = "igl-footer-meta igl-err";
          this.footerMeta.textContent = "This image is no longer readable.";
          return;
        }
        const blob = await res.blob();
        if (footerToken !== this.footerToken || this.closed) return;
        if (this.footerObjectUrl) URL.revokeObjectURL(this.footerObjectUrl);
        const url = URL.createObjectURL(blob);
        this.footerObjectUrl = url;
        this.objectUrls.push(url);
        this.footerThumb.src = url;
      })
      .catch(() => {
        /* the footer is cosmetic; never surface an error for it */
      });
  }

  dispose() {
    this.closed = true;
    this.loadToken += 1;
    this._clearObjectUrls();
    if (this.footerObjectUrl) URL.revokeObjectURL(this.footerObjectUrl);
    if (closeActiveContextMenu) closeActiveContextMenu();
  }
}

// --------------------------------------------------------------------------
// the settings window (configurable folder paths)
// --------------------------------------------------------------------------

class SettingsWindow {
  constructor(node) {
    this.node = node;
    this.state = node.galleryState;

    this.inputs = [];
    this.statuses = [];
    this.timers = [];
    this.saving = false;
    this.closed = false;

    this.element = this._build();
  }

  _build() {
    this.listEl = el("div", { class: "igl-path-list" });

    const note = el("div", { class: "igl-hint" }, [
      "Leave a box empty to ignore it. Paths that do not exist are flagged here and are " +
        "hidden from the gallery's folder list automatically. Each folder is shown in the " +
        "gallery by its own folder name.",
    ]);

    const safety = el("div", { class: "igl-hint" }, [
      el("b", { text: "Read-only: " }),
      "the gallery can browse, preview and select images, but never rename, move, delete, " +
        "copy or upload anything.",
    ]);

    this.slotCountInput = el("input", {
      class: "igl-slot-count",
      type: "number",
      min: "15",
      max: "200",
      step: "1",
      value: String(this.state.slots || 15),
      onchange: () => {
        const count = Math.max(15, Math.min(parseInt(this.slotCountInput.value, 10) || 15, 200));
        this.slotCountInput.value = String(count);
        this.state.slots = count;
        this._renderPathFields(count, this.inputs.map((input) => input.value));
        this.modalSub.textContent = count + " folder slots";
      },
    });
    this._renderPathFields(this.state.slots || 15, this.state.folders || []);

    this.tabs = el("div", {
      class: "igl-modes",
      role: "group",
      "aria-label": "Default view mode",
    });
    this.modeButtons = {};
    for (const mode of VIEW_MODES) {
      const btn = el("button", {
        class: "igl-mode" + (this.state.view_mode === mode ? " igl-active" : ""),
        type: "button",
        text: VIEW_LABELS[mode],
        onclick: () => {
          this.state.view_mode = mode;
          for (const [key, b] of Object.entries(this.modeButtons)) {
            b.classList.toggle("igl-active", key === mode);
          }
        },
      });
      this.modeButtons[mode] = btn;
      this.tabs.appendChild(btn);
    }

    this.thumbSelect = el(
      "select",
      { class: "igl-select" },
      [
        el("option", { value: "128", text: "128 px" }),
        el("option", { value: "192", text: "192 px" }),
        el("option", { value: "256", text: "256 px" }),
        el("option", { value: "384", text: "384 px" }),
      ],
    );
    this.thumbSelect.value = String(this.state.thumbSize || 256);
    if (!this.thumbSelect.value) this.thumbSelect.value = "256";

    this.showFolders = el("input", { type: "checkbox" });
    this.showFolders.checked = this.state.showFolders !== false;
    this.folderThumbnails = el("input", { type: "checkbox" });
    this.folderThumbnails.checked = this.state.folderThumbnails !== false;
    this.imageContextMenu = el("input", { type: "checkbox" });
    this.imageContextMenu.checked = this.state.imageContextMenu !== false;
    this.keepCache = el("input", { type: "checkbox" });
    this.keepCache.checked = this.state.keepCache === true;

    this.body = el("div", { class: "igl-modal-body" }, [
      note,
      el("div", { class: "igl-row" }, [el("label", { text: "Folder path slots" }), this.slotCountInput]),
      this.listEl,
      el("div", { class: "igl-divider" }),
      el("div", { class: "igl-row" }, [el("label", { text: "Default view" }), this.tabs]),
      el("div", { class: "igl-row" }, [
        el("label", { text: "Thumbnail" }),
        this.thumbSelect,
        el("label", { text: "Show folders", style: { minWidth: "auto", marginLeft: "8px" } }),
        this.showFolders,
      ]),
      el("div", { class: "igl-row igl-settings-flags" }, [
        el("label", { text: "Folder thumbnails" }), this.folderThumbnails,
        el("label", { text: "Right-click image menu" }), this.imageContextMenu,
        el("label", { text: "Keep thumbnail cache" }), this.keepCache,
      ]),
      safety,
      el("div", {
        class: "igl-note",
        text: this.state.configPath ? "Saved to: " + this.state.configPath : "",
      }),
    ]);

    this.footStatus = el("span", { class: "igl-note", style: { margin: "0" } });

    this.saveBtn = el("button", {
      class: "igl-btn igl-primary",
      type: "button",
      text: "Save",
      onclick: () => this._commit(),
    });

    this.modalSub = el("div", { class: "igl-modal-sub", text: this.inputs.length + " folder slots" });
    const modal = el("div", { class: "igl-modal", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "igl-modal-head" }, [
        el("div", {}, [
          el("div", { class: "igl-modal-title", text: "Image Gallery Loader \u2014 Settings" }),
          this.modalSub,
        ]),
        el("button", {
          class: "igl-btn igl-icon",
          type: "button",
          title: "Close",
          text: "\u2715",
          onclick: () => this.close(),
        }),
      ]),
      this.body,
      el("div", { class: "igl-modal-foot" }, [
        this.footStatus,
        el("div", { class: "igl-spacer" }),
        el("button", {
          class: "igl-btn",
          type: "button",
          text: "Cancel",
          onclick: () => this.close(),
        }),
        this.saveBtn,
      ]),
    ]);

    const backdrop = el(
      "div",
      {
        class: "igl-modal-backdrop",
        onmousedown: (e) => {
          if (e.target === backdrop) this.close();
        },
      },
      [modal],
    );

    this._onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    };
    document.addEventListener("keydown", this._onKey, true);

    blockFileDrop(backdrop);
    return backdrop;
  }

  _renderPathFields(slots, values) {
    for (const timer of this.timers) clearTimeout(timer);
    this.inputs = [];
    this.statuses = [];
    this.timers = [];
    this.listEl.textContent = "";
    for (let i = 0; i < slots; i++) {
      const input = el("input", {
        type: "text",
        placeholder: "Paste a folder path, e.g. D:\\images\\cats",
        spellcheck: "false",
        autocomplete: "off",
        value: values[i] || "",
        oninput: () => this._onInput(i),
        onkeydown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            this._commit();
          }
        },
      });
      const statusEl = el("div", { class: "igl-field-status" });
      const field = el("div", { class: "igl-field" }, [
        el("div", { class: "igl-field-num", text: String(i + 1) }),
        input,
        statusEl,
      ]);
      this.inputs.push(input);
      this.statuses.push(statusEl);
      this.listEl.appendChild(field);

      const known = (this.state.folderStatus || []).find((s) => s.index === i);
      if (known && (known.raw || "").trim()) this._setStatus(i, known);
    }
  }

  // ------------------------------------------------------------- validation

  _markPending(index) {
    const status = this.statuses[index];
    if (!status) return;
    status.className = "igl-field-status igl-pending";
    status.textContent = "checking\u2026";
    this.inputs[index].parentElement.className = "igl-field";
  }

  _setStatus(index, info) {
    const status = this.statuses[index];
    if (!status) return;
    const field = this.inputs[index].parentElement;

    if (!info || !(info.raw || "").trim()) {
      status.className = "igl-field-status";
      status.textContent = "";
      status.title = "";
      field.className = "igl-field";
      return;
    }

    if (info.valid) {
      status.className = "igl-field-status igl-ok";
      status.textContent =
        info.image_count === 1
          ? "\u2713 1 image"
          : info.image_count
            ? "\u2713 " + info.image_count + " images"
            : "\u2713 empty folder";
      field.className = "igl-field igl-ok";
      status.title =
        (info.path || info.raw) +
        " \u2014 shown in the gallery as \u201c" +
        (info.name || basename(info.path)) +
        "\u201d";
    } else {
      status.className = "igl-field-status igl-bad";
      status.textContent = "\u2715 " + (info.reason || "invalid");
      field.className = "igl-field igl-bad";
      status.title = info.raw || "";
    }
  }

  _onInput(index) {
    const value = this.inputs[index].value.trim();
    clearTimeout(this.timers[index]);

    if (!value) {
      this._setStatus(index, { raw: "", valid: false });
      return;
    }

    this._markPending(index);
    // Debounced so typing a long path does not hammer the filesystem.
    this.timers[index] = setTimeout(async () => {
      try {
        const info = await Api.validatePath(value, index);
        if (this.closed) return;
        this._setStatus(index, info);
      } catch (err) {
        if (this.closed) return;
        const status = this.statuses[index];
        status.className = "igl-field-status igl-bad";
        status.textContent = "\u2715 " + err.message;
      }
    }, 320);
  }

  // ------------------------------------------------------------------- save

  async _commit() {
    if (this.saving) return;
    this.saving = true;
    this.saveBtn.disabled = true;
    this.footStatus.textContent = "Saving\u2026";

    const folders = this.inputs.map((i) => i.value.trim());

    try {
      const res = await Api.saveConfig({
        folders,
        slot_count: parseInt(this.slotCountInput.value, 10) || 15,
        view_mode: this.state.view_mode,
        thumb_size: parseInt(this.thumbSelect.value, 10) || 256,
        show_folders: this.showFolders.checked,
        folder_thumbnails: this.folderThumbnails.checked,
        image_context_menu: this.imageContextMenu.checked,
        keep_cache: this.keepCache.checked,
      });

      this.state.folders = res.folders || folders;
      this.state.folderStatus = res.folder_status || [];
      this.state.slots = res.slots || (res.folders || folders).length;
      this.state.view_mode = res.view_mode || this.state.view_mode;
      this.state.thumbSize = parseInt(this.thumbSelect.value, 10) || 256;
      this.state.showFolders = this.showFolders.checked;
      this.state.folderThumbnails = this.folderThumbnails.checked;
      this.state.imageContextMenu = this.imageContextMenu.checked;
      this.state.keepCache = this.keepCache.checked;

      if (this.node.view) {
        this.node.view.applyState({
          folders: this.state.folders,
          view_mode: this.state.view_mode,
          thumb_size: this.state.thumbSize,
          show_folders: this.state.showFolders,
          folder_thumbnails: this.state.folderThumbnails,
          image_context_menu: this.state.imageContextMenu,
          keep_cache: this.state.keepCache,
          folder_status: this.state.folderStatus,
          roots: res.roots || [],
          slots: this.state.slots,
          config_path: res.config_path,
          supported_extensions: this.node.view.supported,
        });
        await this.node.view.reload();
      }
      this.close();
    } catch (err) {
      this.footStatus.textContent = "Could not save: " + err.message;
      this.saving = false;
      this.saveBtn.disabled = false;
    }
  }

  // ------------------------------------------------------------------ close

  close() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    document.removeEventListener("keydown", this._onKey, true);
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    if (this.node.settingsWindow === this) this.node.settingsWindow = null;
  }
}

// --------------------------------------------------------------------------
// node integration
// --------------------------------------------------------------------------

function patchNode(node) {
  if (node.__iglPatched) return;
  node.__iglPatched = true;

  const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);
  const pathWidget = findWidget("image_path");

  node.galleryState = {
    folders: [],
    folderStatus: [],
    slots: 15,
    view_mode: "medium",
    thumbSize: 256,
    showFolders: true,
    folderThumbnails: true,
    imageContextMenu: true,
    keepCache: false,
    configPath: "",
    image_path:
      (node.properties && node.properties.iglImagePath) ||
      (pathWidget ? pathWidget.value || "" : ""),
    sort: "name",
    direction: "asc",
  };
  node.settingsWindow = null;

  // --- the hidden image_path widget ---------------------------------------
  // It stays serialized (so the selection is saved with the workflow and
  // reaches Python) but is given zero height so it never draws.
  node.setGalleryValue = (value) => {
    node.galleryState.image_path = value || "";
    if (!node.properties) node.properties = {};
    node.properties.iglImagePath = value || "";
    if (!pathWidget) return;
    pathWidget.value = value || "";
    if (typeof pathWidget.callback === "function") {
      try {
        pathWidget.callback(value || "");
      } catch (err) {
        console.warn("[ImageGalleryLoader] widget callback failed", err);
      }
    }
    node.setDirtyCanvas(true, true);
  };

  if (pathWidget) {
    if (!pathWidget.__iglOriginalComputeSize) {
      pathWidget.__iglOriginalComputeSize = pathWidget.computeSize;
    }
    pathWidget.computeSize = () => [0, -4];
    pathWidget.draw = () => {};
    pathWidget.hidden = true;
  } else {
    console.warn(
      "[ImageGalleryLoader] node " +
        node.id +
        " has no image_path widget; the selection may not persist.",
    );
  }

  node.openSettings = () => {
    if (node.settingsWindow) return;
    node.settingsWindow = new SettingsWindow(node);
    document.body.appendChild(node.settingsWindow.element);
  };

  // --- the settings button -------------------------------------------------
  const settingsBtn = node.addWidget("button", "\u2699 Settings", null, () => node.openSettings());
  // The button is UI only: keep it out of widgets_values so the positional
  // order of serialized widgets stays stable across a save/load round trip.
  settingsBtn.serialize = false;
  settingsBtn.serializeValue = () => undefined;

  // --- the gallery ---------------------------------------------------------
  const view = new GalleryView(node, node.galleryState);
  node.view = view;

  const domWidget = node.addDOMWidget("gallery", "custom", view.element, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 220,
    getMaxHeight: () => 4000,
    getValue: () => undefined,
    setValue: () => {},
    afterResize: () => view.render(),
    onRemove: () => view.dispose(),
  });
  domWidget.serialize = false;
  domWidget.serializeValue = () => undefined;

  // Resize, but never shrink a node the user has already sized deliberately.
  const w = node.size ? node.size[0] : 0;
  const h = node.size ? node.size[1] : 0;
  if (!w || !h || (w <= 210 && h <= 100)) {
    node.setSize([DEFAULT_SIZE.w, DEFAULT_SIZE.h]);
  } else if (h < DEFAULT_SIZE.h) {
    node.setSize([Math.max(w, 320), DEFAULT_SIZE.h]);
  }
}

app.registerExtension({
  name: EXT_NAME,

  async init() {
    injectStylesheet();
  },

  async nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    // Anything thrown here would leave a half-built node behind.
    try {
      patchNode(node);
    } catch (err) {
      console.error("[ImageGalleryLoader] failed to initialise node", err);
    }
  },

  async loadedGraphNode(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    try {
      if (!node.__iglPatched) {
        patchNode(node);
        return;
      }
      // Restore the previously chosen image from the saved workflow.
      const pathWidget = (node.widgets || []).find((widget) => widget.name === "image_path");
      const stored =
        (node.properties && node.properties.iglImagePath) ||
        (pathWidget && pathWidget.value) ||
        (node.galleryState && node.galleryState.image_path) ||
        "";
      node.setGalleryValue(stored);
      if (node.view) node.view.selected = stored;
      if (node.view) {
        const location = node.properties || {};
        const root = location.iglRootIndex;
        node.view.rootIndex = Number.isInteger(root) && root >= 0 ? root : null;
        node.view.rel = typeof location.iglRel === "string" ? location.iglRel : "";
        await node.view.reload();
      }
    } catch (err) {
      console.error("[ImageGalleryLoader] failed to restore node", err);
    }
  },
});
