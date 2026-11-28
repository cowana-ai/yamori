'use strict';
// Planning mode, the part that needs no AI. A plan is a list of steps over the
// project's files. Everything here is deterministic and free: finding likely
// starting points for a goal, the impact of a step (who uses it, which tests
// cover it, what is risky), the token-budgeted slice of project knowledge an AI
// plan is drafted from, the gate that decides whether a cheap model's draft is
// good enough, and the plan as an agent prompt or Markdown.
const project = require('./graph');
const { text: promptText } = require('../prompts');

const safeNewFilePath = file => typeof file === 'string' && file.length > 0 && file.length <= 500 && !/[\\:\0]/.test(file) && !file.startsWith('/') && file.split('/').every(part => part && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part));
const newFileStep = step => step?.startLine === 0 && step?.endLine === 0 && safeNewFilePath(step.file);
const MAX_STEPS = 12, MAX_USER_STEPS = 30;
const STOP = new Set('the and for with from this that these those into than then also not should can could will would make add change update use using want need please new old more less all any each just only when what where which how why our their its are was were has have had get set let'.split(' '));
// The same light stemming for the goal and for the project's own words.
const stem = word => word.length > 5 ? word.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s)$/, '') : word.replace(/s$/, '');
function words(text) {
  return (String(text || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).map(stem).filter(word => word.length > 2 && !STOP.has(word));
}
const viewOf = (explanations, rel, hash) => ['logic', 'overview'].map(level => explanations?.[rel]?.[level]).find(view => view && view.hash === hash);

// ---- Starting points: which files a goal is probably about -------------------
function fileFields(graph, notes, explanations, rel) {
  const file = graph.files[rel], note = notes?.files?.[rel], view = viewOf(explanations, rel, file.hash);
  const fields = {
    name: new Set(words(rel)),
    defs: new Set(file.defs.flatMap(def => words(def.name))),
    purpose: new Set(words((note?.purpose || '') + ' ' + (note?.role || ''))),
    terms: new Set((note?.terms || []).flatMap(term => words(term.term + ' ' + (term.meaning || '')))),
    titles: new Set((view?.sections || []).flatMap(section => words(section.title))),
    text: new Map()
  };
  for (const section of view?.sections || []) for (const word of words(section.pseudocode)) fields.text.set(word, (fields.text.get(word) || 0) + 1);
  return fields;
}
// Files ranked by how well the goal's words match their names, definitions,
// AI-note purposes, glossary terms and pseudocode. No AI. `weak` says the
// match is poor, so the caller can offer a cheap AI ranking or ask the user.
function findStartingPoints(graph, notes, explanations, goal, { limit = 8 } = {}) {
  const terms = [...new Set(words(goal))];
  if (!graph?.files || !terms.length) return { files: [], weak: true, terms };
  const rels = Object.keys(graph.files).filter(rel => !graph.files[rel].test), fields = new Map(rels.map(rel => [rel, fileFields(graph, notes, explanations, rel)]));
  const df = new Map(terms.map(term => [term, rels.filter(rel => { const f = fields.get(rel); return f.name.has(term) || f.defs.has(term) || f.purpose.has(term) || f.titles.has(term) || f.text.has(term); }).length]));
  const scored = [];
  for (const rel of rels) {
    const f = fields.get(rel), why = []; let score = 0;
    for (const term of terms) {
      const weight = 1 + Math.log(rels.length / Math.max(1, df.get(term)));
      let part = 0;
      if (f.name.has(term)) { part += 3; why.push('name: ' + term); }
      if (f.defs.has(term)) { part += 2; why.push('defines: ' + term); }
      if (f.purpose.has(term)) { part += 2; why.push('purpose: ' + term); }
      if (f.titles.has(term)) { part += 1.5; why.push('block: ' + term); }
      if (f.terms.has(term)) part += 1;
      if (f.text.has(term)) part += Math.min(3, 0.5 * f.text.get(term));
      score += part * weight;
    }
    if (score > 0) scored.push({ file: rel, score: Math.round(score * 10) / 10, why: [...new Set(why)].slice(0, 4), rank: graph.files[rel].rank || 0 });
  }
  scored.sort((a, b) => b.score - a.score || b.rank - a.rank || a.file.localeCompare(b.file));
  const files = scored.slice(0, limit).map(({ rank, ...item }) => item);
  // A weak match: nothing scored, or only a few words matched anywhere.
  return { files, weak: !files.length || files[0].score < 2.5, terms };
}

// ---- Impact: who is affected by changing a step -------------------------------
function impactOf(graph, step, { effects = [] } = {}) {
  const file = graph?.files?.[step.file];
  if (step.newFile) return { usedBy: [], uses: [], tests: [], risk: ['Proposed new file; no source lines yet.'] };
  if (!file) return { usedBy: [], uses: [], tests: [], risk: ['This file is not in the project map.'] };
  // Tests are shown on their own; "used by" is the code that depends on the file.
  const notTest = link => !graph.files[link.file]?.test, links = project.linksFor(graph, step.file, 40), allUsedBy = graph.edges.filter(edge => edge.to === step.file && notTest({ file: edge.from })).length;
  const start = step.startLine || 1, end = step.endLine || file.lines;
  const tests = project.testsFor(graph, step.file, start, end).map(test => ({ id: test.id, file: test.file, line: test.line, function: test.function }));
  const risk = [];
  if (file.entry) risk.push('Entry point: the program starts here.');
  if (allUsedBy >= 5) risk.push(allUsedBy + ' files use this one.');
  const functions = file.defs.filter(def => ['function', 'method'].includes(def.kind) && def.line >= start && def.line <= end);
  if (functions.length && !tests.length && !file.test) risk.push('No unit test calls the functions in these lines.');
  if (file.test) risk.push('This is a test file.');
  for (const label of effects) risk.push('The code ' + label + '.');
  return { usedBy: links.usedBy.filter(notTest).slice(0, 12), uses: links.uses.slice(0, 12), tests, risk };
}
// Files that use any plan file, without being in the plan: the ripple.
function rippleOf(graph, planFiles, limit = 40) {
  const plan = new Set(planFiles), out = new Map();
  for (const edge of graph?.edges || []) if (plan.has(edge.to) && !plan.has(edge.from) && !graph.files[edge.from]?.test) out.set(edge.from, (out.get(edge.from) || 0) + (edge.weight || 1));
  return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([file]) => file);
}

// Explicit fast mode is optional; default and legacy auto use the selected model once.
function routeFor(graph, files, mode = 'main') {
  const ripple = rippleOf(graph, files);
  return { first: mode === 'fast' ? 'fast' : 'main', ripple: ripple.length, reason: mode === 'fast' ? 'set to always use the quick model' : 'one draft with your selected model; no automatic escalation' };
}

// ---- The slice of project knowledge an AI drafts the plan from -----------------
// Pseudocode outlines and the few blocks that match the goal; one line for each
// neighbouring file; never source. Cut at the budget, saying what was left out.
function planContext(graph, notes, explanations, { goal, files, budget = 6000, sizes = {} } = {}) {
  const terms = new Set(words(goal)), parts = [], omitted = [], included = [];
  let tokens = 0;
  const add = (text, label) => {
    const cost = project.tokensOf(text);
    if (tokens + cost > budget) { omitted.push(label); return false; }
    parts.push(text); tokens += cost; return true;
  };
  const overview = String(notes?.overview || '').slice(0, 500);
  add('PROJECT: ' + (overview || 'No overview yet.') + (graph.entries?.length ? '\nEntry points: ' + graph.entries.slice(0, 4).join(', ') : ''), 'project overview');
  add('STARTING FILES (chosen by the user):', 'heading');
  const blocks = [];
  for (const rel of files) {
    const file = graph.files[rel]; if (!file) continue;
    const view = viewOf(explanations, rel, file.hash), purpose = notes?.files?.[rel]?.purpose;
    const outline = view ? project.outlineText(view) : project.definitionOutline(file);
    const head = `FILE ${rel} (${file.lines} lines)${purpose ? ' — ' + purpose : ''}${view ? '' : ' [no pseudocode yet; definitions only]'}\n${outline.split('\n').slice(0, 45).join('\n')}`;
    if (add(head, 'outline of ' + rel)) included.push(rel);
    if (view) view.sections.forEach((section, index) => {
      const hits = words(section.title + ' ' + section.pseudocode).filter(word => terms.has(word)).length;
      if (hits) blocks.push({ rel, index, hits, section });
    });
  }
  blocks.sort((a, b) => b.hits - a.hits || a.rel.localeCompare(b.rel) || a.index - b.index);
  const perFile = new Map();
  for (const item of blocks) {
    if ((perFile.get(item.rel) || 0) >= 3) continue;
    if (add('BLOCK of ' + item.rel + '\n' + project.blockText(item.section, item.index), 'block ' + (item.index + 1) + ' of ' + item.rel)) perFile.set(item.rel, (perFile.get(item.rel) || 0) + 1);
  }
  // One line for each file next to the starting files.
  const chosen = new Set(files), near = new Map();
  for (const rel of files) { const links = project.linksFor(graph, rel, 6); for (const link of [...links.usedBy, ...links.uses]) if (!chosen.has(link.file) && !near.has(link.file)) near.set(link.file, link.names); }
  const neighbours = [...near.entries()].slice(0, 14).map(([rel, names]) => `- ${rel}${notes?.files?.[rel]?.purpose ? ' — ' + notes.files[rel].purpose : ''}${names?.length ? ' [shares ' + names.join(', ') + ']' : ''}`);
  if (neighbours.length) add('NEIGHBOURING FILES (use or are used by the starting files):\n' + neighbours.join('\n'), 'neighbouring files');
  const text = parts.join('\n\n');
  return { text, tokens: project.tokensOf(text), included, omitted, report: tokenReport({ tokens: project.tokensOf(text) }, files, graph, sizes) };
}
// Tokens sent versus the whole source of the files involved (and their neighbours).
function tokenReport(context, files, graph, sizes = {}) {
  const whole = files.reduce((sum, rel) => sum + (sizes[rel] ?? (graph?.files?.[rel]?.lines || 0) * 10), 0);
  const sent = context.tokens;
  return { sent, whole, saved: Math.max(0, whole - sent), percent: whole ? Math.max(0, Math.round(100 * (whole - sent) / whole)) : 0 };
}

// ---- A plan as data -----------------------------------------------------------
const clip = (value, limit) => String(value ?? '').replace(/\s+$/g, '').slice(0, limit);
const newId = () => 's' + Math.random().toString(36).slice(2, 9);
// Clean any plan (from the AI, from storage, or edited in the webview): known
// files only, ranges inside the file, bounded text. Returns { plan, dropped }.
function normalizePlan(raw, graph, { maxSteps = MAX_USER_STEPS } = {}) {
  const dropped = [], steps = [];
  for (const item of Array.isArray(raw?.steps) ? raw.steps : []) {
    const file = Object.hasOwn(graph?.files || {}, item?.file) ? graph.files[item.file] : undefined;
    const proposed = newFileStep(item) && (!file || item.newFile === true);
    if (!file && !proposed) { dropped.push('unknown file ' + clip(item?.file, 80)); continue; }
    let start = Number.isInteger(item.startLine) ? item.startLine : 1, end = Number.isInteger(item.endLine) ? item.endLine : file.lines;
    if (proposed) { start = 0; end = 0; } else { start = Math.max(1, Math.min(file.lines, start)); end = Math.max(start, Math.min(file.lines, end)); }
    if (steps.length >= maxSteps) { dropped.push('more than ' + maxSteps + ' steps'); break; }
    steps.push({ ...(proposed ? { newFile: true } : {}), id: /^[\w-]{1,24}$/.test(item.id || '') ? item.id : newId(), file: item.file, startLine: start, endLine: end, title: clip(item.title, 120) || 'Change ' + item.file.split('/').pop(),
      change: clip(item.change, 500), why: clip(item.why, 300), note: clip(item.note, 600), status: ['todo', 'done', 'skipped'].includes(item.status) ? item.status : 'todo', manual: !!item.manual,
      ...(item.before ? { before: clip(item.before, 4000) } : {}), ...(item.after ? { after: clip(item.after, 4000) } : {}) });
  }
  const known = new Set(Object.keys(graph?.files || {}));
  const plan = { id: /^[\w-]{1,32}$/.test(raw?.id || '') ? raw.id : 'p' + Date.now().toString(36), goal: clip(raw?.goal, 600), summary: clip(raw?.summary, 600), createdAt: Number(raw?.createdAt) || Date.now(), updatedAt: Date.now(),
    messages: (Array.isArray(raw?.messages) ? raw.messages : []).slice(-100).filter(message => ['user', 'assistant'].includes(message?.role)).map(message => ({ role: message.role, text: clip(message.text, 3000) })),
    starting: (Array.isArray(raw?.starting) ? raw.starting : []).filter(rel => known.has(rel)).slice(0, 30), dismissed: (Array.isArray(raw?.dismissed) ? raw.dismissed : []).filter(rel => known.has(rel)).slice(0, 30), steps,
    ...(['agent', 'native'].includes(raw?.origin) ? { origin: raw.origin } : {}),
    ...(Number(raw?.approvedAt) > 0 ? { approvedAt: Number(raw.approvedAt) } : {}),
    ...(raw?.native && typeof raw.native === 'object' ? { native: { agent: raw.native.agent === 'codex' ? 'codex' : 'claude', hash: clip(raw.native.hash, 32), at: Number(raw.native.at) || Date.now() } } : {}),
    ...(raw?.models && typeof raw.models === 'object' ? { models: { draft: clip(raw.models.draft, 80), escalated: !!raw.models.escalated, improved: !!raw.models.improved } } : {}),
    ...(raw?.tokens && typeof raw.tokens === 'object' ? { tokens: { sent: Number(raw.tokens.sent) || 0, whole: Number(raw.tokens.whole) || 0, used: Number(raw.tokens.used) || 0 } } : {}),
    ...(Array.isArray(raw?.calls) ? { calls: raw.calls.slice(0, 12).map(call => ({ stage: clip(call?.stage, 24), model: clip(call?.model, 80), tokens: Number(call?.tokens) || 0, estimated: !!call?.estimated })) } : {}) };
  return { plan, dropped };
}

// Apply a revision atomically. Unmentioned steps keep identity, notes, status and cached snippets.
function applyPlanPatch(plan, patch, graph) {
  const current = new Map(plan.steps.map(step => [step.id, step])), changed = new Map(), removed = new Set(patch.removals), seen = new Set();
  if (removed.size !== patch.removals.length) throw new Error('The update removes a step more than once.');
  if (patch.question && (patch.updates.length || patch.additions.length || removed.size)) throw new Error('A clarification cannot also change the plan.');
  const fields = raw => {
    const file = Object.hasOwn(graph.files, raw.file) ? graph.files[raw.file] : undefined, [startLine, endLine] = raw.lines;
    const proposed = !file && startLine === 0 && endLine === 0 && safeNewFilePath(raw.file);
    if (!proposed && (!file || !Number.isInteger(file.lines) || startLine < 1 || endLine < startLine || endLine > file.lines)) throw new Error('The update references an unknown file or invalid source range: ' + raw.file + ' [' + startLine + ', ' + endLine + ']' + (file ? ' (file has ' + file.lines + ' lines).' : '. New files must use [0, 0].'));

    if (plan.dismissed?.includes(raw.file)) throw new Error('The update changes a rejected file.');
    return { ...(proposed ? { newFile: true } : {}), file: raw.file, startLine, endLine, title: raw.title, change: raw.change, why: raw.why };
  };
  for (const id of removed) if (!current.has(id)) throw new Error('The update removes an unknown step.');
  for (const raw of patch.updates) {
    if (!current.has(raw.id) || seen.has(raw.id) || removed.has(raw.id)) throw new Error('The update has an unknown, duplicate or conflicting step ID.');
    seen.add(raw.id); const old = current.get(raw.id), next = fields(raw), different = Object.keys(next).some(key => old[key] !== next[key]);
    const updated = { ...old, ...next }; if (!next.newFile) delete updated.newFile; if (different) { delete updated.before; delete updated.after; } changed.set(raw.id, updated);
  }
  const steps = plan.steps.filter(step => !removed.has(step.id)).map(step => changed.get(step.id) || step), tails = new Map();
  for (const raw of patch.additions) {
    if (raw.afterId && (!current.has(raw.afterId) || removed.has(raw.afterId))) throw new Error('The update inserts after an unknown or removed step.');
    let id; do { id = newId(); } while (current.has(id)); current.set(id, true);
    const next = { id, ...fields(raw), note: '', status: 'todo', manual: false };
    const anchor = tails.get(raw.afterId) || raw.afterId, index = anchor ? steps.findIndex(step => step.id === anchor) + 1 : steps.length;
    steps.splice(index, 0, next); tails.set(raw.afterId, id);
  }
  if (steps.length > MAX_USER_STEPS) throw new Error('The update adds too many steps.');
  return { ...plan, summary: patch.summary || plan.summary, steps, updatedAt: Date.now() };
}

// ---- The gate: is a cheap model's draft good enough? ---------------------------
// Hard failures send the draft to the default model once, with the failures
// named. Soft findings are notes on the plan and never cost another request.
function validatePlan(plan, graph, { starting = plan.starting || [], dismissed = plan.dismissed || [] } = {}) {
  const hard = [], soft = [];
  const steps = plan.steps || [];
  const proposedFiles = new Set(steps.filter(step => newFileStep(step) && (!Object.hasOwn(graph?.files || {}, step.file) || step.newFile)).map(step => step.file));
  if (!steps.length) hard.push({ kind: 'empty', text: 'The plan has no steps.' });
  if (steps.length > MAX_STEPS) hard.push({ kind: 'long', text: 'The plan has ' + steps.length + ' steps; the limit is ' + MAX_STEPS + '.' });
  steps.forEach((step, index) => {
    const label = 'Step ' + (index + 1);
    const file = graph?.files?.[step.file];
    if (!file && !proposedFiles.has(step.file)) hard.push({ kind: 'file', step: index, text: label + ' names a file that is not in the project: ' + clip(step.file, 80) + '.' });
    else if (!proposedFiles.has(step.file) && !(step.startLine >= 1 && step.endLine >= step.startLine && step.endLine <= file.lines)) hard.push({ kind: 'range', step: index, text: label + ' uses lines ' + step.startLine + '–' + step.endLine + ' outside ' + step.file + ' (' + file.lines + ' lines).' });
    if (!String(step.change || '').trim()) hard.push({ kind: 'change', step: index, text: label + ' does not say what to change.' });
    // Files named in the text must exist too.
    for (const mention of String(step.change + ' ' + step.why).match(/[\w./-]+\.(?:py|js|jsx|ts|tsx|go|rs|java|rb|php|c|cpp|cs)\b/g) || []) {
      if (graph?.files && !proposedFiles.has(mention) && !graph.files[mention] && !Object.keys(graph.files).some(rel => rel.endsWith('/' + mention) || rel === mention)) hard.push({ kind: 'mention', step: index, text: label + ' mentions ' + mention + ', which is not in the project.' });
    }
  });
  const used = new Set(steps.map(step => step.file));
  // Starting files are where to look, not obligations: an unused one is a note, never a reason to ask again.
  for (const rel of starting) if (!used.has(rel) && !dismissed.includes(rel)) soft.push({ kind: 'unused', text: rel + ' was a starting file but no step uses it.' });
  // Soft: a step that uses another step's file should come after it.
  steps.forEach((step, index) => steps.forEach((other, otherIndex) => {
    if (otherIndex > index && other.file !== step.file && graph?.edges?.some(edge => edge.from === step.file && edge.to === other.file)) soft.push({ kind: 'order', step: index, text: 'Step ' + (index + 1) + ' uses ' + other.file + ', which step ' + (otherIndex + 1) + ' changes. Consider doing step ' + (otherIndex + 1) + ' first.' });
  }));
  // What the plan leaves out: tests that cover a changed file and the code that uses it. Shown as notes, so a thin plan says what it skipped.
  const inPlan = new Set(steps.map(step => step.file));
  steps.forEach((step, index) => {
    if (!graph?.files?.[step.file]) return;
    const impact = impactOf(graph, step), testFiles = [...new Set(impact.tests.map(test => test.file))].filter(file => !inPlan.has(file));
    if (testFiles.length) soft.push({ kind: 'tests', step: index, text: 'Step ' + (index + 1) + ' changes code that ' + testFiles.slice(0, 3).join(', ') + ' tests; the plan does not touch ' + (testFiles.length === 1 ? 'it' : 'them') + '.' });
    const users = impact.usedBy.map(link => link.file).filter(file => !inPlan.has(file));
    if (users.length) soft.push({ kind: 'users', step: index, text: 'Step ' + (index + 1) + ' changes ' + step.file.split('/').pop() + ', which ' + users.slice(0, 3).map(file => file.split('/').pop()).join(', ') + (users.length > 3 ? ' and ' + (users.length - 3) + ' more' : '') + (users.length === 1 ? ' uses' : ' use') + '; none is in the plan.' });
  });
  return { ok: !hard.length, hard, soft: soft.slice(0, 12) };
}

// ---- Using the plan ----------------------------------------------------------
const rangeText = step => step.newFile ? step.file + ' (new file proposal; no source lines yet)' : step.file + ' lines ' + step.startLine + '–' + step.endLine;
function promptFromPlan(plan, { only } = {}) {
  const steps = plan.steps.map((step, index) => ({ step, number: index + 1 })).filter(({ step, number }) => (only === undefined || number === only) && step.status !== 'skipped');
  const lines = ['Goal: ' + plan.goal, '', only === undefined ? promptText('planning/steps-all') : promptText('planning/step-one'), ''];
  for (const { step, number } of steps) {
    lines.push(number + '. ' + step.title + (step.status === 'done' ? ' (already done)' : ''), '   Where: ' + rangeText(step), '   Change: ' + step.change);
    if (step.why) lines.push('   Why: ' + step.why);
    if (step.before) lines.push('   Today (pseudocode): ' + step.before.split('\n').join('\n     '));
    if (step.after) lines.push('   After (pseudocode): ' + step.after.split('\n').join('\n     '));
    if (step.note) lines.push('   My note: ' + step.note);
    lines.push('');
  }
  if (plan.steps.some(step => step.newFile)) lines.push(promptText('planning/new-files-note'));
  lines.push(promptText('planning/read-before-edit'));
  return lines.join('\n');
}
function planToMarkdown(plan) {
  const out = ['# Plan: ' + (plan.goal || 'untitled'), ''];
  if (plan.summary) out.push(plan.summary, '');
  plan.steps.forEach((step, index) => {
    out.push(`## ${index + 1}. ${step.title}${step.status === 'done' ? ' ✓' : step.status === 'skipped' ? ' (skipped)' : ''}`, '', `**Where:** \`${rangeText(step)}\``, '', `**Change:** ${step.change}`, '');
    if (step.why) out.push(`**Why:** ${step.why}`, '');
    if (step.before || step.after) out.push('**Before → after (pseudocode)**', '', '```text', step.before || '(none)', '```', '', '```text', step.after || '(none)', '```', '');
    if (step.note) out.push(`**Note:** ${step.note}`, '');
  });
  return out.join('\n');
}

module.exports = { safeNewFilePath, newFileStep, applyPlanPatch, MAX_STEPS, routeFor, words, findStartingPoints, impactOf, rippleOf, planContext, tokenReport, normalizePlan, validatePlan, promptFromPlan, planToMarkdown };
