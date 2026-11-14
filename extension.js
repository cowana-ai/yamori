'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LEVELS, PROVIDERS, cacheKey, generate, hash, parseResult, lowerView, ORDER, listModels, listEfforts, findCLI, cliLaunch } = require('./engine');
const { panelHTML } = require('./panel');
const { LocalCache, currentSnapshot, analyzeSource, dependencyBlocks } = require('./cache');

const INCLUDE = '**/*.{py,js,jsx,ts,tsx,mjs,cjs,go,rs,java,kt,scala,cs,c,cpp,cc,h,hpp,rb,php,swift,dart,r,R,sh,bash,lua,pl,sql,vue,svelte}';
const EXCLUDE = '**/{node_modules,.git,.venv,venv,env,dist,build,out,vendor,.next,coverage,__pycache__}/**';
const MAX_BYTES = 120000;

// Ask the editor's language service for actual definitions. Never infer a model
// architecture from a variable name or crawl a repository to find a name match.
async function collectCallContext(snapshot, api = vscode, timeout = 1600) {
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

async function migratePreferences(context) {
  const file = path.join(context.globalStorageUri.fsPath, 'migration.json');
  let saved;
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return; }
  if (LEVELS[saved.detail] && context.globalState.get('detail') === undefined) await context.globalState.update('detail', saved.detail);
  if (PROVIDERS[saved.provider] && context.globalState.get('provider') === undefined) await context.globalState.update('provider', saved.provider);
  await fs.unlink(file);
}

async function connectClaude(context, api = vscode, system = {}) {
  const config = api.workspace.getConfiguration('yamori');
  let binary;
  try { binary = await findCLI('claude', config.get('claudePath'), system); }
  catch (error) {
    const choice = await api.window.showInformationMessage(error.message + ' Yamori can open Anthropic’s official installer in a visible terminal, then start its browser sign-in.', 'Install and sign in', 'Choose executable', 'Setup guide');
    if (choice === 'Choose executable') { await api.commands.executeCommand('workbench.action.openSettings', 'yamori.claudePath'); return ''; }
    if (choice === 'Setup guide') { await api.env.openExternal(api.Uri.parse('https://code.claude.com/docs/en/setup')); return ''; }
    if (choice !== 'Install and sign in') return '';
    const windows = (system.platform || process.platform) === 'win32';
    const terminal = api.window.createTerminal(windows ? {
      name: 'Yamori · Install Claude Code',
      shellPath: path.win32.join((system.env || process.env).SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; irm https://claude.ai/install.ps1 | iex; $claudeExe = Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"; if (Test-Path -LiteralPath $claudeExe) { & $claudeExe auth login } else { Write-Error "Claude Code installation did not finish. See the installer output above." }']
    } : {
      name: 'Yamori · Install Claude Code', shellPath: '/bin/bash',
      shellArgs: ['-lc', 'set -euo pipefail; curl -fsSL https://claude.ai/install.sh | /bin/bash; "$HOME/.local/bin/claude" auth login']
    });
    context.subscriptions.push(terminal); terminal.show();
    return 'Complete Claude Code installation and browser sign-in in the Yamori terminal, then press Refresh.';
  }
  const launch = cliLaunch(binary, ['auth', 'login']);
  const terminal = api.window.createTerminal({ name: 'Yamori · Claude sign-in', shellPath: launch.command, shellArgs: launch.args, env: launch.env, cwd: system.home || os.homedir() });
  context.subscriptions.push(terminal); terminal.show();
  return 'Complete Claude’s browser sign-in from the Yamori terminal, then press Refresh. Your credentials stay with Claude Code.';
}

async function activate(context) {
  await migratePreferences(context);
  await context.secrets.delete?.('geminiKey');
  const readers = new Map();
  let activeReader, readingColumn, lastEditor = vscode.window.activeTextEditor;
  const sourceColumn = () => (vscode.window.activeTextEditor || lastEditor)?.viewColumn || vscode.ViewColumn.One;
  function readerFor(uri) {
    const key = uri.toString();
    if (!readers.has(key)) {
      const local = { subscriptions: [], globalState: context.globalState, globalStorageUri: context.globalStorageUri, extensionUri: context.extensionUri };
      const reader = createReader(local, {
        uri: key, column: () => readingColumn || vscode.ViewColumn.Beside,
        open, browse, switchFile, connectClaude: () => connectClaude(context),
        active(value, panel) { activeReader = value; if (panel.viewColumn) readingColumn = panel.viewColumn; void value.showSource().catch(() => {}); },
        closed(value) { if (readers.get(key) === value) readers.delete(key); if (activeReader === value) activeReader = undefined; if (!readers.size) readingColumn = undefined; }
      });
      readers.set(key, reader);
    }
    return readers.get(key);
  }
  async function open(uri) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Yamori.');
    if (!uri && !vscode.window.activeTextEditor && activeReader?.snapshot()) { activeReader.focus(); return activeReader; }
    const editor = vscode.window.activeTextEditor || lastEditor;
    const doc = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
    if (!doc) return browse();
    const reader = readerFor(doc.uri);
    const selection = !uri && editor?.document === doc ? editor.selection : undefined;
    activeReader = reader;
    await reader.read(doc, selection, { sourceColumn: sourceColumn(), openSource: !!uri });
    return reader;
  }
  function current() {
    const editor = vscode.window.activeTextEditor;
    return editor?.document ? readerFor(editor.document.uri) : activeReader || (lastEditor?.document && readerFor(lastEditor.document.uri));
  }
  async function files(root) {
    return vscode.workspace.findFiles(root ? new vscode.RelativePattern(root, INCLUDE) : INCLUDE, EXCLUDE, 501);
  }
  async function browse() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Yamori.');
    const found = await files();
    const pick = await vscode.window.showQuickPick(found.map(uri => ({ label: path.basename(uri.fsPath), description: vscode.workspace.asRelativePath(uri), detail: readers.get(uri.toString())?.hasPanel() ? 'Open Yamori tab' : undefined, uri })), { title: 'Yamori · Open a file', placeHolder: 'Search files. Each file opens in its own Yamori tab.', matchOnDescription: true });
    if (pick) await open(pick.uri);
  }
  async function switchFile() {
    const opened = [...readers.values()].filter(reader => reader.snapshot());
    if (!opened.length) return browse();
    const pick = await vscode.window.showQuickPick([
      { label: '$(add) Open another file…', add: true },
      ...opened.map(reader => ({ label: path.basename(vscode.Uri.parse(reader.snapshot().uri).fsPath), description: reader.snapshot().name, detail: reader.isBusy() ? 'Generating…' : reader.hasPanel() ? 'Open Yamori tab' : 'Prepared explanation', reader }))
    ], { title: 'Yamori · Switch files', placeHolder: 'Switch tabs without regenerating, or open another file.', matchOnDescription: true });
    if (pick?.add) return browse();
    if (pick?.reader) { activeReader = pick.reader; pick.reader.focus(); }
  }
  async function project(uri) {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Yamori.');
    const root = uri instanceof vscode.Uri ? uri : vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('Open a project folder first.');
    const found = await files(root);
    if (found.length > 500) throw new Error('More than 500 source files. Choose a smaller folder in the Explorer.');
    if (!found.length) throw new Error('No supported source files found in this folder.');
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
  command('yamori.read', open); command('yamori.browse', browse); command('yamori.project', project); command('yamori.switchFile', switchFile);
  command('yamori.connectClaude', () => connectClaude(context));
  for (const [id, method] of [['provider', 'chooseProvider'], ['model', 'chooseModel'], ['effort', 'chooseEffort'], ['colors', 'chooseReadingColors']]) {
    command('yamori.' + id, async () => { const reader = current(); if (!reader) return browse(); reader.focus(); await reader[method](); });
  }
  command('yamori.clear', async () => {
    await Promise.all([...readers.values()].map(reader => reader.clear()));
    await fs.rm(path.join(context.globalStorageUri.fsPath, 'cache'), { recursive: true, force: true });
    vscode.window.setStatusBarMessage('Yamori cache cleared', 2000);
  });
  const launcher = vscode.window.createStatusBarItem('yamori.open', vscode.StatusBarAlignment.Right, 110);
  launcher.name = 'Open in Yamori';
  launcher.text = '$(yamori-gecko) Yamori';
  function updateLauncher(editor) {
    if (editor) lastEditor = editor;
    const doc = editor?.document;
    if (!vscode.workspace.isTrusted || !doc || !['file', 'untitled'].includes(doc.uri.scheme)) {
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
  if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => { for (const reader of readers.values()) void reader.check(doc.uri, 'save').catch(() => {}); }));
  if (vscode.window.onDidChangeWindowState) context.subscriptions.push(vscode.window.onDidChangeWindowState(state => { if (state.focused) for (const reader of readers.values()) void reader.check(undefined, 'focus').catch(() => {}); }));
  context.subscriptions.push({ dispose() { const closing = [...readers.values()].map(reader => reader.dispose()); readers.clear(); return Promise.all(closing); } });
}

function createReader(context, navigation) {
  let panel, source, result, refreshBase, error = '', stale = false, busy = false, controller, serial = 0, progress, preview, startedAt;
  let selectedModel, modelNotice = '', activity = [];
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
    source = { ...next, callContext: next.callContext || source.callContext };
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
  const keyFor = (s, opts) => cacheKey(s, opts.level, opts.provider, opts.model || opts.effort !== 'low' ? JSON.stringify([opts.revision?.id || '', opts.model, opts.effort]) : opts.revision?.id || '');
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
  const view = () => ({ readingPalette: context.globalState.get('readingPalette', 'auto'), name: source?.name, providerLabel: PROVIDERS[provider], requestedModel: options().model, requestedEffort: options().effort, modelNotice, level, result: preview?.sections?.length ? preview : result, busy, stale, error, progress, startedAt, partial: !!preview?.sections?.length, model: selectedModel, effort: busy ? options().effort : result?.effort, activity, staleBlocks: [...staleBlocks], removedBlocks: [...removedBlocks], changedAt, checkedAt, changeReason, sharedChange, sourceMissing, cacheWarning, cacheSavedAt, draftScope: scopeFor(), draftKeys: result?.sections.map((section, index) => hash(JSON.stringify([section.title, index]))), drafts: [...(draftScopes.get(scopeFor())?.values() || [])], documentKey: source ? keyFor(source, options()) : undefined });
  function post() { panel?.webview.postMessage({ type: 'state', state: view() }); }
  function cancel() { serial++; controller?.abort(); controller = undefined; busy = false; preview = undefined; progress = undefined; startedAt = undefined; clearHighlight(); }
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
          case 'connectClaude': {
            const notice = await navigation.connectClaude();
            if (notice) { error = ''; modelNotice = notice; post(); }
            break;
          }
          case 'provider': await chooseProvider(); break;
          case 'model': await chooseModel(); break;
          case 'effort': await chooseEffort(); break;
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
                const saved = await disk.latest(source, options());
                if (saved) { const latest = source; source = saved.meta.source; result = saved.value; restoreStatus(saved.meta); applySource(latest, 'Source changed since this cached view'); }
                else { result = lowerView(previous, previousLevel, level); staleBlocks = new Set(result?.sections.map((_, index) => index) || []); stale = true; if (!result) error = 'This level has no cached view yet. Use Refresh all to update it.'; }
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
  function assertTrusted() {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Yamori.');
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
    const config = vscode.workspace.getConfiguration('yamori');
    const choice = context.globalState.get(provider + 'Model');
    const model = typeof choice?.id === 'string' ? choice.id : '';
    const override = context.globalState.get('effortChoices', {})[provider + ':' + model];
    const effort = override === 'auto' ? null : typeof override === 'string' ? override : model ? choice.effort ?? null : provider === 'claude' ? null : 'low';
    return { provider, level, model, effort, cliPath: config.get(provider === 'claude' ? 'claudePath' : 'codexPath'), revision: snapshot && revisions.get(revisionKey(snapshot, provider)) };
  }
  async function cached(s, opts) {
    if (opts.revision?.level === opts.level && matchesModel(opts.revision.value, opts)) return opts.revision.value;
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
    return request.finally(() => { if (inFlight === request) inFlight = undefined; });
  }
  async function runExplanation(force) {
    assertTrusted(); if (!source) return;
    modelNotice = '';
    cancel(); const id = serial; let snapshot = stale ? { ...source, callContext: undefined } : source;
    if (!snapshot.callContext) {
      busy = true; progress = 'Finding function definitions'; post();
      snapshot = await collectCallContext(snapshot);
      if (id !== serial) return;
      source = snapshot; trackSources();
    }
    await loadRevision(snapshot, provider);
    if (id !== serial) return;
    const opts = options(snapshot);
    await loadDrafts();
    const ready = !force && memory.get(keyFor(snapshot, opts));
    if (ready) { restoreStatus(ready._cacheMeta); result = ready; selectedModel = ready.model; error = ''; busy = false; progress = undefined; post(); return; }
    error = ''; busy = true; startedAt = Date.now(); progress = 'Checking cache'; activity = []; selectedModel = undefined; post();
    const task = new AbortController(); controller = task;
    try {
      let value = force ? undefined : await cached(snapshot, opts);
      if (value) restoreStatus(value._cacheMeta);
      if (id !== serial) return;
      if (!value) {
        if (id !== serial) return;
        value = await generate({ source: snapshot, ...opts, signal: task.signal, onProgress: update => {
          if (id !== serial || task.signal.aborted) return;
          progress = update.phase;
          if (update.model) selectedModel = update.model;
          if (activity.at(-1) !== update.phase) activity.push(update.phase);
          if (update.preview) preview = update.preview;
          post();
        } });
        if (id !== serial || task.signal.aborted) return;
        if (!await stillCurrent(snapshot)) { await inspect(undefined, 'change'); return; }
        staleBlocks.clear(); removedBlocks.clear(); stale = false; sourceMissing = false; changedRanges = [];
        await save(snapshot, opts, value);
      }
      if (id !== serial) return;
      result = value;
      if (!value._cacheMeta) await save(snapshot, opts, value);
      selectedModel = value.model || selectedModel;
      if (activity.length) activity.push('Ready');
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === snapshot.uri);
      stale = sharedChange || staleBlocks.size > 0 || (doc ? hash(doc.getText()) !== snapshot.fullHash : false);
    } catch (e) { if (id === serial && !task.signal.aborted) error = e.message; }
    finally { if (id === serial) { busy = false; controller = undefined; preview = undefined; progress = undefined; post(); } }
  }
  async function updateBlock(message) {
    assertTrusted();
    if (busy || sourceMissing || staleBlocks.has(message.index) || !source || !result || !Number.isInteger(message.index)) return;
    const original = result.sections[message.index];
    if (!original || message.documentKey !== view().documentKey || message.baseText !== original.pseudocode) throw new Error('This block changed. Reopen its editor before updating.');
    if (typeof message.draft !== 'string' || !message.draft.trim() || message.draft.length > 30000 || typeof message.instruction !== 'string' || message.instruction.length > 10000) throw new Error('Enter a nonempty draft and a shorter instruction.');
    const snapshot = source, base = result;
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === snapshot.uri);
    if (doc && hash(doc.getText()) !== snapshot.fullHash) throw new Error('Source changed. Refresh before editing this explanation.');
    cancel(); const id = serial, opts = options(snapshot), task = new AbortController(); controller = task;
    busy = true; modelNotice = ''; startedAt = Date.now(); activity = []; progress = 'Updating block'; post();
    try {
      const updated = await generate({ source: snapshot, ...opts, edit: { section: original, draft: message.draft, instruction: message.instruction }, signal: task.signal, onProgress: update => {
        if (id !== serial || task.signal.aborted) return;
        progress = update.phase; if (update.model) selectedModel = update.model;
        if (activity.at(-1) !== update.phase) activity.push(update.phase);
        // Keep all other blocks untouched while the selected one streams.
        if (update.preview?.sections?.[0]) preview = { ...base, sections: base.sections.map((s, i) => i === message.index ? { ...update.preview.sections[0], title: original.title } : s) };
        post();
      } });
      if (id !== serial || task.signal.aborted) return;
      if (!await stillCurrent(snapshot)) { await inspect(undefined, 'change'); throw new Error('Source changed during the edit. Your previous explanation was kept.'); }
      if (id !== serial || task.signal.aborted) return;
      const replacement = updated.sections[0];
      const value = { ...base, edited: true, views: undefined, model: updated.model || base.model, requestedModel: opts.model, requestedEffort: opts.effort, effort: updated.effort, sections: base.sections.map((s, i) => i === message.index ? { ...s, pseudocode: replacement.pseudocode, lineMap: replacement.lineMap } : s) };
      const revision = await persistRevision(snapshot, opts, value);
      await draftApplied(message.index, original.title);
      // New revision keys invalidate every other level without deleting the old
      // approved result. Those views are derived lazily when next requested.
      await save(snapshot, { ...opts, revision }, value);
      if (id !== serial) return;
      result = value; selectedModel = value.model; error = ''; activity.push('Block updated and cached');
    } catch (e) { if (id === serial && !task.signal.aborted) error = e.message; }
    finally { if (id === serial) { busy = false; controller = undefined; preview = undefined; post(); } }
  }
  async function read(doc, selection, settings = {}) {
    assertTrusted(); sourceColumn = settings.sourceColumn || sourceColumn;
    const next = await stamp(capture(doc, selection));
    if (source && result && source.uri === next.uri && source.selected === next.selected && (!next.selected || (source.startLine === next.startLine && source.endLine === next.endLine)) && matchesModel(result, options())) {
      applySource(next, 'Source file changed');
      if (settings.show !== false) { ensurePanel(); post(); }
      return inFlight;
    }
    if (source && !stale && source.fullHash === next.fullHash && busy) { if (settings.show !== false) ensurePanel(); return inFlight; }
    cancel();
    const saved = await disk.latest(next, options(next));
    if (saved) {
      source = saved.meta.source; result = saved.value; restoreStatus(saved.meta); selectedModel = result.model; error = '';
      await loadDrafts(); applySource(next, 'Source changed since the cached explanation');
      if (settings.openSource) await showSource();
      if (settings.show !== false) { ensurePanel(); post(); }
      await inspect(undefined, 'open');
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
    assertTrusted();
    if (busy) return;
    await inspect(undefined, 'refresh');
    if (sourceMissing) throw new Error('The source is unavailable. Restore the file or choose another script before refreshing.');
    if (!result && !refreshBase) { await explain(true); return; }
    const one = Number.isInteger(index);
    if (one && (!result.sections[index] || removedBlocks.has(index))) throw new Error('This code block was removed. Use Refresh all to reorganize the explanation.');
    const base = result || refreshBase, previousSource = source, pending = [...staleBlocks];
    const contextSource = await collectCallContext({ ...source, callContext: undefined });
    const original = one ? base.sections[index] : undefined;
    const scope = one ? { ...contextSource, startLine: original.startLine, endLine: original.endLine, text: contextSource.text.split('\n').slice(original.startLine - contextSource.startLine, original.endLine - contextSource.startLine + 1).join('\n'), callContext: undefined } : contextSource;
    const requestSource = one ? await collectCallContext(scope) : scope;
    if (source.fullHash !== previousSource.fullHash || !await stillCurrent(contextSource)) { await inspect(undefined, 'change'); return; }
    if (Buffer.byteLength(requestSource.text) > MAX_BYTES) throw new Error('Select a smaller code range before refreshing.');
    cancel(); const id = serial, opts = options(contextSource), task = new AbortController(); controller = task;
    busy = true; error = ''; startedAt = Date.now(); activity = []; progress = one ? 'Updating cached block' : 'Updating cached explanation'; post();
    try {
      const updated = await generate({ source: requestSource, ...opts, sourceRefresh: { index: one ? index : undefined, patch: !one && !sharedChange && pending.length > 0 && pending.length < base.sections.length, previous: base, staleBlocks: pending, changedRanges, sharedContext: one ? contextSource.text.split('\n').slice(0, 40).map((line, i) => (contextSource.startLine + i) + ': ' + line).join('\n').slice(0, 6000) : '' }, signal: task.signal, onProgress: update => {
        if (id !== serial || task.signal.aborted) return;
        progress = update.phase; if (update.model) selectedModel = update.model;
        if (activity.at(-1) !== update.phase) activity.push(update.phase);
        // Cached text remains visible and authoritative until the update validates.
        post();
      } });
      if (id !== serial || task.signal.aborted || source.fullHash !== previousSource.fullHash) return;
      if (!await stillCurrent(contextSource)) { await inspect(undefined, 'change'); return; }
      if (id !== serial || task.signal.aborted || source.fullHash !== previousSource.fullHash) return;
      let value;
      if (one) {
        const replacement = updated.sections[0];
        value = { ...base, title: updated.title || base.title, summary: updated.summary || base.summary, views: undefined, model: updated.model || base.model, requestedModel: opts.model, requestedEffort: opts.effort, sections: base.sections.map((section, i) => i === index ? { ...replacement, title: replacement.title || section.title, startLine: section.startLine, endLine: section.endLine } : section) };
      } else value = updated;
      const freshStatus = { ...status(), staleBlocks: one ? pending.filter(item => item !== index) : [], removedBlocks: one ? [...removedBlocks].filter(item => item !== index) : [], changedRanges: one ? changedRanges : [], sharedChange: one && sharedChange, sourceMissing: false, checkedAt: Date.now() };
      const revision = await persistRevision(contextSource, opts, value, freshStatus);
      const saved = await save(contextSource, { ...opts, revision }, value, freshStatus);
      if (id !== serial || task.signal.aborted) return;
      source = contextSource; trackSources(); result = value; refreshBase = undefined; restoreStatus({ ...freshStatus, savedAt: saved ? cacheSavedAt : undefined });
      selectedModel = value.model; activity.push(saved ? one ? 'Block refreshed and cached' : 'Explanation refreshed and cached' : 'Updated; local cache needs attention');
    } catch (e) { if (id === serial && !task.signal.aborted) error = e.message; }
    finally { if (id === serial) { busy = false; controller = undefined; preview = undefined; progress = undefined; post(); } }
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
    read, showSource, chooseProvider, chooseModel, chooseEffort, chooseReadingColors,
    snapshot: () => source, isBusy: () => busy, hasPanel: () => !!panel, failure: () => error,
    stop: cancel,
    focus() { ensurePanel(); post(); },
    async clear() { clearTimeout(persistTimer); for (const timer of watchTimers.values()) clearTimeout(timer); watchTimers.clear(); cancel(); result = undefined; refreshBase = undefined; await disk.flush(); memory.clear(); revisions.clear(); revisionLoaded.clear(); draftScopes.clear(); error = ''; cacheWarning = ''; restoreStatus(); panel?.webview.postMessage({ type: 'cacheCleared' }); post(); },
    changed, check: inspect,
    dispose() {
      if (disposed) return;
      const pendingSave = !!persistTimer; clearTimeout(persistTimer); persistTimer = undefined;
      disposed = true; for (const timer of watchTimers.values()) clearTimeout(timer); watchTimers.clear(); cancel(); clearHighlight();
      const closing = pendingSave && source && result ? save(source, options(), result) : disk.flush();
      panel?.dispose?.(); panel = undefined;
      for (const subscription of context.subscriptions.splice(0)) subscription?.dispose?.();
      navigation.closed(reader);
      return closing;
    }
  };
  return reader;
}
module.exports = { activate, migratePreferences, collectCallContext, connectClaude };
