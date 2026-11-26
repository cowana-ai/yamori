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
#stages-view .st-top { position: sticky; top: 0; z-index: 3; background: var(--read-page); padding: 12px 0 0; border-bottom: 1px solid var(--read-border); }
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
@media (max-height: 520px) { #stages-view .st-top { position: static; } }
`;

// The client: mountStages(root, post) renders into root; post(message) goes
// to the extension. Returns { update(state) }.
function mountStages(root, post) {
  if (!root) return { update() {}, shown() {} };
  const doc = root.ownerDocument;
  let state = {}, ui = { open: undefined, review: false, activity: false, pseudo: {}, expanded: {}, others: false };
  const tokens = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0);
  const money = n => n ? '$' + n.toFixed(n < 0.1 ? 4 : 2) : '—';
  const base = file => file.split('/').at(-1);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const send = (type, data = {}) => post({ type, ...data });
  // Build DOM nodes; text is always set as text, never parsed as HTML.
  function h(tag, attrs, ...children) {
    const el = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === false || value === null) continue;
      if (key === 'class') el.className = value;
      else if (key === 'data') for (const [name, data] of Object.entries(value)) { if (data !== undefined) el.dataset[name] = String(data); }
      else if (key === 'on') for (const [name, fn] of Object.entries(value)) el.addEventListener(name, fn);
      else if (key === 'value') el.value = value;
      else if (key === 'open' || key === 'disabled' || key === 'selected') el[key] = !!value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== undefined && child !== null && child !== false && child !== '') el.append(child instanceof Node ? child : doc.createTextNode(String(child)));
    return el;
  }
  const act = (name, data, label, attrs = {}) => h('button', { ...attrs, data: { act: name, ...data } }, label);
  const link = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-link' + (attrs.class ? ' ' + attrs.class : '') });
  const go = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-go' });
  const muted = text => h('span', { class: 'st-muted' }, text);
  const spacer = () => h('span', { class: 'st-spacer' });
  const section = (title, ...children) => h('div', { class: 'st-section' }, h('h3', {}, title), ...children);
  const diffBlock = lines => h('pre', { class: 'st-diff' }, lines.map(line => h('span', { class: line.kind }, (line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ') + line.text)));

  function bar() {
    const w = state.workflow, list = state.workflows || [], total = state.activity?.total;
    const unmapped = (state.suggestions || []).filter(item => !item.mapped);
    return h('div', { class: 'st-bar' }, h('span', { class: 'st-eyebrow' }, 'Stages'),
      list.length > 1 ? h('select', { 'aria-label': 'Workflow', data: { act: 'workflow' } }, list.map(item => h('option', { value: item.id, selected: item.id === w?.id }, (item.entry_symbol || item.id) + ' · ' + base(item.entry_file))))
        : w ? muted((w.entry_symbol || w.id) + '() in ' + w.entry_file) : undefined,
      w && unmapped.length ? act('others', {}, ui.others ? 'Hide other workflows' : 'Other workflows (' + unmapped.length + ')', { title: 'Other places a workflow starts' }) : undefined,
      w ? act('refresh', {}, 'Update changed', { disabled: !!state.busy, title: 'Update only the stages whose code changed' }) : undefined,
      w ? act('regenerate', {}, 'Regenerate', { disabled: !!state.busy, title: 'Group the whole workflow again (one AI call); pinned stages are kept' }) : undefined,
      spacer(), link('activity', {}, total?.calls ? 'Today: ' + tokens(total.input + total.cached + total.output) + ' tokens · ' + money(total.cost) : 'Activity', { title: 'Every AI call for stages today, with tokens and cost' }));
  }
  const mapButton = (item, primary) => (primary ? go : act)('map', { file: item.file, symbol: item.symbol }, primary ? 'Map stages' : 'Map', { disabled: !!state.busy });
  function suggestionCard(item) {
    return h('div', { class: 'st-found' }, h('div', { class: 'st-eyebrow' }, 'Your main workflow starts here'),
      h('div', { class: 'st-row', style: 'margin:6px 0' }, h('span', { class: 'st-symbol' }, item.symbol + '()'), act('jump', { file: item.file, line: item.line }, item.file + ':' + item.line, { class: 'st-chip', title: 'Open the source line' })),
      h('div', { class: 'st-muted' }, item.why),
      h('p', {}, 'Yamori groups the code it reaches into 3–7 stages, like Plan → Act → Evaluate. One AI call, about ' + tokens(item.tokens) + ' tokens' + (item.missingNotes ? '; ' + plural(item.missingNotes, 'file') + ' get AI notes first (Yamori asks).' : '.')),
      h('div', { class: 'st-tools' }, mapButton(item, true), link('mapFiles', { file: item.file, symbol: item.symbol }, 'Choose files…')));
  }
  const otherRow = item => h('li', {}, h('span', { class: 'st-symbol' }, item.symbol + '()'), muted(item.file + ' · ' + item.why + (item.tokens ? ' · ~' + tokens(item.tokens) + ' tokens' : '')), spacer(), mapButton(item, false));
  function empty() {
    const list = state.suggestions || [];
    if (state.suggesting && !list.length) return h('div', { class: 'st-empty' }, muted('Finding where your workflows start…'));
    if (!list.length) return h('div', { class: 'st-empty' }, h('h1', {}, 'No workflow found yet'),
      h('p', { class: 'st-muted' }, 'Yamori looks for the function that starts your program: an entry point that calls the rest of the project. None stood out here.'),
      h('div', { class: 'st-tools' }, go('pick', {}, 'Pick the starting function…')));
    const [first, ...rest] = list;
    return h('div', { class: 'st-empty' }, h('h1', {}, 'See your code as stages'),
      h('p', { class: 'st-muted' }, 'Stages show what the code does in a few steps, which functions do each one, and what changed since you last looked. Your notes on each stage are shared with your agents.'),
      suggestionCard(first),
      rest.length ? section('Other places a workflow starts', h('ul', { class: 'st-others' }, rest.map(otherRow))) : undefined,
      h('p', { class: 'st-muted', style: 'margin-top:16px' }, 'Not the right one? ', link('pick', {}, 'Pick the starting function yourself')));
  }
  function othersPanel() {
    if (!ui.others || !state.workflow) return undefined;
    const list = (state.suggestions || []).filter(item => !item.mapped);
    return h('section', { class: 'st-card' }, h('h2', {}, 'Other workflows', spacer(), link('others', {}, 'Close')),
      list.length ? h('ul', { class: 'st-others' }, list.map(otherRow)) : h('p', { class: 'st-muted' }, 'Every workflow Yamori found is mapped.'),
      h('p', { class: 'st-muted' }, link('pick', {}, 'Pick a starting function yourself')));
  }
  function graph() {
    const w = state.workflow, out = [];
    w.stages.forEach((stage, index) => {
      if (index) out.push(h('div', { class: 'st-edge', 'aria-hidden': 'true' }, h('span', {}, w.stages[index - 1].output || ''), h('b', {}, '→')));
      out.push(h('button', { role: 'listitem', class: 'st-stage' + (ui.open === stage.id ? ' open' : '') + (stage.stale ? ' stale' : ''), data: { stage: stage.id }, 'aria-expanded': String(ui.open === stage.id) },
        h('span', { class: 'st-badges' },
          stage.plus ? h('span', { class: 'st-badge plus', title: 'Changes since you last reviewed' }, '±' + stage.plus) : undefined,
          stage.stale ? h('span', { class: 'st-badge stale' }, 'Needs update') : undefined,
          stage.pinned ? h('span', { class: 'st-badge', title: 'Pinned: you fixed its name or steps; regenerating keeps it' }, 'pinned') : undefined),
        h('div', { class: 'st-name' }, stage.name), h('div', { class: 'st-gist' }, stage.gist || ''),
        h('div', { class: 'st-meta' }, plural(stage.steps, 'step') + ' · ' + plural(stage.files.length, 'file'))));
    });
    return h('div', { class: 'st-graph', role: 'list', 'aria-label': 'Stages' }, out);
  }
  function reviewBar() {
    const queue = state.queue || [];
    if (!queue.length) return undefined;
    return h('div', { class: 'st-review' }, h('b', {}, plural(queue.length, 'change') + ' to review'),
      muted('since ' + (state.workflow.reviewed_at ? state.workflow.reviewed_at.slice(0, 16).replace('T', ' ') : 'these stages were made')), spacer(),
      go('review', {}, ui.review ? 'Hide review' : 'Review'), link('markReviewed', {}, 'Mark all seen', { title: 'Decide nothing, but count everything so far as seen' }));
  }
  function reviewPanel() {
    const queue = state.queue || [];
    if (!ui.review || !queue.length) return undefined;
    return h('section', { class: 'st-card', 'aria-label': 'Review changes' }, h('h2', {}, 'Review', spacer(), link('review', {}, 'Close')), queue.map(change => {
      const asking = ui.why?.id === change.id, steps = change.detail?.steps || [];
      return h('div', { class: 'st-section' }, h('h3', {}, change.stage_name + ' · ' + change.at.slice(0, 16).replace('T', ' ')), h('p', { class: 'st-sentence' }, change.summary),
        h('details', { open: !!ui.expanded[change.id], data: { expand: change.id } }, h('summary', {}, 'Pseudocode ± (' + plural(steps.length, 'step') + ')'),
          steps.map(step => h('div', { style: 'margin-top:8px' }, h('span', { class: 'st-symbol' }, step.symbol), ' ',
            act('diff', { id: change.id, file: step.file, line: step.line || 1 }, step.file + ' · code diff', { class: 'st-chip', title: 'Open the code diff' }),
            step.before || step.after ? diffBlock(lineDiff(step.before || '', step.after || '')) : h('p', { class: 'st-muted' }, 'No cached pseudocode for this step; open the code diff.')))),
        asking ? h('div', { class: 'st-tools' }, h('textarea', { id: 'st-why', placeholder: 'Why? (optional, saved with the decision)' }), go('saveWhy', {}, ui.why.status === 'approved' ? 'Approve' : 'Reject'), act('cancelWhy', {}, 'Cancel'))
          : h('div', { class: 'st-tools' }, go('approve', { id: change.id }, 'Approve'), act('reject', { id: change.id }, 'Reject')));
    }));
  }
  function card() {
    const stage = state.card;
    if (!stage || stage.id !== ui.open) return undefined;
    const others = (state.workflow?.stages || []).filter(item => item.id !== stage.id), id = { stage: stage.id };
    return h('section', { class: 'st-card', 'aria-label': 'Stage ' + stage.name },
      h('h2', {}, stage.name, stage.stale ? h('span', { class: 'st-badge stale' }, 'Needs update') : undefined,
        link('rename', id, 'Rename'), link('pin', id, stage.pinned ? 'Unpin' : 'Pin'), others.length ? link('merge', id, 'Merge…') : undefined,
        stage.stale ? link('refreshStage', id, 'Update this stage') : undefined, spacer(), link('close', {}, 'Close')),
      h('div', { class: 'st-story' }, h('b', {}, 'In'), h('span', {}, stage.input || '—'), h('b', {}, 'Then'), h('span', {}, stage.gist || '—'), h('b', {}, 'Out'), h('span', {}, stage.output || '—')),
      section('Steps across files', h('ol', { class: 'st-steps' }, stage.steps.map(step => {
        const key = stage.id + ':' + step.position, shown = ui.pseudo[key];
        return h('li', {}, h('div', { class: 'st-row' }, muted((step.position + 1) + '.'), h('span', { class: 'st-symbol' }, step.symbol),
          act('jump', { file: step.file, line: step.line_start || 1 }, step.file + ':' + (step.line_start || '?'), { class: 'st-chip', title: 'Open the source line' }),
          step.missing ? muted('(no longer in the code)') : undefined,
          link('flow', { file: step.file, line: step.line_start || 1 }, 'Read', { title: 'Read this file at this step' }),
          step.pseudocode ? link('pseudo', { key }, shown ? 'Hide pseudocode' : 'Pseudocode') : muted('no pseudocode yet'), spacer(),
          h('select', { 'aria-label': 'Move step', data: { act: 'move', stage: stage.id, position: step.position } }, h('option', { value: '' }, 'Move to…'), others.map(item => h('option', { value: item.id }, item.name)), h('option', { value: '__new' }, 'New stage (split)'))),
          shown && step.pseudocode ? [h('pre', {}, step.pseudocode), step.pseudocodeCurrent ? undefined : h('div', { class: 'st-muted' }, 'From an older version of this file.')] : undefined);
      }))),
      notesSection(stage), steerSection(stage));
  }
  function notesSection(stage) {
    const offer = state.vault?.offer;
    return section('Your notes · why it is this way',
      stage.notes ? h('pre', {}, stage.notes) : h('p', { class: 'st-muted' }, 'No notes yet. Constraints and decisions you write here (for example “never store PII”) are what your agents read before they change this stage.'),
      h('div', { class: 'st-tools' }, h('textarea', { id: 'st-note', 'aria-label': 'Add a note', placeholder: 'Remember: why, constraints, decisions…', value: ui.noteDraft || '' }),
        go('addNote', { stage: stage.id }, 'Save note'), link('openNote', { stage: stage.id }, state.vault?.obsidian ? 'Open in Obsidian' : 'Open notes file')),
      offer ? h('p', { class: 'st-notice' }, 'Keep these notes in Obsidian? They would go to ', h('b', {}, offer.name), '/Yamori/' + (state.vault.repo || '') + ', next to your other notes. ', link('useVault', {}, 'Use ' + offer.name), ' ', link('dismissVault', {}, 'No thanks')) : undefined);
  }
  function steerSection(stage) {
    const steer = state.steer && state.steer.stageId === stage.id ? state.steer : undefined, title = 'Steer · what should this stage do differently?';
    if (!steer || ['error', 'empty', 'saved', 'undone'].includes(steer.phase)) return section(title,
      steer?.message ? h('p', { class: steer.phase === 'error' ? 'st-error' : 'st-notice' }, steer.message) : undefined,
      h('div', { class: 'st-tools' }, h('textarea', { id: 'st-intent', 'aria-label': 'Intent', placeholder: 'For example: retry a failed tool call twice before giving up', value: ui.intentDraft || '' }),
        go('steerPreview', { stage: stage.id }, 'Preview change', { title: 'One AI call with your main model; sends only this stage’s functions and your notes' }),
        act('steerIntent', { stage: stage.id }, 'Leave for my agent', { title: 'No AI call: your next agent run reads it' })));
    if (steer.phase === 'previewing') return section(title, h('p', { class: 'st-notice' }, 'Writing a preview for “' + steer.intent + '”…'), h('div', { class: 'st-tools' }, act('steerCancel', {}, 'Stop')));
    if (steer.phase === 'preview') return section(title, h('p', { class: 'st-sentence' }, steer.summary), h('p', { class: 'st-muted' }, plural(steer.files.length, 'file') + ' · applied together or not at all · you can undo'),
      steer.files.map(file => h('div', { style: 'margin-top:8px' }, act('steerDiff', { file: file.file }, file.file, { class: 'st-chip', title: 'Open in the diff editor' }),
        file.edits.filter(edit => edit.why).map(edit => h('div', { class: 'st-muted' }, 'L' + edit.startLine + (edit.endLine > edit.startLine ? '–' + edit.endLine : '') + ': ' + edit.why)), diffBlock(file.hunks))),
      h('div', { class: 'st-tools' }, go('steerApply', {}, 'Apply to ' + plural(steer.files.length, 'file')), act('steerCancel', {}, 'Discard')));
    if (steer.phase === 'applied') return section(title, h('p', { class: 'st-notice' }, 'Applied: ' + steer.summary + ' (' + steer.applied.join(', ') + '). The stage updates and the change shows up in Review.'),
      h('div', { class: 'st-tools' }, act('steerUndo', {}, 'Undo'), link('steerCancel', {}, 'Done')));
    return section(title);
  }
  function activity() {
    if (!ui.activity || !state.activity) return undefined;
    const { total, calls, day } = state.activity;
    return h('section', { class: 'st-card' }, h('h2', {}, 'Activity · ' + day, spacer(), link('activity', {}, 'Close')),
      h('p', { class: 'st-muted' }, plural(total.calls, 'AI call') + ' today · input ' + tokens(total.input) + ' · cached ' + tokens(total.cached) + ' · output ' + tokens(total.output) + ' · ' + money(total.cost) +
        (state.budget ? ' · budget ' + (state.budget.perDay ? tokens(state.budget.perDay) + '/day' : 'no daily limit') + ', ' + (state.budget.perRun ? tokens(state.budget.perRun) + '/run' : 'no run limit') : '')),
      calls.length ? [h('table', {}, h('tr', {}, ['When', 'What', 'Model', 'Stage', 'Input', 'Cached', 'Output', 'Cost', 'Note'].map(name => h('th', {}, name))),
        calls.map(call => h('tr', {}, [call.at.slice(11, 19), call.trigger, call.model || '', call.stage_id || '', tokens(call.input_tokens) + (call.estimated ? '*' : ''), tokens(call.cached_tokens), tokens(call.output_tokens), money(call.cost_usd), call.note || ''].map(cell => h('td', {}, cell))))),
      h('p', { class: 'st-muted' }, '* estimated: the provider reported no usage.')] : h('p', { class: 'st-muted' }, 'No AI calls today. Opening stages, cards and notes never calls AI.'));
  }
  function body() {
    if (state.unavailable) return [h('div', { class: 'st-empty' }, h('p', { class: 'st-error' }, state.unavailable))];
    const top = [bar(),
      state.error ? h('p', { class: 'st-error' }, state.error) : undefined,
      state.busy ? h('p', { class: 'st-notice' }, state.busy) : undefined,
      state.notice ? h('p', { class: 'st-notice' }, state.notice) : undefined,
      state.outdated ? h('p', { class: 'st-notice' }, 'The AI model or prompt changed since these stages were made. They still work; ', link('regenerate', {}, 'regenerate'), ' when you want.') : undefined];
    if (!state.workflow) return [h('div', { class: 'st-top', style: 'border:0' }, top), empty()];
    // The graph stays in view while a card or the review is open below it.
    return [h('div', { class: 'st-top' }, top, reviewBar(), graph()), othersPanel(), activity(), reviewPanel(), card()];
  }
  function render() {
    // Keep typing intact when new state arrives mid-sentence.
    const active = doc.activeElement, keep = active && /^st-(note|why|intent)$/.test(active.id || '') ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
    root.replaceChildren(...body().flat().filter(Boolean));
    if (keep) { const field = root.querySelector('#' + keep.id); if (field) { field.value = keep.value; field.focus(); field.setSelectionRange(keep.start, keep.end); } }
  }
  const value = id => root.querySelector('#' + id)?.value || '';
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-act], .st-stage[data-stage]');
    if (!target || target.tagName === 'SELECT' || !root.contains(target)) return;
    const name = target.dataset.act, stage = target.dataset.stage, data = target.dataset;
    if (!name) { ui.open = ui.open === stage ? undefined : stage; send('openStage', { id: ui.open }); render(); return; }
    switch (name) {
      case 'close': ui.open = undefined; send('openStage', {}); render(); return;
      case 'activity': case 'review': case 'others': ui[name] = !ui[name]; render(); return;
      case 'pseudo': ui.pseudo[data.key] = !ui.pseudo[data.key]; render(); return;
      case 'jump': case 'flow': send(name, { file: data.file, line: Number(data.line) }); return;
      case 'map': case 'mapFiles': send('map', { file: data.file, symbol: data.symbol, choose: name === 'mapFiles' }); return;
      case 'approve': case 'reject': ui.why = { id: Number(data.id), status: name === 'approve' ? 'approved' : 'rejected' }; render(); root.querySelector('#st-why')?.focus(); return;
      case 'cancelWhy': ui.why = undefined; render(); return;
      case 'saveWhy': send('decide', { id: ui.why.id, status: ui.why.status, why: value('st-why') }); ui.why = undefined; return;
      case 'diff': send('diff', { id: Number(data.id), file: data.file, line: Number(data.line) }); return;
      case 'addNote': { const text = value('st-note'); if (!text.trim()) return; send('addNote', { stage, text }); ui.noteDraft = ''; return; }
      case 'steerPreview': case 'steerIntent': { const intent = value('st-intent'); if (!intent.trim()) return; send(name, { stage, intent }); if (name === 'steerIntent') ui.intentDraft = ''; return; }
      case 'steerDiff': send('steerDiff', { file: data.file }); return;
      default: send(name, { stage });
    }
  });
  root.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset?.act === 'move' && target.value) send('move', { stage: target.dataset.stage, position: Number(target.dataset.position), to: target.value === '__new' ? '' : target.value });
    if (target.dataset?.act === 'workflow') { ui.open = undefined; send('workflow', { id: target.value }); }
  });
  root.addEventListener('input', event => { if (event.target.id === 'st-note') ui.noteDraft = event.target.value; if (event.target.id === 'st-intent') ui.intentDraft = event.target.value; });
  root.addEventListener('toggle', event => { const id = event.target.dataset?.expand; if (id) ui.expanded[id] = event.target.open; }, true);
  return {
    update(next) {
      state = next || {};
      if (ui.open && !(state.workflow?.stages || []).some(stage => stage.id === ui.open)) ui.open = undefined;
      if (ui.open && state.card?.id !== ui.open) send('openStage', { id: ui.open });
      render();
    },
    shown() { send('ready', { open: ui.open }); }
  };
}

// The client as a string for a webview script.
const stagesClient = () => `const lineDiff = ${lineDiff.toString()};\nconst mountStages = ${mountStages.toString()};`;

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

module.exports = { stagesHTML, stagesClient, STAGES_STYLE, lineDiff, mountStages };
