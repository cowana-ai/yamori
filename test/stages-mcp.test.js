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
  await stages.generateWorkflow({ db, graph, notes: { files: {} }, explanations: {}, entryFile: 'main.py', entrySymbol: 'run_agent', request, run: createRun(db), provider: 'claude', model: 'm' });
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
    for (const name of ['find', 'list_stages', 'get_stage', 'add_note', 'done']) assert.ok(names.includes(name), name);
    // Rarely needed tools are not listed for agents, but older callers can still call them.
    for (const name of ['what_changed', 'propose_change', 'search_name', 'project_map']) assert.ok(!names.includes(name), name);
    const before = ctx.db.usage({}).calls;
    // Brief by default: compact text, one line per step.
    const brief = text(await server.call('list_stages', {}));
    assert.match(brief, /^1\. Plan \[plan\]/m); assert.match(brief, /^3\. Evaluate result \[evaluate\].*1 waiting for review/m);
    const actBrief = text(await server.call('get_stage', { stage: 'act' }));
    assert.match(actBrief, /Founder notes \(rules for edits here\):\n[^]*Never call paid tools/); assert.match(actBrief, /^- agent\/\S+:4-5 act/m);
    const list = JSON.parse(text(await server.call('list_stages', { detail: 'full' })));
    assert.equal(list.workflow, 'run-agent'); assert.deepEqual(list.stages.map(stage => stage.name), ['Plan', 'Act', 'Evaluate result']);
    assert.equal(list.stages[2].pendingReview, 1);
    const act = JSON.parse(text(await server.call('get_stage', { stage: 'act', detail: 'full' })));
    assert.match(act.founderNotes, /Never call paid tools without a budget check/);
    assert.deepEqual(act.steps.map(step => step.symbol), ['act', 'run_step']);
    assert.deepEqual(act.steps[0].lines, [4, 5]);
    const byName = JSON.parse(text(await server.call('get_stage', { stage: 'evaluate result', detail: 'full' })));
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

test('find answers where/how in one call with the code, and agents get a short, annotated tool list', { skip }, async () => {
  const ctx = await mapped();
  try {
    const { createServer } = require('../src/project/mcp');
    const server = createServer({ root: ctx.root, cache: ctx.cache });
    await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'codex' } } });
    const graded = text(await server.call('find', { query: 'where are the results graded?' }));
    assert.match(graded, /^Current source, read just now\.\n\nagent\/evaluator\.py:\d+-\d+ · grade/, 'plain words find the function first');
    assert.match(graded, /\d+: def grade\(results\):/, 'with its code');
    const named = text(await server.call('find', { query: 'run_step', code: true }));
    assert.match(named, /^Current source, read just now\.\n\nagent\/actor\.py:8-9 · run_step · run-agent › Act/, 'an exact name comes first, with its part and step');
    assert.match(named, /^Called from: agent\/actor\.py:5 \(act\) · Calls: call_tool \(agent\/tools\.py:1\)$/m, 'with who calls it and what it calls');
    assert.match(named, /^8: def run_step\(step\):/m);
    assert.match(text(await server.call('find', { query: 'kubernetes autoscaler' })), /Nothing in the map matches/);
    assert.ok((await server.call('find', {})).isError);
    assert.match(text(await server.call('read_source', { path: 'agent/actor.py', symbol: 'run_step' })), /lines 8-9 of/);
    const listed = (await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result;
    assert.ok(JSON.stringify(listed).length < 8000, 'agent tool definitions stay small: ' + JSON.stringify(listed).length);
    assert.ok(listed.tools.length <= 14);
    const hint = name => listed.tools.find(tool => tool.name === name).annotations;
    assert.deepEqual(hint('find'), { readOnlyHint: true }); assert.deepEqual(hint('get_stage'), { readOnlyHint: true });
    assert.equal(hint('save_plan').readOnlyHint, false); assert.equal(hint('add_note').destructiveHint, false);
  } finally { ctx.cleanup(); }
});

test('propose_change is logged and rate-limited', { skip }, async () => {
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
    await tools.handlers.propose_change({ graph: ctx.graph }, { stage: 'act', intent: 'again' });
    assert.equal(prompts.length, 2, 'past the wait, a second request goes through: no token cap');
    tools.close();
  } finally { ctx.cleanup(); }
});
