'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { LEVELS, PROVIDERS, cacheKey, generate, hash, parseResult, lowerView, ORDER, listModels, listEfforts, findCLI, cliLaunch } = require('./engine');
const { panelHTML } = require('./panel');

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
    for (const reader of readers.values()) reader.clear();
    await fs.rm(path.join(context.globalStorageUri.fsPath, 'cache'), { recursive: true, force: true });
    vscode.window.setStatusBarMessage('Yamori cache cleared', 2000);
  });
  const launcher = vscode.window.createStatusBarItem('yamori.open', vscode.StatusBarAlignment.Right, 110);
  launcher.name = 'Open in Yamori';
  launcher.text = '$(book) Yamori';
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
  context.subscriptions.push({ dispose() { for (const reader of [...readers.values()]) reader.dispose(); readers.clear(); } });
}

function createReader(context, navigation) {
  let panel, source, result, error = '', stale = false, busy = false, controller, serial = 0, progress, preview, startedAt;
  let selectedModel, modelNotice = '', activity = [];
  let level = context.globalState.get('detail', 'logic');
  let provider = context.globalState.get('provider', 'codex');
  if (!LEVELS[level]) level = 'logic';
  if (!PROVIDERS[provider]) provider = 'codex';
  let sourceColumn = vscode.ViewColumn.One, disposed = false, inFlight;
  const cacheDir = path.join(context.globalStorageUri.fsPath, 'cache');
  const memory = new Map(), revisions = new Map(), revisionLoaded = new Set();
  const revisionKey = (s, owner) => cacheKey(s, 'revision', owner);
  async function loadRevision(s, owner) {
    const key = revisionKey(s, owner);
    if (revisionLoaded.has(key)) return;
    revisionLoaded.add(key);
    try {
      const saved = JSON.parse(await fs.readFile(path.join(cacheDir, 'revisions', key + '.json'), 'utf8'));
      if (!LEVELS[saved.level] || typeof saved.id !== 'string') return;
      saved.value = parseResult(JSON.stringify(saved.value), s);
      revisions.set(key, saved);
    } catch {}
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
  const view = () => ({ readingPalette: context.globalState.get('readingPalette', 'auto'), name: source?.name, providerLabel: PROVIDERS[provider], requestedModel: options().model, requestedEffort: options().effort, modelNotice, level, result: preview?.sections?.length ? preview : result, busy, stale, error, progress, startedAt, partial: !!preview?.sections?.length, model: selectedModel, effort: busy ? options().effort : result?.effort, activity, documentKey: source ? keyFor(source, options()) : undefined });
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
          case 'level':
            if (!LEVELS[message.level] || message.level === level) break;
            cancel(); level = message.level; result = undefined; error = '';
            void context.globalState.update('detail', level);
            if (source) await explain(false);
            else post();
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
      uri: doc.uri.toString(), text, language: doc.languageId, startLine: start + 1, endLine: end + 1, selected,
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
      try {
        const value = parseResult(await fs.readFile(path.join(cacheDir, keyFor(s, candidateOpts) + '.json'), 'utf8'), s);
        remember(s, candidateOpts, value);
        return memory.get(keyFor(s, opts));
      } catch { /* Try a higher-detail cached view before generating. */ }
    }
    return undefined;
  }
  async function save(s, opts, value) {
    remember(s, opts, value);
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      const filename = path.join(cacheDir, keyFor(s, opts) + '.json');
      await fs.writeFile(filename, JSON.stringify(value), { mode: 0o600 });
      const entries = (await fs.readdir(cacheDir)).filter(name => name.endsWith('.json'));
      if (entries.length > 100) {
        const dated = await Promise.all(entries.map(async name => ({ name, time: (await fs.stat(path.join(cacheDir, name))).mtimeMs })));
        dated.sort((a, b) => a.time - b.time);
        await Promise.all(dated.slice(0, entries.length - 100).map(f => fs.unlink(path.join(cacheDir, f.name))));
      }
    } catch { /* Cache is optional; an explanation should still be shown. */ }
  }
  function explain(force) {
    const request = runExplanation(force);
    inFlight = request;
    return request.finally(() => { if (inFlight === request) inFlight = undefined; });
  }
  async function runExplanation(force) {
    assertTrusted(); if (!source) return;
    modelNotice = '';
    cancel(); const id = serial; let snapshot = source;
    if (!snapshot.callContext) {
      busy = true; progress = 'Finding function definitions'; post();
      snapshot = await collectCallContext(snapshot);
      if (id !== serial) return;
      source = snapshot;
    }
    await loadRevision(snapshot, provider);
    if (id !== serial) return;
    const opts = options(snapshot);
    const ready = !force && memory.get(keyFor(snapshot, opts));
    if (ready) { result = ready; selectedModel = ready.model; error = ''; busy = false; progress = undefined; post(); return; }
    error = ''; busy = true; startedAt = Date.now(); progress = 'Checking cache'; activity = []; selectedModel = undefined; post();
    const task = new AbortController(); controller = task;
    try {
      let value = force ? undefined : await cached(snapshot, opts);
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
        await save(snapshot, opts, value);
      }
      if (id !== serial) return;
      result = value;
      selectedModel = value.model || selectedModel;
      if (activity.length) activity.push('Ready');
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === snapshot.uri);
      stale = doc ? hash(doc.getText()) !== snapshot.fullHash : false;
    } catch (e) { if (id === serial && !task.signal.aborted) error = e.message; }
    finally { if (id === serial) { busy = false; controller = undefined; preview = undefined; progress = undefined; post(); } }
  }
  async function updateBlock(message) {
    assertTrusted();
    if (busy || stale || !source || !result || !Number.isInteger(message.index)) return;
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
      if (doc && hash(doc.getText()) !== snapshot.fullHash) throw new Error('Source changed during the edit. Your previous explanation was kept.');
      const replacement = updated.sections[0];
      const value = { ...base, edited: true, views: undefined, model: updated.model || base.model, requestedModel: opts.model, requestedEffort: opts.effort, effort: updated.effort, sections: base.sections.map((s, i) => i === message.index ? { ...s, pseudocode: replacement.pseudocode, lineMap: replacement.lineMap } : s) };
      const revision = { id: hash(JSON.stringify(value)), level: opts.level, value };
      const revisionDir = path.join(cacheDir, 'revisions'); await fs.mkdir(revisionDir, { recursive: true });
      const file = path.join(revisionDir, revisionKey(snapshot, opts.provider) + '.json');
      const temporary = file + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(revision), { mode: 0o600 });
      if (id !== serial || task.signal.aborted) { await fs.unlink(temporary).catch(() => {}); return; }
      await fs.rename(temporary, file);
      revisions.set(revisionKey(snapshot, opts.provider), revision);
      // New revision keys invalidate every other level without deleting the old
      // approved result. Those views are derived lazily when next requested.
      await save(snapshot, { ...opts, revision }, value);
      if (id !== serial) return;
      result = value; selectedModel = value.model; error = ''; activity.push('Block updated and cached');
    } catch (e) { if (id === serial && !task.signal.aborted) error = e.message; }
    finally { if (id === serial) { busy = false; controller = undefined; preview = undefined; post(); } }
  }
  async function read(doc, selection, settings = {}) {
    assertTrusted();
    sourceColumn = settings.sourceColumn || sourceColumn;
    const next = capture(doc, selection);
    if (source && !stale && source.uri === next.uri && source.text === next.text && source.startLine === next.startLine && source.endLine === next.endLine && source.fullHash === next.fullHash && (busy || (result && matchesModel(result, options())))) {
      if (settings.show !== false) { ensurePanel(); post(); }
      return inFlight;
    }
    cancel(); source = next; result = undefined; stale = false; error = '';
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
  async function refresh() {
    if (!source) return navigation.open();
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(source.uri));
    const selection = source.selected ? new vscode.Selection(source.startLine - 1, 0, Math.min(source.endLine - 1, doc.lineCount - 1), doc.lineAt(Math.min(source.endLine - 1, doc.lineCount - 1)).text.length) : undefined;
    source = capture(doc, selection); stale = false; await explain(true);
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
      { label: 'Follow editor', id: 'auto', description: 'Paper in light themes; Slate in dark themes' },
      { label: 'Paper', id: 'paper', description: 'Dark navy text, warm paper, teal and amber accents' },
      { label: 'Slate', id: 'slate', description: 'Warm light text on dark slate, soft teal accents' }
    ];
    const picked = await vscode.window.showQuickPick(choices, { title: 'Yamori · Reading colors', placeHolder: 'Applies immediately. No generation needed.' });
    if (!picked || !choices.some(choice => choice.id === picked.id)) return;
    await context.globalState.update('readingPalette', picked.id); post();
  }
  async function reveal(index, pseudocodeLine) {
    if (!source || !result || !Number.isInteger(index) || stale) return;
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
    if (!source || !result || stale || !Number.isInteger(index) || !Number.isInteger(pseudocodeLine)) return;
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
    clear() { cancel(); memory.clear(); revisions.clear(); revisionLoaded.clear(); result = undefined; error = ''; post(); },
    changed(event) {
      if (source && event.document.uri.toString() === source.uri) { clearHighlight(); stale = hash(event.document.getText()) !== source.fullHash; post(); }
      else if (source?.callContext?.definitions.some(def => def.uri === event.document.uri.toString() && def.fullHash !== hash(event.document.getText()))) { clearHighlight(); stale = true; post(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancel(); clearHighlight();
      panel?.dispose?.(); panel = undefined;
      for (const subscription of context.subscriptions.splice(0)) subscription?.dispose?.();
      navigation.closed(reader);
    }
  };
  return reader;
}
module.exports = { activate, migratePreferences, collectCallContext, connectClaude };
