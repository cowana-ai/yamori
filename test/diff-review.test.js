'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { hash, parseResult } = require('../src/ai/engine');
const { LocalCache } = require('../src/storage/cache');
const { behaviorChanges, changedFiles, comparison, sourcePair } = require('../src/project/diff-review');
const { createDiffReview } = require('../src/views/diff-review');

const opts = { provider: 'codex', level: 'logic' };
const before = 'x = 1\nprint(x)\n';
const after = 'x = 2\nprint(x)\n';
const explanation = (number, output = 'Print x.') => ({
  title: 'Print a number', summary: 'Set and print a number.',
  sections: [{ title: 'Set and print', startLine: 1, endLine: 2, pseudocode: 'Set x to ' + number + '.\n' + output,
    lineMap: [{ pseudocodeLine: 1, startLine: 1, endLine: 1 }, { pseudocodeLine: 2, startLine: 2, endLine: 2 }] }]
});
const snapshot = (file, text) => ({ uri: pathToFileURL(file).href, text, fullText: text, fullHash: hash(text), startLine: 1 });

async function repo(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-review-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const real = await fs.realpath(temp);
  const git = (...args) => execFileSync('git', args, { cwd: real, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Yamori Tests');
  git('config', 'user.email', 'tests@example.test');
  git('config', 'commit.gpgsign', 'false');
  return { root: real, git, write: (file, text) => fs.writeFile(path.join(real, file), text) };
}

test('pseudocode signs require a changed mapped step, and removed steps navigate into the source diff', () => {
  const old = { logic: explanation(1) }, next = { logic: explanation(2, 'Output the value x.') };
  const view = behaviorChanges(before, after, old, next);
  assert.equal(view.status, 'compared');
  assert.deepEqual(view.rows.map(({ kind, text, targetLine }) => [kind, text, targetLine]), [
    ['removed', 'Set x to 1.', 1], ['added', 'Set x to 2.', 1]
  ]);
  const shifted = explanation(1);
  shifted.sections[0].startLine++;
  shifted.sections[0].endLine++;
  for (const link of shifted.sections[0].lineMap) { link.startLine++; link.endLine++; }
  assert.equal(behaviorChanges(before, '# setup\n' + before, old, { logic: shifted }).rows.length, 0);
  assert.deepEqual(behaviorChanges(before, after, old, {}).rows.map(row => row.kind), ['touched']);
  assert.deepEqual(behaviorChanges(before, after, old, { overview: explanation(2) }).rows.map(row => row.kind), ['touched', 'touched']);
  assert.deepEqual(behaviorChanges('', after, {}, next).rows.map(row => row.kind), ['added', 'added']);
  assert.deepEqual(behaviorChanges(before, undefined, old).rows.map(row => row.kind), ['removed', 'removed']);
});

test('compact cards align their mapped actions with older cached pseudocode', () => {
  const cardFor = (number, text) => parseResult(JSON.stringify({
    title: 'Print a number', summary: 'Set and print a number.',
    sections: [{ title: 'Set and print', startLine: 1, endLine: 2, card: {
      p: 'Show a number.', i: 'None.', r: 'Nothing.', x: 'Prints to stdout.',
      s: ['1 Set x to ' + number + '.\nWHY: Use the literal.', '2 Print x.'], c: []
    } }]
  }), { text, startLine: 1 });
  const old = { logic: explanation(1) }, next = { logic: cardFor(2, after) };
  const view = behaviorChanges(before, after, old, next);
  assert.deepEqual(view.rows.map(({ kind, text, sourceLine }) => [kind, text, sourceLine]), [
    ['removed', 'Set x to 1.', 1], ['added', 'Set x to 2.', 1]
  ]);
  assert.deepEqual(behaviorChanges(undefined, after, {}, next).rows.map(row => row.text), ['Set x to 2.', 'Print x.']);
  const same = { logic: cardFor(1, after) };
  assert.equal(behaviorChanges(before, after, old, same).status, 'unchangedSteps');
});

test('working changes include staged, unstaged, unsaved, deleted and literal untracked paths', async t => {
  const { root, git, write } = await repo(t);
  await Promise.all(['staged.py', 'edit.py', 'unsaved.py', 'delete.py'].map(file => write(file, before)));
  git('add', '.');
  git('commit', '-qm', 'Base');
  await write('staged.py', after);
  git('add', 'staged.py');
  await write('edit.py', after);
  await write('[new]\nfile.py', after);
  await fs.unlink(path.join(root, 'delete.py'));
  const pair = await comparison(root, 'working');
  const files = await changedFiles(root, pair, ['unsaved.py']);
  const wanted = new Map(files.map(file => [file.after || file.before, file]));
  assert.deepEqual(Object.fromEntries([...wanted].map(([name, row]) => [name, row.status])), {
    '[new]\nfile.py': 'A', 'delete.py': 'D', 'edit.py': 'M', 'staged.py': 'M', 'unsaved.py': 'M'
  });
  assert.deepEqual(await sourcePair(root, pair, wanted.get('unsaved.py'), after), [before, after]);
  assert.deepEqual(await sourcePair(root, pair, wanted.get('delete.py')), [before, undefined]);
  assert.deepEqual(await sourcePair(root, pair, wanted.get('[new]\nfile.py')), [undefined, after]);
});

test('branch review uses the merge base, reads renames, and excludes dirty working files', async t => {
  const { root, git, write } = await repo(t);
  await write('old [file].py', before);
  git('add', '.');
  git('commit', '-qm', 'Common');
  const common = git('rev-parse', 'HEAD');
  git('switch', '-qc', 'pr');
  git('mv', 'old [file].py', 'renamed.py');
  git('commit', '-qm', 'PR rename');
  git('update-ref', 'refs/pull/55/head', 'HEAD');
  git('switch', '-q', 'main');
  await write('main.py', before);
  git('add', '.');
  git('commit', '-qm', 'Main advanced');
  await write('local.py', after);
  const pair = await comparison(root, 'branch', 'main', 'refs/pull/55/head');
  assert.equal(pair.base, common);
  const files = await changedFiles(root, pair, ['local.py']);
  assert.deepEqual(files, [{ status: 'R', before: 'old [file].py', after: 'renamed.py' }]);
  assert.deepEqual(await sourcePair(root, pair, files[0]), [before, before]);
  assert.equal((await changedFiles(root, await comparison(root, 'revisions', 'main', 'pr'))).length, 2);
  await assert.rejects(comparison(root, 'branch', '--help', 'pr'), /local Git ref/);
});

test('historical cache review requires both matching text and a complete current record', async t => {
  const { root } = await repo(t);
  const disk = new LocalCache(path.join(root, 'cache'));
  const file = path.join(root, 'example.py'), old = snapshot(file, before), next = snapshot(file, after);
  await disk.save(old, opts, explanation(1), hash('previous'));
  await disk.save(next, opts, explanation(2), hash('current'));
  await disk.save(next, opts, explanation(3), hash('stale'), { staleBlocks: [0] });
  await disk.save({ ...old, selected: true }, opts, explanation(4), hash('selection'));
  await disk.save(snapshot(path.join(root, 'another.py'), before), opts, explanation(5), hash('another'));
  const [oldViews, newViews] = await disk.reviewViews([old, next]);
  assert.equal(oldViews.logic.value.sections[0].pseudocode, 'Set x to 1.\nPrint x.');
  assert.equal(newViews.logic.value.sections[0].pseudocode, 'Set x to 2.\nPrint x.');
  await disk.save(old, opts, explanation(1), hash('review'), {}, { index: false });
  assert.equal((await disk.latest(next, opts)).meta.source.text, after);
});

test('the review opens native source with cached steps, jumps to changes and explains only a requested cache miss', async t => {
  const { root, git, write } = await repo(t);
  const storage = path.join(root, 'storage'), file = path.join(root, 'example.py');
  await write('example.py', before);
  git('add', '.');
  git('commit', '-qm', 'Base');
  const disk = new LocalCache(path.join(storage, 'cache'));
  await disk.save(snapshot(file, before), opts, explanation(1), hash('before'));
  await disk.save(snapshot(file, after), opts, explanation(2), hash('after'));
  await write('example.py', after);

  const commands = [];
  const uri = (scheme, pathname, query = '') => ({
    scheme, fsPath: pathname, toString: () => scheme === 'file' ? pathToFileURL(pathname).href : scheme + ':' + pathname + '?' + query
  });
  let provider, receive;
  const panel = { webview: { onDidReceiveMessage(fn) { receive = fn; }, postMessage(message) { this.state = message.state; } }, onDidDispose() {}, reveal() {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: storage } };
  const api = {
    workspace: { isTrusted: true, registerTextDocumentContentProvider(_scheme, value) { provider = value; } },
    window: {
      showQuickPick: async items => items[0], createWebviewPanel: () => panel,
      showErrorMessage: message => assert.fail(message)
    },
    Uri: { file: file => uri('file', file), parse: value => uri('file', fileURLToPath(value)), from: ({ scheme, path, query }) => uri(scheme, path, query) },
    ViewColumn: { One: 1, Beside: -2 },
    Range: class Range { constructor(line) { this.line = line; } },
    commands: { async executeCommand(command, left, right, _title, options) {
      commands.push({ command, before: provider.provideTextDocumentContent(left), after: provider.provideTextDocumentContent(right), options });
    } }
  };
  const third = 'x = 3\nprint(x)\n', generated = [];
  const reviewer = createDiffReview(context, api, {
    cacheEnabled: () => true, maxExplanationBytes: 120000,
    async explain(source, level) {
      generated.push([source.text, level]);
      return { value: explanation(3), opts: { ...opts, level } };
    }
  });
  const working = await reviewer.working(snapshot(file, after), explanation(2), 'logic', 1);
  assert.equal(working.blocks[0].marks[1].kind, 'added');
  assert.equal(working.blocks[0].removed[1][0].text, 'Set x to 1.');
  assert.deepEqual(generated, []);

  await reviewer.start(api.Uri.file(file));
  const initial = panel.webview.state;
  assert.match(panel.webview.html, /<title>Yamori<\/title>/);
  assert.equal(initial.inlineDiff.blocks[0].marks[1].kind, 'added');
  assert.equal(initial.inlineDiff.blocks[0].removed[1][0].text, 'Set x to 1.');
  assert.deepEqual(commands[0], { command: 'vscode.diff', before, after, options: { viewColumn: 1, preserveFocus: false, preview: true } });
  receive({ type: 'inlineDiffJump', documentKey: initial.documentKey, id: initial.inlineDiff.blocks[0].marks[1].id });
  assert.equal(commands[1].options.selection.line, 0);
  assert.deepEqual(generated, []);

  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 80 && !predicate(panel.webview.state); attempt++) await delay(25);
    assert.ok(predicate(panel.webview.state));
  };
  await write('example.py', third);
  receive({ type: 'refresh' });
  await waitFor(state => state.comparison.generate === 'Explain missing version');
  assert.deepEqual(generated, []);
  assert.equal(panel.webview.state.comparison.status, 'One version is cached.');
  const refreshed = panel.webview.state.documentKey;
  receive({ type: 'explainComparison', documentKey: initial.documentKey });
  assert.deepEqual(generated, [], 'messages belonging to a previous snapshot are ignored');
  receive({ type: 'explainComparison', documentKey: refreshed });
  await waitFor(state => state.inlineDiff.blocks[0]?.marks[1]?.text === 'Set x to 3.');
  assert.deepEqual(generated, [[third, 'logic']]);
  assert.equal((await disk.latest(snapshot(file, after), opts)).meta.source.text, after);
});
