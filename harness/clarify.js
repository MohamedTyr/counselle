/**
 * Counselle dev harness — clarify.js (Slice C)
 * Renders clarify events as inline widgets.
 * The main input box stays ENABLED — chips are shortcuts, not a modal.
 */

/**
 * Render a ClarifySpec as an inline widget after parentEl.
 * @param {object} spec  - ClarifySpec payload
 * @param {HTMLElement} parentEl - The current assistant message div
 * @param {string|null} eventId  - SSE event id (used as in_reply_to)
 * @param {string} sessionId     - Current session id
 * @param {Function} sendFn      - The send() function from app.js
 */
function renderClarify(spec, parentEl, eventId, sessionId, sendFn) {
  const widget = document.createElement("div");
  widget.className = "clarify-widget";

  const question = document.createElement("div");
  question.className = "clarify-question";
  question.textContent = spec.question || "";
  widget.appendChild(question);

  if (spec.header) {
    const header = document.createElement("div");
    header.className = "clarify-header";
    header.textContent = spec.header;
    widget.appendChild(header);
  }

  let selectedSingle = null; // for single-select
  const selectedMulti = new Set(); // for multi-select

  function submitAnswer(text) {
    widget.style.opacity = "0.6";
    widget.style.pointerEvents = "none";
    sendFn(text, { inReplyTo: eventId || null, silent: false });
  }

  const optionsEl = document.createElement("div");
  optionsEl.className = spec.multi_select ? "clarify-options clarify-multi" : "clarify-options";

  for (const opt of (spec.options || [])) {
    if (spec.multi_select) {
      // Checkbox mode
      const row = document.createElement("label");
      row.className = "clarify-check-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => {
        if (cb.checked) selectedMulti.add(opt.label);
        else selectedMulti.delete(opt.label);
      });
      const lbl = document.createElement("span");
      lbl.textContent = opt.label;
      if (opt.hint) lbl.title = opt.hint;
      row.appendChild(cb);
      row.appendChild(lbl);
      optionsEl.appendChild(row);
    } else {
      // Chip mode (single select — clicking submits immediately)
      const chip = document.createElement("button");
      chip.className = "clarify-chip";
      chip.textContent = opt.label;
      if (opt.hint) chip.title = opt.hint;
      chip.addEventListener("click", () => {
        submitAnswer(opt.label);
      });
      optionsEl.appendChild(chip);
    }
  }

  widget.appendChild(optionsEl);

  // Multi-select submit button
  if (spec.multi_select) {
    const submitBtn = document.createElement("button");
    submitBtn.className = "clarify-chip";
    submitBtn.style.marginTop = "8px";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => {
      const text = [...selectedMulti].join(", ");
      if (!text) return;
      submitAnswer(text);
    });
    widget.appendChild(submitBtn);
  }

  // "Other…" free-text — always rendered
  const otherRow = document.createElement("div");
  otherRow.className = "clarify-other";

  const otherInput = document.createElement("input");
  otherInput.type = "text";
  otherInput.placeholder = "Other… (or just type in the main box)";

  const otherBtn = document.createElement("button");
  otherBtn.textContent = "Send";
  otherBtn.addEventListener("click", () => {
    const text = otherInput.value.trim();
    if (!text) return;
    submitAnswer(text);
  });
  otherInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") otherBtn.click();
  });

  otherRow.appendChild(otherInput);
  otherRow.appendChild(otherBtn);
  widget.appendChild(otherRow);

  // Insert after the assistant bubble
  const container = parentEl.parentNode;
  container.insertBefore(widget, parentEl.nextSibling);
  document.getElementById("messages").scrollTop = document.getElementById("messages").scrollHeight;
}

// Register globally
window.__renderClarify = renderClarify;
