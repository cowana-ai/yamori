'use strict';
const { parseCard } = require('../ai/cards');
const { randomBytes } = require('node:crypto');
const { LOGIC_STYLE, logicWorkspaceUI } = require('./logic-workspace');

function mathParts(text) {
  const parts = []; let offset = 0;
  for (const match of text.matchAll(/(?<!\\)\$\$([^$]+)\$\$|(?<!\\)\$([^$\n]+)\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)/g)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[0], tex: match[1] || match[2] || match[3] || match[4], display: !!(match[1] || match[3]) });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

function codeParts(text, block = false) {
  const pattern = block ? /^ {0,3}`{3}[^\n]*\n([\s\S]*?)^ {0,3}`{3}[ \t]*(?=\r?$)/gm : /`([^`\r\n]+)`/g;
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[1], code: true });
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

// Project terms (from the project map) become hover/click links in prose and
// notes. Longest names win; matches never split an identifier.
function glossaryMatcher(terms) {
  const names = new Map();
  (Array.isArray(terms) ? terms : []).forEach((term, index) => [term.term, ...(term.aliases || [])].forEach(name => {
    if (typeof name === 'string' && name.length >= 2 && name.length <= 80 && !names.has(name)) names.set(name, index);
  }));
  if (!names.size) return undefined;
  const escaped = [...names.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&'));
  return { names, pattern: new RegExp('(?<![A-Za-z0-9_])(?:' + escaped.join('|') + ')(?![A-Za-z0-9_])', 'g') };
}
function glossaryParts(text, matcher) {
  if (!matcher || !text) return [{ text }];
  const parts = []; let offset = 0;
  for (const match of text.matchAll(matcher.pattern)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[0], term: matcher.names.get(match[0]) }); offset = match.index + match[0].length;
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

function cleanEmphasis(transaction) {
  if (!transaction.docChanged) return transaction;
  const before = transaction.startState.doc.toString(), after = transaction.newDoc, changes = [];
  const edits = []; transaction.changes.iterChangedRanges((from, to) => edits.push({ from, to }));
  for (const match of before.matchAll(/\*\*([^*\n]*)\*\*/g)) {
    const from = match.index, end = from + match[0].length, closing = end - 2;
    const damaged = edits.some(edit => (edit.to > from && edit.from < from + 2) || (edit.to > closing && edit.from < end));
    const bodyStart = transaction.changes.mapPos(from + 2, 1), bodyEnd = transaction.changes.mapPos(closing, -1);
    const body = bodyEnd >= bodyStart ? after.sliceString(bodyStart, bodyEnd) : '';
    if (!damaged && !body.includes('\n')) continue;
    for (const pos of [from, from + 1, closing, closing + 1]) {
      if (edits.some(edit => edit.from <= pos && edit.to > pos)) continue;
      const mapped = transaction.changes.mapPos(pos, 1);
      if (after.sliceString(mapped, mapped + 1) === '*') changes.push({ from: mapped, to: mapped + 1 });
    }
  }
  if (!changes.length) return transaction;
  const unique = [...new Map(changes.map(change => [change.from, change])).values()].sort((a, b) => a.from - b.from);
  return [transaction, { changes: unique, sequential: true }];
}

// CodeMirror is vendored as one local bundle. This adapter stays readable here.
function createDraftEditor(parent, record, { nonce, disabled, onSubmit, onChange, renderMath }) {
  const cm = window.YamoriCodeMirror;
  if (!cm) {
    const input = document.createElement('textarea'); input.value = record.draft;
    input.setAttribute('aria-label', 'Pseudocode draft'); parent.append(input);
    input.addEventListener('input', () => { record.draft = input.value; onChange?.(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); input.setRangeText('    ', input.selectionStart, input.selectionEnd, 'end'); record.draft = input.value; onChange?.(); }
    });
    return { host: parent, serialize: () => ({ doc: input.value }), setDisabled(value) { input.disabled = value; }, focus() { input.focus?.(); }, hasFocus() { return document.activeElement === input; }, destroy() {} };
  }
  const { EditorView, EditorState, Compartment, Decoration, ViewPlugin, WidgetType } = cm;
  const lock = new Compartment();
  // Hidden emphasis markers are presentation, not extra characters a reader
  // should have to delete. Skip them before normal deletion commands.
  function deleteVisible(view, direction, group = false) {
    const selection = view.state.selection;
    if (view.state.readOnly || selection.ranges.length !== 1 || !selection.main.empty) return false;
    const text = view.state.doc.toString(), markers = [];
    for (const match of text.matchAll(/\*\*([^*\n]*)\*\*/g)) markers.push(match.index, match.index + match[0].length - 2);
    let pos = selection.main.head, next;
    do { next = markers.find(from => direction < 0 ? from + 2 === pos : from === pos); if (next !== undefined) pos += direction * 2; } while (next !== undefined);
    if (pos === selection.main.head) return false;
    view.dispatch({ selection: { anchor: pos } });
    return (group ? direction < 0 ? cm.deleteGroupBackward : cm.deleteGroupForward : direction < 0 ? cm.deleteCharBackward : cm.deleteCharForward)(view);
  }
  // A selection may cross only one side of an emphasized phrase. Remove the
  // surviving formatting markers in the same undoable transaction, preserving
  // the actual words. Enter inside a phrase also becomes clean, plain lines.
  const emphasisFilter = EditorState.transactionFilter.of(cleanEmphasis);
  class Equation extends WidgetType {
    constructor(text, from) { super(); this.text = text; this.from = from; }
    eq(other) { return this.text === other.text && this.from === other.from; }
    toDOM(view) {
      const el = document.createElement('span'); el.className = 'edit-equation';
      renderMath(el, this.text); el.title = 'Click to edit this equation';
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('aria-label', 'Edit equation: ' + this.text);
      const activate = event => { event.preventDefault(); if (view.state.readOnly) return; view.dispatch({ selection: { anchor: this.from + (this.text.startsWith('$$') ? 2 : 1) } }); view.focus(); };
      el.addEventListener('mousedown', activate);
      el.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') activate(event); });
      return el;
    }
    ignoreEvent() { return true; }
  }
  function decorate(view) {
    const ranges = [], atoms = [], text = view.state.doc.toString();
    const hidden = (from, to, widget) => {
      const range = Decoration.replace(widget ? { widget } : {}).range(from, to);
      ranges.push(range); atoms.push(range);
    };
    for (const match of text.matchAll(/\*\*([^*\n]*)\*\*/g)) {
      const from = match.index, to = from + match[0].length;
      hidden(from, from + 2); hidden(to - 2, to);
      if (to - from > 4) ranges.push(Decoration.mark({ class: 'edit-strong' }).range(from + 2, to - 2));
    }
    for (const match of text.matchAll(/(\${1,2})([^$\n]+)\1/g)) {
      const from = match.index, to = from + match[0].length;
      const active = view.state.selection.ranges.some(range => range.empty ? range.head > from && range.head < to : range.from < to && range.to > from);
      if (!active) hidden(from, to, new Equation(match[0], from));
      else ranges.push(Decoration.mark({ class: 'edit-formula' }).range(from, to));
    }
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n);
      if (/^\s*#/.test(line.text)) ranges.push(Decoration.line({ class: 'edit-note' }).range(line.from));
      const flow = /^(\s*)(IF|OTHERWISE|ELSE|FOR EACH|WHILE|REPEAT|UNTIL|WHEN|RETURN|FUNCTION)\b/i.exec(line.text);
      if (flow) ranges.push(Decoration.mark({ class: 'edit-flow' }).range(line.from + flow[1].length, line.from + flow[0].length));
    }
    return { decorations: Decoration.set(ranges, true), atoms: Decoration.set(atoms, true) };
  }
  const formatting = ViewPlugin.fromClass(class {
    constructor(view) { Object.assign(this, decorate(view)); }
    update(update) { if (update.docChanged || update.selectionSet) Object.assign(this, decorate(update.view)); }
  }, { decorations: value => value.decorations });
  const extensions = [
    EditorView.cspNonce.of(nonce), cm.lineNumbers(), cm.highlightActiveLineGutter(), cm.highlightActiveLine(), cm.drawSelection(), cm.highlightSpecialChars(), cm.history(), cm.indentUnit.of('    '), cm.indentOnInput(), cm.highlightSelectionMatches(), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Pseudocode draft', spellcheck: 'false', autocapitalize: 'off' }),
    EditorState.tabSize.of(4), formatting, emphasisFilter,
    EditorView.atomicRanges.of(view => view.plugin(formatting)?.atoms || Decoration.none),
    cm.keymap.of([
      { key: 'Mod-Enter', run() { if (!view.state.readOnly) onSubmit(); return true; } },
      { key: 'Backspace', run: view => deleteVisible(view, -1) }, { key: 'Delete', run: view => deleteVisible(view, 1) },
      { key: 'Alt-Backspace', run: view => deleteVisible(view, -1, true) }, { key: 'Ctrl-Backspace', run: view => deleteVisible(view, -1, true) },
      cm.indentWithTab, ...cm.defaultKeymap, ...cm.historyKeymap, ...cm.searchKeymap]),
    lock.of([EditorState.readOnly.of(!!disabled), EditorView.editable.of(!disabled)]),
    EditorView.updateListener.of(update => { if (update.docChanged) record.draft = update.state.doc.toString(); if (update.docChanged || update.selectionSet) onChange?.(); })
  ];
  let editorState;
  try { if (record.editorState?.doc === record.draft) editorState = EditorState.fromJSON(record.editorState, { extensions }, { history: cm.historyField }); } catch { /* Keep the text if old editor history cannot be restored. */ }
  const view = new EditorView({ parent, state: editorState || EditorState.create({ doc: record.draft, extensions }) });
  let locked = !!disabled;
  return { host: parent, view, serialize: () => view.state.toJSON({ history: cm.historyField }), setSubmit(handler) { onSubmit = handler; }, focus: () => view.focus(), hasFocus: () => view.hasFocus, setDisabled(value) {
    if (locked !== value) { locked = value; view.dispatch({ effects: lock.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) }); }
    view.requestMeasure();
  }, destroy: () => view.destroy() };
}

// Shared by the reader and the project map so both follow one palette.
const BASE_STYLES = `:root {
  color-scheme: dark;
  --read-page: #161616; --read-surface: #1b1b1b; --read-header: #222; --read-ink: #f5f5f5;
  --read-muted: #b6b6b6; --read-border: #626262; --read-accent: #f5f5f5; --read-on-accent: #161616;
  --read-note-bg: #262626; --read-note-ink: #dedede; --read-context-bg: #262626; --read-context-ink: #ededed;
  --read-mark-bg: #353535; --read-mark-ink: #fff; --read-hover: #303030; --read-error: #fff;
}
body.vscode-light:not([data-palette="slate"]), body[data-palette="paper"] {
  color-scheme: light;
  --read-page: #fafafa; --read-surface: #fff; --read-header: #f2f2f2; --read-ink: #171717;
  --read-muted: #555; --read-border: #858585; --read-accent: #171717; --read-on-accent: #fff;
  --read-note-bg: #f0f0f0; --read-note-ink: #343434; --read-context-bg: #f0f0f0; --read-context-ink: #292929;
  --read-mark-bg: #e4e4e4; --read-mark-ink: #111; --read-hover: #eaeaea; --read-error: #111;
}
body[data-palette="slate"] { color-scheme: dark; }
body[data-palette="auto"] {
  --read-page: var(--vscode-sideBar-background, light-dark(oklch(98% .004 255), oklch(21% .008 255)));
  --read-surface: var(--vscode-editorWidget-background, light-dark(oklch(96% .005 255), oklch(25% .009 255)));
  --read-ink: var(--vscode-foreground, light-dark(oklch(25% .012 255), oklch(87% .012 255)));
  --read-muted: var(--vscode-descriptionForeground, light-dark(oklch(44% .012 255), oklch(66% .012 255)));
  --read-border: var(--vscode-panel-border, light-dark(oklch(81% .012 255), oklch(33% .012 255)));
  --read-accent: var(--vscode-button-background, light-dark(oklch(44% .14 252), oklch(45% .095 252)));
  --read-on-accent: var(--vscode-button-foreground, oklch(96% .015 252));
  --read-link: var(--vscode-textLink-foreground, light-dark(oklch(43% .14 252), oklch(76% .12 252)));
  --read-header: color-mix(in srgb, var(--read-ink) 4%, var(--read-page));
  --read-hover: color-mix(in srgb, var(--read-ink) 9%, var(--read-page));
  --read-mark-bg: color-mix(in srgb, var(--read-ink) 12%, var(--read-page));
  --read-note-bg: var(--read-header); --read-context-bg: var(--read-header);
  --read-note-ink: var(--read-muted); --read-context-ink: var(--read-ink);
  --read-mark-ink: var(--read-ink);
  --read-error: var(--vscode-errorForeground, var(--read-ink));
}
* { box-sizing: border-box; }
body { --flow: var(--read-ink); --value: var(--read-ink); --string: var(--read-ink); --output: var(--read-ink); --note: var(--read-note-ink); --call: var(--read-ink); margin: 0; background: var(--read-page); color: var(--read-ink); font: 13px/1.6 var(--vscode-font-family, system-ui); }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 0; background: transparent; padding: 5px 9px; transition: background 120ms, transform 120ms, box-shadow 120ms; }
button:hover:not(:disabled) { background: var(--read-hover); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--read-ink); outline-offset: 3px; }
button:disabled { opacity: .45; cursor: default; }
`;
// Reading blocks and pseudocode lines: shared by the reader and the project guide.
const READING_STYLES = `details.reading-block { margin: 0 0 26px; border: 1px solid var(--read-ink); background: var(--read-surface); }
.block-check { padding: 7px 14px; border-bottom: 1px dotted var(--read-border); font-size: 12px; line-height: 1.5; color: var(--read-note-ink); background: var(--read-note-bg); }
.block-check p { margin: 2px 0; }
.block-check-title { font: 600 10px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--read-muted); }
.section-heading { display: flex; align-items: center; gap: 10px; padding: 14px; cursor: pointer; list-style: none; border-bottom: 1px solid var(--read-border); }
.section-heading::-webkit-details-marker { display: none; }
.section-heading::after { content: '−'; font-family: ui-monospace, monospace; }
details:not([open]) .section-heading::after { content: '+'; }
details:not([open]) .section-heading { border-bottom-color: transparent; }
.card-purpose { display: block; color: var(--read-muted); font-size: 12px; font-weight: 400; }
.card-risk-count { display: inline-block; font-size: 11px; margin-top: 4px; color: var(--vscode-editorWarning-foreground, var(--read-ink)); }
.reading-block[open] .card-closed-summary { display: none; }
.block-index { font: 600 11px ui-monospace, monospace; min-width: 20px; color: var(--read-muted); }
h2 { flex: 1; font-size: 15px; line-height: 1.5; font-weight: 650; margin: 0; }
.line { font: 10px ui-monospace, monospace; white-space: nowrap; }
.block-actions { display: inline-flex; gap: 3px; }
.block-actions button { padding: 3px 5px; font-size: 11px; }
pre { font: 15px/1.85 var(--vscode-font-family, system-ui); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; tab-size: 4; padding: 18px 12px 20px; }
.code-line { display: grid; grid-template-columns: 2.1em minmax(0, 1fr); align-items: baseline; min-height: 1.9em; padding-block: 3px; }
.step-body { min-width: 0; }
.code-line.blank { min-height: 1.2em; line-height: 1; padding: 0; }
.code-line.routine:not(:first-child) { margin-top: 1.1em; }
.step-number { color: var(--read-muted); font: 10px/1.8 ui-monospace, monospace; user-select: none; padding-top: 4px; }
.code-line.linked { cursor: pointer; }
.code-line.linked:hover { background: var(--read-hover); }
.code-line.linked:focus-visible { outline: 2px solid var(--read-ink); }
.code-line.decision { margin-top: 7px; }
.important { font-weight: 750; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.keyword, .output, .edit-flow { font-weight: 750; }
.number, .literal { font-weight: 550; }
.code-line.note { margin: 7px 0; padding-block: 9px; font-size: 13px; line-height: 1.7; color: var(--note); background: var(--read-note-bg); border-block: 1px dotted var(--read-border); }
.code-line.context-note { font-size: 14px; }
math { max-inline-size:100%; font: 1.12em 'STIX Two Math', 'Cambria Math', math; margin-inline: 2px; }
.math-display { display:block; overflow:auto; margin-block:.4em; }
.reader-reply { white-space:pre-wrap; overflow-wrap:anywhere; }
.reader-reply code { color:var(--read-ink); background:var(--read-surface); border-radius:3px; padding-inline:3px; }
.reader-reply pre { white-space:pre; overflow:auto; padding:6px 8px; background:var(--read-surface); margin:4px 0; border-radius:4px; }
.reader-reply pre code { padding:0; }
.edge-mark { display:inline-block; font:700 14px/1 system-ui, sans-serif; text-align:center; color:var(--vscode-editorWarning-foreground,var(--read-ink)); }
.edge-mark.handled { color:var(--vscode-testing-iconPassed,var(--read-ink)); }
.value-emoji { font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif; }
`;
const LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><path fill="#888" d="M3 8h9V5h4V3h5v2h3v8h-3v3h3v3h3v3h-5v-2h-4v3h3v4h4v3h-8v-5h-3v5H7v-3h4v-5H8v-4H5v-3h7v-2H6v-2H3z"/><path fill="#fafafa" d="M16 5h4v4h-4zM12 16h9v3h-9z"/><path fill="#161616" d="M17 6h3v1h-3zM2 17h27v2H2z"/></svg>');
function panelHTML(initialPalette = 'auto') {
  const logo = LOGO;
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  const editorLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vendor', 'editor.min.js'), 'utf8');
  const mathLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'vendor', 'katex.min.js'), 'utf8');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori</title><style nonce="${nonce}">
${BASE_STYLES}header { position: sticky; top: 0; z-index: 5; padding: 14px 20px 10px; background: var(--read-page); border-bottom: 1px solid var(--read-border); }
.top, .controls, .brand { display: flex; align-items: center; gap: 8px; }
.top { justify-content: space-between; margin-bottom: 12px; }
.brand { gap: 10px; }
.brand img { width: 32px; height: 32px; image-rendering: pixelated; filter: brightness(0) invert(1); }
body.vscode-light:not([data-palette="slate"]) .brand img, body[data-palette="paper"] .brand img { filter: brightness(0); }
.wordmark { font: 800 18px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: -.05em; }
.ai-settings { position: relative; margin: 0; border: 0; overflow: visible; background: transparent; font-size: 11px; }
.ai-settings > summary { cursor: pointer; list-style: none; max-width: 25ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 2px; color: var(--read-muted); }
.ai-settings > summary::-webkit-details-marker { display: none; }
.ai-controls { position: absolute; right: 0; top: 32px; min-width: 210px; display: grid; padding: 8px; border: 1px solid var(--read-ink); box-shadow: 3px 3px 0 var(--read-ink); background: var(--read-surface); z-index: 6; }
.ai-controls button { text-align: left; overflow-wrap: anywhere; }
.segments { display: inline-flex; gap: 2px; }
.segments button { font-size: 12px; padding: 4px 8px; border-bottom: 2px solid transparent; }
.segments button[aria-pressed="true"] { font-weight: 700; border-bottom-color: var(--read-ink); }
#refresh { margin-left: auto; font-size: 12px; border: 1px solid var(--read-border); }
#colors { font-size: 11px; color: var(--read-muted); }
.crumb { min-width: 0; flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; color: var(--read-muted); font: 12px/1.6 ui-monospace, monospace; }
.crumb strong { color: var(--read-ink); font-weight: 700; }
.control-label { font: 600 10px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; color: var(--read-muted); }
.controls { flex-wrap: wrap; }
.controls .nav { font-size: 12px; border: 1px solid var(--read-border); }
.empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }
#files, #map { flex-shrink: 0; }
.term { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.symbol { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: pointer; }
.symbol:hover, .symbol:focus-visible { background: var(--read-mark-bg); color: var(--read-mark-ink); outline: none; }
.test-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 14px; border-top: 1px dotted var(--read-border); font-size: 12px; }
.test-label { color: var(--read-muted); font: 11px/1.6 ui-monospace, monospace; }
.test-chip { border: 1px solid var(--read-border); font: 12px ui-monospace, monospace; padding: 2px 8px; }
.run-cell { margin: 0 14px 14px; padding: 10px 12px; border: 1px solid var(--read-ink); background: var(--read-page); font-size: 12px; }
.run-cell.simulated { border-style: dashed; }
.run-cell:focus-visible { outline: 2px solid var(--read-ink); outline-offset: 2px; }
.run-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.run-mode, .run-outcome { font: 11px ui-monospace, monospace; color: var(--read-muted); }
.run-outcome.failed, .run-outcome.error, .run-error { color: var(--read-error); font-weight: 650; }
.run-tools { margin-left: auto; display: flex; gap: 4px; }
.run-tools button, .run-nav button, .run-calls button { border: 1px solid var(--read-border); font-size: 11px; padding: 2px 7px; }
.run-calls { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; }
.run-calls button[aria-pressed="true"] { border-color: var(--read-ink); font-weight: 700; }
.run-row { display: grid; grid-template-columns: 4.6em minmax(0, 1fr); gap: 8px; margin-top: 8px; align-items: baseline; }
.run-key { font: 600 10px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .05em; color: var(--read-muted); }
.run-values { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.run-name { font: 12px ui-monospace, monospace; color: var(--read-muted); }
.run-nav { display: flex; align-items: center; gap: 6px; }
.run-position { font: 11px ui-monospace, monospace; }
.run-note { font-style: italic; }
.value { font: 12px ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--read-header); padding: 1px 4px; }
.value.file { background: var(--read-mark-bg); cursor: help; font-family: inherit; }
.value-emoji { font-size: 14px; }
.run-log pre { max-height: 140px; overflow: auto; font-size: 11px; }
.code-line.run-current { background: var(--read-mark-bg); box-shadow: inset 3px 0 0 var(--read-ink); }
.term:hover, .term:focus-visible { background: var(--read-mark-bg); color: var(--read-mark-ink); outline: none; }
main { max-width: 76ch; margin: 0 auto; padding: 28px 24px 44px; scroll-margin-top: 170px; }
h1 { font-size: 22px; line-height: 1.3; font-weight: 650; margin: 0 0 12px; letter-spacing: -.025em; overflow-wrap: anywhere; }
.summary { color: var(--read-muted); margin: 0 0 26px; max-width: 64ch; font-size: 13px; }
.logic-map { margin: 30px 0; }
.map-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid var(--read-ink); }
.map-caption h2, .eyebrow, .block-count, .editor-caption { font: 600 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; text-transform: uppercase; letter-spacing: .06em; }
.eyebrow, .block-count { color: var(--read-muted); }
.logic-map ol { margin: 0; padding: 0; list-style: none; }
.map-item { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto 16px; gap: 10px; align-items: center; width: 100%; padding: 17px 0; border-bottom: 1px solid var(--read-border); text-align: left; }
.map-title { font-size: 14px; line-height: 1.5; font-weight: 550; }
.map-number, .map-range { font: 10px/1.6 ui-monospace, monospace; color: var(--read-muted); }
.map-number { align-self: start; padding-top: 3px; }
.map-arrow { transition: transform 120ms; }
.map-item:hover .map-arrow { transform: translateX(3px); }
.block-navigation { display: flex; align-items: center; gap: 6px; margin: 22px 0 12px; padding-bottom: 10px; border-bottom: 1px solid var(--read-border); }
.block-navigation > button:first-child { margin-right: auto; padding-left: 0; font-size: 12px; }
.block-navigation > button:not(:first-child) { border: 1px solid var(--read-border); min-width: 30px; }
.block-count { margin-right: 6px; font-size: 10px; }
${READING_STYLES}.block-reactions { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--read-border); }
.block-reactions button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 0; font-size: 11px; }
.reaction-icon { display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid var(--read-border); font: 700 12px ui-monospace, monospace; }
details.function-card {
  --card-border: color-mix(in srgb, var(--read-border) 45%, var(--read-surface));
  --card-blue: #76baff;
  --card-symbol: #8ecfeb;
  --card-green: #8bcf91;
  --card-gold: #e3ba71;
  --card-violet: #bdacf8;
  --card-teal: #74d5c9;
  border-color: var(--card-border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--read-ink) 3%, var(--read-surface));
}
body.vscode-light:not([data-palette="slate"]) .function-card, body[data-palette="paper"] .function-card {
  --card-blue: #175a9b; --card-symbol: #146487; --card-green: #306d3a;
  --card-gold: #815a14; --card-violet: #59429c; --card-teal: #146e65;
}
.function-card .section-heading { padding: 15px 16px 9px; align-items: flex-start; border: 0; }
.function-card .section-heading > [role="heading"] { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 15px; font-weight: 650; }
.function-card .block-index { display: grid; place-items: center; width: 32px; min-height: 32px; border: 1px solid var(--card-border); border-radius: 6px; }
.function-card .block-actions button { min-width: 26px; font-size: 15px; border-radius: 4px; }
.card-symbol-line { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 9px; margin-top: 3px; }
.card-symbol { color: var(--card-symbol); font: 12px/1.4 ui-monospace, monospace; }
.card-source-chip { font: 10px/1.25 ui-monospace, monospace; color: var(--read-muted); border: 1px solid var(--card-border); border-radius: 4px; padding: 2px 5px; white-space: nowrap; }
.pseudocode-card { display: block; padding: 6px 16px 12px; font: 13px/1.5 var(--vscode-font-family, system-ui); }
.pseudocode-card .code-line { grid-template-columns: 2.3em minmax(0, 1fr) auto; min-height: 0; gap: 5px; padding: 6px 8px; border-radius: 5px; }
.pseudocode-card .code-line.blank { height: 6px; padding: 0; }
.pseudocode-card .card-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px 9px; padding: 0; margin: 12px 0 6px; }
.pseudocode-card .card-heading .step-body { flex: 1 1 160px; }
.pseudocode-card .card-heading .step-number { display: none; }
.pseudocode-card .card-group .card-field-label { flex-basis: auto; }
.pseudocode-card .card-group { border-top: 1px solid var(--card-border); border-radius: 0; padding-top: 11px; }
.pseudocode-card .card-purpose-field { display: block; margin-top: 7px; }
.pseudocode-card .card-purpose-field .step-body { display: block; margin-top: 3px; }
.card-field-label { flex: 0 0 78px; color: var(--read-muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.pseudocode-card .step-number { padding-top: 0; font-size: 11px; }
.pseudocode-card .card-annotation { padding-block: 2px 7px; color: var(--read-muted); font-size: 12px; }
.card-annotation-tag, .card-edge-count { padding: 2px 5px; border-radius: 4px; font: 700 9px/1.3 ui-monospace, monospace; letter-spacing: .04em; white-space: nowrap; }
.card-annotation-tag { margin-inline-end: 6px; color: var(--card-violet); background: color-mix(in srgb, var(--card-violet) 13%, transparent); }
.card-annotation-tag.shapes { color: var(--card-teal); background: color-mix(in srgb, var(--card-teal) 12%, transparent); }
.pseudocode-card .card-handled { background: color-mix(in srgb, var(--card-green) 11%, transparent); margin-bottom: 4px; }
.pseudocode-card .card-risk { background: color-mix(in srgb, var(--card-gold) 12%, transparent); margin-bottom: 4px; }
.pseudocode-card .card-handled .step-number { color: var(--card-green); }
.pseudocode-card .card-risk .step-number, .card-edge-count { color: var(--card-gold); }
.card-edge-count { border: 1px solid color-mix(in srgb, var(--card-gold) 40%, transparent); border-radius: 12px; }
.pseudocode-card .linked:hover { background: color-mix(in srgb, var(--card-blue) 12%, transparent); }
.pseudocode-card .card-active { background: color-mix(in srgb, var(--card-blue) 19%, transparent); box-shadow: inset 2px 0 var(--card-blue); }
.card-active .card-source-chip, .card-active .step-number { color: var(--card-blue); }
.function-card .block-reactions { margin: 0 16px; padding: 10px 0 15px; gap: 6px; border-color: var(--card-border); }
.function-card .block-reactions button { border: 1px solid var(--card-border); border-radius: 5px; padding: 3px 8px; }
.function-card .reaction-icon { border: 0; }
.function-card button.card-test-action { color: var(--card-gold); border-color: color-mix(in srgb, var(--card-gold) 46%, transparent); }
@media (max-width: 350px) {
  .function-card .section-heading { flex-wrap: wrap; }
  .function-card .section-heading > [role="heading"] { flex-basis: calc(100% - 55px); }
  .function-card .block-actions { margin-inline-start: auto; }
  .pseudocode-card { padding-inline: 10px; }
  .pseudocode-card .code-line { grid-template-columns: 1.7em minmax(0, 1fr) auto; }
  .pseudocode-card .card-heading .step-body { flex-basis: 110px; }
}
.block-editor { padding: 14px; }
.edit-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.editor-caption { margin: 0; }
.edit-hint { margin: 0 0 12px; color: var(--read-muted); font-size: 11px; }
.draft-editor { border: 1px solid var(--read-border); min-height: 220px; background: var(--read-surface); }
.draft-editor:focus-within { outline: 1px solid var(--read-ink); }
.cm-editor { font-size: 15px; line-height: 1.85; color: var(--read-ink); }
.cm-editor.cm-focused { outline: none; }
.cm-editor .cm-scroller { font-family: var(--vscode-editor-font-family, ui-monospace, monospace); overflow: auto; max-height: 48vh; min-height: 220px; }
.cm-editor .cm-content { padding: 14px 0; caret-color: var(--read-ink); }
.cm-editor .cm-line { padding: 2px 12px 2px 8px; }
.cm-editor .cm-gutters { background: var(--read-surface); border: 0; color: var(--read-muted); font-size: 10px; min-width: 28px; }
.cm-editor .cm-lineNumbers .cm-gutterElement { padding-top: 4px; }
.cm-editor .cm-activeLine, .cm-editor .cm-activeLineGutter { background: var(--read-header); }
.cm-editor .cm-cursor { border-left-color: var(--read-ink); }
.cm-editor.cm-focused .cm-selectionBackground, .cm-editor .cm-selectionBackground { background: var(--read-mark-bg); }
.cm-editor .cm-searchMatch { outline: 1px solid var(--read-ink); background: var(--read-header); }
.cm-editor .cm-selectionMatch { background: var(--read-header); }
.cm-editor .cm-panels { background: var(--read-header); color: var(--read-ink); }
.cm-editor .cm-textfield, .cm-editor .cm-button { background: var(--read-surface); color: var(--read-ink); border: 1px solid var(--read-border); border-radius: 0; }
.cm-editor input[type="checkbox"] { accent-color: var(--read-accent); }
.cm-editor .edit-strong { font-weight: 750; }
.cm-editor .edit-note { color: var(--read-muted); font-style: italic; padding-block: 7px; }
.edit-equation { cursor: text; font-family: var(--vscode-font-family, system-ui); }
.edit-equation:hover { background: var(--read-hover); }
.edit-equation:focus-visible { outline: 2px solid var(--read-ink); outline-offset: 2px; }
.edit-formula { background: var(--read-header); font-size: 13px; }
textarea { display: block; width: 100%; min-height: 220px; resize: vertical; padding: 12px; color: var(--read-ink); background: var(--read-surface); border: 1px solid var(--read-border); border-radius: 0; font: 14px/1.85 var(--vscode-editor-font-family, monospace); tab-size: 4; }
textarea:focus { outline: 1px solid var(--read-ink); }
.instruction { min-height: 64px; margin-top: 12px; font: 12px/1.6 var(--vscode-font-family, system-ui); }
.edit-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
.primary { background: var(--read-accent); color: var(--read-on-accent); border: 1px solid var(--read-accent); padding: 7px 11px; font-size: 12px; }
.primary:hover:not(:disabled) { background: var(--read-accent); transform: translate(-1px, -1px); box-shadow: 2px 2px 0 var(--read-muted); }
.review-status.running::before { content: '● '; animation: review-pulse 1.4s ease-in-out infinite; }
@keyframes review-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .review-status.running::before { animation: none; } }
.notice { color: var(--read-muted); margin: 0 0 20px; font-size: 12px; }
.sync-warning { border: 1px solid var(--read-ink); padding: 12px; margin-bottom: 20px; }
.sync-warning p { margin: 0 0 8px; font-size: 12px; }
.sync-hint, .draft-cache-status { color: var(--read-muted); font-size: 11px; margin: 9px 0 0; }
.block-stale { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px dashed var(--read-border); font-size: 11px; }
.block-stale button { border: 1px solid var(--read-border); }
.earlier-drafts { margin-bottom: 20px; font-size: 11px; color: var(--read-muted); }
.earlier-drafts > div { display: flex; justify-content: space-between; gap: 12px; padding-block: 8px; }
.notice.error { border: 1px solid var(--read-ink); padding: 12px; color: var(--read-ink); }
.waiting { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.waiting img { width: 32px; height: 32px; image-rendering: pixelated; filter: brightness(0) invert(1); animation: pixel-step 1.2s steps(2, end) infinite; }
body.vscode-light:not([data-palette="slate"]) .waiting img, body[data-palette="paper"] .waiting img { filter: brightness(0); }
.waiting .notice { margin: 0; }
.run { margin: 0 0 22px; border: 1px solid var(--read-ink); background: var(--read-surface); padding: 12px 14px; }
.run.live { box-shadow: 3px 3px 0 var(--read-ink); }
.run-head { display: flex; align-items: center; gap: 10px; }
.run-head img { width: 28px; height: 28px; image-rendering: pixelated; filter: brightness(0) invert(1); animation: pixel-step 1.2s steps(2, end) infinite; }
body.vscode-light:not([data-palette="slate"]) .run-head img, body[data-palette="paper"] .run-head img { filter: brightness(0); }
.run-title { font-weight: 650; }
.run-time { margin-left: auto; font: 12px ui-monospace, monospace; color: var(--read-muted); }
.run-meta { margin: 2px 0 10px; font: 11px/1.5 ui-monospace, monospace; color: var(--read-muted); overflow-wrap: anywhere; }
.run ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.run li { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px; font-size: 12px; line-height: 1.5; }
.run li .icon, .run li .time { font-family: ui-monospace, monospace; }
.run li .time { color: var(--read-muted); }
.run li.waiting, .run li.skipped, .run li.stopped { color: var(--read-muted); }
.run li.active .label { font-weight: 700; }
.run li .detail { display: block; color: var(--read-muted); font-size: 11px; overflow-wrap: anywhere; }
.run .hint { margin: 10px 0 0; font-size: 12px; }
details.run { padding: 8px 12px; }
details.run summary { cursor: pointer; font: 11px/1.6 ui-monospace, monospace; color: var(--read-muted); }
details.run ol { margin-top: 8px; }
@keyframes pixel-step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
.jump-in { animation: arrive 150ms cubic-bezier(.16, 1, .3, 1); }
@keyframes arrive { from { opacity: .6; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.activity { margin-bottom: 20px; }
.activity summary { cursor: pointer; font-size: 11px; color: var(--read-muted); }
.activity ol { font-size: 11px; color: var(--read-muted); padding-left: 18px; }
.empty { margin-top: 24px; }
.empty p { color: var(--read-muted); max-width: 44ch; }
.empty .primary { margin-top: 16px; }
footer { display: flex; gap: 10px; align-items: center; justify-content: space-between; color: var(--read-muted); font-size: 10px; padding-top: 14px; border-top: 1px solid var(--read-border); }
footer button { padding: 0 4px; font-size: 11px; }
.skeleton { height: 8px; margin: 18px 0; background: var(--read-header); }
@media(max-width: 560px) {
  header { padding: 12px; } main { padding: 24px 14px 36px; }
  .section-heading { display: grid; grid-template-columns: 20px minmax(0,1fr) auto 10px; gap: 6px; }
  .section-heading .block-index { grid-column: 1; grid-row: 1; }
  .section-heading h2 { grid-column: 2 / 4; grid-row: 1; min-width: 0; overflow-wrap: anywhere; }
  .section-heading::after { grid-column: 4; grid-row: 1; }
  .section-heading .line { grid-column: 2; grid-row: 2; justify-self: start; }
  .section-heading .block-actions { grid-column: 3 / 5; grid-row: 2; justify-self: end; }
  .map-item { gap: 7px; grid-template-columns: 22px minmax(0,1fr) auto 10px; }
  .map-range { font-size: 9px; } .map-title { font-size: 13px; }
  .ai-settings > summary { max-width: 19ch; } .segments button { padding-inline: 6px; }
  .block-editor { padding: 10px; } .cm-editor { font-size: 14px; }
}
@media(prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --read-page: var(--vscode-editor-background); --read-surface: var(--vscode-editor-background); --read-header: var(--vscode-editor-background);
  --read-ink: var(--vscode-editor-foreground); --read-muted: var(--vscode-editor-foreground); --read-border: var(--vscode-contrastBorder, var(--vscode-editor-foreground));
  --read-accent: var(--vscode-editor-foreground); --read-on-accent: var(--vscode-editor-background);
  --read-context-bg: var(--vscode-editor-background); --read-context-ink: var(--vscode-editor-foreground); --read-note-bg: var(--vscode-editor-background); --read-note-ink: var(--vscode-editor-foreground);
  --read-mark-bg: color-mix(in srgb, var(--read-ink) 14%, var(--read-page)); --read-mark-ink: var(--read-ink); --read-hover: color-mix(in srgb, var(--read-ink) 9%, var(--read-page));
}
@media(forced-colors: active) { body, header, .reading-block, .section-heading, .code-line.note { background: Canvas; color: CanvasText; } button, .segments, details, .code-line.note { border: 1px solid ButtonText; } }
.workspace-nav { display:flex; align-items:center; gap:3px; padding:3px; border:1px solid var(--read-border); }
.workspace-nav button { padding:6px 13px; border:0; font:600 13px var(--vscode-font-family,system-ui); }
.workspace-nav .current-view { color:var(--read-ink); background:var(--read-header); opacity:1; }
.workspace-nav button:focus-visible { outline:2px solid var(--read-accent); outline-offset:2px; }
@media(max-width:600px) { .workspace-nav { order:2; } .top { flex-wrap:wrap; } }

body { --diff-add: #79c99b; --diff-remove: #f0a29a; }
body.vscode-light:not([data-palette="slate"]), body[data-palette="paper"] { --diff-add: #21633e; --diff-remove: #a23733; }
.diff-added { --diff-ink: var(--diff-add); }
.diff-removed { --diff-ink: var(--diff-remove); }
.code-line.diff-added, .code-line.diff-removed { background: color-mix(in srgb, var(--diff-ink) 10%, var(--read-surface)); }
.code-line:is(.diff-added,.diff-removed):hover { background: color-mix(in srgb, var(--diff-ink) 19%, var(--read-surface)); }
.code-line .diff-sign, .block-diff .diff-sign { color: var(--diff-ink); font-weight: 700; }
.block-diff { display: inline-flex; gap: .35em; margin-inline-end: .55em; }
.comparison-label { margin: 0 0 14px; color: var(--read-muted); font-size: 12px; overflow-wrap: anywhere; }
body[data-comparison] .ai-settings, body[data-comparison] #colors, body[data-comparison] #map, body[data-comparison] #plan { display: none; }

${LOGIC_STYLE}</style></head><body data-palette="${palette}">
<header><div class="top"><span class="brand"><img src="${logo}" alt="Pixel gecko samurai"><span class="wordmark">yamori</span></span>
<nav class="workspace-nav" aria-label="Yamori navigation"><button aria-current="page" class="current-view" disabled>Read</button><button id="map" title="Explore project files and connections">Map</button><button id="plan" title="Plan changes with Codex or Claude">Plan</button></nav>
<button id="source" class="crumb" title="Show this file in the editor">No file yet</button>
<details class="ai-settings"><summary id="ai-summary" title="Which AI writes explanations, and how hard it thinks">AI ▾</summary><div class="ai-controls"><button id="provider" title="Choose AI provider">Codex ▾</button><button id="model" title="Choose model for new requests" aria-label="Choose model for new requests">Default ▾</button><button id="effort" title="Choose reasoning effort for new requests" aria-label="Choose reasoning effort">Effort: Default ▾</button><button id="refinement" title="Choose refinement steps" aria-label="Choose refinement steps">Refine: 1 ▾</button><button id="setup-ai" title="Install, sign in to or switch between Claude and ChatGPT">Set up AI…</button></div></details>
<button id="colors" title="Choose reading colors" aria-label="Choose reading colors">Theme</button></div>
<div class="controls"><span class="control-label" id="detail-label">Detail</span><div class="segments" role="group" aria-labelledby="detail-label">
<button data-level="overview" aria-pressed="false" title="Short: the goal and the main stages">Overview</button>
<button data-level="logic" aria-pressed="true" title="Step by step: decisions, data and useful math">Logic</button></div>
<button id="files" class="nav" title="Explain another file. Shows open Yamori tabs and project files grouped by folder." aria-label="Switch file">Switch file…</button>

<button id="refresh" title="Write this explanation again from the current code">Regenerate</button></div></header>
<main id="content" aria-busy="false"></main>
<script nonce="${nonce}">
${mathLibrary}
${editorLibrary}
const cleanEmphasis = ${cleanEmphasis.toString()};
const createDraftEditor = ${createDraftEditor.toString()};
const editorNonce = ${JSON.stringify(nonce)};
const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const refresh = document.getElementById('refresh');
let state = {};
const collapsed = new Set();
const drafts = new Map();
const draftEditors = new Map();
const focusedBlocks = new Map();
const draftTimers = new Map();
let draftVersion = 0;
let animateNext = false;
let editing;
let reacting;
const activeCardLines = new Map();
const reactions = [
  { id: 'clarify', icon: '?', label: 'Explain better', pending: 'Explaining…', instruction: 'Explain this block better for a mathematically capable reader with less programming experience. Identify the missing conceptual bridge: define what the data represents, unpack a non-obvious operation, or derive the key relationship in a few short lines. Explain why it works and the assumptions it needs. Preserve the block meaning, existing edits and important caveats; add understanding, not filler. Keep phase breaks and source links. Change only this explanation.' },
  { id: 'shorten', icon: '−', label: 'Make shorter', pending: 'Shortening…', instruction: 'Make this block shorter and easier to scan. Cut repetition, filler and incidental detail; use short casual actions. Preserve its meaning, existing edits, meaningful branches, key mathematical bridge, important assumptions and numerical caveats. Keep useful phase breaks and source links. Change only this explanation.' },
  { id: 'example', icon: '+', label: 'Show example', pending: 'Adding example…', instruction: 'Add one tiny worked example that makes this block click. Put it in a clearly labeled # Example: note with illustrative inputs, necessary assumptions and the resulting output or state change. Use simple values consistent with the visible computation, and show the key intermediate step if useful. Do not imply these were actual runtime values or infer missing function internals. Preserve existing steps, edits, meaning and caveats. Keep it short and source-linked; change only this explanation.' }
];
const tokenize = ${tokenize.toString()};
const glossaryMatcher = ${glossaryMatcher.toString()};
const glossaryParts = ${glossaryParts.toString()};
let termMatcher, symbolMatcher, appliedFocus;
const pseudocodeLines = ${pseudocodeLines.toString()};
const parseCard = ${parseCard.toString()};
function appendCardSummary(parent, card) {
  parent.append(node('span', card.purpose, 'card-purpose'));
  const badge = node('span', '⚠ ' + card.riskCount, 'card-risk-count');
  badge.setAttribute('aria-label', card.riskCount + ' risks or caveats to check');
  parent.append(badge);
}
const mathParts = ${mathParts.toString()};
const codeParts = ${codeParts.toString()};
const emphasisParts = ${emphasisParts.toString()};
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const draftKey = (s, index) => (s.draftScope || s.documentKey) + ':' + (s.draftKeys?.[index] || index);
const blockIsStale = (s, index) => !!s.stale && (!Array.isArray(s.staleBlocks) || s.staleBlocks.includes(index));
const dateLabel = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'recently';
function persistDraft(key, flush = false) {
  const record = drafts.get(key); if (!record || !record.scope) return;
  if (draftTimers.has(key) && typeof clearTimeout === 'function') clearTimeout(draftTimers.get(key));
  const write = () => {
    draftTimers.delete(key); record.editorState = draftEditors.get(key)?.serialize();
    record.version = Date.now() + ':' + (++draftVersion); record.saving = true;
    const label = document.getElementById('draft-cache-status'); if (label) label.textContent = 'Saving locally…';
    send('saveDraft', { scope: record.scope, key, index: record.index, title: record.title, draft: record.draft, instruction: record.instruction, baseText: record.baseText, editorState: record.editorState, version: record.version });
  };
  if (!flush && typeof setTimeout === 'function') draftTimers.set(key, setTimeout(write, 300)); else write();
}
function flushDrafts() { for (const key of [...draftTimers.keys()]) persistDraft(key, true); }
// A clickable name inside pseudocode: text only, opened by index, never by path.
function linkSpan(text, className, title, type, index) {
  const link = node('span', text, className), open = event => { event?.stopPropagation?.(); event?.preventDefault?.(); send(type, { index, documentKey: state.documentKey }); };
  link.title = title; link.tabIndex = 0; link.setAttribute('role', 'link');
  link.addEventListener('click', open);
  link.addEventListener('keydown', event => { if (event.key === 'Enter') open(event); });
  return link;
}
function symbolTitle(link) {
  const here = state.name && state.name.split(' · ')[0] === link.file;
  return link.name + ': ' + link.kind + ' in ' + link.file + ':' + link.line + (link.block ? ' · "' + link.block + '"' : '') + (link.purpose && !here ? ' · ' + link.purpose : '')
    + (here ? ' · click to show its block' : link.explained ? ' · click to open its explanation' : ' · not explained yet; click to explain it');
}
function appendText(parent, text) {
  for (const token of tokenize(text)) {
    if ((!termMatcher && !symbolMatcher) || (token.kind && token.kind !== 'comment')) { parent.append(node('span', token.text, token.kind)); continue; }
    const span = node('span', undefined, token.kind);
    // Project terms first (L1, HOOK), then project names (plan_loops, Script).
    for (const part of glossaryParts(token.text, termMatcher)) {
      const term = part.term === undefined ? undefined : state.glossary?.[part.term];
      if (term) { span.append(linkSpan(part.text, 'term', term.term + ': ' + (term.meaning || (term.kind || 'project name') + ' defined elsewhere') + (term.defined ? ' · defined in ' + term.defined + ' (click to open)' : ''), 'revealTerm', part.term)); continue; }
      for (const piece of glossaryParts(part.text, symbolMatcher)) {
        const link = piece.term === undefined ? undefined : state.symbols?.[piece.term];
        span.append(link ? linkSpan(piece.text, 'symbol', symbolTitle(link), 'openSymbol', piece.term) : document.createTextNode(piece.text));
      }
    }
    parent.append(span);
  }
}
function appendMath(parent, text) {
  for (const part of mathParts(text)) {
    if (!part.tex) { appendText(parent, part.text); continue; }
    try {
      const markup = katex.renderToString(part.tex, { output: 'mathml', displayMode: part.display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100, maxSize: 10 });
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const math = document.importNode(parsed.querySelector('math'), true);
      if (!part.display) parent.append(math);
      else { const display = node('span', undefined, 'math-display'); display.append(math); parent.append(display); }
    } catch { appendText(parent, part.text); }
  }
}
function appendInline(parent, text) {
  for (const part of emphasisParts(text)) {
    const target = part.strong ? node('strong', undefined, 'important') : parent;
    appendMath(target, part.text); if (part.strong) parent.append(target);
  }
}
function appendReply(parent, text) {
  parent.className += ' reader-reply';
  for (const part of codeParts(text, true)) {
    if (part.code) { const block = node('pre'); block.append(node('code', part.text.trimEnd())); parent.append(block); continue; }
    for (const phrase of emphasisParts(part.text)) {
      const target = phrase.strong ? node('strong') : parent;
      for (const inline of codeParts(phrase.text)) {
        if (inline.code) target.append(node('code', inline.text));
        else appendMath(target, inline.text);
      }
      if (phrase.strong) parent.append(target);
    }
  }
}
function edgeMark(kind) {
  const handled = kind === 'card-handled';
  const marker = node('span', handled ? '✓' : '⚠︎', 'step-number edge-mark' + (handled ? ' handled' : ''));
  marker.setAttribute('aria-label', handled ? 'Handled edge case' : 'Worth checking');
  return marker;
}
function wireDiff(row, change, text, s) {
  const label = change.kind === 'removed' ? 'Removed step' : 'Added step';
  row.className += ' diff-' + change.kind + ' linked';
  row.title = label + ' · source L' + change.sourceLine;
  row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', label + ' · ' + text.trim() + ' · Open source diff');
  const jump = () => send('inlineDiffJump', { documentKey: s.documentKey, id: change.id });
  row.addEventListener('click', jump);
  row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); } });
}
function diffSign(kind, className = '') {
  const sign = node('span', kind === 'added' ? '+' : '−', 'diff-sign diff-' + kind + (className ? ' ' + className : ''));
  sign.setAttribute('aria-hidden', 'true');
  return sign;
}
function appendRemoved(code, changes, s) {
  for (const change of changes || []) {
    const row = node('span', undefined, 'code-line');
    const body = node('span', undefined, 'step-body');
    body.style.paddingInlineStart = Math.min(change.text.length - change.text.trimStart().length, 40) * .55 + 'em';
    appendInline(body, change.text.trimStart());
    row.append(diffSign('removed', 'step-number'), body);
    wireDiff(row, change, change.text, s); code.append(row);
  }
}
const workspaceUI = (${logicWorkspaceUI.toString()})({ node, send, appendInline, appendReply, edgeMark, parseCard, pseudocodeLines, diffSign, appendRemoved, appendTests, mascotImage: ${JSON.stringify(logo)} });
function render(s) {
  send('clearHover');
  const restoreEditorFocus = editing && draftEditors.get(editing.key)?.hasFocus();
  state = s;
  termMatcher = glossaryMatcher(s.glossary);
  symbolMatcher = glossaryMatcher((s.symbols || []).map(link => ({ term: link.name })));
  for (const row of s.drafts || []) if (!drafts.has(row.key)) drafts.set(row.key, { ...row, scope: s.draftScope });
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  if (s.comparison) document.body.setAttribute('data-comparison', '');
  else document.body.removeAttribute?.('data-comparison');
  if (editing && editing.documentKey !== s.documentKey) editing = undefined;
  if (!s.busy || reacting?.documentKey !== s.documentKey) reacting = undefined;
  content.className = s.level === 'logic' ? 'paper' : '';
  document.getElementById('provider').textContent = s.providerLabel + ' ▾';
  document.getElementById('model').textContent = (s.requestedModel || 'Default') + ' ▾';
  document.getElementById('model').title = 'New requests: ' + (s.requestedModel || 'provider default') + ' · Choose model';
  document.getElementById('effort').textContent = 'Effort: ' + (s.requestedEffort || 'Default') + ' ▾';
  document.getElementById('refinement').textContent = 'Refine: ' + (s.refinementSteps ?? 1) + ' ▾';
  document.getElementById('effort').title = 'New requests: ' + (s.requestedEffort || 'CLI default') + ' reasoning effort';
  const crumb = document.getElementById('source');
  crumb.replaceChildren();
  if (s.name) {
    // "pipeline/plan.py · lines 3–9" reads as pipeline › plan.py · lines 3–9.
    const [file, range] = s.name.split(' · '), parts = file.split('/');
    if (parts.length > 1) crumb.append(document.createTextNode(parts.slice(0, -1).join(' › ') + ' › '));
    crumb.append(node('strong', parts.at(-1)));
    if (range) crumb.append(document.createTextNode(' · ' + range));
    crumb.title = 'Show ' + file + ' in the editor';
  } else { crumb.textContent = 'No file yet'; crumb.title = 'Open a file to explain it'; }
  crumb.disabled = !s.name;
  if (s.comparison) crumb.title = 'Open source diff';
  const fileButton = document.getElementById('files');
  if (s.comparison) { fileButton.textContent = 'Changed files'; fileButton.title = 'Choose another file in this comparison'; fileButton.setAttribute('aria-label', 'Changed files'); }
  document.querySelectorAll('[data-level]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.level === s.level)); if (s.comparison) b.disabled = !!s.busy; });
  refresh.textContent = s.busy ? 'Stop' : s.stale ? 'Update from code' : 'Regenerate'; refresh.disabled = !s.name || (!!s.sourceMissing && !s.busy);
  refresh.title = s.busy ? 'Stop the current request' : s.stale ? 'The code changed: update this explanation to match it' : 'Write this explanation again from the current code';
  if (s.comparison && !s.busy) { refresh.textContent = 'Refresh'; refresh.title = 'Refresh this comparison'; }
  content.setAttribute('aria-busy', String(!!s.busy));
  if (s.workspace) {
    document.body.setAttribute('data-workspace', '');
    workspaceUI.show(content, s);
    return;
  }
  document.body.removeAttribute?.('data-workspace');
  workspaceUI.hide(); content.replaceChildren();
  if (s.comparison) {
    const comparison = s.comparison;
    content.append(node('p', comparison.label, 'comparison-label'));
    const message = comparison.notice || comparison.status;
    if (message && !s.busy) { const notice = node('p', message, 'notice'); notice.setAttribute('role', 'status'); content.append(notice); }
    if (comparison.generate && !s.busy) {
      const explain = node('button', comparison.generate, 'primary');
      explain.addEventListener('click', () => send('explainComparison', { documentKey: s.documentKey }));
      content.append(explain);
    }
  }
  if (s.sourceProposal && !s.workspace) {
    const proposal = s.sourceProposal;
    const notice = node('div', undefined, 'notice');
    notice.append(node('p', proposal.phase === 'previewing' ? 'Preparing preview…' : proposal.message || 'Preview ready'));
    if (proposal.ready) {
      const apply = node('button', proposal.mode === 'test' ? 'Accept test' : 'Apply to code', 'primary');
      apply.addEventListener('click', () => send('workspaceAccept', { id: proposal.id }));
      const diff = node('button', 'Preview diff');
      diff.addEventListener('click', () => send('workspaceShowDiff', { id: proposal.id }));
      notice.append(apply, diff);
    }
    const close = node('button', 'Dismiss');
    close.addEventListener('click', () => send('workspaceCancel'));
    notice.append(close); content.append(notice);
  }
  if (s.result?.refinement?.warning) {
    const notice = node('div', undefined, 'notice'); notice.setAttribute('role', 'status'); notice.append(node('p', s.result.refinement.warning));
    if (s.result.refinement.status === 'incomplete') { const retry = node('button', 'Retry review'); retry.disabled = !!s.busy || !!s.sourceMissing; retry.addEventListener('click', () => { flushDrafts(); send('retryReview'); }); notice.append(retry); }
    content.append(notice);
  }
  if (s.result?.refinement?.status === 'pending' && s.busy) {
    content.append(node('p', 'Updated drafts are saved. Review is pending while the remaining batches are written.', 'notice'));
  }
  if (s.legacyCardBlocks?.length) {
    const count = s.legacyCardBlocks.length;
    const notice = node('div', undefined, 'notice');
    notice.append(node('p', count + ' function block' + (count === 1 ? ' still uses' : 's still use') + ' the legacy format.'));
    const upgrade = node('button', 'Upgrade legacy cards');
    upgrade.disabled = !!s.busy || !!s.sourceMissing;
    upgrade.addEventListener('click', () => { flushDrafts(); send('upgradeCards'); });
    notice.append(upgrade); content.append(notice);
  }
  if (s.result?.sections?.some(section => section.omittedSourceLinks > 0)) { const notice = node('p', 'Some AI source links were invalid and have been disabled. The explanation is still readable.', 'notice source-links'); notice.setAttribute('role', 'status'); content.append(notice); }
  if (s.modelNotice) content.append(node('p', s.modelNotice, 'notice'));
  if (s.writtenBy && s.result && !s.busy) content.append(node('p', 'Written by ' + s.writtenBy + ' during an agent session and saved through Yamori. Regenerate to have Yamori write its own.', 'notice'));
  if (s.review) { const line = node('p', s.review.text, 'notice review-status ' + s.review.state); line.setAttribute('role', 'status'); content.append(line); }
  if (s.error) {
    const el = node('div', undefined, 'notice error'); el.setAttribute('role', 'alert'); el.append(node('p', s.error));
    if (s.setupHint) {
      const connect = node('button', 'Set up AI', 'primary'); connect.disabled = !!s.busy;
      connect.title = 'Sign in, install, or switch to the other AI. Opens the setup screen.';
      connect.addEventListener('click', () => send('setup')); el.append(connect);
    }
    content.append(el);
  }
  if (s.run) renderRun(s);
  else if (s.busy) {
    const waiting = node('div', undefined, 'waiting');
    const mascot = node('img'); mascot.src = ${JSON.stringify(logo)}; mascot.alt = '';
    waiting.append(mascot);
    const label = node('div', s.progress || 'Connecting…', 'notice'); label.setAttribute('role', 'status'); waiting.append(label); content.append(waiting);
  }
  if (s.stale) {
    const warning = node('div', undefined, 'sync-warning'); warning.setAttribute('role', 'status');
    const count = s.staleBlocks?.length;
    const message = s.sourceMissing ? s.changeReason || 'Source file unavailable. The cached explanation is kept.' : (s.changeReason || 'Source changed') + ' · ' + dateLabel(s.changedAt) + (count ? ' · ' + count + ' block' + (count === 1 ? '' : 's') + (count === 1 ? ' needs review.' : ' need review.') : '.');
    warning.append(node('p', message));
    if (!s.sourceMissing) { const update = node('button', 'Update from code', 'primary'); update.disabled = !!s.busy; update.addEventListener('click', () => { flushDrafts(); send('refresh'); }); warning.append(update); }
    warning.append(node('p', s.sourceMissing ? 'Restore or reselect the source to refresh. Your local cache is still available.' : s.sharedChange ? 'Shared or new code changed. Update from code also reorganizes the logic map.' : 'Refresh one block below, or update the cached explanation together.', 'sync-hint'));
    content.append(warning);
  }
  if (s.cacheWarning) { const warning = node('p', s.cacheWarning, 'notice error'); warning.setAttribute('role', 'alert'); content.append(warning); }

  const activitySteps = (s.activity || []).filter(step => typeof step === 'string' && step.trim());
  if (activitySteps.length) {
    const activity = node('details', undefined, 'activity');
    const caption = node('summary'); caption.id = 'activity-caption';
    const list = node('ol'); activitySteps.forEach(step => list.append(node('li', step)));
    activity.append(caption, list); content.append(activity);
  }
  const aiSummary = document.getElementById('ai-summary');
  if (aiSummary) aiSummary.textContent = 'AI: ' + s.providerLabel + (s.requestedModel ? ' · ' + s.requestedModel : '') + ' ▾';
  if (s.result) {
    content.append(node('h1', s.result.title));
    const navKey = s.comparison ? s.documentKey : [s.name, s.level, s.providerLabel].join('|');
    // A link, hover or CodeLens asked for the block covering a line.
    if (s.focusLine?.token && s.focusLine.token !== appliedFocus && !s.partial) {
      const index = s.result.sections.findIndex(section => s.focusLine.line >= section.startLine && s.focusLine.line <= section.endLine);
      appliedFocus = s.focusLine.token;
      if (index >= 0) focusedBlocks.set(navKey, index);
    }
    const cards = s.result.sections.map(section => parseCard(section.pseudocode || ''));
    let selected = focusedBlocks.get(navKey);
    if (selected >= s.result.sections.length) selected = undefined;
    if (selected === undefined && !focusedBlocks.has(navKey) && (s.comparison || s.result.sections.length === 1)) {
      const firstChanged = Object.keys(s.inlineDiff?.blocks || {})[0];
      if (firstChanged !== undefined) { selected = Number(firstChanged); focusedBlocks.set(navKey, selected); }
    }
    if (selected === undefined && (s.result.sections.length === 1 && !cards[0] || s.partial && !s.result.draftComplete)) selected = 0;
    const openBlock = index => {
      focusedBlocks.set(navKey, index);
      if (cards[index]) collapsed.delete([s.name, s.level, s.providerLabel, index].join('|'));
      const key = draftKey(s, index), draft = drafts.get(key);
      editing = draft && (draft.draft !== draft.baseText || draft.instruction) ? { key, index, documentKey: s.documentKey } : undefined;
      animateNext = true; render(state);
      content.querySelector?.('.section-heading')?.focus?.();
      content.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    };
    if (selected === undefined) {
      content.append(node('p', s.result.summary, 'summary'));
      const map = node('nav', undefined, 'logic-map'); map.setAttribute('aria-label', 'Script logic map');
      const caption = node('div', undefined, 'map-caption');
      caption.append(node('h2', 'Logic map'), node('span', s.result.sections.length + ' parts', 'eyebrow')); map.append(caption);
      const list = node('ol');
      s.result.sections.forEach((section, index) => {
        const item = node('li'), button = node('button', undefined, 'map-item');
        const card = cards[index];
        const label = node('span', section.title, 'map-title');
        if (card) appendCardSummary(label, card);
        button.append(node('span', String(index + 1).padStart(2, '0'), 'map-number'), label);
        const draft = drafts.get(draftKey(s, index));
        const detail = blockIsStale(s, index) ? (s.removedBlocks?.includes(index) ? 'Removed' : 'Changed') : draft && (draft.draft !== draft.baseText || draft.instruction) ? 'Draft' : s.legacyCardBlocks?.includes(index) ? 'Legacy format' : section.startLine ? 'L' + section.startLine + '–' + section.endLine : 'Writing…';
        const range = node('span', detail, 'map-range');
        const diff = s.inlineDiff?.blocks?.[index];
        if (diff) {
          const marks = Object.values(diff.marks);
          const added = marks.some(mark => mark.kind === 'added'), removed = marks.some(mark => mark.kind === 'removed') || Object.keys(diff.removed).length > 0;
          const signs = node('span', undefined, 'block-diff');
          signs.setAttribute('aria-label', added && removed ? 'Added and removed steps' : added ? 'Added steps' : 'Removed steps');
          if (added) signs.append(diffSign('added'));
          if (removed) signs.append(diffSign('removed'));
          range.append(signs);
        }
        button.append(range, node('span', '→', 'map-arrow'));
        button.addEventListener('click', () => openBlock(index)); item.append(button); list.append(item);
      });
      map.append(list); content.append(map);
    } else {
      const navigation = node('nav', undefined, 'block-navigation'); navigation.setAttribute('aria-label', 'Block navigation');
      const back = node('button', '← Logic map'); back.disabled = s.result.sections.length === 1 && !cards[0];
      back.addEventListener('click', () => { focusedBlocks.set(navKey, undefined); editing = undefined; render(state); content.querySelector?.('.map-item')?.focus?.(); content.scrollIntoView?.({ block: 'start', behavior: 'instant' }); });
      const count = node('span', String(selected + 1).padStart(2, '0') + ' / ' + String(s.result.sections.length).padStart(2, '0'), 'block-count');
      const previous = node('button', '←'); previous.title = 'Previous block'; previous.setAttribute('aria-label', 'Previous block'); previous.disabled = selected === 0; previous.addEventListener('click', () => openBlock(selected - 1));
      const next = node('button', '→'); next.title = 'Next block'; next.setAttribute('aria-label', 'Next block'); next.disabled = selected === s.result.sections.length - 1; next.addEventListener('click', () => openBlock(selected + 1));
      navigation.append(back, count, previous, next); content.append(navigation);
    }
    s.result.sections.forEach((section, index) => {
      if (index !== selected) return;
      const card = cards[index];
      const blockStale = blockIsStale(s, index);
      const diff = s.inlineDiff?.blocks?.[index];
      const el = node('details'); el.className = 'reading-block' + (card ? ' function-card' : '') + (animateNext ? ' jump-in' : ''); animateNext = false; const heading = node('summary', undefined, 'section-heading');
      const blockKey = [s.name, s.level, s.providerLabel, index].join('|');
      el.open = !collapsed.has(blockKey);
      el.addEventListener('toggle', () => { if (el.open) collapsed.delete(blockKey); else collapsed.add(blockKey); });
      const link = node('button', section.startLine ? 'L' + section.startLine + (section.endLine !== section.startLine ? '–' + section.endLine : '') : 'Writing…', 'line');
      link.title = 'Highlight corresponding source lines'; link.disabled = blockStale || !!s.partial;
      link.addEventListener('click', event => { event.preventDefault(); send('reveal', { index }); });
      const nameParts = card && /^(.*?) \\(([\\w.$]+)(?:\\(\\))?\\)$/.exec(section.title);
      const title = node(card ? 'span' : 'h2', nameParts ? nameParts[1] : section.title);
      if (card) { title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '2'); }
      if (card) {
        const meta = node('span', undefined, 'card-symbol-line');
        if (nameParts) meta.append(node('code', nameParts[2] + '()', 'card-symbol'));
        else if (/^[\\w.$]+$/.test(section.title)) title.className = 'card-symbol';
        link.className = 'line card-source-chip';
        meta.append(link);
        title.append(meta);
        const closed = node('span', undefined, 'card-closed-summary');
        appendCardSummary(closed, card);
        title.append(closed);
      }
      heading.append(node('span', String(index + 1).padStart(2, '0'), 'block-index'), title);
      if (!card) heading.append(link);
      const actions = node('span', undefined, 'block-actions');
      const copyBlock = node('button', card ? '⧉' : 'Copy');
      if (card) { copyBlock.title = 'Copy'; copyBlock.setAttribute('aria-label', 'Copy'); }
      copyBlock.disabled = !!s.partial;
      copyBlock.addEventListener('click', event => { event.preventDefault(); send('copyBlock', { index, documentKey: s.documentKey }); });
      const edit = node('button', card ? '✎' : 'Edit');
      if (card) { edit.title = 'Edit'; edit.setAttribute('aria-label', 'Edit'); }
      edit.disabled = !!s.busy || blockStale || !!s.sourceMissing;
      edit.addEventListener('click', event => {
        event.preventDefault();
        const key = draftKey(s, index);
        if (!drafts.has(key)) drafts.set(key, { draft: section.pseudocode, instruction: '', baseText: section.pseudocode, scope: s.draftScope, index, title: section.title });
        const saved = drafts.get(key);
        if (saved.baseText !== section.pseudocode) { saved.reviewNote = true; saved.baseText = section.pseudocode; }
        editing = { key, index, documentKey: s.documentKey }; render(state); draftEditors.get(key)?.focus();
      });
      const refreshBlock = node('button', '↻'); refreshBlock.title = 'Refresh this cached block'; refreshBlock.setAttribute('aria-label', 'Refresh block: ' + section.title);
      refreshBlock.disabled = !!s.busy || !!s.sourceMissing || !!s.partial || !!s.removedBlocks?.includes(index);
      refreshBlock.addEventListener('click', event => { event.preventDefault(); flushDrafts(); send('refreshBlock', { index, documentKey: s.documentKey }); });
      actions.append(copyBlock, edit, refreshBlock); if (!s.comparison) heading.append(actions);
      const code = node('pre');
      let stepNumber = 0;
      const rowsByLine = [];
      if (card) code.className = 'pseudocode-card';
      const cardKey = draftKey(s, index) + ':' + section.pseudocode;
      const riskLines = [];
      const handledCount = card ? card.rows.filter(row => row.kind === 'card-handled').length : 0;
      (card?.rows || pseudocodeLines(section.pseudocode)).forEach(({ text, kind, number }, lineIndex) => {
        const row = node('span', undefined, 'code-line' + (kind ? ' ' + kind : ''));
        rowsByLine[lineIndex + 1] = row;
        if (kind === 'note' && /^\\s*#\\s*(Context|Why|How|What):/i.test(text)) row.className += ' context-note';
        const mapping = section.lineMap?.find(m => m.pseudocodeLine === lineIndex + 1);
        const line = lineIndex + 1, mark = diff?.marks[line];
        appendRemoved(code, diff?.removed[line], s);
        const stepLabel = card ? number || '' : text.trim() && kind !== 'note' ? String(++stepNumber) : '';
        row.append(mark ? diffSign(mark.kind, 'step-number') : ['card-handled', 'card-risk'].includes(kind) ? edgeMark(kind) : node('span', stepLabel, 'step-number'));
        if (kind === 'card-handled' || kind === 'card-risk') {
          const status = kind === 'card-handled' ? 'Handled · worth checking' : 'Risky · worth checking';
          row.title = status;
          row.setAttribute('aria-label', status + '. ' + text);
        }
        const canLink = mapping && !blockStale && !s.partial;
        const cardLink = card && (kind === 'card-step' || kind === 'card-risk' || kind === 'card-handled');
        if (kind === 'card-risk' && canLink) riskLines.push(lineIndex + 1);
        if (canLink && !mark && (!card || cardLink)) {
          row.className += ' linked'; row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0');
          row.title = (row.title ? row.title + '. ' : '') + 'Hover to highlight source L' + mapping.startLine + '–' + mapping.endLine + ' · Click to jump';
          row.setAttribute('aria-label', text.trim() + '. ' + row.title);
          if (card && activeCardLines.get(cardKey) === lineIndex + 1) row.classList.add('card-active');
          const jump = () => {
            if (card) {
              const old = activeCardLines.get(cardKey);
              rowsByLine[old]?.classList.remove('card-active');
              activeCardLines.set(cardKey, lineIndex + 1);
              row.classList.add('card-active');
            }
            send('revealStep', { index, pseudocodeLine: lineIndex + 1 });
          };
          row.addEventListener('click', jump);
          row.addEventListener('mouseenter', () => send('hoverStep', { index, pseudocodeLine: lineIndex + 1 }));
          row.addEventListener('mouseleave', () => send('clearHover'));
          row.addEventListener('focus', () => send('hoverStep', { index, pseudocodeLine: lineIndex + 1 }));
          row.addEventListener('blur', () => send('clearHover'));
          row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); } });
        }
        const body = node('span', undefined, 'step-body');
        body.style.paddingInlineStart = Math.min(text.length - text.trimStart().length, 40) * .55 + 'em';
        const field = kind === 'card-heading' && /^([A-Z ]+): *(.*)$/.exec(text);
        const annotation = kind === 'card-annotation' && /^\\s*([A-Z]+): (.*)$/.exec(text);
        if (field) {
          const label = field[1];
          row.classList.toggle('card-group', ['STEPS', 'SIDE EFFECTS', 'EDGE CASES'].includes(label));
          row.classList.toggle('card-purpose-field', label === 'PURPOSE');
          row.append(node('span', label === 'EDGE CASES' ? 'Worth checking' : label, 'card-field-label'));
          if (label === 'EDGE CASES') row.append(node('span', handledCount + ' handled · ' + card.riskCount + ' to check', 'card-edge-count'));
          appendInline(body, field[2]);
        } else if (annotation) {
          const label = annotation[1];
          const tag = node('span', label === 'SHAPES' ? 'SHAPE' : label, 'card-annotation-tag ' + label.toLowerCase());
          body.append(tag);
          appendInline(body, annotation[2]);
        } else appendInline(body, text.trimStart());
        if (!text) body.append(document.createTextNode(' '));
        if (!field || field[2]) row.append(body);
        if (cardLink && canLink) {
          const range = 'L' + mapping.startLine + (mapping.endLine === mapping.startLine ? '' : '–' + mapping.endLine);
          row.append(node('span', range, 'card-source-chip'));
        }
        if (mark) wireDiff(row, mark, text, s);
        code.append(row);
      });
      appendRemoved(code, diff?.removed.end, s);
      el.append(heading);
      // Fixed-rule check of this block against the source (no AI): shown only when it found something to look at.
      const found = s.checks?.[index];
      if (found?.length && !s.partial && !blockStale) {
        const box = node('div', undefined, 'block-check'); box.setAttribute('role', 'note');
        box.append(node('span', 'Check against the source', 'block-check-title'));
        for (const text of found) box.append(node('p', text));
        box.title = 'Yamori compared this block with the source using fixed rules, not AI. A finding is a prompt to look, not proof of a mistake.';
        el.append(box);
      }
      if (blockStale) { const warning = node('div', undefined, 'block-stale'); warning.append(node('span', s.removedBlocks?.includes(index) ? 'This code was removed. Update from code to reorganize the map.' : 'This cached block needs review.')); if (!s.removedBlocks?.includes(index)) { const refresh = node('button', 'Refresh block'); refresh.disabled = !!s.busy || !!s.sourceMissing; refresh.addEventListener('click', () => { flushDrafts(); send('refreshBlock', { index, documentKey: s.documentKey }); }); warning.append(refresh); } el.append(warning); }

      if (s.comparison) {
        el.append(code);
      } else if (editing?.index === index && editing.documentKey === s.documentKey) {
        el.open = true;
        const record = drafts.get(editing.key);
        const editor = node('div', undefined, 'block-editor');
        const label = node('div', 'Edit the idea', 'editor-caption');
        const hint = node('p', 'Tab to indent · ⌘/Ctrl+Z to undo · click an equation to edit it', 'edit-hint');
        let draftEditor = draftEditors.get(editing.key);
        const submit = () => { if (!state.busy && !blockIsStale(state, index) && !state.sourceMissing && !update.disabled) { flushDrafts(); update.disabled = true; draftEditor.setDisabled(true); send('updateBlock', { index, documentKey: s.documentKey, ...record }); } };
        if (!draftEditor) {
          const host = node('div', undefined, 'draft-editor');
          draftEditor = createDraftEditor(host, record, { nonce: editorNonce, disabled: !!s.busy || blockStale || !!s.sourceMissing, onSubmit: submit, onChange: () => persistDraft(draftKey(s, index)), renderMath: appendMath });
          draftEditors.set(editing.key, draftEditor);
        }
        draftEditor.setSubmit?.(submit);
        draftEditor.setDisabled(!!s.busy || blockStale || !!s.sourceMissing);
        const instruction = node('textarea', undefined, 'instruction'); instruction.value = record.instruction; instruction.disabled = !!s.busy || blockStale || !!s.sourceMissing;
        instruction.placeholder = 'Optional: what should the AI change?'; instruction.setAttribute('aria-label', 'Instruction for ' + s.providerLabel);
        instruction.addEventListener('input', () => { record.instruction = instruction.value; persistDraft(draftKey(s, index)); });
        const toolbar = node('div', undefined, 'edit-toolbar');
        const update = node('button', 'Update with ' + s.providerLabel, 'primary'); update.disabled = !!s.busy || blockStale || !!s.sourceMissing;
        update.title = 'Update this explanation · ⌘/Ctrl+Enter'; update.addEventListener('click', submit);
        const close = node('button', 'Cancel'); close.disabled = !!s.busy; close.addEventListener('click', () => { flushDrafts(); editing = undefined; render(state); });
        toolbar.append(update, close);
        const editHeader = node('div', undefined, 'edit-header'); editHeader.append(label, toolbar);
        const cacheStatus = node('p', record.saving ? 'Saving locally…' : record.savedAt ? 'Draft saved on this device · ' + dateLabel(record.savedAt) : 'Draft autosaves on this device', 'draft-cache-status'); cacheStatus.id = 'draft-cache-status';
        editor.append(editHeader, hint); if (record.reviewNote) editor.append(node('p', 'Saved draft from an earlier explanation. Review it before applying.', 'sync-hint'));
        editor.append(draftEditor.host, instruction, cacheStatus); el.append(editor);
      } else {
        el.append(code);
        appendTests(el, s, section, index, rowsByLine);
        const row = node('div', undefined, 'block-reactions');
        row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Improve ' + section.title + ' with ' + s.providerLabel);
        const buttons = [];
        reactions.forEach(action => {
          const pending = s.busy && reacting?.index === index && reacting.action === action.id;
          const button = node('button');
          const icon = node('span', action.icon, 'reaction-icon'); icon.setAttribute('aria-hidden', 'true');
          const label = node('span', pending ? action.pending : action.label);
          button.append(icon, label);
          button.disabled = !!s.busy || blockStale || !!s.sourceMissing || !!s.partial;
          button.title = action.label + ' with ' + s.providerLabel + ' · Uses your selected model and effort';
          button.setAttribute('aria-label', action.label + ': ' + section.title + ', with ' + s.providerLabel);
          if (pending) button.setAttribute('aria-busy', 'true');
          button.addEventListener('click', () => {
            if (button.disabled) return;
            reacting = { documentKey: s.documentKey, index, action: action.id };
            buttons.forEach(b => { b.disabled = true; });
            label.textContent = action.pending; button.setAttribute('aria-busy', 'true');
            send('updateBlock', { index, documentKey: s.documentKey, baseText: section.pseudocode, draft: section.pseudocode, instruction: action.instruction });
          });
          buttons.push(button); row.append(button);
        });
        if (riskLines.length && !s.notebook) {
          const addTest = node('button', '+ Add test for ⚠', 'card-test-action');
          addTest.disabled = !!s.busy || !!s.sourceMissing;
          addTest.title = 'Add a regression test in Work mode';
          addTest.addEventListener('click', () => {
            if (addTest.disabled) return;
            const selectedLine = activeCardLines.get(cardKey);
            send('addEdgeTest', { index, documentKey: s.documentKey,
              pseudocodeLine: riskLines.includes(selectedLine) ? selectedLine : riskLines[0] });
          });
          row.append(addTest);
        }
        el.append(row);
      }
      content.append(el);
    });
    const currentKeys = new Set(s.result.sections.map((_, index) => draftKey(s, index)));
    const earlier = (s.drafts || []).filter(row => !currentKeys.has(row.key));
    if (earlier.length) { const list = node('details', undefined, 'earlier-drafts'); list.append(node('summary', earlier.length + ' earlier draft' + (earlier.length === 1 ? '' : 's') + ' cached locally')); for (const row of earlier) { const entry = node('div'); entry.append(node('span', row.title)); const copy = node('button', 'Copy draft'); copy.addEventListener('click', () => send('copyDraft', { scope: s.draftScope, key: row.key })); entry.append(copy); list.append(entry); } content.append(list); }
    const footer = node('footer');
    if (s.result?.refinement) footer.append(node('span', s.result.refinement.status === 'incomplete' ? 'Draft · review incomplete' : s.result.refinement.status === 'skipped' ? 'Straightforward code · refinement skipped' : 'Refined ' + s.result.refinement.selectedBlocks?.length + (s.result.refinement.selectedBlocks?.length === 1 ? ' block · ' : ' blocks · ') + s.result.refinement.stepsCompleted + '/' + s.result.refinement.stepsRequested + ' steps'));
    footer.append(node('span', s.partial ? s.result.draftComplete ? 'Draft · reviews running · final result will be cached' : 'Writing draft · source links activate when complete' : s.stale ? 'Cached locally · source needs review' : s.cacheSavedAt ? 'Cached on this device · ' + dateLabel(s.cacheSavedAt) : 'AI-generated · Verify against source'));
    const copy = node('button', 'Copy'); copy.disabled = !!s.partial; copy.addEventListener('click', () => send('copy')); footer.append(copy); if (!s.comparison) content.append(footer);
  } else if (s.busy) {
    for (let i = 0; i < 8; i++) { const line = node('div', undefined, 'skeleton'); line.style.width = i % 3 === 0 ? '55%' : '90%'; content.append(line); }
  } else if (s.error) {
    const retry = node('button', 'Try again', 'primary'); retry.addEventListener('click', () => send('refresh')); content.append(retry);
  } else if (!s.comparison) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h1', 'Big ideas. Less guesswork.'), node('p', 'Explain a file as short pseudocode, or let the project guide show where to start reading.'));
    const actions = node('div', undefined, 'empty-actions');
    for (const [label, type, primary] of [['Explain current file', 'read', true], ['Switch file…', 'switchFile'], ['Plan a change', 'plan']]) {
      const button = node('button', label, primary ? 'primary' : ''); button.addEventListener('click', () => send(type)); actions.append(button);
    }
    empty.append(actions);
    content.append(empty);
  }
  if (restoreEditorFocus && editing) draftEditors.get(editing.key)?.focus();
  updateElapsed();
}
const clock = ms => { const total = Math.max(0, Math.round(ms / 1000)); return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0'); };
// The request being written: who writes it, each stage, and live details.
function renderRun(s) {
  const run = s.run, live = run.state === 'running' && !!s.busy;
  const effort = run.effort ? run.effort + ' effort' : 'CLI default effort';
  const meta = [run.provider, run.model || 'default model', effort, run.lookups ? run.lookups + ' Yamori lookup' + (run.lookups === 1 ? '' : 's') : ''].filter(Boolean).join(' · ');
  const steps = node('ol');
  for (const step of run.steps) {
    const item = node('li', undefined, step.state);
    item.append(node('span', ({ done: '✓', active: '●', waiting: '○', skipped: '–', stopped: '×' })[step.state] || '○', 'icon'));
    const text = node('span'); text.append(node('span', step.label, 'label'));
    if (step.detail) text.append(node('span', step.detail, 'detail'));
    item.append(text);
    const time = node('span', step.state === 'done' && step.startedAt && step.endedAt - step.startedAt >= 1000 ? clock(step.endedAt - step.startedAt) : '', 'time');
    if (step.state === 'active' && live && step.startedAt) time.setAttribute('data-since', String(step.startedAt));
    item.append(time); steps.append(item);
  }
  if (live) {
    const box = node('section', undefined, 'run live'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    const head = node('div', undefined, 'run-head'), mascot = node('img'); mascot.src = ${JSON.stringify(logo)}; mascot.alt = '';
    const title = run.steps.find(step => step.state === 'active');
    const operationStart = run.operationStartedAt || run.startedAt;
    const total = node('span', clock(Date.now() - operationStart), 'run-time'); total.setAttribute('data-since', String(operationStart));
    head.append(mascot, node('span', title ? title.label : run.title, 'run-title'), total);
    box.append(head, node('div', meta, 'run-meta'));
    if (run.batch) box.append(node('p', run.title, 'hint'));
    box.append(steps);
    if (s.partial && s.result?.draftComplete) box.append(node('p', 'The draft below is ready to read. It may still improve while the review finishes.', 'hint'));
    content.append(box);
  } else {
    const box = node('details', undefined, 'run');
    const verb = run.state === 'done' ? 'Done in ' : run.state === 'failed' ? 'Failed after ' : 'Stopped after ';
    box.append(node('summary', verb + clock((run.endedAt || Date.now()) - run.startedAt) + ' · ' + meta), steps);
    content.append(box);
  }
}
// ---- Unit tests as notebook cells ----
const runCalls = new Map(), runSteps = new Map();
const duration = ms => ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s';
// One value: text in a code chip, or an emoji chip for files, images and data.
function valueNode(value) {
  if (!value) return node('span', '—', 'value muted');
  if (value.emoji) {
    const chip = node('span', undefined, 'value file'); chip.tabIndex = 0;
    chip.append(node('span', value.emoji, 'value-emoji'), document.createTextNode(' ' + (value.detail || value.repr)));
    chip.title = [value.kindLabel, value.repr, value.detail, value.guidance].filter(Boolean).join('\\n');
    return chip;
  }
  const text = node('code', value.repr ?? '', 'value');
  text.title = [value.type, Number.isInteger(value.size) ? value.size + ' items' : ''].filter(Boolean).join(' · ');
  return text;
}
function valueList(values) {
  const list = node('span', undefined, 'run-values');
  for (const value of values || []) { const item = node('span', undefined, 'run-value'); item.append(node('span', value.name + ' = ', 'run-name'), valueNode(value)); list.append(item); }
  if (!values?.length) list.append(node('span', 'nothing', 'muted'));
  return list;
}
function runRow(key, content) { const row = node('div', undefined, 'run-row'); row.append(node('span', key, 'run-key'), content); return row; }
// Tests that exercise this block's functions, and the run the reader chose.
function appendTests(el, s, section, index, rows) {
  const tests = s.blockTests?.[index], run = s.runs?.[index];
  if (!tests?.length && !run) return;
  if (tests?.length) {
    const bar = node('div', undefined, 'test-bar'), real = test => s.canRunTests && test.language === 'python';
    bar.append(node('span', tests.some(real) ? 'Run with a test:' : 'Simulate with a test:', 'test-label'));
    for (const test of tests) {
      const button = node('button', '▸ ' + test.name.split('::').at(-1), 'test-chip');
      button.title = (real(test) ? 'Run ' : 'Simulate ') + test.name + ' from ' + test.file + ' and watch ' + test.function + ' step by step' + (real(test) ? '' : ' (simulated by AI: real runs need a trusted workspace and a Python test)');
      button.disabled = run?.state === 'running' || !!s.partial;
      button.addEventListener('click', () => send('runTest', { index, id: test.id, documentKey: s.documentKey, ...(real(test) ? {} : { simulate: true }) }));
      bar.append(button);
    }
    el.append(bar);
  }
  if (!run) return;
  const cell = node('section', undefined, 'run-cell' + (run.mode === 'simulated' ? ' simulated' : '')); cell.tabIndex = 0;
  cell.setAttribute('aria-label', (run.mode === 'simulated' ? 'Simulated run of ' : 'Run of ') + run.name);
  const head = node('div', undefined, 'run-head');
  head.append(node('strong', run.state === 'running' ? (run.mode === 'simulated' ? 'Simulating ' : 'Running ') + run.name + '…' : '▶ ' + run.name));
  if (run.state === 'done') head.append(node('span', run.mode === 'real' ? 'Real run' : 'Simulated by AI, not a real run', 'run-mode'));
  if (run.state === 'done' && run.mode === 'real') head.append(node('span', run.outcome + ' · ' + duration(run.durationMs) + (run.python ? ' · Python ' + run.python : ''), 'run-outcome ' + run.outcome));
  const tools = node('span', undefined, 'run-tools'), test = tests?.find(item => item.id === run.id);
  const tool = (label, title, message) => { const button = node('button', label); button.title = title; button.addEventListener('click', () => send(message.type, message)); tools.append(button); };
  if (run.state !== 'running' && test) {
    tool('Run again', 'Run this test again', { type: 'runTest', index, id: test.id, documentKey: s.documentKey, ...(run.mode === 'simulated' ? { simulate: true } : {}) });
    if (run.mode !== 'simulated') tool('Simulate with AI', 'Ask the AI to trace this run without running anything', { type: 'runTest', index, id: test.id, documentKey: s.documentKey, simulate: true });
  }
  tool(run.state === 'running' ? 'Stop' : 'Close', run.state === 'running' ? 'Stop this run' : 'Close this cell', { type: 'closeRun', index });
  head.append(tools); cell.append(head);
  if (run.state === 'running') { cell.append(node('p', run.mode === 'simulated' ? 'Asking the AI to trace this run…' : 'Running the test with your project’s Python…', 'muted')); el.append(cell); return; }
  if (run.state === 'failed') { cell.append(node('p', run.message || 'The run failed.', 'run-error')); el.append(cell); return; }
  if (run.reason) cell.append(node('p', run.reason, 'muted'));
  if (run.mode === 'real' && run.outcome !== 'passed' && run.message) cell.append(node('p', 'Test ' + run.outcome + ': ' + run.message, 'run-error'));
  const calls = run.calls || [], callKey = s.documentKey + ':' + index;
  if (!calls.length) { cell.append(node('p', run.mode === 'real' ? 'The test finished without calling ' + run.function + '.' : 'The AI returned no steps.', 'muted')); el.append(cell); return; }
  const callIndex = Math.min(runCalls.get(callKey) || 0, calls.length - 1), call = calls[callIndex];
  if (calls.length > 1) {
    const picker = node('div', undefined, 'run-calls'); picker.append(node('span', run.function + ' ran ' + calls.length + ' times:', 'muted'));
    calls.forEach((_, i) => { const button = node('button', 'Call ' + (i + 1)); button.setAttribute('aria-pressed', String(i === callIndex)); button.addEventListener('click', () => { runCalls.set(callKey, i); render(state); }); picker.append(button); });
    cell.append(picker);
  }
  cell.append(runRow('In', valueList(call.inputs)));
  if (call.error) cell.append(runRow('Raises', node('code', [call.error.type, call.error.message].filter(Boolean).join(': '), 'value run-error')));
  else { const out = node('span', undefined, 'run-values'); out.append(valueNode(call.output)); cell.append(runRow('Out', out)); }
  if (call.steps?.length) {
    const stepKey = callKey + ':' + callIndex, at = Math.max(0, Math.min(call.steps.length - 1, runSteps.get(stepKey) || 0)), step = call.steps[at];
    const move = delta => { runSteps.set(stepKey, Math.max(0, Math.min(call.steps.length - 1, at + delta))); render(state); };
    const nav = node('div', undefined, 'run-nav');
    const back = node('button', '◀'); back.setAttribute('aria-label', 'Previous step'); back.disabled = at === 0; back.addEventListener('click', () => move(-1));
    const forward = node('button', '▶'); forward.setAttribute('aria-label', 'Next step'); forward.disabled = at === call.steps.length - 1; forward.addEventListener('click', () => move(1));
    nav.append(back, node('span', 'Step ' + (at + 1) + ' / ' + call.steps.length + ' · source line ' + step.line, 'run-position'), forward);
    cell.append(runRow('Steps', nav));
    if (step.note) cell.append(runRow('', node('span', step.note, 'run-note')));
    cell.append(runRow('Changed', valueList(step.changed)));
    cell.addEventListener('keydown', event => { if (event.key === 'ArrowRight') { event.preventDefault?.(); move(1); } if (event.key === 'ArrowLeft') { event.preventDefault?.(); move(-1); } });
    // The pseudocode step whose source link covers the line that ran.
    const mapping = (section.lineMap || []).filter(item => item.startLine <= step.line && step.line <= item.endLine).sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
    if (mapping && rows[mapping.pseudocodeLine]) rows[mapping.pseudocodeLine].className += ' run-current';
    if (call.truncated) cell.append(node('p', 'Only the first steps were recorded.', 'muted'));
  }
  if (run.caveats) cell.append(node('p', 'Caveats: ' + run.caveats, 'muted'));
  if (run.log && run.log.trim()) { const log = node('details', undefined, 'run-log'); log.append(node('summary', 'Test output'), node('pre', run.log)); cell.append(log); }
  el.append(cell);
}
function updateElapsed() {
  document.querySelectorAll?.('[data-since]').forEach(el => { const since = Number(el.getAttribute('data-since')); if (since) el.textContent = clock(Date.now() - since); });
  const caption = document.getElementById('activity-caption');
  if (caption) caption.textContent = (state.error || state.activity?.at(-1) === 'Stopped' ? 'Stopped' : state.busy ? state.progress || 'Working' : 'Completed') + (state.busy && state.startedAt ? ' · ' + Math.floor((Date.now() - state.startedAt) / 1000) + 's' : '') + ' · Activity';
}
if (typeof setInterval === 'function') setInterval(updateElapsed, 1000);
document.getElementById('provider').addEventListener('click', () => send('provider'));
document.getElementById('model').addEventListener('click', () => send('model'));
document.getElementById('effort').addEventListener('click', () => send('effort'));
document.getElementById('refinement').addEventListener('click', () => send('refinement'));
document.getElementById('setup-ai').addEventListener('click', () => send('setup'));
document.addEventListener?.('keydown', event => { if (state.workspace) workspaceUI.key(event); if (event.key === 'Escape') document.querySelector?.('.ai-settings')?.removeAttribute('open'); });
document.getElementById('colors').addEventListener('click', () => send('palette'));
document.getElementById('source').addEventListener('click', () => send('showSource'));
document.getElementById('files').addEventListener('click', () => send('switchFile'));
document.getElementById('map').addEventListener('click', () => send('map'));
document.getElementById('plan')?.addEventListener('click', () => send('plan'));
refresh.addEventListener('click', () => { flushDrafts(); send(state.busy ? 'stop' : 'refresh'); });
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => send('level', { level: b.dataset.level })));
window.addEventListener('message', e => {
  if (e.data.type === 'state') render(e.data.state);
  if (e.data.type === 'workspaceCursor' && state.workspace) workspaceUI.cursorLine(e.data.line);
  if (e.data.type === 'workspaceTerminalResult' && state.workspace) workspaceUI.terminalResult(e.data);
  if (e.data.type === 'draftSaved') { const record = drafts.get(e.data.key); if (record && record.version === e.data.version) { record.savedAt = e.data.savedAt; record.saving = false; const label = document.getElementById('draft-cache-status'); if (editing?.key === e.data.key && label) label.textContent = 'Draft saved on this device · ' + dateLabel(record.savedAt); } }
  if (e.data.type === 'draftApplied') { for (const key of e.data.keys || []) { if (draftTimers.has(key) && typeof clearTimeout === 'function') clearTimeout(draftTimers.get(key)); draftTimers.delete(key); draftEditors.get(key)?.destroy(); draftEditors.delete(key); drafts.delete(key); } }
  if (e.data.type === 'cacheCleared') { for (const timer of draftTimers.values()) if (typeof clearTimeout === 'function') clearTimeout(timer); draftTimers.clear(); for (const editor of draftEditors.values()) editor.destroy(); draftEditors.clear(); drafts.clear(); editing = undefined; }
});
window.addEventListener('blur', () => { flushDrafts(); send('clearHover'); });
window.addEventListener('beforeunload', flushDrafts);
send('ready');
</script></body></html>`;
}
module.exports = { READING_STYLES, glossaryMatcher, glossaryParts, BASE_STYLES, LOGO, cleanEmphasis, panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts };
