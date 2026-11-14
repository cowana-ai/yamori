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
function createDraftEditor(parent, record, { nonce, disabled, onSubmit, renderMath }) {
  const cm = window.YamoriCodeMirror;
  if (!cm) {
    const input = document.createElement('textarea'); input.value = record.draft;
    input.setAttribute('aria-label', 'Pseudocode draft'); parent.append(input);
    input.addEventListener('input', () => { record.draft = input.value; });
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); input.setRangeText('    ', input.selectionStart, input.selectionEnd, 'end'); record.draft = input.value; }
    });
    return { host: parent, setDisabled(value) { input.disabled = value; }, focus() { input.focus?.(); }, hasFocus() { return document.activeElement === input; }, destroy() {} };
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
  const view = new EditorView({ parent, state: EditorState.create({ doc: record.draft, extensions: [
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
    EditorView.updateListener.of(update => { if (update.docChanged) record.draft = update.state.doc.toString(); })
  ] }) });
  let locked = !!disabled;
  return { host: parent, view, setSubmit(handler) { onSubmit = handler; }, focus: () => view.focus(), hasFocus: () => view.hasFocus, setDisabled(value) {
    if (locked !== value) { locked = value; view.dispatch({ effects: lock.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) }); }
    view.requestMeasure();
  }, destroy: () => view.destroy() };
}

function panelHTML(initialPalette = 'auto') {
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  const logo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><path fill="#888" d="M3 8h9V5h4V3h5v2h3v8h-3v3h3v3h3v3h-5v-2h-4v3h3v4h4v3h-8v-5h-3v5H7v-3h4v-5H8v-4H5v-3h7v-2H6v-2H3z"/><path fill="#fafafa" d="M16 5h4v4h-4zM12 16h9v3h-9z"/><path fill="#161616" d="M17 6h3v1h-3zM2 17h27v2H2z"/></svg>');
  const editorLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, 'editor.min.js'), 'utf8');
  const mathLibrary = require('node:fs').readFileSync(require('node:path').join(__dirname, 'katex.min.js'), 'utf8');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Yamori</title><style nonce="${nonce}">
:root {
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
* { box-sizing: border-box; }
body { --flow: var(--read-ink); --value: var(--read-ink); --string: var(--read-ink); --output: var(--read-ink); --note: var(--read-note-ink); --call: var(--read-ink); margin: 0; background: var(--read-page); color: var(--read-ink); font: 13px/1.6 var(--vscode-font-family, system-ui); }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 0; background: transparent; padding: 5px 9px; transition: background 120ms, transform 120ms, box-shadow 120ms; }
button:hover:not(:disabled) { background: var(--read-hover); }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--read-ink); outline-offset: 3px; }
button:disabled { opacity: .45; cursor: default; }
header { position: sticky; top: 0; z-index: 5; padding: 14px 20px 10px; background: var(--read-page); border-bottom: 1px solid var(--read-border); }
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
.file-nav { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
#source { min-width: 0; flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 0; color: var(--read-muted); font: 11px/1.8 ui-monospace, monospace; }
#files { flex-shrink: 0; font-size: 11px; }
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
details.reading-block { margin: 0 0 26px; border: 1px solid var(--read-ink); background: var(--read-surface); }
.section-heading { display: flex; align-items: center; gap: 10px; padding: 14px; cursor: pointer; list-style: none; border-bottom: 1px solid var(--read-border); }
.section-heading::-webkit-details-marker { display: none; }
.section-heading::after { content: '−'; font-family: ui-monospace, monospace; }
details:not([open]) .section-heading::after { content: '+'; }
details:not([open]) .section-heading { border-bottom-color: transparent; }
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
math { font: 1.12em 'STIX Two Math', 'Cambria Math', math; margin-inline: 2px; }
.block-reactions { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--read-border); }
.block-reactions button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 0; font-size: 11px; }
.reaction-icon { display: grid; place-items: center; width: 16px; height: 16px; border: 1px solid var(--read-border); font: 700 12px ui-monospace, monospace; }
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
.notice { color: var(--read-muted); margin: 0 0 20px; font-size: 12px; }
.notice.error { border: 1px solid var(--read-ink); padding: 12px; color: var(--read-ink); }
.waiting { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.waiting img { width: 32px; height: 32px; image-rendering: pixelated; filter: brightness(0) invert(1); animation: pixel-step 1.2s steps(2, end) infinite; }
body.vscode-light:not([data-palette="slate"]) .waiting img, body[data-palette="paper"] .waiting img { filter: brightness(0); }
.waiting .notice { margin: 0; }
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
  --read-mark-bg: var(--vscode-editor-findMatchHighlightBackground); --read-mark-ink: var(--vscode-editor-foreground); --read-hover: var(--vscode-editor-findMatchHighlightBackground);
}
@media(forced-colors: active) { body, header, .reading-block, .section-heading, .code-line.note { background: Canvas; color: CanvasText; } button, .segments, details, .code-line.note { border: 1px solid ButtonText; } }
</style></head><body data-palette="${palette}">
<header><div class="top"><span class="brand"><img src="${logo}" alt="Pixel gecko samurai"><span class="wordmark">yamori</span></span><details class="ai-settings"><summary id="ai-summary">AI settings ▾</summary><div class="ai-controls"><button id="provider" title="Choose AI provider">Codex ▾</button><button id="model" title="Choose model for new requests" aria-label="Choose model for new requests">Default ▾</button><button id="effort" title="Choose reasoning effort for new requests" aria-label="Choose reasoning effort">Effort: Default ▾</button></div></details></div>
<div class="controls"><div class="segments" role="group" aria-label="Detail level">
<button data-level="overview" aria-pressed="false" title="The purpose and main stages">Overview</button>
<button data-level="logic" aria-pressed="true" title="Readable steps and important decisions">Logic</button>
<button data-level="detailed" aria-pressed="false" title="Formulas, edge cases and error handling">Detailed</button>
</div><button id="refresh" title="Generate a fresh explanation">Refresh</button><button id="colors" title="Choose reading colors" aria-label="Choose reading colors">Theme</button></div>
<div class="file-nav"><button id="source" title="Open another project file in Yamori">Choose a file…</button><button id="files" title="Switch open Yamori tabs or open another file" aria-label="Switch Yamori files">▤ Files</button></div></header>
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
let animateNext = false;
let editing;
let reacting;
const reactions = [
  { id: 'clarify', icon: '?', label: 'Explain better', pending: 'Explaining…', instruction: 'Explain this block better for a mathematically capable reader with less programming experience. Identify the missing conceptual bridge: define what the data represents, unpack a non-obvious operation, or derive the key relationship in a few short lines. Explain why it works and the assumptions it needs. Preserve the block meaning, existing edits and important caveats; add understanding, not filler. Keep phase breaks and source links. Change only this explanation.' },
  { id: 'shorten', icon: '−', label: 'Make shorter', pending: 'Shortening…', instruction: 'Make this block shorter and easier to scan. Cut repetition, filler and incidental detail; use short casual actions. Preserve its meaning, existing edits, meaningful branches, key mathematical bridge, important assumptions and numerical caveats. Keep useful phase breaks and source links. Change only this explanation.' },
  { id: 'example', icon: '+', label: 'Show example', pending: 'Adding example…', instruction: 'Add one tiny worked example that makes this block click. Put it in a clearly labeled # Example: note with illustrative inputs, necessary assumptions and the resulting output or state change. Use simple values consistent with the visible computation, and show the key intermediate step if useful. Do not imply these were actual runtime values or infer missing function internals. Preserve existing steps, edits, meaning and caveats. Keep it short and source-linked; change only this explanation.' }
];
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
  const restoreEditorFocus = editing && draftEditors.get(editing.key)?.hasFocus();
  state = s;
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  if (editing && editing.documentKey !== s.documentKey) editing = undefined;
  if (!s.busy || reacting?.documentKey !== s.documentKey) reacting = undefined;
  content.className = s.level === 'logic' ? 'paper' : '';
  document.getElementById('provider').textContent = s.providerLabel + ' ▾';
  document.getElementById('model').textContent = (s.requestedModel || 'Default') + ' ▾';
  document.getElementById('model').title = 'New requests: ' + (s.requestedModel || 'provider default') + ' · Choose model';
  document.getElementById('effort').textContent = 'Effort: ' + (s.requestedEffort || 'Default') + ' ▾';
  document.getElementById('effort').title = 'New requests: ' + (s.requestedEffort || 'CLI default') + ' reasoning effort';
  document.getElementById('source').textContent = s.name || 'Choose a file…';
  document.getElementById('source').title = s.name ? s.name + ' · Open another file in its own Yamori tab' : 'Choose a file';
  document.querySelectorAll('[data-level]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.level === s.level)); });
  refresh.textContent = s.busy ? 'Stop' : 'Refresh'; refresh.disabled = !s.name;
  content.setAttribute('aria-busy', String(!!s.busy)); content.replaceChildren();
  if (s.modelNotice) content.append(node('p', s.modelNotice, 'notice'));
  if (s.error) {
    const el = node('div', undefined, 'notice error'); el.setAttribute('role', 'alert'); el.append(node('p', s.error));
    if (s.providerLabel === 'Claude Code') {
      const connect = node('button', 'Connect Claude', 'primary'); connect.disabled = !!s.busy;
      connect.title = 'Open Claude Code sign-in, or install its CLI if missing';
      connect.addEventListener('click', () => send('connectClaude')); el.append(connect);
    }
    content.append(el);
  }
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
  const aiSummary = document.getElementById('ai-summary');
  if (aiSummary) aiSummary.textContent = s.providerLabel + ' · ' + (s.requestedModel || 'Default') + ' ▾';
  if (s.result) {
    content.append(node('h1', s.result.title));
    const navKey = [s.name, s.level, s.providerLabel].join('|');
    let selected = focusedBlocks.get(navKey);
    if (selected >= s.result.sections.length) selected = undefined;
    if (selected === undefined && (s.result.sections.length === 1 || s.partial)) selected = 0;
    const openBlock = index => {
      focusedBlocks.set(navKey, index);
      const key = s.documentKey + ':' + index, draft = drafts.get(key);
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
        button.append(node('span', String(index + 1).padStart(2, '0'), 'map-number'), node('span', section.title, 'map-title'));
        const draft = drafts.get(s.documentKey + ':' + index);
        const detail = draft && (draft.draft !== draft.baseText || draft.instruction) ? 'Draft' : section.startLine ? 'L' + section.startLine + '–' + section.endLine : 'Writing…';
        button.append(node('span', detail, 'map-range'), node('span', '→', 'map-arrow'));
        button.addEventListener('click', () => openBlock(index)); item.append(button); list.append(item);
      });
      map.append(list); content.append(map);
    } else {
      const navigation = node('nav', undefined, 'block-navigation'); navigation.setAttribute('aria-label', 'Block navigation');
      const back = node('button', '← Logic map'); back.disabled = s.result.sections.length === 1;
      back.addEventListener('click', () => { focusedBlocks.delete(navKey); editing = undefined; render(state); content.querySelector?.('.map-item')?.focus?.(); content.scrollIntoView?.({ block: 'start', behavior: 'instant' }); });
      const count = node('span', String(selected + 1).padStart(2, '0') + ' / ' + String(s.result.sections.length).padStart(2, '0'), 'block-count');
      const previous = node('button', '←'); previous.title = 'Previous block'; previous.setAttribute('aria-label', 'Previous block'); previous.disabled = selected === 0; previous.addEventListener('click', () => openBlock(selected - 1));
      const next = node('button', '→'); next.title = 'Next block'; next.setAttribute('aria-label', 'Next block'); next.disabled = selected === s.result.sections.length - 1; next.addEventListener('click', () => openBlock(selected + 1));
      navigation.append(back, count, previous, next); content.append(navigation);
    }
    s.result.sections.forEach((section, index) => {
      if (index !== selected) return;
      const el = node('details'); el.className = 'reading-block' + (animateNext ? ' jump-in' : ''); animateNext = false; const heading = node('summary', undefined, 'section-heading');
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
        editing = { key, index, documentKey: s.documentKey }; render(state); draftEditors.get(key)?.focus();
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
        const label = node('div', 'Edit the idea', 'editor-caption');
        const hint = node('p', 'Tab to indent · ⌘/Ctrl+Z to undo · click an equation to edit it', 'edit-hint');
        let draftEditor = draftEditors.get(editing.key);
        const submit = () => { if (!state.busy && !state.stale && !update.disabled) { update.disabled = true; draftEditor.setDisabled(true); send('updateBlock', { index, documentKey: s.documentKey, ...record }); } };
        if (!draftEditor) {
          const host = node('div', undefined, 'draft-editor');
          draftEditor = createDraftEditor(host, record, { nonce: editorNonce, disabled: !!s.busy || !!s.stale, onSubmit: submit, renderMath: appendMath });
          draftEditors.set(editing.key, draftEditor);
        }
        draftEditor.setSubmit?.(submit);
        draftEditor.setDisabled(!!s.busy || !!s.stale);
        const instruction = node('textarea', undefined, 'instruction'); instruction.value = record.instruction; instruction.disabled = !!s.busy || !!s.stale;
        instruction.placeholder = 'Optional: what should the AI change?'; instruction.setAttribute('aria-label', 'Instruction for ' + s.providerLabel);
        instruction.addEventListener('input', () => { record.instruction = instruction.value; });
        const toolbar = node('div', undefined, 'edit-toolbar');
        const update = node('button', 'Update with ' + s.providerLabel, 'primary'); update.disabled = !!s.busy || !!s.stale;
        update.title = 'Update this explanation · ⌘/Ctrl+Enter'; update.addEventListener('click', submit);
        const close = node('button', 'Cancel'); close.disabled = !!s.busy; close.addEventListener('click', () => { editing = undefined; render(state); });
        toolbar.append(update, close);
        const editHeader = node('div', undefined, 'edit-header'); editHeader.append(label, toolbar);
        editor.append(editHeader, hint, draftEditor.host, instruction); el.append(editor);
      } else {
        el.append(code);
        const row = node('div', undefined, 'block-reactions');
        row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Improve ' + section.title + ' with ' + s.providerLabel);
        const buttons = [];
        reactions.forEach(action => {
          const pending = s.busy && reacting?.index === index && reacting.action === action.id;
          const button = node('button');
          const icon = node('span', action.icon, 'reaction-icon'); icon.setAttribute('aria-hidden', 'true');
          const label = node('span', pending ? action.pending : action.label);
          button.append(icon, label);
          button.disabled = !!s.busy || !!s.stale || !!s.partial;
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
        el.append(row);
      }
      content.append(el);
    });
    const footer = node('footer');
    footer.append(node('span', s.partial ? 'Live draft · source links activate when complete' : s.stale ? 'Earlier version' : s.result.edited ? 'Edited explanation · source code unchanged' : 'AI-generated · Verify against source'));
    const copy = node('button', 'Copy'); copy.disabled = !!s.partial; copy.addEventListener('click', () => send('copy')); footer.append(copy); content.append(footer);
  } else if (s.busy) {
    for (let i = 0; i < 8; i++) { const line = node('div', undefined, 'skeleton'); line.style.width = i % 3 === 0 ? '55%' : '90%'; content.append(line); }
  } else {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h1', 'Big ideas. Less guesswork.'), node('p', 'Open a script. Pick an idea from its logic map. Read, explore, and make it your own.'));
    const button = node('button', 'Read current file', 'primary'); button.addEventListener('click', () => send('read')); empty.append(button);
    if (s.providerLabel === 'Claude Code' && !s.error) {
      const connect = node('button', 'Connect Claude'); connect.title = 'Sign in with Claude Code or install its CLI';
      connect.addEventListener('click', () => send('connectClaude')); empty.append(connect);
    }
    content.append(empty);
  }
  if (restoreEditorFocus && editing) draftEditors.get(editing.key)?.focus();
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
document.addEventListener?.('keydown', event => { if (event.key === 'Escape') document.querySelector?.('.ai-settings')?.removeAttribute('open'); });
document.getElementById('colors').addEventListener('click', () => send('palette'));
document.getElementById('source').addEventListener('click', () => send('browse'));
document.getElementById('files').addEventListener('click', () => send('switchFile'));
refresh.addEventListener('click', () => send(state.busy ? 'stop' : 'refresh'));
document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => send('level', { level: b.dataset.level })));
window.addEventListener('message', e => { if (e.data.type === 'state') render(e.data.state); });
window.addEventListener('blur', () => send('clearHover'));
send('ready');
</script></body></html>`;
}
module.exports = { cleanEmphasis, panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts };
