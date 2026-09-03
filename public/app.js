import { registerGatherwireWebMCP } from "./webmcp.js?v=20260903-5";

const $ = (selector) => document.querySelector(selector);
const MISSION_TOOLS = [
  "gatherwire_list_spaces",
  "gatherwire_search_messages",
  "gatherwire_read_messages",
  "gatherwire_list_project_agents",
  "gatherwire_publish_handoff",
];
const state = { workspace: null, activeSpaceId: null, searchResults: null, receipts: [], focusMessageId: null };
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
  const words = String(name || "?").match(/[\p{L}\p{N}]+/gu) || ["?"];
  return words.map((part) => part[0]).join("").slice(0, 2).toUpperCase();
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
  for (const handoff of state.workspace.handoffs || []) counts.set(handoff.targetSpaceId, (counts.get(handoff.targetSpaceId) || 0) + 1);
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

function renderHandoff(handoff, spaces, participants, messages) {
  const item = element("li", "handoff-capsule");
  const head = element("div", "handoff-head");
  head.append(element("span", "handoff-label", "Source-linked handoff"), element("span", "handoff-status", handoff.status));

  const target = participants.get(handoff.targetAgentId);
  const title = element("div", "handoff-target");
  title.append(element("span", "handoff-avatar", initials(target?.name || "Agent")));
  const targetCopy = element("div");
  targetCopy.append(element("strong", "", `To ${target?.name || "Project agent"}`));
  targetCopy.append(element("span", "", target?.project || "Synthetic demo project"));
  title.append(targetCopy);

  const summary = element("p", "handoff-summary", handoff.summary);
  const next = element("div", "handoff-next");
  next.append(element("span", "", "Next action"), element("strong", "", handoff.nextAction));

  const evidence = element("div", "handoff-evidence");
  evidence.append(element("span", "", "Linked evidence"));
  for (const messageId of handoff.evidenceMessageIds) {
    const message = messages.get(messageId);
    const link = element("button", "evidence-link");
    link.type = "button";
    link.append(
      element("code", "", messageId.slice(0, 8)),
      element("span", "", message ? `${message.author}: ${message.content}` : "Retained source reference"),
    );
    link.addEventListener("click", () => {
      state.activeSpaceId = handoff.sourceSpaceId;
      state.searchResults = null;
      state.focusMessageId = messageId;
      render();
    });
    evidence.append(link);
  }

  const sourceName = spaces.get(handoff.sourceSpaceId) || "source";
  const evidenceCount = handoff.evidenceMessageIds.length;
  const meta = element("div", "handoff-meta");
  meta.append(
    element("span", "", `From #${sourceName}`),
    element("span", "", `${evidenceCount} linked message${evidenceCount === 1 ? "" : "s"}`),
    element("code", "", handoff.taskId),
    element("code", "", `corr:${handoff.correlationId.slice(0, 8)}`),
  );
  item.append(head, title, summary, next, evidence, meta, element("p", "handoff-boundary", "Synthetic demo. Handoff recorded; no external agent started."));
  return item;
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
    .map((message) => ({ ...message, itemType: "message" }));
  const handoffs = (state.workspace.handoffs || [])
    .filter((handoff) => handoff.targetSpaceId === space.id)
    .map((handoff) => ({ ...handoff, itemType: "handoff" }));
  const timeline = [...messages, ...handoffs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const spaces = new Map(state.workspace.spaces.map((item) => [item.id, item.name]));
  const participants = new Map((state.workspace.participants || []).map((participant) => [participant.id, participant]));
  const messageIndex = new Map(state.workspace.messages.map((item) => [item.id, item]));
  for (const message of timeline) {
    if (message.itemType === "handoff") {
      root.append(renderHandoff(message, spaces, participants, messageIndex));
      continue;
    }
    const item = element("li", `message ${message.role}`);
    item.dataset.messageId = message.id;
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
  requestAnimationFrame(() => {
    if (state.focusMessageId) {
      const focused = root.querySelector(`[data-message-id="${state.focusMessageId}"]`);
      if (focused) {
        focused.classList.add("evidence-focus");
        focused.tabIndex = -1;
        focused.scrollIntoView({ block: "center" });
        focused.focus({ preventScroll: true });
      }
      state.focusMessageId = null;
      return;
    }
    root.scrollTop = root.scrollHeight;
  });
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
  const root = $("#activity-list");
  root.replaceChildren();
  if (!state.receipts.length) {
    root.append(element("li", "receipt-empty", "Agent tool receipts will appear here."));
    return;
  }
  for (const receipt of state.receipts.slice(0, 6)) {
    const item = element("li", `receipt ${receipt.success ? "success" : "failure"}`);
    const headline = element("div", "receipt-line");
    headline.append(element("code", "", receipt.tool.replace("gatherwire_", "")), element("span", receipt.mode, receipt.mode));
    const identifiers = [receipt.id.slice(0, 8)];
    if (receipt.taskId) identifiers.push(receipt.taskId.slice(0, 13));
    if (receipt.correlationId) identifiers.push(`corr:${receipt.correlationId.slice(0, 8)}`);
    const detail = element("div", "receipt-detail", `${receipt.target} / ${formatTime(receipt.createdAt)} / ${identifiers.join(" / ")}`);
    item.append(headline, detail);
    root.append(item);
  }
}

function renderMission() {
  const completed = new Set(state.receipts.filter((receipt) => receipt.success).map((receipt) => receipt.tool));
  const count = MISSION_TOOLS.filter((tool) => completed.has(tool)).length;
  $("#mission-count").textContent = `${count}/${MISSION_TOOLS.length}`;
  for (const row of document.querySelectorAll("[data-mission-tool]")) {
    row.classList.toggle("complete", completed.has(row.dataset.missionTool));
  }
}

function recordReceipt(receipt) {
  state.receipts = [receipt, ...state.receipts.filter((item) => item.id !== receipt.id)].slice(0, 12);
  renderActivity();
  renderMission();
}

function render() {
  if (!state.workspace) return;
  if (!state.workspace.spaces.some((space) => space.id === state.activeSpaceId)) state.activeSpaceId = state.workspace.spaces[0]?.id;
  renderSpaces();
  renderMessages();
  renderSearch();
  renderActivity();
  renderMission();
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
  const data = await api(`/api/search?q=${encodeURIComponent(text)}&limit=10`);
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
    const prompt = "Complete the Gatherwire judge mission with this page's site tools: list spaces; search for the handoff note; read its source space; list the available demo project agents; then publish a source-linked handoff to Atlas in the product space using the found message ID as evidence. Keep the summary and next action concise.";
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
      state.receipts = [];
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
    const result = await registerGatherwireWebMCP({ api, refresh, notify, recordReceipt });
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
