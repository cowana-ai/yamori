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
const NOTES_HEADING = '## Notes';
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
const blockId = symbol => String(symbol).replace(/[^A-Za-z0-9-]/g, '-').toLowerCase();
const filesNote = file => 'Files/' + file + '.md';

class Vault {
  constructor({ vaultPath, root }) {
    this.root = root; this.vaultPath = vaultPath || '';
    this.dir = vaultRoot({ vaultPath, root });
    this.obsidian = !!vaultPath;
  }
  stageDir(workflowId) { return path.join(this.dir, 'Stages', safeName(workflowId)); }
  // A stage note is found by its front matter, so a renamed file still matches.
  findStageNote(workflowId, stageId) {
    for (const file of listMarkdown(this.stageDir(workflowId))) {
      const front = parseNote(readFile(file)).front;
      if (front.type === 'stage' && front.workflow === workflowId && front.stage_id === stageId) return file;
    }
    return undefined;
  }
  stageNotePath(workflowId, stage) { return this.findStageNote(workflowId, stage.id) || path.join(this.stageDir(workflowId), safeName(stage.name) + '.md'); }
  stageLink(workflowId, stage) { return '[[' + posix(path.relative(this.dir, this.stageNotePath(workflowId, stage))).replace(/\.md$/, '') + '|' + stage.name + ']]'; }

  // Write every managed section of a workflow. Returns the files written.
  syncWorkflow(db, graph, notes, workflowId) {
    const workflow = db.workflow(workflowId);
    if (!workflow) return [];
    const written = [], updated = new Date().toISOString();
    const list = db.stages(workflowId), fileStages = new Map();
    for (const stage of list) {
      const steps = db.steps(workflowId, stage.id);
      const files = [...new Set(steps.map(step => step.file))];
      for (const step of steps) { if (!fileStages.has(step.file)) fileStages.set(step.file, []); fileStages.get(step.file).push({ stage, step }); }
      const managed = [
        '# ' + stage.name, '',
        stage.gist ? '> ' + stage.gist + '\n' : '',
        '**In:** ' + (stage.input || '—') + ' → **Out:** ' + (stage.output || '—'), '',
        '## Steps', '',
        ...steps.map((step, index) => (index + 1) + '. `' + step.symbol + '` · [[' + filesNote(step.file).replace(/\.md$/, '') + '#^' + blockId(step.symbol) + '|' + step.file + ']] · ' + codeLinks(step.file, step.line_start, this.obsidian ? this.root : undefined)),
        '', '_Managed by Yamori: this section is rewritten when the stage changes. Write below it._'
      ].filter(line => line !== null).join('\n');
      const file = this.stageNotePath(workflowId, stage);
      const before = readFile(file);
      const front = { type: 'stage', workflow: workflowId, stage_id: stage.id, name: stage.name, files, updated: before ? parseNote(before).front.updated || updated : updated };
      let text = mergeNote(before, { front, managed });
      if (text !== before && before !== undefined) text = mergeNote(before, { front: { ...front, updated }, managed });
      if (writeIfChanged(file, text)) written.push(file);
      db.setMeta('vault:name:' + workflowId + ':' + stage.id, stage.name);
    }
    // File notes: the AI note, the file's story across stages and backlinks.
    for (const [file, uses] of [...fileStages].sort(([a], [b]) => a < b ? -1 : 1)) {
      const note = notes?.files?.[file];
      const managed = [
        '# ' + file, '',
        note?.purpose ? '> ' + note.purpose + '\n' : '',
        note?.role ? '**Role:** ' + note.role + '\n' : '',
        '## In stages', '',
        ...uses.map(({ stage, step }) => '- `' + step.symbol + '` in ' + this.stageLink(workflowId, stage) + ' · ' + codeLinks(file, step.line_start, this.obsidian ? this.root : undefined) + ' ^' + blockId(step.symbol)),
        '', '_Managed by Yamori. Write below it._'
      ].join('\n');
      const target = path.join(this.dir, ...filesNote(file).split('/'));
      const before = readFile(target), front = { type: 'file', path: file, workflow: workflowId, updated: before ? parseNote(before).front.updated || updated : updated };
      let text = mergeNote(before, { front, managed });
      if (text !== before && before !== undefined) text = mergeNote(before, { front: { ...front, updated }, managed });
      if (writeIfChanged(target, text)) written.push(target);
    }
    this.archiveOrphans(db, workflowId);
    this.writeIndex(db);
    return written;
  }
  writeIndex(db) {
    const lines = ['# ' + path.basename(this.root), ''];
    for (const workflow of db.workflows()) {
      lines.push('## ' + workflow.id + ' (' + workflow.entry_file + (workflow.entry_symbol ? ' › ' + workflow.entry_symbol : '') + ')', '');
      for (const stage of db.stages(workflow.id)) {
        const files = [...new Set(db.steps(workflow.id, stage.id).map(step => step.file))];
        lines.push('- ' + this.stageLink(workflow.id, stage) + (files.length ? ': ' + files.map(file => '[[' + filesNote(file).replace(/\.md$/, '') + '|' + file + ']]').join(', ') : ''));
      }
      lines.push('');
    }
    const file = path.join(this.dir, 'Index.md');
    writeIfChanged(file, mergeNote(readFile(file), { front: { type: 'index' }, managed: lines.join('\n'), defaultFree: '\n' }));
  }
  // Generated notes whose stage is gone move to _archive/. Nothing is deleted.
  archiveOrphans(db, workflowId) {
    const live = new Set(db.stages(workflowId).map(stage => stage.id)), moved = [];
    for (const file of listMarkdown(this.stageDir(workflowId))) {
      const parsed = parseNote(readFile(file));
      if (parsed.front.type !== 'stage' || parsed.managed === undefined || parsed.front.workflow !== workflowId || live.has(parsed.front.stage_id)) continue;
      const target = path.join(this.dir, '_archive', path.relative(this.dir, file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(file, fs.existsSync(target) ? target.replace(/\.md$/, ' ' + Date.now() + '.md') : target);
      moved.push(file);
    }
    return moved;
  }

  // --- reading the free sections (zero model calls) ---
  stageNotes(workflowId, stageId) {
    const file = this.findStageNote(workflowId, stageId);
    if (!file) return { text: '', file: undefined };
    return { text: freeText(parseNote(readFile(file))), file };
  }
  // A rename in the note's front matter becomes a pinned override.
  renames(db, workflowId) {
    const out = [];
    for (const file of listMarkdown(this.stageDir(workflowId))) {
      const front = parseNote(readFile(file)).front;
      if (front.type !== 'stage' || front.workflow !== workflowId || typeof front.name !== 'string' || !front.name.trim()) continue;
      const stage = db.stage(workflowId, front.stage_id), written = db.meta('vault:name:' + workflowId + ':' + front.stage_id);
      if (stage && written !== undefined && front.name.trim() !== written && front.name.trim() !== stage.name) out.push({ stageId: stage.id, name: front.name.trim() });
    }
    return out;
  }
  // Append to a stage's free section (the card's note box, or MCP add_note).
  addNote(db, workflowId, stageId, text, { author = 'You', at = new Date() } = {}) {
    const clean = String(text || '').replace(/\r/g, '').trim().slice(0, MAX_NOTE);
    if (!clean) throw new Error('Write a note first.');
    const stage = db.stage(workflowId, stageId);
    if (!stage) throw new Error(`No stage "${stageId}" in workflow "${workflowId}".`);
    let file = this.findStageNote(workflowId, stageId);
    if (!file) { this.syncWorkflow(db, { files: {} }, {}, workflowId); file = this.findStageNote(workflowId, stageId); }
    let current = readFile(file);
    if (!new RegExp('^' + NOTES_HEADING + '\\s*$', 'm').test(parseNote(current).after)) current = current.replace(/\s*$/, '\n\n' + NOTES_HEADING + '\n');
    const lines = clean.split('\n');
    const entry = '- ' + at.toISOString().slice(0, 10) + ' · ' + author.replace(/[\n\r]/g, ' ').slice(0, 60) + ': ' + lines[0] + (lines.length > 1 ? '\n' + lines.slice(1).map(line => '  ' + line).join('\n') : '');
    writeIfChanged(file, current.replace(/\s*$/, '\n') + entry + '\n');
    return file;
  }
  // The change log: every decision with its sentence, stage link and why.
  appendChange(db, change, { at = new Date() } = {}) {
    const stage = db.stage(change.workflow_id, change.stage_id) || { id: change.stage_id, name: change.stage_id };
    const day = at.toISOString().slice(0, 10), file = path.join(this.dir, 'Changes', day + '.md');
    let text = readFile(file) ?? '---\ntype: changes\ndate: ' + day + '\n---\n# Changes · ' + day + '\n\n';
    text = text.replace(/\s*$/, '\n') + '- ' + at.toISOString().slice(11, 16) + ' · ' + this.stageLink(change.workflow_id, stage) + ' · **' + change.status + '** · ' + change.summary +
      (change.why ? '\n  - Why: ' + change.why.replace(/\n+/g, ' ') : '') + (change.base_sha || change.head_sha ? '\n  - Commits: ' + [change.base_sha, change.head_sha].filter(Boolean).map(sha => sha.slice(0, 7)).join('…') : '') + '\n';
    writeIfChanged(file, text);
    return file;
  }
}

module.exports = { Vault, vaultRoot, parseNote, mergeNote, freeText, safeName, START, END, codeLinks };
