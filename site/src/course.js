import { el } from './dom.js';
import { installLinks } from './shell.js';

export function renderCourse(parent, ctx) {
  const { data, go, url, route } = ctx;
  const { course, meta, notes } = data;
  const page = el('article', 'course');
  page.append(el('p', 'eyebrow', course.kicker || 'Learning path'));
  page.append(el('h1', '', course.title));
  page.append(el('p', 'lede', course.summary));
  for (const paragraph of course.intro || []) page.append(el('p', '', paragraph));

  const learn = el('section', 'course-learn');
  learn.append(el('h2', '', 'What you will learn'));
  const items = el('ul');
  for (const point of course.learn || []) items.append(el('li', '', point));
  learn.append(items);
  page.append(learn);

  page.append(el('h2', '', 'Reading order'));
  page.append(el('p', 'steps-hint', notes.overview));
  const list = el('ol', 'steps');
  course.steps.forEach((step, index) => {
    const why = notes.readingPath.find(item => item.file === step.file)?.why;
    const note = notes.files[step.file];
    const item = el('li', 'step');
    item.append(el('span', 'step-badge', String(index + 1)));
    const body = el('div');
    const file = el('p', 'step-file');
    file.append(el('span', '', step.title), document.createTextNode(' · '), el('span', 'path', step.file));
    body.append(file);
    if (step.lesson) body.append(el('p', 'step-why', step.lesson));
    if (why) body.append(el('p', 'step-links', why));
    if (note?.purpose) body.append(el('p', 'step-links', note.purpose));
    const actions = el('div', 'actions');
    const read = el('a', 'primary', 'Read');
    const href = '/learn/' + route.course + '/read/' + step.file;
    read.href = url(href);
    read.addEventListener('click', event => { event.preventDefault(); go(href); });
    const map = el('a', '', 'Show on map');
    const mapHref = '/learn/' + route.course + '/map?file=' + encodeURIComponent(step.file);
    map.href = url(mapHref);
    map.addEventListener('click', event => { event.preventDefault(); go(mapHref); });
    actions.append(read, map);
    body.append(actions);
    item.append(body);
    list.append(item);
  });
  page.append(list);

  const credit = el('section', 'credit');
  credit.append(el('h2', '', 'Source and license'));
  const p = el('p');
  p.append(document.createTextNode(meta.attribution + ' '));
  const upstream = el('a', '', meta.upstream.replace('https://github.com/', ''));
  upstream.href = meta.treeUrl || meta.upstream;
  upstream.target = '_blank';
  upstream.rel = 'noopener';
  p.append(upstream, document.createTextNode(' at '));
  const commit = el('a', '', meta.commit.slice(0, 12));
  commit.href = meta.commitUrl;
  commit.target = '_blank';
  commit.rel = 'noopener';
  p.append(commit, document.createTextNode('. ' + meta.copyright + '. License: ' + meta.license + '.'));
  credit.append(p);
  const license = el('p', 'step-links');
  license.append(document.createTextNode('The MIT license is included in the snapshot at '));
  const lic = el('a', '', 'source/LICENSE');
  lic.href = url('/learn/' + route.course + '/read/LICENSE');
  lic.addEventListener('click', event => {
    event.preventDefault();
    go('/learn/' + route.course + '/read/LICENSE');
  });
  license.append(lic, document.createTextNode('. ' + meta.prepared));
  credit.append(license);
  page.append(credit);

  const cta = el('section', 'cta');
  cta.append(el('h2', '', 'Install Yamori'));
  cta.append(el('p', '', 'Open any other repository in VS Code or Cursor and read it the same way: pseudocode beside the source, a project map, and a trace of how a name moves.'));
  installLinks(cta);
  page.append(cta);
  parent.append(page);
}
