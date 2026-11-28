'use strict';
// Every stage model call is a logged event: estimated before it is sent, then
// recorded with its real usage for the AI use view. Nothing is capped.
const { estimateTokens } = require('../project/token-estimates');
const { dayOf } = require('./db');

// Cache reads cost about a tenth of fresh input, so totals count them at a tenth.
const CACHE_WEIGHT = 0.1;
const spentOf = used => used.input + used.output + used.cached * CACHE_WEIGHT;

// A run groups the calls one user action or one settled batch makes.
function createRun(db, { trigger, runId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), clock = () => new Date() } = {}) {
  return {
    id: runId, trigger,
    used() { return db.usage({ runId }); },
    // The rounded estimate, logged when a call has no reported usage.
    estimate(tokens) { return Math.ceil(tokens); },
    log({ model, usage, workflowId, stageId, estimate, note, trigger: callTrigger }) {
      const actual = usage && (Number.isFinite(usage.input) || Number.isFinite(usage.output));
      db.logCall({
        trigger: callTrigger || trigger, model, workflow_id: workflowId, stage_id: stageId, run_id: runId,
        input: actual ? (usage.input || 0) + (usage.cacheWrite || 0) : estimate || 0,
        cached: actual ? usage.cacheRead || 0 : 0,
        output: actual ? usage.output || 0 : 0,
        cost: usage?.costUsd, estimated: !actual, note, at: clock()
      });
    }
  };
}

// Estimate what a prompt will cost before sending it.
const OUTPUT_ALLOWANCE = 1500;
function estimatePrompt(prompt, provider, model) { return estimateTokens(prompt, provider, model) + OUTPUT_ALLOWANCE; }

// The Activity view: today's calls and a running total.
function activity(db, { day = dayOf(new Date()), limit = 50 } = {}) {
  return { day, total: db.usage({ day }), calls: db.calls({ day, limit }) };
}

module.exports = { CACHE_WEIGHT, spentOf, createRun, estimatePrompt, activity, OUTPUT_ALLOWANCE };
