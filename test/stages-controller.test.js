'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const project = require('../src/project/graph');
const { available, closeStageDb, dbPath } = require('../src/stages/db');
const { createStages } = require('../src/stages/controller');
const { timing } = require('../src/stages/scheduler');
const generate = require('../src/stages/generate');

const skip = !available() && 'node:sqlite is not available in this runtime';
const FIXTURE = path.join(__dirname, 'fixtures', 'agent-repo');

function fakeApi(answers = {}) {
  const posted = [], settings = {};
  const api = {
    ViewColumn: { Active: -1, One: 1, Beside: -2 },
    ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ update: async (key, value) => { settings[key] = value; } }) },
    env: { openExternal: async uri => { posted.push({ external: String(uri) }); return true; } },
    Uri: { parse: text => text, file: file => ({ fsPath: file }) },
    window: {
      showQuickPick: async items => answers.quickPick ? answers.quickPick(await items) : (await items)[0],
      showInformationMessage: async () => answers.info ?? 'Generate',
      showWarningMessage: async () => answers.warning,
      showInputBox: async () => answers.input,
      activeTextEditor: undefined
    }
  };
  const host = { postMessage: message => { posted.push(message); return Promise.resolve(true); } };
  return { api, posted, host, settings };
}

async function setup(answers, { obsidianConfig = '/nonexistent/obsidian.json' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-stages-'));
  fs.cpSync(FIXTURE, root, { recursive: true });
  const graph = await project.scanFolder(root, undefined, new project.Indexer());
  const notes = { files: Object.fromEntries(Object.entries(graph.files).map(([rel, file]) => [rel, { hash: file.hash, purpose: 'Purpose of ' + rel, role: 'core', terms: [] }])) };
  const entry = { root: { fsPath: root, toString: () => 'file://' + root }, graph, notes, explanations: {} };
  const calls = [];
  const map = {
    entryFor: async () => entry, entryForFile: async () => entry,
    relative: (_entry, uri) => path.relative(root, uri.fsPath).split(path.sep).join('/'),
    ensureGraph: async value => value, writeNotes: async () => {},
    rescanFiles: async (value, files) => { value.graph = await project.includeSourceFiles(root, value.graph, files, new project.Indexer()); return value; },
    readSource: async (_entry, rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    reveal: async () => {}, openFlow: async () => {}, gitHead: async () => 'abc123', showStages: async () => {},
    fileUri: (_entry, rel) => ({ scheme: 'file', fsPath: path.join(root, ...rel.split('/')) }),
    isDirty: () => false, openProposed: async () => {},
    writeSource: async (_entry, rel, text) => fs.writeFileSync(path.join(root, rel), text),
    connection: async tier => ({ provider: 'claude', model: tier === 'main' ? 'main-model' : 'cheap-model' }),
    requestStructured: async ({ prompt }) => {
      calls.push(prompt);
      if (/steer writer/.test(prompt)) return { raw: JSON.stringify({ summary: 'Act retries a failed step once.', edits: [{ file: 'agent/actor.py', startLine: 9, endLine: 9, replacement: '    return call_tool("search", step) or call_tool("search", step)', why: 'Retry once.' }] }), usage: { input: 3000, output: 200 }, actualModel: 'main-model' };
      const refresh = /Code behind one stage changed/.test(prompt);
      const value = refresh
        ? { name: 'Act', gist: 'Run steps.', input: 'steps', output: 'results', steps: [{ file: 'agent/actor.py', symbol: 'act' }, { file: 'agent/actor.py', symbol: 'run_step' }], behaviorChanged: true, summary: 'Act now runs every step twice.' }
        : { stages: [
          { id: 'plan', name: 'Plan', gist: 'g', input: 'goal', output: 'steps', steps: [{ file: 'agent/planner.py', symbol: 'plan' }] },
          { id: 'act', name: 'Act', gist: 'g', input: 'steps', output: 'results', steps: [{ file: 'agent/actor.py', symbol: 'act' }, { file: 'agent/actor.py', symbol: 'run_step' }] },
          { id: 'evaluate', name: 'Evaluate', gist: 'g', input: 'results', output: 'verdict', steps: [{ file: 'agent/evaluator.py', symbol: 'evaluate' }] }] };
      return { raw: JSON.stringify(value), usage: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0 }, actualModel: refresh ? 'cheap-model' : 'cheap-model' };
    }
  };
  const { api, posted, host, settings } = fakeApi(answers);
  const values = new Map(), context = { globalState: { get: key => values.get(key), update: async (key, value) => values.set(key, value) } };
  const screen = createStages({ api, context, map, setting: (name, fallback) => settings[name] ?? fallback, gitOperationInProgress: async () => false, obsidianConfig });
  screen.attach(entry, host);
  const send = message => screen.message(entry, message);
  const last = () => posted.filter(message => message.type === 'stages').at(-1).state;
  return { root, entry, screen, posted, send, last, settings, calls, cleanup() { screen.dispose(); closeStageDb(dbPath(root)); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('from an entry point to a stage graph, then a save updates only the affected stage once', { skip }, async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 10, idle: 30 });
  const ctx = await setup({ quickPick: items => items.find(item => item.symbol === 'run_agent') || { label: 'run_agent', file: 'main.py', symbol: 'run_agent' } });
  try {
    await ctx.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    assert.equal(ctx.calls.length, 1);
    assert.ok(fs.existsSync(path.join(ctx.root, '.yamori', 'yamori.db')));
    assert.match(fs.readFileSync(path.join(ctx.root, '.yamori', '.gitignore'), 'utf8'), /yamori\.db/);
    let state = ctx.screen.state(ctx.screen.projectFor(ctx.entry));
    assert.deepEqual(state.workflow.stages.map(stage => stage.name), ['Plan', 'Act', 'Evaluate']);
    assert.equal(state.activity.total.calls, 1);
    // Without a vault, notes go to .yamori/notes/.
    assert.ok(fs.existsSync(path.join(ctx.root, '.yamori', 'notes', 'Stages', 'run-agent', 'Act.md')));
    // Opening a card is a read: no model call. The note box writes the free section.
    await ctx.send({ type: 'openStage', id: 'act' });
    await ctx.send({ type: 'addNote', stage: 'act', text: 'Tools must be idempotent.' });
    state = ctx.last();
    assert.equal(state.card.id, 'act'); assert.equal(state.card.steps[0].symbol, 'act');
    assert.match(state.card.notes, /You: Tools must be idempotent\./);
    assert.equal(ctx.calls.length, 1);
    // An edit to the actor: one call for the Act stage only.
    fs.appendFileSync(path.join(ctx.root, 'agent', 'actor.py'), '\n\ndef retry(step):\n    return run_step(step)\n');
    await ctx.screen.saved({ scheme: 'file', fsPath: path.join(ctx.root, 'agent', 'actor.py') });
    await new Promise(resolve => setTimeout(resolve, 60));
    await ctx.screen.projectFor(ctx.entry).scheduler.running;
    assert.equal(ctx.calls.length, 2);
    state = ctx.screen.state(ctx.screen.projectFor(ctx.entry));
    const act = state.workflow.stages.find(stage => stage.id === 'act');
    assert.equal(act.stale, false); assert.equal(act.plus, 1);
    assert.equal(state.workflow.pending, 1);
    // Saving an untracked file never wakes the scheduler.
    fs.writeFileSync(path.join(ctx.root, 'notes.txt'), 'x');
    await ctx.screen.saved({ scheme: 'file', fsPath: path.join(ctx.root, 'notes.txt') });
    assert.deepEqual(ctx.screen.projectFor(ctx.entry).scheduler.pending, []);
    // Running "from entry" again with nothing changed: zero calls.
    await ctx.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    assert.equal(ctx.calls.length, 2);
  } finally { Object.assign(timing, saved); ctx.cleanup(); }
});

test('rename from the card pins the stage', { skip }, async () => {
  const ctx = await setup({ input: 'Use tools' });
  try {
    await ctx.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    await ctx.send({ type: 'rename', stage: 'act' });
    const db = ctx.screen.dbFor(ctx.screen.projectFor(ctx.entry));
    const act = db.stage('run-agent', 'act');
    assert.equal(act.name, 'Use tools'); assert.ok(act.pinned);
    assert.equal(generate.workflowView(db, ctx.entry.graph, 'run-agent').stages[1].pinned, true);
  } finally { ctx.cleanup(); }
});

test('steer from the card: preview, apply to disk, review the result, then undo', { skip }, async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 10, idle: 30 });
  const ctx = await setup({});
  try {
    await ctx.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    const send = ctx.send;
    await send({ type: 'openStage', id: 'act' });
    await send({ type: 'steerPreview', stage: 'act', intent: 'retry failed steps' });
    let state = ctx.last();
    assert.equal(state.steer.phase, 'preview'); assert.equal(state.steer.files[0].file, 'agent/actor.py');
    assert.ok(state.steer.files[0].hunks.some(line => line.kind === 'add' && /or call_tool/.test(line.text)));
    const call = state.activity.calls.find(row => row.trigger === 'stages.steer');
    assert.equal(call.model, 'main-model', 'steer uses the main model');
    const file = path.join(ctx.root, 'agent', 'actor.py'), original = fs.readFileSync(file, 'utf8');
    await send({ type: 'steerApply' });
    assert.match(fs.readFileSync(file, 'utf8'), /or call_tool/);
    await new Promise(resolve => setTimeout(resolve, 60)); await ctx.screen.projectFor(ctx.entry).scheduler.running;
    state = ctx.screen.state(ctx.screen.projectFor(ctx.entry));
    assert.equal(state.queue.length, 1, 'the applied change enters review'); assert.equal(state.queue[0].stage_id, 'act');
    await send({ type: 'openStage', id: 'act' });
    await send({ type: 'steerUndo' });
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.equal(ctx.last().steer.phase, 'undone');
    // Leaving the intent for an agent writes a note and calls no model.
    const before = ctx.calls.length;
    await send({ type: 'steerIntent', stage: 'act', intent: 'Prefer cached tool results.' });
    assert.equal(ctx.calls.length, before);
    assert.match(ctx.last().card.notes, /Intent for the next run: Prefer cached tool results\./);
  } finally { Object.assign(timing, saved); ctx.cleanup(); }
});

test('the Stages tab finds the main workflow by itself, and the command maps it with one confirmation', { skip }, async () => {
  const ctx = await setup({ info: 'Generate' });
  try {
    const item = ctx.screen.projectFor(ctx.entry);
    ctx.screen.state(item);
    while (item.suggesting) await new Promise(resolve => setTimeout(resolve, 5));
    const [first] = ctx.screen.state(item).suggestions;
    assert.equal(first.symbol, 'run_agent'); assert.equal(first.file, 'main.py');
    assert.ok(first.tokens > 0); assert.equal(first.missingNotes, 0); assert.equal(first.mapped, false);
    assert.equal(ctx.calls.length, 0, 'finding the entry point calls no AI');
    await ctx.screen.fromEntry(ctx.entry);
    assert.equal(ctx.calls.length, 1);
    const state = ctx.screen.state(item);
    assert.equal(state.workflow.entry_symbol, 'run_agent'); assert.equal(state.suggestions[0].mapped, true);
  } finally { ctx.cleanup(); }
});

test('Obsidian: a project inside a vault uses it with no setup; otherwise one click moves the notes into the vault you use', { skip }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-obsidian-'));
  fs.mkdirSync(path.join(vault, '.obsidian'));
  const config = path.join(vault, 'obsidian.json');
  fs.writeFileSync(config, JSON.stringify({ vaults: { a: { path: path.join(vault, 'gone'), ts: 9 }, b: { path: vault, ts: 5, open: true } } }));
  const ctx = await setup({}, { obsidianConfig: config });
  try {
    await ctx.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    await ctx.send({ type: 'openStage', id: 'act' });
    await ctx.send({ type: 'addNote', stage: 'act', text: 'Keep tools idempotent.' });
    let state = ctx.last();
    assert.equal(state.vault.obsidian, false);
    assert.deepEqual(state.vault.offer, { name: path.basename(vault), path: vault });
    await ctx.send({ type: 'useVault' });
    assert.equal(ctx.settings['obsidian.vaultPath'], vault);
    const moved = path.join(vault, 'Yamori', path.basename(ctx.root), 'Stages', 'run-agent', 'Act.md');
    assert.match(fs.readFileSync(moved, 'utf8'), /Keep tools idempotent\./);
    assert.equal(fs.existsSync(path.join(ctx.root, '.yamori', 'notes')), false);
    state = ctx.last();
    assert.equal(state.vault.obsidian, true); assert.equal(state.vault.offer, undefined);
    assert.match(state.card.notes, /Keep tools idempotent/);
    await ctx.send({ type: 'openNote', stage: 'act' });
    assert.match(ctx.posted.find(message => message.external).external, /^obsidian:\/\/open\?path=/);
  } finally { ctx.cleanup(); fs.rmSync(vault, { recursive: true, force: true }); }
  // A project that already lives in a vault needs nothing.
  const inside = await setup({});
  try {
    fs.mkdirSync(path.join(inside.root, '.obsidian'));
    await inside.send({ type: 'map', file: 'main.py', symbol: 'run_agent' });
    await inside.send({ type: 'openStage', id: 'plan' });
    assert.equal(inside.last().vault.obsidian, true);
    assert.ok(fs.existsSync(path.join(inside.root, 'Yamori', path.basename(inside.root), 'Stages', 'run-agent', 'Plan.md')));
  } finally { inside.cleanup(); }
});
