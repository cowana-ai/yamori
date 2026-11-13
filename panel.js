'use strict';
const { randomBytes } = require('node:crypto');

function mathParts(text) {
  const parts = []; let offset = 0;
  for (const match of text.matchAll(/\$\$([^$]+)\$\$|\$([^$\n]+)\$/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[0], tex: match[1] || match[2] });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

function pseudocodeLines(text) {
  return text.split(/\r?\n/).map(text => ({
    text,
    kind: !text.trim() ? 'blank' : /^\s*#/.test(text) ? 'note' : /^\s*(FUNCTION|PROCEDURE|WHEN)\b/i.test(text) ? 'routine' : /^\s*(IF\b|ELSE\b|OTHERWISE\b|FOR\s+EACH\b|WHILE\b|REPEAT\b|UNTIL\b)/i.test(text) ? 'decision' : ''
  }));
}

function emphasisParts(text) {
  const parts = []; let offset = 0;
  for (const match of text.matchAll(/\*\*([^*\n]{1,100})\*\*/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[1], strong: true }); offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

// Highlight real control at the start of a step. Ordinary prose stays quiet.
function tokenize(text) {
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#.*$|\/\/.*$|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|^\s*(?:FOR\s+EACH|IF|OTHERWISE|ELSE|WHILE|REPEAT|UNTIL|WHEN|RETURN|YIELD|PRINT|OUTPUT|REJECT|STOP)\b)/gim;
  const tokens = []; let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) tokens.push({ text: text.slice(offset, match.index), kind: '' });
    const value = match[0];
    const kind = /^(#|\/\/)/.test(value) ? 'comment' : /^["']/.test(value) ? 'string' : /^\d/.test(value) ? 'number' : /^(RETURN|YIELD|PRINT|OUTPUT)$/i.test(value.trim()) ? 'output' : 'keyword';
    tokens.push({ text: value, kind }); offset = match.index + value.length;
  }
  if (offset < text.length) tokens.push({ text: text.slice(offset), kind: '' });
  return tokens;
}

function panelHTML(initialPalette = 'auto') {
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  const logo = 'data:image/png;base64,' + require('node:fs').readFileSync(require('node:path').join(__dirname, 'yamori.png')).toString('base64');
  const mathLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, 'katex.min.js'), 'utf8');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori</title><style nonce="${nonce}">
:root {
  color-scheme: dark;
  --read-page: oklch(.205 .018 250); --read-surface: oklch(.247 .020 250); --read-header: oklch(.280 .022 250);
  --read-ink: oklch(.935 .012 85); --read-muted: oklch(.780 .022 250); --read-border: oklch(.390 .023 250);
  --read-accent: oklch(.850 .075 180); --read-on-accent: oklch(.205 .018 250);
  --read-context-bg: oklch(.285 .027 190); --read-context-ink: oklch(.900 .030 180);
  --read-note-bg: oklch(.290 .025 75); --read-note-ink: oklch(.900 .045 85);
  --read-mark-bg: oklch(.385 .050 85); --read-mark-ink: oklch(.965 .025 90);
  --read-hover: oklch(.310 .025 190); --read-error: oklch(.820 .100 25);
}
body.vscode-light:not([data-palette="slate"]), body[data-palette="paper"] {
  color-scheme: light;
  --read-page: oklch(.968 .010 85); --read-surface: oklch(.989 .006 85); --read-header: oklch(.948 .014 85);
  --read-ink: oklch(.270 .030 250); --read-muted: oklch(.420 .022 250); --read-border: oklch(.800 .015 85);
  --read-accent: oklch(.370 .070 185); --read-on-accent: oklch(.989 .006 85);
  --read-context-bg: oklch(.946 .018 185); --read-context-ink: oklch(.320 .044 185);
  --read-note-bg: oklch(.947 .034 85); --read-note-ink: oklch(.370 .053 65);
  --read-mark-bg: oklch(.913 .075 90); --read-mark-ink: oklch(.270 .030 250);
  --read-hover: oklch(.952 .020 185); --read-error: oklch(.400 .120 25);
}
body[data-palette="slate"] { color-scheme: dark; }
* { box-sizing: border-box; }
body { --flow: var(--read-accent); --value: var(--read-ink); --string: var(--read-note-ink); --output: var(--read-accent); --note: var(--read-note-ink); --call: var(--read-context-ink); margin: 0; background: var(--read-page); color: var(--read-ink); font: 13px/1.65 var(--vscode-font-family, system-ui); }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 4px; background: transparent; padding: 4px 9px; }
button:hover { background: var(--read-hover); }
button:focus-visible { outline: 1px solid var(--read-accent); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.block-actions { display: inline-flex; gap: 2px; }
.block-actions button { font-size: 11px; padding: 3px 6px; }
.block-editor { padding: 14px; }
.block-editor label { display: block; font-size: 12px; margin-bottom: 7px; color: var(--read-muted); }
textarea { display: block; width: 100%; resize: vertical; min-height: 160px; padding: 10px; color: var(--read-ink); background: var(--read-surface); border: 1px solid var(--read-border); border-radius: 4px; font: 12px/1.7 var(--vscode-editor-font-family, monospace); tab-size: 4; }
textarea:focus { outline: 1px solid var(--read-accent); }
.instruction { min-height: 60px; margin-top: 10px; font-family: var(--vscode-font-family); }
.edit-toolbar { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
.edit-toolbar .primary { margin-top: 0; }
math { font-size: 1.12em; font-family: 'STIX Two Math', 'Cambria Math', math; margin-inline: 2px; }
header { position: sticky; top: 0; z-index: 1; padding: 14px 22px 12px; background: var(--read-page); border-bottom: 1px solid var(--read-border); }
.top, .controls { display: flex; align-items: center; gap: 8px; }
.top { justify-content: space-between; margin-bottom: 12px; }
.wordmark { font-size: 12px; font-weight: 600; letter-spacing: .03em; }
.brand { display: flex; align-items: center; gap: 8px; }
.brand img { width: 36px; height: 40px; object-fit: contain; }
.waiting { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.waiting img { width: 56px; height: 64px; object-fit: contain; flex-shrink: 0; animation: sway 2s ease-in-out infinite alternate; }
@keyframes sway { from { transform: translateY(2px) rotate(-2deg); } to { transform: translateY(-2px) rotate(2deg); } }
.skeleton { animation: breathe 1.8s ease-in-out infinite alternate; }
@keyframes breathe { from { opacity: .35; } to { opacity: .85; } }
@media(prefers-reduced-motion: reduce) { .waiting img, .skeleton { animation: none; } }
.activity { margin: 0 0 22px; border: 0; border-radius: 0; background: transparent; }
.activity summary { cursor: pointer; color: var(--read-muted); font-size: 12px; }
.activity ol { padding-left: 18px; color: var(--read-muted); font-size: 11px; }
.activity li { padding: 2px 0; }
.model-label { font-size: 11px; color: var(--read-muted); margin-top: -10px; margin-bottom: 18px; }
#provider { flex-shrink: 0; color: var(--read-muted); font-size: 12px; }
.ai-controls { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; min-width: 0; max-width: 65%; margin-left: auto; }
#effort { grid-column: 2; justify-self: end; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--read-muted); font-size: 11px; }
#model { color: var(--read-muted); font-size: 11px; max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.segments { display: inline-flex; padding: 2px; border: 1px solid var(--read-border); border-radius: 6px; }
.segments button { font-size: 12px; padding: 3px 10px; }
.segments button[aria-pressed="true"] { background: var(--read-accent); color: var(--read-on-accent); }
#refresh { margin-left: auto; font-size: 12px; }
#colors { font-size: 12px; font-weight: 650; }
#source { display: block; max-width: 100%; padding-left: 0; margin-top: 12px; text-align: left; color: var(--read-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { max-width: 74ch; margin: 0 auto; padding: 28px 26px 48px; }
h1 { font-size: 22px; line-height: 1.3; font-weight: 600; margin: 0 0 12px; letter-spacing: -.025em; }
.summary { color: var(--read-muted); margin: 0 0 28px; }
details { margin: 0 0 24px; border: 1px solid var(--read-border); border-radius: 10px; overflow: hidden; background: var(--read-surface); }
.reading-block { box-shadow: 0 2px 10px color-mix(in oklch, var(--read-ink) 4%, transparent); }
.section-heading { display: flex; align-items: center; gap: 10px; padding: 13px 14px; cursor: pointer; list-style: none; background: var(--read-header); border-bottom: 1px solid var(--read-border); }
details:not([open]) .section-heading { border-bottom-color: transparent; }
.section-heading::-webkit-details-marker { display: none; }
.section-heading::after { content: '⌄'; color: var(--read-muted); }
details:not([open]) .section-heading::after { content: '›'; }
.section-heading:focus-visible { outline: 1px solid var(--read-accent); outline-offset: -2px; }
.block-index { display: inline-flex; justify-content: center; align-items: center; min-width: 24px; height: 24px; border-radius: 6px; background: color-mix(in oklch, var(--flow) 14%, transparent); color: var(--flow); font-size: 11px; font-weight: 600; }
h2 { flex: 1; font-size: 14px; font-weight: 650; margin: 0; line-height: 1.4; }
.line { flex-shrink: 0; color: var(--read-accent); font-size: 11px; padding: 0 3px; }
pre { font: 15px/1.75 var(--vscode-font-family, system-ui); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; tab-size: 4; padding: 18px 12px; }
.code-line { display: grid; grid-template-columns: 2.1em minmax(0, 1fr); align-items: baseline; min-height: 1.8em; padding-block: 2px; }
.step-body { min-width: 0; }
.code-line.blank { min-height: 1.1em; line-height: 1; padding: 0; }
.code-line.routine:not(:first-child) { margin-top: 1.2em; }
.step-number { color: var(--read-muted); font: 10px/1.8 var(--vscode-font-family); user-select: none; padding-top: 3px; }
.code-line.linked { cursor: pointer; }
.code-line.linked:hover { background: var(--read-hover); }
.code-line.linked:hover .step-number { color: var(--read-accent); }
.code-line.linked:focus-visible { outline: 1px solid var(--read-accent); }
.paper .block-index { min-width: 24px; border-radius: 0; background: transparent; justify-content: start; font: 600 11px var(--vscode-font-family); }
.paper pre { font-family: var(--vscode-font-family, system-ui); font-size: 15px; line-height: 1.75; }
.paper .code-line { min-height: 1.7em; }
.paper .legend { display: none; }
.code-line.decision { margin-top: 5px; }
.important { color: var(--read-mark-ink); background: var(--read-mark-bg); font-weight: 650; padding-inline: .12em; border-radius: 2px; }
.keyword { color: var(--flow); font-weight: 600; }
.number, .literal { color: var(--value); font-weight: 550; }
.string { color: var(--string); }
.output { color: var(--output); font-weight: 600; }
.function { color: var(--call); }
.comment { color: var(--note); }
.code-line.note { margin-block: 3px 6px; padding-block: 5px; font-size: 13px; line-height: 1.65; color: var(--note); border-radius: 4px; background: var(--read-note-bg); }
.code-line.context-note { margin-block: 7px; padding-block: 7px; font-size: 14px; color: var(--read-context-ink); background: var(--read-context-bg); }
.code-line.context-note .comment { color: inherit; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; margin: -12px 0 20px; color: var(--read-muted); }
.legend span::before { content: '●'; margin-right: 5px; }
.legend .flow-key::before { color: var(--flow); } .legend .note-key::before { color: var(--note); } .legend .output-key::before { color: var(--output); }
.notice { color: var(--read-muted); margin: 0 0 20px; font-size: 12px; }
.notice.error { color: var(--read-error); }
.empty { margin-top: 42px; }
.empty p { color: var(--read-muted); max-width: 46ch; }
.primary { background: var(--read-accent); color: var(--read-on-accent); padding: 6px 12px; margin-top: 12px; }
.primary:hover { background: var(--read-accent); }
footer { display: flex; gap: 8px; justify-content: space-between; color: var(--read-muted); font-size: 11px; padding-top: 16px; border-top: 1px solid var(--read-border); }
footer button { padding: 0 4px; font-size: 11px; }
.skeleton { height: 10px; margin: 16px 0; background: var(--read-header); border-radius: 2px; }
@media(max-width: 380px) { header { padding: 12px; } main { padding: 24px 16px; } .segments button { padding: 3px 7px; } }
@media(max-width: 560px) {
  .section-heading { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 12px; gap: 5px 8px; }
  .section-heading .block-index { grid-column: 1; grid-row: 1; }
  .section-heading h2 { grid-column: 2 / 4; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
  .section-heading::after { grid-column: 4; grid-row: 1; }
  .section-heading .line { grid-column: 2; grid-row: 2; justify-self: start; }
  .section-heading .block-actions { grid-column: 3 / 5; grid-row: 2; justify-self: end; }
}
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --read-page: var(--vscode-editor-background); --read-surface: var(--vscode-editor-background); --read-header: var(--vscode-editor-background);
  --read-ink: var(--vscode-editor-foreground); --read-muted: var(--vscode-editor-foreground); --read-border: var(--vscode-contrastBorder, var(--vscode-editor-foreground));
  --read-accent: var(--vscode-textLink-foreground); --read-on-accent: var(--vscode-editor-background);
  --read-context-bg: var(--vscode-editor-background); --read-context-ink: var(--vscode-editor-foreground);
  --read-note-bg: var(--vscode-editor-background); --read-note-ink: var(--vscode-editor-foreground);
  --read-mark-bg: var(--vscode-editor-findMatchHighlightBackground); --read-mark-ink: var(--vscode-editor-foreground); --read-hover: var(--vscode-editor-findMatchHighlightBackground);
}
@media(forced-colors: active) { body, header, .reading-block, .section-heading, .code-line.note { background: Canvas; color: CanvasText; } button, .segments, details, .code-line.note { border: 1px solid ButtonText; } .keyword, .output { color: LinkText; } .comment { color: CanvasText; } }
</style></head><body data-palette="${palette}">
<header><div class="top"><span class="brand"><img src="${logo}" alt="Gecko samurai"><span class="wordmark">Yamori</span></span><span class="ai-controls"><button id="provider" title="Choose AI provider">Codex ▾</button><button id="model" title="Choose model for new requests" aria-label="Choose model for new requests">Default ▾</button><button id="effort" title="Choose reasoning effort for new requests" aria-label="Choose reasoning effort">Effort: Low ▾</button></span></div>
<div class="controls"><div class="segments" role="group" aria-label="Detail level">
<button data-level="overview" aria-pressed="false" title="The purpose and main stages">Overview</button>
<button data-level="logic" aria-pressed="true" title="Readable steps and important decisions">Logic</button>
<button data-level="detailed" aria-pressed="false" title="Formulas, edge cases and error handling">Detailed</button>
</div><button id="refresh" title="Generate a fresh explanation">Refresh</button><button id="colors" title="Choose reading colors" aria-label="Choose reading colors">Aa</button></div>
<button id="source" title="Choose a different project file">Choose a file…</button></header>
<main id="content" aria-busy="false"></main>
<script nonce="${nonce}">
${mathLibrary}
const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const refresh = document.getElementById('refresh');
let state = {};
const collapsed = new Set();
const drafts = new Map();
let editing;
const tokenize = ${tokenize.toString()};
const pseudocodeLines = ${pseudocodeLines.toString()};
const mathParts = ${mathParts.toString()};
const emphasisParts = ${emphasisParts.toString()};
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function appendText(parent, text) { for (const token of tokenize(text)) parent.append(node('span', token.text, token.kind)); }
function appendMath(parent, text) {
  for (const part of mathParts(text)) {
    if (!part.tex) { appendText(parent, part.text); continue; }
    try {
      const markup = katex.renderToString(part.tex, { output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100, maxSize: 10 });
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      parent.append(document.importNode(parsed.querySelector('math'), true));
    } catch { appendText(parent, part.text); }
  }
}
function appendInline(parent, text) {
  for (const part of emphasisParts(text)) {
    const target = part.strong ? node('strong', undefined, 'important') : parent;
    appendMath(target, part.text); if (part.strong) parent.append(target);
  }
}
function render(s) {
  send('clearHover');
  state = s;
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  if (editing && editing.documentKey !== s.documentKey) editing = undefined;
  content.className = s.level === 'logic' ? 'paper' : '';
  document.getElementById('provider').textContent = s.providerLabel + ' ▾';
  document.getElementById('model').textContent = (s.requestedModel || 'Default') + ' ▾';
  document.getElementById('model').title = 'New requests: ' + (s.requestedModel || 'provider default') + ' · Choose model';
  document.getElementById('effort').textContent = 'Effort: ' + (s.requestedEffort || 'Default') + ' ▾';
  document.getElementById('effort').title = 'New requests: ' + (s.requestedEffort || 'CLI default') + ' reasoning effort';
  document.getElementById('source').textContent = s.name || 'Choose a file…';
  document.getElementById('source').title = s.name ? s.name + ' · Choose a different file' : 'Choose a file';
  document.querySelectorAll('[data-level]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.level === s.level)); });
  refresh.textContent = s.busy ? 'Stop' : 'Refresh'; refresh.disabled = !s.name;
  content.setAttribute('aria-busy', String(!!s.busy)); content.replaceChildren();
  if (s.modelNotice) content.append(node('p', s.modelNotice, 'notice'));
  if (s.error) { const el = node('p', s.error, 'notice error'); el.setAttribute('role', 'alert'); content.append(el); }
  else if (s.busy) {
    const waiting = node('div', undefined, 'waiting');
    const mascot = node('img'); mascot.src = ${JSON.stringify(logo)}; mascot.alt = '';
    waiting.append(mascot);
    const label = node('div', s.progress || 'Connecting…', 'notice'); label.setAttribute('role', 'status'); waiting.append(label); content.append(waiting);
  }
  else if (s.stale) content.append(node('p', 'Source changed. Refresh to update this explanation.', 'notice'));
  if (s.activity?.length) {
    const activity = node('details', undefined, 'activity');
    const caption = node('summary'); caption.id = 'activity-caption';
    const list = node('ol'); s.activity.forEach(step => list.append(node('li', step)));
    activity.append(caption, list); content.append(activity);
  }
  if (s.model) content.append(node('div', 'Generated with ' + s.model + (s.effort ? ' · requested ' + s.effort + ' effort' : ''), 'model-label'));
  if (s.result) {
    content.append(node('h1', s.result.title), node('p', s.result.summary, 'summary'));
    const legend = node('div', undefined, 'legend');
    legend.append(node('span', 'Control flow', 'flow-key'), node('span', 'Notes', 'note-key'), node('span', 'Output', 'output-key')); content.append(legend);
    s.result.sections.forEach((section, index) => {
      const el = node('details'); el.className = 'reading-block'; const heading = node('summary', undefined, 'section-heading');
      const blockKey = [s.name, s.level, s.providerLabel, index].join('|');
      el.open = !collapsed.has(blockKey);
      el.addEventListener('toggle', () => { if (el.open) collapsed.delete(blockKey); else collapsed.add(blockKey); });
      const link = node('button', section.startLine ? 'L' + section.startLine + (section.endLine !== section.startLine ? '–' + section.endLine : '') : 'Writing…', 'line');
      link.title = 'Highlight corresponding source lines'; link.disabled = !!s.stale || !!s.partial;
      link.addEventListener('click', event => { event.preventDefault(); send('reveal', { index }); });
      heading.append(node('span', String(index + 1).padStart(2, '0'), 'block-index'), node('h2', section.title), link);
      const actions = node('span', undefined, 'block-actions');
      const copyBlock = node('button', 'Copy'); copyBlock.disabled = !!s.partial;
      copyBlock.addEventListener('click', event => { event.preventDefault(); send('copyBlock', { index, documentKey: s.documentKey }); });
      const edit = node('button', 'Edit'); edit.disabled = !!s.busy || !!s.stale;
      edit.addEventListener('click', event => {
        event.preventDefault();
        const key = s.documentKey + ':' + index;
        if (!drafts.has(key)) drafts.set(key, { draft: section.pseudocode, instruction: '', baseText: section.pseudocode });
        editing = { key, index, documentKey: s.documentKey }; render(state);
      });
      actions.append(copyBlock, edit); heading.append(actions);
      const code = node('pre');
      let stepNumber = 0;
      pseudocodeLines(section.pseudocode).forEach(({ text, kind }, lineIndex) => {
        const row = node('span', undefined, 'code-line' + (kind ? ' ' + kind : ''));
        if (kind === 'note' && /^\\s*#\\s*(Context|Why|How|What):/i.test(text)) row.className += ' context-note';
        const mapping = section.lineMap?.find(m => m.pseudocodeLine === lineIndex + 1);
        row.append(node('span', text.trim() && kind !== 'note' ? String(++stepNumber) : '', 'step-number'));
        if (mapping && !s.stale && !s.partial) {
          row.className += ' linked'; row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0');
          row.title = 'Hover to highlight source L' + mapping.startLine + '–' + mapping.endLine + ' · Click to jump';
          row.setAttribute('aria-label', text.trim() + '. ' + row.title);
          const jump = () => send('revealStep', { index, pseudocodeLine: lineIndex + 1 });
          row.addEventListener('click', jump);
          row.addEventListener('mouseenter', () => send('hoverStep', { index, pseudocodeLine: lineIndex + 1 }));
          row.addEventListener('mouseleave', () => send('clearHover'));
          row.addEventListener('focus', () => send('hoverStep', { index, pseudocodeLine: lineIndex + 1 }));
          row.addEventListener('blur', () => send('clearHover'));
          row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); } });
        }
        const body = node('span', undefined, 'step-body');
        body.style.paddingInlineStart = Math.min(text.length - text.trimStart().length, 40) * .55 + 'em';
        appendInline(body, text.trimStart());
        if (!text) body.append(document.createTextNode(' '));
        row.append(body);
        code.append(row);
      });
      el.append(heading);
      if (editing?.index === index && editing.documentKey === s.documentKey) {
        el.open = true;
        const record = drafts.get(editing.key);
        const editor = node('div', undefined, 'block-editor');
        const label = node('label', 'Edit pseudocode · **key terms** · $LaTeX$');
        const draft = node('textarea'); draft.value = record.draft; draft.disabled = !!s.busy; draft.setAttribute('aria-label', 'Pseudocode draft');
        draft.addEventListener('input', () => { record.draft = draft.value; });
        const instruction = node('textarea', undefined, 'instruction'); instruction.value = record.instruction; instruction.disabled = !!s.busy;
        instruction.placeholder = 'Optional instruction, e.g. simplify the loop or explain this assumption'; instruction.setAttribute('aria-label', 'Instruction for ' + s.providerLabel);
        instruction.addEventListener('input', () => { record.instruction = instruction.value; });
        const toolbar = node('div', undefined, 'edit-toolbar');
        const update = node('button', 'Update with ' + s.providerLabel, 'primary'); update.disabled = !!s.busy;
        update.addEventListener('click', () => send('updateBlock', { index, documentKey: s.documentKey, ...record }));
        const close = node('button', 'Cancel'); close.disabled = !!s.busy; close.addEventListener('click', () => { editing = undefined; render(state); });
        toolbar.append(update, close); editor.append(label, draft, instruction, toolbar); el.append(editor);
      } else el.append(code);
      content.append(el);
    });
    const footer = node('footer');
    footer.append(node('span', s.partial ? 'Live draft · source links activate when complete' : s.stale ? 'Earlier version' : s.result.edited ? 'Edited explanation · source code unchanged' : 'AI-generated · Verify against source'));
    const copy = node('button', 'Copy'); copy.disabled = !!s.partial; copy.addEventListener('click', () => send('copy')); footer.append(copy); content.append(footer);
  } else if (s.busy) {
    for (let i = 0; i < 8; i++) { const line = node('div', undefined, 'skeleton'); line.style.width = i % 3 === 0 ? '55%' : '90%'; content.append(line); }
  } else {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h1', 'Read the logic.'), node('p', 'Open a code file or select a few lines, then read it in plain English. Choose how deep you want to go.'));
    const button = node('button', 'Read current file', 'primary'); button.addEventListener('click', () => send('read')); empty.append(button); content.append(empty);
  }
  updateElapsed();
}
function updateElapsed() {
  const caption = document.getElementById('activity-caption');
  if (caption) caption.textContent = (state.error || state.activity?.at(-1) === 'Stopped' ? 'Stopped' : state.busy ? state.progress || 'Working' : 'Completed') + (state.busy && state.startedAt ? ' · ' + Math.floor((Date.now() - state.startedAt) / 1000) + 's' : '') + ' · Activity';
}
if (typeof setInterval === 'function') setInterval(updateElapsed, 1000);
document.getElementById('provider').addEventListener('click', () => send('provider'));
document.getElementById('model').addEventListener('click', () => send('model'));
document.getElementById('effort').addEventListener('click', () => send('effort'));
document.getElementById('colors').addEventListener('click', () => send('palette'));
document.getElementById('source').addEventListener('click', () => send('browse'));
refresh.addEventListener('click', () => send(state.busy ? 'stop' : 'refresh'));
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => send('level', { level: b.dataset.level })));
window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
window.addEventListener('blur', () => send('clearHover'));
send('ready');
</script></body></html>`;
}
module.exports = { panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts };
