'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPseudocode, unknownNames, sourceNames, missingConstants, inventedNumbers, hiddenEffects } = require('../src/ai/verify');

const SOURCE = `"""Train a small classifier. Learning rate defaults to 0.4 (see the paper, arXiv 2106.09685)."""
import math
import random


def train_classifier(epochs=300, learning_rate=.4):
    rng = random.Random(42)
    samples = []
    for _ in range(200):
        samples.append(([rng.uniform(-2, 2)], 1))
    training, testing = samples[:160], samples[160:]
    for _ in range(epochs):
        step(training)
    with open("out.json", "w") as handle:
        handle.write("done")
    return load_kryptonet()
`;
const check = (pseudocode, extra = {}) => verifyPseudocode({ source: { text: SOURCE, startLine: 1 }, sections: [{ title: 'T', startLine: 6, endLine: 16, pseudocode }], ...extra });
const kinds = result => result.findings.map(item => item.kind).sort();

test('names that are not in the source or the project are flagged, with their cause', () => {
  const found = check('Call refresh_cache_index on the result.\nThen run `warmUpTheModel`.\nWrite the out file.');
  const names = found.findings.find(item => item.kind === 'name');
  assert.deepEqual(names.names.sort(), ['refresh_cache_index', 'warmUpTheModel']);
  assert.match(names.text, /`refresh_cache_index`, `warmUpTheModel` are not in the source or the project\./);
  assert.equal(names.severity, 'warn'); assert.equal(names.section, 0);
});

test('real names, project names, plain words, standard errors, examples, short symbols and math are never flagged', () => {
  const source = sourceNames(SOURCE);
  assert.deepEqual(unknownNames('Use train_classifier with learning_rate, then rng.uniform on each sample.', source), []);
  assert.deepEqual(unknownNames('Call script_parser (a module elsewhere).', source, new Set(['script_parser'])), [], 'names known from the project');
  assert.deepEqual(unknownNames('Raise AssertionError if it fails, and NaN stays NaN.', source), [], 'standard names');
  assert.deepEqual(unknownNames('Name the run key, e.g. layer_1_r4_seed0.', source), [], 'examples are not claims');
  assert.deepEqual(unknownNames('Pick the `M` and `V1` entries; set $w_j \\leftarrow w_{j} - \\eta$.', source), [], 'short symbols and math');
  assert.deepEqual(unknownNames('Load the KryptoNet model.', source), [], 'a recased paraphrase of load_kryptonet');
  assert.deepEqual(unknownNames('# Unresolved: made_up_name is defined elsewhere.\nKeep going.', source), [], 'an Unresolved note says so itself');
  assert.deepEqual(unknownNames('Train a classifier with gradient descent on a plain list of samples.', source), [], 'ordinary words');
  assert.deepEqual(unknownNames('Run it in PyTorch with NumPy arrays.', source), [], 'well-known products');
});

test('numbers: the same value in any notation matches; a changed or invented number is caught; notes may illustrate', () => {
  assert.deepEqual(missingConstants(['learning_rate=.4', 'epochs=300'], 'Use rate 0.4 for 300 rounds.'), []);
  assert.deepEqual(missingConstants(['x = 1e-3', 'k = 3'], 'The step is 0.001 and there are three groups.'), [], '1e-3 = 0.001, and number words count');
  assert.deepEqual(missingConstants(['epochs=300', 'n = 160'], 'Run for 300 rounds.'), [160]);
  assert.deepEqual(missingConstants(['p = 0.5'], 'Keep half of them.'), []); assert.deepEqual(missingConstants(['p = 0.25'], 'Keep 25% of them.'), []);
  assert.deepEqual(inventedNumbers('Run 3000 rounds with rate 0.4.', SOURCE), [3000], 'a number the source never has');
  assert.deepEqual(inventedNumbers('Split 160 for training and 40 for testing.', SOURCE), [], '40 = 200 - 160 is a derived count; 160 and 200 are in the source');
  assert.deepEqual(inventedNumbers('Use rate 0.4 and 42 as the seed.', SOURCE), []);
  assert.deepEqual(inventedNumbers('# Insight: for example 3725 s gives 62:05.', SOURCE), [], 'worked examples in notes');
  assert.deepEqual(inventedNumbers('Cite arXiv 2106.09685.', SOURCE), [], 'a number from a docstring is in the source');
  assert.deepEqual(inventedNumbers('There are 7 groups.', SOURCE), [], 'small whole numbers are counts');
});

test('side effects the source performs must be said, in any wording', () => {
  assert.deepEqual(hiddenEffects(['with open("a.json", "w") as f:', '    f.write(x)'], 'Compute the result.'), ['writes or deletes files']);
  assert.deepEqual(hiddenEffects(['with open("a.json", "w") as f:'], 'Save the result to a file.'), []);
  assert.deepEqual(hiddenEffects(['resp = requests.post(url)'], 'Send the data to the server.'), []);
  assert.deepEqual(hiddenEffects(['resp = requests.post(url)'], 'Compute the data.'), ['makes network requests']);
  assert.deepEqual(hiddenEffects(['subprocess.run(cmd)', 'eval(x)'], 'Compute.').sort(), ['evaluates code', 'runs another process']);
  assert.deepEqual(hiddenEffects(['# f.write(x) would write'], 'Compute.'), [], 'comments do not count');
  const whole = check('Draw the samples.\nSplit them 160 and 40.');
  assert.ok(whole.findings.some(item => item.kind === 'effect' && /writes or deletes files/.test(item.text)));
});

test('a full verification: findings by kind, severity and block, notes versus warnings', () => {
  const clean = check('For each of 200 rounds, draw a sample between -2 and 2.\nSplit 160 for training and 40 for testing.\nTrain for 300 epochs at rate 0.4, with seed 42.\nSave the result to a file, then load the model.');
  assert.deepEqual(clean.findings, [], 'a faithful block raises nothing');
  const bad = check('Train for 3000 epochs.\nCall refresh_cache_index.\nSplit 160 and 40.');
  assert.deepEqual(kinds(bad), ['constant', 'effect', 'name', 'number']);
  assert.equal(bad.warnings, 3); assert.equal(bad.notes, 1);
  const overview = check('Train it.', { level: 'overview' });
  assert.deepEqual(kinds(overview), ['effect'], 'Overview skips the constants note');
});

test('coverage: unexplained code is reported only for whole Logic files, never imports, docstrings or closing lines', () => {
  const body = Array.from({ length: 30 }, (_, i) => i < 3 ? 'import mod' + i : i === 3 ? '' : 'step_' + i + '()').join('\n');
  const sections = [{ title: 'A', startLine: 5, endLine: 14, pseudocode: 'Run the first steps (step_4 to step_13).' }];
  const found = verifyPseudocode({ source: { text: body, startLine: 1 }, sections, complete: true });
  const uncovered = found.findings.find(item => item.kind === 'uncovered');
  assert.match(uncovered.text, /No block explains L15–30 \(16 lines\)\./); assert.equal(uncovered.severity, 'note'); assert.equal(uncovered.section, -1);
  assert.ok(!verifyPseudocode({ source: { text: body, startLine: 1 }, sections, complete: false }).findings.some(item => item.kind === 'uncovered'), 'a selection is not a whole file');
  assert.ok(!verifyPseudocode({ source: { text: body, startLine: 1 }, sections, level: 'overview', complete: true }).findings.some(item => item.kind === 'uncovered'), 'Overview groups on purpose');
  const small = verifyPseudocode({ source: { text: body, startLine: 1 }, sections: [{ title: 'A', startLine: 5, endLine: 27, pseudocode: 'Everything.' }], complete: true });
  assert.ok(!small.findings.some(item => item.kind === 'uncovered'), 'a few stray lines are not reported');
  const docs = verifyPseudocode({ source: { text: '"""One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nSeven."""\nx = 1\n', startLine: 1 }, sections: [{ title: 'A', startLine: 8, endLine: 8, pseudocode: 'Set x.' }], complete: true });
  assert.ok(!docs.findings.some(item => item.kind === 'uncovered'), 'docstring lines are not code');
});

test('a selection keeps its own line numbers', () => {
  const found = verifyPseudocode({ source: { text: 'a = 1\nrate = 0.37\n', startLine: 40 }, sections: [{ title: 'T', startLine: 41, endLine: 41, pseudocode: 'Set the rate.' }] });
  assert.match(found.findings[0].text, /0\.37/);
});
