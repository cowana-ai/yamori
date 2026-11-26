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
#stages-view .st-how li { margin: 2px 0; }
#stages-view .st-foot { margin-top: 18px; }
@media (max-height: 520px) { #stages-view > .st-bar { position: static; } }
`;

// The client: mountStages(root, post) renders into root; post(message) goes
// to the extension. Returns { update(state) }.
function mountStages(root, post) {
  if (!root) return { update() {}, shown() {} };
  const doc = root.ownerDocument;
  let state = {}, ui = { pseudo: {}, expanded: {}, review: false, activity: false, code: {}, picked: undefined };
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
  const act = (name, data, label, attrs = {}) => h('button', { ...attrs, data: { act: name, ...data } }, label);
  const link = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-link' + (attrs.class ? ' ' + attrs.class : '') });
  const go = (name, data, label, attrs = {}) => act(name, data, label, { ...attrs, class: 'st-go' });
  const muted = text => h('span', { class: 'st-muted' }, text);
  const spacer = () => h('span', { class: 'st-spacer' });
  const section = (title, ...children) => h('div', { class: 'st-section' }, title ? h('h3', {}, title) : undefined, ...children);
  const diffBlock = lines => h('pre', { class: 'st-diff' }, lines.map(line => h('span', { class: line.kind }, (line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ') + line.text)));
  const partOf = id => state.system?.parts.find(part => part.id === id);
  const partName = id => partOf(id)?.name || id;
  const targetKey = target => target.part + '/' + target.stage;

  function header() {
    const total = state.activity?.total, sys = state.system;
    return h('div', { class: 'st-bar' },
      h('h1', { class: 'st-title' }, 'How ' + (state.repo || 'this project') + ' works'), spacer(),
      state.vault ? link('openNote', {}, state.vault.obsidian ? 'Notes in Obsidian: ' + state.vault.where : 'Notes: ' + state.vault.where, { title: state.vault.obsidian ? 'Open the system note in Obsidian' : 'Open the system note', disabled: !sys }) : undefined,
      sys ? act('refresh', {}, 'Update', { disabled: !!state.busy, title: 'Update only what changed in the code' }) : undefined,
      link('activity', {}, total?.calls ? 'Today: ' + tokens(total.input + total.cached + total.output) + ' tokens · ' + money(total.cost) : 'AI use', { title: 'Every AI call today, with tokens and cost' }));
  }
  // One place to ask for a change: find where it goes, then preview it or hand it to an agent.
  function steerBox() {
    const route = state.route, steer = state.steer;
    const box = h('div', { class: 'st-ask' },
      h('label', { for: 'st-intent', class: 'st-eyebrow' }, 'What should change?'),
      ui.direct ? h('div', { class: 'st-row' }, muted('Changing: '), h('b', {}, ui.direct.label), link('clearDirect', {}, 'any part instead')) : undefined,
      h('div', { class: 'st-row' }, h('textarea', { id: 'st-intent', rows: 2, placeholder: ui.direct ? 'What should it do differently?' : 'For example: retry a failed email twice before giving up', value: ui.intentDraft || '' }),
        ui.direct ? [go('route', {}, 'Preview the change', { disabled: !!state.busy, title: 'One AI call with your main model; sends only this step’s code and your notes' }), act('handToAgent', {}, 'Give it to my agent', { title: 'No AI call: saved in the notes your agents read' })]
          : go('route', {}, 'Find where', { disabled: !!state.busy || route?.phase === 'routing', title: 'One small AI call: finds which parts and steps this touches' })));
    if (route?.phase === 'routing') box.append(h('p', { class: 'st-notice' }, 'Finding where “' + route.intent + '” goes…'));
    if (route?.phase === 'routed' && !(steer && ['previewing', 'preview', 'applied'].includes(steer.phase))) {
      if (!ui.picked || ui.picked.intent !== route.intent) ui.picked = { intent: route.intent, keys: new Set(route.targets.map(targetKey)) };
      box.append(h('div', { class: 'st-route' },
        route.question ? h('p', {}, route.question) : h('p', {}, route.explanation),
        route.targets.length ? h('div', { class: 'st-targets' }, route.targets.map(target => h('label', { class: 'st-target' }, h('input', { type: 'checkbox', checked: ui.picked.keys.has(targetKey(target)), data: { key: targetKey(target) } }), target.partName + ' › ' + target.stageName))) : undefined,
        h('div', { class: 'st-tools' },
          route.targets.length ? go('steerPreview', {}, 'Preview the change', { title: 'One AI call with your main model; sends only the code of these steps and your notes' }) : undefined,
          act('handToAgent', {}, 'Give it to my agent', { title: 'No AI call: saved in the notes your agents read' }),
          link('routeCancel', {}, 'Cancel'))));
    }
    if (steer) box.append(steerPanel(steer));
    return box;
  }
  function steerPanel(steer) {
    const where = steer.targets?.length ? steer.targets.map(target => partName(target.part) + ' › ' + (partOf(target.part)?.stages.find(stage => stage.id === target.stage)?.name || target.stage)).join(', ') : '';
    if (steer.phase === 'previewing') return h('div', { class: 'st-route' }, h('p', {}, 'Writing the change for ' + where + '…'), h('div', { class: 'st-tools' }, act('steerCancel', {}, 'Stop')));
    if (steer.phase === 'preview') return h('div', { class: 'st-route' }, h('p', { class: 'st-sentence' }, steer.summary), muted(where + ' · ' + plural(steer.files.length, 'file') + ' · all files change together or none do · you can undo'),
      h('details', { open: !!ui.expanded.steer, data: { expand: 'steer' } }, h('summary', {}, 'Show the code change'),
        steer.files.map(file => h('div', { style: 'margin-top:8px' }, act('steerDiff', { file: file.file }, file.file, { class: 'st-chip', title: 'Open in the diff editor' }),
          file.edits.filter(edit => edit.why).map(edit => h('div', { class: 'st-muted' }, edit.why)), diffBlock(file.hunks)))),
      h('div', { class: 'st-tools' }, go('steerApply', {}, 'Apply'), act('steerCancel', {}, 'Discard')));
    if (steer.phase === 'applied') return h('div', { class: 'st-route' }, h('p', {}, 'Done: ' + steer.summary + ' The map updates in a moment and the change shows up in Review.'), h('div', { class: 'st-tools' }, act('steerUndo', {}, 'Undo'), link('steerCancel', {}, 'Close')));
    if (steer.message) return h('p', { class: steer.phase === 'error' ? 'st-error' : 'st-notice' }, steer.message, ' ', link('steerCancel', {}, 'Close'));
    return undefined;
  }
  function reviewBar() {
    const queue = state.queue || [];
    if (!queue.length) return undefined;
    const parts = [...new Set(queue.map(change => change.part_name))];
    return h('div', { class: 'st-review' }, h('b', {}, plural(queue.length, 'change') + ' to review'), muted('in ' + parts.join(', ')), spacer(),
      go('review', {}, ui.review ? 'Hide' : 'Review'), link('markReviewed', {}, 'Mark all seen', { title: 'Decide nothing, but count everything so far as seen' }));
  }
  function reviewPanel() {
    const queue = state.queue || [];
    if (!ui.review || !queue.length) return undefined;
    return h('section', { class: 'st-card', 'aria-label': 'Review changes' }, h('h2', {}, 'What changed', spacer(), link('review', {}, 'Close')), queue.map(change => {
      const asking = ui.why?.id === change.id, steps = change.detail?.steps || [];
      return h('div', { class: 'st-section' }, h('h3', {}, change.part_name + ' › ' + change.stage_name + ' · ' + change.at.slice(0, 16).replace('T', ' ')), h('p', { class: 'st-sentence' }, change.summary),
        h('details', { open: !!ui.expanded[change.id], data: { expand: change.id } }, h('summary', {}, 'Show what changed in detail'),
          steps.map(step => h('div', { style: 'margin-top:8px' }, act('diff', { id: change.id, file: step.file, line: step.line || 1 }, step.file + ' · code diff', { class: 'st-chip', title: 'Open the code diff' }),
            step.before || step.after ? diffBlock(lineDiff(step.before || '', step.after || '')) : h('p', { class: 'st-muted' }, 'Open the code diff to see this change.')))),
        asking ? h('div', { class: 'st-tools' }, h('textarea', { id: 'st-why', placeholder: 'Why? (optional; saved with your decision and read by your agents)' }), go('saveWhy', {}, ui.why.status === 'approved' ? 'Keep it' : 'Reject it'), act('cancelWhy', {}, 'Cancel'))
          : h('div', { class: 'st-tools' }, go('approve', { id: change.id }, 'Keep it'), act('reject', { id: change.id }, 'Reject it')));
    }));
  }
  // The whole system: every part, its steps in order, and how parts connect.
  function systemMap() {
    const sys = state.system;
    return h('div', { class: 'st-parts' }, sys.parts.map(part => {
      const open = state.part === part.id;
      return h('div', { class: 'st-part' + (open ? ' open' : '') },
        h('div', { class: 'st-row' }, act('openPart', { id: open ? '' : part.id }, part.name, { class: 'st-part-name', 'aria-expanded': String(open) }), spacer(),
          part.pending ? h('span', { class: 'st-badge plus', title: 'Changes waiting for your review' }, '±' + part.pending) : undefined,
          part.stale ? h('span', { class: 'st-badge stale', title: 'Code changed; Update refreshes it' }, 'changed') : undefined),
        h('p', { class: 'st-part-summary' }, part.summary),
        h('div', { class: 'st-flow' }, part.stages.map((stage, index) => [index ? h('span', { class: 'st-arrow' }, '→') : undefined,
          act('openStage', { part: part.id, id: stage.id }, stage.name, { class: 'st-step' + (state.card?.id === stage.id && state.part === part.id ? ' open' : '') + (stage.stale ? ' stale' : '') + (stage.pending ? ' changed' : ''), title: stage.gist || '' })])),
        part.uses.length || part.usedBy.length ? h('ul', { class: 'st-links' },
          part.uses.map(entry => h('li', {}, '→ ' + entry.label + ' ', link('openPart', { id: entry.to }, partName(entry.to)))),
          part.usedBy.map(entry => h('li', {}, '← ', link('openPart', { id: entry.from }, partName(entry.from)), ' ' + entry.label + ' it'))) : undefined);
    }));
  }
  function partDetail() {
    const part = partOf(state.part);
    if (!part) return undefined;
    return h('section', { class: 'st-card', 'aria-label': part.name },
      h('h2', {}, part.name, spacer(), link('openPart', { id: '' }, 'Close')), h('p', {}, part.summary),
      h('div', { class: 'st-graph', role: 'list' }, part.stages.map((stage, index) => [
        index ? h('div', { class: 'st-edge', 'aria-hidden': 'true' }, h('b', {}, '→')) : undefined,
        h('button', { role: 'listitem', class: 'st-stage' + (state.card?.id === stage.id ? ' open' : '') + (stage.stale ? ' stale' : ''), data: { act: 'openStage', part: part.id, id: stage.id } },
          h('span', { class: 'st-badges' }, stage.pending ? h('span', { class: 'st-badge plus' }, '±' + stage.pending) : undefined, stage.stale ? h('span', { class: 'st-badge stale' }, 'changed') : undefined),
          h('div', { class: 'st-name' }, (index + 1) + '. ' + stage.name), h('div', { class: 'st-gist' }, stage.gist || ''))])),
      stepCard());
  }
  function stepCard() {
    const stage = state.card;
    if (!stage) return undefined;
    const part = state.part, others = (partOf(part)?.stages || []).filter(item => item.id !== stage.id), id = { part, stage: stage.id }, showCode = !!ui.code[part + '/' + stage.id];
    return h('div', { class: 'st-step-card' },
      h('h2', {}, stage.name, stage.stale ? h('span', { class: 'st-badge stale' }, 'changed') : undefined, spacer(), link('openStage', { part, id: '' }, 'Close')),
      h('div', { class: 'st-story' }, h('b', {}, 'Does'), h('span', {}, stage.gist || '—'), h('b', {}, 'Takes'), h('span', {}, stage.input || '—'), h('b', {}, 'Gives'), h('span', {}, stage.output || '—')),
      stage.steps.some(step => step.what) ? section('How', h('ol', { class: 'st-how' }, stage.steps.filter(step => step.what).map(step => h('li', {}, step.what)))) : undefined,
      h('div', { class: 'st-tools' }, go('changeStep', id, 'Change this step…'), link('rename', id, 'Rename'), others.length ? link('merge', id, 'Merge with…') : undefined, link('pin', id, stage.pinned ? 'Let Yamori update it' : 'Keep as is'),
        stage.stale ? link('refreshStage', id, 'Update this step') : undefined, link('toggleCode', { key: part + '/' + stage.id }, showCode ? 'Hide code' : 'Show code')),
      showCode ? section('Where this is in the code', h('ol', { class: 'st-steps' }, stage.steps.map(step => {
        const key = stage.id + ':' + step.position, shown = ui.pseudo[key];
        return h('li', {}, h('div', { class: 'st-row' }, h('span', {}, step.what || step.symbol), act('jump', { file: step.file, line: step.line_start || 1 }, step.symbol + ' · ' + step.file + ':' + (step.line_start || '?'), { class: 'st-chip', title: 'Open the source line' }),
          step.missing ? muted('(no longer in the code)') : undefined, link('flow', { file: step.file, line: step.line_start || 1 }, 'Read'),
          step.pseudocode ? link('pseudo', { key }, shown ? 'Hide pseudocode' : 'Pseudocode') : undefined, spacer(),
          h('select', { 'aria-label': 'Move to another step', data: { act: 'move', part, stage: stage.id, position: step.position } }, h('option', { value: '' }, 'Move to…'), others.map(item => h('option', { value: item.id }, item.name)), h('option', { value: '__new' }, 'A new step'))),
          shown && step.pseudocode ? h('pre', {}, step.pseudocode) : undefined);
      }))) : undefined,
      section('Your notes on this step',
        stage.notes ? h('pre', {}, stage.notes) : h('p', { class: 'st-muted' }, 'Why it works this way, what must never change (for example “never store personal data”). Your agents read these before they touch this code.'),
        h('div', { class: 'st-tools' }, h('textarea', { id: 'st-note', 'aria-label': 'Add a note', placeholder: 'Write a note…', value: ui.noteDraft || '' }), go('addNote', id, 'Save note'),
          link('openNote', id, state.vault?.obsidian ? 'Open in Obsidian' : 'Open notes file'))));
  }
  function systemNotes() {
    return h('section', { class: 'st-card' }, h('h2', {}, 'Notes for the whole system', spacer(), link('openNote', {}, state.vault?.obsidian ? 'Open in Obsidian' : 'Open notes file')),
      state.systemNotes ? h('pre', {}, state.systemNotes) : h('p', { class: 'st-muted' }, 'Rules for everything (for example “all AI calls go through the budget check”). Your agents read them before any change.'),
      h('div', { class: 'st-tools' }, h('textarea', { id: 'st-system-note', 'aria-label': 'Add a system note', placeholder: 'Write a note…', value: ui.systemDraft || '' }), go('addSystemNote', {}, 'Save note')));
  }
  function activity() {
    if (!ui.activity || !state.activity) return undefined;
    const { total, calls, day } = state.activity;
    return h('section', { class: 'st-card' }, h('h2', {}, 'AI use · ' + day, spacer(), link('activity', {}, 'Close')),
      h('p', { class: 'st-muted' }, plural(total.calls, 'AI call') + ' today · input ' + tokens(total.input) + ' · cached ' + tokens(total.cached) + ' · output ' + tokens(total.output) + ' · ' + money(total.cost) +
        (state.budget ? ' · limit ' + (state.budget.perDay ? tokens(state.budget.perDay) + '/day' : 'none per day') + ', ' + (state.budget.perRun ? tokens(state.budget.perRun) + '/run' : 'none per run') : '')),
      calls.length ? [h('table', {}, h('tr', {}, ['When', 'What', 'Model', 'Input', 'Cached', 'Output', 'Cost', 'Note'].map(name => h('th', {}, name))),
        calls.map(call => h('tr', {}, [call.at.slice(11, 19), call.trigger, call.model || '', tokens(call.input_tokens) + (call.estimated ? '*' : ''), tokens(call.cached_tokens), tokens(call.output_tokens), money(call.cost_usd), call.note || ''].map(cell => h('td', {}, cell))))),
      h('p', { class: 'st-muted' }, '* estimated: the provider reported no usage.')] : h('p', { class: 'st-muted' }, 'No AI calls today. Looking at the map, steps and notes never uses AI.'));
  }
  function empty() {
    const estimate = state.estimate || {};
    return h('div', { class: 'st-empty' },
      h('p', {}, 'Yamori finds the parts of your project (each workflow, server, agent or tool), what each one does in a few plain steps, and how they connect. Then you can ask for changes from here, review what changed, and leave notes your agents follow.'),
      h('div', { class: 'st-found' },
        estimate.pending ? muted('Looking at your project…') : estimate.error ? h('p', { class: 'st-error' }, estimate.error)
          : h('p', {}, 'Mapping it takes about ' + plural(estimate.calls || 1, 'small AI call') + ' (about ' + tokens(estimate.tokens) + ' tokens). Afterwards, only code you change is looked at again.'),
        h('div', { class: 'st-tools' }, go('buildSystem', {}, 'Map my system', { disabled: !!state.busy })),
        state.vault ? h('p', { class: 'st-muted' }, state.vault.obsidian ? 'Notes will go to your Obsidian vault: ' + state.vault.where + '.' : 'Notes will go to ' + state.vault.where + '.') : undefined));
  }
  function body() {
    if (state.unavailable) return [h('div', { class: 'st-empty' }, h('p', { class: 'st-error' }, state.unavailable))];
    const sys = state.system;
    const notices = [
      state.error ? h('p', { class: 'st-error' }, state.error) : undefined,
      state.busy ? h('p', { class: 'st-notice' }, state.busy) : undefined,
      state.notice ? h('p', { class: 'st-notice' }, state.notice) : undefined,
      sys?.newFiles ? h('p', { class: 'st-notice' }, 'Files were added or removed since the map was made. ', link('buildSystem', {}, 'Update the map')) : undefined];
    if (!sys) return [header(), h('div', { class: 'st-top st-plain' }, notices), activity(), empty()];
    return [header(), h('div', { class: 'st-top' }, sys.summary ? h('p', { class: 'st-summary' }, sys.summary) : undefined, notices, reviewBar(), steerBox()),
      activity(), reviewPanel(), systemMap(), partDetail(), systemNotes(),
      h('p', { class: 'st-muted st-foot' }, 'Not right? ', link('rebuild', {}, 'Map the system again'), ' (one AI call for the parts, plus one per part).')];
  }
  function render() {
    // Keep typing intact when new state arrives mid-sentence.
    const active = doc.activeElement, keep = active && /^st-(note|why|intent|system-note)$/.test(active.id || '') ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd } : undefined;
    root.replaceChildren(...body().flat(Infinity).filter(Boolean));
    if (keep) { const field = root.querySelector('#' + keep.id); if (field) { field.value = keep.value; field.focus(); field.setSelectionRange(keep.start, keep.end); } }
  }
  const value = id => root.querySelector('#' + id)?.value || '';
  const pickedTargets = () => (state.route?.targets || []).filter(target => ui.picked?.keys.has(targetKey(target))).map(target => ({ part: target.part, stage: target.stage }));
  root.addEventListener('click', event => {
    const target = event.target.closest('[data-act]');
    if (!target || target.tagName === 'SELECT' || !root.contains(target)) return;
    const name = target.dataset.act, data = target.dataset;
    switch (name) {
      case 'activity': case 'review': ui[name] = !ui[name]; render(); return;
      case 'toggleCode': ui.code[data.key] = !ui.code[data.key]; render(); return;
      case 'pseudo': ui.pseudo[data.key] = !ui.pseudo[data.key]; render(); return;
      case 'openPart': send('openPart', { id: data.id || undefined }); return;
      case 'openStage': send('openStage', { part: data.part, id: data.id || undefined }); return;
      case 'jump': case 'flow': send(name, { file: data.file, line: Number(data.line) }); return;
      case 'rebuild': send('buildSystem', { force: true }); return;
      case 'route': {
        const intent = value('st-intent');
        if (!intent.trim()) { root.querySelector('#st-intent')?.focus(); return; }
        if (ui.direct) { send('steerPreview', { intent, targets: [{ part: ui.direct.part, stage: ui.direct.stage }] }); return; }
        ui.picked = undefined; send('route', { intent }); return;
      }
      case 'clearDirect': ui.direct = undefined; render(); return;
      case 'steerPreview': send('steerPreview', { intent: state.route?.intent || value('st-intent'), targets: pickedTargets() }); return;
      case 'handToAgent': send('handToAgent', { intent: state.route?.intent || value('st-intent'), targets: ui.direct ? [{ part: ui.direct.part, stage: ui.direct.stage }] : pickedTargets() }); ui.intentDraft = ''; ui.direct = undefined; return;
      case 'changeStep': {
        // Steer one step: skip "find where", the target is known.
        const stage = state.card, part = partOf(data.part);
        ui.direct = { part: data.part, stage: data.stage, label: part.name + ' › ' + stage.name };
        send('routeCancel');
        render();
        const field = root.querySelector('#st-intent');
        if (field) { field.focus(); field.scrollIntoView?.({ block: 'center' }); }
        return;
      }
      case 'approve': case 'reject': ui.why = { id: Number(data.id), status: name === 'approve' ? 'approved' : 'rejected' }; render(); root.querySelector('#st-why')?.focus(); return;
      case 'cancelWhy': ui.why = undefined; render(); return;
      case 'saveWhy': send('decide', { id: ui.why.id, status: ui.why.status, why: value('st-why') }); ui.why = undefined; return;
      case 'diff': send('diff', { id: Number(data.id), file: data.file, line: Number(data.line) }); return;
      case 'addNote': { const text = value('st-note'); if (!text.trim()) return; send('addNote', { part: data.part, stage: data.stage, text }); ui.noteDraft = ''; return; }
      case 'addSystemNote': { const text = value('st-system-note'); if (!text.trim()) return; send('addSystemNote', { text }); ui.systemDraft = ''; return; }
      case 'steerDiff': send('steerDiff', { file: data.file }); return;
      default: send(name, { part: data.part, stage: data.stage });
    }
  });
  // Enter in the request box with a step chosen from its card goes straight to a preview.
  root.addEventListener('keydown', event => {
    if (event.target.id !== 'st-intent' || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const intent = value('st-intent');
    if (!intent.trim()) return;
    if (ui.direct) send('steerPreview', { intent, targets: [{ part: ui.direct.part, stage: ui.direct.stage }] });
    else { ui.picked = undefined; send('route', { intent }); }
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
    if (id === 'st-intent') { ui.intentDraft = event.target.value; if (!event.target.value) ui.direct = undefined; }
  });
  root.addEventListener('toggle', event => { const id = event.target.dataset?.expand; if (id) ui.expanded[id] = event.target.open; }, true);
  return {
    update(next) {
      state = next || {};
      if (['applied', 'saved'].includes(state.steer?.phase)) { ui.direct = undefined; ui.intentDraft = ''; }
      render();
    },
    shown() { send('ready'); }
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
