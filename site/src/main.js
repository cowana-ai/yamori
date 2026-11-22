import { BASE_STYLES, READING_STYLES } from 'yamori:reading';
import './styles.css';
import { shell } from './shell.js';
import { renderLanding } from './landing.js';
import { renderCourse } from './course.js';
import { renderFiles } from './files.js';
import { renderMap } from './map.js';
import { renderReader } from './reader.js';
import { el } from './dom.js';

const theme = document.createElement('style');
theme.textContent = BASE_STYLES + READING_STYLES;
document.head.prepend(theme);

const base = import.meta.env.BASE_URL;
let palette = localStorage.getItem('yamori-palette') === 'paper' ? 'paper' : 'slate';
let courses;
let catalog;

function url(href) {
  return base + String(href).replace(/^\//, '');
}
function go(href) {
  const next = new URL(url(href), location.origin);
  if (next.pathname + next.search !== location.pathname + location.search) history.pushState({}, '', next.pathname + next.search);
  render();
}
function route() {
  let path = location.pathname;
  const prefix = base.replace(/\/$/, '');
  if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
  if (!path.startsWith('/')) path = '/' + path;
  const params = new URLSearchParams(location.search);
  const match = path.match(/^\/learn\/([^/]+)(?:\/(files|map|read)(?:\/(.*))?)?\/?$/);
  if (!match) return { view: 'home' };
  const view = match[2] || 'path';
  const file = view === 'read' && match[3] ? decodeURIComponent(match[3]) : (params.get('file') || '');
  return { course: match[1], view, file, line: Number(params.get('line')) || 0, folder: params.get('folder') || '', q: params.get('q') || '' };
}

function applyPalette() {
  document.body.dataset.palette = palette;
  document.body.classList.toggle('locked', ['map', 'read'].includes(route().view));
}

async function ensureKatex() {
  if (window.katex) return;
  await new Promise(resolve => {
    const script = document.createElement('script');
    script.src = url('katex.min.js');
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.append(script);
  });
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  applyPalette();
  const current = route();
  document.title = current.view === 'home' ? 'Yamori Learn' : 'Yamori · ' + (current.file || current.view);
  const app = document.getElementById('app');
  app.replaceChildren();
  const ctx = {
    route: current, go, url, palette,
    setPalette(next) { palette = next; localStorage.setItem('yamori-palette', next); render(); }
  };
  if (current.view === 'home') {
    if (!catalog) {
      try { catalog = await (await fetch(url('content/catalog.json'))).json(); }
      catch { catalog = { courses: [] }; }
    }
    if (token !== renderToken) return;
    shell(app, ctx, main => renderLanding(main, ctx, catalog));
    return;
  }
  if (!courses) {
    app.append(el('p', 'loading', 'Opening the lesson…'));
    await ensureKatex();
    ({ courses } = await import('yamori:courses'));
    if (token !== renderToken) return;
    app.replaceChildren();
  } else await ensureKatex();
  const data = courses[current.course];
  if (!data) {
    shell(app, ctx, main => {
      main.append(el('h1', '', 'No lesson named ' + current.course));
      const back = el('a', 'primary', 'Back home');
      back.href = url('/');
      back.addEventListener('click', event => { event.preventDefault(); go('/'); });
      main.append(back);
    });
    return;
  }
  ctx.data = data;
  const pages = { path: renderCourse, files: renderFiles, map: renderMap, read: renderReader };
  shell(app, ctx, main => (pages[current.view] || renderCourse)(main, ctx));
}

window.addEventListener('popstate', () => render());
document.addEventListener('keydown', event => {
  if (event.target.closest?.('input, textarea')) return;
  const current = route();
  if (current.view !== 'read' || !courses?.[current.course]) return;
  const steps = courses[current.course].course.steps;
  const index = steps.findIndex(step => step.file === current.file);
  if (event.key === 'ArrowRight' && index >= 0 && index < steps.length - 1) go('/learn/' + current.course + '/read/' + steps[index + 1].file);
  if (event.key === 'ArrowLeft' && index > 0) go('/learn/' + current.course + '/read/' + steps[index - 1].file);
});

render();
