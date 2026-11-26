'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const project = require('../src/project/graph');
const { available, openStageDb, closeStageDb, dbPath } = require('../src/stages/db');
const { createRun } = require('../src/stages/budget');
const stages = require('../src/stages/generate');
const { Vault } = require('../src/stages/vault');
const { createStageTools, RATE } = require('../src/stages/mcp-tools');

const skip = !available() && 'node:sqlite is not available in this runtime';
const FIXTURE = path.join(__dirname, 'fixtures', 'agent-repo');
const STAGES = { stages: [
  { id: 'plan', name: 'Plan', gist: 'Turn the goal into steps.', input: 'user goal', output: 'steps', steps: [{ file: 'agent/planner.py', symbol: 'plan' }] },
  { id: 'act', name: 'Act', gist: 'Run each step.', input: 'steps', output: 'results', steps: [{ file: 'agent/actor.py', symbol: 'act' }, { file: 'agent/actor.py', symbol: 'run_step' }] },
  { id: 'evaluate', name: 'Evaluate result', gist: 'Score.', input: 'results', output: 'verdict', steps: [{ file: 'agent/evaluator.py', symbol: 'evaluate' }] }] };

async function mapped() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-mcp-')), root = path.join(temp, 'repo'), cache = path.join(temp, 'cache');
  fs.cpSync(FIXTURE, root, { recursive: true }); fs.mkdirSync(path.join(root, '.git'));
  const graph = await project.scanFolder(root, undefined, new project.Indexer());
  const db = openStageDb(dbPath(root));
  const request = async () => ({ raw: JSON.stringify(STAGES), usage: { input: 10, output: 10 } });
  await stages.generateWorkflow({ db, graph, notes: { files: {} }, explanations: {}, entryFile: 'main.py', entrySymbol: 'run_agent', request, run: createRun(db, { budget: { perRun: 0, perDay: 0 } }), provider: 'claude', model: 'm' });
  new Vault({ root }).syncWorkflow(db, graph, {}, 'run-agent');
  new Vault({ root }).addNote(db, 'run-agent', 'act', 'Never call paid tools without a budget check.', { author: 'You' });
  db.addChange({ workflow_id: 'run-agent', stage_id: 'evaluate', summary: 'Evaluate now retries twice before failing.', detail: { files: ['agent/evaluator.py'], steps: [] } });
  return { temp, root, cache, db, graph, cleanup() { closeStageDb(dbPath(root)); fs.rmSync(temp, { recursive: true, force: true }); } };
}
const text = reply => reply.content[0].text.replace(/^Untrusted[^\n]*\n/, '');

test('agents read stages, founder notes and the review log with no model call, add notes and signal done', { skip }, async () => {
  const ctx = await mapped();
  try {
    const { createServer } = require('../src/project/mcp');
    const server = createServer({ root: ctx.root, cache: ctx.cache });
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
    assert.match(init.result.instructions, /founder notes that get_stage returns are constraints/);
    const names = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(tool => tool.name);
    for (const name of ['list_stages', 'get_stage', 'what_changed', 'add_note', 'propose_change', 'done']) assert.ok(names.includes(name), name);
    const before = ctx.db.usage({}).calls;
    const list = JSON.parse(text(await server.call('list_stages', {})));
    assert.equal(list.workflow, 'run-agent'); assert.deepEqual(list.stages.map(stage => stage.name), ['Plan', 'Act', 'Evaluate result']);
    assert.equal(list.stages[2].pendingReview, 1);
    const act = JSON.parse(text(await server.call('get_stage', { stage: 'act' })));
    assert.match(act.founderNotes, /Never call paid tools without a budget check/);
    assert.deepEqual(act.steps.map(step => step.symbol), ['act', 'run_step']);
    assert.deepEqual(act.steps[0].lines, [4, 5]);
    const byName = JSON.parse(text(await server.call('get_stage', { stage: 'evaluate result' })));
    assert.deepEqual(byName.pendingReview, ['Evaluate now retries twice before failing.']);
    const changed = JSON.parse(text(await server.call('what_changed', {})));
    assert.equal(changed.changes[0].summary, 'Evaluate now retries twice before failing.'); assert.equal(changed.changes[0].status, 'pending');
    assert.equal(ctx.db.usage({}).calls, before, 'read tools never call a model');
    assert.match(text(await server.call('add_note', { stage: 'plan', text: 'Plans are capped at 10 steps.' })), /Added a note to Plan/);
    assert.match(new Vault({ root: ctx.root }).stageNotes('run-agent', 'plan').text, /Claude Code: Plans are capped at 10 steps\./);
    await server.call('done', {});
    assert.ok(fs.existsSync(path.join(ctx.root, '.yamori', 'agent-done')));
    const missing = await server.call('get_stage', { stage: 'nope' });
    assert.ok(missing.isError); assert.match(missing.content[0].text, /Stages: plan \(Plan\), act \(Act\)/);
    const unconfigured = await server.call('propose_change', { stage: 'act', intent: 'retry failed tools' });
    assert.ok(unconfigured.isError); assert.match(unconfigured.content[0].text, /Use get_stage instead/);
    // Inside Yamori's own explanation requests the server keeps its read-only tool set.
    const store = path.join(ctx.temp, 'store'); fs.mkdirSync(store); fs.writeFileSync(path.join(store, 'graph.json'), JSON.stringify(ctx.graph));
    const readOnly = createServer({ root: ctx.root, store });
    assert.ok(!readOnly.tools.some(tool => ['get_stage', 'add_note'].includes(tool.name)));
    assert.ok((await readOnly.call('add_note', { stage: 'plan', text: 'x' })).isError);
  } finally { ctx.cleanup(); }
});

test('propose_change is budgeted, logged and rate-limited', { skip }, async () => {
  const ctx = await mapped();
  try {
    ctx.db.setMeta('connection:cheap', JSON.stringify({ provider: 'claude', model: 'cheap' }));
    const prompts = []; let clock = Date.parse('2026-11-26T10:00:00Z');
    const tools = createStageTools({ root: () => ctx.root, now: () => clock, requestStructured: async ({ prompt }) => {
      prompts.push(prompt);
      return { raw: JSON.stringify({ summary: 'Retry failed tool calls in run_step.', steps: [{ file: 'agent/actor.py', symbol: 'run_step', change: 'Retry twice.' }], constraints: ['Never call paid tools without a budget check.'] }), usage: { input: 500, output: 80 }, actualModel: 'cheap' };
    } });
    const result = await tools.handlers.propose_change({ graph: ctx.graph, explanations: {} }, { stage: 'act', intent: 'retry failed tools' });
    assert.deepEqual(result.steps, [{ file: 'agent/actor.py', symbol: 'run_step', change: 'Retry twice.', lines: [8, 9] }]);
    assert.match(prompts[0], /Never call paid tools/);
    const [call] = ctx.db.calls({});
    assert.equal(call.trigger, 'mcp.propose_change'); assert.equal(call.input_tokens, 500);
    await assert.rejects(tools.handlers.propose_change({ graph: ctx.graph }, { stage: 'act', intent: 'again' }), /less than 30 seconds ago/);
    clock += RATE.minIntervalMs + 1;
    ctx.db.setMeta('budget', JSON.stringify({ perRun: 0, perDay: 600 }));
    await assert.rejects(tools.handlers.propose_change({ graph: ctx.graph }, { stage: 'act', intent: 'again' }), /daily budget/);
    assert.equal(prompts.length, 1);
    tools.close();
  } finally { ctx.cleanup(); }
});
