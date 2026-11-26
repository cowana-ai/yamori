'use strict';
// The stage screen: one view for a workflow. The stage graph stays on top;
// a stage card (and anything opened from it) expands below the graph instead
// of replacing it. Rendering uses only the state posted by the extension, so
// opening anything here never calls a model.
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

const STYLES = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 0 16px 40px; font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
button { font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 4px; padding: 3px 9px; cursor: pointer; }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { filter: brightness(1.1); }
button:disabled { opacity: .5; cursor: default; }
button.link { background: none; color: var(--vscode-textLink-foreground); padding: 0 2px; }
input, textarea, select { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 6px; }
textarea { width: 100%; box-sizing: border-box; min-height: 48px; resize: vertical; }
header { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 0 8px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
header h1 { font-size: 14px; margin: 0 8px 0 0; font-weight: 600; }
header .spacer { flex: 1; }
.muted { color: var(--vscode-descriptionForeground); }
.error { color: var(--vscode-errorForeground); margin: 8px 0; }
.notice { margin: 8px 0; padding: 6px 10px; border-radius: 4px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
.reviewbar { display: flex; align-items: center; gap: 10px; margin: 10px 0 0; padding: 6px 10px; border-radius: 4px; background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background)); border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-panel-border)); }
.graph { display: flex; align-items: stretch; gap: 0; overflow-x: auto; padding: 14px 2px 10px; }
.stage { position: relative; flex: 0 0 190px; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); cursor: pointer; text-align: left; color: inherit; }
.stage:hover, .stage:focus-visible { border-color: var(--vscode-focusBorder); outline: none; }
.stage.open { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder) inset; }
.stage.stale { border-style: dashed; }
.stage .name { font-weight: 600; display: flex; gap: 6px; align-items: baseline; }
.stage .gist { margin-top: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.stage .meta { margin-top: 6px; font-size: 11px; color: var(--vscode-descriptionForeground); }
.badges { position: absolute; top: -9px; right: 8px; display: flex; gap: 4px; }
.badge { font-size: 10px; padding: 0 6px; border-radius: 8px; line-height: 16px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.badge.plus { background: var(--vscode-gitDecoration-addedResourceForeground, #3a3); color: var(--vscode-editor-background); }
.badge.stale { background: var(--vscode-editorWarning-foreground, #c90); color: var(--vscode-editor-background); }
.edge { flex: 0 0 72px; display: flex; flex-direction: column; justify-content: center; align-items: center; font-size: 10px; color: var(--vscode-descriptionForeground); text-align: center; padding: 0 4px; }
.edge .arrow { font-size: 16px; line-height: 1; }
.card { margin: 6px 0 16px; padding: 12px 14px; border: 1px solid var(--vscode-focusBorder); border-radius: 8px; background: var(--vscode-editorWidget-background); }
.card h2 { font-size: 14px; margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.story { display: grid; grid-template-columns: 52px 1fr; gap: 2px 8px; margin: 10px 0; }
.story b { color: var(--vscode-descriptionForeground); font-weight: 600; }
.steps { list-style: none; margin: 8px 0 0; padding: 0; }
.steps li { padding: 6px 0; border-top: 1px solid var(--vscode-panel-border); }
.steps .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.chip { font-family: var(--vscode-editor-font-family); font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); color: var(--vscode-textLink-foreground); border: 0; cursor: pointer; }
.symbol { font-family: var(--vscode-editor-font-family); font-weight: 600; }
pre { margin: 6px 0 0; padding: 6px 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font: 12px/1.45 var(--vscode-editor-font-family); white-space: pre-wrap; }
.diff .add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(80,200,80,.18)); }
.diff .del { background: var(--vscode-diffEditor-removedLineBackground, rgba(220,80,80,.18)); text-decoration: line-through; text-decoration-color: rgba(220,80,80,.5); }
.diff span { display: block; }
.section { margin-top: 14px; }
.section h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; color: var(--vscode-descriptionForeground); }
.tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.activity table { border-collapse: collapse; width: 100%; font-size: 12px; }
.activity td, .activity th { text-align: left; padding: 3px 6px; border-top: 1px solid var(--vscode-panel-border); }
.activity th { color: var(--vscode-descriptionForeground); font-weight: 500; }
.empty { padding: 24px 0; }
details > summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
`;

function stagesHTML() {
  const nonce = randomBytes(18).toString('base64');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yamori stages</title><style nonce="${nonce}">${STYLES}</style></head>
<body><div id="app"><p class="muted">Loading stages…</p></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const lineDiff = ${lineDiff.toString()};
let state = {}, ui = vscode.getState() || { open: undefined, review: undefined, activity: false, pseudo: {} };
const save = () => vscode.setState(ui);
const send = (type, data = {}) => vscode.postMessage({ type, ...data });
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tokens = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0);
const money = n => n ? '$' + n.toFixed(n < 0.1 ? 4 : 2) : '—';
const base = file => file.split('/').at(-1);

function header() {
  const w = state.workflow, list = state.workflows || [];
  const total = state.activity?.total;
  return '<header><h1>Stages</h1>' +
    (list.length ? '<select id="workflow" aria-label="Workflow">' + list.map(item => '<option value="' + esc(item.id) + '"' + (item.id === w?.id ? ' selected' : '') + '>' + esc(item.id) + ' · ' + esc(base(item.entry_file)) + (item.entry_symbol ? ' › ' + esc(item.entry_symbol) : '') + '</option>').join('') + '</select>' : '') +
    '<button data-act="fromEntry">New from entry…</button>' +
    (w ? '<button data-act="refresh"' + (state.busy ? ' disabled' : '') + ' title="Update only stages whose code changed">Update changed</button><button data-act="regenerate"' + (state.busy ? ' disabled' : '') + ' title="Re-cluster the whole workflow (one cheap-model call)">Regenerate all</button>' : '') +
    '<span class="spacer"></span>' +
    '<button class="link" data-act="activity" title="Every model call, its tokens and cost">' + (total ? 'Today: ' + tokens(total.input + total.cached + total.output) + ' tokens · ' + money(total.cost) : 'Activity') + '</button></header>';
}
function graph() {
  const w = state.workflow;
  if (!w) return '';
  let html = '<div class="graph" role="list">';
  w.stages.forEach((stage, index) => {
    if (index) {
      const prev = w.stages[index - 1];
      html += '<div class="edge" aria-hidden="true"><span>' + esc(prev.output || '') + '</span><span class="arrow">→</span></div>';
    }
    const badges = (stage.plus ? '<span class="badge plus" title="Changes since you last reviewed">±' + stage.plus + '</span>' : '') + (stage.stale ? '<span class="badge stale">Needs update</span>' : '') + (stage.pinned ? '<span class="badge" title="Pinned: you fixed its name or steps; regeneration keeps it">📌</span>' : '');
    html += '<button role="listitem" class="stage' + (ui.open === stage.id ? ' open' : '') + (stage.stale ? ' stale' : '') + '" data-stage="' + esc(stage.id) + '">' +
      '<div class="badges">' + badges + '</div><div class="name">' + esc(stage.name) + '</div><div class="gist">' + esc(stage.gist || '') + '</div>' +
      '<div class="meta">' + stage.steps + ' step' + (stage.steps === 1 ? '' : 's') + ' · ' + stage.files.length + ' file' + (stage.files.length === 1 ? '' : 's') + '</div></button>';
  });
  return html + '</div>';
}
function card() {
  const stage = state.card;
  if (!stage || stage.id !== ui.open) return '';
  const others = (state.workflow?.stages || []).filter(item => item.id !== stage.id);
  let html = '<section class="card" aria-label="Stage ' + esc(stage.name) + '"><h2><span id="stageName">' + esc(stage.name) + '</span>' +
    (stage.stale ? '<span class="badge stale">Needs update</span>' : '') +
    '<button class="link" data-act="rename" data-stage="' + esc(stage.id) + '">Rename</button>' +
    '<button class="link" data-act="pin" data-stage="' + esc(stage.id) + '">' + (stage.pinned ? 'Unpin' : 'Pin') + '</button>' +
    (others.length ? '<button class="link" data-act="merge" data-stage="' + esc(stage.id) + '">Merge…</button>' : '') +
    (stage.stale ? '<button class="link" data-act="refreshStage" data-stage="' + esc(stage.id) + '">Update this stage</button>' : '') +
    '<span class="spacer"></span><button class="link" data-act="close">Close</button></h2>' +
    '<div class="story"><b>In</b><span>' + esc(stage.input || '—') + '</span><b>Then</b><span>' + esc(stage.gist || '—') + '</span><b>Out</b><span>' + esc(stage.output || '—') + '</span></div>';
  html += '<div class="section"><h3>Steps across files</h3><ol class="steps">' + stage.steps.map(step => {
    const key = stage.id + ':' + step.position, shown = ui.pseudo[key];
    return '<li><div class="row"><span class="muted">' + (step.position + 1) + '.</span><span class="symbol">' + esc(step.symbol) + '</span>' +
      '<button class="chip" data-act="jump" data-file="' + esc(step.file) + '" data-line="' + (step.line_start || 1) + '" title="Open the source line">' + esc(step.file) + ':' + (step.line_start || '?') + '</button>' +
      (step.missing ? '<span class="muted">(no longer in the code)</span>' : '') +
      '<button class="link" data-act="flow" data-file="' + esc(step.file) + '" data-line="' + (step.line_start || 1) + '" title="Zoom: this file\\'s File Flow, at this step">File Flow</button>' +
      (step.pseudocode ? '<button class="link" data-act="pseudo" data-key="' + esc(key) + '">' + (shown ? 'Hide' : 'Pseudocode') + '</button>' : '<span class="muted">no cached pseudocode</span>') +
      '<span class="spacer"></span><select data-act="move" data-stage="' + esc(stage.id) + '" data-position="' + step.position + '" aria-label="Move step"><option value="">Move to…</option>' + others.map(item => '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>').join('') + '<option value="__new">New stage (split)</option></select></div>' +
      (shown && step.pseudocode ? '<pre>' + esc(step.pseudocode) + '</pre>' + (step.pseudocodeCurrent ? '' : '<div class="muted">Pseudocode is from an older version of this file.</div>') : '') + '</li>';
  }).join('') + '</ol></div>';
  html += extraCardSections(stage);
  return html + '</section>';
}
// Later milestones add sections (notes, steer) here.
function extraCardSections() { return ''; }
function activity() {
  if (!ui.activity || !state.activity) return '';
  const { total, calls, day } = state.activity;
  return '<section class="card activity"><h2>Activity · ' + esc(day) + '<span class="spacer"></span><button class="link" data-act="activity">Close</button></h2>' +
    '<p class="muted">' + total.calls + ' model call' + (total.calls === 1 ? '' : 's') + ' today · input ' + tokens(total.input) + ' · cached ' + tokens(total.cached) + ' · output ' + tokens(total.output) + ' · ' + money(total.cost) +
    (state.budget ? ' · budget ' + (state.budget.perDay ? tokens(state.budget.perDay) + '/day' : 'no daily limit') + ', ' + (state.budget.perRun ? tokens(state.budget.perRun) + '/run' : 'no run limit') : '') + '</p>' +
    (calls.length ? '<table><tr><th>When</th><th>Trigger</th><th>Model</th><th>Stage</th><th>Input</th><th>Cached</th><th>Output</th><th>Cost</th><th>Note</th></tr>' + calls.map(call =>
      '<tr><td>' + esc(call.at.slice(11, 19)) + '</td><td>' + esc(call.trigger) + '</td><td>' + esc(call.model || '') + '</td><td>' + esc(call.stage_id || '') + '</td><td>' + tokens(call.input_tokens) + (call.estimated ? '*' : '') + '</td><td>' + tokens(call.cached_tokens) + '</td><td>' + tokens(call.output_tokens) + '</td><td>' + money(call.cost_usd) + '</td><td>' + esc(call.note || '') + '</td></tr>').join('') + '</table><p class="muted">* estimated: the provider reported no usage.</p>' : '<p class="muted">No model calls today. Opening stages, cards and notes never calls a model.</p>') + '</section>';
}
function body() {
  if (state.unavailable) return '<p class="error">' + esc(state.unavailable) + '</p>';
  let html = header();
  if (state.error) html += '<p class="error">' + esc(state.error) + '</p>';
  if (state.busy) html += '<p class="notice">' + esc(state.busy) + '</p>';
  if (state.notice) html += '<p class="notice">' + esc(state.notice) + '</p>';
  if (state.outdated) html += '<p class="notice">The stage model or prompt changed since these stages were made. They still work; <button class="link" data-act="regenerate">regenerate</button> when you want.</p>';
  html += reviewBar();
  if (!state.workflow) html += '<div class="empty"><p>No stages yet. Pick where a workflow starts (for example the function that runs your agent loop); Yamori groups the code it reaches into 3–7 stages from its AI notes.</p><button class="primary" data-act="fromEntry">Choose an entry point…</button></div>';
  html += activity() + graph() + reviewPanel() + card();
  return html;
}
function reviewBar() { return ''; }
function reviewPanel() { return ''; }
function render() {
  document.getElementById('app').innerHTML = body();
  const select = document.getElementById('workflow');
  if (select) select.onchange = () => { ui.open = undefined; save(); send('workflow', { id: select.value }); };
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-act], [data-stage].stage');
  if (!target || target.tagName === 'SELECT') return;
  const act = target.dataset.act, stage = target.dataset.stage;
  if (!act && stage) { ui.open = ui.open === stage ? undefined : stage; save(); send('openStage', { id: ui.open }); render(); return; }
  switch (act) {
    case 'close': ui.open = undefined; save(); send('openStage', {}); render(); break;
    case 'activity': ui.activity = !ui.activity; save(); render(); break;
    case 'pseudo': ui.pseudo[target.dataset.key] = !ui.pseudo[target.dataset.key]; save(); render(); break;
    case 'jump': case 'flow': send(act, { file: target.dataset.file, line: Number(target.dataset.line) }); break;
    default: if (handleAction(act, target)) break; send(act, { stage, ...target.dataset });
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset?.act === 'move' && target.value) send('move', { stage: target.dataset.stage, position: Number(target.dataset.position), to: target.value === '__new' ? '' : target.value });
});
// Later milestones handle their own actions here; return true when handled.
function handleAction() { return false; }
window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type !== 'state') return;
  state = message.state;
  if (ui.open && !(state.workflow?.stages || []).some(stage => stage.id === ui.open)) { ui.open = undefined; save(); }
  if (ui.open && state.card?.id !== ui.open) send('openStage', { id: ui.open });
  render();
});
send('ready', { open: ui.open });
</script></body></html>`;
}

module.exports = { stagesHTML, lineDiff };
