'use strict';
// "Set up Yamori": which AI explains code, and one button to make it ready.
// The extension sends finished text (cards, checks, button labels); the page
// only renders it with textContent and sends back action names. Every CLI
// path and terminal command is built by the extension.
const { randomBytes } = require('node:crypto');
const { BASE_STYLES, LOGO } = require('./panel');

function setupHTML(initialPalette = 'auto') {
  const nonce = randomBytes(18).toString('base64');
  const palette = ['paper', 'slate'].includes(initialPalette) ? initialPalette : 'auto';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Set up Yamori</title><style nonce="${nonce}">
${BASE_STYLES}
main { max-width: 760px; margin: 0 auto; padding: 28px 20px 56px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand img { width: 30px; height: 30px; image-rendering: pixelated; filter: brightness(0) invert(1); }
body.vscode-light:not([data-palette="slate"]) .brand img, body[data-palette="paper"] .brand img { filter: brightness(0); }
.wordmark { font: 800 17px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: -.05em; }
h1 { font-size: 26px; line-height: 1.2; letter-spacing: -.02em; margin: 26px 0 8px; }
.lead { margin: 0; max-width: 62ch; color: var(--read-muted); font-size: 14px; }
.next { margin: 14px 0 0; font: 12px/1.6 ui-monospace, monospace; }
.next b { font-weight: 700; }
.notice { margin: 18px 0 0; padding: 10px 14px; border-left: 3px solid var(--read-ink); background: var(--read-note-bg); color: var(--read-note-ink); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; margin-top: 22px; }
.card { display: flex; flex-direction: column; gap: 12px; padding: 18px; border: 1px solid var(--read-border); background: var(--read-surface); }
.card.ready { border-color: var(--read-ink); box-shadow: 4px 4px 0 var(--read-ink); }
.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.card h2 { margin: 0; font-size: 17px; }
.product { margin: 2px 0 0; color: var(--read-muted); font-size: 12px; }
.badge { font: 600 10px/1.6 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .06em; padding: 1px 6px; border: 1px solid var(--read-ink); white-space: nowrap; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.checks li { display: grid; grid-template-columns: 1.4em 1fr; gap: 4px; overflow-wrap: anywhere; }
.checks .mark { font: 700 13px/1.6 ui-monospace, monospace; }
.checks li.no, .checks li.unknown { color: var(--read-muted); }
.card .go { margin-top: auto; display: grid; gap: 6px; }
button.primary { background: var(--read-accent); color: var(--read-on-accent); border: 1px solid var(--read-accent); font-weight: 700; padding: 9px 14px; font-size: 14px; }
button.primary:hover:not(:disabled) { background: var(--read-accent); box-shadow: 3px 3px 0 var(--read-border); transform: translate(-1px, -1px); }
button.primary.soft { background: transparent; color: var(--read-ink); border-color: var(--read-ink); }
button.primary.soft:hover:not(:disabled) { background: var(--read-hover); }
button.quiet { justify-self: start; padding: 2px 0; font-size: 12px; color: var(--read-muted); text-decoration: underline; }
.hint { margin: 0; color: var(--read-muted); font-size: 12px; }
.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; margin-top: 24px; color: var(--read-muted); font-size: 12px; }
.foot button { border: 1px solid var(--read-border); font-size: 12px; }
.done { margin-top: 22px; padding: 18px; border: 1px solid var(--read-ink); box-shadow: 4px 4px 0 var(--read-ink); background: var(--read-surface); }
.done h2 { margin: 0 0 6px; font-size: 18px; }
.done p { margin: 0 0 14px; color: var(--read-muted); }
.done .row { display: flex; flex-wrap: wrap; gap: 8px; }
.done .row button:not(.primary) { border: 1px solid var(--read-border); }
@media (max-width: 520px) { main { padding: 20px 16px 40px; } h1 { font-size: 22px; } }
</style></head><body data-palette="${palette}"><main>
<div class="brand"><img src="${LOGO}" alt=""><span class="wordmark">yamori</span></div>
<h1 id="title">Set up Yamori</h1>
<p id="lead" class="lead">Checking which AI is on this computer…</p>
<p id="next" class="next" hidden></p>
<div id="notice" class="notice" role="status" hidden></div>
<div id="done" class="done" hidden></div>
<div id="cards" class="cards" aria-live="polite"></div>
<div class="foot"><button id="check">Check again</button><span id="foot-text"></span></div>
</main><script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const $ = id => document.getElementById(id);
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
const MARKS = { yes: '✓', no: '✕', unknown: '?' };
function render(s) {
  document.body.setAttribute('data-palette', ['paper', 'slate'].includes(s.readingPalette) ? s.readingPalette : 'auto');
  $('title').textContent = s.title || 'Set up Yamori';
  $('lead').textContent = s.lead || '';
  $('next').hidden = !s.next; $('next').textContent = '';
  if (s.next) $('next').append(node('span', 'Then Yamori will '), node('b', s.next), node('span', '.'));
  $('notice').hidden = !s.notice; $('notice').textContent = s.notice || '';
  const done = $('done'); done.textContent = ''; done.hidden = !s.done;
  if (s.done) {
    done.append(node('h2', s.done.title), node('p', s.done.text));
    const row = node('div', undefined, 'row');
    (s.done.actions || []).forEach((action, index) => { const button = node('button', action.label, index ? '' : 'primary'); button.addEventListener('click', () => send('next', { id: action.id })); row.append(button); });
    done.append(row);
  }
  const cards = $('cards'); cards.textContent = ''; cards.hidden = !!s.done;
  const anyReady = (s.cards || []).some(card => card.ready);
  for (const card of s.cards || []) {
    const el = node('section', undefined, 'card' + (card.ready ? ' ready' : '')); el.setAttribute('aria-label', card.name);
    const head = node('div', undefined, 'card-head'), names = node('div');
    names.append(node('h2', card.name), node('p', card.product, 'product')); head.append(names);
    if (card.badge) head.append(node('span', card.badge, 'badge'));
    const checks = node('ul', undefined, 'checks');
    for (const line of card.lines || []) {
      const item = node('li', undefined, line.state); const mark = node('span', MARKS[line.state] || '·', 'mark'); mark.setAttribute('aria-hidden', 'true');
      item.append(mark, node('span', line.text)); checks.append(item);
    }
    const go = node('div', undefined, 'go');
    if (card.action) {
      const button = node('button', card.action.label, anyReady && !card.ready ? 'primary soft' : 'primary'); button.disabled = !!s.checking && !card.ready;
      button.addEventListener('click', () => send('primary', { provider: card.id })); go.append(button);
      if (card.action.hint) go.append(node('p', card.action.hint, 'hint'));
    }
    if (card.alt) { const alt = node('button', card.alt.label, 'quiet'); alt.addEventListener('click', () => send('alt', { provider: card.id })); go.append(alt); }
    el.append(head, checks, go); cards.append(el);
  }
  $('check').disabled = !!s.checking; $('check').textContent = s.checking ? 'Checking…' : 'Check again';
  $('foot-text').textContent = s.foot || '';
}
$('check').addEventListener('click', () => send('check'));
window.addEventListener('message', event => { if (event.data?.type === 'setup') render(event.data.state); });
send('ready');
</script></body></html>`;
}

module.exports = { setupHTML };
