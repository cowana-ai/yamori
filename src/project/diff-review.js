'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { diffArrays } = require('../../vendor/diff.min');
const { linePlan } = require('../storage/cache');
const { parseCard } = require('../ai/cards');

const MAX_SOURCE = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const validRef = ref => typeof ref === 'string' && /^[A-Za-z0-9_./@{}~^+-]{1,120}$/.test(ref) && !ref.startsWith('-');
const textError = () => new Error('Source review supports regular UTF-8 text files up to 1 MB.');

function git(root, args, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    execFile('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, encoding, timeout: 10000, maxBuffer: 4 * MAX_SOURCE, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

async function resolveRef(root, ref) {
  if (!validRef(ref)) throw new Error('Enter a local Git ref or commit, such as HEAD or origin/main.');
  try {
    return (await git(root, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}'])).trim();
  } catch {
    throw new Error('Git could not resolve ' + ref + ' to a local commit.');
  }
}

async function comparison(root, mode, baseRef, headRef) {
  if (mode === 'working') {
    const head = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).catch(error => {
      if (error.code === 128) return '';
      throw error;
    });
    return { mode, base: head.trim() || undefined, baseLabel: head ? 'HEAD' : 'Empty repository', headLabel: 'Working tree' };
  }
  const [base, head] = await Promise.all([resolveRef(root, baseRef), resolveRef(root, headRef)]);
  if (mode !== 'branch') return { mode, base, head, baseLabel: baseRef, headLabel: headRef };
  const shared = await git(root, ['merge-base', base, head]).catch(() => '');
  if (!shared) throw new Error('Git found no common ancestor for these refs.');
  return { mode, base: shared.trim(), head, baseLabel: 'Merge base with ' + baseRef, headLabel: headRef };
}

function relativePath(root, absolute) {
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return undefined;
  return relative.split(path.sep).join('/');
}

function parseChanges(output) {
  const fields = output.split('\0');
  const files = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++][0], file = fields[index++];
    if (status === 'R' || status === 'C') files.push({ status, before: file, after: fields[index++] });
    else files.push({ status, before: status === 'A' ? undefined : file, after: status === 'D' ? undefined : file });
  }
  return files;
}

async function changedFiles(root, pair, dirtyPaths = []) {
  const committed = !!pair.head;
  const diffArgs = ['diff', '--name-status', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '-M'];
  const diff = pair.base ? git(root, [...diffArgs, pair.base, ...(committed ? [pair.head] : []), '--']) : '';
  const localFiles = committed ? '' : git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...(!pair.base ? ['--cached'] : [])]);
  const [output, untracked] = await Promise.all([diff, localFiles]);
  const entries = parseChanges(output);
  const byPath = new Map(entries.map(entry => [entry.after || entry.before, entry]));
  for (const file of untracked.split('\0').filter(Boolean)) {
    const entry = byPath.get(file);
    if (entry?.status === 'D') Object.assign(entry, { status: 'M', after: file });
    else if (!entry) byPath.set(file, { status: 'A', after: file });
  }
  if (!committed && dirtyPaths.length) {
    const candidates = dirtyPaths.filter(file => !byPath.get(file)?.after);
    if (candidates.length) {
      const known = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...candidates]);
      for (const file of new Set(known.split('\0').filter(Boolean))) {
        const entry = byPath.get(file);
        if (entry) Object.assign(entry, { status: 'M', after: file });
        else byPath.set(file, pair.base ? { status: 'M', before: file, after: file } : { status: 'A', after: file });
      }
    }
  }
  return [...byPath.values()].sort((left, right) => (left.after || left.before).localeCompare(right.after || right.before));
}

function decode(buffer) {
  if (buffer.length > MAX_SOURCE || buffer.includes(0)) throw textError();
  try { return decoder.decode(buffer); } catch { throw textError(); }
}

async function readBlob(root, commit, file) {
  if (!file) return undefined;
  const row = await git(root, ['ls-tree', '-z', '--full-tree', commit, '--', file]);
  const object = /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(row);
  if (!row) return undefined;
  if (!object) throw textError();
  const size = Number(await git(root, ['cat-file', '-s', object[1]]));
  if (size > MAX_SOURCE) throw textError();
  return decode(await git(root, ['cat-file', 'blob', object[1]], 'buffer'));
}

async function readWorkingFile(root, file, openDocument) {
  if (!file) return undefined;
  const absolute = path.join(root, file);
  let info;
  try { info = await fs.lstat(absolute); } catch (error) {
    if (error.code === 'ENOENT' && typeof openDocument === 'string') return decode(Buffer.from(openDocument));
    throw error;
  }
  if (!info.isFile() || !relativePath(root, await fs.realpath(absolute))) throw textError();
  if (typeof openDocument === 'string') return decode(Buffer.from(openDocument));
  const handle = await fs.open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(MAX_SOURCE + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return decode(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}

async function sourcePair(root, pair, file, openDocument) {
  return Promise.all([
    readBlob(root, pair.base, file.before),
    pair.head ? readBlob(root, pair.head, file.after) : readWorkingFile(root, file.after, openDocument)
  ]);
}

async function workingSnapshot(root, file, text) {
  const pair = await comparison(root, 'working');
  let original = pair.base ? await readBlob(root, pair.base, file) : undefined;
  let change = { before: file, after: file };
  if (original === undefined) {
    change = (await changedFiles(root, pair, [file])).find(entry => entry.after === file);
    if (!change) return undefined;
    if (change.before) original = await readBlob(root, pair.base, change.before);
  }
  if ((original || '').replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n')) return undefined;
  return { pair, file: change, texts: [original, text] };
}

// A change with no lines on this side can still split the middle of a step.
function touches(range, from, to) {
  return from <= to
    ? range.startLine <= to && from <= range.endLine
    : range.startLine < from && from <= range.endLine;
}

function affectedSteps(view, hunks, matches) {
  if (!view) return [];
  return view.sections.flatMap((section, sectionIndex) => {
    const links = new Map((section.lineMap || []).map(link => [link.pseudocodeLine, link]));
    const blockHunk = hunks.find(hunk => matches(hunk, section));
    const card = parseCard(section.pseudocode);
    const rows = card?.rows || section.pseudocode.split('\n').map(text => ({ text }));
    return rows.flatMap(({ text, kind }, index) => {
      if (!text.trim() || /^\s*#/.test(text)) return [];
      if (card && !['card-step', 'card-handled', 'card-risk'].includes(kind)) return [];
      const link = links.get(index + 1);
      const hunk = link && hunks.find(hunk => matches(hunk, link));
      return [{ text, sectionIndex, pseudocodeLine: index + 1, title: section.title, startLine: link?.startLine || section.startLine, linked: !!link, hunk, blockHunk }];
    });
  });
}

const sameStep = (a, b) => a.text.trim().replace(/\*\*/g, '') === b.text.trim().replace(/\*\*/g, '');

function compareBlockSteps(before, after, base) {
  const old = before.map(step => typeof step === 'string' ? { text: step } : step);
  const diff = diffArrays(old, after, { comparator: sameStep, timeout: 100, maxEditLength: 2000 });
  if (!diff) return undefined;
  const steps = [];
  for (let i = 0; i < diff.length; i++) {
    const change = diff[i];
    if (change.removed) {
      const next = diff[i + 1];
      if (next?.added) {
        const common = Math.min(change.value.length, next.value.length);
        for (let k = 0; k < common; k++) steps.push({ kind: 'touched', before: change.value[k].text, after: next.value[k].text, pseudocodeLine: next.value[k].pseudocodeLine });
        for (const step of change.value.slice(common)) steps.push({ kind: 'removed', before: step.text, pseudocodeLine: diff[i + 2]?.value[0]?.pseudocodeLine || 'end' });
        for (const step of next.value.slice(common)) steps.push({ kind: 'added', after: step.text, pseudocodeLine: step.pseudocodeLine });
        i++;
      } else for (const step of change.value) steps.push({ kind: 'removed', before: step.text, pseudocodeLine: next?.value[0]?.pseudocodeLine || 'end' });
    } else if (change.added) for (const step of change.value) steps.push({ kind: 'added', after: step.text, pseudocodeLine: step.pseudocodeLine });
  }
  if (!steps.length) return undefined;
  const first = steps[0];
  const kind = steps.every(step => step.kind === first.kind) ? first.kind : 'touched';
  return { kind, base, was: first.before, now: first.after, steps };
}

function behaviorChanges(before, after, beforeViews = {}, afterViews = {}, detail) {
  const oldExists = !!before?.trim(), newExists = !!after?.trim();
  const levels = detail ? [detail] : ['logic', 'overview'];
  const common = levels.find(level => (!oldExists || beforeViews[level]) && (!newExists || afterViews[level]));
  const oldView = oldExists && beforeViews[common || levels.find(level => beforeViews[level])];
  const newView = newExists && afterViews[common || levels.find(level => afterViews[level])];
  const base = { level: common, missingBefore: oldExists && !oldView, missingAfter: newExists && !newView };
  const plan = linePlan(before ?? '', after ?? '');
  const hunks = plan.changed;
  const old = affectedSteps(oldView, hunks, (hunk, range) => touches(range, hunk.oldStart, hunk.oldEnd));
  const next = affectedSteps(newView, hunks, (hunk, range) => touches(range, hunk.newStart, hunk.newEnd));
  const row = (step, kind, side) => {
    const hunk = step.hunk || step.blockHunk;
    const sourceLine = Math.max(step.startLine, (side === 'before' ? hunk?.oldStart : hunk?.newStart) || 1);
    return { kind, side, text: step.text, title: step.title, sectionIndex: step.sectionIndex, pseudocodeLine: step.pseudocodeLine, sourceLine, targetLine: side === 'before' ? plan.map(sourceLine) : sourceLine };
  };
  const touched = (steps, side) => {
    const blocks = new Set();
    return steps.flatMap(step => {
      if (step.hunk) return [row(step, 'touched', side)];
      if (step.linked || !step.blockHunk || blocks.has(step.startLine)) return [];
      blocks.add(step.startLine);
      return [row({ ...step, text: step.title }, 'touched', side)];
    });
  };
  const fallback = () => [...touched(old, 'before'), ...touched(next, 'after')];
  if (!hunks.length) return { ...base, status: 'identical', rows: [] };
  if (!oldView && !newView) return { ...base, status: 'missing', rows: [] };
  if (!common) return { ...base, status: base.missingBefore || base.missingAfter ? 'partial' : 'differentLevels', rows: fallback() };
  if (!oldExists || !newExists) return {
    ...base, status: 'compared', rows: oldExists ? old.map(step => row(step, 'removed', 'before')) : next.map(step => row(step, 'added', 'after'))
  };
  const diff = !plan.unknown && diffArrays(old, next, {
    comparator: sameStep,
    timeout: 100, maxEditLength: 2000
  });
  if (!diff) return { ...base, status: 'tooLarge', rows: [] };
  const rows = [];
  for (const part of diff) {
    if (part.removed) rows.push(...part.value.filter(step => step.hunk).map(step => row(step, 'removed', 'before')));
    if (part.added) rows.push(...part.value.filter(step => step.hunk).map(step => row(step, 'added', 'after')));
  }
  return { ...base, status: rows.length ? 'compared' : 'unchangedSteps', rows: rows.length ? rows : fallback() };
}

// Preserve the original reader's section and line indices. Removed rows are
// display-only and sit at the next mapped step in the matching current block.
function inlineLayout(result, view, side) {
  const sections = result?.sections || [];
  const blocks = {};
  for (const [id, change] of view.rows.entries()) {
    if (!['added', 'removed'].includes(change.kind)) continue;
    if (change.side === side && sections[change.sectionIndex]) {
      const block = blocks[change.sectionIndex] ||= { marks: {}, removed: {} };
      block.marks[change.pseudocodeLine] = { ...change, id };
    } else if (change.kind === 'removed' && sections.length) {
      let index = sections.findIndex(section => section.title === change.title &&
        section.startLine <= change.targetLine && section.endLine >= change.targetLine);
      if (index < 0) index = sections.findIndex(section => section.endLine >= change.targetLine);
      if (index < 0) index = sections.length - 1;
      const links = sections[index].lineMap || [];
      const anchor = links.find(link => link.endLine >= change.targetLine)?.pseudocodeLine || 'end';
      const block = blocks[index] ||= { marks: {}, removed: {} };
      (block.removed[anchor] ||= []).push({ ...change, id });
    }
  }
  return blocks;
}

module.exports = { validRef, comparison, relativePath, changedFiles, sourcePair, workingSnapshot, behaviorChanges, inlineLayout, compareBlockSteps };
