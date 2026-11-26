'use strict';
// Yamori's stage store: <project>/.yamori/yamori.db.
//
// SQLite is the working datastore for stages. Everything in it is derived
// from code (plus the founder's structural overrides on pinned stages), so it
// can be rebuilt. Human intent lives in the Obsidian vault (see vault.js).
// Pseudocode is never copied here for the stage view: steps point into the
// per-file pseudocode cache by (file, symbol). The one exception is
// `snapshots`, the review baseline, which keeps the step text as it was when
// the founder last accepted the stage so a change can be shown red/green.
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 2;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS workflows (
  id           TEXT PRIMARY KEY,
  entry_file   TEXT NOT NULL,
  entry_symbol TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  reviewed_at  TEXT,
  base_sha     TEXT
);
CREATE TABLE IF NOT EXISTS files (
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  PRIMARY KEY (workflow_id, path)
);
CREATE TABLE IF NOT EXISTS stages (
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  gist        TEXT,
  input       TEXT,
  output      TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  stale       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, id)
);
CREATE TABLE IF NOT EXISTS steps (
  workflow_id TEXT NOT NULL,
  stage_id    TEXT NOT NULL,
  position    INTEGER NOT NULL,
  file        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  line_start  INTEGER,
  line_end    INTEGER,
  PRIMARY KEY (workflow_id, stage_id, position),
  FOREIGN KEY (workflow_id, stage_id) REFERENCES stages(workflow_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS changes (
  id          INTEGER PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id    TEXT NOT NULL,
  at          TEXT NOT NULL,
  summary     TEXT NOT NULL,
  base_sha    TEXT,
  head_sha    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  detail      TEXT,
  why         TEXT,
  decided_at  TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  workflow_id TEXT NOT NULL,
  file        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (workflow_id, file, symbol)
);
CREATE TABLE IF NOT EXISTS model_calls (
  id            INTEGER PRIMARY KEY,
  at            TEXT NOT NULL,
  day           TEXT NOT NULL,
  run_id        TEXT,
  trigger       TEXT NOT NULL,
  model         TEXT,
  workflow_id   TEXT,
  stage_id      TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL,
  estimated     INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE TABLE IF NOT EXISTS part_links (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  label   TEXT,
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS requests (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL,
  intent  TEXT NOT NULL,
  targets TEXT,
  outcome TEXT NOT NULL,
  files   TEXT
);
CREATE TABLE IF NOT EXISTS function_notes (
  file    TEXT NOT NULL,
  symbol  TEXT NOT NULL,
  hash    TEXT NOT NULL,
  what    TEXT,
  details TEXT,
  at      TEXT NOT NULL,
  PRIMARY KEY (file, symbol, hash)
);
CREATE INDEX IF NOT EXISTS steps_by_file ON steps(file);
CREATE INDEX IF NOT EXISTS changes_by_status ON changes(workflow_id, status);
CREATE INDEX IF NOT EXISTS calls_by_day ON model_calls(day);
`;

let sqlite;
function driver() {
  if (sqlite !== undefined) return sqlite;
  try { sqlite = require('node:sqlite'); } catch { sqlite = null; }
  return sqlite;
}
const available = () => !!driver()?.DatabaseSync;
class StageDbUnavailable extends Error {
  constructor() { super('Yamori stages need SQLite support from the editor runtime (Node 22.13 or newer, VS Code 1.101 or newer). Update the editor to use stages.'); this.code = 'YAMORI_NO_SQLITE'; }
}

const now = () => new Date().toISOString();
const dayOf = (at = new Date()) => (typeof at === 'string' ? new Date(at) : at).toISOString().slice(0, 10);
const row = value => value && { ...value };

// The database file for a project folder.
const dbPath = root => path.join(root, '.yamori', 'yamori.db');

class StageDb {
  constructor(file) {
    if (!available()) throw new StageDbUnavailable();
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.statements = new Map();
    this.db = new (driver().DatabaseSync)(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
    if (file !== ':memory:') { try { this.db.exec('PRAGMA journal_mode = WAL;'); } catch { /* Read-only media keeps the default journal. */ } }
    this.db.exec(SCHEMA);
    // v2: a workflow is a named part of the system; a step says in plain words what it does.
    this.addColumns('workflows', { name: 'TEXT', summary: 'TEXT', folder: 'TEXT', position: 'INTEGER' });
    this.addColumns('steps', { what: 'TEXT', details: 'TEXT', depth: 'INTEGER', parent: 'TEXT' });
    this.setMeta('schema_version', String(SCHEMA_VERSION));
  }
  addColumns(table, columns) {
    const have = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    for (const [name, type] of Object.entries(columns)) if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  close() { try { this.db.close(); } catch { /* Already closed. */ } }
  prepare(sql) {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }
  all(sql, ...args) { return this.prepare(sql).all(...args).map(row); }
  get(sql, ...args) { return row(this.prepare(sql).get(...args)); }
  run(sql, ...args) { return this.prepare(sql).run(...args); }
  // All writes of one logical change land together or not at all.
  transaction(work) {
    if (this.inTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Nothing to roll back. */ } throw error; }
    finally { this.inTransaction = false; }
  }

  meta(key) { return this.get('SELECT value FROM meta WHERE key = ?', key)?.value; }
  setMeta(key, value) { this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value == null ? null : String(value)); }

  // --- workflows ---
  workflows() { return this.all('SELECT * FROM workflows ORDER BY COALESCE(position, 1000000), id'); }
  setPart(id, { name, summary, folder, position }) { this.run('UPDATE workflows SET name = ?, summary = ?, folder = ?, position = ? WHERE id = ?', name ?? null, summary ?? null, folder ?? null, position ?? null, id); }
  links() { return this.all('SELECT from_id AS "from", to_id AS "to", label FROM part_links ORDER BY from_id, to_id'); }
  setLinks(links) { this.transaction(() => { this.run('DELETE FROM part_links'); for (const link of links) this.run('INSERT OR REPLACE INTO part_links (from_id, to_id, label) VALUES (?, ?, ?)', link.from, link.to, link.label ?? null); }); }
  workflow(id) { return this.get('SELECT * FROM workflows WHERE id = ?', id); }
  upsertWorkflow({ id, entry_file, entry_symbol, generated_at = now(), base_sha = null }) {
    this.run(`INSERT INTO workflows (id, entry_file, entry_symbol, generated_at, base_sha) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET entry_file = excluded.entry_file, entry_symbol = excluded.entry_symbol, generated_at = excluded.generated_at, base_sha = excluded.base_sha`,
      id, entry_file, entry_symbol, generated_at, base_sha);
  }
  deleteWorkflow(id) {
    this.transaction(() => {
      this.run('DELETE FROM steps WHERE workflow_id = ?', id);
      this.run('DELETE FROM snapshots WHERE workflow_id = ?', id);
      this.run('DELETE FROM changes WHERE workflow_id = ?', id);
      this.run('DELETE FROM part_links WHERE from_id = ? OR to_id = ?', id, id);
      this.run('DELETE FROM workflows WHERE id = ?', id);
    });
  }
  markReviewed(id, at = now()) { this.run('UPDATE workflows SET reviewed_at = ? WHERE id = ?', at, id); }

  // --- files ---
  files(workflowId) { return this.all('SELECT path, hash FROM files WHERE workflow_id = ? ORDER BY path', workflowId); }
  setFiles(workflowId, entries) {
    this.transaction(() => {
      this.run('DELETE FROM files WHERE workflow_id = ?', workflowId);
      for (const [file, hash] of entries) this.run('INSERT INTO files (workflow_id, path, hash) VALUES (?, ?, ?)', workflowId, file, hash);
    });
  }
  setFileHash(workflowId, file, hash) {
    this.run('INSERT INTO files (workflow_id, path, hash) VALUES (?, ?, ?) ON CONFLICT(workflow_id, path) DO UPDATE SET hash = excluded.hash', workflowId, file, hash);
  }

  // --- stages ---
  stages(workflowId) { return this.all('SELECT * FROM stages WHERE workflow_id = ? ORDER BY position, id', workflowId).map(fromStageRow); }
  stage(workflowId, id) { const value = this.get('SELECT * FROM stages WHERE workflow_id = ? AND id = ?', workflowId, id); return value && fromStageRow(value); }
  steps(workflowId, stageId) {
    const rows = stageId === undefined
      ? this.all('SELECT * FROM steps WHERE workflow_id = ? ORDER BY stage_id, position', workflowId)
      : this.all('SELECT * FROM steps WHERE workflow_id = ? AND stage_id = ? ORDER BY position', workflowId, stageId);
    return rows.map(row => ({ ...row, depth: row.depth || 0, details: behaviors(safeJson(row.details, [])) }));
  }
  // Replace every unpinned stage with fresh output, keeping pinned stages and
  // their steps exactly. `stages` come in display order.
  replaceStages(workflowId, stages) {
    this.transaction(() => {
      const pinned = this.stages(workflowId).filter(stage => stage.pinned);
      const pinnedIds = new Set(pinned.map(stage => stage.id));
      for (const stage of this.stages(workflowId)) if (!stage.pinned) {
        this.run('DELETE FROM steps WHERE workflow_id = ? AND stage_id = ?', workflowId, stage.id);
        this.run('DELETE FROM stages WHERE workflow_id = ? AND id = ?', workflowId, stage.id);
      }
      let position = 0;
      const order = [];
      for (const stage of stages) {
        if (pinnedIds.has(stage.id)) { order.push(stage.id); continue; }
        this.insertStage(workflowId, { ...stage, position: position++ });
        order.push(stage.id);
      }
      // Pinned stages the new output did not mention keep their relative place at the end.
      for (const stage of pinned) if (!order.includes(stage.id)) order.push(stage.id);
      this.reorder(workflowId, order);
    });
  }
  insertStage(workflowId, stage) {
    this.run('INSERT INTO stages (workflow_id, id, position, name, gist, input, output, pinned, stale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      workflowId, stage.id, stage.position ?? 0, stage.name, stage.gist ?? null, stage.input ?? null, stage.output ?? null, stage.pinned ? 1 : 0, stage.stale ? 1 : 0);
    this.setSteps(workflowId, stage.id, stage.steps || []);
  }
  setSteps(workflowId, stageId, steps) {
    this.run('DELETE FROM steps WHERE workflow_id = ? AND stage_id = ?', workflowId, stageId);
    steps.forEach((step, position) => this.run('INSERT INTO steps (workflow_id, stage_id, position, file, symbol, line_start, line_end, what, details, depth, parent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      workflowId, stageId, position, step.file, step.symbol, step.line_start ?? null, step.line_end ?? null, step.what ?? null, Array.isArray(step.details) && step.details.length ? JSON.stringify(step.details) : typeof step.details === 'string' ? step.details : null, step.depth || 0, step.parent || null));
  }
  updateStage(workflowId, id, fields) {
    const allowed = ['name', 'gist', 'input', 'output', 'pinned', 'stale', 'position'];
    const keys = Object.keys(fields).filter(key => allowed.includes(key));
    if (!keys.length) return;
    this.run(`UPDATE stages SET ${keys.map(key => key + ' = ?').join(', ')} WHERE workflow_id = ? AND id = ?`,
      ...keys.map(key => typeof fields[key] === 'boolean' ? (fields[key] ? 1 : 0) : fields[key] ?? null), workflowId, id);
  }
  reorder(workflowId, ids) {
    ids.forEach((id, position) => this.run('UPDATE stages SET position = ? WHERE workflow_id = ? AND id = ?', position, workflowId, id));
  }
  deleteStage(workflowId, id) {
    this.transaction(() => {
      this.run('DELETE FROM steps WHERE workflow_id = ? AND stage_id = ?', workflowId, id);
      this.run('DELETE FROM stages WHERE workflow_id = ? AND id = ?', workflowId, id);
      this.reorder(workflowId, this.stages(workflowId).map(stage => stage.id));
    });
  }
  // The key query on save: every unpinned stage with a step in this file.
  markStaleForFile(file) {
    const result = this.run(`UPDATE stages SET stale = 1
      WHERE pinned = 0 AND stale = 0 AND (workflow_id, id) IN (SELECT workflow_id, stage_id FROM steps WHERE file = ?)`, file);
    return Number(result.changes || 0);
  }
  stagesUsingFile(file) {
    return this.all('SELECT DISTINCT s.workflow_id, s.id, s.name, s.pinned, s.stale FROM steps t JOIN stages s ON s.workflow_id = t.workflow_id AND s.id = t.stage_id WHERE t.file = ? ORDER BY s.workflow_id, s.position', file);
  }
  staleStages(workflowId) {
    return workflowId === undefined ? this.all('SELECT workflow_id, id FROM stages WHERE stale = 1 ORDER BY workflow_id, position')
      : this.all('SELECT workflow_id, id FROM stages WHERE workflow_id = ? AND stale = 1 ORDER BY position', workflowId);
  }

  // --- review baseline ---
  snapshot(workflowId, file, symbol) { return this.get('SELECT text FROM snapshots WHERE workflow_id = ? AND file = ? AND symbol = ?', workflowId, file, symbol)?.text; }
  setSnapshot(workflowId, file, symbol, text) {
    if (text == null) { this.run('DELETE FROM snapshots WHERE workflow_id = ? AND file = ? AND symbol = ?', workflowId, file, symbol); return; }
    this.run('INSERT INTO snapshots (workflow_id, file, symbol, text) VALUES (?, ?, ?, ?) ON CONFLICT(workflow_id, file, symbol) DO UPDATE SET text = excluded.text', workflowId, file, symbol, text);
  }

  // --- changes (the review queue) ---
  addChange({ workflow_id, stage_id, summary, base_sha = null, head_sha = null, detail, at = now() }) {
    const result = this.run('INSERT INTO changes (workflow_id, stage_id, at, summary, base_sha, head_sha, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      workflow_id, stage_id, at, summary, base_sha, head_sha, 'pending', detail === undefined ? null : JSON.stringify(detail));
    return Number(result.lastInsertRowid);
  }
  changes(workflowId, { status, since, stageId } = {}) {
    const where = ['workflow_id = ?'], args = [workflowId];
    if (status) { where.push('status = ?'); args.push(status); }
    if (since) { where.push('at > ?'); args.push(since); }
    if (stageId) { where.push('stage_id = ?'); args.push(stageId); }
    return this.all(`SELECT * FROM changes WHERE ${where.join(' AND ')} ORDER BY at, id`, ...args).map(fromChangeRow);
  }
  change(id) { const value = this.get('SELECT * FROM changes WHERE id = ?', id); return value && fromChangeRow(value); }
  decideChange(id, status, why = '') {
    if (!['approved', 'rejected'].includes(status)) throw new Error('A change is approved or rejected.');
    this.run('UPDATE changes SET status = ?, why = ?, decided_at = ? WHERE id = ?', status, why || null, now(), id);
    return this.change(id);
  }
  pendingCount(workflowId) {
    return workflowId === undefined ? Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE status = 'pending'").n)
      : Number(this.get("SELECT COUNT(*) AS n FROM changes WHERE workflow_id = ? AND status = 'pending'", workflowId).n);
  }

  // --- what each function does, keyed by its code: reused until the code changes ---
  functionNote(file, symbol, hash) {
    const row = this.get('SELECT what, details FROM function_notes WHERE file = ? AND symbol = ? AND hash = ?', file, symbol, hash);
    return row && { what: row.what, details: behaviors(safeJson(row.details, [])) };
  }
  setFunctionNote(file, symbol, hash, { what, details = [] }) {
    this.run('INSERT INTO function_notes (file, symbol, hash, what, details, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(file, symbol, hash) DO UPDATE SET what = excluded.what, details = excluded.details, at = excluded.at', file, symbol, hash, what ?? null, JSON.stringify(details || []), now());
  }

  // --- what the founder asked for, and what came of it (for the notes) ---
  addRequest({ intent, targets = [], outcome, files = [], at = now() }) {
    this.run('INSERT INTO requests (at, intent, targets, outcome, files) VALUES (?, ?, ?, ?, ?)', at, String(intent).slice(0, 2000), JSON.stringify(targets), outcome, JSON.stringify(files));
  }
  requests(limit = 50) {
    return this.all('SELECT * FROM requests ORDER BY id DESC LIMIT ?', limit).map(row => ({ ...row, targets: safeJson(row.targets, []), files: safeJson(row.files, []) }));
  }

  // --- token ledger ---
  logCall({ trigger, model = null, workflow_id = null, stage_id = null, run_id = null, input = 0, cached = 0, output = 0, cost = null, estimated = false, note = null, at = new Date() }) {
    const iso = typeof at === 'string' ? at : at.toISOString();
    this.run('INSERT INTO model_calls (at, day, run_id, trigger, model, workflow_id, stage_id, input_tokens, cached_tokens, output_tokens, cost_usd, estimated, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      iso, dayOf(iso), run_id, trigger, model, workflow_id, stage_id, Math.round(input) || 0, Math.round(cached) || 0, Math.round(output) || 0, Number.isFinite(cost) ? cost : null, estimated ? 1 : 0, note);
  }
  calls({ day, limit = 200 } = {}) {
    return day ? this.all('SELECT * FROM model_calls WHERE day = ? ORDER BY id DESC LIMIT ?', day, limit) : this.all('SELECT * FROM model_calls ORDER BY id DESC LIMIT ?', limit);
  }
  usage({ day, runId } = {}) {
    const where = [], args = [];
    if (day) { where.push('day = ?'); args.push(day); }
    if (runId) { where.push('run_id = ?'); args.push(runId); }
    const value = this.get(`SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(cached_tokens), 0) AS cached, COALESCE(SUM(output_tokens), 0) AS output, COALESCE(SUM(cost_usd), 0) AS cost FROM model_calls ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...args);
    return { calls: Number(value.calls), input: Number(value.input), cached: Number(value.cached), output: Number(value.output), cost: Number(value.cost) };
  }
}

// Key behaviors of a step, each with a kind the map can draw. Older maps stored plain text.
const KINDS = ['decides', 'ai', 'asks', 'writes', 'reads', 'loops', 'fallback', 'stops', 'limit', 'other'];
function behaviors(list) {
  return (Array.isArray(list) ? list : []).map(item => typeof item === 'string' ? { kind: 'other', text: item } : item && typeof item.text === 'string' ? { kind: KINDS.includes(item.kind) ? item.kind : 'other', text: item.text } : undefined).filter(Boolean);
}
function safeJson(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } }
function fromStageRow(value) { return { ...value, pinned: !!value.pinned, stale: !!value.stale }; }
function fromChangeRow(value) {
  let detail;
  try { detail = value.detail ? JSON.parse(value.detail) : undefined; } catch { detail = undefined; }
  return { ...value, detail };
}

// One open handle per file inside a process.
const open = new Map();
function openStageDb(file) {
  let db = open.get(file);
  if (!db) { db = new StageDb(file); if (file !== ':memory:') open.set(file, db); }
  return db;
}
function closeStageDb(file) { open.get(file)?.close(); open.delete(file); }

module.exports = { behaviors, KINDS, StageDb, StageDbUnavailable, openStageDb, closeStageDb, dbPath, available, dayOf, now, SCHEMA_VERSION };
