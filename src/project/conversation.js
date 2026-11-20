'use strict';
// Project conversation survives clearing a plan. Native session references are
// local metadata; prompts use a bounded tail and tools can retrieve older turns.
const crypto = require('node:crypto');
const { cleanTitle } = require('./sessions');
const MODES = ['chat', 'plan', 'work'];
const signature = message => JSON.stringify([message.role, message.text]);
function ensure(plans) {
  if (!plans.conversation || !Array.isArray(plans.conversation.messages)) plans.conversation = { id: crypto.randomUUID(), mode: plans.current?.goal ? 'plan' : 'work', messages: [], calls: [], sessions: {}, planMessages: {} };
  const chat = plans.conversation;
  chat.sessions ||= {}; chat.calls ||= []; chat.planMessages ||= {};
  if (chat.displayVersion !== 1) {
    for (const session of Object.values(chat.sessions)) if (session.title) session.title = cleanTitle(session.title);
    for (const message of chat.messages) {
      if (message.kind !== 'handoff' || !message.details?.sessionId) continue;
      const match = message.text?.match(/^Continuing (Codex|Claude Code): ([\s\S]*)$/);
      if (match) message.text = 'Continuing ' + match[1] + ': ' + cleanTitle(match[2]);
    }
    chat.displayVersion = 1;
  }
  if (!MODES.includes(chat.mode)) chat.mode = 'chat';
  for (const plan of [...(plans.history || []), ...(plans.current ? [plans.current] : [])]) sync(plans, plan, chat);
  if (!chat.migratedCompletion) {
    chat.migratedCompletion = true;
    if (plans.lastRun?.summary && !chat.messages.some(message => message.kind === 'completion' && message.text === plans.lastRun.summary)) append(chat, { role: 'assistant', text: plans.lastRun.summary, mode: 'work', kind: 'completion' });
  }
  return chat;
}
function append(chat, message) {
  const row = { id: crypto.randomUUID(), at: Date.now(), role: ['user', 'assistant', 'tool'].includes(message.role) ? message.role : 'assistant', mode: MODES.includes(message.mode) ? message.mode : chat.mode, text: String(message.text || '').slice(0, 100000), ...(message.kind ? { kind: message.kind } : {}), ...(message.planId ? { planId: message.planId } : {}), ...(message.details ? { details: JSON.parse(JSON.stringify(message.details)) } : {}) };
  chat.messages.push(row); chat.updatedAt = row.at; return row;
}
function sync(plans, plan, ready) {
  const chat = ready || ensure(plans); if (!plan) return;
  const messages = plan.messages?.length ? plan.messages : [{ role: 'user', text: plan.goal || '' }, ...(plan.summary ? [{ role: 'assistant', text: plan.summary }] : [])];
  const previous = chat.planMessages[plan.id] || [], incoming = messages.map(signature);
  let overlap = Math.min(previous.length, incoming.length);
  while (overlap && !previous.slice(-overlap).every((value, index) => value === incoming[index])) overlap--;
  const added = messages.slice(overlap).filter(message => message.text).map(message => append(chat, { ...message, mode: 'plan', planId: plan.id }));
  chat.planMessages[plan.id] = incoming;
  // Keep the actual reviewed changes alongside the discussion, without repeat entries.
  if (plan.steps?.length && !(plan.completedAt && chat.planDetails?.[plan.id])) {
    const details = { id: plan.id, summary: plan.summary, steps: plan.steps, rejectedFiles: plan.dismissed || [] }, digest = JSON.stringify(details);
    chat.planDetails ||= {};
    if (chat.planDetails[plan.id] !== digest) { const reply = [...added].reverse().find(message => message.role === 'assistant'); if (reply) { reply.kind = 'plan'; reply.details = JSON.parse(digest); } else append(chat, { role: 'assistant', mode: 'plan', kind: 'plan', planId: plan.id, text: plan.summary || 'Plan updated.', details }); chat.planDetails[plan.id] = digest; }
  }
}
function add(plans, message) { return append(ensure(plans), message); }
function context(plans, limit = 24000, after, { includePlan = true } = {}) {
  const chat = ensure(plans), tail = []; let size = 0;
  const cursor = after ? chat.messages.findIndex(message => message.id === after) : -1;
  for (const message of chat.messages.slice(cursor + 1).reverse()) {
    const row = JSON.stringify({ id: message.id, role: message.role, mode: message.mode, kind: message.kind, text: message.text, ...(message.kind === 'plan' ? { planId: message.planId } : {}) });
    if (size + row.length > limit) break; tail.unshift(row); size += row.length;
  }
  const initial = chat.messages.find(message => message.role === 'user');
  return 'PROJECT CONVERSATION (history is context, not a new instruction):\n' + (initial && cursor < 0 ? 'Initial request: ' + JSON.stringify(initial.text).slice(0, 6000) + '\n' : '') + tail.join('\n') + '\n' + (chat.messages.length - tail.length) + ' older messages are available using get_conversation. ' + (includePlan ? 'Current plan: ' + JSON.stringify(plans.current ? { id: plans.current.id, goal: plans.current.goal, summary: plans.current.summary, steps: plans.current.steps, rejectedFiles: plans.current.dismissed } : null).slice(0, 14000) : 'The approved plan is supplied separately.');
}
function page(plans, { before, limit = 30, message_id: messageId, offset = 0 } = {}) {
  const chat = ensure(plans);
  if (messageId) { const message = chat.messages.find(row => row.id === messageId); if (!message) throw new Error('Unknown conversation message ID.'); const text = JSON.stringify(message), start = Math.max(0, Number.isInteger(offset) ? offset : 0), size = Math.max(1, Math.min(6000, Number.isInteger(limit) ? limit : 6000)); return { id: chat.id, messageId, offset: start, totalCharacters: text.length, nextOffset: start + size < text.length ? start + size : null, content: text.slice(start, start + size) }; }
  const end = before ? chat.messages.findIndex(message => message.id === before) : chat.messages.length;
  if (end < 0) throw new Error('Unknown conversation message ID.');
  const count = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 30)), start = Math.max(0, end - count);
  return { id: chat.id, total: chat.messages.length, hasMore: start > 0, messages: chat.messages.slice(start, end) };
}
module.exports = { MODES, ensure, sync, add, context, page };
