/**
 * Counselle dev harness — viz.js (Slice C)
 * Renders viz events: stat_block, comparison_table, score_band.
 * Numbers never come from the LLM; they come from CitationEnvelope.raw.
 */

import { showCellPopover } from "/harness/app.js";

/**
 * Render a RenderSpec into a viz card inserted after parentEl.
 * @param {object} spec - RenderSpec payload from the viz event data
 * @param {HTMLElement} parentEl - The current assistant bubble div
 */
function renderViz(spec, parentEl) {
  const card = document.createElement("div");
  card.className = "viz-card";

  const h3 = document.createElement("h3");
  h3.textContent = spec.title || "";
  card.appendChild(h3);

  switch (spec.type) {
    case "stat_block":
      buildStatBlock(card, spec);
      break;
    case "comparison_table":
      buildComparisonTable(card, spec);
      break;
    case "score_band":
      buildScoreBand(card, spec);
      break;
    default:
      card.appendChild(document.createTextNode(`[Unknown viz type: ${spec.type}]`));
  }

  // Insert card after the assistant bubble (before next sibling)
  const container = parentEl.parentNode;
  container.insertBefore(card, parentEl.nextSibling);
  // Scroll
  document.getElementById("messages").scrollTop = document.getElementById("messages").scrollHeight;
}

// ── stat_block ─────────────────────────────────────────────────────────────

function buildStatBlock(card, spec) {
  for (const row of (spec.rows || [])) {
    const rowEl = document.createElement("div");
    rowEl.className = "stat-row";

    const lbl = document.createElement("span");
    lbl.className = "stat-label";
    lbl.textContent = row.label;
    rowEl.appendChild(lbl);

    // stat_block typically has one cell per row (the first)
    const cell = row.cells && row.cells[0];
    const val = document.createElement("span");
    val.className = "stat-value";

    if (!cell || !cell.available) {
      val.classList.add("unavailable");
      val.textContent = "not available";
    } else {
      const tier = cell.citation?.tier || "official";
      const chipLabel = tier === "official" ? "OFF" : "COM";
      const chipClass = tier === "official" ? "official" : "community";

      const valueSpan = document.createElement("span");
      valueSpan.className = "cell-value";
      valueSpan.textContent = cell.display;
      valueSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        showCellPopover(cell, valueSpan);
      });

      const chip = document.createElement("span");
      chip.className = `tier-chip ${chipClass}`;
      chip.textContent = chipLabel;

      val.appendChild(valueSpan);
      val.appendChild(chip);
    }

    rowEl.appendChild(val);
    card.appendChild(rowEl);
  }
}

// ── comparison_table ───────────────────────────────────────────────────────

function buildComparisonTable(card, spec) {
  const schools = spec.schools || [];
  const wrapper = document.createElement("div");
  wrapper.style.overflowX = "auto";

  const table = document.createElement("table");
  table.className = "viz-table";

  // Header
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const emptyTh = document.createElement("th");
  emptyTh.textContent = "";
  hr.appendChild(emptyTh);
  for (const s of schools) {
    const th = document.createElement("th");
    th.textContent = s.name;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  // Rows
  const tbody = document.createElement("tbody");
  for (const row of (spec.rows || [])) {
    const tr = document.createElement("tr");

    const labelTd = document.createElement("td");
    labelTd.className = "row-label";
    labelTd.textContent = row.label;
    tr.appendChild(labelTd);

    for (const cell of (row.cells || [])) {
      const td = document.createElement("td");

      if (!cell.available) {
        td.className = "cell-unavailable";
        td.textContent = "not available";
      } else {
        td.className = "cell-available";
        const tier = cell.citation?.tier || "official";
        const chipLabel = tier === "official" ? "OFF" : "COM";
        const chipClass = tier === "official" ? "official" : "community";

        const spanVal = document.createElement("span");
        spanVal.textContent = cell.display;

        const chip = document.createElement("span");
        chip.className = `tier-chip ${chipClass}`;
        chip.textContent = chipLabel;

        td.appendChild(spanVal);
        td.appendChild(chip);
        td.addEventListener("click", (e) => {
          e.stopPropagation();
          showCellPopover(cell, td);
        });
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrapper.appendChild(table);
  card.appendChild(wrapper);
}

// ── score_band ─────────────────────────────────────────────────────────────

/**
 * Infer the score scale from the band definition or row label.
 * SAT section: 200–800. ACT: 1–36.
 */
function inferScale(band, rowLabel) {
  const label = (rowLabel || "").toLowerCase();
  const test = (band?.test || "").toLowerCase();

  if (test === "act" || label.includes("act")) {
    return { min: 1, max: 36 };
  }
  // Default SAT section scale
  return { min: 200, max: 800 };
}

function buildScoreBand(card, spec) {
  const band = spec.band;

  for (const row of (spec.rows || [])) {
    // A score_band row has cells: [p25_cell, p75_cell] (or just one if unavailable)
    const p25Cell = row.cells && row.cells[0];
    const p75Cell = row.cells && row.cells[1];

    const rowEl = document.createElement("div");
    rowEl.className = "band-row";

    const rowLabel = document.createElement("div");
    rowLabel.className = "band-row-label";
    rowLabel.textContent = row.label;
    rowEl.appendChild(rowLabel);

    const unavailable = !p25Cell?.available && !p75Cell?.available;
    if (unavailable) {
      const u = document.createElement("div");
      u.className = "band-unavailable";
      u.textContent = "not reported";
      rowEl.appendChild(u);
      card.appendChild(rowEl);
      continue;
    }

    const scale = inferScale(band, row.label);
    const p25 = Number(p25Cell?.raw ?? scale.min);
    const p75 = Number(p75Cell?.raw ?? scale.max);
    const range = scale.max - scale.min;

    const leftPct = ((p25 - scale.min) / range) * 100;
    const widthPct = ((p75 - p25) / range) * 100;

    const track = document.createElement("div");
    track.className = "band-track";

    const fill = document.createElement("div");
    fill.className = "band-fill";
    fill.style.left = `${leftPct.toFixed(1)}%`;
    fill.style.width = `${Math.max(widthPct, 1).toFixed(1)}%`;
    track.appendChild(fill);
    rowEl.appendChild(track);

    const labels = document.createElement("div");
    labels.className = "band-labels";

    const p25Lbl = document.createElement("span");
    p25Lbl.textContent = p25Cell?.available ? p25Cell.display : "—";

    const p75Lbl = document.createElement("span");
    p75Lbl.textContent = p75Cell?.available ? p75Cell.display : "—";

    labels.appendChild(p25Lbl);
    labels.appendChild(p75Lbl);
    rowEl.appendChild(labels);

    card.appendChild(rowEl);
  }
}

// ── Register globally ──────────────────────────────────────────────────────
window.__renderViz = renderViz;
