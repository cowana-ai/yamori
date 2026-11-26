'use strict';
// Stages inside Yamori's main panel (the project panel's Stages tab).
// The stage graph stays on top; a stage card (and anything opened from it)
// expands below the graph instead of replacing it. Rendering uses only the
// state the extension posts, so opening anything here never calls a model.
const { randomBytes } = require('node:crypto');

// Line diff for the review view: red/green pseudocode without a library.
function lineDiff(before = '', after = '') {
  const a = String(before).split('\n'), b = String(after).split('\n');
  const n = a.length, m = b.length;
  if (n * m > 250000) return [...a.map(text => ({ kind: 'del', text })), ...b.map(text => ({ kind: 'add', text }))];
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

// Scoped to #stages-view so it never touches the rest of the panel. Uses the
// panel's own reading palette (--read-*), with VS Code colors as fallback.
const STAGES_STYLE = `
#stages-view { overflow: auto; padding: 0 20px 40px; --st-add: #79c99b; --st-del: #f0a29a; --st-warn: var(--vscode-editorWarning-foreground, #d7ba7d); }
body.vscode-light:not([data-palette="slate"]) #stages-view, body[data-palette="paper"] #stages-view { --st-add: #21633e; --st-del: #a23733; --st-warn: #8a6100; }
#stages-view .st-top { padding: 0; border-bottom: 1px solid var(--read-border); }
#stages-view > .st-bar { position: sticky; top: 0; z-index: 3; background: var(--read-page); padding: 12px 0 8px; }
#stages-view .st-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
#stages-view .st-eyebrow { font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--read-muted); }
#stages-view .st-bar button, #stages-view .st-tools button, #stages-view select { font-size: 12px; border: 1px solid var(--read-border); }
#stages-view select { font: inherit; font-size: 12px; color: var(--read-ink); background: var(--read-surface); padding: 4px 6px; border-radius: 0; }
#stages-view button.st-go { background: var(--read-accent); color: var(--read-on-accent); border: 1px solid var(--read-accent); font-weight: 700; }
#stages-view button.st-link { border: 0; padding: 2px 4px; color: var(--read-link, var(--read-ink)); text-decoration: underline; text-underline-offset: 3px; }
#stages-view .st-spacer { flex: 1; }
#stages-view .st-muted { color: var(--read-muted); }
#stages-view .st-error { color: var(--read-error); font-weight: 700; margin: 8px 0; }
#stages-view .st-notice { margin: 8px 0; padding: 7px 10px; border: 1px solid var(--read-border); background: var(--read-surface); font-size: 12px; }
#stages-view .st-review { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 10px 0 0; padding: 7px 10px; border: 1px solid var(--read-ink); box-shadow: 2px 2px 0 var(--read-ink); background: var(--read-surface); }
#stages-view .st-graph { display: flex; align-items: stretch; overflow-x: auto; padding: 16px 2px 12px; }
#stages-view .st-stage { position: relative; flex: 0 0 196px; padding: 10px 12px; border: 1px solid var(--read-border); background: var(--read-surface); text-align: left; color: inherit; }
#stages-view .st-stage:hover { background: var(--read-hover); }
#stages-view .st-stage.open { border-color: var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); }
#stages-view .st-stage.stale { border-style: dashed; }
#stages-view .st-name { font-weight: 700; }
#stages-view .st-gist { margin-top: 4px; font-size: 12px; color: var(--read-muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
#stages-view .st-meta { margin-top: 6px; font: 11px ui-monospace, monospace; color: var(--read-muted); }
#stages-view .st-badges { position: absolute; top: -9px; right: 8px; display: flex; gap: 4px; }
#stages-view .st-badge { font: 700 10px/16px ui-monospace, monospace; padding: 0 6px; border: 1px solid var(--read-border); background: var(--read-page); color: var(--read-ink); }
#stages-view .st-badge.plus { border-color: var(--st-add); color: var(--st-add); }
#stages-view .st-badge.stale { border-color: var(--st-warn); color: var(--st-warn); }
#stages-view .st-edge { flex: 0 0 76px; display: flex; flex-direction: column; justify-content: center; align-items: center; font: 10px/1.3 ui-monospace, monospace; color: var(--read-muted); text-align: center; padding: 0 4px; }
#stages-view .st-edge b { font-size: 16px; color: var(--read-ink); }
#stages-view .st-card { margin: 14px 0; padding: 14px 16px; border: 1px solid var(--read-ink); background: var(--read-surface); }
#stages-view .st-card h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font: 700 15px var(--vscode-font-family, system-ui); text-transform: none; letter-spacing: 0; }
#stages-view .st-story { display: grid; grid-template-columns: 52px 1fr; gap: 3px 10px; margin: 12px 0; }
#stages-view .st-story b { font: 600 11px/1.9 ui-monospace, monospace; text-transform: uppercase; color: var(--read-muted); }
#stages-view .st-section { margin-top: 16px; }
#stages-view .st-section > h3 { margin: 0 0 6px; font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--read-muted); }
#stages-view .st-steps { list-style: none; margin: 0; padding: 0; }
#stages-view .st-steps li { padding: 7px 0; border-top: 1px solid var(--read-border); }
#stages-view .st-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
#stages-view .st-symbol { font: 700 13px ui-monospace, monospace; }
#stages-view .st-chip { font: 11px ui-monospace, monospace; padding: 1px 6px; border: 1px solid var(--read-border); color: var(--read-link, var(--read-ink)); }
#stages-view pre { margin: 6px 0 0; padding: 8px 10px; background: var(--read-note-bg); color: var(--read-ink); font: 12px/1.55 var(--vscode-editor-font-family, ui-monospace, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
#stages-view .st-diff span { display: block; }
#stages-view .st-diff .add { color: var(--st-add); background: color-mix(in srgb, var(--st-add) 12%, transparent); }
#stages-view .st-diff .del { color: var(--st-del); background: color-mix(in srgb, var(--st-del) 12%, transparent); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--st-del) 50%, transparent); }
#stages-view .st-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
#stages-view textarea { display: block; width: 100%; min-height: 54px; resize: vertical; padding: 8px 10px; color: var(--read-ink); background: var(--read-page); border: 1px solid var(--read-border); border-radius: 0; font: 13px/1.5 var(--vscode-font-family, system-ui); }
#stages-view .st-sentence { font-size: 14px; margin: 4px 0 8px; }
#stages-view .st-empty { max-width: 760px; padding: 26px 0; }
#stages-view .st-empty h1 { margin: 0 0 6px; font-size: 20px; }
#stages-view .st-found { margin: 14px 0; padding: 14px 16px; border: 1px solid var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); background: var(--read-surface); }
#stages-view .st-found .st-symbol { font-size: 15px; }
#stages-view .st-others { list-style: none; margin: 8px 0 0; padding: 0; }
#stages-view .st-others li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--read-border); }
#stages-view table { border-collapse: collapse; width: 100%; font-size: 12px; }
#stages-view td, #stages-view th { text-align: left; padding: 3px 6px; border-top: 1px solid var(--read-border); }
#stages-view th { color: var(--read-muted); font-weight: 500; }
#stages-view details > summary { cursor: pointer; color: var(--read-muted); }
#stages-view .st-title { margin: 0; font-size: 18px; }
#stages-view .st-summary { margin: 6px 0 10px; max-width: 90ch; font-size: 14px; }
#stages-view .st-top.st-plain { position: static; border: 0; }
#stages-view .st-ask { margin: 10px 0 12px; }
#stages-view .st-chat { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin: 10px 0 12px; padding: 10px 12px; border: 1px solid var(--read-border); background: var(--read-surface); }
#stages-view .st-ask .st-row { align-items: stretch; flex-wrap: nowrap; }
#stages-view .st-ask textarea { min-height: 40px; flex: 1; }
#stages-view .st-route { margin-top: 8px; padding: 10px 12px; border: 1px solid var(--read-border); background: var(--read-surface); }
#stages-view .st-targets { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 6px 0; }
#stages-view .st-target { display: inline-flex; gap: 6px; align-items: center; font-weight: 600; }
#stages-view .st-parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin: 16px 0; }
#stages-view .st-part { padding: 12px 14px; border: 1px solid var(--read-border); background: var(--read-surface); }
#stages-view .st-part.open { border-color: var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); }
#stages-view .st-part-name { padding: 0; border: 0; font: 700 15px var(--vscode-font-family, system-ui); text-align: left; }
#stages-view .st-part-summary { margin: 4px 0 10px; color: var(--read-muted); }
#stages-view .st-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
#stages-view .st-step { font-size: 12px; padding: 3px 8px; border: 1px solid var(--read-border); background: var(--read-page); }
#stages-view .st-step.open { border-color: var(--read-ink); font-weight: 700; }
#stages-view .st-step.stale { border-style: dashed; }
#stages-view .st-step.changed { border-color: var(--st-add); }
#stages-view .st-arrow { color: var(--read-muted); }
#stages-view .st-links { list-style: none; margin: 10px 0 0; padding: 8px 0 0; border-top: 1px solid var(--read-border); font-size: 12px; color: var(--read-muted); }
#stages-view .st-step-card { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--read-border); }
#stages-view .st-how { margin: 0; padding-left: 20px; }
#stages-view .st-how > li { margin: 6px 0; }
#stages-view .st-how-what { font-weight: 600; }
#stages-view .st-how-details { margin: 2px 0 0; padding-left: 18px; color: var(--read-muted); font-size: 12px; }
#stages-view .st-how-details li { margin: 1px 0; }
#stages-view .st-kind { display: inline-block; font: 600 10px/16px ui-monospace, monospace; padding: 0 5px; border: 1px solid var(--read-border); color: var(--read-ink); white-space: nowrap; }
#stages-view .st-kind.k-decides { border-color: oklch(75% .14 75); color: oklch(75% .14 75); }
#stages-view .st-kind.k-ai { border-color: oklch(70% .13 250); color: oklch(72% .13 250); }
#stages-view .st-kind.k-asks { border-color: oklch(72% .14 150); color: oklch(72% .14 150); }
#stages-view .st-kind.k-writes, #stages-view .st-kind.k-reads { border-color: oklch(70% .13 300); color: oklch(72% .12 300); }
#stages-view .st-kind.k-stops, #stages-view .st-kind.k-fallback { border-color: oklch(68% .15 25); color: oklch(70% .15 25); }
body.vscode-light:not([data-palette="slate"]) #stages-view .st-kind, body[data-palette="paper"] #stages-view .st-kind { filter: brightness(.7) saturate(1.3); }
#stages-view .st-node-kinds { display: flex; flex-wrap: wrap; gap: 3px; }
#stages-view .st-node.flowstep { gap: 4px; }
#stages-view .st-node.flowstep.sub { background: var(--read-page); }
#stages-view .st-decision { font-size: 11.5px; line-height: 15px; color: oklch(80% .12 75); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#stages-view .st-decision.stops { color: oklch(72% .15 25); }
#stages-view .st-behaviors { list-style: none; margin: 8px 0 0; padding: 0; }
#stages-view .st-behaviors li { padding: 4px 0; border-top: 1px solid color-mix(in srgb, var(--read-border) 50%, transparent); }
#stages-view .st-flow-detail { border-color: var(--read-ink); }
body.vscode-light:not([data-palette="slate"]) #stages-view .st-decision, body[data-palette="paper"] #stages-view .st-decision { color: oklch(45% .12 75); }
#stages-view .st-foot { margin-top: 18px; }
#stages-view { --st-c0: oklch(70% .13 250); --st-c1: oklch(72% .14 150); --st-c2: oklch(75% .14 75); --st-c3: oklch(68% .15 20); --st-c4: oklch(70% .13 300); --st-c5: oklch(74% .11 200); --st-c6: oklch(72% .13 110); }
#stages-view .st-canvas { position: relative; margin: 10px 0 6px; border: 1px solid var(--read-border); background: var(--read-page); background-image: radial-gradient(color-mix(in srgb, var(--read-ink) 12%, transparent) 1px, transparent 1px); background-size: 18px 18px; overflow: hidden; cursor: grab; touch-action: none; }
#stages-view .st-canvas.dragging, #stages-view .st-canvas.moving { cursor: grabbing; }
#stages-view .st-canvas.moving .st-node { pointer-events: none; }
#stages-view .st-movable .st-node { cursor: grab; }
#stages-view .st-svg { width: 100%; height: 100%; display: block; }
#stages-view .st-zoom { position: absolute; right: 8px; top: 8px; display: flex; gap: 4px; }
#stages-view .st-zoom button { min-width: 28px; font-size: 12px; border: 1px solid var(--read-border); background: var(--read-surface); }
#stages-view .st-zoom { align-items: center; }
#stages-view .st-canvas { resize: vertical; min-height: 180px; }
#stages-view .st-canvas.full { position: fixed; inset: 6px; z-index: 50; height: auto; resize: none; box-shadow: 0 8px 40px rgba(0,0,0,.45); background-color: var(--read-page); }
#stages-view .st-full-title { margin-right: 10px; font-size: 13px; }
#stages-view .st-canvas-hidden { display: flex; gap: 8px; align-items: center; margin: 8px 0; padding: 8px 10px; border: 1px dashed var(--read-border); }
#stages-view .st-blocks { list-style: none; margin: 6px 0 0; padding: 0; }
#stages-view .st-blocks li { border-top: 1px solid color-mix(in srgb, var(--read-border) 50%, transparent); padding: 3px 0; }
#stages-view .st-block-title { border: 0; padding: 2px 0; font-weight: 600; text-align: left; }
#stages-view code { font: 11px ui-monospace, monospace; overflow-wrap: anywhere; }
#stages-view .st-edge-line { fill: none; stroke: color-mix(in srgb, var(--read-ink) 55%, transparent); stroke-width: 1.6; }
#stages-view .st-edge-line.soft { stroke-dasharray: 5 4; stroke: color-mix(in srgb, var(--read-ink) 32%, transparent); stroke-width: 1.2; }
#stages-view .st-edge-line.hot { stroke: var(--read-link, var(--read-ink)); stroke-width: 1.8; }
#stages-view .st-edge-line.dim, #stages-view .st-edge-label.dim { opacity: .18; }
#stages-view .st-edge-line.faint { opacity: .3; }
#stages-view .st-colhead { font: 600 11px/22px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .04em; color: var(--read-ink); border-bottom: 3px solid var(--read-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#stages-view .st-arrowhead { fill: color-mix(in srgb, var(--read-ink) 70%, transparent); }
#stages-view .st-arrowhead.soft { fill: color-mix(in srgb, var(--read-ink) 35%, transparent); }
#stages-view .st-edge-label text { font: 11px var(--vscode-font-family, system-ui); fill: var(--read-muted); paint-order: stroke; stroke: var(--read-page); stroke-width: 5px; stroke-linejoin: round; }
#stages-view .st-node { box-sizing: border-box; width: 100%; height: 100%; overflow: hidden; padding: 8px 10px; border: 1px solid var(--read-border); background: var(--read-surface); cursor: pointer; font-size: 12px; line-height: 1.35; display: flex; flex-direction: column; gap: 3px; transition: opacity .15s; }
#stages-view .st-node:hover { border-color: var(--read-ink); }
#stages-view .st-node.selected { border-color: var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); }
#stages-view .st-node.dim { color: var(--read-muted); border-color: color-mix(in srgb, var(--read-border) 55%, transparent); background: color-mix(in srgb, var(--read-surface) 70%, var(--read-page)); }
#stages-view .st-node.dim b { color: var(--read-muted); }
#stages-view .st-node b { font-size: 13px; }
#stages-view .st-node.part b { font-size: 14px; }
#stages-view .st-node.shared, #stages-view .st-node.out { border-style: dashed; background: var(--read-page); }
#stages-view .st-node-head { display: flex; align-items: center; gap: 4px; }
#stages-view .st-node-text { color: var(--read-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#stages-view .st-node-text.one { -webkit-line-clamp: 2; }
#stages-view .st-node-flow { display: flex; flex-wrap: nowrap; gap: 3px; align-items: center; overflow: hidden; white-space: nowrap; color: var(--read-muted); font-size: 11px; }
#stages-view .st-node-flow span { border: 1px solid; border-left-width: 3px; padding: 0 4px; color: var(--read-ink); background: var(--read-page); }
#stages-view .st-node-meta { margin-top: auto; font: 10.5px ui-monospace, monospace; color: var(--read-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#stages-view .st-node .st-badge { position: static; }
#stages-view .st-hint { font-size: 12px; margin: 2px 0 10px; }
#stages-view .st-legend { margin: 8px 0; gap: 6px; }
#stages-view .st-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
#stages-view .st-split:empty { display: none; }
#stages-view .st-detail { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--read-border); background: var(--read-page); }
#stages-view .st-swatch { display: inline-block; width: 10px; height: 10px; margin-right: 4px; }
#stages-view .st-list { list-style: none; margin: 0; padding: 0; }
#stages-view .st-list li { padding: 3px 0; border-top: 1px solid color-mix(in srgb, var(--read-border) 50%, transparent); }
@media (max-height: 520px) { #stages-view > .st-bar { position: static; } }
`;

// The client: mountStages(root, post) renders into root; post(message) goes
// to the extension. Returns { update(state) }.
// Layered layout for a directed graph, left to right: each node sits one
// column after the nodes that point to it; rows are ordered to keep arrows short.
function layeredLayout(nodes, edges, { width = 220, height = 100, gapX = 90, gapY = 26, isolatedLast = false, isolatedBelow = false } = {}) {
  const ids = nodes.map(node => node.id), known = new Set(ids);
  const out = new Map(ids.map(id => [id, []])), into = new Map(ids.map(id => [id, []]));
  for (const edge of edges) if (known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to) { out.get(edge.from).push(edge.to); into.get(edge.to).push(edge.from); }
  // Break cycles: drop edges that close a loop in depth-first order.
  const state = new Map(), forward = new Map(ids.map(id => [id, []]));
  const visit = id => { state.set(id, 1); for (const next of out.get(id)) { if (state.get(next) === 1) continue; forward.get(id).push(next); if (!state.has(next)) visit(next); } state.set(id, 2); };
  for (const id of ids.filter(id => !into.get(id).length).concat(ids)) if (!state.has(id)) visit(id);
  const layer = new Map(ids.map(id => [id, 0])), indegree = new Map(ids.map(id => [id, 0]));
  for (const id of ids) for (const next of forward.get(id)) indegree.set(next, indegree.get(next) + 1);
  const queue = ids.filter(id => !indegree.get(id));
  while (queue.length) { const id = queue.shift(); for (const next of forward.get(id)) { layer.set(next, Math.max(layer.get(next), layer.get(id) + 1)); indegree.set(next, indegree.get(next) - 1); if (!indegree.get(next)) queue.push(next); } }
  const connected = id => out.get(id).length || into.get(id).length;
  const maxLayer = Math.max(0, ...ids.filter(connected).map(id => layer.get(id)));
  if (isolatedLast) for (const id of ids) if (!connected(id)) layer.set(id, maxLayer + 1);
  const alone = isolatedBelow ? ids.filter(id => !connected(id)) : [];
  const columns = [];
  for (const id of ids) if (!alone.includes(id)) (columns[layer.get(id)] ||= []).push(id);
  for (let i = 0; i < columns.length; i++) columns[i] ||= [];
  // Order rows by the average row of neighbors, a few sweeps each way.
  const row = new Map();
  const setRows = () => columns.forEach(column => column.forEach((id, index) => row.set(id, index)));
  setRows();
  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 ? [...columns.keys()].reverse() : [...columns.keys()];
    for (const c of order) {
      const score = id => { const near = [...into.get(id), ...out.get(id)].filter(other => Math.abs(layer.get(other) - c) === 1); return near.length ? near.reduce((sum, other) => sum + row.get(other), 0) / near.length : row.get(id); };
      columns[c].sort((a, b) => score(a) - score(b));
      setRows();
    }
  }
  const tallest = Math.max(1, ...columns.map(column => column.length));
  const positions = new Map();
  columns.forEach((column, c) => {
    const offset = (tallest - column.length) * (height + gapY) / 2;
    column.forEach((id, index) => positions.set(id, { x: c * (width + gapX), y: offset + index * (height + gapY), layer: c }));
  });
  // Parts with no links sit in a row underneath, so the chain stays compact.
  const hasChain = columns.some(column => column && column.length);
  const perRow = hasChain ? Math.max(3, columns.length) : Math.min(4, Math.max(1, alone.length)), below = hasChain ? tallest * (height + gapY) + 24 : 0;
  alone.forEach((id, index) => positions.set(id, { x: (index % perRow) * (width + gapX), y: below + Math.floor(index / perRow) * (height + gapY), layer: index % perRow }));
  const rows = alone.length ? Math.ceil(alone.length / perRow) : 0;
  return { positions, width: Math.max(hasChain ? columns.length : 0, Math.min(alone.length, perRow)) * (width + gapX) - gapX, height: ((hasChain ? tallest : 0) + rows) * (height + gapY) - gapY + (rows && hasChain ? 24 : 0) };
}

function mountStages(root, post) {
  if (!root) return { update() {}, shown() {} };
  const doc = root.ownerDocument, SVG = 'http://www.w3.org/2000/svg';
  let state = {}, ui = { pseudo: {}, expanded: {}, review: false, activity: false, code: {}, views: {}, step: undefined, hidden: {}, heights: {}, full: undefined, blocks: {} };
  const tokens = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0);
  const money = n => n ? '$' + n.toFixed(n < 0.1 ? 4 : 2) : '—';
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const send = (type, data = {}) => post({ type, ...data });
  // Build DOM nodes; text is always set as text, never parsed as HTML.
  function h(tag, attrs, ...children) {
    const el = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === false || value === null) continue;
      if (key === 'class') el.className = value;
      else if (key === 'data') for (const [name, data] of Object.entries(value)) { if (data !== undefined) el.dataset[name] = String(data); }
      else if (key === 'value') el.value = value;
      else if (key === 'open' || key === 'disabled' || key === 'selected' || key === 'checked') el[key] = !!value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false && child !== '') el.append(typeof child === 'object' ? child : doc.createTextNode(String(child)));
    return el;
  }
  function s(tag, attrs, ...children) {
    const el = doc.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'data') { for (const [name, data] of Object.entries(value)) if (data !== undefined) el.setAttribute('data-' + name, String(data)); }
      else el.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false && child !== '') el.append(typeof child === 'object' ? child : doc.createTextNode(String(child)));
    return el;
  }
  const act = (name, data, label, attrs = {}) => h('button', { ...attrs, data: { act: name, ...data } }, label);
  const link = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-link' + (attrs.class ? ' ' + attrs.class : '') });
  const go = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-go' });
  const muted = text => h('span', { class: 'st-muted' }, text);
  const spacer = () => h('span', { class: 'st-spacer' });
  const section = (title, ...children) => h('div', { class: 'st-section' }, title ? h('h3', {}, title) : undefined, ...children);
  const diffBlock = lines => h('pre', { class: 'st-diff' }, lines.map(line => h('span', { class: line.kind }, (line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ') + line.text)));
  const partOf = id => state.system?.parts.find(part => part.id === id);
  const partName = id => partOf(id)?.name || id;
  const stageOf = (part, id) => partOf(part)?.stages.find(stage => stage.id === id);
  const stepColor = (part, stageId) => { const index = (partOf(part)?.stages || []).findIndex(stage => stage.id === stageId); return index < 0 ? undefined : 'var(--st-c' + (index % 7) + ')'; };
  const fileName = file => file.split('/').at(-1);
  // Key behaviors, drawn the same way everywhere.
  const KIND = { decides: 'Decides', ai: 'AI', asks: 'Asks you', writes: 'Writes', reads: 'Reads', loops: 'Loops', fallback: 'Fallback', stops: 'Stops on error', limit: 'Limit', other: 'Note' };
  const behaviorChip = (kind, text) => h('span', { class: 'st-kind k-' + kind, title: text || KIND[kind] }, KIND[kind] || kind);
  const chips = details => [...new Set((details || []).map(item => item.kind).filter(kind => kind !== 'other'))].slice(0, 4).map(kind => behaviorChip(kind, (details || []).filter(item => item.kind === kind).map(item => item.text).join('\n')));

  // --- an interactive graph: drag to pan, scroll to zoom, Fit to see it all ---
  function graphView(key, { nodes, edges, width, height, minHeight = 260, maxHeight = 560, label, minZoom = 0.5 }) {
    if (ui.hidden[key]) return h('div', { class: 'st-canvas-hidden' }, muted(label + ' is hidden.'), link('showGraph', { key }, 'Show it'));
    const full = ui.full === key, view = ui.views[key];
    const size = full ? '' : 'height:' + (ui.heights[key] || Math.max(minHeight, Math.min(maxHeight, height + 60))) + 'px';
    const box = h('div', { class: 'st-canvas' + (full ? ' full' : ''), style: size, 'aria-label': label, data: { key } });
    const markerId = 'st-arrow-' + key, markerSoft = 'st-arrow-soft-' + key;
    // Boxes you moved stay where you put them.
    const saved = state.layouts?.[key] || {};
    for (const node of nodes) if (!node.fixed && saved[node.id]) { node.x = saved[node.id].x; node.y = saved[node.id].y; }
    const right = Math.max(width, ...nodes.map(node => node.x + node.w)), bottom = Math.max(height, ...nodes.map(node => node.y + node.h));
    width = right; height = bottom;
    const svg = s('svg', { class: 'st-svg', role: 'img', 'aria-label': label },
      s('defs', {}, s('marker', { id: markerId, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0 L8 4 L0 8 z', class: 'st-arrowhead' })),
        s('marker', { id: markerSoft, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0 L8 4 L0 8 z', class: 'st-arrowhead soft' }))));
    const layer = s('g', { class: 'st-world' });
    const at = new Map(nodes.map(node => [node.id, node]));
    // Arrows follow the boxes: each is redrawn from the boxes' current places.
    const drawnEdges = edges.filter(edge => at.has(edge.from) && at.has(edge.to)).map(edge => {
      const path = s('path', { class: 'st-edge-line' + (edge.soft ? ' soft' : '') + (edge.hot ? ' hot' : '') + (edge.faint ? ' faint' : edge.dim ? ' dim' : ''), 'marker-end': 'url(#' + (edge.soft ? markerSoft : markerId) + ')' }, edge.title ? s('title', {}, edge.title) : undefined);
      const text = edge.label ? s('text', { 'text-anchor': 'middle' }, edge.label) : undefined;
      return { edge, path, text };
    });
    const place = item => { const r = route(at.get(item.edge.from), at.get(item.edge.to)); item.path.setAttribute('d', r.d); if (item.text) { item.text.setAttribute('x', r.lx); item.text.setAttribute('y', r.ly); } };
    drawnEdges.forEach(place);
    for (const item of drawnEdges) layer.append(item.path);
    for (const item of drawnEdges) if (item.text) layer.append(s('g', { class: 'st-edge-label' + (item.edge.dim ? ' dim' : '') }, item.text));
    const objects = new Map();
    for (const node of nodes) {
      const fo = s('foreignObject', { x: node.x, y: node.y, width: node.w, height: node.h, class: node.fixed ? undefined : 'st-movable', data: { node: node.id } });
      fo.append(node.content);
      layer.append(fo); objects.set(node.id, fo);
    }
    svg.append(layer);
    box.append(svg, h('div', { class: 'st-zoom' },
      full ? h('b', { class: 'st-full-title' }, label) : undefined,
      Object.keys(saved).length ? act('resetLayout', { key }, 'Reset layout', { title: 'Put the boxes back where Yamori placed them' }) : undefined,
      act('zoom', { key, by: 1.25 }, '+', { title: 'Zoom in' }), act('zoom', { key, by: 0.8 }, '−', { title: 'Zoom out' }), act('fit', { key }, 'Fit', { title: 'See everything' }),
      act('fullGraph', { key }, full ? 'Exit full view' : '⤢ Enlarge', { title: full ? 'Back to the page (Esc)' : 'Fill the whole panel' }),
      full ? undefined : act('hideGraph', { key }, '✕', { title: 'Close this graph' })));
    // Drag the bottom edge to make the graph taller or shorter; the height is kept.
    if (!full && typeof ResizeObserver === 'function') { let first = true; new ResizeObserver(() => { if (first) { first = false; return; } ui.heights[key] = box.clientHeight; }).observe(box); }
    const apply = v => layer.setAttribute('transform', 'translate(' + v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ') scale(' + v.k.toFixed(3) + ')');
    const fit = () => {
      const w = box.clientWidth || 900, hgt = box.clientHeight || 400;
      // Readable first: never shrink below minZoom; drag or Fit to see the rest.
      const fitK = Math.min(1.1, (w - 40) / Math.max(1, width), (hgt - 50) / Math.max(1, height)), k = Math.max(Math.min(minZoom, 1), fitK);
      ui.views[key] = { k, x: width * k < w ? (w - width * k) / 2 : 20, y: height * k < hgt ? Math.max(16, (hgt - height * k) / 2) : 16, sig: width + 'x' + height };
      apply(ui.views[key]);
    };
    box.fit = () => { const w = box.clientWidth || 900, hgt = box.clientHeight || 400, k = Math.min(1.1, (w - 40) / Math.max(1, width), (hgt - 50) / Math.max(1, height)); ui.views[key] = { k, x: (w - width * k) / 2, y: Math.max(16, (hgt - height * k) / 2), sig: width + 'x' + height }; apply(ui.views[key]); };
    const sig = width + 'x' + height + (full ? ':full' : '');
    if (view && view.sig === sig) apply(view); else requestAnimationFrame(() => { fit(); ui.views[key].sig = sig; });
    let drag, moving;
    box.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      // On a box: drag that box (a click without movement still opens it).
      const fo = event.target.closest?.('foreignObject.st-movable');
      if (fo && !event.target.closest('button:not(.st-node), a, input, textarea, select, .st-zoom')) {
        const node = at.get(fo.dataset.node);
        moving = { node, fo, x: event.clientX, y: event.clientY, startX: node.x, startY: node.y, moved: false, pointer: event.pointerId };
        return;
      }
      if (event.target.closest('button, a, input, textarea, select, [data-act]')) return;
      drag = { x: event.clientX, y: event.clientY, v: { ...(ui.views[key] || { x: 0, y: 0, k: 1 }) } }; box.setPointerCapture?.(event.pointerId); box.classList.add('dragging');
    });
    box.addEventListener('pointermove', event => {
      if (moving) {
        const k = (ui.views[key] || { k: 1 }).k, dx = (event.clientX - moving.x) / k, dy = (event.clientY - moving.y) / k;
        if (!moving.moved && Math.hypot(dx * k, dy * k) < 4) return;
        if (!moving.moved) { moving.moved = true; box.setPointerCapture?.(moving.pointer); box.classList.add('moving'); }
        moving.node.x = Math.round(moving.startX + dx); moving.node.y = Math.round(moving.startY + dy);
        moving.fo.setAttribute('x', moving.node.x); moving.fo.setAttribute('y', moving.node.y);
        for (const item of drawnEdges) if (item.edge.from === moving.node.id || item.edge.to === moving.node.id) place(item);
        return;
      }
      if (!drag) return; ui.views[key] = { ...drag.v, x: drag.v.x + event.clientX - drag.x, y: drag.v.y + event.clientY - drag.y }; apply(ui.views[key]);
    });
    const stop = () => {
      if (moving?.moved) {
        ui.layoutsLocal = { ...(ui.layoutsLocal || {}), [key]: { ...((ui.layoutsLocal || {})[key] || {}), [moving.node.id]: { x: moving.node.x, y: moving.node.y } } };
        state.layouts = { ...(state.layouts || {}), [key]: { ...(state.layouts?.[key] || {}), [moving.node.id]: { x: moving.node.x, y: moving.node.y } } };
        ui.suppressClick = Date.now();
        send('layout', { key, id: moving.node.id, x: moving.node.x, y: moving.node.y });
      }
      moving = undefined; drag = undefined; box.classList.remove('dragging', 'moving');
    };
    box.addEventListener('pointerup', stop); box.addEventListener('pointercancel', stop);
    box.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 40 && !event.altKey) { /* a trackpad scroll pans */ const v = ui.views[key] || { x: 0, y: 0, k: 1 }; ui.views[key] = { ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }; apply(ui.views[key]); event.preventDefault(); return; }
      event.preventDefault();
      const v = ui.views[key] || { x: 0, y: 0, k: 1 }, rect = box.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
      const k = Math.max(0.15, Math.min(2.5, v.k * (event.deltaY < 0 ? 1.12 : 0.89)));
      ui.views[key] = { ...v, k, x: px - (px - v.x) * k / v.k, y: py - (py - v.y) * k / v.k }; apply(ui.views[key]);
    }, { passive: false });
    return box;
  }
  // An arrow from the right side of one box to the left side of another; backward arrows loop underneath.
  function route(from, to) {
    const forward = to.x > from.x + from.w / 2;
    if (forward) {
      const x1 = from.x + from.w, y1 = from.y + from.h / 2, x2 = to.x - 3, y2 = to.y + to.h / 2, mid = (x1 + x2) / 2;
      return { d: 'M' + x1 + ' ' + y1 + ' C' + mid + ' ' + y1 + ' ' + mid + ' ' + y2 + ' ' + x2 + ' ' + y2, lx: mid, ly: (y1 + y2) / 2 - 6 };
    }
    const x1 = from.x + from.w / 2, y1 = from.y + from.h, x2 = to.x + to.w / 2, y2 = to.y + to.h + 3, low = Math.max(y1, y2) + 46;
    return { d: 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + low + ' ' + x2 + ' ' + low + ' ' + x2 + ' ' + y2, lx: (x1 + x2) / 2, ly: low - 4 };
  }

  // --- the whole system ---
  function systemGraph() {
    const sys = state.system, W = 236, H = 118;
    const nodes = [...sys.parts.map(part => ({ id: part.id, kind: 'part', part })), ...sys.shared.map(box => ({ id: box.id, kind: 'shared', box }))];
    const edges = [...sys.links.map(link => ({ from: link.from, to: link.to, label: link.label })), ...sys.codeLinks.map(link => ({ from: link.from, to: link.to, label: 'uses code', soft: true })),
      ...sys.shared.flatMap(box => box.usedBy.map(from => ({ from, to: box.id, soft: true, title: partName(from) + ' uses ' + box.folder })))];
    const layout = layeredLayout(nodes, edges, { width: W, height: H, gapX: 150, gapY: 34, isolatedBelow: true });
    const selected = state.part || state.shared?.id;
    const near = id => !selected || id === selected || edges.some(edge => (edge.from === selected && edge.to === id) || (edge.to === selected && edge.from === id));
    const placed = nodes.map(node => {
      const p = layout.positions.get(node.id), h2 = node.kind === 'shared' ? 86 : H;
      const content = node.kind === 'part' ? partNode(node.part, selected === node.id, !near(node.id)) : sharedNode(node.box, selected === node.id, !near(node.id));
      return { ...node, x: p.x, y: p.y + (H - h2) / 2, w: node.kind === 'shared' ? W - 24 : W, h: h2, content };
    });
    const at = new Map(placed.map(node => [node.id, node]));
    const drawn = edges.filter(edge => at.has(edge.from) && at.has(edge.to)).map(edge => {
      const hot = selected && (edge.from === selected || edge.to === selected);
      const label = edge.soft ? undefined : edge.label && edge.label.length > 26 ? edge.label.slice(0, 25) + '…' : edge.label;
      return { ...edge, hot, dim: selected && !hot, label, title: edge.title || (edge.label ? partName(edge.from) + ' ' + edge.label + ' ' + partName(edge.to) : undefined) };
    });
    return graphView('system', { nodes: placed, edges: drawn, width: layout.width, height: layout.height + 60, minHeight: 320, maxHeight: 640, minZoom: 0.62, label: 'Map of the whole system' });
  }
  function partNode(part, selected, dim) {
    return h('div', { class: 'st-node part' + (selected ? ' selected' : '') + (dim ? ' dim' : ''), data: { act: 'openPart', id: selected ? '' : part.id }, title: part.summary, role: 'button', tabindex: 0 },
      h('div', { class: 'st-node-head' }, h('b', {}, part.name), spacer(),
        part.pending ? h('span', { class: 'st-badge plus', title: 'Changes waiting for your review' }, '±' + part.pending) : undefined,
        part.stale ? h('span', { class: 'st-badge stale', title: 'Code changed; Update refreshes it' }, 'changed') : undefined),
      h('div', { class: 'st-node-text' }, part.summary),
      h('div', { class: 'st-node-flow' }, part.stages.map((stage, index) => [index ? '→' : '', h('span', { style: 'border-color:' + stepColor(part.id, stage.id) }, stage.name)])),
      h('div', { class: 'st-node-kinds' }, ['ai', 'decides', 'asks', 'writes'].filter(kind => part.behaviors?.[kind]).map(kind => h('span', { class: 'st-kind k-' + kind, title: { ai: 'AI calls', decides: 'Decisions and rules', asks: 'Points where it waits for you', writes: 'Places it writes files' }[kind] }, part.behaviors[kind] + ' ' + { ai: 'AI calls', decides: 'decisions', asks: 'asks you', writes: 'writes' }[kind]))),
      h('div', { class: 'st-node-meta' }, plural(part.stages.length, 'step') + ' · ' + plural(part.files, 'file') + (part.folder ? ' · ' + part.folder : '')));
  }
  function sharedNode(box, selected, dim) {
    return h('div', { class: 'st-node shared' + (selected ? ' selected' : '') + (dim ? ' dim' : ''), data: { act: 'openShared', id: selected ? '' : box.id }, title: box.about || box.folder, role: 'button', tabindex: 0 },
      h('div', { class: 'st-eyebrow' }, 'Shared code'), h('b', {}, box.name),
      h('div', { class: 'st-node-meta' }, box.folder + ' · ' + plural(box.files, 'file') + ' · used by ' + plural(box.usedBy.length, 'part')));
  }

  // --- one part: its steps and its files, and how the files use each other ---
  function partPanel() {
    const part = partOf(state.part), detail = state.partDetail;
    if (!part || !detail) return undefined;
    return h('section', { class: 'st-card', 'aria-label': part.name },
      h('h2', {}, part.name, spacer(), link('openPart', { id: '' }, 'Close')),
      h('p', {}, part.summary),
      h('div', { class: 'st-row st-legend' }, muted('Steps:'), part.stages.map((stage, index) => act('openStage', { part: part.id, id: state.card?.id === stage.id ? '' : stage.id }, (index + 1) + '. ' + stage.name,
        { class: 'st-step' + (state.card?.id === stage.id ? ' open' : '') + (stage.stale ? ' stale' : '') + (stage.pending ? ' changed' : ''), style: 'border-left: 4px solid ' + stepColor(part.id, stage.id), title: stage.gist || '' }))),
      part.usedBy.length || part.uses.length ? h('p', { class: 'st-muted' }, [...part.usedBy.map(entry => partName(entry.from) + ' ' + entry.label + ' it'), ...part.uses.map(entry => 'it ' + entry.label + ' ' + partName(entry.to))].join(' · ')) : undefined,
      filesGraph(part, detail),
      detail.hidden ? h('p', { class: 'st-muted' }, plural(detail.hidden, 'more file') + ' in ' + detail.folder + ' are not shown.') : undefined,
      stepCard(), fileCard());
  }
  // Files arranged by the part's steps, left to right in the order the work happens:
  // each step's files, then the supporting files they use, then code from other folders.
  function filesGraph(part, detail) {
    const W = 196, H = 62, GX = 64, GY = 12, MAX_SUPPORT = 0, focus = state.card?.id, file = state.file?.file;
    const byStep = new Map(part.stages.map(stage => [stage.id, []])), support = [];
    for (const entry of detail.files) { const first = part.stages.find(stage => entry.steps.includes(stage.id)); (first ? byStep.get(first.id) : support).push(entry); }
    const linked = new Set(detail.edges.flatMap(edge => [edge.from, edge.to]));
    support.sort((a, b) => (linked.has(b.file) ? 1 : 0) - (linked.has(a.file) ? 1 : 0) || (b.entry ? 1 : 0) - (a.entry ? 1 : 0));
    const shownSupport = ui.allSupport ? support : support.slice(0, MAX_SUPPORT);
    const columns = [...part.stages.filter(stage => byStep.get(stage.id).length).map(stage => ({ title: (part.stages.indexOf(stage) + 1) + '. ' + stage.name, color: stepColor(part.id, stage.id), items: byStep.get(stage.id).map(entry => ({ id: entry.file, entry })) })),
      ...(support.length ? [{ title: 'Supporting files', items: [...shownSupport.map(entry => ({ id: entry.file, entry })), ...(support.length > shownSupport.length ? [{ id: 'more', more: support.length - shownSupport.length }] : [{ id: 'more', more: 0, less: true }])] }] : []),
      ...(detail.outside.length ? [{ title: 'Uses from other folders', items: detail.outside.map(box => ({ id: box.id, box })) }] : [])].map(column => ({ ...column, items: column.items.filter(item => !item.less || ui.allSupport) }));
    const placed = [], heads = [];
    columns.forEach((column, c) => {
      const x = c * (W + GX);
      heads.push({ x, title: column.title, color: column.color });
      column.items.forEach((item, row) => {
        const y = 30 + row * (H + GY);
        const lit = !focus && !file ? true : item.entry ? (focus ? item.entry.steps.includes(focus) : item.id === file || detail.edges.some(edge => (edge.from === file && edge.to === item.id) || (edge.to === file && edge.from === item.id))) : item.box ? (file ? item.box.from.includes(file) : true) : false;
        const content = item.entry ? fileNode(part, item.entry, file === item.id, !lit)
          : item.box ? h('div', { class: 'st-node out' + (lit ? '' : ' dim'), title: item.box.files.join('\n') }, h('b', {}, item.box.folder), h('div', { class: 'st-node-meta' }, plural(item.box.count, 'file') + ' used'))
          : item.less ? h('div', { class: 'st-node out', data: { act: 'allSupport' }, role: 'button' }, h('b', {}, 'Hide supporting files'))
          : h('div', { class: 'st-node out', data: { act: 'allSupport' }, role: 'button' }, h('b', {}, item.more + ' supporting file' + (item.more === 1 ? '' : 's')), h('div', { class: 'st-node-meta' }, 'Helpers the steps use · click to show'));
        placed.push({ id: item.id, x, y, w: W, h: H, content });
      });
    });
    const at = new Map(placed.map(node => [node.id, node]));
    const edges = [...detail.edges.map(edge => ({ from: edge.from, to: edge.to, title: fileName(edge.from) + ' uses ' + (edge.names.join(', ') || 'it') + ' from ' + fileName(edge.to) })),
      ...detail.outside.flatMap(box => box.from.map(from => ({ from, to: box.id, soft: true, title: fileName(from) + ' uses ' + box.folder })))];
    const drawn = edges.filter(edge => at.has(edge.from) && at.has(edge.to)).map(edge => {
      const hot = file && (edge.from === file || edge.to === file);
      return { ...edge, hot, dim: !hot, faint: !file };
    });
    const width = columns.length * (W + GX) - GX, height = 30 + Math.max(1, ...columns.map(column => column.items.length)) * (H + GY);
    const headers = heads.map(head => ({ id: 'head:' + head.x, fixed: true, x: head.x, y: 0, w: W, h: 24, content: h('div', { class: 'st-colhead', style: head.color ? 'border-bottom-color:' + head.color : undefined }, head.title) }));
    return h('div', { class: 'st-section' }, h('h3', {}, 'Its files, step by step'),
      h('p', { class: 'st-muted st-hint' }, 'Each column is a step, in the order the work happens. Click a file to see what it does, what it uses, and to change it; its links light up.'),
      graphView('part:' + part.id, { nodes: [...headers, ...placed], edges: drawn, width, height, minHeight: 260, maxHeight: 600, minZoom: 0.7, label: 'Files of ' + part.name }));
  }
  function fileNode(part, entry, selected, dim) {
    const colors = entry.steps.map(stage => stepColor(part.id, stage)).filter(Boolean);
    return h('div', { class: 'st-node file' + (selected ? ' selected' : '') + (dim ? ' dim' : ''), data: { act: 'openFile', file: selected ? '' : entry.file }, title: entry.file + (entry.purpose ? '\n' + entry.purpose : ''), role: 'button', tabindex: 0,
      style: colors.length ? 'border-left: 5px solid ' + colors[0] : undefined },
      h('div', { class: 'st-node-head' }, h('b', {}, entry.name), spacer(), entry.entry ? h('span', { class: 'st-badge', title: 'The part starts here' }, 'start') : undefined, entry.alsoIn.length ? h('span', { class: 'st-badge', title: 'Also used by ' + entry.alsoIn.map(partName).join(', ') }, 'shared') : undefined),
      h('div', { class: 'st-node-text one' }, entry.purpose || entry.dir));
  }
  function sharedPanel() {
    const box = state.shared;
    if (!box) return undefined;
    const W = 200, H = 58;
    const nodes = box.fileList.map(entry => ({ id: entry.file, entry }));
    const layout = layeredLayout(nodes, box.edges, { width: W, height: H, gapX: 60, gapY: 12, isolatedLast: true });
    const placed = nodes.map(node => { const p = layout.positions.get(node.id); return { ...node, x: p.x, y: p.y, w: W, h: H,
      content: h('div', { class: 'st-node file' + (state.file?.file === node.id ? ' selected' : ''), data: { act: 'openFile', file: node.id }, title: node.id + (node.entry.purpose ? '\n' + node.entry.purpose : ''), role: 'button', tabindex: 0 }, h('b', {}, node.entry.name), h('div', { class: 'st-node-text one' }, node.entry.purpose)) }; });
    const at = new Map(placed.map(node => [node.id, node]));
    const drawn = box.edges.filter(edge => at.has(edge.from) && at.has(edge.to)).map(edge => ({ ...edge, title: fileName(edge.from) + ' uses ' + edge.names.join(', ') }));
    return h('section', { class: 'st-card' }, h('h2', {}, 'Shared code: ' + box.folder, spacer(), link('openShared', { id: '' }, 'Close')),
      h('p', {}, (box.about ? box.about + ' ' : '') + 'Used by ' + box.usedBy.map(partName).join(', ') + '.'),
      graphView('shared:' + box.id, { nodes: placed, edges: drawn, width: layout.width, height: layout.height, minHeight: 220, maxHeight: 480, label: 'Files in ' + box.folder }),
      fileCard());
  }

  // --- details: a step, a file ---
  function stepCard() {
    const stage = state.card;
    if (!stage) return undefined;
    const part = state.part, others = (partOf(part)?.stages || []).filter(item => item.id !== stage.id), id = { part, stage: stage.id }, showCode = !!ui.code[part + '/' + stage.id];
    return h('div', { class: 'st-detail' },
      h('h2', {}, h('span', { class: 'st-swatch', style: 'background:' + stepColor(part, stage.id) }), stage.name, stage.stale ? h('span', { class: 'st-badge stale' }, 'changed') : undefined, spacer(), link('openStage', { part, id: '' }, 'Close')),
      h('div', { class: 'st-story' }, h('b', {}, 'Does'), h('span', {}, stage.gist || '—'), h('b', {}, 'Takes'), h('span', {}, stage.input || '—'), h('b', {}, 'Gives'), h('span', {}, stage.output || '—')),
      stage.steps.length ? section('How it works', h('p', { class: 'st-muted st-hint' }, 'Each box is a step; boxes under it are what it calls. Badges are key behaviors. Click a box for its file.'), stageFlow(part, stage)) : undefined,
      stage.steps.length ? h('details', { open: !!ui.expanded['list:' + stage.id], data: { expand: 'list:' + stage.id } }, h('summary', {}, 'All steps and behaviors as a list'),
        h('ul', { class: 'st-how' }, stage.steps.map(step => h('li', { style: 'margin-left:' + (step.depth || 0) * 22 + 'px' },
          h('span', { class: 'st-how-what' }, step.what || step.symbol), ' ', muted(step.symbol), ' ', link('openFile', { file: step.file }, fileName(step.file), { title: 'Show this file' }),
          step.details?.length ? h('ul', { class: 'st-how-details' }, step.details.map(detail => h('li', {}, behaviorChip(detail.kind), ' ', detail.text))) : undefined)))) : undefined,
      h('div', { class: 'st-tools' }, state.terminalChat ? go('agentSession', { prefill: 'About ' + partName(part) + ' › ' + stage.name + ': ' }, 'Ask in terminal…', { title: 'Opens your agent session with this step on the prompt' }) : go('changeHere', { kind: 'step', part, stage: stage.id }, 'Change this step…'), link('rename', id, 'Rename'), others.length ? link('merge', id, 'Merge with…') : undefined, link('pin', id, stage.pinned ? 'Let Yamori update it' : 'Keep as is'),
        stage.stale ? link('refreshStage', id, 'Update this step') : undefined, link('toggleCode', { key: part + '/' + stage.id }, showCode ? 'Hide functions' : 'Show functions')),
      showCode ? section('Functions', h('ol', { class: 'st-steps' }, stage.steps.map(step => {
        const key = stage.id + ':' + step.position, shown = ui.pseudo[key];
        return h('li', {}, h('div', { class: 'st-row' }, act('jump', { file: step.file, line: step.line_start || 1 }, step.symbol + ' · ' + step.file + ':' + (step.line_start || '?'), { class: 'st-chip', title: 'Open the source line' }),
          step.missing ? muted('(no longer in the code)') : undefined, link('flow', { file: step.file, line: step.line_start || 1 }, 'Read'),
          step.pseudocode ? link('pseudo', { key }, shown ? 'Hide pseudocode' : 'Pseudocode') : undefined, spacer(),
          h('select', { 'aria-label': 'Move to another step', data: { act: 'move', part, stage: stage.id, position: step.position } }, h('option', { value: '' }, 'Move to…'), others.map(item => h('option', { value: item.id }, item.name)), h('option', { value: '__new' }, 'A new step'))),
          shown && step.pseudocode ? h('pre', {}, step.pseudocode) : undefined);
      }))) : undefined,
      section('Notes on this step', stage.notes ? h('pre', {}, stage.notes) : h('p', { class: 'st-muted' }, 'Yamori adds what you change and decide here. Add a rule of your own if you like; your agents read these before they touch this code.'),
        h('div', { class: 'st-tools' }, h('textarea', { id: 'st-note', 'aria-label': 'Add a note', placeholder: 'Optional: a rule or reason…', value: ui.noteDraft || '' }), act('addNote', id, 'Add'), link('openNote', id, state.vault?.obsidian ? 'Open in Obsidian' : 'Open notes file'))));
  }
  // A stage as a diagram: its steps left to right, what each calls stacked under it,
  // and key behaviors (decisions, AI calls, waiting for you, files written) on every box.
  function stageFlow(part, stage) {
    const W = 236, GX = 54, GY = 12, out = [], edges = [];
    let column = -1, y = 0, lastTop;
    // Boxes grow with their text: the step, up to three decisions, its badges.
    const lines = (text, per) => Math.min(3, Math.ceil(String(text || '').length / per));
    const decisionsOf = step => (step.details || []).filter(item => item.kind === 'decides' || item.kind === 'stops').slice(0, 3);
    const height = step => 38 + 17 * lines(step.what || step.symbol, 26) + decisionsOf(step).reduce((sum, item) => sum + 4 + 15 * Math.min(2, lines(item.text, 30)), 0) + (step.details?.length ? 24 : 0);
    stage.steps.forEach((step, index) => {
      const id = 'step:' + index + ':' + step.symbol;
      if (!step.depth) { column++; y = 0; if (lastTop) edges.push({ from: lastTop, to: id }); lastTop = id; }
      const h2 = height(step), indent = (step.depth || 0) * 14;
      const content = h('div', { class: 'st-node flowstep' + (step.depth ? ' sub' : '') + (ui.flowStep === stage.id + ':' + index ? ' selected' : ''), data: { act: 'flowStep', key: stage.id + ':' + index }, role: 'button', tabindex: 0,
        title: step.symbol + ' · ' + step.file + ':' + (step.line_start || '') + (step.details?.length ? '\n\n' + step.details.map(item => (KIND[item.kind] || item.kind) + ': ' + item.text).join('\n') : '') },
        h('b', {}, step.what || step.symbol),
        decisionsOf(step).map(item => h('div', { class: 'st-decision' + (item.kind === 'stops' ? ' stops' : '') }, (item.kind === 'stops' ? '⚠ ' : '◆ ') + item.text)),
        step.details?.length ? h('div', { class: 'st-node-kinds' }, chips(step.details)) : undefined,
        h('div', { class: 'st-node-meta' }, step.symbol + ' · ' + fileName(step.file)));
      out.push({ id, x: column * (W + GX) + indent, y, w: W - indent, h: h2, content, step });
      if (step.depth) { const parent = [...out].reverse().find(item => item.step.depth === step.depth - 1 && item !== out.at(-1)); if (parent) edges.push({ from: parent.id, to: id, soft: true }); }
      y += h2 + GY;
    });
    const width = (column + 1) * (W + GX) - GX, tall = Math.max(...out.map(item => item.y + item.h));
    const picked = ui.flowStep?.startsWith(stage.id + ':') ? stage.steps[Number(ui.flowStep.slice(stage.id.length + 1))] : undefined;
    return [graphView('flow:' + part + '/' + stage.id, { nodes: out, edges, width, height: tall, minHeight: 240, maxHeight: 640, minZoom: 0.75, label: 'How ' + stage.name + ' works' }), picked ? flowStepDetail(picked) : undefined];
  }
  // Everything about one step: what it does, every key behavior, and where it is.
  function flowStepDetail(step) {
    const caller = step.parent ? stagesStep(step.parent) : undefined;
    return h('div', { class: 'st-detail st-flow-detail' },
      h('h2', {}, step.what || step.symbol, spacer(), link('flowStep', { key: '' }, 'Close')),
      h('div', { class: 'st-row' }, act('jump', { file: step.file, line: step.line_start || 1 }, step.symbol + ' · ' + step.file + ':' + (step.line_start || '?'), { class: 'st-chip', title: 'Open the source line' }),
        link('flow', { file: step.file, line: step.line_start || 1 }, 'Read it beside the code'), link('openFile', { file: step.file }, 'About this file'),
        state.terminalChat ? link('agentSession', { prefill: 'About ' + step.symbol + ' in ' + step.file + ': ' }, 'Ask in terminal') : undefined),
      caller ? h('p', { class: 'st-muted' }, 'Called by: ' + (caller.what || caller.symbol)) : undefined,
      step.details?.length ? h('ul', { class: 'st-behaviors' }, step.details.map(item => h('li', {}, behaviorChip(item.kind), ' ', item.text))) : h('p', { class: 'st-muted' }, 'No key behaviors recorded for this step.'));
  }
  const stagesStep = key => state.card?.steps.find(step => step.file + '#' + step.symbol === key);
  function fileCard() {
    const file = state.file;
    if (!file) return undefined;
    const row = entry => h('li', {}, link('openFile', { file: entry.file }, fileName(entry.file), { title: entry.file }), entry.names.length ? muted(' (' + entry.names.join(', ') + ')') : undefined, entry.purpose ? h('div', { class: 'st-muted' }, entry.purpose) : undefined);
    return h('div', { class: 'st-detail' },
      h('h2', {}, fileName(file.file), spacer(), link('openFile', { file: '' }, 'Close')),
      h('div', { class: 'st-muted' }, file.file + ' · ' + plural(file.lines, 'line')),
      h('p', {}, file.purpose || 'No AI note for this file yet.'), file.role ? h('p', { class: 'st-muted' }, file.role) : undefined,
      file.where.length ? section('Used in', h('ul', { class: 'st-list' }, file.where.map(entry => h('li', {}, link('openStage', { part: entry.part, id: entry.stage }, entry.partName + ' › ' + entry.stageName), muted(': ' + entry.does.slice(0, 3).join('; ')))))) : undefined,
      h('div', { class: 'st-tools' }, state.terminalChat ? go('agentSession', { prefill: 'About ' + file.file + ': ' }, 'Ask in terminal…', { title: 'Opens your agent session with this file on the prompt' }) : go('changeHere', { kind: 'file', file: file.file }, 'Change this file…'), act('flow', { file: file.file, line: 1 }, 'Read it'), link('jump', { file: file.file, line: 1 }, 'Open the code')),
      pseudoSection(file),
      file.uses.length ? section('Uses', h('ul', { class: 'st-list' }, file.uses.map(row))) : undefined,
      file.usedBy.length ? section('Used by', h('ul', { class: 'st-list' }, file.usedBy.map(row))) : undefined,
      file.functions.length ? h('details', {}, h('summary', {}, plural(file.functions.length, 'function')), h('ul', { class: 'st-list' }, file.functions.map(def => h('li', {}, link('jump', { file: file.file, line: def.line }, def.name), muted(' ' + def.kind + ' · line ' + def.line))))) : undefined);
  }

  // Pseudocode Yamori already has for the file (no AI call), block by block.
  function pseudoSection(file) {
    const pseudo = file.pseudocode;
    if (!pseudo) return section('Pseudocode', h('p', { class: 'st-muted' }, 'Not written yet. ', link('flow', { file: file.file, line: 1 }, 'Read it'), ' to have Yamori write it (uses AI).'));
    const key = index => file.file + '#' + index;
    return section('Pseudocode' + (pseudo.level === 'overview' ? ' · overview' : ''),
      pseudo.current ? undefined : h('p', { class: 'st-notice' }, 'From an older version of this file. ', link('flow', { file: file.file, line: 1 }, 'Read it'), ' to update it.'),
      pseudo.summary ? h('p', {}, pseudo.summary) : undefined,
      h('div', { class: 'st-row' }, muted(plural(pseudo.sections.length, 'block') + ' · saved, no AI call'), spacer(), link('allBlocks', {}, pseudo.sections.every((_, index) => ui.blocks[key(index)]) ? 'Collapse all' : 'Expand all')),
      h('ol', { class: 'st-blocks' }, pseudo.sections.map((block, index) => h('li', {},
        h('div', { class: 'st-row' }, act('block', { key: key(index) }, (ui.blocks[key(index)] ? '▾ ' : '▸ ') + block.title, { class: 'st-block-title' }), spacer(),
          link('flow', { file: file.file, line: block.startLine }, 'L' + block.startLine + (block.endLine > block.startLine ? '–' + block.endLine : ''), { title: 'Read this block beside the code' })),
        ui.blocks[key(index)] ? h('pre', {}, block.pseudocode) : undefined))));
  }
  // --- header, request box, review, notes, AI use ---
  function header() {
    const total = state.activity?.total, sys = state.system;
    return h('div', { class: 'st-bar' },
      h('h1', { class: 'st-title' }, 'How ' + (state.repo || 'this project') + ' works'), spacer(),
      state.vault && sys ? link('notesPanel', {}, (state.vault.obsidian ? 'Obsidian' : 'Notes') + (state.vault.lastSync?.error ? ' · not written' : state.vault.lastSync ? ' · synced ' + new Date(state.vault.lastSync.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''), { title: 'Notes sync by themselves. Click for where they are.' }) : undefined,
      sys ? act('refresh', {}, 'Update', { disabled: !!state.busy, title: 'Update only what changed in the code' }) : undefined,
      state.terminalChat ? act('agentSession', {}, state.agentSession ? 'Chat ↗' : 'Chat', { title: 'Your agent session in the VS Code terminal' }) : undefined,
      link('activity', {}, total?.calls ? 'Today: ' + tokens(total.input + total.cached + total.output) + ' tokens · ' + money(total.cost) : 'AI use', { title: 'Every AI call today, with tokens and cost' }));
  }
  const targetKey = target => target.file ? 'file:' + target.file : target.part + '/' + target.stage;
  // The request box follows what you selected: a step, a file, a part, or the whole system.
  function scope() {
    if (ui.here?.kind === 'step') return { label: partName(ui.here.part) + ' › ' + (stageOf(ui.here.part, ui.here.stage)?.name || ui.here.stage), targets: [{ part: ui.here.part, stage: ui.here.stage }], direct: true };
    if (ui.here?.kind === 'file') return { label: ui.here.file, targets: [{ file: ui.here.file }], direct: true };
    if (state.part) return { label: partName(state.part), scope: { part: state.part }, part: state.part };
    return { label: 'the whole system' };
  }
  // With chat in the terminal, the request box gives way to your agent session,
  // which sees what you select here (and in the editor) and plans onto the canvas.
  function chatBar() {
    const sel = state.part ? partName(state.part) + (state.card ? ' › ' + state.card.name : '') : state.shared ? state.shared.folder : state.file ? state.file.file : '';
    return h('div', { class: 'st-chat' },
      h('div', {}, h('b', {}, 'Ask, plan or change things with your agent in the terminal.'), ' ',
        muted('It sees what you have open here and in the editor' + (sel ? ' (now: ' + sel + ')' : '') + ', and plans it writes show up in Plan.')),
      go('agentSession', {}, state.agentSession ? 'Show chat' : 'Open chat in terminal', { title: 'One conversation per project in the VS Code terminal; it stays open' }));
  }
  function steerBox() {
    const route = state.route, steer = state.steer, where = scope();
    const busy = steer && ['previewing', 'preview', 'applied'].includes(steer.phase);
    const box = h('div', { class: 'st-ask' },
      h('div', { class: 'st-row' }, h('label', { for: 'st-intent', class: 'st-eyebrow' }, 'What should change in'), h('b', {}, where.label), ui.here ? link('clearHere', {}, 'change anywhere instead') : undefined),
      h('div', { class: 'st-row' }, h('textarea', { id: 'st-intent', rows: 2, placeholder: where.direct ? 'What should it do differently?' : 'For example: retry a failed request twice before giving up', value: ui.intentDraft || '' }),
        where.direct ? [go('ask', {}, 'Preview the change', { disabled: !!state.busy || busy, title: 'One AI call with your main model; sends only this code and your notes' }), act('handToAgent', {}, 'Give it to my agent', { title: 'No AI call: saved where your agents read it' })]
          : go('ask', {}, 'Find where', { disabled: !!state.busy || route?.phase === 'routing', title: 'One small AI call: finds which steps this touches' })));
    if (route?.phase === 'routing') box.append(h('p', { class: 'st-notice' }, 'Finding where “' + route.intent + '” goes…'));
    if (route?.phase === 'routed' && !busy) {
      if (!ui.picked || ui.picked.intent !== route.intent) ui.picked = { intent: route.intent, keys: new Set(route.targets.map(targetKey)) };
      box.append(h('div', { class: 'st-route' },
        h('p', {}, route.question || route.explanation),
        route.targets.length ? h('div', { class: 'st-targets' }, route.targets.map(target => h('label', { class: 'st-target' }, h('input', { type: 'checkbox', checked: ui.picked.keys.has(targetKey(target)), data: { key: targetKey(target) } }), target.partName + ' › ' + target.stageName))) : undefined,
        h('div', { class: 'st-tools' }, route.targets.length ? go('steerPreview', {}, 'Preview the change') : undefined, act('handToAgent', {}, 'Give it to my agent'), link('routeCancel', {}, 'Cancel'))));
    }
    if (steer) box.append(steerPanel(steer));
    return box;
  }
  function steerPanel(steer) {
    if (steer.phase === 'previewing') return h('div', { class: 'st-route' }, h('p', {}, 'Writing the change…'), h('div', { class: 'st-tools' }, act('steerCancel', {}, 'Stop')));
    if (steer.phase === 'preview') return h('div', { class: 'st-route' }, h('p', { class: 'st-sentence' }, steer.summary), muted(plural(steer.files.length, 'file') + ' · all change together or none do · you can undo'),
      h('div', { class: 'st-row' }, steer.files.map(file => act('steerDiff', { file: file.file }, file.file, { class: 'st-chip', title: 'Open in the diff editor' }))),
      h('details', { open: !!ui.expanded.steer, data: { expand: 'steer' } }, h('summary', {}, 'Show the code change'),
        steer.files.map(file => h('div', { style: 'margin-top:8px' }, h('b', {}, file.file), file.edits.filter(edit => edit.why).map(edit => h('div', { class: 'st-muted' }, edit.why)), diffBlock(file.hunks)))),
      h('div', { class: 'st-tools' }, go('steerApply', {}, 'Apply'), act('steerCancel', {}, 'Discard')));
    if (steer.phase === 'applied') return h('div', { class: 'st-route' }, h('p', {}, 'Done: ' + steer.summary + ' The map updates in a moment, and the change is noted where it happened.'), h('div', { class: 'st-tools' }, act('steerUndo', {}, 'Undo'), link('steerCancel', {}, 'Close')));
    if (steer.message) return h('p', { class: steer.phase === 'error' ? 'st-error' : 'st-notice' }, steer.message, ' ', link('steerCancel', {}, 'Close'));
    return undefined;
  }
  function reviewBar() {
    const queue = state.queue || [];
    if (!queue.length) return undefined;
    return h('div', { class: 'st-review' }, h('b', {}, plural(queue.length, 'change') + ' to review'), muted('in ' + [...new Set(queue.map(change => change.part_name))].join(', ')), spacer(),
      go('review', {}, ui.review ? 'Hide' : 'Review'), link('markReviewed', {}, 'Mark all seen'));
  }
  function reviewPanel() {
    const queue = state.queue || [];
    if (!ui.review || !queue.length) return undefined;
    return h('section', { class: 'st-card', 'aria-label': 'Review changes' }, h('h2', {}, 'What changed', spacer(), link('review', {}, 'Close')), queue.map(change => {
      const asking = ui.why?.id === change.id, steps = change.detail?.steps || [];
      return h('div', { class: 'st-section' }, h('h3', {}, change.part_name + ' › ' + change.stage_name + ' · ' + change.at.slice(0, 16).replace('T', ' ')), h('p', { class: 'st-sentence' }, change.summary),
        h('details', { open: !!ui.expanded[change.id], data: { expand: change.id } }, h('summary', {}, 'Show what changed in detail'),
          steps.map(step => h('div', { style: 'margin-top:8px' }, act('diff', { id: change.id, file: step.file, line: step.line || 1 }, step.file + ' · code diff', { class: 'st-chip' }),
            step.before || step.after ? diffBlock(lineDiff(step.before || '', step.after || '')) : h('p', { class: 'st-muted' }, 'Open the code diff to see this change.')))),
        asking ? h('div', { class: 'st-tools' }, h('textarea', { id: 'st-why', placeholder: 'Why? (optional)' }), go('saveWhy', {}, ui.why.status === 'approved' ? 'Keep it' : 'Reject it'), act('cancelWhy', {}, 'Cancel'))
          : h('div', { class: 'st-tools' }, go('approve', { id: change.id }, 'Keep it'), act('reject', { id: change.id }, 'Reject it')));
    }));
  }
  function notesPanel() {
    if (!ui.notesPanel || !state.vault) return undefined;
    const v = state.vault, last = v.lastSync;
    return h('section', { class: 'st-card' }, h('h2', {}, v.obsidian ? 'Notes in Obsidian' : 'Notes', spacer(), link('notesPanel', {}, 'Close')),
      h('p', {}, v.obsidian ? 'Yamori writes the notes into your Obsidian vault by itself: ' : 'Yamori writes the notes here by itself: ', h('code', {}, v.dir)),
      h('p', { class: last?.error ? 'st-error' : 'st-muted' }, last?.error ? 'The last update failed: ' + last.error : (last ? 'Last updated ' + new Date(last.at).toLocaleString() + ' · ' + plural(last.notes, 'note') + '. ' : '') + 'Nothing to do: they update by themselves when you open Yamori, save code, map, review, or ask your agent.'),
      v.obsidian ? undefined : h('p', { class: 'st-muted' }, 'No Obsidian vault found. Open this folder as a vault in Obsidian, or set yamori.obsidian.vaultPath, and the notes move there.'),
      h('div', { class: 'st-tools' }, go('openNote', {}, v.obsidian ? 'Open in Obsidian' : 'Open the system note'), link('revealNotes', {}, 'Show the folder'), link('notesSettings', {}, 'Settings')));
  }
  function systemNotes() {
    return h('section', { class: 'st-card' }, h('h2', {}, 'Rules for the whole system', spacer(), link('openNote', {}, state.vault?.obsidian ? 'Open in Obsidian' : 'Open notes file')),
      state.systemNotes ? h('pre', {}, state.systemNotes) : h('p', { class: 'st-muted' }, 'Optional. Rules your agents follow for every change, for example “all AI calls go through the budget check”.'),
      h('div', { class: 'st-tools' }, h('textarea', { id: 'st-system-note', 'aria-label': 'Add a rule', placeholder: 'Add a rule…', value: ui.systemDraft || '' }), act('addSystemNote', {}, 'Add')));
  }
  function activity() {
    if (!ui.activity || !state.activity) return undefined;
    const { total, calls, day } = state.activity;
    return h('section', { class: 'st-card' }, h('h2', {}, 'AI use · ' + day, spacer(), link('activity', {}, 'Close')),
      h('p', { class: 'st-muted' }, plural(total.calls, 'AI call') + ' today · input ' + tokens(total.input) + ' · cached ' + tokens(total.cached) + ' · output ' + tokens(total.output) + ' · ' + money(total.cost)),
      calls.length ? [h('table', {}, h('tr', {}, ['When', 'What', 'Model', 'Input', 'Cached', 'Output', 'Cost', 'Note'].map(name => h('th', {}, name))),
        calls.map(call => h('tr', {}, [call.at.slice(11, 19), call.trigger, call.model || '', tokens(call.input_tokens) + (call.estimated ? '*' : ''), tokens(call.cached_tokens), tokens(call.output_tokens), money(call.cost_usd), call.note || ''].map(cell => h('td', {}, cell)))))] : h('p', { class: 'st-muted' }, 'No AI calls today.'));
  }
  function empty() {
    const estimate = state.estimate || {};
    return h('div', { class: 'st-empty' },
      h('p', {}, 'Yamori draws your whole project as a map: each part (workflow, agent, server, tool), the shared code they use, how they connect, and inside each part its steps and files. Then you can change things from the map.'),
      h('div', { class: 'st-found' },
        estimate.pending ? muted('Looking at your project…') : estimate.error ? h('p', { class: 'st-error' }, estimate.error)
          : h('p', {}, 'Drawing it takes about ' + plural(estimate.calls || 1, 'small AI call') + ' (about ' + tokens(estimate.tokens) + ' tokens). After that, only code you change is looked at again.'),
        h('div', { class: 'st-tools' }, go('buildSystem', {}, 'Map my system', { disabled: !!state.busy })),
        state.vault ? h('p', { class: 'st-muted' }, 'Notes: ' + state.vault.where + '.') : undefined));
  }
  function body() {
    if (state.unavailable) return [h('div', { class: 'st-empty' }, h('p', { class: 'st-error' }, state.unavailable))];
    const sys = state.system;
    const notices = [
      state.error ? h('p', { class: 'st-error' }, state.error) : undefined,
      state.busy ? h('p', { class: 'st-notice' }, state.busy) : undefined,
      state.notice ? h('p', { class: 'st-notice' }, state.notice) : undefined,
      sys?.newFiles ? h('p', { class: 'st-notice' }, 'Files were added or removed since the map was made. ', link('buildSystem', {}, 'Update the map')) : undefined];
    if (!sys) return [header(), h('div', { class: 'st-top st-plain' }, notices), activity(), empty()];
    return [header(), notesPanel(), h('div', { class: 'st-top' }, sys.summary ? h('p', { class: 'st-summary' }, sys.summary) : undefined, notices, reviewBar(), state.terminalChat ? chatBar() : steerBox()),
      activity(), reviewPanel(), systemGraph(),
      h('p', { class: 'st-muted st-hint' }, 'Click a box to open it. Arrows show what starts or uses what; dashed arrows are code one part uses from another.'),
      partPanel(), sharedPanel(), !state.part && !state.shared ? fileCard() : undefined, systemNotes(),
      h('p', { class: 'st-muted st-foot' }, 'Not right? ', link('rebuild', {}, 'Map the system again'), ' (one AI call for the parts, plus one per part).')];
  }
  function render() {
    const active = doc.activeElement, keep = active && /^st-(note|why|intent|system-note)$/.test(active.id || '') ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
    const scrollTop = root.scrollTop;
    root.replaceChildren(...body().flat(Infinity).filter(Boolean));
    root.scrollTop = scrollTop;
    if (keep) { const field = root.querySelector('#' + keep.id); if (field) { field.value = keep.value; field.focus({ preventScroll: true }); field.setSelectionRange(keep.start, keep.end); } }
  }
  const value = id => root.querySelector('#' + id)?.value || '';
  const pickedTargets = () => (state.route?.targets || []).filter(target => ui.picked?.keys.has(targetKey(target))).map(target => ({ part: target.part, stage: target.stage }));
  function ask() {
    const intent = value('st-intent'), where = scope();
    if (!intent.trim()) { root.querySelector('#st-intent')?.focus(); return; }
    if (where.direct) send('steerPreview', { intent, targets: where.targets });
    else { ui.picked = undefined; send('route', { intent, scope: where.scope }); }
  }
  root.addEventListener('click', event => {
    if (ui.suppressClick && Date.now() - ui.suppressClick < 300) { ui.suppressClick = 0; return; }
    const target = event.target.closest('[data-act]');
    if (!target || target.tagName === 'SELECT' || !root.contains(target)) return;
    const name = target.dataset.act, data = target.dataset;
    switch (name) {
      case 'activity': case 'review': ui[name] = !ui[name]; render(); return;
      case 'toggleCode': ui.code[data.key] = !ui.code[data.key]; render(); return;
      case 'pseudo': ui.pseudo[data.key] = !ui.pseudo[data.key]; render(); return;
      case 'zoom': { const v = ui.views[data.key]; const canvas = target.closest('.st-canvas'); if (!v || !canvas) return; const w = canvas.clientWidth / 2, hh = canvas.clientHeight / 2, k = Math.max(0.15, Math.min(2.5, v.k * Number(data.by))); ui.views[data.key] = { ...v, k, x: w - (w - v.x) * k / v.k, y: hh - (hh - v.y) * k / v.k }; canvas.querySelector('.st-world')?.setAttribute('transform', 'translate(' + ui.views[data.key].x + ' ' + ui.views[data.key].y + ') scale(' + k + ')'); return; }
      case 'fit': target.closest('.st-canvas')?.fit?.(); return;
      case 'allSupport': ui.allSupport = !ui.allSupport; render(); return;
      case 'flowStep': ui.flowStep = ui.flowStep === data.key || !data.key ? undefined : data.key; render(); return;
      case 'resetLayout': if (state.layouts) delete state.layouts[data.key]; delete ui.views[data.key]; send('layout', { key: data.key, reset: true }); render(); return;
      case 'fullGraph': ui.full = ui.full === data.key ? undefined : data.key; render(); return;
      case 'hideGraph': ui.hidden[data.key] = true; if (ui.full === data.key) ui.full = undefined; render(); return;
      case 'showGraph': ui.hidden[data.key] = false; render(); return;
      case 'notesPanel': ui.notesPanel = !ui.notesPanel; render(); return;
      case 'block': ui.blocks[data.key] = !ui.blocks[data.key]; render(); return;
      case 'allBlocks': { const keys = (state.file?.pseudocode?.sections || []).map((_, index) => state.file.file + '#' + index); const open = !keys.every(key => ui.blocks[key]); keys.forEach(key => { ui.blocks[key] = open; }); render(); return; }
      case 'openPart': ui.here = undefined; send('openPart', { id: data.id || undefined }); return;
      case 'openShared': ui.here = undefined; send('openShared', { id: data.id || undefined }); return;
      case 'openStage': send('openStage', { part: data.part, id: data.id || undefined }); return;
      case 'openFile': send('openFile', { file: data.file || undefined }); return;
      case 'jump': case 'flow': send(name, { file: data.file, line: Number(data.line) }); return;
      case 'rebuild': send('buildSystem', { force: true }); return;
      case 'ask': ask(); return;
      case 'changeHere': ui.here = data.kind === 'file' ? { kind: 'file', file: data.file } : { kind: 'step', part: data.part, stage: data.stage }; send('routeCancel'); render(); root.querySelector('#st-intent')?.focus(); root.querySelector('.st-ask')?.scrollIntoView?.({ block: 'nearest' }); return;
      case 'clearHere': ui.here = undefined; render(); return;
      case 'steerPreview': send('steerPreview', { intent: state.route?.intent || value('st-intent'), targets: pickedTargets() }); return;
      case 'handToAgent': { const where = scope(); send('handToAgent', { intent: state.route?.intent || value('st-intent'), targets: where.direct ? where.targets : state.route ? pickedTargets() : where.part ? [{ part: where.part }] : [] }); ui.intentDraft = ''; ui.here = undefined; return; }
      case 'approve': case 'reject': ui.why = { id: Number(data.id), status: name === 'approve' ? 'approved' : 'rejected' }; render(); root.querySelector('#st-why')?.focus(); return;
      case 'cancelWhy': ui.why = undefined; render(); return;
      case 'saveWhy': send('decide', { id: ui.why.id, status: ui.why.status, why: value('st-why') }); ui.why = undefined; return;
      case 'diff': send('diff', { id: Number(data.id), file: data.file, line: Number(data.line) }); return;
      case 'addNote': { const text = value('st-note'); if (!text.trim()) return; send('addNote', { part: data.part, stage: data.stage, text }); ui.noteDraft = ''; return; }
      case 'addSystemNote': { const text = value('st-system-note'); if (!text.trim()) return; send('addSystemNote', { text }); ui.systemDraft = ''; return; }
      case 'steerDiff': send('steerDiff', { file: data.file }); return;
      case 'agentSession': send('agentSession', { prefill: data.prefill || '' }); return;
      default: send(name, { part: data.part, stage: data.stage });
    }
  });
  doc?.addEventListener?.('keydown', event => { if (event.key === 'Escape' && ui.full) { ui.full = undefined; render(); } });
  root.addEventListener('keydown', event => {
    if (event.target.id === 'st-intent' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); return; }
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('.st-node[data-act]')) { event.preventDefault(); event.target.click(); }
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset?.act === 'move' && target.value) send('move', { part: target.dataset.part, stage: target.dataset.stage, position: Number(target.dataset.position), to: target.value === '__new' ? '' : target.value });
    if (target.type === 'checkbox' && target.dataset.key && ui.picked) { if (target.checked) ui.picked.keys.add(target.dataset.key); else ui.picked.keys.delete(target.dataset.key); }
  });
  root.addEventListener('input', event => {
    const id = event.target.id;
    if (id === 'st-note') ui.noteDraft = event.target.value;
    if (id === 'st-system-note') ui.systemDraft = event.target.value;
    if (id === 'st-intent') ui.intentDraft = event.target.value;
  });
  root.addEventListener('toggle', event => { const id = event.target.dataset?.expand; if (id) ui.expanded[id] = event.target.open; }, true);
  return {
    update(next) {
      state = next || {};
      if (['applied', 'saved'].includes(state.steer?.phase)) { ui.here = undefined; ui.intentDraft = ''; }
      render();
    },
    shown() { send('ready'); }
  };
}

// The client as a string for a webview script.
const stagesClient = () => `const lineDiff = ${lineDiff.toString()};\nconst layeredLayout = ${layeredLayout.toString()};\nconst mountStages = ${mountStages.toString()};`;

// A standalone page (previews and tests); in VS Code the project panel hosts it.
function stagesHTML() {
  const { BASE_STYLES } = require('./reader');
  const nonce = randomBytes(18).toString('base64');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yamori stages</title><style nonce="${nonce}">${BASE_STYLES}html, body { height: 100%; } body { display: flex; flex-direction: column; } #stages-view { flex: 1; }${STAGES_STYLE}</style></head>
<body data-palette="auto"><section id="stages-view"></section>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
${stagesClient()}
const stages = mountStages(document.getElementById('stages-view'), message => vscode.postMessage({ type: 'stages', message }));
window.addEventListener('message', event => { if (event.data?.type === 'stages') stages.update(event.data.state); });
stages.shown();
</script></body></html>`;
}

module.exports = { stagesHTML, stagesClient, STAGES_STYLE, lineDiff, mountStages, layeredLayout };
