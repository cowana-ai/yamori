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

function panelHTML() {
  const nonce = randomBytes(18).toString('base64');
  const logo = 'data:image/png;base64,' + require('node:fs').readFileSync(require('node:path').join(__dirname, 'yamori.png')).toString('base64');
  const mathLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, 'katex.min.js'), 'utf8');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori</title><style nonce="${nonce}">
:root { color-scheme: light dark; --flow: oklch(0.78 0.13 300); --value: oklch(0.79 0.11 215); --string: oklch(0.82 0.11 75); --output: oklch(0.79 0.13 155); --note: oklch(0.78 0.09 85); --call: oklch(0.77 0.12 250); }
body.vscode-light { --flow: oklch(0.45 0.19 300); --value: oklch(0.43 0.10 220); --string: oklch(0.43 0.11 65); --output: oklch(0.40 0.11 155); --note: oklch(0.43 0.09 75); --call: oklch(0.45 0.16 250); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font: 13px/1.65 var(--vscode-font-family, system-ui); }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 4px; background: transparent; padding: 4px 9px; }
button:hover { background: var(--vscode-toolbar-hoverBackground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.block-actions { display: inline-flex; gap: 2px; }
.block-actions button { font-size: 11px; padding: 3px 6px; }
.block-editor { padding: 14px; }
.block-editor label { display: block; font-size: 12px; margin-bottom: 7px; color: var(--vscode-descriptionForeground); }
textarea { display: block; width: 100%; resize: vertical; min-height: 160px; padding: 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); border-radius: 4px; font: 12px/1.7 var(--vscode-editor-font-family, monospace); tab-size: 4; }
textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.instruction { min-height: 60px; margin-top: 10px; font-family: var(--vscode-font-family); }
.edit-toolbar { display: flex; gap: 6px; align-items: center; margin-top: 10px; }
.edit-toolbar .primary { margin-top: 0; }
math { font-size: 1.12em; font-family: 'STIX Two Math', 'Cambria Math', math; margin-inline: 2px; }
header { position: sticky; top: 0; z-index: 1; padding: 14px 22px 12px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); }
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
.activity summary { cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 12px; }
.activity ol { padding-left: 18px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.activity li { padding: 2px 0; }
.model-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: -10px; margin-bottom: 18px; }
#provider { flex-shrink: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
.ai-controls { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; min-width: 0; max-width: 65%; margin-left: auto; }
#effort { grid-column: 2; justify-self: end; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
#model { color: var(--vscode-descriptionForeground); font-size: 11px; max-width: 24ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.segments { display: inline-flex; padding: 2px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); border-radius: 6px; }
.segments button { font-size: 12px; padding: 3px 10px; }
.segments button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
#refresh { margin-left: auto; font-size: 12px; }
#source { display: block; max-width: 100%; padding-left: 0; margin-top: 12px; text-align: left; color: var(--vscode-descriptionForeground); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { max-width: 74ch; margin: 0 auto; padding: 28px 26px 48px; }
h1 { font-size: 22px; line-height: 1.3; font-weight: 600; margin: 0 0 12px; letter-spacing: -.025em; }
.summary { color: var(--vscode-descriptionForeground); margin: 0 0 28px; }
details { margin: 0 0 18px; border: 1px solid var(--vscode-widget-border, color-mix(in oklch, var(--flow) 22%, transparent)); border-radius: 9px; overflow: hidden; background: color-mix(in oklch, var(--vscode-editor-background) 96%, var(--flow)); }
.section-heading { display: flex; align-items: center; gap: 10px; padding: 12px 14px; cursor: pointer; list-style: none; background: color-mix(in oklch, var(--vscode-editor-background) 92%, var(--flow)); }
.section-heading::-webkit-details-marker { display: none; }
.section-heading::after { content: '⌄'; color: var(--vscode-descriptionForeground); }
details:not([open]) .section-heading::after { content: '›'; }
.section-heading:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }
.block-index { display: inline-flex; justify-content: center; align-items: center; min-width: 24px; height: 24px; border-radius: 6px; background: color-mix(in oklch, var(--flow) 14%, transparent); color: var(--flow); font-size: 11px; font-weight: 600; }
h2 { flex: 1; font-size: 13px; font-weight: 600; margin: 0; line-height: 1.4; }
.line { flex-shrink: 0; color: var(--vscode-textLink-foreground); font-size: 11px; padding: 0 3px; }
pre { font: 13px/1.8 var(--vscode-editor-font-family, monospace); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; tab-size: 4; padding: 18px 12px; }
.code-line { display: grid; grid-template-columns: 2.1em minmax(0, 1fr); align-items: baseline; min-height: 1.8em; padding-block: 2px; }
.step-body { min-width: 0; }
.code-line.blank { min-height: 1.1em; line-height: 1; padding: 0; }
.code-line.routine:not(:first-child) { margin-top: 1.2em; }
.step-number { color: var(--vscode-descriptionForeground); font: 10px/1.8 var(--vscode-font-family); user-select: none; padding-top: 3px; }
.code-line.linked { cursor: pointer; }
.code-line.linked:hover { background: var(--vscode-editor-hoverHighlightBackground, var(--vscode-toolbar-hoverBackground)); }
.code-line.linked:hover .step-number { color: var(--vscode-textLink-foreground); }
.code-line.linked:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.paper details:not(.activity) { border-radius: 0; border-width: 1px 0; background: transparent; margin-bottom: 26px; }
.paper .section-heading { background: transparent; border-bottom: 1px solid var(--vscode-panel-border); padding: 9px 0; }
.paper .block-index { min-width: 24px; border-radius: 0; background: transparent; justify-content: start; font: 600 11px var(--vscode-font-family); }
.paper pre { font-family: var(--vscode-font-family, system-ui); font-size: 14px; line-height: 1.8; }
.paper .code-line { min-height: 1.7em; }
.paper .legend { display: none; }
.code-line.decision { margin-top: 5px; }
.important { color: var(--vscode-editor-foreground); font-weight: 650; text-decoration: underline; text-decoration-color: color-mix(in oklch, var(--value) 45%, transparent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
.keyword { color: var(--flow); font-weight: 600; }
.number, .literal { color: var(--value); }
.string { color: var(--string); }
.output { color: var(--output); font-weight: 600; }
.function { color: var(--call); }
.comment { color: var(--note); }
.code-line.note { margin-block: 3px 6px; padding-block: 3px; font-size: 12px; line-height: 1.65; color: var(--note); border-radius: 4px; background: color-mix(in oklch, var(--note) 5%, transparent); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; margin: -12px 0 20px; color: var(--vscode-descriptionForeground); }
.legend span::before { content: '●'; margin-right: 5px; }
.legend .flow-key::before { color: var(--flow); } .legend .note-key::before { color: var(--note); } .legend .output-key::before { color: var(--output); }
.notice { color: var(--vscode-descriptionForeground); margin: 0 0 20px; font-size: 12px; }
.notice.error { color: var(--vscode-errorForeground); }
.empty { margin-top: 42px; }
.empty p { color: var(--vscode-descriptionForeground); max-width: 46ch; }
.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 12px; margin-top: 12px; }
.primary:hover { background: var(--vscode-button-hoverBackground); }
footer { display: flex; gap: 8px; justify-content: space-between; color: var(--vscode-descriptionForeground); font-size: 11px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); }
footer button { padding: 0 4px; font-size: 11px; }
.skeleton { height: 10px; margin: 16px 0; background: var(--vscode-textBlockQuote-background, var(--vscode-button-secondaryBackground)); border-radius: 2px; }
@media(max-width: 380px) { header { padding: 12px; } main { padding: 24px 16px; } .segments button { padding: 3px 7px; } }
@media(max-width: 560px) {
  .section-heading { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto 12px; gap: 5px 8px; }
  .section-heading .block-index { grid-column: 1; grid-row: 1; }
  .section-heading h2 { grid-column: 2 / 4; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
  .section-heading::after { grid-column: 4; grid-row: 1; }
  .section-heading .line { grid-column: 2; grid-row: 2; justify-self: start; }
  .section-heading .block-actions { grid-column: 3 / 5; grid-row: 2; justify-self: end; }
}
@media(forced-colors: active) { button, .segments, details, .code-line.note { border: 1px solid ButtonText; } .keyword, .output { color: LinkText; } .comment { color: CanvasText; } }
</style></head><body>
<header><div class="top"><span class="brand"><img src="${logo}" alt="Gecko samurai"><span class="wordmark">Yamori</span></span><span class="ai-controls"><button id="provider" title="Choose AI provider">Codex ▾</button><button id="model" title="Choose model for new requests" aria-label="Choose model for new requests">Default ▾</button><button id="effort" title="Choose reasoning effort for new requests" aria-label="Choose reasoning effort">Effort: Low ▾</button></span></div>
<div class="controls"><div class="segments" role="group" aria-label="Detail level">
<button data-level="overview" aria-pressed="false" title="The purpose and main stages">Overview</button>
<button data-level="logic" aria-pressed="true" title="Readable steps and important decisions">Logic</button>
<button data-level="detailed" aria-pressed="false" title="Formulas, edge cases and error handling">Detailed</button>
</div><button id="refresh" title="Generate a fresh explanation">Refresh</button></div>
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
      const el = node('details'); const heading = node('summary', undefined, 'section-heading');
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
document.getElementById('source').addEventListener('click', () => send('browse'));
refresh.addEventListener('click', () => send(state.busy ? 'stop' : 'refresh'));
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => send('level', { level: b.dataset.level })));
window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
window.addEventListener('blur', () => send('clearHover'));
send('ready');
</script></body></html>`;
}
module.exports = { panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts };
