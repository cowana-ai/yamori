'use strict';
// Project guide webview. "Start here" lists, folder by folder, which files to
// read first. "Map" shows the dependency graph with files grouped in folder
// boxes: drag a box to move it, click its header to fold it, click a file for
// details, double-click to explain it. Text is always inserted with textContent.
const { randomBytes } = require('node:crypto');
const { BASE_STYLES, LOGO } = require('./panel');

// Pure helpers run in Node tests and are inserted into the webview script.
function edgePath(a, b) {
  const down = b.y >= a.y + a.h / 2;
  const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y, x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h;
  const span = Math.abs(y2 - y1), sign = down ? 1 : -1, r = Math.round;
  // An edge that skips a layer bows sideways instead of running through the
  // nodes in between.
  if (span > 140) {
    const bow = Math.min(180, 40 + span * 0.3) * (x2 >= x1 ? 1 : -1);
    return `M${r(x1)} ${r(y1)} C${r(x1 + bow)} ${r(y1 + sign * span * 0.35)} ${r(x2 + bow)} ${r(y2 - sign * span * 0.35)} ${r(x2)} ${r(y2)}`;
  }
  const bend = Math.max(24, span / 2) * sign;
  return `M${r(x1)} ${r(y1)} C${r(x1)} ${r(y1 + bend)} ${r(x2)} ${r(y2 - bend)} ${r(x2)} ${r(y2)}`;
}
function fitTransform(boxes, width, height, padding = 48) {
  if (!boxes.length) return { x: padding, y: padding, k: 1 };
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
  const k = Math.max(0.2, Math.min(1.4, (width - padding * 2) / Math.max(1, right - left), (height - padding * 2) / Math.max(1, bottom - top)));
  return { k, x: (width - (right - left) * k) / 2 - left * k, y: Math.max(padding, (height - (bottom - top) * k) / 2) - top * k };
}
function neighbourSet(edges, id) {
  const near = new Set([id]);
  for (const edge of edges) { if (edge.from === id) near.add(edge.to); if (edge.to === id) near.add(edge.from); }
  return near;
}
function relativeTime(value, now = Date.now()) {
  if (!value) return 'not yet';
  const minutes = Math.round((now - value) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' min ago' : minutes < 1440 ? Math.round(minutes / 60) + ' h ago' : Math.round(minutes / 1440) + ' d ago';
}
// Paths grouped under their folder, folders in path order.
function byFolder(paths) {
  const groups = new Map();
  for (const file of paths) {
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(file);
  }
  return [...groups].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0]));
}

function mapHTML(initialPalette = 'auto') {
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori project guide</title><style nonce="${nonce}">
${BASE_STYLES}
html, body { height: 100%; overflow: hidden; }
body { display: flex; flex-direction: column; }
header { flex: none; padding: 10px 16px 8px; border-bottom: 1px solid var(--read-border); background: var(--read-page); }
.top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 8px; }
.brand img { width: 26px; height: 26px; image-rendering: pixelated; filter: brightness(0) invert(1); }
body.vscode-light:not([data-palette="slate"]) .brand img, body[data-palette="paper"] .brand img { filter: brightness(0); }
.wordmark { font: 800 16px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: -.05em; }
.eyebrow, h2, .folder-label { font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; }
.eyebrow { color: var(--read-muted); }
.tabs { display: inline-flex; margin-left: 10px; }
.tabs button { font-size: 13px; padding: 6px 14px; border: 1px solid var(--read-border); }
.tabs button[aria-selected="true"] { background: var(--read-accent); color: var(--read-on-accent); border-color: var(--read-accent); font-weight: 700; }
.spacer { flex: 1; }
.top > button, .tools button { font-size: 12px; border: 1px solid var(--read-border); }
#notes { border-color: var(--read-ink); box-shadow: 2px 2px 0 var(--read-ink); }
.status { margin: 6px 0 0; font: 11px/1.5 ui-monospace, monospace; color: var(--read-muted); }
.status.error { color: var(--read-error); font-weight: 700; }
.view { flex: 1; min-height: 0; }
.view[hidden] { display: none; }
/* Start here */
#start-view { overflow: auto; padding: 18px 20px 40px; }
.start-head { max-width: 1100px; margin: 0 auto 16px; }
.start-head p { margin: 4px 0; max-width: 80ch; }
.start-body { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 24px; align-items: start; }
#folders { position: sticky; top: 0; display: grid; gap: 2px; }
#folders button { display: flex; justify-content: space-between; gap: 8px; text-align: left; border-left: 3px solid transparent; font: 12px/1.6 ui-monospace, monospace; }
#folders button[aria-current="true"] { border-left-color: var(--read-ink); background: var(--read-hover); font-weight: 700; }
#folders .count { color: var(--read-muted); }
.steps-title { margin: 0 0 4px; font-size: 18px; }
.steps-hint { margin: 0 0 14px; color: var(--read-muted); }
#steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.step { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; padding: 12px 14px; border: 1px solid var(--read-border); background: var(--read-surface); }
.step.focus { border-color: var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); }
.step-number { width: 28px; height: 28px; display: grid; place-items: center; background: var(--read-accent); color: var(--read-on-accent); font: 700 13px ui-monospace, monospace; }
.step-file { font: 700 14px/1.4 ui-monospace, monospace; overflow-wrap: anywhere; }
.step-file .path { color: var(--read-muted); font-weight: 400; }
.step-why { margin: 4px 0; }
.step-links { margin: 2px 0; font-size: 12px; color: var(--read-muted); overflow-wrap: anywhere; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip { font: 10px/1.6 ui-monospace, monospace; border: 1px solid var(--read-border); padding: 0 6px; }
.actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.actions button { border: 1px solid var(--read-border); font-size: 12px; }
.actions button.primary { border-color: var(--read-ink); box-shadow: 2px 2px 0 var(--read-ink); font-weight: 600; }
/* Map */
#map-view { display: flex; flex-direction: column; }
#map-view[hidden] { display: none; }
.tools { flex: none; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 6px 16px; border-bottom: 1px solid var(--read-border); }
.tools .hint { margin-left: 8px; font-size: 11px; color: var(--read-muted); }
.stage { position: relative; flex: 1; min-height: 0; display: flex; }
#canvas { flex: 1; min-width: 0; height: 100%; display: block; cursor: grab; background: var(--read-page); touch-action: none; user-select: none; }
#canvas.panning { cursor: grabbing; }
#canvas:focus-visible { outline: 2px solid var(--read-ink); outline-offset: -2px; }
.box .frame { fill: var(--read-header); stroke: var(--read-border); stroke-width: 1; }
.box.entry .frame { stroke: var(--read-ink); stroke-width: 2; }
.box .head { cursor: grab; }
.box .head-bar { fill: var(--read-hover); }
.box .title { fill: var(--read-ink); font: 700 12px ui-monospace, SFMono-Regular, Consolas, monospace; pointer-events: none; }
.box .count { fill: var(--read-muted); font: 10px ui-monospace, monospace; pointer-events: none; }
.edge { fill: none; stroke: var(--read-muted); stroke-width: 1.2; opacity: .7; }
.edge.inferred { stroke-dasharray: 4 4; }
.edge.hot { stroke: var(--read-ink); stroke-width: 2.2; opacity: 1; }
.arrow { fill: var(--read-muted); }
.node { cursor: pointer; }
.node .shape { fill: var(--read-surface); stroke: var(--read-ink); stroke-width: 1; }
.node .shadow { fill: var(--read-ink); }
.node .label { fill: var(--read-ink); font: 600 12px ui-monospace, SFMono-Regular, Consolas, monospace; pointer-events: none; }
.node .caption { fill: var(--read-muted); font: 10px ui-monospace, monospace; pointer-events: none; }
.node.entry .shape { stroke-width: 2; }
.node.test .shape { stroke-dasharray: 3 3; }
.node.test .label { fill: var(--read-muted); }
.node.selected .shape { fill: var(--read-accent); }
.node.selected .label, .node.selected .caption { fill: var(--read-on-accent); }
.node:focus { outline: none; }
.node:focus-visible .shape { stroke-width: 3; }
.badge rect { fill: var(--read-accent); }
.badge text { fill: var(--read-on-accent); font: 700 10px ui-monospace, monospace; pointer-events: none; }
.dim { opacity: .2; }
aside { flex: none; width: min(340px, 40vw); height: 100%; overflow: auto; border-left: 1px solid var(--read-border); background: var(--read-surface); padding: 10px 16px 28px; }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.drawer-head button { font-size: 11px; border: 1px solid var(--read-border); padding: 2px 8px; }
.step-details { margin-top: 6px; font-size: 12px; }
.step-details summary { cursor: pointer; color: var(--read-muted); font: 11px/1.6 ui-monospace, monospace; }
.step-details p { margin: 4px 0; }
.step-details .term-name { font: 600 12px ui-monospace, monospace; }
aside[hidden] { display: none; }
aside h2 { margin: 18px 0 8px; padding-bottom: 6px; border-bottom: 2px solid var(--read-ink); }
aside section:first-child h2 { margin-top: 0; }
.folder-label { margin: 10px 0 2px; color: var(--read-muted); font-size: 10px; }
.card-title { font: 700 14px/1.4 ui-monospace, monospace; overflow-wrap: anywhere; margin: 0 0 6px; }
.muted { color: var(--read-muted); }
.row { display: block; width: 100%; text-align: left; padding: 5px 4px; border-bottom: 1px solid var(--read-border); overflow-wrap: anywhere; }
.row strong { font: 600 12px ui-monospace, monospace; }
.row span { display: block; font-size: 12px; color: var(--read-muted); }
#glossary-search { width: 100%; font: inherit; color: inherit; background: var(--read-page); border: 1px solid var(--read-border); padding: 5px 7px; margin-bottom: 6px; }
/* Narrow columns: details sit below the map, never on top of it. */
@media(max-width: 720px) { .start-body { grid-template-columns: 1fr; } #folders { position: static; } .stage { flex-direction: column; } aside { width: 100%; height: 45%; border-left: 0; border-top: 1px solid var(--read-border); } }
@media(prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
@media(forced-colors: active) { .node .shape, .box .frame { stroke: CanvasText; fill: Canvas; } .edge { stroke: CanvasText; } }
</style></head><body data-palette="${palette}">
<header><div class="top"><span class="brand"><img src="${LOGO}" alt="Pixel gecko samurai"><span class="wordmark">yamori</span><span class="eyebrow">Project guide</span></span>
<span class="tabs" role="tablist" aria-label="Project guide views"><button id="tab-start" role="tab" aria-selected="true" aria-controls="start-view" title="Which files to read first, folder by folder">Start here</button><button id="tab-map" role="tab" aria-selected="false" aria-controls="map-view" title="How files connect, grouped by folder">Map</button></span>
<span class="spacer"></span>
<button id="rescan" title="Re-read changed files. Local and free; no AI.">Rescan</button><button id="notes" title="Ask your selected AI for a one-line purpose per file, project terms and a reading order">Write AI notes</button></div>
<p id="status" class="status" role="status">Scanning project…</p></header>
<section id="start-view" class="view" role="tabpanel" aria-labelledby="tab-start"><div class="start-head" id="start-head"></div>
<div class="start-body"><nav id="folders" aria-label="Choose a folder"></nav><div><h1 class="steps-title" id="steps-title">Start here</h1><p class="steps-hint" id="steps-hint"></p><ol id="steps"></ol></div></div></section>
<section id="map-view" class="view" role="tabpanel" aria-labelledby="tab-map" hidden><div class="tools">
<button id="expand-all" title="Show the files inside every folder">Expand all</button><button id="collapse-all" title="Show folders only">Collapse all</button>
<button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button><button id="fit" title="Fit the map to the window">Fit</button><button id="reset" title="Put folders back where Yamori placed them">Reset layout</button><button id="drawer-toggle" aria-expanded="false" aria-controls="drawer" title="Show details: the selected file's purpose, terms, what it uses and what uses it, and all project terms">Details</button>
<span class="hint">Drag folders to arrange · click a folder title to fold it · double-click a file to explain it</span></div>
<div class="stage"><svg id="canvas" tabindex="0" role="application" aria-label="Project map. Drag folders, drag the background to pan, scroll to zoom. Double-click a file to explain it." aria-roledescription="graph">
<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0 0 L8 4 L0 8 z"/></marker></defs>
<g id="viewport"><g id="boxes"></g><g id="edges"></g><g id="nodes"></g></g></svg>
<aside id="drawer" aria-label="Details" hidden><div class="drawer-head"><span class="eyebrow">Details</span><button id="drawer-close" title="Close details" aria-label="Close details">Close ×</button></div><section id="card"></section><section id="glossary"></section></aside></div></section>
<script nonce="${nonce}">
const edgePath = ${edgePath.toString()};
const fitTransform = ${fitTransform.toString()};
const neighbourSet = ${neighbourSet.toString()};
const relativeTime = ${relativeTime.toString()};
const byFolder = ${byFolder.toString()};
const vscode = acquireVsCodeApi();
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const SVG = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attrs = {}, text) => { const el = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); if (text !== undefined) el.textContent = text; return el; };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const $ = id => document.getElementById(id);
const canvas = $('canvas'), viewport = $('viewport'), boxLayer = $('boxes'), edgeLayer = $('edges'), nodeLayer = $('nodes');
let state = {}, view = { x: 40, y: 40, k: 1 }, current = 'start', viewToken, focusToken, layoutKey, needsFit = true, query = '', selected, drag, pan;
let positions = new Map(), byId = new Map(), boxes = new Map(), nodeElements = new Map(), boxElements = new Map(), edgeElements = [];
const size = () => ({ width: canvas.clientWidth || 800, height: canvas.clientHeight || 600 });
const fileName = id => id.split('/').at(-1);
function show(name) {
  current = name;
  $('tab-start').setAttribute('aria-selected', String(name === 'start')); $('tab-map').setAttribute('aria-selected', String(name === 'map'));
  $('start-view').hidden = name !== 'start'; $('map-view').hidden = name !== 'map';
  if (name === 'map' && needsFit) { needsFit = false; fit(); }
}
// ---- Map ----
function applyView() { viewport.setAttribute('transform', 'translate(' + Math.round(view.x) + ' ' + Math.round(view.y) + ') scale(' + view.k.toFixed(3) + ')'); }
function box(id) { const n = byId.get(id), p = positions.get(id); return { x: p.x, y: p.y, w: n.w, h: n.h }; }
function fit() { const { width, height } = size(); view = fitTransform([...boxes.values()].map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })), width, height); applyView(); }
function zoom(factor, cx, cy) {
  const { width, height } = size(), x = cx ?? width / 2, y = cy ?? height / 2, k = Math.max(0.15, Math.min(3, view.k * factor));
  view = { k, x: x - (x - view.x) * k / view.k, y: y - (y - view.y) * k / view.k }; applyView();
}
function center(id) { const b = box(id), { width, height } = size(); view = { ...view, x: width / 2 - (b.x + b.w / 2) * view.k, y: height / 2 - (b.y + b.h / 2) * view.k }; applyView(); }
function drawEdges() { for (const item of edgeElements) item.el.setAttribute('d', edgePath(box(item.edge.from), box(item.edge.to))); }
function highlight(id) {
  const near = id && byId.has(id) ? neighbourSet(state.map?.edges || [], id) : undefined;
  for (const [key, el] of nodeElements) el.classList.toggle('dim', !!near && !near.has(key));
  for (const item of edgeElements) { const hot = !!near && (item.edge.from === id || item.edge.to === id); item.el.classList.toggle('hot', hot); item.el.classList.toggle('dim', !!near && !hot); }
}
function showDetails(open) {
  const drawer = $('drawer'); drawer.hidden = !open;
  $('drawer-toggle').setAttribute('aria-expanded', String(open));
}
// Details open only when someone picks a file, never on a redraw.
function select(id, focusNode, reveal = !!focusNode) {
  selected = byId.has(id) ? id : undefined;
  if (selected && reveal) showDetails(true);
  for (const [key, el] of nodeElements) el.classList.toggle('selected', key === selected);
  drawCard(); highlight(selected);
  if (focusNode && selected) { center(selected); nodeElements.get(selected)?.focus?.(); }
}
function open(id) { const item = byId.get(id); if (!item) return; if (item.kind === 'folder') send('toggleFolder', { folder: item.folder }); else send('openFile', { id }); }
// Dragging a file or a folder title moves the whole folder box.
function startDrag(event, boxId, target) {
  if (event.button !== undefined && event.button !== 0) return;
  event.stopPropagation?.(); event.preventDefault?.();
  const b = boxes.get(boxId); if (!b) return;
  const members = [...byId.values()].filter(item => item.group === boxId).map(item => ({ id: item.id, x: positions.get(item.id).x, y: positions.get(item.id).y }));
  drag = { boxId, target, startX: event.clientX, startY: event.clientY, x: b.x, y: b.y, members, moved: false };
  canvas.setPointerCapture?.(event.pointerId);
}
function moveBox(boxId, dx, dy) {
  const b = boxes.get(boxId); b.x = Math.round(drag.x + dx); b.y = Math.round(drag.y + dy);
  boxElements.get(boxId)?.setAttribute('transform', 'translate(' + b.x + ' ' + b.y + ')');
  for (const member of drag.members) {
    const p = { x: Math.round(member.x + dx), y: Math.round(member.y + dy) };
    positions.set(member.id, p); nodeElements.get(member.id)?.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ')');
  }
  drawEdges();
}
function drawMap() {
  boxLayer.replaceChildren(); edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
  nodeElements = new Map(); boxElements = new Map(); edgeElements = [];
  for (const b of boxes.values()) {
    if (b.collapsed) continue;
    const g = svgNode('g', { class: 'box' + (b.entry ? ' entry' : ''), transform: 'translate(' + b.x + ' ' + b.y + ')', 'data-folder': b.folder });
    g.append(svgNode('rect', { class: 'frame', width: b.w, height: b.h }));
    const head = svgNode('g', { class: 'head', tabindex: 0, role: 'button', 'aria-label': 'Folder ' + b.label + ', ' + b.count + ' files. Press Enter to fold it.' });
    head.append(svgNode('rect', { class: 'head-bar', width: b.w, height: 26 }), svgNode('text', { class: 'title', x: 10, y: 17 }, '▾ ' + b.label), svgNode('text', { class: 'count', x: b.w - 10, y: 17, 'text-anchor': 'end' }, b.count + (b.count === 1 ? ' file' : ' files')));
    head.append(svgNode('title', {}, 'Drag to move this folder · click to fold it'));
    head.addEventListener('pointerdown', event => startDrag(event, b.id, { fold: b.folder }));
    head.addEventListener('keydown', event => { if (event.key === 'Enter') send('toggleFolder', { folder: b.folder }); });
    g.append(head); boxLayer.append(g); boxElements.set(b.id, g);
  }
  for (const edge of state.map?.edges || []) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const el = svgNode('path', { class: 'edge' + (edge.imported ? '' : ' inferred'), 'marker-end': 'url(#arrow)' });
    el.append(svgNode('title', {}, edge.from + ' uses ' + edge.to + (edge.names?.length ? ' · ' + edge.names.join(', ') : '')));
    edgeLayer.append(el); edgeElements.push({ edge, el });
  }
  for (const item of byId.values()) {
    const p = positions.get(item.id), note = state.cards?.[item.id];
    const classes = ['node', item.kind, item.entry ? 'entry' : '', item.test ? 'test' : ''].filter(Boolean).join(' ');
    const g = svgNode('g', { class: classes, transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0, role: 'button', 'data-id': item.id,
      'aria-label': (item.kind === 'folder' ? 'Folded folder ' + item.label + ', ' + item.count + ' files' : item.label) + (item.step ? ', reading step ' + item.step : '') + (note?.purpose ? '. ' + note.purpose : '') });
    if (item.entry && item.kind === 'file') g.append(svgNode('rect', { class: 'shadow', x: 3, y: 3, width: item.w, height: item.h }));
    g.append(svgNode('rect', { class: 'shape', width: item.w, height: item.h }));
    if (item.kind === 'folder') {
      g.append(svgNode('text', { class: 'label', x: 12, y: 19 }, '▸ ' + item.label), svgNode('text', { class: 'caption', x: 12, y: 35 }, item.count + ' file' + (item.count === 1 ? '' : 's') + ' · click to unfold'));
    } else g.append(svgNode('text', { class: 'label', x: item.step ? 30 : 10, y: item.h / 2 + 4 }, item.label));
    if (item.step && item.kind === 'file') {
      const badge = svgNode('g', { class: 'badge', transform: 'translate(5 ' + (item.h / 2 - 9) + ')' });
      badge.append(svgNode('rect', { width: 18, height: 18 }), svgNode('text', { x: 9, y: 13, 'text-anchor': 'middle' }, String(item.step)));
      g.append(badge);
    }
    g.append(svgNode('title', {}, (item.kind === 'folder' ? item.label : item.id) + (note?.purpose ? ' — ' + note.purpose : '') + (item.kind === 'file' ? ' · double-click to explain' : '')));
    g.addEventListener('pointerdown', event => startDrag(event, item.group, item.kind === 'folder' ? { fold: item.folder } : { file: item.id }));
    g.addEventListener('dblclick', event => { event.stopPropagation?.(); open(item.id); });
    g.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); open(item.id); } if (event.key === ' ') { event.preventDefault?.(); select(item.id, false, true); } });
    g.addEventListener('pointerenter', () => { if (!drag && !pan) highlight(item.id); });
    g.addEventListener('pointerleave', () => { if (!drag && !pan) highlight(selected); });
    nodeLayer.append(g); nodeElements.set(item.id, g);
  }
  drawEdges(); select(selected);
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== undefined && event.button !== 0) return;
  pan = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, moved: false };
  canvas.classList.add('panning'); canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (drag) {
    const dx = (event.clientX - drag.startX) / view.k, dy = (event.clientY - drag.startY) / view.k;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3 / view.k) return;
    drag.moved = true; moveBox(drag.boxId, dx, dy);
  } else if (pan) {
    pan.moved = pan.moved || Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) > 3;
    view = { ...view, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }; applyView();
  }
});
function release(event) {
  if (drag) {
    const done = drag; drag = undefined;
    if (done.moved) { const b = boxes.get(done.boxId); send('saveLayout', { id: done.boxId, x: b.x, y: b.y }); }
    else if (done.target.file) select(done.target.file, false, true);
    else if (done.target.fold !== undefined) send('toggleFolder', { folder: done.target.fold });
  } else if (pan) {
    if (!pan.moved) select(undefined);
    pan = undefined; canvas.classList.remove('panning');
  }
  canvas.releasePointerCapture?.(event?.pointerId);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', event => {
  event.preventDefault?.();
  const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
  zoom(Math.exp(-(event.deltaY || 0) * (event.ctrlKey ? 0.01 : 0.0018)), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
canvas.addEventListener('keydown', event => {
  if (event.target !== canvas) return;
  const moves = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
  if (moves[event.key]) { event.preventDefault?.(); view = { ...view, x: view.x + moves[event.key][0], y: view.y + moves[event.key][1] }; applyView(); }
  if (event.key === '+' || event.key === '=') zoom(1.2);
  if (event.key === '-') zoom(1 / 1.2);
});
// ---- Lists, always grouped by folder ----
function fileRow(id, detail, onClick) {
  const button = node('button', undefined, 'row');
  button.append(node('strong', fileName(id)));
  if (detail) button.append(node('span', detail));
  button.addEventListener('click', onClick || (() => focusOnMap(id)));
  button.addEventListener('dblclick', () => send('openFile', { id }));
  return button;
}
function groupedRows(parent, ids, detail) {
  for (const [folder, files] of byFolder(ids)) {
    parent.append(node('div', folder ? folder + '/' : 'project root', 'folder-label'));
    files.forEach(id => parent.append(fileRow(id, detail(id))));
  }
}
function focusOnMap(id) {
  if (byId.has(id)) { show('map'); select(id, true); }
  else send('focusMap', { id });
}
function drawCard() {
  const card = $('card'); card.replaceChildren();
  const item = byId.get(selected);
  if (!item) { card.append(node('h2', 'Details'), node('p', 'Click a file to see what it does, what it uses and what uses it. Double-click to explain it.', 'muted')); return; }
  if (item.kind === 'folder') {
    card.append(node('h2', 'Folded folder'), node('p', item.label, 'card-title'), node('p', item.count + ' files.', 'muted'));
    const actions = node('div', undefined, 'actions'), unfold = node('button', 'Unfold', 'primary'), guide = node('button', 'Where to start here');
    unfold.addEventListener('click', () => send('toggleFolder', { folder: item.folder })); guide.addEventListener('click', () => { send('guideFolder', { folder: item.folder }); show('start'); });
    actions.append(unfold, guide); card.append(actions); return;
  }
  const note = state.cards?.[item.id] || {};
  card.append(node('h2', 'File'), node('p', item.id, 'card-title'));
  const chips = node('div', undefined, 'chips');
  for (const text of [item.entry && 'entry point', item.step && 'reading step ' + item.step, item.test && 'test', note.role, note.explained && '✓ explained', note.outdated && 'note outdated'].filter(Boolean)) chips.append(node('span', text, 'chip'));
  card.append(chips, node('p', note.purpose || 'No AI note yet. Write AI notes for a one-line purpose and project terms.', note.purpose ? '' : 'muted'));
  const actions = node('div', undefined, 'actions');
  const explain = node('button', 'Explain in Yamori', 'primary'); explain.addEventListener('click', () => send('openFile', { id: item.id }));
  const source = node('button', 'Open source'); source.addEventListener('click', () => send('revealSource', { id: item.id }));
  actions.append(explain, source); card.append(actions);
  const edges = state.map?.edges || [], names = (from, to) => (edges.find(e => e.from === from && e.to === to)?.names || []).join(', ');
  const uses = edges.filter(e => e.from === item.id && byId.get(e.to)?.kind === 'file').map(e => e.to), usedBy = edges.filter(e => e.to === item.id && byId.get(e.from)?.kind === 'file').map(e => e.from);
  if (uses.length) { card.append(node('h2', 'Uses')); groupedRows(card, uses, id => names(item.id, id)); }
  if (usedBy.length) { card.append(node('h2', 'Used by')); groupedRows(card, usedBy, id => names(id, item.id)); }
  if (note.terms?.length) {
    card.append(node('h2', 'Terms'));
    for (const term of note.terms) {
      const row = node('button', undefined, 'row'); row.append(node('strong', term.term + (term.aliases?.length ? ' · ' + term.aliases.join(', ') : '')), node('span', term.meaning + ' · line ' + term.line));
      row.addEventListener('click', () => send('revealSource', { id: item.id, line: term.line })); card.append(row);
    }
  }
  if (note.defs?.length) { card.append(node('h2', 'Defines'), node('p', note.defs.join(', '), 'muted')); }
}
function drawGlossary() {
  const glossary = $('glossary'), terms = state.glossary || [];
  glossary.replaceChildren(node('h2', 'Project terms · ' + terms.length));
  const input = node('input'); input.id = 'glossary-search'; input.type = 'search'; input.placeholder = 'Find a term'; input.value = query;
  input.setAttribute('aria-label', 'Find a project term');
  const results = node('div');
  const fill = () => {
    results.replaceChildren();
    const needle = query.trim().toLowerCase();
    const shown = terms.filter(term => !needle || [term.term, ...(term.aliases || []), term.meaning || ''].some(text => text.toLowerCase().includes(needle))).slice(0, 200);
    for (const [folder, files] of byFolder([...new Set(shown.map(term => term.file))])) {
      results.append(node('div', folder ? folder + '/' : 'project root', 'folder-label'));
      for (const term of shown.filter(term => files.includes(term.file))) {
        const row = node('button', undefined, 'row');
        row.append(node('strong', term.term + (term.aliases?.length ? ' · ' + term.aliases.slice(0, 4).join(', ') : '')), node('span', (term.meaning || term.kind || 'name') + ' · ' + fileName(term.file) + ':' + term.line));
        row.addEventListener('click', () => send('revealSource', { id: term.file, line: term.line }));
        results.append(row);
      }
    }
    if (!shown.length) results.append(node('p', terms.length ? 'No matching terms.' : 'Write AI notes to collect project terms such as IDs, section names and constants.', 'muted'));
  };
  input.addEventListener('input', () => { query = input.value; fill(); });
  glossary.append(input, results); fill();
}
// ---- Start here ----
function drawStart() {
  const head = $('start-head'); head.replaceChildren();
  head.append(node('p', state.overview || 'Pick a folder on the left. Yamori lists its files in the order that makes them easiest to understand: where things start, then what they use.'));
  if (!state.overview) head.append(node('p', 'Write AI notes to add a one-line purpose for every file, project terms and a written project overview.', 'muted'));
  const folders = $('folders'); folders.replaceChildren();
  for (const folder of state.folders || []) {
    const button = node('button');
    button.style.paddingLeft = (8 + folder.depth * 12) + 'px';
    button.append(node('span', folder.label), node('span', String(folder.count), 'count'));
    button.setAttribute('aria-current', String(folder.key === state.guide?.folder));
    button.title = folder.key ? 'Where to start in ' + folder.key + '/' : 'Where to start in the whole project';
    button.addEventListener('click', () => send('guideFolder', { folder: folder.key }));
    folders.append(button);
  }
  const guide = state.guide || { folder: '', steps: [] };
  $('steps-title').textContent = guide.folder ? 'Start here in ' + guide.folder + '/' : 'Start here';
  $('steps-hint').textContent = guide.steps.length ? 'Read these ' + guide.steps.length + ' file' + (guide.steps.length === 1 ? '' : 's') + ' in order. Each step says why it comes next.' : 'This folder has no source files to read (tests are left out).';
  const list = $('steps'); list.replaceChildren();
  guide.steps.forEach((step, index) => {
    const item = node('li', undefined, 'step' + (step.id === state.focus ? ' focus' : ''));
    const number = node('span', String(index + 1), 'step-number'), body = node('div');
    const title = node('div', undefined, 'step-file');
    if (step.id.includes('/')) title.append(node('span', step.id.slice(0, step.id.lastIndexOf('/') + 1), 'path'));
    title.append(document.createTextNode(fileName(step.id)));
    body.append(title, node('p', step.why, 'step-why'));
    if (step.purpose && step.purpose !== step.why) body.append(node('p', step.purpose, 'muted'));
    if (step.uses?.length || step.usedBy?.length || step.terms?.length) {
      const more = node('details', undefined, 'step-details');
      more.append(node('summary', 'Details: ' + [step.terms?.length && step.terms.length + ' term' + (step.terms.length === 1 ? '' : 's'), step.uses?.length && 'uses ' + step.uses.length, step.usedBy?.length && 'used by ' + step.usedBy.length].filter(Boolean).join(' · ')));
      if (step.usedBy?.length) more.append(node('p', 'Used by: ' + step.usedBy.join(', '), 'step-links'));
      if (step.uses?.length) more.append(node('p', 'Uses: ' + step.uses.join(', '), 'step-links'));
      for (const term of step.terms || []) { const row = node('p'); row.append(node('span', term.term, 'term-name'), document.createTextNode(' · ' + term.meaning)); more.append(row); }
      body.append(more);
    }
    const chips = node('div', undefined, 'chips');
    for (const text of [step.entry && 'entry point', step.explained && '✓ explained'].filter(Boolean)) chips.append(node('span', text, 'chip'));
    if (chips.children.length) body.append(chips);
    const actions = node('div', undefined, 'actions');
    const explain = node('button', 'Explain', 'primary'); explain.title = 'Open this file in Yamori and follow the reading order from there'; explain.addEventListener('click', () => send('openFile', { id: step.id, tour: guide.folder }));
    const source = node('button', 'Open source'); source.addEventListener('click', () => send('revealSource', { id: step.id }));
    const map = node('button', 'Show on map'); map.addEventListener('click', () => focusOnMap(step.id));
    actions.append(explain, source, map); body.append(actions);
    item.append(number, body); list.append(item);
  });
}
function render(s) {
  state = s;
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  byId = new Map((s.map?.nodes || []).map(item => [item.id, item]));
  positions = new Map((s.map?.nodes || []).map(item => [item.id, { x: item.x, y: item.y }]));
  boxes = new Map((s.map?.boxes || []).map(b => [b.id, { ...b }]));
  if (!byId.has(selected)) selected = undefined;
  const n = s.notes || {};
  $('status').textContent = s.error ? s.error : s.waitingForAI && !s.busy ? 'AI notes start once an AI is connected. ' + (s.files || 0) + ' files · ' + (s.links || 0) + ' links mapped without AI.' : [s.busy || s.notesBusy ? s.progress || 'Working…' : undefined, (s.files || 0) + ' files · ' + (s.links || 0) + ' links', 'scanned ' + relativeTime(s.scannedAt), 'AI notes ' + (n.done || 0) + '/' + (n.total || 0) + (n.outdated ? ' (' + n.outdated + ' outdated)' : ''), s.limited ? 'first ' + s.files + ' files shown' : undefined].filter(Boolean).join(' · ');
  $('status').className = 'status' + (s.error ? ' error' : '');
  const notes = $('notes');
  notes.textContent = s.notesBusy ? 'Stop' : s.waitingForAI ? 'Set up AI' : n.done && (n.done < n.total || n.outdated) ? 'Update AI notes' : n.done ? 'AI notes ✓' : 'Write AI notes';
  notes.disabled = !s.notesBusy && !!s.busy;
  notes.title = s.notesBusy ? 'Stop writing AI notes; finished files are kept' : s.waitingForAI ? 'Install or sign in to Claude or ChatGPT; AI notes then start by themselves' : s.autoNotes ? 'AI notes are written automatically after each scan. Press to write them now (also retries after an error).' : 'Ask your selected AI for a one-line purpose per file, project terms and a reading order';
  $('rescan').disabled = !!s.busy;
  drawStart(); drawMap(); drawGlossary();
  // Refit when the set of folders changes, not when one is folded.
  const key = (s.map?.boxes || []).map(b => b.id).join('|');
  if (key !== layoutKey) { layoutKey = key; needsFit = true; }
  if (current === 'map' && needsFit) { needsFit = false; fit(); }
  if (s.viewToken && s.viewToken !== viewToken) { viewToken = s.viewToken; show(s.view === 'map' ? 'map' : 'start'); }
  if (s.focusToken && s.focusToken !== focusToken && byId.has(s.focus)) { focusToken = s.focusToken; if (current === 'map') select(s.focus, true); }
}
$('tab-start').addEventListener('click', () => show('start'));
$('tab-map').addEventListener('click', () => show('map'));
$('expand-all').addEventListener('click', () => send('foldAll', { collapsed: false }));
$('collapse-all').addEventListener('click', () => send('foldAll', { collapsed: true }));
$('zoom-in').addEventListener('click', () => zoom(1.25));
$('zoom-out').addEventListener('click', () => zoom(0.8));
$('fit').addEventListener('click', fit);
$('reset').addEventListener('click', () => send('resetLayout'));
$('rescan').addEventListener('click', () => send('rescan'));
$('notes').addEventListener('click', () => send(state.notesBusy ? 'stop' : state.waitingForAI ? 'setup' : 'notes'));
$('drawer-toggle').addEventListener('click', () => showDetails($('drawer').hidden));
$('drawer-close').addEventListener('click', () => showDetails(false));
window.addEventListener('message', event => { if (event.data?.type === 'map') render(event.data.state); });
showDetails(false);
show('start');
send('ready');
</script></body></html>`;
}
module.exports = { mapHTML, edgePath, fitTransform, neighbourSet, relativeTime, byFolder };
