'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { diffArrays } = require('../../vendor/diff.min');
const { hash, parseResult, PROMPT_FORMAT_VERSION, FLOW_FORMAT_VERSION } = require('../ai/engine');
// Schema of the on-disk explanation record. Newer builds reject records above
// this. Records from schema 1 stay readable: the explanation payload did not
// change, and a missing promptVersion means PROMPT_FORMAT_VERSION.
const CACHE_SCHEMA_VERSION = 2;
const CACHE_SCHEMA_MIN = 1;
// Explanation files plus saved name-flows. Drafts, revisions and project maps
// are not counted; they are removed by Yamori: Clear Cached Explanations.
const CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
const linesOf = text => text.replace(/\r\n/g, '\n').split('\n');

// Dates are the cheap signal; content determines whether an explanation is old.
// Myers alignment is bounded so a large rewrite cannot freeze the editor.
function linePlan(before, after) {
  const old = linesOf(before), next = linesOf(after);
  const parts = diffArrays(old, next, { timeout: 100, maxEditLength: 4000 });
  const mapped = new Map(), changed = [], removed = new Set();
  if (!parts) return { unknown: true, changed: [{ oldStart: 1, oldEnd: old.length, newStart: 1, newEnd: next.length, meaningful: true }], map: line => Math.max(1, Math.min(line, next.length)), removed };
  let a = 1, b = 1;
  for (let i = 0; i < parts.length;) {
    const part = parts[i];
    if (!part.added && !part.removed) { for (let n = 0; n < part.count; n++) mapped.set(a++, b++); i++; continue; }
    const oldStart = a, newStart = b, oldValues = [], newValues = [];
    while (i < parts.length && (parts[i].added || parts[i].removed)) {
      const chunk = parts[i++];
      if (chunk.removed) { oldValues.push(...chunk.value); a += chunk.count; }
      else { newValues.push(...chunk.value); b += chunk.count; }
    }
    changed.push({ oldStart, oldEnd: a - 1, newStart, newEnd: b - 1, meaningful: [...oldValues, ...newValues].some(line => line.trim()) });
    for (let n = oldStart; n < a; n++) {
      mapped.set(n, Math.max(1, Math.min(next.length, newStart + Math.min(n - oldStart, Math.max(0, b - newStart - 1)))));
      if (!newValues.length) removed.add(n);
    }
  }
  return { unknown: false, changed, removed, map: line => Math.max(1, Math.min(next.length, mapped.get(line) ?? next.length)) };
}
function currentSnapshot(previous, fullText, stamp = {}) {
  const full = linesOf(fullText), plan = linePlan(previous.fullText ?? previous.text, fullText);
  const startLine = previous.selected ? previous.fullText ? plan.map(previous.startLine) : Math.min(previous.startLine, full.length) : 1;
  const endLine = previous.selected ? Math.max(startLine, previous.fullText ? plan.map(previous.endLine) : Math.min(previous.endLine, full.length)) : full.length;
  const selectionMappingUnknown = !!previous.selected && (plan.unknown || !!previous.fullText && Array.from({ length: previous.endLine - previous.startLine + 1 }, (_, index) => previous.startLine + index).every(line => plan.removed.has(line)));
  return { ...previous, selectionMappingUnknown, text: previous.selected ? full.slice(startLine - 1, endLine).join(fullText.includes('\r\n') ? '\r\n' : '\n') : fullText, startLine, endLine, fullText, fullHash: hash(fullText), stamp, observedAt: Date.now() };
}
function analyzeSource(before, after, value, previousStale = []) {
  const selectedWithoutBaseline = before.selected && (!before.fullText || !after.fullText);
  const plan = linePlan(before.fullText ?? before.text, after.fullText ?? after.text);
  const offset = before.fullText ? 0 : before.startLine - 1;
  const affected = new Set(previousStale), removed = [], meaningful = plan.changed.filter(change => change.meaningful);
  const afterLines = linesOf(after.fullText ?? after.text);
  const addsDefinition = change => change.oldEnd < change.oldStart && /^(?:async\s+)?(?:def|class|function|export\s+(?:default\s+)?function)\b/.test(afterLines.slice(change.newStart - 1, change.newEnd).find(line => line.trim() && !/^\s*(#|\/\/|@)/.test(line)) || '');
  let shared = plan.unknown || selectedWithoutBaseline;
  const sections = value.sections.map((section, index) => {
    const start = section.startLine - offset, end = section.endLine - offset;
    const touches = meaningful.some(change => change.oldEnd < change.oldStart ? change.oldStart >= start && (change.oldStart !== start || !addsDefinition(change)) && (change.oldStart <= end || change.oldStart === end + 1 && !addsDefinition(change)) : change.oldStart <= end && change.oldEnd >= start);
    if (touches || shared) affected.add(index);
    if (Array.from({ length: Math.max(0, end - start + 1) }, (_, n) => start + n).every(line => plan.removed.has(line))) removed.push(index);
    let startLine = Math.max(after.startLine, Math.min(after.endLine, plan.map(start) + (after.fullText ? 0 : after.startLine - 1)));
    let endLine = Math.max(startLine, Math.min(after.endLine, plan.map(end) + (after.fullText ? 0 : after.startLine - 1)));
    const full = linesOf(after.fullText ?? after.text), baseOffset = after.fullText ? 0 : after.startLine - 1;
    const first = full[startLine - baseOffset - 1] || '';
    if (/^\s*(?:async\s+)?(?:def|class)\b/.test(first)) {
      const indent = first.match(/^\s*/)[0].length;
      for (const change of meaningful) if (change.oldEnd < change.oldStart && change.oldStart === end + 1) {
        const inserted = full.slice(change.newStart - 1, change.newEnd).filter(line => line.trim());
        if (inserted.length && inserted.every(line => line.match(/^\s*/)[0].length > indent)) endLine = Math.min(after.endLine, Math.max(endLine, change.newEnd));
      }
      while (startLine > after.startLine && /^\s*@/.test(full[startLine - baseOffset - 2] || '')) startLine--;
    }
    const lineMap = (section.lineMap || []).flatMap(mapping => {
      const hit = meaningful.some(change => change.oldStart <= mapping.endLine - offset && change.oldEnd >= mapping.startLine - offset);
      if (hit || affected.has(index)) return [];
      const a = plan.map(mapping.startLine - offset) + (after.fullText ? 0 : after.startLine - 1), b = plan.map(mapping.endLine - offset) + (after.fullText ? 0 : after.startLine - 1);
      return a < after.startLine || b > after.endLine ? [] : [{ ...mapping, startLine: a, endLine: Math.max(a, b) }];
    });
    return { ...section, startLine, endLine, lineMap };
  });
  // Changes outside named blocks may alter globals, imports or introduce a new
  // idea. Be conservative instead of declaring unrelated-looking blocks fresh.
  for (const change of meaningful) {
    if (addsDefinition(change) && !sections.some(section => change.newStart <= section.endLine && change.newEnd >= section.startLine)) {
      const code = afterLines.slice(change.newStart - 1, change.newEnd).join('\n');
      const name = code.match(/\b(?:def|class|function)\s+([A-Za-z_]\w*)/)?.[1];
      affected.add(sections.length);
      sections.push({ title: 'New code' + (name ? ': ' + name : ''), startLine: change.newStart, endLine: change.newEnd, pseudocode: '# New source block. Update this block to explain its behavior.', lineMap: [] });
      continue;
    }
    if (!value.sections.some((section, index) => change.oldStart + offset >= section.startLine && Math.max(change.oldStart, change.oldEnd) + offset <= section.endLine + (change.oldEnd < change.oldStart && change.newStart >= sections[index].startLine && change.newEnd <= sections[index].endLine ? 1 : 0))) shared = true;
    if (change.newEnd >= change.newStart && !sections.some(section => change.newStart >= section.startLine && change.newEnd <= section.endLine)) shared = true;
  }
  if (removed.length) shared = true;
  if (shared) sections.forEach((_, index) => affected.add(index));
  // A changed helper can invalidate a caller even when that caller's own
  // lines did not move. Follow named definitions and simple aliases; when a
  // conceptual fragment has no identifiable boundary, prefer a full review.
  const sourceLines = linesOf(after.text), oldLines = linesOf(before.text);
  const namesIn = text => [...text.matchAll(/\b(?:def|function|class|fn|func)\s+([A-Za-z_]\w*)/g)].map(match => match[1]);
  const dependencies = new Set();
  for (const index of affected) {
    const section = sections[index]; if (!section) continue;
    const oldSection = value.sections[index];
    const text = sourceLines.slice(section.startLine - after.startLine, section.endLine - after.startLine + 1).join('\n');
    const previousText = oldSection ? oldLines.slice(oldSection.startLine - before.startLine, oldSection.endLine - before.startLine + 1).join('\n') : '';
    const names = [...namesIn(text), ...namesIn(previousText)];
    if (!names.length) {
      const assigned = [...(text + '\n' + previousText).matchAll(/^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?:\[[^\n]*?\])?\s*(?:=|\+=|-=)/gm)].map(match => match[1].split('.').at(-1));
      names.push(...assigned);
      if (!assigned.length) shared = true;
    }
    names.forEach(name => dependencies.add(name));
  }
  for (let pass = 0; pass < sections.length + 1; pass++) {
    let added = false;
    for (const match of after.text.matchAll(/^\s*(?:(?:const|let|var)\s+)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\b/gm)) if (dependencies.has(match[2]) && !dependencies.has(match[1])) { dependencies.add(match[1]); added = true; }
    sections.forEach((section, index) => {
      if (affected.has(index)) return;
      const text = sourceLines.slice(section.startLine - after.startLine, section.endLine - after.startLine + 1).join('\n');
      if ([...dependencies].some(name => new RegExp('\\b' + name + '\\b').test(text))) { affected.add(index); namesIn(text).forEach(name => dependencies.add(name)); added = true; }
    });
    if (!added) break;
  }
  if (shared) sections.forEach((_, index) => affected.add(index));
  for (const index of affected) if (sections[index]) sections[index].lineMap = [];
  return { value: { ...value, views: undefined, sections }, staleBlocks: [...affected].filter(index => index < sections.length), removedBlocks: removed, shared, changedRanges: plan.changed };
}
function dependencyBlocks(source, value, symbol) {
  const leaf = symbol.split('.').at(-1), escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), pattern = new RegExp('\\b' + escaped + '\\b');
  const lines = linesOf(source.text);
  const found = value.sections.flatMap((section, index) => lines.slice(Math.max(0, section.startLine - source.startLine), section.endLine - source.startLine + 1).some(line => pattern.test(line)) ? [index] : []);
  return found.length ? found : value.sections.map((_, index) => index);
}
function filePathOf(source) {
  if (!source || typeof source.uri !== 'string' || !source.uri.startsWith('file:')) return undefined;
  try { return require('node:url').fileURLToPath(source.uri); } catch { return undefined; }
}
// Optional provenance. A commit change does not invalidate an explanation; the
// content hash does. Reading .git avoids spawning git, including in Restricted Mode.
async function gitCommit(filePath) {
  if (!filePath) return undefined;
  let directory = path.dirname(path.resolve(filePath));
  for (;;) {
    const marker = path.join(directory, '.git');
    let gitDir;
    try {
      const stat = await fs.stat(marker);
      if (stat.isDirectory()) gitDir = marker;
      else {
        const text = await fs.readFile(marker, 'utf8');
        const match = text.match(/^gitdir:\s*(.+)\s*$/m);
        if (match) gitDir = path.resolve(directory, match[1].trim());
      }
    } catch { /* not this directory */ }
    if (gitDir) {
      try {
        const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
        const ref = head.match(/^ref:\s+(\S+)$/);
        if (!ref) return /^[0-9a-f]{7,64}$/i.test(head) ? { commit: head, root: directory } : { root: directory };
        let commit;
        try { commit = (await fs.readFile(path.join(gitDir, ref[1]), 'utf8')).trim(); } catch { commit = ''; }
        if (!/^[0-9a-f]{7,64}$/i.test(commit)) {
          const packed = await fs.readFile(path.join(gitDir, 'packed-refs'), 'utf8').catch(() => '');
          const line = packed.split('\n').find(row => row.endsWith(' ' + ref[1]) && /^[0-9a-f]{7,64}\s/i.test(row));
          commit = line ? line.split(/\s+/)[0] : '';
        }
        return /^[0-9a-f]{7,64}$/i.test(commit) ? { commit, root: directory } : { root: directory };
      } catch { return undefined; }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
function sectionHash(source, section) {
  const lines = linesOf(source?.fullText ?? source?.text ?? '');
  const base = source?.fullText ? 0 : (source?.startLine || 1) - 1;
  const start = section.startLine - base - 1, end = section.endLine - base;
  if (start < 0 || end > lines.length || end < start) return hash('\u0000missing');
  return hash(lines.slice(start, end).join('\n'));
}
function blockRecords(source, sections) {
  return (sections || []).map(section => ({ hash: sectionHash(source, section), startLine: section.startLine, endLine: section.endLine }));
}
// A remapped block whose source text no longer matches the stored hash is stale.
// Its line links are dropped so they cannot point at the wrong lines.
function verifyBlockHashes(analysis, blocks, nextSource) {
  if (!analysis || !Array.isArray(blocks) || !blocks.length) return analysis;
  const stale = new Set(analysis.staleBlocks);
  const sections = analysis.value.sections.map((section, index) => {
    const recorded = blocks[index];
    if (!recorded || stale.has(index)) return section;
    if (sectionHash(nextSource, section) === recorded.hash) return section;
    stale.add(index);
    return { ...section, lineMap: [] };
  });
  return { ...analysis, value: { ...analysis.value, sections }, staleBlocks: [...stale].filter(index => index < sections.length).sort((a, b) => a - b) };
}
function contentIdentity(source) {
  return [source.workspace || '', source.relPath || source.uri, hash(source.text || ''), source.fullHash || null, source.selected ? [source.startLine, source.endLine] : null];
}
// Workspace (or repo root) + path + content hash + the settings that change the
// explanation. The git commit is metadata on the record, not part of this key.
function explainAddress(source, opts) {
  return hash(JSON.stringify(['explanation', CACHE_SCHEMA_VERSION, PROMPT_FORMAT_VERSION, ...contentIdentity(source), opts.provider, opts.level, opts.model || '', opts.effort ?? null, opts.refinementSteps || 0]));
}
function acceptsCache(meta) {
  if (!meta || typeof meta.version !== 'number' || meta.version > CACHE_SCHEMA_VERSION || meta.version < CACHE_SCHEMA_MIN) return false;
  const prompt = Object.hasOwn(meta, 'promptVersion') ? meta.promptVersion : (meta.version === 1 ? PROMPT_FORMAT_VERSION : undefined);
  return prompt === PROMPT_FORMAT_VERSION;
}
function isCurrent(meta) {
  return acceptsCache(meta) && !(meta.staleBlocks || []).length && !meta.sharedChange && !meta.sourceMissing;
}
class LocalCache {
  constructor(root, options = {}) {
    this.root = root; this.writes = new Map(); this.versions = new Map();
    this.maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : CACHE_BYTE_LIMIT;
    this.accounted = 0; this.measured = false; this.evictChain = Promise.resolve(); this.useChain = Promise.resolve(); this.clock = 0;
  }
  async json(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return undefined; } }
  write(file, value) {
    const previous = this.writes.get(file) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = file + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(() => {}); }
    });
    this.writes.set(file, next);
    return next.finally(() => { if (this.writes.get(file) === next) this.writes.delete(file); });
  }
  variant(source, opts) { return hash(JSON.stringify([source.uri, source.selected ? [source.startLine, source.endLine] : null, opts.provider, opts.level, opts.model || '', opts.effort ?? null, ...(opts.refinementSteps ? ['refinement-v1', opts.refinementSteps] : [])])); }
  draftScope(source, opts) { return hash(JSON.stringify([source.uri, opts.provider, opts.level, opts.model || ''])); }
  sameRequest(meta, source, opts) {
    return acceptsCache(meta) && meta.source?.uri === source.uri && meta.opts?.provider === opts.provider && meta.opts?.level === opts.level && (meta.opts?.model || '') === (opts.model || '') && (meta.opts?.effort ?? null) === (opts.effort ?? null) && (meta.opts?.refinementSteps || 0) === (opts.refinementSteps || 0);
  }
  async entry(key, source) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) return undefined;
    const raw = await this.json(path.join(this.root, key + '.json'));
    if (!raw) return undefined;
    const snapshot = source || raw._yamori?.source;
    if (!snapshot || typeof snapshot.text !== 'string' || typeof snapshot.uri !== 'string') return undefined;
    try { return { value: parseResult(JSON.stringify(raw), snapshot), meta: raw._yamori }; } catch { return undefined; }
  }
  noteUse(token) {
    this.useChain = this.useChain.catch(() => {}).then(async () => {
      const file = path.join(this.root, 'lru.json');
      const current = await this.json(file) || {};
      if (!this.clock) for (const value of Object.values(current)) if (typeof value === 'number' && value > this.clock) this.clock = value;
      this.clock = Math.max(Date.now(), this.clock + 1);
      current[token] = this.clock;
      await this.write(file, current);
    });
    return this.useChain;
  }
  async forget(tokens) {
    this.useChain = this.useChain.catch(() => {}).then(async () => {
      const file = path.join(this.root, 'lru.json');
      const current = await this.json(file);
      if (!current) return;
      for (const token of tokens) delete current[token];
      await this.write(file, current);
    });
    return this.useChain;
  }
  async latest(source, opts, legacy = false) {
    const pointer = await this.json(path.join(this.root, 'latest', this.variant(source, opts) + '.json'));
    const entry = pointer && await this.entry(pointer.key);
    if (!entry && legacy && opts.refinementSteps) return this.latest(source, { ...opts, refinementSteps: 0 }, legacy);
    if (!entry || !this.sameRequest(entry.meta, source, opts)) return undefined;
    await this.noteUse(pointer.key + '.json');
    return entry;
  }
  // Exact hit: this workspace, path and content were explained with these settings.
  async exact(source, opts) {
    if (!source || typeof source.text !== 'string' || typeof source.uri !== 'string') return undefined;
    const address = explainAddress(source, opts);
    const pointer = await this.json(path.join(this.root, 'by-content', address + '.json'));
    const entry = pointer && await this.entry(pointer.key);
    if (!entry || !this.sameRequest(entry.meta, source, opts)) return undefined;
    const saved = entry.meta.source || {};
    if (hash(saved.text || '') !== hash(source.text || '') || (saved.fullHash || null) !== (source.fullHash || null)) return undefined;
    if (!!saved.selected !== !!source.selected) return undefined;
    if (source.selected && (saved.startLine !== source.startLine || saved.endLine !== source.endLine)) return undefined;
    await this.noteUse(pointer.key + '.json');
    return entry;
  }
  async save(source, opts, value, key, status = {}) {
    const variant = this.variant(source, opts), version = (this.versions.get(variant) || 0) + 1;
    this.versions.set(variant, version);
    const git = await gitCommit(filePathOf(source)).catch(() => undefined);
    const contentHash = hash(source.text || '');
    const meta = {
      staleBlocks: [], removedBlocks: [], ...status,
      version: CACHE_SCHEMA_VERSION, promptVersion: PROMPT_FORMAT_VERSION,
      source, opts: { provider: opts.provider, level: opts.level, model: opts.model || '', effort: opts.effort ?? null, refinementSteps: opts.refinementSteps || 0 },
      savedAt: Date.now(), contentHash, workspace: source.workspace || '', relPath: source.relPath || '',
      git: git || null, blocks: blockRecords(source, value.sections)
    };
    const file = path.join(this.root, key + '.json');
    await this.write(file, { ...value, _yamori: meta });
    await this.write(path.join(this.root, 'by-content', explainAddress(source, opts) + '.json'), { key });
    if (this.versions.get(variant) === version) await this.write(path.join(this.root, 'latest', variant + '.json'), { key });
    await this.noteUse(key + '.json');
    await this.track(file, key + '.json');
    return meta;
  }
  async readFlow(key) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) return undefined;
    const file = path.join(this.root, 'flows', key + '.json');
    const record = await this.json(file);
    if (!record || record.version !== CACHE_SCHEMA_VERSION || record.promptVersion !== PROMPT_FORMAT_VERSION || record.flowVersion !== FLOW_FORMAT_VERSION) return undefined;
    if (!record.value || typeof record.value.summary !== 'string' || !Array.isArray(record.value.sections)) return undefined;
    await this.noteUse('flows/' + key + '.json');
    return record;
  }
  async saveFlow(key, value, meta = {}) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) return undefined;
    const record = { version: CACHE_SCHEMA_VERSION, promptVersion: PROMPT_FORMAT_VERSION, flowVersion: FLOW_FORMAT_VERSION, savedAt: Date.now(), ...meta, value };
    const file = path.join(this.root, 'flows', key + '.json');
    await this.write(file, record);
    await this.noteUse('flows/' + key + '.json');
    await this.track(file, 'flows/' + key + '.json');
    return record;
  }
  async track(file, protect) {
    const stat = await fs.stat(file).catch(() => undefined);
    if (!this.measured) { this.measured = true; await this.enqueueEvict(protect); }
    this.accounted += stat?.size || 0;
    if (this.maxBytes > 0 && this.accounted > this.maxBytes) {
      await this.enqueueEvict(protect);
      this.accounted = Math.min(this.accounted, this.maxBytes);
    }
  }
  enqueueEvict(protect) {
    const run = this.evictChain.catch(() => {}).then(() => this.evict(protect));
    this.evictChain = run;
    return run;
  }
  async evict(protect) {
    if (!(this.maxBytes > 0)) return;
    const files = [];
    const consider = async (dir, prefix) => {
      let names = [];
      try { names = await fs.readdir(dir); } catch { return; }
      for (const name of names) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const file = path.join(dir, name);
        try {
          const stat = await fs.stat(file);
          if (stat.isFile()) files.push({ file, token: prefix + name, key: name.slice(0, -5), mtime: stat.mtimeMs, size: stat.size });
        } catch { /* removed while measuring */ }
      }
    };
    await consider(this.root, '');
    await consider(path.join(this.root, 'flows'), 'flows/');
    let total = files.reduce((sum, item) => sum + item.size, 0);
    if (total <= this.maxBytes) return;
    const order = await this.json(path.join(this.root, 'lru.json')) || {};
    const removed = new Set(), removedTokens = [];
    for (const item of files.sort((a, b) => (order[a.token] || a.mtime) - (order[b.token] || b.mtime) || (a.token < b.token ? -1 : 1))) {
      if (total <= this.maxBytes) break;
      if (item.token === protect) continue;
      await fs.unlink(item.file).catch(() => {});
      total -= item.size; removed.add(item.key); removedTokens.push(item.token);
    }
    if (removedTokens.length) await this.forget(removedTokens);
    if (!removed.size) return;
    const dir = path.join(this.root, 'by-content');
    let pointers = [];
    try { pointers = await fs.readdir(dir); } catch { return; }
    for (const name of pointers) {
      const pointer = await this.json(path.join(dir, name));
      if (pointer && removed.has(pointer.key)) await fs.unlink(path.join(dir, name)).catch(() => {});
    }
  }
  async drafts(scope) { return await this.json(path.join(this.root, 'drafts', scope + '.json')) || []; }
  saveDrafts(scope, rows) { return this.write(path.join(this.root, 'drafts', scope + '.json'), rows); }
  async flush() {
    await this.useChain.catch(() => {});
    while (this.writes.size) await Promise.all([...this.writes.values()].map(promise => promise.catch(() => {})));
    await this.evictChain.catch(() => {});
    while (this.writes.size) await Promise.all([...this.writes.values()].map(promise => promise.catch(() => {})));
  }
}
module.exports = { LocalCache, linePlan, currentSnapshot, analyzeSource, dependencyBlocks, verifyBlockHashes, sectionHash, explainAddress, gitCommit, acceptsCache, isCurrent, CACHE_SCHEMA_VERSION, CACHE_SCHEMA_MIN, CACHE_BYTE_LIMIT, PROMPT_FORMAT_VERSION };
