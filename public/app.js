import { registerBuzzWebMCP } from "./webmcp.js?v=20260903-2";

const $ = (selector) => document.querySelector(selector);
const state = { workspace: null, activeSpaceId: null, searchResults: null };
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function activeSpace() {
  return state.workspace?.spaces.find((space) => space.id === state.activeSpaceId) || state.workspace?.spaces[0];
}

function initials(name) {
  return String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function notify(message, source = "ui", error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
  if (source === "webmcp") renderActivity();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSpaces() {
  const root = $("#spaces");
  root.replaceChildren();
  const counts = new Map();
  for (const message of state.workspace.messages) counts.set(message.spaceId, (counts.get(message.spaceId) || 0) + 1);
  for (const space of state.workspace.spaces) {
    const button = element("button", `space-button${space.id === state.activeSpaceId ? " active" : ""}`);
    button.type = "button";
    button.dataset.spaceId = space.id;
    button.append(element("span", "hash", "#"), element("span", "name", space.name), element("span", "count", String(counts.get(space.id) || 0)));
    button.addEventListener("click", () => {
      state.activeSpaceId = space.id;
      state.searchResults = null;
      render();
    });
    root.append(button);
  }
}

function renderMessages() {
  const space = activeSpace();
  if (!space) return;
  $("#space-name").textContent = space.name;
  $("#space-description").textContent = space.description || "A shared space for people and agents.";
  $("#message-input").placeholder = `Message #${space.name}`;
  const root = $("#messages");
  root.replaceChildren();
  const messages = state.workspace.messages
    .filter((message) => message.spaceId === space.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const message of messages) {
    const item = element("li", `message ${message.role}`);
    const avatar = element("div", "avatar", initials(message.author));
    const body = element("div", "message-body");
    const meta = element("div", "message-meta");
    meta.append(element("strong", "", message.author));
    const time = element("time", "", formatTime(message.createdAt));
    time.dateTime = message.createdAt;
    meta.append(time);
    if (message.source === "webmcp") meta.append(element("span", "source-badge", "via WebMCP"));
    body.append(meta, element("p", "", message.content));
    item.append(avatar, body);
    root.append(item);
  }
  requestAnimationFrame(() => { root.scrollTop = root.scrollHeight; });
}

function renderSearch() {
  const section = $("#search-results");
  if (!state.searchResults) {
    section.hidden = true;
    section.replaceChildren();
    return;
  }
  section.hidden = false;
  section.replaceChildren();
  const head = element("div", "search-head");
  head.append(element("strong", "", `${state.searchResults.length} search result${state.searchResults.length === 1 ? "" : "s"}`));
  const close = element("button", "", "Close");
  close.type = "button";
  close.addEventListener("click", () => { state.searchResults = null; renderSearch(); });
  head.append(close);
  section.append(head);
  if (!state.searchResults.length) section.append(element("p", "panel-intro", "No matching shared context."));
  for (const result of state.searchResults) {
    const hit = element("button", "search-hit");
    hit.type = "button";
    hit.append(element("span", "", `#${result.spaceName}`), element("div", "", `${result.author}: ${result.content}`));
    hit.addEventListener("click", () => {
      state.activeSpaceId = result.spaceId;
      state.searchResults = null;
      render();
    });
    section.append(hit);
  }
}

function renderActivity() {
  if (!state.workspace) return;
  const spaces = new Map(state.workspace.spaces.map((space) => [space.id, space.name]));
  const root = $("#activity-list");
  root.replaceChildren();
  const latest = [...state.workspace.messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  for (const message of latest) {
    const item = element("li", message.source === "webmcp" ? "webmcp" : "");
    item.textContent = `${message.author} posted in #${spaces.get(message.spaceId) || "space"}`;
    root.append(item);
  }
}

function render() {
  if (!state.workspace) return;
  if (!state.workspace.spaces.some((space) => space.id === state.activeSpaceId)) state.activeSpaceId = state.workspace.spaces[0]?.id;
  renderSpaces();
  renderMessages();
  renderSearch();
  renderActivity();
}

async function refresh(focusSpaceId) {
  const data = await api("/api/workspace");
  state.workspace = data.workspace;
  if (focusSpaceId) state.activeSpaceId = focusSpaceId;
  render();
}

async function searchMessages(query) {
  const text = query.trim();
  if (!text) {
    state.searchResults = null;
    renderSearch();
    return;
  }
  const data = await api(`/api/search?q=${encodeURIComponent(text)}&limit=30`);
  state.searchResults = data.results;
  renderSearch();
}

function bind() {
  $("#composer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#message-input");
    const content = input.value.trim();
    if (!content) return;
    try {
      await api(`/api/spaces/${encodeURIComponent(state.activeSpaceId)}/messages`, {
        method: "POST",
        body: { content, source: "ui", idempotency_key: crypto.randomUUID() },
      });
      input.value = "";
      await refresh(state.activeSpaceId);
      notify("Message posted to the shared workspace.");
    } catch (error) {
      notify(error.message, "ui", true);
    }
  });

  $("#message-input").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") $("#composer").requestSubmit();
  });

  $("#search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchMessages(event.currentTarget.value).catch((error) => notify(error.message, "ui", true));
    }
  });

  const dialog = $("#space-dialog");
  $("#new-space").addEventListener("click", () => dialog.showModal());
  $("#space-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await api("/api/spaces", {
        method: "POST",
        body: { name: $("#space-input").value, description: $("#description-input").value },
      });
      dialog.close();
      form.reset();
      await refresh(data.space.id);
      notify(`#${data.space.name} created.`);
    } catch (error) {
      notify(error.message, "ui", true);
    }
  });

  $("#copy-prompt").addEventListener("click", async () => {
    const prompt = "Find the handoff note, then post a concise launch update in that Buzz space.";
    try {
      await navigator.clipboard.writeText(prompt);
      notify("Agent prompt copied.");
    } catch {
      notify(prompt);
    }
  });

  $("#reset-demo").addEventListener("click", async () => {
    try {
      await api("/api/reset", { method: "POST", body: {} });
      state.searchResults = null;
      await refresh();
      notify("Your isolated demo workspace was reset.");
    } catch (error) {
      notify(error.message, "ui", true);
    }
  });
}

async function boot() {
  bind();
  try {
    await refresh();
  } catch (error) {
    notify(error.message, "ui", true);
    $("#tool-status").innerHTML = "<span></span> Demo unavailable";
    return;
  }
  try {
    const result = await registerBuzzWebMCP({ api, refresh, notify });
    const status = $("#tool-status");
    if (result.available) {
      status.classList.add("available");
      status.innerHTML = `<span></span> ${result.count} site tools available`;
    } else {
      status.innerHTML = "<span></span> Open in a WebMCP browser";
    }
  } catch (error) {
    console.warn("Site tool registration failed", error);
    $("#tool-status").innerHTML = "<span></span> Site tools unavailable";
  }
}

boot();
