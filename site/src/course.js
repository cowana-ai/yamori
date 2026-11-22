import { el } from './dom.js';
import { installLinks } from './shell.js';
import { renderProgressBar, renderStudyGuide } from './lesson-panel.js';
import { isComplete } from './progress.js';

export function renderCourse(parent, ctx) {
  const { data, go, url, route } = ctx;
  const { course, meta, notes } = data;
  const first = course.steps[0];
  const firstHref = '/learn/' + route.course + '/read/' + first.file;
  const totalMinutes = course.steps.reduce((sum, step) => sum + (step.minutes || 0), 0);

  const page = el('article', 'course');
  page.append(el('p', 'eyebrow', course.platform?.name || 'Yamori Learn'));
  page.append(el('h1', '', course.title));
  page.append(el('p', 'lede', course.summary));
  if (course.platform?.audience) page.append(el('p', 'audience-line', 'For ' + course.platform.audience));
  renderProgressBar(page, course);
  if (totalMinutes) page.append(el('p', 'format-line', course.steps.length + ' lessons · ~' + totalMinutes + ' minutes total'));
  for (const paragraph of course.intro || []) page.append(el('p', '', paragraph));

  const begin = el('section', 'onboard-card');
  begin.append(el('h2', '', 'Start here'));
  begin.append(el('p', '', first.lesson || 'Open the first lesson. It starts in Logic.'));
  const open = el('a', 'primary', 'Lesson 1 · ' + first.title);
  open.href = url(firstHref);
  open.addEventListener('click', event => { event.preventDefault(); go(firstHref); });
  begin.append(open);
  page.append(begin);

  renderStudyGuide(page, course.platform);

  const learn = el('section', 'course-learn');
  learn.append(el('h2', '', 'What you\'ll walk away with'));
  const items = el('ul');
  for (const point of course.learn || []) items.append(el('li', '', point));
  learn.append(items);
  page.append(learn);

  page.append(el('h2', '', 'Syllabus'));
  const more = el('details', 'path-more');
  more.append(el('summary', '', 'Repo overview (one paragraph)'));
  more.append(el('p', 'steps-hint', notes.overview));
  page.append(more);

  const list = el('ol', 'steps');
  course.steps.forEach((step, index) => {
    const done = isComplete(course.id, step.file);
    const item = el('li', 'step' + (index === 0 ? ' focus' : '') + (done ? ' done' : ''));
    item.append(el('span', 'step-badge', done ? '✓' : index === 0 ? '★' : String(index + 1)));
    const body = el('div');
    const head = el('p', 'step-file');
    head.append(el('span', '', step.title));
    if (step.minutes) head.append(el('span', 'chip', step.minutes + ' min'));
    if (index === 0 && !done) head.append(el('span', 'chip', 'Start here'));
    body.append(head);
    if (step.primer) body.append(el('p', 'step-primer', step.primer));
    if (step.objectives?.[0]) body.append(el('p', 'step-objective', 'Goal: ' + step.objectives[0]));
    else if (step.lesson) body.append(el('p', 'step-why', step.lesson));
    const actions = el('div', 'actions');
    const read = el('a', 'primary', index === 0 && !done ? 'Open lesson' : 'Open');
    const href = '/learn/' + route.course + '/read/' + step.file;
    read.href = url(href);
    read.addEventListener('click', event => { event.preventDefault(); go(href); });
    const map = el('a', '', 'Map');
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
  cta.append(el('h2', '', 'Go beyond this course'));
  cta.append(el('p', '', 'Install Yamori in your editor to generate the same style of lessons for repositories you choose.'));
  installLinks(cta);
  page.append(cta);
  parent.append(page);
}