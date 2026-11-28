'use strict';
// The founder's own Claude Code and Codex, connected to Yamori: the stable MCP
// launcher, Connect/Disconnect, and the one agent session per project in the
// VS Code terminal. Dependencies come from extension.js so tests can swap them.
const fs = require('node:fs/promises');
const path = require('node:path');
const { render, text: promptText } = require('../prompts');
const { MCP_SERVER_NAME, NODE_RUNTIME_ENV, LAUNCHER, AGENT_SESSION } = require('../config');

module.exports = function agentSessions({ vscode, os, engine, connectionOptions, cliPathFor }) {
  const { PROVIDERS, cliLaunch, findCLI, runProcess } = engine;
  // ---- Your own Claude Code and Codex sessions use Yamori ----
  // A stable launcher in Yamori's storage starts the knowledge server from the
  // installed extension, so extension updates never break the registration.
  async function writeLauncher(context, api = vscode) {
    const bin = path.join(context.globalStorageUri.fsPath, LAUNCHER.dir), cacheRoot = path.join(context.globalStorageUri.fsPath, LAUNCHER.cache);
    await fs.mkdir(bin, { recursive: true });
    const extension = context.extensionUri?.fsPath || path.join(__dirname, '..', '..');
    await fs.writeFile(path.join(bin, LAUNCHER.current), JSON.stringify({ extension, cache: cacheRoot, updatedAt: Date.now() }));
    const launcher = path.join(bin, LAUNCHER.script);
    await fs.writeFile(launcher, [
      '#!/usr/bin/env node',
      "// Written by the Yamori extension: starts Yamori's knowledge server",
      '// from the installed extension. Safe to delete; Connect writes it again.',
      "'use strict';",
      "const fs = require('fs'), path = require('path');",
      "const current = JSON.parse(fs.readFileSync(path.join(__dirname, '" + LAUNCHER.current + "'), 'utf8'));",
      "require(path.join(current.extension, 'src', 'project', 'mcp.js')).main(process.argv.slice(2), { cache: current.cache });",
      ''
    ].join('\n'));
    return { launcher, runtime: process.execPath, env: { ...NODE_RUNTIME_ENV } };
  }
  // One agent session per project in the VS Code terminal: Claude Code, Codex or Cursor,
  // connected to Yamori's MCP server, told to look at what the founder has open
  // and to plan onto Yamori's canvas. It survives closing Yamori's panels; with
  // Claude Code the same conversation resumes after a restart.
  const SESSION_RULES = promptText('agent/session-rules');
  // What the terminal agent is told when the founder presses Approve in Yamori.
  const APPROVED_PROMPT = count => render('agent/approved', { count, plural: count === 1 ? '' : 's' });
  // Comments the founder added on the canvas since the last edit, as one line for
  // the agent's prompt. They gather there until the founder sends them.
  function planComments(before, after) {
    const out = [];
    (after?.steps || []).forEach((step, index) => {
      const now = String(step.note || '').trim(), old = String(before?.steps?.find(item => item.id === step.id)?.note || '').trim();
      if (!now || now === old) return;
      const added = old && now.startsWith(old) ? now.slice(old.length).trim() : now;
      if (!added) return;
      const where = step.file + (step.newFile ? '' : ':' + step.startLine + (step.endLine !== step.startLine ? '-' + step.endLine : ''));
      out.push('[Plan comment · step ' + (index + 1) + ' “' + step.title + '” (' + where + ')] ' + added.replace(/\s*\n\s*/g, ' / '));
    });
    return out.length ? out.join(' ') + ' ' : '';
  }
  function createAgentSessions(context, api = vscode, { find = findCLI } = {}) {
    const open = new Map();
    const name = entry => AGENT_SESSION.terminalPrefix + path.basename(entry.root.fsPath);
    const alive = entry => {
      const known = open.get(entry.root.toString());
      if (known && !known.exitStatus) return known;
      // A terminal VS Code restored after a reload: same name, same project.
      return (api.window.terminals || []).find(terminal => terminal.name === name(entry) && !terminal.exitStatus);
    };
    // A Claude Code conversation exists once it has a transcript on disk.
    const claudeTranscript = id => { try { const dir = path.join(os.homedir(), '.claude', 'projects'); return require('node:fs').readdirSync(dir).some(folder => require('node:fs').existsSync(path.join(dir, folder, id + '.jsonl'))); } catch { return false; } };
    async function start(entry) {
      const provider = PROVIDERS[context.globalState.get('provider')] ? context.globalState.get('provider') : 'claude';
      const { model, cliPath } = connectionOptions(context.globalState, provider, api);
      const binary = await find(provider, cliPath);
      const launcher = await writeLauncher(context, api);
      const server = { command: launcher.runtime, args: [launcher.launcher], env: { ...NODE_RUNTIME_ENV } };
      let args;
      if (provider === 'claude') {
        const key = AGENT_SESSION.stateKey + entry.root.toString();
        let id = context.globalState.get(key);
        const resume = id && claudeTranscript(id);
        if (!resume) { id = require('node:crypto').randomUUID(); await context.globalState.update(key, id); }
        args = [...(resume ? ['--resume', id] : ['--session-id', id]), '--append-system-prompt', SESSION_RULES, '--mcp-config', JSON.stringify({ mcpServers: { yamori: { type: 'stdio', ...server } } }), ...(model ? ['--model', model] : [])];
      } else if (provider === 'cursor') {
        // Cursor's CLI takes no system prompt or per-run MCP config: the rules are its
        // first message, and Yamori's tools come from ~/.cursor/mcp.json (Connect agents).
        args = ['--approve-mcps', ...(model ? ['--model', model] : []), '--', SESSION_RULES + '\n\nReply only "Ready." now.'];
      } else {
        args = ['-c', 'developer_instructions=' + JSON.stringify(SESSION_RULES), '-c', 'mcp_servers.yamori.command=' + JSON.stringify(server.command), '-c', 'mcp_servers.yamori.args=' + JSON.stringify(server.args), '-c', 'mcp_servers.yamori.env={ELECTRON_RUN_AS_NODE="1"}', ...(model ? ['--model', model] : [])];
      }
      const launch = cliLaunch(binary, args);
      const terminal = api.window.createTerminal({ name: name(entry), cwd: entry.root.fsPath, shellPath: launch.command, shellArgs: launch.args, env: launch.env, isTransient: false });
      open.set(entry.root.toString(), terminal);
      return terminal;
    }
    return {
      alive: entry => !!alive(entry),
      // Ready in the background (not shown, no focus taken) so Chat opens at once.
      async ensure(entry) {
        if (api.workspace.isTrusted === false || !api.window.createTerminal || alive(entry)) return;
        if (!PROVIDERS[context.globalState.get('provider')]) return;
        await start(entry);
      },
      async open(entry, { prefill = '', submit = false, preserveFocus = false } = {}) {
        if (api.workspace.isTrusted === false) throw new Error('Trust this workspace to start an agent session.');
        if (!api.window.createTerminal) throw new Error('The integrated terminal is unavailable.');
        const existing = alive(entry), terminal = existing || await start(entry);
        terminal.show(preserveFocus);
        // Puts words on the agent's prompt; without submit they wait there for you to send.
        // Enter goes separately, so the agent's prompt takes the text as typed, not as a paste.
        if (prefill) setTimeout(() => { terminal.sendText(prefill, false); if (submit) setTimeout(() => terminal.sendText('\r', false), AGENT_SESSION.submitDelayMs); }, existing ? 0 : AGENT_SESSION.firstPrefillDelayMs);
        return terminal;
      }
    };
  }
  // Everything Connect changes, described before anything is changed: only the
  // registration of Yamori's knowledge server with each CLI.
  function agentPlan(launch, { claude, codex, home = os.homedir() } = {}) {
    return {
      claude: claude && { cli: claude, add: ['mcp', 'add', '--scope', 'user', MCP_SERVER_NAME, '-e', 'ELECTRON_RUN_AS_NODE=1', '--', launch.runtime, launch.launcher], remove: ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME],
        // Earlier versions also wrote these; Connect and Disconnect remove them.
        legacy: { settings: path.join(home, '.claude', 'settings.json'), instructions: path.join(home, '.claude', 'CLAUDE.md') } },
      codex: codex && { cli: codex, add: ['mcp', 'add', MCP_SERVER_NAME, '--env', 'ELECTRON_RUN_AS_NODE=1', '--', launch.runtime, launch.launcher], remove: ['mcp', 'remove', MCP_SERVER_NAME], legacy: { instructions: path.join(home, '.codex', 'AGENTS.md') } }
    };
  }
  // The marked rules block an earlier version added to an instructions file.
  function stripRulesBlock(text) {
    const clean = String(text || '').replace(/\n?<!-- yamori:start[^>]*-->[\s\S]*?<!-- yamori:end -->\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    return clean ? clean + '\n' : '';
  }
  // Hooks an earlier version added to Claude Code's settings.json, recognised by the launcher name.
  function stripHooks(settings) {
    const next = { ...(settings || {}) }, all = { ...(next.hooks || {}) };
    for (const event of Object.keys(all)) {
      all[event] = (all[event] || []).map(group => ({ ...group, hooks: (group.hooks || []).filter(hook => !String(hook.command || '').includes(LAUNCHER.script)) })).filter(group => group.hooks.length);
      if (!all[event].length) delete all[event];
    }
    if (Object.keys(all).length) next.hooks = all; else delete next.hooks;
    return next;
  }
  async function connectAgents(context, api = vscode, { run = runProcess, discover = findCLI, home = os.homedir(), platform = process.platform, disconnect = false } = {}) {
    const launch = await writeLauncher(context, api);
    const [claude, codex] = await Promise.all(['claude', 'codex'].map(owner => discover(owner, cliPathFor(api, owner)).catch(() => undefined)));
    const plan = agentPlan(launch, { claude, codex, home });
    if (!plan.claude && !plan.codex) { api.window.showWarningMessage?.('Yamori: neither Claude Code nor Codex is installed. Use Yamori: Set Up AI first.'); return; }
    const action = disconnect ? 'Disconnect' : 'Connect';
    const choice = await api.window.showWarningMessage(disconnect ? 'Remove Yamori\'s knowledge server from your Claude Code and Codex?' : 'Add Yamori\'s knowledge server to your own Claude Code and Codex sessions?\n\nThey can then look up the project map, your stages and their notes, and Yamori\'s pseudocode, and save pseudocode for files that have none, so you see it in Yamori without generating it. This only registers the server (claude mcp add, codex mcp add, and the yamori entry in ~/.cursor/mcp.json when Cursor is installed); your settings and instruction files are not changed.', { modal: true }, action);
    if (choice !== action) return;
    const results = [];
    // Remove what earlier versions wrote; never create these files.
    const clean = async (file, change) => { const before = await fs.readFile(file, 'utf8').catch(() => undefined); if (before === undefined) return; let after; try { after = change(before); } catch { return; } if (after !== before) await fs.writeFile(file, after); };
    for (const [name, item] of [['Claude Code', plan.claude], ['Codex', plan.codex]]) {
      if (!item) { results.push(name + ': not installed'); continue; }
      try {
        await run(item.cli, item.remove, '', { timeout: 20000 }).catch(() => {});
        if (!disconnect) await run(item.cli, item.add, '', { timeout: 20000 });
        await clean(item.legacy.instructions, stripRulesBlock);
        if (item.legacy.settings) await clean(item.legacy.settings, text => JSON.stringify(stripHooks(JSON.parse(text)), null, 2) + '\n');
        results.push(name + (disconnect ? ': disconnected' : ': connected'));
      } catch (error) { results.push(name + ': ' + String(error.message || error).split('\n')[0].slice(0, 200)); }
    }
    // Cursor reads ~/.cursor/mcp.json; only touched when Cursor is installed.
    const cursorDir = path.join(home, '.cursor');
    if (await fs.stat(cursorDir).then(stat => stat.isDirectory(), () => false)) {
      try {
        const file = path.join(cursorDir, 'mcp.json'), before = await fs.readFile(file, 'utf8').catch(() => undefined);
        const config = before === undefined ? {} : JSON.parse(before);
        const servers = { ...(config.mcpServers || {}) };
        if (disconnect) delete servers[MCP_SERVER_NAME]; else servers[MCP_SERVER_NAME] = { command: launch.runtime, args: [launch.launcher], env: { ...NODE_RUNTIME_ENV } };
        const after = JSON.stringify({ ...config, mcpServers: servers }, null, 2) + '\n';
        if (after !== before && !(before === undefined && disconnect)) await fs.writeFile(file, after);
        results.push('Cursor' + (disconnect ? ': disconnected' : ': connected'));
      } catch (error) { results.push('Cursor: ' + String(error.message || error).split('\n')[0].slice(0, 200)); }
    }
    await context.globalState.update('agentsConnected', !disconnect && results.some(row => /connected$/.test(row)));
    api.window.showInformationMessage?.('Yamori · ' + results.join(' · ') + (disconnect ? '' : '. Start a new Claude Code or Codex session to use it.'));
    return results;
  }

  return { writeLauncher, SESSION_RULES, APPROVED_PROMPT, planComments, createAgentSessions, agentPlan, stripRulesBlock, stripHooks, connectAgents };
};
