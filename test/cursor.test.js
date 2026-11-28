'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const engine = require('../src/ai/engine');

// A stand-in cursor-agent: answers --help, models and status, and records the
// arguments of each print-mode run before streaming Cursor's stream-json events.
async function fakeCursor({ help = '--mode --trust --sandbox --stream-partial-output', answer = '```json\n{"files":["app/render.py"]}\n```', fail } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-cursor-')), binary = path.join(dir, 'cursor-agent.js'), log = path.join(dir, 'args.jsonl');
  await fs.writeFile(binary, `const fs=require('fs'),a=process.argv.slice(2);
if(a[0]==='--help'){console.log(${JSON.stringify(help)});process.exit(0)}
if(a[0]==='models'){console.log('\\u001b[1mAvailable models\\u001b[0m\\n\\nauto - Auto (current)\\ngpt-6 - GPT-6\\nsonnet-5 - Claude Sonnet 5');process.exit(0)}
if(a[0]==='status'){console.log('\\u2713 Logged in as reader@example.com');process.exit(0)}
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
const say=e=>process.stdout.write(JSON.stringify(e)+'\\n'),answer=${JSON.stringify(answer)};
say({type:'system',subtype:'init',session_id:'5f0c1e2a-0000-4000-8000-000000000001',model:'GPT-6'});
say({type:'tool_call',subtype:'started',tool_call:{readToolCall:{args:{path:'app/render.py'}}}});
say({type:'assistant',message:{content:[{type:'text',text:answer.slice(0,12)}]}});
say({type:'assistant',message:{content:[{type:'text',text:answer.slice(12)}]}});
say(${fail ? `{type:'result',subtype:'error',is_error:true,result:${JSON.stringify(fail)}}` : `{type:'result',subtype:'success',is_error:false,result:answer,session_id:'5f0c1e2a-0000-4000-8000-000000000001',usage:{inputTokens:900,outputTokens:40}}`});`);
  const runs = async () => (await fs.readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { dir, binary, runs, close: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('Cursor answers read-only in Ask mode, with the schema in the prompt and a fenced reply parsed as JSON', async () => {
  const cursor = await fakeCursor();
  try {
    const phases = [];
    const response = await engine.requestStructured({ provider: 'cursor', cliPath: cursor.binary, model: 'gpt-6', prompt: 'Rank the files.', schema: engine.RANK_SCHEMA, showPreview: false, onProgress: update => phases.push(update) });
    assert.deepEqual(JSON.parse(response.raw), { files: ['app/render.py'] });
    assert.equal(response.actualModel, 'GPT-6');
    assert.deepEqual(JSON.parse(JSON.stringify(response.usage)), { input: 900, output: 40, cacheRead: 0, cacheWrite: 0 });
    const [args] = await cursor.runs();
    assert.deepEqual(args.slice(0, 8), ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--trust', '--mode', 'ask', '--model']);
    assert.ok(!args.includes('--force'), 'a read-only request never passes --force');
    assert.match(args.at(-1), /^Rank the files\.\n\nOUTPUT FORMAT: Reply with exactly one JSON object/);
    assert.ok(args.at(-1).includes(JSON.stringify(engine.RANK_SCHEMA)));
    assert.ok(phases.some(update => /^read: app\/render\.py$/.test(update.phase)), 'tool activity is shown');
    assert.ok(phases.some(update => update.stage === 'usage'));
  } finally { await cursor.close(); }
});

test('Cursor implements an approved plan with --force inside its sandbox, and chat stays in Ask mode', async () => {
  const cursor = await fakeCursor({ answer: '{"status":"completed","summary":"Renamed the helper."}' });
  try {
    const sessions = [];
    const done = await engine.implementPlan({ provider: 'cursor', cliPath: cursor.binary, cwd: cursor.dir, prompt: 'Apply the plan.', mode: 'work', onSession: value => sessions.push(value) });
    assert.equal(done.summary, 'Renamed the helper.');
    assert.equal(done.session.id, '5f0c1e2a-0000-4000-8000-000000000001'); assert.equal(sessions.at(-1).provider, 'cursor');
    let [work] = await cursor.runs();
    assert.ok(work.includes('--force')); assert.deepEqual(work.slice(work.indexOf('--sandbox'), work.indexOf('--sandbox') + 2), ['--sandbox', 'enabled']);
    assert.ok(!work.includes('--mode'));
    // The next turn resumes the same Cursor chat, read-only.
    await fs.writeFile(cursor.binary, (await fs.readFile(cursor.binary, 'utf8')).replace('{\\"status\\":\\"completed\\",\\"summary\\":\\"Renamed the helper.\\"}', '{\\"message\\":\\"It renames one helper.\\"}'));
    const chat = await engine.implementPlan({ provider: 'cursor', cliPath: cursor.binary, cwd: cursor.dir, prompt: 'What changed?', mode: 'chat', session: done.session });
    assert.equal(chat.summary, 'It renames one helper.');
    const [, ask] = await cursor.runs();
    assert.deepEqual(ask.slice(ask.indexOf('--mode'), ask.indexOf('--mode') + 2), ['--mode', 'ask']); assert.ok(!ask.includes('--force'));
    assert.deepEqual(ask.slice(ask.indexOf('--resume'), ask.indexOf('--resume') + 2), ['--resume', done.session.id]);
  } finally { await cursor.close(); }
});

test('Cursor: an older CLI without Ask mode is refused for read-only work, errors and non-JSON replies are reported', async () => {
  const old = await fakeCursor({ help: '--print --model' }), failing = await fakeCursor({ fail: 'Not logged in' }), chatty = await fakeCursor({ answer: 'Sure! Here are the files.' });
  try {
    await assert.rejects(engine.requestStructured({ provider: 'cursor', cliPath: old.binary, prompt: 'p', schema: engine.RANK_SCHEMA }), /no read-only Ask mode.*cursor-agent update/);
    assert.deepEqual(await old.runs(), [], 'nothing ran');
    await assert.rejects(engine.requestStructured({ provider: 'cursor', cliPath: failing.binary, prompt: 'p', schema: engine.RANK_SCHEMA }), error => /Not logged in/.test(error.message) && engine.isSetupProblem(error.message));
    await assert.rejects(engine.requestStructured({ provider: 'cursor', cliPath: chatty.binary, prompt: 'p', schema: engine.RANK_SCHEMA }), /did not return the JSON answer/);
  } finally { await Promise.all([old.close(), failing.close(), chatty.close()]); }
});

test('Cursor setup: found in ~/.local/bin, sign-in read from cursor-agent status, models from its list, no effort levels', async () => {
  const cursor = await fakeCursor();
  try {
    const home = path.join(cursor.dir, 'home'), bin = path.join(home, '.local', 'bin');
    await fs.mkdir(bin, { recursive: true }); await fs.writeFile(path.join(bin, 'cursor-agent'), '#!/bin/sh\n'); await fs.chmod(path.join(bin, 'cursor-agent'), 0o755);
    assert.equal(await engine.findCLI('cursor', '', { platform: 'darwin', env: { PATH: '' }, home }), path.join(bin, 'cursor-agent'));
    await assert.rejects(engine.findCLI('cursor', '', { platform: 'darwin', env: { PATH: '' }, home: path.join(cursor.dir, 'nobody') }), error => /Cursor was not found/.test(error.message) && !/ChatGPT/.test(error.message));
    const status = await engine.providerStatus('cursor', cursor.binary, { fresh: true });
    assert.equal(status.ready, true); assert.equal(status.signedIn, true); assert.equal(status.account, 'reader@example.com');
    const models = await engine.listModels('cursor', cursor.binary);
    assert.deepEqual(models.map(model => [model.id, model.label, model.isDefault]), [['auto', 'Auto', true], ['gpt-6', 'GPT-6', false], ['sonnet-5', 'Claude Sonnet 5', false]]);
    assert.deepEqual(await engine.listEfforts('cursor', 'gpt-6', cursor.binary), []);
    assert.equal(await engine.fastModel('cursor', cursor.binary), undefined);
    assert.equal(await engine.reviewModel('cursor', cursor.binary), undefined);
  } finally { await cursor.close(); }
});
