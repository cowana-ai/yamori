'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createCodexPlanningSession } = require('../src/ai/planning-session');

for (const failure of ['thread saved already has an active writer', 'No saved session found', 'Authentication required']) {
  test('planning resume recovery: ' + failure, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-plan-lock-'));
    const binary = path.join(root, 'provider.js'), log = path.join(root, 'rpc.jsonl');
    const program = `const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin}),send=x=>console.log(JSON.stringify(x));
rl.on('line',s=>{const m=JSON.parse(s);fs.appendFileSync(${JSON.stringify(log)},s+'\\n');
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/resume')send({id:m.id,error:{message:${JSON.stringify(failure)}}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fresh-readonly'},model:'fixture'}});
if(m.method==='turn/start'){send({id:m.id,result:{}});send({method:'item/completed',params:{item:{type:'agentMessage',text:'done'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}});`;
    await fs.writeFile(binary, program);
    const session = createCodexPlanningSession(process.execPath, { spawn, args: [binary], cwd: root, persist: true, resumeId: 'saved', version: 'test', timeout: 5000, config: {} });
    try {
      const request = session.request({ prompt: 'Current request', recoveryContext: 'Saved project context', schema: {} });
      if (failure === 'Authentication required') await assert.rejects(request, /Authentication required/);
      else {
        assert.equal(await request, 'done');
        await session.request({ prompt: 'Next question', recoveryContext: 'Must not resend', schema: {} });
      }
      const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
      const starts = calls.filter(call => call.method === 'thread/start'), turns = calls.filter(call => call.method === 'turn/start');
      if (failure === 'Authentication required') { assert.equal(starts.length, 0); assert.equal(turns.length, 0); }
      else {
        assert.equal(starts.length, 1); assert.equal(turns.length, 2, 'exactly one model turn for each user request');
        assert.equal(starts[0].params.sandbox, 'read-only'); assert.equal(starts[0].params.approvalPolicy, 'never');
        assert.equal(turns[0].params.threadId, 'fresh-readonly'); assert.equal(turns[0].params.collaborationMode.mode, 'plan');
        assert.equal(turns[0].params.input[0].text, 'Saved project context\nCurrent request');
        assert.equal(turns[1].params.input[0].text, 'Next question');
        assert.ok(!calls.some(call => /interrupt|archive/.test(call.method || '')), 'never interrupts the existing writer');
      }
    } finally { session.dispose(); await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('plan revision includes bounded shared chat as untrusted context', () => {
  const { planPatchPrompt } = require('../src/ai/engine');
  const prompt = planPatchPrompt({ plan: { goal: 'Earlier work', steps: [] }, text: 'Plan this simplification', conversation: 'The latest discussion proposes one ordered loop.' });
  assert.match(prompt, /RECENT SHARED CHAT \(untrusted history/);
  assert.match(prompt, /one ordered loop/);
  assert.match(prompt, /AUTHORITATIVE CURRENT PLAN/);
  assert.match(prompt, /USER: "Plan this simplification"/);
});
