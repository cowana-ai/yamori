'use strict';
// Plans made in the agents' own plan mode (/plan in Claude Code, Plan mode in
// Codex) land on Yamori's Plan canvas too. Neither calls save_plan there:
// Claude Code finishes with an ExitPlanMode tool call that carries the plan,
// Codex with a <proposed_plan> block in its reply. Both are in the session
// transcripts the CLIs keep on disk, so Yamori reads new transcript lines for
// this project and turns the plan's Markdown into steps over mapped files.
// No model calls: files, symbols and lines come from the project map.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const TAIL = 4 * 1024 * 1024, RECENT = 10 * 60 * 1000, ACTIVE = 2 * 60 * 60 * 1000;
const hashOf = text => crypto.createHash('sha256').update(String(text).trim()).digest('hex').slice(0, 16);
const same = (a, b) => !!a && !!b && path.resolve(a) === path.resolve(b);

// ---- Transcripts ----
// Claude Code keeps one folder per working directory, named after its path.
const claudeFolder = (root, home = os.homedir()) => path.join(home, '.claude', 'projects', path.resolve(root).replace(/[^A-Za-z0-9]/g, '-'));
// Codex keeps sessions by day (sessions/YYYY/MM/DD); look at the days around now.
function codexFolders(home = os.homedir(), now = Date.now()) {
  const days = new Set();
  for (let hours = -36; hours <= 14; hours += 2) {
    const at = new Date(now + hours * 3600000), pad = n => String(n).padStart(2, '0');
    days.add([at.getFullYear(), pad(at.getMonth() + 1), pad(at.getDate())].join('/'));
    days.add([at.getUTCFullYear(), pad(at.getUTCMonth() + 1), pad(at.getUTCDate())].join('/'));
  }
  return [...days].map(day => path.join(home, '.codex', 'sessions', ...day.split('/')));
}
const listJsonl = folder => { try { return fs.readdirSync(folder).filter(name => name.endsWith('.jsonl')).map(name => path.join(folder, name)); } catch { return []; } };
function readRange(file, start, end) {
  const length = Math.max(0, end - start); if (!length) return '';
  const fd = fs.openSync(file, 'r');
  try { const buffer = Buffer.alloc(length); const read = fs.readSync(fd, buffer, 0, length, start); return buffer.subarray(0, read).toString('utf8'); } finally { fs.closeSync(fd); }
}
const codexBlock = text => { const all = [...String(text || '').matchAll(/<proposed_plan>\s*\n([\s\S]*?)\n\s*<\/proposed_plan>/g)]; return all.length ? all[all.length - 1][1].trim() : undefined; };

// The plans in some transcript lines. `cwd` is the session's folder when the
// lines themselves do not say (Codex says it once, in the first line).
function plansInLines(lines, { agent, roots, cwd }) {
  const found = [], ours = dir => roots.some(root => same(dir, root));
  for (const line of lines) {
    if (agent === 'claude' ? !line.includes('ExitPlanMode') : !line.includes('proposed_plan>')) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.timestamp) || Date.now();
    if (agent === 'claude') {
      if (row.type !== 'assistant' || !ours(row.cwd || cwd)) continue;
      for (const part of Array.isArray(row.message?.content) ? row.message.content : [])
        if (part?.type === 'tool_use' && part.name === 'ExitPlanMode' && typeof part.input?.plan === 'string' && part.input.plan.trim()) found.push({ agent, text: part.input.plan.trim(), at, session: row.sessionId });
    } else {
      if (!ours(cwd)) continue;
      const payload = row.payload || {};
      const text = payload.type === 'message' && payload.role === 'assistant' ? (payload.content || []).map(part => part?.text || '').join('\n')
        : payload.type === 'agent_message' ? payload.message : '';
      const plan = codexBlock(text);
      if (plan) found.push({ agent, text: plan, at });
    }
  }
  return found;
}

// Reads only what is new in each transcript since the last look. The first
// look at a file reads its tail, so a plan made just before Yamori opened
// still arrives; older files are only remembered.
function createNativePlanReader({ root, home = os.homedir(), since = Date.now() - RECENT } = {}) {
  const seen = new Map(), cwds = new Map();
  // The CLIs record the real path; the editor may hold a symlinked one.
  let real = root; try { real = fs.realpathSync(root); } catch {}
  const folders = [...new Set([claudeFolder(root, home), claudeFolder(real, home)])];
  const files = () => [...folders.flatMap(listJsonl).map(file => ({ file, agent: 'claude' })), ...codexFolders(home).flatMap(folder => listJsonl(folder).map(file => ({ file, agent: 'codex' })))];
  function codexCwd(file) {
    if (cwds.has(file)) return cwds.get(file);
    let cwd; try { const first = readRange(file, 0, Math.min(fs.statSync(file).size, 256 * 1024)).split('\n')[0]; const row = JSON.parse(first); cwd = row.type === 'session_meta' ? row.payload?.cwd : undefined; } catch {}
    if (cwd !== undefined && cwds.size < 5000) cwds.set(file, cwd);
    return cwd;
  }
  return {
    read(now = Date.now()) {
      const plans = [];
      for (const { file, agent } of files()) {
        let stat; try { stat = fs.statSync(file); } catch { continue; }
        const known = seen.get(file);
        if (known && known.size === stat.size && known.mtime === stat.mtimeMs) continue;
        if (!known && stat.mtimeMs < since) { seen.set(file, { size: stat.size, mtime: stat.mtimeMs, rest: '' }); continue; }
        if (now - stat.mtimeMs > ACTIVE && !known) { seen.set(file, { size: stat.size, mtime: stat.mtimeMs, rest: '' }); continue; }
        const cwd = agent === 'codex' ? codexCwd(file) : root;
        if (agent === 'codex' && !same(cwd, root) && !same(cwd, real)) { seen.set(file, { size: stat.size, mtime: stat.mtimeMs, rest: '' }); continue; }
        // A file that shrank was rewritten: read its tail again.
        const from = known && stat.size >= known.size ? known.size : Math.max(0, stat.size - TAIL);
        let chunk; try { chunk = (known && stat.size >= known.size ? known.rest : '') + readRange(file, from, stat.size); } catch { continue; }
        const lines = chunk.split('\n'), rest = lines.pop();
        if (!known && from > 0) lines.shift();
        seen.set(file, { size: stat.size, mtime: stat.mtimeMs, rest: rest.length > TAIL ? '' : rest });
        for (const plan of plansInLines(lines, { agent, roots: [root, real], cwd })) if (plan.at >= since) plans.push({ ...plan, hash: hashOf(plan.text), file });
      }
      return plans.sort((a, b) => a.at - b.at);
    }
  };
}

// ---- Markdown plan → canvas steps ----
const plain = text => String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
const clip = (text, max) => { const value = plain(text); return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value; };
// Sections that describe the plan rather than change the code.
const ABOUT = /^(?:context|summary|overview|background|goal|goals|why|motivation|assumptions?|defaults|risks?|notes?|open questions|questions|out of scope|non-goals|verification|how to verify|validation|rollout)\b/i;

// File references in a piece of text: `path/to/file.ext`, path:12 or path:12-30.
function fileMentions(text, graph) {
  const files = Object.keys(graph?.files || {}), found = [];
  const kinds = new Set(['py', 'js', 'ts', 'tsx', 'jsx', 'md', 'json', 'yaml', 'yml', 'toml', 'go', 'rs', 'java', 'rb', 'sh', 'css', 'html', ...files.map(rel => rel.split('.').pop())]);
  const bySuffix = name => { if (Object.hasOwn(graph.files, name)) return name; const ends = files.filter(rel => rel.endsWith('/' + name)); return ends.length === 1 ? ends[0] : undefined; };
  for (const match of String(text).matchAll(/(?:^|[\s`'"(\[])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][\w]{0,7})(?::(\d+)(?:\s*[-–]\s*(\d+))?)?/g)) {
    const raw = match[1].replace(/^\.\//, '').replace(/[.,;:]+$/, ''), rel = bySuffix(raw);
    const start = match[2] ? Number(match[2]) : undefined, end = match[3] ? Number(match[3]) : start;
    if (rel) found.push({ file: rel, start, end });
    else if (kinds.has(raw.split('.').pop()) && (/\//.test(raw) || /`/.test(match[0]))) found.push({ file: raw, unknown: true, start, end });
  }
  return found;
}
// Lines for a symbol the text names (`Class.method`, `name`, **name**).
function symbolLines(text, entry) {
  const defs = entry?.defs || []; if (!defs.length) return undefined;
  for (const match of String(text).matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(\))?`|\*\*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:\(\))?\*\*/g)) {
    const parts = (match[1] || match[2]).split('.'), name = parts.pop(), owner = parts.pop();
    const outer = owner && defs.find(def => def.name === owner);
    const def = defs.find(item => item.name === name && (!outer || (item.start >= outer.start && item.end <= outer.end)));
    if (def) return { start: def.start, end: def.end };
  }
  return undefined;
}
// Lines that run past the file's map become the whole file.
const fits = (lines, entry) => lines?.start && lines.start <= (entry?.lines || 0) ? { start: lines.start, end: Math.min(entry.lines, Math.max(lines.start, lines.end || lines.start)) } : undefined;

function planFromMarkdown(markdown, graph, { agent } = {}) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n'), units = [], headings = [];
  let goal = '', summary = '', current, fence = false;
  const flush = () => { if (current && current.text.trim()) units.push(current); current = undefined; };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; if (current) current.text += '\n' + line; continue; }
    if (fence) { if (current) current.text += '\n' + line; continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length, title = heading[2].replace(/^\s*(?:step\s*)?\d+[.)]\s*/i, '').trim();
      if (level === 1 && !goal) { goal = plain(title).replace(/^plan\s*[:—-]\s*/i, ''); continue; }
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, title });
      continue;
    }
    const item = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item && item[1].length < 2) { flush(); current = { text: item[2], headings: [...headings] }; continue; }
    if (!line.trim()) { if (current?.paragraph) flush(); else if (current) current.blank = true; continue; }
    // Indented lines and sub-items belong to the item above; a new paragraph after a gap does not.
    if (current && !(current.blank && !/^\s/.test(line))) { current.text += '\n' + line; continue; }
    flush(); current = { text: line, headings: [...headings], paragraph: true };
  }
  flush();
  // The summary: the first paragraph, preferring one under a summary-like heading.
  const about = units.filter(unit => unit.paragraph && (!unit.headings.length || ABOUT.test(plain(unit.headings[unit.headings.length - 1].title))));
  summary = clip((about.find(unit => unit.headings.length && /^(summary|overview|goal)/i.test(plain(unit.headings[unit.headings.length - 1].title))) || about[0])?.text || '', 600);
  if (!goal) goal = clip(units[0]?.text || 'Plan from ' + (agent === 'codex' ? 'Codex' : 'Claude Code'), 200);

  const steps = [], unplaced = [];
  for (const unit of units) {
    const section = unit.headings.map(item => item.title);
    if (unit.headings.some(item => ABOUT.test(plain(item.title)))) continue;
    // A file named in the item wins; otherwise the nearest heading that names one.
    let mentions = fileMentions(unit.text, graph);
    for (let index = unit.headings.length - 1; !mentions.length && index >= 0; index--) mentions = fileMentions(unit.headings[index].title, graph);
    // The first file the item names, unless it is one the plan creates.
    const creating = /\b(new|create|creates|add|adds)\b/i.test(unit.text + ' ' + section.join(' '));
    const target = mentions.find(item => !item.unknown || creating);
    // The item's first sentence names the change; a bare paragraph takes its heading.
    const first = plain(unit.text.split('\n')[0]).split(/(?<=[.;])\s/)[0].replace(/:$/, '');
    const title = clip(unit.paragraph && section.length ? section[section.length - 1] : first, 90);
    const change = clip(unit.text, 500);
    if (!target) { if (!unit.paragraph) unplaced.push(change); continue; }
    const file = target.file, step = { file, title: title || 'Change ' + file.split('/').pop(), change, why: '' };
    // Items that say to leave something alone stay visible, marked skipped.
    if (/^[^.]{0,80}\b(no change(s)? (needed|required)|leave (it |this |them )?as is|stays? unchanged|unchanged)\b/i.test(plain(unit.text))) step.status = 'skipped';
    if (target.unknown) Object.assign(step, { newFile: true, startLine: 0, endLine: 0 });
    else { const entry = graph.files[file], range = fits(target, entry) || fits(symbolLines(unit.text, entry), entry); if (range) Object.assign(step, { startLine: range.start, endLine: range.end }); }
    steps.push(step);
  }
  // Too many small items: one step per file and section.
  let merged = steps;
  if (steps.length > 30) {
    const groups = new Map();
    for (const step of steps) { const key = step.file; const group = groups.get(key); if (group) { group.change = clip(group.change + ' ' + step.change, 500); group.startLine = Math.min(group.startLine ?? Infinity, step.startLine ?? Infinity); group.endLine = Math.max(group.endLine ?? 0, step.endLine ?? 0); } else groups.set(key, { ...step, title: 'Change ' + step.file.split('/').pop() }); }
    merged = [...groups.values()].map(step => Number.isFinite(step.startLine) ? step : (({ startLine, endLine, ...rest }) => rest)(step)).slice(0, 30);
  }
  return { goal: clip(goal, 600), summary, steps: merged, unplaced };
}

module.exports = { createNativePlanReader, planFromMarkdown, plansInLines, claudeFolder, codexFolders, hashOf, fileMentions };
