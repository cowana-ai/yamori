'use strict';
// Names and fixed values shared by Yamori's modules. Changing one changes
// where Yamori reads or writes, so keep them stable across versions.

// Files in a project's store (Yamori's global storage, one folder per project).
const STORE_FILES = {
  view: 'view.json', // what the founder has open, for the agent's get_view
  show: 'show.json', // what the agent asked Yamori to bring into view
  plan: 'plan.json',
  graph: 'graph.json',
  notes: 'notes.json',
  explanations: 'explanations.json'
};
// Store files the open project map reloads when another process writes them.
const RELOADED_STORE_FILES = [STORE_FILES.explanations, STORE_FILES.graph, STORE_FILES.notes, STORE_FILES.plan];

// The folder Yamori keeps inside a project, and what lives there.
const PROJECT_DIR = '.yamori';
const PROJECT_FILES = {
  db: 'yamori.db',
  agentDone: 'agent-done', // touched by the agent's done tool; the map refreshes once
  notes: 'notes'
};

// Yamori's MCP server, as registered with Claude Code and Codex.
const MCP_SERVER_NAME = 'yamori';
// Runs the editor's bundled runtime as plain Node.js.
const NODE_RUNTIME_ENV = { ELECTRON_RUN_AS_NODE: '1' };
// The stable launcher written into global storage (see writeLauncher).
const LAUNCHER = { dir: 'bin', script: 'yamori-mcp.js', current: 'current.json', cache: 'cache' };
// Preferences from versions that stored them in a file.
const MIGRATION_FILE = 'migration.json';

// The founder's agent session in the VS Code terminal.
const AGENT_SESSION = {
  terminalPrefix: 'Yamori chat · ',
  stateKey: 'agentSession:', // + project URI: the Claude Code session id to resume
  // A new terminal needs time before its prompt accepts text.
  firstPrefillDelayMs: 2500,
  // Enter goes separately so the prompt takes the text as typed, not as a paste.
  submitDelayMs: 150
};

// Files Yamori reads as source, folders it never scans, and the largest
// source it sends to a model in one request.
const SOURCE_GLOB = '**/*.{ipynb,py,js,jsx,ts,tsx,mjs,cjs,go,rs,java,kt,scala,cs,c,cpp,cc,h,hpp,rb,php,swift,dart,r,R,sh,bash,lua,pl,sql,vue,svelte,md,mdx,txt,rst,json,yaml,yml,toml,ini,cfg}';
const EXCLUDED_GLOB = '**/{node_modules,.git,.venv,venv,env,dist,build,out,vendor,.next,coverage,__pycache__}/**';
const MAX_SOURCE_BYTES = 120000;

module.exports = { SOURCE_GLOB, EXCLUDED_GLOB, MAX_SOURCE_BYTES, STORE_FILES, RELOADED_STORE_FILES, PROJECT_DIR, PROJECT_FILES, MCP_SERVER_NAME, NODE_RUNTIME_ENV, LAUNCHER, MIGRATION_FILE, AGENT_SESSION };
