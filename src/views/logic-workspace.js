'use strict';

const LOGIC_STYLE = [
  'body[data-workspace] { height:100vh; display:flex; flex-direction:column; overflow:hidden; --logic-accent:var(--read-link,var(--vscode-textLink-foreground,oklch(72% .151 252))); --logic-warning:var(--vscode-editorWarning-foreground,oklch(80% .123 80)); --logic-wash:var(--read-header); --logic-mono:var(--vscode-editor-font-family,ui-monospace,monospace); background:var(--read-page); color:var(--read-ink); }',
  'body[data-workspace] header { flex:none; padding:9px 13px 5px; }',
  'body[data-workspace] header .top { margin-bottom:5px; }',
  'body[data-workspace] .workspace-nav, body[data-workspace] .segments { border:0; }',
  'body[data-workspace] .workspace-nav button { border-radius:5px; }',
  'body[data-workspace] .segments button[aria-pressed="true"] { border-color:var(--logic-accent); }',
  'body[data-workspace] #files { margin-left:auto; }',
  'body[data-workspace] #refresh, body[data-workspace] #detail-label, body[data-workspace] .brand { display:none; }',
  'body[data-workspace] main { width:100%; flex:1; min-height:0; display:flex; flex-direction:column; margin:0; max-width:none; padding:0; }',
  '.logic-shell { display:flex; flex:1; min-height:0; flex-direction:column; }',
  '.logic-tools,.logic-filters,.logic-command,.logic-keys,.logic-pager { display:flex; align-items:center; gap:6px; padding:5px 12px; border-bottom:1px solid var(--read-border); flex-wrap:wrap; }',
  '.logic-shell button { border-radius:4px; min-height:24px; padding:1px 6px; font-weight:500; }',
  '.logic-shell button:focus-visible { outline:1px solid var(--vscode-focusBorder,var(--logic-accent)); outline-offset:1px; }',
  '.logic-tools .logic-primary,.logic-shell .logic-primary { color:var(--vscode-button-foreground,oklch(94% .025 250)); background:var(--vscode-button-background,oklch(42% .095 252)); }',
  '.logic-shell .logic-primary:hover:not(:disabled) { background:var(--vscode-button-hoverBackground,oklch(47% .095 252)); }',
  '.logic-activity-controls { margin-left:auto; display:grid; justify-items:end; gap:1px; max-width:100%; } .logic-usage { color:var(--read-muted); font:10px/1.5 var(--logic-mono); overflow-wrap:anywhere; }',
  '.logic-filters button { border:1px solid var(--read-border); border-radius:14px; padding-inline:8px; }',
  '.logic-filters button[aria-pressed="true"] { border-color:var(--logic-accent); background:var(--logic-wash); }',
  '.logic-warning { color:var(--logic-warning); }',
  '.logic-ticks { display:flex; gap:2px; flex:1 1 44px; max-width:220px; min-width:24px; overflow:auto; scrollbar-width:thin; }',
  '.logic-ticks button { flex:0 0 4px; min-width:0; padding:0; min-height:8px; border:0; border-radius:1px; background:color-mix(in srgb,var(--read-muted) 24%,transparent); }',
  '.logic-ticks .risk { background:var(--logic-warning); } .logic-ticks .reviewed { background:var(--logic-accent); }',
  '.logic-scroll { min-height:0; flex:1; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }',
  '.logic-file { padding:10px 13px 8px; border-bottom:1px solid var(--read-border); }',
  '.logic-file h1 { font-size:15px; letter-spacing:0; margin:0; line-height:1.4; } .logic-file p { color:var(--read-muted); margin:2px 0 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
  '.logic-queue { padding:4px 8px 8px; } .logic-empty { color:var(--read-muted); margin:12px 5px; }',
  '.logic-row { border:1px solid transparent; border-radius:6px; margin-bottom:3px; }',
  '.logic-row:hover { background:var(--read-surface); } .logic-row[aria-current="true"] { border-color:var(--read-border); }',
  '.logic-row.at-cursor { border-color:var(--read-border); } .logic-row.at-cursor > .logic-row-main { background:var(--read-header); border-radius:5px; }',
  '.logic-row.reviewed .logic-row-main { opacity:.62; }',
  '.logic-row-main { min-height:46px; display:grid; grid-template-columns:auto auto 2ch minmax(0,1fr) fit-content(42%); align-items:center; gap:5px; padding:3px 6px; }',
  '.logic-row-main input { margin:0; accent-color:var(--vscode-testing-iconPassed,var(--diff-add)); }',
  '.logic-row-center { min-width:0; } .logic-row-main button.logic-title { display:block; width:100%; min-width:0; text-align:left; padding:0 3px; } .logic-title strong { display:block; font-weight:550; overflow-wrap:anywhere; }',
  '.logic-index,.logic-symbol,.logic-chip,.logic-scope,.logic-keys kbd,.logic-pager output { font-family:var(--logic-mono); font-size:11px; } .logic-index { color:var(--read-muted); }',
  '.logic-symbol { color:var(--logic-accent); overflow-wrap:anywhere; min-width:0; } .logic-meta,.logic-row-actions,.logic-badges { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }',
  '.logic-token-estimate { color:var(--read-muted); font-size:10px; min-width:0; overflow-wrap:anywhere; }',
  '.logic-chip,.logic-badge { border:1px solid var(--read-border); border-radius:3px; padding:0 4px; font-size:10px; color:var(--read-muted); white-space:nowrap; }',
  '.logic-shell button.logic-chip { min-height:18px; } .logic-badge.logic-warning { color:var(--logic-warning); } .cursor-tag { color:var(--logic-accent); }',
  '.logic-row-actions { opacity:0; } .logic-row:hover .logic-row-actions,.logic-row:focus-within .logic-row-actions { opacity:1; } .logic-badges { justify-content:flex-end; min-width:0; } .logic-badge { max-width:100%; overflow:hidden; text-overflow:ellipsis; }',
  '.logic-row details { position:relative; } .logic-row-actions summary { cursor:pointer; list-style:none; padding:1px 5px; } .logic-row-actions summary::-webkit-details-marker { display:none; } .logic-overflow { position:absolute; z-index:2; inset-inline-end:0; min-width:145px; padding:4px; background:var(--read-surface); border:1px solid var(--read-border); } .logic-overflow button { width:100%; text-align:left; }',
  '.logic-block { padding:3px 9px 8px; } .logic-block .code-line { display:grid; grid-template-columns:2em minmax(0,1fr) auto auto; gap:5px; font-size:13px; border-radius:4px; align-items:baseline; min-height:25px; padding:2px 4px; }',
  '.logic-block .code-line.active-step { background:var(--read-header); box-shadow:inset 0 0 0 1px var(--read-border); } .logic-block .code-line.linked:hover { background:var(--read-hover); color:var(--read-ink); } .logic-block .step-body { min-width:0; overflow-wrap:anywhere; } .logic-block math { display:inline-block; overflow-x:auto; vertical-align:middle; }',
  '.logic-block .code-line button.logic-pencil { opacity:.35; } .logic-block .code-line:hover .logic-pencil,.logic-block .code-line:focus-within .logic-pencil { opacity:1; }',
  '.logic-fields { margin:5px 0 10px; } .logic-fields div { display:grid; grid-template-columns:80px minmax(0,1fr); gap:6px; }',
  '.logic-fields dt,.logic-field-label { color:var(--read-muted); font-size:10px; text-transform:uppercase; letter-spacing:.07em; font-weight:600; } .logic-fields dd { margin:0; overflow-wrap:anywhere; }',
  '.logic-detail { padding:2px 4px 2px 2.5em; color:var(--read-muted); font-size:11px; cursor:pointer; overflow-wrap:anywhere; } .logic-detail b { font-size:9px; margin-inline-end:5px; border:1px solid var(--read-border); border-radius:3px; padding:0 4px; }',
  '.logic-actions,.logic-edit-actions { display:flex; flex-wrap:wrap; gap:5px; margin-block:6px; }',
  '.logic-actions button,.logic-edit-actions button { border:1px solid var(--read-border); }',
  '.logic-edit { border:1px solid var(--read-border); background:var(--read-header); overflow-wrap:anywhere; padding:6px 8px; border-radius:5px; margin:3px 0; }',
  '.logic-edit .was { color:var(--read-muted); font-size:11px; margin:2px 0 5px; } .logic-edit textarea,.logic-command textarea { width:100%; box-sizing:border-box; resize:vertical; color:var(--vscode-input-foreground,var(--read-ink)); background:var(--vscode-input-background,var(--read-page)); border:1px solid var(--read-border); border-radius:5px; padding:5px 7px; font:inherit; } .logic-edit textarea:focus,.logic-command textarea:focus { outline:1px solid var(--vscode-focusBorder,var(--logic-accent)); }',
  '.logic-edit-message,.logic-hint { color:var(--read-muted); font-size:11px; margin:3px 0; } .logic-edit-message.error { color:var(--vscode-errorForeground,var(--diff-remove)); }',
  '.logic-answer { flex-basis:100%; min-width:0; max-width:100%; max-height:28vh; overflow:auto; padding:4px 0; }',
  '.logic-card { padding:8px; } .logic-card h2 { margin:5px 0; } .logic-card .logic-block { padding-inline:0; }',
  '.logic-keys,.logic-command { border-top:1px solid var(--read-border); border-bottom:0; flex:none; } .logic-keys { color:var(--read-muted); padding-block:3px; font-size:11px; } .logic-keys kbd { background:var(--read-surface); padding:1px 3px; border-radius:3px; }',
  '.logic-command textarea { flex:1; min-width:8em; min-height:30px; height:30px; resize:none; } .logic-edit textarea { min-height:54px; } .logic-command .logic-proposal { flex-basis:100%; display:flex; align-items:center; flex-wrap:wrap; gap:5px; } .logic-scope { color:var(--logic-accent); border:1px solid var(--read-border); background:var(--logic-wash); max-width:33%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
  '.logic-terminal-status { flex-basis:100%; margin:0; color:var(--vscode-errorForeground,var(--read-ink)); overflow-wrap:anywhere; }',
  '.logic-activity { max-height:36vh; overflow:auto; padding:8px 12px; background:var(--read-surface); border-bottom:1px solid var(--read-border); }',
  '.logic-activity-head { display:grid; grid-template-columns:56px minmax(0,1fr) auto; align-items:center; gap:9px; } .logic-activity-copy { min-width:0; overflow-wrap:anywhere; } .logic-activity-copy strong { font-size:13px; font-weight:600; } .logic-activity-detail { margin:1px 0 0; color:var(--read-muted); font-size:11px; }',
  '.logic-activity-actions { display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:4px; } .logic-activity-actions button { border:1px solid var(--read-border); }',
  '.logic-activity-scene { display:flex; align-items:center; justify-content:center; gap:1px; min-height:38px; border:1px solid var(--read-border); border-radius:6px; background:var(--read-page); } .logic-activity-mascot { width:23px; height:23px; object-fit:contain; image-rendering:pixelated; }',
  '.logic-activity-prop { color:var(--logic-accent); font:600 14px/1 system-ui,sans-serif; min-width:12px; text-align:center; } .logic-activity-scene[data-stage="failed"] .logic-activity-prop { color:var(--vscode-errorForeground,var(--diff-remove)); } .logic-activity-scene[data-stage="done"] .logic-activity-prop { color:var(--diff-add); }',
  '.logic-activity-scene[data-stage="read"] .logic-activity-mascot { animation:logic-gecko-read 1.3s steps(3,end) infinite; } .logic-activity-scene[data-stage="think"] .logic-activity-prop { animation:logic-gecko-think 1.25s steps(3,end) infinite; } .logic-activity-scene[data-stage="write"] .logic-activity-mascot,.logic-activity-scene[data-stage="preview"] .logic-activity-mascot { animation:logic-gecko-review 1.7s steps(2,end) infinite; } .logic-activity-scene[data-stage="write"] .logic-activity-prop,.logic-activity-scene[data-stage="apply"] .logic-activity-prop,.logic-activity-scene[data-stage="preview"] .logic-activity-prop { animation:logic-gecko-write .85s steps(3,end) infinite; } .logic-activity-scene[data-stage="review"] .logic-activity-mascot { animation:logic-gecko-review 1.35s steps(2,end) infinite; }',
  '@keyframes logic-gecko-read { 0%,100% { transform:translateX(-2px); } 50% { transform:translateX(2px); } } @keyframes logic-gecko-think { 0%,100% { opacity:.5; } 65% { opacity:1; } } @keyframes logic-gecko-write { 0%,100% { transform:translate(-1px,1px) rotate(-10deg); } 55% { transform:translate(2px,-1px) rotate(10deg); } } @keyframes logic-gecko-review { 0%,100% { transform:rotate(0); } 50% { transform:rotate(9deg); } }',
  '@media (prefers-reduced-motion:reduce) { .logic-activity-scene .logic-activity-mascot,.logic-activity-scene .logic-activity-prop { animation:none !important; } }',
  '.activity-toggle[aria-expanded="true"] { background:var(--read-header); } .logic-activity-indicator { display:inline-block; width:5px; height:5px; margin-inline-end:5px; vertical-align:middle; border-radius:100%; background:var(--logic-accent); }',
  '.logic-activity-history { margin:4px 0 0 65px; color:var(--read-muted); } .logic-activity-history summary { cursor:pointer; font-size:11px; width:fit-content; } .logic-activity ol { margin:4px 0 0; padding:0; list-style:none; } .logic-activity li { padding:4px 0; border-top:1px solid var(--read-border); white-space:pre-wrap; overflow-wrap:anywhere; color:var(--read-ink); font-size:11px; } .logic-activity time { margin-inline-end:6px; color:var(--read-muted); font:10px/1.5 var(--logic-mono); }',
  '@media(max-width:360px) { .logic-activity-head { grid-template-columns:48px minmax(0,1fr); gap:5px 8px; } .logic-activity-actions { grid-column:2; justify-content:flex-start; } .logic-activity-history { margin-inline-start:56px; } }',
  '.logic-agent { min-height:26px; max-width:100%; font:inherit; color:var(--read-ink); background:var(--read-page); border:1px solid var(--read-border); border-radius:4px; }',
  '.logic-flow-mode { display:flex; flex-direction:column; } .logic-flow-chrome { display:flex; align-items:center; justify-content:flex-end; gap:5px; padding:3px 12px; border-bottom:1px solid var(--read-border); }',
  '.logic-flow-body { display:flex; flex:1; min-height:0; min-width:0; flex-direction:column; } .logic-flow-graph { flex:0 1 35%; min-height:min(202px,37vh); max-height:230px; display:flex; flex-direction:column; min-width:0; overflow:hidden; background:var(--read-page); border-bottom:1px solid var(--read-border); }',
  '.logic-flow-chrome .logic-flow-back { margin-inline-end:auto; } .logic-flow-mode.card-open .logic-flow-body { display:flex; } .logic-flow-mode.card-open .logic-tools > :not(.logic-activity-controls) { display:none; }',
  '.logic-flow-caption { padding:5px 11px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; column-gap:7px; border-bottom:1px solid var(--read-border); } .logic-flow-caption small { color:var(--read-muted); font-size:10px; }',
  '.logic-flow-viewport { position:relative; flex:1; min-height:0; overflow:auto; } .logic-flow-canvas { position:relative; width:100%; min-width:0; box-sizing:border-box; padding:6px 9px 9px; } .logic-flow-lanes { display:grid; grid-template-columns:repeat(var(--flow-columns,1),minmax(0,1fr)); align-items:start; gap:6px; } .logic-flow-lane { display:grid; grid-template-columns:minmax(0,1fr); gap:3px; } .logic-flow-lane h3 { margin:0 0 1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
  '.logic-flow-svg { position:absolute; inset:0; overflow:visible; pointer-events:none; width:100%; height:100%; } .logic-flow-svg path { fill:none; stroke:var(--read-muted); stroke-width:1.25; opacity:.48; } .logic-flow-svg .data { stroke-dasharray:3 3; } .logic-flow-svg .incident { opacity:.95; stroke:var(--logic-accent); }',
  '.logic-shell .logic-flow-node { position:relative; display:flex; gap:4px; align-items:center; min-width:0; padding:2px 5px; font-size:11px; min-height:22px; text-align:left; background:var(--read-surface); border:1px solid var(--read-border); } .logic-flow-node span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .logic-flow-node[aria-current="true"] { border-color:var(--logic-accent); outline:1px solid var(--logic-accent); outline-offset:-1px; background:var(--logic-wash); } .logic-flow-node[data-cursor="true"] { box-shadow:inset 0 0 0 1px var(--logic-accent); }',
  '.logic-flow-canvas.isolating .logic-flow-node:not(.connected) { opacity:.35; } .logic-flow-canvas.isolating .logic-flow-svg path:not(.connected) { opacity:.1; } .logic-flow-canvas.isolating .logic-flow-svg path.connected { opacity:.95; }',
  '.logic-flow-node[data-behavior],.logic-flow-mode .logic-row[data-behavior],.logic-flow-mode .logic-card[data-behavior] { border-inline-start:3px solid var(--diff-add); } .logic-flow-node[data-behavior="removed"],.logic-flow-mode .logic-row[data-behavior="removed"],.logic-flow-mode .logic-card[data-behavior="removed"] { border-inline-start-color:var(--diff-remove); } .logic-flow-node[data-behavior="touched"],.logic-flow-mode .logic-row[data-behavior="touched"],.logic-flow-mode .logic-card[data-behavior="touched"] { border-image:linear-gradient(var(--diff-add) 50%,var(--diff-remove) 50%) 1; border-image-width:0 0 0 3px; } .logic-flow-node[data-behavior] { background:color-mix(in srgb,var(--diff-add) 8%,var(--read-surface)); }',
  '.logic-flow-number { font:10px/1.5 var(--logic-mono); color:var(--read-muted); } .logic-flow-risk { margin-inline-start:auto; color:var(--logic-warning); }',
  '.logic-updating { display:inline-block; flex:none; width:8px; height:8px; margin-inline-start:auto; border:1.5px solid var(--read-muted); border-top-color:transparent; border-radius:50%; animation:logic-spin .8s linear infinite; } .logic-flow-risk + .logic-updating { margin-inline-start:3px; } .logic-badge .logic-updating { margin-inline:0 4px; vertical-align:-1px; } @keyframes logic-spin { to { transform:rotate(360deg); } } @media (prefers-reduced-motion:reduce) { .logic-updating { animation:none; border-top-color:var(--read-muted); opacity:.6; } }',
  '.logic-flow-mode.card-inline .logic-flow-graph { max-height:min(230px,34vh); } .logic-auto-notice { font-size:11px; }',
  '.logic-flow-mode .logic-file p { white-space:normal; overflow-wrap:anywhere; } .logic-story { margin:3px 0 0; } .logic-story div { display:grid; grid-template-columns:38px minmax(0,1fr); gap:5px; } .logic-story dd { margin:0; overflow-wrap:anywhere; }',
  '.logic-flow-mode .logic-row-main { grid-template-columns:2ch minmax(0,1fr) fit-content(38%); align-items:start; } .logic-flow-mode .logic-row-main>.logic-index { display:block; padding-top:4px; } .logic-flow-mode .logic-row-main>.logic-disclosure,.logic-flow-mode .logic-row-main>input { display:none; }',
  '.logic-flow-stage { margin:7px 5px 3px; display:flex; align-items:center; gap:8px; } .logic-flow-stage::after { content:""; flex:1; border-top:1px solid var(--read-border); } .logic-gist-step,.logic-behavior-summary { margin:1px 0 4px 3px; overflow-wrap:anywhere; color:var(--read-muted); } .logic-behavior-summary { font-size:11px; } .logic-behavior-summary s { color:var(--diff-remove); } .logic-behavior-summary ins { color:var(--diff-add); text-decoration:none; }',
  '.logic-flow-mode .logic-card:focus-visible { outline:1px solid var(--read-border); } .logic-flow-mode .logic-card { padding:10px 12px; margin:8px; border:1px solid var(--read-border); border-radius:5px; background:var(--read-surface); } .logic-flow-mode .logic-row.at-cursor>.logic-row-main { background:var(--logic-wash); } .logic-flow-mode .logic-tools { border-top:1px solid var(--read-border); } .logic-flow-mode .logic-tools .logic-token-hint { margin-inline-start:auto; font-size:10px; color:var(--read-muted); }',
  '@media(min-width:900px) { .logic-flow-body { display:grid; grid-template-columns:minmax(240px,285px) minmax(0,1fr); } .logic-flow-graph { max-height:none; min-height:0; border-inline-end:1px solid var(--read-border); border-bottom:0; } .logic-flow-canvas { width:auto; } .logic-flow-lanes { grid-template-columns:minmax(0,1fr); } }',
  '@media(max-width:520px) { .logic-flow-lanes { grid-template-columns:repeat(3,minmax(0,1fr)); row-gap:7px; } .logic-flow-caption small { display:none; } .logic-flow-mode .logic-row-main { grid-template-columns:2ch minmax(0,1fr) fit-content(30%); } }',
  '[data-workspace] [hidden] { display:none !important; }',
  '@media(max-width:430px) { .logic-row-main { grid-template-columns:auto auto minmax(0,1fr) fit-content(33%); } .logic-index { display:none; } .logic-badges { max-width:7em; } .logic-row-actions { justify-content:flex-end; } .logic-block { padding-inline:4px; } .logic-block .code-line { grid-template-columns:1.5em minmax(0,1fr) auto; } .logic-block .step-body { grid-column:2 / -1; } .logic-block .logic-pencil { grid-column:2; justify-self:end; } .logic-block .logic-chip { grid-column:3; justify-self:end; } }'
].join('\n');

function logicWorkspaceUI({ node, send, appendInline, appendReply, edgeMark, parseCard, pseudocodeLines, diffSign, appendRemoved, appendTests, mascotImage }) {
  const flowMode = () => !!state?.workspace.flow && !state.comparison;
  const reviewFilters = ['all', 'changed', 'risk', 'unreviewed'];
  let state, shell, toolbar, filters, log, fileHeader, scroll, list, topSpacer, bottomSpacer, shortcuts, command, prompt, scopeChip, sendButton, proposal, composerSelect, terminalStatus;
  let terminalRequest, terminalError;
  let filter = 'all', selected, full, inlineCard = false, auto, cursor, activeStep, rangeStart, draft, activityOpen = false, clearedScope = false;
  let visible = [], rowWindow = [], rendered = new Map(), heights = new Map(), scrollTop = 0, resize, windowFrame, commandId = 0;
  let activityView, graph, flowOutline, flowFull, flowBack, graphView, graphResize, edgeFrame, demandSignature = '';
  let lastVisible = '', lastDoc, lastFocus, cursorChanged, needsMeasure, wasRunning = false, composerProvider;
  const providers = [['codex', 'Codex'], ['claude', 'Claude Code']];

  const button = (label, action, title, className) => {
    const item = node('button', label, className);
    if (title) { item.title = title; item.setAttribute('aria-label', title); }
    item.addEventListener('click', action);
    return item;
  };
  const rows = () => state.workspace.rows;
  const section = row => state.workspace.sections[row.index];
  const record = id => rows().find(row => row.identity === id);
  const updating = row => !!(row.generating || row.queued);
  const documentKey = () => state.documentKey;
  const canAsk = () => state.workspace.editable && !state.sourceMissing;
  const canEdit = row => canAsk() && !state.workspace.undo?.busy && !state.busy && !row.changed && !row.missing;
  const sendRow = (type, row, fields = {}) => send(type, { index: row.index, documentKey: documentKey(), ...fields });
  const rangeLabel = (start, end) => 'L' + start + (end === start ? '' : '–' + end);
  const cardRows = row => parseCard(section(row).pseudocode)?.rows || pseudocodeLines(section(row).pseudocode);
  const stepLines = row => (section(row).lineMap || []).filter(link => {
    const kind = cardRows(row)[link.pseudocodeLine - 1]?.kind;
    return kind && kind.startsWith('card-') ? kind === 'card-step' : !!cardRows(row)[link.pseudocodeLine - 1]?.text.trim() && kind !== 'note';
  }).sort((a, b) => a.pseudocodeLine - b.pseudocodeLine);
  const stepText = (row, line) => cardRows(row)[line - 1]?.text.trim() || '';
  const opened = row => expanded.has(row.identity) || auto === row.identity;
  const expanded = new Set(), suppressed = new Set();
  const matches = (row, key) => key === 'all' || (key === 'changed' && row.changed) ||
    (key === 'risk' && row.riskCount > 0) || (key === 'unreviewed' && !row.reviewed);
  const filtered = () => rows().filter(row => matches(row, filter));
  const isInput = el => ['TEXTAREA', 'INPUT', 'SELECT'].includes(el?.tagName) || el?.isContentEditable;
  const updateAll = () => { if (state.workspace.canUpdate) send('workspaceUpdate'); };
  const review = row => {
    if (row.missing) return;
    if (auto === row.identity) expanded.add(row.identity);
    sendRow('workspaceReview', row, { identity: row.identity, contentHash: row.contentHash });
  };
  const chosenProvider = () => composerProvider || state.workspace.provider || 'codex';
  const terminalOpen = () => state.workspace.terminalProviders?.includes(chosenProvider());
  function providerSelect(label) {
    const select = node('select', undefined, 'logic-agent');
    select.setAttribute('aria-label', label);
    for (const [id, name] of providers) {
      const option = node('option', name);
      option.value = id; select.append(option);
    }
    select.value = chosenProvider();
    select.addEventListener('change', () => {
      composerProvider = select.value;
      if (draft) {
        draft.id = ++commandId;
        if (draft.value.trim() && draft.value.trim() !== draft.before.trim()) { send('workspaceSupersede'); queueDraft(); }
      }
      paint();
    });
    return select;
  }
  const hint = text => node('p', text, 'logic-hint');
  const focusPrompt = () => (terminalOpen() ? sendButton : prompt).focus();
  const scopeTo = row => { clearedScope = !row; if (row) selected = row.identity; updateCommand(); };
  const scrollRow = () => {
    const row = rendered.get(selected)?.el;
    (row?.querySelector?.('.logic-row-main') || row)?.scrollIntoView?.({ block: 'nearest' });
  };

  function choose(row, reveal = true, focus = false) {
    if (!row) return;
    selected = row.identity; activeStep = rangeStart = undefined; clearedScope = false;
    if (reveal) sendRow('reveal', row);
    if (flowMode() && full && !draft) { full = row.identity; inlineCard = !!(row.changed || row.behavior || updating(row)); scroll.scrollTop = 0; }
    if (!full && !rendered.has(selected)) {
      scroll.scrollTop = offsetAt(outlineRows().indexOf(row));
      scrollTop = scroll.scrollTop;
    }
    paint();
    if (focus) rendered.get(selected)?.el.focus();
    scrollRow();
  }

  function setFilter(key, focus) {
    if (!reviewFilters.includes(key)) return;
    filter = key; full = undefined; scroll.scrollTop = scrollTop = 0;
    if (focus) selected = focus.identity;
    else if (!record(selected) || !matches(record(selected), filter)) selected = filtered()[0]?.identity;
    toolbarState();
    paint();
    if (focus) { choose(focus); scrollRow(); }
    else filters.querySelector?.('[aria-pressed="true"]')?.focus();
  }

  function toggle(row) {
    if (opened(row)) {
      if (draft?.row === row.identity) return;
      expanded.delete(row.identity);
      if (auto === row.identity) { suppressed.add(row.identity); auto = undefined; }
    } else expanded.add(row.identity);
    paint();
  }

  function zoom(row) {
    if (!row || full === row.identity || (draft && draft.row !== row.identity)) return;
    if (!full) scrollTop = scroll.scrollTop;
    if (selected !== row.identity) activeStep = rangeStart = undefined;
    full = row.identity; selected = row.identity;
    // A changed block opens under the graph, so its ± and neighbours stay in view.
    inlineCard = flowMode() && !!(row.changed || row.behavior || updating(row));
    if (flowMode()) {
      clearedScope = false;
      sendRow('reveal', row); scroll.scrollTop = 0;
    } else expanded.add(row.identity);
    paint();
    (flowMode() ? rendered.get(selected)?.el : list.querySelector?.('.logic-pager button'))?.focus();
  }

  function back() {
    if (draft) return;
    const outlineTop = scrollTop;
    full = undefined; inlineCard = false;
    paint();
    scroll.scrollTop = outlineTop;
    if (flowMode()) {
      mountVisible();
      const target = rendered.get(selected)?.el || graphView?.nodes.get(record(selected)?.index)?.el || flowFull;
      target?.focus({ preventScroll: true });
    } else rendered.get(selected)?.el.focus();
  }

  function pickStep(row, line, extend = false) {
    if (!extend || selected !== row.identity) rangeStart = line;
    activeStep = line; selected = row.identity; clearedScope = false;
    sendRow('revealStep', row, { pseudocodeLine: line });
    syncActiveSteps(row);
    updateCommand();
  }

  function selectedLines(row) {
    const steps = stepLines(row);
    if (!steps.some(step => step.pseudocodeLine === activeStep)) {
      const first = steps.find(step => cursor >= step.startLine && cursor <= step.endLine) || steps[0];
      return first ? [first.pseudocodeLine] : [];
    }
    return steps.map(step => step.pseudocodeLine).filter(line =>
      line >= Math.min(activeStep, rangeStart ?? activeStep) && line <= Math.max(activeStep, rangeStart ?? activeStep));
  }

  function beginEdit(row, line) {
    if (!canEdit(row) || draft) return;
    if (line) { rangeStart = activeStep = line; selected = row.identity; }
    const lines = selectedLines(row);
    if (!lines.length) return;
    const before = lines.map(line => stepText(row, line)).join('\n');
    draft = { row: row.identity, lines, before, value: before, id: ++commandId, timer: undefined };
    if (flowMode() && !full) zoom(row);
    else { expanded.add(row.identity); paint(); }
    draft.field?.focus(); draft.field?.setSelectionRange(before.length, before.length);
  }

  function queueDraft(force = false) {
    if (!draft || draft.value.trim() === draft.before.trim() || !draft.value.trim()) return;
    clearTimeout(draft.timer);
    const current = draft;
    const ask = () => {
      const row = record(current.row);
      if (current !== draft || !row) return;
      sendRow('workspacePreview', row, {
        clientId: current.id, mode: 'step', provider: chosenProvider(), lines: current.lines,
        instruction: 'Replace the behavior described by these existing steps: ' + current.before + '\nNew behavior: ' + current.value.trim()
      });
    };
    if (force) ask(); else draft.timer = setTimeout(ask, 350);
  }

  function endDraft() {
    if (!draft || state.workspace.proposal?.phase === 'applying') return;
    const row = draft.row;
    clearTimeout(draft.timer); draft = undefined;
    send('workspaceCancel'); paint();
    rendered.get(row)?.el.focus();
  }

  function createDraft() {
    if (draft.el) return draft.el;
    const el = node('div', undefined, 'logic-edit'), was = node('p', 'was: ', 'was');
    was.append(node('s', draft.before)); el.append(was);
    const field = node('textarea');
    field.value = draft.value; field.rows = 2; field.setAttribute('aria-label', 'New pseudocode step');
    const current = draft;
    field.addEventListener('input', () => {
      if (draft !== current) return;
      draft.value = field.value; draft.id = ++commandId;
      send(draft.value.trim() && draft.value.trim() !== draft.before.trim() ? 'workspaceSupersede' : 'workspaceCancel');
      queueDraft(); updateDraft();
    });
    const controls = node('div', undefined, 'logic-edit-actions');
    const apply = button('Apply to code ' + state.workspace.keywords + '↵', applyDraft, 'Apply the preview to code', 'logic-primary');
    const diff = button('Preview diff', () => {
      const pending = state.workspace.proposal;
      if (draft.id === pending?.clientId && pending.ready) send('workspaceShowDiff', { id: pending.id });
      else { draft.openWhenReady = true; queueDraft(true); }
    });
    const cancel = button('Cancel', endDraft, 'Cancel draft (Esc)');
    const agent = providerSelect('AI for this step edit');
    controls.append(apply, diff, cancel, agent);
    const message = hint(''); message.setAttribute('role', 'status');
    el.append(field, controls, message);
    Object.assign(draft, { el, field, apply, diff, cancel, message, agent }); updateDraft();
    return el;
  }

  function applyDraft() {
    const item = state.workspace.proposal;
    if (draft && item?.clientId === draft.id && item.ready) {
      draft.applying = item.id; send('workspaceAccept', { id: item.id });
    }
  }

  function updateDraft() {
    if (!draft?.el) return;
    const pending = state.workspace.proposal, item = pending?.clientId === draft.id ? pending : undefined;
    const changed = draft.value.trim() !== draft.before.trim() && !!draft.value.trim();
    draft.apply.disabled = !item?.ready || !canAsk();
    draft.diff.disabled = !changed || !canAsk() || item?.phase === 'previewing' || item?.phase === 'applying';
    draft.cancel.disabled = item?.phase === 'applying';
    if (item?.ready && draft.openWhenReady) { draft.openWhenReady = false; send('workspaceShowDiff', { id: item.id }); }
    draft.field.disabled = item?.phase === 'applying';
    draft.agent.value = chosenProvider(); draft.agent.disabled = !!draft.field.disabled || !canAsk();
    draft.apply.textContent = item?.phase === 'applying' ? 'Applying…' : 'Apply to code ' + state.workspace.keywords + '↵';
    draft.diff.textContent = item?.phase === 'previewing' ? 'Previewing…' : 'Preview diff';
    draft.message.className = 'logic-edit-message' + (['error', 'stale'].includes(item?.phase) ? ' error' : '');
    draft.message.textContent = item?.phase === 'stale' || item?.phase === 'error' ? item.message : '';
  }

  function submit() {
    const instruction = prompt.value.trim();
    const running = terminalOpen();
    if (!canAsk() || (!running && !instruction) || sendButton.disabled || draft || terminalRequest) return;
    const row = clearedScope ? undefined : record(selected);
    terminalError = undefined;
    terminalRequest = { clientId: ++commandId, instruction: running ? undefined : instruction };
    send('workspaceTerminal', { ...terminalRequest, provider: chosenProvider(), index: row?.index, documentKey: documentKey() });
    updateCommand();
  }

  function terminalResult(message) {
    if (!terminalRequest || terminalRequest.clientId !== message.clientId) return;
    if (!message.error && prompt.value.trim() === terminalRequest.instruction) prompt.value = '';
    terminalError = message.error;
    terminalRequest = undefined;
    updateCommand();
  }

  function askTest(row) {
    if (!canEdit(row) || !row.riskCount) return;
    const risks = cardRows(row).flatMap((item, i) => item.kind === 'card-risk' ? [i + 1] : []);
    sendRow('workspacePreview', row, { clientId: ++commandId, mode: 'test', provider: chosenProvider(), lines: risks,
      instruction: 'Draft a focused regression test for these Worth checking items. Verify each risk against the implementation: ' + risks.map(line => stepText(row, line)).join('\n') });
  }

  function updateCommand() {
    const row = clearedScope ? undefined : record(selected), item = state.workspace.proposal;
    const running = terminalOpen();
    scopeChip.hidden = !row;
    scopeChip.textContent = row ? (row.symbol || row.title) + ' ×' : '';
    scopeChip.title = 'Clear block scope';
    prompt.placeholder = running ? 'Continue the conversation in the terminal…' :
      row ? 'Ask in terminal about ' + (row.symbol || row.title) + '…' : 'Ask in terminal about this file…';
    prompt.disabled = !canAsk() || running || !!terminalRequest;
    composerSelect.value = chosenProvider(); composerSelect.disabled = !canAsk() || !!terminalRequest || item?.phase === 'applying';
    prompt.title = canAsk() ? '' : 'Requires a trusted workspace and available source';
    sendButton.textContent = running ? 'Open terminal' : terminalRequest ? 'Opening…' : '→';
    sendButton.title = running ? 'Focus the active terminal' : 'Send to terminal';
    sendButton.setAttribute('aria-label', running ? 'Open active terminal' : 'Send to terminal');
    sendButton.disabled = !canAsk() || !!terminalRequest || state.workspace.undo?.busy || !!draft ||
      (!running && !prompt.value.trim()) || ['previewing', 'applying'].includes(item?.phase);
    terminalStatus.hidden = !terminalError;
    terminalStatus.textContent = terminalError || '';
    proposal.replaceChildren();
    const undo = state.workspace.undo;
    proposal.hidden = !item && (!undo || !!draft) || item?.mode === 'step';
    if (proposal.hidden) return;
    if (!item) {
      const revert = button(undo.busy ? 'Undoing…' : 'Undo Yamori edit', () => send('workspaceUndo', { id: undo.id }));
      revert.disabled = undo.busy || !!undo.error || !canAsk();
      proposal.append(revert);
      if (undo.error) proposal.append(hint(undo.error));
      return;
    }
    if (item.phase === 'ready') {
      const accept = button(item.mode === 'test' ? 'Accept test' : 'Apply to code', () => send('workspaceAccept', { id: item.id }), undefined, 'logic-primary');
      accept.disabled = !canAsk(); proposal.append(accept, button('Preview diff', () => send('workspaceShowDiff', { id: item.id })));
    }
    const owner = providers.find(([id]) => id === item.provider)?.[1];
    if (owner) proposal.append(node('span', owner, 'logic-badge'));
    if (item.estimate) {
      const { kind, tokens, model, actualModel, reportedInput } = item.estimate;
      const count = node('span', '~' + formatTokens(tokens) + ' tok · ' + kind, 'logic-token-estimate');
      count.title = 'Estimated block input for ' + (actualModel || model || owner || 'the selected model') +
        (reportedInput === undefined ? '' : '. Provider reported ' + formatTokens(reportedInput) + ' input tokens for the full request.');
      proposal.append(count);
    }
    if (item.phase === 'answer' || item.ready && item.message) {
      const answer = node('div', undefined, 'logic-answer');
      appendReply(answer, item.message || ''); proposal.append(answer);
    } else proposal.append(node('span', item.phase === 'previewing' ? 'Preparing preview…' : item.phase === 'applying' ? 'Applying…' : item.message || 'Preview ready'));
    if (item.phase !== 'applying') proposal.append(button(item.phase === 'answer' ? 'Dismiss' : 'Cancel', () => send('workspaceCancel')));
  }

  function toolbarState() {
    const all = rows(), total = all.length, reviewed = all.filter(row => row.reviewed).length;
    const changed = all.filter(row => row.changed).length, risk = all.filter(row => row.riskCount).length;
    const counts = [total, changed, risk, total - reviewed];
    toolbar.replaceChildren(
      button(changed + ' changed', () => setFilter('changed')),
      button(risk + ' ⚠', () => setFilter('risk'), 'Filter blocks with risks', 'logic-warning'),
      button(reviewed + '/' + total + ' reviewed', () => setFilter('unreviewed'))
    );
    const ticks = node('div', undefined, 'logic-ticks');
    ticks.setAttribute('aria-label', 'Block review progress');
    for (const row of all) {
      const tick = button('', () => setFilter('all', row), ((row.order ?? row.index) + 1) + ' · ' + row.title + (row.symbol ? ' · ' + row.symbol : ''),
        row.reviewed ? 'reviewed' : row.riskCount ? 'risk' : '');
      tick.tabIndex = -1;
      ticks.append(tick);
    }
    if (flowMode()) {
      const behavior = all.filter(row => row.behavior).length;
      toolbar.replaceChildren(button(reviewed + ' of ' + total + ' reviewed', () => setFilter(filter === 'unreviewed' ? 'all' : 'unreviewed')));
      if (behavior) toolbar.append(node('span', behavior + ' behavior change' + (behavior === 1 ? '' : 's'), 'logic-muted'));
      if (filter !== 'all') toolbar.append(button('Clear filter', () => setFilter('all')));
    } else toolbar.append(ticks);
    if (state.workspace.autoRefresh?.notice) toolbar.append(node('span', state.workspace.autoRefresh.notice, 'logic-muted logic-auto-notice'));
    if (!state.workspace.online) toolbar.append(button('Cached · offline', () => send('setup'), 'Connect a provider to update'));
    const activity = button('Activity', () => { activityOpen = !activityOpen; logState(); activity.setAttribute('aria-expanded', String(activityOpen)); }, undefined, 'activity-toggle');
    activity.setAttribute('aria-expanded', String(activityOpen));
    activity.setAttribute('aria-controls', 'logic-activity-panel');
    if (wasRunning) {
      const indicator = node('span', '', 'logic-activity-indicator');
      indicator.setAttribute('aria-hidden', 'true');
      activity.replaceChildren(indicator, node('span', 'Activity'));
    }
    const comparing = state.comparison;
    const update = button(comparing ? comparing.generate || 'Refresh comparison' : state.busy ? 'Updating…' : 'Update all', comparing ?
      () => comparing.generate ? send('explainComparison', { documentKey: documentKey() }) : send('refresh') : updateAll, undefined, 'logic-primary');
    update.disabled = comparing ? !!state.busy : !state.workspace.canUpdate;
    update.title = comparing ? update.textContent : state.workspace.online ? 'Update changed or missing blocks' : 'Requires the Yamori CLI';
    const activityControls = node('div', undefined, 'logic-activity-controls');
    const usage = state.workspace.usage;
    if (!flowMode() && usage) {
      const n = value => (value || 0).toLocaleString();
      const total = node('span', n((usage.input || 0) + (usage.cacheWrite || 0)) + ' in · ' + n(usage.output) + ' out' +
        (usage.cacheRead ? ' · ' + n(usage.cacheRead) + ' cached' : ''), 'logic-usage');
      total.title = 'Provider-reported tokens for this reader session. Input includes cache writes.';
      total.setAttribute('aria-label', 'Token usage · ' + total.textContent);
      activityControls.append(total);
    } else if (!flowMode()) {
      const total = node('span', wasRunning ? 'Tokens pending' : 'No token usage reported', 'logic-usage');
      activityControls.append(total);
    }
    activityControls.append(activity);
    if (flowMode()) toolbar.append(node('span', 'Hover a block for token counts', 'logic-token-hint'));
    toolbar.append(activityControls, update);
    filters.replaceChildren(...['All ', 'Changed ', '⚠ ', 'Unreviewed '].map((label, index) => {
      const key = reviewFilters[index], chip = button(label + counts[index], () => setFilter(key), undefined, key === 'risk' ? 'logic-warning' : undefined);
      chip.setAttribute('aria-pressed', String(filter === key));
      return chip;
    }));
  }

  const activityStages = {
    read: ['Reading source', '≡'], think: ['Working through the code', '···'],
    write: ['Writing pseudocode', '✎'], review: ['Checking the explanation', '✓'],
    preview: ['Preparing a preview', '✎'], apply: ['Applying the edit', '✎'],
    done: ['Finished', '✓'], stopped: ['Stopped', '–'], failed: ['Needs attention', '!'],
    idle: ['Ready', '']
  };

  function currentActivity() {
    const item = state.workspace.proposal, active = state.busy && state.run?.steps?.find(step => step.state === 'active');
    const error = state.error || (item?.phase === 'error' ? item.message : undefined);
    if (error) return ['failed', error];
    if (item?.phase === 'applying') return ['apply', item.message];
    if (item?.phase === 'previewing') return ['preview', item.mode === 'step' ? 'Checking the source for this step' : undefined];
    if (state.review?.state === 'running') return ['review', state.review.text];
    if (active) return [active.id === 'context' ? 'read' : active.id, active.detail || state.progress];
    if (state.busy) return [/writing|updat(e|ing) batch/i.test(state.progress || '') ? 'write' : 'read', state.progress];
    if (state.result?.refinement?.status === 'incomplete') return ['failed', state.result.refinement.warning];
    if (state.run?.state === 'failed') return ['failed', state.cacheWarning || state.activity?.at(-1)];
    if (state.run?.state === 'done' || ['answer', 'ready'].includes(item?.phase)) return ['done', state.activity?.at(-1)];
    if (state.run?.state === 'stopped') return ['stopped'];
    return ['idle', state.cacheWarning || state.modelNotice || state.workspace.activity[0]?.message];
  }

  function createActivity() {
    const head = node('div', undefined, 'logic-activity-head');
    const scene = node('span', undefined, 'logic-activity-scene');
    scene.setAttribute('aria-hidden', 'true');
    const mascot = node('img', undefined, 'logic-activity-mascot');
    mascot.src = mascotImage;
    mascot.alt = '';
    const prop = node('span', undefined, 'logic-activity-prop');
    scene.append(mascot, prop);
    const copy = node('div', undefined, 'logic-activity-copy'), title = node('strong'), detail = node('p', undefined, 'logic-activity-detail');
    title.setAttribute('role', 'status');
    copy.append(title, detail);
    const controls = node('div', undefined, 'logic-activity-actions');
    head.append(scene, copy, controls);
    const history = node('details', undefined, 'logic-activity-history'), entries = node('ol');
    const breakdown = node('details', undefined, 'logic-activity-history'), usageLabel = node('summary'), usageEntries = node('ul');
    breakdown.append(usageLabel, usageEntries);
    history.append(node('summary', 'Recent activity'), entries);
    log.append(head, breakdown, history);
    return { scene, prop, title, detail, controls, breakdown, usageLabel, usageEntries, history, entries };
  }

  function logState() {
    log.hidden = !activityOpen;
    if (!activityOpen) return;
    const panel = activityView ||= createActivity();
    const [stage, detail] = currentActivity();
    const [label, prop] = activityStages[stage] || activityStages.read;
    if (panel.scene.dataset.stage !== stage) panel.scene.dataset.stage = stage;
    if (panel.title.textContent !== label) panel.title.textContent = label;
    if (panel.prop.textContent !== prop) panel.prop.textContent = prop;
    panel.detail.hidden = !detail || detail === label;
    if (panel.detail.textContent !== (detail || '')) panel.detail.textContent = detail || '';
    const stopPreview = state.workspace.proposal?.phase === 'previewing';
    const stop = state.busy || state.review?.state === 'running';
    const reviewStatus = state.result?.refinement?.status;
    const review = !stop && state.workspace.online && state.refinementSteps &&
      (reviewStatus === 'incomplete' ? 'Retry review' : reviewStatus === 'pending' ? 'Review draft' : undefined);
    const retry = state.error && state.workspace.canUpdate;
    const upgrade = state.legacyCardBlocks?.length && state.workspace.online;
    const key = JSON.stringify([stopPreview, stop, review, retry, upgrade]);
    if (panel.actionKey !== key) {
      panel.actionKey = key;
      const controls = [];
      if (stopPreview) controls.push(button('Stop preview', () => send('workspaceCancel')));
      else if (stop) controls.push(button('Stop', () => send('stop')));
      if (retry) controls.push(button('Retry', updateAll));
      if (review) controls.push(button(review, () => send('retryReview')));
      if (upgrade) controls.push(button('Upgrade cards', () => send('upgradeCards')));
      controls.push(button('×', () => {
        activityOpen = false; logState(); toolbarState(); toolbar.querySelector?.('.activity-toggle')?.focus();
      }, 'Close activity'));
      panel.controls.replaceChildren(...controls);
    }
    const usage = state.workspace.flow?.usage;
    const tokens = usage && ('Today · ' + formatTokens(usage.input + usage.cacheWrite) + ' input · ' + formatTokens(usage.cacheRead) +
      ' cached · ' + formatTokens(usage.output) + ' out · ' + (usage.calls?.gist || 0) + ' gist · ' + (usage.calls?.card || 0) + ' card requests' +
      (usage.calls?.review ? ' · ' + usage.calls.review + ' review requests' : '') +
      (state.workspace.flow.budget ? ' · ' + formatTokens(state.workspace.flow.budget) + ' daily budget' : ''));
    if (tokens && !detail) { panel.detail.hidden = false; panel.detail.textContent = tokens; }
    const perAction = Object.entries({ gist: 'Gist', card: 'Cards', review: 'Review', other: 'Other' })
      .flatMap(([key, label]) => usage?.byAction?.[key] ? [[label, usage.byAction[key]]] : []);
    panel.breakdown.hidden = !perAction.length;
    const measured = perAction.reduce((count, [, value]) => count + value.requests, 0);
    const total = Object.values(usage?.calls || {}).reduce((count, value) => count + value, 0);
    const usageKey = JSON.stringify([perAction, total]);
    if (panel.usageKey !== usageKey) {
      panel.usageKey = usageKey;
      panel.usageLabel.textContent = measured < total ? 'Tokens by action since tracking began' : 'Tokens by action today';
      panel.usageEntries.replaceChildren(...perAction.map(([label, value]) => node('li', label + ' · ' + value.requests +
        (value.requests === 1 ? ' request' : ' requests') + ' · ' + formatTokens(value.input) + ' input · ' +
        formatTokens(value.cacheWrite) + ' cache writes · ' + formatTokens(value.cacheRead) + ' cache reads · ' +
        formatTokens(value.output) + ' output' + (Number.isFinite(value.costUsd) ? ' · $' + value.costUsd.toFixed(4) + ' reported' : ''))));
    }
    const events = [...(state.activity || []).slice().reverse().map(message => ({ message })),
      ...state.workspace.activity, ...[tokens, state.cacheWarning, state.modelNotice, state.result?.refinement?.warning,
        ...Object.values(state.checks || {}).flat()].map(message => ({ message }))];
    const seen = new Set([detail, label, 'Token usage updated']);
    const recent = events.filter(({ message }) => {
      if (!message || seen.has(message)) return false;
      seen.add(message); return true;
    }).slice(0, 20);
    panel.history.hidden = !recent.length;
    const historyKey = JSON.stringify(recent);
    if (panel.historyKey === historyKey) return;
    panel.historyKey = historyKey;
    panel.entries.replaceChildren(...recent.map(({ message, at }) => {
      const event = node('li');
      if (Number.isFinite(at)) event.append(node('time', new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
      appendReply(event, message);
      return event;
    }));
  }

  function lineChip(start, end, action) {
    const label = rangeLabel(start, end);
    return button(label, action, 'Jump to ' + label, 'logic-chip');
  }

  function showDiffJump(row, mark) { sendRow('inlineDiffJump', row, { id: mark.id }); }
  function reviewDiff(row) {
    if (!flowMode() || row.behavior?.base !== 'review') return undefined;
    const marks = {}, removed = {};
    for (const step of row.behavior.steps || []) {
      const line = step.pseudocodeLine || 'end';
      if (step.after) marks[line] = { kind: 'added', text: step.after, review: true };
      if (step.before) (removed[line] ||= []).push(step.before);
    }
    return { marks, removed, review: true };
  }

  function removedSteps(parent, diff, line) {
    if (!diff?.review) { appendRemoved(parent, diff?.removed?.[line], state); return; }
    for (const text of diff.removed[line] || []) {
      const row = node('div', undefined, 'code-line diff-removed'), body = node('s', undefined, 'step-body');
      appendInline(body, text);
      row.append(diffSign('removed'), body);
      parent.append(row);
    }
  }

  function syncActiveSteps(row) {
    for (const el of rendered.get(row.identity)?.el.querySelectorAll?.('[data-step]') || []) {
      const line = Number(el.dataset.step);
      const link = section(row).lineMap?.find(item => item.pseudocodeLine === line);
      const range = row.identity === selected && activeStep !== undefined && rangeStart !== undefined &&
        line >= Math.min(activeStep, rangeStart) && line <= Math.max(activeStep, rangeStart);
      el.classList.toggle('active-step', Boolean(range || (row.identity === auto && link && cursor >= link.startLine && cursor <= link.endLine)));
    }
  }

  function blockBody(row, card) {
    const body = node('div', undefined, 'logic-block'), sectionData = section(row);
    if (!sectionData || row.missing) {
      const message = row.generating ? 'Generating pseudocode…' : !state.workspace.online ? 'Pseudocode is unavailable offline.' :
        row.failed ? 'Couldn’t generate this block.' : 'Pseudocode hasn’t been generated yet.';
      const status = hint(message);
      status.setAttribute('role', 'status');
      body.append(status);
      body.setAttribute('aria-busy', String(!!row.generating));
      return body;
    }
    const parsed = parseCard(sectionData.pseudocode);
    const matches = new Map((sectionData.lineMap || []).map(link => [link.pseudocodeLine, link]));
    const diff = reviewDiff(row) || (flowMode() && row.behavior?.base !== 'head' ? undefined :
      state.inlineDiff?.blocks?.[row.index] || state.workspace.diffs?.[row.index]);
    const fields = node('dl', undefined, 'logic-fields'), effects = node('dl', undefined, 'logic-fields');
    const steps = node('div', undefined, 'logic-steps');
    const edges = node('div', undefined, 'logic-edges');
    const actions = node('div', undefined, 'logic-actions');
    const edgeCount = parsed?.rows.filter(item => item.kind === 'card-handled').length || 0;
    let plainCount = 0, parent;
    const rowsByLine = [];
    cardRows(row).forEach((item, index) => {
      const line = index + 1, link = matches.get(line);
      const { kind, text } = item;
      if (!text.trim()) return;
      if (kind === 'card-heading') {
        const pair = /^([A-Z ]+): *(.*)$/.exec(text);
        if (pair?.[1] === 'EDGE CASES') {
          edges.append(node('span', 'Worth checking', 'logic-field-label'), hint(edgeCount + ' handled · ' + row.riskCount + ' to check'));
        } else if (card && pair?.[2]) {
          const field = node('div');
          const value = node('dd');
          appendInline(value, pair[2]); field.append(node('dt', pair[1]), value);
          (flowMode() && pair[1] === 'SIDE EFFECTS' ? effects : fields).append(field);
        }
        return;
      }
      if (kind === 'card-annotation' || kind === 'note') {
        const detail = node('div', undefined, 'logic-detail'), match = /^\s*(WHY|SHAPES|FORMULA): *(.*)$/.exec(text);
        if (match) detail.append(node('b', match[1] === 'SHAPES' ? 'SHAPE' : match[1]));
        appendInline(detail, match?.[2] || text.trim().replace(/^#\s*/, ''));
        const parentStep = parent;
        if (parentStep && matches.has(parentStep)) detail.addEventListener('click', () => pickStep(row, parentStep));
        steps.append(detail);
        return;
      }
      const isEdge = kind === 'card-risk' || kind === 'card-handled';
      const destination = isEdge ? edges : steps;
      removedSteps(destination, diff, line);
      if (draft?.row === row.identity && draft.lines.includes(line)) {
        if (line === draft.lines[0]) steps.append(createDraft());
        return;
      }
      const step = node('div', undefined, 'code-line' + (kind ? ' ' + kind : ''));
      const mark = diff?.marks?.[line];
      if (mark) step.className += ' diff-' + mark.kind;
      rowsByLine[line] = step;
      step.dataset.step = String(line);
      const label = item.number || (!isEdge ? String(++plainCount) : '');
      const marker = mark?.review ? diffSign(mark.kind) : mark ? button(mark.kind === 'added' ? '+' : '−', event => { event.stopPropagation(); showDiffJump(row, mark); }, 'Open source diff', 'diff-sign diff-' + mark.kind) :
        isEdge ? edgeMark(kind) : node('span', label, 'step-number');
      step.append(marker);
      const description = node('span', undefined, 'step-body');
      description.style.paddingInlineStart = Math.min(text.length - text.trimStart().length, 32) * .5 + 'em';
      if (isEdge && mark) description.append(edgeMark(kind), document.createTextNode(' '));
      appendInline(description, text.trimStart());
      step.append(description);
      if (link && !row.changed) {
        const sourceAction = event => {
          event?.stopPropagation?.();
          pickStep(row, line, event?.shiftKey);
        };
        step.className += ' linked';
        step.addEventListener('click', sourceAction);
        step.addEventListener('mouseenter', () => sendRow('hoverStep', row, { pseudocodeLine: line }));
        step.addEventListener('mouseleave', () => send('clearHover'));
        if (!isEdge && canEdit(row)) {
          step.addEventListener('dblclick', event => { event.stopPropagation(); beginEdit(row, line); });
          step.append(button('✎', event => { event.stopPropagation(); beginEdit(row, line); }, 'Edit this step', 'logic-pencil'));
        }
        step.append(lineChip(link.startLine, link.endLine, sourceAction));
      }
      if (!isEdge) parent = line;
      destination.append(step);
    });
    removedSteps(steps, diff, 'end');
    if (card && fields.children.length) body.append(fields);
    if (row.changed && !diff) {
      const status = hint(updating(row) || state.busy ? 'Updating pseudocode…' : 'Refresh this block to compare with its cached steps.');
      if (updating(row)) { status.prepend(node('span', '', 'logic-updating'), document.createTextNode(' ')); status.setAttribute('role', 'status'); }
      body.append(status);
    } else if (updating(row)) {
      const status = hint('Updating pseudocode…');
      status.prepend(node('span', '', 'logic-updating'), document.createTextNode(' ')); status.setAttribute('role', 'status');
      body.append(status);
    }
    if (flowMode() && card) body.append(node('div', 'Steps', 'logic-field-label'));
    body.append(steps);
    if (effects.children.length) body.append(effects);
    if (edges.children.length) body.append(edges);
    const ask = button('Ask agent', () => { scopeTo(row); focusPrompt(); });
    const edit = button('Edit step', () => beginEdit(row));
    ask.disabled = !canAsk(); edit.disabled = !canEdit(row) || !stepLines(row).length;
    actions.append(ask, edit);
    if (card) for (const [title, instruction] of [
      ['Explain better', 'Make this block clearer. Add WHY only for a surprising choice and mark inferences likely:.'],
      ['Make shorter', 'Make this card shorter while preserving all behaviors and source links.'],
      ['Show example', 'Add one concise illustrative example without inventing an API or claiming actual values.']
    ]) {
      const action = button(title, () => sendRow('updateBlock', row, { workspaceRefine: true, baseText: sectionData.pseudocode, draft: sectionData.pseudocode, instruction }));
      action.disabled = !canEdit(row); actions.append(action);
    }
    if (row.riskCount) {
      const test = button('Add test for ⚠', () => askTest(row)); test.disabled = !canEdit(row);
      actions.append(test);
    }
    body.append(actions);
    appendTests(body, state, sectionData, row.index, rowsByLine);
    if (!draft && canEdit(row) && stepLines(row).length) body.append(hint('Double-click any step to edit'));
    return body;
  }

  function formatTokens(count) { return count.toLocaleString(); }

  function rowTokenEstimate(row) {
    const id = chosenProvider(), estimate = row.tokenEstimates?.[id];
    if (!estimate) return undefined;
    const label = estimate.pseudo === undefined ? '~' + formatTokens(estimate.code) + ' code tok' :
      '~' + formatTokens(estimate.code) + ' code · ~' + formatTokens(estimate.pseudo) + ' pseudo tok';
    const marker = node('span', label, 'logic-token-estimate');
    const model = state.workspace.tokenModels?.[id] || providers.find(([key]) => key === id)?.[1] + ' default';
    const usage = state.workspace.flow?.usage;
    marker.title = label + ' · ' + model + (usage ? '\nToday: ' + formatTokens(usage.input + usage.cacheWrite) + ' input · ' + formatTokens(usage.cacheRead) +
      ' cached · ' + formatTokens(usage.output) + ' output · ' + (usage.calls?.gist || 0) + ' gist · ' + (usage.calls?.card || 0) + ' card requests' : ' · estimated');
    return marker;
  }

  function rowHeader(row, isFull) {
    const meta = node('div', undefined, 'logic-meta');
    if (row.symbol) meta.append(node('code', row.symbol + (row.kind === 'class' ? '' : '()'), 'logic-symbol'));
    meta.append(lineChip(row.startLine, row.endLine, () => sendRow('reveal', row)));
    const tokens = rowTokenEstimate(row);
    if (tokens && !flowMode()) meta.append(tokens);
    if (tokens && flowMode()) meta.title = tokens.title;
    const tag = node('span', auto === row.identity && !expanded.has(row.identity) ? 'at cursor · auto-opened' : 'at cursor', 'logic-badge cursor-tag');
    tag.hidden = !cursor || cursor < row.startLine || cursor > row.endLine || row.identity !== cursorChanged;
    meta.append(tag);
    if (isFull) return { meta, tag };
    const main = node('div', undefined, 'logic-row-main');
    const disclosure = button(opened(row) ? '⌄' : '›', () => toggle(row), opened(row) ? 'Collapse block' : 'Expand block');
    disclosure.classList.add('logic-disclosure');
    disclosure.setAttribute('aria-expanded', String(opened(row)));
    const check = node('input');
    check.type = 'checkbox'; check.checked = row.reviewed; check.disabled = row.missing;
    check.setAttribute('aria-label', (row.reviewed ? 'Unmark reviewed' : 'Mark reviewed') + ' · ' + row.title);
    check.addEventListener('change', () => review(row));
    let titleClick;
    const title = button(undefined, event => {
      clearTimeout(titleClick);
      if (flowMode()) { zoom(row); return; }
      const open = () => { expanded.add(row.identity); choose(row); };
      if (event?.detail && typeof setTimeout === 'function') titleClick = setTimeout(open, 200);
      else open();
    }, undefined, 'logic-title');
    title.tabIndex = -1;
    title.append(node('strong', row.title));
    title.addEventListener('dblclick', () => { clearTimeout(titleClick); zoom(row); });
    const center = node('div', undefined, 'logic-row-center'); center.append(title, meta);
    const flags = node('div', undefined, 'logic-badges');
    const actions = node('div', undefined, 'logic-row-actions');
    const refresh = button('↻', () => sendRow('refreshBlock', row), 'Refresh block');
    refresh.disabled = !!state.comparison || !state.workspace.online || state.busy || state.sourceMissing;
    const ask = button('✦', () => { scopeTo(row); focusPrompt(); }, 'Ask about this block');
    ask.disabled = !canAsk();
    actions.append(button('▣', () => zoom(row), 'Open full card'), ask, refresh);
    const more = node('details'), moreToggle = node('summary', '⋯');
    moreToggle.setAttribute('aria-label', 'More block actions');
    const menu = node('div', undefined, 'logic-overflow');
    for (const [label, action, disabled] of [
      ['Copy pseudocode', () => sendRow('copyBlock', row), row.missing],
      ['Copy source range', () => sendRow('workspaceCopySource', row), false],
      ['Open card', () => zoom(row), false],
      ['Ask agent', () => { scopeTo(row); focusPrompt(); }, !canAsk()],
      ['Edit pseudocode', () => beginEdit(row), !canEdit(row)],
      ['Add test for ⚠', () => askTest(row), !row.riskCount || !canEdit(row)],
      ['Refresh', () => sendRow('refreshBlock', row), refresh.disabled],
      [row.reviewed ? 'Unmark reviewed' : 'Mark reviewed', () => review(row), row.missing]
    ]) {
      const item = button(label, () => { more.open = false; action(); });
      item.disabled = !!disabled; menu.append(item);
    }
    more.append(moreToggle, menu); actions.append(more); flags.append(actions);
    if (row.riskCount) flags.append(button('⚠ ' + row.riskCount, () => {
      if (flowMode()) { zoom(row); return; }
      expanded.add(row.identity); choose(row, false); rendered.get(row.identity)?.el.querySelector?.('.logic-edges')?.scrollIntoView?.({ block: 'nearest' });
    }, 'Show Worth checking', 'logic-badge logic-warning'));
    if (row.failed) flags.append(node('span', 'Couldn’t generate', 'logic-badge logic-warning'));
    if (row.changed) {
      const badge = button(updating(row) ? 'Updating…' : flowMode() ? 'Needs update' : 'Changed', () => {
        if (flowMode()) zoom(row);
        else { expanded.add(row.identity); choose(row, false); }
      }, 'Show changed block', 'logic-badge');
      if (updating(row)) { badge.prepend(node('span', '', 'logic-updating')); badge.setAttribute('aria-busy', 'true'); }
      flags.append(badge);
    }
    else if (!flowMode() && (state.inlineDiff?.blocks?.[row.index] || state.workspace.diffs?.[row.index])) flags.append(node('span', '+/−', 'logic-badge'));
    main.append(disclosure, check, node('span', String((row.order ?? row.index) + 1).padStart(2, '0'), 'logic-index'), center, flags);
    return { main, tag };
  }

  function rowElement(row, isFull = false) {
    const el = node('section', undefined, isFull ? 'logic-card' : 'logic-row');
    el.dataset.identity = row.identity;
    const { main, tag, meta } = rowHeader(row, isFull);
    if (flowMode()) {
      if (row.behavior) el.dataset.behavior = row.behavior.kind;
      const estimate = rowTokenEstimate(row);
      if (estimate) el.title = estimate.title;
      if (isFull) {
        if (row.behavior) meta.append(node('span', row.behavior.base === 'review' ? '± vs last review' : '± vs HEAD', 'logic-badge'));
        const title = node('h2', row.title);
        const actions = node('div', undefined, 'logic-actions');
        const reviewed = button(row.reviewed ? 'Unmark reviewed' : 'Mark reviewed', () => review(row));
        reviewed.disabled = row.missing;
        const copy = button('Copy', () => sendRow('copyBlock', row)); copy.disabled = row.missing;
        const refresh = button(row.failed ? 'Retry block' : row.missing ? 'Generate block' : 'Refresh block', () => sendRow('refreshBlock', row));
        refresh.disabled = !state.workspace.online || state.busy || state.sourceMissing;
        actions.append(reviewed, copy, refresh);
        if (state.refinementSteps && !row.missing && !row.changed) {
          const reviewCard = button('Review block', () => sendRow('reviewBlock', row));
          reviewCard.disabled = !state.workspace.online || state.busy || state.sourceMissing || state.review?.state === 'running';
          actions.append(reviewCard);
        }
        el.append(title, meta, blockBody(row, true), actions);
      } else {
        el.append(main);
        const center = main.querySelector?.('.logic-row-center') || main.children[3];
        if (row.keyStep) {
          const step = node('p', undefined, 'logic-gist-step');
          appendInline(step, row.keyStep); center.append(step);
        }
        if (row.behavior) {
          const change = node('p', undefined, 'logic-behavior-summary');
          if (row.behavior.was) change.append(node('s', '− ' + row.behavior.was.slice(0, 125)));
          if (row.behavior.was && row.behavior.now) change.append(document.createTextNode(' → '));
          if (row.behavior.now) change.append(node('ins', '+ ' + row.behavior.now.slice(0, 125)));
          center.append(change);
        }
        if (row.risk) center.append(node('div', '⚠ ' + row.risk, 'logic-warning logic-gist-step'));
      }
    } else if (isFull) {
      const pager = node('nav', undefined, 'logic-pager');
      const rows = filtered(), index = rows.indexOf(row);
      const prev = button('←', () => zoom(rows[index - 1]), 'Previous block');
      const next = button('→', () => zoom(rows[index + 1]), 'Next block');
      prev.disabled = index < 1; next.disabled = index >= rows.length - 1;
      pager.append(button('← Logic map', back), node('output', String(index + 1).padStart(2, '0') + ' / ' + String(rows.length).padStart(2, '0')), prev, next);
      const copy = button('Copy', () => sendRow('copyBlock', row)); copy.disabled = row.missing;
      const refresh = button('Regenerate', () => sendRow('refreshBlock', row)); refresh.disabled = !!state.comparison || !state.workspace.online || state.busy || state.sourceMissing;
      pager.append(copy, refresh);
      el.append(pager, node('h2', row.title), meta, blockBody(row, true));
    } else {
      el.append(main);
      if (opened(row)) el.append(blockBody(row, false));
    }
    return { el, tag, row };
  }

  function rowSignature(row, isFull) {
    const editing = draft?.row === row.identity ? draft.lines.join(',') : '';
    return JSON.stringify([row, chosenProvider(), state.workspace.tokenModels, isFull, opened(row), auto === row.identity, editing, state.busy, state.workspace.online, state.workspace.editable, state.refinementSteps, state.review?.state,
      state.inlineDiff?.blocks?.[row.index], state.workspace.diffs?.[row.index],
      section(row)?.pseudocode, section(row)?.lineMap, state.blockTests?.[row.index], state.runs?.[row.index]]);
  }

  function styleRow(entry) {
    const chosen = selected === entry.row.identity, cursorHere = cursorChanged === entry.row.identity;
    entry.el.classList.toggle('at-cursor', cursorHere);
    entry.el.classList.toggle('reviewed', entry.row.reviewed);
    entry.el.setAttribute('aria-current', String(chosen));
    entry.el.tabIndex = chosen ? 0 : -1;
    entry.tag.hidden = !cursorHere;
    entry.tag.textContent = auto === entry.row.identity && !expanded.has(entry.row.identity) ? 'at cursor · auto-opened' : 'at cursor';
    syncActiveSteps(entry.row);
  }

  const rowHeight = row => heights.get(row.identity) || (opened(row) ? 180 : flowMode() ? 58 : 50);
  const stages = ['Setup', 'Schedule', 'Prepare', 'Process', 'Evaluate', 'Save'];

  function sendDemand() {
    if (!flowMode()) return;
    const index = record(full)?.index;
    const indices = Number.isInteger(index) ? [index] : [];
    const key = indices.join(',') + ':' + documentKey();
    if (key !== demandSignature) { demandSignature = key; send('workspaceDemand', { indices, documentKey: documentKey() }); }
  }

  function drawFlowEdges() {
    if (!graphView?.svg || typeof document.createElementNS !== 'function' || !graphView.canvas.getBoundingClientRect) return;
    const { svg, canvas, nodes } = graphView, bounds = canvas.getBoundingClientRect(), paths = [];
    for (const edge of state.workspace.flow.edges || []) {
      const from = nodes.get(edge.from), to = nodes.get(edge.to);
      if (!from || !to) continue;
      const a = from.el.getBoundingClientRect(), b = to.el.getBoundingClientRect();
      const sameLane = Math.abs(a.left - b.left) < 2;
      const reverse = !sameLane && b.left < a.left;
      const x1 = (reverse ? a.left : a.right) - bounds.left;
      const x2 = (sameLane ? b.right : reverse ? b.right : b.left) - bounds.left;
      const y1 = a.top + a.height / 2 - bounds.top, y2 = b.top + b.height / 2 - bounds.top;
      const bend = reverse ? -Math.max(7, Math.abs(x2 - x1) / 2) : Math.max(7, Math.abs(x2 - x1) / 2);
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', sameLane ? 'M' + x1 + ',' + y1 + ' C' + (x1 + 6) + ',' + y1 + ' ' + (x2 + 6) + ',' + y2 + ' ' + x2 + ',' + y2 :
        'M' + x1 + ',' + y1 + ' C' + (x1 + bend) + ',' + y1 + ' ' + (x2 - bend) + ',' + y2 + ' ' + x2 + ',' + y2);
      const incident = [from.row.identity, to.row.identity].some(id => id === selected || id === cursorChanged);
      path.setAttribute('class', edge.kind + (incident ? ' incident' : ''));
      paths.push({ edge, path });
    }
    svg.replaceChildren(...paths.map(({ path }) => path));
    graphView.paths = paths;
    focusFlowDependencies(graphView.hovered);
  }

  function focusFlowDependencies(index) {
    if (!graphView) return;
    graphView.hovered = index;
    const related = new Set();
    for (const { edge, path } of graphView.paths) {
      const connected = edge.from === index || edge.to === index;
      path.classList.toggle('connected', connected);
      if (connected) { related.add(edge.from); related.add(edge.to); }
    }
    for (const [nodeIndex, { el }] of graphView.nodes) el.classList.toggle('connected', related.has(nodeIndex));
    graphView.canvas.classList.toggle('isolating', related.size > 0);
  }

  function scheduleEdges() {
    if (full || edgeFrame || typeof requestAnimationFrame !== 'function') return;
    edgeFrame = requestAnimationFrame(() => { edgeFrame = undefined; if (shell && flowMode() && !full) drawFlowEdges(); });
  }

  function graphState(all) {
    if (!flowMode()) return;
    const signature = JSON.stringify(all.map(row => [row.index, row.identity, row.title, row.stage, row.risk, row.behavior?.kind, updating(row),
      row.tokenEstimates?.[chosenProvider()]])) + ':' + chosenProvider() + ':' + JSON.stringify(state.workspace.flow.usage || {});
    if (!graphView || graphView.signature !== signature) {
      const viewport = node('div', undefined, 'logic-flow-viewport'), oldLeft = graphView?.viewport?.scrollLeft || 0, oldTop = graphView?.viewport?.scrollTop || 0;
      const caption = node('div', undefined, 'logic-flow-caption');
      caption.append(node('strong', 'File flow', 'logic-field-label'), node('small', '± Behavior changed · ⚠ Worth checking'));
      const canvas = node('div', undefined, 'logic-flow-canvas'), lanes = node('div', undefined, 'logic-flow-lanes');
      const svg = typeof document.createElementNS === 'function' ? document.createElementNS('http://www.w3.org/2000/svg','svg') : undefined;
      if (svg) { svg.setAttribute('class', 'logic-flow-svg'); svg.setAttribute('aria-hidden', 'true'); canvas.append(svg); }
      const nodes = new Map();
      const stageList = [...new Set([...stages, ...all.map(row => row.stage).filter(Boolean)])].filter(stage => all.some(row => (row.stage || 'Process') === stage));
      lanes.style.setProperty('--flow-columns', String(stageList.length || 1));
      for (const stage of stageList) {
        const group = all.filter(row => (row.stage || 'Process') === stage);
        if (!group.length) continue;
        const lane = node('section', undefined, 'logic-flow-lane');
        lane.append(node('h3', stage, 'logic-field-label'));
        for (const row of group) {
          const chip = button(undefined, () => {
            if (draft && draft.row !== row.identity) return;
            if (filter !== 'all' && !matches(row, filter)) filter = 'all';
            zoom(row);
          }, row.title, 'logic-flow-node');
          const words = row.title.replace(/[_]+/g, ' ').split(/\s+/);
          const useful = words.filter((word, index) => index === 0 || !/^(the|a|an|and|to|of|with)$/i.test(word));
          const label = useful.slice(0, 2).join(' ');
          chip.append(node('span', String((row.order ?? row.index) + 1).padStart(2,'0'), 'logic-flow-number'), node('span', label));
          if (row.behavior) { chip.dataset.behavior = row.behavior.kind; chip.append(node('span', '±', 'logic-flow-number')); }
          if (row.riskCount) chip.append(node('span', '⚠', 'logic-flow-risk'));
          if (updating(row)) { const spin = node('span', '', 'logic-updating'); spin.setAttribute('role', 'img'); spin.setAttribute('aria-label', 'Updating'); chip.append(spin); }
          const tokens = rowTokenEstimate(row);
          chip.title = row.title + (updating(row) ? ' · Updating…' : '') + (tokens ? '\n' + tokens.title : '');
          chip.addEventListener('pointerenter', event => {
            if (event.pointerType !== 'touch') focusFlowDependencies(row.index);
          });
          chip.addEventListener('pointerleave', () => focusFlowDependencies());
          lane.append(chip); nodes.set(row.index, { row, el: chip });
        }
        lanes.append(lane);
      }
      canvas.append(lanes); viewport.append(canvas); graph.replaceChildren(caption, viewport);
      viewport.scrollLeft = oldLeft; viewport.scrollTop = oldTop;
      graphView = { nodes, svg, canvas, viewport, signature, paths: [] };
    }
    for (const { row, el } of graphView.nodes.values()) {
      el.setAttribute('aria-current', String(row.identity === selected));
      el.dataset.cursor = String(row.identity === cursorChanged);
    }
    scheduleEdges();
  }

  function storyState() {
    const story = state.workspace.flow?.story;
    fileHeader.replaceChildren();
    if (flowMode()) fileHeader.append(node('span', 'File story', 'logic-field-label'));
    fileHeader.append(node('h1', story?.lead || state.result?.title || state.name));
    if (flowMode() && story) {
      const fields = node('dl', undefined, 'logic-story');
      for (const [label, text] of [['In', story.in], ['Then', story.then], ['Out', story.out]]) {
        if (!text) continue;
        const field = node('div'); field.append(node('dt', label, 'logic-field-label'), node('dd', text)); fields.append(field);
      }
      fileHeader.append(fields);
    } else fileHeader.append(node('p', state.result?.summary || ''));
    if (state.comparison) fileHeader.append(node('p', [state.comparison.label, state.comparison.notice || state.comparison.status].filter(Boolean).join(' · ')));
  }

  const outlineRows = () => flowMode() ? [...filtered()].sort((a,b) => stages.indexOf(a.stage || 'Process') - stages.indexOf(b.stage || 'Process') || (a.order ?? a.index) - (b.order ?? b.index)) : filtered();
  const offsetAt = index => outlineRows().slice(0, Math.max(0, index)).reduce((sum, row) => sum + rowHeight(row), 0);

  function visibleRange(all) {
    const viewport = scroll.clientHeight || 550;
    const start = Math.max(0, scroll.scrollTop);
    if (all.length <= 28) return [0, all.length];
    let y = 0, first = 0, last;
    for (const row of all) {
      if (y + rowHeight(row) < start) first++;
      if (last === undefined && y >= start + viewport) last = all.indexOf(row);
      y += rowHeight(row);
    }
    return [Math.max(0, first - 5), Math.min(all.length, (last ?? all.length) + 5)];
  }

  function mountVisible() {
    const all = outlineRows();
    const [start, end] = full ? [0, 0] : visibleRange(all);
    visible = full ? all.filter(row => row.identity === full) : all.slice(start, end);
    if (draft && !full) {
      const pinned = all.find(row => row.identity === draft.row);
      if (pinned && !visible.includes(pinned) && !visible.some(row => row.identity === selected)) {
        const at = all.indexOf(pinned);
        scroll.scrollTop = offsetAt(at);
      }
    }
    topSpacer.style.height = (full ? 0 : all.slice(0, start).reduce((sum, row) => sum + rowHeight(row), 0)) + 'px';
    bottomSpacer.style.height = (full ? 0 : all.slice(end).reduce((sum, row) => sum + rowHeight(row), 0)) + 'px';
    const next = new Map();
    for (const row of visible) {
      const signature = rowSignature(row, !!full);
      const old = rendered.get(row.identity);
      let entry = old?.signature === signature ? old : { ...rowElement(row, !!full), signature };
      if (entry !== old) resize?.observe(entry.el);
      entry.row = row;
      next.set(row.identity, entry);
    }
    for (const [id, entry] of rendered) if (next.get(id) !== entry) { resize?.unobserve(entry.el); entry.el.remove?.(); }
    rendered = next;
    const wanted = [topSpacer];
    if (visible.length) {
      for (const [index, row] of visible.entries()) {
        const stage = row.stage || 'Process';
        if (flowMode() && !full && (visible[index - 1]?.stage || (index ? 'Process' : undefined)) !== stage) {
          wanted.push(node('div', stage, 'logic-flow-stage logic-field-label'));
        }
        wanted.push(rendered.get(row.identity).el);
      }
    }
    else wanted.push(node('p', state.workspace.loading ? 'Finding blocks…' :
      !all.length && filter !== 'all' ? ({ changed: 'No changed blocks.', risk: 'No blocks with risks.', unreviewed: 'No unreviewed blocks.' })[filter] :
        'No functions or methods found in this file.', 'logic-empty'));
    wanted.push(bottomSpacer);
    if (typeof list.removeChild === 'function') {
      for (const child of [...list.children]) if (!wanted.includes(child)) list.removeChild(child);
      wanted.forEach((el, index) => { if (list.children[index] !== el) list.insertBefore(el, list.children[index] || null); });
    } else list.replaceChildren(...wanted);
    for (const entry of rendered.values()) styleRow(entry);
    rowWindow = visible.map(row => row.index);
    if (rowWindow.join(',') !== lastVisible) { lastVisible = rowWindow.join(','); send('workspaceVisible', { indices: rowWindow }); }
  }

  function paint() {
    if (!shell) return;
    if (full && !filtered().some(row => row.identity === full)) full = undefined;
    if (flowMode()) {
      const focused = !!full, inline = focused && inlineCard;
      shell.classList.toggle('card-open', focused);
      shell.classList.toggle('card-inline', inline);
      fileHeader.hidden = flowOutline.hidden = flowFull.hidden = focused;
      graph.hidden = focused && !inline;
      flowBack.hidden = !focused;
      flowBack.disabled = !!draft;
      flowFull.disabled = !filtered().length;
      if (!focused) { graphState(rows()); storyState(); }
      else if (inline) graphState(rows());
      else if (graphView?.hovered !== undefined) focusFlowDependencies();
      sendDemand();
      renderShortcuts();
    }
    mountVisible();
    updateDraft();
    updateCommand();
  }

  function cursorLine(line) {
    if (!shell) return;
    const oldCursor = cursorChanged, previous = auto;
    cursor = line;
    const row = rows().filter(item => item.startLine <= line && item.endLine >= line)
      .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
    cursorChanged = row?.identity;
    if (previous && previous !== cursorChanged) suppressed.delete(previous);
    const typing = draft || isInput(document.activeElement);
    if (flowMode()) {
      if (!full && !typing && row && matches(row, filter) && oldCursor !== cursorChanged) {
        selected = row.identity; activeStep = rangeStart = undefined; clearedScope = false;
        if (!rendered.has(selected)) scroll.scrollTop = offsetAt(outlineRows().indexOf(row));
        paint();
        scrollRow();
      } else {
        if (!full) graphState(rows());
        sendDemand();
        for (const id of new Set([oldCursor, cursorChanged])) {
          const entry = rendered.get(id);
          if (entry) styleRow(entry);
        }
      }
      return;
    }
    if (!full && !typing) {
      auto = row && !suppressed.has(row.identity) ? row.identity : undefined;
      if (row && matches(row, filter) && previous !== auto) {
        selected = row.identity; activeStep = rangeStart = undefined; clearedScope = false;
        if (!rendered.has(selected)) scroll.scrollTop = offsetAt(outlineRows().indexOf(row));
      }
    }
    if (previous !== auto) {
      paint();
      if (!typing) scrollRow();
    } else {
      for (const id of new Set([oldCursor, cursorChanged])) {
        const entry = rendered.get(id);
        if (entry) styleRow(entry);
      }
    }
  }

  function moveBlock(delta) {
    const items = outlineRows();
    const index = items.findIndex(row => row.identity === selected);
    const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
    if (next && (!draft || draft.row === next.identity)) { choose(next, true, true); if (full && !flowMode()) zoom(next); }
  }

  function key(event) {
    if (!shell || event.defaultPrevented) return;
    const name = event.key, lower = name.toLowerCase(), modifier = event.metaKey || event.ctrlKey;
    const row = record(selected);
    let action;
    if (name === 'Escape') {
      action = () => {
        if (draft) endDraft();
        else if (state.workspace.proposal && state.workspace.proposal.phase !== 'applying') send('workspaceCancel');
        else if (full) back();
        else if (document.activeElement === prompt && prompt.value) { prompt.value = ''; updateCommand(); }
        else if (!flowMode() && row && opened(row)) toggle(row);
        else send('workspaceBlur');
      };
    } else if (modifier && name === 'Enter') action = draft ? applyDraft : document.activeElement === prompt ? submit : undefined;
    else if (modifier && lower === 'l') action = focusPrompt;
    else if (isInput(event.target)) return;
    else if (!modifier && name === '/') action = focusPrompt;
    else if (modifier && lower === 'c' && row && !window.getSelection?.()?.toString()) action = () => sendRow('copyBlock', row);
    else if (!modifier && ['ArrowUp', 'ArrowDown'].includes(name)) {
      const delta = name === 'ArrowUp' ? -1 : 1;
      if (event.shiftKey && row && (opened(row) || full)) action = () => {
        const steps = stepLines(row), index = steps.findIndex(link => link.pseudocodeLine === activeStep);
        const next = steps[Math.max(0, Math.min(steps.length - 1, index + delta))];
        if (next) { rangeStart ??= activeStep || next.pseudocodeLine; pickStep(row, next.pseudocodeLine, true); }
      };
      else action = () => moveBlock(delta);
    } else if (!modifier && row && ['ArrowLeft', 'ArrowRight'].includes(name)) {
      if (full) action = () => moveBlock(name === 'ArrowLeft' ? -1 : 1);
      else if (flowMode() && name === 'ArrowRight') action = () => zoom(row);
      else if (!flowMode() && (name === 'ArrowRight') !== opened(row)) action = () => toggle(row);
    } else if (!modifier && name === 'Enter' && row && event.target?.tagName !== 'BUTTON') {
      action = () => { if (flowMode()) { if (!full) zoom(row); return; } if (full) back(); else if (opened(row)) zoom(row); else { toggle(row); choose(row); } };
    } else if (!modifier && lower === 'e' && row) action = () => beginEdit(row);
    else if (!modifier && lower === 'r' && row) action = () => review(row);
    else if (!modifier && lower === 'a') action = focusPrompt;
    else if (!modifier && lower === 'u') action = updateAll;
    if (action) { event.preventDefault(); action(); }
  }

  function renderShortcuts() {
    const keys = flowMode() && full ? [['↑↓', 'switch block'], ['E', 'edit step'], [state.workspace.keywords + '↵', 'apply'], ['Esc', 'file flow']] :
      [['↑↓', 'blocks'], ['↵', flowMode() ? 'open card' : 'open'], ['E', 'edit step'], [state.workspace.keywords + '↵', 'apply'], ['R', 'mark reviewed']];
    const id = JSON.stringify(keys);
    if (shortcuts.dataset.keys === id) return;
    shortcuts.dataset.keys = id;
    shortcuts.replaceChildren(...keys.flatMap(([code, text]) => [node('kbd', code), node('span', text)]));
  }

  function init(parent) {
    shell = node('div', undefined, 'logic-shell');
    toolbar = node('div', undefined, 'logic-tools');
    filters = node('nav', undefined, 'logic-filters'); filters.setAttribute('aria-label', 'Filter blocks');
    log = node('section', undefined, 'logic-activity'); log.id = 'logic-activity-panel'; log.setAttribute('aria-label', 'Activity');
    activityView = undefined;
    fileHeader = node('div', undefined, 'logic-file');
    scroll = node('div', undefined, 'logic-scroll');
    scroll.addEventListener('scroll', () => {
      if (full) return;
      scrollTop = scroll.scrollTop;
      if (windowFrame || typeof requestAnimationFrame !== 'function') return;
      windowFrame = requestAnimationFrame(() => { windowFrame = undefined; if (shell) mountVisible(); });
    });
    list = node('div', undefined, 'logic-queue');
    topSpacer = node('div'); bottomSpacer = node('div');
    scroll.append(list);
    shortcuts = node('div', undefined, 'logic-keys');
    renderShortcuts();
    command = node('div', undefined, 'logic-command'); command.setAttribute('aria-label', 'Yamori command bar');
    proposal = node('div', undefined, 'logic-proposal');
    scopeChip = button('', () => scopeTo(undefined), undefined, 'logic-scope');
    prompt = node('textarea'); prompt.rows = 1; prompt.setAttribute('aria-label', 'Ask or edit code');
    prompt.addEventListener('input', () => { terminalError = undefined; updateCommand(); });
    composerSelect = providerSelect('AI for Ask or Edit');
    sendButton = button('→', submit, 'Send to terminal', 'logic-primary');
    terminalStatus = node('p', undefined, 'logic-terminal-status');
    terminalStatus.setAttribute('role', 'status');
    command.append(proposal, terminalStatus, scopeChip, prompt, composerSelect, sendButton);
    if (flowMode()) {
      shell.classList.add('logic-flow-mode');
      const flowChrome = node('div', undefined, 'logic-flow-chrome');
      flowOutline = node('span', 'Gist+Steps', 'logic-muted');
      flowFull = button('Full', () => zoom(record(selected) || record(cursorChanged) || filtered()[0]));
      flowBack = button('← File flow', back, 'Back to File flow', 'logic-flow-back');
      flowChrome.append(flowOutline, flowFull, flowBack);
      graph = node('nav', undefined, 'logic-flow-graph'); graph.setAttribute('aria-label', 'File flow');
      const flowBody = node('div', undefined, 'logic-flow-body');
      flowBody.append(graph, scroll);
      filters.hidden = true;
      shell.append(flowChrome, fileHeader, log, flowBody, toolbar, shortcuts, command);
      if (typeof ResizeObserver === 'function') { graphResize = new ResizeObserver(scheduleEdges); graphResize.observe(graph); }
    } else shell.append(toolbar, filters, log, fileHeader, scroll, shortcuts, command);
    parent.replaceChildren(shell);
    if (typeof ResizeObserver === 'function') resize = new ResizeObserver(entries => {
      if (!shell || full) return;
      for (const entry of entries) {
        const id = entry.target.dataset.identity;
        heights.set(id, Math.max(36, entry.contentRect.height + 5));
      }
      if (!needsMeasure && typeof requestAnimationFrame === 'function') needsMeasure = requestAnimationFrame(() => {
        needsMeasure = undefined; if (shell && !full) mountVisible();
      });
    });
  }

  function show(parent, next) {
    state = next;
    const changedFile = lastDoc !== state.name;
    if (changedFile) {
      lastDoc = state.name; filter = 'all'; selected = full = auto = draft = activeStep = rangeStart = undefined;
      terminalRequest = terminalError = undefined;
      expanded.clear(); suppressed.clear(); heights.clear(); scrollTop = 0;
      demandSignature = ''; graphView = undefined;
      if (activityView) activityView.history.open = false;
      wasRunning = activityOpen = false;
    }
    const running = !!state.busy || state.review?.state === 'running' ||
      ['previewing', 'applying'].includes(state.workspace.proposal?.phase);
    if (running !== wasRunning) {
      if (running || currentActivity()[0] === 'failed') activityOpen = true;
      else activityOpen = false;
      wasRunning = running;
    }
    if (!shell) init(parent);
    if (state.focusLine?.token !== lastFocus) {
      lastFocus = state.focusLine?.token;
      if (state.focusLine?.line) cursorLine(state.focusLine.line);
    } else if (state.workspace.cursor !== cursor || (cursor && !cursorChanged)) cursorLine(state.workspace.cursor);
    if (draft?.applying && !state.workspace.proposal) draft = undefined;
    if (draft && state.workspace.proposal?.phase === 'error') draft.applying = undefined;
    if (draft && !record(draft.row)) { clearTimeout(draft.timer); draft = undefined; }
    if (!record(selected) || !matches(record(selected), filter)) selected = filtered()[0]?.identity;
    if (!flowMode()) storyState();
    command.hidden = !!state.comparison;
    toolbarState(); logState(); paint();
  }

  function hide() {
    if (!shell) return;
    clearTimeout(draft?.timer); draft = terminalRequest = terminalError = undefined;
    if (flowMode()) send('workspaceDemand', { indices: [], documentKey: documentKey() });
    resize?.disconnect(); resize = undefined; graphResize?.disconnect(); graphResize = undefined; graphView = undefined;
    rendered.clear(); lastVisible = ''; shell = undefined; wasRunning = activityOpen = false;
  }

  return { show, hide, key, cursorLine, terminalResult };
}

module.exports = { LOGIC_STYLE, logicWorkspaceUI };
