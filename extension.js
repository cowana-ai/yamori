'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { reviewDraft, reviewModel, REFINEMENT_VERSION, providerStatus, clearProviderStatus, isSetupProblem, runProcess, simulationPrompt, parseSimulation, SIMULATION_SCHEMA, fastModel, LEVELS, PROVIDERS, cacheKey, generate, hash, parseResult, lowerView, ORDER, listModels, listEfforts, findCLI, cliLaunch, refinementSteps, requestStructured, notesPrompt, parseNotes, mapSummaryPrompt, parseMapSummary, NOTES_SCHEMA, MAP_SUMMARY_SCHEMA } = require('./engine');
const { panelHTML } = require('./panel');
const { LocalCache, currentSnapshot, analyzeSource, dependencyBlocks } = require('./cache');
const { mapHTML } = require('./map');
const { setupHTML } = require('./setup');
const project = require('./project');

const INCLUDE = '**/*.{py,js,jsx,ts,tsx,mjs,cjs,go,rs,java,kt,scala,cs,c,cpp,cc,h,hpp,rb,php,swift,dart,r,R,sh,bash,lua,pl,sql,vue,svelte}';
const EXCLUDE = '**/{node_modules,.git,.venv,venv,env,dist,build,out,vendor,.next,coverage,__pycache__}/**';
const MAX_BYTES = 120000;

// Restricted Mode never accepts an executable path or usage policy from a project.
function setting(api, name, fallback = '') {
  const config = api.workspace.getConfiguration('yamori');
  if (api.workspace.isTrusted !== false) return config.get(name, fallback);
  const inspected = config.inspect?.(name);
  return inspected?.globalValue ?? inspected?.defaultValue ?? fallback;
}

// Ask the editor's language service for actual definitions. Never infer a model
// architecture from a variable name or crawl a repository to find a name match.
async function collectCallContext(snapshot, api = vscode, timeout = 1600) {
  if (api.workspace.isTrusted === false) return { ...snapshot, callContext: { definitions: [], unresolved: [], note: 'Restricted Mode: only supplied source is read. Project language services and definition lookups are not invoked; unknown custom behavior must stay explicit.' } };
  if (!api.commands.executeCommand || !api.workspace.getWorkspaceFolder) return snapshot;
  const calls = [], seen = new Set();
  const ordinary = /^(if|for|while|switch|catch|return|print|len|range|int|float|str|list|dict|set|tuple|sum|max|min|zip|enumerate|super|isinstance|hasattr|getattr|setattr|abs|round|bool)$/;
  snapshot.text.split('\n').forEach((line, i) => {
    if (/^\s*(#|\/\/)/.test(line)) return;
    for (const match of line.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)) {
      const symbol = match[1], leaf = symbol.split('.').at(-1);
      if (ordinary.test(leaf) || seen.has(symbol) || /(?:def|function|class)\s+$/.test(line.slice(0, match.index))) continue;
      seen.add(symbol); calls.push({ symbol, line: snapshot.startLine - 1 + i, character: match.index + symbol.length - leaf.length });
    }
  });
  calls.sort((a, b) => Number(/model|student|teacher|predict|network|forward/i.test(b.symbol)) - Number(/model|student|teacher|predict|network|forward/i.test(a.symbol)));
  const selected = calls.slice(0, 10), definitions = [], resolved = new Set(), locations = new Set();
  let finished = false, budget = 18000, timer;
  const inside = (file, root) => { const relative = path.relative(root, file); return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
  const work = Promise.allSettled(selected.map(async call => {
    const uri = api.Uri.parse(snapshot.uri), position = new api.Position(call.line, call.character);
    const answers = await Promise.allSettled(['vscode.executeDefinitionProvider', 'vscode.executeTypeDefinitionProvider'].map(command => api.commands.executeCommand(command, uri, position)));
    for (const answer of answers) {
      if (answer.status !== 'fulfilled' || !Array.isArray(answer.value)) continue;
      for (const target of answer.value.slice(0, 2)) {
        if (finished || budget <= 0) return;
        const uri = target.targetUri || target.uri, range = target.targetRange || target.range;
        if (uri?.scheme !== 'file' || !range || /(?:^|[/\\])(?:node_modules|\.venv|venv|vendor|\.git)(?:[/\\]|$)/.test(uri.fsPath)) continue;
        const folder = api.workspace.getWorkspaceFolder(uri);
        if (!folder) continue;
        const [file, root] = await Promise.all([fs.realpath(uri.fsPath), fs.realpath(folder.uri.fsPath)]);
        if (!inside(file, root) || (await fs.stat(file)).size > 500000) continue;
        // A definition already in the main input needs no duplicate snippet.
        if (uri.toString() === snapshot.uri && range.start.line >= snapshot.startLine - 1 && range.end.line < snapshot.endLine) { resolved.add(call.symbol); continue; }
        const key = uri.toString() + ':' + range.start.line;
        if (locations.has(key)) { resolved.add(call.symbol); continue; }
        const doc = await api.workspace.openTextDocument(uri), fullText = doc.getText(), lines = fullText.split(/\r?\n/);
        let start = range.start.line, end = Math.min(lines.length, start + 70);
        // For callable Python models, the type points to the class. Include its
        // forward/__call__ body even when initialization is longer than 70 lines.
        const chunks = [{ start, end }];
        if (/^\s*class\s/.test(lines[start]) && doc.languageId === 'python') {
          const indent = lines[start].match(/^\s*/)[0].length;
          let classEnd = start + 1;
          while (classEnd < lines.length && (!lines[classEnd].trim() || lines[classEnd].match(/^\s*/)[0].length > indent || /^\s*#/.test(lines[classEnd]))) classEnd++;
          chunks[0].end = Math.min(end, classEnd);
          const forward = lines.findIndex((line, i) => i > start && i < classEnd && /^\s*(?:async\s+)?def\s+(?:forward|__call__)\s*\(/.test(line));
          if (forward >= end) chunks.push({ start: forward, end: Math.min(classEnd, forward + 70) });
        }
        const text = chunks.map(chunk => lines.slice(chunk.start, chunk.end).map((line, i) => `${chunk.start + i + 1}: ${line}`).join('\n').slice(0, chunks.length > 1 ? 2100 : 4400)).join('\n... omitted intervening lines ...\n');
        if (finished || budget < text.length) return;
        locations.add(key); resolved.add(call.symbol); budget -= text.length;
        definitions.push({ symbol: call.symbol, file: api.workspace.asRelativePath(uri), uri: uri.toString(), startLine: start + 1, text, fullHash: hash(fullText) });
      }
    }
  }));
  await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, timeout); })]);
  clearTimeout(timer); finished = true;
  definitions.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  const callContext = { definitions: [...definitions], unresolved: selected.filter(call => !resolved.has(call.symbol)).map(call => call.symbol), bounded: calls.length > selected.length || budget < 4500 };
  return { ...snapshot, callContext };
}

// Hover text is escaped; only Yamori's own two commands may run from its links.
function hoverMarkdown(info, api = vscode) {
  const md = new api.MarkdownString();
  md.isTrusted = { enabledCommands: ['yamori.openAt', 'yamori.showSource'] };
  const link = (label, command, uri, line) => '[' + label + '](command:' + command + '?' + encodeURIComponent(JSON.stringify([uri, line])) + ')';
  md.appendMarkdown('**'); md.appendText(info.word); md.appendMarkdown('** · Yamori\n\n');
  if (info.term) {
    md.appendText(info.term.meaning); md.appendMarkdown('\n\n');
    md.appendText('Defined in ' + info.term.file + ':' + info.term.line + (info.term.outdated ? ' (note may be outdated)' : ''));
    md.appendMarkdown(' · ' + link('Show definition', 'yamori.showSource', info.term.uri, info.term.line) + '\n\n');
  }
  for (const def of info.definitions) {
    md.appendText(def.kind + ' in ' + def.file + ':' + def.line + (def.block ? ' · explained in "' + def.block + '"' : '')); md.appendMarkdown('\n\n');
    if (def.purpose) { md.appendText(def.purpose); md.appendMarkdown('\n\n'); }
    md.appendMarkdown(link(def.block ? 'Open in Yamori' : 'Explain in Yamori', 'yamori.openAt', def.uri, def.line) + ' · ' + link('Go to definition', 'yamori.showSource', def.uri, def.line) + '\n\n');
  }
  return md;
}

// The quick-job model for a provider: AI notes, Overview and block picking.
function quickModel(provider, cliPath, api = vscode) {
  return fastModel(provider, cliPath, setting(api, 'fastModel', 'auto')).catch(() => undefined);
}
// Reviewers and the review rewrite: a cheaper model than the writer (setting).
function reviewerFor(opts, api = vscode) {
  return reviewModel(opts.provider, opts.cliPath, opts.model, setting(api, 'reviewModel', 'auto')).catch(() => undefined);
}
// How many requests write one explanation at once, and the parts they write:
// whole top-level definitions found locally with tree-sitter, no AI.
function parallelRequests(api = vscode) {
  const value = Number(setting(api, 'parallelRequests', 6));
  return Number.isInteger(value) ? Math.max(1, Math.min(8, value)) : 6;
}
let partIndexer;
const EXTENSIONS = { python: '.py', javascript: '.js', javascriptreact: '.jsx', typescript: '.ts', typescriptreact: '.tsx', go: '.go', java: '.java', rust: '.rs' };
async function partsFor(snapshot, parallel) {
  if (parallel < 2 || !snapshot?.text) return undefined;
  const ext = path.extname(snapshot.name || '') || EXTENSIONS[snapshot.language] || '';
  if (!project.GRAMMAR_FOR[ext.toLowerCase()]) return undefined;
  try {
    partIndexer ||= new project.Indexer();
    const record = await partIndexer.extract('part' + ext.toLowerCase(), snapshot.text);
    return project.planParts(record.defs, snapshot.text, snapshot.startLine || 1, { maxParts: parallel });
  } catch { return undefined; }
}

// The provider, model and effort the reader would use for its next request.
function connectionOptions(globalState, provider, api = vscode) {
  const choice = globalState.get(provider + 'Model');
  const model = typeof choice?.id === 'string' ? choice.id : '';
  const override = globalState.get('effortChoices', {})[provider + ':' + model];
  // Without a choice, both providers think at low effort. On a dense 162-line
  // file Opus started writing after 2 s at low, against 77 s at medium.
  const effort = override === 'auto' ? null : typeof override === 'string' ? override : model ? choice.effort ?? null : 'low';
  return { provider, model, effort, cliPath: setting(api, provider === 'claude' ? 'claudePath' : 'codexPath') };
}

// Project map: one local graph (plus optional AI notes and moved node
// positions) per mapped folder. The scan reads files but never runs them and
// never asks a language service, so it also works in Restricted Mode.
function createProjectMap(context, { openFile, openSetup, api = vscode, indexer = new project.Indexer() } = {}) {
  const cache = new LocalCache(path.join(context.globalStorageUri.fsPath, 'cache'));
  const maps = new Map(), listeners = new Set();
  // Readers, hovers and CodeLens refresh when a map, its notes or an explanation change.
  const changed = () => { for (const listener of listeners) { try { listener(); } catch { /* One listener cannot block another. */ } } };
  const relative = (root, fsPath) => { const rel = path.relative(root, fsPath); return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? undefined : rel.split(path.sep).join('/'); };
  const fileUri = (entry, rel) => api.Uri.joinPath ? api.Uri.joinPath(entry.root, ...rel.split('/')) : api.Uri.file(path.join(entry.root.fsPath, ...rel.split('/')));
  async function entryFor(root) {
    const key = root.toString();
    if (!maps.has(key)) {
      const store = new project.ProjectStore(cache, key);
      maps.set(key, { key, root, store, loading: store.load().then(loaded => Object.assign(maps.get(key), loaded)), graph: undefined, notes: { files: {} }, layout: {}, explanations: {}, guideFolder: '' });
    }
    const entry = maps.get(key);
    await entry.loading;
    return entry;
  }
  // The deepest mapped folder containing a file, else its workspace folder.
  async function entryForFile(uri) {
    if (uri?.scheme !== 'file') return undefined;
    const mapped = [...maps.values()].filter(entry => relative(entry.root.fsPath, uri.fsPath)).sort((a, b) => b.root.fsPath.length - a.root.fsPath.length)[0];
    if (mapped) return mapped;
    const folder = api.workspace.getWorkspaceFolder?.(uri);
    return folder ? entryFor(folder.uri) : undefined;
  }
  function counts(entry) {
    const files = Object.entries(entry.graph?.files || {}).filter(([, file]) => !file.test);
    const notes = entry.notes.files || {};
    return { total: files.length, done: files.filter(([rel]) => notes[rel]).length, outdated: files.filter(([rel, file]) => notes[rel] && notes[rel].hash !== file.hash).length };
  }
  // Folded folders and moved boxes, remembered per mapped folder.
  function grouped(entry) {
    const saved = entry.layout.grouped || {};
    return { positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {}, collapsed: Array.isArray(saved.collapsed) ? saved.collapsed : project.defaultCollapsed(entry.graph) };
  }
  function groupKeys(entry) {
    const rels = Object.keys(entry.graph?.files || {}), depth = project.folderDepth(rels);
    return new Set(rels.map(rel => project.folderOf(rel, depth)));
  }
  async function saveGrouped(entry, change) {
    entry.layout = { ...entry.layout, grouped: { ...grouped(entry), ...change } };
    await entry.store.save('layout', entry.layout);
  }
  function whyStep(graph, step, folder) {
    if (step.why) return step.why;
    if (step.via) return 'Used by ' + step.via.split('/').at(-1) + (step.names?.length ? ' for ' + step.names.join(', ') : '') + '.';
    if (graph.files[step.id].entry) return 'Entry point: the program starts here.';
    if (step.usedOutside) return 'The way into this folder: used by ' + step.usedOutside + ' file' + (step.usedOutside === 1 ? '' : 's') + ' outside it.';
    return 'Starts a separate part of ' + (folder ? 'this folder.' : 'the project.');
  }
  function stateOf(entry) {
    const graph = entry.graph, notes = entry.notes;
    const base = { readingPalette: context.globalState.get('readingPalette', 'auto'), busy: !!entry.busy, notesBusy: !!entry.notesController, autoNotes: setting(api, 'autoNotes', true) !== false, waitingForAI: !!entry.waitingForAI, progress: entry.progress, error: entry.error, notes: counts(entry),
      ...(entry.focus ? { focus: entry.focus.id, focusToken: entry.focus.token } : {}), ...(entry.viewRequest ? { view: entry.viewRequest.view, viewToken: entry.viewRequest.token } : {}) };
    if (!graph) return { ...base, folders: [], guide: { folder: '', steps: [] }, map: { boxes: [], nodes: [], edges: [] }, files: 0, links: 0 };
    const known = new Set(Object.keys(graph.files));
    const aiOrder = (notes.readingPath || []).map(step => step.file).filter(file => known.has(file));
    const layout = grouped(entry);
    const map = project.layoutGrouped(graph, { collapsed: layout.collapsed, saved: layout.positions, order: aiOrder.length ? aiOrder : undefined });
    const folders = project.folderTree(graph);
    const folder = folders.some(item => item.key === entry.guideFolder) ? entry.guideFolder : '';
    const out = project.linksFor;
    const steps = project.readingPathFor(graph, notes, folder).slice(0, 80).map(step => {
      const links = out(graph, step.id, 4);
      return { id: step.id, why: whyStep(graph, step, folder), purpose: notes.files?.[step.id]?.purpose, uses: links.uses.map(link => link.file), usedBy: links.usedBy.map(link => link.file),
        terms: (notes.files?.[step.id]?.terms || []).slice(0, 8).map(term => ({ term: term.term, meaning: term.meaning, line: term.line })),
        explained: !!entry.explanations?.[step.id], entry: !!graph.files[step.id].entry };
    });
    const cards = {};
    for (const node of map.nodes) {
      if (node.kind !== 'file') continue;
      const file = graph.files[node.id], note = notes.files?.[node.id];
      cards[node.id] = { ...(note ? { purpose: note.purpose, role: note.role, terms: note.terms, ...(note.hash !== file.hash ? { outdated: true } : {}) } : {}), explained: !!entry.explanations?.[node.id],
        defs: file.defs.filter(def => ['class', 'function', 'interface', 'type', 'enum'].includes(def.kind)).slice(0, 10).map(def => def.name) };
    }
    const glossary = project.glossaryOf(graph, notes).map(term => ({ term: term.term, aliases: term.aliases, meaning: term.meaning, kind: term.kind, file: term.file, line: term.line }));
    return { ...base, folders, guide: { folder, steps }, map, overview: notes.overview, cards, glossary,
      files: known.size, links: graph.edges.length, scannedAt: graph.scannedAt, limited: !!graph.limited };
  }
  function post(entry) { entry.panel?.webview.postMessage({ type: 'map', state: stateOf(entry) }); }
  async function readSource(entry, rootReal, uri) {
    // A symlink must not pull files from outside the mapped folder, even when
    // the file is open with unsaved edits.
    const real = await fs.realpath(uri.fsPath);
    if (!relative(rootReal, real)) throw new Error('Outside the mapped folder.');
    const doc = api.workspace.textDocuments?.find(item => item.uri.toString() === uri.toString());
    if (doc?.isDirty) return doc.getText();
    if ((await fs.stat(real)).size > project.MAX_FILE_BYTES) throw new Error('Too large.');
    return fs.readFile(real, 'utf8');
  }
  async function scan(entry) {
    if (entry.scanning) { entry.rescan = true; return entry.scanning; }
    entry.busy = true; entry.progress = 'Scanning files…'; entry.error = ''; post(entry);
    entry.scanning = (async () => {
      try {
        const found = await api.workspace.findFiles(new api.RelativePattern(entry.root, INCLUDE), EXCLUDE, project.MAX_FILES + 1);
        const rootReal = await fs.realpath(entry.root.fsPath);
        const files = found.map(uri => ({ uri, rel: relative(entry.root.fsPath, uri.fsPath) })).filter(item => item.rel).sort((a, b) => a.rel.localeCompare(b.rel));
        const limited = files.length > project.MAX_FILES;
        const manifests = {};
        for (const uri of await api.workspace.findFiles(new api.RelativePattern(entry.root, '**/{package.json,go.mod,Cargo.toml}'), EXCLUDE, 50)) {
          const rel = relative(entry.root.fsPath, uri.fsPath);
          if (rel) try { manifests[rel] = await readSource(entry, rootReal, uri); } catch { /* Unreadable manifests add nothing. */ }
        }
        const scanned = await project.scanFiles(files.slice(0, project.MAX_FILES).map(item => ({ rel: item.rel, read: () => readSource(entry, rootReal, item.uri) })), entry.graph, indexer,
          { onProgress: ({ done, total }) => { entry.progress = `Scanning files ${done}/${total}…`; post(entry); } });
        entry.graph = { ...project.buildGraph(scanned.records, manifests), scannedAt: Date.now(), limited, root: entry.key };
        try { await entry.store.save('graph', entry.graph); } catch (e) { entry.error = 'The project map could not be saved locally: ' + e.message; }
      } catch (e) { entry.error = 'Project scan failed: ' + e.message; }
      finally { entry.busy = false; entry.progress = undefined; entry.scanning = undefined; post(entry); changed(); if (!entry.error) scheduleAutoNotes(entry); }
      if (entry.rescan) { entry.rescan = false; await scan(entry); }
    })();
    return entry.scanning;
  }
  function watch(entry) {
    if (entry.watchers || !api.workspace.createFileSystemWatcher || !api.RelativePattern) return;
    const watcher = api.workspace.createFileSystemWatcher(new api.RelativePattern(entry.root, INCLUDE));
    const queue = () => { clearTimeout(entry.timer); entry.timer = setTimeout(() => { if (entry.panel) void scan(entry); }, 1200); };
    entry.watchers = [watcher, watcher.onDidCreate(queue), watcher.onDidDelete(queue), watcher.onDidChange(queue)];
    entry.queue = queue;
  }
  function unwatch(entry) { clearTimeout(entry.timer); clearTimeout(entry.notesTimer); entry.watchers?.forEach(item => item.dispose()); entry.watchers = undefined; }
  // AI notes run on their own after each scan and whenever a mapped file is
  // opened, or from the button. Like explanations they are tool-free requests
  // that never run project code, so Restricted Mode writes them too. Auto runs
  // stay quiet, wait for a ready AI instead of failing, and ask first only for
  // big projects.
  const AUTO_NOTES_LIMIT = 120;
  function scheduleAutoNotes(entry) {
    if (setting(api, 'autoNotes', true) === false || entry.autoFailed || entry.autoDeclined || !entry.graph) return;
    clearTimeout(entry.notesTimer);
    entry.notesTimer = setTimeout(() => { if (!entry.notesController) void runNotes(entry, { auto: true }).catch(() => {}); }, 1500);
  }
  async function runNotes(entry, { auto = false } = {}) {
    if (entry.notesController) return;
    if (!auto) { entry.autoFailed = false; entry.autoDeclined = false; }
    if (!entry.graph) { if (auto) return; await scan(entry); }
    const graph = entry.graph; if (!graph) return;
    const chosen = context.globalState.get('provider');
    const status = PROVIDERS[chosen] ? await providerStatus(chosen, cliPathFor(api, chosen)).catch(() => undefined) : undefined;
    if (!status?.ready) {
      entry.waitingForAI = true; entry.error = ''; post(entry);
      if (!auto) openSetup?.({ focus: chosen, pending: { label: 'write AI notes for ' + path.basename(entry.root.fsPath), run: () => runNotes(entry) } });
      return;
    }
    entry.waitingForAI = false;
    const provider = chosen;
    const main = connectionOptions(context.globalState, provider, api);
    const connection = { ...main, ...(await quickModel(provider, main.cliPath, api) || {}) };
    const rootReal = await fs.realpath(entry.root.fsPath);
    const order = new Map(graph.readingPath.map((step, index) => [step.id, index]));
    const pending = Object.entries(graph.files).filter(([rel, file]) => !file.test && entry.notes.files[rel]?.hash !== file.hash)
      .sort(([a, fa], [b, fb]) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6) || fb.rank - fa.rank || a.localeCompare(b));
    const items = [];
    for (const [rel, file] of pending) {
      try {
        const text = await readSource(entry, rootReal, fileUri(entry, rel));
        const links = project.linksFor(graph, rel, 4);
        items.push({ rel, text, record: file, language: file.language, hash: hash(text), links: { uses: links.uses.map(link => link.file), usedBy: links.usedBy.map(link => link.file) } });
      } catch { /* Unreadable files keep their previous note. */ }
    }
    // Automatic runs refresh the project summary only when files are new to it.
    const needsSummary = auto ? !entry.notes.summaryAt || items.some(item => !entry.notes.files[item.rel]) : !!items.length || !entry.notes.summaryAt;
    if (!items.length && !needsSummary) { if (!auto) api.window.showInformationMessage('Yamori: AI notes are up to date.'); return; }
    const batches = project.noteBatches(items), requests = batches.length + (needsSummary ? 1 : 0);
    const label = PROVIDERS[provider] + (connection.model ? ' · ' + connection.model : '') + (connection.effort ? ' · ' + connection.effort + ' effort' : '');
    if (!auto || items.length > AUTO_NOTES_LIMIT) {
      if (auto) entry.autoAsked = true;
      const action = auto ? 'Write notes' : 'Add notes';
      const choice = await api.window.showWarningMessage(`${auto ? 'This project has ' + items.length + ' files without AI notes. Write' : 'Add'} AI notes for ${items.length} file${items.length === 1 ? '' : 's'} with ${label}? This sends their source text to the provider and uses about ${requests} model request${requests === 1 ? '' : 's'}. Tools stay disabled.`, { modal: true }, action);
      if (choice !== action) { if (auto) { entry.autoDeclined = true; entry.error = 'AI notes are paused for this large project. Press Write AI notes when you want them.'; post(entry); } return; }
    }
    const controller = new AbortController();
    entry.notesController = controller; entry.error = ''; post(entry);
    let changed = false, failure;
    const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* ignored */ } } };
    const run = async (progress, token) => {
      token?.onCancellationRequested?.(() => controller.abort());
      // Three batches at a time; each finished batch is saved at once.
      let next = 0, done = 0;
      entry.progress = `Writing AI notes 0/${batches.length}…`; post(entry);
      const worker = async () => {
        while (next < batches.length && !controller.signal.aborted) {
          const batch = batches[next++];
          const response = await requestStructured({ ...connection, prompt: notesPrompt(batch), schema: NOTES_SCHEMA, signal: controller.signal, showPreview: false });
          if (controller.signal.aborted) throw new Error('Cancelled.');
          Object.assign(entry.notes.files, parseNotes(response.raw, batch)); changed = true; done++;
          entry.progress = `Writing AI notes ${done}/${batches.length}…`; progress?.report?.({ message: entry.progress, increment: 100 / requests }); notify();
          await entry.store.save('notes', entry.notes); post(entry);
        }
      };
      // A failed batch stops its siblings; that is a failure, not the user's Stop.
      try { await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker)); }
      catch (error) { failure ||= error; controller.abort(); throw failure; }
      if (needsSummary) {
        entry.progress = 'Writing the project guide…'; post(entry); progress?.report?.({ message: entry.progress, increment: 100 / requests });
        const files = Object.entries(graph.files).filter(([, file]) => !file.test).sort((a, b) => b[1].rank - a[1].rank).slice(0, 300).map(([rel, file]) => {
          const note = entry.notes.files[rel], links = project.linksFor(graph, rel, 5);
          return { file: rel, ...(note ? { purpose: note.purpose, role: note.role } : {}), ...(file.entry ? { entry: true } : {}), rank: Math.round(file.rank * 1000) / 1000, uses: links.uses.map(link => link.file), usedBy: links.usedBy.map(link => link.file) };
        });
        const response = await requestStructured({ ...connection, prompt: mapSummaryPrompt({ files, entries: graph.entries, suggestedPath: graph.readingPath.map(step => step.id) }), schema: MAP_SUMMARY_SCHEMA, signal: controller.signal, showPreview: false });
        if (controller.signal.aborted) throw new Error('Cancelled.');
        Object.assign(entry.notes, parseMapSummary(response.raw, Object.keys(graph.files)), { summaryAt: Date.now(), model: response.actualModel || connection.model || undefined });
        await entry.store.save('notes', entry.notes); changed = true; notify();
      }
    };
    try {
      // Automatic notes show a quiet status-bar spinner; the guide has Stop.
      if (api.window.withProgress && api.ProgressLocation) await api.window.withProgress(auto ? { location: api.ProgressLocation.Window, title: 'Yamori: writing AI notes' } : { location: api.ProgressLocation.Notification, title: 'Yamori · AI notes', cancellable: true }, run);
      else await run();
    } catch (e) {
      const stopped = controller.signal.aborted && !failure;
      // A sign-in problem waits for Set up AI instead of needing the button.
      if (auto && !stopped && isSetupProblem(e.message)) { clearProviderStatus(); entry.waitingForAI = true; entry.error = ''; return; }
      if (auto && !stopped) entry.autoFailed = true;
      entry.error = stopped ? 'AI notes stopped. Notes written so far are saved.' : (auto ? 'AI notes could not be written automatically: ' : 'AI notes failed: ') + e.message + (changed ? ' Notes written so far are saved.' : '') + (auto ? ' Press Write AI notes to retry.' : '');
    } finally { entry.notesController = undefined; entry.progress = undefined; post(entry); }
  }
  function ensurePanel(entry) {
    if (entry.panel) { entry.panel.reveal(entry.panel.viewColumn); return; }
    const panel = api.window.createWebviewPanel('yamoriMap', 'Project map · ' + path.basename(entry.root.fsPath), { viewColumn: api.ViewColumn.Active ?? api.ViewColumn.One, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    if (context.extensionUri && api.Uri.joinPath) panel.iconPath = api.Uri.joinPath(context.extensionUri, 'yamori.png');
    panel.webview.html = mapHTML(context.globalState.get('readingPalette', 'auto'));
    entry.panel = panel; watch(entry);
    panel.onDidDispose(() => { entry.panel = undefined; unwatch(entry); entry.notesController?.abort(); });
    panel.webview.onDidReceiveMessage(async message => {
      try { await receive(entry, message); } catch (e) { entry.error = e.message; post(entry); }
    });
  }
  async function receive(entry, message) {
    if (!message || typeof message.type !== 'string') return;
    const file = typeof message.id === 'string' && entry.graph?.files[message.id] ? message.id : undefined;
    switch (message.type) {
      case 'ready': post(entry); break;
      case 'openFile': {
        // Start here opens files as a tour of the chosen folder.
        const tour = typeof message.tour === 'string' && (message.tour === '' || project.folderTree(entry.graph).some(item => item.key === message.tour)) ? message.tour : undefined;
        if (file) await openFile(fileUri(entry, file), tour === undefined ? {} : { tour });
        break;
      }
      case 'revealSource': if (file) await reveal(entry, file, message.line); break;
      case 'rescan': await scan(entry); break;
      case 'notes': await runNotes(entry); break;
      case 'setup': openSetup?.({ focus: context.globalState.get('provider'), pending: { label: 'write AI notes for ' + path.basename(entry.root.fsPath), run: () => runNotes(entry) } }); break;
      case 'stop': entry.notesController?.abort(); break;
      case 'guideFolder':
        if (typeof message.folder === 'string' && entry.graph && project.folderTree(entry.graph).some(item => item.key === message.folder)) { entry.guideFolder = message.folder; post(entry); }
        break;
      case 'toggleFolder': {
        if (typeof message.folder !== 'string' || !groupKeys(entry).has(message.folder)) break;
        const collapsed = new Set(grouped(entry).collapsed);
        collapsed.has(message.folder) ? collapsed.delete(message.folder) : collapsed.add(message.folder);
        await saveGrouped(entry, { collapsed: [...collapsed] }); post(entry); break;
      }
      case 'foldAll': if (entry.graph) { await saveGrouped(entry, { collapsed: message.collapsed ? [...groupKeys(entry)] : [] }); post(entry); } break;
      case 'focusMap': {
        if (!file) break;
        const rels = Object.keys(entry.graph.files), key = project.folderOf(file, project.folderDepth(rels));
        const collapsed = grouped(entry).collapsed.filter(item => item !== key);
        await saveGrouped(entry, { collapsed });
        entry.focus = { id: file, token: Date.now() }; entry.viewRequest = { view: 'map', token: Date.now() }; post(entry); break;
      }
      case 'saveLayout': {
        if (typeof message.id !== 'string' || !message.id.startsWith('folder:') || !groupKeys(entry).has(message.id.slice(7)) || !Number.isFinite(message.x) || !Number.isFinite(message.y)) break;
        await saveGrouped(entry, { positions: { ...grouped(entry).positions, [message.id]: { x: Math.round(message.x), y: Math.round(message.y) } } }); break;
      }
      case 'resetLayout': await saveGrouped(entry, { positions: {} }); post(entry); break;
    }
  }
  async function reveal(entry, rel, line, viewColumn) {
    const doc = await api.workspace.openTextDocument(fileUri(entry, rel));
    const target = Number.isInteger(line) ? Math.max(0, Math.min(doc.lineCount - 1, line - 1)) : 0;
    const range = new api.Range(target, 0, target, 0);
    await api.window.showTextDocument(doc, { viewColumn: viewColumn ?? api.ViewColumn.Beside, preserveFocus: false, preview: true, selection: range });
  }
  return {
    async show(folderUri, focusUri) {
      const root = folderUri || (focusUri && api.workspace.getWorkspaceFolder?.(focusUri)?.uri) || api.workspace.workspaceFolders?.[0]?.uri;
      if (!root) throw new Error('Open a folder or workspace to map its project.');
      const entry = focusUri ? await entryForFile(focusUri) || await entryFor(root) : await entryFor(root);
      // Opened from a file: start in that file's folder with the file highlighted.
      // The webview applies each token once, even if it loads after this post.
      const rel = focusUri && relative(entry.root.fsPath, focusUri.fsPath);
      if (rel) {
        const parts = rel.split('/').slice(0, -1);
        entry.guideFolder = parts.slice(0, 4).join('/');
        entry.focus = { id: rel, token: Date.now() };
      }
      entry.viewRequest = { view: 'start', token: Date.now() };
      ensurePanel(entry); post(entry);
      await scan(entry);
      return entry;
    },
    // A bounded slice of the stored map for one explanation; undefined until a
    // folder has been mapped, so explanations never trigger a scan.
    async contextFor(snapshot) {
      if (!snapshot?.uri?.startsWith('file:')) return undefined;
      const uri = api.Uri.parse(snapshot.uri), entry = await entryForFile(uri);
      if (!entry?.graph) return undefined;
      const rel = relative(entry.root.fsPath, uri.fsPath);
      return rel ? project.projectContextFor(entry.graph, entry.notes, rel, snapshot.text, entry.explanations) : undefined;
    },
    // How the CLI starts Yamori's read-only knowledge server for one request.
    // Off in Restricted Mode, when disabled, or before the folder is mapped.
    async toolsFor(snapshot) {
      if (api.workspace.isTrusted === false || setting(api, 'agentTools', true) === false || !snapshot?.uri?.startsWith('file:')) return undefined;
      const entry = await entryForFile(api.Uri.parse(snapshot.uri));
      if (!entry?.graph) return undefined;
      return { command: process.execPath, args: [path.join(__dirname, 'mcp.js'), '--store', entry.store.dir, '--root', entry.root.fsPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
    },
    async recordExplanation(snapshot, level, value) {
      if (!snapshot?.uri?.startsWith('file:') || snapshot.selected || !Array.isArray(value?.sections) || !LEVELS[level]) return;
      const uri = api.Uri.parse(snapshot.uri), entry = await entryForFile(uri);
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      if (!rel || !entry.graph.files[rel]) return;
      const pack = view => ({ title: view.title, summary: view.summary, sections: view.sections.map(({ title, startLine, endLine, pseudocode }) => ({ title, startLine, endLine, pseudocode })), hash: snapshot.fullHash, savedAt: Date.now() });
      const saved = { ...(entry.explanations[rel] || {}), [level]: pack(value) };
      for (const [name, view] of Object.entries(value.views || {})) if (LEVELS[name] && name !== level) saved[name] = pack(view);
      entry.explanations = { ...entry.explanations, [rel]: saved };
      await entry.store.save('explanations', entry.explanations);
      if (entry.panel) post(entry);
      changed();
    },
    // Facts for file pickers: the AI-note purpose and whether Yamori explained it.
    async fileFacts(uri) {
      const entry = await entryForFile(uri), rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      if (!rel) return {};
      return { purpose: entry.notes.files?.[rel]?.purpose, explained: !!entry.explanations?.[rel] };
    },
    async revealDefinition(sourceUri, defined, viewColumn) {
      const match = typeof defined === 'string' && defined.match(/^(.*):(\d+)$/);
      const entry = match && await entryForFile(api.Uri.parse(sourceUri));
      if (!entry?.graph?.files[match[1]]) return;
      await reveal(entry, match[1], Number(match[2]), viewColumn);
    },
    onChange(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    // Unit tests that exercise each block's functions, from the map. No AI.
    async testsForBlocks(uri, sections) {
      const entry = uri?.scheme === 'file' ? await entryForFile(uri) : undefined;
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      if (!rel || !Array.isArray(sections)) return {};
      const found = {};
      sections.forEach((section, index) => { const tests = project.testsFor(entry.graph, rel, section.startLine, section.endLine); if (tests.length) found[index] = tests; });
      return found;
    },
    // The files, lines and source text one test run needs, read through the map.
    async testRunInfo(uri, test) {
      const entry = uri?.scheme === 'file' ? await entryForFile(uri) : undefined;
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath), testFile = entry?.graph?.files[test?.file];
      if (!rel || !testFile?.test || !testFile.tests?.some(item => item.name === test.name)) return undefined;
      const rootReal = await fs.realpath(entry.root.fsPath), testUri = fileUri(entry, test.file);
      const [sourceText, testText] = await Promise.all([readSource(entry, rootReal, uri), readSource(entry, rootReal, testUri)]);
      // Tests run from their own project folder, as `pytest` would there.
      let projectRoot = entry.root.fsPath;
      for (let dir = path.dirname(testUri.fsPath); relative(entry.root.fsPath, dir) !== undefined || dir === entry.root.fsPath; dir = path.dirname(dir)) {
        const found = await Promise.all(['pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini', 'tox.ini'].map(name => fs.stat(path.join(dir, name)).then(() => true, () => false)));
        if (found.some(Boolean)) { projectRoot = dir; break; }
        if (dir === entry.root.fsPath) break;
      }
      return { root: projectRoot, workspaceRoot: entry.root.fsPath, testFile: testUri.fsPath, testName: test.name, target: { file: uri.fsPath, function: test.function, line: test.functionLine, end: test.functionEnd },
        functionText: sourceText.split('\n').slice(test.functionLine - 1, test.functionEnd).join('\n'), testText: testText.split('\n').slice(test.line - 1, test.end).join('\n') };
    },
    // Where a file sits in a reading order, with its neighbours, for the tour bar.
    async tourFor(uri, folder) {
      const entry = uri?.scheme === 'file' ? await entryForFile(uri) : undefined;
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      const step = rel && project.tourStep(entry.graph, entry.notes, rel, folder);
      if (!step) return undefined;
      const links = project.linksFor(entry.graph, rel, 4);
      const item = id => id ? { id, label: id.split('/').at(-1), uri: fileUri(entry, id).toString(), explained: !!entry.explanations?.[id] } : undefined;
      return { folder: step.folder, label: step.folder ? step.folder + '/' : 'whole project', index: step.index, total: step.steps.length,
        prev: item(step.steps[step.index - 1]), next: item(step.steps[step.index + 1]), uses: links.uses.map(link => item(link.file)), usedBy: links.usedBy.map(link => item(link.file)) };
    },
    // Project names an explanation of this file can link to.
    async symbolsFor(snapshot) {
      if (!snapshot?.uri?.startsWith('file:')) return [];
      const uri = api.Uri.parse(snapshot.uri), entry = await entryForFile(uri);
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      return rel ? project.symbolLinks(entry.graph, rel, entry.explanations, entry.notes).map(link => ({ ...link, uri: fileUri(entry, link.file).toString() })) : [];
    },
    // Editor hover: a project term or definition Yamori knows. No AI.
    async hoverInfo(uri, word) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word || '') || word.length < 2) return undefined;
      const entry = uri?.scheme === 'file' ? await entryForFile(uri) : undefined;
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      if (!rel || !entry.graph.files[rel]) return undefined;
      const graph = entry.graph, uses = new Set(graph.edges.filter(edge => edge.from === rel).map(edge => edge.to));
      const term = project.glossaryOf(graph, entry.notes).find(item => item.meaning && (item.term === word || item.aliases?.includes(word)));
      const definitions = [];
      // Only this file and files it uses: a local variable elsewhere is not this name.
      for (const file of [rel, ...uses]) for (const def of graph.files[file]?.defs || []) if (def.name === word && !graph.files[file].test) definitions.push({ file, line: def.line, kind: def.kind });
      const shown = definitions.slice(0, 3).map(def => {
        const block = project.blockAt(entry.explanations, def.file, def.line), purpose = entry.notes.files?.[def.file]?.purpose;
        return { ...def, uri: fileUri(entry, def.file).toString(), ...(block ? { block: block.title } : {}), ...(purpose ? { purpose } : {}) };
      });
      if (!term && !shown.length) return undefined;
      return { word, ...(term ? { term: { meaning: term.meaning, file: term.file, line: term.line, uri: fileUri(entry, term.file).toString(), ...(term.outdated ? { outdated: true } : {}) } } : {}), definitions: shown };
    },
    // CodeLens: Yamori's block titles above the code they explain, while the
    // explanation still matches the text; otherwise one "Explain" lens.
    async lensesFor(uri, text) {
      if (setting(api, 'codeLens', true) === false) return [];
      const entry = uri?.scheme === 'file' ? await entryForFile(uri) : undefined;
      const rel = entry?.graph && relative(entry.root.fsPath, uri.fsPath);
      if (!rel || !entry.graph.files[rel] || entry.graph.files[rel].test) return [];
      const saved = entry.explanations?.[rel], view = saved?.logic || saved?.overview;
      if (view && view.hash === hash(text)) return view.sections.map(section => ({ line: section.startLine, title: 'Yamori · ' + section.title }));
      const step = project.tourStep(entry.graph, entry.notes, rel);
      const where = step && step.steps.length > 1 ? 'Step ' + (step.index + 1) + ' of ' + step.steps.length + ' in ' + (step.folder ? step.folder + '/' : 'the project') + ' · ' : '';
      return [{ line: 1, title: view ? 'Yamori · The code changed since its explanation · Open' : 'Yamori · ' + where + 'Explain this file' }];
    },
    saved(uri) { for (const entry of maps.values()) if (entry.panel && entry.queue && uri?.scheme === 'file' && relative(entry.root.fsPath, uri.fsPath)) entry.queue(); },
    // Called before the cache folder is removed: stop work and drop state.
    async clear() {
      for (const entry of maps.values()) entry.notesController?.abort();
      await Promise.all([...maps.values()].map(entry => entry.scanning).filter(Boolean));
      await cache.flush();
      for (const entry of maps.values()) Object.assign(entry, { graph: undefined, notes: { files: {} }, layout: {}, explanations: {}, guideFolder: '', focus: undefined });
      changed();
    },
    rescanOpen() { for (const entry of maps.values()) if (entry.panel) void scan(entry); },
    // An AI just became ready: maps that were waiting for one write their notes.
    aiReady() {
      for (const entry of maps.values()) {
        if (!entry.graph || !(entry.waitingForAI || entry.autoFailed)) continue;
        entry.waitingForAI = false; entry.autoFailed = false; entry.error = ''; post(entry); scheduleAutoNotes(entry);
      }
    },
    // Opening a file of a mapped project fills in its missing notes.
    async noteFile(uri) {
      if (uri?.scheme !== 'file') return;
      const entry = await entryForFile(uri).catch(() => undefined);
      if (entry?.graph) scheduleAutoNotes(entry);
    },
    dispose() { for (const entry of maps.values()) { entry.notesController?.abort(); unwatch(entry); entry.panel?.dispose?.(); } maps.clear(); }
  };
}

async function migratePreferences(context) {
  const file = path.join(context.globalStorageUri.fsPath, 'migration.json');
  let saved;
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return; }
  if (LEVELS[saved.detail] && context.globalState.get('detail') === undefined) await context.globalState.update('detail', saved.detail);
  if (PROVIDERS[saved.provider] && context.globalState.get('provider') === undefined) await context.globalState.update('provider', saved.provider);
  await fs.unlink(file);
}

// ---- Setup: which AI explains code, and one button to make it ready ----
const OWNERS = ['claude', 'codex'];
const AI_NAMES = { claude: 'Claude', codex: 'ChatGPT' };
function cliPathFor(api, owner) { return setting(api, owner === 'claude' ? 'claudePath' : 'codexPath'); }
// The terminal behind Sign in / Install. Commands are fixed here; the webview
// only names the provider. A failed install waits so its messages stay visible.
function setupTerminal(context, api, owner, kind, binary, system = {}) {
  const windows = (system.platform || process.platform) === 'win32', env = system.env || process.env, home = system.home || os.homedir();
  const powershell = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const pause = ' || { echo; echo "Yamori: setup did not finish. Read the messages above, then close this terminal."; read -r _; }';
  let options;
  if (kind === 'signIn' && binary) {
    const launch = cliLaunch(binary, owner === 'claude' ? ['auth', 'login'] : ['login']);
    options = { name: owner === 'claude' ? 'Yamori · Claude sign-in' : 'Yamori · ChatGPT sign-in', shellPath: launch.command, shellArgs: launch.args, env: launch.env, cwd: home };
  } else if (owner === 'claude') {
    options = windows ? {
      name: 'Yamori · Install Claude Code', cwd: home, shellPath: powershell,
      shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; irm https://claude.ai/install.ps1 | iex; $claudeExe = Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"; if (Test-Path -LiteralPath $claudeExe) { & $claudeExe auth login } else { Write-Error "Claude Code installation did not finish. See the installer output above." }']
    } : {
      name: 'Yamori · Install Claude Code', cwd: home, shellPath: '/bin/bash',
      shellArgs: ['-lc', 'set -o pipefail; { curl -fsSL https://claude.ai/install.sh | /bin/bash && "$HOME/.local/bin/claude" auth login; }' + pause]
    };
  } else {
    // Codex: npm when Node.js is installed, otherwise Homebrew. The user's own
    // shell (login + interactive) sees the same PATH as their terminal.
    const shell = /[\\/](?:zsh|bash)$/.test(env.SHELL || '') ? env.SHELL : '/bin/bash';
    options = windows ? {
      name: 'Yamori · Install Codex', cwd: home, shellPath: powershell,
      shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; if (Get-Command npm -ErrorAction SilentlyContinue) { npm install -g @openai/codex; codex login } else { Write-Error "Codex needs Node.js. Install it from https://nodejs.org, then press Install Codex again." }']
    } : {
      name: 'Yamori · Install Codex', cwd: home, shellPath: shell,
      shellArgs: ['-ilc', '{ if command -v npm >/dev/null 2>&1; then npm install -g @openai/codex; elif command -v brew >/dev/null 2>&1; then brew install --cask codex; else echo "Yamori: Codex needs Node.js (https://nodejs.org) or Homebrew (https://brew.sh). Install one, then press Install Codex again."; false; fi && hash -r && codex login; }' + pause]
    };
  }
  const terminal = api.window.createTerminal(options);
  context.subscriptions?.push(terminal); terminal.show();
  return terminal;
}
// Cards for the setup screen, most ready first. Pure, so tests can read it.
function setupView(statuses, { chosen, working = {}, pending, done } = {}) {
  const card = owner => {
    const s = statuses[owner] || {}, name = AI_NAMES[owner], cli = owner === 'claude' ? 'Claude Code' : 'Codex';
    const lines = [s.installed
      ? { state: 'yes', text: cli + ' installed' + (s.source && s.source !== 'Command line' ? ' · from ' + s.source : '') }
      : { state: 'no', text: cli + ' not installed' }];
    if (s.installed) lines.push(s.signedIn === true ? { state: 'yes', text: 'Signed in' + (s.account ? ' · ' + s.account : '') }
      : s.signedIn === false ? { state: 'no', text: s.problem || 'Not signed in' } : { state: 'unknown', text: 'Sign-in not confirmed; Yamori will try it' });
    let action;
    if (working[owner]) action = { label: 'Show the ' + (working[owner] === 'install' ? 'install' : 'sign-in') + ' terminal', hint: 'Finish there (and in your browser). This page updates when you come back.' };
    else if (s.ready) action = { label: 'Use ' + name, hint: 'Explanations use your ' + name + ' plan. Yamori never asks for an API key.' };
    else if (s.installed) action = { label: owner === 'claude' ? 'Sign in to Claude' : 'Sign in with ChatGPT', hint: 'Opens a terminal and your browser. Sign in there; this page updates when you come back.' };
    else action = { label: 'Install ' + cli, hint: owner === 'claude' ? 'Runs Anthropic’s official installer in a terminal, then opens sign-in. About a minute.' : 'Installs OpenAI’s Codex CLI in a terminal (with npm or Homebrew), then opens sign-in.' };
    const alt = s.installed && s.signedIn !== false && !working[owner] ? { label: s.signedIn === true ? 'Use a different account' : 'Sign in' } : undefined;
    return { id: owner, name, product: cli + ' · uses your ' + name + ' plan', lines, action, alt, ready: !!s.ready, badge: s.ready ? (chosen === owner ? 'In use' : 'Ready') : '' };
  };
  const rank = owner => (statuses[owner]?.ready ? 0 : statuses[owner]?.installed ? 2 : 4) + (owner === chosen ? 0 : 1);
  const cards = [...OWNERS].sort((a, b) => rank(a) - rank(b)).map(card);
  const other = OWNERS.find(owner => owner !== chosen);
  const notice = PROVIDERS[chosen] && statuses[chosen] && !statuses[chosen].ready && statuses[other]?.ready ? `${AI_NAMES[chosen]} isn’t ready (${statuses[chosen].problem || 'not set up'}). ${AI_NAMES[other]} is ready to use instead.`
    : OWNERS.every(owner => statuses[owner] && !statuses[owner].installed) ? 'Neither is on this computer yet. Pick the one whose plan you have; the install runs in a terminal you can watch.' : '';
  const view = { title: 'Set up Yamori', lead: 'Yamori explains code with an AI you already use: Claude or ChatGPT. Choose one; setup takes about a minute and uses your own sign-in.',
    next: pending?.label || '', notice, cards, foot: 'Yamori runs Claude Code or Codex on this computer with your sign-in and plan limits.' };
  if (done) {
    const s = statuses[done] || {};
    view.done = { title: '✓ Yamori will use ' + AI_NAMES[done], text: (s.account ? 'Signed in · ' + s.account + '. ' : '') + 'Change it any time from AI ▾ in a Yamori tab, or with Yamori: Set Up AI.',
      actions: [{ id: 'read', label: 'Explain current file' }, { id: 'map', label: 'Open project guide' }, { id: 'close', label: 'Close' }] };
    view.lead = 'You’re ready. Click the gecko beside any script, or Yamori in the status bar.'; view.notice = '';
  }
  return view;
}
// The setup screen and the check behind every "can Yamori explain now?".
function createSetup(context, { api = vscode, system = {}, status = providerStatus, onReady = () => {}, onNext = () => {} } = {}) {
  let panel, pending, done, intent, checking = false, serial = 0, statuses = {};
  const working = {}, terminals = new Map(), subscriptions = [];
  if (api.window.onDidCloseTerminal) subscriptions.push(api.window.onDidCloseTerminal(terminal => {
    const job = terminals.get(terminal); if (!job) return;
    terminals.delete(terminal); delete working[job.owner]; clearProviderStatus(); void check().catch(() => {});
  }));
  // Coming back from the browser sign-in re-checks without a click.
  if (api.window.onDidChangeWindowState) subscriptions.push(api.window.onDidChangeWindowState(state => { if (state.focused && panel && !done) void check().catch(() => {}); }));
  const view = () => ({ readingPalette: context.globalState.get('readingPalette', 'auto'), checking, ...setupView(statuses, { chosen: context.globalState.get('provider'), working, pending, done }) });
  const post = () => panel?.webview.postMessage({ type: 'setup', state: view() });
  const statusOf = (owner, fresh) => status(owner, cliPathFor(api, owner), { fresh, system }).catch(error => ({ provider: owner, installed: false, signedIn: false, ready: false, problem: error.message }));
  async function check() {
    const id = ++serial; checking = true; post();
    const results = await Promise.all(OWNERS.map(owner => statusOf(owner, true)));
    if (id !== serial) return statuses;
    statuses = Object.fromEntries(OWNERS.map((owner, index) => [owner, { ...results[index], provider: owner }])); checking = false;
    // A sign-in or install started here continues by itself once it works.
    if (intent && statuses[intent]?.ready) { const owner = intent; intent = undefined; await use(owner); return statuses; }
    post(); return statuses;
  }
  async function use(owner) {
    await context.globalState.update('provider', owner);
    await context.globalState.update('setupDone', true);
    try { onReady(owner); } catch { /* A listener cannot block setup. */ }
    const next = pending; pending = undefined;
    if (next) { done = undefined; panel?.dispose?.(); await next.run(); return; }
    done = owner; post();
  }
  async function act(owner, which) {
    if (!PROVIDERS[owner]) return;
    const open = [...terminals].find(([, job]) => job.owner === owner);
    if (which === 'primary' && open) { open[0].show(); return; }
    const s = statuses[owner] || await statusOf(owner, true);
    if (which === 'primary' && s.ready) return use(owner);
    const kind = s.installed ? 'signIn' : 'install';
    const terminal = setupTerminal(context, api, owner, kind, s.path, system);
    terminals.set(terminal, { owner, kind }); working[owner] = kind; intent = owner; post();
  }
  async function receive(message) {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'ready': post(); break;
      case 'check': clearProviderStatus(); await check(); break;
      case 'primary': case 'alt': await act(message.provider, message.type); break;
      case 'next': if (['read', 'map', 'close'].includes(message.id)) { panel?.dispose?.(); if (message.id !== 'close') await onNext(message.id); } break;
    }
  }
  return {
    // Shows the screen; `pending` runs once an AI is chosen and ready.
    async show({ pending: next } = {}) {
      done = undefined;
      if (next) pending = next;
      if (panel) panel.reveal?.(panel.viewColumn);
      else {
        panel = api.window.createWebviewPanel('yamoriSetup', 'Set up Yamori', { viewColumn: api.ViewColumn.Active ?? api.ViewColumn.One, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
        if (context.extensionUri && api.Uri.joinPath) panel.iconPath = api.Uri.joinPath(context.extensionUri, 'yamori.png');
        panel.webview.html = setupHTML(context.globalState.get('readingPalette', 'auto'));
        panel.onDidDispose(() => { panel = undefined; pending = undefined; intent = undefined; });
        panel.onDidChangeViewState?.(event => { if (event?.webviewPanel?.visible !== false && !done) void check().catch(() => {}); });
        panel.webview.onDidReceiveMessage(message => receive(message).catch(error => api.window.showErrorMessage?.(error.message)));
      }
      post();
      await check();
    },
    // Is the chosen AI usable now? Installed and not known to be signed out.
    async ready() {
      const chosen = context.globalState.get('provider');
      if (!PROVIDERS[chosen]) return false;
      const s = await statusOf(chosen, false);
      statuses = { ...statuses, [chosen]: { ...s, provider: chosen } };
      return !!s.ready;
    },
    receive,
    dispose() { subscriptions.forEach(item => item.dispose?.()); panel?.dispose?.(); }
  };
}

async function chooseInstalledProvider(context, api = vscode, discover = findCLI) {
  if (context.globalState.get('provider') !== undefined) return;
  const owners = ['codex', 'claude'];
  const installed = await Promise.allSettled(owners.map(owner => discover(owner, setting(api, owner === 'claude' ? 'claudePath' : 'codexPath'))));
  const index = installed.findIndex(result => result.status === 'fulfilled');
  if (index >= 0 && context.globalState.get('provider') === undefined) await context.globalState.update('provider', owners[index]);
}

async function activate(context) {
  await migratePreferences(context);
  await context.secrets.delete?.('geminiKey');
  const readers = new Map();
  let activeReader, readingColumn, lastEditor = vscode.window.activeTextEditor;
  const projectMap = createProjectMap(context, { openFile: (uri, options) => open(uri, options), openSetup: options => setup.show(options) });
  // Setup comes before the app: opening a file with no ready AI shows it first.
  const setup = createSetup(context, {
    onReady: owner => { for (const reader of readers.values()) reader.useProvider(owner); projectMap.aiReady(); },
    onNext: async id => id === 'map' ? projectMap.show(undefined, (vscode.window.activeTextEditor || lastEditor)?.document.uri) : open(undefined, { ready: true })
  });
  context.subscriptions.push(setup);
  // One background preparation at a time, only for the next step of a tour.
  const prefetching = new Set();
  const notifyReaders = () => { for (const reader of readers.values()) reader.projectChanged(); };
  async function prefetch(uri) {
    const key = uri.toString(), existing = readers.get(key);
    if (setting(vscode, 'prefetchNext', true) === false || prefetching.size || existing?.hasResult() || existing?.isBusy()) return;
    prefetching.add(key); notifyReaders();
    try { const doc = await vscode.workspace.openTextDocument(uri); await readerFor(doc.uri).read(doc, undefined, { show: false, sourceColumn: sourceColumn() }); }
    catch { /* A failed preparation only means the file is written when opened. */ }
    finally { prefetching.delete(key); notifyReaders(); }
  }
  // ---- Test runs: a real run with the project's Python, or an AI simulation ----
  async function pythonFor(uri, projectRoot, workspaceRoot) {
    const configured = setting(vscode, 'pythonPath', '');
    if (configured) return configured;
    // The nearest virtualenv first: each sub-project of a monorepo has its own.
    for (let dir = projectRoot; dir && (dir === workspaceRoot || dir.startsWith(workspaceRoot + path.sep)); dir = path.dirname(dir)) {
      for (const candidate of ['.venv/bin/python', 'venv/bin/python', '.venv/Scripts/python.exe', 'venv/Scripts/python.exe']) {
        const full = path.join(dir, candidate);
        if (await fs.stat(full).then(stat => stat.isFile(), () => false)) return full;
      }
      if (dir === workspaceRoot) break;
    }
    try {
      const extension = vscode.extensions?.getExtension?.('ms-python.python');
      const api = extension && (extension.isActive ? extension.exports : await extension.activate());
      const active = await Promise.resolve(api?.environments?.getActiveEnvironmentPath?.(uri));
      if (active?.path && active.path !== 'python') return active.path;
      const command = api?.settings?.getExecutionDetails?.(uri)?.execCommand;
      if (Array.isArray(command) && command[0]) return command[0];
    } catch { /* Fall back to the folder's own environment. */ }
    const folder = vscode.workspace.getWorkspaceFolder?.(uri)?.uri.fsPath;
    for (const candidate of ['.venv/bin/python', 'venv/bin/python', '.venv/Scripts/python.exe', 'venv/Scripts/python.exe']) {
      const full = folder && path.join(folder, candidate);
      if (full && await fs.stat(full).then(stat => stat.isFile(), () => false)) return full;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }
  // Running tests runs project code: ask once per folder unless always allowed.
  async function allowRun(root, test, python) {
    const key = 'runTests:' + root;
    if (context.globalState.get(key) === 'always') return 'run';
    const choice = await vscode.window.showWarningMessage(`Run the unit test ${test.name}? Yamori will run your project's test code with ${python} in ${path.basename(root)} and record how ${test.function} runs.`, { modal: true }, 'Run', 'Always run tests in this folder', 'Simulate with AI instead');
    if (choice === 'Always run tests in this folder') { await context.globalState.update(key, 'always'); return 'run'; }
    return choice === 'Run' ? 'run' : choice === 'Simulate with AI instead' ? 'simulate' : undefined;
  }
  const kindOf = value => { const kind = project.VALUE_KINDS[value?.kind]; return kind ? { emoji: kind[0], kindLabel: kind[1], guidance: kind[2] } : {}; };
  const shown = (value, limit = 400) => value && typeof value === 'object' ? { name: String(value.name || '').slice(0, 80), repr: String(value.repr ?? '').slice(0, limit), type: String(value.type || '').slice(0, 60),
    ...(project.VALUE_KINDS[value.kind] ? { kind: value.kind, detail: String(value.detail || '').slice(0, 200), ...kindOf(value) } : {}), ...(Number.isInteger(value.size) ? { size: value.size } : {}) } : undefined;
  const fromText = (name, text) => shown({ name, repr: text, kind: project.valueKind(text) });
  async function realRun(info, python, signal) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-run-')), request = path.join(dir, 'request.json'), output = path.join(dir, 'result.json');
    try {
      await fs.writeFile(request, JSON.stringify({ root: info.root, testFile: info.testFile, testName: info.testName, target: info.target }));
      let log = '';
      try { log = await runProcess(python, [path.join(__dirname, 'runner', 'trace.py'), request, output], '', { cwd: info.root, signal, timeout: 60000 }); }
      catch (error) { if (/ENOENT/.test(error.message) || error.code === 'ENOENT') throw new Error(`Python was not found (${python}). Pick an interpreter with the Python extension, or set yamori.pythonPath.`); throw error; }
      const raw = JSON.parse(await fs.readFile(output, 'utf8'));
      const calls = (Array.isArray(raw.calls) ? raw.calls : []).slice(0, 3).map(call => ({
        inputs: (call.inputs || []).slice(0, 20).map(value => shown(value)), steps: (call.steps || []).slice(0, 300).map(step => ({ line: Number(step.line) || 0, changed: (step.changed || []).slice(0, 12).map(value => shown(value)) })),
        output: shown(call.output), error: call.error ? { type: String(call.error.type || '').slice(0, 80), message: String(call.error.message || '').slice(0, 400) } : undefined, truncated: !!call.truncated }));
      return { mode: 'real', outcome: ['passed', 'failed', 'error'].includes(raw.outcome) ? raw.outcome : 'error', message: String(raw.message || '').slice(0, 400), durationMs: Number(raw.durationMs) || 0, runner: String(raw.runner || ''), python: String(raw.python || ''), calls, log: String(log || '').slice(-600) };
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
  async function simulatedRun(info, test, connection, signal, reason) {
    const prompt = simulationPrompt({ functionName: test.function, functionText: info.functionText, functionStart: info.target.line, testName: test.name, testText: info.testText, testStart: test.line, language: test.language === 'python' ? 'Python' : 'JavaScript' });
    const response = await requestStructured({ provider: connection.provider, cliPath: connection.cliPath, model: connection.model, effort: connection.effort, prompt, schema: SIMULATION_SCHEMA, signal, showPreview: false });
    const run = parseSimulation(response.raw, info.target.line, info.target.end);
    return { mode: 'simulated', outcome: 'simulated', reason, model: response.actualModel || connection.model || '', caveats: run.caveats.slice(0, 400),
      calls: [{ inputs: run.inputs.map(value => fromText(value.name, value.value)), steps: run.steps.map(step => ({ line: step.line, note: step.note.slice(0, 300), changed: step.changed.map(value => fromText(value.name, value.value)) })),
        output: run.output.kind === 'return' ? fromText('return', run.output.value) : undefined, error: run.output.kind === 'raises' ? { type: '', message: run.output.value.slice(0, 400) } : undefined }] };
  }
  async function runTest({ uri, test, simulate, signal, connection }) {
    const info = await projectMap.testRunInfo(uri, test);
    if (!info) throw new Error('This test is no longer in the project map. Rescan the Project guide and try again.');
    const realPossible = vscode.workspace.isTrusted !== false && test.language === 'python';
    if (!simulate && realPossible) {
      const python = await pythonFor(uri, info.root, info.workspaceRoot), allowed = await allowRun(info.workspaceRoot, test, python);
      if (allowed === 'run') return realRun(info, python, signal);
      if (allowed !== 'simulate') return undefined;
    }
    const reason = simulate ? 'You asked for a simulation.' : vscode.workspace.isTrusted === false ? 'Restricted Mode: Yamori does not run project code here.' : test.language !== 'python' ? 'Real runs support Python tests for now.' : undefined;
    return simulatedRun(info, test, connection, signal, reason);
  }
  async function tourWithStatus(uri, folder) {
    const tour = await projectMap.tourFor(uri, folder);
    if (!tour) return undefined;
    const status = item => {
      if (!item) return item;
      const reader = readers.get(item.uri);
      return { ...item, status: prefetching.has(item.uri) || reader?.isBusy() ? 'preparing' : reader?.hasResult() || item.explained ? 'ready' : 'waiting' };
    };
    return { ...tour, prev: status(tour.prev), next: status(tour.next) };
  }
  const sourceColumn = () => (vscode.window.activeTextEditor || lastEditor)?.viewColumn || vscode.ViewColumn.One;
  function readerFor(uri) {
    const key = uri.toString();
    if (!readers.has(key)) {
      const local = { subscriptions: [], globalState: context.globalState, globalStorageUri: context.globalStorageUri, extensionUri: context.extensionUri };
      const reader = createReader(local, {
        uri: key, column: () => readingColumn || vscode.ViewColumn.Beside,
        open, browse, switchFile, setup: () => setup.show(),
        projectContext: snapshot => projectMap.contextFor(snapshot),
        openMap: uri => projectMap.show(undefined, uri),
        revealDefinition: (uri, defined, column) => projectMap.revealDefinition(uri, defined, column),
        agentTools: snapshot => projectMap.toolsFor(snapshot),
        tourFor: (uri, folder) => tourWithStatus(uri, folder),
        symbolsFor: snapshot => projectMap.symbolsFor(snapshot),
        openRel: (uri, options) => open(uri, options),
        prefetch: uri => prefetch(uri),
        testsFor: (snapshot, sections) => projectMap.testsForBlocks(vscode.Uri.parse(snapshot.uri), sections),
        runTest: request => runTest(request),
        recordExplanation: (snapshot, level, value) => projectMap.recordExplanation(snapshot, level, value),
        active(value, panel) { activeReader = value; if (panel.viewColumn) readingColumn = panel.viewColumn; void value.showSource().catch(() => {}); },
        closed(value) { if (readers.get(key) === value) readers.delete(key); if (activeReader === value) activeReader = undefined; if (!readers.size) readingColumn = undefined; }
      });
      readers.set(key, reader);
    }
    return readers.get(key);
  }
  async function open(uri, options = {}) {
    if (!uri && !vscode.window.activeTextEditor && activeReader?.snapshot()) { activeReader.focus(); return activeReader; }
    const editor = vscode.window.activeTextEditor || lastEditor;
    const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
    if (!doc) return browse();
    if (!options.ready && !(await setup.ready())) {
      const name = path.basename(doc.uri.fsPath || doc.uri.path || 'this file');
      await setup.show({ pending: { label: 'explain ' + name, run: () => open(doc.uri, { ...options, ready: true }) } });
      return undefined;
    }
    void projectMap.noteFile(doc.uri).catch(() => {});
    const reader = readerFor(doc.uri);
    const selection = !uri && editor?.document === doc ? editor.selection : undefined;
    activeReader = reader;
    await reader.read(doc, selection, { sourceColumn: sourceColumn(), openSource: !!uri, ...(typeof options?.tour === 'string' ? { tour: options.tour } : {}) });
    if (Number.isInteger(options?.line)) reader.focusAt(options.line);
    return reader;
  }
  function current() {
    const editor = vscode.window.activeTextEditor;
    return editor?.document ? readerFor(editor.document.uri) : activeReader || (lastEditor?.document && readerFor(lastEditor.document.uri));
  }
  async function files(root) {
    return vscode.workspace.findFiles(root ? new vscode.RelativePattern(root, INCLUDE) : INCLUDE, EXCLUDE, 501);
  }
  async function browse() { return switchFile(); }
  // One picker: files already open in Yamori, then project files by folder,
  // each with its AI-note purpose and whether Yamori has explained it.
  async function switchFile() {
    const opened = [...readers.values()].filter(reader => reader.snapshot());
    const found = await files();
    const Separator = vscode.QuickPickItemKind?.Separator, items = [];
    const openUris = new Set(opened.map(reader => reader.snapshot().uri));
    if (opened.length) {
      if (Separator) items.push({ label: 'Open in Yamori', kind: Separator });
      for (const reader of opened) items.push({ label: path.basename(vscode.Uri.parse(reader.snapshot().uri).fsPath), description: reader.snapshot().name, detail: reader.isBusy() ? 'Writing…' : reader.hasPanel() ? 'Open tab' : 'Ready to read', reader });
    }
    const groups = new Map();
    const facts = await Promise.all(found.map(uri => Promise.resolve(projectMap.fileFacts(uri)).catch(() => ({}))));
    found.forEach((uri, index) => {
      if (openUris.has(uri.toString())) return;
      const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      if (!groups.has(folder)) groups.set(folder, []);
      const fact = facts[index] || {};
      groups.get(folder).push({ label: path.basename(uri.fsPath), description: [fact.explained ? '✓ explained' : '', fact.purpose ? fact.purpose.slice(0, 90) : ''].filter(Boolean).join(' · ') || undefined, folder, uri });
    });
    for (const folder of [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b))) {
      if (Separator) items.push({ label: folder ? folder + '/' : 'Project root', kind: Separator });
      items.push(...groups.get(folder).sort((a, b) => a.label.localeCompare(b.label)).map(item => Separator ? item : { ...item, description: [folder, item.description].filter(Boolean).join(' · ') }));
    }
    const pick = await vscode.window.showQuickPick(items, { title: 'Yamori · Switch file', placeHolder: 'Type a file or folder name. Files open in Yamori are listed first.', matchOnDescription: true });
    if (pick?.reader) { activeReader = pick.reader; pick.reader.focus(); }
    else if (pick?.uri) await open(pick.uri);
  }
  // Yamori: Read a Folder or Project (named so it never hides the project module).
  async function prepareFolder(uri) {
    const root = uri instanceof vscode.Uri ? uri : vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('Open a project folder first.');
    const found = await files(root);
    if (found.length > 500) throw new Error('More than 500 source files. Choose a smaller folder in the Explorer.');
    if (!found.length) throw new Error('No supported source files found in this folder.');
    if (!(await setup.ready())) { await setup.show({ pending: { label: 'prepare files in ' + path.basename(root.fsPath), run: () => prepareFolder(root) } }); return; }
    const picked = await vscode.window.showQuickPick(found.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri, picked: true })), { title: 'Yamori · Prepare files', placeHolder: 'Generate and cache files, then use Switch files to open them.', canPickMany: true });
    if (!picked?.length) return;
    let completed = 0, skipped = 0, stopped = false, failure, job;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Yamori', cancellable: true }, async (progress, token) => {
      const subscription = token.onCancellationRequested(() => { stopped = true; job?.stop(); });
      try {
        for (const item of picked) {
          if (stopped) break;
          progress.report({ message: `${completed + skipped + 1}/${picked.length} · ${item.label}`, increment: 100 / picked.length });
          const doc = await vscode.workspace.openTextDocument(item.uri);
          if (!doc.getText().trim() || Buffer.byteLength(doc.getText()) > MAX_BYTES) { skipped++; continue; }
          job = readerFor(item.uri);
          await job.read(doc, undefined, { show: false, sourceColumn: sourceColumn() });
          if (stopped) break;
          if (job.failure()) { failure = job.failure(); break; }
          completed++;
        }
      } catch (e) { failure = e.message; }
      finally { subscription.dispose(); }
    });
    vscode.window.showInformationMessage(`Yamori: ${completed} ready${skipped ? `, ${skipped} empty or oversized files skipped` : ''}.${failure ? ' ' + failure : stopped ? ' Stopped; completed files are cached.' : ' Use Yamori: Switch Files to read them.'}`);
    if (!stopped && completed) await switchFile();
  }
  const command = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...args) => {
    try { return await fn(...args); } catch (e) { vscode.window.showErrorMessage(e.message); }
  }));
  command('yamori.read', open); command('yamori.browse', browse); command('yamori.project', prepareFolder); command('yamori.switchFile', switchFile);
  command('yamori.setup', () => setup.show());
  command('yamori.connectClaude', () => setup.show());
  // Hidden commands behind hovers, CodeLens and links: open a file's explanation
  // at a line, or show the source line itself. Local files only.
  const fileTarget = uri => { const target = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri; return target?.scheme === 'file' ? target : undefined; };
  command('yamori.openAt', async (uri, line) => { const target = fileTarget(uri); if (target) await open(target, Number.isInteger(line) ? { line } : {}); });
  command('yamori.showSource', async (uri, line) => {
    const target = fileTarget(uri); if (!target) return;
    const doc = await vscode.workspace.openTextDocument(target), at = Math.max(0, Math.min(doc.lineCount - 1, (Number.isInteger(line) ? line : 1) - 1));
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, 0, at, 0), preview: true });
  });
  if (vscode.languages?.registerHoverProvider && vscode.MarkdownString && vscode.Hover) {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: async (document, position) => {
      const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      const info = range && await projectMap.hoverInfo(document.uri, document.getText(range)).catch(() => undefined);
      return info ? new vscode.Hover(hoverMarkdown(info), range) : undefined;
    } }));
  }
  let lensesChanged;
  if (vscode.languages?.registerCodeLensProvider && vscode.CodeLens && vscode.EventEmitter) {
    lensesChanged = new vscode.EventEmitter();
    context.subscriptions.push(lensesChanged, vscode.languages.registerCodeLensProvider({ scheme: 'file' }, { onDidChangeCodeLenses: lensesChanged.event, provideCodeLenses: async document => {
      const lenses = await projectMap.lensesFor(document.uri, document.getText()).catch(() => []);
      return lenses.filter(lens => lens.line >= 1 && lens.line <= document.lineCount).map(lens => new vscode.CodeLens(new vscode.Range(lens.line - 1, 0, lens.line - 1, 0), { title: lens.title, command: 'yamori.openAt', arguments: [document.uri.toString(), lens.line] }));
    } }));
  }
  context.subscriptions.push(projectMap.onChange(() => { notifyReaders(); lensesChanged?.fire(); }));
  command('yamori.map', uri => projectMap.show(uri instanceof vscode.Uri ? uri : undefined, uri instanceof vscode.Uri ? undefined : vscode.window.activeTextEditor?.document.uri));
  for (const [id, method] of [['provider', 'chooseProvider'], ['model', 'chooseModel'], ['effort', 'chooseEffort'], ['colors', 'chooseReadingColors'], ['refinement', 'chooseRefinement']]) {
    command('yamori.' + id, async () => { const reader = current(); if (!reader) return browse(); reader.focus(); await reader[method](); });
  }
  command('yamori.clear', async () => {
    await Promise.all([...readers.values()].map(reader => reader.clear()));
    await projectMap.clear();
    await fs.rm(path.join(context.globalStorageUri.fsPath, 'cache'), { recursive: true, force: true });
    projectMap.rescanOpen();
    vscode.window.setStatusBarMessage('Yamori cache cleared', 2000);
  });
  const launcher = vscode.window.createStatusBarItem('yamori.open', vscode.StatusBarAlignment.Right, 110);
  launcher.name = 'Open in Yamori';
  launcher.text = '$(yamori-gecko) Yamori';
  function updateLauncher(editor) {
    if (editor) lastEditor = editor;
    const doc = editor?.document;
    if (!doc || !['file', 'untitled'].includes(doc.uri.scheme)) {
      launcher.command = undefined; launcher.hide(); return;
    }
    const name = path.basename(doc.uri.fsPath);
    launcher.tooltip = `Open ${name} in Yamori`;
    launcher.accessibilityInformation = { label: `Open ${name} in Yamori` };
    // Pin the URI so clicking always opens the displayed file, even if focus
    // moves before the command runs. Opening is explicit; navigation is free.
    launcher.command = { command: 'yamori.read', title: 'Open in Yamori', arguments: [doc.uri] };
    launcher.show();
  }
  context.subscriptions.push(launcher, vscode.window.onDidChangeActiveTextEditor(updateLauncher));
  updateLauncher(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { for (const reader of readers.values()) reader.changed(event); }));
  if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => { projectMap.saved(doc.uri); for (const reader of readers.values()) void reader.check(doc.uri, 'save').catch(() => {}); }));
  if (vscode.window.onDidChangeWindowState) context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) for (const reader of readers.values()) void reader.check(undefined, 'focus').catch(() => {}); }));
  // First run: the setup screen when no AI is ready yet, otherwise a pointer
  // to the gecko.
  if (!context.globalState.get('launcherHintShown') && vscode.window.showInformationMessage) {
    await context.globalState.update('launcherHintShown', true);
    void setup.ready().then(ready => {
      if (!ready) return setup.show();
      const action = vscode.window.activeTextEditor ? 'Open current file' : 'Choose a file';
      return Promise.resolve(vscode.window.showInformationMessage('Yamori is ready. Click the gecko beside any script, or Yamori in the status bar.', action)).then(choice => {
        if (choice === action) return vscode.commands.executeCommand(action === 'Open current file' ? 'yamori.read' : 'yamori.browse');
      });
    }).catch(error => vscode.window.showErrorMessage(error.message));
  }
  context.subscriptions.push({ dispose() { projectMap.dispose(); const closing = [...readers.values()].map(reader => reader.dispose()); readers.clear(); return Promise.all(closing); } });
}

function createReader(context, navigation) {
  let panel, source, result, refreshBase, error = '', stale = false, busy = false, controller, serial = 0, progress, preview, startedAt, run;
  // Tour: where this file sits in a reading order. Opened from the guide (or
  // Next/Previous), the reader also prepares the next step in the background.
  let tour, tourFolder, tourMode = false, symbols = [], focusLine;
  // Unit tests per block, and notebook-style runs keyed by block index.
  let blockTests = {}, runs = {}, runsKey;
  const runControllers = new Map();
  let selectedModel, modelNotice = '', activity = [];
  // Background reviews by cache key: they outlive level switches and swap in
  // improved blocks when they finish.
  const backgroundReviews = new Map();
  let reviewState;
  let level = context.globalState.get('detail', 'logic');
  let provider = context.globalState.get('provider', 'codex');
  if (!LEVELS[level]) level = 'logic';
  if (!PROVIDERS[provider]) provider = 'codex';
  let sourceColumn = vscode.ViewColumn.One, disposed = false, inFlight;
  const cacheDir = path.join(context.globalStorageUri.fsPath, 'cache');
  const memory = new Map(), revisions = new Map(), revisionLoaded = new Set();
  const disk = new LocalCache(cacheDir), draftScopes = new Map();
  let staleBlocks = new Set(), removedBlocks = new Set(), changedRanges = [], sharedChange = false, sourceMissing = false;
  let cacheWarning = '', cacheSavedAt, changedAt, checkedAt, changeReason = '', persistTimer;
  const watchedDirectories = new Map(), watchTimers = new Map(), observedDependencies = new Map(), checkTokens = new Map();
  let missingStale = [];
  const revisionKey = (s, owner) => cacheKey(s, 'revision', owner);
  async function loadRevision(s, owner) {
    const key = revisionKey(s, owner);
    if (revisionLoaded.has(key)) return;
    revisionLoaded.add(key);
    try {
      const saved = JSON.parse(await fs.readFile(path.join(cacheDir, 'revisions', key + '.json'), 'utf8'));
      if (!LEVELS[saved.level] || typeof saved.id !== 'string') return;
      saved.value = parseResult(JSON.stringify(saved.value), s);
      if (saved._yamori) Object.defineProperty(saved.value, '_cacheMeta', { value: saved._yamori, configurable: true });
      revisions.set(key, saved);
    } catch {}
  }
  function trackSources() {
    if (!source || !vscode.workspace.createFileSystemWatcher || !vscode.RelativePattern) return;
    const targets = [source.uri, ...(source.callContext?.definitions || []).map(def => def.uri)].filter(uri => uri.startsWith('file:'));
    const directories = new Set(targets.map(uri => path.dirname(vscode.Uri.parse(uri).fsPath)));
    for (const [directory, subscriptions] of watchedDirectories) if (!directories.has(directory)) { subscriptions.forEach(item => item.dispose()); watchedDirectories.delete(directory); }
    for (const directory of directories) if (!watchedDirectories.has(directory)) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, '*'));
      const check = (uri, kind) => { const key = uri.toString(); clearTimeout(watchTimers.get(key)); watchTimers.set(key, setTimeout(() => { watchTimers.delete(key); void inspect(uri, kind).catch(() => {}); }, 150)); };
      const subscriptions = [watcher, watcher.onDidChange(uri => check(uri, 'change')), watcher.onDidCreate(uri => check(uri, 'create')), watcher.onDidDelete(uri => check(uri, 'delete'))];
      watchedDirectories.set(directory, subscriptions); context.subscriptions.push(...subscriptions);
    }
  }
  const status = () => ({ staleBlocks: [...staleBlocks], removedBlocks: [...removedBlocks], changedRanges, sharedChange, sourceMissing, missingStale, changedAt, changeReason, checkedAt });
  const scopeFor = () => source && disk.draftScope(source, options());
  function restoreStatus(meta) {
    staleBlocks = new Set(meta?.staleBlocks || []); removedBlocks = new Set(meta?.removedBlocks || []);
    changedRanges = meta?.changedRanges || []; sharedChange = !!meta?.sharedChange; sourceMissing = !!meta?.sourceMissing;
    changedAt = meta?.changedAt; changeReason = meta?.changeReason || ''; checkedAt = meta?.checkedAt; cacheSavedAt = meta?.savedAt;
    missingStale = meta?.missingStale || [];
    stale = sourceMissing || sharedChange || staleBlocks.size > 0;
  }
  async function loadDrafts() {
    const scope = scopeFor(); if (!scope || draftScopes.has(scope)) return;
    const rows = await disk.drafts(scope);
    draftScopes.set(scope, new Map((Array.isArray(rows) ? rows : []).filter(row => validDraft(row)).map(row => [row.key, row])));
  }
  function validDraft(row) {
    return row && typeof row.key === 'string' && row.key.length < 1000 && typeof row.title === 'string' && Number.isInteger(row.index) && row.index >= 0 && typeof row.draft === 'string' && row.draft.length <= 30000 && typeof row.instruction === 'string' && row.instruction.length <= 10000 && typeof row.baseText === 'string' && (!row.editorState || JSON.stringify(row.editorState).length <= 1500000);
  }
  async function saveDraft(message) {
    if (!draftScopes.has(message.scope)) return;
    if (!validDraft(message)) { cacheWarning = 'This draft is too large to save locally. Shorten the block or instruction.'; post(); return; }
    const rows = draftScopes.get(message.scope), row = { key: message.key, title: message.title, index: message.index, draft: message.draft, instruction: message.instruction, baseText: message.baseText, editorState: message.editorState, version: message.version, savedAt: Date.now() };
    rows.set(row.key, row);
    try { await disk.saveDrafts(message.scope, [...rows.values()]); panel?.webview.postMessage({ type: 'draftSaved', key: row.key, version: row.version, savedAt: row.savedAt }); }
    catch (e) { cacheWarning = 'Your draft could not be saved locally: ' + e.message; post(); }
  }
  async function draftApplied(index, title) {
    const scope = scopeFor(), rows = draftScopes.get(scope); if (!rows) return;
    const keys = [...rows.values()].filter(row => row.index === index && row.title === title).map(row => row.key);
    keys.forEach(key => rows.delete(key));
    try { await disk.saveDrafts(scope, [...rows.values()]); } catch (e) { cacheWarning = 'The explanation was saved, but its draft cache could not be updated: ' + e.message; }
    panel?.webview.postMessage({ type: 'draftApplied', keys });
  }
  async function stamp(snapshot) {
    if (!snapshot || !snapshot.uri.startsWith('file:')) return snapshot;
    try { const stat = await fs.stat(vscode.Uri.parse(snapshot.uri).fsPath); return { ...snapshot, stamp: { modifiedAt: stat.mtimeMs, size: stat.size, dirty: snapshot.stamp?.dirty || false }, observedAt: Date.now() }; }
    catch { return snapshot; }
  }
  async function persistRevision(snapshot, opts, value, freshStatus = status()) {
    const revision = { id: hash(JSON.stringify(value)), level: opts.level, value, _yamori: { ...freshStatus, source: snapshot, savedAt: Date.now() } };
    try { await disk.write(path.join(cacheDir, 'revisions', revisionKey(snapshot, opts.provider) + '.json'), revision); }
    catch (e) { cacheWarning = 'Local revision could not be saved: ' + e.message; throw e; }
    revisions.set(revisionKey(snapshot, opts.provider), revision);
    return revision;
  }
  function queuePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = undefined; if (source && result && !disposed) void save(source, options(), result); }, 250);
  }
  function unavailable(reason) {
    if (!sourceMissing) missingStale = [...staleBlocks];
    if (busy) cancel();
    sourceMissing = true; stale = true; changedAt = Date.now(); changeReason = reason;
    staleBlocks = new Set(result?.sections.map((_, index) => index) || []); clearHighlight(); queuePersist(); post();
  }
  function applySource(next, reason = 'File changed') {
    if (!source) { source = next; return; }
    if (next.selectionMappingUnknown) { unavailable('The selected code was removed or changed too much to locate safely. Select it again.'); return; }
    if (!next.text.trim()) { unavailable('Source file or selected range is empty'); return; }
    const different = source.fullHash !== next.fullHash;
    if (sourceMissing) staleBlocks = new Set(missingStale);
    const metadataChanged = source.stamp?.modifiedAt !== next.stamp?.modifiedAt || source.stamp?.dirty !== next.stamp?.dirty || sourceMissing;
    if (different && busy) { cancel(); activity.push('Source changed; previous explanation kept'); }
    if (different && result) {
      const analysis = analyzeSource(source, next, result, [...staleBlocks]);
      result = analysis.value; staleBlocks = new Set(analysis.staleBlocks); removedBlocks = new Set(analysis.removedBlocks);
      changedRanges = analysis.changedRanges; sharedChange = sharedChange || analysis.shared;
      changedAt = next.stamp?.dirty || next.stamp?.modifiedAt === source.stamp?.modifiedAt ? Date.now() : next.stamp?.modifiedAt || Date.now(); changeReason = reason;
    }
    if (!different && source.stamp?.dirty && !next.stamp?.dirty && stale) { changedAt = next.stamp?.modifiedAt || Date.now(); changeReason = 'Source file saved'; }
    source = { ...next, callContext: next.callContext || source.callContext, projectContext: next.projectContext || source.projectContext };
    sourceMissing = false; missingStale = []; trackSources(); checkedAt = Date.now(); stale = sharedChange || staleBlocks.size > 0 || (different && !result);
    if (different || metadataChanged) { clearHighlight(); queuePersist(); }
    post();
  }
  function dependencyChanged(uri, text, modifiedAt) {
    if (!source?.callContext?.definitions || !result) return;
    const fingerprint = typeof text === 'string' ? hash(text) : 'missing';
    if (observedDependencies.get(uri) === fingerprint) return;
    observedDependencies.set(uri, fingerprint);
    const definitions = source.callContext.definitions.filter(def => def.uri === uri && (!text || def.fullHash !== hash(text)));
    if (!definitions.length) return;
    if (busy) cancel();
    for (const def of definitions) dependencyBlocks(source, result, def.symbol).forEach(index => { staleBlocks.add(index); if (sourceMissing && !missingStale.includes(index)) missingStale.push(index); });
    result = { ...result, views: undefined, sections: result.sections.map((section, index) => staleBlocks.has(index) ? { ...section, lineMap: [] } : section) };
    stale = true; checkedAt = Date.now(); changedAt = modifiedAt || Date.now(); changeReason = 'A used function changed'; clearHighlight(); queuePersist(); post();
  }
  async function inspect(uri, kind = 'focus') {
    if (!source || disposed) return;
    const targets = new Set([source.uri, ...(source.callContext?.definitions || []).map(def => def.uri)]);
    if (uri && !targets.has(uri.toString())) return;
    for (const target of uri ? [uri.toString()] : targets) {
      if (!target.startsWith('file:')) continue;
      const token = (checkTokens.get(target) || 0) + 1; checkTokens.set(target, token);
      const main = target === source.uri, doc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === target);
      try {
        const stat = await fs.stat(vscode.Uri.parse(target).fsPath);
        if (token !== checkTokens.get(target) || disposed) return;
        if (stat.size > 2000000 && main && !source.selected) { unavailable('File is too large; select a smaller range'); continue; }
        if (kind === 'focus' && main && !doc?.isDirty && source.stamp?.modifiedAt === stat.mtimeMs && source.stamp?.size === stat.size) continue;
        const text = doc?.isDirty ? doc.getText() : await fs.readFile(vscode.Uri.parse(target).fsPath, 'utf8');
        if (token !== checkTokens.get(target) || disposed) return;
        if (main) applySource(currentSnapshot(source, text, { modifiedAt: stat.mtimeMs, size: stat.size, dirty: !!doc?.isDirty }), doc?.isDirty ? 'Unsaved code changed' : 'Source file changed');
        else dependencyChanged(target, text, stat.mtimeMs);
      } catch (e) {
        if (token !== checkTokens.get(target) || disposed) return;
        if (main && (kind === 'delete' || !doc || doc.isDirty === false)) {
          unavailable('Source file is unavailable');
        } else if (!main) dependencyChanged(target, undefined);
      }
    }
  }
  // The stored project map adds file roles and project terms. A map never
  // starts a scan from here; a missing or failing map simply adds nothing.
  // Read-only Yamori lookups for the agent, when this file's folder is mapped.
  async function agentTools(snapshot) { return Promise.resolve(navigation.agentTools?.(snapshot)).catch(() => undefined); }
  async function withProjectContext(snapshot) {
    const projectContext = await Promise.resolve(navigation.projectContext?.(snapshot)).catch(() => undefined);
    return projectContext ? { ...snapshot, projectContext } : snapshot;
  }
  async function stillCurrent(snapshot) {
    for (const item of [{ uri: snapshot.uri, fullHash: snapshot.fullHash }, ...(snapshot.callContext?.definitions || [])]) {
      const doc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === item.uri);
      let text;
      try { text = doc && doc.isDirty !== false ? doc.getText() : item.uri.startsWith('file:') ? await fs.readFile(vscode.Uri.parse(item.uri).fsPath, 'utf8') : doc?.getText(); }
      catch { if (doc && doc.isDirty === undefined) text = doc.getText(); else return false; }
      if (typeof text !== 'string' || hash(text) !== item.fullHash) return false;
    }
    return true;
  }
  function changed(event) {
    const changedUri = event.document.uri.toString(); checkTokens.set(changedUri, (checkTokens.get(changedUri) || 0) + 1);
    if (source && changedUri === source.uri) applySource(currentSnapshot(source, event.document.getText(), { ...source.stamp, dirty: event.document.isDirty !== false }), 'Unsaved code changed');
    else if (source) dependencyChanged(event.document.uri.toString(), event.document.getText());
  }
  const matchesModel = (value, opts) => (value.requestedModel || '') === (opts.model || '') && (Object.hasOwn(value, 'requestedEffort') ? value.requestedEffort : value.effort ?? (value.requestedModel ? null : 'low')) === opts.effort;
  const keyFor = (s, opts) => cacheKey(s, opts.level, opts.provider, opts.model || opts.effort !== 'low' || opts.refinementSteps ? JSON.stringify([opts.revision?.id || '', opts.model, opts.effort, ...(opts.refinementSteps ? ['refinement-v1', opts.refinementSteps] : [])]) : opts.revision?.id || '');
  function remember(s, opts, value) {
    memory.set(keyFor(s, opts), value);
    for (const lower of ORDER.slice(0, ORDER.indexOf(opts.level))) {
      if (opts.revision?.level === opts.level && !value.views?.[lower]) continue;
      const view = opts.revision?.level === lower && matchesModel(opts.revision.value, opts) ? opts.revision.value : lowerView(value, opts.level, lower);
      if (view) memory.set(keyFor(s, { ...opts, level: lower }), view);
    }
    while (memory.size > 200) memory.delete(memory.keys().next().value);
  }
  const decoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground') });
  context.subscriptions.push(decoration);
  const highlighted = new Set();
  let highlightTimer;
  function clearHighlight() {
    clearTimeout(highlightTimer);
    for (const editor of highlighted) { try { editor.setDecorations(decoration, []); } catch {} }
    highlighted.clear();
  }
  // Runs belong to one explanation; a new document starts without them.
  function currentRuns() {
    const key = source && result ? keyFor(source, options()) + ':' + result.sections.length : undefined;
    if (key !== runsKey) { runsKey = key; for (const controller of runControllers.values()) controller.abort(); runControllers.clear(); runs = {}; }
    return runs;
  }
  const view = () => ({ readingPalette: context.globalState.get('readingPalette', 'auto'), name: source?.name, providerLabel: PROVIDERS[provider], requestedModel: options().model, requestedEffort: options().effort, refinementSteps: options().refinementSteps, review: reviewState && source && reviewState.key === keyFor(source, options()) ? { state: reviewState.state, text: reviewState.text } : undefined, modelNotice, setupHint: !!error && isSetupProblem(error), level, result: preview?.sections?.length ? preview : result, busy, stale, error, progress, startedAt, partial: !!preview?.sections?.length, model: selectedModel, effort: busy ? options().effort : result?.effort, activity, staleBlocks: [...staleBlocks], removedBlocks: [...removedBlocks], changedAt, checkedAt, changeReason, sharedChange, sourceMissing, cacheWarning, cacheSavedAt, draftScope: scopeFor(), draftKeys: result?.sections.map((section, index) => hash(JSON.stringify([section.title, index]))), drafts: [...(draftScopes.get(scopeFor())?.values() || [])], documentKey: source ? keyFor(source, options()) : undefined, run, tour, focusLine, runs: currentRuns(),
    canRunTests: vscode.workspace.isTrusted !== false && !stale,
    blockTests: stale ? {} : Object.fromEntries(Object.entries(blockTests).map(([index, tests]) => [index, tests.map(({ id, name, function: fn, file, language }) => ({ id, name, function: fn, file, language }))])),
    symbols: symbols.map(({ name, file, line, kind, block, purpose, explained }) => ({ name, file, line, kind, block, purpose, explained })),
    glossary: (source?.projectContext?.glossary || []).map(term => ({ term: term.term, aliases: term.aliases || [], meaning: term.meaning || '', kind: term.kind || '', defined: term.defined || '' })) });
  function post() { panel?.webview.postMessage({ type: 'state', state: view() }); }
  function cancel() { serial++; controller?.abort(); controller = undefined; busy = false; preview = undefined; progress = undefined; startedAt = undefined; if (run?.state === 'running') finishRun('stopped'); clearHighlight(); }
  // What the reader sees while a request runs: who is writing, and each stage.
  const STAGES = [['context', 'Read the code and its context'], ['think', 'Think it through'], ['write', 'Write the explanation'], ['review', 'Review difficult blocks']];
  function startRun(snapshot, opts, tools, title) {
    const definitions = snapshot.callContext?.definitions?.length || 0, terms = snapshot.projectContext?.glossary?.length;
    run = { title, state: 'running', provider: PROVIDERS[opts.provider], model: opts.model || '', effort: opts.effort || null, startedAt: Date.now(), lookups: 0,
      steps: STAGES.map(([id, label]) => ({ id, label, state: id === 'review' && !opts.refinementSteps ? 'skipped' : 'waiting' })) };
    run.steps[0] = { ...run.steps[0], state: 'done', startedAt: run.startedAt, endedAt: run.startedAt,
      detail: [definitions + ' called definition' + (definitions === 1 ? '' : 's'), snapshot.projectContext ? 'project guide' + (terms ? ' · ' + terms + ' term' + (terms === 1 ? '' : 's') : '') : 'no project guide yet', tools ? 'lookups on' : ''].filter(Boolean).join(' · ') };
    if (!opts.refinementSteps) run.steps[3].detail = 'Off (AI ▾ → Refine)';
  }
  function stage(id, detail, done) {
    if (!run || run.state !== 'running') return;
    const index = run.steps.findIndex(step => step.id === id), now = Date.now();
    if (index < 0) return;
    run.steps.forEach((step, i) => { if (i < index && (step.state === 'active' || step.state === 'waiting')) Object.assign(step, { state: 'done', endedAt: now, startedAt: step.startedAt || now }); });
    const step = run.steps[index];
    if (step.state === 'waiting' || step.state === 'skipped') Object.assign(step, { state: 'active', startedAt: now });
    if (detail) step.detail = detail;
    if (done) Object.assign(step, { state: 'done', endedAt: now });
  }
  function finishRun(state) {
    if (!run) return;
    const now = Date.now();
    run.state = state; run.endedAt = now;
    for (const step of run.steps) if (step.state === 'active' || (state === 'done' && step.state === 'waiting')) Object.assign(step, { state: state === 'done' ? 'done' : 'stopped', endedAt: now, startedAt: step.startedAt || now });
  }
  function track(update) {
    if (!run) return;
    if (update.model) run.model = update.model;
    if (update.lookup) { run.lookups++; run.lastLookup = update.lookup.replace(/^Looked up /, ''); }
    if (update.stage === 'start') stage('think', 'Starting ' + run.provider + '…');
    else if (update.stage === 'think') {
      if (Number.isFinite(update.thinkingTokens)) run.thinkingTokens = update.thinkingTokens;
      stage('think', [run.thinkingTokens ? '~' + run.thinkingTokens.toLocaleString('en-US') + ' thinking tokens' : update.phase === 'Thinking' ? 'Thinking…' : update.phase,
        run.lookups ? run.lookups + ' lookup' + (run.lookups === 1 ? '' : 's') + ' · ' + run.lastLookup : ''].filter(Boolean).join(' · '));
    } else if (update.stage === 'write') stage('write', [/parts in parallel/.test(update.phase || '') ? update.phase.replace(/^Writing /, '') : /^Parallel writing failed/.test(update.phase || '') ? 'Parallel writing failed; one request' : '',
      Number.isFinite(update.characters) ? update.characters.toLocaleString('en-US') + ' characters written' : ''].filter(Boolean).join(' · ') || undefined);
    else if (update.stage === 'review') stage('review', update.detail || update.phase, update.done);
  }
  function progressFor(id, task, onPreview) {
    return update => {
      if (id !== serial || task.signal.aborted) return;
      if (typeof update.phase === 'string' && update.phase.trim()) { progress = update.phase; if (activity.at(-1) !== update.phase) activity.push(update.phase); }
      if (update.model) selectedModel = update.model;
      track(update); onPreview?.(update);
      post();
    };
  }
  function ensurePanel() {
    if (panel) { panel.reveal(panel.viewColumn || navigation.column(), false); return; }
    panel = vscode.window.createWebviewPanel('yamori', path.basename(vscode.Uri.parse(navigation.uri).fsPath) + ' · Yamori', { viewColumn: navigation.column(), preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    if (context.extensionUri && vscode.Uri.joinPath) panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'yamori.png');
    panel.webview.html = panelHTML(context.globalState.get('readingPalette', 'auto'));
    panel.onDidDispose(() => { panel = undefined; reader.dispose(); }, null, context.subscriptions);
    panel.onDidChangeViewState?.(event => { if (!event.webviewPanel.visible) clearHighlight(); if (event.webviewPanel.active) { navigation.active(reader, event.webviewPanel); post(); } }, null, context.subscriptions);
    navigation.active(reader, panel);
    panel.webview.onDidReceiveMessage(async message => {
      try {
        if (!message || typeof message.type !== 'string') return;
        switch (message.type) {
          case 'ready': post(); break;
          case 'read': await navigation.open(); break;
          case 'browse': await navigation.browse(); break;
          case 'switchFile': await navigation.switchFile(); break;
          case 'showSource': if (source) { await showSource(); const doc = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === source.uri); if (doc) await vscode.window.showTextDocument(doc.document, { viewColumn: doc.viewColumn, preserveFocus: false }); } break;
          case 'map': await navigation.openMap?.(source ? vscode.Uri.parse(source.uri) : undefined); break;
          case 'tourGo': {
            // Only files the tour bar itself listed can be opened from it.
            const target = tour && [tour.prev, tour.next, ...(tour.uses || []), ...(tour.usedBy || [])].find(item => item?.id === message.id);
            if (target) await navigation.openRel?.(vscode.Uri.parse(target.uri), { tour: tour.folder });
            break;
          }
          case 'runTest': await runBlockTest(message); break;
          case 'closeRun': if (Number.isInteger(message.index)) { runControllers.get(message.index)?.abort(); const next = { ...runs }; delete next[message.index]; runs = next; post(); } break;
          case 'openSymbol': {
            const link = Number.isInteger(message.index) && message.documentKey === view().documentKey ? symbols[message.index] : undefined;
            if (!link) break;
            if (link.uri === source?.uri) focusAt(link.line);
            else await navigation.openRel?.(vscode.Uri.parse(link.uri), { line: link.line });
            break;
          }
          case 'revealTerm': {
            const term = Number.isInteger(message.index) && message.documentKey === view().documentKey ? source?.projectContext?.glossary?.[message.index] : undefined;
            if (term) await navigation.revealDefinition?.(source.uri, term.defined, sourceColumn);
            break;
          }
          case 'setup': await navigation.setup(); break;
          case 'provider': await chooseProvider(); break;
          case 'model': await chooseModel(); break;
          case 'effort': await chooseEffort(); break;
          case 'refinement': await chooseRefinement(); break;
          case 'palette': await chooseReadingColors(); break;
          case 'stop': cancel(); activity.push('Stopped'); error = ''; post(); break;
          case 'refresh': await refresh(); break;
          case 'refreshBlock': if (message.documentKey === view().documentKey) await refresh(message.index); break;
          case 'saveDraft': await saveDraft(message); break;
          case 'copyDraft': { const draft = draftScopes.get(message.scope)?.get(message.key); if (draft) await vscode.env.clipboard.writeText(draft.draft); break; }
          case 'level':
            if (!LEVELS[message.level] || message.level === level) break;
            {
              const previous = result, previousLevel = level, wasStale = stale;
              if (previous) refreshBase = previous;
              cancel(); level = message.level; result = undefined; error = '';
              void context.globalState.update('detail', level); await loadDrafts();
              if (source && wasStale) {
                const saved = await disk.latest(source, options(), true);
                if (saved) { const latest = source; source = saved.meta.source; result = saved.value; restoreStatus(saved.meta); applySource(latest, 'Source changed since this cached view'); }
                else { result = lowerView(previous, previousLevel, level); staleBlocks = new Set(result?.sections.map((_, index) => index) || []); stale = true; if (!result) error = 'This level has no cached view yet. Use Update from code to write it.'; }
                post();
              } else if (source) await explain(false); else post();
            }
            break;
          case 'reveal': await reveal(message.index); break;
          case 'revealStep': await reveal(message.index, message.pseudocodeLine); break;
          case 'hoverStep': hoverStep(message.index, message.pseudocodeLine); break;
          case 'clearHover': clearHighlight(); break;
          case 'copyBlock':
            if (result?.sections[message.index] && message.documentKey === view().documentKey) await vscode.env.clipboard.writeText(result.sections[message.index].pseudocode);
            break;
          case 'updateBlock': await updateBlock(message); break;
          case 'copy':
            if (result) {
              await vscode.env.clipboard.writeText([result.title, result.summary, ...result.sections.map(s => `${s.title} (L${s.startLine}–${s.endLine})\n${s.pseudocode}`)].join('\n\n'));
              vscode.window.setStatusBarMessage('Yamori copied', 1800);
            }
            break;
        }
      } catch (e) { error = e.message; post(); }
    }, null, context.subscriptions);
  }
  function capture(doc, selection) {
    if (!['file', 'untitled'].includes(doc.uri.scheme)) throw new Error('Choose a local code file.');
    let start = 0, end = doc.lineCount - 1;
    const selected = selection && !selection.isEmpty;
    if (selected) {
      start = Math.min(selection.start.line, doc.lineCount - 1);
      end = Math.min(selection.end.line - (selection.end.character === 0 ? 1 : 0), doc.lineCount - 1);
      end = Math.max(start, end);
    }
    const text = doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).text.length));
    if (!text.trim()) throw new Error('This file or selection is empty.');
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('This file is large. Select a function or a smaller section first (up to 120 KB).');
    return {
      uri: doc.uri.toString(), text, fullText: doc.getText(), observedAt: Date.now(), stamp: { dirty: doc.isDirty !== false }, language: doc.languageId, startLine: start + 1, endLine: end + 1, selected,
      fullHash: hash(doc.getText()),
      name: vscode.workspace.asRelativePath(doc.uri) + (selected ? ` · lines ${start + 1}–${end + 1}` : '')
    };
  }
  function options(snapshot = source) {
    const { model, effort, cliPath } = connectionOptions(context.globalState, provider);
    return { provider, level, model, effort, refinementSteps: refinementSteps(setting(vscode, 'refinementSteps', 1)), cliPath, revision: snapshot && revisions.get(revisionKey(snapshot, provider)) };
  }
  async function cached(s, opts) {
    if (opts.revision?.level === opts.level && matchesModel(opts.revision.value, opts) && (opts.revision.value.refinement?.stepsRequested || 0) === opts.refinementSteps) return opts.revision.value;
    if (memory.has(keyFor(s, opts))) return memory.get(keyFor(s, opts));
    for (const candidate of ORDER.slice(ORDER.indexOf(opts.level))) {
      const candidateOpts = { ...opts, level: candidate };
      const entry = await disk.entry(keyFor(s, candidateOpts), s);
      if (entry) {
        if (entry.meta) Object.defineProperty(entry.value, '_cacheMeta', { value: entry.meta, configurable: true });
        remember(s, candidateOpts, entry.value);
        const found = memory.get(keyFor(s, opts));
        if (found && !found._cacheMeta && entry.meta) Object.defineProperty(found, '_cacheMeta', { value: { ...entry.meta, staleBlocks: entry.meta.staleBlocks?.length ? found.sections.map((_, index) => index) : [] }, configurable: true });
        return found;
      }
    }
  }
  async function save(s, opts, value, freshStatus = status()) {
    remember(s, opts, value);
    try {
      const meta = await disk.save(s, opts, value, keyFor(s, opts), freshStatus);
      Object.defineProperty(value, '_cacheMeta', { value: meta, configurable: true });
      // Current explanations become project knowledge for other files.
      if (!freshStatus.staleBlocks?.length && !freshStatus.sourceMissing) void Promise.resolve(navigation.recordExplanation?.(s, opts.level, value)).catch(() => {});
      for (const lower of ORDER.slice(0, ORDER.indexOf(opts.level))) {
        const lowerValue = value.views?.[lower];
        if (lowerValue) await disk.save(s, { ...opts, level: lower }, lowerValue, keyFor(s, { ...opts, level: lower }), { ...freshStatus, staleBlocks: freshStatus.staleBlocks.length ? lowerValue.sections.map((_, index) => index) : [] });
      }
      cacheSavedAt = meta.savedAt; cacheWarning = ''; return true;
    } catch (e) { cacheWarning = 'Local cache could not be saved: ' + e.message; return false; }
  }
  function explain(force) {
    const request = runExplanation(force);
    inFlight = request;
    return request.finally(() => { if (inFlight === request) inFlight = undefined; if (result && !error && !busy) afterReady(); });
  }
  async function refreshProjectView() {
    if (!source || disposed) return;
    const uri = source.uri;
    const [nextTour, nextSymbols, nextTests] = await Promise.all([Promise.resolve(navigation.tourFor?.(vscode.Uri.parse(uri), tourFolder)).catch(() => undefined), Promise.resolve(navigation.symbolsFor?.(source)).catch(() => []),
      Promise.resolve(result && !source.selected ? navigation.testsFor?.(source, result.sections) : undefined).catch(() => undefined)]);
    if (disposed || source?.uri !== uri) return;
    tour = nextTour; symbols = Array.isArray(nextSymbols) ? nextSymbols : []; blockTests = nextTests && typeof nextTests === 'object' ? nextTests : {}; post();
  }
  function afterReady() {
    void refreshProjectView().then(() => {
      if (tourMode && tour?.next && tour.next.status !== 'ready' && result && !busy && !disposed) navigation.prefetch?.(vscode.Uri.parse(tour.next.uri));
    });
  }
  async function runBlockTest(message) {
    const index = message.index, test = Number.isInteger(index) && message.documentKey === view().documentKey ? blockTests[index]?.find(item => item.id === message.id) : undefined;
    if (!test || !source) return;
    runControllers.get(index)?.abort();
    const controller = new AbortController(), base = { id: test.id, name: test.name, function: test.function };
    runControllers.set(index, controller);
    runs = { ...runs, [index]: { ...base, state: 'running', mode: message.simulate ? 'simulated' : 'real' } }; post();
    try {
      const outcome = await navigation.runTest?.({ uri: vscode.Uri.parse(source.uri), test, simulate: !!message.simulate, signal: controller.signal, connection: options() });
      if (controller.signal.aborted) return;
      const next = { ...runs };
      if (outcome) next[index] = { ...base, ...outcome, state: 'done' }; else delete next[index];
      runs = next;
    } catch (e) {
      if (!controller.signal.aborted) runs = { ...runs, [index]: { ...base, state: 'failed', mode: runs[index]?.mode, message: e.message } };
    } finally { if (runControllers.get(index) === controller) runControllers.delete(index); post(); }
  }
  function focusAt(line) {
    if (!Number.isInteger(line)) return;
    focusLine = { line, token: Date.now() }; ensurePanel(); post();
  }
  async function runExplanation(force) {
    if (!source) return;
    modelNotice = '';
    cancel(); const id = serial; let snapshot = stale ? { ...source, callContext: undefined, projectContext: undefined } : source;
    if (!snapshot.callContext) {
      busy = true; progress = 'Finding function definitions'; post();
      snapshot = await withProjectContext(await collectCallContext(snapshot));
      if (id !== serial) return;
      source = snapshot; trackSources();
    }
    await loadRevision(snapshot, provider);
    if (id !== serial) return;
    const opts = options(snapshot);
    await loadDrafts();
    if (force) backgroundReviews.get(keyFor(snapshot, opts))?.abort();
    const ready = !force && memory.get(keyFor(snapshot, opts));
    if (ready) { restoreStatus(ready._cacheMeta); result = ready; selectedModel = ready.model; error = ''; busy = false; progress = undefined; post(); resumeReview(snapshot, opts, ready); return; }
    error = ''; busy = true; startedAt = Date.now(); progress = 'Checking cache'; activity = []; selectedModel = undefined; post();
    const task = new AbortController(); controller = task;
    let pendingReview;
    try {
      let value = force ? undefined : await cached(snapshot, opts);
      if (value) restoreStatus(value._cacheMeta);
      if (id !== serial) return;
      if (!value) {
        if (id !== serial) return;
        const tools = await agentTools(snapshot);
        if (id !== serial || task.signal.aborted) return;
        startRun(snapshot, opts, tools, 'Writing the ' + (LEVELS[opts.level]?.label || '') + ' explanation'); post();
        const parallel = parallelRequests();
        const [fast, parts, review] = await Promise.all([quickModel(opts.provider, opts.cliPath), opts.level === 'logic' ? partsFor(snapshot, parallel) : undefined, opts.refinementSteps ? reviewerFor(opts) : undefined]);
        if (id !== serial || task.signal.aborted) return;
        if (parts) stage('write', parts.length + ' parts in parallel');
        // The draft comes back as soon as it is written; review runs afterwards.
        value = await generate({ source: snapshot, ...opts, tools, fast, parts, parallel, background: true, review, signal: task.signal, onProgress: progressFor(id, task, update => { if (update.preview) preview = update.preview; }) });
        if (id !== serial || task.signal.aborted) return;
        if (!await stillCurrent(snapshot)) { await inspect(undefined, 'change'); return; }
        staleBlocks.clear(); removedBlocks.clear(); stale = false; sourceMissing = false; changedRanges = [];
        // A refined view derived from another level's revision is cached under
        // that revision. Promoting it would invalidate every other level again.
        if (value.refinement?.acceptedStep && (!opts.revision || opts.revision.level === opts.level)) opts.revision = await persistRevision(snapshot, opts, value);
        await save(snapshot, opts, value);
      }
      if (id !== serial) return;
      result = value;
      if (!value._cacheMeta) await save(snapshot, opts, value);
      if (value.refinement?.status === 'pending') pendingReview = [snapshot, opts, value];
      selectedModel = value.model || selectedModel;
      if (activity.length) activity.push('Ready');
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === snapshot.uri);
      stale = sharedChange || staleBlocks.size > 0 || (doc ? hash(doc.getText()) !== snapshot.fullHash : false);
    } catch (e) { if (id === serial && !task.signal.aborted) { error = e.message; if (isSetupProblem(error)) clearProviderStatus(); finishRun('failed'); } }
    finally {
      if (id === serial) { if (run?.state === 'running') finishRun('done'); busy = false; controller = undefined; preview = undefined; progress = undefined; post(); }
      if (pendingReview && id === serial) startBackgroundReview(...pendingReview);
    }
  }
  // A cached draft whose review never finished (Yamori closed meanwhile) is
  // reviewed again once it is shown.
  function resumeReview(snapshot, opts, value) {
    if (value?.refinement?.status === 'pending' && opts.refinementSteps) startBackgroundReview(snapshot, opts, value);
  }
  // Review after the draft is shown: improved blocks swap in when it finishes,
  // unless the reader edited the explanation or the code changed meanwhile.
  async function startBackgroundReview(snapshot, opts, draft) {
    let key = keyFor(snapshot, opts);
    if (backgroundReviews.has(key) || disposed) return;
    const task = new AbortController(), owner = run && run.state !== 'running' && result === draft ? run : undefined;
    backgroundReviews.set(key, task);
    const reviewStep = () => owner?.steps.find(step => step.id === 'review');
    try {
      const [fast, review] = await Promise.all([quickModel(opts.provider, opts.cliPath), reviewerFor(opts)]);
      if (task.signal.aborted || disposed) return;
      const by = review?.model ? ' with ' + review.model : '';
      reviewState = { key, state: 'running', text: 'Reviewing difficult blocks in the background' + by + '. You can read now; improved blocks swap in when it finishes.' };
      const step = reviewStep();
      if (step) Object.assign(step, { state: 'active', startedAt: Date.now(), endedAt: undefined, detail: 'In the background' + by });
      post();
      let reviewed;
      try {
        reviewed = await reviewDraft({ initial: draft, source: snapshot, level: opts.level, provider: opts.provider, cliPath: opts.cliPath, model: opts.model, effort: opts.effort, fast, review, steps: opts.refinementSteps, signal: task.signal,
          onProgress: update => { const active = reviewStep(); if (active && update.detail && !task.signal.aborted) { active.detail = update.detail + (by ? ' ·' + by : ''); post(); } } });
      } catch (error) {
        if (task.signal.aborted) return;
        reviewed = { ...draft, refinement: { version: REFINEMENT_VERSION, status: 'incomplete', stepsRequested: opts.refinementSteps, stepsCompleted: 0, selectedBlocks: [],
          warning: (error.code === 'YAMORI_FIDELITY' ? 'The reviewers flagged possible inaccuracies they could not fix. Read this explanation with care, or press Retry review. ' : 'Review could not finish. The draft is kept; press Retry review to try again. ') + error.message.slice(0, 200) } };
      }
      if (task.signal.aborted || disposed || !await stillCurrent(snapshot)) return;
      // An edit or a new explanation under this key since the draft wins.
      if (memory.has(key) && memory.get(key) !== draft) return;
      const showing = result === draft, info = reviewed.refinement || {};
      if (info.acceptedStep && (!opts.revision || opts.revision.level === opts.level)) { opts = { ...opts, revision: await persistRevision(snapshot, opts, reviewed) }; }
      await save(snapshot, opts, reviewed);
      const improved = info.acceptedStep ? (info.selectedBlocks || []).map(index => reviewed.sections[index]?.title).filter(Boolean) : [];
      const text = info.status === 'incomplete' ? 'Review could not finish; the draft is kept.' : info.status === 'skipped' ? 'Review: nothing needed a second look.'
        : improved.length ? 'Review improved ' + improved.length + ' block' + (improved.length === 1 ? '' : 's') + ': ' + improved.join(', ') + '.' : 'Review checked the difficult blocks and found nothing to change.';
      key = keyFor(snapshot, opts);
      reviewState = { key, state: info.status === 'incomplete' ? 'failed' : 'done', text };
      const done = reviewStep();
      if (done) Object.assign(done, { state: info.status === 'incomplete' ? 'stopped' : 'done', endedAt: Date.now(), detail: text });
      if (showing) result = reviewed;
      post();
    } finally { for (const [name, value] of backgroundReviews) if (value === task) backgroundReviews.delete(name); }
  }
  async function updateBlock(message) {
    if (busy || sourceMissing || staleBlocks.has(message.index) || !source || !result || !Number.isInteger(message.index)) return;
    const original = result.sections[message.index];
    if (!original || message.documentKey !== view().documentKey || message.baseText !== original.pseudocode) throw new Error('This block changed. Reopen its editor before updating.');
    if (typeof message.draft !== 'string' || !message.draft.trim() || message.draft.length > 30000 || typeof message.instruction !== 'string' || message.instruction.length > 10000) throw new Error('Enter a nonempty draft and a shorter instruction.');
    const snapshot = source, base = result;
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === snapshot.uri);
    if (doc && hash(doc.getText()) !== snapshot.fullHash) throw new Error('Source changed. Refresh before editing this explanation.');
    cancel(); const id = serial, opts = options(snapshot), task = new AbortController(); controller = task;
    backgroundReviews.get(keyFor(snapshot, opts))?.abort();
    busy = true; modelNotice = ''; startedAt = Date.now(); activity = []; progress = 'Updating block'; post();
    try {
      const tools = await agentTools(snapshot);
      startRun(snapshot, opts, tools, 'Updating "' + original.title + '"'); post();
      const updated = await generate({ source: snapshot, ...opts, tools, fast: await quickModel(opts.provider, opts.cliPath), review: opts.refinementSteps ? await reviewerFor(opts) : undefined, edit: { section: original, draft: message.draft, instruction: message.instruction }, signal: task.signal, onProgress: progressFor(id, task, update => {
        // Keep all other blocks untouched while the selected one streams.
        if (update.preview?.sections?.[0]) preview = { ...base, sections: base.sections.map((s, i) => i === message.index ? { ...update.preview.sections[0], title: original.title } : s) };
      }) });
      if (id !== serial || task.signal.aborted) return;
      if (!await stillCurrent(snapshot)) { await inspect(undefined, 'change'); throw new Error('Source changed during the edit. Your previous explanation was kept.'); }
      if (id !== serial || task.signal.aborted) return;
      const replacement = updated.sections[0];
      const value = { ...base, refinement: updated.refinement && { ...updated.refinement, selectedBlocks: updated.refinement.selectedBlocks.map(() => message.index) }, edited: true, views: undefined, model: updated.model || base.model, requestedModel: opts.model, requestedEffort: opts.effort, effort: updated.effort, sections: base.sections.map((s, i) => i === message.index ? { ...s, pseudocode: replacement.pseudocode, lineMap: replacement.lineMap } : s) };
      const revision = await persistRevision(snapshot, opts, value);
      await draftApplied(message.index, original.title);
      // New revision keys invalidate every other level without deleting the old
      // approved result. Those views are derived lazily when next requested.
      await save(snapshot, { ...opts, revision }, value);
      if (id !== serial) return;
      result = value; selectedModel = value.model; error = ''; activity.push('Block updated and cached');
    } catch (e) { if (id === serial && !task.signal.aborted) { error = e.message; if (isSetupProblem(error)) clearProviderStatus(); finishRun('failed'); } }
    finally { if (id === serial) { if (run?.state === 'running') finishRun('done'); busy = false; controller = undefined; preview = undefined; post(); } }
  }
  async function read(doc, selection, settings = {}) {
    sourceColumn = settings.sourceColumn || sourceColumn;
    if (typeof settings.tour === 'string') { tourFolder = settings.tour; tourMode = true; }
    const next = await stamp(capture(doc, selection));
    if (source && result && source.uri === next.uri && source.selected === next.selected && (!next.selected || (source.startLine === next.startLine && source.endLine === next.endLine)) && matchesModel(result, options())) {
      applySource(next, 'Source file changed');
      if (settings.show !== false) { ensurePanel(); post(); }
      if (!busy) afterReady();
      return inFlight;
    }
    if (source && !stale && source.fullHash === next.fullHash && busy) { if (settings.show !== false) ensurePanel(); return inFlight; }
    cancel();
    const saved = await disk.latest(next, options(next), true);
    if (saved) {
      source = saved.meta.source; result = saved.value; restoreStatus(saved.meta); selectedModel = result.model; error = '';
      modelNotice = (saved.meta.opts?.refinementSteps || 0) < options().refinementSteps ? 'This cached result predates your refinement setting. Use Regenerate to apply it; opening the cache uses no AI.' : '';
      await loadDrafts(); applySource(next, 'Source changed since the cached explanation');
      const fresh = await Promise.resolve(navigation.projectContext?.(source)).catch(() => undefined);
      if (fresh && fresh.fingerprint !== source.projectContext?.fingerprint) modelNotice = (modelNotice ? modelNotice + ' ' : '') + 'The project map has new context for this file. Use Regenerate to include it; opening the cache uses no AI.';
      if (settings.openSource) await showSource();
      if (settings.show !== false) { ensurePanel(); post(); }
      await inspect(undefined, 'open');
      if (!stale && (saved.meta.opts?.refinementSteps || 0) === options().refinementSteps) resumeReview(source, options(), result);
      afterReady();
      return;
    }
    source = next; result = undefined; refreshBase = undefined; restoreStatus(); stale = false; error = ''; trackSources();
    await loadDrafts();
    if (settings.openSource) await showSource();
    if (settings.show !== false) ensurePanel();
    await explain(false);
  }
  async function showSource() {
    if (!source || disposed) return;
    if (vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === source.uri)) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(source.uri));
    if (!disposed) await vscode.window.showTextDocument(doc, { viewColumn: sourceColumn, preserveFocus: true });
  }
  async function refresh(index) {
    if (!source) return navigation.open();
    if (busy) return;
    await inspect(undefined, 'refresh');
    if (sourceMissing) throw new Error('The source is unavailable. Restore the file or choose another script before refreshing.');
    if (!result && !refreshBase) { await explain(true); return; }
    const one = Number.isInteger(index);
    if (one && (!result.sections[index] || removedBlocks.has(index))) throw new Error('This code block was removed. Use Update from code to reorganize the explanation.');
    const base = result || refreshBase, previousSource = source, pending = [...staleBlocks];
    backgroundReviews.get(keyFor(source, options()))?.abort();
    const contextSource = await withProjectContext(await collectCallContext({ ...source, callContext: undefined, projectContext: undefined }));
    const original = one ? base.sections[index] : undefined;
    const scope = one ? { ...contextSource, startLine: original.startLine, endLine: original.endLine, text: contextSource.text.split('\n').slice(original.startLine - contextSource.startLine, original.endLine - contextSource.startLine + 1).join('\n'), callContext: undefined } : contextSource;
    const requestSource = one ? await collectCallContext(scope) : scope;
    if (source.fullHash !== previousSource.fullHash || !await stillCurrent(contextSource)) { await inspect(undefined, 'change'); return; }
    if (Buffer.byteLength(requestSource.text) > MAX_BYTES) throw new Error('Select a smaller code range before refreshing.');
    cancel(); const id = serial, opts = options(contextSource), task = new AbortController(); controller = task;
    busy = true; error = ''; startedAt = Date.now(); activity = []; progress = one ? 'Updating cached block' : 'Updating cached explanation'; post();
    try {
      const tools = await agentTools(contextSource);
      startRun(requestSource, opts, tools, one ? 'Updating one block from the code' : 'Updating the explanation from the code'); post();
      const updated = await generate({ source: requestSource, ...opts, tools, fast: await quickModel(opts.provider, opts.cliPath), review: opts.refinementSteps ? await reviewerFor(opts) : undefined, initialDraft: !one && !stale && result === base && base.refinement?.status === 'incomplete' ? base : undefined, sourceRefresh: { index: one ? index : undefined, patch: !one && !sharedChange && pending.length > 0 && pending.length < base.sections.length, previous: base, staleBlocks: pending, changedRanges, sharedContext: one ? contextSource.text.split('\n').slice(0, 40).map((line, i) => (contextSource.startLine + i) + ': ' + line).join('\n').slice(0, 6000) : '' }, signal: task.signal, onProgress: progressFor(id, task) });
      if (id !== serial || task.signal.aborted || source.fullHash !== previousSource.fullHash) return;
      if (!await stillCurrent(contextSource)) { await inspect(undefined, 'change'); return; }
      if (id !== serial || task.signal.aborted || source.fullHash !== previousSource.fullHash) return;
      let value;
      if (one) {
        const replacement = updated.sections[0];
        value = { ...base, refinement: updated.refinement && { ...updated.refinement, selectedBlocks: updated.refinement.selectedBlocks.map(() => index) }, title: updated.title || base.title, summary: updated.summary || base.summary, views: undefined, model: updated.model || base.model, requestedModel: opts.model, requestedEffort: opts.effort, sections: base.sections.map((section, i) => i === index ? { ...replacement, title: replacement.title || section.title, startLine: section.startLine, endLine: section.endLine } : section) };
      } else value = updated;
      const freshStatus = { ...status(), staleBlocks: one ? pending.filter(item => item !== index) : [], removedBlocks: one ? [...removedBlocks].filter(item => item !== index) : [], changedRanges: one ? changedRanges : [], sharedChange: one && sharedChange, sourceMissing: false, checkedAt: Date.now() };
      const revision = await persistRevision(contextSource, opts, value, freshStatus);
      const saved = await save(contextSource, { ...opts, revision }, value, freshStatus);
      if (id !== serial || task.signal.aborted) return;
      source = contextSource; trackSources(); result = value; refreshBase = undefined; restoreStatus({ ...freshStatus, savedAt: saved ? cacheSavedAt : undefined });
      selectedModel = value.model; activity.push(saved ? one ? 'Block refreshed and cached' : 'Explanation refreshed and cached' : 'Updated; local cache needs attention');
    } catch (e) { if (id === serial && !task.signal.aborted) { error = e.message; if (isSetupProblem(error)) clearProviderStatus(); finishRun('failed'); } }
    finally { if (id === serial) { if (run?.state === 'running') finishRun('done'); busy = false; controller = undefined; preview = undefined; progress = undefined; post(); } }
  }
  async function chooseProvider() {
    const picked = await vscode.window.showQuickPick([
      { label: 'Codex', description: 'Use your local Codex sign-in', value: 'codex' },
      { label: 'Claude Code', description: 'Use your local Claude Code sign-in', value: 'claude' }
    ], { title: 'Choose a provider', placeHolder: 'CLI providers use their own saved sign-in and plan limits.' });
    if (!picked) return;
    cancel(); provider = picked.value; await context.globalState.update('provider', provider);
    result = undefined; error = ''; ensurePanel(); post();
    if (source) await explain(false);
  }
  async function chooseModel() {
    const opts = options(), owner = provider, task = new AbortController();
    let failure = '';
    const models = listModels(owner, opts.cliPath, task.signal).catch(error => { failure = error.message; return []; });
    const items = models.then(found => {
      const rows = found.map(model => ({ label: model.label, description: model.id, detail: model.description, id: model.id, effort: model.effort ?? null, picked: model.id === opts.model }));
      if (opts.model && !rows.some(row => row.id === opts.model)) rows.unshift({ label: opts.model, description: 'Current selection', id: opts.model, effort: opts.effort });
      return [{ label: 'Provider default', description: 'Use the CLI default', detail: failure ? 'Model list unavailable. You can still enter a model ID.' : undefined, id: '', effort: 'low', picked: !opts.model }, ...rows, { label: 'Enter model ID…', description: 'Use an exact model name or alias', custom: true }];
    });
    let picked;
    try { picked = await vscode.window.showQuickPick(items, { title: 'Yamori · ' + PROVIDERS[owner] + ' model', placeHolder: 'Applies to new requests. Model access depends on your account.', matchOnDescription: true }); }
    finally { task.abort(); }
    if (!picked || provider !== owner) return;
    if (picked.custom) {
      const id = await vscode.window.showInputBox({ title: 'Yamori · Model ID', prompt: 'Enter a model supported by your ' + PROVIDERS[owner] + ' account', value: opts.model, validateInput: value => !value.trim() || value.trim().length > 200 || /^-|\s|[\x00-\x1f]/.test(value.trim()) ? 'Enter a model ID without spaces, up to 200 characters.' : undefined });
      if (id === undefined || provider !== owner) return;
      picked = { id: id.trim(), effort: null };
    }
    if (picked.id === opts.model) return;
    cancel(); await context.globalState.update(owner + 'Model', { id: picked.id, effort: picked.effort });
    if (provider !== owner) return;
    modelNotice = 'New requests use ' + (picked.id || 'the provider default') + (result ? '. Press Refresh to regenerate this explanation.' : '.');
    error = ''; post();
  }
  async function chooseEffort() {
    const opts = options(), task = new AbortController();
    let failed = false;
    const rows = listEfforts(opts.provider, opts.model, opts.cliPath, task.signal).catch(() => { failed = true; return []; }).then(levels => [{ label: 'Provider default', id: 'auto', description: 'Let the CLI choose its effort', detail: failed || !levels.length ? 'Supported levels unavailable. Select a catalog model to choose a level.' : undefined }, ...levels.map(level => ({ label: level.id[0].toUpperCase() + level.id.slice(1), id: level.id, description: level.description }))]);
    let picked;
    try { picked = await vscode.window.showQuickPick(rows, { title: 'Yamori · Reasoning effort', placeHolder: 'For ' + (opts.model || PROVIDERS[opts.provider] + ' default') + '. Higher levels can take longer.' }); }
    finally { task.abort(); }
    if (!picked || provider !== opts.provider || options().model !== opts.model) return;
    cancel();
    const saved = { ...context.globalState.get('effortChoices', {}), [opts.provider + ':' + opts.model]: picked.id };
    await context.globalState.update('effortChoices', saved);
    modelNotice = 'New requests use ' + (picked.id === 'auto' ? 'the CLI default effort' : picked.id + ' effort') + (result ? '. Press Refresh to regenerate this explanation.' : '.');
    error = ''; post();
  }
  async function chooseRefinement() {
    const config = vscode.workspace.getConfiguration('yamori');
    const selected = refinementSteps(setting(vscode, 'refinementSteps', 1));
    const picked = await vscode.window.showQuickPick(Array.from({ length: 6 }, (_, value) => ({
      label: value ? `${value} refinement step${value === 1 ? '' : 's'}${value === 1 ? ' · Default' : ''}` : 'Off · Fast draft', value, picked: value === selected,
      description: value ? `Up to ${3 * value + 4} model requests per new explanation` : 'One generation request',
      detail: value ? 'A selector picks difficult blocks; two parallel evaluators review only those blocks after generation and each revision. Only the best reviewed result is shown.' : 'Skip the evaluator loop. Cached results are never reviewed automatically.'
    })), { title: 'Yamori · Refinement steps', placeHolder: 'Uses your selected provider, model and effort. More steps take longer and use more of your plan.' });
    if (!picked || picked.value === selected) return;
    cancel(); await config.update('refinementSteps', picked.value, vscode.ConfigurationTarget.Global);
    modelNotice = 'Refinement applies to the next generation or refresh. Your current cached explanation is kept.'; post();
  }
  async function chooseReadingColors() {
    const choices = [
      { label: 'Follow editor', id: 'auto', description: 'Monochrome light or dark to match your editor' },
      { label: 'Pixel Light', id: 'paper', description: 'Black ink on white, crisp pixel details' },
      { label: 'Pixel Dark', id: 'slate', description: 'White ink on black, crisp pixel details' }
    ];
    const picked = await vscode.window.showQuickPick(choices, { title: 'Yamori · Reading colors', placeHolder: 'Applies immediately. No generation needed.' });
    if (!picked || !choices.some(choice => choice.id === picked.id)) return;
    await context.globalState.update('readingPalette', picked.id); post();
  }
  async function reveal(index, pseudocodeLine) {
    if (!source || !result || !Number.isInteger(index) || sourceMissing || staleBlocks.has(index)) return;
    const section = result.sections[index]; if (!section) return;
    let location = section;
    if (pseudocodeLine !== undefined) {
      if (!Number.isInteger(pseudocodeLine)) return;
      location = section.lineMap?.find(m => m.pseudocodeLine === pseudocodeLine);
      if (!location) return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(source.uri));
    if (hash(doc.getText()) !== source.fullHash) { stale = true; post(); return; }
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: sourceColumn, preserveFocus: true });
    const range = new vscode.Range(location.startLine - 1, 0, location.endLine - 1, doc.lineAt(location.endLine - 1).text.length);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    clearHighlight();
    editor.setDecorations(decoration, [range]); highlighted.add(editor);
    highlightTimer = setTimeout(clearHighlight, 1800);
  }
  function hoverStep(index, pseudocodeLine) {
    clearHighlight();
    if (!source || !result || sourceMissing || staleBlocks.has(index) || !Number.isInteger(index) || !Number.isInteger(pseudocodeLine)) return;
    const mapping = result.sections[index]?.lineMap?.find(m => m.pseudocodeLine === pseudocodeLine);
    if (!mapping) return;
    // Highlight only already-visible editors: no file reads, focus or scroll changes.
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== source.uri || hash(editor.document.getText()) !== source.fullHash) continue;
      const range = new vscode.Range(mapping.startLine - 1, 0, mapping.endLine - 1, editor.document.lineAt(mapping.endLine - 1).text.length);
      editor.setDecorations(decoration, [range]); highlighted.add(editor);
    }
  }
  const reader = {
    read, showSource, chooseProvider, chooseModel, chooseEffort, chooseReadingColors, chooseRefinement,
    snapshot: () => source, isBusy: () => busy, hasPanel: () => !!panel, hasResult: () => !!result, failure: () => error, focusAt,
    projectChanged() { if (panel && source && !disposed) void refreshProjectView(); },
    // Set up AI picked a provider: new requests use it (not while writing).
    useProvider(value) { if (!PROVIDERS[value] || value === provider || busy) return; provider = value; error = ''; modelNotice = ''; if (panel) post(); },
    stop: cancel,
    focus() { ensurePanel(); post(); },
    async clear() { clearTimeout(persistTimer); for (const timer of watchTimers.values()) clearTimeout(timer); watchTimers.clear(); cancel(); result = undefined; refreshBase = undefined; await disk.flush(); memory.clear(); revisions.clear(); revisionLoaded.clear(); draftScopes.clear(); error = ''; cacheWarning = ''; restoreStatus(); panel?.webview.postMessage({ type: 'cacheCleared' }); post(); },
    changed, check: inspect,
    dispose() {
      if (disposed) return;
      const pendingSave = !!persistTimer; clearTimeout(persistTimer); persistTimer = undefined;
      disposed = true; for (const timer of watchTimers.values()) clearTimeout(timer); watchTimers.clear(); cancel(); clearHighlight();
      for (const review of backgroundReviews.values()) review.abort(); backgroundReviews.clear();
      const closing = pendingSave && source && result ? save(source, options(), result) : disk.flush();
      panel?.dispose?.(); panel = undefined;
      for (const subscription of context.subscriptions.splice(0)) subscription?.dispose?.();
      navigation.closed(reader);
      return closing;
    }
  };
  return reader;
}
module.exports = { hoverMarkdown, createProjectMap, createSetup, setupView, setupTerminal, connectionOptions, chooseInstalledProvider, setting, activate, migratePreferences, collectCallContext };
