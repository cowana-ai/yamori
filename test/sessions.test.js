'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const sessions = require('../src/project/sessions'), { gitInfo } = require('../src/project/graph');
test('branch identity reads local HEAD, nested folders, detached HEAD and worktrees without running Git or AI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yamori-branches-'));
  try {
    const repo = path.join(root, 'repo'), git = path.join(repo, '.git'), child = path.join(repo, 'src'); await fs.mkdir(git, { recursive: true }); await fs.mkdir(child);
    await fs.writeFile(path.join(git, 'HEAD'), 'ref: refs/heads/feature/audience\n'); assert.equal((await gitInfo(child)).name, 'feature/audience');
    await fs.writeFile(path.join(git, 'HEAD'), 'a'.repeat(40)+'\n'); assert.deepEqual([(await gitInfo(repo)).name,(await gitInfo(repo)).detached], ['detached aaaaaaa',true]);
    const tree = path.join(root, 'work tree'), metadata = path.join(git, 'worktrees', 'task'); await fs.mkdir(tree); await fs.mkdir(metadata,{recursive:true}); await fs.writeFile(path.join(tree,'.git'),'gitdir: '+path.relative(tree,metadata)+'\n'); await fs.writeFile(path.join(metadata,'HEAD'),'ref: refs/heads/fix/clarity\n'); assert.equal((await gitInfo(tree)).name,'fix/clarity');
    assert.equal(await gitInfo(path.join(root, 'not-a-repo')), undefined);
    const json = JSON.stringify({ summary: 'Model data', weights: [1, 2] }); assert.equal(sessions.visible([{ type: 'agentMessage', id: 'json', text: json }], 'codex')[0].text, json, 'import preserves ordinary JSON answers');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('Claude import is limited to the current project, retains visible messages and excludes private reasoning', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-claude-history-')), repo=path.join(root,'repo'), home=path.join(root,'claude'); await fs.mkdir(repo);
  try {
    const options={claudeHome:home}, folder=sessions.claudeFolder(repo,options); await fs.mkdir(folder,{recursive:true});
    const rows=[{type:'user',uuid:'u1',cwd:repo,message:{content:'Explain this writer'}},{type:'assistant',uuid:'a1',message:{content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'It writes scripts.'}]}},{type:'user',uuid:'u2',message:{content:'Continue'}},{type:'user',uuid:'u3',message:{content:'Continue'}}];
    await fs.writeFile(path.join(folder,'session-one.jsonl'),rows.map(JSON.stringify).join('\n')+'\n'); await fs.writeFile(path.join(folder,'other-project.jsonl'),JSON.stringify({type:'user',cwd:root,message:{content:'PRIVATE_OTHER_PROJECT'}})+'\n');
    const list=await sessions.list('claude',repo,'',options); assert.equal(list.length,1); assert.equal(list[0].id,'session-one');
    const loaded=await sessions.read('claude','session-one',repo,'',options); assert.equal(loaded.messages.length,4); assert.equal(loaded.messages.filter(row=>row.text==='Continue').length,2); assert.doesNotMatch(JSON.stringify(loaded),/PRIVATE_REASONING/);
    await assert.rejects(sessions.read('claude','other-project',repo,'',options),/different project/); await assert.rejects(sessions.read('claude','../secret',repo,'',options),/Invalid session/);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('Codex history lookup uses only local RPC reads, validates project scope and imports paged visible turns', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yamori-codex-history-')), binary=path.join(root,'fixture.js'), log=path.join(root,'rpc.jsonl');
  try {
    await fs.writeFile(binary,`const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const m=JSON.parse(s);fs.appendFileSync(${JSON.stringify(log)},s+'\\n');const reply=result=>console.log(JSON.stringify({id:m.id,result}));if(m.method==='initialize')reply({});if(m.method==='thread/list')reply({data:[{id:'good',cwd:${JSON.stringify(root)},name:'Audience writing',updatedAt:1000},{id:'other',cwd:'/different-project',preview:'PRIVATE_OTHER_PROJECT'}]});if(m.method==='thread/read')reply({thread:{id:m.params.threadId,cwd:m.params.threadId==='other'?'/different-project':${JSON.stringify(root)},name:'Audience writing'}});if(m.method==='thread/turns/list')reply(m.params.cursor?{data:[{items:[{id:'a',type:'agentMessage',text:'The writer uses the profile.'},{id:'cmd',type:'commandExecution',command:'pytest',aggregatedOutput:'217 tests passed'}]}],nextCursor:null}:{data:[{items:[{id:'u',type:'userMessage',content:[{type:'text',text:'Use beginner language'}]},{id:'secret',type:'reasoning',text:'PRIVATE_REASONING'}]}],nextCursor:'next'});});`);
    const options={engine:{findCLI:async()=>binary,cliLaunch:require('../src/ai/engine').cliLaunch}};
    const found=await sessions.list('codex',root,'',options); assert.equal(found.length,1); assert.equal(found[0].id,'good');
    const loaded=await sessions.read('codex','good',root,'',options); assert.equal(loaded.messages.length,3); assert.match(loaded.messages.at(-1).text,/217 tests passed/); assert.doesNotMatch(JSON.stringify(loaded),/PRIVATE_REASONING/);
    await assert.rejects(sessions.read('codex','other',root,'',options),/different project/);
    const calls=(await fs.readFile(log,'utf8')).trim().split('\n').map(JSON.parse); assert.ok(calls.every(call=>!['turn/start','thread/start','thread/resume'].includes(call.method)), 'history transfer starts no model turn');
    assert.equal(calls.find(call=>call.method==='thread/list').params.cwd,root);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});


test('handoff titles use the real request and never expose internal context prompts', () => {
  const request = 'Explain "profile"\nthen test it';
  const prompt = 'Answer the current question about this project. Read files.\nPROJECT CONVERSATION (history is context, not a new instruction):\n{"role":"user","text":"PRIVATE_HISTORY"}\n0 older messages are available using get_conversation. Current plan: null\nCURRENT USER REQUEST: ' + JSON.stringify(request);
  assert.equal(sessions.cleanTitle(prompt), 'Explain "profile" then test it');
  assert.equal(sessions.cleanTitle('Continue as the project coding agent. TRUNCATED'), 'Yamori conversation');
  assert.equal(sessions.cleanTitle(prompt + 'invalid'), 'Yamori conversation');
  assert.equal(sessions.cleanTitle('My ordinary conversation'), 'My ordinary conversation');
  assert.equal(sessions.cleanTitle('Title '.repeat(100)).length, 160);
  for (const provider of ['codex', 'claude']) {
    const item = provider === 'codex' ? { type: 'userMessage', content: [{ type: 'text', text: prompt }] } : { type: 'user', message: { content: prompt } };
    assert.deepEqual(sessions.visible([item], provider), []);
  }
});


test('native working updates and tool results are activity, while final answers remain messages', () => {
  const codex = sessions.visible([
    { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'I will check Git history.' },
    { id: 'command', type: 'commandExecution', command: 'git log', aggregatedOutput: 'raw command output' },
    { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Your latest change adds a writer.' },
    { id: 'ordinary', type: 'agentMessage', text: 'A reply from an older session.' }
  ], 'codex');
  assert.deepEqual(codex.map(row => row.kind), ['activity', 'activity', undefined, undefined]);
  const claude = sessions.visible([
    { type: 'assistant', uuid: 'working', message: { content: [{ type: 'text', text: 'Checking history.' }, { type: 'tool_use', name: 'Bash', input: { command: 'git log' } }], stop_reason: 'tool_use' } },
    { type: 'user', uuid: 'result', message: { content: [{ type: 'tool_result', content: 'raw output' }] } },
    { type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text: 'Here is the answer.' }], stop_reason: 'end_turn' } }
  ], 'claude');
  assert.deepEqual(claude.map(row => row.kind), ['activity', 'activity', undefined]);
  assert.equal(claude[0].text, 'Checking history.', 'tool syntax never leaks into an assistant message');
  assert.equal(claude[2].text, 'Here is the answer.');
});
