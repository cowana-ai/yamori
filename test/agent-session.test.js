'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const vm = require('node:vm');
const project = require('../src/project/graph');
const { createServer } = require('../src/project/mcp');

const FIXTURE = path.join(__dirname, 'fixtures', 'multi-repo');
const text = reply => reply.content[0].text.replace(/^Untrusted[^\n]*\n/, '');

async function standing() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-session-')), root = path.join(temp, 'repo'), cache = path.join(temp, 'cache');
  fs.cpSync(FIXTURE, root, { recursive: true }); fs.mkdirSync(path.join(root, '.git'));
  const server = createServer({ root, cache });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } });
  await server.call('list_files', {});
  const located = await project.locateProject(root, cache);
  return { temp, root, cache, server, store: located.dir, cleanup: () => fs.rmSync(temp, { recursive: true, force: true }) };
}

test('the terminal agent reads what the founder is looking at, saves plans onto the canvas, and shows things in Yamori', async () => {
  const ctx = await standing();
  try {
    const names = (await ctx.server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(tool => tool.name);
    for (const name of ['get_view', 'save_plan', 'show_in_yamori']) assert.ok(names.includes(name), name);
    assert.equal(JSON.parse(text(await ctx.server.call('get_view', {}))).known, false);
    fs.writeFileSync(path.join(ctx.store, 'view.json'), JSON.stringify({ at: new Date().toISOString(), tab: 'System', editor: { file: 'agents/email/run.py', line: 7, selected: 'answer = complete(...)' }, system: { part: 'Email helper', step: 'Answer' } }));
    const view = JSON.parse(text(await ctx.server.call('get_view', {})));
    assert.equal(view.editor.file, 'agents/email/run.py'); assert.equal(view.system.step, 'Answer'); assert.ok(view.secondsAgo <= 5);
    // A plan lands on the canvas, the old one goes to history.
    const saved = await ctx.server.call('save_plan', { goal: 'Retry failed replies', summary: 'Send again when sending fails.', steps: [{ file: 'agents/email/inbox.py', startLine: 5, endLine: 6, title: 'Retry the send', change: 'Try sending twice.', why: 'Mail servers drop replies.' }] });
    assert.match(text(saved), /Saved a plan with 1 step/);
    const plans = JSON.parse(fs.readFileSync(path.join(ctx.store, 'plan.json'), 'utf8'));
    assert.equal(plans.current.goal, 'Retry failed replies'); assert.deepEqual(plans.current.steps.map(step => [step.file, step.startLine, step.endLine, step.title]), [['agents/email/inbox.py', 5, 6, 'Retry the send']]);
    assert.ok(plans.conversation, 'the panel reloads plans that carry a conversation'); assert.equal(plans.conversation.mode, 'plan');
    await ctx.server.call('save_plan', { goal: 'Second plan', steps: [{ file: 'server/app.py', title: 'Route', change: 'Add a route.' }] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.store, 'plan.json'), 'utf8')).history.at(-1).goal, 'Retry failed replies');
    const bad = await ctx.server.call('save_plan', { goal: 'x', steps: [{ file: 'nowhere.py', title: 'x', change: 'x' }] });
    assert.ok(bad.isError); assert.match(bad.content[0].text, /unknown file nowhere\.py/);
    // Showing something in Yamori is a request the extension picks up.
    assert.match(text(await ctx.server.call('show_in_yamori', { tab: 'system', part: 'Email helper', step: 'Answer' })), /Shown in Yamori: Email helper › Answer/);
    const show = JSON.parse(fs.readFileSync(path.join(ctx.store, 'show.json'), 'utf8'));
    assert.deepEqual([show.tab, show.part, show.step], ['system', 'Email helper', 'Answer']); assert.ok(show.token);
    assert.ok((await ctx.server.call('show_in_yamori', { tab: 'read', file: '../secret.py' })).isError);
  } finally { ctx.cleanup(); }
});

test('one persistent agent session per project: started once with Yamori\'s tools and rules, reused, and resumed after a restart', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yamori-home-')), storage = path.join(home, 'storage');
  const created = [], sent = [];
  const api = {
    workspace: { isTrusted: true, getConfiguration: () => ({ get: (_, fallback) => fallback }) },
    window: { terminals: [], createTerminal(options) { const terminal = { name: options.name, options, show() {}, sendText: (value, enter) => sent.push([value, enter]) }; created.push(terminal); api.window.terminals.push(terminal); return terminal; } }
  };
  const stub = { exports: {} };
  const srcRequire = id => require(id.startsWith('.') ? path.join(__dirname, '..', 'src', id) : id);
  const fakeOs = { ...os, homedir: () => home };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? api : id === 'node:os' ? fakeOs : srcRequire(id), Buffer, AbortController, setTimeout, clearTimeout, process, __dirname: path.join(__dirname, '..', 'src'), console, URL, URLSearchParams });
  const values = new Map([['provider', 'claude']]), context = { globalStorageUri: { fsPath: storage }, extensionUri: { fsPath: path.join(__dirname, '..') }, globalState: { get: (key, fallback) => values.has(key) ? values.get(key) : fallback, update: async (key, value) => values.set(key, value) } };
  try {
    const sessions = stub.exports.createAgentSessions(context, api, { find: async () => '/usr/local/bin/claude' });
    const entry = { root: { fsPath: path.join(home, 'shop'), toString: () => 'file://' + path.join(home, 'shop') } };
    // Started by itself with the panel: in the background, not shown.
    let shown = 0; const createTerminal = api.window.createTerminal; api.window.createTerminal = options => { const terminal = createTerminal(options); terminal.show = () => { shown++; }; return terminal; };
    await sessions.ensure(entry); await sessions.ensure(entry);
    assert.equal(created.length, 1, 'started once'); assert.equal(shown, 0, 'not shown, no focus taken');
    await sessions.open(entry);
    assert.equal(shown, 1, 'Chat shows the same session'); assert.equal(created.length, 1); assert.equal(created[0].name, 'Yamori chat · shop'); assert.equal(created[0].options.cwd, path.join(home, 'shop'));
    const args = created[0].options.shellArgs.join(' ');
    assert.match(args, /--session-id [0-9a-f-]{36}/); assert.match(args, /--append-system-prompt .*call the yamori get_view tool first/s); assert.match(args, /--mcp-config \{"mcpServers":\{"yamori":/);
    assert.ok(sessions.alive(entry));
    await sessions.open(entry, { prefill: 'About Email helper › Answer: ' });
    assert.equal(created.length, 1, 'the open session is reused');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(sent, [['About Email helper › Answer: ', false]], 'the prefill waits on the prompt, not sent');
    // After a restart the same conversation resumes once it has a transcript.
    const id = values.get('agentSession:file://' + path.join(home, 'shop'));
    fs.mkdirSync(path.join(home, '.claude', 'projects', 'x'), { recursive: true }); fs.writeFileSync(path.join(home, '.claude', 'projects', 'x', id + '.jsonl'), '{}');
    created[0].exitStatus = { code: 0 };
    const again = stub.exports.createAgentSessions(context, api, { find: async () => '/usr/local/bin/claude' });
    await again.open(entry);
    assert.equal(created.length, 2); assert.match(created[1].options.shellArgs.join(' '), new RegExp('--resume ' + id));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
