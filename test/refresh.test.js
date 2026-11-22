'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Indexer } = require('../src/project/graph');
const { reconcileRefresh, dependencyFingerprint, dependencyBlocks, LocalCache } = require('../src/storage/cache');
const { hash, refinementContext } = require('../src/ai/engine');
const snapshot = (text, name = 'sample.py') => ({ uri: 'file:///fixture/' + name, name, text, fullText: text, fullHash: hash(text), startLine: 1, endLine: text.split('\n').length });
const explanation = (defs, text) => ({ title: 'Sample', summary: '', sections: defs.map(def => ({ title: def.name, startLine: def.line, endLine: def.end, pseudocode: 'Keep the explanation of ' + def.name, lineMap: [{ pseudocodeLine: 1, startLine: def.line, endLine: def.end }] })) });
test('source reconciliation reuses moved code, removes deleted blocks, and adds only newly uncovered definitions across languages', async () => {
  const indexer = new Indexer();
  for (const [name, beforeText, afterText] of [
    ['sample.py', 'def first():\n    return 1\n\ndef gone():\n    return 2\n', 'def added():\n    return 3\n\ndef first():\n    return 1\n'],
    ['sample.ts', 'function first() { return 1; }\nfunction gone() { return 2; }\n', 'function added() { return 3; }\nfunction first() { return 1; }\n']
  ]) {
    const before = snapshot(beforeText, name), after = snapshot(afterText, name);
    const old = explanation((await indexer.extract(name, beforeText)).defs.filter(def => def.kind === 'function'), beforeText);
    const origins = new Map(old.sections.map((section,i) => [i, { section, source: before }]));
    const result = await reconcileRefresh(after, old, origins, indexer);
    assert.equal(result.removed, 1); assert.equal(result.value.sections.length, 2);
    const reused = result.value.sections.find(section => section.title === 'first');
    assert.equal(reused.pseudocode, old.sections[0].pseudocode);
    assert.equal(reused.startLine, (await indexer.extract(name, afterText)).defs.find(def => def.name === 'first').line);
    assert.deepEqual(result.staleBlocks, [0], 'only the added function needs writing');
  }
});
test('dependency signatures ignore unrelated bodies but include reachable helpers and module constants', async () => {
  const indexer = new Indexer(), original = 'LIMIT = 2\ndef helper():\n    return LIMIT\ndef used():\n    return helper()\ndef unrelated():\n    return 4\n';
  const signature = async text => dependencyFingerprint(text, (await indexer.extract('module.py', text)).defs, 'used', 'function');
  assert.equal(await signature(original), await signature(original.replace('return 4', 'return 8')));
  assert.notEqual(await signature(original), await signature(original.replace('return LIMIT', 'return LIMIT + 1')));
  assert.notEqual(await signature(original), await signature(original.replace('LIMIT = 2', 'LIMIT = 3')));
  assert.deepEqual(dependencyBlocks(snapshot(original), explanation([{ name: 'other', line: 7, end: 8 }]), 'missing'), [], 'an unresolved symbol does not invalidate every block');
});
test('changed helpers invalidate callers while unrelated explanations remain exact', async () => {
  const indexer = new Indexer(), text = 'def first():\n    return 1\ndef caller():\n    return first()\ndef unrelated():\n    return 4\n';
  const before = snapshot(text), after = snapshot(text.replace('return 1', 'return 2'));
  const old = explanation((await indexer.extract('module.py', text)).defs.filter(def => def.kind === 'function'));
  const result = await reconcileRefresh(after, old, new Map(old.sections.map((section,i) => [i, { source: before, section }])), indexer);
  assert.deepEqual(result.staleBlocks, [0, 1]); assert.deepEqual(result.value.sections[2], old.sections[2]);
});
test('patch review receives the affected source and excludes unrelated bodies', () => {
  const source = snapshot('def one():\n    return 2\ndef unrelated():\n    SECRET_UNRELATED_BODY()');
  const previous = { sections: [{ startLine: 1, endLine: 2 }, { startLine: 3, endLine: 4 }] };
  const prompt = refinementContext(source, 'logic', { sourceRefresh: { patch: true, previous, staleBlocks: [0] } });
  assert.match(prompt, /return 2/); assert.doesNotMatch(prompt, /SECRET_UNRELATED_BODY/);
});
test('origin recovery accepts only previously fresh matching explanations', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-refresh-origins-'));
  try {
    const source = snapshot('def one():\n    return 1'), value = explanation([{ name: 'one', line: 1, end: 2 }]), opts = { provider: 'codex', level: 'logic' }, cache = new LocalCache(dir);
    await cache.save(source, opts, value, hash('fresh'));
    await cache.save({ ...source, text: 'changed', fullHash: hash('changed') }, opts, value, hash('stale'), { staleBlocks: [0] });
    const origins = await cache.origins(source, opts, value);
    assert.equal(origins.get(0).source.fullHash, source.fullHash);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('declaration decorators are part of the behavior being compared', async () => {
  const indexer = new Indexer(), before = snapshot('@cached\ndef compute():\n    return 2\n'), after = snapshot('@uncached\ndef compute():\n    return 2\n');
  const defs = (await indexer.extract('sample.py', before.text)).defs;
  assert.equal(defs[0].start, 1);
  const value = explanation(defs), result = await reconcileRefresh(after, value, new Map([[0,{ source: before, section: value.sections[0] }]]), indexer);
  assert.deepEqual(result.staleBlocks, [0]); assert.equal(result.value.sections[0].startLine, 1);
});
test('supporting context includes referenced helpers and excludes unrelated bodies', async () => {
  const { refreshSupport } = require('../src/storage/cache'), indexer = new Indexer();
  const source = snapshot('LIMIT = 2\ndef helper():\n    return LIMIT\ndef target():\n    return helper()\ndef unrelated():\n    SECRET_UNRELATED_BODY()\n');
  const defs = (await indexer.extract('sample.py', source.text)).defs;
  const target = defs.find(def => def.name === 'target');
  const context = refreshSupport(source, [{ startLine: target.line, endLine: target.end }], defs);
  assert.match(context, /def helper/); assert.match(context, /LIMIT = 2/); assert.doesNotMatch(context, /SECRET_UNRELATED_BODY/);
  assert.match(refreshSupport(source, [{ startLine: target.line, endLine: target.end }], defs, 1), /do not invent their internals/);
});
test('a changed external dependency cannot be made fresh by unchanged main-source text', async () => {
  const indexer = new Indexer(), before = snapshot('def first():\n    return external()\n');
  before.callContext = { definitions: [{ symbol: 'external', uri: 'file:///fixture/helper.py', fullHash: 'old' }] };
  const after = { ...before, callContext: { definitions: [{ symbol: 'external', uri: 'file:///fixture/helper.py', fullHash: 'new' }] } };
  const value = explanation((await indexer.extract('sample.py', before.text)).defs);
  const result = await reconcileRefresh(after, value, new Map([[0,{source:before,section:value.sections[0]}]]), indexer);
  assert.deepEqual(result.staleBlocks, [0]);
});

test('unknown definition boundaries never certify a cache block as unchanged', async () => {
  const source = snapshot('def first():\n    return 2'), defs = [{ kind: 'function', name: 'first', line: 1 }];
  assert.equal(dependencyFingerprint(source.text, defs, 'first', 'function'), undefined);
  assert.equal(await reconcileRefresh(source, explanation([{ name: 'first', line: 1, end: 2 }]), new Map(), { extract: async () => ({ defs }) }), undefined);
});

test('difficulty selection sends only eligible blocks with their original indices', () => {
  const { selectionPrompt } = require('../src/ai/engine');
  const prompt = selectionPrompt('Affected source', { title: 'File', summary: '', sections: [{ pseudocode: 'UNRELATED_CACHED_TEXT' }, { pseudocode: 'Explain the changed algorithm' }] }, [1]);
  assert.doesNotMatch(prompt, /UNRELATED_CACHED_TEXT/); assert.match(prompt, /"index":1/); assert.match(prompt, /explicit index/);
});

test('new top-level effects are not hidden by unchanged function bodies', async () => {
  const indexer = new Indexer(), before = snapshot('def first():\n    return 1\n'), after = snapshot(before.text + '\nprint(first())\n');
  const value = explanation((await indexer.extract('sample.py', before.text)).defs), result = await reconcileRefresh(after, value, new Map([[0,{source:before,section:value.sections[0]}]]), indexer);
  assert.equal(result.value.sections.length, 2); assert.equal(result.value.sections[0].pseudocode, value.sections[0].pseudocode);
  assert.deepEqual(result.staleBlocks, [1]); assert.equal(result.value.sections[1].startLine, 4);
});

test('matching a fragment of text in a different function never makes its explanation fresh', async () => {
  const indexer = new Indexer(), before = snapshot('def first():\n    return 1\n'), after = snapshot('def second():\n    return 1\n');
  const section = { title: 'Result', startLine: 2, endLine: 2, pseudocode: 'Return the first result.', lineMap: [] };
  const result = await reconcileRefresh(after, { title:'File',summary:'',sections:[section] }, new Map([[0,{source:before,section}]]), indexer);
  assert.ok(!result || result.staleBlocks.includes(0), 'text equality cannot establish semantic ownership');
});


test('mixed historical baselines never invalidate already updated blocks on retry', async () => {
  const indexer = new Indexer(), before = snapshot('LIMIT = 2\ndef helper():\n    return LIMIT\ndef caller():\n    return helper()\n'), current = snapshot('LIMIT = 3\ndef helper():\n    return LIMIT\ndef caller():\n    return helper()\n');
  const value = explanation((await indexer.extract('sample.py', current.text)).defs.filter(d => d.kind === 'function'));
  // One block already passed review against current code. The other is still old.
  const origins = new Map([[0, { source: before, section: value.sections[0] }], [1, { source: current, section: value.sections[1] }]]);
  const result = await reconcileRefresh(current, value, origins, indexer);
  const caller = result.value.sections.findIndex(section => section.title === 'caller');
  assert.ok(!result.staleBlocks.includes(caller), 'a historical global change cannot invalidate the already-current caller');
  assert.deepEqual(result.value.sections[caller], value.sections[1]);
  assert.ok(result.staleBlocks.some(index => result.value.sections[index].title === 'helper'));
});

test('current fresh sub-blocks retain their boundaries and dependent context is still checked', async () => {
  const indexer = new Indexer(), source = snapshot('def compute():\n    first = 1\n    second = first + 2\n    return second\n');
  const value = { title: 'Compute', summary: '', sections: [{ title: 'First', startLine: 1, endLine: 2, pseudocode: 'Set the first value.', lineMap: [] }, { title: 'Second', startLine: 3, endLine: 4, pseudocode: 'Add two and return.', lineMap: [] }] };
  const result = await reconcileRefresh(source, value, new Map(value.sections.map((section,i) => [i,{ source, section }])), indexer);
  assert.deepEqual(result.staleBlocks, []);
  assert.deepEqual(result.value.sections, value.sections, 'conceptual blocks are not expanded to the entire function');
  const old = { ...source, callContext: { definitions: [{ uri: 'file:///fixture/external.py', symbol: 'first', fullHash: 'old' }] } }, next = { ...source, callContext: { definitions: [{ uri: 'file:///fixture/external.py', symbol: 'first', fullHash: 'new' }] } };
  const changed = await reconcileRefresh(next, value, new Map(value.sections.map((section,i) => [i,{ source: old, section }])), indexer);
  assert.ok(changed.staleBlocks.length > 0, 'a changed helper cannot be bypassed by matching main source');
});
