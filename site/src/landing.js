import { el } from './dom.js';
import { installLinks } from './shell.js';

export function renderLanding(parent, ctx, catalog) {
  const page = el('article', 'landing');
  const hero = el('section', 'hero');
  const img = el('img', 'hero-mark');
  img.src = ctx.url('yamori.png');
  img.alt = 'Yamori, a teal gecko samurai';
  hero.append(img);
  hero.append(el('p', 'eyebrow', 'A learning platform'));
  hero.append(el('h1', '', 'Read famous code as pseudocode.'));
  hero.append(el('p', 'lede', 'Yamori puts short, numbered steps beside the source, and every step links back to the lines it stands for. This site is that reader, already filled in, so you can study a repository in the browser.'));
  page.append(hero);

  const path = el('section', 'path-card');
  path.append(el('p', 'eyebrow', 'Learning path'));
  const course = catalog?.courses?.[0];
  path.append(el('h2', '', course?.title || 'Transformers through nanoGPT'));
  path.append(el('p', '', course?.blurb || 'A GPT, end to end, read the way Yamori reads it.'));
  const list = el('ol', 'path-steps');
  const steps = ['model.py · the GPT', 'prepare.py · characters become ids', 'train.py · one training step', 'sample.py · text back out', 'train_shakespeare_char.py · the small run', 'configurator.py · how a config lands'];
  steps.forEach((label, index) => {
    const item = el('li');
    item.append(el('span', 'step-badge', String(index + 1)), el('span', '', label));
    list.append(item);
  });
  path.append(list);
  const open = el('a', 'primary', 'Open the path');
  open.href = ctx.url('/learn/nanogpt');
  open.addEventListener('click', event => { event.preventDefault(); ctx.go('/learn/nanogpt'); });
  path.append(open);
  page.append(path);

  const learn = el('section', 'learn-grid');
  learn.append(el('h2', '', 'What you read'));
  for (const [title, body] of [
    ['Side by side', 'Pseudocode on one side, the Python on the other. Hover a step to mark its lines. Click to jump.'],
    ['Two depths', 'Overview is the goal and the main stages. Logic is every meaningful step, with the formulas.'],
    ['The map', 'Files sit in folder boxes. Arrows follow imports. Numbered badges are the reading order.']
  ]) {
    const card = el('article');
    card.append(el('h3', '', title), el('p', '', body));
    learn.append(card);
  }
  page.append(learn);

  const cta = el('section', 'cta');
  cta.append(el('h2', '', 'Read the next repository in your editor'));
  cta.append(el('p', '', 'Yamori is a VS Code and Cursor extension. It explains the file you have open, maps the project, and traces a name across files. This site only hosts lessons that were prepared ahead of time.'));
  installLinks(cta);
  page.append(cta);

  const foot = el('footer', 'site-foot');
  foot.append(el('p', '', 'Lessons are static. Nothing on this site calls a model. nanoGPT is included under the MIT license; see the path page for the commit and the copyright.'));
  page.append(foot);
  parent.append(page);
}
