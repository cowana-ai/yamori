'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Indexer } = require('../src/project/graph');
const { blockRecords, blockEdges, blockBehavior, blockSteps, scaffold, unchangedChecks, reuseChecks } = require('../src/project/reader-workspace');
const { compactSource, generate, gistPrompt, GIST_SCHEMA, hardReviewBlocks, parseResult, promptFor, refreshPrompt, requestSchema, reviewDraft, reviewSchema } = require('../src/ai/engine');

const source = text => ({ name: 'sample.py', uri: 'file:///sample.py', language: 'python', startLine: 1, text });

test('Flow edges derive from local calls and review diffs ignore formatting', async () => {
  const snapshot = source('def helper():\n    return 1\n\ndef caller():\n    return helper()\n');
  const syntax = await new Indexer().extract(snapshot.name, snapshot.text);
  const sections = scaffold(snapshot, syntax);
  const rows = blockRecords(snapshot, sections, syntax);
  assert.deepEqual(blockEdges(sections, rows, syntax, snapshot), [{ from: 0, to: 1, kind: 'call', name: 'helper', weight: 1 }]);
  const original = { ...sections[0], pseudocode: 'Return **one**.' };
  const reviewed = { [rows[0].identity]: { steps: blockSteps(original).map(step => step.text) } };
  assert.equal(blockBehavior(rows[0], { ...original, pseudocode: ' Return one. ' }, reviewed), undefined);
  assert.deepEqual(blockBehavior(rows[0], { ...original, pseudocode: 'Return two.' }, reviewed),
    { kind: 'touched', base: 'review', was: 'Return **one**.', now: 'Return two.',
      steps: [{ kind: 'touched', before: 'Return **one**.', after: 'Return two.', pseudocodeLine: 1 }] });
});

test('Flow prompt keeps stable prefixes and compacts only expendable source text', () => {
  const first = source('def first():\n    return 1'), other = { ...first, name: 'other.py', text: 'def other():\n    return 3' };
  assert.equal(promptFor(first, 'logic').split('File:')[0], promptFor(other, 'logic').split('File:')[0]);
  const block = { identity: 'function:first', symbol: 'first', startLine: 1, endLine: 2 };
  const next = { ...block, identity: 'function:other', symbol: 'other', startLine: 4, endLine: 5 };
  const prompt = gistPrompt(source(first.text + '\n\n' + other.text), [block, next], [block]);
  assert.match(prompt, /function:other/);
  assert.doesNotMatch(prompt, /return 3/);
  assert.doesNotMatch(JSON.stringify(GIST_SCHEMA), /"pseudocode"|"card"|"lineMap"/);
  const compact = compactSource('value = "' + 'x'.repeat(120) + '"\n\n\n# Preserve why\nreturn value', 12);
  assert.match(compact, /12: value = "<long literal omitted>"/);
  assert.match(compact, /15: # Preserve why\n16: return value/);
  assert.equal(compact.includes('14:'), false);
  assert.equal(JSON.stringify(reviewSchema({ sections: [] })), JSON.stringify(reviewSchema({ sections: [block, next] })));
});

test('Flow sends only requested source, useful cached wording, and definition locators', () => {
  const snapshot = { ...source('def first():\n    return helper()\n\ndef unrelated():\n    return 8675309\n'),
    readContext: true, callContext: { definitions: [{ symbol: 'helper', file: 'helpers.py', startLine: 10, text: '10: def helper():\n11:    return 12345' }] } };
  const previous = { title: 'File', summary: 'Read two values.', sections: [
    { title: 'first', startLine: 1, endLine: 2, pseudocode: '# Waiting for pseudocode.' },
    { title: 'Unrelated cached title', startLine: 4, endLine: 5, pseudocode: 'Unrelated cached body' }
  ] };
  const refresh = { flow: true, patch: true, previous, staleBlocks: [0] };
  const initial = refreshPrompt(snapshot, 'logic', refresh);
  assert.match(initial, /helpers\.py.*"startLine":10/);
  assert.match(initial, /return helper\(\)/);
  assert.doesNotMatch(initial, /8675309|12345|Unrelated cached|Waiting for pseudocode|COMMUNICATION OPTIMIZATION OBJECTIVE/);
  previous.sections[0].pseudocode = 'Use the helper result.';
  assert.match(refreshPrompt(snapshot, 'logic', refresh), /Use the helper result/);
});

test('Flow gist runs once on the fast model with no file tools', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-gist-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.join(root, 'claude.js'), log = path.join(root, 'calls');
  await fs.writeFile(cli, `
    const fs = require('node:fs'), args = process.argv.slice(2);
    if (args.includes('--help')) process.exit(0);
    let prompt = '';
    process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt, args }) + '\\n');
      console.log(JSON.stringify({ structured_output: { l:'Read the result', i:'', n:'Evaluate the function', o:'An integer',
        b:[{d:'function:first',g:'Process',t:'Return the result',s:'Return one.',w:''}] } }));
    });
  `);
  const block = { identity: 'function:first', symbol: 'first', startLine: 1, endLine: 2 };
  const result = await generate({ source: source('def first():\n    return 1'), level: 'logic', provider: 'claude', cliPath: cli,
    model: 'main-model', fast: { model: 'fast-model', effort: 'low' }, gist: { blocks: [block] } });
  const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'fast-model');
  assert.equal(calls[0].args[calls[0].args.indexOf('--tools') + 1], '');
  assert.equal(result.gist.blocks['function:first'].step, 'Return one.');
});

test('Flow keeps usable gist entries from an imperfect provider response', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-partial-gist-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.join(root, 'claude.js');
  const blocks = [{ identity: 'first', startLine: 1, endLine: 1 }, { identity: 'second', startLine: 2, endLine: 2 }];
  const story = 'Read the settings before selecting the output. '.repeat(4).trim();
  const response = { l: story, i: null, b: [
    { d: 'other', t: 'Ignore foreign id', s: 'Do not use this.' },
    { d: 'first', g: ' process ', t: 'Read settings', s: 'Read the settings.' },
    { d: 'first', g: 'Save', t: 'Ignore duplicate', s: 'Do not use this.' }
  ] };
  await fs.writeFile(cli, `
    if (process.argv.includes('--help')) process.exit(0);
    process.stdin.resume();
    process.stdin.on('end', () => console.log(JSON.stringify(process.argv.includes('bad-json')
      ? { result: 'truncated {' } : { structured_output: ${JSON.stringify(response)} })));
  `);
  const options = { source: source('settings = read()\nsave(settings)'), level: 'logic', provider: 'claude', cliPath: cli, gist: { blocks } };
  const partial = await generate(options);
  assert.deepEqual(partial.gist.story, { lead: story, in: '', then: '', out: '' });
  assert.deepEqual(partial.gist.blocks, { first: { stage: 'Process', title: 'Read settings', step: 'Read the settings.', risk: '' } });
  assert.deepEqual((await generate({ ...options, model: 'bad-json' })).gist.blocks, {});
});

test('Flow skips review API requests for straightforward filled cards', async () => {
  const snapshot = source('def first():\n    return 1');
  const sections = [{ title: 'First', startLine: 1, endLine: 2, pseudocode: 'Return one.' }];
  assert.deepEqual(hardReviewBlocks(snapshot, sections, [0]), []);
  const initial = { title: 'Sample', summary: '', sections };
  const result = await reviewDraft({ source: snapshot, initial, provider: 'codex', level: 'logic', steps: 1,
    sourceRefresh: { patch: true, flow: true, previous: initial, staleBlocks: [0] } });
  assert.equal(result.refinement.status, 'skipped');
});

test('a compact card patch sends typed steps and checks with the selected block bounds', () => {
  const block = { title: 'lookup', startLine: 18, endLine: 25 };
  const previous = { sections: [block, { ...block, startLine: 30, endLine: 48 }] };
  const schema = requestSchema('logic', false, { patch: true, staleBlocks: [0, 1], cardBlocks: [0, 1], previous });
  const [short, long] = schema.properties.sections.items.anyOf.map(item => item.properties);
  const card = short.card.properties;
  assert.deepEqual(short.index.enum, [0]);
  assert.deepEqual(short.startLine.enum, [18]);
  assert.deepEqual(short.endLine.enum, [25]);
  assert.equal(card.s.items.type, 'object');
  assert.deepEqual(card.s.items.properties.a, { type: 'integer', minimum: 18, maximum: 25 });
  assert.equal(card.c, undefined);
  assert.equal(short.card.required.includes('c'), false);
  assert.equal(long.card.properties.c.maxItems, 3);
  assert.equal(long.card.properties.c.items.properties.b.maximum, 48);
});

test('typed steps and checks preserve source links, depth, and annotations in canonical text', () => {
  const snapshot = { ...source('code\n'.repeat(20)), startLine: 18 };
  const block = { title: 'lookup', startLine: 18, endLine: 32, card: {
    p: 'Find the result', i: 'Key', r: 'Value or null', x: '',
    s: [{ a: 19, b: 20, d: 0, t: 'Check the key', n: [{ k: 'why', t: 'A missing key has no entry.' }] },
      { a: 20, b: 20, d: 1, t: 'Return null', n: [] }],
    c: [{ a: 19, b: 20, k: 'handled', q: 'Missing key', o: 'Returns null' }]
  } };
  const read = () => parseResult(JSON.stringify({ title: 'Lookup', summary: '', sections: [block] }), snapshot, { validateCards: true }).sections[0];
  const section = read();
  assert.match(section.pseudocode, /- Check the key\n {4}WHY: A missing key has no entry\.\n {4}- Return null/);
  assert.deepEqual(section.lineMap.map(link => [link.pseudocodeLine, link.startLine, link.endLine]), [[5, 19, 20], [7, 20, 20], [9, 19, 20]]);
  block.card.s[1].b = 33;
  assert.throws(read, /lookup.*step 2 has a source range outside the block/);
});

test('Flow shortens an oversized routine block even when both reviewers find the draft clear', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-compress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.join(root, 'claude.js'), log = path.join(root, 'calls');
  const snapshot = source('def set_rate(self, rate):\n    self.rate = rate\n\ndef scores(x):\n    return softmax(x @ weights)\n');
  const summary = 'Manage learning rates and scores.';
  const verbose = 'Store the new value supplied as rate on the current object. Write the provided rate into the rate field on the object so the object has the provided rate.';
  const cardText = 'PURPOSE: Set rate.\nINPUTS: The rate.\nRETURNS: None.\nSTEPS:\n- ';
  const initial = { title: 'Rates', summary, sections: [
    { title: 'Set rate', startLine: 1, endLine: 2, pseudocode: cardText + verbose, lineMap: [{ pseudocodeLine: 5, startLine: 2, endLine: 2 }] },
    { title: 'Compute scores', startLine: 4, endLine: 5, pseudocode: verbose }
  ] };
  const shortened = { ...initial, sections: [{ title: 'Set rate', startLine: 1, endLine: 2, card: {
    p: 'Set rate.', i: 'The rate.', r: 'None.', x: '', s: [{ a: 2, b: 2, d: 0, t: 'Set rate.', n: [] }]
  } }] };
  await fs.writeFile(cli, `
    const fs = require('node:fs');
    if (process.argv.includes('--help')) process.exit(0);
    let prompt = '';
    process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(prompt) + '\\n');
      if (prompt.includes('REFINEMENT PASS')) {
        const args = process.argv;
        const branches = JSON.parse(args[args.indexOf('--json-schema') + 1]).properties.sections.items.anyOf;
        if (branches.length !== 1 || 'c' in branches[0].properties.card.properties ||
            branches[0].properties.card.properties.s.items.properties.b.maximum !== 2) process.exit(2);
      }
      const structured_output = prompt.includes('REFINEMENT PASS') ? ${JSON.stringify(shortened)} :
        prompt.includes('difficulty selector') ? { blocks: [] } : { score: 1, faithful: true, issues: [] };
      console.log(JSON.stringify({ structured_output }));
    });
  `);
  const result = await reviewDraft({ source: snapshot, initial, provider: 'claude', cliPath: cli, level: 'logic', steps: 2,
    sourceRefresh: { patch: true, flow: true, previous: initial, staleBlocks: [0, 1] } });
  assert.equal(result.refinement.acceptedStep, 1, result.refinement.warning);
  assert.deepEqual(result.refinement.selectedBlocks, [0]);
  assert.equal(result.sections[0].pseudocode, cardText + 'Set rate.');
  assert.deepEqual(result.sections[0].lineMap, [{ pseudocodeLine: 5, startLine: 2, endLine: 2 }]);
  assert.equal(result.sections[1], initial.sections[1]);
  const prompts = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const rewrites = prompts.filter(prompt => prompt.includes('REFINEMENT PASS'));
  assert.equal(rewrites.length, 1);
  assert.match(rewrites[0], /Shorten these routine blocks.*"section":0,"targetTokens":28/);
  assert.doesNotMatch(rewrites[0], /return softmax/);
});

test('Flow preserves an unchanged edge check and rebases its source link', () => {
  const body = ['def first():', '    if missing:', '        return 0', ...Array.from({ length: 10 }, (_, i) => '    value' + i + ' = 1'), '    return 1'].join('\n');
  const old = { title: 'First', startLine: 1, endLine: 14, pseudocode: 'PURPOSE: Return a value.\nINPUTS: A flag.\nRETURNS: A value.\nSTEPS:\n- Return the result.\nEDGE CASES:\n✓ Missing -> Stop early.', lineMap: [{pseudocodeLine:7,startLine:2,endLine:3}] };
  const next = { ...old, endLine: 15, pseudocode: old.pseudocode.split('\nEDGE CASES:')[0], lineMap: [] };
  const checks = unchangedChecks({ source: source(body), section: old }, next, source(body.replace('    if missing:', '    initialize()\n    if missing:')));
  assert.deepEqual(checks, [{ text: '✓ Missing -> Stop early.', startLine: 3, endLine: 4 }]);
  assert.equal(reuseChecks(next, checks).lineMap[0].startLine, 3);
});
