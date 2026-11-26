'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const project = require('../src/project/graph');
const { StageDb, available } = require('../src/stages/db');
const { createRun, normalizeBudget } = require('../src/stages/budget');
const stages = require('../src/stages/generate');
const { createStageScheduler, timing } = require('../src/stages/scheduler');

const FIXTURE = path.join(__dirname, 'fixtures', 'agent-repo');
const skip = !available() && 'node:sqlite is not available in this runtime';

let cachedGraph;
async function fixtureGraph() {
  cachedGraph ||= await project.scanFolder(FIXTURE, undefined, new project.Indexer());
  return structuredClone(cachedGraph);
}
function notesFor(graph) {
  const purposes = { 'main.py': 'Runs the agent loop: plan, act, evaluate.', 'agent/planner.py': 'Turns a goal into steps.', 'agent/actor.py': 'Runs each step with a tool.', 'agent/evaluator.py': 'Scores the results.', 'agent/tools.py': 'Tool calls.', 'agent/prompts.py': 'Prompt templates.' };
  return { files: Object.fromEntries(Object.entries(graph.files).map(([rel, file]) => [rel, { hash: file.hash, purpose: purposes[rel] || '', role: 'core', terms: [] }])) };
}
function explanationsFor(graph) {
  const out = {};
  for (const [rel, file] of Object.entries(graph.files)) out[rel] = { logic: { hash: file.hash, sections: stages.symbolsOf(file).map(def => ({ title: def.name, startLine: def.start || def.line, endLine: def.end || def.line, pseudocode: 'do ' + def.name + ' v1', lineMap: [] })) } };
  return out;
}
const STAGES = { stages: [
  { id: 'plan', name: 'Plan', gist: 'Turn the goal into steps.', input: 'user goal', output: 'list of steps', steps: [{ file: 'agent/planner.py', symbol: 'plan' }, { file: 'agent/planner.py', symbol: 'build_prompt' }, { file: 'agent/planner.py', symbol: 'split_steps' }] },
  { id: 'act', name: 'Act', gist: 'Run each step with a tool.', input: 'list of steps', output: 'tool results', steps: [{ file: 'agent/actor.py', symbol: 'act' }, { file: 'agent/actor.py', symbol: 'run_step' }, { file: 'agent/tools.py', symbol: 'call_tool' }] },
  { id: 'evaluate', name: 'Evaluate result', gist: 'Score the results.', input: 'tool results', output: 'verdict', steps: [{ file: 'agent/evaluator.py', symbol: 'evaluate' }, { file: 'agent/evaluator.py', symbol: 'grade' }, { file: 'agent/prompts.py', symbol: 'EVAL_PROMPT' }, { file: 'nowhere.py', symbol: 'ghost' }] }
] };
function fakeModel(responses) {
  const calls = [];
  const request = async ({ prompt, schema, tier }) => {
    calls.push({ prompt, schema, tier });
    const next = typeof responses === 'function' ? responses(prompt, calls.length) : responses.shift();
    return { raw: JSON.stringify(next), usage: { input: 1000, cacheRead: 200, cacheWrite: 0, output: 150, costUsd: 0.001 }, model: 'cheap-model' };
  };
  return { request, calls };
}
async function setup() {
  const db = new StageDb(':memory:'), graph = await fixtureGraph();
  const ctx = { db, graph, notes: notesFor(graph), explanations: explanationsFor(graph), provider: 'claude', model: 'cheap-model' };
  return ctx;
}
const runFor = (db, budget) => createRun(db, { budget: budget || { perRun: 0, perDay: 0 }, trigger: 'test' });
// Simulate an edit: new hash in the graph and fresh pseudocode for the edited symbol.
function edit(ctx, file, symbol, text) {
  const hash = 'edited-' + Math.random().toString(36).slice(2);
  ctx.graph.files[file].hash = hash;
  ctx.explanations[file].logic.hash = hash;
  if (symbol) ctx.explanations[file].logic.sections.find(section => section.title === symbol).pseudocode = text;
  return hash;
}

test('stage generation reads AI notes, stores 3–7 ordered stages with line-linked steps, and logs the call', { skip }, async () => {
  const ctx = await setup(), model = fakeModel([STAGES]);
  const result = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  assert.equal(result.calls, 1); assert.equal(model.calls.length, 1); assert.equal(model.calls[0].tier, 'cheap');
  assert.equal(result.workflowId, 'run_agent'.replace('_', '-'));
  const list = ctx.db.stages(result.workflowId);
  assert.deepEqual(list.map(stage => stage.name), ['Plan', 'Act', 'Evaluate result']);
  assert.deepEqual(list.map(stage => stage.position), [0, 1, 2]);
  const evaluate = ctx.db.steps(result.workflowId, 'evaluate');
  assert.equal(evaluate.length, 3, 'the invented step is dropped');
  const grade = evaluate.find(step => step.symbol === 'grade'), def = ctx.graph.files['agent/evaluator.py'].defs.find(item => item.name === 'grade');
  assert.equal(grade.line_start, def.line); assert.equal(grade.line_end, def.end);
  // The prompt carries notes, not raw source, and is sorted by path.
  const prompt = model.calls[0].prompt;
  assert.match(prompt, /Turns a goal into steps/); assert.doesNotMatch(prompt, /return \[line for line/);
  assert.ok(prompt.indexOf('"agent/actor.py"') < prompt.indexOf('"main.py"'));
  const usage = ctx.db.usage({});
  assert.deepEqual([usage.calls, usage.input, usage.cached, usage.output], [1, 1000, 200, 150]);
});

test('zero-call reads and zero-call reruns', { skip }, async () => {
  const ctx = await setup(), model = fakeModel([STAGES]);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  const again = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  assert.equal(again.calls, 0); assert.ok(again.reused);
  const view = stages.stageView(ctx.db, ctx.graph, ctx.explanations, workflowId, 'plan');
  assert.equal(view.steps[0].pseudocode, '## plan\ndo plan v1'); assert.ok(view.steps[0].pseudocodeCurrent);
  assert.equal(stages.workflowView(ctx.db, ctx.graph, workflowId).stages.length, 3);
  assert.equal(model.calls.length, 1);
});

test('editing one file used by one stage makes exactly one cheap call for that stage and logs a plain-sentence change', { skip }, async () => {
  const ctx = await setup(), model = fakeModel(prompt => /REFRESH|Code behind one stage changed/.test(prompt)
    ? { name: 'Evaluate result', gist: 'Score the results; retry twice before failing.', input: 'tool results', output: 'verdict', steps: [{ file: 'agent/evaluator.py', symbol: 'evaluate' }, { file: 'agent/evaluator.py', symbol: 'grade' }], behaviorChanged: true, summary: 'Evaluate now retries twice before failing.' }
    : STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  const hash = edit(ctx, 'agent/evaluator.py', 'grade', 'do grade with two retries');
  const affected = stages.fileChanged(ctx.db, 'agent/evaluator.py', hash);
  assert.deepEqual(affected.map(stage => stage.id), ['evaluate']);
  assert.deepEqual(ctx.db.stages(workflowId).map(stage => stage.stale), [false, false, true]);
  const result = await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db) });
  assert.equal(result.calls, 1); assert.equal(model.calls.length, 2);
  assert.match(model.calls[1].prompt, /do grade v1/); assert.match(model.calls[1].prompt, /do grade with two retries/);
  assert.doesNotMatch(model.calls[1].prompt, /Turn the goal into steps/, 'other stages are not re-sent');
  const [change] = ctx.db.changes(workflowId, { status: 'pending' });
  assert.equal(change.stage_id, 'evaluate'); assert.equal(change.summary, 'Evaluate now retries twice before failing.');
  assert.deepEqual(change.detail.steps.find(step => step.symbol === 'grade'), { file: 'agent/evaluator.py', symbol: 'grade', before: '## grade\ndo grade v1', after: '## grade\ndo grade with two retries' });
  assert.equal(ctx.db.stages(workflowId).some(stage => stage.stale), false);
  // Rerun with nothing new: no calls.
  assert.equal((await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) })).calls, 0);
});

test('a shared file marks every stage that uses it, and each gets at most one call after the burst settles', { skip }, async () => {
  const ctx = await setup();
  const shared = { stages: STAGES.stages.map(stage => stage.id === 'act' ? { ...stage, steps: [...stage.steps, { file: 'agent/prompts.py', symbol: 'PLAN_PROMPT' }] } : stage) };
  const model = fakeModel(prompt => /Code behind one stage changed/.test(prompt) ? { name: 'Same', gist: 'Same.', input: 'a', output: 'b', steps: [{ file: 'agent/prompts.py', symbol: 'PLAN_PROMPT' }], behaviorChanged: false, summary: '' } : shared);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  for (const file of ['agent/prompts.py', 'agent/tools.py', 'agent/actor.py']) stages.fileChanged(ctx.db, file, edit(ctx, file));
  assert.deepEqual(ctx.db.staleStages(workflowId).map(row => row.id), ['act', 'evaluate']);
  const result = await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db) });
  assert.equal(result.calls, 2, 'one call per affected stage, not per file');
  assert.equal(ctx.db.changes(workflowId).length, 0, 'no behavior change, no review item');
  assert.equal(stages.workflowStatus(ctx.db, ctx.graph, workflowId).changedFiles.length, 0);
});

test('pinned and renamed stages survive regeneration and never go stale', { skip }, async () => {
  const ctx = await setup(), model = fakeModel(() => STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  stages.renameStage(ctx.db, workflowId, 'act', 'Use tools');
  stages.fileChanged(ctx.db, 'agent/actor.py', edit(ctx, 'agent/actor.py'));
  assert.equal(ctx.db.stage(workflowId, 'act').stale, false);
  await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db), force: true });
  const act = ctx.db.stage(workflowId, 'act');
  assert.equal(act.name, 'Use tools'); assert.ok(act.pinned);
  assert.equal(ctx.db.stages(workflowId).length, 3);
  assert.match(model.calls.at(-1).prompt, /"pinned":true/);
  // Move a step into a new stage (split) and merge it back.
  const created = stages.moveStep(ctx.db, workflowId, { from: 'plan', position: 2, newName: 'Split steps' });
  assert.deepEqual(ctx.db.stages(workflowId).map(stage => stage.id), ['plan', created, 'act', 'evaluate']);
  stages.mergeStages(ctx.db, workflowId, 'plan', created);
  assert.deepEqual(ctx.db.steps(workflowId, 'plan').map(step => step.symbol), ['plan', 'build_prompt', 'split_steps']);
});

test('budgets stop a call before it is made and leave the stage as needs update', { skip }, async () => {
  const ctx = await setup(), model = fakeModel(() => STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  stages.fileChanged(ctx.db, 'agent/planner.py', edit(ctx, 'agent/planner.py'));
  const result = await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db, { perRun: 0, perDay: 1500 }) });
  assert.equal(result.calls, 0); assert.equal(model.calls.length, 1);
  assert.match(result.skipped[0].reason, /daily budget/);
  assert.ok(ctx.db.stage(workflowId, 'plan').stale);
  await assert.rejects(stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', id: 'other', request: model.request, run: runFor(ctx.db, { perRun: 10, perDay: 0 }) }), /per-run budget/);
  assert.deepEqual(normalizeBudget(5000), { perRun: 60000, perDay: 5000 });
});

test('the estimate lists files without notes and the "only these files" option limits the input', { skip }, async () => {
  const ctx = await setup();
  delete ctx.notes.files['agent/tools.py'];
  const estimate = stages.estimateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent' });
  assert.deepEqual(estimate.missingNotes, ['agent/tools.py']);
  assert.ok(estimate.tokens > 0); assert.equal(estimate.escalated, 1, 'a coarse note falls back to the pseudocode outline');
  const model = fakeModel(() => STAGES);
  await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', files: ['main.py', 'agent/planner.py'], request: model.request, run: runFor(ctx.db) }).catch(() => {});
  assert.doesNotMatch(model.calls[0].prompt, /agent\/actor\.py/);
});

test('the scheduler coalesces an agent burst into one run and runs at once on done', async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 20, idle: 80, burstFiles: 3, pauseRetry: 20 });
  try {
    const runs = [];
    const scheduler = createStageScheduler(async files => { runs.push(files); });
    for (const file of ['a', 'b', 'c', 'd', 'a']) scheduler.saved(file);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(runs.length, 0, 'a burst waits for idle');
    scheduler.done(); await new Promise(resolve => setTimeout(resolve, 10)); await scheduler.running;
    assert.deepEqual(runs, [['a', 'b', 'c', 'd']]);
    let busy = true;
    const paused = createStageScheduler(async files => { runs.push(files); }, { paused: async () => busy });
    paused.saved('x'); await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(runs.length, 1, 'nothing runs during a rebase');
    busy = false; await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(runs[1], ['x']);
    scheduler.dispose(); paused.dispose();
  } finally { Object.assign(timing, saved); }
});

test('review: approving moves the baseline, the queue empties into reviewed, and what_changed reads since the last review', { skip }, async () => {
  const review = require('../src/stages/review');
  const ctx = await setup();
  const model = fakeModel(prompt => /Code behind one stage changed/.test(prompt)
    ? { name: 'Plan', gist: 'g', input: 'a', output: 'b', steps: [{ file: 'agent/planner.py', symbol: 'plan' }], behaviorChanged: true, summary: 'Plan now drops empty steps.' }
    : STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  stages.fileChanged(ctx.db, 'agent/planner.py', edit(ctx, 'agent/planner.py', 'plan', 'do plan v2'));
  await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db) });
  const [change] = review.reviewQueue(ctx.db, workflowId);
  assert.equal(change.stage_name, 'Plan');
  assert.equal(review.whatChanged(ctx.db, workflowId).changes.length, 1);
  const decided = review.decide(ctx.db, change.id, 'approved', 'Empty steps confused the actor.', { headSha: 'def456' });
  assert.equal(decided.status, 'approved'); assert.equal(decided.why, 'Empty steps confused the actor.'); assert.ok(decided.reviewed);
  assert.equal(ctx.db.snapshot(workflowId, 'agent/planner.py', 'plan'), '## plan\ndo plan v2');
  assert.equal(ctx.db.workflow(workflowId).base_sha, 'def456');
  assert.throws(() => review.decide(ctx.db, change.id, 'rejected'), /already approved/);
  // A later change of the same step is shown against what was accepted.
  await new Promise(resolve => setTimeout(resolve, 5));
  stages.fileChanged(ctx.db, 'agent/planner.py', edit(ctx, 'agent/planner.py', 'plan', 'do plan v3'));
  await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db) });
  assert.match(model.calls.at(-1).prompt, /do plan v2/);
  const since = review.whatChanged(ctx.db, workflowId);
  assert.equal(since.changes.length, 1); assert.equal(since.pending, 1);
  assert.equal(review.whatChanged(ctx.db, workflowId, { sinceReview: false }).changes.length, 2);
});

test('the review diff marks removed and added pseudocode lines', () => {
  const { lineDiff } = require('../src/views/stages');
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd').map(line => line.kind + ':' + line.text), ['same:a', 'del:b', 'add:B', 'same:c', 'add:d']);
});

test('vault: readable system, part and step notes; managed parts rewritten, your text kept, renames pinned, orphans archived, decisions logged', { skip }, async () => {
  const fs = require('node:fs'), os = require('node:os');
  const { Vault, parseNote, mergeNote } = require('../src/stages/vault');
  const review = require('../src/stages/review');
  const ctx = await setup(), model = fakeModel(prompt => /Code behind one stage changed/.test(prompt)
    ? { name: 'Act', gist: 'g', input: 'a', output: 'b', steps: [{ file: 'agent/actor.py', symbol: 'act', what: 'Runs the steps' }], behaviorChanged: true, summary: 'Act now runs steps in parallel.' } : STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  ctx.db.setPart(workflowId, { name: 'Agent loop', summary: 'Plans, acts and checks the result.', folder: '(root)', position: 0 });
  ctx.db.setMeta('system_summary', 'An agent that works toward a goal.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-vault-'));
  try {
    assert.equal(new Vault({ root }).dir, path.join(root, '.yamori', 'notes'));
    const vault = new Vault({ root, vaultPath: path.join(root, 'vault') });
    assert.equal(vault.dir, path.join(root, 'vault', 'Yamori', path.basename(root)));
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    assert.match(fs.readFileSync(vault.systemFile(), 'utf8'), /# How .* works\n\nAn agent that works toward a goal\.\n\n```mermaid\nflowchart LR\n {2}p0\["Agent loop"\]\n```\n\n## Parts\n\n- \[\[Agent loop\/Agent loop\|Agent loop\]\]: Plans, acts and checks the result\./);
    const partNote = fs.readFileSync(path.join(vault.dir, 'Agent loop', 'Agent loop.md'), 'utf8');
    assert.match(partNote, /```mermaid\nflowchart LR\n {2}s0\["1\. Plan"\]\n {2}s1\["2\. Act"\]\n {2}s2\["3\. Evaluate result"\]\n {2}s0 --> s1\n {2}s1 --> s2\n```/);
    assert.match(partNote, /## Steps\n\n1\. \[\[Agent loop\/Plan\|Plan\]\]: Turn the goal into steps\./);
    // A note per code file: what it is for, where it is used, what it uses.
    const codeNote = fs.readFileSync(path.join(vault.dir, 'Code', 'agent', 'planner.py.md'), 'utf8');
    assert.match(codeNote, /Turns a goal into steps\./); assert.match(codeNote, /## Used in\n\n- \[\[Agent loop\/Plan\|Agent loop › Plan\]\]/);
    const planFile = vault.findStageNote(workflowId, 'plan');
    assert.equal(planFile, path.join(vault.dir, 'Agent loop', 'Plan.md'));
    let text = fs.readFileSync(planFile, 'utf8');
    assert.match(text, /^---\ntype: step\npart: Agent loop\nworkflow: run-agent\nstage_id: plan\nname: Plan/);
    assert.match(text, /Step 1 of 3 in \[\[Agent loop\/Agent loop\|Agent loop\]\]/);
    assert.match(text, /\*\*Next:\*\* \[\[Agent loop\/Act\|Act\]\]/);
    assert.match(text, /> - `plan` in \[\[Code\/agent\/planner\.py\|planner\.py\]\] · \[open\]\(vscode:\/\/cowana-ai\.yamori\/open\?file=agent%2Fplanner\.py&line=4/);
    assert.match(text, /\*\*Files:\*\* \[\[Code\/agent\/planner\.py\|planner\.py\]\]/);
    // Founder notes in Obsidian and from the card/MCP.
    fs.writeFileSync(planFile, text.replace('## Your notes\n', '## Your notes\n\nNever store PII in prompts.\n'));
    vault.addNote(ctx.db, workflowId, 'plan', 'Keep plans under 10 steps.', { author: 'Claude Code', at: new Date('2026-11-26T10:00:00Z') });
    assert.equal(vault.stageNotes(workflowId, 'plan').text, 'Never store PII in prompts.\n- 2026-11-26 · Claude Code: Keep plans under 10 steps.');
    vault.addSystemNote(ctx.db, 'All AI calls go through the budget.', { at: new Date('2026-11-26T10:00:00Z') });
    assert.match(vault.constraints(workflowId, 'plan'), /^Whole system:\n- 2026-11-26 · You: All AI calls go through the budget\.\n\nThis step:\nNever store PII/);
    // Edits inside the managed part are restored; free text survives.
    fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('**Takes:**', '**Hacked:**'));
    ctx.db.updateStage(workflowId, 'plan', { gist: 'New gist.' });
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    text = fs.readFileSync(planFile, 'utf8');
    assert.match(text, /\*\*What it does:\*\* New gist\./); assert.doesNotMatch(text, /Hacked/);
    assert.match(text, /Never store PII in prompts\./); assert.match(text, /Keep plans under 10 steps\./);
    // A rename in front matter becomes a pinned override (no AI).
    fs.writeFileSync(planFile, text.replace('name: Plan\n', 'name: Think ahead\n'));
    const renames = vault.renames(ctx.db, workflowId);
    assert.deepEqual(renames, [{ stageId: 'plan', name: 'Think ahead' }]);
    stages.renameStage(ctx.db, workflowId, 'plan', renames[0].name);
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    assert.deepEqual(vault.renames(ctx.db, workflowId), []);
    assert.equal(model.calls.length, 1);
    // A decision lands in Changes/<date>.md in plain words.
    stages.fileChanged(ctx.db, 'agent/actor.py', edit(ctx, 'agent/actor.py', 'act', 'do act in parallel'));
    await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db) });
    const [change] = review.reviewQueue(ctx.db, workflowId);
    const log = vault.appendChange(ctx.db, review.decide(ctx.db, change.id, 'approved', 'Faster on big inboxes.'), { at: new Date('2026-11-26T14:02:00Z') });
    assert.match(fs.readFileSync(log, 'utf8'), /# What changed on 2026-11-26\n\n- 14:02 · Agent loop › \[\[Agent loop\/Act\|Act\]\]: Act now runs steps in parallel\. \*\*Approved\.\*\*\n {2}- Why: Faster on big inboxes\./);
    // History writes itself in the step note and the system note.
    ctx.db.addRequest({ intent: 'run steps in parallel', targets: [{ part: workflowId, stage: 'act' }], outcome: 'applied', files: ['agent/actor.py'] });
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    assert.match(fs.readFileSync(path.join(vault.dir, 'Agent loop', 'Act.md'), 'utf8'), /## History\n\n- \d{4}-\d\d-\d\d · (You asked: “run steps in parallel” \(applied\)|Act now runs steps in parallel\. \(kept: Faster on big inboxes\.\))\n- \d{4}-\d\d-\d\d · (You asked|Act now)/);
    assert.match(fs.readFileSync(vault.systemFile(), 'utf8'), /## Lately\n\n- .*(You asked: “run steps in parallel” \(applied\)|Agent loop › Act: Act now runs steps in parallel\. \(kept\))/);
    vault.appendRequest(ctx.db, { intent: 'log failures', targets: [{ part: workflowId, stage: 'act' }], outcome: 'given to your agent' }, { at: new Date('2026-11-26T15:00:00Z') });
    assert.match(fs.readFileSync(log, 'utf8'), /- 15:00 · You asked: “log failures” in Agent loop › Act\. \*\*Given to your agent\.\*\*/);
    // A step that disappears: its note moves to _archive with the founder's text.
    stages.mergeStages(ctx.db, workflowId, 'act', 'plan');
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    assert.equal(fs.existsSync(planFile), false);
    assert.match(fs.readFileSync(path.join(vault.dir, '_archive', 'Agent loop', 'Plan.md'), 'utf8'), /Never store PII/);
    // A note the user created by hand is never touched.
    const mine = path.join(vault.dir, 'Agent loop', 'My thoughts.md');
    fs.writeFileSync(mine, '# Mine\n'); vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes });
    assert.equal(fs.readFileSync(mine, 'utf8'), '# Mine\n');
    const merged = mergeNote('---\ntags: [agent]\nname: X\n---\nhello', { front: { type: 'step', name: 'Y' }, managed: 'M' });
    assert.deepEqual(parseNote(merged).front, { tags: ['agent'], name: 'Y', type: 'step' });
    assert.match(merged, /<!-- yamori:end -->\n\nhello$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('steer: previews with the main model on the stage\'s own code, rejects edits outside it, and applies or undoes atomically', { skip }, async () => {
  const fs = require('node:fs');
  const steer = require('../src/stages/steer');
  const ctx = await setup(), model = fakeModel(() => STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  const view = stages.stageView(ctx.db, ctx.graph, ctx.explanations, workflowId, 'act');
  const files = new Map(['agent/actor.py', 'agent/tools.py'].map(file => [file, fs.readFileSync(path.join(FIXTURE, file), 'utf8')]));
  let failWrite;
  const io = { read: async file => files.get(file), write: async (file, text) => { if (failWrite === file) throw new Error('disk full'); files.set(file, text); } };
  const prompts = [];
  const reply = value => async ({ prompt, tier }) => { prompts.push({ prompt, tier }); return { raw: JSON.stringify(value), usage: { input: 2000, output: 300 }, model: 'main-model' }; };
  const good = { summary: 'Act retries a failed tool call once.', edits: [
    { file: 'agent/actor.py', startLine: 8, endLine: 9, replacement: 'def run_step(step):\n    result = call_tool("search", step)\n    return result or call_tool("search", step)', why: 'Retry once.' },
    { file: 'agent/tools.py', startLine: 2, endLine: 2, replacement: '    return {"tool": name, "argument": argument, "ok": True}', why: 'Report success.' }] };
  const preview = await steer.previewSteer({ db: ctx.db, view, notes: 'Never call paid tools twice.', intent: 'retry failed tools', io, request: reply(good), run: runFor(ctx.db), provider: 'claude', model: 'main-model', workflowId });
  assert.equal(prompts[0].tier, 'main'); assert.match(prompts[0].prompt, /Never call paid tools twice/); assert.match(prompts[0].prompt, /8: def run_step\(step\):/);
  assert.doesNotMatch(prompts[0].prompt, /PLAN_PROMPT/, 'only this stage\'s code is sent');
  assert.deepEqual(preview.files.map(file => file.file), ['agent/actor.py', 'agent/tools.py']);
  assert.equal(ctx.db.calls({})[0].trigger, 'stages.steer');
  // Out of range, or overlapping: no preview.
  await assert.rejects(steer.previewSteer({ db: ctx.db, view, intent: 'x', io, request: reply({ summary: 's', edits: [{ file: 'agent/planner.py', startLine: 1, endLine: 1, replacement: 'import os', why: '' }] }), run: runFor(ctx.db), workflowId }), /outside this stage's code/);
  await assert.rejects(steer.previewSteer({ db: ctx.db, view, intent: 'x', io, request: reply({ summary: 's', edits: [{ file: 'agent/tools.py', startLine: 1, endLine: 4, replacement: 'x', why: '' }] }), run: runFor(ctx.db), workflowId }), /outside this stage's code \(lines 1-4\)/);
  await assert.rejects(steer.previewSteer({ db: ctx.db, view, intent: 'x', io, request: reply({ summary: 's', edits: [good.edits[0], { ...good.edits[0], startLine: 9 }] }), run: runFor(ctx.db), workflowId }), /overlapping/);
  // A failed write restores the files already written.
  failWrite = 'agent/tools.py';
  const original = new Map(files);
  await assert.rejects(steer.applyAtomic(preview, io), /Every file is as it was/);
  assert.deepEqual(files, original);
  failWrite = undefined;
  const applied = await steer.applyAtomic(preview, io);
  assert.match(files.get('agent/actor.py'), /return result or call_tool/); assert.match(files.get('agent/tools.py'), /"ok": True/);
  await assert.rejects(steer.applyAtomic(preview, io), /changed since the preview/);
  assert.deepEqual(await steer.undoAtomic(applied, io), ['agent/actor.py', 'agent/tools.py']);
  assert.deepEqual(files, original);
  // Undo refuses once a file was edited after the apply.
  const again = await steer.applyAtomic(preview, io);
  files.set('agent/tools.py', files.get('agent/tools.py') + '\n# edited');
  await assert.rejects(steer.undoAtomic(again, io), /edited after the change/);
  assert.match(files.get('agent/actor.py'), /return result or call_tool/, 'a refused undo changes nothing');
});

test('the stage screen script parses', () => {
  const html = require('../src/views/stages').stagesHTML();
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function(script));
});

test('without cached pseudocode a refresh compares the function at the base commit with the current one', { skip }, async () => {
  const ctx = await setup();
  ctx.explanations = {};
  const model = fakeModel(prompt => /Code behind one stage changed/.test(prompt) ? { name: 'Evaluate result', gist: 'g', input: 'a', output: 'b', steps: [{ file: 'agent/evaluator.py', symbol: 'grade' }], behaviorChanged: true, summary: 'Evaluate now scores zero when there are no results.' } : STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  ctx.graph.files['agent/evaluator.py'].hash = 'edited';
  stages.fileChanged(ctx.db, 'agent/evaluator.py', 'edited');
  await stages.refreshStale({ ...ctx, workflowId, request: model.request, run: runFor(ctx.db),
    readExcerpt: async () => '9: def grade(results):\n10:     if not results: return 0.0', readBefore: async (file, symbol) => symbol === 'grade' ? '9: def grade(results):\n10:     return len(results)' : undefined });
  const prompt = model.calls.at(-1).prompt;
  assert.match(prompt, /"before":"SOURCE EXCERPT:\\n9: def grade\(results\):\\n10:     return len\(results\)"/);
  assert.match(prompt, /if not results: return 0\.0/);
  assert.match(prompt, /"before":"\(not recorded\)"/, 'a step without any baseline says so');
  const [change] = ctx.db.changes(workflowId);
  assert.ok(change.detail.steps.every(step => step.before === '' && step.after === ''), 'source is never stored in the change log');
});

test('system discovery: each workflow folder gets candidates without AI, and the AI may only pick among them', async () => {
  const fs = require('node:fs');
  const system = require('../src/stages/system');
  const root = path.join(__dirname, 'fixtures', 'multi-repo');
  const graph = await project.scanFolder(root, undefined, new project.Indexer());
  assert.deepEqual(system.areasOf(graph).map(area => area.folder), ['agents/email', 'agents/sales', 'server', 'shared']);
  const texts = new Map(system.readFiles(graph).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const found = system.candidates(graph, texts);
  const best = folder => found.find(item => item.folder === folder);
  assert.equal(best('agents/email').symbol, 'triage_loop'); assert.equal(best('agents/sales').symbol, 'score_leads'); assert.equal(best('server').symbol, 'main');
  const id = (file, symbol) => found.find(item => item.file === file && item.symbol === symbol).id;
  const parsed = system.parseSystem(JSON.stringify({ summary: 'S', parts: [
    { name: 'Email helper', summary: 'Answers email.', entry: id('agents/email/run.py', 'triage_loop') },
    { name: 'Invented', summary: 'x', entry: 'c999' },
    { name: 'Twice', summary: 'x', entry: id('agents/email/run.py', 'triage_loop') },
    { name: 'Web server', summary: 'Serves.', entry: id('server/app.py', 'main') }],
    links: [{ from: 'Web server', to: 'Email helper', label: 'starts' }, { from: 'Web server', to: 'Nobody', label: 'x' }] }), found);
  assert.deepEqual(parsed.parts.map(part => part.name), ['Email helper', 'Web server'], 'made-up or repeated entry points are dropped');
  assert.deepEqual(parsed.links, [{ from: 'web-server', to: 'email-helper', label: 'starts' }]);
  const prompt = system.systemPrompt({ graph, notes: { files: {} }, found });
  assert.doesNotMatch(prompt, /def triage_loop/, 'no source code is sent, only names and notes');
});

test('a Python package that lives elsewhere in a monorepo (src layout) resolves, but an ambiguous name does not', () => {
  const files = ['packages/contracts/src/mla_contracts/__init__.py', 'packages/contracts/src/mla_contracts/pitch.py', 'orchestrator/src/cli.py', 'a/util/__init__.py', 'b/util/__init__.py'];
  const ctx = project.resolutionContext(files);
  assert.deepEqual(project.resolveImport('orchestrator/src/cli.py', { kind: 'module', spec: 'mla_contracts.pitch', names: ['parse_pitch'] }, ctx), ['packages/contracts/src/mla_contracts/pitch.py']);
  assert.deepEqual(project.resolveImport('orchestrator/src/cli.py', { kind: 'module', spec: 'mla_contracts', names: ['pitch'] }, ctx), ['packages/contracts/src/mla_contracts/__init__.py', 'packages/contracts/src/mla_contracts/pitch.py']);
  assert.deepEqual(project.resolveImport('orchestrator/src/cli.py', { kind: 'module', spec: 'util', names: [] }, ctx), [], 'two packages named util: no guess');
});
