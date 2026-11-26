'use strict';
// Debounce and coalesce saves before any stage work runs.
// - One save: wait `delay` (~2 s) after the last save, then run once.
// - A burst (an agent editing many files): once `burstFiles` distinct files
//   are saved inside one window, wait until saves stop for `idle` ms, or until
//   an agent says it is done, then run once for everything.
// - A newer save cancels a run in progress (its signal aborts); the next run
//   picks up all files.
// - While `paused()` is true (rebase, merge, checkout), keep collecting and
//   retry later.
const timing = { delay: 2000, idle: 8000, burstFiles: 3, pauseRetry: 5000 };

function createStageScheduler(run, { paused = async () => false, now = () => Date.now() } = {}) {
  let timer, files = new Set(), firstAt = 0, controller, disposed = false, running;

  function arm(ms) {
    clearTimeout(timer);
    timer = setTimeout(fire, ms);
  }
  async function fire() {
    timer = undefined;
    if (disposed || !files.size) return;
    if (await paused().catch(() => false)) { arm(timing.pauseRetry); return; }
    const batch = [...files]; files = new Set(); firstAt = 0;
    controller?.abort();
    const current = controller = new AbortController();
    running = Promise.resolve().then(() => run(batch, current.signal)).catch(() => {}).finally(() => { if (controller === current) controller = undefined; });
    await running;
  }
  return {
    get pending() { return [...files]; },
    get busy() { return !!controller; },
    saved(file) {
      if (disposed) return;
      if (!files.size) firstAt = now();
      files.add(file);
      // Anything in flight is superseded by this newer content.
      controller?.abort();
      arm(files.size >= timing.burstFiles ? timing.idle : timing.delay);
    },
    // An agent finished its run (MCP `done`): summarize now, once.
    done() { if (files.size) arm(0); },
    flush() { return fire(); },
    cancel() { clearTimeout(timer); timer = undefined; files = new Set(); controller?.abort(); },
    dispose() { disposed = true; this.cancel(); },
    get firstAt() { return firstAt; },
    get running() { return running; }
  };
}

module.exports = { createStageScheduler, timing };
