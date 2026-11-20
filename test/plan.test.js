'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const project = require('../src/project/graph');
const planner = require('../src/project/plan');
const engine = require('../src/ai/engine');

const FILES = {
  'app/render.py': 'SHORT_WARN_S = 90\n\ndef trim_candidates(section, length_s, wpm, limit_s=SHORT_WARN_S):\n    """Core lines to cut, longest first, until the short fits."""\n    core = [ln for ln in section if ln.part == "CORE"][2:]\n    picked = []\n    for line in core:\n        if length_s <= limit_s:\n            break\n        picked.append(line)\n    return picked\n\ndef render_shorts(script):\n    return [trim_candidates(s, 100, 150) for s in script]\n',
  'app/checker.py': 'from app.render import render_shorts\n\ndef check_script(script):\n    return render_shorts(script)\n',
  'workflows/script.py': 'from app.render import render_shorts\n\ndef plan_loops(blocks):\n    return [{"id": "L1"}]\n\ndef run_script(script):\n    return render_shorts(script)\n',
  'utils/llm.py': 'BACKOFF_S = (2.0, 4.0, 8.0)\n\ndef post_with_retries(payload):\n    for wait in BACKOFF_S:\n        pass\n',
  'main.py': 'from workflows.script import run_script\n\ndef main():\n    return run_script([])\n\nif __name__ == "__main__":\n    main()\n',
  'tests/test_render.py': 'from app.render import trim_candidates\n\ndef test_trim_stops_under_limit():\n    assert trim_candidates([], 50, 150) == []\n'
};
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-plan-'));
  for (const [rel, text] of Object.entries(FILES)) { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); }
  const graph = await project.scanFolder(root, undefined, new project.Indexer());
  const hash = rel => graph.files[rel].hash;
  const notes = { overview: 'Writes video scripts and trims shorts.', files: {
    'app/render.py': { hash: hash('app/render.py'), purpose: 'Renders short videos and trims the ones that run too long', role: 'rendering', terms: [{ term: 'SHORT_WARN_S', meaning: 'Longest a short may run, in seconds', line: 1 }] },
    'workflows/script.py': { hash: hash('workflows/script.py'), purpose: 'Plans open loops and runs the script workflow', role: 'workflow', terms: [] },
    'utils/llm.py': { hash: hash('utils/llm.py'), purpose: 'Calls the language model and retries failures', role: 'client', terms: [] } } };
  const explanations = { 'app/render.py': { logic: { title: 'Render shorts', summary: 'Trims long shorts.', hash: hash('app/render.py'), sections: [
    { title: 'Trim a long short', startLine: 3, endLine: 10, pseudocode: 'Pick the core lines after the first two.\nFor each line, longest first:\n    Stop once the short is under 90 seconds.\n    Otherwise add the line to the cuts.', lineMap: [] },
    { title: 'Render every short', startLine: 12, endLine: 13, pseudocode: 'Trim each short of the script.', lineMap: [] }] } } };
  return { root, graph, notes, explanations, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('starting points: goal words are matched against names, definitions, purposes and pseudocode, with no AI', async () => {
  const f = await fixture();
  try {
    const found = planner.findStartingPoints(f.graph, f.notes, f.explanations, 'let a short be at most 60 seconds instead of 90');
    assert.equal(found.files[0].file, 'app/render.py'); assert.equal(found.weak, false);
    assert.ok(found.files[0].why.some(reason => /short|second/.test(reason)), 'each file says why');
    const retry = planner.findStartingPoints(f.graph, f.notes, f.explanations, 'retry failed model calls more times');
    assert.equal(retry.files[0].file, 'utils/llm.py');
    assert.ok(![...found.files, ...retry.files].some(item => item.file.startsWith('tests/')), 'tests are never starting points');
    const none = planner.findStartingPoints(f.graph, f.notes, f.explanations, 'quantum banana');
    assert.deepEqual([none.files.length, none.weak], [0, true], 'no match is reported as weak, not guessed');
    assert.deepEqual(planner.findStartingPoints(f.graph, f.notes, f.explanations, '   ').files, []);
    assert.ok(planner.findStartingPoints(f.graph, f.notes, f.explanations, 'plan the loops').files[0].file === 'workflows/script.py');
  } finally { await f.cleanup(); }
});

test('impact: who uses a step, which tests cover it, what is risky, and the ripple around the plan', async () => {
  const f = await fixture();
  try {
    const impact = planner.impactOf(f.graph, { file: 'app/render.py', startLine: 3, endLine: 10 });
    assert.deepEqual(impact.usedBy.map(link => link.file).sort(), ['app/checker.py', 'workflows/script.py']);
    assert.deepEqual(impact.tests.map(test => test.function), ['trim_candidates']);
    assert.ok(!impact.risk.some(text => /No unit test/.test(text)), 'trim_candidates has a test');
    const untested = planner.impactOf(f.graph, { file: 'workflows/script.py', startLine: 1, endLine: 8 });
    assert.ok(untested.risk.includes('No unit test calls the functions in these lines.'));
    assert.ok(planner.impactOf(f.graph, { file: 'main.py', startLine: 1, endLine: 6 }).risk.includes('Entry point: the program starts here.'));
    assert.ok(planner.impactOf(f.graph, { file: 'workflows/script.py', startLine: 1, endLine: 8 }, { effects: ['writes or deletes files'] }).risk.includes('The code writes or deletes files.'));
    assert.match(planner.impactOf(f.graph, { file: 'nope.py' }).risk[0], /not in the project map/);
    assert.deepEqual(planner.rippleOf(f.graph, ['app/render.py']).sort(), ['app/checker.py', 'workflows/script.py'], 'files that use a plan file');
    assert.deepEqual(planner.rippleOf(f.graph, ['app/render.py', 'app/checker.py', 'workflows/script.py']), ['main.py'], 'plan files are not ripple; their users are');
  } finally { await f.cleanup(); }
});

test('the AI context is a small slice: outlines, only the matching blocks, one line per neighbour, never source, cut at the budget', async () => {
  const f = await fixture();
  try {
    const goal = 'lower the limit to 60 seconds instead of 90';
    const ctx = planner.planContext(f.graph, f.notes, f.explanations, { goal, files: ['app/render.py'], budget: 6000, sizes: { 'app/render.py': 4000 } });
    assert.match(ctx.text, /^PROJECT: Writes video scripts and trims shorts\./);
    assert.match(ctx.text, /FILE app\/render\.py \(\d+ lines\) — Renders short videos/);
    assert.match(ctx.text, /1 · Trim a long short · L3–10/, 'the outline');
    assert.match(ctx.text, /BLOCK of app\/render\.py\n## 1 · Trim a long short · L3–10[\s\S]*under 90 seconds/, 'the block that matches the goal, in full');
    assert.match(ctx.text, /2 · Render every short · L12–13/, 'the other block is in the outline'); assert.doesNotMatch(ctx.text, /## 2 · Render every short/, 'but a block that does not match goal is not included in full');
    assert.doesNotMatch(ctx.text, /def trim_candidates|SHORT_WARN_S = 90/, 'never source');
    assert.match(ctx.text, /NEIGHBOURING FILES[\s\S]*- app\/checker\.py \[shares render_shorts\]/, 'one line for each neighbour');
    assert.deepEqual([ctx.report.whole, ctx.report.sent < ctx.report.whole, ctx.report.percent > 0], [4000, true, true]);
    const tiny = planner.planContext(f.graph, f.notes, f.explanations, { goal, files: ['app/render.py', 'utils/llm.py'], budget: 120 });
    assert.ok(tiny.tokens <= 120, 'the budget is a hard cut (' + tiny.tokens + ')'); assert.ok(tiny.omitted.length > 0, 'and it says what was left out');
    const bare = planner.planContext(f.graph, f.notes, {}, { goal, files: ['utils/llm.py'], budget: 6000 });
    assert.match(bare.text, /\[no pseudocode yet; definitions only\][\s\S]*function post_with_retries · L3–5/, 'without pseudocode: definitions from the map');
  } finally { await f.cleanup(); }
});

test('normalising a plan keeps only real files and sane ranges, bounds every text, and never trusts the sender', async () => {
  const f = await fixture();
  try {
    const long = 'x'.repeat(5000);
    const { plan, dropped } = planner.normalizePlan({ goal: long, summary: long, starting: ['app/render.py', '../etc/passwd'], dismissed: ['nope.py'], steps: [
      { id: 'ok', file: 'app/render.py', startLine: 3, endLine: 999, title: long, change: long, why: long, note: long, status: 'done', before: long, after: long, manual: true },
      { file: 'evil/../../secret.py', startLine: 1, endLine: 2, title: 't', change: 'c' },
      { file: 'utils/llm.py', startLine: 9, endLine: 2, title: '', change: 'c', status: 'weird' }] }, f.graph);
    assert.equal(plan.steps.length, 2); assert.deepEqual(dropped, ['unknown file evil/../../secret.py']);
    assert.deepEqual([plan.steps[0].id, plan.steps[0].endLine, plan.steps[0].status], ['ok', f.graph.files['app/render.py'].lines, 'done']);
    assert.ok(plan.goal.length <= 600 && plan.steps[0].title.length <= 120 && plan.steps[0].change.length <= 500 && plan.steps[0].why.length <= 300 && plan.steps[0].note.length <= 600 && plan.steps[0].before.length <= 4000);
    assert.deepEqual([plan.steps[1].status, plan.steps[1].title, plan.steps[1].startLine <= plan.steps[1].endLine], ['todo', 'Change llm.py', true], 'bad status, empty title and reversed lines are repaired');
    assert.deepEqual(plan.starting, ['app/render.py']); assert.deepEqual(plan.dismissed, []);
    const many = planner.normalizePlan({ steps: Array.from({ length: 20 }, () => ({ file: 'main.py', title: 't', change: 'c' })) }, f.graph, { maxSteps: 12 });
    assert.equal(many.plan.steps.length, 12); assert.match(many.dropped[0], /more than 12 steps/);
    assert.ok(new Set(many.plan.steps.map(step => step.id)).size === 12, 'ids are unique');
  } finally { await f.cleanup(); }
});

test('the gate: hard failures name their cause and send a cheap draft to the default model; soft findings are only notes', async () => {
  const f = await fixture();
  try {
    const step = overrides => ({ file: 'app/render.py', startLine: 3, endLine: 10, title: 'T', change: 'Lower the limit to 60 seconds', why: 'y', ...overrides });
    const check = (steps, extra) => planner.validatePlan({ steps, starting: [] , ...extra }, f.graph);
    assert.equal(check([step()]).ok, true);
    assert.match(check([step({ file: 'app/missing.py' })]).hard[0].text, /^Step 1 names a file that is not in the project: app\/missing\.py\./);
    assert.match(check([step({ endLine: 500 })]).hard[0].text, /Step 1 uses lines 3–500 outside app\/render\.py \(\d+ lines\)\./);
    assert.match(check([step({ change: '  ' })]).hard[0].text, /does not say what to change/);
    assert.match(check([step({ change: 'Edit app/nowhere.py too' })]).hard[0].text, /mentions app\/nowhere\.py, which is not in the project/);
    assert.equal(check([step({ change: 'Also look at render.py' })]).ok, true, 'a file named by its short name is fine');
    assert.match(check([]).hard[0].text, /no steps/); assert.match(check(Array.from({ length: 13 }, () => step())).hard[0].text, /13 steps; the limit is 12/);
    // Soft: order and unused starting files never fail the gate.
    const soft = check([step({ file: 'app/checker.py', startLine: 1, endLine: 4 }), step()], { starting: ['utils/llm.py'] });
    assert.equal(soft.ok, true);
    assert.deepEqual(soft.soft.map(item => item.kind).sort(), ['order', 'tests', 'unused', 'users']);
    assert.match(soft.soft.find(item => item.kind === 'tests').text, /^Step 2 changes code that tests\/test_render\.py tests; the plan does not touch it\.$/, 'a thin plan says which tests it left out');
    assert.match(soft.soft.find(item => item.kind === 'users').text, /^Step 2 changes render\.py, which script\.py uses; none is in the plan\.$/, 'and which code depends on what it changes');
    assert.equal(check([step({ file: 'workflows/script.py', startLine: 1, endLine: 8 }), step({ file: 'app/checker.py', startLine: 1, endLine: 4 })]).soft.filter(item => item.kind === 'users').length, 1, 'a user that is itself in the plan is not reported');
    assert.match(soft.soft.find(item => item.kind === 'order').text, /Step 1 uses app\/render\.py, which step 2 changes\. Consider doing step 2 first\./);
  } finally { await f.cleanup(); }
});

test('using the plan: an agent prompt (whole or one step) and a Markdown export; skipped steps stay out of the prompt', () => {
  const plan = { goal: 'Cap shorts at 60 seconds', summary: 'Change one constant.', steps: [
    { id: 'a', file: 'app/render.py', startLine: 1, endLine: 1, title: 'Lower the limit', change: 'Set SHORT_WARN_S to 60', why: 'The new cap', note: 'ask Sam', status: 'todo', before: 'Limit is 90', after: 'Limit is 60' },
    { id: 'b', file: 'app/checker.py', startLine: 1, endLine: 4, title: 'Skip me', change: 'x', why: '', note: '', status: 'skipped' },
    { id: 'c', file: 'utils/llm.py', startLine: 3, endLine: 5, title: 'Done already', change: 'y', why: '', note: '', status: 'done' }] };
  const prompt = planner.promptFromPlan(plan);
  assert.match(prompt, /^Goal: Cap shorts at 60 seconds\n\nDo these steps in order\./);
  assert.match(prompt, /1\. Lower the limit\n   Where: app\/render\.py lines 1–1\n   Change: Set SHORT_WARN_S to 60\n   Why: The new cap\n   Today \(pseudocode\): Limit is 90\n   After \(pseudocode\): Limit is 60\n   My note: ask Sam/);
  assert.doesNotMatch(prompt, /Skip me/); assert.match(prompt, /3\. Done already \(already done\)/); assert.match(prompt, /Read the real source of each range before editing it\.$/);
  const only = planner.promptFromPlan(plan, { only: 1 }); assert.match(only, /Do this step only\./); assert.doesNotMatch(only, /Done already/);
  const markdown = planner.planToMarkdown(plan);
  assert.match(markdown, /^# Plan: Cap shorts at 60 seconds\n\nChange one constant\.\n\n## 1\. Lower the limit\n/); assert.match(markdown, /## 2\. Skip me \(skipped\)/); assert.match(markdown, /## 3\. Done already ✓/);
  assert.match(markdown, /\*\*Before → after \(pseudocode\)\*\*\n\n```text\nLimit is 90\n```\n\n```text\nLimit is 60\n```/);
});

test('plan requests: compact schemas, parsing that rejects bad answers, and the real token usage Claude reports', async () => {
  const known = new Set(['app/render.py']);
  assert.deepEqual(JSON.parse(JSON.stringify(engine.parsePlan(JSON.stringify({ summary: ' s ', steps: [{ file: 'app/render.py', lines: [3, 10], title: ' T ', change: ' c ', why: 'y' }] })))), { summary: 's', steps: [{ file: 'app/render.py', startLine: 3, endLine: 10, title: 'T', change: 'c', why: 'y' }] });
  for (const bad of ['{', JSON.stringify({ summary: 's', steps: [] }), JSON.stringify({ summary: 's', steps: Array.from({ length: 13 }, () => ({ file: 'a', lines: [1, 2], title: 't', change: 'c', why: '' })) }), JSON.stringify({ summary: 's', steps: [{ file: 'a', lines: [1], title: 't', change: 'c', why: '' }] })]) assert.throws(() => engine.parsePlan(bad), /plan/i);
  assert.deepEqual(engine.parseStepDetail(JSON.stringify({ before: '', after: ' Do it ' })), { before: '', after: 'Do it' }); assert.throws(() => engine.parseStepDetail(JSON.stringify({ before: '', after: '' })), /invalid/);
  assert.deepEqual(engine.parseRank(JSON.stringify({ files: ['app/render.py', 'not/real.py'] }), known), ['app/render.py']);
  const prompt = engine.planPrompt({ context: 'CONTEXT', goal: 'the goal', feedback: ['Step 1 names a file that is not in the project: x.py.'] });
  assert.ok(prompt.indexOf('You plan a code change') < prompt.indexOf('CONTEXT') && prompt.indexOf('CONTEXT') < prompt.indexOf('GOAL: "the goal"'), 'stable instructions first, the goal last, so the prefix can be cached');
  assert.match(prompt, /PROBLEMS TO FIX:\n- Step 1 names a file that is not in the project: x\.py\./); assert.match(prompt, /untrusted data/);
  // Claude's result carries usage; requestStructured passes it on.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-usage-')), binary = path.join(dir, 'claude.js');
  try {
    await fs.writeFile(binary, `const a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
process.stdin.resume();process.stdin.on('data',()=>{}).on('end',()=>process.stdout.write(JSON.stringify({type:'result',structured_output:{files:['app/render.py']},usage:{input_tokens:1200,cache_creation_input_tokens:300,cache_read_input_tokens:5000,output_tokens:90},total_cost_usd:0.012,modelUsage:{'claude-test':{}}})));`);
    const response = await engine.requestStructured({ provider: 'claude', cliPath: binary, prompt: 'p', schema: engine.RANK_SCHEMA, showPreview: false });
    assert.deepEqual(JSON.parse(JSON.stringify(response.usage)), { input: 1200, cacheWrite: 300, cacheRead: 5000, output: 90, costUsd: 0.012 });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('default and legacy automatic planning use one selected model; fast requires explicit selection', async () => {
  const f = await fixture();
  try {
    for (const files of [['main.py'], ['app/render.py', 'utils/llm.py'], Object.keys(f.graph.files)]) {
      for (const mode of [undefined, 'main', 'auto']) {
        const route = planner.routeFor(f.graph, files, mode);
        assert.equal(route.first, 'main'); assert.match(route.reason, /no automatic escalation/);
      }
      assert.equal(planner.routeFor(f.graph, files, 'fast').first, 'fast');
    }
  } finally { await f.cleanup(); }
});


test('planning context ignores stale pseudocode and uses current overview when logic is stale', async () => {
  const f = await fixture();
  try {
    const rel = 'app/render.py';
    f.explanations[rel] = { logic: { hash: 'old', title: 'STALE_SENTINEL', summary: '', sections: [{ title: 'STALE_SENTINEL', startLine: 1, endLine: 2, pseudocode: 'STALE_SENTINEL', lineMap: [] }] } };
    const build = () => planner.planContext(f.graph, f.notes, f.explanations, { goal: 'render', files: [rel], budget: 2000 });
    assert.doesNotMatch(build().text, /STALE_SENTINEL/);
    f.explanations[rel].overview = { hash: f.graph.files[rel].hash, title: 'CURRENT_SENTINEL', summary: '', sections: [{ title: 'Render CURRENT_SENTINEL', startLine: 1, endLine: 2, pseudocode: 'Render CURRENT_SENTINEL', lineMap: [] }] };
    assert.match(build().text, /CURRENT_SENTINEL/);
    assert.doesNotMatch(build().text, /STALE_SENTINEL/);
  } finally { await f.cleanup(); }
});


test('planning schema satisfies Codex strict required-property rules at every object level', () => {
  function check(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(check);
    }
    if (schema.items) check(schema.items);
  }
  check(engine.PLAN_SCHEMA);
  assert.ok(engine.PLAN_SCHEMA.required.includes('question'));
  const plan = { question: '', summary: 'Change the limit.', steps: [{ file: 'a.py', lines: [1, 1], title: 'Limit', change: 'Use 60.', why: 'Shorter.' }] };
  assert.equal(engine.parsePlan(JSON.stringify(plan)).steps.length, 1);
  delete plan.question;
  assert.equal(engine.parsePlan(JSON.stringify(plan)).steps.length, 1, 'legacy plans still parse');
  assert.equal(engine.parsePlan(JSON.stringify({ question: 'Which limit?', summary: 'Need a limit.', steps: [] })).question, 'Which limit?');
});


test('proposal colors distinguish additions and removals, with mixed and unclear changes kept yellow', () => {
  const { proposalKind } = require('../src/views/guide');
  const add = { title: 'Add training support', change: 'Create a training helper.' };
  const remove = { title: 'Remove old helper', change: 'Delete the unused helper.' };
  assert.equal(proposalKind(add), 'add');
  assert.equal(proposalKind(remove), 'remove');
  assert.equal(proposalKind({ title: 'Refactor training', change: 'Extract shared logic.' }), 'change');
  assert.equal(proposalKind({ title: 'Update limit', change: 'Set the limit to 60.' }), 'change');
  assert.equal(proposalKind([add, remove]), 'change', 'mixed file proposals must not imply a pure addition or removal');
  assert.equal(proposalKind({ title: 'Add replacement', change: 'Add a helper and remove the old implementation.' }), 'change');
  assert.equal(proposalKind([]), 'change');
});

test('agents read the saved human plan from storage without a .yamori mirror', async () => {
  const f = await fixture(), store = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-plan-mcp-'));
  try {
    await fs.writeFile(path.join(store, 'graph.json'), JSON.stringify(f.graph));
    await fs.writeFile(path.join(store, 'plan.json'), JSON.stringify({ current: { goal: 'Shorter videos', summary: 'Lower the cap.', dismissed: ['app/checker.py'], steps: [
      { id: 'a', file: 'app/render.py', startLine: 1, endLine: 1, title: 'Lower cap', change: 'Use 60.', why: 'Shorter.', note: 'Keep validation.', before: 'Use 90.', after: 'Use 60.', status: 'todo' },
      { id: 'b', file: 'app/checker.py', startLine: 1, endLine: 2, title: 'Rejected change', change: 'Do not do this.', status: 'skipped' }
    ] } }));
    const server = require('../src/project/mcp').createServer({ store, root: f.root });
    const list = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(list.result.tools.some(tool => tool.name === 'get_plan'));
    const call = async args => { const reply = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_plan', arguments: args } }); assert.ok(!reply.result.isError); const text = reply.result.content[0].text; return JSON.parse(text.slice(text.indexOf('\n') + 1)); };
    const plan = await call({}); assert.equal(plan.goal, 'Shorter videos'); assert.equal(plan.proposal, true); assert.equal(plan.steps.length, 1); assert.equal(plan.steps[0].comment, 'Keep validation.'); assert.equal(plan.steps[0].before, undefined);
    assert.deepEqual(plan.rejectedFiles, ['app/checker.py']);
    const full = await call({ include_pseudocode: true, include_skipped: true }); assert.equal(full.steps.length, 2); assert.equal(full.steps[0].proposed, 'Use 60.');
    assert.equal((await call({ path: 'app/render.py' })).steps.length, 1);
    const stored = JSON.parse(await fs.readFile(path.join(store, 'plan.json'), 'utf8'));
    stored.current.steps.push({ id: 'new', file: 'train_lstm.py', newFile: true, startLine: 0, endLine: 0, title: 'Create script', change: 'Train separately.', status: 'todo' });
    await fs.writeFile(path.join(store, 'plan.json'), JSON.stringify(stored));
    const proposed = await call({ path: 'train_lstm.py' }); assert.equal(proposed.steps.length, 1); assert.equal(proposed.steps[0].newFile, true); assert.equal(proposed.steps[0].sourceLines, null);
    await assert.rejects(fs.access(path.join(f.root, '.yamori')));
  } finally { await f.cleanup(); await fs.rm(store, { recursive: true, force: true }); }
});


test('idea canvas groups shared titles, links explicit file references, and avoids invented or ambiguous relationships', () => {
  const { planIdeaGraph, planCanvasLayout } = require('../src/views/guide');
  const step = (id, file, title, change) => ({ id, file, title, change, why: '', status: 'todo' });
  const plan = { dismissed: [], steps: [step('a', 'train.py', 'Reuse the loader', 'Read batches through data.py.'), step('b', 'evaluate.py', 'Reuse the loader', 'Read the same prepared batches.'), step('c', 'models.py', 'Add a transformer', 'Define the candidate architecture.'), step('d', 'train.py', 'Choose checkpoint', 'Keep weights using validation loss.'), step('e', 'train.py', 'Keep utility', 'Use utils.py.')] };
  const graph = planIdeaGraph(plan, ['data.py', 'left/utils.py', 'right/utils.py', 'unrelated.py']);
  const reuse = graph.ideas.find(idea => idea.id === 'a');
  assert.equal(graph.ideas.length, 4); assert.deepEqual(reuse.steps.map(step => step.id), ['a', 'b']);
  assert.deepEqual(reuse.files, ['train.py', 'data.py', 'evaluate.py']);
  assert.deepEqual(graph.files.find(file => file.id === 'data.py'), { id: 'data.py', count: 0, changed: false });
  assert.ok(!graph.files.some(file => /utils|unrelated/.test(file.id)), 'ambiguous short names and unrelated files are not connected');
  const layout = planCanvasLayout(graph, { expanded: 'train.py' });
  const rects = [...Object.values(layout.files), ...Object.values(layout.ideas)];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(!(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y), 'idea labels do not overlap file boxes or expanded changes');
  }
  assert.ok(layout.files['train.py'].h > 64);
});


test('plan patches preserve untouched steps, annotations and IDs, and reject invalid edits atomically', () => {
  const graph = { files: { 'a.py': { lines: 20 }, 'b.py': { lines: 30 } } };
  const plan = { id: 'p', summary: 'Original goal', dismissed: [], steps: [
    { id: 'one', file: 'a.py', startLine: 1, endLine: 5, title: 'Load input', change: 'Read x', why: '', note: 'Keep my note', status: 'done', before: 'Old snippet', after: 'Old proposal' },
    { id: 'two', file: 'b.py', startLine: 2, endLine: 8, title: 'Train model', change: 'Train it', why: '', note: 'Other note', status: 'todo', after: 'Untouched proposal' }
  ] };
  const blank = { message: 'Updated.', question: '', summary: '', updates: [], additions: [], removals: [] };
  const update = { id: 'one', file: 'a.py', lines: [1, 6], title: 'Load validated input', change: 'Validate x', why: 'Reject invalid input.' };
  const patch = engine.parsePlanPatch(JSON.stringify({ ...blank, updates: [update] }));
  const out = planner.applyPlanPatch(plan, patch, graph);
  assert.equal(out.steps[1], plan.steps[1], 'unmentioned steps and cached snippets are kept');
  assert.equal(out.steps[0].id, 'one'); assert.equal(out.steps[0].note, 'Keep my note'); assert.equal(out.steps[0].status, 'done');
  assert.equal(out.steps[0].after, undefined, 'changed pseudocode is invalidated'); assert.equal(out.summary, plan.summary);
  assert.equal(plan.steps[0].after, 'Old proposal', 'the original plan is not mutated');
  const answer = planner.applyPlanPatch(plan, blank, graph); assert.deepEqual(answer.steps, plan.steps, 'a conversation answer has no plan edits');
  for (const bad of [{ ...blank, updates: [{ ...update, id: 'missing' }] }, { ...blank, updates: [{ ...update, lines: [1, 100] }] }, { ...blank, removals: ['missing'] }, { ...blank, removals: ['one', 'one'] }, { ...blank, updates: [{ ...update, file: '__proto__' }] }, { ...blank, question: 'Clarify?', updates: [update] }, { ...blank, updates: [update, update] }]) assert.throws(() => planner.applyPlanPatch(plan, bad, graph));
  assert.throws(() => planner.applyPlanPatch({ ...plan, dismissed: ['a.py'] }, patch, graph), /rejected/);
  assert.throws(() => engine.parsePlanPatch(JSON.stringify({ ...blank, extra: 'invalid' })), /invalid/i);
  assert.throws(() => engine.parsePlanPatch(JSON.stringify({ ...blank, updates: [{ id: 'one' }] })), /invalid/i);
});


test('planning patch schema stays within Codex strict output constraints', () => {
  const { PLAN_PATCH_SCHEMA } = engine;
  function check(node) {
    assert.equal(node.uniqueItems, undefined, 'uniqueItems is enforced locally, not sent to Codex');
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); }
    if (node.properties) Object.values(node.properties).forEach(check);
    if (node.items) check(node.items);
    if (node.anyOf) node.anyOf.forEach(check);
  }
  check(PLAN_PATCH_SCHEMA);
  check(require('../src/ai/schemas').PLAN_SESSION_SCHEMA);
});


test('plans can propose a safe new file without pretending it has existing source lines', async () => {
  const f = await fixture();
  try {
    const original = { id: 'p-new', goal: 'Train LSTM separately', summary: 'Existing plan', starting: [], dismissed: [], steps: [{ id: 'keep', file: 'app/render.py', startLine: 1, endLine: 2, title: 'Keep loader', change: 'Reuse the loader', why: '', note: 'Keep this note', status: 'todo' }] };
    const patch = engine.parsePlanPatch(JSON.stringify({ message: 'Add the new script.', question: '', summary: '', updates: [], removals: [], additions: [{ afterId: '', file: 'train_lstm.py', lines: [0, 0], title: 'Create standalone LSTM training', change: 'Train the LSTM in a separate script.', why: 'Keep the existing workflow intact.' }] }));
    const result = planner.applyPlanPatch(original, patch, f.graph), added = result.steps[1];
    assert.equal(added.newFile, true); assert.equal(added.startLine, 0); assert.equal(added.endLine, 0); assert.equal(result.steps[0], original.steps[0]);
    const saved = planner.normalizePlan(result, f.graph).plan;
    assert.equal(saved.steps.length, 2); assert.equal(saved.steps[1].newFile, true);
    assert.equal(planner.validatePlan({ steps: [added] }, f.graph).ok, true);
    assert.match(planner.planToMarkdown(saved), /new file proposal; no source lines yet/);
    assert.doesNotMatch(planner.planToMarkdown(saved), /lines 0/);
    await assert.rejects(fs.access(path.join(f.root, 'train_lstm.py')));
    for (const file of ['../train.py', '/tmp/train.py', 'C:\\train.py', '__proto__', 'folder//train.py']) assert.throws(() => planner.applyPlanPatch(original, { ...patch, additions: [{ ...patch.additions[0], file }] }, f.graph));
    assert.throws(() => planner.applyPlanPatch(original, { ...patch, additions: [{ ...patch.additions[0], lines: [1, 100] }] }, f.graph), /New files must use/);
    assert.throws(() => planner.applyPlanPatch(original, { ...patch, additions: [{ ...patch.additions[0], file: 'app/render.py' }] }, f.graph), /invalid source range/);
  } finally { await f.cleanup(); }
});


test('unified proposed pseudocode distinguishes additions, replacements and unchanged context without showing removed text', () => {
  const { planPseudocodeDiff } = require('../src/views/guide');
  const diff = planPseudocodeDiff('L11 Read data\nSet limit to 60\nReturn results\nSave results', { before: 'L10 Read data\nSet limit to 90\nReturn results' });
  assert.deepEqual(diff.lines.map(line => line.change), ['', 'change', '', 'add']);
  assert.ok(!diff.lines.some(line => line.text.includes('90')));
  assert.equal(diff.removed, 0);
  const removed = planPseudocodeDiff('Read data\nReturn results', { before: 'Read data\nLog debug details\nReturn results' });
  assert.equal(removed.removed, 1); assert.ok(removed.lines.every(line => !line.change));
  const fresh = planPseudocodeDiff('Define classifier\nTrain classifier', { newFile: true, title: 'Define the network' });
  assert.ok(fresh.lines.every(line => line.change === 'add'));
  assert.equal(planPseudocodeDiff('Add a metric', { title: 'Add metric' }).lines[0].change, 'add');
  assert.equal(planPseudocodeDiff('Use a new threshold', { title: 'Change threshold' }).lines[0].change, 'change');
});


test('canvas paths wrap without losing directories and grow file boxes to fit', () => {
  const { planFilePathLines, planFileHeight, planCanvasLayout } = require('../src/views/guide');
  const file = 'src/experiments/transformer/features/long_feature_embedding_name.ts';
  const lines = planFilePathLines(file);
  assert.equal(lines.join(''), file);
  assert.ok(lines.every(line => line.length <= 30));
  assert.ok(planFileHeight(file) > planFileHeight('model.py'));
  const layout = planCanvasLayout({ files: [{ id: file, count: 1 }], ideas: [] });
  assert.equal(layout.files[file].h, planFileHeight(file));
});


test('targeted MCP reads reach source beyond a capped overview and keep outside symlinks inaccessible', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-capped-plan-'));
  try {
    const repo = path.join(root, 'repo'), store = path.join(root, 'store'); await fs.mkdir(path.join(repo, 'assets'), { recursive: true }); await fs.mkdir(path.join(repo, 'src')); await fs.mkdir(store);
    await Promise.all(Array.from({ length: 505 }, (_, i) => fs.writeFile(path.join(repo, 'assets', i + '.md'), '# Preview\n')));
    await fs.writeFile(path.join(repo, 'src', 'calculate.py'), 'def calculate():\n    return 42\n');
    const indexer = new project.Indexer(), capped = await project.scanFolder(repo, undefined, indexer); assert.equal(capped.files['src/calculate.py'], undefined);
    const server = require('../src/project/mcp').createServer({ root: repo, store });
    const result = await server.call('read_source', { path: 'src/calculate.py', start_line: 1, end_line: 2 }); assert.equal(result.isError, undefined); assert.match(result.content[0].text, /return 42/);
    await fs.writeFile(path.join(store, 'plan.json'), JSON.stringify({ current: { steps: [{ file: 'src/calculate.py', startLine: 1, endLine: 2 }] } }));
    const reopened = require('../src/project/mcp').createServer({ root: repo, store }); await reopened.call('project_overview', {});
    assert.ok(JSON.parse(await fs.readFile(path.join(store, 'graph.json'), 'utf8')).files['src/calculate.py'], 'subsequent capped scans retain files used by the plan');
    await fs.writeFile(path.join(root, 'private.py'), 'PRIVATE_CONTENT'); await fs.symlink(path.join(root, 'private.py'), path.join(repo, 'src', 'outside.py'));
    const outside = await server.call('read_source', { path: 'src/outside.py' }); assert.equal(outside.isError, true); assert.doesNotMatch(outside.content[0].text, /PRIVATE_CONTENT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('planning can verify local commit authorship without a shell or model turn', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-history-tool-'));
  try {
    const { execFileSync } = require('node:child_process'), git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['init', '-q']); await fs.writeFile(path.join(root, 'source.py'), 'answer = 42\n'); git(['add', 'source.py']);
    git(['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Add source']);
    const store = path.join(root, 'store'); await fs.mkdir(store); const server = require('../src/project/mcp').createServer({ root, store });
    const result = await server.call('git_history', { author: 'Fixture Author', limit: 2 }); assert.equal(result.isError, undefined); assert.match(result.content[0].text, /Fixture Author/); assert.match(result.content[0].text, /source.py/);
    const missing = await server.call('git_history', { author: 'Different Author' }); assert.match(missing.content[0].text, /No matching local commits/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
