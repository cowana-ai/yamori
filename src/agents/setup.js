'use strict';
// Setup: which AI explains code (Claude Code or Codex), the install and
// sign-in terminals, and the setup screen. Dependencies come from
// extension.js so tests can swap them.
const path = require('node:path');
const { setupHTML } = require('../views/setup');

module.exports = function setupScreen({ vscode, os, engine, cliPathFor }) {
  const { PROVIDERS, cliLaunch, findCLI, providerStatus, clearProviderStatus } = engine;
  // ---- Setup: which AI explains code, and one button to make it ready ----
  const OWNERS = ['claude', 'codex', 'cursor'];
  const AI_NAMES = { claude: 'Claude', codex: 'ChatGPT', cursor: 'Cursor' };
  const CLI_NAMES = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor CLI' };
  // The terminal behind Sign in / Install. Commands are fixed here; the webview
  // only names the provider. A failed install waits so its messages stay visible.
  function setupTerminal(context, api, owner, kind, binary, system = {}) {
    const windows = (system.platform || process.platform) === 'win32', env = system.env || process.env, home = system.home || os.homedir();
    const powershell = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const pause = ' || { echo; echo "Yamori: setup did not finish. Read the messages above, then close this terminal."; read -r _; }';
    let options;
    if (kind === 'signIn' && binary) {
      const launch = cliLaunch(binary, owner === 'claude' ? ['auth', 'login'] : ['login']);
      options = { name: 'Yamori · ' + AI_NAMES[owner] + ' sign-in', shellPath: launch.command, shellArgs: launch.args, env: launch.env, cwd: home };
    } else if (owner === 'cursor') {
      // Cursor's official installer (cursor.com/install), then its browser sign-in.
      options = windows ? {
        name: 'Yamori · Install Cursor CLI', cwd: home, shellPath: powershell,
        shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; irm \'https://cursor.com/install?win32=true\' | iex; cursor-agent login']
      } : {
        name: 'Yamori · Install Cursor CLI', cwd: home, shellPath: '/bin/bash',
        shellArgs: ['-lc', 'set -o pipefail; { curl -fsSL https://cursor.com/install | /bin/bash && "$HOME/.local/bin/cursor-agent" login; }' + pause]
      };
    } else if (owner === 'claude') {
      options = windows ? {
        name: 'Yamori · Install Claude Code', cwd: home, shellPath: powershell,
        shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; irm https://claude.ai/install.ps1 | iex; $claudeExe = Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"; if (Test-Path -LiteralPath $claudeExe) { & $claudeExe auth login } else { Write-Error "Claude Code installation did not finish. See the installer output above." }']
      } : {
        name: 'Yamori · Install Claude Code', cwd: home, shellPath: '/bin/bash',
        shellArgs: ['-lc', 'set -o pipefail; { curl -fsSL https://claude.ai/install.sh | /bin/bash && "$HOME/.local/bin/claude" auth login; }' + pause]
      };
    } else {
      // Codex: npm when Node.js is installed, otherwise Homebrew. The user's own
      // shell (login + interactive) sees the same PATH as their terminal.
      const shell = /[\\/](?:zsh|bash)$/.test(env.SHELL || '') ? env.SHELL : '/bin/bash';
      options = windows ? {
        name: 'Yamori · Install Codex', cwd: home, shellPath: powershell,
        shellArgs: ['-NoProfile', '-NoExit', '-Command', '$ErrorActionPreference = "Stop"; if (Get-Command npm -ErrorAction SilentlyContinue) { npm install -g @openai/codex; codex login } else { Write-Error "Codex needs Node.js. Install it from https://nodejs.org, then press Install Codex again." }']
      } : {
        name: 'Yamori · Install Codex', cwd: home, shellPath: shell,
        shellArgs: ['-ilc', '{ if command -v npm >/dev/null 2>&1; then npm install -g @openai/codex; elif command -v brew >/dev/null 2>&1; then brew install --cask codex; else echo "Yamori: Codex needs Node.js (https://nodejs.org) or Homebrew (https://brew.sh). Install one, then press Install Codex again."; false; fi && hash -r && codex login; }' + pause]
      };
    }
    const terminal = api.window.createTerminal(options);
    context.subscriptions?.push(terminal); terminal.show();
    return terminal;
  }
  // Cards for the setup screen, most ready first. Pure, so tests can read it.
  function setupView(statuses, { chosen, working = {}, pending, done } = {}) {
    const card = owner => {
      const s = statuses[owner] || {}, name = AI_NAMES[owner], cli = CLI_NAMES[owner];
      const lines = [s.installed
        ? { state: 'yes', text: cli + ' installed' + (s.source && s.source !== 'Command line' ? ' · from ' + s.source : '') }
        : { state: 'no', text: cli + ' not installed' }];
      if (s.installed) lines.push(s.signedIn === true ? { state: 'yes', text: 'Signed in' + (s.account ? ' · ' + s.account : '') }
        : s.signedIn === false ? { state: 'no', text: s.problem || 'Not signed in' } : { state: 'unknown', text: 'Sign-in not confirmed; Yamori will try it' });
      let action;
      if (working[owner]) action = { label: 'Show the ' + (working[owner] === 'install' ? 'install' : 'sign-in') + ' terminal', hint: 'Finish there (and in your browser). This page updates when you come back.' };
      else if (s.ready) action = { label: 'Use ' + name, hint: 'Explanations use your ' + name + ' plan. Yamori never asks for an API key.' };
      else if (s.installed) action = { label: owner === 'codex' ? 'Sign in with ChatGPT' : 'Sign in to ' + name, hint: 'Opens a terminal and your browser. Sign in there; this page updates when you come back.' };
      else action = { label: 'Install ' + cli, hint: owner === 'claude' ? 'Runs Anthropic’s official installer in a terminal, then opens sign-in. About a minute.' : owner === 'cursor' ? 'Runs Cursor’s official CLI installer in a terminal, then opens sign-in. About a minute.' : 'Installs OpenAI’s Codex CLI in a terminal (with npm or Homebrew), then opens sign-in.' };
      const alt = s.installed && s.signedIn !== false && !working[owner] ? { label: s.signedIn === true ? 'Use a different account' : 'Sign in' } : undefined;
      return { id: owner, name, product: cli + ' · uses your ' + name + ' plan', lines, action, alt, ready: !!s.ready, badge: s.ready ? (chosen === owner ? 'In use' : 'Ready') : '' };
    };
    const rank = owner => (statuses[owner]?.ready ? 0 : statuses[owner]?.installed ? 2 : 4) + (owner === chosen ? 0 : 1);
    const cards = [...OWNERS].sort((a, b) => rank(a) - rank(b)).map(card);
    const other = OWNERS.find(owner => owner !== chosen && statuses[owner]?.ready) || OWNERS.find(owner => owner !== chosen);
    const notice = PROVIDERS[chosen] && statuses[chosen] && !statuses[chosen].ready && statuses[other]?.ready ? `${AI_NAMES[chosen]} isn’t ready (${statuses[chosen].problem || 'not set up'}). ${AI_NAMES[other]} is ready to use instead.`
      : OWNERS.every(owner => statuses[owner] && !statuses[owner].installed) ? 'None of them is on this computer yet. Pick the one whose plan you have; the install runs in a terminal you can watch.' : '';
    const view = { title: 'Set up Yamori', lead: 'Yamori explains code with an AI you already use: Claude, ChatGPT or Cursor. Choose one; setup takes about a minute and uses your own sign-in.',
      next: pending?.label || '', notice, cards, foot: 'Yamori runs Claude Code, Codex or the Cursor CLI on this computer with your sign-in and plan limits.' };
    if (done) {
      const s = statuses[done] || {};
      view.done = { title: '✓ Yamori will use ' + AI_NAMES[done], text: (s.account ? 'Signed in · ' + s.account + '. ' : '') + 'Change it any time from AI ▾ in a Yamori tab, or with Yamori: Set Up AI.',
        actions: [{ id: 'read', label: 'Explain current file' }, { id: 'map', label: 'Open project guide' }, { id: 'close', label: 'Close' }] };
      view.lead = 'You’re ready. Click the gecko beside any script, or Yamori in the status bar.'; view.notice = '';
    }
    return view;
  }
  // The setup screen and the check behind every "can Yamori explain now?".
  function createSetup(context, { api = vscode, system = {}, status = providerStatus, onReady = () => {}, onNext = () => {} } = {}) {
    let panel, pending, done, intent, checking = false, serial = 0, statuses = {};
    const working = {}, terminals = new Map(), subscriptions = [];
    if (api.window.onDidCloseTerminal) subscriptions.push(api.window.onDidCloseTerminal(terminal => {
      const job = terminals.get(terminal); if (!job) return;
      terminals.delete(terminal); delete working[job.owner]; clearProviderStatus(); void check().catch(() => {});
    }));
    // Coming back from the browser sign-in re-checks without a click.
    if (api.window.onDidChangeWindowState) subscriptions.push(api.window.onDidChangeWindowState(state => { if (state.focused && panel && !done) void check().catch(() => {}); }));
    const view = () => ({ readingPalette: context.globalState.get('readingPalette', 'auto'), checking, ...setupView(statuses, { chosen: context.globalState.get('provider'), working, pending, done }) });
    const post = () => panel?.webview.postMessage({ type: 'setup', state: view() });
    const statusOf = (owner, fresh) => status(owner, cliPathFor(api, owner), { fresh, system }).catch(error => ({ provider: owner, installed: false, signedIn: false, ready: false, problem: error.message }));
    async function check() {
      const id = ++serial; checking = true; post();
      const results = await Promise.all(OWNERS.map(owner => statusOf(owner, true)));
      if (id !== serial) return statuses;
      statuses = Object.fromEntries(OWNERS.map((owner, index) => [owner, { ...results[index], provider: owner }])); checking = false;
      // A sign-in or install started here continues by itself once it works.
      if (intent && statuses[intent]?.ready) { const owner = intent; intent = undefined; await use(owner); return statuses; }
      post(); return statuses;
    }
    async function use(owner) {
      await context.globalState.update('provider', owner);
      await context.globalState.update('setupDone', true);
      try { onReady(owner); } catch { /* A listener cannot block setup. */ }
      const next = pending; pending = undefined;
      if (next) { done = undefined; panel?.dispose?.(); await next.run(); return; }
      done = owner; post();
    }
    async function act(owner, which) {
      if (!PROVIDERS[owner]) return;
      const open = [...terminals].find(([, job]) => job.owner === owner);
      if (which === 'primary' && open) { open[0].show(); return; }
      const s = statuses[owner] || await statusOf(owner, true);
      if (which === 'primary' && s.ready) return use(owner);
      const kind = s.installed ? 'signIn' : 'install';
      const terminal = setupTerminal(context, api, owner, kind, s.path, system);
      terminals.set(terminal, { owner, kind }); working[owner] = kind; intent = owner; post();
    }
    async function receive(message) {
      if (!message || typeof message.type !== 'string') return;
      switch (message.type) {
        case 'ready': post(); break;
        case 'check': clearProviderStatus(); await check(); break;
        case 'primary': case 'alt': await act(message.provider, message.type); break;
        case 'next': if (['read', 'map', 'close'].includes(message.id)) { panel?.dispose?.(); if (message.id !== 'close') await onNext(message.id); } break;
      }
    }
    return {
      // Shows the screen; `pending` runs once an AI is chosen and ready.
      async show({ pending: next } = {}) {
        done = undefined;
        if (next) pending = next;
        if (panel) panel.reveal?.(panel.viewColumn);
        else {
          panel = api.window.createWebviewPanel('yamoriSetup', 'Set up Yamori', { viewColumn: api.ViewColumn.Active ?? api.ViewColumn.One, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
          if (context.extensionUri && api.Uri.joinPath) panel.iconPath = api.Uri.joinPath(context.extensionUri, 'media', 'yamori.png');
          panel.webview.html = setupHTML(context.globalState.get('readingPalette', 'auto'));
          panel.onDidDispose(() => { panel = undefined; pending = undefined; intent = undefined; });
          panel.onDidChangeViewState?.(event => { if (event?.webviewPanel?.visible !== false && !done) void check().catch(() => {}); });
          panel.webview.onDidReceiveMessage(message => receive(message).catch(error => api.window.showErrorMessage?.(error.message)));
        }
        post();
        await check();
      },
      // Is the chosen AI usable now? Installed and not known to be signed out.
      async ready() {
        const chosen = context.globalState.get('provider');
        if (!PROVIDERS[chosen]) return false;
        const s = await statusOf(chosen, false);
        statuses = { ...statuses, [chosen]: { ...s, provider: chosen } };
        return !!s.ready;
      },
      receive,
      dispose() { subscriptions.forEach(item => item.dispose?.()); panel?.dispose?.(); }
    };
  }

  async function chooseInstalledProvider(context, api = vscode, discover = findCLI) {
    if (context.globalState.get('provider') !== undefined) return;
    const owners = ['codex', 'claude', 'cursor'];
    const installed = await Promise.allSettled(owners.map(owner => discover(owner, cliPathFor(api, owner))));
    const index = installed.findIndex(result => result.status === 'fulfilled');
    if (index >= 0 && context.globalState.get('provider') === undefined) await context.globalState.update('provider', owners[index]);
  }

  return { OWNERS, AI_NAMES, setupTerminal, setupView, createSetup, chooseInstalledProvider };
};
