'use strict';
// The System tab of Yamori's project panel: how the whole project works, as
// parts (one per workflow, found automatically) made of a few steps each.
// One SQLite store per project folder. Everything shown is served from SQLite,
// the caches and the notes on disk; AI runs only on an explicit action or
// after saves settle, and every call is budgeted and logged.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PROJECT_DIR, PROJECT_FILES } = require('../config');
const { openStageDb, closeStageDb, dbPath, available, StageDbUnavailable } = require('./db');
const { createRun, normalizeBudget, activity } = require('./budget');
const stages = require('./generate');
const system = require('./system');
const { createStageScheduler } = require('./scheduler');
const review = require('./review');
const { Vault } = require('./vault');
const steer = require('./steer');
const { lineDiff } = require('../views/stages');

function createStages({ api, context, map, setting, gitOperationInProgress, extensions = {}, obsidianConfig = defaultObsidianConfig() }) {
  const projects = new Map();
  const budget = () => normalizeBudget(setting('tokenBudget', undefined));
  const autoUpdate = () => setting('stages.autoUpdate', true) !== false;

  function projectFor(entry) {
    const key = entry.root.toString();
    let item = projects.get(key);
    if (item) { item.entry = entry; return item; }
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
    try { const ignore = path.join(item.root, PROJECT_DIR, '.gitignore'); if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, [PROJECT_FILES.db, PROJECT_FILES.db + '-*', PROJECT_FILES.agentDone, ''].join('\n')); } catch { /* Best effort. */ }
    if (!item.workflowId) item.workflowId = item.db.meta('last_workflow') || undefined;
    try { item.db.setMeta('vault_root', vaultFor(item).dir); } catch { /* Notes are optional. */ }
    // An agent's MCP `done` touches .yamori/agent-done: settle the burst now.
    try { item.doneWatch = fs.watch(path.dirname(file), (_event, name) => { if (String(name) === PROJECT_FILES.agentDone) item.scheduler.done(); }); }
    catch { /* Without the watch, the idle timer still settles the burst. */ }
    return item.db;
  }

  // --- notes: Obsidian with no setup ---
  // The setting if set; else the vault the project lives in; else the vault
  // Obsidian has open or opened last; else .yamori/notes/ in the project.
  function vaultPathFor(item) {
    const configured = String(setting('obsidian.vaultPath', '') || '').trim();
    if (configured) return configured;
    if (setting('obsidian.auto', true) === false) return '';
    for (let dir = item.root; ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.obsidian'))) return dir;
      if (path.dirname(dir) === dir) break;
    }
    return knownVaults(obsidianConfig)[0]?.path || '';
  }
  function vaultFor(item) {
    const vaultPath = vaultPathFor(item);
    if (item.vault && item.vault.vaultPath === vaultPath) return item.vault;
    const before = item.vault?.dir;
    item.vault = new Vault({ vaultPath, root: item.root });
    // Notes written before the vault was found come along; nothing there is overwritten.
    const local = path.join(item.root, PROJECT_DIR, PROJECT_FILES.notes);
    for (const from of new Set([before, local].filter(dir => dir && dir !== item.vault.dir))) {
      try { if (fs.existsSync(from)) { fs.cpSync(from, item.vault.dir, { recursive: true, force: false, errorOnExist: false }); fs.rmSync(from, { recursive: true, force: true }); } } catch { /* The old notes stay where they were. */ }
    }
    item.vaultWatch?.close(); item.vaultWatch = undefined;
    try { item.db?.setMeta('vault_root', item.vault.dir); } catch { /* No database yet. */ }
    if (item.db) sync(item);
    return item.vault;
  }
  // Notes are written and watched only once there is a map to write.
  function watchVault(item) {
    if (item.vaultWatch || !fs.existsSync(item.vault.dir)) return;
    try {
      item.vaultWatch = fs.watch(item.vault.dir, { recursive: true }, (_event, name) => {
        if (!name || !String(name).endsWith('.md')) return;
        clearTimeout(item.vaultTimer);
        item.vaultTimer = setTimeout(() => vaultChanged(item), 300);
      });
    } catch { /* Watching is best effort; notes are re-read when shown. */ }
  }
  // Note edits never call AI. A rename in front matter becomes a pinned override.
  function vaultChanged(item) {
    const db = dbFor(item, false);
    if (!db) return;
    let renamed = false;
    for (const workflow of db.workflows()) for (const change of item.vault.renames(db, workflow.id)) { stages.renameStage(db, workflow.id, change.stageId, change.name); renamed = true; }
    if (renamed) sync(item);
    post(item);
  }
  // Rewrite the managed sections of every note. Pure file IO.
  function sync(item) {
    const db = dbFor(item, false);
    if (!db || !db.workflows().length || !item.vault) return;
    try {
      const files = item.vault.syncSystem(db, item.entry.graph || { files: {} }, { notes: item.entry.notes, anatomy: item.notesLayers?.layers });
      item.lastSync = { at: new Date().toISOString(), notes: files.length, error: '' };
      watchVault(item);
      refreshNotesLayers(item, db);
    } catch (error) { item.lastSync = { at: new Date().toISOString(), notes: 0, error: error.message }; item.notice = 'Notes were not written: ' + error.message; }
  }

  // At most a few AI calls at once, across parts and step writers: each is a CLI process.
  const slots = { free: Math.max(1, Math.min(8, Number(setting('parallelRequests', 4)) || 4)), waiting: [] };
  const acquire = () => slots.free > 0 ? (slots.free--, Promise.resolve()) : new Promise(resolve => slots.waiting.push(resolve));
  const release = () => { const next = slots.waiting.shift(); if (next) next(); else slots.free++; };
  async function request(tier) {
    // Stage work (mapping, step writing, updates) is simple and structured: low
    // reasoning effort cut output tokens in half and time by about 3x in testing.
    const connection = tier === 'cheap' ? { ...(await map.connection(tier)), effort: 'low' } : await map.connection(tier);
    // Agents' propose_change (MCP, outside VS Code) uses the same provider and budget.
    try { for (const item of projects.values()) if (item.db && tier === 'cheap') { item.db.setMeta('connection:cheap', JSON.stringify({ provider: connection.provider, model: connection.model || '', effort: connection.effort ?? null, cliPath: connection.cliPath || '' })); item.db.setMeta('budget', JSON.stringify(budget())); } } catch { /* Agents fall back to get_stage. */ }
    return {
      provider: connection.provider, model: connection.model,
      request: async ({ prompt, schema, signal }) => {
        await acquire();
        try {
          if (signal?.aborted) throw new Error('Cancelled.');
          const response = await map.requestStructured({ ...connection, prompt, schema, signal, showPreview: false });
          return { raw: response.raw, usage: response.usage, model: response.actualModel || connection.model };
        } finally { release(); }
      }
    };
  }
  const head = async item => (await map.gitHead(item.entry).catch(() => undefined)) || null;
  const readTexts = async (item, files) => {
    const texts = new Map();
    for (const file of files) { try { texts.set(file, await map.readSource(item.entry, file)); } catch { /* Unreadable: ranked by structure only. */ } }
    return texts;
  };

  const syncLine = item => item.lastSync && !item.lastSync.error ? ' Notes updated' + (item.vault?.obsidian ? ' in Obsidian' : '') + ' (' + item.lastSync.notes + ' notes).' : '';
  // --- state for the panel (zero AI calls) ---
  function state(item) {
    if (!available()) return { unavailable: new StageDbUnavailable().message };
    const graph = item.entry.graph || { files: {} };
    const db = dbFor(item, false), vault = vaultFor(item);
    const base = { terminalChat: map.chatInTerminal ? map.chatInTerminal() : false, agentSession: !!map.agentSessionAlive?.(item.entry), layouts: layoutsFor(item), repo: path.basename(item.root), busy: item.busy, error: item.error, notice: item.notice, budget: budget(),
      vault: { obsidian: vault.obsidian, where: vault.obsidian ? path.basename(vault.vaultPath) + ' › Yamori › ' + vault.repo : '.yamori/notes in this project', dir: vault.dir, lastSync: item.lastSync } };
    if (!db || !db.workflows().length) return { ...base, estimate: estimateFor(item), system: undefined, activity: db ? activity(db) : undefined };
    const view = system.systemView(db, graph, item.entry.notes);
    if (item.workflowId && !view.parts.some(part => part.id === item.workflowId)) { item.workflowId = undefined; item.open = undefined; }
    if (item.file && !graph.files[item.file]) item.file = undefined;
    const card = item.workflowId && item.open ? stages.stageView(db, graph, item.entry.explanations, item.workflowId, item.open) : undefined;
    if (card) { card.notes = vault.stageNotes(item.workflowId, card.id).text; card.part = item.workflowId; }
    const lineOf = (file, symbol) => { const def = stages.symbolsOf(graph.files[file]).find(entry => entry.name === symbol); return def ? def.start || def.line : 1; };
    const names = new Map(view.parts.map(part => [part.id, part.name]));
    const queue = view.parts.flatMap(part => review.reviewQueue(db, part.id).map(change => ({ ...change, part_name: names.get(change.workflow_id),
      detail: change.detail && { ...change.detail, steps: (change.detail.steps || []).map(step => ({ ...step, line: lineOf(step.file, step.symbol) })) } }))).sort((a, b) => a.at < b.at ? -1 : 1);
    return { ...base, system: view, part: item.workflowId, card, queue, systemNotes: vault.systemNotes(),
      partDetail: item.workflowId ? system.partDetail(db, graph, item.entry.notes, item.workflowId) : undefined,
      partFlow: item.workflowId ? system.partFlow(db, graph, item.workflowId) : undefined,
      partCalls: item.workflowId ? item.callLinks?.[item.workflowId]?.links : undefined,
      partBuiltFrom: item.workflowId ? item.callLinks?.[item.workflowId]?.builtFrom : undefined,
      partLayers: item.workflowId ? item.callLinks?.[item.workflowId]?.layers : undefined,
      shared: item.shared ? sharedDetail(item, view) : undefined,
      file: item.file ? system.fileDetail(db, graph, item.entry.notes, item.file, item.entry.explanations) : undefined,
      route: item.route, steer: item.steer && steerState(item.steer), activity: activity(db) };
  }
  function post(item) {
    if (!item.host) return;
    try { void item.host.postMessage({ type: 'stages', state: state(item) }); }
    catch (error) { void item.host.postMessage({ type: 'stages', state: { error: error.message } }); }
  }
  // What mapping the whole system costs, computed once per set of files.
  function estimateFor(item) {
    const graph = item.entry.graph;
    if (!graph) return { pending: true };
    const key = system.signature(graph);
    if (item.estimateKey !== key && !item.estimating) {
      item.estimating = true;
      void (async () => {
        // The deep map reads each part's code: estimate from all source files (local reads, no AI).
        const texts = await readTexts(item, Object.keys(graph.files).filter(file => !graph.files[file].test && !graph.files[file].contextFile).slice(0, 800));
        const estimate = system.estimateSystem({ graph, notes: item.entry.notes, explanations: item.entry.explanations, texts, deep: true });
        item.estimate = { ...estimate, missingNotes: estimate.missingNotes.length };
        item.estimateKey = key;
      })().catch(error => { item.estimate = { error: error.message }; item.estimateKey = key; }).finally(() => { item.estimating = false; post(item); });
    }
    return item.estimate && item.estimateKey === key ? item.estimate : { pending: true };
  }

  // A shared-code box up close: its files and which parts use them.
  function sharedDetail(item, view) {
    const box = view.shared.find(entry => entry.id === item.shared);
    if (!box) return undefined;
    const graph = item.entry.graph, notes = item.entry.notes;
    const files = Object.keys(graph.files).filter(file => system.inFolder(file, box.folder) && !graph.files[file].test).sort();
    const set = new Set(files);
    return { ...box, fileList: files.slice(0, 80).map(file => ({ file, name: file.split('/').at(-1), purpose: notes?.files?.[file]?.purpose || '' })),
      edges: (graph.edges || []).filter(edge => set.has(edge.from) && set.has(edge.to)).map(edge => ({ from: edge.from, to: edge.to, names: (edge.names || []).slice(0, 4) })) };
  }
  // The project panel hosts the System tab.
  function attach(entry, host) {
    const item = projectFor(entry);
    item.host = host;
    try { markChanged(item); } catch { /* Shown on the next post. */ }
    // Notes are kept current by themselves: opening Yamori brings them up to date.
    try { if (dbFor(item, false)) { vaultFor(item); sync(item); } } catch { /* Shown on the next post. */ }
    return item;
  }
  function detach(entry) { const item = projects.get(entry.root.toString()); if (item) item.host = undefined; }
  // Code that changed while Yamori was closed: hash comparison only.
  function markChanged(item) {
    const db = dbFor(item, false), graph = item.entry.graph;
    if (!db || !graph) return;
    for (const workflow of db.workflows()) for (const file of stages.workflowStatus(db, graph, workflow.id).changedFiles) db.markStaleForFile(file);
  }
  async function show(entry, { workflowId, stageId } = {}) {
    const item = projectFor(entry);
    if (workflowId) item.workflowId = workflowId;
    if (stageId) item.open = stageId;
    await map.showStages(entry);
    post(item);
    return item;
  }
  // What the founder has selected here, for their agent session (get_view).
  function noteSelection(item) {
    const db = dbFor(item, false);
    const part = item.workflowId && db?.workflow(item.workflowId), stage = part && item.open ? db.stage(part.id, item.open) : undefined;
    map.noteView?.(item.entry, { system: part || item.file || item.shared ? {
      ...(part ? { part: part.name || part.id, partId: part.id, partDoes: part.summary || undefined } : {}),
      ...(stage ? { step: stage.name, stepId: stage.id, stepDoes: stage.gist || undefined, stepFiles: [...new Set(db.steps(part.id, stage.id).map(step => step.file))] } : {}),
      ...(item.file ? { file: item.file } : {}), ...(item.shared ? { sharedCode: item.shared.replace(/^code:/, '') } : {}) } : { overview: true } });
  }
  // The agent asked to show a part, step or file (MCP show_in_yamori).
  async function reveal(entry, { part, step, file } = {}) {
    const item = projectFor(entry), db = dbFor(item, false);
    const key = value => String(value || '').trim().toLowerCase();
    const found = db && part ? db.workflows().find(workflow => workflow.id === part || key(workflow.name) === key(part)) : undefined;
    const stage = found && step ? db.stages(found.id).find(entry => entry.id === step || key(entry.name) === key(step)) : undefined;
    item.workflowId = found?.id; item.open = stage?.id; item.file = file; item.shared = undefined;
    noteSelection(item);
    await show(entry);
  }
  // Boxes you dragged keep their place (per graph), until you reset them.
  function layoutsFor(item) {
    const db = dbFor(item, false);
    if (!db) return {};
    try { return JSON.parse(db.meta('layouts') || '{}'); } catch { return {}; }
  }
  // Which steps of a part call which, from its call tree (local, no AI), so a click
  // or a search can trace the real path. Cached until the part's files change.
  async function callLinks(item, workflowId) {
    const db = dbFor(item, false), graph = item.entry.graph, workflow = db?.workflow(workflowId);
    if (!workflow || !graph) return;
    const steps = db.steps(workflowId), keys = new Set(steps.map(step => step.file + '#' + step.symbol));
    const signature = db.files(workflowId).map(file => file.path + ':' + (graph.files[file.path]?.hash || '')).join('|') + '|' + [...keys].sort().join(',');
    item.callLinks ||= {};
    if (item.callLinks[workflowId]?.signature === signature) return;
    const { callTree } = require('./callgraph');
    const files = [...new Set([...db.files(workflowId).map(file => file.path), ...(system.areasOf(graph).find(area => area.folder === workflow.folder)?.files || [])])].filter(file => graph.files[file]);
    const texts = new Map();
    for (const file of files) { try { texts.set(file, await map.readSource(item.entry, file)); } catch { /* Left out. */ } }
    const tree = callTree(graph, texts, files, workflow.entry_file, workflow.entry_symbol, { maxNodes: 400, maxDepth: 14 });
    const byId = new Map(tree.nodes.map(node => [node.id, node])), links = {};
    // A step calls another step directly, or through helpers that are not steps.
    for (const node of tree.nodes) {
      const from = node.file + '#' + node.symbol;
      if (!keys.has(from)) continue;
      const found = new Set(), seen = new Set([node.id]), queue = [...node.calls];
      while (queue.length) {
        const next = byId.get(queue.shift());
        if (!next || seen.has(next.id)) continue;
        seen.add(next.id);
        const key = next.file + '#' + next.symbol;
        if (keys.has(key)) { if (key !== from) found.add(key); continue; }
        queue.push(...next.calls);
      }
      if (found.size) links[from] = [...found];
    }
    // What each class step is built from: the part's classes its code uses (a model from its layers).
    const { definitions, codeOnly } = require('./callgraph');
    const classes = new Map();
    for (const file of texts.keys()) for (const def of definitions(graph, file)) if (def.kind === 'class' && !classes.has(def.name)) classes.set(def.name, { file, def });
    const builtFrom = {};
    // For each class that is a step, or owns a method that is one.
    for (const step of steps) {
      const line = step.line_start || 0;
      const home = classes.get(step.symbol)?.file === step.file ? classes.get(step.symbol)
        : [...classes.values()].filter(item => item.file === step.file && item.def.start < line && item.def.end >= line).sort((a, b) => b.def.start - a.def.start)[0];
      if (!home || !texts.has(step.file) || builtFrom[step.file + '#' + home.def.name]) continue;
      const body = codeOnly(texts.get(step.file).split('\n').slice(home.def.start - 1, home.def.end).join('\n'));
      const used = [...classes.keys()].filter(name => name !== home.def.name && new RegExp('\\b' + name + '\\b').test(body));
      if (used.length) builtFrom[step.file + '#' + home.def.name] = used.slice(0, 8);
    }
    // What each class is made of and how data moves through it (shared cache with the notes).
    const layers = (await classLayersFor(item, [...texts.keys()], texts)).layers;
    item.callLinks[workflowId] = { signature, links, builtFrom, layers };
  }
  // What classes are made of, read from code (no AI), cached by the files' content:
  // the Your System tab and the Obsidian notes ask for the same files often.
  const CODE = /\.(py|ipynb|m?[jt]sx?|cjs|java|go|rs)$/i;
  function layersSignature(item, files) {
    const graph = item.entry.graph || { files: {} };
    const list = [...new Set(files)].filter(file => graph.files[file] && CODE.test(file)).sort();
    return { list, signature: list.map(file => file + ':' + (graph.files[file].hash || graph.files[file].size || '')).join('|') };
  }
  async function classLayersFor(item, files, texts = new Map()) {
    const { list, signature } = layersSignature(item, files);
    item.layersCache ||= new Map();
    if (item.layersCache.has(signature)) return item.layersCache.get(signature);
    const { definitions } = require('./callgraph'), graph = item.entry.graph;
    const read = new Map();
    for (const file of list) { if (texts.has(file)) read.set(file, texts.get(file)); else { try { read.set(file, await map.readSource(item.entry, file)); } catch { /* Left out. */ } } }
    const classes = [...read.keys()].flatMap(file => definitions(graph, file).filter(def => def.kind === 'class').map(def => ({ file, def })));
    const result = { signature, layers: require('./layers').partLayers(classes, read) };
    item.layersCache.set(signature, result);
    while (item.layersCache.size > 8) item.layersCache.delete(item.layersCache.keys().next().value);
    return result;
  }
  // The notes cover every class in the mapped steps' files and the files they import.
  function notesFiles(item, db) {
    const graph = item.entry.graph || { files: {}, edges: [] }, files = new Set();
    for (const workflow of db.workflows()) for (const step of db.steps(workflow.id)) if (graph.files[step.file]) files.add(step.file);
    for (const edge of graph.edges || []) if (files.has(edge.from) && graph.files[edge.to]) files.add(edge.to);
    return [...files];
  }
  // Brings the notes' class reading up to date in the background, then writes the notes again.
  function refreshNotesLayers(item, db) {
    if (item.notesLayersBusy) return;
    const files = notesFiles(item, db), { signature } = layersSignature(item, files);
    if (item.notesLayers?.signature === signature) return;
    item.notesLayersBusy = true;
    classLayersFor(item, files).then(result => {
      item.notesLayersBusy = false;
      // The project may have closed meanwhile.
      if (item.closed) return;
      item.notesLayers = result;
      try { sync(item); } catch { /* Notes are written on the next sync. */ }
    }, () => { item.notesLayersBusy = false; });
  }
  // A message from the System tab: errors show in the tab.
  async function message(entry, value) {
    const item = projectFor(entry);
    try {
      item.error = ''; await receive(item, value);
      if (['openPart', 'openStage', 'openFile', 'openShared'].includes(value?.type)) noteSelection(item);
      if (item.workflowId && ['openPart', 'ready', 'remapPart', 'upgradeParts', 'describeParts'].includes(value?.type)) await callLinks(item, item.workflowId).catch(() => {});
    }
    catch (error) { item.error = error.message; }
    post(item);
  }

  // --- steering: from a request to the steps it touches, then a preview ---
  function hunks(before, after) {
    const lines = lineDiff(before, after), keep = new Set();
    lines.forEach((line, index) => { if (line.kind !== 'same') for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) keep.add(i); });
    const out = []; let last = -2;
    for (const index of [...keep].sort((a, b) => a - b)) { if (index > last + 1 && out.length) out.push({ kind: 'gap', text: '…' }); out.push(lines[index]); last = index; }
    return out;
  }
  function steerState(value) {
    return { phase: value.phase, intent: value.intent, message: value.message || '', targets: value.targets || [],
      summary: value.preview?.summary || value.applied?.summary || '',
      files: (value.preview?.files || []).map(entry => ({ file: entry.file, edits: entry.edits, hunks: hunks(entry.before, entry.after) })),
      applied: value.applied ? value.applied.files.map(entry => entry.file) : [] };
  }
  const steerIO = item => ({ read: file => map.readSource(item.entry, file), write: (file, text) => map.writeSource(item.entry, file, text) });
  async function route(item, intent, scope) {
    const db = dbFor(item);
    const { provider, model, request: send } = await request('cheap');
    item.route = { intent, phase: 'routing' }; item.steer = undefined; post(item);
    try {
      const result = await system.routeIntent({ db, graph: item.entry.graph, intent, notes: vaultFor(item).systemNotes(), request: send, run: createRun(db, { budget: budget(), trigger: 'system.route' }), provider, model, scope: scope?.part && db.workflow(scope.part) ? { part: scope.part } : undefined });
      item.route = { ...result, phase: 'routed' };
    } catch (error) { item.route = undefined; throw error; }
  }
  async function steerPreview(item, intent, targets) {
    const db = dbFor(item), graph = item.entry.graph, vault = vaultFor(item);
    const valid = (targets || []).filter(target => target.file ? !!graph.files[target.file] : db.stage(target.part, target.stage));
    if (!valid.length) throw new Error('Pick where the change goes first.');
    // A file target stands for its own functions.
    const fileView = file => ({ id: 'file', name: file, gist: item.entry.notes?.files?.[file]?.purpose || '', input: '', output: '',
      steps: stages.symbolsOf(graph.files[file]).filter(def => ['function', 'method', 'class'].includes(def.kind)).slice(0, 16).map(def => ({ file, symbol: def.name, line_start: def.start || def.line, line_end: def.end || def.line })) });
    const views = valid.map(target => target.file ? fileView(target.file) : stages.stageView(db, graph, item.entry.explanations, target.part, target.stage));
    const view = { ...views[0], name: views.map(entry => entry.name).join(' + '), gist: views.map(entry => entry.name + ': ' + (entry.gist || '')).join(' '), steps: views.flatMap(entry => entry.steps) };
    const notes = [...new Set(valid.flatMap(target => target.file ? stepsOfFile(db, target.file).map(step => vault.constraints(step.part, step.stage)).concat(stepsOfFile(db, target.file).length ? [] : [vault.systemNotes()]) : [vault.constraints(target.part, target.stage)]))].filter(Boolean).join('\n\n');
    item.steerController?.abort();
    const controller = item.steerController = new AbortController();
    const { provider, model, request: send } = await request('main');
    item.steer = { intent, targets: valid, phase: 'previewing' }; post(item);
    try {
      const preview = await steer.previewSteer({ db, view, notes, intent, io: steerIO(item), request: send, run: createRun(db, { budget: budget(), trigger: 'system.steer' }), provider, model, workflowId: valid[0].part || stepsOfFile(db, valid[0].file)[0]?.part || null, signal: controller.signal });
      if (controller.signal.aborted) return;
      item.steer = { intent, targets: valid, phase: preview.files.length ? 'preview' : 'empty', preview, message: preview.files.length ? '' : preview.summary || 'No change was proposed.' };
    } catch (error) {
      if (!controller.signal.aborted) item.steer = { intent, targets: valid, phase: 'error', message: error.message };
    }
  }
  async function steerApply(item) {
    const preview = item.steer?.preview;
    if (!preview) throw new Error('Preview a change first.');
    const dirty = preview.files.filter(file => map.isDirty(item.entry, file.file)).map(file => file.file);
    if (dirty.length) throw new Error('Save or revert ' + dirty.join(', ') + ' first: the preview is based on the saved file.');
    const applied = await steer.applyAtomic(preview, steerIO(item));
    logRequest(item, item.steer.intent, item.steer.targets, 'applied', applied.files.map(file => file.file));
    item.steer = { ...item.steer, phase: 'applied', applied, preview: undefined };
    item.route = undefined;
    // The applied change goes through the normal update and review.
    for (const file of applied.files) await saved(map.fileUri(item.entry, file.file));
  }
  async function steerUndo(item) {
    const files = await steer.undoAtomic(item.steer?.applied, steerIO(item));
    logRequest(item, item.steer.intent, item.steer.targets, 'undone', files);
    item.steer = { ...item.steer, phase: 'undone', applied: undefined, message: 'Undone: ' + files.join(', ') + ' are back as they were.' };
    for (const file of files) await saved(map.fileUri(item.entry, file));
  }
  // Every request is remembered in the notes by itself: nothing to write by hand.
  function logRequest(item, intent, targets, outcome, files = []) {
    const db = dbFor(item), request = { intent: String(intent || ''), targets: targets || [], outcome, files };
    if (!request.intent) return;
    db.addRequest(request);
    try { vaultFor(item).appendRequest(db, request); } catch { /* The request still shows in the History. */ }
  }
  const stepsOfFile = (db, file) => db.all('SELECT DISTINCT workflow_id AS part, stage_id AS stage FROM steps WHERE file = ?', file);
  // Leave the request for the next agent run instead (no AI call).
  function handToAgent(item, intent, targets) {
    const db = dbFor(item), vault = vaultFor(item), text = String(intent || '').trim();
    if (!text) throw new Error('Say what should change.');
    const expanded = (targets || []).flatMap(target => target.file ? stepsOfFile(db, target.file) : target.part && !target.stage ? db.stages(target.part).map(stage => ({ part: target.part, stage: stage.id })) : [target]);
    const valid = expanded.filter(target => db.stage(target.part, target.stage));
    if (valid.length) for (const target of [...new Map(valid.map(target => [target.part + '/' + target.stage, target])).values()]) vault.addNote(db, target.part, target.stage, 'To do: ' + text, { author: 'You' });
    else vault.addSystemNote(db, 'To do: ' + text, { author: 'You' });
    logRequest(item, text, valid.length ? valid : targets, 'given to your agent');
    item.route = undefined;
    item.steer = { intent: '', targets: valid, phase: 'saved', message: 'Saved as a to-do in ' + (valid.length ? 'the notes of ' + valid.map(target => db.stage(target.part, target.stage).name).join(', ') : 'the system notes') + '. Your agents read it before they work on that code.' };
  }

  const MUTATIONS = new Set(['rename', 'pin', 'merge', 'move', 'decide', 'refresh', 'refreshStage', 'handToAgent', 'steerApply', 'steerUndo', 'markReviewed']);
  async function receive(item, value) {
    if (!value || typeof value.type !== 'string') return;
    await handle(item, value);
    if (MUTATIONS.has(value.type)) sync(item);
  }
  async function handle(item, message) {
    const db = () => dbFor(item);
    const part = typeof message.part === 'string' ? message.part : item.workflowId;
    switch (message.type) {
      case 'ready': break;
      case 'buildSystem': await buildSystem(item, { force: !!message.force }); break;
      case 'describeParts': await describeParts(item, message.id ? [message.id] : system.systemView(dbFor(item), item.entry.graph || { files: {} }).parts.filter(part => part.undescribed).map(part => part.id)); break;
      case 'remapPart': await remapParts(item, [message.id || item.workflowId].filter(Boolean)); break;
      case 'upgradeParts': await remapParts(item, system.systemView(dbFor(item), item.entry.graph || { files: {} }).parts.filter(part => part.outdated).map(part => part.id)); break;
      case 'openPart': item.workflowId = typeof message.id === 'string' && message.id ? message.id : undefined; item.open = undefined; item.file = undefined; item.shared = undefined; if (item.workflowId) db().setMeta('last_workflow', item.workflowId); break;
      case 'openStage': item.workflowId = part; item.open = typeof message.id === 'string' && message.id ? message.id : undefined; break;
      case 'openFile': item.file = typeof message.file === 'string' && message.file ? message.file : undefined; break;
      case 'openShared': item.shared = typeof message.id === 'string' && message.id ? message.id : undefined; item.workflowId = undefined; item.open = undefined; item.file = undefined; break;
      case 'refresh': await updateChanged(item, { trigger: 'system.update' }); break;
      case 'refreshStage': await updateChanged(item, { trigger: 'system.update', stageId: message.stage, workflows: [part] }); break;
      case 'jump': await map.reveal(item.entry, message.file, message.line); break;
      case 'flow': await map.openFlow(item.entry, message.file, message.line); break;
      case 'rename': {
        const current = db().stage(part, message.stage);
        const name = await api.window.showInputBox({ title: 'Rename this step', value: current?.name || '', prompt: 'Renamed steps stay as you set them when the map updates.' });
        if (name?.trim()) stages.renameStage(db(), part, message.stage, name);
        break;
      }
      case 'pin': { const current = db().stage(part, message.stage); stages.pinStage(db(), part, message.stage, !current?.pinned); break; }
      case 'merge': {
        const others = db().stages(part).filter(stage => stage.id !== message.stage);
        const pick = await api.window.showQuickPick(others.map(stage => ({ label: stage.name, id: stage.id })), { title: 'Merge which step into this one?' });
        if (pick) stages.mergeStages(db(), part, message.stage, pick.id);
        break;
      }
      case 'move': {
        let newName;
        if (!message.to) { newName = await api.window.showInputBox({ title: 'Name the new step', prompt: 'This code moves into a new step after this one.' }); if (!newName?.trim()) break; }
        const target = stages.moveStep(db(), part, { from: message.stage, position: message.position, to: message.to || undefined, newName });
        item.open = db().stage(part, message.stage) ? message.stage : target;
        break;
      }
      case 'decide': {
        if (!['approved', 'rejected'].includes(message.status)) break;
        const decided = review.decide(db(), Number(message.id), message.status, typeof message.why === 'string' ? message.why : '', { headSha: await head(item) });
        try { vaultFor(item).appendChange(db(), decided); } catch (error) { item.notice = 'The change log was not written: ' + error.message; }
        break;
      }
      case 'markReviewed': { const sha = await head(item); for (const workflow of db().workflows()) review.markReviewed(db(), workflow.id, sha); break; }
      case 'diff': {
        const change = db().change(Number(message.id));
        if (change) await map.openDiff(item.entry, change.base_sha || db().workflow(change.workflow_id)?.base_sha, message.file, message.line);
        break;
      }
      case 'addNote': vaultFor(item).addNote(db(), part, message.stage, message.text, { author: 'You' }); break;
      case 'addSystemNote': vaultFor(item).addSystemNote(db(), message.text, { author: 'You' }); break;
      case 'openNote': {
        const vault = vaultFor(item);
        const file = message.stage ? vault.findStageNote(part, message.stage) : vault.systemFile();
        if (!file || !fs.existsSync(file)) break;
        // In Obsidian when the notes live in a vault; otherwise beside the code.
        if (vault.obsidian && api.env?.openExternal && await api.env.openExternal(api.Uri.parse('obsidian://open?path=' + encodeURIComponent(file)))) break;
        await api.window.showTextDocument(await api.workspace.openTextDocument(api.Uri.file(file)), { preview: true, viewColumn: api.ViewColumn.Beside });
        break;
      }
      case 'syncNotes': sync(item); if (!item.lastSync?.error) item.notice = 'Notes updated' + (vaultFor(item).obsidian ? ' in Obsidian' : '') + ': ' + item.lastSync.notes + ' notes in ' + vaultFor(item).dir + '.'; break;
      case 'revealNotes': if (fs.existsSync(vaultFor(item).dir)) await api.commands?.executeCommand?.('revealFileInOS', api.Uri.file(vaultFor(item).dir)); break;
      case 'notesSettings': await api.commands?.executeCommand?.('workbench.action.openSettings', 'yamori.obsidian'); break;
      case 'route': await route(item, typeof message.intent === 'string' ? message.intent.trim() : '', message.scope); break;
      case 'routeCancel': item.route = undefined; item.steer = undefined; item.steerController?.abort(); break;
      case 'steerPreview': await steerPreview(item, String(message.intent || '').trim(), message.targets); break;
      case 'steerApply': await steerApply(item); break;
      case 'steerUndo': await steerUndo(item); break;
      case 'steerCancel': item.steerController?.abort(); item.steer = undefined; break;
      case 'steerDiff': { const file = item.steer?.preview?.files.find(entry => entry.file === message.file); if (file) await map.openProposed(item.entry, file.file, file.after, item.steer.preview.summary); break; }
      case 'handToAgent': handToAgent(item, message.intent, message.targets); break;
      case 'agentSession': await map.openAgentSession?.(item.entry, { prefill: typeof message.prefill === 'string' ? message.prefill.slice(0, 300) : '' }); break;
      case 'layout': {
        const layouts = layoutsFor(item), key = String(message.key || '').slice(0, 200);
        if (!key) break;
        if (message.reset) delete layouts[key];
        else if (typeof message.id === 'string' && Number.isFinite(message.x) && Number.isFinite(message.y)) layouts[key] = { ...(layouts[key] || {}), [message.id]: { x: Math.round(message.x), y: Math.round(message.y) } };
        dbFor(item).setMeta('layouts', JSON.stringify(layouts));
        break;
      }
      default: await extensions.receive?.(item, message);
    }
  }

  // --- mapping the whole system ---
  // Map one part (or every outdated part) again, deeply, keeping the parts as they are.
  async function remapParts(item, ids) {
    const entry = item.entry = await map.ensureGraph(item.entry), db = dbFor(item);
    const parts = ids.map(id => db.workflow(id)).filter(Boolean);
    if (!parts.length) return;
    const { provider, model, request: send } = await request('cheap');
    const run = createRun(db, { budget: { perRun: 0, perDay: 0 }, trigger: 'system.remap' });
    let done = 0; const failed = [];
    await busy(item, 'Mapping ' + (parts.length === 1 ? (parts[0].name || parts[0].id) : parts.length + ' parts') + ' again…', async () => {
      await Promise.all(parts.map(async part => {
        try {
          const result = await stages.generateWorkflow({ db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, entryFile: part.entry_file, entrySymbol: part.entry_symbol, id: part.id, request: send, run, provider, model, headSha: await head(item), force: true,
            readText: file => map.readSource(entry, file), scope: system.areasOf(entry.graph).find(area => area.folder === part.folder)?.files, part: { name: part.name, does: part.summary } });
          if (result.failed?.length) failed.push((part.name || part.id) + ': ' + result.failed.length + ' stage(s) not described (' + result.failed[0].replace(/^[^:]+: /, '').slice(0, 120) + ')');
        } catch (error) { failed.push((part.name || part.id) + ': ' + error.message); }
        item.busy = 'Mapped ' + (++done) + ' of ' + parts.length + '…'; post(item);
      }));
      sync(item);
    });
    item.notice = failed.length ? 'Not mapped: ' + failed.join('; ') : 'Mapped again: inner steps and key behaviors are on the diagrams.';
  }
  // Finish what a run left undescribed: only step writers, no re-planning.
  async function describeParts(item, ids) {
    const entry = item.entry = await map.ensureGraph(item.entry), db = dbFor(item);
    const parts = ids.map(id => db.workflow(id)).filter(Boolean);
    const { provider, model, request: send } = await request('cheap');
    const run = createRun(db, { budget: { perRun: 0, perDay: 0 }, trigger: 'system.describe' });
    let described = 0; const failed = [];
    await busy(item, 'Describing the missing steps…', async () => {
      await Promise.all(parts.map(async part => {
        try {
          const result = await stages.describeMissing({ db, graph: entry.graph, explanations: entry.explanations, workflowId: part.id, request: send, run, provider, model, readText: file => map.readSource(entry, file), part: { name: part.name, does: part.summary } });
          described += result.described; failed.push(...result.failed.map(reason => (part.name || part.id) + ' · ' + reason));
        } catch (error) { failed.push((part.name || part.id) + ': ' + error.message); }
        post(item);
      }));
      sync(item);
    });
    item.notice = failed.length ? 'Described ' + described + ' steps; not done: ' + failed.slice(0, 3).join('; ') : 'Described ' + described + ' steps.';
  }
  async function buildSystem(item, { force = false, confirm = false } = {}) {
    const entry = item.entry = await map.ensureGraph(item.entry);
    const db = dbFor(item);
    if (confirm && !db.workflows().length) {
      const texts = await readTexts(item, Object.keys(entry.graph.files).filter(file => !entry.graph.files[file].test && !entry.graph.files[file].contextFile).slice(0, 800));
      const estimate = system.estimateSystem({ graph: entry.graph, notes: entry.notes, explanations: entry.explanations, texts, deep: true });
      const pick = await api.window.showInformationMessage(`Map how ${path.basename(item.root)} works? Yamori finds its parts and their steps: about ${estimate.calls} AI calls, ${estimate.tokens.toLocaleString()} tokens.`, { modal: true }, 'Map it');
      if (pick !== 'Map it') return;
    }
    const { provider, model, request: send } = await request('cheap');
    await busy(item, 'Finding the parts of your system…', async () => {
      const texts = await readTexts(item, system.readFiles(entry.graph));
      // You asked for the map after seeing its estimate: it is logged, not capped.
      const run = createRun(db, { budget: { perRun: 0, perDay: 0 }, trigger: 'system.map' });
      const result = await system.buildSystem({ db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, texts, request: send, run, provider, model, headSha: await head(item), project: path.basename(item.root), force,
        readText: file => map.readSource(entry, file),
        onProgress: text => { item.busy = text; post(item); } });
      item.notice = result.failed.length ? 'Some parts could not be mapped: ' + result.failed.map(entry => entry.part + ' (' + entry.reason + ')').join('; ') : result.calls ? '' : 'Nothing changed since the map was made: no AI call.';
      vaultFor(item); sync(item);
    });
  }
  async function updateChanged(item, { trigger, stageId, signal, workflows } = {}) {
    const db = dbFor(item), entry = item.entry;
    markChanged(item);
    const targets = workflows || db.workflows().map(workflow => workflow.id).filter(id => db.staleStages(id).length);
    if (!targets.length) { sync(item); item.notice = 'Everything is up to date: no code changed since the last update.' + syncLine(item); return { calls: 0 }; }
    const { provider, model, request: send } = await request('cheap');
    const readExcerpt = async (file, from, to) => { try { return (await map.readSource(entry, file)).split('\n').slice(from - 1, to).map((line, index) => (from + index) + ': ' + line).join('\n'); } catch { return undefined; } };
    const run = createRun(db, { budget: budget(), trigger });
    let calls = 0; const skipped = [];
    await busy(item, 'Updating the steps whose code changed…', async () => {
      for (const workflowId of targets) {
        // A function's text at the map's base commit (git, no AI call).
        const readBefore = async (file, symbol) => {
          const base = db.workflow(workflowId)?.base_sha;
          if (!base || !map.readAtCommit) return undefined;
          const text = await map.readAtCommit(entry, base, file);
          const def = text && await map.findDefinition(file, text, symbol);
          return def && text.split('\n').slice(def.from - 1, Math.min(def.to, def.from + 60)).map((line, index) => (def.from + index) + ': ' + line).join('\n');
        };
        const common = { db, graph: entry.graph, notes: entry.notes, explanations: entry.explanations, workflowId, request: send, run, provider, model, headSha: await head(item), readExcerpt, readBefore, signal };
        if (stageId) { calls += (await stages.refreshStage({ ...common, stageId })).calls; continue; }
        const result = await stages.refreshStale(common);
        calls += result.calls; skipped.push(...result.skipped);
      }
      sync(item);
    });
    item.notice = skipped.length ? skipped[0].reason : 'Updated ' + calls + ' step' + (calls === 1 ? '' : 's') + ' whose code changed.' + syncLine(item);
    return { calls, skipped };
  }
  async function busy(item, label, work) {
    item.busy = label; post(item);
    try { return await work(); } finally { item.busy = ''; post(item); }
  }

  // --- saves: hash, mark stale, then (after the burst settles) update ---
  async function saved(uri) {
    if (uri?.scheme !== 'file' || !available()) return;
    // Most saves are in projects without a map: one stat, no store load.
    const root = map.rootFor?.(uri);
    if (root && !fs.existsSync(dbPath(root)) && ![...projects.values()].some(item => item.db && uri.fsPath.startsWith(item.root + path.sep))) return;
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
    if (!item.entry.graph) await map.ensureGraph(item.entry);
    const entry = item.entry = await map.rescanFiles(item.entry, files);
    if (signal.aborted) return;
    const affected = new Set();
    for (const file of files) for (const stage of stages.fileChanged(db, file, entry.graph.files[file]?.hash || 'removed')) affected.add(stage.workflow_id);
    sync(item);
    post(item);
    if (!affected.size || !autoUpdate() || signal.aborted) return;
    await updateChanged(item, { trigger: 'system.auto', signal, workflows: [...affected] }).catch(error => { item.error = error.message; post(item); });
  }

  return {
    show: async (entry, options) => show(await map.ensureGraph(entry), options),
    attach, detach, message, reveal,
    // Command palette: map the whole system, with one confirmation.
    fromEntry: async entry => { const item = projectFor(entry); await show(entry); await buildSystem(item, { confirm: true }); post(item); },
    regenerate: async entry => { const item = projectFor(entry); await show(entry); await buildSystem(item, { force: true }); post(item); },
    saved, updateChanged, post, state, projectFor, dbFor, vaultFor, sync, vaultChanged, request, budget, busy,
    // An agent finished a run (MCP `done`): summarize once, now.
    agentDone(entry) { projectFor(entry).scheduler.done(); },
    dispose() { for (const item of projects.values()) { item.closed = true; item.scheduler.dispose(); item.steerController?.abort(); item.doneWatch?.close(); item.vaultWatch?.close(); clearTimeout(item.vaultTimer); if (item.db) closeStageDb(item.db.file); } projects.clear(); }
  };
}

// Obsidian keeps its vault list in obsidian.json; the open vault first, then the most recent.
function defaultObsidianConfig() {
  const home = os.homedir();
  return process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'obsidian', 'obsidian.json');
}
function knownVaults(file) {
  try {
    const vaults = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).vaults || {});
    return vaults.filter(vault => typeof vault?.path === 'string' && fs.existsSync(path.join(vault.path, '.obsidian'))).sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
  } catch { return []; }
}

module.exports = { createStages, knownVaults };
