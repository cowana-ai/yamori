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
    try { const ignore = path.join(item.root, '.yamori', '.gitignore'); if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'yamori.db\nyamori.db-*\n'); } catch { /* Best effort. */ }
    if (!item.workflowId) item.workflowId = item.db.meta('last_workflow') || item.db.workflows()[0]?.id;
    extensions.opened?.(item);
    return item.db;
  }
  async function request(tier) {
    const connection = await map.connection(tier);
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
    const extra = extensions.state?.(item, { db, graph, workflow, card }) || {};
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
  async function receive(item, message) {
    if (!message || typeof message.type !== 'string') return;
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
        await extensions.decided?.(item, decided);
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
    saved, updateChanged, post, state, projectFor, dbFor, request, budget, busy,
    // An agent finished a run (MCP `done`): summarize once, now.
    agentDone(entry) { projectFor(entry).scheduler.done(); },
    dispose() { for (const item of projects.values()) { item.scheduler.dispose(); item.panel?.dispose(); if (item.db) closeStageDb(item.db.file); } projects.clear(); }
  };
}

module.exports = { createStages };
