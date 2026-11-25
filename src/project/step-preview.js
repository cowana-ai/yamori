'use strict';

const { randomUUID } = require('node:crypto');
const { hash } = require('../ai/engine');
const { PROPOSAL_SCHEMA, proposalPrompt, parseProposal, sourcePreview } = require('./reader-workspace');

function createStepPreview(api, { scope, request, openPatch, changed, applied, activity, sourceUri }) {
  let current, decoration, closeDiff, lastEdit, undoing = false;
  const editors = new Set();

  function clearGhosts() {
    for (const editor of editors) editor.setDecorations(decoration, []);
    editors.clear();
  }

  function clearDiff() {
    if (closeDiff) void Promise.resolve(closeDiff()).catch(() => {});
    closeDiff = undefined;
  }

  function cancel(force = false) {
    if (current?.applying && !force) return;
    current?.controller.abort();
    current = undefined;
    clearGhosts();
    clearDiff();
    changed();
  }

  function invalidate(uri) {
    if (!current || ![current.scope?.uri, current.sourceUri].some(item => item?.toString() === uri.toString())) return;
    if (current.applying) return;
    current.controller.abort();
    current.patch = undefined;
    current.phase = 'stale';
    current.message = 'Source changed. Preview again to continue.';
    clearGhosts();
    clearDiff();
    changed();
  }

  function showGhosts(item) {
    clearGhosts();
    if (!item.patch?.ghosts.length || !api.window.createTextEditorDecorationType) return;
    decoration ||= api.window.createTextEditorDecorationType({ after: { color: new api.ThemeColor('gitDecoration.addedResourceForeground'),
      backgroundColor: new api.ThemeColor('diffEditor.insertedTextBackground'), margin: '0 0 0 2em' } });
    const rows = new Map();
    for (const ghost of item.patch.ghosts.slice(0, 12)) {
      const text = rows.get(ghost.line);
      rows.set(ghost.line, text ? text + '    + ' + ghost.text.trimStart() : '+ ' + ghost.text.trimStart());
    }
    for (const editor of api.window.visibleTextEditors || []) {
      if (editor.document.uri.toString() !== item.scope.uri.toString()) continue;
      editor.setDecorations(decoration, [...rows].map(([line, text], index) => {
        const end = editor.document.lineAt(line - 1).text.length;
        return { range: new api.Range(line - 1, end, line - 1, end),
          renderOptions: { after: { contentText: (index ? '' : 'PREVIEW  ') + text.slice(0, 180) } } };
      }));
      editors.add(editor);
    }
  }

  function snapshot(item) {
    return { id: item.id, clientId: item.clientId, phase: item.phase, message: item.message, mode: item.mode, provider: item.provider,
      estimate: item.estimate, ready: !!item.patch && item.phase === 'ready', index: item.index };
  }

  function fail(item, error) {
    if (current !== item || item.controller.signal.aborted) return;
    item.phase = 'error';
    item.message = error.message || 'The preview failed.';
    activity(item.message);
    changed();
  }

  function supersede() {
    if (!current || current.applying) return;
    current.controller.abort();
    current.patch = undefined;
    current.phase = 'superseded';
  }

  async function preview(message) {
    if (undoing || current?.applying || !['step', 'command', 'test'].includes(message.mode)) return;
    const instruction = typeof message.instruction === 'string' && message.instruction.trim();
    if (!instruction || instruction.length > 4000) throw new Error('Enter a request of up to 4,000 characters.');
    const previous = current;
    if (previous && previous.clientId === message.clientId && previous.instruction === instruction && previous.provider === message.provider &&
        (previous.phase === 'previewing' || previous.phase === 'ready')) return;
    previous?.controller.abort();
    const item = { id: randomUUID(), clientId: message.clientId, phase: 'previewing', mode: message.mode, provider: message.provider, index: message.index, instruction, sourceUri: sourceUri?.(), controller: new AbortController() };
    current = item;
    changed();
    try {
      const target = await scope(message);
      if (current !== item || item.controller.signal.aborted) return;
      item.scope = target;
      item.sourceUri = target.sourceUri;
      if (target.question) {
        const { input, sourceTokens, pseudoTokens, model } = target.question;
        item.estimate = { kind: input.kind, tokens: input.kind === 'code' ? sourceTokens : pseudoTokens, model };
        changed();
      }
      const response = await request({ schema: PROPOSAL_SCHEMA, signal: item.controller.signal, ...(target.question ? { model: target.question.model } : {}), readRoot: target.readRoot, tools: target.tools, prompt: proposalPrompt({ ...target, instruction }) }, item.provider);
      if (current !== item || item.controller.signal.aborted) return;
      if (target.sourceHash) {
        const origin = await api.workspace.openTextDocument(target.sourceUri);
        if (current !== item || item.controller.signal.aborted) return;
        if (hash(origin.getText()) !== target.sourceHash) throw new Error('Source changed. Preview again to continue.');
      }
      const proposal = parseProposal(response.raw);
      clearGhosts();
      clearDiff();
      item.message = proposal.message;
      if (item.estimate) {
        const usage = response.usage;
        const reportedInput = usage ? (usage.input || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0) : undefined;
        Object.assign(item.estimate, { actualModel: response.actualModel, reportedInput });
      }
      if (!proposal.edit || target.question) {
        item.phase = 'answer';
        if (proposal.message) activity(proposal.message);
        changed();
        return;
      }
      const proposed = target.wholeFile ? { after: target.text.includes('\r\n') ?
        proposal.replacement.replace(/\r?\n/g, '\r\n') : proposal.replacement, ghosts: [] } :
        sourcePreview(target.text, target.startLine, target.endLine, proposal.replacement);
      if (!target.exists && !proposed.after.trim()) throw new Error('The proposed test file is empty.');
      if (proposed.after === target.text) throw new Error('The provider returned the source unchanged.');
      item.patch = proposed;
      item.phase = 'ready';
      showGhosts(item);
      changed();
      if (item.mode !== 'step') await showDiff(item.id);
    } catch (error) { fail(item, error); }
  }

  async function showDiff(id) {
    const item = current;
    if (item?.id !== id || item.phase !== 'ready') return;
    clearDiff();
    const { scope: target, patch } = item;
    const close = await openPatch(target.uri, target.text, patch.after, target.startLine);
    if (item === current && item.phase === 'ready') closeDiff = close;
    else await close?.();
  }

  async function replaceDocument(target, before, after) {
    const doc = await api.workspace.openTextDocument(target.uri);
    if (doc.getText() !== before) return false;
    const editor = await api.window.showTextDocument(doc, { viewColumn: target.column, preserveFocus: true });
    if (editor.document.getText() !== before) return false;
    const end = doc.lineCount - 1;
    const range = new api.Range(0, 0, end, doc.lineAt(end).text.length);
    // TextEditor.edit carries the document version across the extension host boundary.
    return editor.edit(edit => edit.replace(range, after));
  }

  async function undo(id) {
    const edit = lastEdit;
    if (!edit || edit.id !== id || current || undoing || api.workspace.isTrusted === false) return;
    if (sourceUri?.()?.toString() !== edit.target.sourceUri?.toString()) return;
    undoing = true;
    changed();
    try {
      if (!await replaceDocument(edit.target, edit.after, edit.target.text)) {
        throw new Error('The file changed after Yamori applied this edit. Undo is unavailable.');
      }
      lastEdit = undefined;
      activity('Undid the last Yamori edit.');
      await applied(edit.target, { undo: true });
    } catch (error) {
      if (lastEdit === edit) edit.error = error.message;
      activity(error.message);
    } finally {
      undoing = false;
      changed();
    }
  }

  async function accept(id) {
    const item = current;
    if (item?.id !== id || item.phase !== 'ready' || undoing || api.workspace.isTrusted === false) return;
    const { scope: target, patch } = item;
    item.applying = true;
    item.phase = 'applying';
    changed();
    try {
      if (target.sourceHash && target.test) {
        const origin = await api.workspace.openTextDocument(target.sourceUri);
        if (hash(origin.getText()) !== target.sourceHash) throw new Error('Source changed. Preview the test again to continue.');
      }
      if (target.exists) {
        if (!await replaceDocument(target, target.text, patch.after)) throw new Error('Source changed. Preview again to continue.');
      } else {
        const edit = new api.WorkspaceEdit();
        edit.createFile(target.uri, { overwrite: false, ignoreIfExists: false });
        edit.insert(target.uri, new api.Position(0, 0), patch.after);
        if (!await api.workspace.applyEdit(edit)) throw new Error('The test file could not be created. Preview again to continue.');
      }
      lastEdit = target.exists ? { id: item.id, target, after: patch.after } : undefined;
      activity(target.test ? 'Applied the test preview.' : 'Applied the source preview.');
      cancel(true);
      await applied(target);
    } catch (error) { if (current === item) fail(item, error); else activity(error.message); }
    finally { item.applying = false; }
  }

  return { preview, showDiff, accept, cancel, supersede, undo, invalidate, state: () => current && snapshot(current),
    undoState() {
      if (lastEdit && sourceUri?.()?.toString() === lastEdit.target.sourceUri?.toString()) {
        return { id: lastEdit.id, busy: undoing, error: lastEdit.error };
      }
    },
    dispose() { lastEdit = undefined; cancel(true); decoration?.dispose(); } };
}

module.exports = { createStepPreview };
