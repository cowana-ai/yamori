'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { diffArrays } = require('./diff.min');
const { hash, parseResult } = require('./engine');
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
  let shared = plan.unknown || selectedWithoutBaseline;
  const sections = value.sections.map((section, index) => {
    const start = section.startLine - offset, end = section.endLine - offset;
    const touches = meaningful.some(change => change.oldEnd < change.oldStart ? change.oldStart >= start && change.oldStart <= end + 1 : change.oldStart <= end && change.oldEnd >= start);
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
    const previousText = oldLines.slice(oldSection.startLine - before.startLine, oldSection.endLine - before.startLine + 1).join('\n');
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
class LocalCache {
  constructor(root) { this.root = root; this.writes = new Map(); this.versions = new Map(); }
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
  variant(source, opts) { return hash(JSON.stringify([source.uri, source.selected ? [source.startLine, source.endLine] : null, opts.provider, opts.level, opts.model || '', opts.effort ?? null])); }
  draftScope(source, opts) { return hash(JSON.stringify([source.uri, opts.provider, opts.level, opts.model || ''])); }
  async entry(key, source) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) return undefined;
    const raw = await this.json(path.join(this.root, key + '.json'));
    if (!raw) return undefined;
    const snapshot = source || raw._yamori?.source;
    if (!snapshot || typeof snapshot.text !== 'string' || typeof snapshot.uri !== 'string') return undefined;
    try { return { value: parseResult(JSON.stringify(raw), snapshot), meta: raw._yamori }; } catch { return undefined; }
  }
  async latest(source, opts) {
    const pointer = await this.json(path.join(this.root, 'latest', this.variant(source, opts) + '.json'));
    const entry = pointer && await this.entry(pointer.key);
    if (entry?.meta?.source.uri !== source.uri || entry.meta.opts?.provider !== opts.provider || entry.meta.opts?.level !== opts.level || (entry.meta.opts?.model || '') !== (opts.model || '') || (entry.meta.opts?.effort ?? null) !== (opts.effort ?? null)) return undefined;
    return entry;
  }
  async save(source, opts, value, key, status = {}) {
    const variant = this.variant(source, opts), version = (this.versions.get(variant) || 0) + 1;
    this.versions.set(variant, version);
    const meta = { version: 1, source, opts: { provider: opts.provider, level: opts.level, model: opts.model || '', effort: opts.effort ?? null }, savedAt: Date.now(), staleBlocks: [], removedBlocks: [], ...status };
    await this.write(path.join(this.root, key + '.json'), { ...value, _yamori: meta });
    if (this.versions.get(variant) === version) await this.write(path.join(this.root, 'latest', variant + '.json'), { key });
    return meta;
  }
  async drafts(scope) { return await this.json(path.join(this.root, 'drafts', scope + '.json')) || []; }
  saveDrafts(scope, rows) { return this.write(path.join(this.root, 'drafts', scope + '.json'), rows); }
  async flush() { while (this.writes.size) await Promise.all([...this.writes.values()].map(promise => promise.catch(() => {}))); }
}
module.exports = { LocalCache, linePlan, currentSnapshot, analyzeSource, dependencyBlocks };
