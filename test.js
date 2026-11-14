'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { LEVELS, SCHEMA, cacheKey, promptFor, parseResult, generate, runProcess, schemaFor, lowerView, partialView, streamCodex, editPrompt, revisionPrompt, listModels, listEfforts, findCLI, cliLaunch } = require('./engine');
const { cleanEmphasis, panelHTML, tokenize, pseudocodeLines, mathParts, emphasisParts } = require('./panel');
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
  assert.notEqual(cacheKey(source, 'detailed', 'codex'), key);
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
  await assert.rejects(findCLI('claude', '', windowsFixture({ [native]: 'directory' })), /desktop app alone/);
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
test('Connect Claude opens provider login, and installation requires an explicit choice', async () => {
  const fs = require('node:fs/promises'), path = require('node:path'), terminals = [], commands = [], links = [];
  let choice;
  const api = { workspace: { getConfiguration: () => ({ get: () => '' }) }, Uri: { parse: value => value },
    commands: { executeCommand: async (...args) => commands.push(args) }, env: { openExternal: async value => links.push(value) },
    window: { showInformationMessage: async () => choice, createTerminal(options) { const t = { options, show() { t.visible = true; }, dispose() {} }; terminals.push(t); return t; } } };
  const stub = { exports: {} };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, 'extension.js'), 'utf8'), { module: stub, require: id => id === 'vscode' ? api : require(id), Buffer, AbortController, setTimeout, clearTimeout });
  const context = { subscriptions: [] }, native = 'C:\\Users\\A Person\\.local\\bin\\claude.exe';
  await stub.exports.connectClaude(context, api, windowsFixture({ [native]: '' }));
  assert.equal(terminals[0].options.shellPath, native); assert.deepEqual([...terminals[0].options.shellArgs], ['auth', 'login']); assert.equal(terminals[0].visible, true);
  await stub.exports.connectClaude(context, api, windowsFixture()); assert.equal(terminals.length, 1, 'dismiss never installs');
  choice = 'Choose executable'; await stub.exports.connectClaude(context, api, windowsFixture()); assert.equal(commands[0][1], 'yamori.claudePath');
  choice = 'Setup guide'; await stub.exports.connectClaude(context, api, windowsFixture()); assert.equal(links[0], 'https://code.claude.com/docs/en/setup');
  choice = 'Install and sign in'; await stub.exports.connectClaude(context, api, windowsFixture());
  const win = terminals.at(-1); assert.equal(win.visible, true); assert.equal(win.options.shellPath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.match(win.options.shellArgs.at(-1), /irm https:\/\/claude.ai\/install.ps1 \| iex/); assert.match(win.options.shellArgs.at(-1), /& \$claudeExe auth login/);
  await stub.exports.connectClaude(context, api, { platform: 'darwin', home: '/missing', env: {}, fs: windowsFixture().fs });
  assert.equal(terminals.at(-1).options.shellPath, '/bin/bash'); assert.match(terminals.at(-1).options.shellArgs.at(-1), /"\$HOME\/\.local\/bin\/claude" auth login/);
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
  assert.deepEqual(schemaFor('detailed').properties.views.required, ['overview', 'logic']);
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
  assert.equal(lowerView(parsed, 'overview', 'detailed'), undefined);
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
  const elements = Object.fromEntries(['content', 'refresh', 'provider', 'model', 'effort', 'colors', 'source', 'files'].map(id => [id, new Element('div')]));
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
  const mapState = { ...renderedState, result: { ...valid, sections: [renderedState.result.sections[0], { ...valid.sections[0], title: 'Count the matches', pseudocode: 'Return the number of matches.' }] } };
  receive({ data: { type: 'state', state: mapState } });
  all.length = 0; visit(elements.content);
  assert.equal(all.filter(el => el.className === 'map-item').length, 2, 'multi-block files begin with a compact logic map');
  assert.equal(all.filter(el => el.className?.startsWith('reading-block')).length, 0, 'the map does not show a wall of blocks');
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
  receive({ data: { type: 'state', state: { ...renderedState, providerLabel: 'Claude Code', error: 'Sign in required' } } });
  all.length = 0; visit(elements.content);
  const connect = all.find(el => el.textContent === 'Connect Claude');
  assert.ok(connect); assert.ok(!sent.slice(beforeConnect).some(message => message.type === 'connectClaude'), 'an error never opens login automatically');
  connect.events.click(); assert.equal(sent.at(-1).type, 'connectClaude');
  receive({ data: { type: 'state', state: { ...renderedState, providerLabel: 'Claude Code', error: 'Sign in required', busy: true } } });
  all.length = 0; visit(elements.content); assert.equal(all.find(el => el.textContent === 'Connect Claude').disabled, true);
  receive({ data: { type: 'state', state: { providerLabel: 'Claude Code', level: 'logic' } } });
  all.length = 0; visit(elements.content); assert.ok(all.find(el => el.textContent === 'Connect Claude'), 'initial Claude screen offers setup');
});

test('extension workflow switches levels, reuses cache, marks edits stale and ignores cancelled results', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-test-'));
  const commands = new Map(), state = new Map(), messages = [];
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
    return { ...make(opts.level), requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort, views: Object.fromEntries(['overview', 'logic', 'detailed'].slice(0, ['overview', 'logic', 'detailed'].indexOf(opts.level)).map(name => [name, make(name)])) };
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
    assert.equal(messages.at(-1).result.title, 'detailed');
    await receive({ type: 'level', level: 'logic' });
    assert.equal(calls, 2, 'returning to an earlier level uses cache');
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
    context.subscriptions.splice(0).forEach(d => d?.dispose?.());
    assert.equal(highlights.length, 0, 'deactivation clears existing highlights');
    await moduleStub.exports.activate(context);
    await commands.get('yamori.read')();
    await receive({ type: 'level', level: 'overview' });
    assert.equal(calls, 2, 'companion views survive extension restart');
    await receive({ type: 'level', level: 'logic' });
    documentText = 'x = 2\nprint(x)'; change({ document: doc });
    assert.equal(messages.at(-1).stale, true);
    await receive({ type: 'hoverStep', index: 0, pseudocodeLine: 2 });
    assert.equal(highlights.length, 0, 'stale source must never highlight');
    await receive({ type: 'refresh' });
    assert.equal(calls, 3, 'refresh translates edited source');
    assert.equal(messages.at(-1).stale, false);
    const beforeEdit = messages.at(-1), neighbor = JSON.stringify(beforeEdit.result.sections[1]);
    await receive({ type: 'copyBlock', index: 0, documentKey: beforeEdit.documentKey });
    assert.equal(copied, beforeEdit.result.sections[0].pseudocode);
    await receive({ type: 'updateBlock', index: 0, documentKey: beforeEdit.documentKey, baseText: beforeEdit.result.sections[0].pseudocode, draft: 'Set x to $x^2$\nPrint x', instruction: 'Keep the equation' });
    const edited = messages.at(-1).result.sections[0].pseudocode;
    assert.match(edited, /Polished/);
    assert.equal(JSON.stringify(messages.at(-1).result.sections[1]), neighbor, 'neighboring blocks must remain byte-for-byte unchanged');
    assert.equal(messages.at(-1).result.edited, true);
    assert.equal(calls, 4);
    await receive({ type: 'level', level: 'overview' });
    assert.equal(calls, 5, 'a stale lower view is regenerated lazily');
    assert.ok(lastRevision?.value.sections[0].pseudocode.includes('$x^2$'));
    await receive({ type: 'level', level: 'logic' });
    assert.equal(calls, 5);
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'approved block is preserved exactly');
    await receive({ type: 'level', level: 'detailed' });
    await receive({ type: 'level', level: 'logic' });
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'derived companion views cannot replace the approved edit');
    context.subscriptions.splice(0).forEach(d => d?.dispose?.());
    await moduleStub.exports.activate(context);
    await commands.get('yamori.read')();
    assert.equal(messages.at(-1).result.sections[0].pseudocode, edited, 'approved edits survive extension restart');
    deferred = {};
    const request = receive({ type: 'refresh' });
    while (!deferred.resolve) await new Promise(resolve => setTimeout(resolve, 1));
    deferred.progress({ phase: 'Writing pseudocode', preview: { ...valid, title: 'live draft' }, model: 'test-stream-model' });
    assert.equal(messages.at(-1).partial, true);
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
    context.subscriptions.splice(0).forEach(d => d?.dispose?.());
    await moduleStub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(messages.at(-1).requestedEffort, null, 'effort choices survive restart');
    const beforeColors = calls, beforeKey = messages.at(-1).documentKey;
    nextPick = 'paper'; await commands.get('yamori.colors')();
    assert.equal(messages.at(-1).readingPalette, 'paper');
    assert.equal(calls, beforeColors, 'reading colors do not start inference');
    assert.equal(messages.at(-1).documentKey, beforeKey, 'color changes do not invalidate cache or drafts');
    context.subscriptions.splice(0).forEach(d => d?.dispose?.());
    await moduleStub.exports.activate(context); await commands.get('yamori.read')();
    assert.equal(messages.at(-1).readingPalette, 'paper', 'reading palette survives restart');


  } finally { context.subscriptions.forEach(d => d?.dispose?.()); await fs.rm(temp, { recursive: true, force: true }); }
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
    await fs.writeFile(file, JSON.stringify({ detail: 'detailed', provider: 'gemini' }));
    await stub.exports.migratePreferences(context);
    assert.equal(state.get('detail'), 'detailed');
    assert.equal(state.get('provider'), 'codex');
    await assert.rejects(fs.access(file));
    await stub.exports.migratePreferences(context);
    assert.equal(state.get('detail'), 'detailed');
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
  const commands = new Map(), settings = new Map(), panels = [], shown = [], launchers = [];
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
    return { ...make(opts.level), requestedModel: opts.model, requestedEffort: opts.effort, effort: opts.effort, views: Object.fromEntries(['overview', 'logic', 'detailed'].slice(0, ['overview', 'logic', 'detailed'].indexOf(opts.level)).map(level => [level, make(level)])) };
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
    vscode.workspace.isTrusted = false; editorChanged(editors[1]); assert.equal(launchers[0].visible, false);
  } finally { context.subscriptions.forEach(item => item.dispose?.()); await fs.rm(temp, { recursive: true, force: true }); }
});
