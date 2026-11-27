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

test('sub-steps come from the call tree: what a step calls is nested under it, plumbing is skipped, nothing is listed twice', () => {
  const node = (symbol, calls = [], lines = 10, file = 'a.py') => ({ id: file + '#' + symbol + ':1', file, symbol, kind: 'function', line: 1, end: 1 + lines, calls: calls.map(name => 'a.py#' + name + ':1') });
  const tree = { nodes: [
    node('propose', ['rank', 'log_event', 'save']), node('rank', ['ask_judge', 'Score']), node('ask_judge', ['build_request']), node('build_request', ['deep_helper']), node('deep_helper'),
    node('log_event'), node('save'), { ...node('Score'), kind: 'class' } ] };
  const list = [{ id: 'plan', steps: [{ file: 'a.py', symbol: 'propose' }] }, { id: 'store', steps: [{ file: 'a.py', symbol: 'save' }] }];
  stages.addSubSteps(list, tree);
  assert.deepEqual(list[0].steps.map(step => [step.symbol, step.depth, step.parent || null]), [['propose', 0, null], ['rank', 1, 'a.py#propose'], ['ask_judge', 2, 'a.py#rank']],
    'rank and its judge sit under propose; logging, a data class, the step another stage owns, and anything deeper than two levels stay out');
  assert.deepEqual(list[1].steps.map(step => step.symbol), ['save']);
  assert.deepEqual(stages.typedDetails(['plain text', { kind: 'decides', text: 'Eligible only if demand >= 0.5' }, { kind: 'weird', text: 'x' }]), [{ kind: 'other', text: 'plain text' }, { kind: 'decides', text: 'Eligible only if demand >= 0.5' }, { kind: 'other', text: 'x' }]);
});

test('thin wrappers give way to the function that does the work, keeping their name as a note', () => {
  const node = (symbol, calls = [], lines = 10, file = 'a.py') => ({ id: file + '#' + symbol + ':1', file, symbol, kind: 'function', line: 1, end: 1 + lines, calls: calls.map(name => 'a.py#' + name + ':1') });
  const tree = { nodes: [node('init_month', ['update_thread_id', 'init_month_tool'], 12), node('update_thread_id'), node('init_month_tool', ['build_month_brief', 'load_all_series'], 30), node('build_month_brief'), node('load_all_series'),
    node('register', ['a_tool', 'b_tool'], 8), node('a_tool'), node('b_tool')] };
  const list = [{ id: 'start', steps: [{ file: 'a.py', symbol: 'init_month' }, { file: 'a.py', symbol: 'register' }] }];
  stages.unwrap(list, tree);
  assert.deepEqual(list[0].steps.map(step => [step.symbol, step.via || null]), [['init_month_tool', 'init_month'], ['register', null]],
    'the tool wrapper (plumbing aside, one real call) becomes its tool function; a function that calls two is kept');
});

test('the budget counts cache reads at a tenth, so cached prompts do not use up the day', () => {
  const { StageDb } = require('../src/stages/db');
  const db = new StageDb(':memory:');
  db.logCall({ trigger: 't', input: 1000, cached: 9000, output: 500 });
  assert.doesNotThrow(() => createRun(db, { budget: { perRun: 0, perDay: 3000 } }).check(500), '1000 + 500 + 900 = 2400 spent; 500 more fits in 3000');
  assert.throws(() => createRun(db, { budget: { perRun: 0, perDay: 3000 } }).check(700), /daily budget \(2,400 of 3,000 used\)/);
});

test('the How it works search is loose: word endings, one typo, same-meaning verbs; steps with the most words come first', () => {
  const { stepSearch } = require('../src/views/stages');
  const { queryWords, find, matches } = stepSearch();
  const steps = [
    { name: 'init', text: 'Sets up the research folder for a chosen month.' },
    { name: '_eligible_angles', text: 'Picks up to three distinct angles per topic.' },
    { name: 'rank_monthly_angles', text: 'Scores each angle and selects a winner.' },
    { name: 'save_audit', text: 'Saves the audit record.' }
  ];
  const names = query => find(steps, queryWords(query), step => step.name + ' ' + step.text).map(step => step.name);
  // Both words (picks ~ selection), exact ones first; "chosen" alone is only half.
  assert.deepEqual(names('angle selection'), ['rank_monthly_angles', '_eligible_angles']);
  assert.deepEqual(names('angel'), ['_eligible_angles', 'rank_monthly_angles'], 'one typo is fine');
  assert.deepEqual(names('saving'), ['save_audit']);
  assert.deepEqual(names('eligible'), ['_eligible_angles'], 'function names count');
  assert.deepEqual(names('database migration'), []);
  assert.equal(matches('Picks', queryWords('selection')), true);
  assert.equal(matches('folder', queryWords('selection')), false);
});

test('a script that works outside functions gets steps: top-level sections named by their comments, run in order', () => {
  const { scriptBlocks } = require('../src/project/graph');
  const { callTree } = require('../src/stages/callgraph');
  const { readJson, planSchema } = require('../src/stages/generate');
  const text = ['"""', 'Prepare the data.', '"""', 'import os', 'size = 10', '', '# download the text', 'data = open("in.txt").read()', 'print(len(data))', '',
    '# ----------', 'def encode(s):', '    return [ord(c) for c in s]', '', '# split and encode both halves', 'train = encode(data[:size])', 'val = encode(data[size:])', 'print(train, val)', '',
    '# save the files', 'open("train.bin", "w").write(str(train))', 'open("val.bin", "w").write(str(val))', 'print("saved")'].join('\n');
  const defs = [{ name: 'size', kind: 'constant', line: 5, start: 5, end: 5 }, { name: 'encode', kind: 'function', line: 12, start: 12, end: 13 }];
  const blocks = scriptBlocks(defs, text);
  // The docstring and imports are not steps; a top-level assignment is code, not a break.
  assert.deepEqual(blocks.map(block => [block.name, block.start, block.end]), [['download the text', 8, 9], ['split and encode both halves', 16, 18], ['save the files', 21, 23]]);
  assert.deepEqual(scriptBlocks([], 'import os\nx = 1\n'), [], 'a tiny module has no blocks');
  // Started from its first block, the tree runs every block and reaches the function they call.
  const graph = { files: { 'prep.py': { defs, blocks } }, edges: [] };
  const tree = callTree(graph, new Map([['prep.py', text]]), ['prep.py'], 'prep.py', 'download the text');
  assert.deepEqual(tree.nodes.map(node => node.symbol), ['download the text', 'split and encode both halves', 'save the files', 'encode']);
  // A small part may have fewer stages; replies with text around the JSON still parse.
  assert.equal(planSchema(1).properties.stages.minItems, 1);
  assert.equal(planSchema(40).properties.stages.minItems, 3);
  assert.deepEqual(readJson('Here it is:\n```json\n{"stages": []}\n```\nDone.'), { stages: [] });
  assert.deepEqual(readJson('Sure. {"a": 1} hope that helps'), { a: 1 });
  assert.equal(readJson('I cannot do that.'), undefined);
});

test('steps know whether they are a class, a method of which class, a function or a script section', () => {
  const { stepShape } = require('../src/stages/system');
  const graph = { files: { 'model.py': { defs: [
    { name: 'LayerNorm', kind: 'class', line: 1, start: 1, end: 8 }, { name: 'forward', kind: 'function', line: 5, start: 5, end: 8 },
    { name: 'Block', kind: 'class', line: 10, start: 10, end: 20 }, { name: 'forward', kind: 'function', line: 15, start: 15, end: 20 },
    { name: 'train', kind: 'function', line: 22, start: 22, end: 30 }, { name: 'SIZE', kind: 'constant', line: 31, start: 31, end: 31 }],
    blocks: [{ name: 'training loop', kind: 'block', line: 40, start: 40, end: 60 }] } } };
  const shape = (symbol, line) => stepShape(graph, { file: 'model.py', symbol, line_start: line });
  assert.deepEqual(shape('LayerNorm', 1), { kind: 'class', line_start: 1 });
  // Two classes have a forward: the line the step was mapped at picks the right one.
  assert.deepEqual(shape('forward', 15), { kind: 'method', owner: 'Block', line_start: 15 });
  assert.deepEqual(shape('forward', 5), { kind: 'method', owner: 'LayerNorm', line_start: 5 });
  assert.deepEqual(shape('train', 22), { kind: 'function', line_start: 22 });
  assert.deepEqual(shape('training loop', 40), { kind: 'section', line_start: 40 });
});

// What a class is made of, from its code: any model style or plain class, no AI.
test('a class shows what it is made of: parts in the order they run, repeats, shortcuts, plain words', () => {
  const { partLayers } = require('../src/stages/layers');
  const read = (file, text) => {
    const lines = text.split('\n'), found = [];
    lines.forEach((line, i) => { const m = /^(?:export\s+)?class (\w+)/.exec(line); if (m) found.push({ file, def: { name: m[1], start: i + 1 } }); });
    found.forEach((item, i) => { item.def.end = i + 1 < found.length ? found[i + 1].def.start - 1 : lines.length; });
    return found;
  };
  const conv = [
    'class Unit(nn.Module):',
    '    """Two convolutions with a skip connection."""',
    '    def __init__(self, c):',
    '        super().__init__()',
    '        self.first = nn.Conv2d(c, c, 3)',
    '        self.norm = nn.BatchNorm2d(c)',
    '        self.second = nn.Conv2d(c, c, 3)',
    '    def forward(self, x):',
    '        saved = x',
    '        out = self.norm(self.first(x))',
    '        out = self.second(out)',
    '        out += saved',
    '        return out',
    'class Net(nn.Module):',
    '    def __init__(self, depth, classes):',
    '        super().__init__()',
    '        self.stem = nn.Sequential(OrderedDict([("conv", nn.Conv2d(3, 8, 7)), ("act", nn.ReLU())]))',
    '        self.units = nn.ModuleList([Unit(8) for _ in range(depth)])',
    '        self.head = nn.Linear(8, classes)  # the classifier',
    '        self.spare = nn.Dropout(0.1)',
    '    def forward(self, x, y=None):',
    '        x = self.stem(x)',
    '        for unit in self.units:',
    '            x = unit(x)',
    '        logits = self.head(x)',
    '        loss = F.cross_entropy(logits, y)',
    '        return logits, loss',
  ].join('\n');
  const keras = [
    'class Tagger(keras.Model):',
    '    def __init__(self):',
    '        super().__init__()',
    '        self.embed = layers.Embedding(100, 16)',
    '        self.mix = layers.Dense(16)',
    '    def call(self, inputs):',
    '        h = self.embed(inputs)',
    '        h = h + self.mix(h)',
    '        return h',
  ].join('\n');
  const plain = [
    'class Orders:',
    '    def __init__(self, cfg):',
    '        self.db = Database(cfg.url)',
    '        self.mail = Mailer(cfg.smtp)',
    '        self.count = 0',
    '    def place(self, order):',
    '        self.db.save(order)',
    '        self.mail.send(order)',
    '        return order',
  ].join('\n');
  const ts = [
    '/** Keeps the cart in sync. */',
    'export class Cart {',
    '  constructor(base: string) {',
    '    this.events = new Emitter();',
    '    this.api = new Api(base);',
    '  }',
    '  async sync(cart: Items) {',
    '    const fresh = await this.api.put(cart);',
    '    this.events.emit(fresh);',
    '    return fresh;',
    '  }',
    '}',
  ].join('\n');
  const texts = new Map([['net.py', conv], ['tagger.py', keras], ['orders.py', plain], ['cart.ts', ts]]);
  const out = partLayers([...texts].flatMap(([file, text]) => read(file, text)), texts);
  const names = key => out[key].layers.map(layer => layer.name);

  // In the order forward runs them (inner calls first), with the skip added back after the last.
  assert.deepEqual(names('net.py#Unit'), ['first', 'norm', 'second']);
  assert.equal(out['net.py#Unit'].doc, 'Two convolutions with a skip connection.');
  // The skip connection is where two paths join: what came in, and what second gave.
  const joins = item => item.flow.nodes.filter(node => node.kind === 'merge').map(node => item.flow.edges.filter(([, to]) => to === node.id).map(([from]) => item.flow.nodes.find(other => other.id === from)).map(other => other.kind === 'in' ? 'in:' + other.name : other.name).sort());
  assert.deepEqual(joins(out['net.py#Unit']), [['in:x', 'second']]);
  assert.match(out['net.py#Unit'].layers[0].plain, /pattern/);
  // Named pieces of a container run with it; a repeated project block points at its own class; math between parts shows.
  assert.deepEqual(names('net.py#Net'), ['stem.conv', 'stem.act', 'units', 'head', 'cross_entropy', 'spare']);
  const units = out['net.py#Net'].layers.find(layer => layer.name === 'units');
  assert.equal(units.repeat, 'depth');
  assert.equal(units.own, 'net.py#Unit');
  assert.equal(units.doc, 'Two convolutions with a skip connection.');
  assert.ok(out['net.py#Net'].layers.find(layer => layer.name === 'cross_entropy').op);
  assert.ok(out['net.py#Net'].layers.find(layer => layer.name === 'spare').unused);
  assert.deepEqual([out['net.py#Net'].inputs, out['net.py#Net'].outputs], [['x', 'y'], ['logits', 'loss']]);
  // Keras: call() runs it; h = h + part(h) is a shortcut.
  assert.equal(out['tagger.py#Tagger'].runs, 'call');
  assert.deepEqual(names('tagger.py#Tagger'), ['embed', 'mix']);
  assert.deepEqual(joins(out['tagger.py#Tagger']), [['embed', 'mix']]);
  // Not a model: the method that uses the most parts sets the order; plain values are not parts.
  assert.equal(out['orders.py#Orders'].runs, 'place');
  assert.deepEqual(names('orders.py#Orders'), ['db', 'mail']);
  assert.equal(out['orders.py#Orders'].layers[0].plain, undefined);
  // TypeScript: this.x = new X() in the constructor.
  assert.deepEqual(names('cart.ts#Cart'), ['api', 'events']);
  assert.equal(out['cart.ts#Cart'].doc, 'Keeps the cart in sync.');
  assert.deepEqual(out['cart.ts#Cart'].inputs, ['cart']);
});

// How data moves through a class's main method, read from the code: what feeds
// each part, where values are combined, which calls run only under a condition.
test('a class shows how data flows through it: splits, merges, conditions, loops and worked-out sizes', () => {
  const { partLayers } = require('../src/stages/layers');
  const text = [
    'WIDTH = 64',
    '@dataclass',
    'class Settings:',
    '    """What the model is built with."""',
    '    width: int = WIDTH',
    '    depth: int = 3',
    '    vocab: int = 1000',
    'class Model(nn.Module):',
    '    def __init__(self, settings, heads=4):',
    '        super().__init__()',
    '        self.words = Embed(settings.vocab, settings.width)',
    '        self.places = Embed(512, settings.width)',
    '        self.blocks = ModuleList([Unit(settings.width * heads) for _ in range(settings.depth)])',
    '        self.out = Project(settings.width, settings.vocab, bias=False)',
    '        self.scale = Weights(settings.width)',
    '    def forward(self, ids, answers=None):',
    '        n, t = ids.size()',
    '        where = torch.arange(0, t)',
    '        x = self.words(ids) + self.places(where)',
    '        for unit in self.blocks:',
    '            x = x + unit(x)',
    '        x = x * self.scale',
    '        if answers is not None:',
    '            guesses = self.out(x)',
    '            miss = F.cross_entropy(guesses, answers)',
    '        else:',
    '            guesses = self.out(x[:, -1])',
    '            miss = None',
    '        return guesses, miss',
    'class Unit(nn.Module):',
    '    def __init__(self, width):',
    '        super().__init__()',
    '        self.mix = Project(width, width)',
    '    def forward(self, x):',
    '        return self.mix(x)',
  ].join('\n');
  const lines = text.split('\n'), classes = [];
  lines.forEach((line, i) => { const m = /^class (\w+)/.exec(line); if (m) classes.push({ file: 'model.py', def: { name: m[1], start: i + 1 - (lines[i - 1]?.startsWith('@') ? 1 : 0) } }); });
  classes.forEach((item, i) => { item.def.end = i + 1 < classes.length ? classes[i + 1].def.start - 1 : lines.length; });
  const model = partLayers(classes, new Map([['model.py', text]]))['model.py#Model'];
  const label = node => node.kind === 'in' ? 'in:' + node.name : node.kind === 'out' ? 'out' : node.kind === 'merge' ? node.name : node.name;
  const byId = new Map(model.flow.nodes.map(node => [node.id, node]));
  const feeds = name => model.flow.nodes.filter(node => label(node) === name).map(node => model.flow.edges.filter(([, to]) => to === node.id).map(([from]) => label(byId.get(from))).sort());

  // words reads the input; places reads only positions made from the input's length (not its data), so nothing feeds it.
  assert.deepEqual(feeds('words'), [['in:ids']]);
  assert.deepEqual(feeds('places'), [[]]);
  // Two values added make a node of their own; so does the shortcut inside the loop and the scaling by a part read as a value.
  assert.deepEqual(feeds('+'), [['places', 'words'], ['+', 'blocks']]);
  assert.deepEqual(feeds('*'), [['+', 'scale']]);
  assert.ok(model.flow.nodes.find(node => node.name === 'scale').value);
  // The loop over a list of parts is that part; each branch of an if carries its condition.
  assert.deepEqual(feeds('blocks'), [['+']]);
  const outs = model.flow.nodes.filter(node => node.name === 'out');
  assert.deepEqual(outs.map(node => node.when), [['when answers is not None'], ['when answers is None']]);
  assert.deepEqual(feeds('cross_entropy'), [['in:answers', 'out']]);
  assert.deepEqual(model.flow.nodes.find(node => node.kind === 'out').names, ['guesses', 'miss']);
  assert.ok(model.flow.nodes.every(node => node.kind === 'in' || node.kind === 'out' || node.line > 0));

  // Sizes from defaults: another class's fields (a module constant behind one), the constructor's own defaults.
  const part = name => model.layers.find(layer => layer.name === name);
  assert.deepEqual(part('words').args.map(arg => arg.value), ['1000', '64']);
  assert.deepEqual(part('out').args.map(arg => [arg.name, arg.value ?? arg.code]), [[undefined, '64'], [undefined, '1000'], ['bias', 'False']]);
  assert.equal(part('blocks').args[0].value, '256');
  assert.equal(part('blocks').times, 3);
  assert.deepEqual(model.defaults.sort(), ['Settings', 'default arguments']);
  assert.equal(part('words').line, 11);
});

test('vault: an Inside note per class, with its flow as a diagram, step by step, its parts and links both ways', { skip }, async () => {
  const fs = require('node:fs'), os = require('node:os');
  const { Vault } = require('../src/stages/vault');
  const { partLayers } = require('../src/stages/layers');
  const ctx = await setup(), model = fakeModel(() => STAGES);
  const { workflowId } = await stages.generateWorkflow({ ...ctx, entryFile: 'main.py', entrySymbol: 'run_agent', request: model.request, run: runFor(ctx.db) });
  ctx.db.setPart(workflowId, { name: 'Agent loop', summary: 's', folder: '(root)', position: 0 });
  const code = [
    'class Runner:',
    '    """Runs a plan, one tool at a time."""',
    '    def __init__(self, cfg):',
    '        self.tools = Toolbox(cfg.tools)',
    '        self.log = Journal("runs")',
    '    def run(self, plan, dry=False):',
    '        result = self.tools.call(plan)',
    '        if not dry:',
    '            self.log.write(result + plan)',
    '        return result',
    'class Toolbox:',
    '    def __init__(self, names):',
    '        self.http = Client()',
    '        self.cache = Store(64)',
    '    def call(self, plan):',
    '        hit = self.cache.get(plan)',
    '        return self.http.post(hit)',
  ].join('\n');
  const anatomy = partLayers([{ file: 'agent/actor.py', def: { name: 'Runner', start: 1, end: 10 } }, { file: 'agent/actor.py', def: { name: 'Toolbox', start: 11, end: 17 } }], new Map([['agent/actor.py', code]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-inside-'));
  try {
    const vault = new Vault({ root, vaultPath: path.join(root, 'vault') });
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes, anatomy });
    const note = fs.readFileSync(path.join(vault.dir, 'Inside', 'Runner.md'), 'utf8');
    assert.match(note, /^---\ntype: inside\nclass: "agent\/actor\.py#Runner"\nname: Runner/);
    assert.match(note, /# Inside Runner\n\n`agent\/actor\.py` · \[\[Code\/agent\/actor\.py\|actor\.py\]\]/);
    assert.match(note, /Runs a plan, one tool at a time\./);
    // The diagram: inputs as pills, parts as boxes with their arguments, the condition on the arrow into the part it guards.
    assert.match(note, /```mermaid\nflowchart TD\n {2}f0\(\["in: plan"\]\)\n/);
    assert.match(note, /\["Toolbox · tools\.call\(\)<br\/>\(cfg\.tools\)"\]/);
    assert.match(note, /\["Journal · log\.write\(\)<br\/>\(#quot;runs#quot;\)"\]/);
    assert.match(note, / -- "when not dry" --> /);
    assert.match(note, /\(\("\+ add"\)\)/);
    // Step by step, with lines; parts link to the class notes they are; the class it is part of links back.
    assert.match(note, /## Step by step\n\n1\. Runner is given plan\. Next: tools\.call\(\) and the add result\./);
    assert.match(note, /4\. log \(Journal\) takes the add result\. This only happens when not dry\. · \[actor\.py:9\]\(vscode:/);
    assert.match(note, /- \*\*tools\*\* · \[\[Inside\/Toolbox\|Toolbox\]\] \(cfg\.tools\): Made of Store, Client\. · \[actor\.py:4\]/);
    assert.match(fs.readFileSync(path.join(vault.dir, 'Inside', 'Toolbox.md'), 'utf8'), /## Part of\n\n- \[\[Inside\/Runner\|Runner\]\] \(as `tools`\)/);
    // The code note and the part note list the classes.
    assert.match(fs.readFileSync(path.join(vault.dir, 'Code', 'agent', 'actor.py.md'), 'utf8'), /## Classes\n\n- \[\[Inside\/Runner\|Runner\]\]\n- \[\[Inside\/Toolbox\|Toolbox\]\]/);
    assert.match(fs.readFileSync(path.join(vault.dir, 'Agent loop', 'Agent loop.md'), 'utf8'), /## What its classes are made of\n\n- \[\[Inside\/Runner\|Runner\]\]: Runs a plan, one tool at a time\./);
    // Without the class any more, its note moves to the archive like other generated notes.
    vault.syncSystem(ctx.db, ctx.graph, { notes: ctx.notes, anatomy: { 'agent/actor.py#Runner': anatomy['agent/actor.py#Runner'] } });
    assert.ok(!fs.existsSync(path.join(vault.dir, 'Inside', 'Toolbox.md')));
    assert.ok(fs.existsSync(path.join(vault.dir, '_archive', 'Inside', 'Toolbox.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); ctx.db.close?.(); }
});
