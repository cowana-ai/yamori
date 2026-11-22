'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { hash, PROMPT_FORMAT_VERSION, FLOW_FORMAT_VERSION } = require('../src/ai/engine');
const { LocalCache, analyzeSource, currentSnapshot, verifyBlockHashes, sectionHash, explainAddress, gitCommit, acceptsCache, isCurrent, CACHE_SCHEMA_VERSION } = require('../src/storage/cache');

const opts = { provider: 'codex', level: 'logic', model: '', effort: 'low', refinementSteps: 0 };
const text = 'def a():\n    return 1\n\ndef b():\n    return 2\n';
const source = { uri: 'file:///proj/a.py', name: 'a.py', language: 'python', text, fullText: text, fullHash: hash(text), startLine: 1, endLine: 6, selected: false, workspace: '/proj', relPath: 'a.py' };
const value = { title: 'Two functions', summary: 'Returns two numbers.', sections: [
  { title: 'First', startLine: 1, endLine: 2, pseudocode: 'Return 1.', lineMap: [{ pseudocodeLine: 1, startLine: 2, endLine: 2 }] },
  { title: 'Second', startLine: 4, endLine: 5, pseudocode: 'Return 2.', lineMap: [{ pseudocodeLine: 1, startLine: 5, endLine: 5 }] }
] };

async function tempCache(options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-cache-'));
  return { root, store: new LocalCache(root, options), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('an unchanged file is an exact cache hit, including line links, and a content change misses', async () => {
  const { store, cleanup } = await tempCache();
  try {
    const key = hash('explanation-a');
    await store.save(source, opts, value, key);
    const reopened = new LocalCache(store.root);
    const started = Date.now();
    let hit;
    for (let i = 0; i < 30; i++) hit = await reopened.exact(source, opts);
    const elapsed = Date.now() - started;
    assert.ok(hit, 'exact hit');
    assert.equal(hit.value.sections[0].pseudocode, 'Return 1.');
    assert.equal(hit.value.sections[1].lineMap[0].startLine, 5);
    assert.equal(isCurrent(hit.meta), true);
    assert.equal(hit.meta.version, CACHE_SCHEMA_VERSION);
    assert.equal(hit.meta.promptVersion, PROMPT_FORMAT_VERSION);
    assert.equal(hit.meta.contentHash, hash(text));
    assert.equal(hit.meta.workspace, '/proj');
    assert.equal(hit.meta.relPath, 'a.py');
    assert.equal(hit.meta.blocks[1].hash, sectionHash(source, value.sections[1]));
    assert.ok(elapsed < 3000, '30 cache hits took ' + elapsed + ' ms');
    const changed = { ...source, text: text.replace('return 1', 'return 9'), fullText: text.replace('return 1', 'return 9'), fullHash: hash(text.replace('return 1', 'return 9')) };
    assert.equal(await reopened.exact(changed, opts), undefined, 'changed content is not an exact hit');
    const previous = await reopened.latest(changed, opts);
    assert.equal(previous.value.sections[0].pseudocode, 'Return 1.');
    assert.notEqual(previous.meta.contentHash, changed.fullHash);
    assert.notEqual(explainAddress(source, opts), explainAddress(changed, opts));
  } finally { await cleanup(); }
});

test('cache misses when the provider, model, effort, prompt or schema no longer match', async () => {
  const { store, cleanup } = await tempCache();
  try {
    const key = hash('explanation-b');
    await store.save(source, opts, value, key);
    assert.equal(await store.exact(source, { ...opts, provider: 'claude' }), undefined);
    assert.equal(await store.exact(source, { ...opts, model: 'other-model' }), undefined);
    assert.equal(await store.exact(source, { ...opts, effort: 'high' }), undefined);
    assert.equal(await store.latest(source, { ...opts, provider: 'claude' }), undefined);
    const moved = { ...source, workspace: '/other', relPath: 'a.py', uri: 'file:///other/a.py' };
    assert.equal(await store.exact(moved, opts), undefined, 'a different workspace does not reuse the file');
    const file = path.join(store.root, key + '.json');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    saved._yamori.promptVersion = PROMPT_FORMAT_VERSION - 1;
    await fs.writeFile(file, JSON.stringify(saved));
    assert.equal(acceptsCache(saved._yamori), false);
    assert.equal(await store.exact(source, opts), undefined, 'a prompt-format change is not served as current');
    assert.equal(await store.latest(source, opts), undefined);
    saved._yamori.promptVersion = PROMPT_FORMAT_VERSION;
    saved._yamori.version = CACHE_SCHEMA_VERSION + 1;
    await fs.writeFile(file, JSON.stringify(saved));
    assert.equal(await store.latest(source, opts), undefined, 'a newer cache schema is not served');
  } finally { await cleanup(); }
});

test('schema 1 records stay readable, and a stale record is not marked current', async () => {
  const { store, cleanup } = await tempCache();
  try {
    const key = hash('legacy-record');
    const legacy = { ...value, _yamori: { version: 1, source, opts: { provider: 'codex', level: 'logic', model: '', effort: 'low', refinementSteps: 0 }, savedAt: 1, staleBlocks: [], removedBlocks: [] } };
    await fs.mkdir(path.join(store.root, 'latest'), { recursive: true });
    await fs.writeFile(path.join(store.root, key + '.json'), JSON.stringify(legacy));
    await fs.writeFile(path.join(store.root, 'latest', store.variant(source, opts) + '.json'), JSON.stringify({ key }));
    const hit = await store.latest(source, opts);
    assert.equal(hit.value.sections[1].pseudocode, 'Return 2.');
    assert.equal(isCurrent(hit.meta), true, 'a schema 1 record from this prompt is still current');
    await store.save(source, opts, value, hash('stale-record'), { staleBlocks: [0], sharedChange: false });
    const stale = await store.exact(source, opts);
    assert.equal(stale.value.sections[0].pseudocode, 'Return 1.');
    assert.equal(isCurrent(stale.meta), false, 'stale blocks are not presented as current');
  } finally { await cleanup(); }
});

test('unchanged blocks keep remapped line links and a hash mismatch drops them', () => {
  const blocks = value.sections.map(section => ({ hash: sectionHash(source, section) }));
  const nextText = '\n' + text;
  const next = currentSnapshot(source, nextText);
  const shifted = verifyBlockHashes(analyzeSource(source, next, value), blocks, next);
  assert.deepEqual(shifted.staleBlocks, []);
  assert.equal(shifted.value.sections[1].startLine, 5);
  assert.equal(shifted.value.sections[1].lineMap[0].startLine, 6);
  assert.equal(shifted.value.sections[1].pseudocode, 'Return 2.');
  const edited = verifyBlockHashes(analyzeSource(source, currentSnapshot(source, text.replace('return 1', 'return 10')), value), blocks, currentSnapshot(source, text.replace('return 1', 'return 10')));
  assert.deepEqual(edited.staleBlocks, [0]);
  assert.equal(edited.value.sections[1].lineMap[0].startLine, 5);
  assert.equal(edited.value.sections[0].lineMap.length, 0);
  const lied = verifyBlockHashes(shifted, [{ hash: blocks[0].hash }, { hash: 'not-the-block' }], next);
  assert.deepEqual(lied.staleBlocks, [1]);
  assert.equal(lied.value.sections[1].lineMap.length, 0);
  assert.equal(lied.value.sections[0].lineMap[0].startLine, 3);
});

test('least recently used explanations are evicted, and the newest write is kept', async () => {
  const { store, cleanup } = await tempCache({ maxBytes: 1 });
  try {
    const copies = ['return 1', 'return 2', 'return 3'].map((body, index) => {
      const bodyText = text.replace('return 1', body);
      return { source: { ...source, text: bodyText, fullText: bodyText, fullHash: hash(bodyText) }, key: hash('evict-' + index) };
    });
    for (const copy of copies) await store.save(copy.source, opts, value, copy.key);
    const names = (await fs.readdir(store.root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    assert.deepEqual(names, [copies[2].key + '.json']);
    assert.equal(await store.exact(copies[0].source, opts), undefined);
    const kept = await store.exact(copies[2].source, opts);
    assert.equal(kept.value.sections[0].pseudocode, 'Return 1.');
    assert.equal(await store.latest(copies[2].source, opts).then(entry => entry.meta.contentHash), hash(copies[2].source.text));
  } finally { await cleanup(); }
});

test('the git commit is stored and is not part of the cache key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-git-cache-'));
  try {
    const repo = path.join(root, 'repo'), file = path.join(repo, 'a.py');
    await fs.mkdir(path.join(repo, '.git', 'refs', 'heads'), { recursive: true });
    await fs.writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const first = 'a'.repeat(40), second = 'b'.repeat(40);
    await fs.writeFile(path.join(repo, '.git', 'refs', 'heads', 'main'), first + '\n');
    await fs.writeFile(file, text);
    const snapshot = { ...source, uri: require('node:url').pathToFileURL(file).href, workspace: repo, relPath: 'a.py' };
    assert.equal((await gitCommit(file)).commit, first);
    const store = new LocalCache(path.join(root, 'cache'));
    await store.save(snapshot, opts, value, hash('git-record'));
    assert.equal((await store.exact(snapshot, opts)).meta.git.commit, first);
    await fs.writeFile(path.join(repo, '.git', 'refs', 'heads', 'main'), second + '\n');
    const again = await store.exact(snapshot, opts);
    assert.equal(again.meta.git.commit, first, 'a later commit does not invalidate the saved explanation');
    assert.equal(again.value.sections[1].lineMap[0].endLine, 5);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('name flows are cached and invalidated with the flow format', async () => {
  const { store, cleanup } = await tempCache();
  try {
    const key = hash('flow-record');
    const flow = { summary: 'It returns.', sections: [{ file: 'a.py', title: 'Return', startLine: 1, endLine: 2, pseudocode: 'Return 1.', lineMap: [] }], caveats: '' };
    await store.saveFlow(key, flow, { provider: 'codex', model: 'fast', query: 'a' });
    const hit = await new LocalCache(store.root).readFlow(key);
    assert.equal(hit.value.summary, 'It returns.');
    assert.equal(hit.flowVersion, FLOW_FORMAT_VERSION);
    const file = path.join(store.root, 'flows', key + '.json');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    saved.flowVersion = FLOW_FORMAT_VERSION + 1;
    await fs.writeFile(file, JSON.stringify(saved));
    assert.equal(await store.readFlow(key), undefined);
  } finally { await cleanup(); }
});
