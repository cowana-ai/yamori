'use strict';
// Stages inside Yamori's main panel (the project panel's Stages tab).
// The stage graph stays on top; a stage card (and anything opened from it)
// expands below the graph instead of replacing it. Rendering uses only the
// state the extension posts, so opening anything here never calls a model.
const { randomBytes } = require('node:crypto');
const { flowWords } = require('../stages/layers');

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
#stages-view .st-outdated { border-color: var(--st-warn); }
#stages-view .st-outdated b { color: var(--st-warn); }
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
#stages-view .st-flowbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 0; }
#stages-view .st-flowbar input { flex: 0 1 360px; min-width: 220px; font: inherit; font-size: 13px; color: var(--read-ink); background: var(--read-page); border: 1px solid var(--read-border); border-radius: 0; padding: 5px 8px; }
#stages-view .st-flowbar input:focus { outline: 2px solid var(--read-link, var(--read-ink)); outline-offset: 0; }
#stages-view .st-flowbar button { border: 1px solid var(--read-border); min-width: 28px; }
#stages-view mark { background: oklch(80% .15 85 / .45); color: inherit; padding: 0 1px; }
#stages-view .st-node.flowstep.hit { border-color: oklch(80% .15 85); box-shadow: 0 0 0 1px oklch(80% .15 85); }
#stages-view .st-node.flowstep.hit.current { box-shadow: 0 0 0 3px oklch(80% .15 85); }
#stages-view .st-node.flowstep.onpath { border-color: var(--read-link, var(--read-ink)); box-shadow: 0 0 0 1px var(--read-link, var(--read-ink)); }
#stages-view .st-node.flowstep.selected { border-color: var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink), 0 0 0 1px var(--read-ink); }
#stages-view .st-node.flowstep.dim { opacity: .38; }
#stages-view .st-flowhead.dim { opacity: .4; }
#stages-view .st-upgrade { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin: 10px 0; padding: 10px 12px; border: 1px solid oklch(75% .14 75); background: color-mix(in srgb, oklch(75% .14 75) 10%, var(--read-surface)); }
#stages-view .st-tabs { display: flex; gap: 4px; align-items: center; margin: 12px 0 4px; border-bottom: 1px solid var(--read-border); }
#stages-view .st-tabs button { border: 1px solid transparent; border-bottom: 0; padding: 6px 14px; font-size: 13px; }
#stages-view .st-tabs button.on { border-color: var(--read-border); background: var(--read-surface); font-weight: 700; }
#stages-view .st-flowhead { box-sizing: border-box; height: 100%; display: flex; align-items: flex-end; padding-bottom: 4px; font: 700 12px/1.3 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .03em; border-bottom: 3px solid var(--read-border); cursor: pointer; overflow: hidden; }
#stages-view .st-flowhead.on { color: var(--read-link, var(--read-ink)); }
body.vscode-light:not([data-palette="slate"]) #stages-view .st-decision, body[data-palette="paper"] #stages-view .st-decision { color: oklch(45% .12 75); }
#stages-view .st-foot { margin-top: 18px; }
#stages-view { --st-c0: oklch(70% .13 250); --st-c1: oklch(72% .14 150); --st-c2: oklch(75% .14 75); --st-c3: oklch(68% .15 20); --st-c4: oklch(70% .13 300); --st-c5: oklch(74% .11 200); --st-c6: oklch(72% .13 110); }
#stages-view .st-canvas { position: relative; margin: 10px 0 6px; border: 1px solid var(--read-border); background: var(--read-page); background-image: radial-gradient(color-mix(in srgb, var(--read-ink) 12%, transparent) 1px, transparent 1px); background-size: 18px 18px; overflow: hidden; cursor: grab; touch-action: none; }
#stages-view .st-canvas.dragging, #stages-view .st-canvas.moving { cursor: grabbing; }
#stages-view .st-canvas.moving .st-node { pointer-events: none; }
#stages-view .st-movable .st-node { cursor: grab; }
#stages-view .st-svg { width: 100%; height: 100%; display: block; }
#stages-view .st-zoom { position: absolute; right: 8px; top: 8px; display: flex; gap: 4px; }
#stages-view .st-zoom button { min-width: 24px; height: 24px; padding: 0 7px; font-size: 12px; line-height: 22px; border: 1px solid var(--read-border); background: var(--read-page); }
#stages-view .st-zoom { align-items: center; }
#stages-view .st-canvas { resize: vertical; min-height: 180px; }
#stages-view .st-codekind { font: 600 10px/1.4 var(--vscode-editor-font-family, monospace); letter-spacing: .04em; text-transform: uppercase; color: var(--read-muted); margin: 0 0 3px; }
#stages-view .st-codekind.class { color: oklch(72% .13 300); display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; text-transform: none; letter-spacing: 0; }
#stages-view .st-kind-tag { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; opacity: .85; }
#stages-view .st-classname { font: 700 14px/1.3 var(--vscode-editor-font-family, monospace); color: oklch(80% .14 300); background: color-mix(in srgb, oklch(60% .15 300) 18%, transparent); border-radius: 4px; padding: 0 5px; max-width: 100%; overflow-wrap: anywhere; }
#stages-view .st-classname.small { font-size: 11.5px; padding: 0 4px; }
#stages-view .st-codekind.method { color: oklch(72% .1 200); text-transform: none; letter-spacing: 0; font-size: 11px; }
#stages-view .st-built code { color: oklch(80% .14 300); font-weight: 600; }
#stages-view .st-node.flowstep.classbox { border-radius: 10px; border-width: 1.5px; background: color-mix(in srgb, oklch(60% .13 300) 9%, var(--read-surface, var(--read-page))); }
#stages-view .st-node.flowstep.methodbox { border-style: dashed; border-left-style: solid; }
#stages-view .st-measures { position: absolute; left: -10000px; top: 0; visibility: hidden; }
#stages-view .st-measure { position: relative; }
#stages-view .st-measure > .st-node { height: auto; }
#stages-view .st-measure > .st-node.repeat { height: auto; width: calc(100% - 9px); }
#stages-view .st-inside-hint { font-size: 11px; color: oklch(72% .13 300); margin: 4px 0 0; }
#stages-view .st-switch { display: inline-flex; border: 1px solid var(--read-border); }
#stages-view .st-switch button { border: 0; padding: 2px 9px; font-size: 12px; background: transparent; color: var(--read-muted); }
#stages-view .st-switch button.on { background: var(--read-ink); color: var(--read-page); font-weight: 700; }
#stages-view .st-crumbs { font-size: 13px; }
#stages-view .st-node.st-layer { border-radius: 10px; border-width: 1.5px; padding: 9px 12px; gap: 4px; background: color-mix(in srgb, oklch(60% .13 300) 7%, var(--read-surface, var(--read-page))); }
#stages-view .st-node.st-layer.repeat { box-shadow: 4px 4px 0 -1px var(--read-page), 4px 4px 0 0 color-mix(in srgb, oklch(76% .13 85) 60%, transparent), 8px 8px 0 -1px var(--read-page), 8px 8px 0 0 color-mix(in srgb, oklch(76% .13 85) 35%, transparent); width: calc(100% - 9px); height: calc(100% - 9px); overflow: visible; }
#stages-view .st-node.st-layer.selected { border-color: var(--read-ink); box-shadow: 0 0 0 2px var(--read-ink); }
#stages-view .st-node.st-layer.op { border-style: dashed; border-radius: 16px; background: var(--read-page); padding: 5px 12px; }
#stages-view .st-layer-args { font-size: 11px; color: var(--read-muted); overflow-wrap: anywhere; }
#stages-view .st-layer-badge.when { color: oklch(76% .12 240); }
#stages-view .st-layer-badge.loop { color: oklch(76% .13 85); }
#stages-view .st-node.st-layer-merge { border-radius: 999px; border-width: 1.5px; flex-direction: row; align-items: center; justify-content: center; gap: 5px; padding: 4px 8px; background: var(--read-page); }
#stages-view .st-node.st-layer-merge b { font: 700 15px var(--vscode-editor-font-family, monospace); }
#stages-view .st-node.st-layer-merge span { font-size: 11px; color: var(--read-muted); }
#stages-view .st-node.st-layer-merge.selected, #stages-view .st-node.st-layer-end.selected { border-color: var(--read-ink); box-shadow: 0 0 0 2px var(--read-ink); }
#stages-view .st-walk h2 { font-size: 14px; }
#stages-view .st-layer-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; }
#stages-view .st-layer-name { font-size: 11px; color: var(--read-muted); }
#stages-view .st-layer-what { font-size: 12.5px; line-height: 1.4; }
#stages-view .st-opname { font: 600 12px var(--vscode-editor-font-family, monospace); color: oklch(74% .12 200); }
#stages-view .st-layer-badge { font-size: 11px; color: var(--read-muted); }
#stages-view .st-layer-badge.repeat { color: oklch(76% .13 85); font-weight: 600; }
#stages-view .st-layer-badge.shortcut { color: oklch(74% .12 160); }
#stages-view .st-layer-inner { margin-top: 4px; padding: 6px 8px; border: 1px dashed var(--read-border); border-radius: 8px; background: var(--read-page); }
#stages-view .st-layer-inner-head { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--read-muted); margin-bottom: 2px; }
#stages-view .st-layer-row { font-size: 11.5px; padding: 1px 0; }
#stages-view .st-layer-row code { font-size: 10.5px; color: var(--read-muted); }
#stages-view .st-layer-row-what { color: var(--read-muted); font-size: 11px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
#stages-view .st-layer-down { display: block; color: var(--read-muted); font-size: 10px; line-height: 1; }
#stages-view .st-layer-plus { color: oklch(74% .12 160); font-weight: 700; }
#stages-view .st-node.st-layer-end { border-radius: 18px; border-style: dashed; background: var(--read-page); flex-direction: row; align-items: center; gap: 8px; padding: 6px 14px; }
#stages-view .st-built { font-size: 11px; color: var(--read-muted); margin: 4px 0 0; }
#stages-view .st-built code, #stages-view .st-method code { font-size: 11px; color: var(--read-ink); }
#stages-view .st-methods { margin: 6px -4px 2px; border-top: 1px solid color-mix(in srgb, var(--read-border) 70%, transparent); padding-top: 4px; display: grid; gap: 2px; }
#stages-view .st-method { display: block; padding: 3px 6px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: 11.5px; line-height: 1.35; }
#stages-view .st-method span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--read-muted); }
#stages-view .st-method:hover { border-color: var(--read-border); }
#stages-view .st-method.hit { border-color: oklch(80% .15 85); }
#stages-view .st-method.hit.current, #stages-view .st-method.selected { border-color: oklch(80% .15 85); box-shadow: 0 0 0 1px oklch(80% .15 85); }
#stages-view .st-method.onpath { border-color: var(--read-link, var(--read-ink)); }
#stages-view .st-method.dim { opacity: .45; }
#stages-view .st-path-stage { font: 600 10px/1.4 var(--vscode-editor-font-family, monospace); letter-spacing: .04em; text-transform: uppercase; margin: 0 0 3px; }
/* Full view: one thin strip on top (tools left, zoom right) and a slim panel on the right. */
#stages-view .st-canvas.full::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 36px; background: var(--read-page); border-bottom: 1px solid var(--read-border); z-index: 1; }
#stages-view .st-canvas.full .st-zoom { top: 6px; z-index: 3; }
#stages-view .st-full-tools { position: absolute; left: 8px; top: 0; height: 36px; right: 260px; display: flex; align-items: center; z-index: 3; overflow: hidden; }
#stages-view .st-full-tools .st-flowbar { margin: 0; flex-wrap: nowrap; gap: 6px; min-width: 0; }
#stages-view .st-full-tools .st-flowbar > * { flex-shrink: 0; }
#stages-view .st-full-tools .st-flowbar .st-muted { flex-shrink: 1; min-width: 0; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#stages-view .st-full-tools .st-flowbar input { height: 24px; padding: 0 8px; font-size: 12px; flex: 0 1 260px; min-width: 160px; }
#stages-view .st-flowbar button { height: 24px; padding: 0 8px; font-size: 12px; }
#stages-view .st-full-aside { position: absolute; right: 0; top: 36px; bottom: 0; width: min(340px, 34%); overflow: auto; background: var(--read-page); border-left: 1px solid var(--read-border); padding: 10px 12px; cursor: auto; z-index: 2; font-size: 12.5px; }
#stages-view .st-full-aside .st-card, #stages-view .st-full-aside .st-detail { border: 0; margin: 0; padding: 0; background: none; box-shadow: none; }
#stages-view .st-full-aside h2 { font-size: 14px; margin: 0 0 6px; }
#stages-view .st-full-aside .st-chip { white-space: normal; word-break: break-all; text-align: left; }
#stages-view .st-full-aside button:not(.st-link) { height: 24px; padding: 0 8px; font-size: 12px; }
#stages-view .st-full-aside button.st-chip { height: auto; min-height: 24px; padding: 3px 8px; line-height: 1.4; max-width: 100%; }
#stages-view .st-full-aside .st-row { row-gap: 6px; }
#stages-view .st-full-aside, #stages-view .st-full-aside h2, #stages-view .st-full-aside li { overflow-wrap: anywhere; }
#stages-view .st-canvas.full { position: fixed; inset: 0; border: 0; z-index: 50; height: auto; resize: none; box-shadow: 0 8px 40px rgba(0,0,0,.45); background-color: var(--read-page); }
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

// Loose word search over a part's steps, for the search bar in Your System:
// lower case, simple endings dropped ("selection" finds "selects"), one typo
// allowed in longer words, and a few plain verbs that mean the same thing.
function stepSearch() {
  const stem = word => word.length > 4 ? word.replace(/(ations?|ions?|ings?|ers?|ed|es|s)$/, '') || word : word;
  const queryWords = text => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1).map(stem);
  const tokensOf = text => String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  const SAME = [['select', 'pick', 'choose', 'chosen', 'winner'], ['save', 'write', 'store', 'persist'], ['load', 'read', 'open'], ['fetch', 'download', 'scrape', 'get'], ['delete', 'remove', 'drop'], ['retry', 'again', 'repeat'], ['limit', 'cap', 'max', 'most'], ['error', 'fail', 'exception'], ['rank', 'score', 'sort'], ['check', 'validate', 'verify'], ['ask', 'prompt'], ['search', 'find', 'query']].map(group => group.map(stem));
  function near(a, b) {
    if (a === b || b.startsWith(a) || (a.length >= 4 && a.startsWith(b) && b.length >= 4)) return true;
    if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    let edits = 0, i = 0, j = 0;
    while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++edits > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  const close = (word, token) => near(word, token) || SAME.some(group => group.some(other => near(word, other)) && group.some(other => near(other, token)));
  // Items that have the most of the words (at least half), best first.
  function find(items, words, textOf) {
    const scored = items.map((item, order) => {
      const tokens = tokensOf(textOf(item));
      return { item, order, exact: words.filter(word => tokens.some(token => near(word, token))).length, score: words.filter(word => tokens.some(token => close(word, token))).length };
    });
    const best = Math.max(0, ...scored.map(item => item.score));
    if (best < Math.max(1, Math.ceil(words.length / 2))) return [];
    return scored.filter(item => item.score === best).sort((a, b) => b.exact - a.exact || a.order - b.order).map(item => item.item);
  }
  const matches = (text, words) => tokensOf(text).some(token => words.some(word => close(word, token)));
  return { queryWords, find, matches, close, tokensOf };
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
  const finder = stepSearch();
  // Key behaviors, drawn the same way everywhere.
  const KIND = { decides: 'Decides', ai: 'AI', asks: 'Asks you', writes: 'Writes', reads: 'Reads', loops: 'Loops', fallback: 'Fallback', stops: 'Stops on error', limit: 'Limit', other: 'Note' };
  const behaviorChip = (kind, text) => h('span', { class: 'st-kind k-' + kind, title: text || KIND[kind] }, KIND[kind] || kind);
  const chips = details => [...new Set((details || []).map(item => item.kind).filter(kind => kind !== 'other'))].slice(0, 4).map(kind => behaviorChip(kind, (details || []).filter(item => item.kind === kind).map(item => item.text).join('\n')));

  // --- an interactive graph: drag to pan, scroll to zoom, Fit to see it all ---
  function graphView(key, { nodes, edges, width, height, minHeight = 260, maxHeight = 560, label, minZoom = 0.5, aside, toolbar }) {
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
    const place = item => { const r = route(at.get(item.edge.from), at.get(item.edge.to), item.edge); item.path.setAttribute('d', r.d); if (item.text) { item.text.setAttribute('x', r.lx); item.text.setAttribute('y', r.ly); } };
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
      full && !toolbar ? h('b', { class: 'st-full-title' }, label) : undefined,
      Object.keys(saved).length ? act('resetLayout', { key }, 'Reset layout', { title: 'Put the boxes back where Yamori placed them' }) : undefined,
      act('zoom', { key, by: 1.25 }, '+', { title: 'Zoom in' }), act('zoom', { key, by: 0.8 }, '−', { title: 'Zoom out' }), act('fit', { key }, 'Fit', { title: 'See everything' }),
      act('fullGraph', { key }, full ? 'Exit full view' : '⤢ Enlarge', { title: full ? 'Back to the page (Esc)' : 'Fill the whole panel' }),
      full ? undefined : act('hideGraph', { key }, '✕', { title: 'Close this graph' })),
      // In full view, what you clicked shows beside the diagram instead of below it.
      full && aside ? h('div', { class: 'st-full-aside' }, aside) : undefined,
      full && toolbar ? h('div', { class: 'st-full-tools' }, toolbar()) : undefined);
    // Drag the bottom edge to make the graph taller or shorter; the height is kept.
    if (!full && typeof ResizeObserver === 'function') { let first = true; new ResizeObserver(() => { if (first) { first = false; return; } ui.heights[key] = box.clientHeight; }).observe(box); }
    const apply = v => layer.setAttribute('transform', 'translate(' + v.x.toFixed(1) + ' ' + v.y.toFixed(1) + ') scale(' + v.k.toFixed(3) + ')');
    // In full view the strip on top and the side panel cover part of the canvas.
    const area = () => { const w = box.clientWidth || 900, hgt = box.clientHeight || 400, top = full ? 36 : 0, right = full && aside ? Math.min(340, w * 0.34) : 0; return { w: w - right, hgt: hgt - top, top }; };
    const fit = () => {
      const { w, hgt, top } = area();
      // Readable first: never shrink below minZoom; drag or Fit to see the rest.
      const fitK = Math.min(1.1, (w - 40) / Math.max(1, width), (hgt - 50) / Math.max(1, height)), k = Math.max(Math.min(minZoom, 1), fitK);
      ui.views[key] = { k, x: width * k < w ? (w - width * k) / 2 : 20, y: top + (height * k < hgt ? Math.max(16, (hgt - height * k) / 2) : 16), sig: width + 'x' + height };
      apply(ui.views[key]);
    };
    box.fit = () => { const { w, hgt, top } = area(), k = Math.min(1.1, (w - 40) / Math.max(1, width), (hgt - 50) / Math.max(1, height)); ui.views[key] = { k, x: (w - width * k) / 2, y: top + Math.max(16, (hgt - height * k) / 2), sig: width + 'x' + height }; apply(ui.views[key]); };
    const sig = width + 'x' + height + (full ? ':full' : '');
    if (view && view.sig === sig) apply(view); else requestAnimationFrame(() => { fit(); ui.views[key].sig = sig; });
    let drag, moving;
    box.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target.closest?.('.st-full-aside, .st-full-tools')) return;
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
      if (event.target.closest?.('.st-full-aside, .st-full-tools')) return;
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 40 && !event.altKey) { /* a trackpad scroll pans */ const v = ui.views[key] || { x: 0, y: 0, k: 1 }; ui.views[key] = { ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }; apply(ui.views[key]); event.preventDefault(); return; }
      event.preventDefault();
      const v = ui.views[key] || { x: 0, y: 0, k: 1 }, rect = box.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
      const k = Math.max(0.15, Math.min(2.5, v.k * (event.deltaY < 0 ? 1.12 : 0.89)));
      ui.views[key] = { ...v, k, x: px - (px - v.x) * k / v.k, y: py - (py - v.y) * k / v.k }; apply(ui.views[key]);
    }, { passive: false });
    return box;
  }
  // An arrow from the right side of one box to the left side of another; backward arrows loop underneath.
  function route(from, to, edge = {}) {
    if (edge.down) { const x1 = from.x + from.w / 2, y1 = from.y + from.h, x2 = to.x + to.w / 2, y2 = to.y - 3; return { d: 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + y2) / 2 + ' ' + x2 + ' ' + (y1 + y2) / 2 + ' ' + x2 + ' ' + y2, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 }; }
    if (edge.side === 'left') { const x1 = from.x, y1 = from.y + from.h / 2, x2 = to.x - 3, y2 = to.y + to.h / 2, out = edge.out ?? Math.min(x1, x2) - 54; return { d: 'M' + x1 + ' ' + y1 + ' C' + out + ' ' + y1 + ' ' + out + ' ' + y2 + ' ' + x2 + ' ' + y2, lx: out + 10, ly: (y1 + y2) / 2 }; }
    if (edge.side) { const x1 = from.x + from.w, y1 = from.y + from.h / 2, x2 = to.x + to.w + 3, y2 = to.y + to.h / 2, out = edge.out ?? Math.max(x1, x2) + 54; return { d: 'M' + x1 + ' ' + y1 + ' C' + out + ' ' + y1 + ' ' + out + ' ' + y2 + ' ' + x2 + ' ' + y2, lx: out - 10, ly: (y1 + y2) / 2 }; }
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
      part.undescribed && !part.outdated && !state.busy ? h('div', { class: 'st-upgrade' }, h('div', {}, h('b', {}, plural(part.undescribed, 'step') + ' have no description yet.'), ' ', muted('A run stopped before writing them (for example at the daily limit). This only describes them; the stages stay as they are.')),
        go('describeParts', { id: part.id }, 'Describe the missing steps', { disabled: !!state.busy })) : undefined,
      part.outdated && !state.busy ? h('div', { class: 'st-upgrade' }, h('div', {}, h('b', {}, 'This part was mapped before inner steps and key behaviors.'), ' ', muted('Map it again to see what every step calls, its decisions, AI calls and files on the diagram. About 1–2 minutes and a few cents with the cheap model.')),
        go('remapPart', { id: part.id }, 'Map this part again', { disabled: !!state.busy })) : undefined,
      h('div', { class: 'st-tabs', role: 'tablist' },
        act('partTab', { tab: 'flow' }, 'Steps', { role: 'tab', 'aria-selected': String(ui.partTab !== 'files'), class: ui.partTab !== 'files' ? 'on' : '' }),
        act('partTab', { tab: 'files' }, 'Files', { role: 'tab', 'aria-selected': String(ui.partTab === 'files'), class: ui.partTab === 'files' ? 'on' : '' }),
        spacer(), part.outdated ? undefined : link('remapPart', { id: part.id }, 'Map this part again', { title: 'Re-plan the stages; unchanged functions reuse their saved descriptions' })),
      ui.partTab === 'files' ? [filesGraph(part, detail), detail.hidden ? h('p', { class: 'st-muted' }, plural(detail.hidden, 'more file') + ' in ' + detail.folder + ' are not shown.') : undefined] : partFlowView(part),
      stepCard(), fileCard());
  }
  // Files arranged by the part's steps, left to right in the order the work happens:
  // each step's files, then the supporting files they use, then code from other folders.
  function filesGraph(part, detail) {
    const W = 196, H = 62, GX = 64, GY = 12, MAX_SUPPORT = 0, focus = state.card?.id, file = state.file?.file;
    const byStep = new Map(part.stages.map(stage => [stage.id, []])), support = [];
    // A file sits under the step that runs most of its functions (the earlier one on a tie).
    for (const entry of detail.files) {
      const counts = entry.counts || {}, home = part.stages.filter(stage => entry.steps.includes(stage.id)).reduce((best, stage) => !best || (counts[stage.id] || 1) > (counts[best.id] || 1) ? stage : best, undefined);
      (home ? byStep.get(home.id) : support).push(entry);
    }
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
      h('p', { class: 'st-muted st-hint' }, 'Each column is one of this part\'s steps, in the order the work happens; a file sits under the step that runs most of its code, and its color strip shows every step it serves. Click a file to see what it does and what it uses; its links light up.'),
      graphView('part:' + part.id, { nodes: [...headers, ...placed], edges: drawn, width, height, minHeight: 260, maxHeight: 600, minZoom: 0.7, label: 'Files of ' + part.name, aside: state.file ? fileCard() : undefined }));
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
      graphView('shared:' + box.id, { nodes: placed, edges: drawn, width: layout.width, height: layout.height, minHeight: 220, maxHeight: 480, label: 'Files in ' + box.folder, aside: state.file ? fileCard() : undefined }),
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
      stage.steps.length ? h('details', { open: ui.expanded['list:' + stage.id] !== false, data: { expand: 'list:' + stage.id } }, h('summary', {}, 'Every step and behavior in this stage'),
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
  // The whole part as it works: each stage a column, its steps down the column with
  // what they call indented under them, and key behaviors on every box.
  function partFlowView(part) {
    const flow = state.partFlow || [], W = 236, GX = 70, GY = 12, HEAD = 46, graphKey = 'pflow:' + part.id;
    const lines = (text, per) => Math.min(3, Math.ceil(String(text || '').length / per));
    const decisionsOf = step => (step.details || []).filter(item => item.kind === 'decides' || item.kind === 'stops').slice(0, 3);
    const height = step => 38 + (step.kind === 'class' ? 30 + (step.symbol.length > 16 ? 20 : 0) : step.kind === 'method' || step.kind === 'section' ? 17 : 0) + 17 * lines(step.what || step.symbol, 26) + decisionsOf(step).reduce((sum, item) => sum + 4 + 15 * Math.min(2, lines(item.text, 30)), 0) + (step.details?.length ? 24 : 0);
    // Every step once, with its call links: from the part's call tree when known, else from nesting.
    const entries = [];
    flow.forEach(stage => stage.steps.forEach((step, index) => entries.push({ key: 'p:' + stage.id + ':' + index, id: 'n:' + stage.id + ':' + index, ref: step.file + '#' + step.symbol, step, stage })));
    const byRef = new Map(entries.map(entry => [entry.ref, entry]));
    const calls = new Map(), callers = new Map();
    const connect = (from, to) => { if (from === to || !byRef.has(from) || !byRef.has(to)) return; (calls.get(from) || calls.set(from, new Set()).get(from)).add(to); (callers.get(to) || callers.set(to, new Set()).get(to)).add(from); };
    for (const [from, list] of Object.entries(state.partCalls || {})) for (const to of list) connect(from, to);
    for (const entry of entries) if (entry.step.parent) connect(entry.step.parent, entry.ref);
    const walk = (start, next, depth) => { const out = new Set(), queue = [[start, 0]]; while (queue.length) { const [ref, d] = queue.shift(); if (d >= depth) continue; for (const other of next.get(ref) || []) if (!out.has(other) && other !== start) { out.add(other); queue.push([other, d + 1]); } } return out; };
    // What to light up: search hits and the steps that lead to them; a clicked step, what leads to it and what it calls.
    const words = finder.queryWords(ui.flowQuery);
    const hits = words.length ? finder.find(entries, words, entry => [entry.step.what, entry.step.symbol, entry.step.owner, entry.step.kind, fileName(entry.step.file), ...(entry.step.details || []).map(item => item.text + ' ' + (KIND[item.kind] || ''))].join(' ')) : [];
    // The path on screen is built around the box you first clicked (its root);
    // clicking along it only selects another box, so the layout stays put.
    const clicked = entries.find(entry => entry.key === (ui.flowRoot || ui.flowStep));
    const path = new Set();
    // The current match's path: what leads to it and what it does next.
    const current = hits.length ? hits[((ui.flowHit || 0) % hits.length + hits.length) % hits.length] : undefined;
    // A clicked box takes over the trace; matches stay outlined.
    if (current && !clicked) { path.add(current.ref); walk(current.ref, callers, 6).forEach(ref => path.add(ref)); walk(current.ref, calls, 1).forEach(ref => path.add(ref)); }
    if (clicked) { path.add(clicked.ref); walk(clicked.ref, callers, 6).forEach(ref => path.add(ref)); walk(clicked.ref, calls, 3).forEach(ref => path.add(ref)); }
    if (clicked && insideRefOf(clicked.step) && flowModeOf(clicked.step) === 'inside') return insideView(part, clicked, entries, words);
    if (clicked) return pathView(part, clicked, entries.find(entry => entry.key === ui.flowStep) || clicked, entries, calls, callers, walk, height, words);
    const active = !!(clicked || hits.length), hitRefs = new Set(hits.map(hit => hit.ref));
    const lookOf = entry => current?.ref === entry.ref ? 'hit current' : hitRefs.has(entry.ref) ? 'hit' : path.has(entry.ref) ? 'onpath' : active ? 'dim' : '';
    // A method sits inside its class's box when that class is a step of the same stage.
    for (const entry of entries) if (entry.step.kind === 'method') entry.host = entries.find(other => other.stage === entry.stage && other.step.kind === 'class' && other.step.symbol === entry.step.owner && other.step.file === entry.step.file);
    const membersOf = host => entries.filter(entry => entry.host === host);
    const classHeight = (entry, members) => height(entry.step) + (state.partLayers?.[entry.ref] ? 20 : 0) + (state.partBuiltFrom?.[entry.ref] ? 6 + 15 * lines('Built from ' + state.partBuiltFrom[entry.ref].join(' · '), 34) : 0) + (members.length ? 14 + members.reduce((sum, member) => sum + 25 + 15 * Math.min(2, lines(member.step.what, 30)), 0) : 0);
    const nodes = [], edges = [], idOf = ref => { const entry = byRef.get(ref); return entry && (entry.host || entry).id; };
    let previousLast;
    flow.forEach((stage, c) => {
      const x = c * (W + GX), stageLit = !active || stage.steps.some(step => path.has(step.file + '#' + step.symbol));
      nodes.push({ id: 'head:' + stage.id, fixed: true, x, y: 0, w: W, h: HEAD - 8, content: h('div', { class: 'st-flowhead' + (state.card?.id === stage.id ? ' on' : '') + (stageLit ? '' : ' dim'), data: { act: 'openStage', part: part.id, id: state.card?.id === stage.id ? '' : stage.id }, style: 'border-bottom-color:' + stepColor(part.id, stage.id), title: stage.gist || '' }, (c + 1) + '. ' + stage.name) });
      let y = HEAD, lastTop;
      stage.steps.forEach((step, index) => {
        const entry = entries.find(item => item.key === 'p:' + stage.id + ':' + index), indent = (step.depth || 0) * 14;
        if (entry.host) return;
        const members = step.kind === 'class' ? membersOf(entry) : [], h2 = step.kind === 'class' ? classHeight(entry, members) : height(step), color = stepColor(part.id, stage.id);
        // The box's own look; a class box also lights up when one of its methods does.
        const looks = [entry, ...members].map(lookOf), look = ['hit current', 'hit', 'onpath'].find(value => looks.includes(value)) || lookOf(entry);
        nodes.push({ id: entry.id, x: x + indent, y, w: W - indent, h: h2, ref: entry.ref, refs: [entry.ref, ...members.map(member => member.ref)],
          content: step.kind === 'class' ? classBox(entry, members, color, look, lookOf, words) : flowBox(step, entry.key, color, look, words) });
        if (!step.depth) { if (lastTop) edges.push({ from: lastTop, to: entry.id, seq: true }); else if (previousLast) edges.push({ from: previousLast, to: entry.id, seq: true }); lastTop = entry.id; }
        y += h2 + GY;
      });
      previousLast = lastTop;
    });
    for (const entry of entries) if (entry.step.parent && byRef.has(entry.step.parent) && idOf(entry.step.parent) !== idOf(entry.ref)) edges.push({ from: idOf(entry.step.parent), to: idOf(entry.ref), soft: true, from_ref: entry.step.parent, to_ref: entry.ref });
    // A class built from other classes (a model from its layers): a dashed "part of" arrow from each piece.
    // A method box stands for its class when the class itself is not a step.
    const builtFromOf = entry => state.partBuiltFrom?.[entry.ref] || (entry.step.kind === 'method' && !entry.host && !entries.some(other => other.step.kind === 'class' && other.step.symbol === entry.step.owner && other.step.file === entry.step.file) && entries.find(other => other.step.kind === 'method' && other.step.owner === entry.step.owner && !other.host) === entry ? state.partBuiltFrom?.[entry.step.file + '#' + entry.step.owner] : undefined) || [];
    for (const entry of entries) for (const name of builtFromOf(entry)) {
      const piece = entries.find(other => other.step.kind === 'class' && other.step.symbol === name) || entries.find(other => other.step.kind === 'method' && other.step.owner === name && !other.host);
      if (piece && idOf(piece.ref) !== idOf(entry.ref)) edges.push({ from: idOf(piece.ref), to: idOf(entry.ref), soft: true, label: 'part of', has: true, from_ref: piece.ref, to_ref: entry.ref, title: name + ' is part of ' + (entry.step.kind === 'method' ? entry.step.owner : entry.step.symbol) });
    }
    // The path itself: call links between lit steps, drawn bold, even across stages.
    if (active) for (const from of path) for (const to of calls.get(from) || []) if (path.has(to) && idOf(from) !== idOf(to) && !edges.some(edge => edge.from_ref === from && edge.to_ref === to)) edges.push({ from: idOf(from), to: idOf(to), path: true, from_ref: from, to_ref: to, title: byRef.get(from).step.symbol + ' calls ' + byRef.get(to).step.symbol });
    const lit = new Map(nodes.filter(node => node.refs).map(node => [node.id, node.refs.some(ref => path.has(ref))]));
    for (const edge of edges) {
      const both = lit.get(edge.from) && lit.get(edge.to);
      if (active) { edge.hot = both && (edge.path || edge.soft); edge.dim = !both; }
    }
    if (!entries.length) return h('p', { class: 'st-muted' }, 'No steps mapped yet.');
    const width = flow.length * (W + GX) - GX, tall = Math.max(...nodes.map(node => node.y + node.h));
    keepFull(part, graphKey);
    const bar = () => h('div', { class: 'st-flowbar' },
        h('input', { id: 'st-flowsearch', type: 'search', placeholder: 'Find in this part, e.g. angle selection', value: ui.flowQuery || '', 'aria-label': 'Find steps in this part', autocomplete: 'off', spellcheck: 'false' }),
        words.length ? muted(hits.length ? hits.length + (hits.length === 1 ? ' match' : ' matches') + (hits.length > 1 ? ' · ' + (((ui.flowHit || 0) % hits.length + hits.length) % hits.length + 1) + ' of ' + hits.length : '') : 'No match') : muted(ui.full === graphKey ? 'Click a box to trace its path.' : 'Type words from a step, a behavior, a function or a file. Click a box to trace its path.'),
        hits.length > 1 ? [act('flowHit', { by: -1 }, '↑', { title: 'Previous match (Shift+Enter)' }), act('flowHit', { by: 1 }, '↓', { title: 'Next match (Enter)' })] : undefined,
        words.length || clicked ? link('flowClear', {}, 'Clear') : undefined);
    const canvas = graphView(graphKey, { nodes, edges, width, height: tall, minHeight: 360, maxHeight: 760, minZoom: 0.7, label: 'How ' + part.name + ' works', aside: clicked ? flowStepDetail(clicked.step) : undefined, toolbar: bar });
    // Where each box ended up (after any dragging), to jump to a match.
    ui.flowPlaces = { key: graphKey, hits: hits.map(hit => nodes.find(node => node.refs?.includes(hit.ref))).filter(Boolean).map(node => ({ x: node.x, y: node.y, w: node.w, h: node.h })) };
    const picked = clicked?.step;
    return [ui.full === graphKey ? undefined : bar(),
      canvas, picked ? flowStepDetail(picked) : undefined];
  }
  // Moving between a part's whole diagram and a step's path stays in full view.
  function resetInside() { ui.flowMode = ui.flowLayer = ui.walk = undefined; ui.insideTrail = []; }
  function keepFull(part, graphKey) {
    const [kind, id] = String(ui.full || '').split(':');
    if ((kind === 'pflow' || kind === 'ppath' || kind === 'pin') && id === part.id) ui.full = graphKey;
  }
  // A clicked step's path on its own, read left to right: what leads to it,
  // the step, and what it calls, each box labeled with its stage.
  function pathView(part, clicked, selected, entries, calls, callers, walk, height, words) {
    const before = walk(clicked.ref, callers, 6), after = walk(clicked.ref, calls, 2);
    const keep = new Set([...before, clicked.ref, ...after]);
    const list = entries.filter(entry => keep.has(entry.ref));
    const links = [];
    for (const from of keep) for (const to of calls.get(from) || []) if (keep.has(to) && !(after.has(from) && before.has(to))) links.push({ from, to });
    const W = 236, H = 34 + Math.max(...list.map(entry => height(entry.step))), GY = 18;
    const layout = layeredLayout(list.map(entry => ({ id: entry.ref })), links, { width: W, height: H, gapX: 64, gapY: GY });
    // Each box only as tall as its text: restack every column, centered on the tallest.
    const own = new Map(list.map(entry => [entry.ref, 34 + height(entry.step)])), columns = new Map();
    for (const entry of list) { const at = layout.positions.get(entry.ref); (columns.get(at.x) || columns.set(at.x, []).get(at.x)).push(entry.ref); }
    const totals = new Map([...columns].map(([x, refs]) => [x, refs.reduce((sum, ref) => sum + own.get(ref) + GY, -GY)])), tallest = Math.max(...totals.values());
    for (const [x, refs] of columns) { let y = (tallest - totals.get(x)) / 2; refs.sort((a, b) => layout.positions.get(a).y - layout.positions.get(b).y).forEach(ref => { layout.positions.get(ref).y = y; y += own.get(ref) + GY; }); }
    layout.height = tallest;
    const stageNumber = new Map((state.partFlow || []).map((stage, index) => [stage.id, index + 1]));
    const graphKey = 'ppath:' + part.id + ':' + clicked.ref;
    keepFull(part, graphKey);
    const nodes = list.map(entry => {
      const at = layout.positions.get(entry.ref), color = stepColor(part.id, entry.stage.id);
      const box = flowBox({ ...entry.step, depth: 0 }, entry.key, color, entry === selected ? 'selected' : entry === clicked ? 'onpath' : '', words);
      box.prepend(h('div', { class: 'st-path-stage', style: 'color:' + color }, stageNumber.get(entry.stage.id) + '. ' + entry.stage.name));
      return { id: entry.ref, x: at.x, y: at.y, w: W, h: own.get(entry.ref), ref: entry.ref, content: box };
    });
    const name = ref => entries.find(entry => entry.ref === ref)?.step.symbol;
    const edges = links.map(link => ({ ...link, hot: true, title: name(link.from) + ' calls ' + name(link.to) }));
    const summary = (before.size ? plural(before.size, 'step') + ' lead here' : 'Nothing in this part calls it') + (after.size ? ' · it calls ' + plural(after.size, 'step') : '');
    const bar = () => h('div', { class: 'st-flowbar' },
      act('flowBack', {}, '← Whole part', { title: 'Back to every step of this part' }), modeSwitch(clicked.step),
      h('b', {}, 'Path of ' + clicked.step.symbol), muted(summary + '. Read left to right; click a box for its details.'));
    ui.flowPlaces = { key: graphKey, hits: [] };
    // Another box's own path, only when asked.
    const detail = () => [selected !== clicked ? h('div', { class: 'st-row' }, link('flowRoot', { key: selected.key }, 'Show the path of ' + selected.step.symbol + ' →', { title: 'Lay out what leads to this step and what it calls' })) : undefined, flowStepDetail(selected.step)];
    const canvas = graphView(graphKey, { nodes, edges, width: layout.width, height: layout.height, minHeight: 300, maxHeight: 760, minZoom: 0.7, label: 'Path of ' + clicked.step.symbol + ' in ' + part.name, aside: detail(), toolbar: bar });
    const box = nodes.find(node => node.ref === selected.ref);
    ui.flowSelected = { key: graphKey, x: box.x, y: box.y, w: box.w, h: box.h };
    return [ui.full === graphKey ? undefined : bar(), canvas, detail()];
  }
  // --- inside a class: what it is made of, top to bottom ---
  // Read from the code (no AI): the parts its constructor creates, in the order
  // its main method (forward, call, or the one using most parts) runs them.
  const insideKeyOf = step => step.kind === 'class' ? step.file + '#' + step.symbol : step.kind === 'method' && step.owner ? step.file + '#' + step.owner : undefined;
  const insideRefOf = step => { const key = insideKeyOf(step); return key && state.partLayers?.[key]?.layers.some(layer => !layer.op) ? key : undefined; };
  const flowModeOf = step => ui.flowMode || (step.kind === 'class' ? 'inside' : 'calls');
  const shortName = key => String(key).split('#').pop();
  function modeSwitch(step) {
    const key = insideRefOf(step);
    if (!key) return undefined;
    const mode = flowModeOf(step);
    return h('span', { class: 'st-switch', role: 'group', 'aria-label': 'What to show' },
      act('flowMode', { mode: 'inside' }, 'Inside ' + shortName(key), { class: mode === 'inside' ? 'on' : '', title: 'What it is made of, in the order it runs' }),
      act('flowMode', { mode: 'calls' }, 'What it calls', { class: mode === 'calls' ? 'on' : '', title: 'What leads to it and what it calls' }));
  }
  function insideView(part, clicked, entries, words) {
    const rootKey = insideRefOf(clicked.step), trail = (ui.insideTrail || []).filter(key => state.partLayers?.[key]);
    const key = trail.length ? trail[trail.length - 1] : rootKey, anatomy = state.partLayers[key], name = shortName(key);
    const graphKey = 'pin:' + part.id + ':' + key;
    keepFull(part, graphKey);
    const classStep = ref => entries.find(entry => entry.step.kind === 'class' && entry.step.file + '#' + entry.step.symbol === ref)?.step;
    // What a part is: its step's description, its docstring, plain words for a known layer,
    // or else what it is made of.
    const madeOf = ref => { const sub = state.partLayers?.[ref]; const types = sub ? sub.layers.filter(item => !item.op && !item.unused).map(item => item.type) : []; return types.length ? 'Made of ' + [...new Set(types)].join(', ') + '.' : ''; };
    const whatOf = layer => layer.op ? layer.plain || '' : (layer.own && classStep(layer.own)?.what) || layer.doc || layer.plain || (layer.own ? madeOf(layer.own) : '') || '';
    // Its parts are shown inside it when they are building blocks, not only raw learned numbers.
    const opened = layer => { const sub = layer.own && state.partLayers?.[layer.own]; return sub && sub.layers.filter(item => !item.op && !item.unused && item.type !== 'Parameter').length >= 2 ? sub : undefined; };
    const lines = (text, per) => Math.max(1, Math.ceil(String(text || '').length / per));
    const runs = anatomy.runs ? anatomy.runs + '()' : '';
    const used = anatomy.layers.filter(layer => !layer.unused), unused = anatomy.layers.filter(layer => layer.unused);
    const { OPERATOR, times, nameOf } = flowText;
    const layerNamed = name => anatomy.layers.find(layer => !layer.op && layer.name === name);
    const file = key.split('#')[0], W = 380;
    // A part's arguments, values worked out where the code allows (768 for n_embd).
    const argsOf = layer => layer.args?.length ? h('code', { class: 'st-layer-args', title: layer.type + '(' + layer.args.map(arg => (arg.name ? arg.name + '=' : '') + arg.code).join(', ') + ')' }, '(' + layer.args.map(arg => (arg.name ? arg.name + '=' : '') + (arg.value ?? arg.code)).join(', ') + ')') : undefined;
    const badges = (layer, node) => [
      layer.repeat ? h('div', { class: 'st-layer-badge repeat' }, '× ' + times(layer) + ' · the same part, one copy after another') : undefined,
      node?.value ? h('div', { class: 'st-layer-badge' }, 'Read as a value, not run') : undefined,
      node?.method ? h('div', { class: 'st-layer-badge' }, 'Calls its ' + node.method + '()') : undefined,
      ...(node?.when || []).map(when => h('div', { class: 'st-layer-badge when' }, '◇ Only ' + when)),
      ...(node?.loop || []).map(loop => h('div', { class: 'st-layer-badge loop' }, '↻ Runs ' + loop)),
      layer.optional ? h('div', { class: 'st-layer-badge' }, 'Only created when a setting asks for it') : undefined,
      layer.unused ? h('div', { class: 'st-layer-badge' }, runs ? 'Not used by ' + runs : 'Not used by its main method') : undefined].filter(Boolean);
    const inner = layer => {
      const sub = opened(layer);
      if (!sub) return layer.own && state.partLayers?.[layer.own] ? link('flowInside', { ref: layer.own }, 'Look inside ' + layer.type + ' →', { title: 'Show ' + layer.type + ' on its own' }) : undefined;
      // In the order its own flow runs, each with its condition; additions as "+ add".
      const steps = (sub.flow?.nodes || []).filter(node => node.kind === 'part' || node.kind === 'op' || node.kind === 'merge');
      const rows = steps.length ? steps.map(node => node.kind === 'part' ? { ...(sub.layers.find(item => item.name === node.name) || { name: node.name, type: node.name }), when: node.when } : node.kind === 'op' ? { op: true, type: node.name, plain: node.plain, when: node.when } : { merge: node.name, when: node.when })
        : sub.layers.filter(item => !item.unused);
      return h('div', { class: 'st-layer-inner' }, h('div', { class: 'st-layer-inner-head' }, (layer.repeat ? 'Inside each ' : 'Inside ') + layer.type + ':'),
        rows.map((item, index) => h('div', { class: 'st-layer-row' + (item.op ? ' op' : '') }, index ? h('span', { class: 'st-layer-down' }, '↓') : undefined,
          item.merge ? h('span', { class: 'st-layer-plus' }, item.merge + ' ' + (OPERATOR[item.merge] || 'combine') + ' (joins two paths)') : [h('span', { class: item.op ? 'st-opname' : 'st-classname small' }, marked(item.type, words)), item.op ? undefined : h('code', {}, ' ' + item.name)],
          item.when?.length ? h('span', { class: 'st-layer-badge when' }, ' ◇ ' + item.when.join('; ')) : undefined,
          !item.merge && whatOf(item) ? h('div', { class: 'st-layer-row-what' }, marked(whatOf(item), words)) : undefined)),
        link('flowInside', { ref: layer.own }, 'Look inside ' + layer.type + ' →', { title: 'Show ' + layer.type + ' on its own' }));
    };
    const heightOf = (layer, node) => {
      const sub = opened(layer), what = whatOf(layer);
      return 44 + (layer.args?.length ? 16 : 0) + (what ? 17 * lines(what, 50) : 0) + badges(layer, node).length * 19 + (layer.own && !sub && state.partLayers?.[layer.own] ? 20 : 0)
        + (sub ? 50 + sub.layers.filter(item => !item.unused).reduce((sum, item, index) => sum + 19 + (index ? 11 : 0) + (whatOf(item) ? 14 * Math.min(2, lines(whatOf(item), 58)) : 0), 0) : 0) + (layer.repeat ? 10 : 0);
    };
    const flow = anatomy.flow || { nodes: [], edges: [] }, flowNodes = flow.nodes, at = new Map(flowNodes.map(node => [node.id, node]));
    const graph = flowText.links(flow), into = graph.into, outOf = graph.outOf;
    const walking = ui.walk !== undefined && ui.walkKey === key ? Math.max(0, Math.min(flowNodes.length - 1, ui.walk)) : undefined, current = walking !== undefined ? flowNodes[walking] : undefined;
    const isSelected = node => current ? current === node : ui.flowLayer === (node.kind === 'part' ? node.name : 'node:' + node.id);
    // One box per step of the flow.
    function flowContent(node) {
      const pick = { act: 'flowLayer', name: node.kind === 'part' ? node.name : 'node:' + node.id }, on = isSelected(node) ? ' selected' : '';
      const where = node.line ? ' · ' + file + ':' + node.line : '';
      if (node.kind === 'in' || node.kind === 'out') return h('div', { class: 'st-node st-layer-end' + on, data: pick, role: 'button', tabindex: 0 }, h('b', {}, node.kind === 'in' ? 'Goes in' : 'Comes out'), node.kind === 'in' ? h('code', {}, node.name) : node.names?.length ? h('code', {}, node.names.join(', ')) : muted('the result'));
      if (node.kind === 'merge') return h('div', { class: 'st-node st-layer-merge' + on, data: pick, role: 'button', tabindex: 0, title: 'Combines ' + into(node.id).map(nameOf).join(' and ') + where }, h('b', {}, node.name), h('span', {}, OPERATOR[node.name] || 'combine'), ...(node.when || []).map(when => h('span', { class: 'st-layer-badge when' }, '◇')));
      if (node.kind === 'op') return h('div', { class: 'st-node st-layer op' + on, data: pick, role: 'button', tabindex: 0, title: node.name + where },
        h('div', {}, h('span', { class: 'st-opname' }, '∑ ' + node.name)), node.plain ? h('div', { class: 'st-layer-what' }, marked(node.plain, words)) : undefined, ...(node.when || []).map(when => h('div', { class: 'st-layer-badge when' }, '◇ Only ' + when)));
      const layer = layerNamed(node.name) || { name: node.name, type: node.name };
      return h('div', { class: 'st-node st-layer' + (layer.own ? ' own' : '') + (layer.repeat ? ' repeat' : '') + on, data: pick, role: 'button', tabindex: 0, title: layer.name + ' = ' + layer.type + '(…)' + where },
        h('div', { class: 'st-layer-head' }, h('span', { class: 'st-classname', title: layer.plain || '' }, marked(layer.type, words)), h('code', { class: 'st-layer-name' }, marked(layer.name, words) )),
        argsOf(layer),
        whatOf(layer) ? h('div', { class: 'st-layer-what' }, marked(whatOf(layer), words)) : h('div', { class: 'st-layer-what st-muted' }, 'A part made from ' + layer.type + '.'),
        badges(layer, node), inner(layer));
    }
    const widthOf = node => node.kind === 'merge' ? 92 : node.kind === 'in' || node.kind === 'out' ? 220 : node.kind === 'op' ? 300 : W;
    const estimate = node => node.kind === 'merge' ? 34 : node.kind === 'in' || node.kind === 'out' ? 34 : node.kind === 'op' ? 30 + 15 * lines(node.plain, 52) + (node.when?.length || 0) * 19 : heightOf(layerNamed(node.name) || {}, node);
    // Laid out top to bottom: rows from the flow's order, side by side where it splits.
    const contents = flowNodes.map(node => flowContent(node)), measured = measureAll(contents.map((content, index) => [content, widthOf(flowNodes[index])]));
    const sized = flowNodes.map((node, index) => ({ node, content: contents[index], w: widthOf(node), h: measured[index] ? measured[index] + (layerNamed(node.name)?.repeat && node.kind === 'part' ? 10 : 0) : estimate(node) }));
    const layout = layeredLayout(flowNodes.map(node => ({ id: node.id })), (flow.edges || []).map(([from, to]) => ({ from, to })), { width: 1, height: W, gapX: 0, gapY: 46 });
    // A source other than an input (a part read with nothing fed in) sits just above where it is used.
    const row = new Map(flowNodes.map(node => [node.id, layout.positions.get(node.id).layer]));
    for (const node of flowNodes) {
      if (node.kind === 'in' || into(node.id).length) continue;
      const below = outOf(node.id).map(next => row.get(next.id));
      if (below.length) row.set(node.id, Math.max(0, Math.min(...below) - 1));
    }
    const rows = [];
    for (const item of sized) (rows[row.get(item.node.id)] ||= []).push(item);
    // Each row centered on one line down the middle, in the layout's left-to-right order.
    const nodes = [], GAP = 40, SLOT = W + 40;
    let y = 0;
    for (const items of rows) {
      if (!items) continue;
      items.sort((a, b) => layout.positions.get(a.node.id).y - layout.positions.get(b.node.id).y);
      const tallest = Math.max(...items.map(item => item.h));
      items.forEach((item, index) => nodes.push({ id: item.node.id, x: (index - (items.length - 1) / 2) * SLOT - item.w / 2, y: y + (tallest - item.h) / 2, w: item.w, h: item.h, content: item.content }));
      y += tallest + GAP;
    }
    const left = Math.min(0, ...nodes.map(node => node.x - 90));
    for (const node of nodes) node.x -= left;
    const placed = new Map(nodes.map(node => [node.id, node])), rowOf = id => row.get(id);
    const edges = (flow.edges || []).filter(([from, to]) => placed.has(from) && placed.has(to)).map(([from, to]) => {
      const a = placed.get(from), b = placed.get(to), far = rowOf(to) - rowOf(from) > 1;
      // Arrows that skip rows go round the boxes between them, on the nearer side.
      let side, out;
      if (far) {
        const between = nodes.filter(node => rowOf(node.id) > rowOf(from) && rowOf(node.id) < rowOf(to));
        const leftmost = Math.min(a.x, b.x, ...between.map(node => node.x)) - 26, rightmost = Math.max(a.x + a.w, b.x + b.w, ...between.map(node => node.x + node.w)) + 26;
        const middle = (a.x + a.w / 2 + b.x + b.w / 2) / 2;
        side = rightmost - middle <= middle - leftmost ? 'right' : 'left';
        out = side === 'right' ? rightmost : leftmost;
      }
      const lit = current ? to === current.id || from === current.id : true;
      return { from, to, down: !side, side, out, hot: lit && !flow.order, soft: !!flow.order, dim: !!current && !lit, title: nameOf(at.get(from)) + ' → ' + nameOf(at.get(to)) };
    });
    if (unused.length) {
      y += 10;
      const spare = unused.map((layer, index) => flowContent({ kind: 'part', name: layer.name, id: 'u' + index })), tall = measureAll(spare.map(content => [content, W]));
      unused.forEach((layer, index) => { const hgt = tall[index] || heightOf(layer); nodes.push({ id: 'u:' + index, x: -left - W / 2, y, w: W, h: hgt, content: spare[index] }); y += hgt + 16; });
    }
    const width = Math.max(W, ...nodes.map(node => node.x + node.w)) + 90, height = Math.max(0, y - GAP);
    const crumbs = [rootKey, ...trail.filter(item => item !== rootKey)];
    const defaults = anatomy.defaults?.length ? 'Numbers use ' + anatomy.defaults.join(', ') + '; a run can pass other values.' : '';
    const bar = () => h('div', { class: 'st-flowbar' },
      act('flowBack', {}, '← Whole part', { title: 'Back to every step of this part' }), modeSwitch(clicked.step),
      crumbs.length > 1 ? h('span', { class: 'st-crumbs' }, crumbs.map((item, index) => [index ? ' › ' : '', index === crumbs.length - 1 ? h('b', {}, shortName(item)) : link('flowInside', { depth: index }, shortName(item))])) : h('b', {}, 'Inside ' + name),
      flowNodes.length > 1 ? act('walk', { key, at: walking === undefined ? 0 : '' }, walking === undefined ? '▶ Step through' : '■ Stop', { title: 'Follow the data one step at a time' }) : undefined,
      muted((flow.order ? 'Top to bottom in the order ' + (runs || 'it') + ' uses them' : 'Arrows show what feeds what' + (runs ? ' in ' + runs : '')) + '. ' + defaults));
    // Step through: one sentence per step, built from the graph.
    const sentence = node => flowText.sentence(anatomy, node, { name, whatOf, graph });
    const walkCard = () => h('div', { class: 'st-detail st-flow-detail st-walk' },
      h('h2', {}, 'Step ' + (walking + 1) + ' of ' + flowNodes.length, spacer(), link('walk', { key, at: '' }, 'Stop')),
      h('p', {}, sentence(current)),
      current.line ? h('div', { class: 'st-row' }, link('jump', { file, line: current.line }, file + ':' + current.line, { title: 'Open this line' })) : undefined,
      h('div', { class: 'st-row' }, act('walk', { key, at: walking - 1 }, '← Back', { disabled: walking === 0 ? true : undefined }), act('walk', { key, at: walking + 1 }, 'Next →', { disabled: walking === flowNodes.length - 1 ? true : undefined })));
    const selectedLayer = anatomy.layers.find(layer => !layer.op && layer.name === ui.flowLayer), selectedNode = /^node:/.test(ui.flowLayer || '') ? at.get(ui.flowLayer.slice(5)) : undefined;
    const uses = layer => flowNodes.filter(node => node.kind === 'part' && node.name === layer.name);
    const detail = () => current ? walkCard() : selectedLayer ? layerCard(selectedLayer, name, whatOf, classStep, { file, uses: uses(selectedLayer), runs, times })
      : selectedNode ? h('div', { class: 'st-detail st-flow-detail' }, h('h2', {}, selectedNode.kind === 'merge' ? selectedNode.name + ' ' + (OPERATOR[selectedNode.name] || 'combine') : selectedNode.kind === 'in' ? 'Goes in: ' + selectedNode.name : selectedNode.kind === 'out' ? 'Comes out' : '∑ ' + selectedNode.name, spacer(), link('flowLayer', { name: ui.flowLayer }, 'Close')), h('p', {}, sentence(selectedNode)), selectedNode.line ? link('jump', { file, line: selectedNode.line }, file + ':' + selectedNode.line) : undefined)
      : key === rootKey ? flowStepDetail(clicked.step)
      : h('div', { class: 'st-detail st-flow-detail' }, h('h2', {}, name), h('p', {}, classStep(key)?.what || anatomy.doc || madeOf(key)), h('p', { class: 'st-muted' }, 'A part of ' + shortName(crumbs[crumbs.length - 2] || rootKey) + '.'), link('openFile', { file }, 'About ' + fileName(file)));
    ui.flowPlaces = { key: graphKey, hits: [] };
    const focus = current ? placed.get(current.id) : undefined;
    if (focus) ui.flowSelected = { key: graphKey, x: focus.x, y: focus.y, w: focus.w, h: focus.h };
    const canvas = graphView(graphKey, { nodes, edges, width, height, minHeight: 320, maxHeight: 760, minZoom: 0.7, label: 'Inside ' + name, aside: detail(), toolbar: bar });
    return [ui.full === graphKey ? undefined : bar(), canvas, detail()];
  }
  // The heights boxes take at their widths, laid out off screen together (one layout
  // pass for all of them); 0s when the page can't tell.
  function measureAll(items) {
    if (!root.isConnected || !items.length) return items.map(() => 0);
    const probes = items.map(([content, width]) => h('div', { class: 'st-measure', style: 'width:' + width + 'px' }, content));
    const holder = h('div', { class: 'st-measures' }, probes);
    root.append(holder);
    const heights = probes.map(probe => Math.ceil(probe.getBoundingClientRect().height));
    holder.remove();
    for (const [content] of items) content.remove?.();
    return heights;
  }
  // One part, in the side panel: what it is and what the code says about it.
  function layerCard(layer, owner, whatOf, classStep, { file, uses = [], runs = '', times = () => '' } = {}) {
    const step = layer.own && classStep(layer.own), what = whatOf(layer);
    const conditions = [...new Set(uses.flatMap(node => node.when || []))];
    return h('div', { class: 'st-detail st-flow-detail' },
      h('h2', {}, layer.type, spacer(), link('flowLayer', { name: layer.name }, 'Close')),
      h('p', { class: 'st-muted' }, owner + ' keeps it as ' + layer.name + '.'),
      what ? h('p', {}, what) : h('p', { class: 'st-muted' }, 'No plain-words note for ' + layer.type + ' yet.'),
      layer.args?.length ? h('p', {}, 'Made with ', h('code', {}, layer.type + '(' + layer.args.map(arg => (arg.name ? arg.name + '=' : '') + (arg.value !== undefined && arg.value !== arg.code ? arg.value + ' ‹' + arg.code + '›' : arg.code)).join(', ') + ')')) : undefined,
      layer.repeat ? h('p', {}, 'Repeated ' + times(layer) + ' times: the output of one copy goes into the next.') : undefined,
      conditions.length ? h('p', {}, 'Runs only ' + conditions.join('; or ') + '.') : undefined,
      h('div', { class: 'st-row' }, layer.line ? link('jump', { file, line: layer.line }, 'Made at ' + file + ':' + layer.line, { title: 'Where the constructor creates it' }) : undefined,
        ...uses.filter(node => node.line).map(node => link('jump', { file, line: node.line }, 'Used at ' + file + ':' + node.line, { title: 'Where ' + (runs || 'the code') + ' uses it' }))),
      layer.own && state.partLayers?.[layer.own] ? h('div', { class: 'st-row' }, link('flowInside', { ref: layer.own }, 'Look inside ' + layer.type + ' →')) : undefined,
      layer.own && !step ? h('div', { class: 'st-row' }, link('openFile', { file: layer.own.split('#')[0] }, 'About ' + fileName(layer.own.split('#')[0]))) : undefined,
      step ? flowStepDetail(step) : undefined);
  }
  // Marks the words that matched, inside a box's text.
  function marked(text, words) {
    if (!words?.length) return text;
    return String(text).split(/([A-Za-z0-9_]+)/).map(part => /[A-Za-z0-9]/.test(part) && finder.matches(part, words) ? h('mark', {}, part) : part);
  }
  // What kind of code a box is: a class (a thing with parts and methods), a method of one, or a script section.
  // The class name is the layer's name in a model (LayerNorm, Block): shown big, not only in the small print.
  function kindLabel(step, words) {
    if (step.kind === 'class') return h('div', { class: 'st-codekind class' }, h('span', { class: 'st-kind-tag' }, '◇ class'), h('span', { class: 'st-classname' }, marked(step.symbol, words)));
    if (step.kind === 'method') return h('div', { class: 'st-codekind method' }, 'ƒ ', h('span', { class: 'st-classname small' }, marked(step.owner || 'a class', words)), '.' + step.symbol);
    if (step.kind === 'section') return h('div', { class: 'st-codekind section' }, '§ script section');
    return undefined;
  }
  const codeName = step => step.kind === 'method' && step.owner ? step.owner + '.' + step.symbol : step.symbol;
  function flowBox(step, key, color, look = '', words = []) {
    const decisionsOf = (step.details || []).filter(item => item.kind === 'decides' || item.kind === 'stops').slice(0, 3);
    return h('div', { class: 'st-node flowstep' + (step.depth ? ' sub' : '') + (step.kind === 'class' ? ' classbox' : step.kind === 'method' ? ' methodbox' : '') + (look ? ' ' + look : ''), data: { act: 'flowStep', key }, role: 'button', tabindex: 0, style: step.depth && step.kind !== 'class' ? undefined : 'border-left: 4px solid ' + color,
      title: codeName(step) + ' · ' + step.file + ':' + (step.line_start || '') + (step.details?.length ? '\n\n' + step.details.map(item => (KIND[item.kind] || item.kind) + ': ' + item.text).join('\n') : '') },
      kindLabel(step, words),
      h('b', {}, marked(step.what || step.symbol, words)),
      decisionsOf.map(item => h('div', { class: 'st-decision' + (item.kind === 'stops' ? ' stops' : '') }, (item.kind === 'stops' ? '⚠ ' : '◆ '), marked(item.text, words))),
      step.details?.length ? h('div', { class: 'st-node-kinds' }, chips(step.details)) : undefined,
      h('div', { class: 'st-node-meta' }, marked(codeName(step), words), ' · ' + fileName(step.file)));
  }
  // A class as a container: what it is, what it is built from, and its methods inside it.
  function classBox(entry, members, color, look, lookOf, words) {
    const box = flowBox(entry.step, entry.key, color, look, words), meta = box.lastChild;
    const parts = state.partBuiltFrom?.[entry.ref];
    if (parts?.length) box.insertBefore(h('div', { class: 'st-built', title: 'Classes this one is built from' }, 'Built from ', parts.map((name, index) => [index ? ' · ' : '', h('code', {}, name)])), meta);
    const inside = state.partLayers?.[entry.ref]?.layers.filter(layer => !layer.op).length;
    if (inside) box.insertBefore(h('div', { class: 'st-inside-hint', title: 'Click to see the parts it is made of, top to bottom' }, '▦ Made of ' + inside + ' parts · click to look inside'), meta);
    if (members.length) box.insertBefore(h('div', { class: 'st-methods' }, members.map(member => h('div', { class: 'st-method' + (lookOf(member) ? ' ' + lookOf(member) : ''), data: { act: 'flowStep', key: member.key }, role: 'button', tabindex: 0,
      title: member.step.owner + '.' + member.step.symbol + ' · ' + member.step.file + ':' + (member.step.line_start || '') + (member.step.details?.length ? '\n\n' + member.step.details.map(item => (KIND[item.kind] || item.kind) + ': ' + item.text).join('\n') : '') },
      h('code', {}, 'ƒ ', marked(member.step.symbol, words), '()'), member.step.what ? h('span', {}, marked(member.step.what, words)) : undefined))), meta);
    return box;
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
    return [graphView('flow:' + part + '/' + stage.id, { nodes: out, edges, width, height: tall, minHeight: 240, maxHeight: 640, minZoom: 0.75, label: 'How ' + stage.name + ' works', aside: picked ? flowStepDetail(picked) : undefined }), picked ? flowStepDetail(picked) : undefined];
  }
  // Everything about one step: what it does, every key behavior, and where it is.
  function flowStepDetail(step) {
    const caller = step.parent ? stagesStep(step.parent) : undefined;
    return h('div', { class: 'st-detail st-flow-detail' },
      h('h2', {}, step.what || step.symbol, spacer(), link('flowStep', { key: '' }, 'Close')),
      h('div', { class: 'st-row' }, act('jump', { file: step.file, line: step.line_start || 1 }, step.symbol + ' · ' + step.file + ':' + (step.line_start || '?'), { class: 'st-chip', title: 'Open the source line' }),
        link('flow', { file: step.file, line: step.line_start || 1 }, 'Read it beside the code'), link('openFile', { file: step.file }, 'About this file'),
        state.terminalChat ? go('agentSession', { prefill: 'About ' + step.symbol + ' in ' + step.file + ': ' }, 'Ask in terminal…', { title: 'Opens your agent session with this step on the prompt' }) : undefined),
      caller ? h('p', { class: 'st-muted' }, 'Called by: ' + (caller.what || caller.symbol)) : undefined,
      step.details?.length ? h('ul', { class: 'st-behaviors' }, step.details.map(item => h('li', {}, behaviorChip(item.kind), ' ', item.text))) : h('p', { class: 'st-muted' }, 'No key behaviors recorded for this step.'));
  }
  const stagesStep = key => [...(state.card?.steps || []), ...(state.partFlow || []).flatMap(stage => stage.steps)].find(step => step.file + '#' + step.symbol === key);
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
  // Tells you when the map no longer matches the code: edits in progress, or
  // steps whose code changed (from the editor, your agent, git) and are not updated yet.
  function changesBanner(sys) {
    const pending = state.changes?.pending || 0, auto = state.changes?.auto !== false;
    if (state.busy) return undefined;
    if (pending) return h('p', { class: 'st-notice st-changing' }, 'Your code is changing (' + plural(pending, 'file') + ' edited). ', auto ? 'The map updates by itself once the edits stop.' : 'Update the map when you are done.');
    const stale = sys.parts.filter(part => part.stale);
    if (!stale.length) return undefined;
    const steps = stale.reduce((sum, part) => sum + part.stale, 0), names = stale.map(part => part.name);
    return h('div', { class: 'st-upgrade st-outdated', role: 'status' },
      h('div', {}, h('b', {}, 'Your code changed since this map was made.'), ' ', muted(plural(steps, 'step') + ' in ' + (names.length > 3 ? names.slice(0, 3).join(', ') + ' and ' + plural(names.length - 3, 'more part') : names.join(', ')) + (steps === 1 ? ' is' : ' are') + ' out of date (dashed boxes). Update re-reads only those steps.')),
      go('refresh', {}, 'Update now', { title: 'Update only the steps whose code changed' }));
  }
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
      sys?.newFiles ? h('p', { class: 'st-notice' }, 'Files were added or removed since the map was made. ', link('buildSystem', {}, 'Update the map')) : undefined,
      sys ? changesBanner(sys) : undefined,
      sys && !state.busy && !sys.parts.some(part => part.outdated) && sys.parts.some(part => part.undescribed) ? h('div', { class: 'st-upgrade' }, h('div', {}, h('b', {}, plural(sys.parts.reduce((sum, part) => sum + (part.undescribed || 0), 0), 'step') + ' across ' + plural(sys.parts.filter(part => part.undescribed).length, 'part') + ' have no description yet.'), ' ', muted('A run stopped before writing them. This only fills them in.')),
        go('describeParts', {}, 'Describe the missing steps', { disabled: !!state.busy })) : undefined,
      sys && !state.busy && sys.parts.some(part => part.outdated) ? h('div', { class: 'st-upgrade' }, h('div', {}, h('b', {}, plural(sys.parts.filter(part => part.outdated).length, 'part') + ' mapped the old way.'), ' ', muted('Map them again to see inner steps, decisions, AI calls and files on the diagrams. A few cents with the cheap model; unchanged functions are reused.')),
        go('upgradeParts', {}, 'Upgrade all parts', { disabled: !!state.busy })) : undefined];
    if (!sys) return [header(), h('div', { class: 'st-top st-plain' }, notices), activity(), empty()];
    return [header(), notesPanel(), h('div', { class: 'st-top' }, sys.summary ? h('p', { class: 'st-summary' }, sys.summary) : undefined, notices, reviewBar(), state.terminalChat ? chatBar() : steerBox()),
      activity(), reviewPanel(), systemGraph(),
      h('p', { class: 'st-muted st-hint' }, 'Click a box to open it. Arrows show what starts or uses what; dashed arrows are code one part uses from another.'),
      partPanel(), sharedPanel(), !state.part && !state.shared ? fileCard() : undefined, systemNotes(),
      h('p', { class: 'st-muted st-foot' }, 'Not right? ', link('rebuild', {}, 'Map the system again'), ' (one AI call for the parts, plus one per part).')];
  }
  function render() {
    const active = doc.activeElement, keep = active && /^st-(note|why|intent|system-note|flowsearch)$/.test(active.id || '') ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
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
      case 'partTab': ui.partTab = data.tab; render(); return;
      case 'flowHit': ui.flowHit = (ui.flowHit || 0) + Number(data.by); (ui.flowStep = ui.flowRoot = undefined, resetInside()); render(); jumpToHit(); return;
      case 'flowClear': ui.flowQuery = ''; (ui.flowStep = ui.flowRoot = undefined, resetInside()); render(); return;
      case 'flowBack': (ui.flowStep = ui.flowRoot = undefined, resetInside()); render(); jumpToHit(); return;
      case 'flowStep':
        // In a part's steps: the first click opens that step's path; clicks along it only select.
        if (!data.key) (ui.flowStep = ui.flowRoot = undefined, resetInside());
        else if (data.key.startsWith('p:') && ui.flowRoot) { ui.flowStep = data.key; render(); requestAnimationFrame(revealSelected); return; }
        else if (data.key.startsWith('p:')) (ui.flowStep = ui.flowRoot = data.key, resetInside());
        else ui.flowStep = ui.flowStep === data.key ? undefined : data.key;
        render(); return;
      case 'flowMode': ui.flowMode = data.mode; ui.flowLayer = undefined; render(); return;
      case 'walk': ui.walkKey = data.key; ui.walk = data.at === '' || data.at === undefined ? undefined : Number(data.at); ui.flowLayer = undefined; render(); if (ui.walk !== undefined) requestAnimationFrame(revealSelected); return;
      case 'flowLayer': ui.flowLayer = ui.flowLayer === data.name ? undefined : data.name; render(); return;
      case 'flowInside': { ui.walk = undefined; const trail = ui.insideTrail || []; ui.insideTrail = data.depth !== undefined ? trail.slice(0, Number(data.depth)) : trail.includes(data.ref) ? trail.slice(0, trail.indexOf(data.ref) + 1) : [...trail, data.ref]; ui.flowLayer = undefined; render(); return; }
      case 'flowRoot': (ui.flowStep = ui.flowRoot = data.key, resetInside()); render(); return;
      case 'resetLayout': if (state.layouts) delete state.layouts[data.key]; delete ui.views[data.key]; send('layout', { key: data.key, reset: true }); render(); return;
      case 'fullGraph': ui.full = ui.full === data.key ? undefined : data.key; render(); return;
      case 'hideGraph': ui.hidden[data.key] = true; if (ui.full === data.key) ui.full = undefined; render(); return;
      case 'showGraph': ui.hidden[data.key] = false; render(); return;
      case 'notesPanel': ui.notesPanel = !ui.notesPanel; render(); return;
      case 'block': ui.blocks[data.key] = !ui.blocks[data.key]; render(); return;
      case 'allBlocks': { const keys = (state.file?.pseudocode?.sections || []).map((_, index) => state.file.file + '#' + index); const open = !keys.every(key => ui.blocks[key]); keys.forEach(key => { ui.blocks[key] = open; }); render(); return; }
      case 'openPart': ui.here = undefined; (ui.flowStep = ui.flowRoot = undefined, resetInside()); send('openPart', { id: data.id || undefined }); return;
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
  // Pan just enough that the selected box is not cut off or under the side panel.
  function revealSelected() {
    const place = ui.flowSelected, canvas = place && root.querySelector('.st-canvas[data-key="' + place.key + '"]'), view = place && ui.views[place.key];
    if (!canvas || !view) return;
    const full = canvas.classList.contains('full'), width = canvas.clientWidth, right = full && canvas.querySelector('.st-full-aside') ? Math.min(340, width * 0.34) : 0, top = full ? 36 : 0;
    const left = place.x * view.k + view.x, rightEdge = left + place.w * view.k, upper = place.y * view.k + view.y, lower = upper + place.h * view.k;
    let dx = 0, dy = 0;
    if (rightEdge > width - right - 12) dx = width - right - 12 - rightEdge;
    if (left + dx < 12) dx = 12 - left;
    if (lower > canvas.clientHeight - 12) dy = canvas.clientHeight - 12 - lower;
    if (upper + dy < top + 12) dy = top + 12 - upper;
    if (!dx && !dy) return;
    ui.views[place.key] = { ...view, x: view.x + dx, y: view.y + dy };
    canvas.querySelector('.st-world')?.setAttribute('transform', 'translate(' + ui.views[place.key].x + ' ' + ui.views[place.key].y + ') scale(' + view.k + ')');
  }
  // Center the diagram on the current match.
  function jumpToHit() { requestAnimationFrame(centerHit); }
  function centerHit() {
    const places = ui.flowPlaces, hits = places?.hits || [];
    if (!hits.length) return;
    const index = ((ui.flowHit || 0) % hits.length + hits.length) % hits.length, node = hits[index];
    const canvas = root.querySelector('.st-canvas[data-key="' + places.key + '"]'), view = ui.views[places.key];
    if (!canvas || !view) return;
    // Center it in the part of the diagram that is on screen.
    const k = Math.max(view.k, 0.85), box = canvas.getBoundingClientRect(), screen = doc.defaultView?.innerHeight || box.bottom;
    const top = Math.max(0, -box.top), bottom = Math.min(box.height, screen - box.top), middle = bottom > top + 80 ? (top + bottom) / 2 : box.height / 2;
    ui.views[places.key] = { ...view, k, x: canvas.clientWidth / 2 - (node.x + node.w / 2) * k, y: middle - (node.y + node.h / 2) * k };
    canvas.querySelector('.st-world')?.setAttribute('transform', 'translate(' + ui.views[places.key].x + ' ' + ui.views[places.key].y + ') scale(' + k + ')');
  }
  root.addEventListener('keydown', event => {
    if (event.target.id === 'st-flowsearch' && event.key === 'Enter') { event.preventDefault(); ui.flowHit = (ui.flowHit || 0) + (event.shiftKey ? -1 : 1); (ui.flowStep = ui.flowRoot = undefined, resetInside()); render(); jumpToHit(); return; }
    if (event.target.id === 'st-flowsearch' && event.key === 'Escape') { ui.flowQuery = ''; render(); return; }
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
    if (id === 'st-flowsearch') { ui.flowQuery = event.target.value; ui.flowHit = 0; (ui.flowStep = ui.flowRoot = undefined, resetInside()); clearTimeout(ui.flowTimer); ui.flowTimer = setTimeout(() => { render(); jumpToHit(); }, 140); }
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
const stagesClient = () => `const lineDiff = ${lineDiff.toString()};\nconst flowText = (${flowWords.toString()})();\nconst stepSearch = ${stepSearch.toString()};\nconst layeredLayout = ${layeredLayout.toString()};\nconst mountStages = ${mountStages.toString()};`;

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

module.exports = { stagesHTML, stagesClient, STAGES_STYLE, lineDiff, mountStages, layeredLayout, stepSearch };
