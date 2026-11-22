import { glossaryMatcher } from 'yamori:reading';
import { el } from './dom.js';
import { renderBlocks } from './render.js';
import { renderLessonRail } from './lesson-panel.js';

export function renderReader(parent, ctx) {
  const { data, route, go, url } = ctx;
  const file = route.file;
  const source = data.sources[file];
  const saved = data.explanations[file];
  if (!source) {
    parent.append(missing(file, ctx));
    return;
  }
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  let pane = narrow ? 'pseudo' : 'split';
  let level = sessionLevel(file);
  let hot = new Set();
  let rows = [];

  const page = el('section', 'reader');
  const bar = el('div', 'reader-bar');
  bar.append(tour(file));
  if (saved && onCoursePath(data, file)) bar.append(coachCard());
  if (saved) {
    const group = el('div', 'segments');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Detail');
    for (const [id, label, title] of [['overview', 'Overview', 'Plain story: goals and big moves'], ['logic', 'Logic', 'Full detail: branches, data shapes, and math']]) {
      const button = el('button', '', label);
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-pressed', String(level === id));
      button.addEventListener('click', () => {
        level = id;
        sessionStorage.setItem('yamori-level:' + file, id);
        localStorage.setItem('yamori-default-level', id);
        paint();
      });
      group.append(button);
    }
    bar.append(group);
    const menu = fileMenu();
    bar.append(menu);
  }
  if (narrow) {
    const toggle = el('div', 'segments pane-toggle');
    for (const [id, label] of [['pseudo', 'Pseudocode'], ['source', 'Source']]) {
      const button = el('button', '', label);
      button.type = 'button';
      button.dataset.pane = id;
      button.addEventListener('click', () => { pane = id; paint(); });
      toggle.append(button);
    }
    bar.append(toggle);
  }
  const split = el('div', 'split');
  const pseudo = el('div', 'pseudo-pane');
  const code = el('div', 'source-pane');
  code.tabIndex = 0;
  code.setAttribute('aria-label', 'Source of ' + file);
  split.append(pseudo, code);
  const onPath = onCoursePath(data, file);
  const main = el('div', 'reader-main');
  main.append(bar, split);
  if (onPath) {
    const layout = el('div', 'reader-layout');
    renderLessonRail(layout, ctx, file);
    layout.append(main);
    page.append(layout);
  } else {
    page.append(bar, split);
  }
  parent.append(page);
  paint();
  if (route.line) reveal(route.line, true);

  function paint() {
    pseudo.replaceChildren();
    const view = saved?.[level];
    if (!view) {
      pseudo.append(el('h1', '', file.split('/').at(-1)));
      const note = data.notes.files[file];
      pseudo.append(el('p', 'summary', note?.purpose || 'This file is part of the repository map.'));
      pseudo.append(el('p', 'notice', file.endsWith('.ipynb')
        ? 'Notebooks are shown as Yamori\'s code view: source cells only, with the line numbers the map uses.'
        : 'This file is on the map. The guided path does not include a pseudocode reading for it.'));
    } else {
      pseudo.append(el('h1', '', view.title));
      pseudo.append(el('p', 'summary', view.summary));
      if (level === 'logic') {
        const outline = el('nav', 'logic-map');
        outline.setAttribute('aria-label', 'Sections in this file');
        const caption = el('div', 'map-caption');
        caption.append(el('h2', '', 'Jump to a section'), el('span', 'eyebrow', view.sections.length + ' parts'));
        outline.append(caption);
        const list = el('ol');
        view.sections.forEach((section, index) => {
          const item = el('li');
          const button = el('button', 'map-item');
          button.type = 'button';
          button.append(
            el('span', 'map-number', String(index + 1).padStart(2, '0')),
            el('span', 'map-title', section.title),
            el('span', 'map-range', 'L' + section.startLine + '–' + section.endLine),
            el('span', 'map-arrow', '→')
          );
          button.addEventListener('click', () => {
            pseudo.querySelectorAll('.reading-block')[index]?.scrollIntoView({ block: 'start' });
            show(section.startLine, section.endLine, true);
          });
          item.append(button);
          list.append(item);
        });
        outline.append(list);
        pseudo.append(outline);
      } else if (view.sections.length > 1) {
        pseudo.append(el('p', 'reading-hint', view.sections.length + ' short sections below — click any step to light up the code on the right.'));
      }
      const symbols = data.symbols[file] || [];
      rows = renderBlocks(pseudo, view.sections, {
        glossary: data.glossary,
        terms: glossaryMatcher(data.glossary),
        symbols: glossaryMatcher(symbols.map(item => ({ term: item.name }))),
        symbolTable: Object.fromEntries(symbols.map((item, index) => [index, item])),
        onOpen: (target, line) => { if (target) go('/learn/' + route.course + '/read/' + target + (line ? '?line=' + line : '')); },
        onRange: show,
        onClear: () => show(0, 0, false)
      });
      // glossaryMatcher indexes by insertion order, which is the array index. Rebuild the table to match.
      const matcher = glossaryMatcher(symbols.map(item => ({ term: item.name })));
      if (matcher) {
        const table = {};
        symbols.forEach((item, index) => { table[index] = item; });
        // The matcher stores the index from forEach on the array we passed, which matches `symbols`.
        rows.symbolTable = table;
      }
      if (level === 'logic') {
        const foot = el('footer');
        foot.append(el('span', '', 'Prepared in Yamori\'s format · ' + data.meta.title + ' ' + data.meta.commit.slice(0, 12) + ' · Verify against the source'));
        pseudo.append(foot);
      }
    }
    paintSource();
    page.dataset.pane = pane;
    bar.querySelectorAll('[data-pane]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pane === pane)));
    bar.querySelectorAll('.segments [aria-pressed]').forEach(button => {
      if (button.dataset.pane) return;
      button.setAttribute('aria-pressed', String(button.textContent.toLowerCase() === level));
    });
  }

  function paintSource() {
    code.replaceChildren();
    const head = el('div', 'source-head');
    head.append(el('span', 'eyebrow', 'Source'), el('strong', '', file));
    code.append(head);
    const body = el('div', 'source-code');
    source.split('\n').forEach((line, index) => {
      const number = index + 1;
      const row = el('div', 'source-line' + (hot.has(number) ? ' hot' : ''));
      row.dataset.line = String(number);
      row.append(el('span', 'source-gutter', String(number)));
      const text = el('code', /^\s*#/.test(line) ? 'comment' : '', line.length ? line : ' ');
      row.append(text);
      row.addEventListener('click', () => reveal(number, true));
      body.append(row);
    });
    code.append(body);
  }

  function show(start, end, jump) {
    if (!start) { hot = new Set(); mark(); return; }
    hot = new Set();
    for (let line = start; line <= end; line++) hot.add(line);
    mark();
    if (jump && narrow) { pane = 'source'; page.dataset.pane = pane; }
    if (jump) {
      const row = code.querySelector('[data-line="' + start + '"]');
      row?.scrollIntoView({ block: 'center' });
    }
  }
  function mark() {
    code.querySelectorAll('.source-line').forEach(row => row.classList.toggle('hot', hot.has(Number(row.dataset.line))));
    for (const { row, mapping } of rows) {
      const on = mapping && mapping.startLine <= Math.max(...hot, 0) && mapping.endLine >= Math.min(...hot, Infinity) && hot.size
        && [...hot].some(line => line >= mapping.startLine && line <= mapping.endLine);
      row.classList.toggle('hot', !!on);
    }
  }
  function reveal(line, jump) {
    const view = saved?.[level];
    if (!view) { show(line, line, jump); return; }
    let start = line, end = line;
    for (const section of view.sections) {
      for (const link of section.lineMap || []) {
        if (line >= link.startLine && line <= link.endLine) { start = link.startLine; end = link.endLine; }
      }
    }
    show(start, end, jump);
    const block = rows.find(item => item.mapping && line >= item.mapping.startLine && line <= item.mapping.endLine);
    if (jump && block) block.row.scrollIntoView({ block: 'center' });
  }

  function tour(current) {
    const steps = data.course.steps;
    const index = steps.findIndex(step => step.file === current);
    const nav = el('nav', 'tour');
    nav.setAttribute('aria-label', 'Reading tour');
    const row = el('div', 'tour-row');
    if (index >= 0) {
      const step = steps[index];
      row.append(el('span', 'tour-where', 'Lesson ' + (index + 1) + ' of ' + steps.length + ' · ' + step.title));
      if (index > 0) row.append(jump(steps[index - 1].file, '← ' + steps[index - 1].title, 'tour-prev'));
      if (index < steps.length - 1) row.append(jump(steps[index + 1].file, 'Next: ' + steps[index + 1].title + ' →', 'tour-next primary'));
      else row.append(el('span', 'tour-status', 'You finished the path'));
    } else row.append(el('span', 'tour-where', 'On the map · outside the guided path'));
    const guide = el('a', 'tour-guide', 'Course');
    guide.href = url('/learn/' + route.course);
    guide.addEventListener('click', event => { event.preventDefault(); go('/learn/' + route.course); });
    row.append(guide);
    nav.append(row);
    const lesson = steps[index];
    if (lesson?.lesson) nav.append(el('p', 'tour-why', lesson.lesson));
    return nav;
  }
  function jump(file, label, className) {
    const button = el('a', className, label);
    const href = '/learn/' + route.course + '/read/' + file;
    button.href = url(href);
    button.addEventListener('click', event => { event.preventDefault(); go(href); });
    return button;
  }
  function fileMenu() {
    const details = el('details', 'file-menu');
    const summary = el('summary', '', 'Switch file…');
    details.append(summary);
    const list = el('div', 'file-menu-list');
    const explained = Object.keys(data.explanations).sort();
    const rest = Object.keys(data.graph.files).filter(item => !data.explanations[item]).sort();
    for (const item of [...explained, ...rest]) {
      const button = el('button', item === file ? 'current' : '', (data.explanations[item] ? '✓ ' : '') + item);
      button.type = 'button';
      button.addEventListener('click', () => go('/learn/' + route.course + '/read/' + item));
      list.append(button);
    }
    details.append(list);
    return details;
  }
}

function sessionLevel(file) {
  const saved = sessionStorage.getItem('yamori-level:' + file);
  if (saved === 'overview' || saved === 'logic') return saved;
  const pref = localStorage.getItem('yamori-default-level');
  return pref === 'logic' ? 'logic' : 'overview';
}

function onCoursePath(data, file) {
  return data.course?.steps?.some(step => step.file === file);
}

function coachCard() {
  if (localStorage.getItem('yamori-coach-dismissed')) return el('span', 'coach-spacer');
  const card = el('div', 'coach-card');
  card.append(el('p', 'coach-title', 'Quick tip'));
  card.append(el('p', '', 'Overview is selected on purpose — read one numbered block at a time and click it to see the matching Python. Switch to Logic when you want every branch.'));
  const row = el('div', 'coach-actions');
  const dismiss = el('button', '', 'Got it');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => {
    localStorage.setItem('yamori-coach-dismissed', '1');
    card.replaceWith(el('span', 'coach-spacer'));
  });
  row.append(dismiss);
  card.append(row);
  return card;
}

function missing(file, ctx) {
  const box = el('article', 'course');
  box.append(el('h1', '', 'No file ' + file));
  box.append(el('p', '', 'That path is not in this snapshot.'));
  const back = el('a', 'primary', 'Back to the path');
  back.href = ctx.url('/learn/' + ctx.route.course);
  back.addEventListener('click', event => { event.preventDefault(); ctx.go('/learn/' + ctx.route.course); });
  box.append(back);
  return box;
}
