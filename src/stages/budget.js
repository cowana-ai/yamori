'use strict';
// Every stage model call is a budgeted, logged event. Callers estimate first;
// a call that would exceed the per-run or per-day budget is not made, and the
// stage stays "Needs update" instead.
const { estimateTokens } = require('../project/token-estimates');
const { dayOf } = require('./db');

const DEFAULT_BUDGET = { perRun: 60000, perDay: 1500000 };
// Cache reads cost about a tenth of fresh input, so they count a tenth here.
const CACHE_WEIGHT = 0.1;
const spentOf = used => used.input + used.output + used.cached * CACHE_WEIGHT;

function normalizeBudget(value) {
  const read = (key, fallback) => {
    const number = Number(value?.[key]);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
  };
  if (typeof value === 'number') return { perRun: DEFAULT_BUDGET.perRun, perDay: Math.max(0, Math.floor(value)) };
  return { perRun: read('perRun', DEFAULT_BUDGET.perRun), perDay: read('perDay', DEFAULT_BUDGET.perDay) };
}

class BudgetExceeded extends Error {
  constructor(scope, used, limit, estimate) {
    super(`Needs update: this would use about ${estimate.toLocaleString()} tokens, over the ${scope} budget (${used.toLocaleString()} of ${limit.toLocaleString()} used). Raise yamori.tokenBudget or update later.`);
    this.code = 'YAMORI_BUDGET'; this.scope = scope;
  }
}

// A run groups the calls one user action or one settled batch makes.
function createRun(db, { budget, trigger, runId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), clock = () => new Date() } = {}) {
  const limits = normalizeBudget(budget);
  return {
    id: runId, trigger, limits,
    used() { return db.usage({ runId }); },
    // Estimated input + a fixed output allowance; zero limits mean "no limit".
    check(estimate) {
      const tokens = Math.ceil(estimate);
      if (limits.perRun) {
        const used = this.used(), spent = Math.round(spentOf(used));
        if (spent + tokens > limits.perRun) throw new BudgetExceeded('per-run', spent, limits.perRun, tokens);
      }
      if (limits.perDay) {
        const used = db.usage({ day: dayOf(clock()) }), spent = Math.round(spentOf(used));
        if (spent + tokens > limits.perDay) throw new BudgetExceeded('daily', spent, limits.perDay, tokens);
      }
      return tokens;
    },
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

module.exports = { CACHE_WEIGHT, spentOf, DEFAULT_BUDGET, normalizeBudget, BudgetExceeded, createRun, estimatePrompt, activity, OUTPUT_ALLOWANCE };
