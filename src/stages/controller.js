'use strict';
// Stages in VS Code: one panel and one SQLite store per project folder.
// Everything a founder opens here is served from SQLite and the existing
// caches. Model calls happen only on an explicit action or after saves have
// settled, and each one is budgeted and logged.
const fs = require('node:fs');
const path = require('node:path');
const { openStageDb, closeStageDb, dbPath, available, StageDbUnavailable } = require('./db');
const { createRun, normalizeBudget, activity } = require('./budget');
const stages = require('./generate');
const { createStageScheduler } = require('./scheduler');
const review = require('./review');
const { Vault } = require('./vault');
const steer = require('./steer');
const { lineDiff } = require('../views/stages');
const { stagesHTML } = require('../views/stages');

function createStages({ api, context, map, setting, gitOperationInProgress, extensions = {} }) {
  const projects = new Map();
  const budget = () => normalizeBudget(setting('tokenBudget', undefined));
  const autoUpdate = () => setting('stages.autoUpdate', true) !== false;

  function projectFor(entry) {
    const key = entry.root.toString();
    let item = projects.get(key);
    if (item) return item;
    item = { key, entry, root: entry.root.fsPath, workflowId: undefined, open: undefined, busy: '', error: '', notice: '' };
    item.scheduler = createStageScheduler((files, signal) => settled(item, files, signal), { paused: () => gitOperationInProgress(path.join(item.root, '.')) });
    projects.set(key, item);
    return item;
  }
  function dbFor(item, create = true) {
    if (item.db) return item.db;
    const file = dbPath(item.root);
    if (!create && !fs.existsSync(file)) return undefined;
    if (!available()) throw new StageDbUnavailable();
    item.db = openStageDb(file);
    // The database is derived and local: keep it out of commits.
    try { const ignore = path.join(item.root, '.yamori', '.gitignore'); if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'yamori.db\nyamori.db-*\nagent-done\n'); } catch { /* Best effort. */ }
    if (!item.workflowId) item.workflowId = item.db.meta('last_workflow') || item.db.workflows()[0]?.id;
    extensions.opened?.(item);
    try { vaultFor(item); } catch { /* Notes are optional. */ }
    // An agent's MCP `done` touches .yamori/agent-done: settle the burst now.
    try {
      item.doneWatch = fs.watch(path.dirname(file), (_event, name) => { if (String(name) === 'agent-done') item.scheduler.done(); });
    } catch { /* Without the watch, the idle timer still settles the burst. */ }
    return item.db;
  }
  // The vault (or .yamori/notes/) follows the setting; agents find it through the db.
  function vaultFor(item) {
    const vaultPath = String(setting('obsidian.vaultPath', '') || '').trim();
    if (item.vault && item.vault.vaultPath === vaultPath) return item.vault;
    item.vault = new Vault({ vaultPath, root: item.root });
    item.vaultWatch?.close(); item.vaultWatch = undefined;
    try { dbFor(item).setMeta('vault_root', item.vault.dir); } catch { /* No database yet. */ }
    try {
      fs.mkdirSync(item.vault.dir, { recursive: true });
      item.vaultWatch = fs.watch(item.vault.dir, { recursive: true }, (_event, name) => {
        if (!name || !String(name).endsWith('.md')) return;
        clearTimeout(item.vaultTimer);
        item.vaultTimer = setTimeout(() => vaultChanged(item), 300);
      });
    } catch { /* Watching is best effort; the card re-reads notes when opened. */ }
    return item.vault;
  }
  // Note edits never call a model. A rename in front matter becomes a pinned override.
  function vaultChanged(item) {
    const db = dbFor(item, false);
    if (!db) return;
    let renamed = false;
    for (const workflow of db.workflows()) for (const change of item.vault.renames(db, workflow.id)) { stages.renameStage(db, workflow.id, change.stageId, change.name); renamed = true; }
    if (renamed) sync(item);
    post(item);
  }
  // Rewrite managed sections. Pure file IO.
  function sync(item, workflowId = item.workflowId) {
    const db = dbFor(item, false);
    if (!db || !workflowId) return;
    try { vaultFor(item).syncWorkflow(db, item.entry.graph || { files: {} }, item.entry.notes, workflowId); }
    catch (error) { item.notice = 'Notes were not written: ' + error.message; }
  }
  async function request(tier) {
    const connection = await map.connection(tier);
    // Agents' propose_change (MCP, outside VS Code) uses the same provider and budget.
    try { if (tier === 'cheap' && projects.size) for (const item of projects.values()) if (item.db) { item.db.setMeta('connection:cheap', JSON.stringify({ provider: connection.provider, model: connection.model || '', effort: connection.effort ?? null, cliPath: connection.cliPath || '' })); item.db.setMeta('budget', JSON.stringify(budget())); } } catch { /* Agents fall back to get_stage. */ }
    return {
      provider: connection.provider, model: connection.model,
      request: async ({ prompt, schema, signal }) => {
        const response = await map.requestStructured({ ...connection, prompt, schema, signal, showPreview: false });
        return { raw: response.raw, usage: response.usage, model: response.actualModel || connection.model };
      }
    };
  }
  const head = async item => (await map.gitHead(item.entry).catch(() => undefined)) || null;

  // --- state for the panel (zero model calls) ---
  function state(item) {
    if (!available()) return { unavailable: new StageDbUnavailable().message };
    const db = dbFor(item, false);
    const base = { busy: item.busy, error: item.error, notice: item.notice, budget: budget() };
    if (!db) return { ...base, workflows: [] };
    const graph = item.entry.graph || { files: {} };
    const workflows = db.workflows();
    if (item.workflowId && !workflows.some(workflow => workflow.id === item.workflowId)) item.workflowId = workflows[0]?.id;
    const workflow = item.workflowId ? stages.workflowView(db, graph, item.workflowId) : undefined;
    const status = item.workflowId ? stages.workflowStatus(db, graph, item.workflowId, item.lastModel) : {};
    const card = workflow && item.open ? stages.stageView(db, graph, item.entry.explanations, item.workflowId, item.open) : undefined;
    if (card) { const notes = vaultFor(item).stageNotes(item.workflowId, card.id); card.notes = notes.text; card.noteFile = !!notes.file; }
    const extra = extensions.state?.(item, { db, graph, workflow, card }) || {};
    extra.vault = { dir: vaultFor(item).dir, obsidian: vaultFor(item).obsidian };
    if (item.steer && card && item.steer.stageId === card.id) extra.steer = steerState(item.steer);
    const lineOf = (file, symbol) => { const def = stages.symbolsOf(graph.files[file]).find(item => item.name === symbol); return def ? def.start || def.line : 1; };
    const queue = workflow ? review.reviewQueue(db, item.workflowId).map(change => ({ ...change, detail: change.detail && { ...change.detail, steps: (change.detail.steps || []).map(step => ({ ...step, line: lineOf(step.file, step.symbol) })) } })) : [];
    return { ...base, workflows, workflow, card, queue, outdated: !!status.outdated, activity: activity(db), ...extra };
  }
  function post(item) {
    if (!item.panel) return;
    try { void item.panel.webview.postMessage({ type: 'state', state: state(item) }); }
    catch (error) { void item.panel.webview.postMessage({ type: 'state', state: { error: error.message, workflows: [] } }); }
  }

  async function show(entry, { workflowId, stageId } = {}) {
    const item = projectFor(entry);
    if (workflowId) item.workflowId = workflowId;
    if (stageId) item.open = stageId;
    if (item.panel) { item.panel.reveal(item.panel.viewColumn); post(item); return item; }
    const panel = api.window.createWebviewPanel('yamoriStages', 'Stages · ' + path.basename(item.root), { viewColumn: api.ViewColumn.Active ?? api.ViewColumn.One, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    if (context.extensionUri && api.Uri.joinPath) panel.iconPath = api.Uri.joinPath(context.extensionUri, 'media', 'yamori.png');
    panel.webview.html = stagesHTML();
    item.panel = panel;
    panel.onDidDispose(() => { item.panel = undefined; });
    panel.webview.onDidReceiveMessage(async message => {
      try { item.error = ''; await receive(item, message); }
      catch (error) { item.error = error.message; }
      post(item);
    });
    return item;
  }
  // Compact hunks for the preview: changed lines with two lines of context.
  function hunks(before, after) {
    const lines = lineDiff(before, after), keep = new Set();
    lines.forEach((line, index) => { if (line.kind !== 'same') for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) keep.add(i); });
    const out = []; let last = -2;
    for (const index of [...keep].sort((a, b) => a - b)) { if (index > last + 1 && out.length) out.push({ kind: 'gap', text: '…' }); out.push(lines[index]); last = index; }
    return out;
  }
  function steerState(value) {
    return { stageId: value.stageId, phase: value.phase, intent: value.intent, message: value.message || '',
      summary: value.preview?.summary || value.applied?.summary || '',
      files: (value.preview?.files || []).map(item => ({ file: item.file, edits: item.edits, hunks: hunks(item.before, item.after) })),
      applied: value.applied ? value.applied.files.map(item => item.file) : [] };
  }
  const steerIO = item => ({ read: file => map.readSource(item.entry, file), write: (file, text) => map.writeSource(item.entry, file, text) });
  async function steerPreview(item, stageId, intent) {
    const db = dbFor(item), view = stages.stageView(db, item.entry.graph, item.entry.explanations, item.workflowId, stageId);
    if (!view) throw new Error('No such stage.');
    item.steerController?.abort();
    const controller = item.steerController = new AbortController();
    const { provider, model, request: send } = await request('main');
    item.steer = { stageId, intent, phase: 'previewing' }; post(item);
    try {
      const preview = await steer.previewSteer({ db, view, notes: vaultFor(item).stageNotes(item.workflowId, stageId).text, intent, io: steerIO(item), request: send, run: createRun(db, { budget: budget(), trigger: 'stages.steer' }), provider, model, workflowId: item.workflowId, signal: controller.signal });
      if (controller.signal.aborted) return;
      item.steer = { stageId, intent, phase: preview.files.length ? 'preview' : 'empty', preview, message: preview.files.length ? '' : preview.summary || 'No change was proposed.' };
    } catch (error) {
      if (!controller.signal.aborted) item.steer = { stageId, intent, phase: 'error', message: error.message };
    }
  }
  async function steerApply(item) {
    const preview = item.steer?.preview;
    if (!preview) throw new Error('Preview a change first.');
    const dirty = preview.files.filter(file => map.isDirty(item.entry, file.file)).map(file => file.file);
    if (dirty.length) throw new Error('Save or revert ' + dirty.join(', ') + ' first: the preview is based on the saved file.');
    const applied = await steer.applyAtomic(preview, steerIO(item));
    item.steer = { stageId: preview.stageId, intent: preview.intent, phase: 'applied', applied };
    // The applied change goes through the normal update and review.
    for (const file of applied.files) await saved(map.fileUri(item.entry, file.file));
  }
  async function steerUndo(item) {
    const applied = item.steer?.applied;
    const files = await steer.undoAtomic(applied, steerIO(item));
    item.steer = { stageId: item.steer.stageId, intent: item.steer.intent, phase: 'undone', message: 'Undone: ' + files.join(', ') + ' are back as they were.' };
    for (const file of files) await saved(map.fileUri(item.entry, file));
  }

  const MUTATIONS = new Set(['rename', 'pin', 'merge', 'move', 'decide', 'refresh', 'refreshStage', 'steerIntent']);
  async function receive(item, message) {
    if (!message || typeof message.type !== 'string') return;
    await handle(item, message);
    if (MUTATIONS.has(message.type)) sync(item);
  }
  async function handle(item, message) {
    const db = () => dbFor(item);
    const wf = item.workflowId;
    switch (message.type) {
      case 'ready': if (typeof message.open === 'string') item.open = message.open; break;
      case 'workflow': item.workflowId = message.id; item.open = undefined; db().setMeta('last_workflow', message.id); break;
      case 'openStage': item.open = typeof message.id === 'string' ? message.id : undefined; break;
      case 'fromEntry': await fromEntry(item.entry); break;
      case 'refresh': await updateChanged(item, { trigger: 'stages.update' }); break;
      case 'refreshStage': await updateChanged(item, { trigger: 'stages.update', stageId: message.stage }); break;
      case 'regenerate': await regenerate(item); break;
      case 'jump': await map.reveal(item.entry, message.file, message.line); break;
      case 'flow': await map.openFlow(item.entry, message.file, message.line); break;
      case 'rename': {
        const current = db().stage(wf, message.stage);
        const name = await api.window.showInputBox({ title: 'Rename stage', value: current?.name || '', prompt: 'Renamed stages are pinned: regeneration keeps your name and steps.' });
        if (name?.trim()) { stages.renameStage(db(), wf, message.stage, name); extensions.renamed?.(item, message.stage); }
        break;
      }
      case 'pin': { const current = db().stage(wf, message.stage); stages.pinStage(db(), wf, message.stage, !current?.pinned); break; }
      case 'merge': {
        const others = db().stages(wf).filter(stage => stage.id !== message.stage);
        const pick = await api.window.showQuickPick(others.map(stage => ({ label: stage.name, id: stage.id })), { title: 'Merge which stage into this one?' });
        if (pick) stages.mergeStages(db(), wf, message.stage, pick.id);
        break;
      }
      case 'move': {
        let newName;
        if (!message.to) { newName = await api.window.showInputBox({ title: 'Name the new stage', prompt: 'The step moves into a new pinned stage after this one.' }); if (!newName?.trim()) break; }
        const target = stages.moveStep(db(), wf, { from: message.stage, position: message.position, to: message.to || undefined, newName });
        item.open = db().stage(wf, message.stage) ? message.stage : target;
        break;
      }
      case 'decide': {
        if (!['approved', 'rejected'].includes(message.status)) break;
        const decided = review.decide(db(), Number(message.id), message.status, typeof message.why === 'string' ? message.why : '', { headSha: await head(item) });
        try { vaultFor(item).appendChange(db(), decided); } catch (error) { item.notice = 'The change log was not written: ' + error.message; }
        await extensions.decided?.(item, decided);
        break;
      }
      case 'addNote': vaultFor(item).addNote(db(), wf, message.stage, message.text, { author: 'You' }); break;
      case 'openNote': {
        const file = vaultFor(item).findStageNote(wf, message.stage) || (sync(item), vaultFor(item).findStageNote(wf, message.stage));
        if (file) await api.window.showTextDocument(await api.workspace.openTextDocument(api.Uri.file(file)), { preview: true, viewColumn: api.ViewColumn.Beside });
        break;
      }
      case 'steerPreview': await steerPreview(item, message.stage, typeof message.intent === 'string' ? message.intent : ''); break;
      case 'steerApply': await steerApply(item); break;
      case 'steerUndo': await steerUndo(item); break;
      case 'steerCancel': item.steerController?.abort(); item.steer = undefined; break;
      case 'steerDiff': { const file = item.steer?.preview?.files.find(entry => entry.file === message.file); if (file) await map.openProposed(item.entry, file.file, file.after, item.steer.preview.summary); break; }
      // Leave the intent for the next agent run instead (no model call).
      case 'steerIntent': {
        const text = typeof message.intent === 'string' ? message.intent.trim() : '';
        if (!text) break;
        vaultFor(item).addNote(db(), wf, message.stage, 'Intent for the next run: ' + text, { author: 'You' });
        item.steer = { stageId: message.stage, intent: '', phase: 'saved', message: 'Saved as an intent in this stage\'s notes. Agents see it in get_stage.' };
        break;
      }
      case 'markReviewed': review.markReviewed(db(), wf, await head(item)); break;
      case 'diff': {
        const change = db().change(Number(message.id));
        if (change) await map.openDiff(item.entry, change.base_sha || db().workflow(change.workflow_id)?.base_sha, message.file, message.line);
        break;
      }
      default: await extensions.receive?.(item, message);
    }
  }

  // --- generation ---
  async function suggestEntries(entry) {
    const graph = entry.graph, out = [];
    const editor = api.window.activeTextEditor, doc = editor?.document;
    const rel = doc?.uri?.scheme === 'file' ? map.relative(entry, doc.uri) : undefined;
    if (rel && graph.files[rel]) {
      const line = (editor.selection?.active?.line ?? 0) + 1;
      const here = stages.symbolsOf(graph.files[rel]).filter(def => def.line <= line && (def.end || def.line) >= line).at(-1);
      if (here) out.push({ label: here.name, description: rel + ':' + here.line, detail: 'At your cursor', file: rel, symbol: here.name });
      for (const def of stages.symbolsOf(graph.files[rel]).slice(0, 20)) if (def !== here) out.push({ label: def.name, description: rel + ':' + def.line, file: rel, symbol: def.name });
    }
    for (const file of graph.entries || []) for (const def of stages.symbolsOf(graph.files[file]).slice(0, 8)) if (!out.some(item => item.file === file && item.symbol === def.name)) out.push({ label: def.name, description: file + ':' + def.line, detail: 'Entry point file', file, symbol: def.name });
    return out;
  }
  async function fromEntry(entry, picked) {
    entry = await map.ensureGraph(entry);
    const item = projectFor(entry);
    if (!item.panel) await show(entry);
    const choice = picked || await api.window.showQuickPick(await suggestEntries(entry), { title: 'Where does the workflow start?', placeHolder: 'For example the function that runs your agent loop', matchOnDescription: true });
    if (!choice) return;
    const db = dbFor(item);
    const { provider, model, request: send } = await request('cheap');
    item.lastModel = model;
    let estimate = stages.estimateWorkflow({ graph: entry.graph, notes: entry.notes, explanations: entry.explanations, entryFile: choice.file, entrySymbol: choice.symbol, provider, model });
    let files = estimate.files;
    const existing = db.workflow(stages.slug(choice.symbol || choice.file));
    if (!existing) {
      // The first run is the expensive one: say what it costs and allow a narrower set.
      const notesLine = estimate.missingNotes.length ? ` ${estimate.missingNotes.length} of them need AI notes first (Yamori asks before writing them).` : '';
      const pick = await api.window.showInformationMessage(`Map stages from ${choice.symbol} across ${files.length} file${files.length === 1 ? '' : 's'}? About ${estimate.tokens.toLocaleString()} tokens, one ${model || provider} call.${notesLine}`, { modal: true }, 'Generate', 'Only these files…');
      if (!pick) return;
      if (pick === 'Only these files…') {
        const chosen = await api.window.showQuickPick(files.map(file => ({ label: file, picked: true, description: estimate.missingNotes.includes(file) ? 'no AI notes yet' : '' })), { canPickMany: true, title: 'Files to include' });
        if (!chosen?.length) return;
        files = chosen.map(row => row.label);
      }
      if (files.some(file => estimate.missingNotes.includes(file))) {
        await map.writeNotes(entry, files.filter(file => estimate.missingNotes.includes(file)));
        estimate = stages.estimateWorkflow({ graph: entry.graph, notes: entry.notes, explanations: entry.explanations, entryFile: choice.file, entrySymbol: choice.symbol, files, provider, model });
      }
    }
    await busy(item, 'Mapping stages…', async () => {
      const run = createRun(db, { budget: budget(), trigger: 'stages.fromEntry' });
      const result = await stages.generateWorkflow({ db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, entryFile: choice.file, entrySymbol: choice.symbol, files, request: send, run, provider, model, headSha: await head(item) });
      item.workflowId = result.workflowId; db.setMeta('last_workflow', result.workflowId);
      item.notice = result.calls ? '' : 'Nothing changed since these stages were made: no model call.';
      sync(item, result.workflowId);
      await extensions.generated?.(item, result.workflowId);
    });
  }
  async function regenerate(item) {
    const db = dbFor(item), workflow = db.workflow(item.workflowId);
    if (!workflow) return;
    const pick = await api.window.showWarningMessage(`Re-cluster every unpinned stage of ${workflow.id}? Pinned stages and your notes are kept. One cheap-model call.`, { modal: true }, 'Regenerate');
    if (pick !== 'Regenerate') return;
    const entry = await map.ensureGraph(item.entry);
    const { provider, model, request: send } = await request('cheap');
    item.lastModel = model;
    await busy(item, 'Regenerating stages…', async () => {
      const run = createRun(db, { budget: budget(), trigger: 'stages.regenerate' });
      await stages.generateWorkflow({ db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, entryFile: workflow.entry_file, entrySymbol: workflow.entry_symbol, id: workflow.id, files: db.files(workflow.id).map(file => file.path), request: send, run, provider, model, headSha: await head(item), force: true });
      sync(item, workflow.id);
      await extensions.generated?.(item, workflow.id);
    });
  }
  async function updateChanged(item, { trigger, stageId, signal, workflows } = {}) {
    const db = dbFor(item), entry = item.entry;
    const targets = workflows || (item.workflowId ? [item.workflowId] : []);
    if (!targets.length) return { calls: 0 };
    const { provider, model, request: send } = await request('cheap');
    item.lastModel = model;
    const readExcerpt = async (file, from, to) => { try { return (await map.readSource(entry, file)).split('\n').slice(from - 1, to).map((line, index) => (from + index) + ': ' + line).join('\n'); } catch { return undefined; } };
    const run = createRun(db, { budget: budget(), trigger });
    let calls = 0; const skipped = [];
    await busy(item, 'Updating changed stages…', async () => {
      for (const workflowId of targets) {
        const common = { db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, workflowId, request: send, run, provider, model, headSha: await head(item), readExcerpt, signal };
        if (stageId) { calls += (await stages.refreshStage({ ...common, stageId })).calls; continue; }
        const result = await stages.refreshStale(common);
        calls += result.calls; skipped.push(...result.skipped);
        sync(item, workflowId);
        await extensions.refreshed?.(item, workflowId, result);
      }
    });
    item.notice = skipped.length ? skipped[0].reason : '';
    return { calls, skipped };
  }
  async function busy(item, label, work) {
    item.busy = label; post(item);
    try { return await work(); } finally { item.busy = ''; post(item); }
  }

  // --- saves: hash, mark stale, then (after the burst settles) update ---
  async function saved(uri) {
    if (uri?.scheme !== 'file' || !available()) return;
    const entry = await map.entryForFile(uri).catch(() => undefined);
    if (!entry) return;
    const item = projectFor(entry), db = dbFor(item, false);
    const rel = map.relative(entry, uri);
    if (!db || !rel || rel.startsWith('.yamori/')) return;
    if (!db.all('SELECT 1 FROM files WHERE path = ? LIMIT 1', rel).length) return;
    item.scheduler.saved(rel);
  }
  async function settled(item, files, signal) {
    const db = dbFor(item);
    const entry = item.entry = await map.rescanFiles(item.entry, files);
    if (signal.aborted) return;
    const affected = new Set();
    for (const file of files) for (const stage of stages.fileChanged(db, file, entry.graph.files[file]?.hash || 'removed')) affected.add(stage.workflow_id);
    post(item);
    if (!affected.size || !autoUpdate() || signal.aborted) return;
    await updateChanged(item, { trigger: 'stages.auto', signal, workflows: [...affected] }).catch(error => { item.error = error.message; post(item); });
  }

  return {
    show: async (entry, options) => show(await map.ensureGraph(entry), options),
    fromEntry, regenerate: async entry => { const item = projectFor(entry); await show(entry); await regenerate(item); },
    saved, updateChanged, post, state, projectFor, dbFor, vaultFor, sync, vaultChanged, request, budget, busy,
    // An agent finished a run (MCP `done`): summarize once, now.
    agentDone(entry) { projectFor(entry).scheduler.done(); },
    dispose() { for (const item of projects.values()) { item.scheduler.dispose(); item.steerController?.abort(); item.doneWatch?.close(); item.vaultWatch?.close(); clearTimeout(item.vaultTimer); item.panel?.dispose(); if (item.db) closeStageDb(item.db.file); } projects.clear(); }
  };
}

module.exports = { createStages };
