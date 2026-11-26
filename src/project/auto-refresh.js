'use strict';

// Auto-refresh after save. Saves are coalesced: each save restarts one timer,
// so a burst of saves runs at most one refresh. A newer save also makes any
// running refresh stale (the reader cancels it when the source hash changes).
const fs = require('node:fs/promises');
const path = require('node:path');

const MODES = ['changedBlocks', 'off', 'wholeFile'];
// Tests shorten the delay; the extension reads these values at call time.
const timing = { delay: 2000, maxBytes: 200000 };

function autoRefreshMode(value) {
  return MODES.includes(value) ? value : 'changedBlocks';
}

function createAutoRefresh(run) {
  let timer, generation = 0, disposed = false;
  return {
    get queued() { return timer !== undefined; },
    schedule() {
      if (disposed) return;
      clearTimeout(timer);
      const current = ++generation;
      timer = setTimeout(() => {
        timer = undefined;
        if (!disposed && current === generation) void Promise.resolve().then(() => run(() => !disposed && current === generation)).catch(() => {});
      }, timing.delay);
    },
    cancel() { clearTimeout(timer); timer = undefined; generation++; },
    dispose() { disposed = true; clearTimeout(timer); timer = undefined; generation++; }
  };
}

// A rebase, merge, cherry-pick or revert rewrites many files at once and
// leaves intermediate content. Never spend model calls on those snapshots.
const MARKERS = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];
async function gitDirFor(file) {
  let dir = path.dirname(file);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
      const pointer = /^gitdir:\s*(.+)\s*$/m.exec(await fs.readFile(candidate, 'utf8'))?.[1];
      return pointer ? path.resolve(dir, pointer) : undefined;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return undefined; }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
async function gitOperationInProgress(file) {
  const gitDir = await gitDirFor(file);
  if (!gitDir) return false;
  for (const marker of MARKERS) {
    try { await fs.access(path.join(gitDir, marker)); return true; } catch {}
  }
  return false;
}

module.exports = { MODES, timing, autoRefreshMode, createAutoRefresh, gitOperationInProgress };
