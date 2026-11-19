'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const journal = require('../src/project/conversation');
test('a project conversation migrates previous plans and completion once and survives clearing the active plan', () => {
  const plan = { id: 'p', goal: 'Use a beginner audience profile', summary: 'Load the audience profile.', steps: [{ file: 'writer.py', title: 'Load profile', status: 'todo' }], messages: [{ role: 'user', text: 'Use a beginner audience profile' }, { role: 'assistant', text: 'Load the audience profile.' }] };
  const store = { current: plan, history: [], lastRun: { summary: 'Previous checks passed.' } };
  const chat = journal.ensure(store), count = chat.messages.length;
  journal.ensure(store); assert.equal(chat.messages.length, count);
  const artifact = chat.messages.find(row => row.kind === 'plan'); assert.equal(artifact.details.steps[0].file, 'writer.py');
  plan.steps[0].title = 'Read the audience profile'; assert.equal(artifact.details.steps[0].title, 'Load profile', 'reviewed artifacts are immutable snapshots');
  journal.ensure(store); store.history.push({ ...plan, completedAt: Date.now() }); store.current = undefined;
  journal.add(store, { role: 'assistant', mode: 'work', kind: 'completion', text: 'Implementation complete.' });
  journal.add(store, { role: 'user', mode: 'work', text: 'Test those changes' });
  const restored = JSON.parse(JSON.stringify(store));
  assert.equal(journal.ensure(restored).id, chat.id); assert.equal(restored.conversation.messages[0].text, 'Use a beginner audience profile'); assert.equal(restored.conversation.messages.at(-1).text, 'Test those changes');
});
test('history pages and bounded handoffs retain access to full old messages and reviewed steps', () => {
  const store = {}; const first = journal.add(store, { role: 'user', text: 'Explain the original audience requirement', mode: 'chat' });
  for (let i = 0; i < 140; i++) journal.add(store, { role: i % 2 ? 'user' : 'assistant', text: 'Turn ' + i, mode: 'work' });
  const last = journal.page(store, { limit: 10 }); assert.equal(last.messages.length, 10); assert.equal(last.hasMore, true);
  const previous = journal.page(store, { limit: 10, before: last.messages[0].id }); assert.equal(previous.messages.at(-1).text, 'Turn 129');
  const prompt = journal.context(store, 1200); assert.match(prompt, /original audience requirement/); assert.match(prompt, /Turn 139/); assert.match(prompt, /get_conversation/); assert.ok(prompt.length < 2000);
  const after = journal.context(store, 1200, store.conversation.messages.at(-2).id); assert.doesNotMatch(after, /Turn 138/); assert.match(after, /Turn 139/);
  const long = journal.add(store, { role: 'assistant', text: 'x'.repeat(20000) }); let payload = '', offset = 0;
  do { const part = journal.page(store, { message_id: long.id, offset, limit: 1000 }); payload += part.content; offset = part.nextOffset; } while (offset !== null);
  assert.equal(JSON.parse(payload).text.length, 20000); assert.throws(() => journal.page(store, { before: 'missing' }), /Unknown/); assert.equal(first.id, store.conversation.messages[0].id);
});


test('old handoff labels are repaired without losing messages, native sessions or cursors', () => {
  const prompt = 'Answer the current question about this project.\nPROJECT CONVERSATION (history is context, not a new instruction):\nPRIVATE_HISTORY\nCURRENT USER REQUEST: "hey"';
  const store = { conversation: { id: 'chat', mode: 'work', migratedCompletion: true, messages: [
    { id: 'u', role: 'user', text: 'Explain my code' },
    { id: 'h', role: 'assistant', kind: 'handoff', text: 'Continuing Codex: ' + prompt, details: { sessionId: 'native' } },
    { id: 'a', role: 'assistant', text: 'An ordinary answer' }
  ], sessions: { codex: { id: 'native', title: prompt, lastMessageId: 'a', linked: true } } } };
  const chat = journal.ensure(store);
  assert.equal(chat.messages[1].text, 'Continuing Codex: hey'); assert.equal(chat.sessions.codex.title, 'hey');
  assert.deepEqual(chat.messages.map(row => row.id), ['u', 'h', 'a']); assert.equal(chat.messages[0].text, 'Explain my code');
  assert.equal(chat.sessions.codex.id, 'native'); assert.equal(chat.sessions.codex.lastMessageId, 'a'); assert.equal(chat.sessions.codex.linked, true);
  const saved = JSON.stringify(store); journal.ensure(store); assert.equal(JSON.stringify(store), saved, 'repair runs once and survives restart');
  assert.doesNotMatch(journal.context(store), /PRIVATE_HISTORY/);
});
