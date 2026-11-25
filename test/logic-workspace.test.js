'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { hash } = require('../src/ai/engine');
const { LocalCache, reconcileRefresh } = require('../src/storage/cache');
const { Indexer } = require('../src/project/graph');
const { blockRecords, workspaceRows, scaffold, sourcePreview } = require('../src/project/reader-workspace');
const { createStepPreview } = require('../src/project/step-preview');

const filename = '/demo/calc.py';
const snapshot = (text, file = filename, workspace = '/demo') => ({
  name: path.basename(file), uri: pathToFileURL(file).href, workspace, relPath: path.basename(file),
  startLine: 1, endLine: text.split('\n').length, text, fullText: text, fullHash: hash(text)
});

test('review hashes survive offset shifts and a uniquely identifiable rename, and invalidate on a body change', async t => {
  const indexer = new Indexer();
  const original = snapshot('def size():\n    return 2\n\ndef other():\n    return 3\n');
  const extract = source => indexer.extract(source.name, source.text);
  const syntax = await extract(original);
  const sections = scaffold(original, syntax).map(block => ({ ...block, pseudocode: 'Return the constant.' }));
  const value = { title: 'Constants', summary: 'Return constants.', sections };
  const records = blockRecords(original, sections, syntax, { model: 'test' });
  const reviews = Object.fromEntries(records.map(row => [row.identity, row]));
  const shifted = snapshot('\n\n' + original.text.replace('def size', 'def magnitude'));
  const origins = new Map(sections.map((item, index) => [index, { source: original, section: item }]));
  const moved = await reconcileRefresh(shifted, value, origins, indexer);
  assert.deepEqual(moved.staleBlocks, []);
  assert.equal(moved.value.sections[0].title, 'magnitude');
  const rows = workspaceRows(shifted, moved.value, [], await extract(shifted), { model: 'test' }, new Set(), reviews);
  assert.deepEqual(rows.map(row => [row.startLine, row.reviewed]), [[3, true], [6, true]]);
  const changed = snapshot(original.text.replace('return 2', 'return 9'));
  const dirty = workspaceRows(changed, value, [], await extract(changed), { model: 'test' }, new Set([0]), reviews);
  assert.deepEqual(dirty.map(row => [row.changed, row.reviewed]), [[true, false], [false, true]]);
  assert.notEqual(dirty[0].key, records[0].key);
  assert.equal(dirty[1].key, records[1].key);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-workspace-review-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const disk = new LocalCache(root);
  await disk.saveLogicState(original, reviews, [{ message: 'Reviewed the code.', at: 10 }]);
  assert.deepEqual(await new LocalCache(root).logicState(original), { reviews, activity: [{ message: 'Reviewed the code.', at: 10 }] });
});

test('a source preview preserves surrounding lines and line endings and can delete an entire range', () => {
  const before = 'header\r\nold\r\nfooter\r\n';
  const result = sourcePreview(before, 2, 2, 'new\nsecond');
  assert.equal(result.after, 'header\r\nnew\r\nsecond\r\nfooter\r\n');
  assert.deepEqual(result.ghosts, [{ line: 2, text: 'new' }, { line: 2, text: 'second' }]);
  assert.equal(sourcePreview(before, 2, 2, '').after, 'header\r\nfooter\r\n');
});

test('preview never writes, a stale proposal is rejected, and accepting a current proposal applies once', async () => {
  const uri = pathToFileURL(filename);
  let text = 'x = 1\n', writes = 0, shown = 0, regenerated = 0;
  const doc = { uri, getText: () => text, lineCount: 2, lineAt: i => ({ text: text.split('\n')[i] }) };
  const api = {
    Range: class {},
    workspace: { isTrusted: true, openTextDocument: async () => doc },
    window: { showTextDocument: async () => ({ document: doc, async edit(fn) {
      fn({ replace(_range, after) { text = after; writes++; } }); return true;
    } }) }
  };
  const preview = createStepPreview(api, {
    sourceUri: () => uri, changed() {}, activity() {}, async applied() { regenerated++; },
    openPatch: async () => { shown++; return () => { shown--; }; },
    scope: async () => ({ uri, sourceUri: uri, text, before: text.split('\n')[0], exists: true, startLine: 1, endLine: 1 }),
    request: async () => ({ raw: JSON.stringify({ edit: true, replacement: 'x = 2', message: '' }) })
  });
  const request = { clientId: 1, mode: 'step', instruction: 'Set x to two.' };
  await preview.preview(request);
  let id = preview.state().id;
  await preview.showDiff(id);
  assert.equal(shown, 1);
  assert.equal(writes, 0);
  preview.invalidate(uri);
  await preview.accept(id);
  assert.equal(writes, 0);
  assert.equal(shown, 0);
  assert.equal(preview.state().phase, 'stale');
  await preview.preview({ ...request, clientId: 2 });
  id = preview.state().id;
  await preview.accept(id);
  await preview.accept(id);
  assert.equal(text, 'x = 2\n');
  assert.equal(writes, 1);
  assert.equal(regenerated, 1);
  assert.equal(preview.undoState().id, id);
  await preview.undo(id);
  assert.equal(text, 'x = 1\n');
  assert.equal(preview.undoState(), undefined);
  await preview.preview({ ...request, clientId: 3 });
  await preview.accept(preview.state().id);
  text += '# later editor change\n';
  const writesBeforeConflict = writes;
  await preview.undo(preview.undoState().id);
  assert.equal(writes, writesBeforeConflict);
  assert.match(preview.undoState().error, /file changed/);
  assert.match(text, /later editor change/);
});

test('cancel aborts an in-flight preview before it can display or write changes', async () => {
  const uri = pathToFileURL(filename);
  let reply, started;
  const pending = new Promise(resolve => { started = resolve; });
  const preview = createStepPreview({ workspace: { isTrusted: true }, window: {} }, {
    changed() {}, activity() {}, applied() { assert.fail('cancelled changes were applied'); },
    scope: async () => ({ uri, sourceUri: uri, text: 'old', before: 'old', exists: true, startLine: 1, endLine: 1 }),
    openPatch() { assert.fail('cancelled diff was opened'); },
    request: ({ signal }) => new Promise(resolve => { reply = resolve; started(signal); })
  });
  const request = preview.preview({ clientId: 1, mode: 'command', instruction: 'Replace old.' });
  const signal = await pending;
  preview.cancel();
  assert.equal(signal.aborted, true);
  reply({ raw: JSON.stringify({ edit: true, replacement: 'new', message: '' }) });
  await request;
  assert.equal(preview.state(), undefined);
});

test('an accepted test uses an explicit create operation and a discarded test writes nothing', async () => {
  const uri = pathToFileURL('/demo/test_calc.py');
  const writes = [];
  const api = {
    Position: class {},
    WorkspaceEdit: class { constructor() { this.ops = []; } createFile(...args) { this.ops.push(args); } insert(...args) { this.ops.push(args); } },
    workspace: { isTrusted: true, async applyEdit(edit) { writes.push(edit.ops); return true; } },
    window: {}
  };
  const preview = createStepPreview(api, {
    changed() {}, activity() {}, async applied() {}, openPatch: async () => () => {},
    scope: async () => ({ uri, text: '', before: '', exists: false, wholeFile: true, test: true }),
    request: async () => ({ raw: JSON.stringify({ edit: true, replacement: 'def test_size():\n    assert size() == 2\n', message: '' }) })
  });
  const request = { clientId: 1, mode: 'test', instruction: 'Test the constant value.' };
  await preview.preview(request);
  assert.deepEqual(writes, []);
  preview.cancel();
  assert.deepEqual(writes, []);
  await preview.preview({ ...request, clientId: 2 });
  await preview.accept(preview.state().id);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0][0][1], { overwrite: false, ignoreIfExists: false });
  assert.match(writes[0][1][2], /^def test_size/);
});

test('reconciliation builds a focused payload only for blocks with changed lines', async () => {
  const oldText = ['def calculate():', '    left = 10', '    right = 20', '    total = left + right', '    scale = 2',
    '    factor = scale * 10', '    metric = total * factor', '    return metric', '', 'def separate():', '    return 500'].join('\n');
  const before = snapshot(oldText), after = snapshot(oldText.replace('scale = 2', 'scale = 3'));
  const indexer = new Indexer();
  const syntax = await indexer.extract(before.name, before.text);
  const sections = scaffold(before, syntax).map((block, index) => ({ ...block, pseudocode: index ? 'Return 500.' : 'Scale the total by 2.',
    lineMap: index ? [] : [{ pseudocodeLine: 1, startLine: 4, endLine: 4 }] }));
  const previous = { title: 'Calculations', summary: 'Calculate a metric.', sections };
  const origins = new Map(sections.map((section, index) => [index, { source: before, section }]));
  const layout = await reconcileRefresh(after, previous, origins, indexer, true);
  assert.deepEqual(layout.staleBlocks, [0]);
  assert.deepEqual([...layout.focused], [[0, { hunks: [{ removed: [[5, '    scale = 2']], added: [[5, '    scale = 3']], currentLine: 5 }],
    lineMap: [[1, 4, 4]] }]]);
  assert.deepEqual(layout.value.sections[1], sections[1]);
});

test('a moved symbol can reuse its cached block and links while a copied symbol cannot', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-moved-block-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const from = path.join(root, 'from.py'), to = path.join(root, 'to.py');
  const definition = 'def moved():\n    return 9\n';
  const stored = snapshot(definition + '\ndef remains():\n    return 0\n', from, root);
  const next = snapshot('\n' + definition, to, root);
  const indexer = new Indexer(), disk = new LocalCache(path.join(root, 'cache'));
  const opts = { provider: 'codex', level: 'logic', effort: 'low' };
  await fs.writeFile(from, stored.text);
  const oldSyntax = await indexer.extract(stored.name, stored.text), newSyntax = await indexer.extract(next.name, next.text);
  const sections = scaffold(stored, oldSyntax).map(section => ({ ...section,
    pseudocode: 'Return the constant.', lineMap: [{ pseudocodeLine: 1, startLine: section.endLine, endLine: section.endLine }] }));
  const old = { title: 'Two constants', summary: 'Return constants.', sections };
  await disk.save(stored, opts, old, hash('saved'), { workspaceBlocks: blockRecords(stored, sections, oldSyntax, opts) });
  const wanted = blockRecords(next, scaffold(next, newSyntax), newSyntax, opts);
  assert.equal((await disk.movedBlocks(next, opts, wanted)).size, 0);
  await fs.writeFile(from, 'def remains():\n    return 0\n');
  const origins = await disk.movedBlocks(next, opts, wanted);
  assert.equal(origins.size, 1);
  assert.equal(origins.get(0).section.title, 'moved');
  assert.equal(origins.get(0).section.lineMap[0].startLine, 2);
});
