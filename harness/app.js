/**
 * Counselle dev harness — app.js
 * Slice A: session bootstrap, SSE line parser, delta rendering, source dropdown.
 * Slice B: sources registry, [n] → cite chip post-processing, popover.
 */

// ── Utilities ──────────────────────────────────────────────────────────────

/** Escape text for safe innerHTML insertion. */
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal markdown → safe HTML. ~30 lines, no library. */
function mdLite(raw) {
  // Work on escaped text so we can freely add HTML tags
  const lines = raw.split("\n");
  const out = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = esc(lines[i]);
    // Apply inline: **bold**
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Headings: #..###### at line start → small bold headings (h3..h6)
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      if (inList) { out.push("</ul>"); inList = false; }
      const level = Math.min(heading[1].length + 2, 6); // "#"→h3, "##"→h4, "###"+→h5/h6
      out.push(`</p><h${level}>${heading[2]}</h${level}><p>`);
      continue;
    }

    // Horizontal rule: a lone "---" / "***" / "<hr>" line (escaped) → real <hr>
    if (/^(-{3,}|\*{3,}|&lt;hr ?\/?&gt;)$/.test(line.trim())) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("</p><hr><p>");
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${line.slice(2)}</li>`);
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (line === "") {
        // paragraph break — handled by joining paragraphs below
        out.push("</p><p>");
      } else {
        out.push(line + " ");
      }
    }
  }
  if (inList) out.push("</ul>");

  let html = out.join("");
  // Wrap in paragraph
  html = "<p>" + html + "</p>";
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  // Clean duplicate paragraph-break artifacts
  html = html.replace(/(<\/p>)(<p>)+/g, "</p><p>");
  return html;
}

// ── Citation popover (Slice B) ─────────────────────────────────────────────

let sourcesRegistry = {}; // { "1": {index, citation, label}, ... }
let turnBubbles = []; // all assistant bubbles of the current logical turn
const popover = document.getElementById("cite-popover");
let popoverOpen = false;

function showPopover(entry, chipEl) {
  const c = entry.citation;
  const tierClass = c.tier === "official" ? "official" : "community";
  const tierLabel = c.tier === "official" ? "OFF" : "COM";

  let html = `<div class="pop-label">${esc(entry.label)}</div>`;
  html += `<div class="pop-row">Tier: <span><span class="tier-chip ${tierClass}">${tierLabel}</span></span></div>`;
  html += `<div class="pop-row">Source: <span>${esc(c.source)}</span></div>`;
  html += `<div class="pop-row">Vintage: <span>${esc(c.vintage)}</span></div>`;
  if (c.caveat) html += `<div class="pop-row">Note: <span>${esc(c.caveat)}</span></div>`;
  if (c.raw_table) html += `<div class="pop-row pop-table">Table: ${esc(c.raw_table)}</div>`;
  if (c.url) {
    html += `<div class="pop-row">Link: <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a></div>`;
  }

  popover.innerHTML = html;
  popover.classList.add("open");
  popoverOpen = true;

  // Position near chip
  const rect = chipEl.getBoundingClientRect();
  const pw = 320;
  let left = rect.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  popover.style.left = left + "px";
  popover.style.top = (rect.bottom + 6) + "px";
}

function closePopover() {
  popover.classList.remove("open");
  popoverOpen = false;
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });
document.addEventListener("click", (e) => {
  if (popoverOpen && !popover.contains(e.target) && !e.target.classList.contains("cite-chip") && !e.target.classList.contains("cell-value")) {
    closePopover();
  }
});

/**
 * Post-process a rendered bubble: replace [n] with superscript cite chips.
 * Called after streaming finishes and sources are in registry.
 */
export function applyCiteChips(bubbleEl) {
  const walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);

  for (const textNode of nodes) {
    const text = textNode.textContent;
    if (!/\[\d+\]/.test(text)) continue;

    const frag = document.createDocumentFragment();
    let last = 0;
    const re = /\[(\d+)\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const idx = m[1];
      const entry = sourcesRegistry[idx];
      if (entry) {
        const chip = document.createElement("sup");
        chip.className = "cite-chip " + (entry.citation.tier === "official" ? "official" : "community");
        chip.textContent = entry.citation.tier === "official" ? "OFF" : "COM";
        chip.title = entry.label;
        chip.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (popoverOpen && popover.dataset.forChip === idx) { closePopover(); return; }
          popover.dataset.forChip = idx;
          showPopover(entry, chip);
        });
        frag.appendChild(chip);
      } else {
        frag.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

/** Apply cite chips to EVERY assistant bubble of the current turn (idempotent). */
function applyCiteChipsToTurn() {
  for (const b of turnBubbles) {
    if (b.isConnected) applyCiteChips(b);
  }
}

/** Show popover for a citation envelope cell (viz cards). */
export function showCellPopover(envelope, cellEl) {
  const c = envelope.citation;
  const entry = { label: envelope.label, citation: c };
  const fakeChip = { getBoundingClientRect: () => cellEl.getBoundingClientRect(), dataset: {} };
  popover.dataset.forChip = "";
  showPopover(entry, cellEl);
}

// ── Source dropdown (Slice D) ──────────────────────────────────────────────

const sourceBtn = document.getElementById("source-btn");
const sourcePanel = document.getElementById("source-panel");
const srcWeb = document.getElementById("src-web");
const srcEdu = document.getElementById("src-edu");
const srcReddit = document.getElementById("src-reddit");
const subredditSection = document.getElementById("subreddit-section");
const subredditList = document.getElementById("subreddit-list");

let allSubreddits = []; // [{sub, label}]
let subredditStates = {}; // sub → checked bool

sourceBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  sourcePanel.classList.toggle("open");
});

document.addEventListener("click", (e) => {
  if (!sourcePanel.contains(e.target) && e.target !== sourceBtn) {
    sourcePanel.classList.remove("open");
  }
});

srcReddit.addEventListener("change", () => {
  subredditSection.classList.toggle("visible", srcReddit.checked);
  saveSourceConfig();
});

[srcWeb, srcEdu].forEach(el => el.addEventListener("change", saveSourceConfig));

function saveSourceConfig() {
  const cfg = buildSourceConfig();
  localStorage.setItem("counselle_source_config", JSON.stringify(cfg));
}

function buildSourceConfig() {
  const checked = [];
  for (const [sub, on] of Object.entries(subredditStates)) {
    if (on) checked.push(sub);
  }
  const allOn = allSubreddits.every(s => subredditStates[s.sub]);
  return {
    web: srcWeb.checked,
    edu: srcEdu.checked,
    reddit: srcReddit.checked,
    reddit_subreddits: (srcReddit.checked && !allOn) ? checked : null,
  };
}

async function loadSourceMeta() {
  try {
    const res = await fetch("/v1/meta/sources");
    if (!res.ok) return;
    const data = await res.json();

    // Apply defaults
    srcWeb.checked = data.defaults?.web ?? true;
    srcEdu.checked = data.defaults?.edu ?? true;
    srcReddit.checked = data.defaults?.reddit ?? true;

    // Load stored overrides
    const stored = localStorage.getItem("counselle_source_config");
    if (stored) {
      try {
        const cfg = JSON.parse(stored);
        srcWeb.checked = cfg.web ?? srcWeb.checked;
        srcEdu.checked = cfg.edu ?? srcEdu.checked;
        srcReddit.checked = cfg.reddit ?? srcReddit.checked;
        if (cfg.reddit_subreddits) {
          // Will apply after subreddits are rendered
          window._storedSubreddits = cfg.reddit_subreddits;
        }
      } catch (_) {}
    }

    // Build subreddit checkboxes
    allSubreddits = (data.subreddits || []).filter(s => !s.sub.includes("{"));
    renderSubreddits();

    if (srcReddit.checked) subredditSection.classList.add("visible");
  } catch (_) {}
}

function renderSubreddits() {
  subredditList.innerHTML = "";
  const stored = window._storedSubreddits;
  for (const { sub, label } of allSubreddits) {
    const checked = stored ? stored.includes(sub) : true;
    subredditStates[sub] = checked;

    const row = document.createElement("div");
    row.className = "src-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `sub-${sub}`;
    cb.checked = checked;
    cb.addEventListener("change", () => {
      subredditStates[sub] = cb.checked;
      saveSourceConfig();
    });
    const lbl = document.createElement("label");
    lbl.htmlFor = `sub-${sub}`;
    lbl.textContent = `r/${sub}`;
    lbl.title = label;
    row.appendChild(cb);
    row.appendChild(lbl);
    subredditList.appendChild(row);
  }
}

// ── Message rendering ──────────────────────────────────────────────────────

const messagesEl = document.getElementById("messages");

function appendMsg(role, content, extra = {}) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (extra.id) div.id = extra.id;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant" || role === "error") bubble.classList.add("md");

  if (typeof content === "string") {
    bubble.innerHTML = content;
  } else {
    bubble.appendChild(content);
  }

  div.appendChild(bubble);

  if (extra.traceId) {
    const t = document.createElement("div");
    t.className = "trace-id";
    t.textContent = `trace: ${extra.traceId}`;
    div.appendChild(t);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// ── Session management ─────────────────────────────────────────────────────

const sessionLabel = document.getElementById("session-label");
let sessionId = null;
let streamActive = false;

async function initSession() {
  // Try to reuse stored session
  const stored = localStorage.getItem("counselle_session_id");
  if (stored) {
    try {
      const res = await fetch(`/v1/sessions/${stored}`);
      if (res.ok) {
        const data = await res.json();
        sessionId = stored;
        sessionLabel.textContent = sessionId.slice(0, 8) + "…";
        // Replay transcript
        if (data.transcript && data.transcript.length > 0) {
          for (const entry of data.transcript) {
            if (entry.role === "user") {
              appendMsg("user", esc(entry.text));
            } else if (entry.role === "assistant") {
              const div = appendMsg("assistant", "");
              const bubble = div.querySelector(".bubble");
              bubble.innerHTML = `<div class="md">${mdLite(entry.text)}</div>`;
            }
          }
        }
        return;
      }
    } catch (_) {}
  }
  await createSession();
}

async function createSession() {
  const srcCfg = buildSourceConfig();
  const res = await fetch("/v1/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_config: srcCfg }),
  });
  if (!res.ok) {
    appendMsg("error", `<strong>Error:</strong> Could not create session (${res.status}).`);
    return;
  }
  const data = await res.json();
  sessionId = data.session_id;
  localStorage.setItem("counselle_session_id", sessionId);
  sessionLabel.textContent = sessionId.slice(0, 8) + "…";
  messagesEl.innerHTML = "";
}

document.getElementById("new-chat-btn").addEventListener("click", async () => {
  if (streamActive) return;
  localStorage.removeItem("counselle_session_id");
  await createSession();
});

// ── SSE streaming (Slice A) ────────────────────────────────────────────────

const sendBtn = document.getElementById("send-btn");
const msgInput = document.getElementById("msg-input");

// ?noviz=1 flag: render viz specs as plain markdown tables
const noViz = new URLSearchParams(location.search).has("noviz");

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(msgInput.value.trim());
  }
});
sendBtn.addEventListener("click", () => send(msgInput.value.trim()));

// Auto-resize textarea
msgInput.addEventListener("input", () => {
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + "px";
});

export async function send(text, opts = {}) {
  if (!text || streamActive || !sessionId) return;
  msgInput.value = "";
  msgInput.style.height = "auto";
  streamActive = true;
  sendBtn.disabled = true;

  if (!opts.silent) {
    appendMsg("user", esc(text));
  }

  // Current assistant bubble
  const assistantDiv = document.createElement("div");
  assistantDiv.className = "msg assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble md typing-dots";
  assistantDiv.appendChild(bubble);
  messagesEl.appendChild(assistantDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let rawText = "";
  let currentTraceId = null;
  let currentStreamId = opts.streamId || null;
  // Reset per-turn state — but a clarify answer (inReplyTo) CONTINUES the same
  // logical turn: keep accumulating bubbles so the final sources event can
  // retro-fit chips onto every bubble of the turn.
  if (!opts.inReplyTo) {
    sourcesRegistry = {};
    turnBubbles = [];
  }
  turnBubbles.push(bubble);

  const body = {
    text,
    source_config: buildSourceConfig(),
  };
  if (opts.inReplyTo) body.in_reply_to = opts.inReplyTo;

  try {
    const res = await fetch(`/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      bubble.classList.remove("typing-dots");
      bubble.classList.add("error");
      bubble.innerHTML = `<strong>Error ${res.status}</strong>`;
      streamActive = false;
      sendBtn.disabled = false;
      return;
    }

    // SSE line parser: ReadableStream + TextDecoder
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let currentEvent = {};

    const flush = () => {
      if (currentEvent.event && currentEvent.data) {
        let payload = null;
        try {
          payload = JSON.parse(currentEvent.data);
        } catch (parseErr) {
          console.warn("SSE: unparseable data for event", currentEvent.event, parseErr);
        }
        if (payload !== null) {
          handleEvent(currentEvent.event, payload, currentEvent.id, {
            bubble, assistantDiv, rawText: () => rawText,
            setRawText: (t) => { rawText = t; },
            setTraceId: (t) => { currentTraceId = t; },
            getTraceId: () => currentTraceId,
            streamId: currentStreamId,
            setStreamId: (id) => { currentStreamId = id; },
          });
        }
      }
      currentEvent = {};
    };

    // One SSE line. sse-starlette emits CRLF line endings — split on \n and
    // strip a trailing \r, otherwise the blank dispatch line never matches
    // and NO event ever flushes (the empty-bubble bug).
    const parseLine = (rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith(":")) return; // keepalive comment
      if (line === "") { flush(); return; }
      if (line.startsWith("event:")) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        // Per SSE spec: strip one leading space, concatenate multi-line data with \n
        const chunk = line.slice(5).replace(/^ /, "");
        currentEvent.data = currentEvent.data === undefined ? chunk : currentEvent.data + "\n" + chunk;
      } else if (line.startsWith("id:")) {
        currentEvent.id = line.slice(3).trim();
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop(); // keep partial last line

      for (const line of lines) parseLine(line);
    }
    // Flush any remaining buffer line
    if (buf) parseLine(buf);
    flush();

    // Final post-processing: apply cite chips to ALL bubbles of the turn
    bubble.classList.remove("typing-dots");
    if (rawText) {
      bubble.innerHTML = `<div class="md">${mdLite(rawText)}</div>`;
    }
    applyCiteChipsToTurn();
    if (currentTraceId && !assistantDiv.querySelector(".trace-id")) {
      const t = document.createElement("div");
      t.className = "trace-id";
      t.textContent = `trace: ${currentTraceId}`;
      assistantDiv.appendChild(t);
    }

  } catch (err) {
    bubble.classList.remove("typing-dots");
    bubble.classList.add("error");
    bubble.textContent = `Network error: ${err.message}`;
  } finally {
    streamActive = false;
    sendBtn.disabled = false;
  }
}

/**
 * Handle one parsed SSE event.
 * ctx: { bubble, assistantDiv, rawText(), setRawText(), setTraceId(), getTraceId(), streamId, setStreamId() }
 */
function handleEvent(type, payload, id, ctx) {
  const data = payload.data ?? payload;

  if (type === "meta") {
    ctx.setTraceId(data.trace_id);
    ctx.bubble.classList.remove("typing-dots");
    return;
  }

  if (type === "delta") {
    const chunk = data.text || "";
    ctx.setRawText(ctx.rawText() + chunk);
    // Incremental render
    ctx.bubble.classList.remove("typing-dots");
    ctx.bubble.innerHTML = `<div class="md">${mdLite(ctx.rawText())}</div>`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  if (type === "sources") {
    const sources = data.sources || [];
    for (const entry of sources) {
      sourcesRegistry[String(entry.index)] = entry;
    }
    // Retro-fit chips onto every assistant bubble of the turn immediately
    applyCiteChipsToTurn();
    return;
  }

  if (type === "viz") {
    // Import viz renderer (already loaded as module)
    if (noViz) {
      renderVizFallback(data, ctx.assistantDiv);
    } else {
      window.__renderViz && window.__renderViz(data, ctx.assistantDiv);
    }
    return;
  }

  if (type === "clarify") {
    window.__renderClarify && window.__renderClarify(data, ctx.assistantDiv, id, sessionId, send);
    return;
  }

  if (type === "usage") {
    const inTok = data.input_tokens ?? 0;
    const outTok = data.output_tokens ?? 0;
    const cost = data.est_cost_usd != null ? ` · $${Number(data.est_cost_usd).toFixed(4)}` : "";
    const u = document.createElement("div");
    u.className = "usage-line";
    u.textContent = `${inTok} in / ${outTok} out${cost}`;
    ctx.assistantDiv.appendChild(u);
    return;
  }

  if (type === "done") {
    ctx.bubble.classList.remove("typing-dots");
    // Safety net: re-apply chips in case sources arrived before the last render
    applyCiteChipsToTurn();
    return;
  }

  if (type === "error") {
    ctx.bubble.classList.remove("typing-dots");
    ctx.bubble.classList.add("error");
    const msg = data.message || "An error occurred.";
    const tid = data.trace_id || ctx.getTraceId() || "";
    ctx.bubble.innerHTML = `<strong>Error:</strong> ${esc(msg)}`;
    if (tid) {
      const t = document.createElement("div");
      t.className = "trace-id";
      t.textContent = `trace: ${tid}`;
      ctx.assistantDiv.appendChild(t);
    }
    return;
  }
  // Unknown event types silently ignored (forward compat)
}

/** ?noviz=1 fallback: render viz spec as plain markdown-ish table. */
function renderVizFallback(spec, parentEl) {
  const card = document.createElement("div");
  card.className = "viz-card";
  const h3 = document.createElement("h3");
  h3.textContent = spec.title || "Visualization";
  card.appendChild(h3);

  const table = document.createElement("table");
  table.className = "noviz-table";

  // Header row: label + school names
  const schools = spec.schools || [];
  if (schools.length > 0) {
    const hr = table.insertRow();
    hr.insertCell().textContent = "";
    for (const s of schools) {
      const th = document.createElement("th");
      th.textContent = s.name;
      hr.appendChild(th);
    }
  }

  for (const row of (spec.rows || [])) {
    const tr = table.insertRow();
    const lbl = tr.insertCell();
    lbl.textContent = row.label;
    for (const cell of (row.cells || [])) {
      const td = tr.insertCell();
      td.textContent = cell.available ? cell.display : "not available";
    }
  }

  card.appendChild(table);
  parentEl.parentNode.insertBefore(card, parentEl.nextSibling);
}

// ── Expose send for clarify.js ─────────────────────────────────────────────
window.__appSend = send;

// ── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  await loadSourceMeta();
  await initSession();
})();
