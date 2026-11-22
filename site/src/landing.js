import { el } from './dom.js';
import { installLinks } from './shell.js';

export function renderLanding(parent, ctx, catalog) {
  const page = el('article', 'landing');
  const course = catalog?.courses?.[0];
  const startHref = '/learn/nanogpt/read/data/shakespeare_char/prepare.py';

  const hero = el('section', 'hero');
  const img = el('img', 'hero-mark');
  img.src = ctx.url('yamori.png');
  img.alt = 'Yamori, a teal gecko samurai';
  hero.append(img);
  hero.append(el('p', 'eyebrow', catalog?.platform?.name || 'Yamori Learn'));
  hero.append(el('h1', '', 'Understand GPTs without running a training job.'));
  if (catalog?.platform?.tagline) hero.append(el('p', 'platform-tagline', catalog.platform.tagline));
  hero.append(el('p', 'lede', 'Each course has lessons, goals, and check-yourself prompts — all generated beside the real source. Click a step and the matching lines light up.'));
  const start = el('a', 'primary hero-cta', 'Start lesson 1 — text to numbers');
  start.href = ctx.url(startHref);
  start.addEventListener('click', event => { event.preventDefault(); ctx.go(startHref); });
  hero.append(start);
  page.append(hero);

  const path = el('section', 'path-card');
  path.append(el('p', 'eyebrow', 'Featured path'));
  path.append(el('h2', '', course?.title || 'Transformers through nanoGPT'));
  path.append(el('p', '', course?.blurb || 'Six files from Karpathy\'s nanoGPT, ordered so the story builds slowly.'));
  const list = el('ol', 'path-steps');
  const steps = [
    'Tiny Shakespeare → training files',
    'The GPT module',
    'One training step',
    'Sampling text',
    'The small config',
    'How configs attach'
  ];
  steps.forEach((label, index) => {
    const item = el('li');
    item.append(el('span', 'step-badge', String(index + 1)), el('span', '', label));
    list.append(item);
  });
  path.append(list);
  const open = el('a', '', 'See the full path overview');
  open.href = ctx.url('/learn/nanogpt');
  open.addEventListener('click', event => { event.preventDefault(); ctx.go('/learn/nanogpt'); });
  path.append(open);
  page.append(path);

  const learn = el('section', 'learn-grid beginner-tips');
  learn.append(el('h2', '', 'How to read a lesson'));
  for (const [title, body] of [
    ['Opens in Logic', 'The full step-by-step reading. Each step points at a short span of the real file.'],
    ['Click any step', 'The pseudocode highlights what matters; the Python on the right shows exactly where it lives.'],
    ['Overview is the short pass', 'Fewer blocks, same file. Switch to it when you want the shape without every branch.']
  ]) {
    const card = el('article');
    card.append(el('h3', '', title), el('p', '', body));
    learn.append(card);
  }
  page.append(learn);

  const cta = el('section', 'cta');
  cta.append(el('h2', '', 'Want this inside your editor?'));
  cta.append(el('p', '', 'Yamori is a VS Code / Cursor extension that generates the same style of reading for repos you open yourself. This site only hosts lessons prepared ahead of time.'));
  installLinks(cta);
  page.append(cta);

  const foot = el('footer', 'site-foot');
  foot.append(el('p', '', 'Lessons are static snapshots — no API calls, no model runs. nanoGPT is MIT-licensed; credits live on the path page.'));
  page.append(foot);
  parent.append(page);
}