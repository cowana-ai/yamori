'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createNativePlanReader, planFromMarkdown, claudeFolder } = require('../src/project/native-plans');
const { normalizePlan } = require('../src/project/plan');
const { adoptPlan } = require('../src/project/session-tools');
const journal = require('../src/project/conversation');

const graph = { files: {
  'app/model.py': { lines: 120, defs: [{ name: 'Config', kind: 'class', start: 5, end: 12 }, { name: 'Net', kind: 'class', start: 20, end: 90 }, { name: 'forward', kind: 'function', start: 60, end: 90 }, { name: 'forward', kind: 'function', start: 100, end: 110 }] },
  'train.py': { lines: 300, defs: [] },
  'README.md': { lines: 40, defs: [] }
} };

const CLAUDE_PLAN = `# Add caching to the model

## Context
Every call recomputes the features. A cache keeps them between calls.

## Changes

### 1. \`model.py\`
- **Config**: add \`cache_size: int = 0\`.
- **Net.forward**: look the input up before computing.
  - store the result after.
- \`_init\`: no change needed, defaults still hold.

### 2. Training
- Pass \`cache_size\` from \`train.py:40-44\` into the model.
- New \`app/cache_store.py\` with a small LRU.
- Mention it somewhere in the docs.

## Verification
- Run \`train.py\` once and compare.
`;

test('a plan written in Markdown becomes steps over mapped files, with lines from the map', () => {
  const raw = planFromMarkdown(CLAUDE_PLAN, graph, { agent: 'claude' });
  assert.equal(raw.goal, 'Add caching to the model');
  assert.match(raw.summary, /recomputes the features/);
  const steps = raw.steps;
  assert.deepEqual(steps.map(step => step.file), ['app/model.py', 'app/model.py', 'app/model.py', 'train.py', 'app/cache_store.py']);
  assert.deepEqual([steps[0].startLine, steps[0].endLine], [5, 12], 'Config resolves to its class');
  assert.deepEqual([steps[1].startLine, steps[1].endLine], [60, 90], 'Net.forward is the forward inside Net');
  assert.match(steps[1].change, /store the result after/, 'sub-items stay with their item');
  assert.equal(steps[2].status, 'skipped', 'items that leave code alone are kept but skipped');
  assert.deepEqual([steps[3].startLine, steps[3].endLine], [40, 44], 'file:lines is used as given');
  assert.equal(steps[4].newFile, true);
  assert.ok(!steps.some(step => /compare/.test(step.change)), 'verification sections are not changes');
  assert.deepEqual(raw.unplaced, ['Mention it somewhere in the docs.']);
  const { plan, dropped } = normalizePlan({ ...raw, origin: 'native', native: { agent: 'claude', hash: 'abc', at: 1 } }, graph);
  assert.deepEqual(dropped, []);
  assert.equal(plan.steps.length, 5);
  assert.equal(plan.origin, 'native'); assert.equal(plan.native.hash, 'abc');
});

test('plan mode logs: Claude Code ExitPlanMode and Codex <proposed_plan>, only for this project and only once', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-native-')), root = path.join(home, 'work', 'my project');
  const claude = claudeFolder(root, home); fs.mkdirSync(claude, { recursive: true });
  const now = new Date(), day = path.join(home, '.codex', 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(day, { recursive: true });
  const at = new Date().toISOString();
  const claudeLog = path.join(claude, 's1.jsonl');
  fs.writeFileSync(claudeLog, JSON.stringify({ type: 'user', cwd: root, timestamp: at, message: { content: 'plan it' } }) + '\n');
  const codexLog = path.join(day, 'rollout-a.jsonl'), otherLog = path.join(day, 'rollout-b.jsonl');
  fs.writeFileSync(codexLog, JSON.stringify({ type: 'session_meta', payload: { cwd: root } }) + '\n');
  fs.writeFileSync(otherLog, JSON.stringify({ type: 'session_meta', payload: { cwd: path.join(home, 'elsewhere') } }) + '\n');
  const reader = createNativePlanReader({ root, home, since: Date.now() - 60000 });
  assert.deepEqual(reader.read(), []);
  fs.appendFileSync(claudeLog, JSON.stringify({ type: 'assistant', cwd: root, sessionId: 's1', timestamp: at, message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: CLAUDE_PLAN } }] } }) + '\n');
  const codexReply = 'Here is the plan.\n\n<proposed_plan>\n# Faster training\n\n- Use `train.py:10` warmup.\n</proposed_plan>\n';
  fs.appendFileSync(codexLog, JSON.stringify({ type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: codexReply }] } }) + '\n');
  fs.appendFileSync(otherLog, JSON.stringify({ type: 'response_item', timestamp: at, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: codexReply }] } }) + '\n');
  const found = reader.read();
  assert.deepEqual(found.map(plan => plan.agent).sort(), ['claude', 'codex']);
  assert.equal(found.find(plan => plan.agent === 'codex').text, '# Faster training\n\n- Use `train.py:10` warmup.');
  assert.deepEqual(reader.read(), [], 'lines already read are not read again');
  // A half-written line waits until it is complete.
  const line = JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'agent_message', message: '<proposed_plan>\n# Second\n- `README.md`: add a section\n</proposed_plan>' } });
  fs.appendFileSync(codexLog, line.slice(0, 30));
  assert.deepEqual(reader.read(), []);
  fs.appendFileSync(codexLog, line.slice(30) + '\n');
  assert.deepEqual(reader.read().map(plan => plan.text.split('\n')[0]), ['# Second']);
  fs.rmSync(home, { recursive: true, force: true });
});

test('adopting a plan keeps the old one in history and notes it in the conversation', () => {
  const plans = {};
  const first = normalizePlan(planFromMarkdown(CLAUDE_PLAN, graph), graph).plan;
  adoptPlan(plans, first, 'Claude Code plan mode', journal);
  assert.equal(plans.current, first);
  const empty = normalizePlan({ goal: 'Nothing mapped', steps: [] }, graph).plan;
  adoptPlan(plans, empty, 'Codex plan mode', journal);
  assert.equal(plans.current, first, 'a plan with no mapped steps does not replace the canvas');
  assert.equal(plans.conversation.mode, 'plan');
  assert.ok(plans.conversation.messages.some(message => message.text === 'Codex plan mode'));
});
