'use strict';
// Local session discovery/import only. No model turns, shell interpolation or
// cross-project transcript reads. Resume uses the original provider session ID.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
const sameRoot = async (a, b) => { if (!a || !b) return false; const real = async value => fs.realpath(value).catch(() => path.resolve(value)); const [x, y] = await Promise.all([real(a), real(b)]); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };
const milliseconds = value => Number(value) < 100000000000 ? Number(value) * 1000 : Number(value);
// Providers may derive a thread's title/preview from Yamori's full request.
// Those prompts are transport, not something to print into the conversation.
function isTransportPrompt(text) {
  return typeof text === 'string' && (text.includes('PROJECT CONVERSATION (history is context') || /^(?:The user approved this Yamori plan\.|Answer the current question about this project\.|Continue as the project coding agent\.|Discuss this project using read-only Yamori tools\.|You plan a code change for a person)/.test(text.trimStart()));
}
function cleanTitle(value, fallback = 'Yamori conversation') {
  let text = typeof value === 'string' ? value : '';
  if (isTransportPrompt(text)) {
    const request = text.match(/\nCURRENT (?:USER REQUEST|QUESTION):\s*([\s\S]+)$/);
    try { text = request ? JSON.parse(request[1]) : fallback; } catch { text = fallback; }
    if (typeof text !== 'string' || isTransportPrompt(text)) text = fallback;
  }
  return text.replace(/[\x00-\x1f\x7f\s]+/g, ' ').trim().slice(0, 160) || fallback;
}
function decodeText(text) {
  try { const value = JSON.parse(text); const keys = Object.keys(value); if (keys.length === 1 && typeof value.message === 'string') return value.message; if (keys.length === 2 && ['completed', 'blocked'].includes(value.status) && typeof value.summary === 'string') return value.summary; if (keys.length === 2 && 'draft' in value && 'patch' in value) { if (value.draft?.summary) return value.draft.summary; if (value.patch?.message) return value.patch.message; } } catch {}
  return text;
}
function visible(items, provider) {
  const out = [];
  for (const [index, item] of items.entries()) {
    let role, text, activity = false;
    const type = item.type;
    if (type === 'userMessage') { role = 'user'; text = (item.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n'); }
    else if (type === 'agentMessage') { role = 'assistant'; text = item.text; activity = item.phase === 'commentary' || item.channel === 'commentary'; }
    else if (type === 'commandExecution') { role = 'tool'; text = 'Command: ' + item.command + (item.aggregatedOutput ? '\n' + item.aggregatedOutput : ''); }
    else if (type === 'fileChange') { role = 'tool'; text = 'Changed files: ' + (item.changes || []).map(change => change.path).join(', '); }
    else if (provider === 'claude' && ['user', 'assistant'].includes(type)) {
      const content = item.message?.content;
      role = Array.isArray(content) && content.length && content.every(part => part.type === 'tool_result') ? 'tool' : type;
      text = typeof content === 'string' ? content : (content || []).flatMap(part => part.type === 'text' ? [part.text] : part.type === 'tool_result' ? ['Tool result: ' + (typeof part.content === 'string' ? part.content : JSON.stringify(part.content))] : []).join('\n');
      activity = type === 'assistant' && (item.message?.stop_reason === 'tool_use' || Array.isArray(content) && content.some(part => part.type === 'tool_use'));
      if (!text && activity) { role = 'tool'; text = (content || []).filter(part => part.type === 'tool_use').map(part => 'Tool: ' + part.name).join('\n'); }
    }
    if (!role || typeof text !== 'string' || !text.trim()) continue;
    // Yamori's transport prompts are already represented by real user messages
    // in its journal; don't re-import the prompt wrapper as a new user request.
    if (role === 'user' && isTransportPrompt(text)) continue;
    const transport = role === 'assistant' && decodeText(text) !== text;
    out.push({ ...(activity || role === 'tool' ? { kind: 'activity' } : {}), ...(transport ? { transport: true } : {}), id: item.id || item.uuid || provider + '-' + index, role, text: role === 'assistant' ? decodeText(text) : text, at: item.timestamp ? new Date(item.timestamp).getTime() : undefined });
  }
  return out;
}
async function codexClient(configured, work, options = {}) {
  const engine = options.engine || require('../ai/engine'), binary = await engine.findCLI('codex', configured), launch = engine.cliLaunch(binary, ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}', '--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks']);
  const child = spawn(launch.command, launch.args, { env: launch.env || process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  let buffer = '', next = 0, stderr = ''; const waiting = new Map();
  const rejectAll = error => { for (const value of waiting.values()) value.reject(error); waiting.clear(); };
  child.on('error', rejectAll); child.on('close', code => rejectAll(new Error('Codex local history closed (' + code + '). ' + stderr.slice(-400)))); child.stdin.on('error', () => {}); child.stderr.on('data', data => { stderr = (stderr + data).slice(-1000); });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', data => {
    buffer += data; if (buffer.length > 64000000) { rejectAll(new Error('This transcript is too large to import.')); child.kill(); return; }
    let newline; while ((newline = buffer.indexOf('\n')) >= 0) { let message; try { message = JSON.parse(buffer.slice(0, newline)); } catch {} buffer = buffer.slice(newline + 1); if (!message) continue; const pending = waiting.get(message.id); if (!pending || message.method) continue; waiting.delete(message.id); message.error ? pending.reject(new Error(message.error.message || 'Could not read Codex history.')) : pending.resolve(message.result); }
  });
  const request = (method, params) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  const timer = setTimeout(() => { rejectAll(new Error('Local session lookup timed out.')); child.kill(); }, 20000); timer.unref();
  try { await request('initialize', { clientInfo: { name: 'yamori_history', version: '0.26.0' }, capabilities: { experimentalApi: true } }); child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n'); return await work(request); }
  finally { clearTimeout(timer); child.kill(); }
}
const claudeFolder = (root, options = {}) => path.join(options.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', path.resolve(root).replace(/[^A-Za-z0-9]/g, '-'));
async function head(file, size = 262144) { const handle = await fs.open(file, 'r'); try { const buffer = Buffer.alloc(size), { bytesRead } = await handle.read(buffer, 0, size, 0); return buffer.subarray(0, bytesRead).toString('utf8'); } finally { await handle.close(); } }
function records(text) { return text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
async function list(provider, root, configured, options = {}) {
  if (provider === 'codex') return codexClient(configured, async rpc => {
    const result = await rpc('thread/list', { cwd: root, currentAccountOnly: true, sourceKinds: ['cli', 'vscode', 'exec', 'appServer'], limit: 50, sortKey: 'updated_at', sortDirection: 'desc' });
    const matches = []; for (const thread of result.data || []) if (!thread.ephemeral && await sameRoot(thread.cwd, root)) matches.push({ provider, id: thread.id, cwd: root, title: cleanTitle(thread.name || thread.preview, 'Codex conversation'), updatedAt: milliseconds(thread.updatedAt), branch: thread.gitInfo?.branch }); return matches;
  }, options);
  if (provider !== 'claude') throw new Error('Choose Codex or Claude Code.');
  const folder = claudeFolder(root, options); let files; try { files = await fs.readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const entries = await Promise.all(files.filter(name => name.endsWith('.jsonl') && validId(name.slice(0, -6))).map(async name => {
    const file = path.join(folder, name), rows = records(await head(file)), cwd = rows.find(row => row.cwd)?.cwd;
    if (cwd && !(await sameRoot(cwd, root))) return undefined;
    const user = visible(rows, provider).find(row => row.role === 'user');
    return { provider, id: name.slice(0, -6), cwd: root, title: cleanTitle(user?.text, 'Claude Code conversation'), updatedAt: (await fs.stat(file)).mtimeMs };
  }));
  return entries.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}
async function read(provider, id, root, configured, options = {}) {
  if (!validId(id)) throw new Error('Invalid session ID.');
  if (provider === 'codex') return codexClient(configured, async rpc => {
    const metadata = (await rpc('thread/read', { threadId: id, includeTurns: false })).thread;
    if (!(await sameRoot(metadata.cwd, root))) throw new Error('That conversation belongs to a different project.');
    const items = []; let cursor, pages = 0;
    try { do { const page = await rpc('thread/turns/list', { threadId: id, itemsView: 'full', sortDirection: 'asc', limit: 50, ...(cursor ? { cursor } : {}) }); for (const turn of page.data || []) items.push(...(turn.items || [])); cursor = page.nextCursor; } while (cursor && ++pages < 100); }
    catch (error) { if (!/method not found|unknown (?:variant|method)/i.test(error.message)) throw error; const thread = (await rpc('thread/read', { threadId: id, includeTurns: true })).thread; for (const turn of thread.turns || []) items.push(...(turn.items || [])); }
    return { provider, id, cwd: root, title: cleanTitle(metadata.name || metadata.preview, 'Codex conversation'), messages: visible(items, provider), ...(metadata.model ? { model: metadata.model } : {}) };
  }, options);
  if (provider !== 'claude') throw new Error('Choose Codex or Claude Code.');
  const file = path.join(claudeFolder(root, options), id + '.jsonl'); if ((await fs.stat(file)).size > 64000000) throw new Error('This Claude transcript is too large to import.');
  const rows = records(await fs.readFile(file, 'utf8')), cwd = rows.find(row => row.cwd)?.cwd;
  if (!(await sameRoot(cwd, root))) throw new Error('That conversation belongs to a different project.');
  return { provider, id, cwd: root, title: cleanTitle(visible(rows, provider).find(row => row.role === 'user')?.text, 'Claude Code conversation'), messages: visible(rows, provider) };
}
module.exports = { list, read, visible, sameRoot, claudeFolder, cleanTitle, isTransportPrompt };
