'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const project = require('../src/project/graph');
const { available, closeStageDb, dbPath } = require('../src/stages/db');
const { createStages } = require('../src/stages/controller');
const { timing } = require('../src/stages/scheduler');

const skip = !available() && 'node:sqlite is not available in this runtime';
const FIXTURE = path.join(__dirname, 'fixtures', 'multi-repo');

// A stand-in AI that answers each Yamori prompt the way a model would.
function fakeModel() {
  const calls = [];
  const candidate = (prompt, file, fn) => new RegExp('"id":"(c\\d+)","file":"' + file.replace(/\//g, '\\/') + '","function":"' + fn + '"').exec(prompt)?.[1];
  const answer = prompt => {
    if (/system mapper/.test(prompt)) return { summary: 'Two AI helpers answer email and score leads; a web server starts them.', parts: [
      { name: 'Web server', summary: 'Starts the helpers when a request comes in.', entry: candidate(prompt, 'server/app.py', 'main') },
      { name: 'Email helper', summary: 'Reads unread email and answers it.', entry: candidate(prompt, 'agents/email/run.py', 'triage_loop') },
      { name: 'Lead scoring', summary: 'Scores sales leads and saves the scores.', entry: candidate(prompt, 'agents/sales/pipeline.py', 'score_leads') }],
      links: [{ from: 'Web server', to: 'Email helper', label: 'starts' }, { from: 'Web server', to: 'Lead scoring', label: 'starts' }] };
    if (/Code behind one stage changed/.test(prompt)) return { name: 'Answer', gist: 'Writes and sends replies, twice if needed.', input: 'unread email', output: 'sent replies', steps: [{ file: 'agents/email/run.py', symbol: 'triage_loop', what: 'Answers each unread email' }], behaviorChanged: true, summary: 'Replies are now sent twice when the first try fails.' };
    if (/Yamori's router/.test(prompt)) return { targets: ['email-helper/answer'], explanation: 'Retrying belongs where replies are sent, in the Email helper.' };
    if (/steer writer/.test(prompt)) return { summary: 'Replies are retried once.', edits: [{ file: 'agents/email/inbox.py', startLine: 6, endLine: 6, replacement: '    print(message, answer) or print(message, answer)', why: 'Retry once.' }] };
    if (/stage mapper/.test(prompt)) {
      const entry = /WORKFLOW ENTRY: (\{.*\})/.exec(prompt)[1];
      if (/email/.test(entry)) return { stages: [
        { id: 'read', name: 'Read inbox', gist: 'Gets unread email.', input: 'mailbox', output: 'unread email', steps: [{ file: 'agents/email/inbox.py', symbol: 'fetch_unread', what: 'Gets the unread email' }] },
        { id: 'answer', name: 'Answer', gist: 'Writes and sends replies.', input: 'unread email', output: 'sent replies', steps: [{ file: 'agents/email/run.py', symbol: 'triage_loop', what: 'Answers each unread email' }, { file: 'agents/email/inbox.py', symbol: 'reply', what: 'Sends the reply' }] },
        { id: 'write', name: 'Write text', gist: 'Asks AI for the words.', input: 'prompt', output: 'text', steps: [{ file: 'shared/llm.py', symbol: 'complete', what: 'Asks the AI to write' }] }] };
      if (/sales/.test(entry)) return { stages: [
        { id: 'load', name: 'Load leads', gist: 'Reads leads.', input: 'CRM', output: 'leads', steps: [{ file: 'agents/sales/crm.py', symbol: 'load_leads', what: 'Reads the leads' }] },
        { id: 'score', name: 'Score', gist: 'Scores each lead.', input: 'leads', output: 'scores', steps: [{ file: 'agents/sales/pipeline.py', symbol: 'score_leads', what: 'Scores each lead' }] },
        { id: 'save', name: 'Save scores', gist: 'Stores scores.', input: 'scores', output: 'saved', steps: [{ file: 'agents/sales/crm.py', symbol: 'save_score', what: 'Saves a score' }] }] };
      return { stages: [
        { id: 'receive', name: 'Receive request', gist: 'Takes a web request.', input: 'request', output: 'path', steps: [{ file: 'server/app.py', symbol: 'main', what: 'Starts the server' }] },
        { id: 'route', name: 'Pick helper', gist: 'Starts the right helper.', input: 'path', output: 'helper run', steps: [{ file: 'server/app.py', symbol: 'handle_request', what: 'Picks the helper for the path' }] },
        { id: 'respond', name: 'Respond', gist: 'Returns the result.', input: 'helper run', output: 'response', steps: [{ file: 'agents/email/run.py', symbol: 'triage_loop', what: 'Runs the email helper' }] }] };
    }
    throw new Error('Unexpected prompt: ' + prompt.slice(0, 80));
  };
  const requestStructured = async ({ prompt }) => { calls.push(prompt); return { raw: JSON.stringify(answer(prompt)), usage: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0 }, actualModel: /steer writer/.test(prompt) ? 'main-model' : 'cheap-model' }; };
  return { calls, requestStructured };
}

async function setup({ obsidianConfig = '/nonexistent/obsidian.json', answers = {}, root: existing } = {}) {
  const root = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-system-'));
  if (!existing) fs.cpSync(FIXTURE, root, { recursive: true });
  const graph = await project.scanFolder(root, undefined, new project.Indexer());
  const notes = { files: Object.fromEntries(Object.entries(graph.files).map(([rel, file]) => [rel, { hash: file.hash, purpose: 'Purpose of ' + rel, role: 'core', terms: [] }])) };
  const entry = { root: { fsPath: root, toString: () => 'file://' + root }, graph, notes, explanations: {} };
  const model = fakeModel(), posted = [], settings = {};
  const map = {
    entryFor: async () => entry, entryForFile: async () => entry, rootFor: () => root,
    relative: (_entry, uri) => path.relative(root, uri.fsPath).split(path.sep).join('/'),
    ensureGraph: async value => value,
    rescanFiles: async (value, files) => { value.graph = await project.includeSourceFiles(root, value.graph, files, new project.Indexer()); return value; },
    readSource: async (_entry, rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    reveal: async () => {}, openFlow: async () => {}, gitHead: async () => 'abc123', showStages: async () => {},
    fileUri: (_entry, rel) => ({ scheme: 'file', fsPath: path.join(root, ...rel.split('/')) }),
    isDirty: () => false, openProposed: async () => {},
    writeSource: async (_entry, rel, text) => fs.writeFileSync(path.join(root, rel), text),
    connection: async tier => ({ provider: 'claude', model: tier === 'main' ? 'main-model' : 'cheap-model' }),
    requestStructured: model.requestStructured
  };
  const api = {
    ViewColumn: { Beside: -2 }, ConfigurationTarget: { Global: 1 },
    workspace: { getConfiguration: () => ({ update: async (key, value) => { settings[key] = value; } }), openTextDocument: async uri => uri },
    env: { openExternal: async uri => { posted.push({ external: String(uri) }); return true; } },
    Uri: { parse: text => text, file: file => ({ fsPath: file }) },
    window: { showQuickPick: async items => (await items)[0], showInformationMessage: async () => answers.info, showWarningMessage: async () => answers.warning, showInputBox: async () => answers.input, showTextDocument: async () => {} }
  };
  const values = new Map(), context = { globalState: { get: key => values.get(key), update: async (key, value) => values.set(key, value) } };
  const screen = createStages({ api, context, map, setting: (name, fallback) => settings[name] ?? fallback, gitOperationInProgress: async () => false, obsidianConfig });
  const host = { postMessage: message => { posted.push(message); return Promise.resolve(true); } };
  screen.attach(entry, host);
  const send = message => screen.message(entry, message);
  const last = () => posted.filter(message => message.type === 'stages').at(-1).state;
  const item = screen.projectFor(entry);
  const settle = async () => { while (item.estimating) await new Promise(resolve => setTimeout(resolve, 5)); };
  return { root, entry, screen, posted, send, last, settle, settings, item, calls: model.calls, close() { screen.dispose(); closeStageDb(dbPath(root)); }, cleanup() { this.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('one click maps the whole system: every part, its steps in plain words, and how the parts connect', { skip }, async () => {
  const ctx = await setup();
  try {
    ctx.screen.state(ctx.item); await ctx.settle();
    const before = ctx.screen.state(ctx.item);
    assert.equal(before.system, undefined);
    assert.ok(before.estimate.tokens > 0); assert.equal(before.estimate.calls, 5, 'one call for the parts, one per folder that may hold a part');
    assert.equal(ctx.calls.length, 0, 'the estimate needs no AI');
    assert.equal(fs.existsSync(path.join(ctx.root, '.yamori', 'notes')), false, 'nothing is written before mapping');
    await ctx.send({ type: 'buildSystem' });
    assert.equal(ctx.calls.length, 4, 'one system call and one call per part');
    const state = ctx.last();
    assert.deepEqual(state.system.parts.map(part => part.name), ['Web server', 'Email helper', 'Lead scoring']);
    assert.match(state.system.summary, /web server starts them/);
    const email = state.system.parts.find(part => part.name === 'Email helper');
    assert.deepEqual(email.stages.map(stage => stage.name), ['Read inbox', 'Answer', 'Write text']);
    assert.deepEqual(email.usedBy, [{ from: 'web-server', label: 'starts' }]);
    assert.deepEqual(email.entry, { file: 'agents/email/run.py', symbol: 'triage_loop' });
    // A step in plain words; code only on request.
    await ctx.send({ type: 'openStage', part: 'email-helper', id: 'answer' });
    const card = ctx.last().card;
    assert.deepEqual(card.steps.map(step => step.what), ['Answers each unread email', 'Sends the reply']);
    assert.equal(ctx.calls.length, 4, 'opening a step calls no AI');
    // Readable notes: a system note, a note per part, a note per step.
    const notes = path.join(ctx.root, '.yamori', 'notes');
    const systemNote = fs.readFileSync(path.join(notes, 'System.md'), 'utf8');
    assert.match(systemNote, /# How .* works/); assert.match(systemNote, /\[\[Web server\/Web server\|Web server\]\] starts \[\[Email helper\/Email helper\|Email helper\]\]/);
    const stepNote = fs.readFileSync(path.join(notes, 'Email helper', 'Answer.md'), 'utf8');
    assert.match(stepNote, /Step 2 of 3 in \[\[Email helper\/Email helper\|Email helper\]\]/);
    assert.match(stepNote, /\*\*How:\*\*\n1\. Answers each unread email\n2\. Sends the reply/);
    assert.match(stepNote, /> \[!note\]- Where this is in the code/);
    // Mapping again with the same files: no AI.
    await ctx.send({ type: 'buildSystem' });
    assert.equal(ctx.calls.length, 4);
  } finally { ctx.cleanup(); }
});

test('a save updates only the parts it touches, and the review lists changes across parts', { skip }, async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 10, idle: 30 });
  const ctx = await setup();
  try {
    await ctx.send({ type: 'buildSystem' });
    fs.appendFileSync(path.join(ctx.root, 'agents', 'email', 'run.py'), '\n\ndef retry(message):\n    return triage_loop()\n');
    await ctx.screen.saved({ scheme: 'file', fsPath: path.join(ctx.root, 'agents', 'email', 'run.py') });
    await new Promise(resolve => setTimeout(resolve, 60)); await ctx.item.scheduler.running;
    const refreshes = ctx.calls.filter(prompt => /Code behind one stage changed/.test(prompt));
    assert.equal(refreshes.length, 2, 'the email step and the server step that runs it, nothing else');
    const state = ctx.screen.state(ctx.item);
    assert.deepEqual([...new Set(state.queue.map(change => change.part_name))].sort(), ['Email helper', 'Web server']);
    assert.equal(state.system.parts.find(part => part.name === 'Lead scoring').pending, 0);
    await ctx.send({ type: 'decide', id: state.queue[0].id, status: 'approved', why: 'Mail servers drop replies.' });
    const log = fs.readdirSync(path.join(ctx.root, '.yamori', 'notes', 'Changes'));
    assert.match(fs.readFileSync(path.join(ctx.root, '.yamori', 'notes', 'Changes', log[0]), 'utf8'), /Replies are now sent twice when the first try fails\. \*\*Approved\.\*\*\n {2}- Why: Mail servers drop replies\./);
  } finally { Object.assign(timing, saved); ctx.cleanup(); }
});

test('steering from the top: find where a request goes, preview it, apply, undo, or give it to the agent', { skip }, async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 10, idle: 30 });
  const ctx = await setup();
  try {
    await ctx.send({ type: 'buildSystem' });
    await ctx.send({ type: 'addSystemNote', text: 'Never send the same email twice to a customer.' });
    await ctx.send({ type: 'route', intent: 'retry failed replies' });
    let state = ctx.last();
    assert.deepEqual(state.route.targets.map(target => target.partName + ' › ' + target.stageName), ['Email helper › Answer']);
    assert.match(state.route.explanation, /Email helper/);
    assert.match(ctx.calls.at(-1), /Never send the same email twice/, 'system notes reach the router');
    await ctx.send({ type: 'steerPreview', intent: 'retry failed replies', targets: [{ part: 'email-helper', stage: 'answer' }] });
    state = ctx.last();
    assert.equal(state.steer.phase, 'preview'); assert.equal(state.steer.files[0].file, 'agents/email/inbox.py');
    assert.match(ctx.calls.at(-1), /Never send the same email twice/, 'system notes are constraints on the change');
    const file = path.join(ctx.root, 'agents', 'email', 'inbox.py'), original = fs.readFileSync(file, 'utf8');
    await ctx.send({ type: 'steerApply' });
    assert.match(fs.readFileSync(file, 'utf8'), /or print/);
    await new Promise(resolve => setTimeout(resolve, 60)); await ctx.item.scheduler.running;
    await ctx.send({ type: 'steerUndo' });
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    const count = ctx.calls.length;
    await ctx.send({ type: 'handToAgent', intent: 'log every failed reply', targets: [{ part: 'email-helper', stage: 'answer' }] });
    assert.equal(ctx.calls.length, count, 'handing over calls no AI');
    await ctx.send({ type: 'openStage', part: 'email-helper', id: 'answer' });
    assert.match(ctx.last().card.notes, /You: To do: log every failed reply/);
  } finally { Object.assign(timing, saved); ctx.cleanup(); }
});

test('Obsidian connects by itself, and notes written before move into the vault', { skip }, async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-obsidian-'));
  fs.mkdirSync(path.join(vault, '.obsidian'));
  const config = path.join(vault, 'obsidian.json');
  fs.writeFileSync(config, JSON.stringify({ vaults: { gone: { path: path.join(vault, 'gone'), ts: 9 }, mine: { path: vault, ts: 5, open: true } } }));
  // Without Obsidian, notes start in the project.
  const first = await setup({ obsidianConfig: path.join(vault, 'missing.json') });
  await first.send({ type: 'buildSystem' });
  await first.send({ type: 'addNote', part: 'email-helper', stage: 'answer', text: 'Keep replies short.' });
  assert.equal(first.last().vault.obsidian, false);
  assert.ok(fs.existsSync(path.join(first.root, '.yamori', 'notes', 'Email helper', 'Answer.md')));
  first.close();
  // Once Obsidian has a vault open: no click, the notes move there.
  const again = await setup({ obsidianConfig: config, root: first.root });
  try {
    const state = again.screen.state(again.item);
    assert.equal(state.vault.obsidian, true); assert.match(state.vault.where, new RegExp(path.basename(vault) + ' › Yamori › '));
    const moved = path.join(vault, 'Yamori', path.basename(again.root), 'Email helper', 'Answer.md');
    assert.match(fs.readFileSync(moved, 'utf8'), /Keep replies short\./);
    assert.equal(fs.existsSync(path.join(again.root, '.yamori', 'notes')), false);
    await again.send({ type: 'openNote', part: 'email-helper', stage: 'answer' });
    assert.match(again.posted.find(message => message.external).external, /^obsidian:\/\/open\?path=/);
  } finally { again.cleanup(); fs.rmSync(vault, { recursive: true, force: true }); }
});

test('renaming a step keeps the name through a new map', { skip }, async () => {
  const ctx = await setup({ answers: { input: 'Reply' } });
  try {
    await ctx.send({ type: 'buildSystem' });
    await ctx.send({ type: 'rename', part: 'email-helper', stage: 'answer' });
    await ctx.send({ type: 'buildSystem', force: true });
    const email = ctx.last().system.parts.find(part => part.id === 'email-helper');
    assert.deepEqual(email.stages.map(stage => stage.name), ['Read inbox', 'Reply', 'Write text']);
    assert.ok(email.stages[1].pinned);
  } finally { ctx.cleanup(); }
});

test('the map shows shared code, a part opens to its files and how they use each other, and a file shows where it is used', { skip }, async () => {
  const ctx = await setup();
  try {
    await ctx.send({ type: 'buildSystem' });
    let state = ctx.last();
    assert.deepEqual(state.system.shared.map(box => [box.folder, box.usedBy.sort()]), [['shared', ['email-helper', 'lead-scoring', 'web-server']]]);
    await ctx.send({ type: 'openPart', id: 'email-helper' });
    state = ctx.last();
    const files = state.partDetail.files.map(file => file.file).sort();
    assert.deepEqual(files, ['agents/email/inbox.py', 'agents/email/run.py', 'shared/llm.py']);
    assert.ok(state.partDetail.files.find(file => file.file === 'agents/email/run.py').entry);
    assert.deepEqual(state.partDetail.files.find(file => file.file === 'agents/email/inbox.py').steps.sort(), ['answer', 'read']);
    assert.ok(state.partDetail.edges.some(edge => edge.from === 'agents/email/run.py' && edge.to === 'agents/email/inbox.py' && edge.names.includes('fetch_unread')));
    await ctx.send({ type: 'openFile', file: 'agents/email/inbox.py' });
    state = ctx.last();
    assert.deepEqual(state.file.where.map(entry => entry.partName + ' › ' + entry.stageName).sort(), ['Email helper › Answer', 'Email helper › Read inbox']);
    assert.ok(state.file.usedBy.some(entry => entry.file === 'agents/email/run.py'));
    assert.match(state.file.purpose, /Purpose of agents\/email\/inbox\.py/);
    await ctx.send({ type: 'openShared', id: 'code:shared' });
    state = ctx.last();
    assert.deepEqual(state.shared.fileList.map(file => file.file), ['shared/llm.py']);
    assert.equal(state.part, undefined, 'opening shared code closes the part');
    assert.equal(ctx.calls.length, 4, 'browsing the map calls no AI');
  } finally { ctx.cleanup(); }
});

test('changes start from any box: a part narrows the search, a file goes straight to a preview, and every request is noted by itself', { skip }, async () => {
  const saved = { ...timing };
  Object.assign(timing, { delay: 10, idle: 30 });
  const ctx = await setup();
  try {
    await ctx.send({ type: 'buildSystem' });
    await ctx.send({ type: 'route', intent: 'retry failed replies', scope: { part: 'email-helper' } });
    const routing = ctx.calls.at(-1);
    assert.match(routing, /email-helper\/answer/); assert.doesNotMatch(routing, /lead-scoring\//, 'only the selected part is searched');
    await ctx.send({ type: 'steerPreview', intent: 'retry failed replies', targets: [{ file: 'agents/email/inbox.py' }] });
    assert.match(ctx.calls.at(-1), /SOURCE "agents\/email\/inbox\.py"/, 'a file target sends that file\'s functions');
    assert.equal(ctx.last().steer.phase, 'preview');
    await ctx.send({ type: 'steerApply' });
    await new Promise(resolve => setTimeout(resolve, 60)); await ctx.item.scheduler.running;
    const notes = path.join(ctx.root, '.yamori', 'notes');
    const log = fs.readFileSync(path.join(notes, 'Changes', fs.readdirSync(path.join(notes, 'Changes'))[0]), 'utf8');
    assert.match(log, /You asked: “retry failed replies” in agents\/email\/inbox\.py\. \*\*Applied\.\*\*\n {2}- Files: agents\/email\/inbox\.py/);
    await ctx.send({ type: 'handToAgent', intent: 'log every failed reply', targets: [{ part: 'email-helper' }] });
    const step = fs.readFileSync(path.join(notes, 'Email helper', 'Answer.md'), 'utf8');
    assert.match(step, /## History\n\n- .*You asked: “log every failed reply” \(given to your agent\)/);
    assert.match(fs.readFileSync(path.join(notes, 'System.md'), 'utf8'), /## Lately\n\n- .*You asked: “log every failed reply” \(given to your agent\)/);
    assert.match(fs.readFileSync(path.join(notes, 'System.md'), 'utf8'), /```mermaid\nflowchart LR\n/);
    assert.ok(fs.existsSync(path.join(notes, 'Code', 'agents', 'email', 'inbox.py.md')));
  } finally { Object.assign(timing, saved); ctx.cleanup(); }
});

test('a file shows its cached pseudocode, Update always says what it did, and notes can be updated on demand', { skip }, async () => {
  const ctx = await setup();
  try {
    await ctx.send({ type: 'buildSystem' });
    const hash = ctx.entry.graph.files['agents/email/inbox.py'].hash;
    ctx.entry.explanations['agents/email/inbox.py'] = { logic: { hash, title: 'Inbox', summary: 'Reads and answers mail.', sections: [{ title: 'Get unread mail', startLine: 1, endLine: 2, pseudocode: 'Return the unread messages' }, { title: 'Send a reply', startLine: 5, endLine: 6, pseudocode: 'Print the message and its answer' }] } };
    await ctx.send({ type: 'openPart', id: 'email-helper' });
    await ctx.send({ type: 'openFile', file: 'agents/email/inbox.py' });
    const pseudo = ctx.last().file.pseudocode;
    assert.equal(pseudo.current, true); assert.equal(pseudo.summary, 'Reads and answers mail.');
    assert.deepEqual(pseudo.sections.map(section => [section.title, section.startLine]), [['Get unread mail', 1], ['Send a reply', 5]]);
    const calls = ctx.calls.length;
    await ctx.send({ type: 'refresh' });
    assert.match(ctx.last().notice, /Everything is up to date: no code changed since the last update\. Notes updated \(\d+ notes\)\./);
    await ctx.send({ type: 'syncNotes' });
    const state = ctx.last();
    assert.match(state.notice, /^Notes updated: \d+ notes in .*\.yamori\/notes\.$/);
    assert.ok(state.vault.lastSync.notes > 5); assert.equal(state.vault.lastSync.error, '');
    assert.equal(ctx.calls.length, calls, 'neither calls AI');
  } finally { ctx.cleanup(); }
});
