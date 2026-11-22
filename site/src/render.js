import { tokenize, pseudocodeLines, mathParts, emphasisParts, glossaryParts } from 'yamori:reading';
import { el } from './dom.js';

function appendText(parent, text, ctx) {
  for (const token of tokenize(text)) {
    if ((!ctx.terms && !ctx.symbols) || (token.kind && token.kind !== 'comment')) {
      parent.append(el('span', token.kind, token.text));
      continue;
    }
    const span = el('span', token.kind);
    for (const part of glossaryParts(token.text, ctx.terms)) {
      const term = part.term === undefined ? undefined : ctx.glossary?.[part.term];
      if (term) {
        span.append(link(part.text, 'term', term.term + ': ' + (term.meaning || 'Project term') + (term.file ? ' · ' + term.file + ':' + term.line : ''), () => ctx.onOpen?.(term.file, term.line)));
        continue;
      }
      for (const piece of glossaryParts(part.text, ctx.symbols)) {
        const symbol = piece.term === undefined ? undefined : ctx.symbolTable?.[piece.term];
        span.append(symbol
          ? link(piece.text, 'symbol', symbol.name + ': ' + symbol.kind + ' in ' + symbol.file + ':' + symbol.line + (symbol.block ? ' · ' + symbol.block : ''), () => ctx.onOpen?.(symbol.file, symbol.line))
          : document.createTextNode(piece.text));
      }
    }
    parent.append(span);
  }
}

function link(text, className, title, onOpen) {
  const node = el('span', className, text);
  node.title = title;
  node.tabIndex = 0;
  node.setAttribute('role', 'link');
  const open = event => { event.preventDefault(); event.stopPropagation(); onOpen(); };
  node.addEventListener('click', open);
  node.addEventListener('keydown', event => { if (event.key === 'Enter') open(event); });
  return node;
}

function appendMath(parent, text, ctx) {
  for (const part of mathParts(text)) {
    if (!part.tex) { appendText(parent, part.text, ctx); continue; }
    try {
      const markup = window.katex.renderToString(part.tex, { output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100, maxSize: 10 });
      const math = new DOMParser().parseFromString(markup, 'text/html').querySelector('math');
      if (math) parent.append(document.importNode(math, true));
      else appendText(parent, part.text, ctx);
    } catch { appendText(parent, part.text, ctx); }
  }
}

function appendInline(parent, text, ctx) {
  for (const part of emphasisParts(text)) {
    const target = part.strong ? el('strong', 'important') : parent;
    appendMath(target, part.text, ctx);
    if (part.strong) parent.append(target);
  }
}

// One Yamori reading block. Returns the rows so the source pane can highlight them.
export function renderBlock(parent, section, index, ctx) {
  const block = el('details', 'reading-block');
  block.open = true;
  const heading = el('summary', 'section-heading');
  heading.append(el('span', 'block-index', String(index + 1).padStart(2, '0')));
  heading.append(el('h2', '', section.title));
  const range = el('button', 'line', 'L' + section.startLine + (section.endLine !== section.startLine ? '–' + section.endLine : ''));
  range.type = 'button';
  range.title = 'Highlight this block in the source';
  range.addEventListener('click', event => { event.preventDefault(); ctx.onRange?.(section.startLine, section.endLine, true); });
  heading.append(range);
  const code = el('pre');
  const rows = [];
  let step = 0;
  pseudocodeLines(section.pseudocode).forEach(({ text, kind }, lineIndex) => {
    const row = el('span', 'code-line' + (kind ? ' ' + kind : ''));
    if (kind === 'note' && /^\s*#\s*(Context|Why|How|What|Insight|Inferred|Unresolved):/i.test(text)) row.classList.add('context-note');
    const mapping = section.lineMap?.find(item => item.pseudocodeLine === lineIndex + 1);
    row.append(el('span', 'step-number', text.trim() && kind !== 'note' ? String(++step) : ''));
    if (mapping) {
      row.classList.add('linked');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.title = 'Hover to highlight source L' + mapping.startLine + '–' + mapping.endLine + ' · Click to jump';
      row.setAttribute('aria-label', text.trim() + '. ' + row.title);
      const jump = () => ctx.onRange?.(mapping.startLine, mapping.endLine, true);
      row.addEventListener('click', jump);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); } });
      row.addEventListener('mouseenter', () => ctx.onRange?.(mapping.startLine, mapping.endLine, false));
      row.addEventListener('focus', () => ctx.onRange?.(mapping.startLine, mapping.endLine, false));
      row.addEventListener('mouseleave', () => ctx.onClear?.());
      row.addEventListener('blur', () => ctx.onClear?.());
    }
    const body = el('span', 'step-body');
    body.style.paddingInlineStart = Math.min(text.length - text.trimStart().length, 40) * 0.55 + 'em';
    appendInline(body, text.trimStart(), ctx);
    if (!text) body.append(document.createTextNode(' '));
    row.append(body);
    code.append(row);
    rows.push({ row, mapping });
  });
  block.append(heading, code);
  const aside = ctx.asides?.[index];
  if (aside?.digest) block.append(blogNote(aside));
  parent.append(block);
  return rows;
}

function blogNote(aside) {
  const box = el('div', 'block-blog');
  const digest = el('div', 'blog-digest');
  digest.append(el('h3', '', 'Digest'));
  for (const paragraph of aside.digest.split(/\n\n+/)) digest.append(el('p', '', paragraph));
  box.append(digest);
  if (aside.next) {
    const next = el('div', 'blog-next');
    next.append(el('h3', '', 'What to expect next'));
    for (const paragraph of aside.next.split(/\n\n+/)) next.append(el('p', '', paragraph));
    box.append(next);
  }
  return box;
}

export function renderBlocks(parent, sections, ctx) {
  const rows = [];
  sections.forEach((section, index) => rows.push(...renderBlock(parent, section, index, ctx)));
  return rows;
}
