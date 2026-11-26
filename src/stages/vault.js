'use strict';
// The human-readable side of stages: Markdown notes in an Obsidian vault
// (or <project>/.yamori/notes/ when no vault is configured).
//
// Each generated note has a managed section between
//   <!-- yamori:start --> and <!-- yamori:end -->
// that Yamori rewrites, and a free section (everything else) that it never
// overwrites. Founders and agents write intent and decisions there. All of
// this is plain file IO: nothing in this module calls a model.
const fs = require('node:fs');
const path = require('node:path');

const START = '<!-- yamori:start -->', END = '<!-- yamori:end -->';
const NOTES_HEADING = '## Your notes';
const MAX_NOTE = 4000;

function vaultRoot({ vaultPath, root }) {
  const repo = path.basename(root);
  return vaultPath ? path.join(vaultPath, 'Yamori', safeName(repo)) : path.join(root, '.yamori', 'notes');
}
// File names Obsidian and every OS accept.
function safeName(text) {
  return String(text || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80) || 'untitled';
}
const posix = file => file.split(path.sep).join('/');

// --- front matter (a small YAML subset: scalars and inline lists) ---
function parseNote(text) {
  let front = {}, body = String(text || ''), raw = '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (match) {
    raw = match[1]; body = body.slice(match[0].length);
    for (const line of raw.split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (!kv) continue;
      let value = kv[2].trim();
      if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map(item => unquote(item.trim())).filter(Boolean);
      else value = unquote(value);
      front[kv[1]] = value;
    }
  }
  const start = body.indexOf(START), end = body.indexOf(END);
  const managed = start >= 0 && end > start;
  return {
    front, rawFront: raw, body,
    before: managed ? body.slice(0, start) : '',
    managed: managed ? body.slice(start + START.length, end) : undefined,
    after: managed ? body.slice(end + END.length) : body
  };
}
function unquote(value) { return /^".*"$/.test(value) ? JSON.parse(value) : /^'.*'$/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : value; }
const yamlValue = value => Array.isArray(value) ? '[' + value.map(yamlValue).join(', ') + ']' : /^[\w./@-][\w ./@()-]*$/.test(String(value)) && !/^(true|false|null|yes|no|\d+)$/i.test(String(value)) ? String(value) : JSON.stringify(String(value));
// Yamori's keys are rewritten; any key the user added stays.
function writeFront(previousRaw, owned) {
  const lines = (previousRaw || '').split(/\r?\n/).filter(Boolean), out = [], seen = new Set();
  for (const line of lines) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key && key in owned) { if (!seen.has(key)) { out.push(key + ': ' + yamlValue(owned[key])); seen.add(key); } }
    else out.push(line);
  }
  for (const [key, value] of Object.entries(owned)) if (!seen.has(key)) out.push(key + ': ' + yamlValue(value));
  return '---\n' + out.join('\n') + '\n---\n';
}
// The free text a human or agent wrote: everything outside the managed section.
function freeText(parsed) {
  return (parsed.before + '\n' + parsed.after).replace(new RegExp('^\\s*' + NOTES_HEADING + '\\s*$', 'm'), '').trim();
}
// Replace only the managed section; keep the free section byte for byte.
function mergeNote(existing, { front, managed, defaultFree = '\n\n' + NOTES_HEADING + '\n\n' }) {
  const parsed = existing === undefined ? undefined : parseNote(existing);
  const head = writeFront(parsed?.rawFront, front);
  if (!parsed) return head + START + '\n' + managed.trim() + '\n' + END + defaultFree;
  if (parsed.managed === undefined) return head + START + '\n' + managed.trim() + '\n' + END + '\n\n' + parsed.body.trimStart();
  return head + parsed.before + START + '\n' + managed.trim() + '\n' + END + parsed.after;
}

function readFile(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; } }
function writeIfChanged(file, text) {
  if (readFile(file) === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(temp, text); fs.renameSync(temp, file);
  return true;
}
function listMarkdown(dir) {
  const out = [];
  const walk = current => { let entries = []; try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) { const full = path.join(current, entry.name); if (entry.isDirectory()) { if (entry.name !== '_archive') walk(full); } else if (entry.name.endsWith('.md')) out.push(full); } };
  walk(dir);
  return out;
}

// --- links back to code ---
function codeLinks(file, line, root) {
  const query = 'file=' + encodeURIComponent(file) + '&line=' + (line || 1) + (root ? '&root=' + encodeURIComponent(root) : '');
  return '[open](vscode://cowana-ai.yamori/open?' + query + ') · [cursor](cursor://cowana-ai.yamori/open?' + query + ')';
}
const mermaidText = text => String(text || '').replace(/["\[\]{}()<>|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const linkTo = (dir, file, label) => '[[' + posix(path.relative(dir, file)).replace(/\.md$/, '') + (label ? '|' + label : '') + ']]';
const GENERATED = new Set(['system', 'part', 'step', 'stage', 'file', 'index']);

// Notes a founder can read without knowing the code:
//   System.md                 how the whole system works, its parts and links
//   <Part>/<Part>.md          what one part does, its steps in order
//   <Part>/<Step>.md          what one step does; code references folded away
//   Changes/YYYY-MM-DD.md     what changed, what you decided and why
class Vault {
  constructor({ vaultPath, root }) {
    this.root = root; this.vaultPath = vaultPath || '';
    this.dir = vaultRoot({ vaultPath, root });
    this.obsidian = !!vaultPath;
    this.repo = path.basename(root);
  }
  systemFile() { return path.join(this.dir, 'System.md'); }
  // Notes are found by their front matter, so renamed files and folders still match.
  find(match) {
    const entries = this.scan || listMarkdown(this.dir).map(file => [file, parseNote(readFile(file)).front]);
    return entries.find(([, front]) => match(front))?.[0];
  }
  findStageNote(workflowId, stageId) { return this.find(front => (front.type === 'step' || front.type === 'stage') && front.workflow === workflowId && front.stage_id === stageId); }
  findPartNote(workflowId) { return this.find(front => front.type === 'part' && front.workflow === workflowId); }
  partName(db, workflowId) { const workflow = db.workflow(workflowId); return workflow?.name || workflow?.entry_symbol || workflowId; }
  partDir(db, workflowId) { const existing = this.findPartNote(workflowId); return existing ? path.dirname(existing) : path.join(this.dir, safeName(this.partName(db, workflowId))); }
  partNotePath(db, workflowId) { return this.findPartNote(workflowId) || path.join(this.partDir(db, workflowId), safeName(this.partName(db, workflowId)) + '.md'); }
  stageNotePath(db, workflowId, stage) {
    const found = this.findStageNote(workflowId, stage.id);
    if (found) return found;
    let file = path.join(this.partDir(db, workflowId), safeName(stage.name) + '.md');
    if (file === this.partNotePath(db, workflowId)) file = file.replace(/\.md$/, ' (step).md');
    return file;
  }
  write(file, front, managed, defaultFree) {
    const before = readFile(file), updated = new Date().toISOString();
    const keep = before ? parseNote(before).front.updated || updated : updated;
    let text = mergeNote(before, { front: { ...front, updated: keep }, managed, ...(defaultFree ? { defaultFree } : {}) });
    if (before !== undefined && text !== before) text = mergeNote(before, { front: { ...front, updated }, managed, ...(defaultFree ? { defaultFree } : {}) });
    writeIfChanged(file, text);
    return file;
  }

  // Rewrite every managed section. Pure file IO; returns the files it owns.
  syncSystem(db, graph, options = {}) {
    // One read of every note's front matter for the whole sync.
    this.scan = listMarkdown(this.dir).map(file => [file, parseNote(readFile(file)).front]);
    try { return this.syncAll(db, graph, options); } finally { this.scan = undefined; }
  }
  syncAll(db, graph, { summary = db.meta('system_summary') || '', notes = {} } = {}) {
    const owned = new Set(), workflows = db.workflows(), links = db.links();
    const name = id => this.partName(db, id);
    const day = at => String(at || '').slice(0, 10);
    const status = change => change.status === 'approved' ? 'kept' : change.status === 'rejected' ? 'rejected' : 'waiting for review';
    const requests = db.requests(200);
    // Code notes: one per file the map uses, so Obsidian's graph shows the real structure.
    const codeFiles = new Set();
    for (const workflow of workflows) for (const step of db.steps(workflow.id)) if (graph.files?.[step.file]) codeFiles.add(step.file);
    const codeNote = file => path.join(this.dir, 'Code', ...file.split('/')) + '.md';
    const codeLink = file => linkTo(this.dir, codeNote(file), file.split('/').at(-1));
    for (const workflow of workflows) {
      const list = db.stages(workflow.id), partFile = this.partNotePath(db, workflow.id);
      list.forEach((stage, index) => {
        const steps = db.steps(workflow.id, stage.id), file = this.stageNotePath(db, workflow.id, stage);
        const prev = list[index - 1], next = list[index + 1];
        const code = steps.map(step => '> - ' + (step.what ? step.what + ': ' : '') + '`' + step.symbol + '` in ' + codeLink(step.file) + ' · ' + codeLinks(step.file, step.line_start, this.obsidian ? this.root : undefined)).join('\n');
        // History writes itself: changes found in the code, your decisions, what you asked for.
        const history = [
          ...db.changes(workflow.id, { stageId: stage.id }).map(change => ({ at: change.decided_at || change.at, text: change.summary + ' (' + status(change) + (change.why ? ': ' + change.why.replace(/\n+/g, ' ') : '') + ')' })),
          ...requests.filter(request => request.targets.some(target => target.part === workflow.id && target.stage === stage.id)).map(request => ({ at: request.at, text: 'You asked: “' + request.intent.replace(/\n+/g, ' ') + '” (' + request.outcome + ')' }))
        ].sort((x, y) => x.at < y.at ? 1 : -1).slice(0, 12);
        const managed = [
          '# ' + stage.name, '',
          'Step ' + (index + 1) + ' of ' + list.length + ' in ' + linkTo(this.dir, partFile, name(workflow.id)), '',
          stage.gist ? '**What it does:** ' + stage.gist : '',
          '**Takes:** ' + (stage.input || '—') + ' → **Gives:** ' + (stage.output || '—'),
          [prev ? '**Before:** ' + linkTo(this.dir, this.stageNotePath(db, workflow.id, prev), prev.name) : '', next ? '**Next:** ' + linkTo(this.dir, this.stageNotePath(db, workflow.id, next), next.name) : ''].filter(Boolean).join(' · '), '',
          steps.some(step => step.what) ? '**How:**\n' + steps.filter(step => step.what).map((step, n) => (n + 1) + '. ' + step.what + (step.details?.length ? '\n' + step.details.map(detail => '    - ' + detail).join('\n') : '')).join('\n') + '\n' : '',
          '**Files:** ' + [...new Set(steps.map(step => step.file))].map(codeLink).join(' · '), '',
          history.length ? '## History\n\n' + history.map(item => '- ' + day(item.at) + ' · ' + item.text).join('\n') + '\n' : '',
          '> [!note]- Where this is in the code', code || '> (no code linked)', '',
          '_Yamori writes and updates everything above. Add a rule below only if you want one; your agents read it._'
        ].join('\n').replace(/\n{3,}/g, '\n\n');
        this.write(file, { type: 'step', part: name(workflow.id), workflow: workflow.id, stage_id: stage.id, name: stage.name }, managed);
        db.setMeta('vault:name:' + workflow.id + ':' + stage.id, stage.name);
        owned.add(file);
      });
      const uses = links.filter(link => link.from === workflow.id).map(link => '- It ' + link.label + ' ' + linkTo(this.dir, this.partNotePath(db, link.to), name(link.to)));
      const usedBy = links.filter(link => link.to === workflow.id).map(link => '- ' + linkTo(this.dir, this.partNotePath(db, link.from), name(link.from)) + ' ' + link.label + ' it');
      const flow = list.length ? '```mermaid\nflowchart LR\n' + list.map((stage, index) => '  s' + index + '["' + mermaidText((index + 1) + '. ' + stage.name) + '"]\n').join('') + list.slice(1).map((_, index) => '  s' + index + ' --> s' + (index + 1) + '\n').join('') + '```\n' : '';
      const managed = ['# ' + name(workflow.id), '',
        workflow.summary || '', '',
        flow,
        '## Steps', '',
        ...list.map((stage, index) => (index + 1) + '. ' + linkTo(this.dir, this.stageNotePath(db, workflow.id, stage), stage.name) + (stage.gist ? ': ' + stage.gist : '')), '',
        uses.length || usedBy.length ? '## Works with\n\n' + [...uses, ...usedBy].join('\n') + '\n' : '',
        '_Starts at `' + workflow.entry_symbol + '` in ' + codeLink(workflow.entry_file) + '._'].join('\n').replace(/\n{3,}/g, '\n\n');
      this.write(partFile, { type: 'part', workflow: workflow.id, name: name(workflow.id) }, managed);
      owned.add(partFile);
      if (graph.files?.[workflow.entry_file]) codeFiles.add(workflow.entry_file);
    }
    // Code notes: what each file is for, where it is used, what it uses.
    const edges = graph.edges || [];
    for (const file of [...codeFiles].sort().slice(0, 600)) {
      const note = notes?.files?.[file];
      const where = [];
      for (const workflow of workflows) for (const stage of db.stages(workflow.id)) if (db.steps(workflow.id, stage.id).some(step => step.file === file)) where.push('- ' + linkTo(this.dir, this.stageNotePath(db, workflow.id, stage), name(workflow.id) + ' › ' + stage.name));
      const usesFiles = [...new Set(edges.filter(edge => edge.from === file).map(edge => edge.to))].filter(other => codeFiles.has(other));
      const usedByFiles = [...new Set(edges.filter(edge => edge.to === file).map(edge => edge.from))].filter(other => codeFiles.has(other));
      const managed = ['# ' + file.split('/').at(-1), '', '`' + file + '` · ' + codeLinks(file, 1, this.obsidian ? this.root : undefined), '',
        note?.purpose || '', note?.role ? '_' + note.role + '_' : '', '',
        where.length ? '## Used in\n\n' + where.join('\n') + '\n' : '',
        usesFiles.length ? '## Uses\n\n' + usesFiles.map(other => '- ' + codeLink(other)).join('\n') + '\n' : '',
        usedByFiles.length ? '## Used by\n\n' + usedByFiles.map(other => '- ' + codeLink(other)).join('\n') + '\n' : ''].join('\n').replace(/\n{3,}/g, '\n\n');
      owned.add(this.write(codeNote(file), { type: 'file', path: file }, managed, '\n'));
    }
    // The system note: what it does, a diagram, the parts, and what happened lately.
    const view = workflows.map((workflow, index) => ({ id: workflow.id, key: 'p' + index }));
    const key = id => view.find(item => item.id === id)?.key;
    const diagram = workflows.length ? '```mermaid\nflowchart LR\n' + workflows.map(workflow => '  ' + key(workflow.id) + '["' + mermaidText(name(workflow.id)) + '"]').join('\n') + '\n' +
      links.filter(link => key(link.from) && key(link.to)).map(link => '  ' + key(link.from) + ' -- "' + mermaidText(link.label || 'uses') + '" --> ' + key(link.to) + '\n').join('') + '```\n' : '';
    const recent = [
      ...workflows.flatMap(workflow => db.changes(workflow.id).map(change => ({ at: change.decided_at || change.at, text: name(workflow.id) + ' › ' + (db.stage(workflow.id, change.stage_id)?.name || change.stage_id) + ': ' + change.summary + ' (' + status(change) + ')' }))),
      ...requests.map(request => ({ at: request.at, text: 'You asked: “' + request.intent.replace(/\n+/g, ' ') + '” (' + request.outcome + ')' }))
    ].sort((x, y) => x.at < y.at ? 1 : -1).slice(0, 15);
    const managed = ['# How ' + this.repo + ' works', '', summary || '', '',
      diagram,
      '## Parts', '',
      ...workflows.map(workflow => '- ' + linkTo(this.dir, this.partNotePath(db, workflow.id), name(workflow.id)) + (workflow.summary ? ': ' + workflow.summary : '')), '',
      links.length ? '## How they work together\n\n' + links.map(link => '- ' + linkTo(this.dir, this.partNotePath(db, link.from), name(link.from)) + ' ' + link.label + ' ' + linkTo(this.dir, this.partNotePath(db, link.to), name(link.to))).join('\n') + '\n' : '',
      recent.length ? '## Lately\n\n' + recent.map(item => '- ' + day(item.at) + ' · ' + item.text).join('\n') + '\n' : '',
      '_Yamori writes and updates everything above. Rules you add below apply to every change; your agents read them._'].join('\n').replace(/\n{3,}/g, '\n\n');
    owned.add(this.write(this.systemFile(), { type: 'system', repo: this.repo }, managed));
    this.archiveOrphans(owned);
    return [...owned];
  }
  // Kept for callers that sync one workflow: the whole system is cheap to write.
  syncWorkflow(db, graph) { return this.syncSystem(db, graph); }
  // Generated notes Yamori no longer writes move to _archive/. Nothing is deleted;
  // notes you created yourself (no managed section) are never touched.
  archiveOrphans(owned) {
    const moved = [];
    for (const file of listMarkdown(this.dir)) {
      if (owned.has(file) || file.startsWith(path.join(this.dir, 'Changes') + path.sep)) continue;
      const parsed = parseNote(readFile(file));
      if (!GENERATED.has(parsed.front.type) || parsed.managed === undefined) continue;
      const target = path.join(this.dir, '_archive', path.relative(this.dir, file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(file, fs.existsSync(target) ? target.replace(/\.md$/, ' ' + Date.now() + '.md') : target);
      moved.push(file);
    }
    // Folders left empty by a move go too.
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== '_archive') removeEmpty(path.join(this.dir, entry.name));
    return moved;
  }

  // --- reading the free sections (zero model calls) ---
  stageNotes(workflowId, stageId) {
    const file = this.findStageNote(workflowId, stageId);
    return file ? { text: freeText(parseNote(readFile(file))), file } : { text: '', file: undefined };
  }
  systemNotes() { const text = readFile(this.systemFile()); return text === undefined ? '' : freeText(parseNote(text)); }
  partNotes(workflowId) { const file = this.findPartNote(workflowId); return file ? freeText(parseNote(readFile(file))) : ''; }
  // Everything an agent must respect for one step: system, part and step notes.
  constraints(workflowId, stageId) {
    return [['Whole system', this.systemNotes()], ['This part', this.partNotes(workflowId)], ['This step', this.stageNotes(workflowId, stageId).text]].filter(([, text]) => text).map(([label, text]) => label + ':\n' + text).join('\n\n');
  }
  // A rename in a note's front matter becomes a pinned override.
  renames(db, workflowId) {
    const out = [];
    for (const file of listMarkdown(this.dir)) {
      const front = parseNote(readFile(file)).front;
      if (!['step', 'stage'].includes(front.type) || front.workflow !== workflowId || typeof front.name !== 'string' || !front.name.trim()) continue;
      const stage = db.stage(workflowId, front.stage_id), written = db.meta('vault:name:' + workflowId + ':' + front.stage_id);
      if (stage && written !== undefined && front.name.trim() !== written && front.name.trim() !== stage.name) out.push({ stageId: stage.id, name: front.name.trim() });
    }
    return out;
  }
  appendTo(file, text, author, at) {
    const clean = String(text || '').replace(/\r/g, '').trim().slice(0, MAX_NOTE);
    if (!clean) throw new Error('Write a note first.');
    let current = readFile(file);
    if (!new RegExp('^' + NOTES_HEADING + '\\s*$', 'm').test(parseNote(current).after)) current = current.replace(/\s*$/, '\n\n' + NOTES_HEADING + '\n');
    const lines = clean.split('\n');
    const entry = '- ' + at.toISOString().slice(0, 10) + ' · ' + String(author).replace(/[\n\r]/g, ' ').slice(0, 60) + ': ' + lines[0] + (lines.length > 1 ? '\n' + lines.slice(1).map(line => '  ' + line).join('\n') : '');
    writeIfChanged(file, current.replace(/\s*$/, '\n') + entry + '\n');
    return file;
  }
  // Append to a step's notes (the card's note box, or MCP add_note).
  addNote(db, workflowId, stageId, text, { author = 'You', at = new Date() } = {}) {
    if (!db.stage(workflowId, stageId)) throw new Error(`No step "${stageId}" in "${workflowId}".`);
    let file = this.findStageNote(workflowId, stageId);
    if (!file) { this.syncSystem(db, { files: {} }); file = this.findStageNote(workflowId, stageId); }
    return this.appendTo(file, text, author, at);
  }
  addSystemNote(db, text, { author = 'You', at = new Date() } = {}) {
    if (!fs.existsSync(this.systemFile())) this.syncSystem(db, { files: {} });
    return this.appendTo(this.systemFile(), text, author, at);
  }
  // What you asked for, in the day's log.
  appendRequest(db, request, { at = new Date() } = {}) {
    const day = at.toISOString().slice(0, 10), file = path.join(this.dir, 'Changes', day + '.md');
    let text = readFile(file) ?? '---\ntype: changes\ndate: ' + day + '\n---\n# What changed on ' + day + '\n\n';
    const where = (request.targets || []).map(target => target.file ? target.file : this.partName(db, target.part) + (target.stage ? ' › ' + (db.stage(target.part, target.stage)?.name || target.stage) : '')).join(', ');
    text = (text.endsWith('\n\n') ? text : text.replace(/\s*$/, '\n')) + '- ' + at.toISOString().slice(11, 16) + ' · You asked: “' + String(request.intent).replace(/\n+/g, ' ') + '”' + (where ? ' in ' + where : '') + '. **' + request.outcome[0].toUpperCase() + request.outcome.slice(1) + '.**' + (request.files?.length ? '\n  - Files: ' + request.files.join(', ') : '') + '\n';
    writeIfChanged(file, text);
    return file;
  }
  // The change log in plain words: what changed, where, the decision and why.
  appendChange(db, change, { at = new Date() } = {}) {
    const stage = db.stage(change.workflow_id, change.stage_id) || { id: change.stage_id, name: change.stage_id };
    const day = at.toISOString().slice(0, 10), file = path.join(this.dir, 'Changes', day + '.md');
    let text = readFile(file) ?? '---\ntype: changes\ndate: ' + day + '\n---\n# What changed on ' + day + '\n\n';
    const where = this.partName(db, change.workflow_id) + ' › ' + linkTo(this.dir, this.stageNotePath(db, change.workflow_id, stage), stage.name);
    text = (text.endsWith('\n\n') ? text : text.replace(/\s*$/, '\n')) + '- ' + at.toISOString().slice(11, 16) + ' · ' + where + ': ' + change.summary + ' **' + (change.status === 'approved' ? 'Approved' : change.status === 'rejected' ? 'Rejected' : change.status) + '.**' +
      (change.why ? '\n  - Why: ' + change.why.replace(/\n+/g, ' ') : '') + '\n';
    writeIfChanged(file, text);
    return file;
  }
}
function removeEmpty(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) if (entry.isDirectory()) removeEmpty(path.join(dir, entry.name));
  try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* Not empty. */ }
}

module.exports = { Vault, vaultRoot, parseNote, mergeNote, freeText, safeName, START, END, codeLinks };
