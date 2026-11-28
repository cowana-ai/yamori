'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const engine = require('./ai/engine');
const { reviewModel, runProcess, simulationPrompt, parseSimulation, SIMULATION_SCHEMA, fastModel, LEVELS, PROVIDERS, generate, hash, findCLI, cliLaunch, requestStructured } = engine;
const autoRefreshing = require('./project/auto-refresh');
const { createDiffReview } = require('./views/diff-review');
const { dependencyFingerprint, refreshSupport } = require('./storage/cache');
const project = require('./project/graph');
const { SOURCE_GLOB, EXCLUDED_GLOB, IGNORED_CHANGE, MAX_SOURCE_BYTES, MIGRATION_FILE } = require('./config');

async function openNotebookAt(api, uri, cells, line = 1, viewColumn, preserveFocus = false) {
  if (!api.workspace.openNotebookDocument || !api.window.showNotebookDocument) return false;
  const notebook = await api.workspace.openNotebookDocument(uri);
  const target = cells.find(cell => cell.endLine >= line) || cells.at(-1);
  const range = target && api.NotebookRange ? new api.NotebookRange(target.cell, target.cell + 1) : undefined;
  const editor = await api.window.showNotebookDocument(notebook, { viewColumn: viewColumn ?? api.ViewColumn.Beside, preserveFocus, ...(range ? { selections: [range] } : {}) });
  if (range) editor.revealRange?.(range); return true;
}

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
  if (snapshot.notebook) return snapshot;
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
        partIndexer ||= new project.Indexer();
        const syntax = await partIndexer.extract(uri.fsPath, fullText);
        const declaration = (syntax.defs || []).filter(def => def.line <= start + 1 && (def.end || def.line) >= start + 1 && ['function','class','method'].includes(def.kind)).sort((a,b) => (a.end - a.line) - (b.end - b.line))[0];
        const watchSignature = declaration && dependencyFingerprint(fullText, syntax.defs, declaration.name, declaration.kind);
        definitions.push({ ...(watchSignature ? { watchSignature, watchName: declaration.name, watchKind: declaration.kind } : {}), ...(doc.isDirty ? { unsaved: true } : {}), symbol: call.symbol, file: api.workspace.asRelativePath(uri, false), uri: uri.toString(), startLine: start + 1, text, fullHash: hash(fullText) });
      }
    }
  }));
  await Promise.race([work, new Promise(resolve => { timer = setTimeout(resolve, timeout); })]);
  clearTimeout(timer); finished = true;
  definitions.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  const callContext = { definitions: [...definitions], unresolved: selected.filter(call => !resolved.has(call.symbol)).map(call => call.symbol), bounded: calls.length > selected.length || budget < 4500 };
  return { ...snapshot, callContext };
}

// Follow Python imports from the current buffer even before a language server or project map is ready.
async function pythonCommandDefinitions(uri, fullText, nearby, startLine, endLine, instruction) {
  const folder = vscode.workspace.getWorkspaceFolder?.(uri);
  if (!folder || folder.uri.scheme !== 'file') return [];
  const rel = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
  partIndexer ||= new project.Indexer();
  const [bindings, syntax] = await Promise.all([partIndexer.pythonBindings(fullText), partIndexer.extract(rel, fullText)]);
  const words = String(instruction).toLowerCase().match(/[a-z_][\w]{3,}/g) || [];
  const symbols = [...new Set(nearby.flatMap(line =>
    [...line.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g)].map(match => match[1])))];
  const rank = symbol => words.filter(word => symbol.toLowerCase().split(/[._]/).includes(word) || symbol.toLowerCase() === word).length;
  symbols.sort((a, b) => rank(b) - rank(a));
  const calls = symbols.flatMap(symbol => {
    const [first, ...rest] = symbol.split('.');
    const binding = bindings.get(first);
    if (!binding) return rest.length ? [] : [{ symbol, name: first }];
    if (binding.qualifier) return symbol.startsWith(binding.qualifier + '.') && symbol.split('.').length === binding.qualifier.split('.').length + 1
      ? [{ symbol, name: rest.at(-1), binding }] : [];
    return rest.length <= 1 ? [{ symbol, name: rest[0] || binding.member, binding }] : [];
  }).slice(0, 16);
  const imports = calls.some(call => call.binding)
    ? project.resolutionContext(await project.listSourceFiles(folder.uri.fsPath)) : undefined;
  const read = new Map();
  const entry = async file => {
    if (file === rel) return { text: fullText, syntax };
    if (!read.has(file)) read.set(file, (async () => {
      // Check the resolved path and size before accessing an open buffer or disk.
      const root = await fs.realpath(folder.uri.fsPath), filename = path.join(root, file);
      const real = await fs.realpath(filename), relative = path.relative(root, real);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
          relative.split(path.sep).some(part => part.startsWith('.') || ['node_modules', 'venv', 'vendor'].includes(part)) ||
          (await fs.stat(real)).size > MAX_SOURCE_BYTES) return undefined;
      const doc = vscode.workspace.textDocuments?.find(doc => doc.uri.scheme === 'file' &&
        [real, filename, path.join(folder.uri.fsPath, file)].includes(doc.uri.fsPath));
      const text = doc?.getText() ?? await fs.readFile(real, 'utf8');
      if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) return undefined;
      return { text, syntax: await partIndexer.extract(file, text), unsaved: doc?.isDirty };
    })().catch(() => undefined));
    return read.get(file);
  };
  const definitions = [], seen = new Set();
  for (const { symbol, name, binding } of calls) {
    if (definitions.length === 8) break;
    let targets = binding ? project.resolveImport(rel, { spec: binding.spec, names: binding.member ? [binding.member] : [], kind: 'module' }, imports) : [rel];
    if (binding) {
      const modulePath = binding.spec.replace(/^\.+/, '').replace(/\./g, '/');
      const matchesModule = (file, suffix) => suffix && [suffix + '.py', suffix + '/__init__.py'].some(candidate => file === candidate || file.endsWith('/' + candidate));
      targets = targets.filter(file => symbol.includes('.') && binding.member ? matchesModule(file, binding.member)
        : matchesModule(file, modulePath) || !modulePath && file.endsWith('/__init__.py'));
    }
    for (const file of targets) {
      const source = await entry(file);
      if (!source) continue;
      const lines = source.text.split(/\r?\n/);
      const matches = source.syntax.defs.filter(def => def.name === name && ['function', 'class'].includes(def.kind) && /^\S/.test(lines[def.line - 1] || ''));
      if (matches.length !== 1) continue;
      const def = matches[0], start = def.start || def.line;
      if (file === rel && start >= startLine && def.end <= endLine) break;
      const key = file + ':' + start;
      if (seen.has(key)) break;
      seen.add(key);
      const text = lines.slice(start - 1, Math.min(def.end, start + 69)).map((line, i) => (start + i) + ': ' + line).join('\n').slice(0, 3600);
      definitions.push({ symbol, file, startLine: start, endLine: def.end, text, ...(source.unsaved ? { unsaved: true } : {}) });
      break;
    }
  }
  return definitions;
}

async function commandDefinitions(snapshot, uri, text, lines, startLine, endLine, instruction, language) {
  const nearby = lines.slice(startLine - 1, endLine);
  const [python, languageService] = await Promise.all([
    language === 'python' ? pythonCommandDefinitions(uri, text, nearby, startLine, endLine, instruction).catch(() => []) : [],
    vscode.Position && vscode.commands.executeCommand ? collectCallContext({ ...snapshot, text: nearby.join('\n'), startLine, endLine }).catch(() => undefined) : undefined
  ]);
  const definitions = [], symbols = new Set();
  let budget = 14000;
  for (const { symbol, file, startLine, endLine, text, unsaved } of [...python, ...(languageService?.callContext?.definitions || [])]) {
    if (!text || symbols.has(symbol) || text.length > budget) continue;
    const last = text.trimEnd().split('\n').at(-1)?.match(/^(\d+):/)?.[1];
    definitions.push({ symbol, file, startLine, endLine: endLine || (last && Number(last)) || startLine, text, ...(unsaved ? { unsaved: true } : {}) });
    symbols.add(symbol);
    budget -= text.length;
  }
  return definitions;
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
    return project.planParts(record.defs, snapshot.text, snapshot.startLine || 1, { maxParts: parallel })?.map(part => ({
      ...part, context: refreshSupport(snapshot, [part], record.defs, 2600)
    }));
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
  return { provider, model, effort: provider === 'cursor' ? null : effort, cliPath: cliPathFor(api, provider) };
}

// Project map: one local graph (plus optional AI notes and moved node
// positions) per mapped folder. The scan reads files but never runs them and
// never asks a language service, so it also works in Restricted Mode.
// Native inline question drafts: no source edits and no AI until Submit.
function createSelectionQuestions(context, api, sendQuestion) {
  const subscriptions = [], drafts = new WeakMap();
  const controller = api.comments?.createCommentController('yamori-selection', 'Yamori');
  let current, timer, closed = false;
  const disposeDraft = () => { clearTimeout(timer); if (current?.sending) return; current?.thread?.dispose(); current = undefined; };
  if (controller) {
    controller.options = { prompt: 'Send your question and selected code to Yamori chat.', placeHolder: 'Ask about this code…' };
    controller.commentingRangeProvider = { provideCommentingRanges: () => [] };
    subscriptions.push(controller);
  }
  function snapshot(editor) {
    const doc = editor?.document, selection = editor?.selection;
    if (doc?.uri?.scheme !== 'file' || !selection || selection.isEmpty || editor.selections?.length > 1) return;
    const text = doc.getText(selection); if (!text.trim() || text.length > 12000) return;
    const range = new api.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
    return { uri: doc.uri, range, text, language: doc.languageId, version: doc.version, unsaved: !!doc.isDirty, startLine: selection.start.line + 1, endLine: selection.end.line + (selection.end.character === 0 ? 0 : 1) };
  }
  async function open(editor = api.window.activeTextEditor, automatic = false) {
    if (closed || current?.sending) return;
    const selected = snapshot(editor);
    if (!selected) { if (!automatic && current?.thread) { current.thread.collapsibleState = api.CommentThreadCollapsibleState?.Expanded ?? 1; return; } if (!automatic) api.window.showInformationMessage?.('Select up to 12,000 characters of code to ask Yamori.'); return; }
    const key = JSON.stringify([selected.uri.toString(), selected.version, selected.range.start, selected.range.end, selected.text]);
    if (current?.key === key) { if (current.thread) current.thread.collapsibleState = api.CommentThreadCollapsibleState?.Expanded ?? 1; return; }
    disposeDraft();
    if (!controller) {
      if (automatic) return;
      const question = await api.window.showInputBox?.({ title: 'Ask Yamori about selected code', placeHolder: 'What would you like to understand?', prompt: selected.startLine === selected.endLine ? 'Selected line ' + selected.startLine : 'Selected lines ' + selected.startLine + '–' + selected.endLine });
      if (question?.trim()) await sendQuestion(selected, question.trim());
      return;
    }
    const thread = controller.createCommentThread(selected.uri, selected.range, []);
    thread.label = 'Ask Yamori · ' + path.basename(selected.uri.fsPath) + ' · L' + selected.startLine + (selected.endLine > selected.startLine ? '–' + selected.endLine : '');
    thread.contextValue = 'yamori-selection'; thread.canReply = true; thread.collapsibleState = api.CommentThreadCollapsibleState?.Expanded ?? 1;
    current = { key, thread, selected, sending: false }; drafts.set(thread, current);
  }
  async function submit(reply) {
    const thread = reply?.thread || reply, draft = thread && drafts.get(thread), question = typeof reply?.text === 'string' ? reply.text.trim() : draft?.pendingText;
    if (!draft || draft !== current || draft.sending || !question) return;
    draft.pendingText = question; draft.sending = true; thread.canReply = false;
    try {
      await sendQuestion(draft.selected, question);
      thread.dispose(); drafts.delete(thread); if (current === draft) current = undefined;
    } catch (error) {
      draft.sending = false; thread.canReply = true; thread.contextValue = 'yamori-selection-retry';
      thread.comments = [{ body: question, author: { name: 'Your question · not sent' }, mode: api.CommentMode?.Preview ?? 0 }];
      api.window.showErrorMessage?.(error.message || 'Could not send this question. Use Retry to keep your question and selection.');
    }
  }
  const command = (id, fn) => subscriptions.push(api.commands.registerCommand(id, fn));
  command('yamori.askSelection', () => open());
  command('yamori.sendSelectionQuestion', submit);
  command('yamori.retrySelectionQuestion', submit);
  command('yamori.cancelSelectionQuestion', thread => { if (!thread || current?.thread === (thread?.thread || thread)) disposeDraft(); });
  if (api.window.onDidChangeTextEditorSelection) subscriptions.push(api.window.onDidChangeTextEditorSelection(event => {
    if (event.textEditor?.document?.uri?.scheme !== 'file') return;
    if (closed || current?.sending || ![api.TextEditorSelectionChangeKind?.Mouse ?? 2, api.TextEditorSelectionChangeKind?.Keyboard ?? 1].includes(event.kind)) return;
    clearTimeout(timer);
    if (!event.selections?.length || event.selections[0].isEmpty || event.selections.length > 1 || !setting(api, 'selectionQuestions', true)) return;
    timer = setTimeout(() => { void open(event.textEditor, true).catch(() => {}); }, 350);
  }));
  if (api.window.onDidChangeActiveTextEditor) subscriptions.push(api.window.onDidChangeActiveTextEditor(editor => { if (editor?.document?.uri?.scheme === 'file' && current && editor.document.uri.toString() !== current.selected.uri.toString()) disposeDraft(); }));
  const result = { dispose() { closed = true; clearTimeout(timer); if (current) { current.sending = false; disposeDraft(); } subscriptions.forEach(item => item?.dispose?.()); } };
  context.subscriptions?.push(result); return result;
}

async function migratePreferences(context) {
  const file = path.join(context.globalStorageUri.fsPath, MIGRATION_FILE);
  let saved;
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return; }
  if (LEVELS[saved.detail] && context.globalState.get('detail') === undefined) await context.globalState.update('detail', saved.detail);
  if (PROVIDERS[saved.provider] && context.globalState.get('provider') === undefined) await context.globalState.update('provider', saved.provider);
  await fs.unlink(file);
}

// ---- Setup and the founder's own agents (src/agents) ----
const PATH_SETTINGS = { claude: 'claudePath', codex: 'codexPath', cursor: 'cursorPath' };
function cliPathFor(api, owner) { return setting(api, PATH_SETTINGS[owner] || 'codexPath'); }
const { setupTerminal, setupView, createSetup, chooseInstalledProvider } = require('./agents/setup')({ vscode, os, engine, cliPathFor });
const { writeLauncher, SESSION_RULES, APPROVED_PROMPT, planComments, createAgentSessions, agentPlan, stripRulesBlock, stripHooks, connectAgents } = require('./agents/sessions')({ vscode, os, engine, connectionOptions, cliPathFor });
const { createProjectMap } = require('./panels/project-map')({ engine, vscode, setting, cliPathFor, connectionOptions, quickModel, openNotebookAt, connectAgents, planComments, APPROVED_PROMPT });

async function activate(context) {
  await migratePreferences(context);
  await context.secrets.delete?.('geminiKey');
  const readers = new Map();
  const readerTerminals = new Map();
  if (vscode.window.onDidCloseTerminal) context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
    for (const [key, session] of readerTerminals) {
      if (session.terminal !== terminal) continue;
      readerTerminals.delete(key);
      readers.get(session.uri)?.composerModelChanged();
      break;
    }
  }));
  let activeReader, readingColumn, lastEditor = vscode.window.activeTextEditor;
  const projectMap = createProjectMap(context, { openFile: (uri, options) => open(uri, options), openSetup: options => setup.show(options) });
  // Setup comes before the app: opening a file with no ready AI shows it first.
  const setup = createSetup(context, {
    onReady: owner => { for (const reader of readers.values()) reader.useProvider(owner); projectMap.aiReady(); },
    onNext: async id => id === 'map' ? projectMap.show(undefined, (vscode.window.activeTextEditor || lastEditor)?.document.uri) : open(undefined, { ready: true })
  });
  context.subscriptions.push(setup);
  const diffReview = createDiffReview(context, vscode, {
    cacheEnabled: () => setting(vscode, 'cache', true) !== false,
    maxExplanationBytes: MAX_SOURCE_BYTES,
    async explain(source, level, signal) {
      const provider = context.globalState.get('provider', 'codex');
      const opts = { ...connectionOptions(context.globalState, provider), level };
      const value = await generate({ source, ...opts, signal });
      return { value, opts: { provider, level, model: opts.model, effort: opts.effort } };
    }
  });
  const notifyReaders = () => { for (const reader of readers.values()) reader.projectChanged(); };
  const notifyModels = () => { for (const reader of readers.values()) reader.composerModelChanged(); };
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
  const sourceColumn = () => (vscode.window.activeTextEditor || lastEditor)?.viewColumn || vscode.ViewColumn.One;
  async function openReaderTerminal(uri, owner, firstTurn) {
    const id = uri.toString(), key = id + '\0' + owner;
    let current = readerTerminals.get(key)?.terminal;
    if (current && !current.exitStatus) { current.show(); return; }
    if (!firstTurn) throw new Error('The terminal session has ended. Enter a message to start another.');
    if (!vscode.window.createTerminal) throw new Error('The integrated terminal is unavailable.');
    const folder = vscode.workspace.getWorkspaceFolder?.(uri)?.uri;
    const cwd = folder?.scheme === 'file' ? folder.fsPath : path.dirname(uri.fsPath);
    const { model, effort, cliPath } = connectionOptions(context.globalState, owner);
    const binary = await findCLI(owner, cliPath);
    const reasoning = !effort ? [] : owner === 'claude' ? ['--effort', effort] : ['-c', 'model_reasoning_effort=' + JSON.stringify(effort)];
    // Cursor's CLI has no system-prompt option, so its first message carries the reading context.
    const sessionContext = owner === 'claude' ? ['--append-system-prompt', firstTurn.readingContext] : owner === 'cursor' ? [] :
      ['-c', 'developer_instructions=' + JSON.stringify(firstTurn.readingContext).replace(/\x7f/g, '\\u007f')];
    const question = owner === 'cursor' ? firstTurn.readingContext + '\n\n' + firstTurn.question : firstTurn.question;
    const launch = cliLaunch(binary, [...(model ? ['--model', model] : []), ...(owner === 'cursor' ? [] : reasoning), ...sessionContext, '--', question]);
    current = readerTerminals.get(key)?.terminal;
    if (current && !current.exitStatus) { current.show(); return; }
    // The Python extension skips auto-activation for terminals created with this
    // flag. Showing the terminal explicitly still keeps its original options.
    const terminal = vscode.window.createTerminal({ name: 'Yamori · ' + PROVIDERS[owner] + ' · ' + path.basename(uri.fsPath),
      hideFromUser: true, cwd, shellPath: launch.command, shellArgs: launch.args, env: launch.env });
    readerTerminals.set(key, { uri: id, owner, terminal });
    terminal.show();
  }
  function readerFor(uri) {
    const key = uri.toString();
    if (!readers.has(key)) {
      const local = { subscriptions: [], globalState: context.globalState, globalStorageUri: context.globalStorageUri, extensionUri: context.extensionUri };
      const reader = createReader(local, {
        uri: key, column: () => readingColumn || vscode.ViewColumn.Beside,
        open, browse, switchFile, setup: () => setup.show(),
        projectContext: snapshot => projectMap.contextFor(snapshot),
        openMap: uri => projectMap.show(undefined, uri, 'map'),
        openPlan: uri => projectMap.show(undefined, uri, 'plan'),
        openStages: uri => projectMap.show(undefined, uri, 'stages'),
        revealDefinition: (uri, defined, column) => projectMap.revealDefinition(uri, defined, column),
        agentTools: snapshot => projectMap.toolsFor(snapshot),
        openReaderTerminal,
        terminalProviders: () => [...readerTerminals.values()].filter(session => session.uri === key && !session.terminal.exitStatus).map(session => session.owner),
        workingDiff: diffReview.working,
        previousDiff: diffReview.against,
        openSourceDiff: diffReview.openSource,
        openPatch: diffReview.openPatch,
        aiReady: () => setup.ready(),
        notifyModels,
        symbolsFor: snapshot => projectMap.symbolsFor(snapshot),
        openRel: (uri, options) => open(uri, options),
        testsFor: (snapshot, sections) => projectMap.testsForBlocks(vscode.Uri.parse(snapshot.uri), sections),
        runTest: request => runTest(request),
        recordExplanation: (snapshot, level, value) => projectMap.recordExplanation(snapshot, level, value),
        savedPseudocode: (snapshot, level) => projectMap.savedPseudocode(snapshot, level),
        knownNames: snapshot => projectMap.knownNames(snapshot),
        active(value, panel) { activeReader = value; if (panel.viewColumn) readingColumn = panel.viewColumn; void value.showSource().catch(() => {}); const uri = value.snapshot?.()?.uri; if (uri?.startsWith('file:')) projectMap.noteRead(vscode.Uri.parse(uri)); },
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
    const ready = !!options.ready || await setup.ready();
    if (!ready && (doc.uri.scheme !== 'file' || !context.globalState.get('provider') && context.globalState.get('detail', 'logic') === 'overview')) {
      const name = path.basename(doc.uri.fsPath || doc.uri.path || 'this file');
      await setup.show({ pending: { label: 'explain ' + name, run: () => open(doc.uri, { ...options, ready: true }) } });
      return undefined;
    }
    if (ready) void projectMap.noteFile(doc.uri).catch(() => {});
    const reader = readerFor(doc.uri);
    const selection = !uri && editor?.document === doc ? editor.selection : undefined;
    activeReader = reader;
    const cursor = options?.line ?? (editor?.document.uri.toString() === doc.uri.toString() && editor.selection?.active ?
      (editor.selection.isEmpty ? editor.selection.active : editor.selection.start).line + 1 : undefined);
    await reader.read(doc, selection, { sourceColumn: sourceColumn(), openSource: !!uri, online: ready, cursor });
    if (Number.isInteger(options?.line)) reader.focusAt(options.line);
    else if (editor?.document.uri.toString() === doc.uri.toString() && editor.selection?.active) reader.cursorAt(editor.selection.active.line + 1);
    return reader;
  }
  function current() {
    const editor = vscode.window.activeTextEditor;
    return editor?.document ? readerFor(editor.document.uri) : activeReader || (lastEditor?.document && readerFor(lastEditor.document.uri));
  }
  async function files(root) {
    return vscode.workspace.findFiles(root ? new vscode.RelativePattern(root, SOURCE_GLOB) : SOURCE_GLOB, EXCLUDED_GLOB, 501);
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
          if (!doc.getText().trim() || Buffer.byteLength(doc.getText()) > MAX_SOURCE_BYTES) { skipped++; continue; }
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
  createSelectionQuestions(context, vscode, (selected, question) => projectMap.askSelection(selected, question));
  command('yamori.reviewChanges', diffReview.start);
  command('yamori.read', open); command('yamori.browse', browse); command('yamori.project', prepareFolder); command('yamori.switchFile', switchFile);
  command('yamori.setup', () => setup.show());
  command('yamori.connectAgents', () => connectAgents(context));
  command('yamori.disconnectAgents', () => connectAgents(context, vscode, { disconnect: true }));
  // Keep the launcher pointing at this version of the extension.
  if (context.globalState.get('agentsConnected')) void writeLauncher(context).catch(() => {});
  command('yamori.connectClaude', () => setup.show());
  // Hidden commands behind hovers, CodeLens and links: open a file's explanation
  // at a line, or show the source line itself. Local files only.
  const fileTarget = uri => { const target = typeof uri === 'string' ? vscode.Uri.parse(uri) : uri; return target?.scheme === 'file' ? target : undefined; };
  // Stages: the shared map between the founder and their agents.
  const stageScreen = require('./stages/controller').createStages({
    api: vscode, context, map: projectMap.stageSupport, setting: (name, fallback) => setting(vscode, name, fallback),
    gitOperationInProgress: autoRefreshing.gitOperationInProgress
  });
  context.subscriptions.push({ dispose: () => stageScreen.dispose() });
  projectMap.setStages(stageScreen);
  const agentSessions = createAgentSessions(context);
  projectMap.setAgentSessions(agentSessions);
  command('yamori.agentSession', async () => agentSessions.open(await stageEntry()));
  const stageEntry = async () => {
    const uri = (vscode.window.activeTextEditor || lastEditor)?.document?.uri;
    const entry = uri?.scheme === 'file' ? await projectMap.stageSupport.entryForFile(uri) : undefined;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!entry && !root) throw new Error('Open a folder or workspace to map its stages.');
    return entry || projectMap.stageSupport.entryFor(root);
  };
  command('yamori.stages.open', async () => stageScreen.show(await stageEntry()));
  command('yamori.stages.fromEntry', async () => stageScreen.fromEntry(await stageEntry()));
  command('yamori.stages.regenerate', async () => stageScreen.regenerate(await stageEntry()));
  if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => { void stageScreen.saved(doc.uri).catch(() => {}); }));
  // Edits made outside VS Code's editor (your terminal agent, git pull, a branch
  // switch) reach Your System too. Only files already in a map do any work.
  if (vscode.workspace.createFileSystemWatcher) {
    const watcher = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    const changed = uri => { if (!IGNORED_CHANGE.test(uri?.fsPath || '')) void stageScreen.saved(uri).catch(() => {}); };
    context.subscriptions.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
  }
  // Deep links from Obsidian notes: vscode://cowana-ai.yamori/open?file=<repo-relative>&line=N[&root=<abs>]
  if (vscode.window.registerUriHandler) context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri) {
      if (uri.path !== '/open') return;
      const query = new URLSearchParams(uri.query), file = query.get('file') || '', line = Math.max(1, Number(query.get('line')) || 1);
      if (!file || file.includes('\0')) return;
      const folders = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);
      const roots = query.get('root') ? [query.get('root'), ...folders] : folders;
      for (const root of roots) {
        const target = path.resolve(root, file), rel = path.relative(root, target);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !folders.some(folder => !path.relative(folder, target).startsWith('..'))) continue;
        try { await fs.access(target); } catch { continue; }
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
        const position = new vscode.Range(line - 1, 0, line - 1, 0);
        await vscode.window.showTextDocument(doc, { selection: position, preview: true });
        return;
      }
      vscode.window.showWarningMessage('Yamori: ' + file + ' is not in an open workspace folder.');
    }
  }));
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
  command('yamori.plan', uri => projectMap.show(undefined, uri instanceof vscode.Uri ? uri : (vscode.window.activeTextEditor || lastEditor)?.document.uri, 'plan'));
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
  if (vscode.window.onDidChangeTextEditorSelection) context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
    const reader = readers.get(event.textEditor.document.uri.toString());
    const selection = event.selections[0];
    if (reader && selection) reader.cursorAt((selection.isEmpty ? selection.active : selection.start).line + 1);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { for (const reader of readers.values()) reader.changed(event); }));
  if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => { projectMap.saved(doc.uri); for (const reader of readers.values()) { void reader.check(doc.uri, 'save').catch(() => {}); reader.saved(doc.uri); } }));
  if (vscode.window.onDidChangeWindowState) context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) { projectMap.rescanOpen(); for (const reader of readers.values()) void reader.check(undefined, 'focus').catch(() => {}); } }));
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
  context.subscriptions.push({ async dispose() { const closing = [...readers.values()].map(reader => reader.dispose()); readers.clear(); try { await Promise.all(closing); } finally { await projectMap.dispose(); } } });
}

const sharedIndexer = () => partIndexer ||= new project.Indexer();
const { createReader } = require('./panels/reader')({ engine, vscode, os, setting, connectionOptions, quickModel, openNotebookAt, collectCallContext, commandDefinitions, parallelRequests, partsFor, reviewerFor, sharedIndexer });

module.exports = { createAgentSessions, SESSION_RULES, APPROVED_PROMPT, planComments, createSelectionQuestions, connectAgents, agentPlan, stripRulesBlock, stripHooks, writeLauncher, hoverMarkdown, createProjectMap, createSetup, setupView, setupTerminal, connectionOptions, chooseInstalledProvider, setting, activate, migratePreferences, collectCallContext };
