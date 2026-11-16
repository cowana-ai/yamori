'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { LEVELS, SCHEMA, cacheKey, promptFor, parseResult, generate, runProcess, schemaFor, lowerView, partialView, streamCodex, editPrompt, revisionPrompt, listModels, listEfforts, findCLI, cliLaunch } = require('./engine');
const { cleanEmphasis, panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts } = require('./panel');
// Tests never start a real CLI: choosing the quick-job model is stubbed for the
// extension; the real chooser is tested against a fixture Codex below.
const realFastModel = require('./engine').fastModel;
// Tests never ask the real CLIs whether they are signed in; a test can set
// testStatus[provider] to simulate a missing or signed-out AI.
const realProviderStatus = require('./engine').providerStatus, testStatus = {};
require('./engine').providerStatus = async provider => testStatus[provider] || { provider, installed: true, signedIn: true, ready: true, source: 'Command line', account: 'reader@example.com · pro plan', path: '/usr/local/bin/' + provider };
require('./engine').fastModel = async provider => provider === 'claude' ? { model: 'haiku', effort: 'low' } : { model: 'fast-test', effort: 'low' };
const source = { uri: 'file:///example.py', name: 'example.py', language: 'python', startLine: 10, text: 'x = 1\nprint(x)' };
const valid = { title: 'Print a number', summary: 'Sets and prints a number.', sections: [{ title: 'Print', startLine: 10, endLine: 11, pseudocode: 'Set x to 1\nPrint x' }] };
const statusItem = () => ({ show() { this.visible = true; }, hide() { this.visible = false; }, dispose() { this.disposed = true; } });

test('real CodeMirror transactions keep ordinary edits free of orphan formatting markers', () => {
  const fs = require('node:fs'), path = require('node:path');
  const sandbox = { document: { documentElement: { style: {} } }, window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'editor.min.js'), 'utf8'), sandbox);
  const { EditorState } = sandbox.YamoriCodeMirror;
  const edit = (doc, changes) => EditorState.create({ doc, extensions: [EditorState.transactionFilter.of(cleanEmphasis)] }).update({ changes }).state.doc.toString();
  assert.equal(edit('**pool**.', { from: 5, to: 6 }), '**poo**.', 'deleting a letter preserves emphasis');
  assert.equal(edit('**pool**.', { from: 6, to: 7 }), 'pool.', 'a selection crossing one marker removes its matching formatting');
  assert.equal(edit('**pool**.', { from: 6, to: 8 }), 'pool.');
  assert.equal(edit('**pool**.', { from: 4, insert: '\n' }), 'po\nol.', 'splitting a phrase creates clean normal lines');
  assert.equal(edit('**pool**.', { from: 0, to: 9, insert: 'A new idea.' }), 'A new idea.', 'replacing the whole block does not delete new text');
  assert.equal(edit('**pool**.', { from: 2, to: 6 }), '****.', 'empty paired formatting can remain invisible and editable');
});

test('all levels use original selection line numbers and distinct instructions', () => {
  for (const level of Object.keys(LEVELS)) {
    const prompt = promptFor(source, level);
    assert.match(prompt, /10: x = 1\n11: print\(x\)/);
    assert.ok(prompt.includes(LEVELS[level].instruction));
    assert.match(prompt, /untrusted data/);
  }
  assert.throws(() => promptFor(source, 'bogus'));
});
test('cache invalidates for source, location, level, provider and model changes', () => {
  const key = cacheKey(source, 'logic', 'codex');
  for (const changed of [{ ...source, text: 'x = 2' }, { ...source, startLine: 20 }, { ...source, uri: 'file:///other.py' }]) assert.notEqual(cacheKey(changed, 'logic', 'codex'), key);
  assert.notEqual(cacheKey(source, 'overview', 'codex'), key);
  assert.notEqual(cacheKey(source, 'logic', 'claude'), key);
  assert.notEqual(cacheKey(source, 'logic', 'claude', 'a'), cacheKey(source, 'logic', 'claude', 'b'));
  assert.equal(cacheKey({ ...source }, 'logic', 'codex'), key);
});
test('accepts structured output and fenced JSON', () => {
  assert.deepEqual(parseResult(JSON.stringify(valid), source), valid);
  assert.deepEqual(parseResult('```json\n' + JSON.stringify(valid) + '\n```', source), valid);
});
test('rejects truncated JSON, empty output and invented source ranges', () => {
  for (const raw of ['{', '{}', '{"sections":[]}']) assert.throws(() => parseResult(raw, source));
  for (const section of [{ startLine: 1 }, { endLine: 500 }, { startLine: 11, endLine: 10 }, { pseudocode: '' }, { endLine: 10.5 }]) {
    assert.throws(() => parseResult(JSON.stringify({ ...valid, sections: [{ ...valid.sections[0], ...section }] }), source));
  }
});
test('process input travels over stdin without shell interpretation', async () => {
  const input = '$(touch /tmp/should-not-exist); `echo unsafe`';
  const output = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], input);
  assert.equal(output, input);
});

function windowsFixture(files = {}) {
  const paths = require('node:path').win32, entries = new Map(Object.entries(files).map(([key, value]) => [paths.normalize(key).toLowerCase(), value]));
  const get = key => { const value = entries.get(paths.normalize(key).toLowerCase()); if (value === undefined) throw new Error('ENOENT'); return value; };
  return { platform: 'win32', home: 'C:\\Users\\A Person', env: { Path: '"C:\\Tool Folder";C:\\Other', APPDATA: 'C:\\Users\\A Person\\AppData\\Roaming' }, fs: {
    stat: async key => ({ isFile: () => get(key) !== 'directory' }), access: async key => { get(key); }, readFile: async key => get(key)
  } };
}
test('Windows discovery handles native installs, quoted PATH folders and configured executables', async () => {
  const native = 'C:\\Users\\A Person\\.local\\bin\\claude.exe';
  assert.equal(await findCLI('claude', '', windowsFixture({ [native]: '' })), native);
  assert.equal(await findCLI('claude', '', windowsFixture({ 'C:\\Tool Folder\\claude.exe': '' })), 'C:\\Tool Folder\\claude.exe');
  assert.equal(await findCLI('claude', '"D:\\Custom Folder\\claude.exe"', windowsFixture({ 'D:\\Custom Folder\\claude.exe': '' })), 'D:\\Custom Folder\\claude.exe');
  await assert.rejects(findCLI('claude', '', windowsFixture({ [native]: 'directory' })), /Use Set up AI to install it/);
});
test('Windows npm launchers resolve only expected package entry points without a shell', async () => {
  const root = 'C:\\Users\\A Person\\AppData\\Roaming\\npm';
  for (const provider of ['claude', 'codex']) {
    const pkg = provider === 'claude' ? '@anthropic-ai\\claude-code' : '@openai\\codex';
    const packageName = pkg.replace('\\', '/'), entry = root + '\\node_modules\\' + pkg + '\\cli.js';
    for (const ext of ['cmd', 'ps1', 'bat']) {
      const files = { [root + '\\' + provider + '.' + ext]: '', [root + '\\node_modules\\' + pkg + '\\package.json']: JSON.stringify({ name: packageName, bin: { [provider]: 'cli.js' } }), [entry]: '' };
      assert.equal(await findCLI(provider, '', windowsFixture(files)), entry);
      files[root + '\\node_modules\\' + pkg + '\\package.json'] = JSON.stringify({ name: packageName, bin: '../../outside.js' });
      await assert.rejects(findCLI(provider, '', windowsFixture(files)), /could not resolve/);
      files[root + '\\node_modules\\' + pkg + '\\package.json'] = JSON.stringify({ name: 'foreign-package', bin: 'cli.js' });
      await assert.rejects(findCLI(provider, '', windowsFixture(files)), /could not resolve/);
    }
  }
});
test('npm JavaScript CLI runs with literal arguments and stdin through the Node runtime', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-js-launch-'));
  try {
    const binary = path.join(dir, 'cli with spaces.js'), args = ['--model', 'a & b | c', '{"x":"$HOME `echo hi`"}'];
    await fs.writeFile(binary, 'let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>console.log(JSON.stringify({args:process.argv.slice(2),text,node:process.env.ELECTRON_RUN_AS_NODE})));');
    const launch = cliLaunch(binary, args, { TEST: 'keep' });
    assert.equal(launch.command, process.execPath); assert.equal(launch.env.TEST, 'keep');
    const output = JSON.parse(await runProcess(binary, args, 'literal $(echo source)'));
    assert.deepEqual(output, { args, text: 'literal $(echo source)', node: '1' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('Claude safe mode preserves auth setup, uses default effort, and parses a final event without newline', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-claude-safe-'));
  try {
    for (const safe of [true, false]) {
      const binary = path.join(dir, safe ? 'modern.js' : 'legacy.js');
      await fs.writeFile(binary, 'const a=process.argv.slice(2);if(a.includes("--help")){console.log(' + JSON.stringify(safe ? '--safe-mode' : '--setting-sources') + ');process.exit(0)};' +
        'if(a.includes("--safe-mode")!==' + safe + '||a.includes("--setting-sources")===' + safe + '||a.includes("--effort")||a[a.indexOf("--tools")+1]!=="")process.exit(3);' +
        'process.stdin.resume();process.stdin.on("end",()=>{console.log(JSON.stringify({type:"system",subtype:"init",model:"test"}));process.stdout.write(' + JSON.stringify(JSON.stringify({ type: 'result', structured_output: { ...valid, views: { overview: valid } } })) + ')});');
      const result = await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, onProgress() {} });
      assert.equal(result.title, valid.title); assert.equal(result.requestedEffort, null);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('setup terminals: sign-in runs the CLI itself, installs are visible and wait on failure', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), terminals = [];
  const api = { workspace: { getConfiguration: () => ({ get: () => '' }) }, Uri: { parse: value => value },
    window: { createTerminal(options) { const t = { options, show() { t.visible = true; }, dispose() {} }; terminals.push(t); return t; } } };
  const stub = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? api : require(id), Buffer, AbortController, setTimeout, clearTimeout, process });
  const { setupTerminal } = stub.exports, context = { subscriptions: [] }, native = 'C:\\Users\\A Person\\.local\\bin\\claude.exe';
  setupTerminal(context, api, 'claude', 'signIn', native, windowsFixture());
  assert.equal(terminals[0].options.shellPath, native); assert.deepEqual([...terminals[0].options.shellArgs], ['auth', 'login']); assert.equal(terminals[0].visible, true);
  setupTerminal(context, api, 'codex', 'signIn', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', { platform: 'darwin', home: '/u', env: {} });
  assert.deepEqual([...terminals[1].options.shellArgs], ['login']); assert.equal(terminals[1].options.name, 'Yamori · ChatGPT sign-in');
  setupTerminal(context, api, 'claude', 'install', undefined, windowsFixture());
  const win = terminals.at(-1); assert.equal(win.options.shellPath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.match(win.options.shellArgs.at(-1), /irm https:\/\/claude.ai\/install.ps1 \| iex/); assert.match(win.options.shellArgs.at(-1), /& \$claudeExe auth login/);
  setupTerminal(context, api, 'claude', 'install', undefined, { platform: 'darwin', home: '/missing', env: {} });
  assert.equal(terminals.at(-1).options.shellPath, '/bin/bash'); assert.match(terminals.at(-1).options.shellArgs.at(-1), /"\$HOME\/\.local\/bin\/claude" auth login/);
  assert.match(terminals.at(-1).options.shellArgs.at(-1), /\|\| \{ echo; echo "Yamori: setup did not finish/, 'a failed install stays open');
  setupTerminal(context, api, 'codex', 'install', undefined, { platform: 'darwin', home: '/u', env: { SHELL: '/bin/zsh' } });
  const codex = terminals.at(-1).options; assert.equal(codex.shellPath, '/bin/zsh'); assert.deepEqual([...codex.shellArgs].slice(0, 1), ['-ilc']);
  assert.match(codex.shellArgs[1], /npm install -g @openai\/codex; elif command -v brew .*brew install --cask codex/); assert.match(codex.shellArgs[1], /&& hash -r && codex login/);
  assert.equal(setupTerminal(context, api, 'codex', 'install', undefined, { platform: 'darwin', home: '/u', env: { SHELL: '/usr/bin/fish' } }).options.shellPath, '/bin/bash', 'unknown shells use bash');
  assert.equal(context.subscriptions.length, terminals.length);
});
test('Claude Desktop’s own Claude Code is found, newest first, and status checks read sign-in without a model request', async () => {
  const { readStatus, cliSource, isSetupProblem } = require('./engine');
  const home = '/Users/a', base = home + '/Library/Application Support/Claude/claude-code';
  const tree = { [base]: ['2.1.9', '2.1.325', 'notes.txt'], [base + '/2.1.325']: ['485fdac4332e'], [base + '/2.1.325/485fdac4332e']: ['claude.app', '.verified'], [base + '/2.1.325/485fdac4332e/claude.app']: ['Contents'],
    [base + '/2.1.325/485fdac4332e/claude.app/Contents']: ['MacOS'], [base + '/2.1.325/485fdac4332e/claude.app/Contents/MacOS']: ['claude'], [base + '/2.1.9']: ['claude'] };
  const newest = base + '/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude', older = base + '/2.1.9/claude';
  const files = new Set([newest, older]);
  const io = { readdir: async dir => { if (!tree[dir]) throw new Error('ENOENT'); return tree[dir].map(name => ({ name, isDirectory: () => !!tree[dir + '/' + name] || name === 'notes.txt' ? !!tree[dir + '/' + name] : false })); },
    stat: async file => { if (!files.has(file)) throw new Error('ENOENT'); return { isFile: () => true }; }, access: async () => {} };
  const system = { platform: 'darwin', home, env: { PATH: '/usr/bin' }, fs: io };
  assert.equal(await findCLI('claude', '', system), newest, 'the newest Claude Desktop version wins');
  files.delete(newest); assert.equal(await findCLI('claude', '', system), older);
  files.add('/usr/bin/claude'); assert.equal(await findCLI('claude', '', system), '/usr/bin/claude', 'a command-line install comes first');
  await assert.rejects(findCLI('codex', '', system), /Use Set up AI to install it \(or install the ChatGPT desktop app\)/);
  assert.equal(cliSource(newest), 'Claude Desktop'); assert.equal(cliSource('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'), 'ChatGPT app'); assert.equal(cliSource('/usr/bin/claude'), 'Command line');
  const signedIn = readStatus('claude', { code: 0, out: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'reader@example.com', subscriptionType: 'max' }) });
  assert.deepEqual(JSON.parse(JSON.stringify(signedIn)), { signedIn: true, account: 'reader@example.com · max plan' });
  assert.equal(readStatus('claude', { code: 1, out: JSON.stringify({ loggedIn: false }) }).signedIn, false);
  assert.equal(readStatus('claude', { code: 0, out: '{"loggedIn":true,"apiProvider":"bedrock"}' }).account, 'via bedrock');
  assert.equal(readStatus('claude', { code: 1, out: "error: unknown command 'auth'" }).signedIn, null, 'an older CLI is never blocked');
  assert.deepEqual(JSON.parse(JSON.stringify(readStatus('codex', { code: 0, out: 'Logged in using ChatGPT\n' }))), { signedIn: true, account: 'ChatGPT account' });
  assert.equal(readStatus('codex', { code: 0, out: 'Logged in using an API key - sk-***' }).account, 'API key');
  assert.deepEqual(JSON.parse(JSON.stringify(readStatus('codex', { code: 1, out: 'Not logged in' }))), { signedIn: false, problem: 'Not signed in' });
  assert.equal(readStatus('codex', { timedOut: true, out: '' }).signedIn, null);
  for (const message of ['Codex is not signed in.', 'Claude Code was not found on this computer. Use Set up AI…', 'Codex failed (1). 401 Unauthorized', 'Your login has expired']) assert.ok(isSetupProblem(message), message);
  for (const message of ['The model returned invalid JSON.', 'The provider took too long. Retry or choose another provider.']) assert.ok(!isSetupProblem(message), message);
  // The real status check on fixture CLIs: installed + signed in, signed out, missing.
  const fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'yamori-status-'));
  try {
    const cli = (name, body) => { const file = path.join(dir, name); return fsp.writeFile(file, body).then(() => file); };
    const claudeIn = await cli('claude-in.js', 'console.log(JSON.stringify({loggedIn:true,email:"reader@example.com",subscriptionType:"pro"}))');
    const codexOut = await cli('codex-out.js', 'if(process.argv.slice(2).join(" ")==="login status"){console.error("Not logged in");process.exit(1)}');
    const a = await realProviderStatus('claude', claudeIn, { fresh: true });
    assert.deepEqual([a.installed, a.signedIn, a.ready, a.account, a.source], [true, true, true, 'reader@example.com · pro plan', 'Command line']);
    const b = await realProviderStatus('codex', codexOut, { fresh: true });
    assert.deepEqual([b.installed, b.signedIn, b.ready, b.problem], [true, false, false, 'Not signed in']);
    const c = await realProviderStatus('codex', '', { fresh: true, system: { platform: 'linux', home: dir, env: { PATH: dir }, fs: { stat: async () => { throw new Error('ENOENT'); }, access: async () => {} } } });
    assert.deepEqual([c.installed, c.ready, c.problem], [false, false, 'Not installed']);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});
test('setup comes before the app: no ready AI shows Setup, one click continues to the file, and readers switch AI', async () => {
  const h = await readerHarness({ prefetchNext: false, autoNotes: false });
  try {
    const setupView = (...args) => JSON.parse(JSON.stringify(h.exports.setupView(...args)));
    // Cards: most ready first, exactly one primary action each, plain text.
    const missing = { claude: { installed: false, signedIn: false, ready: false, problem: 'Not installed' }, codex: { installed: true, signedIn: false, ready: false, problem: 'Not signed in', source: 'ChatGPT app' } };
    let view = setupView(missing, {});
    assert.deepEqual(view.cards.map(card => card.id), ['codex', 'claude']);
    assert.deepEqual(view.cards.map(card => card.action.label), ['Sign in with ChatGPT', 'Install Claude Code']);
    assert.deepEqual(view.cards[0].lines.map(line => line.text), ['Codex installed · from ChatGPT app', 'Not signed in']);
    view = setupView({ claude: { installed: true, signedIn: true, ready: true, account: 'reader@example.com · max plan', source: 'Claude Desktop' }, codex: missing.codex }, { chosen: 'codex', pending: { label: 'explain plan.py' } });
    assert.equal(view.cards[0].action.label, 'Use Claude'); assert.equal(view.cards[0].badge, 'Ready'); assert.equal(view.cards[0].lines[0].text, 'Claude Code installed · from Claude Desktop');
    assert.match(view.notice, /ChatGPT isn’t ready \(Not signed in\)\. Claude is ready to use instead\./); assert.equal(view.next, 'explain plan.py');
    assert.match(setupView({ claude: missing.claude, codex: { installed: false, ready: false } }).notice, /Neither is on this computer yet/);
    // A first-time user (no AI chosen) gets Setup instead of an empty reader.
    const state = new Map(); h.context.globalState.get = (k, f) => state.get(k) ?? f; h.context.globalState.update = async (k, v) => state.set(k, v);
    const readersBefore = h.readers().length;
    testStatus.codex = { provider: 'codex', installed: true, signedIn: false, ready: false, problem: 'Not signed in', path: '/usr/local/bin/codex', source: 'Command line' };
    await h.commands.get('yamori.openAt')(new h.Uri(require('node:path').join(h.root, 'pipeline/plan.py')).toString(), 3);
    const setupPanel = h.panels.find(panel => panel.type === 'yamoriSetup');
    assert.ok(setupPanel, 'Setup opens'); assert.equal(h.readers().length, readersBefore, 'no reader before an AI is ready');
    const shown = () => setupPanel.messages.filter(m => m.type === 'setup').at(-1).state;
    assert.equal(shown().next, 'explain plan.py'); assert.equal(shown().cards[0].id, 'claude', 'the ready AI is offered first');
    // Signing in to ChatGPT opens its terminal; finishing it continues by itself.
    h.vscode.window.createTerminal = options => { const t = { options, show() { t.visible = true; }, dispose() {} }; (h.terminals ||= []).push(t); return t; };
    await setupPanel.receive({ type: 'primary', provider: 'codex' });
    assert.deepEqual([...h.terminals[0].options.shellArgs], ['login']); assert.equal(shown().cards.find(card => card.id === 'codex').action.label, 'Show the sign-in terminal');
    // Use Claude instead: saved, and the waiting file opens at once.
    await setupPanel.receive({ type: 'primary', provider: 'claude' });
    assert.equal(state.get('provider'), 'claude'); assert.equal(state.get('setupDone'), true);
    await h.until(() => h.readers().length === readersBefore + 1, 'the pending file opens');
    assert.equal(h.last(h.readers().at(-1)).providerLabel, 'Claude Code');
    // With an AI ready, opening files skips Setup.
    const setupCount = h.panels.filter(panel => panel.type === 'yamoriSetup').length;
    await h.commands.get('yamori.openAt')(new h.Uri(require('node:path').join(h.root, 'main.py')).toString(), 1);
    assert.equal(h.panels.filter(panel => panel.type === 'yamoriSetup').length, setupCount);
    // Set up AI from a reader switches open readers to the newly chosen AI.
    delete testStatus.codex;
    const reader = h.readers().at(-1);
    await reader.receive({ type: 'setup' });
    const again = h.panels.filter(panel => panel.type === 'yamoriSetup').at(-1);
    await again.receive({ type: 'primary', provider: 'codex' });
    assert.equal(again.messages.filter(m => m.type === 'setup').at(-1).state.done !== undefined, true, 'nothing pending: You’re set');
    assert.equal(h.last(reader).providerLabel, 'Codex');
  } finally { for (const key of Object.keys(testStatus)) delete testStatus[key]; await h.close(); }
});
test('process cancellation terminates a running request', async () => {
  const controller = new AbortController();
  const promise = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', { signal: controller.signal });
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(promise, /Cancelled/);
});
test('process timeout and nonzero exit become errors, credentials are redacted', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', { timeout: 40 }), /too long/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("sk-private-secret"); process.exit(1)'], ''), error => error.message.includes('[redacted]') && !error.message.includes('sk-private'));
});
test('webview scripts compile and model content is inserted as text, never HTML', () => {
  const html = panelHTML();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  new vm.Script(script);
  assert.match(html, /default-src 'none'/);
  assert.ok(!script.includes('innerHTML'));
  assert.match(script, /textContent/);
  assert.match(html, /aria-pressed/);
  assert.match(script, /node\('details'\)/);
  assert.match(script, /tokenize\(text\)/);
});

test('highlighting preserves exact text and distinguishes rationale from strings', () => {
  const text = 'IF x > 1e-8: RETURN softmax(x) # subtract max for numerical stability';
  const tokens = tokenize(text);
  assert.equal(tokens.map(t => t.text).join(''), text);
  assert.ok(tokens.some(t => t.kind === 'keyword' && t.text === 'IF'));
  assert.ok(!tokens.some(t => t.kind === 'output' && t.text === 'RETURN'), 'inline prose words are not syntax-highlighted');
  assert.ok(tokens.some(t => t.kind === 'number' && t.text === '1e-8'));
  assert.ok(!tokens.some(t => t.kind === 'function'), 'function names are not automatically emphasized');
  assert.ok(tokens.some(t => t.kind === 'comment' && t.text.includes('numerical stability')));
  const quoted = tokenize('PRINT "# this is a string, not a comment"');
  assert.ok(quoted.some(t => t.kind === 'string'));
  assert.ok(!quoted.some(t => t.kind === 'comment'));
  const hostile = '<script>alert("x")</script> # <img onerror="oops">';
  assert.equal(tokenize(hostile).map(t => t.text).join(''), hostile);
});

test('important source rationale is requested at every detail level', () => {
  for (const level of Object.keys(LEVELS)) {
    const prompt = promptFor({ ...source, text: '# subtract max for numerical stability\nz = x - max(x)' }, level);
    assert.match(prompt, /Preserve important explanatory source comments as # comments/);
    assert.match(prompt, /at EVERY detail level, including Overview/);
    assert.match(prompt, /Do not invent rationale absent from the source/);
  }
});

test('readability instructions require task headings and expanded decisions', () => {
  for (const level of Object.keys(LEVELS)) {
    const prompt = promptFor(source, level);
    assert.match(prompt, /purpose-based title and the original symbol/);
    assert.match(prompt, /one action or structuring element per line/);
    assert.match(prompt, /Put IF, ELSE and each consequence on separate lines/);
    assert.match(prompt, /no HTML entities, HTML markup or code fences/);
  }
});

test('higher generations prepare lower views in the same request', () => {
  assert.deepEqual(schemaFor('logic').properties.views.required, ['overview']);
  assert.deepEqual(Object.keys(LEVELS), ['overview', 'logic'], 'two detail levels');
  assert.deepEqual(schemaFor('overview').properties.views.required, []);
  assert.match(promptFor(source, 'logic'), /4–10 concise action lines/);
});

test('validates and preserves step links and companion views across disk serialization', () => {
  const mapped = { ...valid, sections: [{ ...valid.sections[0], lineMap: [{ pseudocodeLine: 2, startLine: 11, endLine: 11 }] }] };
  const parsed = parseResult(JSON.stringify({ ...mapped, views: { overview: mapped } }), source);
  assert.deepEqual(lowerView(parsed, 'logic', 'overview'), mapped);
  assert.equal(parsed.sections[0].lineMap[0].startLine, 11);
  for (const bad of [{ pseudocodeLine: 5, startLine: 10, endLine: 10 }, { pseudocodeLine: 1, startLine: 1, endLine: 10 }, { pseudocodeLine: 1, startLine: 11, endLine: 10 }]) {
    assert.throws(() => parseResult(JSON.stringify({ ...valid, sections: [{ ...valid.sections[0], lineMap: [bad] }] }), source), /Invalid step/);
  }
  assert.equal(lowerView(parsed, 'overview', 'logic'), undefined);
});

test('Codex receives a schema object and returns companion views through its output file', async () => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-cli-test-'));
  const executable = path.join(dir, 'codex');
  const response = { ...valid, views: { overview: valid } };
  try {
    await fs.writeFile(executable, '#!' + process.execPath + '\n' +
      'const fs=require("node:fs");const a=process.argv.slice(2);' +
      'const schema=JSON.parse(fs.readFileSync(a[a.indexOf("--output-schema")+1],"utf8"));' +
      'if(schema.type!=="object"||!schema.properties.views.properties.overview||a[a.indexOf("--model")+1]!=="test-choice")process.exit(3);' +
      'process.stdin.resume();process.stdin.on("end",()=>fs.writeFileSync(a[a.indexOf("--output-last-message")+1],' + JSON.stringify(JSON.stringify(response)) + '));', { mode: 0o700 });
    const value = await generate({ source, level: 'logic', provider: 'codex', cliPath: executable, model: 'test-choice' });
    assert.equal(value.views.overview.title, valid.title);
    assert.equal(value.requestedModel, 'test-choice');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('line formatting preserves real newlines, indentation, blank lines and note styles', () => {
  const text = 'WHEN training starts\r\n    # Count restored updates.\r\n\r\n    IF the first reduction is due\r\n        Halve the rate.';
  const rows = pseudocodeLines(text);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.kind), ['routine', 'note', 'blank', 'decision', '']);
  assert.equal(rows[4].text, '        Halve the rate.');
});

test('actual embedded webview renders multiline steps as separate styled rows', () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; } addEventListener(type, callback) { (this.events ||= {})[type] = callback; }
  }
  const elements = Object.fromEntries(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'setup-ai'].map(id => [id, new Element('div')]));
  let receive;
  const document = { documentElement: { style: {} }, body: new Element('body'), getElementById: id => elements[id], createElement: tag => new Element(tag), createTextNode: text => ({ textContent: text }), querySelectorAll: () => [], importNode: node => node };
  const script = panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const sent = [];
  vm.runInNewContext(script, { document, DOMParser: class { parseFromString(markup) { return { querySelector: () => { const el = new Element('math'); el.markup = markup; return el; } }; } }, acquireVsCodeApi: () => ({ postMessage(m) { sent.push(m); } }), window: { addEventListener: (name, fn) => { if (name === 'message') receive = fn; } } });
  const renderedState = { readingPalette: 'paper', requestedEffort: 'medium', documentKey: 'test-document', providerLabel: 'Codex', level: 'logic', name: 'test.py', result: { ...valid, sections: [{ ...valid.sections[0], lineMap: [{ pseudocodeLine: 5, startLine: 11, endLine: 11 }], pseudocode: 'WHEN training starts\n    # Context: Preserve restored updates.\n\n    IF reduction is due\n        Halve the **learning rate** $\\eta \\leftarrow \\frac{\\eta}{2}$.' }] } };
  receive({ data: { type: 'state', state: renderedState } });
  assert.equal(document.body.attributes['data-palette'], 'paper');
  elements.colors.events.click(); assert.equal(sent.at(-1).type, 'palette');
  elements.files.events.click(); assert.equal(sent.at(-1).type, 'switchFile');
  assert.equal(elements.effort.textContent, 'Effort: medium ▾');
  elements.effort.events.click(); assert.equal(sent.at(-1).type, 'effort');
  assert.equal(elements.refinement.textContent,'Refine: 1 ▾');elements.refinement.events.click();assert.equal(sent.at(-1).type,'refinement');
  const all = []; const visit = el => { all.push(el); (el.children || []).forEach(visit); }; visit(elements.content);
  const rows = all.filter(el => el.className?.startsWith('code-line'));
  assert.equal(rows.length, 5, 'actual newlines must not collapse into one text row');
  assert.ok(rows[1].className.includes('note'));
  assert.ok(rows[1].className.includes('context-note'));
  assert.ok(all.some(el => el.tag === 'details' && el.className === 'reading-block'));
  assert.ok(rows[2].className.includes('blank'));
  assert.ok(rows[3].className.includes('decision'));
  assert.ok(rows[4].className.includes('linked'));
  assert.ok(all.some(el => el.tag === 'strong' && el.className === 'important'));
  assert.equal(rows[1].children[0].textContent, '', 'definition notes are not numbered as actions');
  assert.equal(rows[4].children[0].textContent, '3');
  assert.equal(rows[4].children[1].style.paddingInlineStart, '4.4em');
  rows[4].events.mouseenter();
  assert.equal(sent.at(-1).type, 'hoverStep');
  rows[4].events.mouseleave();
  assert.equal(sent.at(-1).type, 'clearHover');
  rows[4].events.click();
  assert.equal(sent.at(-1).type, 'revealStep');
  assert.equal(sent.at(-1).pseudocodeLine, 5);
  assert.equal(elements.content.className, 'paper');
  const math = all.find(el => el.tag === 'math');
  assert.ok(math, 'equations use native math rather than plain text');
  assert.match(math.markup, /<mfrac>/);
  const copy = all.find(el => el.tag === 'button' && el.textContent === 'Copy');
  copy.events.click({ preventDefault() {} });
  assert.equal(sent.at(-1).type, 'copyBlock');
  assert.equal(sent.at(-1).documentKey, 'test-document');
  for (const [index, expected] of ['missing conceptual bridge', 'key mathematical bridge', '# Example:'].entries()) {
    receive({ data: { type: 'state', state: renderedState } });
    all.length = 0; visit(elements.content);
    const reactions = all.find(el => el.className === 'block-reactions');
    assert.equal(reactions.attributes.role, 'group');
    assert.equal(reactions.children.length, 3);
    const button = reactions.children[index];
    assert.equal(button.disabled, false);
    button.events.click();
    const request = sent.at(-1), count = sent.length;
    assert.equal(request.type, 'updateBlock');
    assert.equal(request.index, 0);
    assert.equal(request.documentKey, renderedState.documentKey);
    assert.equal(request.baseText, renderedState.result.sections[0].pseudocode);
    assert.equal(request.draft, request.baseText, 'reactions start from the approved block');
    assert.ok(request.instruction.includes(expected));
    button.events.click();
    assert.equal(sent.length, count, 'a repeated click cannot submit twice');
    assert.ok(reactions.children.every(b => b.disabled));
    receive({ data: { type: 'state', state: { ...renderedState, busy: true } } });
    all.length = 0; visit(elements.content);
    assert.ok(all.some(el => el.attributes?.['aria-busy'] === 'true' && el.tag === 'button'), 'the active reaction explains what is running');
  }
  receive({ data: { type: 'state', state: renderedState } });
  all.length = 0; visit(elements.content);
  all.find(el => el.textContent === 'Edit').events.click({ preventDefault() {} });
  const editorNodes = []; const findEditor = el => { editorNodes.push(el); (el.children || []).forEach(findEditor); }; findEditor(elements.content);
  const fields = editorNodes.filter(el => el.tag === 'textarea');
  assert.equal(fields.length, 2);
  assert.ok(!editorNodes.some(el => el.className === 'block-reactions'), 'reactions cannot overwrite an open draft');
  fields[0].value = 'Count completed examples'; fields[0].events.input();
  fields[1].value = 'Explain the accumulator'; fields[1].events.input();
  receive({ data: { type: 'state', state: { ...renderedState, readingPalette: 'slate' } } });
  editorNodes.length = 0; findEditor(elements.content);
  assert.equal(editorNodes.filter(el => el.tag === 'textarea')[0].value, 'Count completed examples', 'changing colors preserves the unsaved block draft');
  assert.equal(document.body.attributes['data-palette'], 'slate');

  editorNodes.find(el => el.textContent === 'Update with Codex').events.click();
  assert.equal(sent.at(-1).type, 'updateBlock');
  assert.equal(sent.at(-1).draft, 'Count completed examples');
  assert.equal(sent.at(-1).instruction, 'Explain the accumulator');
  assert.equal(sent.at(-1).baseText, renderedState.result.sections[0].pseudocode);
  editorNodes.find(el => el.textContent === 'Cancel').events.click();
  receive({ data: { type: 'state', state: { ...renderedState, stale: true } } });
  const staleNodes = []; const scan = el => { staleNodes.push(el); (el.children || []).forEach(scan); }; scan(elements.content);
  assert.ok(!staleNodes.some(el => el.className?.includes('linked')));
  assert.ok(staleNodes.find(el => el.className === 'block-reactions').children.every(b => b.disabled), 'stale code cannot be revised through reactions');
  receive({ data: { type: 'state', state: { ...renderedState, busy: true, partial: true, progress: 'Writing pseudocode', model: 'test-model', activity: ['Connecting', 'Writing pseudocode'] } } });
  const draftNodes = []; const draftScan = el => { draftNodes.push(el); (el.children || []).forEach(draftScan); }; draftScan(elements.content);
  assert.ok(draftNodes.some(el => el.tag === 'img'), 'loading view includes the gecko');
  assert.ok(draftNodes.some(el => el.textContent === 'Writing pseudocode'));
  assert.ok(!draftNodes.some(el => el.className?.includes('linked')), 'partial drafts have no actionable source links');
  assert.ok(draftNodes.find(el => el.className === 'block-reactions').children.every(b => b.disabled), 'partial output cannot start a block reaction');
  receive({data:{type:'state',state:{...renderedState,result:undefined,error:'An evaluator returned invalid feedback references.',activity:['',undefined,null,'Checking difficult blocks']}}});
  all.length=0;visit(elements.content);assert.equal(all.filter(el=>el.tag==='li').length,1,'blank activity entries are omitted');assert.ok(!all.some(el=>el.textContent==='Big ideas. Less guesswork.'),'a failure never shows the first-use welcome screen');
  all.find(el=>el.textContent==='Try again').events.click();assert.equal(sent.at(-1).type,'refresh');
  receive({data:{type:'state',state:{...renderedState,result:{...renderedState.result,refinement:{status:'incomplete',warning:'Review incomplete. Draft cached.'}}}}});
  all.length=0;visit(elements.content);assert.ok(all.some(el=>el.textContent==='Draft · review incomplete'));all.find(el=>el.textContent==='Retry review').events.click();assert.equal(sent.at(-1).type,'refresh');
  const mapState = { ...renderedState, result: { ...valid, sections: [renderedState.result.sections[0], { ...valid.sections[0], title: 'Count the matches', pseudocode: 'Return the number of matches.' }] } };
  receive({ data: { type: 'state', state: mapState } });
  all.length = 0; visit(elements.content);
  assert.equal(all.filter(el => el.className === 'map-item').length, 2, 'multi-block files begin with a compact logic map');
  assert.equal(all.filter(el => el.className?.startsWith('reading-block')).length, 0, 'the map does not show a wall of blocks');
  receive({data:{type:'state',state:{...mapState,busy:true,partial:true,result:{...mapState.result,draftComplete:true}}}});
  all.length=0;visit(elements.content);assert.equal(all.filter(el=>el.className==='map-item').length,2,'the complete streaming draft has a usable logic map while reviewers run');
  assert.ok(all.some(el=>el.textContent==='Draft · reviews running · final result will be cached'));
  receive({data:{type:'state',state:mapState}});all.length=0;visit(elements.content);
  const beforeMap = sent.filter(message => message.type === 'updateBlock').length;
  all.filter(el => el.className === 'map-item')[1].events.click();
  all.length = 0; visit(elements.content);
  assert.equal(all.filter(el => el.className?.startsWith('reading-block')).length, 1);
  assert.ok(all.some(el => el.tag === 'h2' && el.textContent === 'Count the matches'));
  all.find(el => el.textContent === 'Copy' && el.tag === 'button').events.click({ preventDefault() {} });
  assert.equal(sent.at(-1).index, 1, 'focused blocks keep original source and edit indexes');
  all.find(el => el.textContent === 'Edit').events.click({ preventDefault() {} });
  all.length = 0; visit(elements.content);
  const secondDraft = all.filter(el => el.tag === 'textarea')[0]; secondDraft.value = 'Count the equal signs.'; secondDraft.events.input();
  all.find(el => el.textContent === '← Logic map').events.click();
  all.length = 0; visit(elements.content);
  assert.equal(all.filter(el => el.className === 'map-item')[1].children[2].textContent, 'Draft');
  all.filter(el => el.className === 'map-item')[1].events.click();
  all.length = 0; visit(elements.content);
  assert.equal(all.filter(el => el.tag === 'textarea')[0], secondDraft, 'navigation reuses the editor instead of losing its history and selection');
  assert.equal(secondDraft.value, 'Count the equal signs.');
  assert.equal(sent.filter(message => message.type === 'updateBlock').length, beforeMap, 'navigating and editing start no inference');
  const beforeConnect = sent.length;
  receive({ data: { type: 'state', state: { ...renderedState, providerLabel: 'Codex', error: 'Codex is not signed in.', setupHint: true } } });
  all.length = 0; visit(elements.content);
  const connect = all.find(el => el.textContent === 'Set up AI');
  assert.ok(connect); assert.ok(!sent.slice(beforeConnect).some(message => message.type === 'setup'), 'an error never opens setup automatically');
  connect.events.click(); assert.equal(sent.at(-1).type, 'setup');
  receive({ data: { type: 'state', state: { ...renderedState, providerLabel: 'Claude Code', error: 'Sign in required', setupHint: true, busy: true } } });
  all.length = 0; visit(elements.content); assert.equal(all.find(el => el.textContent === 'Set up AI').disabled, true);
  receive({ data: { type: 'state', state: { ...renderedState, error: 'The model returned invalid JSON.' } } });
  all.length = 0; visit(elements.content); assert.ok(!all.find(el => el.textContent === 'Set up AI'), 'other errors offer no setup');
  elements['setup-ai'].events.click(); assert.equal(sent.at(-1).type, 'setup', 'AI ▾ always offers Set up AI');
});

test('extension workflow switches levels, reuses cache, marks edits stale and ignores cancelled results', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-test-'));
  const commands = new Map(), state = new Map([['provider', 'codex']]), messages = [];
  let receive, change, calls = 0, deferred, copied, lastRevision, lastModel, lastEffort, nextPick;
  class Uri { constructor(value) { this.value = value; this.scheme = 'file'; this.fsPath = value.replace('file://', ''); } toString() { return this.value; } static parse(v) { return new Uri(v); } }
  class Range { constructor(a, b, c, d) { if (typeof a === 'object') { this.start = a; this.end = b; } else { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } } }
  class Selection extends Range { get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; } }
  let documentText = 'x = 1\nprint(x)';
  const doc = { uri: new Uri('file:///sample.py'), languageId: 'python', lineCount: 2, getText: () => documentText, lineAt: i => ({ text: documentText.split('\n')[i] }) };
  let highlights = [], sourceOpens = 0, scrolls = 0;
  const editor = { document: doc, selection: new Selection(0, 0, 0, 0), setDecorations(_, ranges) { highlights = ranges; }, revealRange() { scrolls++; } };
  const noop = () => ({ dispose() {} });
  const vscode = {
    Uri, Range, Selection, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: 2 }, TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    commands: { registerCommand(id, fn) { commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: true, textDocuments: [doc], asRelativePath: () => 'sample.py', openTextDocument: async () => doc, getConfiguration: () => ({ get: (_, fallback) => fallback }), onDidChangeTextDocument(fn) { change = fn; return noop(); } },
    window: { createStatusBarItem: statusItem, showQuickPick: async items => { const rows = await items; return rows.find(row => row.id === nextPick || row.value === nextPick); }, activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor: noop, showTextDocument: async () => { sourceOpens++; return editor; },
      showErrorMessage(message) { throw new Error(message); }, setStatusBarMessage() {},
      createWebviewPanel: () => ({ reveal() {}, onDidDispose: noop, webview: { postMessage: m => messages.push(structuredClone(m.state)), onDidReceiveMessage(fn) { receive = fn; return noop(); } } }) },
    env: { clipboard: { writeText: async text => { copied = text; } } }
  };
  const engine = { ...require('./engine'), listModels: async () => [{ id: 'test-choice', label: 'Test model', effort: 'high' }], listEfforts: async () => [{ id: 'low', description: 'Quick' }, { id: 'medium', description: 'Balanced' }, { id: 'high', description: 'Deep' }], generate: async opts => {
    calls++;
    lastRevision = opts.revision; lastModel = opts.model; lastEffort = opts.effort;
    if (deferred) return new Promise(resolve => { deferred.resolve = resolve; deferred.progress = opts.onProgress; });
    if (opts.edit) return { ...valid, sections: [{ ...opts.edit.section, pseudocode: opts.edit.draft + '\n# Polished', lineMap: [{ pseudocodeLine: 2, startLine: 2, endLine: 2 }] }] };
    const make = name => ({ ...valid, title: name, sections: [{ ...valid.sections[0], pseudocode: opts.revision?.value.sections[0].pseudocode || valid.sections[0].pseudocode, startLine: 1, endLine: 2, lineMap: [{ pseudocodeLine: 2, startLine: 2, endLine: 2 }] }, { title: 'Unchanged neighbor', pseudocode: 'Print result', startLine: 2, endLine: 2 }] });
    return { ...make(opts.level), requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort, views: Object.fromEntries(['overview', 'logic'].slice(0, ['overview', 'logic'].indexOf(opts.level)).map(name => [name, make(name)])) };
  } };
  const moduleStub = { exports: {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: temp }, globalState: { get: (k, fallback) => state.get(k) ?? fallback, update: async (k, v) => state.set(k, v) }, secrets: { get: async () => undefined } };
  try {
    const code = await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8');
    vm.runInNewContext(code, { require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout });
    await moduleStub.exports.activate(context);
    await commands.get('yamori.read')();
    assert.equal(messages.at(-1).result.title, 'logic');
    assert.equal(calls, 1);
    await commands.get('yamori.read')();
    assert.equal(calls, 1, 'unchanged source uses cached explanation');
    await receive({ type: 'level', level: 'overview' });
    assert.equal(messages.at(-1).result.title, 'overview');
    assert.equal(calls, 1, 'downgrade requires no second model request');
    await receive({ type: 'level', level: 'detailed' });
    assert.equal(messages.at(-1).result.title, 'overview', 'the removed Detailed level is ignored');
    await receive({ type: 'level', level: 'logic' });
    assert.equal(calls, 1, 'returning to Logic uses cache');
    await receive({ type: 'hoverStep', index: 0, pseudocodeLine: 2 });
    assert.equal(highlights[0].start.line, 1);
    assert.equal(editor.selection.start.line, 0, 'hover must not move the caret');
    assert.equal(sourceOpens, 0, 'hover must not open or focus editors');
    assert.equal(scrolls, 0, 'hover must not scroll editors');
    await receive({ type: 'clearHover' });
    assert.equal(highlights.length, 0);
    await receive({ type: 'revealStep', index: 0, pseudocodeLine: 2 });
    assert.equal(editor.selection.start.line, 1, 'step jumps to its precise range, not the entire section');
    editor.selection = new Selection(0, 0, 0, 0);
    // A fresh extension activation has no memory cache; it must recover the
    // companion Overview from the stored Logic/Detailed response without inference.
    await Promise.all(context.subscriptions.splice(0).map(d => d?.dispose?.()));
    assert.equal(highlights.length, 0, 'deactivation clears existing highlights');
    await moduleStub.exports.activate(context);
    await commands.get('yamori.read')();
    await receive({ type: 'level', level: 'overview' });
    assert.equal(calls, 1, 'companion views survive extension restart');
    await receive({ type: 'level', level: 'logic' });
    documentText = 'x = 2\nprint(x)'; change({ document: doc });
    assert.equal(messages.at(-1).stale, true);
    await receive({ type: 'hoverStep', index: 0, pseudocodeLine: 2 });
    assert.equal(highlights.length, 0, 'stale source must never highlight');
    await receive({ type: 'refresh' });
    assert.equal(calls, 2, 'refresh translates edited source');
    assert.equal(messages.at(-1).stale, false);
    const beforeEdit = messages.at(-1), neighbor = JSON.stringify(beforeEdit.result.sections[1]);
    await receive({ type: 'copyBlock', index: 0, documentKey: beforeEdit.documentKey });
    assert.equal(copied, beforeEdit.result.sections[0].pseudocode);
    await receive({ type: 'updateBlock', index: 0, documentKey: beforeEdit.documentKey, baseText: beforeEdit.result.sections[0].pseudocode, draft: 'Set x to $x^2$\nPrint x', instruction: 'Keep the equation' });
    const edited = messages.at(-1).result.sections[0].pseudocode;
    assert.match(edited, /Polished/);
    assert.equal(JSON.stringify(messages.at(-1).result.sections[1]), neighbor, 'neighboring blocks must remain byte-for-byte unchanged');
    assert.equal(messages.at(-1).result.edited, true);
    assert.equal(calls, 3);
    await receive({ type: 'level', level: 'overview' });
    assert.equal(calls, 4, 'a stale lower view is regenerated lazily');
    assert.ok(lastRevision?.value.sections[0].pseudocode.includes('$x^2$'));
    await receive({ type: 'level', level: 'logic' });
    assert.equal(calls, 4);
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'approved block is preserved exactly');
    await receive({ type: 'level', level: 'overview' });
    await receive({ type: 'level', level: 'logic' });
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'derived companion views cannot replace the approved edit');
    await Promise.all(context.subscriptions.splice(0).map(d => d?.dispose?.()));
    await moduleStub.exports.activate(context);
    await commands.get('yamori.read')();
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'approved edits survive extension restart');
    deferred = {};
    const request = receive({ type: 'refresh' });
    while (!deferred.resolve) await new Promise(resolve => setTimeout(resolve, 1));
    deferred.progress({ phase: 'Writing pseudocode', preview: { ...valid, title: 'live draft' }, model: 'test-stream-model' });
    assert.equal(messages.at(-1).partial, false, 'refresh keeps the cached explanation visible until validation');
    assert.equal(messages.at(-1).model, 'test-stream-model');
    await receive({ type: 'stop' });
    deferred.progress({ phase: 'Writing pseudocode', preview: { ...valid, title: 'obsolete progress' } });
    assert.notEqual(messages.at(-1).result?.title, 'obsolete progress');
    deferred.resolve({ ...valid, title: 'obsolete result' });
    await request;
    assert.notEqual(messages.at(-1).result.title, 'obsolete result');
    assert.equal(messages.at(-1).busy, false);
    deferred = undefined;
    const beforeChoice = calls;
    nextPick = 'test-choice'; await commands.get('yamori.model')();
    assert.equal(calls, beforeChoice, 'choosing a model must not start inference');
    assert.equal(state.get('codexModel').id, 'test-choice');
    assert.equal(messages.at(-1).requestedModel, 'test-choice');
    await receive({ type: 'refresh' });
    assert.equal(lastModel, 'test-choice', 'new generation receives selected model');
    assert.equal(calls, beforeChoice + 1);
    await receive({ type: 'level', level: 'overview' });
    assert.equal(calls, beforeChoice + 1, 'model-specific companion view is cached');
    nextPick = 'claude'; await receive({ type: 'provider' });
    assert.equal(lastModel, '', 'Claude has a separate default');
    nextPick = 'test-choice'; await commands.get('yamori.model')();
    assert.equal(state.get('claudeModel').id, 'test-choice');
    nextPick = 'codex'; await receive({ type: 'provider' });
    assert.equal(messages.at(-1).requestedModel, 'test-choice', 'Codex choice is restored');
    const beforeEffort = calls;
    nextPick = 'medium'; await commands.get('yamori.effort')();
    assert.equal(calls, beforeEffort, 'choosing effort must not start inference');
    assert.equal(messages.at(-1).requestedEffort, 'medium');
    await receive({ type: 'refresh' });
    assert.equal(lastEffort, 'medium');
    assert.equal(calls, beforeEffort + 1);
    nextPick = 'auto'; await commands.get('yamori.effort')();
    await receive({ type: 'refresh' });
    assert.equal(lastEffort, null, 'provider default omits the effort override');
    nextPick = ''; await commands.get('yamori.model')();
    nextPick = 'high'; await commands.get('yamori.effort')();
    await commands.get('yamori.read')();
    assert.equal(lastEffort, 'high', 'effort-only changes invalidate default-model cache keys');
    nextPick = 'test-choice'; await commands.get('yamori.model')();
    assert.equal(messages.at(-1).requestedEffort, null, 'each model restores its saved effort');
    await Promise.all(context.subscriptions.splice(0).map(d => d?.dispose?.()));
    await moduleStub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(messages.at(-1).requestedEffort, null, 'effort choices survive restart');
    const beforeColors = calls, beforeKey = messages.at(-1).documentKey;
    nextPick = 'paper'; await commands.get('yamori.colors')();
    assert.equal(messages.at(-1).readingPalette, 'paper');
    assert.equal(calls, beforeColors, 'reading colors do not start inference');
    assert.equal(messages.at(-1).documentKey, beforeKey, 'color changes do not invalidate cache or drafts');
    await Promise.all(context.subscriptions.splice(0).map(d => d?.dispose?.()));
    await moduleStub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(messages.at(-1).readingPalette, 'paper', 'reading palette survives restart');


  } finally { await Promise.all(context.subscriptions.map(d => d?.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); }
});

test('identity migration imports valid preferences once without overwriting newer choices', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-migration-test-'));
  const state = new Map([['provider', 'codex']]);
  const context = { globalStorageUri: { fsPath: dir }, globalState: { get: k => state.get(k), update: async (k, v) => state.set(k, v) } };
  const stub = { exports: {} };
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? {} : require(id) });
    const file = path.join(dir, 'migration.json');
    await fs.writeFile(file, JSON.stringify({ detail: 'overview', provider: 'gemini' }));
    await stub.exports.migratePreferences(context);
    assert.equal(state.get('detail'), 'overview');
    assert.equal(state.get('provider'), 'codex');
    await assert.rejects(fs.access(file));
    await stub.exports.migratePreferences(context);
    assert.equal(state.get('detail'), 'overview');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('live JSON preview handles incomplete strings and never displays companion JSON', () => {
  const raw = JSON.stringify({ ...valid, sections: [valid.sections[0], { ...valid.sections[0], title: 'Second algorithm' }], views: { overview: { title: 'Hidden lower view' } } });
  const preview = partialView(raw);
  assert.equal(preview.sections.length, 2);
  assert.equal(preview.title, valid.title);
  assert.equal(preview.sections[1].title, 'Second algorithm');
  assert.ok(!JSON.stringify(preview).includes('Hidden lower view'));
  const partial = partialView('{"title":"A","sections":[{"title":"Step","pseudocode":"IF ready\\n    Print \\u');
  assert.match(partial.sections[0].pseudocode, /IF ready\n    Print/);
});

test('Codex streaming uses saved auth, emits output deltas, reports model, rejects failed turns', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-stream-test-'));
  const binary = path.join(dir, 'codex');
  const program = `#!${process.execPath}
const rl = require('node:readline').createInterface({input:process.stdin});
const out = event => process.stdout.write(JSON.stringify(event)+'\\n');
rl.on('line', line => {
 const request=JSON.parse(line);
 if(request.id===1) out({id:1,result:{}});
 if(request.id===2) {
   if(request.params.model && (request.params.model!=='test-selected'||request.params.config.model_reasoning_effort!=='high')) return out({id:2,error:{message:'wrong model selection'}});
   out({id:2,result:{thread:{id:'test-thread'},model:request.params.model||'test-codex-model'}});
 }
 if(request.id===4) out({id:4,result:{data:[{model:'live-low',displayName:'Live low',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'medium'},{model:'live-high',displayName:'Live high',supportedReasoningEfforts:[{reasoningEffort:'high'}],defaultReasoningEffort:'high'}],nextCursor:null}});
 if(request.id===3) {
   out({method:'item/reasoning/summaryTextDelta',params:{delta:'NOT DISPLAYABLE'}});
   const text=${JSON.stringify(JSON.stringify(valid))};
   for(let i=0;i<text.length;i+=12) out({method:'item/agentMessage/delta',params:{delta:text.slice(i,i+12)}});
   out({method:'turn/completed',params:{turn:{status:request.params.input[0].text==='FAIL'?'failed':'completed',error:{message:'simulated failure'}}}});
 }
});`;
  try {
    await fs.writeFile(binary, program, { mode: 0o700 });
    const deltas = [], phases = [];
    const result = await streamCodex(binary, 'Translate', schemaFor('logic'), { cwd: dir, onText: value => deltas.push(value), onPhase: (phase, model) => phases.push({ phase, model }) });
    assert.equal(result, JSON.stringify(valid));
    assert.ok(deltas.length > 3);
    assert.ok(!deltas.some(text => text.includes('NOT DISPLAYABLE')));
    assert.ok(phases.some(p => p.model === 'test-codex-model'));
    await streamCodex(binary, 'Translate', schemaFor('logic'), { cwd: dir, model: 'test-selected', effort: 'high' });
    const catalog = await listModels('codex', binary);
    assert.deepEqual(catalog.map(m => [m.id, m.effort]), [['live-low', 'low'], ['live-high', 'high']]);
    assert.deepEqual((await listEfforts('codex', 'live-high', binary)).map(e => e.id), ['high']);
    assert.deepEqual((await listEfforts('codex', '', binary)).map(e => e.id), ['low']);
    await assert.rejects(streamCodex(binary, 'FAIL', SCHEMA, { cwd: dir }), /simulated failure/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(streamCodex(binary, 'Translate', SCHEMA, { cwd: dir, signal: controller.signal }), /Cancelled/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('math delimiters preserve prose and typeset subscripts, sums and fractions', () => {
  const line = String.raw`Count samples $c_{t+1} \leftarrow c_t + \frac{n}{2}$ safely.`;
  const parts = mathParts(line);
  assert.equal(parts.map(p => p.text).join(''), line);
  assert.equal(parts.length, 3);
  const katex = require('./katex.min');
  const markup = katex.renderToString(parts[1].tex, { output: 'mathml', trust: false });
  assert.match(markup, /<msub>/); assert.match(markup, /<mfrac>/);
  assert.match(markup, /<math/);
  assert.equal(mathParts('No equations here.')[0].text, 'No equations here.');
  assert.equal(mathParts('Unfinished $x').length, 1);
});

test('edit requests ground one block and revisions preserve user intent across levels', () => {
  const prompt = editPrompt(source, 'logic', { section: valid.sections[0], draft: 'Print two numbers', instruction: 'Make it clearer' });
  assert.match(prompt, /exactly ONE/); assert.match(prompt, /Do not use tools, edit files/);
  assert.match(prompt, /Make it clearer/); assert.match(prompt, /Print two numbers/);
  const revised = revisionPrompt(source, 'overview', { level: 'logic', value: valid });
  assert.match(revised, /Never silently revert edits/);
  assert.match(promptFor(source, 'logic'), /\\leftarrow/);
});

test('custom calls use bounded workspace definitions and callable model forward bodies', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-context-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-outside-'));
  class Uri { constructor(file) { this.fsPath = file; this.scheme = 'file'; } toString() { return 'file://' + this.fsPath; } static parse(value) { return new Uri(value.replace('file://', '')); } }
  const code = await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8');
  const moduleStub = { exports: {} };
  vm.runInNewContext(code, { require: id => id === 'vscode' ? {} : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout });
  const collect = moduleStub.exports.collectCallContext;
  try {
    const body = ['class Student:', '    def __init__(self):', ...Array.from({ length: 85 }, (_, i) => '        self.layer_' + i + ' = None'), '    def forward(self, inputs, times, labels):', '        return inputs * 2', '', 'def unrelated():', '    return 5'].join('\n');
    await fs.writeFile(path.join(dir, 'network.py'), body);
    await fs.writeFile(path.join(outside, 'hidden.py'), 'SECRET = 123');
    await fs.symlink(path.join(outside, 'hidden.py'), path.join(dir, 'linked.py'));
    const target = { targetUri: new Uri(path.join(dir, 'network.py')), targetRange: { start: { line: 0 }, end: { line: 89 } } };
    const api = {
      Uri, Position: class { constructor(line, character) { this.line = line; this.character = character; } },
      workspace: { getWorkspaceFolder: uri => uri.fsPath.startsWith(dir + '/') ? { uri: new Uri(dir) } : undefined, asRelativePath: uri => path.basename(uri.fsPath), openTextDocument: async uri => ({ languageId: 'python', getText: () => body }) },
      commands: { executeCommand: async (command, uri, position) => position.line === 0 ? [target] : [{ uri: new Uri(path.join(dir, 'linked.py')), range: { start: { line: 0 }, end: { line: 0 } } }] }
    };
    const main = { ...source, uri: 'file://' + path.join(dir, 'train.py'), startLine: 1, endLine: 2, text: 'predictions = self.student_model(inputs, times, labels)\nresult = unknown_custom(predictions)' };
    const enriched = await collect(main, api);
    assert.equal(enriched.callContext.definitions.length, 1, 'duplicate definition/type targets are deduplicated');
    assert.match(enriched.callContext.definitions[0].text, /def forward/);
    assert.match(enriched.callContext.definitions[0].text, /return inputs \* 2/);
    assert.ok(enriched.callContext.unresolved.includes('unknown_custom'), 'outside-workspace symlink is not followed');
    assert.ok(!JSON.stringify(enriched.callContext).includes('SECRET'));
    assert.notEqual(cacheKey(main, 'logic', 'codex'), cacheKey(enriched, 'logic', 'codex'));
    assert.equal(cacheKey(main, 'revision', 'codex'), cacheKey(enriched, 'revision', 'codex'), 'approved user edits survive context upgrades');
    const prompt = promptFor(enriched, 'logic');
    assert.match(prompt, /network.py/); assert.match(prompt, /zero label does not prove unconditional/);
    assert.match(prompt, /# Unresolved/); assert.match(prompt, /ORIGINAL call site/);
    api.commands.executeCommand = () => new Promise(() => {});
    const partial = await collect(main, api, 20);
    assert.equal(partial.callContext.definitions.length, 0);
    assert.ok(partial.callContext.unresolved.includes('self.student_model'), 'language server timeout remains useful');
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); }
});

test('Claude receives the selected alias and reports the actual response model', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-claude-model-'));
  const binary = path.join(dir, 'claude');
  try {
    const envelope = { type: 'result', structured_output: { ...valid, views: { overview: valid } }, modelUsage: { 'claude-actual-version': {} } };
    await fs.writeFile(binary, '#!' + process.execPath + '\n' +
      'const a=process.argv.slice(2);if(a[a.indexOf("--model")+1]!=="opus"||a.includes("--effort"))process.exit(3);' +
      'process.stdin.resume();process.stdin.on("end",()=>console.log(' + JSON.stringify(JSON.stringify(envelope)) + '));', { mode: 0o700 });
    for (const onProgress of [undefined, () => {}]) {
      const value = await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: null, onProgress });
      assert.equal(value.model, 'claude-actual-version');
      assert.equal(value.requestedModel, 'opus');
      assert.equal(parseResult(JSON.stringify(value), source).requestedModel, 'opus');
    }
    assert.ok((await listModels('claude')).some(m => m.id === 'sonnet'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('friendly explanation targets capable readers without coding experience and grounds insights', async () => {
  const prompt = promptFor(source, 'logic');
  assert.match(prompt, /strong in mathematics but inexperienced in programming/);
  assert.match(prompt, /what changes in place, what remains fixed/);
  assert.match(prompt, /# Insight:/);
  assert.match(prompt, /author's stated intention/);
  assert.match(prompt, /Use plain words for simple counters/);
  assert.ok(!prompt.includes('Use compact research-paper algorithm style'));
  assert.match(editPrompt(source, 'logic', {section: valid.sections[0], draft: 'Print x'}), /mathematically capable reader/);
  const values = await listEfforts('claude', 'sonnet');
  assert.ok(values.some(v => v.id === 'high'));
  assert.ok(!(await listEfforts('claude', 'claude-opus-4-6')).some(v => v.id === 'xhigh'));
  assert.equal((await listEfforts('claude', 'unknown-deployment')).length, 0);
});


test('emphasis preserves meaning and ordinary connective words stay plain', () => {
  const parts = emphasisParts('Pick K items **without repeats** and copy **their states**');
  assert.equal(parts.filter(p => p.strong).length, 2);
  assert.equal(parts.map(p => p.text).join(''), 'Pick K items without repeats and copy their states');
  const tokens = tokenize('Use teacher and guide for the next state');
  assert.ok(!tokens.some(t => t.kind === 'keyword'));
  assert.equal(pseudocodeLines('For teacher_step, use the teacher')[0].kind, '');
  assert.equal(pseudocodeLines('For each selected item')[0].kind, 'decision');
  assert.equal(tokenize('Return the original states')[0].kind, 'output');
  assert.equal(emphasisParts('Incomplete **key')[0].text, 'Incomplete **key');
  const hostile = emphasisParts('Keep **<img onerror=alert(1)>**');
  assert.equal(hostile[1].text, '<img onerror=alert(1)>');
});


test('all generation and edit paths contain the explicit communication objective', () => {
  const prompts = [...Object.keys(LEVELS).map(level => promptFor(source, level)), editPrompt(source, 'logic', { section: valid.sections[0], draft: 'Print x' }), revisionPrompt(source, 'overview', {level:'logic',value:valid})];
  for (const prompt of prompts) {
    assert.ok(prompt.includes('min_X [ H(B | X, K) + λ · ReadCost(X) ]'));
    assert.match(prompt, /subject to semantic fidelity/);
    assert.match(prompt, /not a request to invent numerical entropy estimates/);
  }
});


test('generation and editing permit grounded internal algorithm knowledge for what, how and why', () => {
  const prompts = [...Object.keys(LEVELS).map(level => promptFor(source, level)), editPrompt(source, 'logic', {section:valid.sections[0],draft:'Print x'}), revisionPrompt(source, 'overview', {level:'logic',value:valid})];
  for (const prompt of prompts) {
    assert.match(prompt, /Actively use your established internal mathematical/);
    assert.match(prompt, /WHAT:.*HOW:.*WHY:/s);
    assert.match(prompt, /Heun \/ explicit trapezoidal predictor-corrector pattern/);
    assert.match(prompt, /Do not turn a standard rationale into an unconditional guarantee/);
    assert.ok(prompt.includes('min_X [ H(B | X, K) + λ · ReadCost(X) ]'));
  }
});

test('file tabs reuse one reader column and isolate generation, detail, edits, closure and prepared files', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-tabs-test-'));
  const commands = new Map(), settings = new Map([['provider', 'codex']]), panels = [], shown = [], launchers = [];
  let change, editorChanged, nextPick, calls = 0, holdA = true, holdB = false, pendingA, pendingB, startA, startB;
  const aStarted = new Promise(resolve => { startA = resolve; });
  let bStarted;
  class Uri { constructor(value) { this.value = value; this.scheme = 'file'; this.fsPath = value.replace('file://', ''); } toString() { return this.value; } static parse(value) { return new Uri(value); } }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  class Selection extends Range { get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; } }
  const docs = ['first.py', 'second.py', 'third.py'].map(name => ({ uri: new Uri('file:///project/' + name), languageId: 'python', lineCount: 2, getText: () => 'x = 1\nprint(x)', lineAt: i => ({ text: ['x = 1', 'print(x)'][i] }) }));
  const editors = docs.map(document => ({ document, viewColumn: 1, selection: new Selection(0, 0, 0, 0), setDecorations() {}, revealRange() {} }));
  const noop = () => ({ dispose() {} });
  const vscode = {
    Uri, Range, Selection, RelativePattern: class {}, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: -2 }, ProgressLocation: { Notification: 1 }, TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
    commands: { registerCommand(id, fn) { assert.ok(!commands.has(id), 'commands are registered only once'); commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: new Uri('file:///project') }], textDocuments: docs, asRelativePath: uri => path.basename(uri.fsPath), openTextDocument: async uri => docs.find(doc => doc.uri.toString() === uri.toString()), getConfiguration: () => ({ get: (_, fallback) => fallback }), findFiles: async () => docs.map(doc => doc.uri), onDidChangeTextDocument(fn) { change = fn; return noop(); } },
    window: {
      createStatusBarItem() { const item = statusItem(); launchers.push(item); return item; },
      activeTextEditor: editors[0], visibleTextEditors: [editors[0]], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor(fn) { editorChanged = fn; return noop(); },
      showErrorMessage(message) { throw new Error(message); }, setStatusBarMessage() {}, showInformationMessage() {},
      showTextDocument: async (doc, options) => { const editor = editors.find(editor => editor.document === doc); shown.push({ doc, options }); vscode.window.visibleTextEditors = [editor]; return editor; },
      showQuickPick: async (items, options) => { const rows = await items; return options?.canPickMany ? rows.filter(row => row.label === 'third.py') : rows.find(row => row.label === nextPick); },
      withProgress: async (_, fn) => fn({ report() {} }, { onCancellationRequested: noop }),
      createWebviewPanel(_, title, options) {
        const panel = { title, viewColumn: options.viewColumn === -2 ? 2 : options.viewColumn, active: true, visible: true, messages: [],
          reveal(column) { assert.equal(column, 2, 'reusing a tab must not split a new column'); vscode.window.activeTextEditor = undefined; panel.active = true; panel.changed?.({ webviewPanel: panel }); },
          onDidDispose(fn) { panel.closed = fn; return noop(); }, onDidChangeViewState(fn) { panel.changed = fn; return noop(); },
          dispose() { if (panel.disposed) return; panel.disposed = true; panel.closed?.(); },
          webview: { postMessage(message) { panel.messages.push(structuredClone(message.state)); }, onDidReceiveMessage(fn) { panel.receive = fn; return noop(); } }
        };
        panels.push(panel); return panel;
      }
    }, env: { clipboard: { writeText: async () => {} } }
  };
  const valueFor = opts => {
    const make = level => ({ title: opts.source.name + ' ' + level, summary: 'Read the file.', sections: [{ title: 'Print', startLine: 1, endLine: 2, pseudocode: opts.edit?.draft || 'Print ' + opts.source.name, lineMap: [{ pseudocodeLine: 1, startLine: 2, endLine: 2 }] }] });
    return { ...make(opts.level), requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort, views: Object.fromEntries(['overview', 'logic'].slice(0, ['overview', 'logic'].indexOf(opts.level)).map(level => [level, make(level)])) };
  };
  const engine = { ...require('./engine'), generate: async opts => {
    calls++;
    if (holdA && opts.source.name === 'first.py') { startA(); return new Promise(resolve => { pendingA = { resolve: () => resolve(valueFor(opts)), signal: opts.signal }; }); }
    if (holdB && opts.source.name === 'second.py') { startB(); return new Promise(resolve => { pendingB = { resolve: () => resolve(valueFor(opts)), signal: opts.signal }; }); }
    return valueFor(opts);
  } };
  const stub = { exports: {} }, context = { subscriptions: [], globalStorageUri: { fsPath: temp }, globalState: { get: (key, fallback) => settings.get(key) ?? fallback, update: async (key, value) => settings.set(key, value) }, secrets: {} };
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), Buffer, AbortController, setTimeout, clearTimeout });
    await stub.exports.activate(context);
    assert.equal(calls, 0, 'startup creates the launcher without inference');
    assert.equal(launchers[0].visible, true); assert.equal(launchers[0].text, '$(yamori-gecko) Yamori');
    assert.match(launchers[0].tooltip, /first.py/);
    const first = commands.get(launchers[0].command.command)(...launchers[0].command.arguments); await aStarted;
    const repeat = commands.get('yamori.read')();
    assert.equal(panels.length, 1, 'repeated opening reuses the existing tab and request');
    vscode.window.activeTextEditor = editors[1]; vscode.window.visibleTextEditors = [editors[1]];
    editorChanged(editors[1]); assert.match(launchers[0].tooltip, /second.py/);
    assert.equal(calls, 1, 'switching scripts updates the icon without inference');
    await commands.get(launchers[0].command.command)(...launchers[0].command.arguments);
    assert.equal(panels.length, 2);
    assert.deepEqual(panels.map(panel => panel.title), ['first.py · Yamori', 'second.py · Yamori']);
    assert.deepEqual(panels.map(panel => panel.viewColumn), [2, 2]);
    assert.equal(pendingA.signal.aborted, false, 'opening another file does not cancel the first');
    assert.equal(panels[1].messages.at(-1).name, 'second.py');
    holdA = false; pendingA.resolve(); await Promise.all([first, repeat]);
    assert.equal(calls, 2);
    assert.equal(panels[0].messages.at(-1).result.title, 'first.py logic');
    await panels[1].receive({ type: 'level', level: 'overview' });
    assert.equal(panels[1].messages.at(-1).level, 'overview');
    assert.equal(panels[0].messages.at(-1).level, 'logic');
    const beforeEdit = panels[1].messages.at(-1);
    await panels[1].receive({ type: 'updateBlock', index: 0, documentKey: beforeEdit.documentKey, baseText: beforeEdit.result.sections[0].pseudocode, draft: 'My second-file explanation', instruction: 'Keep this meaning' });
    assert.equal(panels[1].messages.at(-1).result.sections[0].pseudocode, 'My second-file explanation');
    assert.equal(panels[0].messages.at(-1).result.sections[0].pseudocode, 'Print first.py');
    nextPick = 'first.py'; const beforeSwitch = calls;
    await commands.get('yamori.switchFile')();
    assert.equal(calls, beforeSwitch, 'switching native tabs does not regenerate');
    assert.equal(shown.at(-1).doc, docs[0]);
    assert.equal(shown.at(-1).options.preserveFocus, true);
    assert.equal(editors[0].selection.start.line, 0, 'restoring the source does not move the caret');
    holdB = true; bStarted = new Promise(resolve => { startB = resolve; });
    const refresh = panels[1].receive({ type: 'refresh' }); await bStarted;
    panels[0].dispose();
    assert.equal(pendingB.signal.aborted, false, 'closing one tab does not stop another file');
    holdB = false; pendingB.resolve(); await refresh;
    const beforeReopen = calls;
    vscode.window.activeTextEditor = editors[0];
    await commands.get('yamori.read')();
    assert.equal(panels.length, 3, 'a closed file can be reopened');
    assert.equal(calls, beforeReopen, 'reopening a closed tab uses disk cache');
    nextPick = undefined;
    await commands.get('yamori.project')(new Uri('file:///project'));
    assert.equal(panels.length, 3, 'folder preparation must not open a panel for every file');
    nextPick = 'third.py'; const beforePrepared = calls;
    await commands.get('yamori.switchFile')();
    assert.equal(panels.length, 4);
    assert.equal(panels[3].title, 'third.py · Yamori');
    assert.equal(calls, beforePrepared, 'prepared explanations open without inference');
    docs[2].getText = () => 'x = 2\nprint(x)'; change({ document: docs[2] });
    assert.equal(panels[3].messages.at(-1).stale, true);
    assert.equal(panels[1].messages.at(-1).stale, false, 'source changes affect only related tabs');
    editorChanged(undefined); assert.equal(launchers[0].visible, false); assert.equal(launchers[0].command, undefined);
    editorChanged({ document: { uri: { scheme: 'output' } } }); assert.equal(launchers[0].visible, false);
    editorChanged(editors[1]); assert.equal(launchers[0].visible, true);
    vscode.workspace.isTrusted = false; editorChanged(editors[1]); assert.equal(launchers[0].visible, true, 'Restricted Mode keeps the launcher available');
    const tsDoc={...docs[1],uri:new Uri('file:///project/current.ts'),languageId:'typescript',getText:()=> 'const x = 1;\nconsole.log(x);'};docs.push(tsDoc);vscode.window.activeTextEditor={...editors[1],document:tsDoc};vscode.window.visibleTextEditors=[vscode.window.activeTextEditor];
    editorChanged(vscode.window.activeTextEditor);assert.match(launchers[0].tooltip,/current.ts/);
    await commands.get('yamori.read')();assert.equal(panels.at(-1).title,'current.ts · Yamori');assert.ok(panels.at(-1).messages.at(-1).result,'TypeScript explanation works in Restricted Mode');
  } finally { await Promise.all(context.subscriptions.map(item => item.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); }
});

test('source alignment rebases unchanged links and identifies helper callers conservatively', () => {
  const { analyzeSource, currentSnapshot, linePlan, dependencyBlocks } = require('./cache');
  const text = 'def a():\n    return 1\n\ndef b():\n    return 2\n';
  const old = { uri: 'file:///a.py', text, fullText: text, fullHash: 'old', startLine: 1, endLine: 6, selected: false };
  const value = { title: 'Two functions', summary: '', sections: [
    { title: 'First', startLine: 1, endLine: 2, pseudocode: 'Return 1.', lineMap: [{ pseudocodeLine: 1, startLine: 2, endLine: 2 }] },
    { title: 'Second', startLine: 4, endLine: 5, pseudocode: 'Return 2.', lineMap: [{ pseudocodeLine: 1, startLine: 5, endLine: 5 }] }
  ] };
  const shifted = analyzeSource(old, currentSnapshot(old, '\n' + text), value);
  assert.deepEqual(shifted.staleBlocks, []);
  assert.equal(shifted.value.sections[1].startLine, 5);
  assert.equal(shifted.value.sections[1].lineMap[0].startLine, 6);
  const changed = analyzeSource(old, currentSnapshot(old, text.replace('return 1', 'return 10')), value);
  assert.deepEqual(changed.staleBlocks, [0]);
  assert.equal(changed.value.sections[1].pseudocode, value.sections[1].pseudocode);
  assert.equal(changed.value.sections[0].lineMap.length, 0);
  const calling = { ...old, text: text.replace('return 2', 'return a()'), fullText: text.replace('return 2', 'return a()') };
  const caller = analyzeSource(calling, currentSnapshot(calling, calling.text.replace('return 1', 'return 10')), value);
  assert.deepEqual(caller.staleBlocks, [0, 1]);
  const global = analyzeSource(old, currentSnapshot(old, 'import changed\n' + text), value);
  assert.equal(global.shared, true); assert.deepEqual(global.staleBlocks, [0, 1]);
  assert.deepEqual(dependencyBlocks(calling, value, 'a'), [0, 1]);
  assert.equal(linePlan('a\r\nb\r\n', 'a\nb\n').changed.length, 0);
  const selected = { ...old, selected: true, startLine: 4, endLine: 5, text: 'def b():\n    return 2' };
  const moved = currentSnapshot(selected, '\n' + text);
  assert.equal(moved.startLine, 5); assert.equal(moved.text, selected.text);
});

test('local cache retains every version, provenance and drafts with atomic latest pointers', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const { LocalCache } = require('./cache');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-durable-cache-'));
  try {
    const store = new LocalCache(root), opts = { provider: 'codex', level: 'logic', model: '', effort: 'low' };
    const snapshots = Array.from({ length: 105 }, (_, index) => ({ ...source, text: 'x = ' + index + '\nprint(x)', fullHash: 'source-' + index, fullText: 'x = ' + index + '\nprint(x)', stamp: { modifiedAt: index, size: 20 } }));
    await Promise.all(snapshots.map((snapshot, index) => store.save(snapshot, opts, valid, require('./engine').hash('version-' + index), { staleBlocks: index === 104 ? [0] : [] })));
    const records = (await fs.readdir(root)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    assert.equal(records.length, 105, 'old explanations are not automatically pruned');
    const latest = await new LocalCache(root).latest(snapshots.at(-1), opts);
    assert.equal(latest.meta.source.fullHash, 'source-104'); assert.deepEqual(latest.meta.staleBlocks, [0]);
    const scope = store.draftScope(source, opts), row = { key: 'draft', draft: 'A local draft', instruction: 'Keep my idea', editorState: { doc: 'A local draft', selection: { ranges: [{ anchor: 3, head: 3 }], main: 0 } } };
    await store.saveDrafts(scope, [row]);
    assert.deepEqual(await new LocalCache(root).drafts(scope), [row]);
    assert.equal((await fs.readdir(root)).filter(name => name.endsWith('.tmp')).length, 0);
    await assert.rejects(new LocalCache(path.join(root, records[0])).save(source, opts, valid, 'a'.repeat(64)), /ENOTDIR|EEXIST/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CodeMirror text, selection and undo history survive a local JSON round trip', () => {
  const fs = require('node:fs'), path = require('node:path');
  const sandbox = { document: { documentElement: { style: {} } }, window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'editor.min.js'), 'utf8'), sandbox);
  const cm = sandbox.YamoriCodeMirror;
  const extensions = [cm.history(), cm.EditorState.transactionFilter.of(cleanEmphasis)];
  let current = cm.EditorState.create({ doc: 'Return the count.', extensions });
  current = current.update({ changes: { from: 7, insert: 'all of ' }, selection: { anchor: 14 }, userEvent: 'input.type' }).state;
  const saved = JSON.parse(JSON.stringify(current.toJSON({ history: cm.historyField })));
  current = cm.EditorState.fromJSON(saved, { extensions }, { history: cm.historyField });
  assert.equal(current.doc.toString(), 'Return all of the count.'); assert.equal(current.selection.main.head, 14);
  const view = { get state() { return current; }, dispatch(transaction) { current = transaction.state; } };
  assert.equal(cm.historyKeymap.find(binding => binding.key === 'Mod-z').run(view), true);
  assert.equal(current.doc.toString(), 'Return the count.');
});

test('source refresh prompt updates the cached explanation and treats new source as authoritative', () => {
  const { refreshPrompt } = require('./engine');
  const prompt = refreshPrompt(source, 'logic', { previous: valid, index: 0, staleBlocks: [0], changedRanges: [{ oldStart: 10, newStart: 10 }] });
  assert.match(prompt, /INCREMENTAL SOURCE REFRESH/); assert.match(prompt, /Current source is authoritative/);
  assert.match(prompt, /Do not rewrite neighboring blocks/); assert.ok(prompt.includes(valid.sections[0].pseudocode.replace(/\n/g, '\\n')));
  assert.match(prompt, /H\(B \| X, K\)/);
});

test('disk changes, selective refresh, durable drafts and offline restarts reuse cached explanations', async () => {
  const fs = require('node:fs/promises'), fsSync = require('node:fs'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-sync-workflow-')), file = path.join(temp, 'code.py');
  await fs.writeFile(file, 'def a():\n    return 10\n\ndef b():\n    return 2\n');
  const commands = new Map(), settings = new Map([['provider', 'codex']]), panels = [], watchers = [], requests = [];
  let change, releaseGeneration, generationStarted, deferGeneration = false;
  class Uri { constructor(value) { this.value = value; this.scheme = 'file'; this.fsPath = require('node:url').fileURLToPath(value); } toString() { return this.value; } static parse(value) { return new Uri(value); } }
  class Range { constructor(a,b,c,d) { this.start={line:a,character:b};this.end={line:c,character:d}; } }
  class Selection extends Range { get isEmpty() { return this.start.line===this.end.line&&this.start.character===this.end.character; } }
  const uri = new Uri(require('node:url').pathToFileURL(file).href);
  const doc = { uri, languageId: 'python', isDirty: false, get lineCount() { return this.getText().split('\n').length; }, getText() { return fsSync.readFileSync(file,'utf8'); }, lineAt(index) { return { text: this.getText().split('\n')[index] }; } };
  const noop = () => ({ dispose() {} }), editor = { document: doc, viewColumn: 1, selection: new Selection(0,0,0,0), setDecorations() {}, revealRange() {} };
  const api = { Uri, Range, Selection, RelativePattern: class { constructor(base, pattern) { this.base=base;this.pattern=pattern; } }, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One:1,Beside:2 }, TextEditorRevealType: { InCenterIfOutsideViewport:1 },
    commands: { registerCommand(id, fn) { commands.set(id,fn);return noop(); } },
    workspace: { isTrusted:true,textDocuments:[doc],asRelativePath:()=> 'code.py',openTextDocument:async()=>doc,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeTextDocument(fn){change=fn;return noop();},
      createFileSystemWatcher(pattern) { const watcher={pattern,onDidChange(fn){watcher.change=fn;return noop();},onDidCreate(fn){watcher.create=fn;return noop();},onDidDelete(fn){watcher.delete=fn;return noop();},dispose(){watcher.disposed=true;}};watchers.push(watcher);return watcher; } },
    window: { activeTextEditor:editor,visibleTextEditors:[editor],createStatusBarItem:statusItem,createTextEditorDecorationType:noop,onDidChangeActiveTextEditor:noop,showTextDocument:async()=>editor,showErrorMessage(message){throw new Error(message);},setStatusBarMessage(){},
      createWebviewPanel(){const panel={messages:[],reveal(){},onDidDispose(fn){panel.closed=fn;return noop();},dispose(){if(!panel.disposed){panel.disposed=true;panel.closed?.();}},webview:{postMessage(message){panel.messages.push(structuredClone(message));},onDidReceiveMessage(fn){panel.receive=fn;return noop();}}};panels.push(panel);return panel;} },env:{clipboard:{writeText:async()=>{}}} };
  const engine = { ...require('./engine'), generate: async opts => {
    requests.push(opts);
    if (deferGeneration) await new Promise(resolve => { releaseGeneration = resolve; generationStarted = true; });
    const make = () => ({title:'Two ideas',summary:'Read two return values.',sections:[
      {title:'First',startLine:1,endLine:2,pseudocode:'Return '+/return (\d+)/.exec(doc.getText())[1]+'.',lineMap:[{pseudocodeLine:1,startLine:2,endLine:2}]},
      {title:'Second',startLine:4,endLine:5,pseudocode:'Return 2.',lineMap:[{pseudocodeLine:1,startLine:5,endLine:5}]}
    ]});
    const value=make();
    if(Number.isInteger(opts.sourceRefresh?.index)){const index=opts.sourceRefresh.index;value.sections=[{...value.sections[index],startLine:opts.source.startLine,endLine:opts.source.endLine}];}
    else value.views={overview:make()};
    return {...value,requestedModel:opts.model,requestedEffort:opts.effort,model:'fixture'};
  } };
  const stub={exports:{}}, context={subscriptions:[],globalStorageUri:{fsPath:path.join(temp,'storage')},globalState:{get:(key,fallback)=>settings.get(key)??fallback,update:async(key,value)=>settings.set(key,value)},secrets:{}};
  const wait = async condition => { for(let n=0;n<200;n++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Timed out waiting for source check'); };
  const state = () => panels.at(-1).messages.filter(message=>message.type==='state').at(-1).state;
  const stop = async () => { await Promise.all(context.subscriptions.splice(0).map(item=>item.dispose?.())); };
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname,'extension.js'),'utf8'),{module:stub,require:id=>id==='vscode'?api:id==='./engine'?engine:require(id),Buffer,AbortController,setTimeout,clearTimeout});
    await stub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(requests.length,1); assert.ok(state().cacheSavedAt); assert.ok(watchers.length);
    assert.equal(typeof state().draftScope,'string');
    const originalDate=await fs.stat(file);
    await fs.writeFile(file,doc.getText().replace('return 10','return 11')); await fs.utimes(file,originalDate.atime,originalDate.mtime);
    watchers.at(-1).change(uri); await wait(()=>state().stale);
    assert.deepEqual(state().staleBlocks,[0],'same-size content changes are detected even with a restored timestamp');
    assert.equal(requests.length,1,'file changes never start inference');
    const neighbor=JSON.stringify(state().result.sections[1]);
    await panels.at(-1).receive({type:'refreshBlock',index:0,documentKey:state().documentKey});
    assert.equal(requests.length,2); assert.equal(requests.at(-1).sourceRefresh.previous.sections[0].pseudocode,'Return 10.');
    assert.equal(requests.at(-1).source.text,'def a():\n    return 11','only the selected current block is sent as primary source');
    assert.equal(state().result.sections[0].pseudocode,'Return 11.'); assert.equal(JSON.stringify(state().result.sections[1]),neighbor); assert.equal(state().stale,false);
    const draft={type:'saveDraft',scope:state().draftScope,key:state().draftScope+':'+state().draftKeys[0],title:'First',index:0,draft:'My persistent draft.',instruction:'Keep this idea',baseText:'Return 11.',editorState:{doc:'My persistent draft.',selection:{ranges:[{anchor:3,head:3}],main:0}},version:'1'};
    await panels.at(-1).receive(draft);
    assert.ok(panels.at(-1).messages.some(message=>message.type==='draftSaved'));
    await stop(); const count=requests.length;
    await stub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(requests.length,count,'restarting uses the complete local cache');
    assert.equal(state().drafts[0].draft,draft.draft); assert.equal(state().drafts[0].editorState.selection.ranges[0].head,3);
    await stop(); await fs.writeFile(file,doc.getText().replace('return 11','return 12'));
    await stub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(requests.length,count,'an offline Git-style edit opens the cached explanation with a warning');
    assert.equal(state().result.sections[0].pseudocode,'Return 11.'); assert.deepEqual(state().staleBlocks,[0]);
    await panels.at(-1).receive({type:'refresh'});
    assert.equal(state().result.sections[0].pseudocode,'Return 12.'); assert.equal(state().stale,false);
    assert.equal(requests.at(-1).sourceRefresh.previous.sections[0].pseudocode,'Return 11.','whole refresh is grounded in the cached version');
    const beforeTouch=requests.length; await fs.utimes(file,new Date(),new Date(Date.now()+1000)); watchers.at(-1).change(uri);
    await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(state().stale,false);assert.equal(requests.length,beforeTouch,'timestamp-only changes need no model request');
    await fs.unlink(file);watchers.at(-1).delete(uri);await wait(()=>state().sourceMissing);
    assert.equal(state().result.sections[0].pseudocode,'Return 12.','deleting a file retains its cached explanation');
    await fs.writeFile(file,'def a():\n    return 12\n\ndef b():\n    return 2\n');watchers.at(-1).create(uri);
    await wait(()=>!state().sourceMissing);assert.equal(state().stale,false,'a temporary Git delete/recreate does not invalidate identical code');
    await fs.writeFile(file,doc.getText().replace('return 12','return 13'));watchers.at(-1).change(uri);await wait(()=>state().stale);
    deferGeneration=true;
    const refresh=panels.at(-1).receive({type:'refresh'});await wait(()=>generationStarted);
    await fs.writeFile(file,doc.getText().replace('return 13','return 14'));watchers.at(-1).change(uri);await wait(()=>!state().busy);
    releaseGeneration();await refresh;
    assert.equal(state().result.sections[0].pseudocode,'Return 12.','a late result cannot replace the cache after another source edit');
    assert.equal(state().stale,true);deferGeneration=false;
    await panels.at(-1).receive({type:'refresh'});assert.equal(state().result.sections[0].pseudocode,'Return 14.');
    await fs.writeFile(file,doc.getText().replace('return 14','return 15'));watchers.at(-1).change(uri);await wait(()=>state().stale);
    await fs.rename(path.join(temp,'storage/cache/revisions'),path.join(temp,'storage/cache/revisions-old'));
    await fs.writeFile(path.join(temp,'storage/cache/revisions'),'blocked directory');
    await panels.at(-1).receive({type:'refresh'});
    assert.match(state().cacheWarning,/revision could not be saved/);
    assert.equal(state().result.sections[0].pseudocode,'Return 14.','a failed revision save keeps the last cached result visible');
    assert.equal(state().stale,true);
  } finally { await stop();await fs.rm(temp,{recursive:true,force:true}); }
});

test('a batched source refresh returns only changed blocks and merges untouched cached text exactly', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'yamori-patch-provider-'));
  const previous = { ...valid, sections: [
    { title:'Set',startLine:10,endLine:10,pseudocode:'Set x to 1.',lineMap:[{pseudocodeLine:1,startLine:10,endLine:10}] },
    { title:'Print',startLine:11,endLine:11,pseudocode:'Print the **current value**.\n\n# Why: Keep this useful cached note.',lineMap:[{pseudocodeLine:1,startLine:11,endLine:11},{pseudocodeLine:3,startLine:11,endLine:11}] }
  ] };
  const binary = path.join(temp,'provider.js');
  try {
    const reply = {title:previous.title,summary:previous.summary,sections:[{...previous.sections[0],index:0,pseudocode:'Set x to 2.'}]};
    await fs.writeFile(binary, 'const fs=require("node:fs"),a=process.argv.slice(2),schema=JSON.parse(fs.readFileSync(a[a.indexOf("--output-schema")+1],"utf8"));'+
      'if(schema.properties.views||schema.properties.sections.maxItems!==1||schema.properties.sections.items.properties.index.enum[0]!==0)process.exit(3);'+
      'let prompt="";process.stdin.on("data",c=>prompt+=c);process.stdin.on("end",()=>{if(!prompt.includes("CACHED DOCUMENT DATA")||!prompt.includes("Keep this useful cached note"))process.exit(4);const reply='+JSON.stringify(reply)+';if(a.includes("bad"))reply.sections[0].index=1;fs.writeFileSync(a[a.indexOf("--output-last-message")+1],JSON.stringify(reply))});');
    const options={source:{...source,text:'x = 2\nprint(x)'},level:'logic',provider:'codex',cliPath:binary,sourceRefresh:{previous,patch:true,staleBlocks:[0]}};
    const value=await generate(options);
    assert.equal(value.sections[0].pseudocode,'Set x to 2.'); assert.deepEqual(value.sections[1],previous.sections[1]);
    assert.equal(value.views,undefined,'other levels are refreshed lazily from the new cached revision');
    await assert.rejects(generate({...options,model:'bad'}),/unexpected block patch/);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
});

 test('deleted selections are not silently remapped to unrelated code', () => {
  const { currentSnapshot } = require('./cache');
  const previous={selected:true,startLine:1,endLine:2,text:'def gone():\n    return 1',fullText:'def gone():\n    return 1\n\ndef keep():\n    return 2'};
  assert.equal(currentSnapshot(previous,'\ndef keep():\n    return 2').selectionMappingUnknown,true);
});

test('difficulty selection validates scope and allows skipping straightforward code', () => {
  const { parseSelection, selectionPrompt } = require('./engine');
  assert.deepEqual(parseSelection('{"blocks":[]}', valid, [0]), []);
  assert.deepEqual(parseSelection('{"blocks":[{"index":0,"reason":"A non-obvious identity."}]}',valid,[0]),[0]);
  for (const blocks of [[{index:1,reason:'Outside scope'}],[{index:0,reason:'A'},{index:0,reason:'B'}],[{index:0,reason:''}]]) assert.throws(()=>parseSelection(JSON.stringify({blocks}),valid,[0]));
  assert.match(selectionPrompt('task',valid,[0]),/Short code can still have a difficult mathematical idea/);
});
test('two independent reviewers run concurrently and refinement keeps the lowest faithful objective', async () => {
  const { refineExplanation, parseResult } = require('./engine');
  let active=0, peak=0; const revised=[];
  const result=await refineExplanation({initial:{...valid,round:0},steps:2,
    evaluate:async(candidate,role)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;return {score:candidate.round===0?6:candidate.round===1?2:0,faithful:candidate.round!==2,issues:candidate.round===1?[{problem:'Still worth checking.'}]:[]};},
    revise:async(candidate,reports,step)=>{revised.push(candidate.round);return {...candidate,round:step};}
  });
  assert.equal(peak,2,'both evaluator requests are in flight together');
  assert.deepEqual(revised,[0,1]);assert.equal(result.round,1);assert.equal(result.refinement.acceptedStep,1);
  assert.equal(result.refinement.initialObjective,9);assert.equal(result.refinement.finalObjective,3);
  assert.equal(result.refinement.history[2].accepted,false,'a zero-cost but unfaithful answer is rejected');
  assert.deepEqual(parseResult(JSON.stringify(result),source).refinement,result.refinement,'public audit metrics survive cache parsing');
});
test('fidelity repairs take priority over cheap scores and unresolved errors are withheld',async()=>{
  const { refineExplanation }=require('./engine');
  const options={initial:{...valid,fixed:false},steps:1,evaluate:async value=>({score:value.fixed?7:0,faithful:value.fixed,issues:[]}),revise:async value=>({...value,fixed:true})};
  const result=await refineExplanation(options);assert.equal(result.fixed,true);
  await assert.rejects(refineExplanation({...options,revise:async value=>value}),/unresolved fidelity/);
});
test('review failures retain only an already reviewed draft; cancellation stops both reviewers',async()=>{
  const { refineExplanation }=require('./engine');
  const retained=await refineExplanation({initial:valid,steps:2,evaluate:async()=>({score:3,faithful:true,issues:[]}),revise:async()=>{throw new Error('quota reached');}});
  assert.equal(retained.sections,valid.sections);assert.match(retained.refinement.warning,/quota reached/);assert.equal(retained.refinement.stepsCompleted,0);
  const controller=new AbortController();let started=0,stopped=0;
  const work=refineExplanation({initial:valid,steps:2,signal:controller.signal,evaluate:async(value,role,step,signal)=>{started++;return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{stopped++;reject(new Error('Cancelled.'));},{once:true});});},revise:async()=>{throw new Error('Must not revise');}});
  await new Promise(r=>setImmediate(r));assert.equal(started,2);controller.abort();await assert.rejects(work,/Cancelled/);assert.equal(stopped,2);
  const failed=refineExplanation({initial:valid,steps:1,evaluate:async(value,role,step,signal)=>{if(role==='entropy')throw new Error('review failed');return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('stopped sibling')),{once:true}));},revise:async()=>valid});
  await assert.rejects(failed,/review failed/);
});
test('review feedback uses valid block references and rejects invented entropy measurements',()=>{
  const { parseReview }=require('./engine');
  const review={score:3,faithful:true,issues:[{section:0,view:'main',severity:'critical',problem:'Wrong computation',suggestion:'Keep the sign.'}]};
  assert.equal(parseReview(JSON.stringify(review),valid).faithful,false);
  for (const changed of [{score:NaN},{score:11},{faithful:'yes'},{issues:[{...review.issues[0],section:3}]},{issues:[{...review.issues[0],view:'unknown'}]}]) assert.throws(()=>parseReview(JSON.stringify({...review,...changed}),valid));
});

test('provider pipeline selects difficult blocks, refines only them, and leaves easy sections byte-identical',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-select-refine-')),cli=path.join(temp,'fixture.cjs'),log=path.join(temp,'calls.jsonl');
  const input={uri:'file:///hard.py',name:'hard.py',language:'python',startLine:1,text:'def easy():\n    return 1\n\ndef hard(n, d):\n    return (n + d) / 2'};
  const base={title:'Two ideas',summary:'Return a constant and recover a count.',sections:[{title:'Return a constant',startLine:1,endLine:2,pseudocode:'Return 1.',lineMap:[]},{title:'Recover matches',startLine:4,endLine:5,pseudocode:'Compute the count.',lineMap:[]}]};
  const program=String.raw`
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),log=path.join(__dirname,'calls.jsonl');
const original=BASE;
let mode=args.includes('--model')?args[args.indexOf('--model')+1]:'hard';
function respond(prompt,schema){
 let value,type;
 if(schema.properties.blocks){type='selector';value={blocks:mode==='skip'?[]:[{index:1,reason:'The count identity needs a short derivation.'}]};}
 else if(schema.properties.score){
  type=prompt.includes('independent remaining-uncertainty')?'entropy':'readCost';
  if(JSON.stringify(schema.properties.issues.items.properties.view.enum)!=='[\"main\"]'||JSON.stringify(schema.properties.issues.items.properties.section.enum)!=='[-1,0]')throw new Error('Review schema allows absent references');
  const match=prompt.match(/CANDIDATE EXPLANATION DATA: ([\s\S]*)\nReturn the review JSON only\./),candidate=JSON.parse(match[1]);
  if(candidate.sections.length!==1||candidate.sections[0].title!=='Recover matches')throw new Error('Reviewer received an easy section');
  const improved=candidate.sections[0].pseudocode.includes('Let m');value={score:improved?2:7,faithful:true,issues:improved?[]:[{section:0,view:'main',severity:'major',problem:'The count identity is unexplained.',suggestion:'Define matches and derive the identity.'}]};
  if(type==='entropy' && (mode==='always-bad-reference' || mode==='bad-reference'&&!improved&&!prompt.includes('REVIEW FORMAT REPAIR')))value.issues=[{section:42,view:'logic',severity:'major',problem:'The count identity is unexplained.',suggestion:'Define its terms.'}];
  if(mode==='fidelity-failure'){value.faithful=false;value.issues=[{section:0,view:'main',severity:'critical',problem:'The claimed behavior is wrong.',suggestion:'Fix the claim.'}];}
 }else if(prompt.includes('REFINEMENT PASS')){
  type='revision';if(schema.properties.sections.maxItems!==1||schema.properties.views)throw new Error('Wrong scoped schema');
  value={...original,sections:[{...original.sections[1],pseudocode:'Let m count matching nonzero signs.\nTheir signed sum is d = 2m − n.\nRecover m = (n + d) / 2.'}]};
  if(mode==='boundary')value.sections[0].startLine=1;
 }else{type='initial';value={...original,views:{overview:original}};}
 fs.appendFileSync(log,JSON.stringify({type,model:mode,promptLength:prompt.length})+'\n');return value;
}
if(args.includes('--help')){process.stdout.write('--safe-mode');process.exit(0);}
if(args[0]==='app-server'){
 const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===1)out({id:1,result:{}});if(q.id===2){mode=q.params.model||'hard';out({id:2,result:{thread:{id:'test'},model:mode}});}if(q.id===3){const text=JSON.stringify(respond(q.params.input[0].text,q.params.outputSchema));out({method:'item/agentMessage/delta',params:{delta:text}});out({method:'turn/completed',params:{turn:{status:'completed'}}});}});
}else{let prompt='';process.stdin.on('data',data=>prompt+=data);process.stdin.on('end',()=>{if(args.includes('--json-schema')){const schema=JSON.parse(args[args.indexOf('--json-schema')+1]);process.stdout.write(JSON.stringify({structured_output:respond(prompt,schema),modelUsage:{'fixture-claude':{}}}));}else{const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(respond(prompt,schema)));}});}
`.replace('BASE',JSON.stringify(base));
  try{
    await fs.writeFile(cli,program);const phases=[];
    const value=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'hard',refinementSteps:2,onProgress:update=>{phases.push(update);}});
    assert.deepEqual(value.sections[0],base.sections[0]);assert.match(value.sections[1].pseudocode,/Let m/);
    assert.deepEqual(value.refinement.selectedBlocks,[1]);assert.equal(value.refinement.stepsCompleted,1);assert.equal(value.refinement.acceptedStep,1);
    assert.equal(value.views,undefined,'old companion summaries are not silently reused after refinement');
    assert.ok(phases.some(update=>update.preview?.draftComplete),'a complete first draft is readable before review finishes');
    assert.ok(phases.findIndex(update=>update.preview?.draftComplete)<phases.findIndex(update=>update.phase==='Selecting the most difficult blocks'));
    assert.deepEqual(parseResult(JSON.stringify(value),input).refinement,value.refinement);
    let calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length,7,'a clear revised draft stops before spending another refinement pass');
    assert.ok(calls.filter(row=>row.type!=='initial').every(row=>row.promptLength<calls[0].promptLength),'selection, review and revision prompts omit the repeated full writing guide');assert.deepEqual(calls.slice(0,2).map(row=>row.type),['initial','selector']);
    await fs.writeFile(log,'');
    const skipped=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'skip',refinementSteps:2});
    assert.equal(skipped.refinement.status,'skipped');assert.deepEqual(skipped.refinement.selectedBlocks,[]);assert.ok(skipped.views.overview);
    calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(row=>row.type),['initial','selector'],'easy code makes no evaluator/revision calls');
    await fs.writeFile(log,'');
    const bounded=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'boundary',refinementSteps:1});
    assert.equal(bounded.sections[1].pseudocode,'Compute the count.');assert.match(bounded.refinement.warning,/boundaries/);
    await fs.writeFile(log,'');
    const claude=await generate({source:input,level:'logic',provider:'claude',cliPath:cli,model:'hard',refinementSteps:1});
    assert.equal(claude.refinement.stepsCompleted,1);assert.deepEqual(claude.sections[0],base.sections[0]);assert.equal(claude.model,'fixture-claude');
    await fs.writeFile(log,'');
    const fast=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'hard',refinementSteps:0});
    assert.equal(fast.refinement,undefined);calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls.map(row=>row.type),['initial']);
    await fs.writeFile(log,'');const repairPhases=[];
    const repaired=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'bad-reference',refinementSteps:1,onProgress:update=>repairPhases.push(update.phase)});
    assert.equal(repaired.refinement.status,'reviewed');assert.ok(repairPhases.some(phase=>phase.includes('Repairing uncertainty')));
    calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(row=>row.type==='entropy').length,3,'only the malformed evaluator is retried once');assert.equal(calls.filter(row=>row.type==='readCost').length,2,'the valid evaluator is not rerun for a sibling format repair');
    await fs.writeFile(log,'');
    const unreviewed=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'always-bad-reference',refinementSteps:1});
    assert.equal(unreviewed.refinement.status,'incomplete');assert.equal(unreviewed.refinement.faithful,undefined);assert.equal(unreviewed.sections[1].pseudocode,'Compute the count.');assert.match(unreviewed.refinement.warning,/has not passed both evaluator checks/);
    assert.equal(unreviewed.views.overview.refinement.status,'incomplete','companion views do not hide incomplete review');
    const {LocalCache,}=require('./cache'),disk=new LocalCache(path.join(temp,'cache')),opts={provider:'codex',level:'logic',model:'always-bad-reference',effort:'low',refinementSteps:1};
    await disk.save(input,opts,unreviewed,require('./engine').hash('incomplete-draft'));
    const restored=await disk.latest(input,opts);assert.equal(restored.value.refinement.status,'incomplete');assert.equal(restored.value.sections[1].pseudocode,unreviewed.sections[1].pseudocode);
    await fs.writeFile(log,'');
    const resumed=await generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'hard',refinementSteps:1,initialDraft:restored.value,sourceRefresh:{previous:restored.value,staleBlocks:[],changedRanges:[]}});
    assert.equal(resumed.refinement.status,'reviewed');calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(calls.every(row=>row.type!=='initial'),'retrying review reuses the cached draft without another generation');
    await assert.rejects(generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'fidelity-failure',refinementSteps:1}),error=>error.code==='YAMORI_FIDELITY','known fidelity failures are not downgraded to a successful draft');
    await fs.writeFile(log,'');const stopped=new AbortController();
    await assert.rejects(generate({source:input,level:'logic',provider:'codex',cliPath:cli,model:'hard',refinementSteps:1,signal:stopped.signal,onProgress:update=>{if(update.phase.startsWith('Review 0/'))stopped.abort();}}),/Cancelled/);
    calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.ok(calls.every(row=>!['entropy','readCost'].includes(row.type)),'cancelling at review start prevents both evaluator calls');

  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('refinement policies have separate caches while old cached files remain readable without inference',async()=>{
  const {LocalCache}=require('./cache'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-refinement-policy-'));
  try{
    const cache=new LocalCache(temp),opts={provider:'codex',level:'logic',effort:'low',refinementSteps:0},key=hashForTest('legacy');
    await cache.save(source,opts,valid,key);
    assert.notEqual(cache.variant(source,opts),cache.variant(source,{...opts,refinementSteps:2}));
    assert.equal(await cache.latest(source,{...opts,refinementSteps:2}),undefined);
    const legacy=await cache.latest(source,{...opts,refinementSteps:2},true);assert.equal(legacy.value.sections[0].pseudocode,valid.sections[0].pseudocode);
    assert.equal(legacy.meta.opts.refinementSteps,0,'legacy output is never relabeled as reviewed');
    const skipped={...valid,refinement:{version:1,status:'skipped',stepsRequested:2,stepsCompleted:0,selectedBlocks:[]}};
    await cache.save(source,{...opts,refinementSteps:2},skipped,hashForTest('selected-none'));
    assert.equal((await cache.latest(source,{...opts,refinementSteps:2},true)).value.refinement.status,'skipped');
  }finally{await fs.rm(temp,{recursive:true,force:true});}
  function hashForTest(value){return require('./engine').hash(value);}
});

test('Restricted Mode ignores workspace executable paths and cost settings',()=>{
  const {setting}=extensionForTest();let gets=0;
  const config={get(){gets++;return '/project/evil-cli';},inspect(name){return name==='codexPath'?{globalValue:'/user/installed/codex',workspaceValue:'/project/evil-cli'}:{globalValue:0,workspaceValue:5,defaultValue:2};}};
  const api={workspace:{isTrusted:false,getConfiguration:()=>config}};
  assert.equal(setting(api,'codexPath'),'/user/installed/codex');assert.equal(setting(api,'refinementSteps',2),0);assert.equal(gets,0);
  api.workspace.getConfiguration=()=>({get:config.get,inspect:()=>({workspaceValue:'/project/evil-cli'})});
  assert.equal(setting(api,'codexPath'),'','workspace-only CLI settings are ignored');
  api.workspace.isTrusted=true;assert.equal(setting(api,'codexPath'),'/project/evil-cli','normal VS Code settings remain available in trusted folders');
  function extensionForTest(){const module={exports:{}};vm.runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'extension.js'),'utf8'),{module,require:id=>id==='vscode'?{}:require(id),Buffer,AbortController,setTimeout,clearTimeout});return module.exports;}
});
test('Restricted Mode does not invoke project definition providers or reuse their cached definitions',async()=>{
  const api={workspace:{isTrusted:false},commands:{executeCommand(){throw new Error('Must not invoke project tooling');}}};
  const snapshot={...source,callContext:{definitions:[{uri:'file:///project/helper.ts',text:'unsafe external context'}]}};
  const result=await requireExtension().collectCallContext(snapshot,api);
  assert.equal(result.text,snapshot.text);assert.deepEqual(Array.from(result.callContext.definitions),[]);assert.match(result.callContext.note,/Restricted Mode/);
  await assert.rejects(findCLI('codex','./project/cli',{platform:'darwin',env:{PATH:'.:node_modules/.bin'},home:'/user',fs:{stat:async()=>({isFile:()=>true}),access:async()=>{}}}),/absolute path/);
  function requireExtension(){const module={exports:{}};vm.runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'extension.js'),'utf8'),{module,require:id=>id==='vscode'?{}:require(id),Buffer,AbortController,setTimeout,clearTimeout});return module.exports;}
});

test('first use chooses an installed provider without overwriting an explicit preference',async()=>{
  const module={exports:{}};vm.runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'extension.js'),'utf8'),{module,require:id=>id==='vscode'?{}:require(id),Buffer,AbortController,setTimeout,clearTimeout});
  const {chooseInstalledProvider}=module.exports;const values=new Map(),context={globalState:{get:key=>values.get(key),update:async(key,value)=>values.set(key,value)}};
  const api={workspace:{isTrusted:false,getConfiguration:()=>({get:()=>'/project/evil',inspect:()=>undefined})}};
  const calls=[];await chooseInstalledProvider(context,api,async(owner,configured)=>{calls.push(owner);assert.equal(configured,'');if(owner==='codex')throw new Error('not installed');return '/user/claude';});
  assert.equal(values.get('provider'),'claude');assert.deepEqual(calls,['codex','claude']);
  await chooseInstalledProvider(context,api,async()=>{throw new Error('An explicit choice must skip detection');});assert.equal(values.get('provider'),'claude');
});

test('satisfied reviewers skip redundant writer and re-review calls',async()=>{
  const {refineExplanation}=require('./engine');let reviews=0,revisions=0;
  const result=await refineExplanation({initial:valid,steps:5,evaluate:async()=>{reviews++;return {score:1,faithful:true,issues:[]};},revise:async()=>{revisions++;throw new Error('Must not revise an already clear candidate');}});
  assert.equal(reviews,2);assert.equal(revisions,0);assert.equal(result.refinement.stepsCompleted,0);assert.equal(result.refinement.stepsRequested,5);
});
test('refinement stops after a plateau instead of spending every remaining pass',async()=>{
  const {refineExplanation}=require('./engine');let reviews=0,revisions=0;
  const result=await refineExplanation({initial:valid,steps:5,evaluate:async()=>{reviews++;return {score:5,faithful:true,issues:[]};},revise:async candidate=>{revisions++;return candidate;}});
  assert.equal(reviews,4);assert.equal(revisions,1);assert.equal(result.refinement.stepsCompleted,1);assert.equal(result.refinement.acceptedStep,0);
});
test('compact refinement context retains source numbering, user intent and definition uncertainty',()=>{
  const {refinementContext}=require('./engine');
  const context=refinementContext(source,'logic',{edit:{instruction:'Propose doubling it',draft:'Return twice the value.',section:valid.sections[0]}});
  assert.match(context,/10: x = 1\n11: print\(x\)/);assert.match(context,/Propose doubling it/);assert.match(context,/source is unchanged/);assert.match(context,/untrusted data/);assert.match(context,/unknown custom behavior/);
  assert.ok(context.length<promptFor(source,'logic').length/2,'the evaluator context excludes the long writing guide and illustrative examples');
});

test('review schemas expose only available targets and normalize only a known detail alias',()=>{
  const {reviewSchema,parseReview}=require('./engine'),schema=reviewSchema(valid),item=schema.properties.issues.items;
  assert.deepEqual(item.properties.view.enum,['main']);assert.deepEqual(item.properties.section.enum,[-1,0]);assert.equal(item.properties.problem.maxLength,2000);
  const feedback={score:3,faithful:true,issues:[{view:'logic',section:0,severity:'critical',problem:'Wrong behavior.',suggestion:'Fix it.'}]};
  const parsed=parseReview(JSON.stringify(feedback),valid,{level:'logic'});assert.equal(parsed.issues[0].view,'main');assert.equal(parsed.faithful,false,'normalizing an alias never clears a critical fidelity objection');
  assert.throws(()=>parseReview(JSON.stringify({...feedback,issues:[{...feedback.issues[0],section:1}]}),valid,{level:'logic'}),error=>error.code==='YAMORI_REVIEW_FORMAT','one-based or original indices are not guessed');
  assert.throws(()=>parseReview(JSON.stringify({...feedback,issues:[null]}),valid),error=>error.code==='YAMORI_REVIEW_FORMAT');
});
test('a failed repair after a known fidelity rejection retains the hard fidelity error',async()=>{
  const {refineExplanation}=require('./engine');
  await assert.rejects(refineExplanation({initial:valid,steps:1,evaluate:async()=>({score:6,faithful:false,issues:[]}),revise:async()=>{throw new Error('Bad revision references');}}),error=>error.code==='YAMORI_FIDELITY');
});

test('a malformed sibling review cannot hide an already reported fidelity failure',async()=>{
  const {refineExplanation}=require('./engine');
  await assert.rejects(refineExplanation({initial:valid,steps:1,evaluate:async(candidate,role)=>{if(role==='entropy')return {score:8,faithful:false,issues:[]};throw new Error('Malformed feedback references');},revise:async()=>valid}),error=>error.code==='YAMORI_FIDELITY');
});

test('Ajv validators reject wrong types without coercion, defaults or mutation',()=>{
  const validators=require('./validation.min');
  const wrong={score:'2',faithful:'false',issues:[],extra:'keep me'};
  const before=structuredClone(wrong);assert.equal(validators.review(wrong),false);assert.deepEqual(wrong,before);
  assert.equal(validators.review({score:2,issues:[]}),false,'missing fidelity is never defaulted to approval');
  assert.equal(validators.review({score:2,faithful:true,issues:[],extra:'unrecognized'}),false,'review extras are rejected, not silently removed');
  assert.equal(validators.review(Object.create({score:2,faithful:true,issues:[]})),false,'required fields must be owned by the response');
  assert.equal(validators.review({score:2,faithful:true,issues:[]}),true);
});
test('Ajv response errors include field paths while reference checks remain contextual',()=>{
  const {parseReview,parseSelection}=require('./engine');
  assert.throws(()=>parseReview('{"score":"2","faithful":true,"issues":[]}',valid),error=>error.code==='YAMORI_REVIEW_FORMAT'&&error.validation.path==='/score'&&error.validation.keyword==='type');
  assert.throws(()=>parseReview('{"score":2,"faithful":true,"issues":[{"section":0,"view":"main","severity":"major","problem":22,"suggestion":"Define it."}]}',valid),error=>error.validation.path==='/issues/0/problem');
  assert.throws(()=>parseSelection('{"blocks":[{"index":"0","reason":"A derivation."}]}',valid,[0]),error=>error.validation.path==='/blocks/0/index');
  assert.throws(()=>parseReview('{"score":2,"faithful":true,"issues":[{"section":8,"view":"main","severity":"major","problem":"A gap.","suggestion":"Define it."}]}',valid),error=>error.validation.path==='/issues/0/section'&&error.validation.keyword==='reference');
  const old={...valid,_yamori:{source:'legacy metadata'},extra:'ignored metadata'};
  assert.deepEqual(parseResult(JSON.stringify(old),source),valid,'legacy cache metadata and absent line maps stay compatible');
});
test('packaged validators work with no Ajv installation, schema compilation or developer tools',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-validator-runtime-'));
  try{
    await Promise.all(['engine.js','schemas.js','validation.min.js'].map(file=>fs.copyFile(path.join(__dirname,file),path.join(root,file))));
    const script=`const Module=require('node:module'),load=Module._load;Module._load=function(id,...args){if(id==='ajv'||id.startsWith('ajv/')||id==='esbuild')throw new Error('Build-only dependency loaded at runtime');return load.call(this,id,...args);};global.Function=function(){throw new Error('Runtime schema compilation is forbidden');};const {parseResult}=require('./engine');const source=${JSON.stringify(source)},value=${JSON.stringify(valid)};if(parseResult(JSON.stringify(value),source).title!==value.title)process.exit(2);process.stdout.write('Standalone validation works');`;
    const output=await runProcess(process.execPath,['-e',script],'',{cwd:root});assert.equal(output,'Standalone validation works');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('a refined view derived from another level does not invalidate that level again',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-pingpong-'));
  const commands=new Map(),state=new Map([['provider','codex']]),generated=[];let receive;
  class Uri{constructor(v){this.value=v;this.scheme='file';this.fsPath=v.replace('file://','');}toString(){return this.value;}static parse(v){return new Uri(v);}}
  class Range{constructor(a,b,c,d){if(typeof a==='object'){this.start=a;this.end=b;}else{this.start={line:a,character:b};this.end={line:c,character:d};}}}
  class Selection extends Range{get isEmpty(){return this.start.line===this.end.line&&this.start.character===this.end.character;}}
  const text='x = 1\nprint(x)',doc={uri:new Uri('file:///sample.py'),languageId:'python',lineCount:2,getText:()=>text,lineAt:i=>({text:text.split('\n')[i]})};
  const editor={document:doc,selection:new Selection(0,0,0,0),setDecorations(){},revealRange(){}},noop=()=>({dispose(){}});
  const vscode={Uri,Range,Selection,ThemeColor:class{},StatusBarAlignment:{Right:2},ViewColumn:{One:1,Beside:2},TextEditorRevealType:{InCenterIfOutsideViewport:1},
    commands:{registerCommand(id,fn){commands.set(id,fn);return noop();}},
    workspace:{isTrusted:true,textDocuments:[doc],asRelativePath:()=>'sample.py',openTextDocument:async()=>doc,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeTextDocument(){return noop();}},
    window:{createStatusBarItem:statusItem,activeTextEditor:editor,visibleTextEditors:[editor],createTextEditorDecorationType:noop,onDidChangeActiveTextEditor:noop,showTextDocument:async()=>editor,showErrorMessage(m){throw new Error(m);},setStatusBarMessage(){},
      createWebviewPanel:()=>({reveal(){},onDidDispose:noop,webview:{postMessage(){},onDidReceiveMessage(fn){receive=fn;return noop();}}})},
    env:{clipboard:{writeText:async()=>{}}}};
  // Every refinement is accepted, so each generation returns a reviewed draft without companion views.
  const engine={...require('./engine'),generate:async opts=>{generated.push(opts.level+(opts.revision?'<'+opts.revision.level:''));
    return{title:opts.level,summary:'s',sections:[{title:'Block',startLine:1,endLine:2,pseudocode:opts.level+' text',lineMap:[]}],requestedModel:opts.model,requestedEffort:opts.effort,effort:opts.effort,
      refinement:{version:1,stepsRequested:2,stepsCompleted:1,acceptedStep:1,lambda:0.5,initialObjective:6,finalObjective:2,entropy:1,readCost:2,faithful:true,history:[],selectedBlocks:[0],status:'reviewed'}};}};
  const moduleStub={exports:{}},context={subscriptions:[],globalStorageUri:{fsPath:temp},globalState:{get:(k,f)=>state.get(k)??f,update:async(k,v)=>state.set(k,v)},secrets:{}};
  try{
    vm.runInNewContext(await fs.readFile(path.join(__dirname,'extension.js'),'utf8'),{require:id=>id==='vscode'?vscode:id==='./engine'?engine:require(id),module:moduleStub,Buffer,AbortController,setTimeout,clearTimeout});
    await moduleStub.exports.activate(context);await commands.get('yamori.read')();
    for(const level of ['overview','logic','overview','logic'])await receive({type:'level',level});
    assert.deepEqual(generated,['logic','overview<logic'],'returning to a refined level uses its cached result');
  }finally{await Promise.all(context.subscriptions.map(d=>d?.dispose?.()));await fs.rm(temp,{recursive:true,force:true});}
});

// ---- Project map ---------------------------------------------------------------
const projectMap = require('./project');
// A page's own script (the guide also embeds KaTeX in a script before it).
const pageScript = html => [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].map(match => match[1]).find(text => text.includes('acquireVsCodeApi'));
const videoProject = {
  'main.py': '"""Generate a video script."""\nfrom pipeline.plan import plan_loops\nfrom pipeline.write import write_blocks\nfrom models.script import Script\n\ndef main(outline):\n    script = Script.from_outline(outline)\n    return write_blocks(script, plan_loops(script.blocks))\n\nif __name__ == "__main__":\n    main("a")\n',
  'pipeline/__init__.py': '',
  'models/__init__.py': '',
  'models/script.py': 'HOOK = "HOOK"\nENDING = "ENDING"\nBRIDGE = "BRIDGE"\n\nclass Script:\n    def __init__(self, blocks):\n        self.blocks = blocks\n\n    @classmethod\n    def from_outline(cls, outline):\n        return cls([HOOK, outline, ENDING])\n',
  'pipeline/plan.py': 'from models.script import HOOK, ENDING\n\ndef plan_loops(blocks):\n    """Assign loop IDs in opening order."""\n    loops = [{"id": "L1", "open": HOOK, "close": ENDING}]\n    for i, block in enumerate(blocks[1:-1], start=2):\n        loops.append({"id": f"L{i}", "open": block})\n    return loops\n\ndef _loop_hint(loop):\n    return "" if loop["id"] == "L1" else "Open " + loop["id"]\n',
  'pipeline/write.py': 'from .plan import _loop_hint\nfrom models.script import BRIDGE\n\ndef write_blocks(script, loops):\n    return [_loop_hint(loop) for loop in loops] + [BRIDGE]\n',
  'tests/test_plan.py': 'from pipeline.plan import plan_loops\n\ndef test_first_loop():\n    assert plan_loops(["HOOK", "x", "ENDING"])[0]["id"] == "L1"\n'
};
async function scanFixture(files, previous) {
  const scanned = await projectMap.scanFiles(Object.entries(files).map(([rel, text]) => ({ rel, read: async () => text })), previous, new projectMap.Indexer());
  return { ...scanned, graph: projectMap.buildGraph(scanned.records) };
}

test('project indexer extracts definitions, imports and references with bundled tree-sitter grammars', async () => {
  const indexer = new projectMap.Indexer();
  for (const grammar of projectMap.GRAMMARS) {
    const { patterns } = await indexer.language(grammar);
    assert.equal(patterns, projectMap.QUERIES[grammar].length, grammar + ' tag queries all compile');
  }
  const py = await indexer.extract('pipeline/plan.py', videoProject['pipeline/plan.py']);
  assert.deepEqual(py.defs.map(def => def.name + ':' + def.kind), ['plan_loops:function', '_loop_hint:function']);
  assert.deepEqual(py.imports[0], { spec: 'models.script', line: 1, kind: 'module', names: ['HOOK', 'ENDING'] });
  assert.ok(py.refs.some(([name]) => name === 'HOOK'));
  const ts = await indexer.extract('src/app.ts', "import { load } from './data.js';\nexport interface Options { size: number }\nexport const LIMIT = 3;\nexport function run(o: Options) { return load(o.size); }\n");
  assert.deepEqual(ts.defs.map(def => def.name), ['Options', 'LIMIT', 'run']);
  assert.deepEqual(ts.imports.map(imp => [imp.spec, imp.names]), [['./data.js', ['load']]]);
  const fallback = projectMap.regexExtract('lib/util.rb', "require_relative 'helpers'\nMAX_ITEMS = 3\ndef total(items)\n  items.sum\nend\n");
  assert.deepEqual(fallback.defs.map(def => def.name), ['MAX_ITEMS', 'total']);
  assert.equal(fallback.imports[0].spec, 'helpers');
});

test('project imports resolve per language without linking packages outside the project', () => {
  const ctx = projectMap.resolutionContext(['pkg/__init__.py', 'pkg/core.py', 'pkg/sub/__init__.py', 'pkg/sub/tool.py', 'src/app.ts', 'src/data.ts', 'src/lib/index.tsx', 'cmd/main.go', 'internal/plan/plan.go', 'internal/plan/plan_test.go', 'src/main/java/a/c/Thing.java', 'crate/src/main.rs', 'crate/src/plan.rs', 'crate/src/plan/loops.rs'],
    { 'go.mod': 'module example.com/app\n', 'crate/Cargo.toml': '[package]' });
  const resolve = (from, imp) => projectMap.resolveImport(from, { kind: 'module', names: [], ...imp }, ctx);
  assert.deepEqual(resolve('pkg/sub/tool.py', { spec: '..core' }), ['pkg/core.py']);
  assert.deepEqual(resolve('pkg/sub/tool.py', { spec: 'pkg.core' }), ['pkg/core.py']);
  assert.deepEqual(resolve('pkg/core.py', { spec: '.sub', names: ['tool'] }).sort(), ['pkg/sub/__init__.py', 'pkg/sub/tool.py']);
  assert.deepEqual(resolve('pkg/core.py', { spec: 'numpy' }), []);
  assert.deepEqual(resolve('src/app.ts', { spec: './data.js' }), ['src/data.ts']);
  assert.deepEqual(resolve('src/app.ts', { spec: './lib' }), ['src/lib/index.tsx']);
  assert.deepEqual(resolve('src/app.ts', { spec: 'react' }), []);
  assert.deepEqual(resolve('cmd/main.go', { spec: 'example.com/app/internal/plan' }), ['internal/plan/plan.go']);
  assert.deepEqual(resolve('src/main/java/a/c/Thing.java', { spec: 'a.c.Thing' }), []);
  assert.deepEqual(resolve('crate/src/main.rs', { spec: 'plan', kind: 'mod' }), ['crate/src/plan.rs']);
  assert.deepEqual(resolve('crate/src/main.rs', { spec: 'crate::plan::loops::Loop' }), ['crate/src/plan/loops.rs']);
  assert.equal(resolve('pkg/core.py', { spec: '....outside' }).length, 0, 'relative imports cannot leave the project');
});

test('project graph finds the entry point, a top-down reading path and import-backed links', async () => {
  const { graph, skipped } = await scanFixture(videoProject);
  assert.equal(skipped, 2, 'empty package markers are not map nodes');
  assert.deepEqual(graph.entries, ['main.py']);
  assert.deepEqual(graph.readingPath.map(step => step.id), ['main.py', 'pipeline/plan.py', 'pipeline/write.py', 'models/script.py'], 'stages in the order the entry point imports them');
  assert.deepEqual(graph.readingPath[1].names, ['plan_loops']);
  const edge = graph.edges.find(item => item.from === 'pipeline/plan.py' && item.to === 'models/script.py');
  assert.ok(edge.imported); assert.deepEqual(edge.names.slice(0, 2).sort(), ['ENDING', 'HOOK'], 'explicitly imported names lead');
  assert.ok(graph.files['tests/test_plan.py'].test && !graph.files['tests/test_plan.py'].entry);
  assert.ok(!graph.edges.some(item => item.to.startsWith('tests/')), 'tests are never a dependency');
  assert.ok(Math.abs(Object.values(graph.files).reduce((sum, file) => sum + file.rank, 0) - 1) < 1e-3, 'ranks form a distribution');
  assert.ok(graph.files['models/script.py'].rank > graph.files['main.py'].rank, 'shared foundations outrank the entry point');
  // Python files only link through imports; Go packages also link by shared names.
  const noisy = await scanFixture({ 'a.py': 'def helper_value():\n    return 1\n', 'b.py': 'def use():\n    return helper_value()\n' });
  assert.equal(noisy.graph.edges.length, 0, 'a shared name without an import is not a Python dependency');
  const go = await scanFixture({ 'plan/a.go': 'package plan\nfunc OpenLoops() int { return 1 }\n', 'plan/b.go': 'package plan\nfunc Run() int { return OpenLoops() }\n' });
  assert.deepEqual(go.graph.edges.map(item => [item.from, item.to, item.imported]), [['plan/b.go', 'plan/a.go', false]]);
});

test('project rescans reuse unchanged files and parse only edited ones', async () => {
  const first = await scanFixture(videoProject);
  const second = await scanFixture({ ...videoProject, 'pipeline/write.py': videoProject['pipeline/write.py'] + '\nEXTRA = 1\n' }, first.graph);
  assert.equal(second.parsed, 1); assert.equal(second.reused, 4);
  assert.ok(second.graph.files['pipeline/write.py'].defs.some(def => def.name === 'EXTRA'));
  assert.deepEqual(second.graph.files['main.py'], first.graph.files['main.py'], 'reused records are identical');
});

test('project map views lay out layers deterministically and respect moved nodes', async () => {
  const { graph } = await scanFixture(videoProject);
  const view = projectMap.graphView(graph), layout = projectMap.layoutView(view);
  assert.deepEqual(projectMap.layoutView(view), layout, 'layout is deterministic');
  const byId = new Map(layout.nodes.map(node => [node.id, node]));
  assert.ok(byId.get('main.py').y < byId.get('pipeline/plan.py').y && byId.get('pipeline/plan.py').y < byId.get('models/script.py').y, 'users above what they use');
  for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b && a.y === b.y) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, 'nodes in a layer never overlap');
  const moved = projectMap.layoutView(view, { 'main.py': { x: 500, y: -40 } });
  assert.deepEqual([moved.nodes.find(node => node.id === 'main.py').x, moved.nodes.find(node => node.id === 'main.py').y], [500, -40]);
  const folders = projectMap.graphView(graph, { mode: 'folders' });
  assert.deepEqual(folders.nodes.map(node => node.id).sort(), ['folder:(root)', 'folder:models', 'folder:pipeline', 'folder:tests']);
  assert.ok(folders.edges.some(edge => edge.from === 'folder:pipeline' && edge.to === 'folder:models'));
  const focus = projectMap.graphView(graph, { mode: 'folder', folder: 'pipeline' });
  assert.deepEqual(focus.nodes.filter(node => !node.external).map(node => node.id).sort(), ['pipeline/plan.py', 'pipeline/write.py']);
  assert.ok(focus.nodes.some(node => node.external && node.id === 'models/script.py'), 'neighbours outside a folder stay visible');
});

test('project context gives explanations bounded roles and terms without changing old cache keys', async () => {
  const { graph } = await scanFixture(videoProject);
  const notes = { overview: 'Writes retention-focused video scripts.', files: {
    'pipeline/plan.py': { hash: graph.files['pipeline/plan.py'].hash, purpose: 'Plans open loops for each block.', role: 'loop planning', terms: [{ term: 'L1', aliases: ['L2', 'L<n>'], meaning: 'The first loop: opened by the hook and answered only in the ending.', line: 5 }] },
    'models/script.py': { hash: 'old', purpose: 'Defines script sections.', role: 'data model', terms: [{ term: 'HOOK', aliases: [], meaning: 'Opening section that raises the main question.', line: 1 }, { term: 'BRIDGE', aliases: [], meaning: 'Transition speech.', line: 3 }] } } };
  const text = videoProject['pipeline/plan.py'];
  const slice = projectMap.projectContextFor(graph, notes, 'pipeline/plan.py', text);
  assert.equal(slice.file.purpose, 'Plans open loops for each block.'); assert.equal(slice.file.readingStep, 2);
  assert.deepEqual(slice.glossary.map(term => term.term), ['L1', 'HOOK', 'ENDING'], 'own terms, then neighbour terms that appear in the source');
  assert.equal(slice.glossary[1].outdated, true, 'notes for changed files are marked outdated');
  assert.equal(slice.glossary[2].kind, 'constant', 'constants without notes still give a location');
  assert.equal(slice.uses[0].purpose, 'Defines script sections.');
  assert.deepEqual(projectMap.projectContextFor(graph, notes, 'pipeline/plan.py', text), slice, 'the fingerprint is stable');
  const big = { files: Object.fromEntries(Object.keys(graph.files).map(rel => [rel, { hash: graph.files[rel].hash, purpose: 'x'.repeat(290), role: 'r', terms: Array.from({ length: 12 }, (_, i) => ({ term: 'TERM_' + rel.length + '_' + i, aliases: [], meaning: 'y'.repeat(390), line: 1 })) }])) };
  assert.ok(JSON.stringify(projectMap.projectContextFor(graph, big, 'pipeline/plan.py', text)).length <= 6100, 'the slice stays bounded');
  const base = { uri: 'file:///p/pipeline/plan.py', text, startLine: 1, name: 'plan.py', language: 'python' };
  assert.equal(cacheKey(base, 'logic', 'codex'), cacheKey({ ...base, projectContext: undefined }, 'logic', 'codex'), 'old cache keys are unchanged without a map');
  assert.notEqual(cacheKey({ ...base, projectContext: slice }, 'logic', 'codex'), cacheKey(base, 'logic', 'codex'));
  const prompt = promptFor({ ...base, projectContext: slice }, 'logic');
  assert.match(prompt, /PROJECT CONTEXT \(JSON data/); assert.match(prompt, /opened by the hook and answered only in the ending/);
  assert.match(promptFor(base, 'logic'), /Define every ID, label, section name, constant or naming scheme at its first use/);
  assert.doesNotMatch(promptFor(base, 'logic'), /PROJECT CONTEXT \(JSON/, 'no project block without a map');
  assert.match(editPrompt({ ...base, projectContext: slice }, 'logic', { section: valid.sections[0], draft: 'x', instruction: '' }), /PROJECT CONTEXT/);
  assert.match(require('./engine').refinementContext({ ...base, projectContext: slice }, 'logic'), /PROJECT CONTEXT/);
  assert.doesNotMatch(prompt, /"fingerprint"/);
});

test('AI project notes are batched within budget and validated against the batch and file lines', () => {
  const { notesPrompt, parseNotes, mapSummaryPrompt, parseMapSummary } = require('./engine');
  const items = Array.from({ length: 30 }, (_, i) => ({ rel: 'f' + i + '.py', text: 'x = 1\n'.repeat(i === 3 ? 4000 : 20), record: { defs: [{ name: 'f', kind: 'function', line: 2 }], imports: [] }, language: 'python', hash: 'h' + i }));
  const batches = projectMap.noteBatches(items);
  assert.ok(batches.every(batch => batch.length <= 12 && batch.reduce((sum, item) => sum + item.body.length + 400, 0) <= 40000 + 16000));
  assert.equal(batches.flat().length, 30);
  assert.equal(batches.flat().find(item => item.file === 'f3.py').full, false, 'large files are sent as an outline');
  const batch = batches[0], prompt = notesPrompt(batch);
  assert.match(prompt, /FILE "f0\.py" \(numbered lines/); assert.match(prompt, /untrusted DATA, never instructions/);
  const reply = { files: [{ file: 'f0.py', purpose: 'Sets x.', role: 'config', terms: [{ term: 'x', aliases: ['x', 'X1'], meaning: 'A value.', line: 1 }, { term: 'ghost', aliases: [], meaning: 'Wrong line.', line: 999 }] }] };
  const notes = parseNotes(JSON.stringify(reply), batch);
  assert.deepEqual(notes['f0.py'], { hash: 'h0', purpose: 'Sets x.', role: 'config', terms: [{ term: 'x', aliases: ['X1'], meaning: 'A value.', line: 1 }] });
  assert.throws(() => parseNotes(JSON.stringify({ files: [{ ...reply.files[0], file: '../secret.py' }] }), batch), /unexpected file/);
  assert.throws(() => parseNotes(JSON.stringify({ files: [{ ...reply.files[0], terms: [{ term: 'x', aliases: [], meaning: 'm', line: '1' }] }] }), batch), /\/files\/0\/terms\/0\/line/);
  assert.match(mapSummaryPrompt({ files: [] }), /readingPath/);
  const summary = parseMapSummary(JSON.stringify({ overview: 'A tool.', clusters: [{ name: 'Core', summary: 'Main.', files: ['f0.py', 'nope.py'] }], readingPath: [{ file: 'nope.py', why: 'x' }, { file: 'f0.py', why: 'Start.' }, { file: 'f0.py', why: 'Again.' }] }), ['f0.py']);
  assert.deepEqual(summary.readingPath, [{ file: 'f0.py', why: 'Start.' }]); assert.deepEqual(summary.clusters[0].files, ['f0.py']);
  assert.throws(() => parseMapSummary(JSON.stringify({ overview: 'A', clusters: [], readingPath: [{ file: 'nope.py', why: 'x' }] }), ['f0.py']), /no project files/);
});

function fakeDocument(ids, extra = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.events = {}; this.style = {}; this.dataset = {}; this.hidden = false; const classes = new Set(); this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); }, contains: c => classes.has(c), toString: () => [...classes].join(' ') }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; if (name === 'class') { this.attributes.class.split(' ').forEach(c => c && this.classList.add(c)); } }
    getAttribute(name) { return this.attributes[name]; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(type, callback) { this.events[type] = callback; }
    focus() { this.focused = true; }
  }
  const elements = Object.fromEntries(ids.map(id => [id, new Element('div')]));
  const document = { documentElement: { style: {} }, body: new Element('body'), getElementById: id => elements[id], createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => ({ textContent: text }), querySelectorAll: () => extra.all || [], querySelector: () => undefined, importNode: node => node, addEventListener() {} };
  const all = root => { const list = []; const visit = el => { list.push(el); (el.children || []).forEach(visit); }; visit(root); return list; };
  return { document, elements, all, Element };
}

test('project guide lists folder reading steps and a folder-box map; drag, fold, click and double-click send safe messages', async () => {
  const { mapHTML, edgePath, fitTransform, byFolder } = require('./map');
  const html = mapHTML('paper');
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|outerHTML|eval\(/);
  assert.match(html, /script-src 'nonce-/);
  assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 36 }, { x: 0, y: 104, w: 100, h: 36 }), 'M50 36 C50 70 50 70 50 104');
  assert.ok(fitTransform([{ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 200, w: 100, h: 40 }], 800, 600).k <= 1.4);
  assert.deepEqual(byFolder(['b/x.py', 'main.py', 'a/y.py', 'a/z.py']), [['a', ['a/y.py', 'a/z.py']], ['b', ['b/x.py']], ['', ['main.py']]]);
  const ids = ['canvas', 'viewport', 'boxes', 'edges', 'nodes', 'card', 'glossary', 'drawer', 'drawer-close', 'status', 'notes', 'rescan', 'zoom-in', 'zoom-out', 'fit', 'reset', 'drawer-toggle', 'tab-start', 'tab-map', 'start-view', 'map-view', 'start-head', 'folders', 'steps-title', 'steps-hint', 'steps', 'expand-all', 'collapse-all', 'search', 'search-form', 'search-go', 'search-panel'];
  const { document, elements, all } = fakeDocument(ids);
  const messages = [], sent = { at: i => messages.at(i), get length() { return messages.length; } }; let receive;
  vm.runInNewContext(pageScript(html), { document, acquireVsCodeApi: () => ({ postMessage: m => messages.push(JSON.parse(JSON.stringify(m))) }), window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Date, Math, Number, String, Map, Set, Object, Array, JSON });
  assert.equal(messages[0].type, 'ready');
  // A real grouped layout from the fixture project.
  const { graph } = await scanFixture(videoProject);
  const map = projectMap.layoutGrouped(graph), steps = projectMap.readingPathFor(graph, {}, 'pipeline');
  receive({ data: { type: 'map', state: { files: 5, links: 6, notes: { done: 0, total: 4 }, folders: projectMap.folderTree(graph), map,
    guide: { folder: 'pipeline', steps: steps.map(step => ({ id: step.id, why: 'Why ' + step.id, uses: [], usedBy: ['main.py'], explained: step.id === 'pipeline/plan.py' })) },
    cards: { 'pipeline/plan.py': { purpose: 'Plans open loops.', role: 'loop planning', explained: true, terms: [{ term: 'L1', aliases: [], meaning: 'The first loop.', line: 5 }], defs: ['plan_loops'] } },
    glossary: [{ term: 'L1', aliases: ['L2'], meaning: 'The first loop.', file: 'pipeline/plan.py', line: 5 }, { term: '<b>HOOK</b>', aliases: [], meaning: '', kind: 'constant', file: 'models/script.py', line: 1 }] } } });
  // Start here: folders and ordered steps, all text.
  assert.equal(elements['start-view'].hidden, false); assert.equal(elements['map-view'].hidden, true);
  const folderButtons = all(elements.folders).filter(el => el.tag === 'button');
  assert.deepEqual(folderButtons.map(el => el.children[0].textContent), ['Whole project', 'models/', 'pipeline/', 'tests/']);
  assert.equal(folderButtons[2].attributes['aria-current'], 'true');
  folderButtons[1].events.click(); assert.deepEqual(sent.at(-1), { type: 'guideFolder', folder: 'models' });
  assert.equal(elements['steps-title'].textContent, 'Start here in pipeline/');
  const stepItems = all(elements.steps).filter(el => el.tag === 'li');
  assert.deepEqual(stepItems.map(el => all(el).find(child => child.className === 'step-file').children.at(-1).textContent), ['write.py', 'plan.py']);
  assert.ok(all(stepItems[1]).some(el => el.textContent === '✓ explained'));
  const stepDetails = all(stepItems[0]).find(el => el.tag === 'details');
  assert.equal(stepDetails.className, 'step-details'); assert.ok(!stepDetails.attributes.open, 'step details start collapsed');
  assert.ok(all(stepDetails).some(el => el.textContent === 'Used by: main.py'));
  all(stepItems[0]).find(el => el.textContent === 'Explain').events.click();
  assert.deepEqual(sent.at(-1), { type: 'openFile', id: 'pipeline/write.py', tour: 'pipeline' }, 'Start here opens files as a tour of the folder');
  // Map: folders are boxes holding their files, and the map comes first.
  elements['tab-map'].events.click();
  assert.equal(elements['map-view'].hidden, false);
  assert.equal(elements.drawer.hidden, true, 'Details stay closed until a file is picked');
  const boxes = all(elements.boxes).filter(el => el.attributes['data-folder'] !== undefined);
  assert.deepEqual(boxes.map(el => el.attributes['data-folder']).sort(), ['(root)', 'models', 'pipeline', 'tests']);
  const files = all(elements.nodes).filter(el => el.attributes['data-id']);
  const plan = files.find(el => el.attributes['data-id'] === 'pipeline/plan.py'), box = map.boxes.find(b => b.folder === 'pipeline'), node = map.nodes.find(n => n.id === 'pipeline/plan.py');
  assert.ok(node.x >= box.x && node.x + node.w <= box.x + box.w && node.y >= box.y && node.y + node.h <= box.y + box.h, 'files sit inside their folder box');
  // Dragging a file moves its whole folder box and saves the box position.
  plan.events.pointerdown({ button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  elements.canvas.events.pointermove({ clientX: 70, clientY: 40 });
  elements.canvas.events.pointerup({ pointerId: 1 });
  const saved = sent.at(-1);
  assert.equal(saved.type, 'saveLayout'); assert.equal(saved.id, 'folder:pipeline'); assert.ok(saved.x > box.x && saved.y > box.y);
  const pipelineBox = boxes.find(el => el.attributes['data-folder'] === 'pipeline');
  assert.equal(pipelineBox.attributes.transform, 'translate(' + saved.x + ' ' + saved.y + ')');
  assert.match(files.find(el => el.attributes['data-id'] === 'pipeline/write.py').attributes.transform, new RegExp('translate\\(' + (map.nodes.find(n => n.id === 'pipeline/write.py').x + saved.x - box.x) + ' '), 'sibling files move with the box');
  // A click selects and shows the card; double-click explains; a header click folds.
  assert.equal(elements.drawer.hidden, true, 'dragging does not open Details');
  plan.events.pointerdown({ button: 0, clientX: 0, clientY: 0, pointerId: 1 }); elements.canvas.events.pointerup({ pointerId: 1 });
  assert.ok(plan.classList.contains('selected'));
  assert.equal(elements.drawer.hidden, false, 'clicking a file opens Details');
  elements['drawer-close'].events.click(); assert.equal(elements.drawer.hidden, true);
  receive({ data: { type: 'map', state: { files: 5, links: 6, notes: { done: 1, total: 4 }, notesBusy: true, progress: 'Writing AI notes 1/2…', folders: projectMap.folderTree(graph), map, guide: { folder: 'pipeline', steps: [] }, cards: { 'pipeline/plan.py': { purpose: 'Plans open loops.', explained: true, terms: [], defs: [] } },
    glossary: [{ term: 'L1', aliases: ['L2'], meaning: 'The first loop.', file: 'pipeline/plan.py', line: 5 }, { term: '<b>HOOK</b>', aliases: [], meaning: '', kind: 'constant', file: 'models/script.py', line: 1 }] } } });
  assert.equal(elements.drawer.hidden, true, 'a redraw while notes stream in does not reopen Details');
  assert.match(elements.status.textContent, /^Writing AI notes 1\/2…/, 'note progress shows in the status line');
  elements['drawer-toggle'].events.click(); assert.equal(elements.drawer.hidden, false);
  const cardText = all(elements.card).map(el => el.textContent).join('|');
  assert.match(cardText, /Plans open loops\./); assert.match(cardText, /✓ explained/); assert.match(cardText, /pipeline\//, 'card lists are grouped under folder headings');
  plan.events.dblclick({}); assert.deepEqual(sent.at(-1), { type: 'openFile', id: 'pipeline/plan.py' });
  const head = all(pipelineBox).find(el => el.attributes.class === 'head');
  head.events.pointerdown({ button: 0, clientX: 0, clientY: 0, pointerId: 1 }); elements.canvas.events.pointerup({ pointerId: 1 });
  assert.deepEqual(sent.at(-1), { type: 'toggleFolder', folder: 'pipeline' });
  elements['collapse-all'].events.click(); assert.deepEqual(sent.at(-1), { type: 'foldAll', collapsed: true });
  // Glossary rows are grouped by folder and stay text.
  const glossaryText = all(elements.glossary).map(el => el.textContent).filter(Boolean);
  assert.ok(glossaryText.includes('models/') && glossaryText.includes('pipeline/'));
  assert.ok(glossaryText.includes('<b>HOOK</b>'), 'terms are text, never markup');
  // A folded folder is a single node that unfolds on double-click.
  receive({ data: { type: 'map', state: { files: 5, links: 6, notes: {}, folders: [], guide: { folder: '', steps: [] }, map: projectMap.layoutGrouped(graph, { collapsed: ['pipeline'] }) } } });
  const folded = all(elements.nodes).find(el => el.attributes['data-id'] === 'folder:pipeline');
  folded.events.dblclick({}); assert.deepEqual(sent.at(-1), { type: 'toggleFolder', folder: 'pipeline' });
});

test('reader explanations turn project terms into text-only links that open their definitions', () => {
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'setup-ai']);
  const sent = []; let receive;
  const record = m => sent.push(JSON.parse(JSON.stringify(m)));
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage: record }), katex: { renderToString: () => '<math></math>' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  receive({ data: { type: 'state', state: { documentKey: 'doc', providerLabel: 'Codex', level: 'logic', name: 'plan.py', glossary: [{ term: 'L1', aliases: ['L2'], meaning: 'The first loop, opened by the hook.', kind: '', defined: 'pipeline/plan.py:5' }, { term: 'HOOK', aliases: [], meaning: '', kind: 'constant', defined: 'models/script.py:1' }],
    result: { title: 'Plan loops', summary: 'Plans loops.', sections: [{ title: 'Open loops', startLine: 1, endLine: 2, pseudocode: 'Open L1 in HOOK; then L2.\n# Context: L1 spans the video.' }] } } } });
  const terms = all(elements.content).filter(el => el.className === 'term');
  assert.deepEqual(terms.map(el => el.textContent), ['L1', 'HOOK', 'L2', 'L1']);
  assert.match(terms[0].title, /The first loop, opened by the hook\. · defined in pipeline\/plan\.py:5/);
  assert.match(terms[1].title, /constant defined elsewhere/);
  terms[2].events.click({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(sent.at(-1), { type: 'revealTerm', index: 0, documentKey: 'doc' });
  elements.map.events.click(); assert.equal(sent.at(-1).type, 'map');
});

test('opening the project map scans locally, AI notes use the estimated requests, and explanations receive the context', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-map-')), root = path.join(temp, 'video'), storage = path.join(temp, 'storage');
  for (const [rel, text] of Object.entries(videoProject)) { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); }
  await fs.mkdir(path.join(temp, 'outside')); await fs.writeFile(path.join(temp, 'outside', 'secret.py'), 'TOKEN = "do-not-send"\n');
  await fs.symlink(path.join(temp, 'outside', 'secret.py'), path.join(root, 'leak.py'));
  class Uri { constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; } toString() { return 'file://' + this.fsPath; } static file(p) { return new Uri(p); } static parse(v) { return new Uri(decodeURIComponent(v.replace(/^file:\/\//, ''))); } static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); } }
  class RelativePattern { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  class Selection extends Range { get isEmpty() { return true; } }
  const commands = new Map(), state = new Map(), panels = [], requests = [], generated = [], shown = [], sentPrompts = [], usedTools = [];
  const noop = () => ({ dispose() {} });
  const walk = async dir => (await fs.readdir(dir, { withFileTypes: true })).flatMap(entry => entry.isDirectory() ? [] : [path.join(dir, entry.name)]).concat(...await Promise.all((await fs.readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => walk(path.join(dir, entry.name)))));
  const docFor = uri => fs.readFile(uri.fsPath, 'utf8').then(text => ({ uri, languageId: 'python', isDirty: false, lineCount: text.split('\n').length, getText: () => text, lineAt: i => ({ text: text.split('\n')[i] }) }));
  const vscode = { Uri, RelativePattern, Range, Selection, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: -2, Active: -1 }, TextEditorRevealType: {},
    commands: { registerCommand(id, fn) { commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: true, workspaceFolders: [{ uri: new Uri(root) }], textDocuments: [], getWorkspaceFolder: uri => uri.fsPath.startsWith(root) ? { uri: new Uri(root) } : undefined, asRelativePath: uri => path.relative(root, uri.fsPath), openTextDocument: docFor,
      findFiles: async pattern => (await walk(root)).filter(file => /package\.json/.test(pattern.pattern) ? /(package\.json|go\.mod|Cargo\.toml)$/.test(file) : /\.py$/.test(file)).map(file => new Uri(file)),
      createFileSystemWatcher: () => ({ onDidCreate: noop, onDidDelete: noop, onDidChange: noop, dispose() {} }), getConfiguration: () => ({ get: (key, fallback) => key === 'autoNotes' ? false : fallback }), onDidChangeTextDocument: noop },
    window: { createStatusBarItem: statusItem, activeTextEditor: undefined, visibleTextEditors: [], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor: noop, showErrorMessage(message) { throw new Error(message); }, showInformationMessage: async () => undefined,
      showWarningMessage: async (message) => { shown.push(message); return 'Add notes'; }, showTextDocument: async (doc, options) => { shown.push(['open', doc.uri.fsPath, options?.selection?.start.line]); return { document: doc, setDecorations() {}, revealRange() {} }; },
      createWebviewPanel: type => { const panel = { type, messages: [], reveal() {}, onDidDispose: noop, onDidChangeViewState: noop, webview: { postMessage: m => panel.messages.push(m), onDidReceiveMessage(fn) { panel.receive = fn; return noop(); } } }; panels.push(panel); return panel; } },
    env: { clipboard: { writeText: async () => {} } } };
  const engine = { ...require('./engine'),
    requestStructured: async ({ prompt, schema }) => {
      sentPrompts.push(prompt);
      requests.push(schema === require('./engine').NOTES_SCHEMA ? 'notes' : 'summary');
      if (schema === require('./engine').NOTES_SCHEMA) {
        const files = [...prompt.matchAll(/FILE "([^"]+)" \(numbered/g)].map(match => match[1]);
        return { raw: JSON.stringify({ files: files.map(file => ({ file, purpose: 'Purpose of ' + file, role: 'stage', terms: file === 'pipeline/plan.py' ? [{ term: 'L1', aliases: ['L2'], meaning: 'The first loop: opened by the hook, answered in the ending.', line: 5 }] : [] })) }) };
      }
      return { raw: JSON.stringify({ overview: 'Writes video scripts.', clusters: [{ name: 'Planning', summary: 'Plans loops.', files: ['pipeline/plan.py'] }], readingPath: [{ file: 'main.py', why: 'Shows the whole flow.' }, { file: 'pipeline/plan.py', why: 'Explains loops.' }] }), actualModel: 'fixture' };
    },
    generate: async opts => { generated.push(opts.source.projectContext); usedTools.push(opts.tools); return { ...valid, title: 'Plan', sections: [{ title: 'Plan loops', startLine: 1, endLine: 2, pseudocode: 'Open L1.', lineMap: [] }], requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort }; } };
  const moduleStub = { exports: {} }, context = { subscriptions: [], globalStorageUri: { fsPath: storage }, globalState: { get: (k, fallback) => state.get(k) ?? fallback, update: async (k, v) => state.set(k, v) }, secrets: {} };
  state.set('provider', 'codex'); state.set('launcherHintShown', true);
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout, process, __dirname });
    await moduleStub.exports.activate(context);
    await commands.get('yamori.map')(new Uri(root));
    assert.equal(panels.filter(panel => panel.type === 'yamoriMap').length, 1);
    const mapPanel = panels.find(panel => panel.type === 'yamoriMap'), last = () => JSON.parse(JSON.stringify(mapPanel.messages.at(-1).state));
    assert.deepEqual(requests, [], 'opening and scanning the map uses no AI');
    assert.equal(last().files, 5); assert.deepEqual(last().guide.steps.map(step => step.id), ['main.py', 'pipeline/plan.py', 'pipeline/write.py', 'models/script.py']);
    assert.equal(last().guide.steps[0].why, 'Entry point: the program starts here.');
    assert.ok(!last().map.nodes.some(node => node.id === 'leak.py'), 'a symlink to a file outside the project is not read');
    await mapPanel.receive({ type: 'guideFolder', folder: 'pipeline' });
    assert.deepEqual(last().guide.steps.map(step => step.id), ['pipeline/write.py', 'pipeline/plan.py']);
    assert.match(last().guide.steps[0].why, /way into this folder/);
    await mapPanel.receive({ type: 'guideFolder', folder: '../..' });
    assert.equal(last().guide.folder, 'pipeline', 'unknown folders are ignored');
    await mapPanel.receive({ type: 'saveLayout', id: 'folder:pipeline', x: 400, y: -20 });
    await mapPanel.receive({ type: 'saveLayout', id: 'folder:../../etc', x: 1, y: 1 });
    await mapPanel.receive({ type: 'toggleFolder', folder: 'models' });
    await mapPanel.receive({ type: 'toggleFolder', folder: 'nope' });
    assert.deepEqual(last().map.boxes.find(b => b.folder === 'pipeline').x, 400);
    assert.ok(last().map.nodes.some(node => node.id === 'folder:models' && node.collapsed), 'a folded folder becomes one node');
    assert.ok(!last().map.boxes.some(b => b.folder === '../../etc'));
    await mapPanel.receive({ type: 'focusMap', id: 'models/script.py' });
    assert.ok(last().map.nodes.some(node => node.id === 'models/script.py'), 'showing a file on the map unfolds its folder');
    assert.equal(last().view, 'map'); assert.equal(last().focus, 'models/script.py');
    await mapPanel.receive({ type: 'revealSource', id: '/etc/passwd', line: 1 });
    await mapPanel.receive({ type: 'revealSource', id: 'pipeline/plan.py', line: 5 });
    assert.deepEqual(shown.filter(item => Array.isArray(item)), [['open', path.join(root, 'pipeline/plan.py'), 4]], 'only mapped files open');
    await mapPanel.receive({ type: 'notes' });
    assert.match(shown.find(item => typeof item === 'string'), /4 files .* about 2 model requests/);
    assert.deepEqual(requests, ['notes', 'summary']);
    assert.ok(!sentPrompts.some(prompt => prompt.includes('do-not-send')), 'files outside the project never reach a prompt');
    await mapPanel.receive({ type: 'guideFolder', folder: '' });
    assert.equal(last().overview, 'Writes video scripts.'); assert.equal(last().guide.steps[1].id, 'pipeline/plan.py'); assert.equal(last().guide.steps[1].why, 'Explains loops.');
    assert.deepEqual(last().notes, { total: 4, done: 4, outdated: 0 });
    assert.ok(last().glossary.some(term => term.term === 'L1' && term.file === 'pipeline/plan.py'));
    // Reopening a project with notes does not ask again.
    requests.length = 0; await mapPanel.receive({ type: 'notes' }); assert.deepEqual(requests, []);
    // An explanation of a mapped file carries the project slice.
    await mapPanel.receive({ type: 'openFile', id: 'pipeline/plan.py' });
    assert.equal(generated.length, 1);
    assert.equal(generated[0].file.purpose, 'Purpose of pipeline/plan.py');
    assert.ok(generated[0].glossary.some(term => term.term === 'L1' && /opened by the hook/.test(term.meaning)));
    assert.ok(usedTools[0]?.args[0].endsWith('mcp.js') && usedTools[0].args.includes('--root') && usedTools[0].env.ELECTRON_RUN_AS_NODE === '1', 'a mapped file gets Yamori lookups');
    await new Promise(resolve => setTimeout(resolve, 20));
    const index = JSON.parse(await fs.readFile(path.join(storage, 'cache', 'projects', require('./engine').hash('file://' + root).slice(0, 32), 'explanations.json'), 'utf8'));
    assert.deepEqual(Object.keys(index), ['pipeline/plan.py']); assert.equal(index['pipeline/plan.py'].logic.title, 'Plan');
    assert.ok(last().guide.steps.find(step => step.id === 'pipeline/plan.py').explained, 'explained files are marked in the guide');
    const server = require('./mcp').createServer({ store: path.dirname(path.join(storage, 'cache', 'projects', require('./engine').hash('file://' + root).slice(0, 32), 'x')), root });
    assert.match(server.call('get_explanation', { path: 'pipeline/plan.py' }).content[0].text, /"title": "Plan"/, 'the agent can read Yamori explanations of other files');
    const reader = panels.find(panel => panel.type === 'yamori'), readerState = reader.messages.filter(m => m.type === 'state').at(-1).state;
    assert.equal(readerState.glossary.find(term => term.term === 'L1').defined, 'pipeline/plan.py:5');
    shown.length = 0;
    await reader.receive({ type: 'revealTerm', index: readerState.glossary.findIndex(term => term.term === 'L1'), documentKey: readerState.documentKey });
    assert.deepEqual(shown, [['open', path.join(root, 'pipeline/plan.py'), 4]]);
    // Unmapped workspaces add nothing and never trigger a scan.
    const plain = moduleStub.exports.createProjectMap({ globalStorageUri: { fsPath: path.join(temp, 'empty') }, globalState: context.globalState }, { api: vscode });
    assert.equal(await plain.contextFor({ uri: 'file://' + path.join(root, 'main.py'), text: 'x' }), undefined);
  } finally { await Promise.all(context.subscriptions.map(d => d?.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); }
});

async function mappedFixture(extra = {}) {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-mcp-')), root = path.join(temp, 'video'), store = path.join(temp, 'store');
  const files = { ...videoProject, 'big.py': Array.from({ length: 500 }, (_, i) => 'V' + i + ' = ' + i).join('\n') + '\n', ...extra };
  for (const [rel, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); }
  await fs.mkdir(path.join(temp, 'outside')); await fs.writeFile(path.join(temp, 'outside', 'secret.py'), 'TOKEN = "do-not-send"\n');
  await fs.symlink(path.join(temp, 'outside', 'secret.py'), path.join(root, 'leak.py'));
  const { graph } = await scanFixture(files);
  graph.files['leak.py'] = { ...graph.files['main.py'], defs: [], refs: [], imports: [] };
  await fs.mkdir(store);
  await fs.writeFile(path.join(store, 'graph.json'), JSON.stringify(graph));
  await fs.writeFile(path.join(store, 'notes.json'), JSON.stringify({ overview: 'Writes video scripts.', files: { 'models/script.py': { hash: graph.files['models/script.py'].hash, purpose: 'Defines script sections.', role: 'data model', terms: [{ term: 'HOOK', aliases: [], meaning: 'Opening section that raises the main question.', line: 1 }] } } }));
  await fs.writeFile(path.join(store, 'explanations.json'), JSON.stringify({ 'pipeline/write.py': { overview: { title: 'Write blocks', summary: 'Turns loops into hints.', sections: [{ title: 'Write', startLine: 1, endLine: 5, pseudocode: 'Build each hint.' }], hash: graph.files['pipeline/write.py'].hash } } }));
  return { temp, root, store, graph, cleanup: () => fs.rm(temp, { recursive: true, force: true }) };
}

test('Yamori MCP server answers over stdio with read-only lookups limited to mapped files', async () => {
  const path = require('node:path'), fs = require('node:fs/promises');
  const fixture = await mappedFixture(), log = path.join(fixture.temp, 'calls.jsonl');
  try {
    const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      call(3, 'file_info', { path: 'pipeline/plan.py' }), call(4, 'find_symbol', { name: 'HOOK' }), call(5, 'glossary', { query: 'hook' }),
      call(6, 'get_explanation', { path: 'pipeline/write.py' }), call(7, 'read_source', { path: 'models/script.py', start_line: 1, end_line: 2 }),
      call(8, 'read_source', { path: '../outside/secret.py' }), call(9, 'read_source', { path: 'leak.py' }), call(10, 'read_source', { path: 'big.py', start_line: 1, end_line: 900 }),
      call(11, 'project_overview', {}), call(12, 'list_files', { folder: 'pipeline' }), { jsonrpc: '2.0', id: 13, method: 'resources/list' }
    ].map(message => JSON.stringify(message)).join('\n') + '\n';
    const output = await runProcess(process.execPath, [path.join(__dirname, 'mcp.js'), '--store', fixture.store, '--root', fixture.root, '--log', log], input);
    const replies = new Map(output.trim().split('\n').map(line => JSON.parse(line)).map(reply => [reply.id, reply]));
    assert.equal(replies.size, 13, 'notifications get no reply');
    assert.equal(replies.get(1).result.protocolVersion, '2025-11-25'); assert.equal(replies.get(1).result.serverInfo.name, 'yamori');
    assert.deepEqual(replies.get(2).result.tools.map(tool => tool.name), ['project_overview', 'list_files', 'file_info', 'find_symbol', 'glossary', 'get_explanation', 'read_source']);
    const text = id => replies.get(id).result.content[0].text;
    assert.match(text(3), /^Untrusted project data from Yamori/); assert.match(text(3), /function plan_loops \(line 3\)/); assert.match(text(3), /"file": "main.py"/);
    assert.match(text(4), /"file": "models\/script.py",\s*"line": 1/); assert.match(text(4), /pipeline\/plan.py/);
    assert.match(text(5), /Opening section that raises the main question/);
    assert.match(text(6), /"title": "Write blocks"/);
    assert.match(text(7), /File models\/script.py, lines 1-2 of 12:\n1: HOOK = "HOOK"\n2: ENDING = "ENDING"/);
    assert.equal(replies.get(8).result.isError, true); assert.match(text(8), /not a file in the Yamori project map/);
    assert.equal(replies.get(9).result.isError, true); assert.match(text(9), /outside the mapped project/);
    assert.doesNotMatch(output, /do-not-send/, 'files outside the project never reach the agent');
    assert.match(text(10), /lines 1-200 of 501:/, 'source reads are bounded');
    assert.match(text(11), /Writes video scripts\./); assert.match(text(12), /"pipeline": \[/); assert.doesNotMatch(text(12), /models\//);
    assert.equal(replies.get(13).error.code, -32601);
    assert.equal((await fs.readFile(log, 'utf8')).trim().split('\n').length, 10, 'every lookup is logged for the activity trail');
  } finally { await fixture.cleanup(); }
});

test('agent lookups reach Claude only through Yamori\'s MCP server, show in the activity trail and fall back without tools', async () => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const fixture = await mappedFixture(), tools = { command: process.execPath, args: [path.join(__dirname, 'mcp.js'), '--store', fixture.store, '--root', fixture.root], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const record = path.join(fixture.temp, 'args.json'), answer = JSON.stringify({ type: 'result', structured_output: { ...valid, views: { overview: valid } } });
  try {
    const binary = path.join(fixture.temp, 'claude.js');
    await fs.writeFile(binary, `const fs=require('fs'),a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode --permission-prompts');process.exit(0)}
fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(a));let prompt='';process.stdin.on('data',d=>prompt+=d).on('end',()=>{
const config=JSON.parse(a[a.indexOf('--mcp-config')+1]).mcpServers.yamori;
if(config){const log=config.args[config.args.indexOf('--log')+1];fs.appendFileSync(log,JSON.stringify({tool:'file_info',target:'models/script.py'})+'\\n');if(!prompt.includes('YAMORI TOOLS'))process.exit(4);}
setTimeout(()=>process.stdout.write(${JSON.stringify(answer)}),config?400:0);});`);
    const phases = [];
    const result = await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, tools, onProgress: update => update.phase && phases.push(update.phase) });
    const args = JSON.parse(await fs.readFile(record, 'utf8'));
    const server = JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers.yamori;
    assert.equal(server.type, 'stdio'); assert.equal(server.command, process.execPath); assert.ok(server.args.includes('--log'));
    assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__yamori__*'); assert.equal(args[args.indexOf('--permission-prompts') + 1], 'none');
    assert.equal(args[args.indexOf('--tools') + 1], '', 'built-in tools stay off');
    assert.ok(args.includes('--setting-sources') && !args.includes('--safe-mode'), 'safe mode would drop the explicitly passed server');
    assert.ok(phases.includes('Looked up file · models/script.py')); assert.equal(result.toolCalls, 1);
    assert.equal(parseResult(JSON.stringify(result), source).toolCalls, 1, 'lookup counts survive the cache');
    // Without tools nothing about Yamori's server is passed.
    await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, onProgress() {} });
    const plain = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.deepEqual(JSON.parse(plain[plain.indexOf('--mcp-config') + 1]), { mcpServers: {} }); assert.ok(plain.includes('--safe-mode') && !plain.includes('--allowedTools'));
    // A CLI that cannot start the server still produces an explanation.
    const broken = path.join(fixture.temp, 'broken.js');
    await fs.writeFile(broken, `const a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
if(JSON.parse(a[a.indexOf('--mcp-config')+1]).mcpServers.yamori){console.error('MCP server failed to start');process.exit(2)}
process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(answer)}));`);
    const fallback = [];
    const recovered = await generate({ source, level: 'logic', provider: 'claude', cliPath: broken, tools, onProgress: update => update.phase && fallback.push(update.phase) });
    assert.equal(recovered.title, valid.title); assert.ok(fallback.includes('Yamori lookups unavailable; writing without them'));
  } finally { await fixture.cleanup(); }
});

test('Codex tool runs load only Yamori\'s server and approve only its requests', async () => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const fixture = await mappedFixture(), tools = { command: process.execPath, args: [path.join(__dirname, 'mcp.js'), '--store', fixture.store, '--root', fixture.root], env: { ELECTRON_RUN_AS_NODE: '1' } };
  const record = path.join(fixture.temp, 'codex.json'), binary = path.join(fixture.temp, 'codex');
  await fs.writeFile(binary, `#!${process.execPath}
const fs=require('fs'),out=e=>process.stdout.write(JSON.stringify(e)+'\\n'),seen={launch:process.argv.slice(2),responses:{}};
require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);
 if(q.id===1)out({id:1,result:{}});
 if(q.id===2){seen.thread=q.params;out({id:2,result:{thread:{id:'t'},model:'fixture'}});}
 if(q.id===3){seen.prompt=q.params.input[0].text;out({id:50,method:'mcpServer/elicitation/request',params:{serverName:'yamori',threadId:'t'}});out({id:51,method:'mcpServer/elicitation/request',params:{serverName:'other',threadId:'t'}});out({id:52,method:'item/commandExecution/requestApproval',params:{command:'rm -rf /'}});}
 if([50,51,52].includes(q.id)){seen.responses[q.id]=q;if(Object.keys(seen.responses).length===3){fs.writeFileSync(${JSON.stringify(record)},JSON.stringify(seen));out({method:'item/agentMessage/delta',params:{delta:${JSON.stringify(JSON.stringify({ ...valid, views: { overview: valid } }))}}});out({method:'turn/completed',params:{turn:{status:'completed'}}});}}
});`);
  await fs.chmod(binary, 0o755);
  try {
    const result = await generate({ source, level: 'logic', provider: 'codex', cliPath: binary, tools });
    assert.equal(result.title, valid.title);
    const seen = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.match(seen.launch[seen.launch.indexOf('-c') + 1], /^mcp_servers=\{yamori=\{command=".+",args=\[.*"--log".*\],env=\{ELECTRON_RUN_AS_NODE="1"\},default_tools_approval_mode="approve"/);
    assert.equal(seen.thread.config.mcp_servers.yamori.command, process.execPath); assert.deepEqual(Object.keys(seen.thread.config.mcp_servers), ['yamori']);
    assert.match(seen.thread.baseInstructions, /read-only yamori tools; do not use any other tools/);
    assert.match(seen.prompt, /YAMORI TOOLS/);
    assert.deepEqual(seen.responses[50].result, { action: 'accept', content: {} });
    assert.ok(seen.responses[51].error && seen.responses[52].error, 'other servers and commands are refused');
  } finally { await fixture.cleanup(); }
});

test('folder reading paths start where a folder is entered, and folder boxes stay structured at any size', async () => {
  const { graph } = await scanFixture(videoProject);
  assert.deepEqual(projectMap.folderTree(graph).map(folder => folder.key), ['', 'models', 'pipeline', 'tests']);
  assert.deepEqual(projectMap.readingPathFor(graph, {}, '').map(step => step.id), graph.readingPath.map(step => step.id));
  const pipeline = projectMap.readingPathFor(graph, {}, 'pipeline');
  assert.deepEqual(pipeline.map(step => [step.id, step.via || null, step.usedOutside ?? null]), [['pipeline/write.py', null, 1], ['pipeline/plan.py', 'pipeline/write.py', null]]);
  assert.deepEqual(projectMap.readingPathFor(graph, { readingPath: [{ file: 'pipeline/plan.py', why: 'Loops first.' }] }, 'pipeline').map(step => step.id), ['pipeline/plan.py', 'pipeline/write.py'], 'AI order leads');
  assert.deepEqual(projectMap.readingPathFor(graph, {}, 'tests'), [], 'tests are never reading steps');
  // A larger project: boxes never overlap, files stay inside, and only the entry folder starts open.
  const files = { 'main.py': 'from pkg0.m0 import f0\nif __name__ == "__main__":\n    f0()\n' };
  for (let p = 0; p < 9; p++) for (let m = 0; m < 10; m++) files['pkg' + p + '/m' + m + '.py'] = (m ? 'from pkg' + p + '.m' + (m - 1) + ' import f' + (m - 1) + '\n' : '') + (p ? 'from pkg' + (p - 1) + '.m0 import f0\n' : '') + 'def f' + m + '():\n    return ' + m + '\n';
  const big = (await scanFixture(files)).graph;
  const collapsed = projectMap.defaultCollapsed(big);
  assert.equal(collapsed.length, 9); assert.ok(!collapsed.includes('(root)'), 'the entry point\'s folder stays open');
  const open = projectMap.layoutGrouped(big);
  for (const a of open.boxes) for (const b of open.boxes) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'folder boxes never overlap');
  for (const node of open.nodes) { const box = open.boxes.find(item => item.id === node.group); assert.ok(node.x >= box.x && node.x + node.w <= box.x + box.w && node.y >= box.y && node.y + node.h <= box.y + box.h); }
  const folded = projectMap.layoutGrouped(big, { collapsed });
  assert.equal(folded.nodes.filter(node => node.kind === 'folder').length, 9);
  assert.ok(folded.edges.every(edge => !edge.from.startsWith('pkg') && !edge.to.startsWith('pkg')), 'edges into folded folders point at the folder');
  const moved = projectMap.layoutGrouped(big, { saved: { 'folder:pkg3': { x: 5000, y: 7 } } });
  const box = moved.boxes.find(item => item.folder === 'pkg3');
  assert.deepEqual([box.x, box.y], [5000, 7]); assert.ok(moved.nodes.filter(node => node.group === 'folder:pkg3').every(node => node.x >= 5000), 'files move with their box');
});

test('the reader header names its actions plainly and the empty state offers the next steps', () => {
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'ai-summary', 'setup-ai']);
  const sent = []; let receive;
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage: m => sent.push(JSON.parse(JSON.stringify(m))) }), katex: { renderToString: () => '' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  const html = panelHTML();
  for (const label of ['Switch file…', 'Project guide', 'Overview', 'Logic']) assert.ok(html.includes('>' + label + '<'), label);
  assert.ok(!/▤|▦|>Detailed</.test(html), 'no cryptic icons or removed levels');
  receive({ data: { type: 'state', state: { providerLabel: 'Claude Code', requestedModel: 'opus', level: 'logic' } } });
  assert.equal(elements['ai-summary'].textContent, 'AI: Claude Code · opus ▾');
  const actions = all(elements.content).filter(el => el.tag === 'button');
  assert.deepEqual(actions.map(el => el.textContent).slice(0, 3), ['Explain current file', 'Switch file…', 'Open project guide']);
  actions[1].events.click(); assert.equal(sent.at(-1).type, 'switchFile');
  actions[2].events.click(); assert.equal(sent.at(-1).type, 'map');
  receive({ data: { type: 'state', state: { providerLabel: 'Codex', level: 'logic', name: 'pipeline/plan.py · lines 3–9', result: valid } } });
  assert.deepEqual(elements.source.children.map(el => el.textContent), ['pipeline › ', 'plan.py', ' · lines 3–9']);
  elements.source.events.click(); assert.equal(sent.at(-1).type, 'showSource');
  assert.equal(elements.refresh.textContent, 'Regenerate');
  receive({ data: { type: 'state', state: { providerLabel: 'Codex', level: 'logic', name: 'plan.py', result: valid, stale: true, staleBlocks: [0] } } });
  assert.equal(elements.refresh.textContent, 'Update from code');
  receive({ data: { type: 'state', state: { providerLabel: 'Codex', level: 'logic', name: 'plan.py', result: valid, busy: true } } });
  assert.equal(elements.refresh.textContent, 'Stop');
});

test('Switch file groups project files by folder, lists open tabs first, and an old Detailed preference reads as Logic', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-picker-'));
  const commands = new Map(), state = new Map([['detail', 'detailed'], ['provider', 'codex'], ['launcherHintShown', true]]), levels = [];
  let picked;
  class Uri { constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; } toString() { return 'file://' + this.fsPath; } static parse(v) { return new Uri(v.replace('file://', '')); } }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  const noop = () => ({ dispose() {} });
  const uris = ['/p/main.py', '/p/pipeline/plan.py', '/p/pipeline/write.py', '/p/models/script.py'].map(file => new Uri(file));
  const doc = uri => ({ uri, languageId: 'python', isDirty: false, lineCount: 1, getText: () => 'x = 1', lineAt: () => ({ text: 'x = 1' }) });
  const vscode = { Uri, Range, Selection: Range, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: -2 }, QuickPickItemKind: { Separator: -1 },
    commands: { registerCommand(id, fn) { commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: true, textDocuments: [], findFiles: async () => uris, asRelativePath: uri => uri.fsPath.replace('/p/', ''), openTextDocument: async uri => doc(uri), getConfiguration: () => ({ get: (_, fallback) => fallback }), onDidChangeTextDocument: noop },
    window: { createStatusBarItem: statusItem, activeTextEditor: undefined, visibleTextEditors: [], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor: noop, showErrorMessage(message) { throw new Error(message); }, showTextDocument: async () => ({ setDecorations() {}, revealRange() {} }),
      showQuickPick: async items => { picked = await items; return picked.find(item => item.label === 'write.py'); },
      createWebviewPanel: () => ({ reveal() {}, onDidDispose: noop, onDidChangeViewState: noop, webview: { postMessage() {}, onDidReceiveMessage: noop } }) },
    env: { clipboard: { writeText: async () => {} } } };
  const engine = { ...require('./engine'), generate: async opts => { levels.push(opts.level); return { ...valid, sections: [{ ...valid.sections[0], startLine: 1, endLine: 1 }], views: { overview: { ...valid, sections: [{ ...valid.sections[0], startLine: 1, endLine: 1 }] } } }; } };
  const moduleStub = { exports: {} }, context = { subscriptions: [], globalStorageUri: { fsPath: temp }, globalState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, secrets: {} };
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout, process, __dirname });
    await moduleStub.exports.activate(context);
    await commands.get('yamori.switchFile')();
    assert.deepEqual(JSON.parse(JSON.stringify(picked.map(item => item.kind === -1 ? '[' + item.label + ']' : item.label))), ['[models/]', 'script.py', '[pipeline/]', 'plan.py', 'write.py', '[Project root]', 'main.py']);
    assert.deepEqual(JSON.parse(JSON.stringify(levels)), ['logic'], 'a stored Detailed preference opens at Logic');
    await commands.get('yamori.switchFile')();
    assert.deepEqual(JSON.parse(JSON.stringify(picked.slice(0, 2).map(item => item.kind === -1 ? '[' + item.label + ']' : item.label))), ['[Open in Yamori]', 'write.py'], 'open files come first');
    assert.ok(!picked.slice(2).some(item => item.label === 'write.py'), 'an open file is not listed twice');
  } finally { await Promise.all(context.subscriptions.map(d => d?.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); }
});

test('Claude and Codex progress becomes visible stages: start, thinking with token counts, writing, review', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-stages-'));
  try {
    const answer = JSON.stringify({ ...valid, views: { overview: valid } }), half = Math.floor(answer.length / 2);
    const events = [{ type: 'system', subtype: 'init', model: 'claude-opus-test' }, { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 1240, estimated_tokens_delta: 1240 }, { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE REASONING' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'StructuredOutput' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: answer.slice(0, half) } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: answer.slice(half) } } },
      { type: 'result', structured_output: JSON.parse(answer), modelUsage: { 'claude-opus-test': {} } }];
    const binary = path.join(dir, 'claude.js');
    await fs.writeFile(binary, `const a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
process.stdin.resume();process.stdin.on('end',async()=>{for(const e of ${JSON.stringify(events)}){process.stdout.write(JSON.stringify(e)+'\\n');await new Promise(r=>setTimeout(r,150));}});`);
    const updates = [];
    await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, effort: 'medium', onProgress: update => updates.push(update) });
    const stages = updates.map(update => update.stage).filter((value, index, all) => value && value !== all[index - 1]);
    assert.deepEqual(stages, ['start', 'think', 'write']);
    assert.ok(updates.some(update => update.model === 'claude-opus-test'));
    assert.ok(updates.some(update => update.stage === 'think' && update.thinkingTokens === 1240), 'thinking shows as a token estimate');
    assert.ok(!JSON.stringify(updates).includes('PRIVATE REASONING'), 'thinking text is never shown');
    assert.ok(updates.some(update => update.stage === 'write' && update.characters > 0));
    assert.ok(updates.filter(update => update.stage === 'write').every(update => update.characters > 0), 'thinking deltas never count as writing');
    const firstWrite = updates.findIndex(update => update.stage === 'write');
    assert.ok(updates.slice(firstWrite).every(update => update.stage !== 'think'), 'once writing starts, the stage does not flip back to thinking');
    // Codex reports reasoning as an item; it becomes the thinking stage too.
    const codex = path.join(dir, 'codex');
    await fs.writeFile(codex, `#!${process.execPath}
const out=e=>process.stdout.write(JSON.stringify(e)+'\\n');require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);
if(q.id===1)out({id:1,result:{}});if(q.id===2)out({id:2,result:{thread:{id:'t'},model:'codex-test'}});
if(q.id===3){out({method:'item/started',params:{item:{type:'reasoning',id:'r'}}});out({method:'item/agentMessage/delta',params:{delta:${JSON.stringify(answer)}}});out({method:'turn/completed',params:{turn:{status:'completed'}}});}});`);
    await fs.chmod(codex, 0o755);
    const codexUpdates = [];
    await generate({ source, level: 'logic', provider: 'codex', cliPath: codex, onProgress: update => codexUpdates.push(update) });
    assert.deepEqual(codexUpdates.map(update => update.stage).filter((value, index, all) => value && value !== all[index - 1]), ['start', 'think', 'write']);
    assert.ok(codexUpdates.some(update => update.phase === 'Thinking'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('refinement reports its review rounds, and the difficulty selector thinks at low effort', async () => {
  const efforts = [], updates = [];
  const draft = { ...valid, sections: [{ ...valid.sections[0], lineMap: [] }] };
  const review = { score: 1, faithful: true, issues: [] };
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-select-effort-'));
  try {
    const binary = path.join(dir, 'claude.js');
    await fs.writeFile(binary, `const a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
const schema=JSON.parse(a[a.indexOf('--json-schema')+1]);require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'efforts'))},(schema.properties.blocks?'select:':schema.properties.score?'review:':'write:')+(a.includes('--effort')?a[a.indexOf('--effort')+1]:'none')+'\\n');
process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'result',structured_output:schema.properties.blocks?{blocks:[{index:0,reason:'Hard.'}]}:schema.properties.score?${JSON.stringify(review)}:{...${JSON.stringify(draft)},views:{overview:${JSON.stringify(draft)}}}})));`);
    await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, effort: 'high', refinementSteps: 1, onProgress: update => updates.push(update) });
    efforts.push(...(await fs.readFile(path.join(dir, 'efforts'), 'utf8')).trim().split('\n'));
    assert.deepEqual(efforts.slice(0, 2), ['write:high', 'select:low'], 'only the selector drops to low effort');
    assert.ok(efforts.slice(2).every(line => line === 'review:high'));
    const reviews = updates.filter(update => update.stage === 'review');
    assert.ok(reviews.some(update => /readable now/.test(update.detail)) && reviews.some(update => /reviewers/.test(update.detail)));
    assert.ok(reviews.at(-1).done, 'the review stage ends explicitly');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the reader shows who is writing and each stage live, then a finished summary; Claude defaults to medium effort', async () => {
  const { connectionOptions } = (() => { const stub = { exports: {} }; vm.runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? { workspace: { getConfiguration: () => ({ get: (_, f) => f }) } } : require(id), process, __dirname }); return stub.exports; })();
  const state = new Map(), globalState = { get: (k, f) => state.get(k) ?? f };
  const vscodeStub = { workspace: { isTrusted: true, getConfiguration: () => ({ get: (_, f) => f }) } };
  assert.equal(connectionOptions(globalState, 'claude', vscodeStub).effort, 'low', 'Claude writes at low effort unless told otherwise');
  assert.equal(connectionOptions(globalState, 'codex', vscodeStub).effort, 'low');
  state.set('effortChoices', { 'claude:': 'auto' }); assert.equal(connectionOptions(globalState, 'claude', vscodeStub).effort, null, 'an explicit provider default is respected');
  // Panel: a live card while running, a one-line summary afterwards.
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'ai-summary', 'setup-ai']);
  let receive;
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage() {} }), katex: { renderToString: () => '' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  const now = Date.now(), steps = [{ id: 'context', label: 'Read the code and its context', state: 'done', startedAt: now - 9000, endedAt: now - 9000, detail: '2 called definitions · project guide · lookups on' },
    { id: 'think', label: 'Think it through', state: 'active', startedAt: now - 8000, detail: '~1,240 thinking tokens · 1 lookup · file · models/script.py' }, { id: 'write', label: 'Write the explanation', state: 'waiting' }, { id: 'review', label: 'Review difficult blocks', state: 'skipped', detail: 'Off (AI ▾ → Refine)' }];
  receive({ data: { type: 'state', state: { providerLabel: 'Claude Code', level: 'logic', name: 'plan.py', busy: true, run: { state: 'running', title: 'Writing the Logic explanation', provider: 'Claude Code', model: 'claude-opus-5-5', effort: 'medium', lookups: 1, startedAt: now - 9000, steps } } } });
  const card = all(elements.content).find(el => el.className === 'run live');
  const text = all(card).map(el => el.textContent).filter(Boolean);
  assert.ok(text.includes('Think it through'), 'the active stage leads the card');
  assert.ok(text.includes('Claude Code · claude-opus-5-5 · medium effort · 1 Yamori lookup'), 'provider, actual model and effort are visible');
  assert.ok(text.includes('~1,240 thinking tokens · 1 lookup · file · models/script.py'));
  assert.deepEqual(all(card).filter(el => el.className === 'icon').map(el => el.textContent), ['✓', '●', '○', '–']);
  assert.ok(text.includes('0:09'), 'a running timer is shown');
  receive({ data: { type: 'state', state: { providerLabel: 'Claude Code', level: 'logic', name: 'plan.py', result: valid, run: { state: 'done', provider: 'Claude Code', model: 'claude-opus-5-5', effort: 'medium', lookups: 1, startedAt: now - 48000, endedAt: now, steps: steps.map(step => ({ ...step, state: step.state === 'skipped' ? 'skipped' : 'done', endedAt: now })) } } } });
  const summary = all(elements.content).find(el => el.tag === 'summary');
  assert.equal(summary.textContent, 'Done in 0:48 · Claude Code · claude-opus-5-5 · medium effort · 1 Yamori lookup');
});

test('the reader tracks a run through every stage and marks it stopped when the user stops it', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-run-'));
  const commands = new Map(), states = []; let receive, progress, release;
  class Uri { constructor(v) { this.value = v; this.scheme = 'file'; this.fsPath = v.replace('file://', ''); } toString() { return this.value; } static parse(v) { return new Uri(v); } }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  const text = 'x = 1\nprint(x)', doc = { uri: new Uri('file:///sample.py'), languageId: 'python', lineCount: 2, getText: () => text, lineAt: i => ({ text: text.split('\n')[i] }) };
  const editor = { document: doc, selection: new Range(0, 0, 0, 0), setDecorations() {}, revealRange() {} }, noop = () => ({ dispose() {} });
  const vscode = { Uri, Range, Selection: class extends Range { get isEmpty() { return true; } }, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: 2 },
    commands: { registerCommand(id, fn) { commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: true, textDocuments: [doc], asRelativePath: () => 'sample.py', openTextDocument: async () => doc, getConfiguration: () => ({ get: (k, f) => k === 'refinementSteps' ? 1 : f }), onDidChangeTextDocument: noop },
    window: { createStatusBarItem: statusItem, activeTextEditor: editor, visibleTextEditors: [editor], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor: noop, showTextDocument: async () => editor, showErrorMessage(m) { throw new Error(m); }, setStatusBarMessage() {},
      createWebviewPanel: () => ({ reveal() {}, onDidDispose: noop, webview: { postMessage: m => m.type === 'state' && states.push(JSON.parse(JSON.stringify(m.state))), onDidReceiveMessage(fn) { receive = fn; return noop(); } } }) },
    env: { clipboard: { writeText: async () => {} } } };
  const engine = { ...require('./engine'), generate: opts => new Promise((resolve, reject) => { progress = opts.onProgress; release = () => resolve({ ...valid, sections: [{ ...valid.sections[0], startLine: 1, endLine: 2 }], views: { overview: { ...valid, sections: [{ ...valid.sections[0], startLine: 1, endLine: 2 }] } } }); opts.signal.addEventListener('abort', () => reject(new Error('Cancelled.'))); }) };
  const state = new Map([['provider', 'claude'], ['launcherHintShown', true]]), moduleStub = { exports: {} };
  const context = { subscriptions: [], globalStorageUri: { fsPath: temp }, globalState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, secrets: {} };
  try {
    vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout, process, __dirname });
    await moduleStub.exports.activate(context);
    const reading = commands.get('yamori.read')();
    while (!progress) await new Promise(resolve => setTimeout(resolve, 1));
    let run = states.at(-1).run;
    assert.equal(run.state, 'running'); assert.equal(run.provider, 'Claude Code'); assert.equal(run.effort, 'low');
    assert.deepEqual(run.steps.map(step => step.state), ['done', 'waiting', 'waiting', 'waiting']);
    assert.match(run.steps[0].detail, /0 called definitions · no project guide yet/);
    progress({ phase: 'Starting Claude Code', stage: 'start' });
    progress({ phase: 'Reading the code', stage: 'think', model: 'claude-opus-5-5' });
    progress({ phase: 'Thinking', stage: 'think', thinkingTokens: 2048 });
    progress({ phase: 'Looked up file · models/script.py', stage: 'think', lookup: 'Looked up file · models/script.py' });
    run = states.at(-1).run;
    assert.equal(run.model, 'claude-opus-5-5'); assert.equal(run.lookups, 1);
    assert.deepEqual(run.steps.map(step => step.state), ['done', 'active', 'waiting', 'waiting']);
    assert.equal(run.steps[1].detail, '~2,048 thinking tokens · 1 lookup · file · models/script.py');
    progress({ phase: 'Writing the explanation', stage: 'write', characters: 1830 });
    progress({ phase: 'Draft ready', stage: 'review', detail: 'The draft is readable now. Picking blocks worth a second look' });
    run = states.at(-1).run;
    assert.deepEqual(run.steps.map(step => step.state), ['done', 'done', 'done', 'active']);
    assert.equal(run.steps[2].detail, '1,830 characters written');
    release(); await reading;
    run = states.at(-1).run;
    assert.equal(run.state, 'done'); assert.ok(run.steps.every(step => step.state === 'done'));
    // Stopping a request leaves a stopped summary, not a frozen card.
    progress = undefined;
    const again = receive({ type: 'refresh' });
    while (!progress) await new Promise(resolve => setTimeout(resolve, 1));
    progress({ phase: 'Thinking', stage: 'think', thinkingTokens: 10 });
    await receive({ type: 'stop' }); await again;
    run = states.at(-1).run;
    assert.equal(run.state, 'stopped'); assert.equal(run.steps[1].state, 'stopped'); assert.equal(states.at(-1).busy, false);
  } finally { await Promise.all(context.subscriptions.map(d => d?.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); }
});

test('project links and tours come from the map: names a file uses, the block that explains them, and its reading position', async () => {
  const { graph } = await scanFixture(videoProject);
  const explanations = { 'pipeline/plan.py': { logic: { title: 'Plan', summary: 's', sections: [{ title: 'Plan the loops', startLine: 3, endLine: 8, pseudocode: 'x' }, { title: 'Hint', startLine: 10, endLine: 11, pseudocode: 'y' }], hash: 'h' } } };
  assert.deepEqual(projectMap.blockAt(explanations, 'pipeline/plan.py', 11), { index: 1, level: 'logic', title: 'Hint', hash: 'h' });
  assert.equal(projectMap.blockAt(explanations, 'pipeline/plan.py', 1), undefined);
  const links = projectMap.symbolLinks(graph, 'pipeline/write.py', explanations, { files: { 'models/script.py': { purpose: 'Defines script sections.' } } });
  assert.deepEqual(links.map(link => [link.name, link.file, link.line]), [['BRIDGE', 'models/script.py', 3], ['_loop_hint', 'pipeline/plan.py', 10], ['write_blocks', 'pipeline/write.py', 4]], 'strongest dependencies first, then this file');
  assert.equal(links[1].block, 'Hint'); assert.equal(links[1].explained, true); assert.equal(links[0].purpose, 'Defines script sections.'); assert.equal(links[0].explained, false);
  assert.ok(!links.some(link => link.name === 'HOOK'), 'names the file does not use are not links');
  assert.deepEqual(projectMap.tourStep(graph, {}, 'pipeline/plan.py', 'pipeline'), { folder: 'pipeline', steps: ['pipeline/write.py', 'pipeline/plan.py'], index: 1 });
  assert.deepEqual(projectMap.tourStep(graph, {}, 'main.py', 'pipeline').folder, '', 'a file outside the tour folder falls back to the project');
  assert.equal(projectMap.tourStep(graph, {}, 'tests/test_plan.py'), undefined, 'tests have no tour');
});

async function readerHarness(settings = {}, options = {}) {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-tour-')), root = path.join(temp, 'video'), storage = path.join(temp, 'storage');
  for (const [rel, text] of Object.entries(videoProject)) { await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), text); }
  class Uri { constructor(fsPath) { this.fsPath = fsPath; this.scheme = 'file'; } toString() { return 'file://' + this.fsPath; } static file(p) { return new Uri(p); } static parse(v) { const uri = new Uri(decodeURIComponent(v.replace(/^[a-z]+:\/\//, ''))); uri.scheme = v.match(/^([a-z]+):/)?.[1] || 'file'; return uri; } static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); } }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  class MarkdownString { constructor() { this.parts = []; } appendMarkdown(value) { this.parts.push(['md', value]); return this; } appendText(value) { this.parts.push(['text', value]); return this; } }
  for (let i = 0; i < (options.extraFiles || 0); i++) { await fs.mkdir(path.join(root, 'extra'), { recursive: true }); await fs.writeFile(path.join(root, 'extra', 'm' + i + '.py'), 'def f' + i + '():\n    return ' + i + '\n'); }
  const harness = { commands: new Map(), panels: [], generated: [], shown: [], requests: [], prompts: [], warnings: [], answer: undefined, hover: undefined, lens: undefined, root, temp, Uri };
  const noop = () => ({ dispose() {} });
  const walk = async dir => (await fs.readdir(dir, { withFileTypes: true })).flatMap(entry => entry.isDirectory() ? [] : [path.join(dir, entry.name)]).concat(...await Promise.all((await fs.readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => walk(path.join(dir, entry.name)))));
  const slice = (lines, range) => { if (range.start.line === range.end.line) return lines[range.start.line].slice(range.start.character, range.end.character); const out = lines.slice(range.start.line, range.end.line + 1); out[0] = out[0].slice(range.start.character); out[out.length - 1] = out[out.length - 1].slice(0, range.end.character); return out.join('\n'); };
  const docFor = async uri => { const text = await fs.readFile(uri.fsPath, 'utf8'); const lines = text.split('\n'); return { uri, languageId: 'python', isDirty: false, lineCount: lines.length, getText: range => range ? slice(lines, range) : text, lineAt: i => ({ text: lines[i] }),
    getWordRangeAtPosition: (position, pattern) => { for (const match of lines[position.line].matchAll(new RegExp(pattern.source, 'g'))) if (position.character >= match.index && position.character <= match.index + match[0].length) return new Range(position.line, match.index, position.line, match.index + match[0].length); } }; };
  harness.docFor = docFor;
  const vscode = { Uri, RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } }, Range, Selection: class extends Range { get isEmpty() { return true; } }, ThemeColor: class {}, StatusBarAlignment: { Right: 2 }, ViewColumn: { One: 1, Beside: -2, Active: -1 }, TextEditorRevealType: {},
    MarkdownString, Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } }, CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } }, EventEmitter: class { constructor() { this.fired = 0; this.event = () => noop(); } fire() { this.fired++; } dispose() {} },
    languages: { registerHoverProvider: (_, provider) => { harness.hover = provider; return noop(); }, registerCodeLensProvider: (_, provider) => { harness.lens = provider; return noop(); } },
    commands: { registerCommand(id, fn) { harness.commands.set(id, fn); return noop(); } },
    workspace: { isTrusted: options.trusted !== false, workspaceFolders: [{ uri: new Uri(root) }], textDocuments: [], getWorkspaceFolder: uri => uri.fsPath.startsWith(root) ? { uri: new Uri(root) } : undefined, asRelativePath: uri => path.relative(root, uri.fsPath), openTextDocument: docFor,
      findFiles: async pattern => (await walk(root)).filter(file => /package\.json/.test(pattern.pattern) ? false : /\.py$/.test(file)).map(file => new Uri(file)),
      createFileSystemWatcher: () => ({ onDidCreate: noop, onDidDelete: noop, onDidChange: noop, dispose() {} }), getConfiguration: () => ({ get: (key, fallback) => key in settings ? settings[key] : fallback, inspect: () => ({}) }), onDidChangeTextDocument: noop },
    window: { createStatusBarItem: statusItem, activeTextEditor: undefined, visibleTextEditors: [], createTextEditorDecorationType: noop, onDidChangeActiveTextEditor: noop, showErrorMessage(message) { throw new Error(message); }, showInformationMessage: async () => undefined,
      showWarningMessage: async message => { harness.warnings.push(message); return harness.answer; },
      showTextDocument: async (doc, options) => { harness.shown.push([path.relative(root, doc.uri.fsPath), options?.selection?.start.line]); return { document: doc, setDecorations() {}, revealRange() {} }; },
      createWebviewPanel: type => { const panel = { type, messages: [], reveal() {}, onDidDispose: noop, onDidChangeViewState: noop, webview: { postMessage: m => panel.messages.push(JSON.parse(JSON.stringify(m))), onDidReceiveMessage(fn) { panel.receive = fn; return noop(); } } }; harness.panels.push(panel); return panel; } },
    env: { clipboard: { writeText: async () => {} } } };
  harness.vscode = vscode;
  const real = require('./engine');
  harness.models = []; harness.inFlight = 0; harness.peak = 0;
  const engine = { ...real, requestStructured: async ({ prompt, schema, model }) => {
    const kind = schema === real.NOTES_SCHEMA ? 'notes' : schema === real.MAP_SUMMARY_SCHEMA ? 'summary' : 'other';
    harness.requests.push(kind); harness.prompts.push(prompt); harness.models.push(model);
    harness.inFlight++; harness.peak = Math.max(harness.peak, harness.inFlight);
    await new Promise(resolve => setTimeout(resolve, options.noteDelay || 0)); harness.inFlight--;
    const fail = harness.failNotes ?? options.failNotes;
    if (fail) throw new Error(typeof fail === 'string' ? fail : 'Codex is not signed in.');
    if (kind === 'notes') return { raw: JSON.stringify({ files: [...prompt.matchAll(/FILE "([^"]+)" \(numbered/g)].map(match => ({ file: match[1], purpose: 'Purpose of ' + match[1], role: 'stage', terms: [] })) }) };
    if (schema === real.SIMULATION_SCHEMA) { harness.simulations = (harness.simulations || 0) + 1; return { raw: JSON.stringify({ inputs: [{ name: 'blocks', value: "['HOOK', 'x', 'ENDING']" }, { name: 'cover', value: "'assets/cover.png'" }], steps: [{ line: 5, note: 'Start with the hook loop', values: [{ name: 'loops', value: "[{'id': 'L1'}]" }] }, { line: 99, note: 'outside', values: [] }], output: { kind: 'return', value: "[{'id': 'L1'}, {'id': 'L2'}]" }, caveats: 'HOOK and ENDING come from models/script.py.' }), actualModel: 'sim-model' }; }
    return { raw: JSON.stringify({ overview: 'Writes video scripts.', clusters: [], readingPath: [{ file: 'main.py', why: 'Start.' }] }) };
  }, generate: async opts => {
    const rel = path.relative(root, vscode.Uri.parse(opts.source.uri).fsPath), lines = opts.source.text.split('\n').length;
    harness.generated.push(rel);
    const view = { title: 'About ' + rel, summary: 'Explains ' + rel + '.', sections: [{ title: 'Block for ' + rel, startLine: 1, endLine: lines, pseudocode: 'Call _loop_hint for each loop, then add BRIDGE in write_blocks.', lineMap: [] }] };
    return { ...view, views: { overview: view }, requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort };
  }, ...(options.engine ? options.engine(harness) : {}) };
  const state = new Map([['provider', 'codex'], ['launcherHintShown', true]]), moduleStub = { exports: {} };
  harness.context = { subscriptions: [], globalStorageUri: { fsPath: storage }, globalState: { get: (k, f) => state.get(k) ?? f, update: async (k, v) => state.set(k, v) }, secrets: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { require: id => id === 'vscode' ? vscode : id === './engine' ? engine : require(id), module: moduleStub, Buffer, AbortController, setTimeout, clearTimeout, process, __dirname });
  await moduleStub.exports.activate(harness.context);
  harness.exports = moduleStub.exports;
  await harness.commands.get('yamori.map')(new Uri(root));
  harness.guide = harness.panels.find(panel => panel.type === 'yamoriMap');
  harness.readers = () => harness.panels.filter(panel => panel.type === 'yamori');
  harness.last = panel => panel.messages.filter(m => m.type === 'state').at(-1).state;
  harness.guideState = () => harness.guide.messages.filter(m => m.type === 'map').at(-1).state;
  harness.until = async (check, label) => { for (let i = 0; i < 400 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(check(), label); };
  harness.close = async () => { await Promise.all(harness.context.subscriptions.map(d => d?.dispose?.())); await fs.rm(temp, { recursive: true, force: true }); };
  return harness;
}

test('a guide tour shows where each file sits, prepares only the next step, and Next opens it without waiting', async () => {
  const h = await readerHarness({ autoNotes: false });
  try {
    await h.guide.receive({ type: 'openFile', id: 'pipeline/write.py', tour: 'pipeline' });
    const write = h.readers()[0];
    await h.until(() => h.generated.includes('pipeline/plan.py'), 'the next step is prepared in the background');
    await h.until(() => h.last(write).tour?.next?.status === 'ready', 'the tour bar says the next step is ready');
    let tour = h.last(write).tour;
    assert.deepEqual([tour.label, tour.index, tour.total, tour.next.id, tour.prev], ['pipeline/', 0, 2, 'pipeline/plan.py', undefined]);
    assert.deepEqual(tour.usedBy.map(item => item.id), ['main.py']);
    assert.deepEqual(JSON.parse(JSON.stringify(h.generated)), ['pipeline/write.py', 'pipeline/plan.py'], 'exactly one step ahead');
    assert.equal(h.readers().length, 1, 'preparing a step opens no tab');
    await write.receive({ type: 'tourGo', id: '../../etc/passwd' });
    await write.receive({ type: 'tourGo', id: 'pipeline/plan.py' });
    assert.equal(h.readers().length, 2);
    const plan = h.readers()[1];
    await h.until(() => h.last(plan).tour?.index === 1, 'Next keeps the tour');
    tour = h.last(plan).tour;
    assert.equal(tour.prev.id, 'pipeline/write.py'); assert.equal(tour.next, undefined);
    assert.equal(h.generated.length, 2, 'the prepared step opens without another request');
  } finally { await h.close(); }
});

test('files opened outside a tour, or with prefetch off, never prepare other files', async () => {
  const h = await readerHarness({ prefetchNext: false, autoNotes: false });
  try {
    await h.guide.receive({ type: 'openFile', id: 'pipeline/write.py', tour: 'pipeline' });
    await h.until(() => h.last(h.readers()[0]).tour, 'the tour bar still shows');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(JSON.parse(JSON.stringify(h.generated)), ['pipeline/write.py']);
    assert.equal(h.last(h.readers()[0]).tour.next.status, 'waiting');
  } finally { await h.close(); }
  const casual = await readerHarness({ autoNotes: false });
  try {
    await casual.commands.get('yamori.openAt')('file://' + require('node:path').join(casual.root, 'pipeline/write.py'), 4);
    await casual.until(() => casual.last(casual.readers()[0]).tour, 'a casually opened file still knows its place');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(JSON.parse(JSON.stringify(casual.generated)), ['pipeline/write.py'], 'no tour, no background requests');
    assert.equal(casual.last(casual.readers()[0]).focusLine.line, 4, 'openAt focuses the block for that line');
  } finally { await casual.close(); }
});

test('project names in pseudocode open the explanation that defines them', async () => {
  const h = await readerHarness({ prefetchNext: false, autoNotes: false });
  try {
    await h.guide.receive({ type: 'openFile', id: 'pipeline/write.py', tour: 'pipeline' });
    const write = h.readers()[0];
    await h.until(() => h.last(write).symbols?.length, 'links are computed');
    const state = h.last(write), names = state.symbols.map(link => link.name);
    assert.deepEqual(JSON.parse(JSON.stringify(names)), ['BRIDGE', '_loop_hint', 'write_blocks']);
    // A name defined in this file focuses its own block.
    await write.receive({ type: 'openSymbol', index: names.indexOf('write_blocks'), documentKey: state.documentKey });
    assert.equal(h.last(write).focusLine.line, 4); assert.equal(h.readers().length, 1);
    // A name from another file opens that file's explanation at its block.
    await write.receive({ type: 'openSymbol', index: names.indexOf('BRIDGE'), documentKey: 'stale-key' });
    assert.equal(h.readers().length, 1, 'links from an older document are ignored');
    await write.receive({ type: 'openSymbol', index: names.indexOf('BRIDGE'), documentKey: state.documentKey });
    assert.equal(h.readers().length, 2);
    await h.until(() => h.last(h.readers()[1]).focusLine?.line === 3, 'the target opens at the defining line');
    assert.ok(h.generated.includes('models/script.py'), 'an unexplained target is written when its link is clicked');
  } finally { await h.close(); }
});

test('editor hovers and CodeLens show what Yamori knows, with escaped text and only Yamori commands', async () => {
  const path = require('node:path'), fs = require('node:fs/promises');
  const h = await readerHarness({ prefetchNext: false, autoNotes: false });
  try {
    const doc = rel => h.docFor(new h.Uri(path.join(h.root, rel)));
    const plan = await doc('pipeline/plan.py');
    const hover = await h.hover.provideHover(plan, { line: 0, character: 30 });
    assert.ok(hover, 'HOOK has a hover');
    const md = hover.contents.parts.map(([kind, value]) => kind + ':' + value).join('\n');
    assert.match(md, /text:HOOK/); assert.match(md, /text:constant in models\/script.py:1/); assert.match(md, /command:yamori\.openAt\?/); assert.match(md, /command:yamori\.showSource\?/);
    assert.deepEqual(JSON.parse(JSON.stringify(hover.contents.isTrusted)), { enabledCommands: ['yamori.openAt', 'yamori.showSource'] });
    assert.equal(await h.hover.provideHover(plan, { line: 4, character: 10 }), undefined, 'ordinary local names get no hover');
    // AI-written text is appended as text, never as markdown that could run commands.
    const hostile = h.exports.hoverMarkdown({ word: 'x', definitions: [{ kind: 'function', file: 'a.py', line: 1, uri: 'file:///a.py', purpose: '[run](command:workbench.action.terminal.new)' }] }, h.vscode);
    assert.ok(hostile.parts.some(([kind, value]) => kind === 'text' && value.includes('command:workbench')));
    assert.ok(!hostile.parts.some(([kind, value]) => kind === 'md' && value.includes('workbench')));
    // CodeLens: an unexplained mapped file offers one Explain lens with its reading position.
    const main = await doc('main.py');
    let lenses = await h.lens.provideCodeLenses(main);
    assert.deepEqual(JSON.parse(JSON.stringify(lenses.map(lens => [lens.range.start.line, lens.command.title, lens.command.command]))), [[0, 'Yamori · Step 1 of 4 in the project · Explain this file', 'yamori.openAt']]);
    // After an explanation, its block titles sit above the code they explain.
    await h.guide.receive({ type: 'openFile', id: 'pipeline/write.py' });
    await h.until(() => h.generated.includes('pipeline/write.py'), 'explained');
    const write = await doc('pipeline/write.py');
    await h.until(() => true);
    lenses = await h.lens.provideCodeLenses(write);
    assert.deepEqual(JSON.parse(JSON.stringify(lenses.map(lens => [lens.range.start.line, lens.command.title, lens.command.arguments[1]]))), [[0, 'Yamori · Block for pipeline/write.py', 1]]);
    const edited = { ...write, getText: () => write.getText() + '\n# edited' };
    lenses = await h.lens.provideCodeLenses(edited);
    assert.equal(lenses[0].command.title, 'Yamori · The code changed since its explanation · Open', 'block titles are never shown against changed code');
    await h.commands.get('yamori.showSource')(write.uri.toString(), 10);
    assert.deepEqual(JSON.parse(JSON.stringify(h.shown.at(-1))), ['pipeline/write.py', 5], 'source lines are clamped to the file');
    await h.commands.get('yamori.openAt')('https://example.com/x.py', 1);
    assert.ok(!h.readers().some(panel => !panel.messages.length), 'non-file targets are ignored');
  } finally { await h.close(); }
  const off = await readerHarness({ prefetchNext: false, codeLens: false, autoNotes: false });
  try { assert.equal((await off.lens.provideCodeLenses(await off.docFor(new off.Uri(require('node:path').join(off.root, 'main.py'))))).length, 0, 'yamori.codeLens: false shows no lenses'); }
  finally { await off.close(); }
});

test('the reader shows a tour bar, project-name links and jumps to a requested block', () => {
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'ai-summary', 'setup-ai']);
  const sent = []; let receive;
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage: m => sent.push(JSON.parse(JSON.stringify(m))) }), katex: { renderToString: () => '' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  const result = { title: 'Write blocks', summary: 's', sections: [{ title: 'First', startLine: 1, endLine: 3, pseudocode: 'Use _loop_hint on each loop.' }, { title: 'Second', startLine: 4, endLine: 6, pseudocode: 'Add <b>BRIDGE</b> text in write_blocks.' }] };
  const symbols = [{ name: '_loop_hint', file: 'pipeline/plan.py', line: 11, kind: 'function', block: 'Hint', purpose: 'Plans loops.', explained: true }, { name: 'BRIDGE', file: 'models/script.py', line: 3, kind: 'constant', explained: false }, { name: 'write_blocks', file: 'pipeline/write.py', line: 4, kind: 'function', explained: true }];
  const tour = { folder: 'pipeline', label: 'pipeline/', index: 0, total: 2, next: { id: 'pipeline/plan.py', label: 'plan.py', status: 'preparing' }, usedBy: [{ id: 'main.py', label: 'main.py' }], uses: [] };
  receive({ data: { type: 'state', state: { providerLabel: 'Codex', level: 'logic', name: 'pipeline/write.py', documentKey: 'doc', result, symbols, tour, focusLine: { line: 5, token: 1 } } } });
  const bar = all(elements.content).find(el => el.className === 'tour');
  const barText = all(bar).map(el => el.textContent).filter(Boolean);
  assert.ok(barText.includes('pipeline/ · Step 1 of 2') && barText.includes('Next: plan.py →') && barText.includes('preparing…'));
  all(bar).find(el => el.textContent === 'Next: plan.py →').events.click(); assert.deepEqual(sent.at(-1), { type: 'tourGo', id: 'pipeline/plan.py' });
  all(bar).find(el => el.textContent === 'main.py').events.click(); assert.deepEqual(sent.at(-1), { type: 'tourGo', id: 'main.py' });
  // The requested line opened the second block, whose names are links.
  const links = all(elements.content).filter(el => el.className === 'symbol');
  assert.deepEqual(links.map(el => el.textContent), ['BRIDGE', 'write_blocks'], 'the focused (second) block is shown, with its names linked');
  assert.ok(all(elements.content).some(el => el.textContent === 'Add <b>') && !all(elements.content).some(el => el.tag === 'b'), 'markup in pseudocode stays text');
  assert.match(links[0].title, /not explained yet; click to explain it/); assert.match(links[1].title, /click to show its block/);
  receive({ data: { type: 'state', state: { providerLabel: 'Codex', level: 'logic', name: 'pipeline/write.py', documentKey: 'doc', result: { ...result, sections: [result.sections[0]] }, symbols, tour } } });
  const first = all(elements.content).find(el => el.className === 'symbol');
  assert.equal(first.textContent, '_loop_hint'); assert.match(first.title, /function in pipeline\/plan.py:11 · "Hint" · Plans loops\. · click to open its explanation/);
  first.events.click({ stopPropagation() {}, preventDefault() {} }); assert.deepEqual(sent.at(-1), { type: 'openSymbol', index: 0, documentKey: 'doc' });
});

test('AI notes are written automatically when the guide maps a project: quietly, once per change, and never in a loop', async () => {
  const path = require('node:path'), fs = require('node:fs/promises');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const h = await readerHarness({ prefetchNext: false });
  try {
    await h.until(() => h.requests.length >= 2 && !h.guideState().notesBusy, 'notes and the project summary are written without asking');
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests)), ['notes', 'summary']); assert.equal(h.warnings.length, 0, 'no dialog for a normal project');
    assert.deepEqual(h.guideState().notes, { total: 4, done: 4, outdated: 0 }); assert.equal(h.guideState().overview, 'Writes video scripts.');
    assert.ok(h.guideState().autoNotes);
    await h.guide.receive({ type: 'rescan' }); await pause(1700);
    assert.equal(h.requests.length, 2, 'an unchanged project writes nothing more');
    await fs.appendFile(path.join(h.root, 'pipeline/plan.py'), '\nEXTRA = 1\n');
    await h.guide.receive({ type: 'rescan' });
    await h.until(() => h.requests.length === 3 && !h.guideState().notesBusy, 'a changed file is noted again');
    await pause(50);
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests.slice(2))), ['notes'], 'only the changed file, without a new summary');
    assert.match(h.prompts.at(-1), /FILE "pipeline\/plan.py"/); assert.doesNotMatch(h.prompts.at(-1), /FILE "main.py"/);
  } finally { await h.close(); }
  const failing = await readerHarness({ prefetchNext: false }, { failNotes: 'The provider took too long. Retry or choose another provider.' });
  try {
    await failing.until(() => /could not be written automatically: The provider took too long\. .*Press Write AI notes to retry\./.test(failing.guideState().error || ''), 'a failure is explained once');
    await failing.guide.receive({ type: 'rescan' }); await pause(1700);
    assert.equal(failing.requests.length, 1, 'no automatic retries after a failure');
  } finally { await failing.close(); }
  // Signed out: notes wait for Set up AI instead of failing, then start by themselves.
  const signedOut = await readerHarness({ prefetchNext: false }, { failNotes: true });
  try {
    await signedOut.until(() => signedOut.guideState().waitingForAI && !signedOut.guideState().notesBusy, 'a sign-in problem waits for setup');
    assert.equal(signedOut.guideState().error, '', 'waiting is not shown as an error');
    signedOut.failNotes = false;
    await signedOut.guide.receive({ type: 'setup' });
    const setupPanel = signedOut.panels.find(panel => panel.type === 'yamoriSetup');
    assert.ok(setupPanel, 'Set up AI in the guide opens the setup screen');
    await setupPanel.receive({ type: 'primary', provider: 'codex' });
    await signedOut.until(() => signedOut.guideState().notes.done === 4 && !signedOut.guideState().notesBusy, 'notes start once the AI is ready');
    assert.equal(signedOut.guideState().waitingForAI, false);
  } finally { await signedOut.close(); }
  const big = await readerHarness({ prefetchNext: false }, { extraFiles: 125 });
  try {
    await big.until(() => big.warnings.length === 1, 'large projects ask first');
    assert.match(big.warnings[0], /^This project has 129 files without AI notes\. Write AI notes for 129 files/);
    await big.until(() => /paused/.test(big.guideState().error || ''), 'declining pauses automatic notes');
    await big.guide.receive({ type: 'rescan' }); await pause(1700);
    assert.equal(big.requests.length, 0); assert.equal(big.warnings.length, 1, 'it asks only once');
  } finally { await big.close(); }
  const quiet = await readerHarness({ prefetchNext: false, autoNotes: false });
  try { await pause(1700); assert.equal(quiet.requests.length, 0, 'the setting keeps notes manual'); }
  finally { await quiet.close(); }
  // Notes are tool-free requests that run no project code, so Restricted Mode writes them too.
  const restricted = await readerHarness({ prefetchNext: false }, { trusted: false });
  try { await restricted.until(() => restricted.requests.length >= 2 && !restricted.guideState().notesBusy, 'Restricted Mode writes notes automatically'); assert.ok(restricted.guideState().autoNotes); }
  finally { await restricted.close(); }
});

test('quick jobs use a fast model: the Overview is written in parallel, Logic answers carry no companion, and line maps are compact', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-fast-'));
  try {
    const log = path.join(dir, 'requests.jsonl'), binary = path.join(dir, 'claude.js');
    const logic = { ...valid, sections: [{ ...valid.sections[0], lineMap: [[1, 10, 10], [2, 11, 11]] }] };
    const overview = { title: 'Overview', summary: 'Short.', sections: [{ title: 'Print', startLine: 10, endLine: 11, pseudocode: 'Print a number', lineMap: [[1, 11, 11], [7, 10, 10]] }] };
    await fs.writeFile(binary, `const a=process.argv.slice(2),fs=require('fs');if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
let prompt='';process.stdin.on('data',d=>prompt+=d).on('end',()=>{const schema=JSON.parse(a[a.indexOf('--json-schema')+1]),model=a.includes('--model')?a[a.indexOf('--model')+1]:'';
const kind=schema.properties.blocks?'select':schema.properties.score?'review':/Detail: overview\\./.test(prompt)?'overview':'logic';
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind,model,effort:a.includes('--effort')?a[a.indexOf('--effort')+1]:null,views:!!schema.properties.views,link:schema.properties.sections?.items?.properties?.lineMap?.items,companions:/LOWER DETAIL VIEWS/.test(prompt),triple:/\\[pseudocodeLine, startLine, endLine\\] triple/.test(prompt)})+'\\n');
const out=kind==='select'?{blocks:[]}:kind==='review'?{score:1,faithful:true,issues:[]}:kind==='overview'?{...${JSON.stringify(overview)},views:{}}:${JSON.stringify(logic)};
setTimeout(()=>process.stdout.write(JSON.stringify({type:'result',structured_output:out,modelUsage:{[model||'claude-opus-test']:{}}})),kind==='logic'?300:50);});`);
    const read = async () => (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const fast = { model: 'haiku', effort: 'low' };
    const result = await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'medium', fast, refinementSteps: 1 });
    let calls = await read();
    const main = calls.find(call => call.kind === 'logic'), side = calls.find(call => call.kind === 'overview');
    assert.deepEqual([main.model, main.effort, main.views, main.companions], ['opus', 'medium', false, false], 'the Logic answer carries no companion view');
    assert.deepEqual([side.model, side.effort], ['haiku', 'low'], 'the Overview is written by the fast model');
    assert.deepEqual(main.link, { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 }); assert.ok(main.triple, 'the prompt asks for compact triples');
    assert.deepEqual(calls.find(call => call.kind === 'select').model, 'haiku', 'picking blocks is a quick job');
    assert.equal(result.views.overview.title, 'Overview'); assert.equal(result.views.overview.model, 'haiku');
    assert.deepEqual(result.views.overview.sections[0].lineMap, [{ pseudocodeLine: 1, startLine: 11, endLine: 11 }], 'a fast model\'s one bad link is dropped, not the whole Overview');
    assert.equal(result.views.overview.requestedModel, 'opus', 'the companion is cached under the reader\'s own settings');
    assert.deepEqual(result.sections[0].lineMap, [{ pseudocodeLine: 1, startLine: 10, endLine: 10 }, { pseudocodeLine: 2, startLine: 11, endLine: 11 }], 'triples are stored as readable objects');
    await fs.writeFile(log, '');
    await generate({ source, level: 'overview', provider: 'claude', cliPath: binary, model: 'opus', effort: 'medium', fast });
    calls = await read();
    assert.deepEqual(calls.map(call => [call.kind, call.model]), [['overview', 'haiku']], 'an Overview-level explanation is a single quick job');
    await fs.writeFile(log, '');
    await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', fast, edit: { section: valid.sections[0], draft: 'x', instruction: '' } });
    calls = await read();
    assert.deepEqual(calls.map(call => [call.kind, call.model]), [['logic', 'opus']], 'edits are not quick jobs and need no parallel Overview');
    await fs.writeFile(log, '');
    await generate({ source, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus' });
    calls = await read();
    assert.deepEqual(calls.map(call => [call.kind, call.views, call.companions]), [['logic', true, true]], 'without a fast model the companion stays in the same answer');
    // Codex: the fast model comes from its own catalog.
    const codex = path.join(dir, 'codex');
    await fs.writeFile(codex, `#!${process.execPath}
const out=e=>process.stdout.write(JSON.stringify(e)+'\\n');require('readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);
if(q.id===1)out({id:1,result:{}});if(q.id===4)out({id:4,result:{data:[{model:'big',displayName:'Big',description:'Frontier intelligence.',supportedReasoningEfforts:[{reasoningEffort:'low'}]},{model:'quick',displayName:'Quick',description:'Fast and affordable model for easier tasks.',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]}]}});});`);
    await fs.chmod(codex, 0o755);
    assert.deepEqual(await realFastModel('codex', codex), { model: 'quick', effort: 'low' });
    assert.deepEqual(await realFastModel('claude'), { model: 'haiku', effort: 'low' });
    assert.equal(await realFastModel('claude', '', 'off'), undefined, 'off keeps every job on the main model');
    assert.deepEqual(await realFastModel('claude', '', 'sonnet'), { model: 'sonnet', effort: 'low' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('AI notes use the fast model and run three batches at a time', async () => {
  const h = await readerHarness({ prefetchNext: false }, { extraFiles: 60, noteDelay: 80 });
  try {
    await h.until(() => h.requests.includes('summary') && !h.guideState().notesBusy, 'notes finish');
    const notes = h.requests.filter(kind => kind === 'notes').length;
    assert.ok(notes >= 3, 'the project needs several batches');
    assert.equal(h.peak, 3, 'three batches run at once');
    assert.ok(h.models.every(model => model === 'fast-test'), 'every note request uses the fast model');
    assert.equal(h.guideState().notes.done, h.guideState().notes.total);
  } finally { await h.close(); }
});

test('main-model answers keep strict step links; fast-model answers drop only the bad link', () => {
  const answer = { title: 't', summary: 's', sections: [{ title: 'a', startLine: 10, endLine: 11, pseudocode: 'Set x\n\nPrint x', lineMap: [[1, 10, 10], [2, 10, 10], [3, 11, 11], [3, 10, 10], [9, 10, 10]] }] };
  assert.throws(() => parseResult(JSON.stringify(answer), source), /Invalid step source references/, 'the main model gets no silent repairs');
  const lenient = parseResult(JSON.stringify(answer), source, { dropInvalidLinks: true });
  assert.deepEqual(lenient.sections[0].lineMap.map(link => link.pseudocodeLine), [1, 3], 'blank, duplicate and out-of-range links are dropped');
  assert.throws(() => parseResult(JSON.stringify({ ...answer, sections: [{ ...answer.sections[0], startLine: 1 }] }), source, { dropInvalidLinks: true }), /invalid source references/, 'block ranges stay strict');
});

const pythonAvailable = (() => { try { require('node:child_process').execFileSync('python3', ['-c', 'import sys'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const pillowAvailable = pythonAvailable && (() => { try { require('node:child_process').execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('unit tests are found in Python and JS files and linked to the functions they call', async () => {
  const indexer = new projectMap.Indexer();
  const py = await indexer.extract('tests/test_plan.py', 'import unittest\nfrom pipeline.plan import plan_loops, _loop_hint\n\ndef test_first_loop():\n    assert plan_loops(["HOOK", "x", "ENDING"])[0]["id"] == "L1"\n\nclass TestHint(unittest.TestCase):\n    def test_skip(self):\n        self.assertEqual(_loop_hint({"id": "L1"}), "")\n\nclass Helper:\n    def test_not_a_test(self):\n        pass\n');
  assert.deepEqual(py.tests.map(test => [test.name, test.line, test.end]), [['test_first_loop', 4, 5], ['TestHint::test_skip', 8, 9]]);
  assert.ok(py.tests[0].calls.includes('plan_loops') && py.tests[1].calls.includes('_loop_hint'));
  const js = await indexer.extract('src/math.test.ts', "import { square } from './math';\nit('squares', () => { expect(square(3)).toBe(9); });\ntest('squares zero', () => { expect(square(0)).toBe(0); });\n");
  assert.deepEqual(js.tests.map(test => test.name), ['squares', 'squares zero']); assert.ok(js.tests[0].calls.includes('square'));
  const { graph } = await scanFixture(videoProject);
  assert.equal(graph.version, projectMap.GRAPH_VERSION);
  const found = projectMap.testsFor(graph, 'pipeline/plan.py', 1, 12);
  assert.deepEqual(found.map(test => [test.id, test.function, test.functionLine, test.functionEnd]), [['tests/test_plan.py::test_first_loop', 'plan_loops', 3, 8]]);
  assert.deepEqual(projectMap.testsFor(graph, 'pipeline/plan.py', 10, 12), [], '_loop_hint has no test');
  assert.deepEqual(projectMap.testsFor(graph, 'tests/test_plan.py', 1, 5), [], 'tests are not tested');
  assert.equal(projectMap.valueKind("'assets/cat.PNG'"), 'image'); assert.equal(projectMap.valueKind('"report.pdf"'), 'document'); assert.equal(projectMap.valueKind("b'\\x89PNG'"), 'bytes'); assert.equal(projectMap.valueKind('42'), undefined);
});

test('the Python runner records a function\'s real inputs, steps and output under one test', { skip: !pythonAvailable && 'python3 is not installed' }, async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-runner-'));
  try {
    await fs.mkdir(path.join(root, 'pkg')); await fs.mkdir(path.join(root, 'tests')); await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'pkg', '__init__.py'), '');
    await fs.writeFile(path.join(root, 'pkg', 'work.py'), 'def total(items, path):\n    acc = 0\n    for item in items:\n        acc += item\n    return {"total": acc, "file": path}\n\n\ndef load(path, data):\n    if not data:\n        raise ValueError("empty")\n    return len(data)\n');
    await fs.writeFile(path.join(root, 'tests', 'test_work.py'), 'import unittest\nfrom pkg.work import total, load\n\ndef test_total():\n    assert total([1, 2], "assets/cover.png")["total"] == 3\n\ndef test_wrong():\n    assert total([1], "x.pdf")["total"] == 2, "expected 2"\n\ndef test_needs_fixture(tmp_path):\n    pass\n\nclass TestLoad(unittest.TestCase):\n    def test_empty(self):\n        with self.assertRaises(ValueError):\n            load("notes.txt", b"")\n');
    if (pillowAvailable) require('node:child_process').execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB', (32, 16)).save(${JSON.stringify(path.join(root, 'assets', 'cover.png'))})`]);
    const run = async (testName, fn, line, end) => {
      const request = path.join(root, 'request.json'), output = path.join(root, 'result.json');
      await fs.writeFile(request, JSON.stringify({ root, testFile: path.join(root, 'tests', 'test_work.py'), testName, target: { file: path.join(root, 'pkg', 'work.py'), function: fn, line, end } }));
      await runProcess('python3', [path.join(__dirname, 'runner', 'trace.py'), request, output], '', { cwd: root, timeout: 30000 });
      return JSON.parse(await fs.readFile(output, 'utf8'));
    };
    const ok = await run('test_total', 'total', 1, 5);
    assert.equal(ok.outcome, 'passed'); assert.equal(ok.calls.length, 1);
    const call = ok.calls[0];
    assert.deepEqual(call.inputs.map(value => [value.name, value.repr]), [['items', '[1, 2]'], ['path', "'assets/cover.png'"]]);
    assert.equal(call.inputs[1].kind, 'image');
    if (pillowAvailable) assert.match(call.inputs[1].detail, /cover\.png · \d+ bytes · 32×16 PNG/);
    assert.deepEqual(call.steps.map(step => step.line), [2, 3, 4, 3, 4, 3, 5], 'every executed line, loops included');
    assert.deepEqual(call.steps[0].changed.map(value => [value.name, value.repr]), [['acc', '0']], 'a line is credited with the changes it made');
    assert.deepEqual(call.steps[2].changed.map(value => value.repr), ['1']);
    assert.equal(call.output.repr, "{'total': 3, 'file': 'assets/cover.png'}");
    const wrong = await run('test_wrong', 'total', 1, 5);
    assert.equal(wrong.outcome, 'failed'); assert.match(wrong.message, /expected 2/); assert.equal(wrong.calls[0].inputs[1].kind, 'document');
    const fixture = await run('test_needs_fixture', 'total', 1, 5);
    if (fixture.runner === 'plain') assert.match(fixture.message, /needs pytest fixtures \(tmp_path\)/);
    const unit = await run('TestLoad::test_empty', 'load', 8, 11);
    assert.equal(unit.outcome, 'passed'); assert.equal(unit.calls[0].error.type, 'ValueError'); assert.equal(unit.calls[0].inputs[1].kind, 'bytes');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a block runs its unit test for real once allowed, and simulates in Restricted Mode', { skip: !pythonAvailable && 'python3 is not installed' }, async () => {
  const h = await readerHarness({ prefetchNext: false, autoNotes: false, pythonPath: 'python3' });
  try {
    await h.guide.receive({ type: 'openFile', id: 'pipeline/plan.py' });
    const reader = h.readers()[0];
    await h.until(() => Object.keys(h.last(reader).blockTests || {}).length, 'the block knows its tests');
    let state = h.last(reader);
    assert.deepEqual(JSON.parse(JSON.stringify(state.blockTests[0])), [{ id: 'tests/test_plan.py::test_first_loop', name: 'test_first_loop', function: 'plan_loops', file: 'tests/test_plan.py', language: 'python' }]);
    assert.equal(state.canRunTests, true);
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/../../etc::x', documentKey: state.documentKey });
    assert.equal(h.warnings.length, 0, 'unknown tests are ignored');
    h.answer = 'Always run tests in this folder';
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/test_plan.py::test_first_loop', documentKey: state.documentKey });
    assert.equal(h.warnings.length, 1); assert.match(h.warnings[0], /^Run the unit test test_first_loop\? Yamori will run your project's test code with python3/);
    let run = h.last(reader).runs[0];
    assert.equal(run.mode, 'real'); assert.equal(run.outcome, 'passed', run.message);
    assert.deepEqual(run.calls[0].inputs.map(value => [value.name, value.repr]), [['blocks', "['HOOK', 'x', 'ENDING']"]]);
    assert.ok(run.calls[0].steps.length >= 3); assert.match(run.calls[0].output.repr, /'id': 'L1'/);
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/test_plan.py::test_first_loop', documentKey: state.documentKey });
    assert.equal(h.warnings.length, 1, '"Always" is remembered for the folder');
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/test_plan.py::test_first_loop', documentKey: state.documentKey, simulate: true });
    run = h.last(reader).runs[0];
    assert.equal(run.mode, 'simulated'); assert.equal(run.reason, 'You asked for a simulation.');
    assert.deepEqual(run.calls[0].steps.map(step => step.line), [5], 'simulated steps stay inside the function');
    assert.equal(run.calls[0].inputs[1].emoji, '🖼️'); assert.match(run.calls[0].inputs[1].guidance, /path to an image file/);
    await reader.receive({ type: 'closeRun', index: 0 });
    assert.equal(h.last(reader).runs[0], undefined);
  } finally { await h.close(); }
  const restricted = await readerHarness({ prefetchNext: false, autoNotes: false }, { trusted: false });
  try {
    await restricted.guide.receive({ type: 'openFile', id: 'pipeline/plan.py' });
    const reader = restricted.readers()[0];
    await restricted.until(() => Object.keys(restricted.last(reader).blockTests || {}).length, 'tests are listed in Restricted Mode');
    const state = restricted.last(reader);
    assert.equal(state.canRunTests, false);
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/test_plan.py::test_first_loop', documentKey: state.documentKey });
    const run = restricted.last(reader).runs[0];
    assert.equal(run.mode, 'simulated'); assert.match(run.reason, /Restricted Mode/); assert.equal(restricted.warnings.length, 0, 'no code runs and nothing is asked');
  } finally { await restricted.close(); }
});

test('the run cell shows In, Out and steps that highlight the pseudocode, with file values as emoji', () => {
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'ai-summary', 'setup-ai']);
  const sent = []; let receive;
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage: m => sent.push(JSON.parse(JSON.stringify(m))) }), katex: { renderToString: () => '' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  const result = { title: 'Totals', summary: 's', sections: [{ title: 'Add the items', startLine: 1, endLine: 5, pseudocode: 'Start the total at 0.\nFor each item:\n    Add it to the total.\nReturn the total with the file.', lineMap: [{ pseudocodeLine: 1, startLine: 2, endLine: 2 }, { pseudocodeLine: 2, startLine: 3, endLine: 3 }, { pseudocodeLine: 3, startLine: 4, endLine: 4 }, { pseudocodeLine: 4, startLine: 5, endLine: 5 }] }] };
  const image = { name: 'path', repr: "'assets/cover.png'", type: 'str', kind: 'image', detail: 'cover.png · 157 bytes · 32×16 PNG', emoji: '🖼️', kindLabel: 'Image', guidance: 'A path to an image file.' };
  const runs = { 0: { id: 't::test_total', name: 'test_total', function: 'total', state: 'done', mode: 'real', outcome: 'passed', durationMs: 12, python: '3.14.4', calls: [{ inputs: [{ name: 'items', repr: '[1, 2]', type: 'list', size: 2 }, image], steps: [{ line: 2, changed: [{ name: 'acc', repr: '0', type: 'int' }] }, { line: 3, changed: [{ name: 'item', repr: '<b>1</b>', type: 'int' }] }, { line: 4, changed: [{ name: 'acc', repr: '1', type: 'int' }] }], output: { name: 'return', repr: "{'total': 3}", type: 'dict' } }] } };
  const state = { providerLabel: 'Codex', level: 'logic', name: 'pkg/work.py', documentKey: 'doc', canRunTests: true, result, blockTests: { 0: [{ id: 't::test_total', name: 'test_total', function: 'total', file: 'tests/test_work.py', language: 'python' }] }, runs };
  receive({ data: { type: 'state', state } });
  const chip = all(elements.content).find(el => el.className === 'test-chip');
  assert.equal(chip.textContent, '▸ test_total'); assert.equal(chip.title, 'Run test_total from tests/test_work.py and watch total step by step');
  chip.events.click(); assert.deepEqual(sent.at(-1), { type: 'runTest', index: 0, id: 't::test_total', documentKey: 'doc' });
  const cell = all(elements.content).find(el => el.className === 'run-cell');
  const text = all(cell).map(el => el.textContent).filter(Boolean);
  assert.ok(text.includes('Real run') && text.includes('passed · 12 ms · Python 3.14.4'));
  assert.ok(text.includes("{'total': 3}"), 'Out shows the return value');
  const file = all(cell).find(el => el.className === 'value file');
  assert.equal(all(file).find(el => el.className === 'value-emoji').textContent, '🖼️');
  assert.match(file.title, /Image\n'assets\/cover.png'\ncover.png · 157 bytes · 32×16 PNG\nA path to an image file\./);
  assert.ok(text.includes('Step 1 / 3 · source line 2'));
  let rows = all(elements.content).filter(el => /code-line/.test(el.className));
  assert.ok(/run-current/.test(rows[0].className) && !/run-current/.test(rows[1].className), 'step 1 highlights the pseudocode line linked to source line 2');
  cell.events.keydown({ key: 'ArrowRight', preventDefault() {} });
  const after = all(elements.content);
  rows = after.filter(el => /code-line/.test(el.className));
  assert.ok(/run-current/.test(rows[1].className), 'the next step moves the highlight');
  assert.ok(after.some(el => el.textContent === '<b>1</b>') && !after.some(el => el.tag === 'b'), 'values are text, never markup');
  receive({ data: { type: 'state', state: { ...state, canRunTests: false, runs: { 0: { ...runs[0], mode: 'simulated', outcome: 'simulated', caveats: 'Unknown helper.', calls: [{ ...runs[0].calls[0], steps: [{ line: 3, note: 'Loop over items', changed: [] }] }] } } } } });
  const simulated = all(elements.content).find(el => /run-cell simulated/.test(el.className));
  const simText = all(simulated).map(el => el.textContent).filter(Boolean);
  assert.ok(simText.includes('Simulated by AI, not a real run') && simText.includes('Caveats: Unknown helper.') && simText.includes('Loop over items'));
  assert.match(all(elements.content).find(el => el.className === 'test-chip').title, /simulated by AI/);
});

test('monorepo sub-projects resolve `src.` imports and run tests from their own folder and .venv', { skip: !pythonAvailable && 'python3 is not installed' }, async () => {
  const ctx = projectMap.resolutionContext(['research/agent/mcp_server/src/app/decisions_handler.py', 'research/agent/mcp_server/src/config/constants.py', 'research/agent/mcp_server/tests/test_decisions.py', 'tools/utils.py', 'tools/run.py']);
  const resolve = (from, spec, names = []) => projectMap.resolveImport(from, { kind: 'module', spec, names }, ctx);
  assert.deepEqual(resolve('research/agent/mcp_server/tests/test_decisions.py', 'src.app.decisions_handler'), ['research/agent/mcp_server/src/app/decisions_handler.py'], 'tests import from their sub-project root');
  assert.deepEqual(resolve('research/agent/mcp_server/src/app/decisions_handler.py', 'src.config.constants'), ['research/agent/mcp_server/src/config/constants.py']);
  assert.deepEqual(resolve('tools/run.py', 'utils'), ['tools/utils.py'], 'a script\'s sibling module comes first');
  const fs = require('node:fs/promises'), path = require('node:path');
  const h = await readerHarness({ prefetchNext: false, autoNotes: false });
  try {
    const python = require('node:child_process').execFileSync('python3', ['-c', 'import sys; print(sys.executable)']).toString().trim();
    await fs.writeFile(path.join(h.root, 'pyproject.toml'), '[project]\nname = "video"\n');
    await fs.mkdir(path.join(h.root, '.venv', 'bin'), { recursive: true }); await fs.symlink(python, path.join(h.root, '.venv', 'bin', 'python'));
    await h.guide.receive({ type: 'openFile', id: 'pipeline/plan.py' });
    const reader = h.readers()[0];
    await h.until(() => Object.keys(h.last(reader).blockTests || {}).length, 'tests listed');
    h.answer = 'Run';
    await reader.receive({ type: 'runTest', index: 0, id: 'tests/test_plan.py::test_first_loop', documentKey: h.last(reader).documentKey });
    assert.ok(h.warnings[0].includes(path.join(h.root, '.venv', 'bin', 'python')), 'the project\'s own .venv runs the test');
    assert.equal(h.last(reader).runs[0].outcome, 'passed', h.last(reader).runs[0].message);
  } finally { await h.close(); }
});

test('a sign-in started in Setup continues by itself once it works, and coming back to the window re-checks', async () => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const terminals = [], panels = [], ready = [];
  let closeTerminal, focusWindow;
  const api = { Uri: { parse: value => value }, ViewColumn: { Active: -1, One: 1 }, workspace: { isTrusted: true, getConfiguration: () => ({ get: (_, fallback) => fallback }) },
    window: { createTerminal(options) { const t = { options, show() {}, dispose() {} }; terminals.push(t); return t; }, onDidCloseTerminal(fn) { closeTerminal = fn; return { dispose() {} }; }, onDidChangeWindowState(fn) { focusWindow = fn; return { dispose() {} }; },
      createWebviewPanel(type) { const panel = { type, messages: [], reveal() {}, dispose() { panel.disposed = true; panel.closed?.(); }, onDidDispose(fn) { panel.closed = fn; }, webview: { postMessage: m => panel.messages.push(JSON.parse(JSON.stringify(m))), onDidReceiveMessage(fn) { panel.receive = fn; } } }; panels.push(panel); return panel; } } };
  const stub = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? api : require(id), Buffer, AbortController, setTimeout, clearTimeout, process, __dirname });
  const values = new Map(), context = { subscriptions: [], globalState: { get: (k, f) => values.get(k) ?? f, update: async (k, v) => values.set(k, v) } };
  const statuses = { claude: { installed: false, signedIn: false, ready: false, problem: 'Not installed' }, codex: { installed: true, signedIn: false, ready: false, problem: 'Not signed in', path: '/usr/local/bin/codex' } };
  let checks = 0, opened = 0;
  const setup = stub.exports.createSetup(context, { api, status: async owner => { checks++; return statuses[owner]; }, onReady: owner => ready.push(owner) });
  assert.equal(await setup.ready(), false, 'no AI chosen yet');
  await setup.show({ pending: { label: 'explain a.py', run: async () => { opened++; } } });
  const panel = panels[0], last = () => panel.messages.at(-1).state;
  assert.match(panel.webview.html, /<title>Set up Yamori<\/title>/); assert.doesNotMatch(panel.webview.html, /innerHTML/);
  assert.deepEqual(last().cards.map(card => card.action.label), ['Sign in with ChatGPT', 'Install Claude Code']);
  await panel.receive({ type: 'primary', provider: 'codex' });
  assert.deepEqual([...terminals[0].options.shellArgs], ['login']);
  const before = checks; await focusWindow({ focused: true }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(checks > before, 'returning to the window re-checks'); assert.equal(opened, 0, 'still signed out: nothing continues');
  statuses.codex = { installed: true, signedIn: true, ready: true, account: 'ChatGPT account', path: '/usr/local/bin/codex' };
  closeTerminal(terminals[0]);
  for (let i = 0; i < 100 && !opened; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(opened, 1, 'the waiting file opens'); assert.deepEqual(ready, ['codex']); assert.equal(values.get('provider'), 'codex'); assert.equal(panel.disposed, true);
  assert.equal(await setup.ready(), true);
  closeTerminal({}); assert.equal(terminals.length, 1, 'other terminals are ignored');
  setup.dispose();
});

test('parts for parallel writing are whole definitions of similar size, planned locally', () => {
  const { planParts } = projectMap;
  const lines = n => Array.from({ length: n }, (_, i) => 'x' + i).join('\n');
  // 120 lines: imports, three functions (one decorated), a small tail.
  const text = lines(120).split('\n');
  text[29] = '@cache'; text[30] = '# Build the plan.';
  const defs = [{ name: 'load', kind: 'function', line: 11, end: 30 }, { name: 'plan', kind: 'function', line: 32, end: 70 }, { name: 'helper', kind: 'function', line: 40, end: 45 }, { name: 'LIMIT', kind: 'constant', line: 5, end: 5 }, { name: 'write', kind: 'function', line: 71, end: 115 }];
  const parts = planParts(defs, text.join('\n'), 1, { maxParts: 5, minLines: 25 });
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), [
    { startLine: 1, endLine: 29, names: ['load'] },
    { startLine: 30, endLine: 70, names: ['plan'] },
    { startLine: 71, endLine: 120, names: ['write'] }
  ], 'decorators and comments stay with their definition; nested helpers stay inside; a short tail joins the last part');
  assert.equal(planParts(defs, lines(40), 1), undefined, 'too small for two parts');
  assert.equal(planParts(defs, text.join('\n'), 1, { maxParts: 1 }), undefined, 'one request means no parts');
  // A class longer than a part splits into its methods; the header stays with the first.
  const big = [{ name: 'Store', kind: 'class', line: 3, end: 200 }, ...[10, 60, 110, 160].map((line, i) => ({ name: 'm' + i, kind: 'function', line, end: line + 40 }))];
  const split = planParts(big, lines(200), 1, { maxParts: 4, minLines: 25 });
  assert.deepEqual(JSON.parse(JSON.stringify(split.map(part => [part.startLine, part.endLine, part.names]))), [[1, 59, ['Store.m0']], [60, 109, ['Store.m1']], [110, 159, ['Store.m2']], [160, 200, ['Store.m3']]]);
  // A selection keeps original line numbers.
  const offset = planParts(defs.map(def => ({ ...def, line: def.line + 100, end: def.end + 100 })), text.join('\n'), 101, { maxParts: 5, minLines: 25 });
  assert.deepEqual(JSON.parse(JSON.stringify(offset.map(part => [part.startLine, part.endLine]))), [[101, 129], [130, 170], [171, 220]]);
});

test('parallel parts: at most N at once, stitched in order, kept inside their lines, retried once, else one whole-file request', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-parts-'));
  try {
    const log = path.join(dir, 'calls.jsonl'), binary = path.join(dir, 'claude.js'), marker = path.join(dir, 'failed-once');
    await fs.writeFile(binary, `const a=process.argv.slice(2),fs=require('fs');if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
let prompt='';process.stdin.on('data',d=>prompt+=d).on('end',()=>{const schema=JSON.parse(a[a.indexOf('--json-schema')+1]),model=a.includes('--model')?a[a.indexOf('--model')+1]:'';
const part=prompt.match(/PARALLEL PART (\\d+) OF (\\d+): .*?source lines (\\d+)–(\\d+)/);
const kind=schema.properties.blocks?'select':schema.properties.score?'review':/Detail: overview\\./.test(prompt)?'overview':part?'part':'whole';
const started=Date.now();
const finish=out=>setTimeout(()=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind,model,part:part&&+part[1],started,ended:Date.now()})+'\\n');process.stdout.write(JSON.stringify({type:'result',structured_output:out,modelUsage:{[model||'claude-opus-test']:{}}}))},kind==='part'?150:20);
if(kind==='part'&&(model==='broken-parts'||(part[1]==='2'&&!fs.existsSync(${JSON.stringify(marker)})))){fs.writeFileSync(${JSON.stringify(marker)},'');fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'failed',part:+part[1]})+'\\n');process.stderr.write('overloaded');process.exit(1)}
if(kind==='select')return finish({blocks:[{index:0,reason:'hard'}]});
if(kind==='review')return finish({score:1,faithful:true,issues:[]});
if(kind==='overview')return finish({title:'Overview',summary:'Short.',sections:[{title:'All',startLine:1,endLine:90,pseudocode:'Do it',lineMap:[[1,1,90]]}],views:{}});
if(kind==='whole')return finish({title:'Whole file',summary:'One request.',sections:[{title:'Everything',startLine:1,endLine:90,pseudocode:'Do everything',lineMap:[[1,1,90]]}]});
const k=+part[1],s=+part[3],e=+part[4];
finish({title:k===1?'Whole file':'Part '+k,summary:k===1?'Explains the file.':'p',sections:[{title:'Part '+k+' work',startLine:s-3,endLine:e,pseudocode:'Work on part '+k+'\\nThen finish',lineMap:[[1,s,s],[3,e+20,e+21]]},{title:'Outside',startLine:e+30,endLine:e+31,pseudocode:'Not mine',lineMap:[]}]});});`);
    const read = async () => (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const text = Array.from({ length: 90 }, (_, i) => 'line' + (i + 1)).join('\n');
    const input = { uri: 'file:///work.py', name: 'work.py', language: 'python', startLine: 1, text };
    const parts = [{ startLine: 1, endLine: 30, names: ['a'] }, { startLine: 31, endLine: 60, names: ['b'] }, { startLine: 61, endLine: 90, names: ['c'] }];
    const phases = [];
    const result = await generate({ source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', fast: { model: 'haiku', effort: 'low' }, parts, parallel: 2, onProgress: update => phases.push(update) });
    const calls = await read(), runs = calls.filter(call => call.kind === 'part');
    assert.deepEqual(runs.map(call => call.part).sort(), [1, 2, 3]); assert.deepEqual(calls.filter(call => call.kind === 'failed').map(call => call.part), [2], 'part 2 failed once and was retried');
    const overlap = Math.max(...runs.map(a => runs.filter(b => b.started <= a.started && b.ended > a.started).length));
    assert.ok(overlap <= 2, 'never more than 2 parts at once (saw ' + overlap + ')'); assert.ok(overlap === 2, 'parts really run in parallel');
    assert.equal(result.title, 'Whole file'); assert.equal(result.summary, 'Explains the file.'); assert.equal(result.parts, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(result.sections.map(section => [section.title, section.startLine, section.endLine]))), [['Part 1 work', 1, 30], ['Part 2 work', 31, 60], ['Part 3 work', 61, 90]], 'in order, clamped to their part; sections outside are dropped');
    assert.deepEqual(JSON.parse(JSON.stringify(result.sections[1].lineMap)), [{ pseudocodeLine: 1, startLine: 31, endLine: 31 }], 'links that leave the part are dropped');
    assert.equal(result.views.overview.title, 'Overview', 'the fast Overview still runs alongside');
    assert.ok(phases.some(update => update.stage === 'write' && /Writing 3 parts in parallel \(3\/3 done\)/.test(update.phase)));
    assert.ok(phases.some(update => update.preview?.sections?.length >= 1 && update.preview.title === 'Whole file'), 'a combined preview streams');
    // Parts that keep failing fall back to one whole-file request.
    await fs.writeFile(log, ''); phases.length = 0;
    const fallback = await generate({ source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'broken-parts', effort: 'low', parts, parallel: 3, onProgress: update => phases.push(update) });
    assert.equal(fallback.title, 'Whole file'); assert.equal(fallback.sections[0].title, 'Everything'); assert.equal(fallback.parts, undefined);
    assert.ok(phases.some(update => /^Parallel writing failed .*; writing the whole file in one request/.test(update.phase)));
    // Background review: the draft returns at once; reviewDraft later uses the review model.
    await fs.writeFile(log, '');
    const draft = await generate({ source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', fast: { model: 'haiku', effort: 'low' }, parts, parallel: 3, refinementSteps: 1, background: true });
    assert.deepEqual(JSON.parse(JSON.stringify(draft.refinement)), { version: 1, status: 'pending', stepsRequested: 1, stepsCompleted: 0, selectedBlocks: [] });
    assert.ok(!(await read()).some(call => call.kind === 'select' || call.kind === 'review'), 'no review before the draft is returned');
    assert.equal(parseResult(JSON.stringify(draft), input).refinement.status, 'pending', 'a cached draft keeps its pending review');
    const { reviewDraft } = require('./engine');
    const reviewed = await reviewDraft({ initial: draft, source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', fast: { model: 'haiku', effort: 'low' }, review: { model: 'sonnet', effort: 'low' }, steps: 1 });
    const reviews = (await read()).filter(call => call.kind === 'review');
    assert.equal(reviews.length, 2); assert.ok(reviews.every(call => call.model === 'sonnet'), 'reviewers use the cheaper review model');
    assert.equal((await read()).find(call => call.kind === 'select').model, 'haiku');
    assert.equal(reviewed.refinement.status, 'reviewed'); assert.equal(reviewed.refinement.reviewModel, 'sonnet'); assert.equal(reviewed.model, draft.model, 'the explanation keeps its writer');
    assert.equal(parseResult(JSON.stringify(reviewed), input).refinement.reviewModel, 'sonnet');
    // Stop aborts every part.
    const stop = new AbortController(); setTimeout(() => stop.abort(), 60);
    await assert.rejects(generate({ source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', parts, parallel: 3, signal: stop.signal }), /Cancelled/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('reviews use one tier below the writer, never above it', async () => {
  const { reviewModel } = require('./engine');
  const plain = value => value && JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await reviewModel('claude', '', '')), { model: 'sonnet', effort: 'low' }, 'under Claude\'s default (Opus)');
  assert.deepEqual(plain(await reviewModel('claude', '', 'opus')), { model: 'sonnet', effort: 'low' });
  assert.equal(await reviewModel('claude', '', 'sonnet'), undefined, 'a Sonnet writer reviews with itself');
  assert.equal(await reviewModel('claude', '', 'haiku'), undefined, 'never upgrade a smaller writer');
  assert.equal(await reviewModel('claude', '', '', 'main'), undefined);
  assert.deepEqual(plain(await reviewModel('claude', '', '', 'claude-sonnet-5-5')), { model: 'claude-sonnet-5-5', effort: 'low' });
  const catalog = [{ id: 'gpt-6.1-sol', description: 'Latest workhorse', efforts: [{ reasoningEffort: 'low' }] }, { id: 'gpt-6-astra', description: 'Frontier', efforts: [] }, { id: 'gpt-6.1-terra', description: 'GPT-6.1 Terra Codex model', efforts: [{ reasoningEffort: 'low' }] }, { id: 'gpt-5.6-terra', description: 'Older balanced model', efforts: [] }, { id: 'gpt-6-luna', description: 'Fast', efforts: [] }];
  assert.deepEqual(plain(await reviewModel('codex', '', '', 'auto', catalog)), { model: 'gpt-6.1-terra', effort: 'low' }, 'the newest balanced model under Codex\'s default');
  assert.deepEqual(plain(await reviewModel('codex', '', 'gpt-6-astra', 'auto', catalog)), { model: 'gpt-6.1-terra', effort: 'low' });
  assert.equal(await reviewModel('codex', '', 'gpt-6-luna', 'auto', catalog), undefined);
  assert.equal(await reviewModel('codex', '', '', 'auto', [{ id: 'only-one', description: 'x' }]), undefined, 'no balanced model: the writer reviews');
});

test('background review: the draft is readable at once, improved blocks swap in later, and edits, refreshes and failures are handled', async () => {
  const path = require('node:path'), fs = require('node:fs/promises');
  const gates = [], opened = [];
  const engine = h => ({
    generate: async opts => {
      opened.push({ level: opts.level, background: opts.background, parallel: opts.parallel, parts: opts.parts?.length || 0, review: opts.review, refine: opts.refinementSteps, refresh: !!opts.sourceRefresh });
      const lines = opts.source.text.split('\n').length;
      const view = { title: 'About', summary: 'Explains.', sections: [{ title: 'First block', startLine: 1, endLine: lines, pseudocode: 'Draft text', lineMap: [] }] };
      return { ...view, requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort, ...(opts.level === 'logic' && opts.background && opts.refinementSteps ? { refinement: { version: 1, status: 'pending', stepsRequested: opts.refinementSteps, stepsCompleted: 0, selectedBlocks: [] } } : {}) };
    },
    reviewDraft: args => new Promise((resolve, reject) => { const gate = { args, resolve, reject }; gates.push(gate); h.gates = gates; })
  });
  const h = await readerHarness({ prefetchNext: false, autoNotes: false, reviewModel: 'review-test' }, { engine });
  try {
    // A bigger file is written as parallel parts.
    const big = Array.from({ length: 4 }, (_, i) => `def step_${i}():\n` + Array.from({ length: 29 }, (_, j) => `    value_${j} = ${j}`).join('\n') + '\n    return value_0\n').join('\n');
    await fs.writeFile(path.join(h.root, 'pipeline', 'big.py'), big);
    await h.commands.get('yamori.openAt')(new h.Uri(path.join(h.root, 'pipeline/big.py')).toString(), 1);
    const reader = h.readers().at(-1);
    await h.until(() => h.last(reader).review?.state === 'running', 'the review runs in the background');
    const shown = h.last(reader);
    assert.equal(shown.busy, false, 'not busy while reviewing'); assert.equal(shown.result.sections[0].pseudocode, 'Draft text', 'the draft is readable at once');
    assert.match(shown.review.text, /Reviewing difficult blocks in the background with review-test\. You can read now/);
    assert.deepEqual(JSON.parse(JSON.stringify(opened[0])), { level: 'logic', background: true, parallel: 6, parts: 4, review: { model: 'review-test', effort: 'low' }, refine: 1, refresh: false });
    assert.equal(shown.run.state, 'done'); assert.equal(shown.run.steps.find(step => step.id === 'review').state, 'active');
    assert.deepEqual(JSON.parse(JSON.stringify(gates[0].args.review)), { model: 'review-test', effort: 'low' });
    // A level switch does not stop it; finishing swaps the improved block in and caches it.
    await reader.receive({ type: 'level', level: 'overview' });
    assert.equal(gates[0].args.signal.aborted, false, 'switching level keeps the review going');
    await reader.receive({ type: 'level', level: 'logic' });
    gates[0].resolve({ ...gates[0].args.initial, sections: [{ ...gates[0].args.initial.sections[0], pseudocode: 'Reviewed text' }], refinement: { version: 1, status: 'reviewed', stepsRequested: 1, stepsCompleted: 1, acceptedStep: 1, lambda: 0.5, initialObjective: 6, finalObjective: 2, entropy: 1, readCost: 2, faithful: true, history: [], selectedBlocks: [0], reviewModel: 'review-test' } });
    await h.until(() => h.last(reader).review?.state === 'done', 'the review finishes');
    assert.equal(h.last(reader).result.sections[0].pseudocode, 'Reviewed text'); assert.equal(h.last(reader).review.text, 'Review improved 1 block: First block.');
    assert.equal(h.last(reader).run.steps.find(step => step.id === 'review').state, 'done');
    // A refresh abandons the review of what it replaces.
    await h.commands.get('yamori.openAt')(new h.Uri(path.join(h.root, 'main.py')).toString(), 1);
    const second = h.readers().at(-1);
    await h.until(() => gates.length === 2 && h.last(second).review?.state === 'running', 'a second review starts');
    await second.receive({ type: 'refresh' });
    await h.until(() => gates[1].args.signal.aborted, 'Regenerate stops the old review');
    // A fidelity failure keeps the draft with a warning and Retry review.
    await h.commands.get('yamori.openAt')(new h.Uri(path.join(h.root, 'pipeline/plan.py')).toString(), 1);
    const third = h.readers().at(-1);
    await h.until(() => gates.length >= 3 && h.last(third).review?.state === 'running', 'a third review starts');
    gates.at(-1).reject(Object.assign(new Error('Step 2 invents a retry.'), { code: 'YAMORI_FIDELITY' }));
    await h.until(() => h.last(third).review?.state === 'failed', 'the failure is shown');
    assert.equal(h.last(third).result.sections[0].pseudocode, 'Draft text');
    assert.equal(h.last(third).result.refinement.status, 'incomplete'); assert.match(h.last(third).result.refinement.warning, /flagged possible inaccuracies .*Retry review\. Step 2 invents a retry\./);
  } finally { for (const gate of gates) gate.resolve?.(gate.args.initial); await h.close(); }
});

test('the reader shows the background review status as a quiet line', () => {
  const { document, elements, all } = fakeDocument(['content', 'refresh', 'provider', 'model', 'effort', 'refinement', 'colors', 'source', 'files', 'map', 'ai-summary', 'setup-ai']);
  let receive;
  vm.runInNewContext(panelHTML().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, DOMParser: class { parseFromString() { return { querySelector: () => ({}) }; } }, acquireVsCodeApi: () => ({ postMessage() {} }), katex: { renderToString: () => '' }, window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Intl, Date });
  receive({ data: { type: 'state', state: { providerLabel: 'Claude Code', level: 'logic', name: 'a.py', documentKey: 'k', result: valid, review: { state: 'running', text: 'Reviewing difficult blocks in the background with sonnet.' } } } });
  const line = all(elements.content).find(el => /review-status/.test(el.className || ''));
  assert.ok(line); assert.equal(line.className, 'notice review-status running'); assert.equal(line.textContent, 'Reviewing difficult blocks in the background with sonnet.'); assert.equal(line.attributes.role, 'status');
});

test('a parallel draft never waits long for a slow Overview, and a cheaper reviewer’s stray link does not discard its rewrite', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-review-'));
  try {
    const binary = path.join(dir, 'claude.js');
    await fs.writeFile(binary, `const a=process.argv.slice(2);if(a.includes('--help')){console.log('--safe-mode');process.exit(0)}
let prompt='';process.stdin.on('data',d=>prompt+=d).on('end',()=>{const schema=JSON.parse(a[a.indexOf('--json-schema')+1]),model=a.includes('--model')?a[a.indexOf('--model')+1]:'';
const out=o=>setTimeout(()=>process.stdout.write(JSON.stringify({type:'result',structured_output:o,modelUsage:{[model||'claude-opus-test']:{}}})),/Detail: overview\\./.test(prompt)?5000:10);
if(schema.properties.blocks)return out({blocks:[{index:0,reason:'hard'}]});
if(schema.properties.score)return out(/Reviewed text/.test(prompt)?{score:1,faithful:true,issues:[]}:{score:6,faithful:true,issues:[{section:0,view:'main',severity:'major',problem:'Unclear',suggestion:'Explain the count'}]});
if(/Detail: overview\\./.test(prompt))return out({title:'O',summary:'O',sections:[{title:'All',startLine:1,endLine:60,pseudocode:'Do',lineMap:[]}],views:{}});
if(/REFINEMENT PASS/.test(prompt)){const b=JSON.parse(prompt.match(/SELECTED BLOCKS DATA: (\\[.*?\\])\\n/)[1])[0];return out({title:'t',summary:'s',sections:[{...b,pseudocode:'Reviewed text\\n\\nCount the items',lineMap:[[1,b.startLine,b.startLine],[2,b.startLine,b.startLine],[3,b.endLine,b.endLine]]}]})}
const p=prompt.match(/PARALLEL PART (\\d+) OF \\d+: .*?source lines (\\d+)–(\\d+)/);
out({title:'File',summary:'Explains.',sections:[{title:'Part '+p[1],startLine:+p[2],endLine:+p[3],pseudocode:'Draft '+p[1],lineMap:[[1,+p[2],+p[2]]]}]});});`);
    const text = Array.from({ length: 60 }, (_, i) => 'line' + (i + 1)).join('\n'), input = { uri: 'file:///w.py', name: 'w.py', language: 'python', startLine: 1, text };
    const parts = [{ startLine: 1, endLine: 30, names: [] }, { startLine: 31, endLine: 60, names: [] }];
    const started = Date.now();
    const draft = await generate({ source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', fast: { model: 'haiku', effort: 'low' }, parts, parallel: 2, refinementSteps: 1, background: true });
    assert.ok(Date.now() - started < 4000, 'the draft did not wait 15 s for the Overview (' + (Date.now() - started) + ' ms)');
    assert.equal(draft.views, undefined, 'a late Overview is written when that level is opened');
    const { reviewDraft } = require('./engine');
    const reviewed = await reviewDraft({ initial: draft, source: input, level: 'logic', provider: 'claude', cliPath: binary, model: 'opus', effort: 'low', fast: { model: 'haiku', effort: 'low' }, review: { model: 'sonnet', effort: 'low' }, steps: 1 });
    assert.equal(reviewed.refinement.acceptedStep, 1, 'the rewrite is kept');
    assert.equal(reviewed.sections[0].pseudocode, 'Reviewed text\n\nCount the items'); assert.equal(reviewed.sections[1].pseudocode, 'Draft 2');
    assert.deepEqual(JSON.parse(JSON.stringify(reviewed.sections[0].lineMap.map(link => link.pseudocodeLine))), [1, 3], 'only the link on a blank line was dropped');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('guide search: a visible header box highlights every file that mentions a name, and Explain traces its flow with AI', async () => {
  const path = require('node:path');
  const flows = [];
  const engine = h => ({ requestStructured: async ({ prompt, schema, model }) => {
    const real = require('./engine');
    if (schema !== real.FLOW_SCHEMA) return { raw: JSON.stringify({ files: [] }) };
    flows.push(prompt);
    return { raw: JSON.stringify({ summary: 'plan_loops builds the loops; main.py calls it.', sections: [
      { file: 'pipeline/plan.py', title: 'Build the loops', startLine: 1, endLine: 400, pseudocode: '# Context: a loop is an open question\nBuild the loops with **plan_loops**\n\nReturn them', lineMap: [[2, 1, 2], [1, 1, 1], [4, 1, 999]] },
      { file: 'main.py', title: 'Use them', startLine: 1, endLine: 2, pseudocode: 'Call it for the video', lineMap: [[1, 2, 2]] },
      { file: 'nowhere.py', title: 'Invented', startLine: 1, endLine: 1, pseudocode: 'Not real', lineMap: [] }], caveats: '' }), actualModel: 'flow-model' };
  } });
  const h = await readerHarness({ prefetchNext: false, autoNotes: false }, { engine });
  try {
    const html = require('./map').mapHTML();
    assert.match(html, /<form class="search" id="search-form" role="search"><input id="search" type="search" placeholder="Search a name: variable, function, term…"/, 'the search box sits in the header, always visible');
    await h.guide.receive({ type: 'search', query: 'plan_loops' });
    const found = h.guideState().search;
    assert.equal(found.query, 'plan_loops'); assert.equal(found.identifier, true);
    assert.deepEqual(JSON.parse(JSON.stringify(found.hits.map(hit => hit.file))), ['pipeline/plan.py', ...found.hits.map(hit => hit.file).filter(file => file !== 'pipeline/plan.py')], 'the defining file comes first');
    assert.ok(found.hits.find(hit => hit.file === 'pipeline/plan.py').defines);
    assert.ok(found.hits.every(hit => hit.matches.every(match => /plan_loops/.test(match.text))));
    await h.guide.receive({ type: 'search', query: 'plan' });
    assert.ok(!h.guideState().search.hits.some(hit => hit.matches.some(match => !/\bplan\b/.test(match.text))), 'a name matches whole words only');
    await h.guide.receive({ type: 'search', query: 'plan_loops' });
    await h.guide.receive({ type: 'explainFlow' });
    const flow = h.guideState().flow;
    assert.equal(flow.state, 'done'); assert.equal(flow.model, 'flow-model');
    assert.deepEqual(JSON.parse(JSON.stringify(flow.sections.map(section => section.file))), ['pipeline/plan.py', 'main.py'], 'blocks outside the searched files are dropped');
    const first = flow.sections[0];
    assert.ok(first.endLine < 400, 'a block range is clamped to its file');
    assert.deepEqual(JSON.parse(JSON.stringify(first.lineMap)), [{ pseudocodeLine: 2, startLine: 1, endLine: 2 }], 'links on notes or past the file are dropped');
    assert.match(flows[0], /sections: the flow as Yamori reading blocks/); assert.match(flows[0], /VOICE AND INFORMATION DENSITY/, 'the reader\'s own writing rules');
    assert.match(flows[0], /searched this project for "plan_loops"/); assert.match(flows[0], /FILE "pipeline\/plan\.py".*defines it/);
    await h.guide.receive({ type: 'search', query: '' });
    assert.equal(h.guideState().search, undefined); assert.equal(h.guideState().flow, undefined, 'clearing the search clears its flow');
    // No AI ready: Explain opens setup instead.
    await h.guide.receive({ type: 'search', query: 'plan_loops' });
    testStatus.codex = { provider: 'codex', installed: false, signedIn: false, ready: false, problem: 'Not installed' };
    await h.guide.receive({ type: 'explainFlow' });
    assert.ok(h.panels.some(panel => panel.type === 'yamoriSetup')); assert.equal(flows.length, 1);
  } finally { delete testStatus.codex; await h.close(); }
  // The page: hits glow and carry counts; the side panel lists them and the flow.
  const ids = ['canvas', 'viewport', 'boxes', 'edges', 'nodes', 'card', 'glossary', 'drawer', 'drawer-close', 'status', 'notes', 'rescan', 'zoom-in', 'zoom-out', 'fit', 'reset', 'drawer-toggle', 'tab-start', 'tab-map', 'start-view', 'map-view', 'start-head', 'folders', 'steps-title', 'steps-hint', 'steps', 'expand-all', 'collapse-all', 'search', 'search-form', 'search-go', 'search-panel'];
  const { document, elements, all } = fakeDocument(ids);
  const messages = []; let receive;
  vm.runInNewContext(pageScript(require('./map').mapHTML()), { document, acquireVsCodeApi: () => ({ postMessage: m => messages.push(JSON.parse(JSON.stringify(m))) }), window: { addEventListener: (type, fn) => { if (type === 'message') receive = fn; } }, Date, Math, Number, String, Map, Set, Object, Array, JSON, setTimeout, clearTimeout });
  const { graph } = await scanFixture(videoProject);
  const map = projectMap.layoutGrouped(graph, { collapsed: [] });
  const search = { query: 'plan_loops', identifier: true, total: 3, more: 0, hits: [{ file: 'pipeline/plan.py', count: 2, defines: true, test: false, matches: [{ line: 1, text: 'def plan_loops(blocks):' }] }, { file: 'main.py', count: 1, defines: false, test: false, matches: [{ line: 2, text: 'plan_loops(x)' }] }] };
  const flow = { state: 'done', query: 'plan_loops', model: 'm', summary: 'It builds loops.', caveats: '',
    sections: [{ file: 'pipeline/plan.py', title: 'Build the loops', startLine: 1, endLine: 3, pseudocode: '# Context: L1 is the big question\nIf the hook is set:\n    Build **L1** with $n+1$ loops', lineMap: [{ pseudocodeLine: 3, startLine: 2, endLine: 3 }] }] };
  receive({ data: { type: 'map', state: { files: 5, links: 6, notes: { done: 0, total: 4 }, folders: [], map, guide: { folder: '', steps: [] }, cards: {}, glossary: [], search, flow } } });
  const nodes = all(elements.nodes).filter(el => el.attributes?.['data-id']);
  const hit = nodes.find(el => el.attributes['data-id'] === 'pipeline/plan.py'), miss = nodes.find(el => el.attributes['data-id'] === 'models/script.py');
  assert.ok(hit.classList.contains('hit')); assert.ok(!hit.classList.contains('dim')); assert.ok(miss.classList.contains('dim'), 'files without a hit fade');
  assert.ok(all(hit).some(el => el.attributes?.class === 'hit-count' && all(el).some(child => child.textContent === '2')), 'each hit shows its count');
  const panel = elements['search-panel'];
  assert.equal(panel.hidden, false); assert.ok(all(panel).some(el => el.textContent === '2 files mention “plan_loops”'));
  assert.ok(all(panel).some(el => el.textContent === 'How “plan_loops” flows')); assert.ok(all(panel).some(el => el.textContent === 'It builds loops.'));
  const block = all(panel).find(el => el.className === 'reading-block'), rows = all(block).filter(el => /^code-line/.test(el.className || ''));
  assert.ok(all(block).some(el => el.className === 'section-heading' && all(el).some(child => child.textContent === 'Build the loops')));
  assert.ok(all(block).some(el => el.className === 'line' && el.textContent === 'plan.py · L1–3'));
  assert.equal(rows.length, 3); assert.equal(rows[0].className, 'code-line note context-note'); assert.equal(rows[1].className, 'code-line decision');
  assert.ok(all(rows[1]).some(el => el.className === 'keyword' && el.textContent === 'If'), 'control words are tokens, as in the reader');
  assert.ok(all(rows[2]).some(el => el.tag === 'strong' && el.className === 'important'), '**emphasis** as in the reader');
  assert.equal(rows[2].className, 'code-line linked'); rows[2].events.click();
  assert.deepEqual(messages.at(-1), { type: 'revealSource', id: 'pipeline/plan.py', line: 2 }, 'a linked line opens its source');
  assert.ok(elements['search-panel'].classList.contains('wide'), 'the panel widens for a flow');
  all(panel).find(el => el.className === 'match').events.click();
  assert.deepEqual(messages.at(-1), { type: 'revealSource', id: 'pipeline/plan.py', line: 1 });
  receive({ data: { type: 'map', state: { files: 5, links: 6, notes: { done: 0, total: 4 }, folders: [], map, guide: { folder: '', steps: [] }, cards: {}, glossary: [], search } } });
  all(elements['search-panel']).find(el => el.className === 'explain-flow').events.click();
  assert.deepEqual(messages.at(-1), { type: 'explainFlow' });
  elements.search.value = 'L1'; elements['search-form'].events.submit({ preventDefault() {} });
  assert.deepEqual(messages.at(-1), { type: 'search', query: 'L1' }); assert.equal(elements['map-view'].hidden, false, 'searching shows the map');
});
