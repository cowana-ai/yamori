import { layoutApi } from 'yamori:reading';
import { el } from './dom.js';

const posix = { dirname(file) { const index = file.lastIndexOf('/'); return index === -1 ? '.' : file.slice(0, index) || '.'; } };
const api = layoutApi(posix);

export function renderFiles(parent, ctx) {
  const { data, route, go, url } = ctx;
  const folder = route.folder || '';
  const steps = api.readingPathFor(data.graph, data.notes, folder);
  const page = el('div', 'start-page');
  const head = el('div', 'start-head');
  head.append(el('p', 'eyebrow', 'Library'));
  head.append(el('h1', '', folder ? folder + '/' : 'All files'));
  head.append(el('p', '', data.notes.overview));
  page.append(head);
  const body = el('div', 'start-body');
  const nav = el('nav', 'folders');
  nav.setAttribute('aria-label', 'Choose a folder');
  for (const item of data.graph.tree) {
    const button = el('button');
    button.type = 'button';
    if (item.key === folder) button.setAttribute('aria-current', 'true');
    button.style.paddingLeft = (8 + item.depth * 12) + 'px';
    button.append(el('span', '', item.label), el('span', 'count', String(item.count)));
    button.addEventListener('click', () => {
      const href = '/learn/' + route.course + '/files' + (item.key ? '?folder=' + encodeURIComponent(item.key) : '');
      go(href);
    });
    nav.append(button);
  }
  const column = el('div');
  column.append(el('h2', 'steps-title', folder ? 'In ' + folder + '/' : 'Whole project'));
  column.append(el('p', 'steps-hint', 'Numbered steps follow the guided path first, then the files it leads to. A check marks a file that already has pseudocode.'));
  const list = el('ol', 'steps');
  list.id = 'steps';
  steps.forEach((step, index) => {
    const note = data.notes.files[step.id];
    const item = el('li', 'step' + (data.course.steps.some(lesson => lesson.file === step.id) ? ' focus' : ''));
    item.append(el('span', 'step-badge', String(index + 1)));
    const text = el('div');
    const title = el('p', 'step-file');
    title.append(document.createTextNode(step.id.split('/').at(-1)));
    if (data.explanations[step.id]) title.append(document.createTextNode(' ✓'));
    if (step.id.includes('/')) title.append(el('span', 'path', '  ' + step.id.slice(0, step.id.lastIndexOf('/')) + '/'));
    text.append(title);
    if (note?.purpose) text.append(el('p', 'step-why', note.purpose));
    if (step.why) text.append(el('p', 'step-links', step.why));
    else if (step.via) text.append(el('p', 'step-links', 'Reached from ' + step.via + (step.names?.length ? ' via ' + step.names.join(', ') : '')));
    if (note?.terms?.length) {
      const chips = el('div', 'chips');
      for (const term of note.terms.slice(0, 6)) chips.append(el('span', 'chip', term.term));
      text.append(chips);
    }
    const actions = el('div', 'actions');
    const read = el('a', data.explanations[step.id] ? 'primary' : '', data.explanations[step.id] ? 'Read' : 'Open source');
    const href = '/learn/' + route.course + '/read/' + step.id;
    read.href = url(href);
    read.addEventListener('click', event => { event.preventDefault(); go(href); });
    const map = el('a', '', 'Show on map');
    const mapHref = '/learn/' + route.course + '/map?file=' + encodeURIComponent(step.id);
    map.href = url(mapHref);
    map.addEventListener('click', event => { event.preventDefault(); go(mapHref); });
    actions.append(read, map);
    text.append(actions);
    item.append(text);
    list.append(item);
  });
  column.append(list);
  body.append(nav, column);
  page.append(body);
  parent.append(page);
}
