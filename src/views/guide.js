'use strict';
// Project guide webview. "Start here" lists, folder by folder, which files to
// read first. "Map" shows the dependency graph with files grouped in folder
// boxes: drag a box to move it, click its header to fold it, click a file for
// details, double-click to explain it. Text is always inserted with textContent.
const { randomBytes } = require('node:crypto');
const { BASE_STYLES, LOGO, READING_STYLES, pseudocodeLines, emphasisParts, mathParts, tokenize } = require('./reader');
const { STAGES_STYLE, stagesClient } = require('./stages');

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

// Conservative display hints for cached plans: mixed or unclear actions are changes.
function proposalKind(steps) {
  const kinds = (Array.isArray(steps) ? steps : [steps]).filter(Boolean).map(step => {
    const title = String(step.title || '').trim(), change = String(step.change || '').trim();
    const action = /^(?:add|create|introduce|append|implement|new|remove|delete|drop|eliminate)\b/i.test(title) ? title : change;
    if (/^(?:add|create|introduce|append|implement|new)\b/i.test(action) && !/\b(?:remove|delete|drop|refactor|replace)\b/i.test(change)) return 'add';
    if (/^(?:remove|delete|drop|eliminate)\b/i.test(action) && !/\b(?:add|create|replace|refactor)\b/i.test(change)) return 'remove';
    return 'change';
  });
  return kinds.length && kinds.every(kind => kind === kinds[0]) ? kinds[0] : 'change';
}


// Compare cached pseudocode locally. Removed text is never repeated in the reader.
function planPseudocodeDiff(text, step = {}) {
  const lines = String(text || '').split(/\r?\n/).map(text => ({ text, change: '' }));
  const key = text => text.replace(/^L\d+(?:[–-]\d+)?\s+/, '').trim().replace(/\s+/g, ' ');
  const next = lines.filter(line => key(line.text)), old = String(step.before || '').split(/\r?\n/).map(key).filter(Boolean);
  if (step.newFile || !old.length) {
    const change = step.newFile || proposalKind(step) === 'add' ? 'add' : 'change';
    for (const line of next) line.change = change;
    return { lines, removed: 0 };
  }
  // Bounded by cached preview size, not by the size of a source file.
  const keys = next.map(line => key(line.text));
  const table = Array.from({ length: old.length + 1 }, () => new Uint16Array(keys.length + 1));
  for (let i = old.length - 1; i >= 0; i--) for (let j = keys.length - 1; j >= 0; j--) table[i][j] = old[i] === keys[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  let i = 0, j = 0, deleted = 0, removed = 0, pending = [];
  const flush = () => {
    for (const line of pending) line.change = deleted ? 'change' : 'add';
    removed += Math.max(0, deleted - pending.length); deleted = 0; pending = [];
  };
  while (i < old.length || j < keys.length) {
    if (i < old.length && j < keys.length && old[i] === keys[j]) { flush(); i++; j++; }
    else if (i < old.length && (j === keys.length || table[i + 1][j] >= table[i][j + 1])) { deleted++; i++; }
    else pending.push(next[j++]);
  }
  flush(); return { lines, removed };
}

// Connections are grounded in saved changes and exact file references, not inferred semantics.
function planIdeaGraph(plan, knownFiles = []) {
  const modified = [...new Set((plan?.steps || []).map(step => step.file))];
  const known = [...new Set([...modified, ...knownFiles])], byBase = new Map();
  for (const file of known) { const base = file.split('/').at(-1); byBase.set(base, [...(byBase.get(base) || []), file]); }
  const groups = new Map();
  for (const step of plan?.steps || []) {
    if (step.status === 'skipped' || plan.dismissed?.includes(step.file)) continue;
    const title = String(step.title || step.change || 'Explore change').trim();
    const key = title.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim();
    if (!groups.has(key)) groups.set(key, { id: step.id, title, steps: [], files: [] });
    const group = groups.get(key); group.steps.push(step); group.files.push(step.file);
    const text = [step.title, step.change, step.why].join(' ');
    for (const file of known) {
      const base = file.split('/').at(-1), names = [file, ...(byBase.get(base).length === 1 ? [base] : [])];
      if (names.some(name => new RegExp('(^|[^A-Za-z0-9_./-])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^A-Za-z0-9_./-]|[.,;:!?](?:\\s|$))').test(text))) group.files.push(file);
    }
  }
  const ideas = [...groups.values()].map(group => ({ ...group, files: [...new Set(group.files)], kind: proposalKind(group.steps), reuse: /^(reuse|keep|preserve|retain)\b/i.test(group.title) }));
  const files = [...new Set([...modified, ...ideas.flatMap(idea => idea.files)])].map(id => ({ id, count: (plan.steps || []).filter(step => step.file === id).length, changed: modified.includes(id) }));
  return { ideas, files };
}
function planFilePathLines(file) {
  const lines = []; let remaining = String(file);
  while (remaining.length > 30) {
    const slash = remaining.lastIndexOf('/', 29), cut = slash >= 8 ? slash + 1 : 30;
    lines.push(remaining.slice(0, cut)); remaining = remaining.slice(cut);
  }
  if (remaining) lines.push(remaining);
  return lines.length ? lines : ['.'];
}
function planFileHeight(file) { return 66 + planFilePathLines(file).length * 14; }
function planCanvasLayout(graph, { expanded, offsets = {}, ideaOffsets = {} } = {}) {
  const files = {}, ideas = {}, occupied = [], columns = graph.files.length <= 4 ? 2 : 3;
  const expandedIndex = graph.files.findIndex(file => file.id === expanded), expandedRow = Math.floor(expandedIndex / columns);
  const extra = expandedIndex < 0 ? 0 : graph.files[expandedIndex].count * 48 + 12;
  graph.files.forEach((file, index) => {
    const row = Math.floor(index / columns), manual = offsets[file.id];
    const preceding = Array.from({ length: row }, (_, r) => Math.max(250, ...graph.files.slice(r * columns, (r + 1) * columns).map(f => planFileHeight(f.id) + 120))).reduce((a, b) => a + b, 0);
    const rect = { x: manual?.x ?? 120 + index % columns * 360, y: manual?.y ?? 160 + preceding + (expandedIndex >= 0 && row > expandedRow ? extra : 0), w: 240, h: planFileHeight(file.id) + (file.id === expanded ? extra : 0) };
    files[file.id] = rect; occupied.push(rect);
  });
  const overlaps = rect => occupied.some(other => rect.x < other.x + other.w + 18 && rect.x + rect.w + 18 > other.x && rect.y < other.y + other.h + 18 && rect.y + rect.h + 18 > other.y);
  for (const idea of graph.ideas) {
    if (ideaOffsets[idea.id]) { ideas[idea.id] = { ...ideaOffsets[idea.id], w: 240, h: 54 }; occupied.push(ideas[idea.id]); continue; }
    const related = idea.files.map(file => files[file]).filter(Boolean);
    const cx = related.reduce((sum, file) => sum + file.x + file.w / 2, 0) / related.length;
    const cy = related.reduce((sum, file) => sum + file.y + file.h / 2, 0) / related.length;
    let chosen;
    for (let ring = 0; !chosen && ring < 40; ring++) {
      for (const dy of [-100 - ring * 78, 112 + ring * 78]) {
        for (const dx of [0, -260, 260, -520, 520]) {
          const rect = { x: cx - 120 + dx, y: cy + dy - 27, w: 240, h: 54 };
          if (!overlaps(rect)) { chosen = rect; break; }
        }
        if (chosen) break;
      }
    }
    chosen ||= { x: cx - 120, y: cy - 3400, w: 240, h: 54 };
    ideas[idea.id] = chosen; occupied.push(chosen);
  }
  return { files, ideas };
}

function mapHTML(initialPalette = 'auto') {
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori project guide</title><style nonce="${nonce}">
${BASE_STYLES}
${require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vendor', 'terminal.css'), 'utf8')}
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
.agents { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.agents:empty { display: none; }
.agents button { font: 11px ui-monospace, monospace; border: 1px solid var(--read-border); padding: 1px 8px; }
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
.step-badge { width: 28px; height: 28px; display: grid; place-items: center; background: var(--read-accent); color: var(--read-on-accent); font: 700 13px ui-monospace, monospace; }
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
/* Search: always visible in the header; hits glow on the map. */
.search { display: flex; align-items: stretch; flex: 1 1 260px; max-width: 460px; min-width: 200px; margin-left: 12px; }
.search input { flex: 1; min-width: 0; font: 13px/1.4 var(--vscode-font-family, system-ui); color: var(--read-ink); background: var(--read-surface); border: 2px solid var(--read-ink); border-right: 0; padding: 6px 10px; }
.search input:focus { outline: none; box-shadow: inset 0 0 0 1px var(--read-ink); }
.search button { border: 2px solid var(--read-ink); background: var(--read-accent); color: var(--read-on-accent); font-weight: 700; padding: 0 12px; }
.node.hit .shape { stroke-width: 3; fill: var(--read-mark-bg); }
.node.hit .label { font-weight: 800; }
.hit-count rect { fill: var(--read-ink); }
.hit-count text { fill: var(--read-page); font: 700 10px ui-monospace, monospace; pointer-events: none; }
#search-panel { width: min(380px, 44vw); }
.search-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.search-head h2 { flex: 1; overflow-wrap: anywhere; }
.search-head button { font-size: 11px; border: 1px solid var(--read-border); padding: 2px 8px; }
.explain-flow { width: 100%; margin: 4px 0 6px; padding: 8px; font-weight: 700; background: var(--read-accent); color: var(--read-on-accent); border: 1px solid var(--read-accent); }
.flow { margin: 10px 0 14px; padding: 10px 12px; border: 1px solid var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); background: var(--read-page); }
.flow p { margin: 4px 0; }
.flow ol { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; }
.flow li button { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 6px; width: 100%; text-align: left; padding: 5px 4px; border-left: 3px solid var(--read-border); }
.flow li button:hover { border-left-color: var(--read-ink); }
.flow .num { font: 700 11px ui-monospace, monospace; }
.flow .where { display: block; font: 600 11px ui-monospace, monospace; overflow-wrap: anywhere; }
.flow .role { font: 600 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .05em; color: var(--read-muted); }
/* Flow: the reader's own blocks and lines, scoped to the flow so they never touch the guide. */
@scope (.flow-reading) {
${READING_STYLES}
}
.flow-reading { margin-top: 12px; }
.flow-reading details.reading-block { margin-bottom: 14px; }
aside .flow-reading .section-heading { padding: 10px 12px; gap: 8px; }
aside .flow-reading .section-heading h2 { margin: 0; padding: 0; border: 0; font: 650 14px/1.45 var(--vscode-font-family, system-ui); text-transform: none; letter-spacing: 0; }
aside .flow-reading .line { border: 1px solid var(--read-border); padding: 2px 6px; }
aside .flow-reading pre { font-size: 14px; padding: 12px 8px 14px; }
#search-panel.wide { width: min(640px, 56vw); }
.match { display: grid; grid-template-columns: 4ch minmax(0, 1fr); gap: 6px; width: 100%; text-align: left; padding: 1px 4px; font: 11px/1.5 ui-monospace, monospace; color: var(--read-muted); }
.match:hover { color: var(--read-ink); }
.match code { white-space: pre-wrap; overflow-wrap: anywhere; }
/* Plan: a panel beside the same map; nodes carry step numbers, ripples and suggestions. */
#plan-panel { flex: none; width: min(440px, 48vw); height: 100%; overflow: auto; border-left: 1px solid var(--read-border); background: var(--read-surface); padding: 12px 14px 36px; }
#plan-panel[hidden] { display: none; }
.plan-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.plan-head h2 { flex: 1; margin: 0; padding: 0; border: 0; }
.plan-head button, .plan-row button, .step-actions button, .plan-foot button, .sel-bar button { border: 1px solid var(--read-border); font-size: 11px; padding: 2px 8px; }
.plan-head button:disabled { opacity: .35; }
#plan-goal { display: block; width: 100%; min-height: 56px; font: 13px/1.5 var(--vscode-font-family, system-ui); color: var(--read-ink); background: var(--read-page); border: 2px solid var(--read-ink); padding: 7px 9px; resize: vertical; }
.plan-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 0; }
button.go { background: var(--read-accent); color: var(--read-on-accent); border: 1px solid var(--read-accent); font-weight: 700; padding: 6px 12px; font-size: 12px; }
button.go:disabled { opacity: .4; }
.plan-estimate, .plan-models { margin: 6px 0; font: 11px/1.5 ui-monospace, monospace; color: var(--read-muted); }
.plan-busy { margin: 8px 0; padding: 7px 9px; border-left: 3px solid var(--read-ink); background: var(--read-note-bg); font-size: 12px; }
.plan-err { margin: 8px 0; padding: 7px 9px; border: 1px solid var(--read-ink); font-size: 12px; font-weight: 600; }
.plan-sub { margin: 14px 0 4px; font: 600 11px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--read-muted); }
.cand { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 6px; padding: 4px 2px; border-bottom: 1px solid var(--read-border); cursor: pointer; }
.cand:hover { background: var(--read-hover); }
.cand input { margin: 3px 0 0; }
.cand .path { font: 600 12px ui-monospace, monospace; overflow-wrap: anywhere; }
.cand .why { font-size: 11px; color: var(--read-muted); }
.sel-bar { margin: 8px 0; padding: 7px 9px; border: 1px dashed var(--read-ink); font-size: 12px; }
.sel-bar .path { font: 700 12px ui-monospace, monospace; overflow-wrap: anywhere; display: block; margin-bottom: 4px; }
.plan-summary { margin: 8px 0; font-size: 13px; }
.plan-notes p { margin: 2px 0; font-size: 11px; color: var(--read-muted); }
.step-card { border: 1px solid var(--read-ink); background: var(--read-page); margin: 10px 0; }
.step-card.dragging { opacity: .4; }
.step-card.over { box-shadow: 0 -3px 0 var(--read-ink); }
.step-card.flash { box-shadow: 0 0 0 3px var(--read-ink); }
.step-card.done .step-title { text-decoration: line-through; opacity: .7; }
.step-card.skipped { opacity: .55; }
.step-top { display: grid; grid-template-columns: 16px 24px minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--read-border); }
.handle { cursor: grab; color: var(--read-muted); font: 700 14px ui-monospace, monospace; user-select: none; }
.step-num { height: 22px; display: grid; place-items: center; background: var(--read-accent); color: var(--read-on-accent); font: 700 12px ui-monospace, monospace; }
.step-title { width: 100%; font: 650 13px/1.4 var(--vscode-font-family, system-ui); color: inherit; background: transparent; border: 1px solid transparent; padding: 2px 4px; }
.step-title:focus, .step-field:focus { border-color: var(--read-ink); outline: none; background: var(--read-surface); }
.step-actions { display: flex; gap: 3px; }
.step-body { padding: 6px 8px 8px; display: grid; gap: 6px; }
.step-field { width: 100%; font: 12px/1.5 var(--vscode-font-family, system-ui); color: inherit; background: transparent; border: 1px solid var(--read-border); padding: 4px 6px; resize: vertical; }
.step-where { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font: 11px ui-monospace, monospace; }
.step-where .step-field { width: auto; flex: 1 1 14ch; font: 11px ui-monospace, monospace; }
.step-where input[type=number] { flex: 0 0 6ch; width: 6ch; }
.impact { display: flex; flex-wrap: wrap; gap: 4px; font: 10px/1.6 ui-monospace, monospace; }
.impact span { border: 1px solid var(--read-border); padding: 0 6px; }
.impact .risk { border-color: var(--read-ink); font-weight: 700; }
.ba { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ba textarea { min-height: 120px; font: 11px/1.5 ui-monospace, monospace; }
.ba label { font: 600 10px ui-monospace, monospace; text-transform: uppercase; color: var(--read-muted); display: block; }
.plan-foot { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.node .plan-badge rect { fill: var(--read-ink); }
.node .plan-badge text { fill: var(--read-page); font: 700 11px ui-monospace, monospace; pointer-events: none; }
.node .suggest rect { fill: var(--read-page); stroke: var(--read-ink); stroke-width: 1.5; }
.node .suggest text { fill: var(--read-ink); font: 700 11px ui-monospace, monospace; pointer-events: none; }
.node.ripple .shape { stroke-dasharray: 5 3; stroke-width: 2; }
.node.planned .shape { stroke-width: 3; }
@media(max-width: 720px) { #plan-panel { width: 100%; height: 55%; border-left: 0; border-top: 1px solid var(--read-border); } .ba { grid-template-columns: 1fr; } }
/* Narrow columns: details sit below the map, never on top of it. */
@media(max-width: 720px) { .search { order: 5; flex-basis: 100%; max-width: none; margin: 8px 0 0; } #search-panel { width: 100%; } .start-body { grid-template-columns: 1fr; } #folders { position: static; } .stage { flex-direction: column; } aside { width: 100%; height: 45%; border-left: 0; border-top: 1px solid var(--read-border); } }
@media(prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
@media(forced-colors: active) { .node .shape, .box .frame { stroke: CanvasText; fill: Canvas; } .edge { stroke: CanvasText; } }

/* Plan: a compact outline with one editor in focus. */
#plan-panel { width: min(480px, 48vw); padding: 20px 22px 36px; }
.plan-head { margin-bottom: 16px; }
.plan-head h2 { font: 700 19px/1.3 var(--vscode-font-family, system-ui); text-transform: none; letter-spacing: -.02em; }
#plan-goal { border: 1px solid var(--read-border); border-radius: 6px; padding: 12px; min-height: 74px; font-size: 14px; }
#plan-goal:focus { outline: 2px solid var(--read-ink); outline-offset: 2px; }
.plan-sub { margin-top: 24px; margin-bottom: 10px; }
.plan-summary { font-size: 14px; line-height: 1.6; margin: 18px 0; max-width: 65ch; }
.plan-context, .plan-meta { border: 0; border-bottom: 1px solid var(--read-border); padding: 10px 0; margin: 6px 0; }
.plan-context > summary, .plan-meta > summary { cursor: pointer; font: 12px/1.5 var(--vscode-font-family, system-ui); color: var(--read-muted); padding: 4px 0; }
.plan-estimate, .plan-models { font-family: var(--vscode-font-family, system-ui); line-height: 1.6; }
.step-card { border: 0; border-bottom: 1px solid var(--read-border); background: transparent; margin: 0; }
.step-top { grid-template-columns: 12px 24px minmax(0,1fr) 14px; padding: 14px 0 4px; border: 0; cursor: pointer; list-style: none; }
.step-top::-webkit-details-marker { display: none; }
.step-title { font-size: 14px; font-weight: 600; padding: 2px 0; }
.step-num { background: transparent; color: var(--read-muted); font-size: 12px; }
.step-caption { display: block; grid-column: 3 / 4; margin: 0 0 4px; color: var(--read-muted); font: 11px/1.5 ui-monospace, monospace; }
.step-preview { grid-column: 3 / 4; margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: var(--read-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.step-disclosure[open] .step-preview { display: none; }
.step-disclosure[open] .step-chevron { transform: rotate(180deg); }
.step-chevron { color: var(--read-muted); transition: transform 160ms ease-out; }
.step-body { padding: 14px 0 20px 48px; gap: 14px; }
.step-label { display: grid; gap: 6px; font-size: 11px; color: var(--read-muted); }
.step-field { background: var(--read-page); padding: 8px 10px; border-radius: 4px; color: var(--read-ink); font-size: 13px; }
.step-actions { justify-content: flex-end; border-top: 1px solid var(--read-border); padding-top: 10px; opacity: .7; }
.step-actions:hover, .step-actions:focus-within { opacity: 1; }
.plan-foot { position: sticky; bottom: -36px; background: var(--read-surface); padding: 14px 0; border-top: 1px solid var(--read-border); margin-top: 24px; }
.plan-foot button:first-child { background: var(--read-accent); color: var(--read-on-accent); border-color: var(--read-accent); padding: 8px 12px; }
.plan-secondary button { border-color: transparent; color: var(--read-muted); }
.plan-busy { border: 1px solid var(--read-border); padding: 10px; }
.step-top:focus-visible, .plan-context > summary:focus-visible, .plan-meta > summary:focus-visible { outline: 2px solid var(--read-ink); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .step-chevron { transition: none; } }
@media (max-width:720px) { #plan-panel { width:100%; padding:14px 18px 30px; } }


body[data-planning="true"] .tools { display:none; }
/* A goal on an empty canvas; the plan itself is the navigation. */
#plan-panel { position: absolute; z-index: 4; right: 20px; top: 20px; height: auto; max-height: calc(100% - 40px); width: min(420px,calc(100% - 40px)); border: 1px solid var(--read-border); border-radius: 8px; padding: 18px; box-shadow: none; }
#plan-panel[data-ready="false"] { right: auto; left: 50%; top: 40%; transform: translate(-50%,-50%); border: 0; background: transparent; }
#plan-panel[data-ready="false"] .plan-head button, #plan-panel[data-ready="false"] .plan-context { display:none; }
#plan-panel[data-ready="true"]:not([data-inspecting="true"]) { top:auto; bottom:20px; right:auto; left:20px; max-height:220px; }
#plan-panel[data-ready="true"]:not([data-inspecting="true"]) > :not(.plan-head):not(#plan-goal):not(.plan-summary) { display:none; }
#plan-panel[data-ready="true"] .step-card[data-selected="false"] { display:none; }
#plan-panel[data-ready="true"] .plan-context, #plan-panel[data-ready="true"] .sel-bar, #plan-panel[data-ready="true"] .plan-meta { display:none; }
.plan-source { margin:0; padding:12px; background:var(--read-page); border:1px solid var(--read-border); font:11px/1.7 ui-monospace,monospace; white-space:pre; overflow:auto; max-height:240px; color:var(--read-ink); }


#plan-panel { width:min(620px,calc(100% - 48px)); border:2px solid var(--read-ink); border-radius:0; box-shadow:5px 5px 0 var(--read-ink); }
.step-body { padding-left:12px; padding-right:12px; gap:20px; }
.step-reading { font-size:16px; line-height:1.75; white-space:pre-wrap; overflow-wrap:anywhere; margin:0; color:var(--read-ink); }
.step-card:not(.editing) .step-label > input, .step-card:not(.editing) .step-label > textarea, .step-card:not(.editing) .step-where { display:none; }
.step-card.editing .step-reading, .step-card.editing .step-title-reading { display:none; }
.step-card:not(.editing) .step-title, .step-card:not(.editing) .ba textarea, .step-card:not(.editing) .snippet-block > textarea { display:none; }
.step-title-reading { grid-column:3; font:600 17px/1.5 var(--vscode-font-family,system-ui); overflow-wrap:anywhere; }
.step-chevron { grid-column:4; grid-row:1; }
.ba .step-reading { white-space:pre-wrap; }
.step-card .step-label > .step-reading { max-width:65ch; }
.step-card.editing input, .step-card.editing textarea, .terminal-comment, .plan-question textarea { background:oklch(19% .009 260); color:oklch(92% .025 150); border:1px solid oklch(50% .01 260); border-radius:0; font:14px/1.75 ui-monospace,monospace; padding:12px; caret-color:oklch(88% .1 150); }
.step-card.editing textarea { min-height:130px; }
.step-where { display:grid; grid-template-columns:minmax(0,1fr) auto 70px auto 70px; }
.step-where .step-field { min-width:0; width:100%; }
.step-label > span { font:600 11px/1.5 ui-monospace,monospace; text-transform:uppercase; letter-spacing:.08em; }
.file-feedback { padding:14px 0; display:grid; gap:10px; }
.terminal-comment { width:100%; min-height:85px; }
.plan-ai { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
.plan-ai button { border:1px solid var(--read-border); padding:6px 10px; font:12px ui-monospace,monospace; }
.plan-question { position:relative; padding:20px; border:2px solid var(--read-ink); background:var(--read-surface); box-shadow:4px 4px 0 var(--read-ink); margin:18px 0; }
.plan-question p { white-space:pre-line; }
.plan-question textarea { display:block; width:100%; min-height:100px; margin:12px 0; }
.plan-usage { font:12px/1.6 ui-monospace,monospace; margin:12px 0; }
.plan-activity { font:11px/1.6 ui-monospace,monospace; margin:4px 0; }
#plan-panel[data-ready="true"]:not([data-inspecting="true"]) > .plan-ai, #plan-panel[data-ready="true"]:not([data-inspecting="true"]) > .plan-busy, #plan-panel[data-ready="true"]:not([data-inspecting="true"]) > .plan-question, #plan-panel[data-ready="true"]:not([data-inspecting="true"]) > .plan-usage { display:block; }
#plan-panel:has(.plan-question), #plan-panel:has(.plan-busy) { max-height:calc(100% - 40px); }

.node.rejected .label { text-decoration:line-through; } .node.rejected .shape { stroke-dasharray:5 3; }

/* The conversation is a terminal, never a goal/start-over card. */
body[data-planning="true"] .agents { display:none; }
#plan-panel:not([data-inspecting="true"]), #plan-panel[data-ready="false"] { position:absolute; inset:0; width:100%; max-height:none; height:100%; padding:0; transform:none; background:transparent; border:0; box-shadow:none; pointer-events:none; overflow:visible; }
#plan-panel:not([data-inspecting="true"]) > :not(.plan-terminal) { display:none !important; }
#plan-panel .plan-terminal { display:flex !important; position:fixed; left:20px; right:20px; bottom:12px; height:230px; max-height:42vh; flex-direction:column; padding:12px 18px; background:var(--read-page); border:0; border-top:1px solid var(--read-border); box-shadow:none; color:var(--read-ink); font:13px/1.65 ui-monospace,monospace; z-index:8; pointer-events:auto; }
#plan-panel[data-ready="false"] .plan-terminal { top:25%; bottom:auto; height:auto; max-height:65vh; }
.plan-transcript { flex:1; min-height:36px; overflow:auto; padding:4px 0 10px; }
.terminal-message { display:grid; grid-template-columns:58px minmax(0,1fr); gap:12px; padding:4px 0; }
.terminal-message[data-role="user"] { color:var(--read-ink); background:var(--read-header); padding:10px 12px; margin:8px 0; }
.terminal-message[data-role="user"] .terminal-speaker { color:var(--read-link,var(--read-ink)); font-weight:600; }
.terminal-message[data-role="assistant"] .terminal-speaker { color:var(--read-muted); font-weight:600; }
.terminal-message p { white-space:pre-wrap; margin:0; overflow-wrap:anywhere; max-width:72ch; }
.terminal-speaker, .terminal-prompt { color:var(--read-muted); }
.terminal-composer { display:flex; align-items:flex-start; gap:12px; }
.terminal-composer #plan-goal { min-height:46px; max-height:130px; resize:vertical; font:inherit; background:transparent; color:inherit; border:0; border-radius:0; padding:0; box-shadow:none; }
.terminal-composer #plan-goal:focus { outline:0; }
.terminal-composer:focus-within { outline:1px dotted var(--read-border); outline-offset:4px; }
.plan-terminal .plan-row { margin:4px 0 0; }
.plan-terminal .plan-ai { margin:0 0 6px; }
.plan-terminal .plan-ai button { border:0; padding:0 10px 0 0; background:transparent; }
.plan-terminal .plan-usage { position:absolute; right:18px; top:5px; margin:0; font-size:10px; }
.plan-terminal .plan-busy { border:0; padding:4px 0; margin:0; font:11px/1.5 ui-monospace,monospace; }
.plan-terminal .plan-busy .plan-activity { display:none; }
#plan-panel[data-inspecting="true"] { top:16px; bottom:260px; max-height:calc(100% - 280px); height:auto; pointer-events:auto; }
#plan-panel[data-inspecting="true"] .plan-head { position:sticky; top:-18px; background:var(--read-surface); z-index:2; padding:8px 0; }

.step-reading { font-size:14px; line-height:1.65; }
.plan-terminal .plan-question { position:fixed; top:16%; left:15%; right:15%; max-height:65vh; overflow:auto; }


/* Proposed change semantics, independent of monochrome editor chrome. */
.change-add { --change-bg:oklch(95% .035 150); --change-ink:oklch(34% .08 150); --change-border:oklch(65% .11 150); }
.change-remove { --change-bg:oklch(95% .03 25); --change-ink:oklch(42% .13 25); --change-border:oklch(65% .13 25); }
.change-change { --change-bg:oklch(96% .06 90); --change-ink:oklch(39% .075 75); --change-border:oklch(68% .12 85); }
body.vscode-dark:not([data-palette="paper"]) .change-add, body[data-palette="slate"] .change-add { --change-bg:oklch(25% .035 150); --change-ink:oklch(86% .12 150); --change-border:oklch(64% .12 150); }
body.vscode-dark:not([data-palette="paper"]) .change-remove, body[data-palette="slate"] .change-remove { --change-bg:oklch(25% .035 25); --change-ink:oklch(86% .10 25); --change-border:oklch(65% .13 25); }
body.vscode-dark:not([data-palette="paper"]) .change-change, body[data-palette="slate"] .change-change { --change-bg:oklch(26% .035 90); --change-ink:oklch(90% .12 90); --change-border:oklch(70% .12 90); }
.node.change-add .shape, .node.change-remove .shape, .node.change-change .shape { fill:var(--change-bg); stroke:var(--change-border); }
.node.change-add .label, .node.change-add .caption, .node.change-remove .label, .node.change-remove .caption, .node.change-change .label, .node.change-change .caption { fill:var(--change-ink); }
.change-kind { color:var(--change-ink); fill:var(--change-ink); font:600 11px/1.6 ui-monospace,monospace; }
.step-card .step-label[data-field="change"] .step-reading { color:var(--read-ink); background:transparent; border:0; padding:0; }
.step-card .step-num { color:var(--change-ink); }
.node.rejected .shape { fill:var(--read-page); stroke:var(--read-muted); }
.node.rejected .label, .node.rejected .caption, .node.rejected .change-kind { fill:var(--read-muted); }
@media(forced-colors:active) { .node .shape { fill:Canvas; stroke:CanvasText; } .change-kind { color:CanvasText; fill:CanvasText; } }


.plan-terminal[data-native="true"] .plan-transcript, .plan-terminal[data-native="true"] > .plan-row { display:none; }
#plan-panel .plan-terminal { background:var(--read-page); color:var(--read-ink); padding:8px 12px; height:var(--plan-terminal-height,280px); max-height:none; }
#plan-panel[data-ready="false"] .plan-terminal { top:auto; bottom:12px; height:var(--plan-terminal-height,280px); max-height:none; }
.plan-terminal .plan-ai button { color:var(--read-muted); font:11px Menlo,monospace; padding:0 14px 0 0; }
.plan-terminal .plan-usage { color:var(--read-muted); font-size:10px; }
.plan-terminal-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; margin-bottom:6px; flex-shrink:0; }
.plan-terminal-toolbar .plan-ai { flex:1; min-width:0; margin:0; }
.plan-terminal .plan-terminal-toolbar .plan-usage { position:static; margin:0; }
.plan-terminal-toolbar .plan-new { margin-left:auto; flex-shrink:0; padding:4px 10px; border:1px solid var(--read-border); background:var(--read-accent); color:var(--read-on-accent); font:12px Menlo,monospace; }
.plan-terminal-toolbar .plan-new:hover { background:var(--vscode-button-hoverBackground,var(--read-accent)); }
.plan-terminal-toolbar .plan-new:focus-visible { outline:2px solid var(--read-link,var(--read-ink)); outline-offset:2px; }
.plan-live { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 14px; flex-shrink:0; padding-top:5px; font:11px/1.5 Menlo,monospace; color:var(--read-muted); }
.plan-live-phase { color:var(--read-link,var(--read-ink)); overflow-wrap:anywhere; }
.plan-live-metric { color:var(--read-muted); }
.plan-live-trail { margin-left:auto; position:relative; }
.plan-live-trail summary { cursor:pointer; }
.plan-live-trail[open] { max-height:84px; overflow:auto; }
.plan-live-trail p { margin:2px 0; }

.terminal-resizer { position:absolute; left:0; right:0; top:-7px; height:12px; cursor:ns-resize; touch-action:none; z-index:10; }
.terminal-resizer::after { content:""; position:absolute; left:calc(50% - 24px); top:5px; width:48px; height:2px; background:var(--read-border); }
.terminal-resizer:hover::after, .terminal-resizer:focus-visible::after { background:var(--read-link,var(--read-ink)); }
.terminal-resizer:focus-visible { outline:1px solid var(--read-link,var(--read-ink)); outline-offset:1px; }
.plan-terminal .terminal-composer { flex-shrink:0; margin-top:6px; padding:4px 0; gap:9px; font:13px/1.65 Menlo,Monaco,Consolas,monospace; }
.plan-terminal .terminal-prompt { color:var(--read-link,var(--read-ink)); user-select:none; }
.plan-terminal .terminal-composer #plan-goal { flex:1; min-width:0; width:auto; min-height:24px; max-height:180px; padding:0; margin:0; resize:none; overflow-y:auto; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; caret-color:var(--read-link,var(--read-ink)); }
.plan-terminal .terminal-composer:focus-within { outline:none; }
.plan-terminal .terminal-composer #plan-goal:focus-visible { outline:none; }
.plan-terminal .terminal-composer #plan-goal::placeholder { color:var(--read-muted); }

.terminal-stream[hidden] { display:none; }
.terminal-stream { white-space:pre-wrap; overflow-wrap:anywhere; font:13px/1.5 Menlo,Monaco,Consolas,monospace; color:var(--read-ink); background:var(--read-surface); padding:8px 12px; margin:6px 0; max-height:45%; overflow:auto; flex-shrink:1; }
.native-terminal { flex:1; min-height:0; width:100%; overflow:hidden; }
.native-terminal .xterm { height:100%; }
#plan-panel[data-inspecting="true"] { bottom:calc(var(--plan-terminal-height,280px) + 28px); max-height:max(0px,calc(100% - var(--plan-terminal-height,280px) - 48px)); padding:12px 16px; }
.step-navigation { position:sticky; top:38px; display:flex; gap:8px; background:var(--read-surface); padding:8px 0; z-index:3; }
.step-navigation select { min-width:0; flex:1; font:13px/1.5 var(--vscode-font-family,system-ui); padding:6px; background:var(--read-page); color:var(--read-ink); border:1px solid var(--read-border); }
.step-card[hidden] { display:none !important; }
#plan-panel .file-feedback { margin:0; padding:0; }
#plan-panel .plan-notes { display:none; }
#plan-panel[data-inspecting="true"] > .plan-sub { display:none; }
#plan-panel[data-inspecting="true"] > .plan-row:not(.plan-secondary) { display:none; }
#plan-panel .step-body { padding:8px 0; gap:12px; }
#plan-panel .step-top { padding-top:8px; }
#plan-panel .step-caption { display:none; }
#plan-panel .step-body > .plan-row { margin:0 0 8px; }
#plan-panel .step-label { gap:4px; }
#plan-panel .step-card:not(.editing) .step-label[data-field="where"] { display:none; }
#plan-panel .plan-foot { position:static; margin:12px 0 0; padding:8px 0; }
#plan-panel .plan-foot button { font-size:10px; padding:4px 8px; }
.selection-comment { margin:6px 0; padding:8px; background:var(--read-note-bg); border:1px solid var(--read-border); }
.selection-comment textarea { display:block; width:100%; min-height:65px; margin:6px 0; font:13px/1.5 var(--vscode-font-family,system-ui); color:var(--read-ink); background:var(--read-page); }
.saved-comment { margin:4px 0; font-size:12px; white-space:pre-wrap; color:var(--read-muted); }
.step-reading::selection, .plan-source::selection { background:oklch(82% .08 85); color:oklch(20% .01 85); }

.plan-terminal .plan-question { color:var(--read-ink); } .plan-terminal[data-native="true"] > .plan-err, .plan-terminal[data-native="true"] > .plan-busy { display:none; } .step-checks > summary, .step-source > summary, .step-more > summary { cursor:pointer; font-size:12px; color:var(--read-muted); padding:6px 0; }

.ba { grid-template-columns:1fr; }
.snippet-block > summary { cursor:pointer; padding:8px 0; font:600 12px/1.5 ui-monospace,monospace; }
.plan-pseudocode { padding:6px 0; max-width:72ch; }
.plan-pseudocode [hidden] { display:none !important; }
.snippet-block { border-left:3px solid var(--read-border); padding-left:14px; }
.change-add .snippet-block:first-child { border-left-color:var(--plan-add, #388459); }
.change-remove .snippet-block:first-child { border-left-color:var(--plan-remove, #b65c62); }
.change-change .snippet-block:first-child { border-left-color:var(--plan-change, #ab8339); }
.pseudo-expand { margin:8px 0 4px 34px; border:0; border-bottom:1px dotted var(--read-border); padding:4px 0; background:transparent; color:var(--read-accent); font:12px var(--vscode-font-family,system-ui); cursor:pointer; }
.pseudo-notes { margin-top:10px; }
.pseudo-notes > summary { cursor:pointer; color:var(--read-muted); font:12px var(--vscode-font-family,system-ui); padding:6px 0; }
.pseudo-overflow { padding-top:4px; }
.plan-pseudocode .algo-line { display:grid; grid-template-columns:minmax(24px,auto) minmax(0,1fr); gap:10px; padding:7px 0; line-height:1.65; }
.plan-pseudocode .pseudo-body { font:14px/1.65 var(--vscode-font-family,system-ui); white-space:pre-wrap; overflow-wrap:anywhere; }
.plan-pseudocode .note { background:var(--read-note-bg); color:var(--read-muted); margin:8px 0; }
.plan-pseudocode .decision { background:var(--read-hover); }
.pseudo-source { color:var(--read-accent); font:11px ui-monospace,monospace; align-self:start; padding:3px 0; border:0; background:transparent; }
.pseudo-heading { margin:10px 0; font-size:13px; }
.step-card.editing .plan-pseudocode { display:none; }

/* Same quiet dark surface as the planning terminal; only meaningful tokens carry color. */
.snippet-block { border-left:0; padding-left:0; }
.plan-pseudocode { background:var(--read-page); color:var(--read-ink); border:1px solid var(--read-border); padding:0 14px 10px; max-width:78ch; font:13px/1.65 Menlo,Monaco,Consolas,monospace; }
.pseudo-titlebar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:7px 0; margin-bottom:5px; border-bottom:1px solid var(--read-border); color:var(--read-muted); font:11px/1.6 Menlo,monospace; }
.pseudo-titlebar > span { white-space:nowrap; }
.pseudo-file { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--read-muted); border:0; padding:2px 0; font:inherit; }
.plan-pseudocode button:hover { background:var(--read-hover); }
.plan-pseudocode button:focus-visible, .plan-pseudocode summary:focus-visible { outline:2px solid var(--read-link,var(--read-ink)); outline-offset:2px; }
.plan-pseudocode .pseudo-body { font:13px/1.7 Menlo,Monaco,Consolas,monospace; }
.plan-pseudocode .step-number { color:var(--read-muted); }
.plan-pseudocode .keyword { color:#c4a5f3; }
.plan-pseudocode .output { color:#a5dbb6; }
.plan-pseudocode .pseudo-variable { color:var(--read-link,var(--read-ink)); }
.plan-pseudocode .pseudo-function { color:#e6c681; }
.plan-pseudocode .number { color:#f1bc92; }
.plan-pseudocode .string { color:#a9d5b1; }
.plan-pseudocode .comment { color:#a0aebd; }
.plan-pseudocode .important { font-weight:700; text-decoration:none; }
.plan-pseudocode .note { background:var(--read-note-bg); color:var(--read-note-ink); padding:7px; }
.plan-pseudocode .decision { background:transparent; }
.plan-pseudocode .pseudo-heading { color:#c4a5f3; }
.plan-pseudocode .pseudo-notes > summary { color:var(--read-muted); }
.plan-pseudocode .pseudo-expand { color:var(--read-link,var(--read-ink)); border-bottom-color:var(--read-border); }


/* One proposed result: signs keep additions and changes distinct without color. */
.plan-pseudocode.has-diff .algo-line { grid-template-columns:12px minmax(24px,auto) minmax(0,1fr); gap:8px; padding:7px 8px; margin-inline:-8px; }
.plan-pseudocode .diff-add { background:oklch(32% .045 150); }
.plan-pseudocode .diff-change { background:oklch(32% .045 85); }
.pseudo-diff-sign { font-weight:700; user-select:none; -webkit-user-select:none; }
.diff-add .pseudo-diff-sign, .pseudo-diff-legend .diff-add { color:oklch(84% .12 150); }
.diff-change .pseudo-diff-sign, .pseudo-diff-legend .diff-change { color:oklch(87% .12 85); }
.pseudo-diff-legend { display:flex; flex-wrap:wrap; gap:12px; padding:0 0 8px; color:var(--read-muted); font:11px/1.6 Menlo,monospace; }
.plan-pseudocode .diff-key { background:transparent; }

/* Text selection belongs to the reader; reordering belongs to the handle. */
#plan-panel .step-body, #plan-panel .step-reading, #plan-panel .plan-pseudocode, #plan-panel .pseudo-body { user-select:text; -webkit-user-select:text; cursor:text; }
#plan-panel .handle { user-select:none; -webkit-user-select:none; }
.plan-pseudocode ::selection { background:#435976; color:#f0f2f6; }
.selection-comment { cursor:auto; user-select:text; }
.selection-comment > button:first-child { border:1px solid var(--read-border); font-weight:600; }

.plan-files-inline { animation:mini-files-in 160ms ease-out; }
.mini-file-connector { stroke:var(--read-border); stroke-width:1; fill:none; }
.plan-file-mini { cursor:pointer; }
.mini-file-shape { fill:var(--read-surface); stroke:var(--read-border); stroke-width:1; }
.plan-file-mini:hover .mini-file-shape, .plan-file-mini:focus .mini-file-shape { fill:var(--read-hover); stroke:var(--read-ink); }
.mini-file-name { fill:var(--read-ink); font:11px ui-monospace,monospace; pointer-events:none; }
.mini-file-count { fill:var(--read-muted); font:11px ui-monospace,monospace; pointer-events:none; }
.mini-file-accent { fill:var(--read-border); }
.plan-file-mini.change-add .mini-file-accent { fill:var(--plan-add,#388459); } .plan-file-mini.change-remove .mini-file-accent { fill:var(--plan-remove,#b65c62); } .plan-file-mini.change-change .mini-file-accent { fill:var(--plan-change,#ab8339); }
@keyframes mini-files-in { from { opacity:0; } to { opacity:1; } }
.file-changes-overview { display:grid; gap:4px; margin:0 0 14px; max-height:190px; overflow:auto; }
.file-changes-count { color:var(--read-muted); font-size:11px; padding:2px 0 5px; }
.file-change-summary { text-align:left; display:grid; gap:3px; padding:8px 10px; border-left:3px solid var(--read-border); }
.file-change-summary strong { font-size:12px; } .file-change-summary > span { font-size:12px; color:var(--read-muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.file-change-summary[aria-current="true"] { background:var(--read-hover); }
.file-change-summary.change-add { border-left-color:var(--plan-add,#388459); } .file-change-summary.change-remove { border-left-color:var(--plan-remove,#b65c62); } .file-change-summary.change-change { border-left-color:var(--plan-change,#ab8339); }
#plan-panel .step-navigation[hidden] { display:none; }

/* The plan's ideas stay in the same coordinate space as their file and change boxes. */
.plan-idea { cursor:pointer; }
.idea-label { fill:var(--read-muted); font:500 12px/1.5 var(--vscode-font-family,system-ui); }
.primary-idea { font-size:14px; font-weight:650; }
.plan-idea.change-add .idea-label { fill:var(--plan-add,#388459); }
.plan-idea.change-remove .idea-label { fill:var(--plan-remove,#b65c62); }
.plan-idea.change-change .idea-label { fill:var(--plan-change,#ab8339); }
.idea-tether { stroke:var(--read-border); stroke-dasharray:3 4; stroke-width:1; fill:none; opacity:0; pointer-events:none; }
.plan-idea:hover .idea-tether, .plan-idea:focus .idea-tether { opacity:1; }
.plan-idea:hover .idea-label, .plan-idea:focus .idea-label { fill:var(--read-ink); text-decoration:underline; text-underline-offset:4px; }
.idea-more { fill:var(--read-muted); font:11px var(--vscode-font-family,system-ui); cursor:pointer; }
.plan-file-mini[data-active="true"] .mini-file-shape { stroke:var(--read-accent); stroke-width:2; }

body[data-planning="true"] .node .shape { stroke:var(--read-border); }
body[data-planning="true"] .node .shadow { fill:var(--read-border); }
body[data-planning="true"] .node.idea-related .shape { stroke:var(--read-accent); stroke-width:2; }
.idea-hit { fill:var(--read-page); stroke:none; }
.plan-idea .idea-label { font:500 16px var(--vscode-font-family,system-ui); pointer-events:none; }
.plan-idea .primary-idea { font-size:19px; }
.plan-idea[aria-pressed="true"] .idea-label { text-decoration:underline; text-underline-offset:6px; }
.idea-link { stroke:var(--read-muted); stroke-width:1; opacity:.25; pointer-events:none; }
.idea-link.reference-link { stroke-dasharray:4 4; }
.idea-link.hot { stroke:var(--read-accent); stroke-width:2; opacity:.95; }
.idea-link.dim { opacity:.06; }

body[data-planning="true"] { --idea-reuse:light-dark(#276586,#9acbed); --idea-add:light-dark(#2f6d46,#9dd2ad); --idea-change:light-dark(#80601e,#dfc28c); --idea-remove:light-dark(#a63f4b,#e9a3ac); }
body[data-planning="true"] .node .shape { fill:var(--read-surface); }
body[data-planning="true"] .node.selected .shape { fill:var(--read-hover); }
body[data-planning="true"] .node .label, body[data-planning="true"] .node.selected .caption { fill:var(--read-ink); }
body[data-planning="true"] .node.dim, body[data-planning="true"] .plan-idea.dim { opacity:.58; }
.plan-idea.change-add .idea-label { fill:var(--idea-add); }
.plan-idea.change-remove .idea-label { fill:var(--idea-remove); }
.plan-idea.change-change .idea-label { fill:var(--idea-change); }
.plan-idea.idea-reuse .idea-label { fill:var(--idea-reuse); }
body[data-planning="true"] .node.idea-related .shape { stroke:var(--idea-reuse); }
.idea-link.hot { stroke:var(--idea-reuse); }

body[data-planning="true"] .node .label { font-size:15px; }
.plan-file-path { fill:var(--read-muted); font:11px/1.4 ui-monospace,monospace; pointer-events:none; }
body[data-planning="true"] .node .caption { fill:var(--read-muted); font-size:14px; }
body[data-planning="true"] .node.selected .caption { fill:var(--read-muted); }

.plan-idea { cursor:grab; user-select:none; }
.plan-idea:active { cursor:grabbing; }


/* Stable destinations and actions; change colors belong to the proposals. */
body[data-planning="true"] #status:not(.error) { display:none; }
#plan-panel[data-inspecting="true"] .step-card:not(.editing) .step-top { display:none; }
header .top { gap:14px; }
.tabs { gap:3px; padding:3px; border:1px solid var(--read-border); }
.tabs button { border:0; padding:6px 13px; font:600 13px var(--vscode-font-family,system-ui); }
.tabs [aria-selected="true"] { background:var(--read-header); color:var(--read-ink); }
.workspace-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:12px 0 2px; }
.workspace-actions[hidden] { display:none; }
.workspace-actions button { padding:7px 12px; border:1px solid var(--read-border); font:500 12px var(--vscode-font-family,system-ui); }
.workspace-actions .plan-new { background:var(--read-ink); color:var(--read-page); border-color:var(--read-ink); font-weight:600; }
.workspace-actions .workspace-hint { margin-left:auto; font:12px var(--vscode-font-family,system-ui); color:var(--read-muted); }
.workspace-actions .workspace-stop { color:var(--read-ink); border-color:var(--read-ink); }
.workspace-actions button:focus-visible, .tabs button:focus-visible { outline:2px solid var(--read-accent); outline-offset:2px; }
.plan-terminal .plan-ai button { border:1px solid var(--read-border); padding:5px 9px; color:var(--read-ink); }
.plan-terminal .plan-ai { display:flex; gap:7px; flex-wrap:wrap; }
#plan-panel[data-inspecting="true"] { position:fixed; top:12px; bottom:calc(var(--plan-terminal-height,280px) + 28px); max-height:none; display:flex; flex-direction:column; min-height:0; overflow:hidden; border:1px solid var(--read-border); box-shadow:none; z-index:7; }
#plan-panel .plan-detail-content { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:10px 2px 16px; }
#plan-panel .plan-detail-content > .plan-sub, #plan-panel .plan-detail-content > .plan-row:not(.plan-secondary) { display:none; }
#plan-panel .step-body { min-width:0; align-content:start; }
#plan-panel .step-reading { display:block; overflow:visible; max-height:none; }
#plan-panel .step-body > .change-kind { justify-self:start; padding:2px 7px; border:1px solid var(--change-border); background:var(--change-bg); }
.plan-inspector-path { flex-basis:100%; margin:2px 0 6px; color:var(--read-muted); font:11px/1.5 ui-monospace,monospace; overflow-wrap:anywhere; }
#plan-panel[data-inspecting="true"] .plan-head button { padding:6px 10px; font-size:12px; }
#plan-panel[data-inspecting="true"] .plan-head { position:static; flex-shrink:0; flex-wrap:wrap; margin-bottom:0; border-bottom:1px solid var(--read-border); }
#plan-panel .step-navigation { position:static; flex-shrink:0; margin:0; border-bottom:1px solid var(--read-border); padding:8px 0; }
#plan-panel .step-navigation button { border:1px solid var(--read-border); min-width:34px; }
#plan-panel .step-navigation select { font-size:12px; }
#plan-panel .step-body > .plan-row { position:static; padding:0 0 6px; }
#plan-panel .step-body > .plan-row button { padding:6px 10px; font-size:12px; }
@media(max-width:720px) { .workspace-actions .workspace-hint { width:100%; margin-left:0; } header .brand { margin-right:0; } .tabs { flex-shrink:0; } }
.conversation-modes { display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin:0 0 8px; }
.conversation-modes button { background:transparent; color:var(--read-muted); border:1px solid transparent; padding:4px 10px; font:12px/1.5 ui-monospace,monospace; }
.conversation-modes button[aria-pressed="true"] { border-color:var(--read-border); background:var(--read-mark-bg); color:var(--read-ink); }
.conversation-modes button[data-mode="work"][aria-pressed="true"] { border-color:#877952; background:#2b2820; color:#edcf88; }
.conversation-modes button:focus-visible { outline:1px solid var(--read-ink); outline-offset:2px; }
.conversation-modes .conversation-focus { margin-left:auto; border:1px solid var(--read-border); background:var(--read-surface); color:var(--read-ink); font-weight:600; padding:6px 12px; }
.conversation-modes .conversation-focus:hover { background:var(--read-hover); }
.conversation-modes .conversation-focus[aria-pressed="true"] { background:var(--read-mark-bg); border-color:var(--read-border); }
.focus-icon { display:inline-block; font:700 14px ui-monospace,monospace; }
.conversation-modes .conversation-earlier { margin-left:auto; color:var(--read-muted); text-decoration:underline; }
.project-branch { max-width:24ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--read-muted); font:11px/1.5 ui-monospace,monospace; padding:3px 7px; }
.conversation-modes .conversation-handoff { margin-left:auto; border-color:var(--read-border); }
.conversation-linked { color:#a3b7ad; font:11px ui-monospace,monospace; }
body[data-chat-focused="true"] > header { display:none; }
body[data-chat-focused="true"] #canvas, body[data-chat-focused="true"] #drawer, body[data-chat-focused="true"] #search-panel { visibility:hidden; pointer-events:none; }
#plan-panel .plan-terminal[data-focused="true"] { inset:12px; height:auto !important; z-index:12; }
.plan-terminal[data-focused="true"] .terminal-resizer { display:none; }
.conversation-project { display:flex; align-items:center; flex-shrink:0; gap:12px; padding:3px 0 12px; color:var(--read-ink); font:13px/1.4 ui-monospace,monospace; }
.conversation-project .conversation-branch { color:var(--read-muted); font:11px ui-monospace,monospace; background:transparent; border:1px solid var(--read-border); padding:4px 7px; max-width:50%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 ${STAGES_STYLE}
#plan-panel .plan-chatbar { display:flex !important; position:fixed; left:20px; right:20px; bottom:12px; align-items:center; gap:14px; padding:10px 14px; background:var(--read-surface); border:1px solid var(--read-border); z-index:8; font-size:12px; color:var(--read-muted); }
#plan-panel .plan-chatbar .plan-chatbar-text { flex:1; }
#plan-panel:not([data-inspecting="true"]) > .plan-chatbar { display:flex !important; }
body[data-view="stages"] .search, body[data-view="stages"] #rescan { display:none; }
</style></head><body data-palette="${palette}">
<header><div class="top"><span class="brand"><img src="${LOGO}" alt="Pixel gecko samurai"><span class="wordmark">yamori</span></span>
<button id="project-branch" class="project-branch" title="Current Git branch. Local metadata, no AI." hidden></button>
<span class="tabs" role="tablist" aria-label="Yamori navigation"><button id="read-current" title="Read the current script as pseudocode">Read</button><button id="tab-start" role="tab" aria-selected="true" aria-controls="start-view" title="Which files to read first, folder by folder">Files</button><button id="tab-map" role="tab" aria-selected="false" aria-controls="map-view" title="How files connect, grouped by folder">Map</button><button id="tab-stages" role="tab" aria-selected="false" aria-controls="stages-view" title="How the whole project works: its parts, their steps and how they connect. Ask for changes and review them here">System</button><button id="tab-plan" role="tab" aria-selected="false" aria-controls="map-view" title="Chat about your project, plan changes and work with your agent">Chat &amp; plan</button></span>
<form class="search" id="search-form" role="search"><input id="search" type="search" placeholder="Search a name: variable, function, term…" aria-label="Search the project for a variable, function or term" autocomplete="off" spellcheck="false"><button id="search-go" type="submit" title="Highlight every file that mentions it (local, no AI)">Search</button></form>
<span class="spacer"></span>
<button id="rescan" title="Re-read changed files. Local and free; no AI.">Rescan</button><button id="notes" title="Ask your selected AI for a one-line purpose per file, project terms and a reading order">Write AI notes</button></div>
<div id="plan-actions" class="workspace-actions" aria-label="Plan actions" hidden></div>
<p id="status" class="status" role="status">Scanning project…</p><p id="agents" class="status agents"></p></header>
<section id="start-view" class="view" role="tabpanel" aria-labelledby="tab-start"><div class="start-head" id="start-head"></div>
<div class="start-body"><nav id="folders" aria-label="Choose a folder"></nav><div><h1 class="steps-title" id="steps-title">Start here</h1><p class="steps-hint" id="steps-hint"></p><ol id="steps"></ol></div></div></section>
<section id="stages-view" class="view" role="tabpanel" aria-labelledby="tab-stages" hidden></section>
<section id="map-view" class="view" role="tabpanel" aria-labelledby="tab-map" hidden><div class="tools">
<button id="expand-all" title="Show the files inside every folder">Expand all</button><button id="collapse-all" title="Show folders only">Collapse all</button>
<button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button><button id="fit" title="Fit the map to the window">Fit</button><button id="reset" title="Put folders back where Yamori placed them">Reset layout</button><button id="drawer-toggle" aria-expanded="false" aria-controls="drawer" title="Show details: the selected file's purpose, terms, what it uses and what uses it, and all project terms">Details</button>
<span class="hint">Drag folders to arrange · click a folder title to fold it · double-click a file to explain it</span></div>
<div class="stage"><svg id="canvas" tabindex="0" role="application" aria-label="Project map. Drag folders, drag the background to pan, scroll to zoom. Double-click a file to explain it." aria-roledescription="graph">
<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="arrow" d="M0 0 L8 4 L0 8 z"/></marker></defs>
<g id="viewport"><g id="boxes"></g><g id="edges"></g><g id="nodes"></g></g></svg>
<aside id="search-panel" aria-label="Search results" hidden></aside>
<aside id="plan-panel" aria-label="Plan" hidden></aside>
<aside id="drawer" aria-label="Details" hidden><div class="drawer-head"><span class="eyebrow">Details</span><button id="drawer-close" title="Close details" aria-label="Close details">Close ×</button></div><section id="card"></section><section id="glossary"></section></aside></div></section>
<script nonce="${nonce}">${require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vendor', 'katex.min.js'), 'utf8')}</script>
<script nonce="${nonce}">
// All scripts are bundled and nonce-authorized; keep xterm's generated styles
// authorized without enabling unsafe inline styles or rendering project HTML.
(() => { const make = document.createElement.bind(document); document.createElement = (name, ...args) => { const element = make(name, ...args); if (String(name).toLowerCase() === 'style') element.setAttribute('nonce', '${nonce}'); return element; }; })();
</script>
<script nonce="${nonce}">${require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vendor', 'terminal.min.js'), 'utf8')}</script>
<script nonce="${nonce}">
const edgePath = ${edgePath.toString()};
const fitTransform = ${fitTransform.toString()};
const neighbourSet = ${neighbourSet.toString()};
const relativeTime = ${relativeTime.toString()};
const byFolder = ${byFolder.toString()};
const proposalKind = ${proposalKind.toString()};
const planPseudocodeDiff = ${planPseudocodeDiff.toString()};
const planIdeaGraph = ${planIdeaGraph.toString()};
const planFilePathLines = ${planFilePathLines.toString()};
const planFileHeight = ${planFileHeight.toString()};
const planCanvasLayout = ${planCanvasLayout.toString()};
const pseudocodeLines = ${pseudocodeLines.toString()};
const emphasisParts = ${emphasisParts.toString()};
const mathParts = ${mathParts.toString()};
const tokenize = ${tokenize.toString()};
const vscode = acquireVsCodeApi();
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
${stagesClient()}
const stagesView = mountStages(document.getElementById('stages-view'), message => send('stages', { message }));
const SVG = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attrs = {}, text) => { const el = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); if (text !== undefined) el.textContent = text; return el; };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const $ = id => document.getElementById(id);
const canvas = $('canvas'), viewport = $('viewport'), boxLayer = $('boxes'), edgeLayer = $('edges'), nodeLayer = $('nodes');
let state = {}, view = { x: 40, y: 40, k: 1 }, current = 'map', viewToken, focusToken, layoutKey, needsFit = true, query = '', selected, drag, pan;
let positions = new Map(), byId = new Map(), boxes = new Map(), nodeElements = new Map(), boxElements = new Map(), edgeElements = [];
const size = () => ({ width: canvas.clientWidth || 800, height: canvas.clientHeight || 600 });
const fileName = id => id.split('/').at(-1);
let viewReported = false;
function show(name) {
  if (viewReported) send('viewChanged', { view: name });
  const stagesNow = name === 'stages';
  $('tab-stages').setAttribute('aria-selected', String(stagesNow)); $('stages-view').hidden = !stagesNow; document.body.setAttribute('data-view', stagesNow ? 'stages' : '');
  if (stagesNow) {
    if (planMode) { planMode = false; document.body.setAttribute('data-planning', 'false'); needsFit = true; }
    current = 'stages';
    $('tab-start').setAttribute('aria-selected', 'false'); $('tab-map').setAttribute('aria-selected', 'false'); $('tab-plan').setAttribute('aria-selected', 'false');
    if ($('plan-actions')) $('plan-actions').hidden = true;
    $('start-view').hidden = true; $('map-view').hidden = true;
    stagesView.shown();
    return;
  }
  // Plan is the same map with the plan panel beside it.
  const changedMode = planMode !== (name === 'plan');
  planMode = name === 'plan'; if (changedMode) needsFit = true; document.body.setAttribute('data-planning', String(planMode)); current = planMode ? 'map' : name;
  $('tab-start').setAttribute('aria-selected', String(name === 'start')); $('tab-map').setAttribute('aria-selected', String(name === 'map')); $('tab-plan').setAttribute('aria-selected', String(planMode));
  if ($('plan-actions')) $('plan-actions').hidden = !planMode;
  $('start-view').hidden = current !== 'start'; $('map-view').hidden = current !== 'map';
  if (state.map) { hits = planMode ? undefined : searchHits(); if (planMode) showDetails(false); computePlanSets(); drawMap(); drawPlan(); drawSearch(); }
  if (current === 'map' && needsFit) { needsFit = false; fit(true); }
}
// ---- Map ----
function applyView() { viewport.setAttribute('transform', 'translate(' + Math.round(view.x) + ' ' + Math.round(view.y) + ') scale(' + view.k.toFixed(3) + ')'); }
function box(id) { const n = byId.get(id), p = planMode && planCoordinates.has(id) ? planCoordinates.get(id) : positions.get(id); return { x: p.x, y: p.y, w: planMode ? 240 : n.w, h: planMode ? planFileHeight(id) + planFilesHeight(id) : n.h }; }
function fit(readable = false) {
  const { width, height } = size(), usableHeight = planMode ? Math.max(180, height - terminalHeight - 24) : height;
  view = fitTransform(planMode ? [...[...planCoordinates.keys()].map(id => box(id)), ...Object.values(planLayout.ideas)] : [...boxes.values()].map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h })), width, usableHeight);
  // Initial planning view keeps the main affected file readable. Explicit Fit
  // canvas can still zoom out to show every label; panning/zooming stay local.
  if (planMode && readable === true && view.k < 0.75 && planGraph.files.length) {
    const main = [...planGraph.files].sort((a, b) => b.count - a.count)[0], b = box(main.id); view = { k: 0.75, x: width / 2 - (b.x + b.w / 2) * 0.75, y: usableHeight / 2 - (b.y + b.h / 2) * 0.75 };
  }
  applyView();
}
function zoom(factor, cx, cy) {
  const { width, height } = size(), x = cx ?? width / 2, y = cy ?? height / 2, k = Math.max(0.15, Math.min(3, view.k * factor));
  view = { k, x: x - (x - view.x) * k / view.k, y: y - (y - view.y) * k / view.k }; applyView();
}
function center(id) { const b = box(id), { width, height } = size(); view = { ...view, x: width / 2 - (b.x + b.w / 2) * view.k, y: height / 2 - (b.y + b.h / 2) * view.k }; applyView(); }
function drawEdges() {
  for (const item of edgeElements) item.el.setAttribute('d', edgePath(box(item.edge.from), box(item.edge.to)));
  for (const link of planIdeaEdges) { const idea = planLayout.ideas[link.idea], file = box(link.file); link.el.setAttribute('x1', idea.x + idea.w / 2); link.el.setAttribute('y1', idea.y + idea.h / 2); link.el.setAttribute('x2', file.x + file.w / 2); link.el.setAttribute('y2', file.y + planFileHeight(link.file) / 2); }
}
// Search hits by map node: a file's own count, or a folded folder's total.
let hits, shownQuery;
function searchHits() {
  const found = state.search?.hits;
  if (!found) return undefined;
  const counts = new Map(found.map(hit => [hit.file, hit.count]));
  for (const item of byId.values()) {
    if (item.kind !== 'folder') continue;
    const total = found.filter(hit => item.folder === '' || hit.file.startsWith(item.folder + '/')).reduce((sum, hit) => sum + hit.count, 0);
    if (total) counts.set(item.id, total);
  }
  return counts;
}
function highlight(id) {
  if (planMode) { highlightPlanCanvas(id ? { file: id } : planIdeaSelection ? { idea: planIdeaSelection } : planCanvasFile ? { file: planCanvasFile } : undefined); return; }
  const near = id && byId.has(id) ? neighbourSet(state.map?.edges || [], id) : undefined;
  const planned = planActive();
  for (const [key, el] of nodeElements) { el.classList.toggle('dim', near ? !near.has(key) : planned ? !planTouched(key) : !!hits && !hits.has(key)); el.classList.toggle('hit', !!hits && hits.has(key)); }
  for (const item of edgeElements) {
    const inPlan = key => planSets.steps.has(key) || planSets.starting.has(key);
    const hot = near ? item.edge.from === id || item.edge.to === id : planned ? inPlan(item.edge.from) && inPlan(item.edge.to) : !!hits && hits.has(item.edge.from) && hits.has(item.edge.to);
    item.el.classList.toggle('hot', hot); item.el.classList.toggle('dim', (!!near || !!hits || planned) && !hot);
  }
}
function showDetails(open) {
  const drawer = $('drawer'); drawer.hidden = !open;
  $('drawer-toggle').setAttribute('aria-expanded', String(open));
}
// Details open only when someone picks a file, never on a redraw.
function select(id, focusNode, reveal = !!focusNode) {
  const previous = selected;
  selected = byId.has(id) ? id : undefined;
  if (selected && reveal && !planMode) showDetails(true);
  for (const [key, el] of nodeElements) el.classList.toggle('selected', key === selected);
  drawCard(); highlight(selected);
  if (planMode && selected !== previous) { const step = planLocal?.steps.find(step => step.file === selected); if (step) send('planSource', { step: step.id }); drawPlan(); planFocus(selected); }
  if (focusNode && selected) { center(selected); nodeElements.get(selected)?.focus?.(); }
}
let planFilesMenu, planFilesAnchor, planIdeaSelection, planCanvasFile;
let planGraph = { ideas: [], files: [] }, planLayout = { files: {}, ideas: {} }, planIdeaEdges = [], ideaElements = new Map();
function planFilesHeight(id) { return planFilesAnchor === id ? (planLocal?.steps || []).filter(step => step.file === id).length * 48 + 12 : 0; }
function closePlanFiles(redraw = true) {
  const wasOpen = !!planFilesAnchor;
  if (planFilesMenu) { planFilesMenu.hidden = true; planFilesMenu.setAttribute('display', 'none'); }
  planFilesMenu = undefined; planFilesAnchor = undefined;
  if (wasOpen && redraw && planMode) drawMap();
}
function showPlanFiles(anchor) {
  if (!planMode || !planLocal?.steps.length) return;
  const opening = planFilesAnchor !== anchor;
  closePlanFiles(false); planIdeaSelection = undefined; planCanvasFile = opening ? anchor : undefined; select(undefined);
  if (opening && planLocal.steps.some(step => step.file === anchor)) planFilesAnchor = anchor;
  drawMap();
}
function activatePlanFile(id) {
  showPlanFiles(id);
  const steps = planLocal?.steps.filter(step => step.file === id) || [];
  if (!steps.some(step => step.newFile)) send('revealSource', { id, line: steps[0]?.startLine || 1 });
}
function highlightPlanCanvas(focus) {
  const ideaIds = new Set(), fileIds = new Set();
  for (const idea of planGraph.ideas) {
    if (focus?.idea === idea.id || focus?.file && idea.files.includes(focus.file)) {
      ideaIds.add(idea.id); for (const file of idea.files) if (!focus?.file || file === focus.file) fileIds.add(file);
    }
  }
  if (focus?.file) fileIds.add(focus.file);
  for (const [id, element] of nodeElements) { element.classList.toggle('dim', !!focus && !fileIds.has(id)); element.classList.toggle('idea-related', !!focus && fileIds.has(id)); }
  for (const [id, element] of ideaElements) { element.classList.toggle('dim', !!focus && !ideaIds.has(id)); element.setAttribute('aria-pressed', String(planIdeaSelection === id)); }
  for (const link of planIdeaEdges) { const hot = focus?.idea === link.idea || focus?.file === link.file; link.el.classList.toggle('hot', !!hot); link.el.classList.toggle('dim', !!focus && !hot); }
  const idea = planGraph.ideas.find(item => item.id === focus?.idea);
  if (planMode) $('status').textContent = idea ? idea.title + ' · ' + idea.files.length + ' connected files · click this idea again to open its change' : focus?.file ? focus.file + ' · ' + ideaIds.size + ' connected ideas' : planGraph.ideas.length + ' ideas · ' + planGraph.files.length + ' files · select an idea or file to explore';
}
let suppressIdeaClick;
function activatePlanIdea(id, event = {}) {
  event.stopPropagation?.();
  if (event.detail > 0 && suppressIdeaClick?.id === id && Date.now() < suppressIdeaClick.until) return;
  const idea = planGraph.ideas.find(idea => idea.id === id); if (!idea) return;
  if (planIdeaSelection === id) { planFilesAnchor = idea.steps[0].file; navigatePlanStep(idea.steps[0].id); drawMap(); return; }
  planIdeaSelection = id; planCanvasFile = undefined; closePlanFiles(false); select(undefined); drawMap();
}
function rememberIdeaPositions() {
  for (const [id, p] of Object.entries(planLayout.ideas)) planIdeaOffsets.set(id, { x: p.x, y: p.y });
}
function startIdeaDrag(event, id) {
  if (event.button !== undefined && event.button !== 0) return;
  event.stopPropagation?.(); event.preventDefault?.();
  const p = planLayout.ideas[id]; if (!p) return;
  rememberIdeaPositions(); drag = { planIdea: id, startX: event.clientX, startY: event.clientY, x: p.x, y: p.y, moved: false };
  canvas.setPointerCapture?.(event.pointerId);
}
function movePlanIdea(id, x, y) {
  const p = planLayout.ideas[id]; if (!p) return;
  p.x = x; p.y = y; planIdeaOffsets.set(id, { x, y }); ideaElements.get(id)?.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
}
function drawSharedIdeas() {
  for (const idea of planGraph.ideas) {
    const p = planLayout.ideas[idea.id];
    const group = svgNode('g', { class: 'plan-idea change-' + idea.kind + (idea.reuse ? ' idea-reuse' : ''), transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0, role: 'button', 'data-idea': idea.id, 'aria-label': idea.title + ', connected to ' + idea.files.join(', '), 'aria-pressed': String(planIdeaSelection === idea.id) });
    group.append(svgNode('rect', { class: 'idea-hit', width: p.w, height: p.h }));
    const words = idea.title.split(/\\s+/), lines = [''];
    for (const word of words) { if ((lines.at(-1) + ' ' + word).trim().length > 25 && lines.at(-1)) lines.push(''); lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim(); }
    lines.slice(0, 2).forEach((line, index) => group.append(svgNode('text', { class: 'idea-label' + (idea.files.length > 1 ? ' primary-idea' : ''), x: p.w / 2, y: lines.length === 1 ? 33 : 22 + index * 23, 'text-anchor': 'middle' }, line + (index === 1 && lines.length > 2 ? '…' : ''))));
    group.append(svgNode('title', {}, idea.title + '\\n' + idea.files.join(', ') + '\\n' + idea.steps.map(step => step.change).join('\\n')));
    const activate = event => activatePlanIdea(idea.id, event);
    group.addEventListener('pointerdown', event => startIdeaDrag(event, idea.id)); group.addEventListener('click', activate);
    group.addEventListener('dblclick', event => { event.stopPropagation?.(); if (suppressIdeaClick?.id === idea.id && Date.now() < suppressIdeaClick.until) return; navigatePlanStep(idea.steps[0].id); });
    group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); activate(event); } });
    group.addEventListener('pointerenter', () => highlightPlanCanvas({ idea: idea.id })); group.addEventListener('pointerleave', () => highlight(selected));
    nodeLayer.append(group); ideaElements.set(idea.id, group);
    for (const file of idea.files) {
      const el = svgNode('line', { class: 'idea-link' + (!idea.steps.some(step => step.file === file) ? ' reference-link' : '') });
      el.append(svgNode('title', {}, idea.title + (idea.steps.some(step => step.file === file) ? ' changes ' : ' refers to ') + file)); edgeLayer.append(el); planIdeaEdges.push({ idea: idea.id, file, el });
    }
  }
}
function drawPlanFiles(parent, anchor) {
  parent.setAttribute('aria-expanded', String(planFilesAnchor === anchor));
  if (planFilesAnchor !== anchor) return;
  const group = svgNode('g', { class: 'plan-files-inline', 'aria-label': 'Changes in ' + anchor });
  const steps = planLocal.steps.filter(step => step.file === anchor);
  const base = planFileHeight(anchor);
  group.append(svgNode('path', { class: 'mini-file-connector', d: 'M20 ' + base + ' V' + (base + 12 + (steps.length - 1) * 48) }));
  steps.forEach((step, index) => {
    const kind = proposalKind(step), title = step.title;
    const row = svgNode('g', { class: 'plan-file-mini change-' + kind, transform: 'translate(12 ' + (base + 12 + index * 48) + ')', tabindex: 0, role: 'button', 'data-file': anchor, 'data-change': step.id, 'data-active': String(expandedStep === step.id), 'aria-label': title + ', ' + anchor });
    row.append(svgNode('rect', { class: 'mini-file-shape', width: 216, height: 40 }), svgNode('rect', { class: 'mini-file-accent', width: 3, height: 40 }), svgNode('text', { class: 'mini-file-name', x: 12, y: 24 }, title.length > 21 ? title.slice(0, 20) + '…' : title), svgNode('text', { class: 'mini-file-count', x: 204, y: 24, 'text-anchor': 'end' }, String(index + 1)), svgNode('title', {}, title + ' · ' + step.change));
    const choose = event => { event.stopPropagation?.(); closePlanFiles(); navigatePlanStep(step.id); };
    row.addEventListener('pointerdown', event => { event.stopPropagation?.(); });
    row.addEventListener('click', choose);
    row.addEventListener('dblclick', event => event.stopPropagation?.());
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); choose(event); } if (event.key === 'Escape') { event.stopPropagation?.(); closePlanFiles(); } });
    group.append(row);
  });
  parent.append(group); planFilesMenu = group;
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closePlanFiles(); if (planMode && selected && !event.target?.closest?.('input, textarea')) { select(undefined); drawPlan(); } } });
function open(id) { const item = byId.get(id); if (!item) return; if (item.kind === 'folder') send('toggleFolder', { folder: item.folder }); else send('openFile', { id }); }
// Dragging a file or a folder title moves the whole folder box.
function startDrag(event, boxId, target) {
  if (event.button !== undefined && event.button !== 0) return;
  event.stopPropagation?.(); event.preventDefault?.();
  if (planMode && target.file && planCoordinates.has(target.file)) {
    const p = planCoordinates.get(target.file); rememberIdeaPositions();
    const ideas = planGraph.ideas.filter(idea => idea.files.includes(target.file)).map(idea => ({ id: idea.id, ...planLayout.ideas[idea.id], weight: 1 / idea.files.length }));
    drag = { planFile: target.file, target, ideas, startX: event.clientX, startY: event.clientY, x: p.x, y: p.y, moved: false }; canvas.setPointerCapture?.(event.pointerId); return;
  }
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
  for (const id of planSynthetic) if (byId.get(id)?.syntheticPlan) byId.delete(id); planSynthetic.clear();
  if (planMode) {
    planGraph = planIdeaGraph(planLocal, Object.keys(state.cards || {}));
    if (!planGraph.ideas.some(idea => idea.id === planIdeaSelection)) planIdeaSelection = undefined;
    for (const { id } of planGraph.files) if (!byId.has(id)) { byId.set(id, { id, kind: 'file', label: fileName(id), w: 200, h: 64, syntheticPlan: true }); planSynthetic.add(id); }
    planLayout = planCanvasLayout(planGraph, { expanded: planFilesAnchor, offsets: Object.fromEntries(planOffsets), ideaOffsets: Object.fromEntries(planIdeaOffsets) });
  }
  planCoordinates.clear();
  if (planMode) for (const [id, p] of Object.entries(planLayout.files)) planCoordinates.set(id, { x: p.x, y: p.y });
  planIdeaEdges = []; ideaElements = new Map();
  boxLayer.replaceChildren(); edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
  nodeElements = new Map(); boxElements = new Map(); edgeElements = [];
  for (const b of boxes.values()) {
    if (b.collapsed || planMode) continue;
    const g = svgNode('g', { class: 'box' + (b.entry ? ' entry' : ''), transform: 'translate(' + b.x + ' ' + b.y + ')', 'data-folder': b.folder });
    g.append(svgNode('rect', { class: 'frame', width: b.w, height: b.h }));
    const head = svgNode('g', { class: 'head', tabindex: 0, role: 'button', 'aria-label': 'Folder ' + b.label + ', ' + b.count + ' files. Press Enter to fold it.' });
    head.append(svgNode('rect', { class: 'head-bar', width: b.w, height: 26 }), svgNode('text', { class: 'title', x: 10, y: 17 }, '▾ ' + b.label), svgNode('text', { class: 'count', x: b.w - 10, y: 17, 'text-anchor': 'end' }, b.count + (b.count === 1 ? ' file' : ' files')));
    head.append(svgNode('title', {}, 'Drag to move this folder · click to fold it'));
    head.addEventListener('pointerdown', event => startDrag(event, b.id, { fold: b.folder }));
    head.addEventListener('keydown', event => { if (event.key === 'Enter') send('toggleFolder', { folder: b.folder }); });
    g.append(head); boxLayer.append(g); boxElements.set(b.id, g);
  }
  for (const edge of planMode ? [] : state.map?.edges || []) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || (planMode && (!planSets.steps.has(edge.from) || !planSets.steps.has(edge.to)))) continue;
    const el = svgNode('path', { class: 'edge' + (edge.imported ? '' : ' inferred'), 'marker-end': 'url(#arrow)' });
    el.append(svgNode('title', {}, edge.from + ' uses ' + edge.to + (edge.names?.length ? ' · ' + edge.names.join(', ') : '')));
    edgeLayer.append(el); edgeElements.push({ edge, el });
  }
  for (const rawItem of byId.values()) {
    const item = planMode ? { ...rawItem, w: 240, h: planFileHeight(rawItem.id) } : rawItem;
    if (planMode && (item.kind !== 'file' || !planCoordinates.has(item.id))) continue;
    const p = planMode ? planCoordinates.get(item.id) : positions.get(item.id), note = state.cards?.[item.id];
    const fileChanges = planMode ? (planLocal?.steps || []).filter(step => step.file === item.id) : [];
    const kind = proposalKind(fileChanges);
    const classes = ['node', item.kind, planMode ? 'change-' + kind : '', planMode && planLocal?.dismissed.includes(item.id) ? 'rejected' : '', item.entry ? 'entry' : '', item.test ? 'test' : '', planMode && planSets.ripple.has(item.id) && !planSets.steps.has(item.id) ? 'ripple' : '', planMode && (planSets.steps.has(item.id) || planSets.starting.has(item.id)) ? 'planned' : ''].filter(Boolean).join(' ');
    const g = svgNode('g', { class: classes, transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0, role: 'button', 'data-id': item.id,
      'aria-label': (item.kind === 'folder' ? 'Folded folder ' + item.label + ', ' + item.count + ' files' : planMode ? item.id : item.label) + (item.step ? ', reading step ' + item.step : '') + (note?.purpose ? '. ' + note.purpose : '') });
    if ((item.entry || planMode) && item.kind === 'file') g.append(svgNode('rect', { class: 'shadow', x: 3, y: 3, width: item.w, height: item.h }));
    g.append(svgNode('rect', { class: 'shape', width: item.w, height: item.h }));
    if (item.kind === 'folder') {
      g.append(svgNode('text', { class: 'label', x: 12, y: 19 }, '▸ ' + item.label), svgNode('text', { class: 'caption', x: 12, y: 35 }, item.count + ' file' + (item.count === 1 ? '' : 's') + ' · click to unfold'));
    } else g.append(svgNode('text', { class: 'label', x: item.step && !planMode ? 30 : 10, y: planMode ? 25 : item.h / 2 + 4 }, planMode && item.label.length > 23 ? item.label.slice(0, 20) + '…' : item.label));
    if (planMode && item.kind === 'file') {
      const reference = !fileChanges.length;
      const path = svgNode('text', { class: 'plan-file-path', x: 10, y: 43 });
      planFilePathLines(item.id).forEach((line, index) => path.append(svgNode('tspan', { x: 10, dy: index ? 14 : 0 }, line)));
      g.append(path);
      g.append(svgNode('text', { class: 'caption', x: 10, y: item.h - 10 }, fileChanges.some(step => step.newFile) ? '+ New file · ' + fileChanges.length + ' changes' : reference ? 'Referenced · unchanged' : (planFilesAnchor === item.id ? '▴ ' : '▾ ') + fileChanges.length + (fileChanges.length === 1 ? ' change' : ' changes')));
      const numbers = planSets.steps.get(item.id);
      if (numbers) {
        const label = numbers.length > 2 ? numbers.length + ' changes' : numbers.join(','), width = Math.max(18, 10 + label.length * 7), tag = svgNode('g', { class: 'plan-badge', transform: 'translate(-8 -8)' });
        tag.append(svgNode('rect', { width, height: 18 }), svgNode('text', { x: width / 2, y: 13, 'text-anchor': 'middle' }, label), svgNode('title', {}, 'Plan step ' + label)); g.append(tag);
      } else if (planSets.candidates.has(item.id) && !planSets.starting.has(item.id)) {
        const tag = svgNode('g', { class: 'suggest', transform: 'translate(' + (item.w - 10) + ' -8)' });
        tag.append(svgNode('rect', { width: 18, height: 18 }), svgNode('text', { x: 9, y: 13, 'text-anchor': 'middle' }, '?'), svgNode('title', {}, 'Suggested starting file')); g.append(tag);
      }
    }
    const hitCount = hits?.get(item.id);
    if (hitCount) {
      const label = String(hitCount), width = 12 + label.length * 6, tag = svgNode('g', { class: 'hit-count', transform: 'translate(' + (item.w - width / 2) + ' -8)' });
      tag.append(svgNode('rect', { width, height: 16, rx: 0 }), svgNode('text', { x: width / 2, y: 12, 'text-anchor': 'middle' }, label));
      tag.append(svgNode('title', {}, hitCount + ' mention' + (hitCount === 1 ? '' : 's') + ' of ' + state.search.query));
      g.append(tag);
    }
    if (!planMode && item.step && item.kind === 'file') {
      const badge = svgNode('g', { class: 'badge', transform: 'translate(5 ' + (item.h / 2 - 9) + ')' });
      badge.append(svgNode('rect', { width: 18, height: 18 }), svgNode('text', { x: 9, y: 13, 'text-anchor': 'middle' }, String(item.step)));
      g.append(badge);
    }
    g.append(svgNode('title', {}, (item.kind === 'folder' ? item.label : item.id) + (note?.purpose ? ' — ' + note.purpose : '') + (item.kind === 'file' ? planMode ? fileChanges.some(step => step.newFile) ? ' · proposed new file, not created yet' : ' · click to open source in VS Code' : ' · double-click to explain' : '')));
    g.addEventListener('pointerdown', event => startDrag(event, item.group, item.kind === 'folder' ? { fold: item.folder } : { file: item.id }));
    g.addEventListener('dblclick', event => { event.stopPropagation?.(); if (planMode) activatePlanFile(item.id); else open(item.id); });
    g.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault?.(); if (planMode) activatePlanFile(item.id); else open(item.id); } if (event.key === ' ') { event.preventDefault?.(); if (planMode) showPlanFiles(item.id); else select(item.id, false, true); } });
    g.addEventListener('pointerenter', () => { if (!drag && !pan) highlight(item.id); });
    g.addEventListener('pointerleave', () => { if (!drag && !pan) highlight(selected); });
    if (planMode) drawPlanFiles(g, item.id);
    nodeLayer.append(g); nodeElements.set(item.id, g);
  }
  if (planMode) drawSharedIdeas();
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
    drag.moved = true;
    if (drag.planIdea) { movePlanIdea(drag.planIdea, drag.x + dx, drag.y + dy); drawEdges(); }
    else if (drag.planFile) { const p = { x: drag.x + dx, y: drag.y + dy }; planCoordinates.set(drag.planFile, p); planOffsets.set(drag.planFile, p); if (planLayout.files[drag.planFile]) Object.assign(planLayout.files[drag.planFile], p); nodeElements.get(drag.planFile)?.setAttribute('transform', 'translate(' + p.x + ' ' + p.y + ')'); for (const idea of drag.ideas) movePlanIdea(idea.id, idea.x + dx * idea.weight, idea.y + dy * idea.weight); drawEdges(); }
    else moveBox(drag.boxId, dx, dy);
  } else if (pan) {
    pan.moved = pan.moved || Math.abs(event.clientX - pan.startX) + Math.abs(event.clientY - pan.startY) > 3;
    view = { ...view, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }; applyView();
  }
});
function release(event) {
  if (drag) {
    const done = drag; drag = undefined;
    if (event?.type === 'pointercancel') { canvas.releasePointerCapture?.(event.pointerId); return; }
    if (done.planIdea) { suppressIdeaClick = { id: done.planIdea, until: Date.now() + 400 }; if (!done.moved) activatePlanIdea(done.planIdea); }
    else if (done.moved && !done.planFile) { const b = boxes.get(done.boxId); send('saveLayout', { id: done.boxId, x: b.x, y: b.y }); }
    else if (!done.moved && done.target.file) { if (planMode) activatePlanFile(done.target.file); else select(done.target.file, false, true); }
    else if (done.target.fold !== undefined) send('toggleFolder', { folder: done.target.fold });
  } else if (pan) {
    if (!pan.moved) { planIdeaSelection = undefined; planCanvasFile = undefined; closePlanFiles(false); select(undefined); drawMap(); }
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
// ---- Plan ----
// The editable plan lives here (planLocal); the extension keeps and saves it and
// computes impact. A newer revision from the extension replaces it.
let planMode = false, planLocal, planRev = -1, planBaseline = '', planUndo = [], planRedo = [], planSendTimer, planSig = '', pendingGoal = '';
let planSets = { steps: new Map(), starting: new Set(), ripple: new Set(), candidates: new Set() };
const stepCards = new Map();
let expandedStep, editingStep;
let planCanvasKey = '';
const planCoordinates = new Map(), planOffsets = new Map(), planIdeaOffsets = new Map(), planSynthetic = new Set();
const planDisclosures = new Map();
let chatFocused = false;
const planInfo = () => state.plan || {};
function computePlanSets() {
  const info = planInfo(), steps = new Map();
  (planLocal?.steps || []).forEach((step, index) => { if (!steps.has(step.file)) steps.set(step.file, []); steps.get(step.file).push(index + 1); });
  planSets = { steps, starting: new Set(planLocal?.starting || []), ripple: new Set(info.ripple || []), candidates: new Set((info.candidates?.files || []).map(item => item.file)) };
}
const planTouched = id => planSets.steps.has(id) || planSets.starting.has(id) || planSets.ripple.has(id) || planSets.candidates.has(id);
const planActive = () => planMode && (planSets.steps.size || planSets.starting.size || planSets.candidates.size);
function syncPlan(s) {
  const info = s.plan || {};
  if ((info.rev ?? 0) !== planRev) {
    closePlanFiles(false); planIdeaSelection = undefined; planCanvasFile = undefined; planRev = info.rev ?? 0;
    planLocal = info.plan ? JSON.parse(JSON.stringify(info.plan)) : undefined;
    planBaseline = JSON.stringify(planLocal || null); planUndo = []; planRedo = [];
    // A plan that disappears (Start over, or cleared elsewhere) leaves an empty goal box.
    pendingGoal = '';
  }
  computePlanSets();
}
function sendPlan() { clearTimeout(planSendTimer); planSendTimer = setTimeout(() => { if (planLocal) send('planEdit', { plan: planLocal }); }, 350); }
// A finished edit: remember the state before it, save, and refresh the map overlays.
function touchPlan() { planUndo.push(planBaseline); if (planUndo.length > 60) planUndo.shift(); planRedo = []; planBaseline = JSON.stringify(planLocal); sendPlan(); }
function mutatePlan(change) { if (!planLocal) return; change(planLocal); touchPlan(); computePlanSets(); drawPlan(); drawMap(); }
function restorePlan(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(planLocal)); planLocal = JSON.parse(from.pop()); planBaseline = JSON.stringify(planLocal);
  sendPlan(); computePlanSets(); drawPlan(); drawMap();
}
function planSignature() {
  const info = planInfo();
  return JSON.stringify([planRev, info.busy, info.error, info.estimate, (info.candidates?.files || []).length, (info.notes || []).length, (info.ripple || []).length, planMode, selected, Object.keys(info.impact || {}).length, info.snippet, info.ai, info.question, info.activity, planLocal?.messages, info.conversation, info.mode, info.conversationHasMore, info.nativeSession, state.projectName, state.git?.name, state.git?.detached]);
}
const fileLabel = rel => rel.split('/').at(-1) + (rel.includes('/') ? '  ·  ' + rel.split('/').slice(0, -1).join('/') : '');
const tokenText = value => value >= 1000 ? (value / 1000).toFixed(1).replace(/[.]0$/, '') + 'k' : String(value);
function moveStep(from, to) {
  if (!planLocal || from === to || from < 0 || to < 0 || from >= planLocal.steps.length || to >= planLocal.steps.length) return;
  mutatePlan(plan => { const [item] = plan.steps.splice(from, 1); plan.steps.splice(to, 0, item); });
}
function addStep(file) {
  if (!planLocal || !byId.has(file) && !(state.cards && state.cards[file])) return;
  const lines = state.cards?.[file]?.lines || 1;
  mutatePlan(plan => { plan.steps.push({ id: 'n' + Date.now().toString(36) + plan.steps.length, file, startLine: 1, endLine: Math.max(1, lines), title: 'Change ' + fileName(file), change: '', why: '', note: '', status: 'todo', manual: true }); });
}
function toggleStarting(file) {
  if (!planLocal) return;
  mutatePlan(plan => { plan.starting = plan.starting.includes(file) ? plan.starting.filter(item => item !== file) : [...plan.starting, file].slice(0, 30); });
}
function numberInput(value, onChange) {
  const input = node('input', undefined, 'step-field'); input.type = 'number'; input.min = '1'; input.value = String(value);
  input.addEventListener('change', () => onChange(Math.max(1, Math.round(Number(input.value) || 1)))); return input;
}
function saveSelectionComment(id, quote, text) {
  if (!quote.trim() || !text.trim()) return;
  mutatePlan(plan => { const step = plan.steps.find(step => step.id === id); if (step) step.note = (step.note ? step.note + '\\n' : '') + '“' + quote.slice(0, 200) + '” → ' + text.trim().slice(0, 300); });
}
let selectionAction;
function hideSelectionAction() {
  if (!selectionAction || selectionAction.editing) return;
  selectionAction.tool.hidden = true; selectionAction.tool.remove?.(); selectionAction = undefined;
}
document.addEventListener('selectionchange', () => {
  if (!selectionAction || selectionAction.editing) return;
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.toString().trim() !== selectionAction.quote ||
      selection.anchorNode && selectionAction.holder.contains && (!selectionAction.holder.contains(selection.anchorNode) || !selectionAction.holder.contains(selection.focusNode))) hideSelectionAction();
});
function selectionComment(holder, step, event) {
  // Mouseup inside the comment composer must not replace the clicked control.
  if (event?.target?.closest?.('.selection-comment, input, textarea, button, summary')) return;
  const selection = window.getSelection?.();
  if (selection?.anchorNode && holder.contains && (!holder.contains(selection.anchorNode) || !holder.contains(selection.focusNode))) return;
  const quote = selection?.toString().trim();
  if (!quote || quote.length > 2000) { hideSelectionAction(); return; }
  if (selectionAction?.editing) return;
  hideSelectionAction();
  holder.querySelector?.('.selection-comment')?.remove?.();
  const tool = node('div', undefined, 'selection-comment'), button = node('button', 'Add comment');
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => {
    if (selectionAction) selectionAction.editing = true;
    const text = node('textarea'); text.placeholder = 'Comment on “' + quote.slice(0, 60) + '”'; text.setAttribute('aria-label', 'Comment on selected text');
    const save = node('button', 'Save comment'); save.addEventListener('click', () => { if (text.value.trim()) { selectionAction = undefined; saveSelectionComment(step.id, quote, text.value); } });
    const cancel = node('button', 'Cancel'); cancel.addEventListener('click', () => { selectionAction = undefined; tool.hidden = true; tool.remove?.(); });
    tool.replaceChildren(node('p', '“' + quote.slice(0, 150) + '”'), text, save, cancel); text.focus?.();
  });
  tool.append(button); holder.append(tool); selectionAction = { tool, holder, quote, editing: false };
}
function navigatePlanStep(id) {
  const step = planLocal?.steps.find(step => step.id === id); if (!step) return;
  select(step.file, false, true); expandedStep = id; drawPlan(); const scroller = $('plan-panel').querySelector?.('.plan-detail-content') || $('plan-panel'); scroller.scrollTop = 0;
  send('planSource', { step: id });
}
let nativeTerminal, nativeHost, nativeFit, nativeKey = '', nativeMessages = [], planComposer, planInputHistory = 0, planInputDraft = '', terminalDrag;
let terminalHeight = Number(vscode.getState?.()?.terminalHeight) || 280;
function terminalLimits() {
  const top = $('map-view')?.getBoundingClientRect?.().top || 100;
  const max = Math.max(160, (window.innerHeight || 800) - top - 28);
  return { min: Math.min(220, max), max };
}
function sizePlanComposer(goal) {
  if (!goal) return;
  goal.style.height = 'auto';
  goal.style.height = Math.min(Math.max(40, terminalHeight - 160), 180, Math.max(24, goal.scrollHeight || 24)) + 'px';
}
function setTerminalHeight(value, persist = false) {
  const limits = terminalLimits(); terminalHeight = Math.round(Math.max(limits.min, Math.min(limits.max, value)));
  document.documentElement.style.setProperty?.('--plan-terminal-height', terminalHeight + 'px');
  const handle = document.querySelector?.('.terminal-resizer');
  handle?.setAttribute('aria-valuenow', String(terminalHeight)); handle?.setAttribute('aria-valuemin', String(limits.min)); handle?.setAttribute('aria-valuemax', String(limits.max));
  sizePlanComposer(planComposer);
  if (persist) vscode.setState?.({ ...(vscode.getState?.() || {}), terminalHeight });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { try { nativeFit?.fit(); } catch {} });
  return terminalHeight;
}
window.addEventListener('resize', () => setTerminalHeight(terminalHeight));
function terminalResizer() {
  const handle = node('div', undefined, 'terminal-resizer'), limits = terminalLimits();
  handle.setAttribute('role', 'separator'); handle.setAttribute('tabindex', '0'); handle.setAttribute('aria-orientation', 'horizontal'); handle.setAttribute('aria-label', 'Resize planning terminal');
  handle.setAttribute('aria-valuemin', String(limits.min)); handle.setAttribute('aria-valuemax', String(limits.max)); handle.setAttribute('aria-valuenow', String(terminalHeight));
  handle.title = 'Drag up or down to resize. Arrow keys resize; double-click resets.';
  handle.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.(); event.stopPropagation?.(); terminalDrag = { y: event.clientY, height: terminalHeight };
    handle.setPointerCapture?.(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!terminalDrag) return;
    event.preventDefault?.(); event.stopPropagation?.(); handle.setAttribute('aria-valuenow', String(setTerminalHeight(terminalDrag.height + terminalDrag.y - event.clientY)));
  });
  const finish = event => {
    if (!terminalDrag) return;
    const height = event.type === 'pointercancel' ? terminalDrag.height : terminalHeight;
    terminalDrag = undefined; handle.releasePointerCapture?.(event.pointerId); setTerminalHeight(height, event.type !== 'pointercancel'); if (planSignature() !== planSig) drawPlan();
  };
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  handle.addEventListener('dblclick', () => { setTerminalHeight(280, true); });
  handle.addEventListener('keydown', event => {
    const values = { ArrowUp: terminalHeight + 24, ArrowDown: terminalHeight - 24, Home: limits.min, End: limits.max };
    if (values[event.key] === undefined) return;
    event.preventDefault?.(); event.stopPropagation?.(); handle.setAttribute('aria-valuenow', String(setTerminalHeight(values[event.key], true)));
  });
  return handle;
}
const terminalPlain = text => String(text || '').replace(/[\\x00-\\x08\\x0b-\\x1f\\x7f]/g, '').replace(/\\r?\\n/g, '\\r\\n');
function terminalTheme() {
  const style = window.getComputedStyle?.(document.body);
  const color = (key, fallback) => {
    if (!style) return fallback;
    const probe = node('span');
    probe.style.color = style.getPropertyValue(key) || fallback;
    document.body.append(probe);
    const value = window.getComputedStyle(probe).color;
    probe.remove();
    return value.startsWith('rgb') ? value : fallback;
  };
  const light = document.body?.classList?.contains('vscode-light');
  return { background: color('--read-page', light ? '#f9fafb' : '#18191d'),
    foreground: color('--read-ink', light ? '#25282d' : '#e4e5e8') };
}
function attachTerminal(container, messages, info) {
  if (!window.YamoriTerminal) return;
  if (!nativeTerminal) {
    nativeHost = node('div', undefined, 'native-terminal');
    nativeTerminal = new window.YamoriTerminal.Terminal({ fontFamily: 'Menlo, Monaco, Consolas, monospace', fontSize: 13, lineHeight: 1.25, disableStdin: true, cursorBlink: false, cursorInactiveStyle: 'none', scrollback: 3000, allowProposedApi: false, theme: terminalTheme() });
    nativeFit = new window.YamoriTerminal.FitAddon(); nativeTerminal.loadAddon(nativeFit); nativeTerminal.open(nativeHost);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { try { nativeFit.fit(); } catch {} }).observe(nativeHost);
  }
  // The browser edits the prompt; xterm only displays the transcript. It never
  // repaints partially wrapped input or guesses Unicode cursor positions.
  container.insertBefore(nativeHost, container.querySelector?.('.terminal-stream') || container.querySelector?.('.terminal-composer') || null); container.setAttribute('data-native', 'true');
  const key = JSON.stringify([messages, info.error]);
  if (key !== nativeKey) {
    const prefix = nativeMessages.length <= messages.length && nativeMessages.every((message, index) => JSON.stringify(message) === JSON.stringify(messages[index]));
    const start = prefix ? nativeMessages.length : 0;
    nativeKey = key; if (!prefix) nativeTerminal.reset();
    if (!messages.length) nativeTerminal.writeln('Yamori · your project conversation starts here.');
    for (const message of messages.slice(start)) {
      const user = message.role === 'user';
      nativeTerminal.writeln((user ? '\\x1b[1;38;2;154;207;255m❯ You' : '\\x1b[1;38;2;165;226;179m● Yamori') + '\\x1b[0m');
      nativeTerminal.writeln((user ? '\\x1b[38;2;189;220;248m' : '\\x1b[38;2;228;229;232m') + terminalPlain(message.text) + '\\x1b[0m\\r\\n');
    }
    nativeMessages = messages.map(message => ({ ...message }));
    if (info.error) nativeTerminal.writeln('\\x1b[31m' + terminalPlain(info.error) + '\\x1b[0m');
  }
  requestAnimationFrame(() => { try { nativeFit.fit(); } catch {} });
}
// Highlight explicit source names, not arbitrary words in the explanation.
function appendPlanInline(parent, text, step, variables) {
  const functions = new Set(state.cards?.[step.file]?.defs || []);
  for (const part of emphasisParts(text)) {
    const target = part.strong ? node('strong', undefined, 'important') : parent;
    for (const math of mathParts(part.text)) {
      if (math.tex) { appendMath(target, math.text); continue; }
      // Inline code marks name source identifiers, but never executes or renders HTML.
      const chunks = math.text.split(/(\`[^\`\\n]+\`)/g);
      for (const chunk of chunks) {
        if (chunk.startsWith('\`') && chunk.endsWith('\`')) {
          const name = chunk.slice(1, -1), call = functions.has(name) || /\\(/.test(name);
          target.append(node('span', name, call ? 'pseudo-function' : 'pseudo-variable')); continue;
        }
        for (const token of tokenize(chunk)) {
          if (token.kind) { target.append(node('span', token.text, token.kind)); continue; }
          let offset = 0;
          for (const match of token.text.matchAll(/[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*/g)) {
            const name = match[0], tail = token.text.slice(match.index + name.length);
            const call = functions.has(name) || tail.startsWith('(');
            const variable = variables.has(name) || /[a-z]_[a-z]|[a-z][A-Z]|^[A-Z][A-Z_]+$/.test(name);
            if (!call && !variable) continue;
            if (match.index > offset) target.append(document.createTextNode(token.text.slice(offset, match.index)));
            target.append(node('span', name, call ? 'pseudo-function' : 'pseudo-variable')); offset = match.index + name.length;
          }
          if (offset < token.text.length) target.append(document.createTextNode(token.text.slice(offset)));
        }
      }
    }
    if (part.strong) parent.append(target);
  }
}
function renderPlanPseudocode(text, step, showDiff = false) {
  const block = node('div', undefined, 'plan-pseudocode'), overflow = node('div', undefined, 'pseudo-overflow'), notes = node('details', undefined, 'pseudo-notes'); let number = 0, visible = 0, remaining = 0, noteCount = 0;
  const diff = showDiff ? planPseudocodeDiff(text, step) : undefined;
  if (diff) block.classList.add('has-diff');
  const variables = new Set([...String(text || '').matchAll(/\\b([A-Za-z_$][\\w$]*)\\s*(?:←|=(?!=))/g)].map(match => match[1]));
  const titlebar = node('div', undefined, 'pseudo-titlebar');
  const sourceFile = node('button', step.file.split('/').at(-1), 'pseudo-file'); sourceFile.disabled = !!step.newFile; sourceFile.title = 'Open source file'; sourceFile.addEventListener('click', () => send('revealSource', { id: step.file, line: step.startLine || 1 }));
  titlebar.append(node('span', '❯ pseudocode'), sourceFile); block.append(titlebar);
  if (diff) {
    const legend = node('div', undefined, 'pseudo-diff-legend');
    for (const [kind, label] of [['add', '+ Added'], ['change', '~ Changed']]) if (diff.lines.some(line => line.change === kind)) legend.append(node('span', label, 'diff-key diff-' + kind));
    if (diff.removed) legend.append(node('span', diff.removed + (diff.removed === 1 ? ' line removed' : ' lines removed'), 'diff-removed'));
    if (legend.children.length) block.append(legend);
  }
  overflow.hidden = true;
  for (const { text: raw, change } of diff?.lines || String(text || '').split(/\\r?\\n/).map(text => ({ text, change: '' }))) {
    if (!raw.trim()) continue;
    if (/^##\\s/.test(raw)) { if (visible < 5) block.append(node('h4', raw.replace(/^##\\s*/, ''), 'pseudo-heading')); else overflow.append(node('h4', raw.replace(/^##\\s*/, ''), 'pseudo-heading')); continue; }
    const match = raw.match(/^L(\\d+)(?:[–-](\\d+))?\\s+(.*)$/);
    const clean = match ? match[3] : raw;
    const { kind } = pseudocodeLines(clean)[0];
    const row = node('div', undefined, 'algo-line ' + kind + (change ? ' diff-' + change : ''));
    if (diff) { const sign = node('span', change === 'add' ? '+' : change === 'change' ? '~' : '', 'pseudo-diff-sign'); sign.setAttribute('aria-label', change === 'add' ? 'Added line' : change === 'change' ? 'Changed line' : 'Unchanged line'); row.append(sign); }
    const marker = match && !step.newFile ? 'L' + match[1] + (match[2] ? '–' + match[2] : '') : clean.trim() && kind !== 'note' ? String(++number) : '';
    const source = node(match && !step.newFile ? 'button' : 'span', marker, match && !step.newFile ? 'pseudo-source' : 'step-number');
    if (match && !step.newFile) { source.title = 'Open corresponding source'; source.addEventListener('click', () => send('revealSource', { id: step.file, line: Number(match[1]) })); }
    const body = node('span', undefined, 'pseudo-body'); body.style.paddingInlineStart = Math.min(clean.length - clean.trimStart().length, 32) * .5 + 'em';
    appendPlanInline(body, clean.trimStart(), step, variables); row.append(source, body);
    if (kind === 'note') { notes.append(row); noteCount++; }
    else if (visible++ < 5) block.append(row);
    else { overflow.append(row); remaining++; }
  }
  if (remaining) {
    const more = node('button', 'Show ' + remaining + ' more lines', 'pseudo-expand'); more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => { overflow.hidden = !overflow.hidden; more.textContent = overflow.hidden ? 'Show ' + remaining + ' more lines' : 'Show fewer lines'; more.setAttribute('aria-expanded', String(!overflow.hidden)); });
    block.append(overflow, more);
  }
  if (noteCount) { notes.replaceChildren(node('summary', 'Why & context · ' + noteCount + (noteCount === 1 ? ' note' : ' notes')), ...notes.children); block.append(notes); }
  return block;
}
function drawStep(step, index) {
  const info = planInfo(), impact = info.impact?.[step.id];
  const kind = proposalKind(step);
  const card = node('div', undefined, 'step-card change-' + kind + (step.status === 'done' ? ' done' : step.status === 'skipped' ? ' skipped' : '')); card.setAttribute('data-step', step.id); card.setAttribute('data-selected', String(!selected || step.file === selected)); card.draggable = false; card.hidden = !!selected && (step.file !== selected || step.id !== expandedStep); card.classList.toggle('editing', editingStep === step.id);
  stepCards.set(step.id, card);
  card.addEventListener('dragstart', event => { if (!event.target?.closest?.('.handle')) { event.preventDefault?.(); return; } event.dataTransfer?.setData?.('text/plain', String(index)); card.classList.add('dragging'); card._from = index; dragFrom = index; });
  card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragFrom = -1; });
  card.addEventListener('dragover', event => { event.preventDefault?.(); card.classList.add('over'); });
  card.addEventListener('dragleave', () => card.classList.remove('over'));
  card.addEventListener('drop', event => { event.preventDefault?.(); card.classList.remove('over'); if (dragFrom >= 0) moveStep(dragFrom, index); dragFrom = -1; });
  // The inspector already selects one change. A hidden summary must not gate its body.
  const inspecting = !!selected && step.file === selected && step.id === expandedStep;
  const disclosure = node(inspecting ? 'section' : 'details', undefined, 'step-disclosure'); disclosure.open = expandedStep === step.id;
  disclosure.addEventListener('toggle', () => {
    if (disclosure.isConnected === false) return;
    if (!disclosure.open) { if (expandedStep === step.id) expandedStep = ''; return; }
    expandedStep = step.id;
    for (const other of stepCards.values()) { const detail = other.querySelector?.('details'); if (detail && detail !== disclosure) detail.open = false; }
  });
  const top = node(inspecting ? 'div' : 'summary', undefined, 'step-top');
  const handle = node('span', '⠿', 'handle'); handle.draggable = true; handle.title = 'Drag to reorder';
  const title = node('input', undefined, 'step-title'); title.value = step.title; title.setAttribute('aria-label', 'Step ' + (index + 1) + ' title');
  title.readOnly = editingStep !== step.id;
  title.addEventListener('input', () => { step.title = title.value; }); title.addEventListener('change', touchPlan);
  const actions = node('span', undefined, 'step-actions');
  const button = (label, tip, run, disabled) => { const el = node('button', label); el.title = tip; el.setAttribute('aria-label', tip); el.disabled = !!disabled; el.addEventListener('click', run); return el; };
  actions.append(button('↑', 'Move up', () => moveStep(index, index - 1), index === 0), button('↓', 'Move down', () => moveStep(index, index + 1), index === planLocal.steps.length - 1),
    button(step.status === 'done' ? '↺' : '✓', step.status === 'done' ? 'Mark as not done' : 'Mark as done', () => mutatePlan(() => { step.status = step.status === 'done' ? 'todo' : 'done'; })),
    button(step.status === 'skipped' ? '+' : '–', step.status === 'skipped' ? 'Include this step again' : 'Skip this step', () => mutatePlan(() => { step.status = step.status === 'skipped' ? 'todo' : 'skipped'; })),
    button('✕', 'Delete this step', () => mutatePlan(plan => { plan.steps = plan.steps.filter(item => item.id !== step.id); })));
  const caption = node('span', step.file.split('/').at(-1), 'step-caption');
  top.append(handle, node('span', String(index + 1), 'step-num'), title, node('span', step.title, 'step-title-reading'), node('span', '⌄', 'step-chevron'));
  const preview = node('p', step.change || 'Describe the change', 'step-preview');
  const body = node('div', undefined, 'step-body');
  const where = node('div', undefined, 'step-where');
  const file = node('input', undefined, 'step-field'); file.value = step.file; file.setAttribute('list', 'plan-files'); file.setAttribute('aria-label', 'File for step ' + (index + 1));
  file.addEventListener('change', () => { if (byId.has(file.value) || (state.cards && state.cards[file.value])) mutatePlan(() => { step.file = file.value; }); else file.value = step.file; });
  const show = node('button', 'On map'); show.title = 'Find this file on the map'; show.addEventListener('click', () => { if (byId.has(step.file)) select(step.file, true, false); });
  if (step.newFile) where.append(file, node('span', 'New file · no source lines yet'), show);
  else where.append(file, node('span', 'lines'), numberInput(step.startLine, value => mutatePlan(() => { step.startLine = value; if (step.endLine < value) step.endLine = value; })), node('span', '–'), numberInput(step.endLine, value => mutatePlan(() => { step.endLine = Math.max(value, step.startLine); })), show);
  const change = node('textarea', undefined, 'step-field'); change.value = step.change; change.rows = Math.max(5, Math.ceil(step.change.length / 55)); change.placeholder = 'What to change, in plain words'; change.setAttribute('aria-label', 'What to change in step ' + (index + 1));
  change.addEventListener('input', () => { step.change = change.value; }); change.addEventListener('change', touchPlan);
  const why = node('textarea', undefined, 'step-field'); why.rows = 3; why.value = step.why || ''; why.placeholder = 'Why'; why.addEventListener('input', () => { step.why = why.value; }); why.addEventListener('change', touchPlan);
  const note = node('textarea', undefined, 'step-field'); note.value = step.note || ''; note.rows = 1; note.placeholder = 'Your note (kept with the plan)'; note.addEventListener('input', () => { step.note = note.value; }); note.addEventListener('change', touchPlan);
  const chips = node('div', undefined, 'impact');
  if (impact) {
    if (impact.usedBy?.length) { const chip = node('span', 'used by ' + impact.usedBy.length); chip.title = impact.usedBy.map(link => link.file).join(', '); chips.append(chip); }
    if (impact.tests?.length) { const chip = node('span', impact.tests.length + ' test' + (impact.tests.length === 1 ? '' : 's')); chip.title = impact.tests.map(test => test.id).join(', '); chips.append(chip); }
    for (const risk of impact.risk || []) { const chip = node('span', risk, 'risk'); chips.append(chip); }
  }
  const label = (text, control, reading) => { const holder = node('div', undefined, 'step-label'); holder.setAttribute('data-field', text.toLowerCase()); holder.append(node('span', text)); if (control.value !== undefined || reading) holder.append(node('p', reading || control.value || 'No note yet.', 'step-reading')); holder.append(control); holder.addEventListener('mouseup', event => selectionComment(holder, step, event)); holder.addEventListener('keyup', event => { if (event.key === 'Shift') selectionComment(holder, step, event); }); return holder; };
  body.append(node('span', { add: '+ Addition', remove: '− Removal', change: '~ Change / refactor' }[kind], 'change-kind'));
  body.append(label('Where', where, step.file + (step.newFile ? ' · New file' : ' · L' + step.startLine + '–' + step.endLine)), label('Change', change), label('Reason', why));
  if (chips.children.length) { const checks = node('details', undefined, 'step-checks'); checks.append(node('summary', 'Impact & checks'), chips); body.append(checks); }
  if (step.after) {
    const holder = node('div', undefined, 'snippet-block'), area = node('textarea', undefined, 'step-field');
    area.value = step.after; area.rows = Math.min(20, Math.max(6, step.after.split('\\n').length + 1)); area.setAttribute('aria-label', 'Proposed pseudocode');
    area.addEventListener('input', () => { step.after = area.value; }); area.addEventListener('change', touchPlan);
    holder.append(renderPlanPseudocode(step.after, step, true), area);
    holder.addEventListener('mouseup', event => selectionComment(holder, step, event));
    holder.addEventListener('keyup', event => { if (event.key === 'Shift') selectionComment(holder, step, event); });
    body.append(holder);
  }
  const row = node('div', undefined, 'plan-row');
  const detail = node('button', step.after ? 'Regenerate pseudocode' : 'Generate pseudocode'); detail.title = 'Preview this change as pseudocode (small request)'; detail.disabled = !!info.busy; detail.addEventListener('click', () => { flushPlan(); send('planDetail', { id: step.id }); });
  const copy = node('button', 'Copy as prompt'); copy.title = 'Copy only this step as a prompt for Claude Code or Codex'; copy.addEventListener('click', () => { flushPlan(); send('planCopy', { only: index + 1 }); });
  const edit = node('button', editingStep === step.id ? 'Done editing' : 'Edit'); edit.addEventListener('click', () => { editingStep = editingStep === step.id ? undefined : step.id; flushPlan(); drawPlan(); });
  row.append(detail, edit, copy);
  if (info.snippet?.step === step.id) { const source = node('details', undefined, 'step-source'); source.append(node('summary', step.newFile ? 'New file proposal' : 'Current code · L' + step.startLine + '–' + step.endLine), node('pre', info.snippet.text, 'plan-source')); source.addEventListener('mouseup', event => selectionComment(source, step, event)); source.addEventListener('keyup', event => { if (event.key === 'Shift') selectionComment(source, step, event); }); body.append(source); }
  if (step.note) body.append(node('p', step.note, 'saved-comment'));
  const more = node('details', undefined, 'step-more'); more.append(node('summary', 'More actions'), actions); body.append(row, more);
  top.append(caption, preview); disclosure.append(top, body); card.append(disclosure); return card;
}
let dragFrom = -1;
function flushPlan() { clearTimeout(planSendTimer); if (planLocal) send('planEdit', { plan: planLocal }); }
function drawPlan() {
  const panel = $('plan-panel'); if (terminalDrag) return; panel.hidden = !planMode; stepCards.clear();
  planSig = planSignature();
  if (!planMode || terminalDrag) { if (!planMode) document.body.setAttribute('data-chat-focused', 'false'); return; }
  const previousGoal = planComposer, focusedGoal = previousGoal && document.activeElement === previousGoal;
  const caret = focusedGoal ? [previousGoal.selectionStart, previousGoal.selectionEnd, previousGoal.selectionDirection] : undefined;
  if (focusedGoal) pendingGoal = previousGoal.value;
  const scroll = panel.querySelector?.('.plan-detail-content')?.scrollTop ?? panel.scrollTop; const previousTranscript = panel.querySelector?.('.plan-transcript');
  const transcriptAtEnd = !previousTranscript || previousTranscript.scrollHeight - previousTranscript.scrollTop - previousTranscript.clientHeight < 40;
  const transcriptScroll = previousTranscript?.scrollTop || 0; selectionAction = undefined; panel.replaceChildren();
  const info = planInfo(), busy = info.busy, plan = planLocal, hasSteps = !!plan?.steps.length, mode = info.mode || 'plan';
  document.body.setAttribute('data-chat-focused', String(chatFocused));
  if (selected && !plan?.steps.some(step => step.id === expandedStep && step.file === selected)) expandedStep = plan?.steps.find(step => step.file === selected)?.id;
  const head = node('div', undefined, 'plan-head'); head.append(node('h2', selected && planSets.steps.has(selected) ? fileName(selected) : 'Plan'));
  const undo = node('button', 'Undo'); undo.disabled = !planUndo.length; undo.addEventListener('click', () => restorePlan(planUndo, planRedo));
  const redo = node('button', 'Redo'); redo.disabled = !planRedo.length; redo.addEventListener('click', () => restorePlan(planRedo, planUndo));
  const close = node('button', 'Close'); close.setAttribute('aria-label', 'Close plan details'); close.title = 'Close details and return to the canvas'; close.addEventListener('click', () => { expandedStep = undefined; editingStep = undefined; select(undefined); drawPlan(); });
  head.append(undo, redo, close);
  if (selected && planSets.steps.has(selected)) head.append(node('p', selected + (plan.steps.some(step => step.file === selected && step.newFile) ? ' · proposed new file' : ''), 'plan-inspector-path'));
  panel.append(head);
  if (hasSteps && selected) {
    const steps = plan.steps.filter(step => step.file === selected), index = Math.max(0, steps.findIndex(step => step.id === expandedStep));
    const nav = node('div', undefined, 'step-navigation');
    const previous = node('button', '←'); previous.setAttribute('aria-label', 'Previous change'); previous.disabled = index === 0; previous.addEventListener('click', () => navigatePlanStep(steps[index - 1]?.id));
    const picker = node('select'); picker.setAttribute('aria-label', 'Jump to change');
    steps.forEach((step, i) => { const option = node('option', (i + 1) + '. ' + step.title); option.value = step.id; option.selected = i === index; picker.append(option); }); picker.value = steps[index]?.id; picker.addEventListener('change', () => navigatePlanStep(picker.value));
    const next = node('button', '→'); next.setAttribute('aria-label', 'Next change'); next.disabled = index >= steps.length - 1; next.addEventListener('click', () => navigatePlanStep(steps[index + 1]?.id));
    nav.append(previous, picker, next); panel.append(nav);
  }
  const content = node('div', undefined, 'plan-detail-content'); content.setAttribute('tabindex', '0'); content.setAttribute('aria-label', 'Change details'); panel.append(content);
  // The goal.
  const goal = node('textarea'); goal.id = 'plan-goal'; goal.value = pendingGoal; goal.placeholder = mode === 'chat' ? 'Ask anything about this project…' : mode === 'work' ? 'Ask your agent, run tests, or request a change…' : 'Describe a plan or discuss its changes…'; goal.rows = 1; goal.spellcheck = false; goal.wrap = 'soft'; goal.setAttribute('aria-label', 'Goal'); goal.title = 'Enter to send · Shift+Enter for a new line';
  goal.addEventListener('input', () => { pendingGoal = goal.value; planInputHistory = 0; sizePlanComposer(goal); go && (go.disabled = !goal.value.trim() || !!busy && !info.question); }); goal.addEventListener('change', () => { pendingGoal = goal.value; });
  const canvasKey = [...planSets.steps.keys()].join('|');
  if (planMode && canvasKey !== planCanvasKey) { planCanvasKey = canvasKey; fit(); }
  panel.setAttribute('data-ready', String(!!hasSteps)); panel.setAttribute('data-inspecting', String(!!selected && planSets.steps.has(selected)));
  const ai = node('div', undefined, 'plan-ai');
  for (const [label, type] of [[(info.ai?.label || 'Choose AI') + ' ▾', 'planAI'], ['Model: ' + (info.ai?.model || 'default') + ' ▾', 'planModel'], ['Effort: ' + (info.ai?.effort || 'default') + ' ▾', 'planEffort']]) { const pick = node('button', label); pick.setAttribute('aria-label', { planAI: 'Choose planning AI', planModel: 'Choose planning model', planEffort: 'Choose planning effort' }[type]); pick.disabled = !!busy; pick.addEventListener('click', () => send(type)); ai.append(pick); }
  const terminal = node('section', undefined, 'plan-terminal'); terminal.setAttribute('aria-label', 'Project conversation'); terminal.setAttribute('data-focused', String(!!chatFocused)); setTerminalHeight(terminalHeight); terminal.append(terminalResizer());
  const transcript = node('div', undefined, 'plan-transcript'); transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-live', 'polite');
  const history = info.conversation?.length ? info.conversation : plan?.messages?.length ? plan.messages : plan?.goal ? [{ role: 'user', text: plan.goal }, ...(plan.summary ? [{ role: 'assistant', text: plan.summary }] : [])] : [];
  const messages = history.filter(message => message.role !== 'tool' && message.kind !== 'activity');
  for (const message of messages) { const line = node('div', undefined, 'terminal-message'); line.setAttribute('data-role', message.role); line.append(node('span', message.role === 'user' ? 'You' : 'Yamori', 'terminal-speaker'), node('p', message.text)); transcript.append(line); }
  if (!messages.length) transcript.append(node('p', 'Ask about your project, plan a change, or ask your agent to work. This conversation stays with the project.', 'terminal-welcome'));
  const composer = node('div', undefined, 'terminal-composer'); composer.append(node('span', '❯', 'terminal-prompt'), goal);
  const toolbar = node('div', undefined, 'plan-terminal-toolbar');
  const projectHeading = node('div', undefined, 'conversation-project'); projectHeading.append(node('span', 'yamori / ' + (state.projectName || 'Project')));
  if (state.git?.name) { const branch = node('button', '⎇ ' + state.git.name, 'conversation-branch'); branch.title = 'Current Git branch. Local metadata, no AI.'; branch.addEventListener('click', () => send('refreshGit')); projectHeading.append(branch); }
  if (chatFocused) terminal.append(projectHeading);
  const modes = node('div', undefined, 'conversation-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Conversation mode');
  for (const [value, label, tip] of [['chat', 'Chat', 'Read and explain project files. No changes.'], ['plan', 'Plan', 'Discuss and review a plan on the canvas.'], ['work', 'Work', 'Your agent answers questions, runs requested tests and makes requested edits.']]) {
    const choice = node('button', label); choice.setAttribute('aria-pressed', String(mode === value)); choice.setAttribute('data-mode', value); choice.title = tip; choice.disabled = !!busy; choice.addEventListener('click', () => send('projectMode', { mode: value })); modes.append(choice);
  }
  const transfer = node('button', 'Continue from…', 'conversation-handoff'); transfer.title = 'Move an existing Codex or Claude conversation into Yamori, or open this conversation in your agent'; transfer.disabled = !!busy; transfer.addEventListener('click', () => send('handoff')); modes.append(transfer);
  if (info.nativeSession?.linked) { const linked = node('span', '↔ ' + (info.nativeSession.provider === 'claude' ? 'Claude' : 'Codex'), 'conversation-linked'); linked.title = 'Native session ' + info.nativeSession.id + '. External updates sync when you return.'; modes.append(linked); }
  if (info.conversationHasMore) { const earlier = node('button', 'Earlier messages', 'conversation-earlier'); earlier.title = 'Load older messages from this project’s local history'; earlier.addEventListener('click', () => send('conversationEarlier')); modes.append(earlier); }
  const focusChat = node('button', undefined, 'conversation-focus'); focusChat.setAttribute('aria-pressed', String(chatFocused)); focusChat.setAttribute('aria-label', chatFocused ? 'Back to canvas' : 'Focus chat'); const focusIcon = node('span', chatFocused ? '> <' : '< >', 'focus-icon'); focusIcon.setAttribute('aria-hidden', 'true'); focusChat.append(focusIcon, document.createTextNode(chatFocused ? ' Back to canvas' : ' Focus chat')); focusChat.title = chatFocused ? 'Show the project canvas beside this conversation' : 'Give the conversation the whole view'; focusChat.addEventListener('click', () => { chatFocused = !chatFocused; drawPlan(); }); modes.append(focusChat);
  if (chatFocused) { const newPlan = node('button', 'New plan'); newPlan.disabled = !!busy; newPlan.addEventListener('click', () => { clearTimeout(planSendTimer); pendingGoal = ''; planComposer = undefined; send('planClear'); }); modes.append(newPlan); }
  terminal.append(modes);
  const fresh = node('button', '+ New plan', 'plan-new'); fresh.setAttribute('aria-label', 'New plan'); fresh.title = 'Start a fresh plan. The current plan is kept in local history.';
  fresh.addEventListener('click', () => {
    clearTimeout(planSendTimer); pendingGoal = ''; planComposer = undefined; planInputHistory = 0; planInputDraft = ''; nativeKey = '';
    expandedStep = undefined; editingStep = undefined; select(undefined); send('planClear');
    requestAnimationFrame(() => { planComposer?.focus?.(); });
  });
  const actions = $('plan-actions');
  if (actions) {
    actions.hidden = !planMode;
    fresh.disabled = ['implement', 'handoff'].includes(busy?.stage);
    const approve = node('button', busy?.stage === 'implement' ? 'Implementing…' : 'Approve & implement', 'go');
    approve.disabled = !!busy || !!info.question || !plan?.steps.some(step => !['done', 'skipped'].includes(step.status) && !plan.dismissed?.includes(step.file));
    approve.title = 'Allow the selected agent to edit project files and run checks. Clear the plan after successful completion.';
    approve.addEventListener('click', () => { if (!approve.disabled) { flushPlan(); send('planExecute', { id: plan.id }); } });
    const fitButton = node('button', 'Fit canvas'); fitButton.addEventListener('click', fit);
    const copyPlan = node('button', 'Copy plan'); copyPlan.disabled = !hasSteps; copyPlan.addEventListener('click', () => { flushPlan(); send('planCopy', {}); });
    const exportPlan = node('button', 'Export'); exportPlan.disabled = !hasSteps; exportPlan.addEventListener('click', () => { flushPlan(); send('planExport'); });
    const hint = node('span', hasSteps ? plan.steps.length + (plan.steps.length === 1 ? ' change' : ' changes') + ' · click a file to explore' : 'One conversation for this project', 'workspace-hint');
    actions.replaceChildren(...(hasSteps ? [approve] : []), fresh, fitButton, copyPlan, exportPlan, hint);
    if (busy) { const stop = node('button', 'Stop', 'workspace-stop'); stop.addEventListener('click', () => send('planStop')); actions.append(stop); }
  }
  toolbar.append(ai); terminal.append(toolbar, transcript);
  const live = node('div', busy?.reply || '', 'terminal-stream'); live.hidden = !busy?.reply; live.setAttribute('role', 'status'); live.setAttribute('aria-label', 'Agent reply, streaming'); terminal.append(live);
  terminal.append(composer);
  // Chat lives in the VS Code terminal: one agent session that sees what you have
  // open and writes plans onto this canvas. Only a slim bar stays here.
  if (state.terminalChat) {
    const bar = node('section', undefined, 'plan-chatbar'); bar.setAttribute('aria-label', 'Your agent session');
    bar.append(node('span', 'Ask, plan or change things with your agent in the VS Code terminal. It sees what you have open, and plans it saves show up on this canvas.', 'plan-chatbar-text'));
    const open = node('button', state.agentSession ? 'Show chat' : 'Open chat in terminal', 'go'); open.addEventListener('click', () => send('agentSession'));
    bar.append(open); panel.append(bar); document.documentElement.style.setProperty?.('--plan-terminal-height', '56px');
  } else panel.append(terminal);
  const submit = () => { const text = goal.value.trim(); if (!text || busy && !info.question) return; pendingGoal = ''; goal.value = ''; if (info.question) send('planAnswer', { answer: text }); else if (mode === 'plan') send(plan?.goal ? 'planChat' : 'planGoal', plan?.goal ? { text } : { goal: text }); else send('projectMessage', { text, mode }); };
  if (!state.terminalChat) attachTerminal(terminal, messages, info);
  planComposer = goal; sizePlanComposer(goal);
  if (focusedGoal) { goal.focus?.(); if (caret?.[0] !== undefined) goal.setSelectionRange?.(...caret); }
  goal.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault?.(); planInputHistory = 0; planInputDraft = ''; submit(); sizePlanComposer(goal); return; }
    const start = goal.selectionStart ?? goal.value.length, end = goal.selectionEnd ?? goal.value.length;
    if (!event.shiftKey && start === end && (event.key === 'ArrowUp' && start === 0 || event.key === 'ArrowDown' && planInputHistory && end === goal.value.length)) {
      const history = messages.filter(message => message.role === 'user').map(message => message.text);
      if (!history.length) return;
      event.preventDefault?.(); if (!planInputHistory) planInputDraft = goal.value;
      planInputHistory = Math.max(0, Math.min(history.length, planInputHistory + (event.key === 'ArrowUp' ? 1 : -1)));
      goal.value = planInputHistory ? history[history.length - planInputHistory] : planInputDraft; pendingGoal = goal.value;
      sizePlanComposer(goal); goal.setSelectionRange?.(goal.value.length, goal.value.length);
    }
  });

  if (info.question) {
    const popup = node('div', undefined, 'plan-question'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Agent needs your input');
    popup.append(node('h3', 'A question before continuing'), node('p', info.question));
    const answer = node('textarea'); answer.placeholder = 'Your answer'; answer.setAttribute('aria-label', 'Answer the planning question');
    const reply = node('button', 'Answer & continue'); reply.addEventListener('click', () => { if (answer.value.trim()) send('planAnswer', { answer: answer.value }); });
    const cancel = node('button', 'Not now'); cancel.addEventListener('click', () => send('planDismissQuestion'));
    popup.append(answer, reply, cancel); terminal.append(popup);
  }
  const recordedUsage = [], recordedIds = new Set();
  for (const call of [...(plan?.calls || []), ...(info.conversationCalls || [])]) if (call.usage && (!call.id || !recordedIds.has(call.id))) { recordedUsage.push(call.usage); if (call.id) recordedIds.add(call.id); }
  if (!plan && info.lastRun?.usage) recordedUsage.push(info.lastRun.usage);
  const usage = [...recordedUsage, ...(busy?.usage ? [busy.usage] : [])];
  const total = key => usage.reduce((sum, value) => sum + (value[key] || 0), 0);
  const usageLabel = busy?.stage === 'handoff' ? 'Local history · no AI' : usage.length
    ? tokenText(total('input') + total('cacheWrite')) + ' input · ' + tokenText(total('output')) + ' output · ' + tokenText(total('cacheRead')) + ' cached'
    : plan?.tokens?.used || info.questionTokens
      ? tokenText(plan?.tokens?.used || info.questionTokens) + ' tokens used (excludes cached input)'
      : busy?.contextTokens ? '~' + tokenText(busy.contextTokens) + ' context tokens · usage pending'
      : busy ? 'Token usage pending' : 'No token usage reported';
  const usageCounter = node('p', usageLabel, 'plan-usage');
  usageCounter.title = 'Provider-reported tokens for recorded calls, including the active request. Input includes cache writes; cached reads are separate. Context is an estimate, not usage.';
  toolbar.append(usageCounter);
  const status = node('div', undefined, 'plan-live'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  status.append(node('span', info.question ? 'Waiting for your answer' : busy?.text || (info.error ? 'Stopped' : hasSteps ? 'Plan ready' : info.lastRun ? 'Implementation complete' : 'Ready'), 'plan-live-phase'));
  if (busy?.characters) status.append(node('span', tokenText(busy.characters) + ' characters generated', 'plan-live-metric'));
  if (busy?.thinkingTokens) status.append(node('span', '~' + tokenText(busy.thinkingTokens) + ' reasoning tokens', 'plan-live-metric'));
  const activity = [...new Set([...history.filter(message => message.role === 'tool' || message.kind === 'activity').map(message => message.text), ...(info.activity || [])])].filter(item => item !== 'Token usage updated');
  if (busy) planDisclosures.set('activity-running', true);
  else if (planDisclosures.get('activity-running')) {
    planDisclosures.delete('activity-running');
    if (!info.error) planDisclosures.set('activity', false);
  }
  if (activity.length) {
    const trail = node('details', undefined, 'plan-live-trail'); trail.open = planDisclosures.get('activity') || false;
    trail.addEventListener('toggle', () => planDisclosures.set('activity', trail.open));
    trail.append(node('summary', 'Activity')); for (const item of activity.slice(-6)) trail.append(node('p', item)); status.append(trail);
  }
  terminal.append(status);

  let go;
  {
    const row = node('div', undefined, 'plan-row'); go = node('button', mode === 'plan' && !hasSteps ? 'Create plan' : 'Send', 'go'); go.disabled = !goal.value.trim() || !!busy && !info.question; go.title = mode === 'work' ? 'Send to your agent. It can answer questions, run tests and edit files as requested.' : mode === 'chat' ? 'Discuss the project without changing files.' : 'Investigate the project and propose a plan. No code is changed.';
    go.addEventListener('click', submit); row.append(go, node('span', 'Enter to send · Shift+Enter for a new line', 'plan-models')); terminal.append(row);
  }
  if (info.error) { const err = node('div', info.error, 'plan-err'); err.setAttribute('role', 'alert'); terminal.append(err); }
  if (busy) {
    const box = node('div', busy.text, 'plan-busy'); box.setAttribute('role', 'status');
    const stop = node('button', 'Stop'); stop.addEventListener('click', () => send('planStop')); box.append(document.createTextNode(' '), stop); if (busy.contextTokens) box.append(node('p', '~' + tokenText(busy.contextTokens) + ' context tokens (estimate; excludes later lookups)')); if (busy.usage) box.append(node('p', tokenText((busy.usage.input || 0) + (busy.usage.output || 0)) + ' uncached input + output · ' + tokenText(busy.usage.cacheRead || 0) + ' cached input')); if (busy.thinkingTokens) box.append(node('p', '~' + tokenText(busy.thinkingTokens) + ' thinking tokens (provider estimate)')); if (busy.characters) box.append(node('p', tokenText(busy.characters) + ' characters generated')); for (const item of info.activity || []) box.append(node('p', item, 'plan-activity')); terminal.append(box);
  }
  // The file picked on the map.
  if (selected && byId.get(selected)?.kind === 'file') {
    const bar = node('div', undefined, 'sel-bar'); bar.append(node('span', selected, 'path'));
    if (plan) {
      const chosen = plan.starting.includes(selected), stepNumbers = planSets.steps.get(selected);
      const toggle = node('button', chosen ? 'Remove from starting files' : 'Add as starting file'); toggle.addEventListener('click', () => toggleStarting(selected));
      const add = node('button', 'Add as a step'); add.addEventListener('click', () => addStep(selected));
      bar.append(toggle, document.createTextNode(' '), add, document.createTextNode(' '));
      if (stepNumbers) bar.append(node('span', 'In step ' + stepNumbers.join(', ') + '.', 'plan-models'));
    } else bar.append(node('span', 'Write a goal first, then click files to choose starting points.', 'plan-models'));
    const open = node('button', 'Open source'); open.disabled = !!plan?.steps.some(step => step.file === selected && step.newFile); open.addEventListener('click', () => send('revealSource', { id: selected })); bar.append(document.createTextNode(' '), open); content.append(bar);
  }
  let fileFeedback;
  if (hasSteps && selected && plan.steps.some(step => step.file === selected)) {
    const feedback = node('div', undefined, 'file-feedback'), rejected = plan.dismissed.includes(selected);
    const reject = node('button', rejected ? 'Restore file' : 'Reject file'); reject.addEventListener('click', () => mutatePlan(p => { p.dismissed = rejected ? p.dismissed.filter(file => file !== selected) : [...new Set([...p.dismissed, selected])]; p.steps.filter(step => step.file === selected).forEach(step => { step.status = rejected ? 'todo' : 'skipped'; }); }));
    feedback.append(reject); fileFeedback = feedback;
  }
  // Starting points: suggestions and the user's own picks.
  const candidates = info.candidates?.files || [], chosen = plan?.starting || [];
  const contextDetails = node('details', undefined, 'plan-context'); contextDetails.open = planDisclosures.get('context') ?? !hasSteps;
  contextDetails.addEventListener('toggle', () => planDisclosures.set('context', contextDetails.open));
  contextDetails.append(node('summary', 'Starting files' + (chosen.length ? ' · ' + chosen.length : '')));
  const appendContext = el => contextDetails.append(el);
  if (plan && (candidates.length || chosen.length)) {
    appendContext(node('div', 'Starting points · ' + chosen.length + ' chosen', 'plan-sub'));
    appendContext(node('p', info.candidates?.weak && !candidates.some(item => item.score === 0) ? 'Few files match the goal’s words. Click files on the map to choose where to start.' : 'Tick the files to start from, or click files on the map. Fewer files means fewer tokens.', 'plan-models'));
    const rows = [...candidates, ...chosen.filter(rel => !candidates.some(item => item.file === rel)).map(file => ({ file, score: 0, why: ['picked on the map'] }))];
    for (const item of rows) {
      const row = node('div', undefined, 'cand'), box = node('input'); box.type = 'checkbox'; box.checked = chosen.includes(item.file); box.setAttribute('aria-label', 'Start from ' + item.file);
      box.addEventListener('click', event => { event.stopPropagation?.(); toggleStarting(item.file); });
      const text = node('div'); text.append(node('span', fileLabel(item.file), 'path'), node('span', (item.why || []).join(' · '), 'why'));
      row.append(box, text); row.addEventListener('click', () => { if (byId.has(item.file)) select(item.file, true, false); }); appendContext(row);
    }
    if (info.estimate && !hasSteps) appendContext(node('p', 'Drafting sends about ' + tokenText(info.estimate.sent) + ' tokens (pseudocode outlines, no source). The whole files would be about ' + tokenText(info.estimate.whole) + ', ' + info.estimate.percent + '% more.' + (info.estimate.omitted ? ' ' + info.estimate.omitted + ' part' + (info.estimate.omitted === 1 ? '' : 's') + ' cut at the ' + tokenText(info.estimate.budget) + ' budget.' : ''), 'plan-estimate'));
    if (!hasSteps) {
      const route = info.estimate?.route;
      if (route) appendContext(node('p', 'Will draft with ' + (route.first === 'main' ? 'your default model' : 'the quick model') + ': ' + route.reason + '.' + (route.first === 'fast' && info.settings?.mode === 'auto' ? ' If a check rejects the draft, your default model redrafts it once.' : ''), 'plan-estimate'));
      const row = node('div', undefined, 'plan-row'), draft = node('button', 'Draft plan', 'go'); draft.disabled = !chosen.length || !!busy || !plan.goal.trim();
      draft.title = 'Draft the plan with AI. You can edit every step afterwards.';
      draft.addEventListener('click', () => { flushPlan(); send('planDraft'); }); row.append(draft); content.append(contextDetails, row);
    }
  }
  if (hasSteps && chosen.length) content.append(contextDetails);
  // The plan itself.
  if (hasSteps) {
    if (plan.summary) { const summary = node('p', plan.summary, 'plan-summary'); summary.hidden = true; content.append(summary); }
    const models = [];
    if (plan.models?.draft) models.push('Drafted by ' + plan.models.draft + (plan.models.escalated ? ' after the quick draft failed a check' : '') + (plan.models.improved ? ', improved' : ''));
    if (plan.tokens?.sent) models.push((plan.tokens.used ? 'used ' + tokenText(plan.tokens.used) + ' tokens' : 'sent about ' + tokenText(plan.tokens.sent) + ' tokens') + (plan.tokens.whole ? ' vs ' + tokenText(plan.tokens.whole) + ' for whole files' : ''));
    if (models.length) { const line = node('p', models.join(' · '), 'plan-models'); line.title = (plan.calls || []).map(call => call.stage + ': ' + call.model + ' ' + (call.estimated ? '~' : '') + tokenText(call.tokens)).join(' | '); const meta = node('details', undefined, 'plan-meta'); meta.open = planDisclosures.get('meta') || false; meta.addEventListener('toggle', () => planDisclosures.set('meta', meta.open)); meta.append(node('summary', 'Model & usage'), line); content.append(meta); }
    if ((info.notes || []).length) { const notes = node('details', undefined, 'plan-notes'); notes.append(node('summary', 'Checks · ' + info.notes.length)); for (const text of [...new Set(info.notes.map(item => item.text))]) notes.append(node('p', '• ' + text)); content.append(notes); }
    content.append(node('div', 'Steps · ' + plan.steps.length, 'plan-sub'));
    plan.steps.forEach((step, index) => content.append(drawStep(step, index)));
    if (fileFeedback) content.append(fileFeedback);
    const add = node('div', undefined, 'plan-row'), pick = node('input', undefined, 'step-field'); pick.setAttribute('list', 'plan-files'); pick.placeholder = 'Add a step: type a file or click one on the map'; pick.setAttribute('aria-label', 'File for a new step');
    const addButton = node('button', 'Add step'); addButton.addEventListener('click', () => { if (pick.value) addStep(pick.value); });
    add.append(pick, addButton); content.append(add);
    const row = node('div', undefined, 'plan-row plan-secondary'), improve = node('button', 'Improve with default model', 'go'); improve.disabled = !!busy; improve.title = 'Send the plan to your default model to tighten it. Keeps your edits.';
    improve.addEventListener('click', () => { flushPlan(); send('planImprove'); }); row.append(improve); content.append(row);

  }
  // File names for the pickers.
  const list = node('datalist'); list.id = 'plan-files';
  for (const id of byId.keys()) if (byId.get(id).kind === 'file') { const option = node('option'); option.value = id; list.append(option); }
  content.append(list);
  content.scrollTop = scroll;
  transcript.scrollTop = transcriptAtEnd ? transcript.scrollHeight : transcriptScroll;
}
function planFocus(id) {
  const numbers = planSets.steps.get(id); if (!numbers) return;
  const card = stepCards.get(planLocal?.steps[numbers[0] - 1]?.id);
  if (card) { card.setAttribute('data-selected', 'true'); const detail = card.querySelector?.('details'); if (detail) detail.open = true; expandedStep = planLocal?.steps[numbers[0] - 1]?.id; const scroller = $('plan-panel').querySelector?.('.plan-detail-content') || $('plan-panel'); scroller.scrollTop = 0; card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 900); }
}
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
// Text, formulas and **emphasis** exactly as the reader draws them.
function appendText(parent, text) { for (const token of tokenize(text)) parent.append(node('span', token.text, token.kind)); }
function appendMath(parent, text) {
  for (const part of mathParts(text)) {
    if (!part.tex || typeof katex === 'undefined') { appendText(parent, part.text); continue; }
    try {
      const markup = katex.renderToString(part.tex, { output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100, maxSize: 10 });
      parent.append(document.importNode(new DOMParser().parseFromString(markup, 'text/html').querySelector('math'), true));
    } catch { appendText(parent, part.text); }
  }
}
function appendInline(parent, text) {
  for (const part of emphasisParts(text)) { const target = part.strong ? node('strong', undefined, 'important') : parent; appendMath(target, part.text); if (part.strong) parent.append(target); }
}
// The flow as reading blocks: one per stop in a file, lines linked to that file's source.
function flowBlocks(flow) {
  const wrap = node('div', undefined, 'flow-reading');
  flow.sections.forEach((section, index) => {
    const el = node('details', undefined, 'reading-block'); el.open = true;
    const heading = node('summary', undefined, 'section-heading');
    const where = node('button', fileName(section.file) + ' · L' + section.startLine + (section.endLine !== section.startLine ? '–' + section.endLine : ''), 'line');
    where.title = 'Open ' + section.file + ' at line ' + section.startLine;
    where.addEventListener('click', event => { event.preventDefault?.(); send('revealSource', { id: section.file, line: section.startLine }); });
    heading.append(node('span', String(index + 1).padStart(2, '0'), 'block-index'), node('h2', section.title), where);
    heading.addEventListener('pointerenter', () => highlight(section.file)); heading.addEventListener('pointerleave', () => highlight(selected));
    const pre = node('pre'); let number = 0;
    pseudocodeLines(section.pseudocode).forEach(({ text, kind }, lineIndex) => {
      const row = node('span', undefined, 'code-line' + (kind ? ' ' + kind : ''));
      if (kind === 'note' && /^\\s*#\\s*(Context|Why|How|What):/i.test(text)) row.className += ' context-note';
      row.append(node('span', text.trim() && kind !== 'note' ? String(++number) : '', 'step-number'));
      const mapping = section.lineMap?.find(item => item.pseudocodeLine === lineIndex + 1);
      if (mapping) {
        row.className += ' linked'; row.tabIndex = 0; row.setAttribute('role', 'button');
        row.title = fileName(section.file) + ' L' + mapping.startLine + (mapping.endLine !== mapping.startLine ? '–' + mapping.endLine : '') + ' · Click to open the source';
        const go = () => send('revealSource', { id: section.file, line: mapping.startLine });
        row.addEventListener('click', go); row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); go(); } });
        row.addEventListener('pointerenter', () => highlight(section.file)); row.addEventListener('pointerleave', () => highlight(selected));
      }
      const body = node('span', undefined, 'step-body');
      body.style.paddingInlineStart = Math.min(text.length - text.trimStart().length, 40) * .55 + 'em';
      appendInline(body, text.trimStart());
      if (!text) body.append(document.createTextNode(' '));
      row.append(body); pre.append(row);
    });
    el.append(heading, pre); wrap.append(el);
  });
  return wrap;
}
function drawSearch() {
  const panel = $('search-panel'), found = state.search;
  panel.hidden = !found || planMode; panel.replaceChildren();
  if (planMode) return;
  panel.classList.toggle('wide', state.flow?.state === 'done');
  if (!found) return;
  const head = node('div', undefined, 'search-head');
  head.append(node('h2', found.hits.length ? found.hits.length + (found.more ? '+' : '') + ' file' + (found.hits.length === 1 ? '' : 's') + ' mention “' + found.query + '”' : 'No file mentions “' + found.query + '”'));
  const clear = node('button', 'Clear ×'); clear.title = 'Clear the search'; clear.addEventListener('click', () => { $('search').value = ''; send('search', { query: '' }); });
  head.append(clear); panel.append(head);
  if (!found.hits.length) { panel.append(node('p', found.identifier ? 'Names match as whole words, with exact capitals. Check the spelling, or Rescan if the file is new.' : 'Text matches anywhere, ignoring capitals.', 'muted')); return; }
  panel.append(node('p', found.total + ' mention' + (found.total === 1 ? '' : 's') + (found.identifier ? ' as a whole word' : '') + '. Highlighted on the map; hover a file to find it.', 'muted'));
  const flow = state.flow;
  if (!flow || flow.state === 'failed') {
    const go = node('button', 'Explain how “' + found.query + '” flows', 'explain-flow');
    go.title = 'Ask your AI how this name moves through and connects the highlighted files. Sends excerpts around each mention.';
    go.addEventListener('click', () => send('explainFlow')); panel.append(go);
  }
  if (flow) {
    const box = node('section', undefined, 'flow'); box.setAttribute('aria-live', 'polite');
    if (flow.state === 'running') {
      box.append(node('p', 'Tracing “' + flow.query + '” with ' + (flow.provider || 'your AI') + '…'));
      const stop = node('button', 'Stop'); stop.addEventListener('click', () => send('stopFlow')); box.append(stop);
    } else if (flow.state === 'failed') box.append(node('p', 'Could not explain the flow: ' + flow.error));
    else {
      box.append(node('h2', 'How “' + flow.query + '” flows'), node('p', flow.summary), flowBlocks(flow));
      if (flow.caveats) box.append(node('p', flow.caveats, 'muted'));
      box.append(node('p', (flow.cached ? 'Saved flow · no new request' : 'AI-written from the excerpts') + (flow.model ? ' · ' + flow.model : '') + '. Verify against the source.', 'muted'));
    }
    panel.append(box);
  }
  for (const [folder, files] of byFolder(found.hits.map(hit => hit.file))) {
    panel.append(node('div', folder ? folder + '/' : 'project root', 'folder-label'));
    for (const id of files) {
      const hit = found.hits.find(item => item.file === id);
      const row = fileRow(id, [hit.count + ' mention' + (hit.count === 1 ? '' : 's'), hit.defines && 'defines it', hit.test && 'test', state.cards?.[id]?.purpose].filter(Boolean).join(' · '));
      row.addEventListener('pointerenter', () => highlight(id)); row.addEventListener('pointerleave', () => highlight(selected));
      panel.append(row);
      for (const match of hit.matches) {
        const line = node('button', undefined, 'match'); line.append(node('span', String(match.line)), node('code', match.text));
        line.title = 'Open ' + id + ' at line ' + match.line; line.addEventListener('click', () => send('revealSource', { id, line: match.line }));
        panel.append(line);
      }
      if (hit.count > hit.matches.length) panel.append(node('p', '+ ' + (hit.count - hit.matches.length) + ' more in this file', 'muted'));
    }
  }
  if (found.more) panel.append(node('p', found.more + ' more files not listed.', 'muted'));
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
    const number = node('span', String(index + 1), 'step-badge'), body = node('div');
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
    const explain = node('button', 'Explain', 'primary'); explain.title = 'Open this file in Yamori'; explain.addEventListener('click', () => send('openFile', { id: step.id }));
    const source = node('button', 'Open source'); source.addEventListener('click', () => send('revealSource', { id: step.id }));
    const map = node('button', 'Show on map'); map.addEventListener('click', () => focusOnMap(step.id));
    actions.append(explain, source, map); body.append(actions);
    item.append(number, body); list.append(item);
  });
}
function render(s) {
  state = s;
  const branch = $('project-branch'); if (branch) { branch.hidden = !s.git?.name; branch.textContent = s.git?.name ? '⎇ ' + s.git.name : ''; branch.title = (s.git?.root || '') + ' · Current Git branch. Local metadata, no AI.'; branch.onclick = () => send('refreshGit'); }
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  byId = new Map((s.map?.nodes || []).map(item => [item.id, item]));
  positions = new Map((s.map?.nodes || []).map(item => [item.id, { x: item.x, y: item.y }]));
  boxes = new Map((s.map?.boxes || []).map(b => [b.id, { ...b }]));
  const n = s.notes || {};
  $('status').textContent = s.error ? s.error : s.waitingForAI && !s.busy ? 'AI notes start once an AI is connected. ' + (s.files || 0) + ' files · ' + (s.links || 0) + ' links mapped without AI.' : [s.busy || s.notesBusy ? s.progress || 'Working…' : undefined, (s.files || 0) + ' files · ' + (s.links || 0) + ' links', 'scanned ' + relativeTime(s.scannedAt), 'AI notes ' + (n.done || 0) + '/' + (n.total || 0) + (n.outdated ? ' (' + n.outdated + ' outdated)' : ''), s.limited ? 'first ' + s.files + ' files shown' : undefined].filter(Boolean).join(' · ');
  $('status').className = 'status' + (s.error ? ' error' : '');
  // Your own Claude Code and Codex sessions can use this map and its pseudocode.
  const agents = $('agents'); agents.replaceChildren();
  if (s.agents && s.files) {
    if (s.agents.connected) agents.append(node('span', 'Agents: connected'));
    else { agents.append(node('span', 'Your Claude Code and Codex sessions can use this map and its pseudocode.')); const go = node('button', 'Connect agents'); go.title = 'Register the Yamori knowledge server with your own Claude Code and Codex (asks first)'; go.addEventListener('click', () => send('connectAgents')); agents.append(go); }
  }
  const notes = $('notes');
  notes.textContent = s.notesBusy ? 'Stop' : s.waitingForAI ? 'Set up AI' : n.done && (n.done < n.total || n.outdated) ? 'Update AI notes' : n.done ? 'AI notes ✓' : 'Write AI notes';
  notes.disabled = !s.notesBusy && !!s.busy;
  notes.title = s.notesBusy ? 'Stop writing AI notes; finished files are kept' : s.waitingForAI ? 'Install or sign in to Claude or ChatGPT; AI notes then start by themselves' : s.autoNotes ? 'AI notes are written automatically after each scan. Press to write them now (also retries after an error).' : 'Ask your selected AI for a one-line purpose per file, project terms and a reading order';
  $('rescan').disabled = !!s.busy;
  hits = planMode ? undefined : searchHits();
  syncPlan(s);
  // Proposed files live in the plan, not the source graph. Keep their inspector
  // open when source/detail responses rebuild the map.
  if (!byId.has(selected) && !(planMode && planLocal?.steps.some(step => step.file === selected))) selected = undefined;
  // A new result is shown on the map, wherever the search came from.
  let zoomToHits = false;
  if (s.search?.query && s.search.query !== shownQuery) { shownQuery = s.search.query; zoomToHits = true; if (current !== 'map' || planMode) show('map'); }
  if (!s.search) shownQuery = undefined;
  const input = $('search');
  if (document.activeElement !== input) input.value = s.search?.query || '';
  drawStart(); drawMap(); drawGlossary(); drawSearch();
  // The plan panel is rebuilt only when the plan or its context changed, so typing is never interrupted.
  if (planSignature() !== planSig) drawPlan();
  // Refit when the set of folders changes, not when one is folded.
  const key = planMode ? 'plan:' + planGraph.files.map(file => file.id).join('|') : 'map:' + (s.map?.boxes || []).map(b => b.id).join('|');
  if (key !== layoutKey) { layoutKey = key; needsFit = true; }
  if (current === 'map' && needsFit) { needsFit = false; fit(true); }
  // A new search zooms to the files it found.
  if (zoomToHits && hits?.size) {
    const found = [...hits.keys()].filter(id => byId.has(id) && positions.has(id)).map(box);
    if (found.length) { const { width, height } = size(); view = fitTransform(found, width, height, 140); needsFit = false; applyView(); }
  }
  if (s.viewToken && s.viewToken !== viewToken) { viewToken = s.viewToken; show(['map', 'plan', 'stages'].includes(s.view) ? s.view : 'start'); }
  if (s.focusToken && s.focusToken !== focusToken && byId.has(s.focus)) { focusToken = s.focusToken; if (current === 'map' && !planMode) select(s.focus, true); }
}
// Typing searches after a short pause; Enter searches at once. Results show on the map.
let searchTimer;
const runSearch = () => { clearTimeout(searchTimer); const query = $('search').value.trim(); if (query) show('map'); send('search', { query }); };
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
$('search-form').addEventListener('submit', event => { event.preventDefault?.(); runSearch(); });
$('search').addEventListener('keydown', event => { if (event.key === 'Escape') { $('search').value = ''; runSearch(); } });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'f') { event.preventDefault?.(); $('search').focus(); $('search').select?.(); } });
$('tab-start').addEventListener('click', () => { closePlanFiles(); show('start'); });
$('tab-map').addEventListener('click', () => { closePlanFiles(); show('map'); });
$('tab-plan').addEventListener('click', () => show('plan'));
$('tab-stages').addEventListener('click', () => { closePlanFiles(); show('stages'); });
$('read-current')?.addEventListener('click', () => send('readCurrent'));
document.addEventListener('keydown', event => {
  if (!planMode || !(event.metaKey || event.ctrlKey) || event.key !== 'z') return;
  const typing = event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
  if (typing) return;
  event.preventDefault?.(); if (event.shiftKey) restorePlan(planRedo, planUndo); else restorePlan(planUndo, planRedo);
});
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
window.addEventListener('focus', () => send('conversationSync'));
window.addEventListener('message', event => {
  if (event.data?.type === 'map') render(event.data.state);
  else if (event.data?.type === 'stages') stagesView.update(event.data.state);
  else if (event.data?.type === 'agentStream' && state.plan?.busy && typeof event.data.reply === 'string') {
    state.plan.busy.reply = event.data.reply;
    const live = $('plan-panel').querySelector?.('.terminal-stream');
    if (live) { const atEnd = live.scrollHeight - live.scrollTop - live.clientHeight < 40; live.textContent = event.data.reply; live.hidden = !event.data.reply; if (atEnd) live.scrollTop = live.scrollHeight; }
  }
});
showDetails(false);
show('map');
send('ready');
viewReported = true;
</script></body></html>`;
}
module.exports = { mapHTML, edgePath, fitTransform, neighbourSet, relativeTime, byFolder, proposalKind, planPseudocodeDiff, planIdeaGraph, planFilePathLines, planFileHeight, planCanvasLayout };
