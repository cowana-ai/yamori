import { el } from './dom.js';
import { completedLessons, isComplete, progressCounts, setComplete } from './progress.js';

export function renderProgressBar(parent, course) {
  const { finished, total } = progressCounts(course);
  const wrap = el('div', 'learn-progress');
  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', String(total));
  wrap.setAttribute('aria-valuenow', String(finished));
  wrap.setAttribute('aria-label', 'Course progress');
  const track = el('div', 'learn-progress-track');
  const fill = el('div', 'learn-progress-fill');
  fill.style.width = total ? (100 * finished / total) + '%' : '0%';
  track.append(fill);
  wrap.append(track, el('span', 'learn-progress-label', finished + ' of ' + total + ' lessons marked done'));
  parent.append(wrap);
  return wrap;
}

export function renderStudyGuide(parent, platform) {
  if (!platform?.studyGuide?.length) return;
  const section = el('section', 'study-guide');
  section.append(el('h2', '', 'How this platform works'));
  const grid = el('div', 'study-guide-grid');
  platform.studyGuide.forEach((item, index) => {
    const card = el('article', 'study-card');
    card.append(el('span', 'study-num', String(index + 1)), el('h3', '', item.title), el('p', '', item.body));
    grid.append(card);
  });
  section.append(grid);
  if (platform.prerequisites?.length) {
    const pre = el('div', 'prereq');
    pre.append(el('h3', '', 'Before you start'));
    const ul = el('ul');
    for (const line of platform.prerequisites) ul.append(el('li', '', line));
    pre.append(ul);
    section.append(pre);
  }
  if (platform.format) section.append(el('p', 'format-line', platform.format));
  parent.append(section);
}

export function renderSyllabusNav(parent, ctx, currentFile) {
  const { course } = ctx.data;
  const { go, url, route } = ctx;
  const done = new Set(completedLessons(course.id));
  const nav = el('nav', 'syllabus');
  nav.setAttribute('aria-label', 'Course lessons');
  nav.append(el('h2', '', 'Lessons'));
  const list = el('ol', 'syllabus-list');
  course.steps.forEach((step, index) => {
    const item = el('li', 'syllabus-item' + (step.file === currentFile ? ' current' : '') + (done.has(step.file) ? ' done' : ''));
    const link = el('a', 'syllabus-link', '');
    link.href = url('/learn/' + route.course + '/read/' + step.file);
    link.addEventListener('click', event => {
      event.preventDefault();
      go('/learn/' + route.course + '/read/' + step.file);
    });
    const head = el('span', 'syllabus-head');
    head.append(el('span', 'syllabus-index', String(index + 1)), el('span', 'syllabus-title', step.title));
    if (step.minutes) head.append(el('span', 'syllabus-time', step.minutes + ' min'));
    link.append(head);
    item.append(link);
    list.append(item);
  });
  nav.append(list);
  parent.append(nav);
}

export function renderLessonRail(parent, ctx, file, onProgressChange) {
  const { course } = ctx.data;
  const step = course.steps.find(item => item.file === file);
  if (!step) return null;

  const rail = el('div', 'lesson-rail');
  rail.append(el('p', 'eyebrow', 'Lesson'));
  rail.append(el('h2', 'lesson-rail-title', step.title));
  if (step.minutes) rail.append(el('p', 'lesson-meta', '~' + step.minutes + ' min'));
  if (step.primer) rail.append(el('p', 'lesson-primer', step.primer));

  if (step.objectives?.length) {
    const block = el('div', 'lesson-block');
    block.append(el('h3', '', 'Goals'));
    const ul = el('ul');
    for (const line of step.objectives) ul.append(el('li', '', line));
    block.append(ul);
    rail.append(block);
  }

  renderSyllabusNav(rail, ctx, file);

  if (step.takeaway) {
    const block = el('div', 'lesson-block takeaway');
    block.append(el('h3', '', 'Takeaway'));
    block.append(el('p', '', step.takeaway));
    rail.append(block);
  }

  if (step.checks?.length) {
    const block = el('div', 'lesson-block checks');
    block.append(el('h3', '', 'Check yourself'));
    const ul = el('ul');
    for (const line of step.checks) ul.append(el('li', '', line));
    block.append(ul);
    rail.append(block);
  }

  const toggle = el('label', 'lesson-done');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = isComplete(course.id, file);
  box.addEventListener('change', () => {
    setComplete(course.id, file, box.checked);
    rail.querySelector('.syllabus-item.current')?.classList.toggle('done', box.checked);
    onProgressChange?.();
  });
  toggle.append(box, document.createTextNode(' Mark lesson complete'));
  rail.append(toggle);
  parent.append(rail);
  return rail;
}