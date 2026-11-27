'use strict';
// With/without Yamori MCP benchmark: the same read-only questions, answered by
// Claude Code and Codex without Yamori, with it, and told to start with the
// map. Spends real tokens on your own sign-ins; not part of npm test.
// node scripts/bench-mcp/run.js [--tasks file] [--only id,id] [--agents claude,codex] [--arms without,with,mapfirst] [--reps n] [--par n] [--out dir]
// Projects in tasks.json must be mapped in Yamori first (open them in VS Code).
// --no-approve leaves Codex's MCP approval as configured (checks read-only hints).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const HERE = __dirname;
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const OUT = path.resolve(arg('out', path.join(HERE, 'results')));
fs.mkdirSync(OUT, { recursive: true });
const { projects, tasks } = JSON.parse(fs.readFileSync(path.resolve(arg('tasks', path.join(HERE, 'tasks.example.json'))), 'utf8'));
const only = arg('only') ? arg('only').split(',') : undefined, agents = arg('agents', 'claude,codex').split(','), arms = arg('arms', 'without,with').split(','), reps = Number(arg('reps', 1)), par = Number(arg('par', 4));
const LAUNCHER = process.env.YAMORI_MCP || process.env.HOME + '/Library/Application Support/Code/User/globalStorage/cowana-ai.yamori/bin/yamori-mcp.js';
const CODEX = process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const CLAUDE_MODEL = arg('claude-model', 'sonnet');
const WRITE_TOOLS = ['save_plan', 'show_in_yamori', 'add_note', 'done', 'save_pseudocode', 'propose_change'];
// What Yamori's own terminal session is told, minus the tools that write.
const RULES = `This project is mapped by Yamori (MCP server "yamori").
- For where or how questions, call the yamori find tool: it returns the matching functions with their current code, callers and callees, so you can usually answer from it without grep or reading files, and its code needs no re-reading. Say what the code shows, not what you assume.
- To explain how the parts fit together, use list_stages and get_stage; notes there are the founder's rules, follow them.`;
const MAP_FIRST = RULES + '\n- Start with the yamori find tool before reading or searching files.';
const rulesFor = arm => arm === 'mapfirst' ? MAP_FIRST : RULES;
const prompt = task => task.q + '\n\nAnswer from this project\'s code. Do not edit any files. Answer in at most 150 words and name the files and functions involved (file paths and function or class names).';

function claudeArgs(task, arm) {
  const uses = arm !== 'without';
  const mcp = uses ? { mcpServers: { yamori: { type: 'stdio', command: process.execPath, args: [LAUNCHER], env: { ELECTRON_RUN_AS_NODE: '1' } } } } : { mcpServers: {} };
  return ['-p', prompt(task), '--output-format', 'stream-json', '--verbose', '--model', CLAUDE_MODEL, '--no-session-persistence', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp),
    '--allowedTools', 'Read,Grep,Glob,Bash(grep:*),Bash(rg:*),Bash(ls:*),Bash(sed:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(find:*),Bash(wc:*),Bash(git grep:*),Bash(git ls-files:*)' + (uses ? ',mcp__yamori' : ''),
    '--disallowedTools', ['Edit', 'Write', 'NotebookEdit', ...WRITE_TOOLS.map(name => 'mcp__yamori__' + name)].join(','),
    ...(uses ? ['--append-system-prompt', rulesFor(arm)] : [])];
}
function codexArgs(task, arm) {
  // Your other Codex MCP servers, off in every setup so only Yamori differs.
  const off = (process.env.CODEX_DISABLE || 'node_repl,computer-use,cloudflare').split(',').filter(Boolean).flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
  const yamori = arm !== 'without'
    ? [...(process.argv.includes('--no-approve') ? [] : ['-c', 'mcp_servers.yamori.default_tools_approval_mode="approve"']), '-c', 'mcp_servers.yamori.command=' + JSON.stringify(process.execPath), '-c', 'mcp_servers.yamori.args=' + JSON.stringify([LAUNCHER]), '-c', 'mcp_servers.yamori.env={ELECTRON_RUN_AS_NODE="1"}', '-c', 'mcp_servers.yamori.disabled_tools=' + JSON.stringify(WRITE_TOOLS), '-c', 'developer_instructions=' + JSON.stringify(rulesFor(arm))]
    : ['-c', 'mcp_servers.yamori.enabled=false'];
  return ['exec', '--json', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-c', 'approval_policy="never"', ...off, ...yamori, prompt(task)];
}

function parseClaude(lines) {
  const r = { tools: 0, yamori: 0, answer: '', tokens: 0, cost: 0, turns: 0, names: {} };
  for (const line of lines) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'assistant') for (const c of m.message?.content || []) if (c.type === 'tool_use') { r.tools++; r.names[c.name] = (r.names[c.name] || 0) + 1; if (c.name.startsWith('mcp__yamori')) r.yamori++; }
    if (m.type === 'result') { r.answer = m.result || ''; r.cost = m.total_cost_usd || 0; r.turns = m.num_turns; const u = m.usage || {}; r.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); r.cached = u.cache_read_input_tokens || 0; r.output = u.output_tokens || 0; r.tokens = r.input + r.output; r.error = m.is_error ? m.subtype : undefined; }
  }
  r.tools -= r.names.ToolSearch || 0; // loading tool schemas is not work on the task
  return r;
}
function parseCodex(lines) {
  const r = { tools: 0, yamori: 0, answer: '', tokens: 0, input: 0, cached: 0, output: 0, names: {} };
  for (const line of lines) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'item.completed') {
      const it = m.item || {};
      if (it.type === 'agent_message') r.answer = it.text || r.answer;
      else if (['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(it.type)) { r.tools++; const name = it.type === 'mcp_tool_call' ? it.server + '.' + it.tool : it.type; r.names[name] = (r.names[name] || 0) + 1; if (it.server === 'yamori') r.yamori++; }
    }
    if (m.type === 'turn.completed') { const u = m.usage || {}; r.input += u.input_tokens || 0; r.cached += u.cached_input_tokens || 0; r.output += u.output_tokens || 0; }
    if (m.type === 'turn.failed' || m.type === 'error') r.error = JSON.stringify(m).slice(0, 300);
  }
  r.tokens = r.input + r.output;
  return r;
}

function runOne(job) {
  return new Promise(resolve => {
    const { task, agent, arm, rep } = job, cwd = projects[task.project];
    const [cmd, args] = agent === 'claude' ? ['claude', claudeArgs(task, arm)] : [CODEX, codexArgs(task, arm)];
    const started = Date.now(), child = spawn(cmd, args, { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60 * 1000);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      const lines = out.split('\n').filter(Boolean), parsed = agent === 'claude' ? parseClaude(lines) : parseCodex(lines);
      const hits = task.must.map(re => new RegExp(re, 'i').test(parsed.answer));
      const row = { task: task.id, project: task.project, agent, arm, rep, code, seconds: Math.round((Date.now() - started) / 100) / 10, score: hits.filter(Boolean).length / hits.length, missed: task.must.filter((_, i) => !hits[i]), ...parsed };
      const base = `${task.id}.${agent}.${arm}.${rep}`;
      fs.writeFileSync(path.join(OUT, base + '.jsonl'), out); if (err) fs.writeFileSync(path.join(OUT, base + '.err'), err.slice(-20000));
      fs.writeFileSync(path.join(OUT, base + '.json'), JSON.stringify(row, null, 1));
      console.log([base, 'score=' + row.score.toFixed(2), 'tok=' + row.tokens, 'cost=' + (row.cost ?? '-'), 's=' + row.seconds, 'tools=' + row.tools, 'yamori=' + row.yamori, row.error || ''].join(' '));
      resolve(row);
    });
  });
}

(async () => {
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) for (const task of tasks) if (!only || only.includes(task.id)) for (const agent of agents) for (const arm of arms) {
    if (fs.existsSync(path.join(OUT, `${task.id}.${agent}.${arm}.${rep}.json`)) && !process.argv.includes('--fresh')) continue;
    jobs.push({ task, agent, arm, rep });
  }
  console.log(jobs.length + ' runs');
  let next = 0;
  await Promise.all(Array.from({ length: par }, async () => { while (next < jobs.length) await runOne(jobs[next++]); }));
})();
