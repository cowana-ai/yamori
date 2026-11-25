'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, parseResult } = require('../ai/engine');
const { LocalCache, linePlan } = require('../storage/cache');
const { panelHTML } = require('./reader');
const { workspaceRows } = require('../project/reader-workspace');
const { Indexer, gitInfo, locateProject } = require('../project/graph');
const { validRef, comparison, changedFiles, relativePath, sourcePair, workingSnapshot, behaviorChanges, inlineLayout } = require('../project/diff-review');

const SCHEME = 'yamori-review-source';
const STATUS = { A: 'Added', D: 'Deleted', M: 'Modified', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Unmerged' };
const MODES = [
  { mode: 'working', label: 'Working changes', description: 'Staged, unstaged and new files against HEAD' },
  { mode: 'branch', label: 'Branch or pull request', description: 'Compare a local head ref against its merge base' },
  { mode: 'revisions', label: 'Two revisions', description: 'Compare two local Git snapshots directly' }
];
function createDiffReview(context, api, { cacheEnabled, explain, maxExplanationBytes }) {
  const disk = new LocalCache(path.join(context.globalStorageUri.fsPath, 'cache'));
  const documents = new Map();
  let indexer;
  let panel, current, launch = 0;
  const releaseClosedTabs = () => {
    const tabs = api.window.tabGroups?.all;
    if (!tabs) return;
    const open = new Set(tabs.flatMap(group => group.tabs.flatMap(tab => [tab.input?.original?.toString(), tab.input?.modified?.toString()])));
    for (const [key, record] of documents) if (!record.opening && !open.has(key) && !current?.documentKeys?.includes(key)) documents.delete(key);
  };
  const provider = api.workspace.registerTextDocumentContentProvider?.(SCHEME, {
    provideTextDocumentContent(uri) { return documents.get(uri.toString())?.text; }
  });
  const tabListener = api.window.tabGroups?.onDidChangeTabs?.(releaseClosedTabs);
  if (provider) context.subscriptions.push(provider);
  if (tabListener) context.subscriptions.push(tabListener);

  async function repoFor(target) {
    if (target?.scheme === 'file') {
      const repo = await gitInfo(path.dirname(target.fsPath));
      if (repo) return repo.root;
    }
    const candidates = await Promise.all((api.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').map(folder => gitInfo(folder.uri.fsPath)));
    const roots = [...new Set(candidates.filter(Boolean).map(repo => repo.root))];
    if (!roots.length) throw new Error('Yamori could not find a local Git repository.');
    if (roots.length === 1) return roots[0];
    const pick = await api.window.showQuickPick(roots.map(root => ({ label: path.basename(root), description: root })), { placeHolder: 'Choose a Git repository' });
    return pick?.description;
  }

  async function chooseComparison() {
    const selected = await api.window.showQuickPick(MODES, { placeHolder: 'Choose what to compare' });
    if (!selected || selected.mode === 'working') return selected;
    const ask = (prompt, placeHolder, value) => api.window.showInputBox({ prompt, placeHolder, value, validateInput: text => validRef(text.trim()) ? undefined : 'Enter a local Git ref or commit.' });
    const base = await ask('Base ref', 'origin/main or a commit');
    if (!base) return;
    const head = await ask('Head ref', 'Local PR branch, refs/pull/123/head or a commit', 'HEAD');
    if (head) return { ...selected, base: base.trim(), head: head.trim() };
  }

  function localEdits(root) {
    return new Map((api.workspace.textDocuments || []).filter(doc => doc.uri.scheme === 'file' && doc.isDirty)
      .map(doc => [relativePath(root, doc.uri.fsPath), doc]).filter(([rel]) => rel));
  }

  async function fileList(root, pair) {
    return changedFiles(root, pair, [...localEdits(root).keys()]);
  }

  async function chooseFile(files, preferred) {
    const picks = files.map(file => ({ label: file.after || file.before, description: STATUS[file.status], detail: file.status === 'R' ? 'From ' + file.before : undefined, file }));
    const first = picks.findIndex(pick => pick.label === preferred);
    if (first > 0) picks.unshift(...picks.splice(first, 1));
    return (await api.window.showQuickPick(picks, { placeHolder: 'Choose a changed file', matchOnDescription: true, matchOnDetail: true }))?.file;
  }

  function reviewSource(root, rel, text) {
    if (!rel) return undefined;
    const target = api.Uri.file(path.join(root, rel));
    const uri = target.toString();
    const workspace = api.workspace.getWorkspaceFolder?.(target)?.uri?.fsPath || root;
    return {
      uri, workspace, relPath: relativePath(workspace, target.fsPath) || rel, name: rel, text, fullText: text, fullHash: hash(text), selected: false,
      startLine: 1, endLine: text.split('\n').length,
      language: (api.workspace.textDocuments || []).find(doc => doc.uri.toString() === uri)?.languageId || path.extname(rel).slice(1) || 'text'
    };
  }

  async function savedViews(sources) {
    if (!cacheEnabled()) return [{}, {}];
    const cached = await disk.reviewViews(sources);
    return Promise.all(sources.map(async (source, index) => {
      if (!source) return {};
      const absolute = api.Uri.parse(source.uri).fsPath;
      const located = await locateProject(path.dirname(absolute), disk.root);
      const rel = relativePath(located.root, absolute);
      const shared = located.known && rel ? (await disk.json(path.join(located.dir, 'explanations.json')))?.[rel] : undefined;
      const views = {};
      for (const level of ['logic', 'overview']) {
        const view = shared?.[level], entry = cached[index][level];
        if (view?.hash === source.fullHash && (!entry || (view.savedAt || 0) > entry.at)) {
          try { views[level] = parseResult(JSON.stringify(view), source, { dropInvalidLinks: true }); } catch {}
        }
        if (!views[level] && entry) views[level] = entry.value;
      }
      return views;
    }));
  }

  function update(state) {
    if (state !== current || !panel) return;
    const name = state.file.after || state.file.before;
    panel.title = path.basename(name) + ' · Yamori';
    const side = state.views[1][state.level] ? 'after' : 'before';
    const cached = state.views[side === 'after' ? 1 : 0][state.level];
    const result = cached && { title: cached.title, summary: cached.summary, sections: cached.sections };
    const status = {
      identical: 'The source text is identical.',
      missing: 'Pseudocode is missing for this comparison.',
      partial: 'One version is cached.',
      notebook: 'Open the source diff to review the notebook file.',
      tooLarge: 'Open the source diff to review this large change.'
    }[state.view.status];
    const index = side === 'after' ? 1 : 0;
    const snapshot = state.sources[index];
    const stored = state.queue[index];
    const workspace = state.level === 'logic' && result && snapshot ? {
      rows: workspaceRows(snapshot, result, [], stored.syntax, {}, new Set(), stored.reviews),
      sections: result.sections, online: true, editable: false, loading: state.busy, activity: stored.activity,
      keywords: process.platform === 'darwin' ? '⌘' : 'Ctrl+', canUpdate: false
    } : undefined;
    panel.webview.postMessage({ type: 'state', state: {
      name, level: state.level, result, workspace, busy: state.busy, progress: 'Explaining the missing version…',
      documentKey: state.id + ':' + state.level,
      readingPalette: context.globalState?.get('readingPalette', 'auto'),
      comparison: { label: state.pair.baseLabel + ' → ' + state.pair.headLabel, side, status, notice: state.notice,
        generate: state.canGenerate && (state.needed.indices.length > 1 ? 'Explain both versions' : 'Explain missing version') },
      inlineDiff: { blocks: inlineLayout(result, state.view, side) }
    } });
  }

  function setView(state) {
    state.level ||= behaviorChanges(...state.texts, ...state.views).level ||
      (['logic', 'overview'].find(level => state.views[1][level]) || ['logic', 'overview'].find(level => state.views[0][level]) || 'logic');
    state.view = state.notebook ? { status: 'notebook', rows: [] } : behaviorChanges(...state.texts, ...state.views, state.level);
    state.needed = { level: state.level, indices: state.sources.flatMap((source, index) =>
      source?.text.trim() && !state.views[index][state.level] ? [index] : []) };
    state.canGenerate = ['missing', 'partial'].includes(state.view.status) && state.needed.indices.length > 0 &&
      state.needed.indices.every(index => Buffer.byteLength(state.sources[index].text) <= maxExplanationBytes);
  }

  function sourceUris(file, id) {
    return [file.before, file.after].map((rel, index) => api.Uri.from({
      scheme: SCHEME, path: '/' + (rel || file.after || file.before), query: id + (index ? '-after' : '-before')
    }));
  }

  async function working(snapshot, result, level, column) {
    if (api.workspace.isTrusted === false || !cacheEnabled() || snapshot.selected || snapshot.notebook || !snapshot.uri.startsWith('file:')) return;
    const absolute = api.Uri.parse(snapshot.uri).fsPath;
    const repo = await gitInfo(path.dirname(absolute));
    const rel = repo && relativePath(repo.root, absolute);
    if (!rel) return;
    const state = await workingSnapshot(repo.root, rel, snapshot.fullText ?? snapshot.text);
    if (!state) return;
    const [before] = await savedViews([reviewSource(repo.root, state.file.before, state.texts[0]), undefined]);
    const view = behaviorChanges(...state.texts, before, { [level]: result }, level);
    const blocks = inlineLayout(result, view, 'after');
    if (!Object.keys(blocks).length) return;
    return { blocks, view, ...state, column, uris: sourceUris(state.file, randomUUID()) };
  }

  async function openSource(state, line, preserveFocus = true) {
    const { uris, texts } = state;
    const keys = state.documentKeys = uris.map(uri => uri.toString());
    keys.forEach((key, index) => documents.set(key, { text: texts[index] ?? '', opening: true }));
    const lines = (texts[1] ?? '').split('\n').length;
    const start = Number.isInteger(line) ? Math.max(0, Math.min(lines - 1, line - 1)) : undefined;
    const options = { viewColumn: state.column, preview: true, preserveFocus, ...(start === undefined ? {} : { selection: new api.Range(start, 0, start, 0) }) };
    try {
      await api.commands.executeCommand('vscode.diff', ...uris, path.basename(state.file.after || state.file.before) + ' · ' + state.pair.baseLabel + ' → ' + state.pair.headLabel, options);
      if (start !== undefined) {
        const editor = api.window.visibleTextEditors?.find(editor => editor.viewColumn === state.column && editor.document.uri.toString() === keys[1]);
        editor?.revealRange(options.selection, api.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } finally {
      keys.forEach(key => { const record = documents.get(key); if (record) record.opening = false; });
      releaseClosedTabs();
    }
  }

  async function show(state, file, ticket) {
    const { root, pair } = state;
    const doc = !pair.head && localEdits(root).get(file.after);
    const texts = await sourcePair(root, pair, file, doc ? doc.getText() : undefined);
    const sources = [file.before, file.after].map((rel, index) => reviewSource(root, rel, texts[index]));
    const id = randomUUID(), notebook = [file.before, file.after].some(rel => /\.ipynb$/i.test(rel || ''));
    const views = notebook ? [{}, {}] : await savedViews(sources);
    const queue = await Promise.all(sources.map(async source => {
      if (!source || notebook) return { reviews: {}, activity: [] };
      indexer ||= new Indexer();
      const [syntax, store] = await Promise.all([indexer.extract(source.name, source.text).catch(() => undefined), disk.logicState(source)]);
      return { syntax, ...store };
    }));
    if (ticket !== launch) return;
    const uris = sourceUris(file, id);
    const model = { ...state, id, file, notebook, texts, sources, views, queue, uris, busy: false, notice: '', controller: undefined };
    setView(model);
    await openSource(model, undefined, !!panel);
    if (ticket !== launch) return;
    current?.controller?.abort();
    current = model;
    if (!panel) {
      panel = api.window.createWebviewPanel('yamori', path.basename(file.after || file.before) + ' · Yamori', api.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
      if (context.extensionUri && api.Uri.joinPath) panel.iconPath = api.Uri.joinPath(context.extensionUri, 'media', 'yamori.png');
      panel.onDidDispose(() => {
        launch++;
        current?.controller?.abort();
        panel = undefined;
        current = undefined;
        releaseClosedTabs();
      });
      panel.webview.onDidReceiveMessage(message => { void handle(message).catch(error => api.window.showErrorMessage(error.message)); });
      panel.webview.html = panelHTML(context.globalState?.get('readingPalette', 'auto'));
    }
    update(model);
    panel.reveal(undefined, false);
    releaseClosedTabs();
  }

  async function generateMissing(state) {
    if (!state.canGenerate || state.busy) return;
    const controller = state.controller = new AbortController();
    state.busy = true;
    state.notice = '';
    update(state);
    try {
      for (const index of state.needed.indices) {
        const source = state.sources[index], level = state.needed.level;
        const result = await explain(source, level, controller.signal);
        if (controller.signal.aborted) return;
        state.views[index][level] = result.value;
        Object.assign(state.views[index], result.value.views);
        if (cacheEnabled()) {
          const key = hash(JSON.stringify(['diff-review', source.uri, source.fullHash, result.opts]));
          await disk.save(source, result.opts, result.value, key, {}, { index: false }).catch(() => {
            state.notice = 'Yamori could not save the explanation to the local cache.';
          });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) state.notice = error.message;
    } finally {
      state.busy = false;
      setView(state);
      update(state);
    }
  }

  async function handle(message) {
    const state = current;
    if (!state || !message) return;
    if (message.type === 'ready') return update(state);
    if (message.type === 'showSource') return openSource(state, undefined, false);
    if (message.type === 'stop') { state.controller?.abort(); return; }
    if (message.type === 'level' && ['logic', 'overview'].includes(message.level) && !state.busy) {
      state.level = message.level; setView(state); update(state); return;
    }
    if (message.type === 'inlineDiffJump' && message.documentKey === state.id + ':' + state.level) {
      const row = Number.isInteger(message.id) && state.view.rows[message.id];
      if (row) return openSource(state, row.targetLine);
      return;
    }
    if (['reveal', 'revealStep'].includes(message.type) && Number.isInteger(message.index)) {
      const after = state.views[1][state.level], cached = after || state.views[0][state.level];
      const section = cached?.sections[message.index];
      const link = message.type === 'revealStep' ? section?.lineMap?.find(item => item.pseudocodeLine === message.pseudocodeLine) : section;
      if (link) {
        const line = after ? link.startLine : linePlan(state.texts[0] ?? '', state.texts[1] ?? '').map(link.startLine);
        return openSource(state, line);
      }
      return;
    }
    if (message.type === 'workspaceReview' && message.documentKey === state.id + ':' + state.level) {
      const index = state.views[1][state.level] ? 1 : 0;
      const snapshot = state.sources[index], stored = state.queue[index], cached = state.views[index][state.level];
      const row = snapshot && cached && workspaceRows(snapshot, cached, [], stored.syntax, {}, new Set(), stored.reviews)[message.index];
      if (row && row.identity === message.identity && row.contentHash === message.contentHash && !row.missing) {
        const reviews = { ...stored.reviews };
        if (row.reviewed) {
          for (const [id, saved] of Object.entries(reviews)) if (id === row.identity || saved.bodyHash === row.bodyHash) delete reviews[id];
        } else reviews[row.identity] = { contentHash: row.contentHash, bodyHash: row.bodyHash, kind: row.kind, at: Date.now() };
        stored.reviews = reviews;
        await disk.saveLogicState(snapshot, reviews, stored.activity);
        update(state);
      }
      return;
    }
    if (message.type === 'copyBlock' && message.documentKey === state.id + ':' + state.level) {
      const cached = state.views[1][state.level] || state.views[0][state.level];
      const text = cached?.sections[message.index]?.pseudocode;
      if (text) await api.env.clipboard.writeText(text);
      return;
    }
    if (message.type === 'explainComparison' && message.documentKey === state.id + ':' + state.level) return generateMissing(state);
    if (!['switchFile', 'refresh'].includes(message.type)) return;
    const ticket = ++launch;
    const { root, selection } = state;
    const pair = await comparison(root, selection.mode, selection.base, selection.head);
    const files = await fileList(root, pair);
    if (ticket !== launch) return;
    if (!files.length) {
      state.notice = 'The comparison is now clean. This is the last reviewed snapshot.';
      update(state);
      return;
    }
    const preferred = state.file.after || state.file.before;
    const file = (message.type === 'refresh' && files.find(item => (item.after || item.before) === preferred)) || await chooseFile(files, preferred);
    if (file && ticket === launch) await show({ root, pair, selection, column: state.column }, file, ticket);
  }

  async function start(uri) {
    if (api.workspace.isTrusted === false) throw new Error('Trust this workspace to review Git changes with Yamori.');
    const ticket = ++launch;
    const editor = api.window.activeTextEditor;
    const target = uri?.scheme === 'file' ? uri : editor?.document.uri;
    const root = current && (!target || target.scheme === SCHEME) ? current.root : await repoFor(target);
    if (!root || ticket !== launch) return;
    const selection = await chooseComparison();
    if (!selection || ticket !== launch) return;
    const pair = await comparison(root, selection.mode, selection.base, selection.head);
    const files = await fileList(root, pair);
    if (ticket !== launch) return;
    if (!files.length) return api.window.showInformationMessage('Yamori found no changed files for this comparison.');
    const file = await chooseFile(files, target?.scheme === 'file' ? relativePath(root, target.fsPath) : undefined);
    if (file && ticket === launch) await show({ root, pair, selection, column: panel && current ? current.column : editor?.viewColumn || api.window.tabGroups?.activeTabGroup.viewColumn || api.ViewColumn.One }, file, ticket);
  }

  context.subscriptions.push({ dispose() { panel?.dispose(); documents.clear(); } });
  async function openPatch(uri, before, after, column, line) {
    const file = { before: path.basename(uri.fsPath), after: path.basename(uri.fsPath) };
    const uris = sourceUris(file, randomUUID());
    await openSource({ file, texts: [before, after], uris, column,
      pair: { baseLabel: 'Current', headLabel: 'Preview' } }, line, true);
    return () => {
      const key = uris[1].toString();
      const tabs = api.window.tabGroups?.all.flatMap(group => group.tabs)
        .filter(tab => tab.input?.modified?.toString() === key) || [];
      if (tabs.length) return api.window.tabGroups.close(tabs);
    };
  }
  function against(snapshot, result, level, column, previous) {
    if (!api.Uri.from || !previous || previous.level !== level || !snapshot.uri.startsWith('file:')) return;
    const name = path.basename(api.Uri.parse(snapshot.uri).fsPath), texts = [previous.source.fullText ?? previous.source.text, snapshot.fullText ?? snapshot.text];
    const view = behaviorChanges(...texts, { [level]: previous.result }, { [level]: result }, level);
    const blocks = inlineLayout(result, view, 'after');
    if (!Object.keys(blocks).length) return;
    const file = { before: name, after: name };
    return { blocks, view, file, texts, column, uris: sourceUris(file, randomUUID()),
      pair: { baseLabel: 'Previously explained', headLabel: 'Working tree' } };
  }
  return { start, working, against, openSource, openPatch };
}

module.exports = { createDiffReview };
