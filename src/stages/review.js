'use strict';
// Stage-level review: the founder's queue of behavior changes. Reading the
// queue is pure SQLite; deciding moves the review baseline forward so the next
// change of the same step is shown against what the founder last accepted.

const MAX_WHY = 2000;

function reviewQueue(db, workflowId) {
  const names = new Map(db.stages(workflowId).map(stage => [stage.id, stage.name]));
  return db.changes(workflowId, { status: 'pending' }).map(change => ({ ...change, stage_name: names.get(change.stage_id) || change.stage_id }));
}

// What changed since the founder last looked: every change detected after
// reviewed_at (or everything, if never reviewed), newest last.
function whatChanged(db, workflowId, { sinceReview = true } = {}) {
  const workflow = db.workflow(workflowId);
  if (!workflow) throw new Error(`No workflow "${workflowId}".`);
  const since = sinceReview ? workflow.reviewed_at || undefined : undefined;
  const names = new Map(db.stages(workflowId).map(stage => [stage.id, stage.name]));
  const changes = db.changes(workflowId, since ? { since } : {});
  return {
    workflow: workflowId, reviewedAt: workflow.reviewed_at || null, baseSha: workflow.base_sha || null,
    pending: changes.filter(change => change.status === 'pending').length,
    staleStages: db.staleStages(workflowId).map(row => names.get(row.id) || row.id),
    changes: changes.map(change => ({ id: change.id, stage: change.stage_id, stageName: names.get(change.stage_id) || change.stage_id, at: change.at, summary: change.summary, status: change.status, ...(change.why ? { why: change.why } : {}), files: change.detail?.files || [], range: [change.base_sha, change.head_sha] }))
  };
}

function decide(db, changeId, status, why = '', { headSha } = {}) {
  return db.transaction(() => {
    const change = db.change(changeId);
    if (!change) throw new Error('That change is no longer in the review queue.');
    if (change.status !== 'pending') throw new Error('That change was already ' + change.status + '.');
    const decided = db.decideChange(changeId, status, String(why || '').trim().slice(0, MAX_WHY));
    // The code is what it is either way: the next comparison starts here.
    for (const step of change.detail?.steps || []) db.setSnapshot(change.workflow_id, step.file, step.symbol, step.after || null);
    let reviewed = false;
    if (!db.pendingCount(change.workflow_id)) { markReviewed(db, change.workflow_id, headSha); reviewed = true; }
    return { ...decided, reviewed };
  });
}

function markReviewed(db, workflowId, headSha) {
  db.markReviewed(workflowId);
  if (headSha) db.run('UPDATE workflows SET base_sha = ? WHERE id = ?', headSha, workflowId);
}

module.exports = { reviewQueue, whatChanged, decide, markReviewed, MAX_WHY };
