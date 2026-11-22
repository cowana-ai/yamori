import { LOGO } from 'yamori:reading';
import { el } from './dom.js';

const MARKET = 'https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori';
const GITHUB = 'https://github.com/cowana-ai/yamori';

export function shell(app, ctx, page) {
  const { route, url, go } = ctx;
  app.append(topbar(ctx));
  const main = el('main', 'shell-main');
  main.id = 'content';
  if (route.view === 'map' || route.view === 'read') main.classList.add('fill');
  page(main);
  app.append(main);

  function topbar() {
    const header = el('header');
    const row = el('div', 'top');
    const brand = el('a', 'brand');
    brand.href = url('/');
    brand.dataset.nav = '1';
    const img = el('img');
    img.src = LOGO;
    img.alt = '';
    const mark = el('span', 'wordmark', '');
    mark.append(el('span', '', 'yamori'), el('span', 'wordmark-learn', ' learn'));
    brand.append(img, mark);
    brand.addEventListener('click', event => { event.preventDefault(); go('/'); });
    row.append(brand);

    if (route.course && ctx.data) {
      const nav = el('nav', 'workspace-nav');
      nav.setAttribute('aria-label', 'Course sections');
      for (const [id, label, href] of [['path', 'Course', '/learn/' + route.course], ['files', 'Library', '/learn/' + route.course + '/files'], ['map', 'Map', '/learn/' + route.course + '/map']]) {
        const button = el('a', id === route.view ? 'current-view' : '', label);
        button.href = url(href);
        if (id === route.view) button.setAttribute('aria-current', 'page');
        button.addEventListener('click', event => { event.preventDefault(); go(href); });
        nav.append(button);
      }
      row.append(nav);
      if (route.view === 'map' || route.view === 'files') row.append(searchBox(ctx));
    }
    row.append(el('span', 'spacer'));
    const theme = el('button', '', ctx.palette === 'paper' ? 'Dark' : 'Light');
    theme.type = 'button';
    theme.id = 'colors';
    theme.title = 'Choose reading colors';
    theme.addEventListener('click', () => ctx.setPalette(ctx.palette === 'paper' ? 'slate' : 'paper'));
    const install = el('a', 'primary install', 'Install Yamori');
    install.href = MARKET;
    install.target = '_blank';
    install.rel = 'noopener';
    install.title = 'Yamori on the VS Code Marketplace';
    row.append(theme, install);
    header.append(row);
    if (route.course && ctx.data && route.view !== 'path') {
      const crumb = el('p', 'crumb-line');
      const courseLink = el('a', '', ctx.data.course.title);
      courseLink.href = url('/learn/' + route.course);
      courseLink.addEventListener('click', event => { event.preventDefault(); go('/learn/' + route.course); });
      crumb.append(courseLink);
      if (route.file) {
        crumb.append(document.createTextNode(' / '));
        crumb.append(el('strong', '', route.file));
      }
      header.append(crumb);
    }
    return header;
  }
}

function searchBox(ctx) {
  const form = el('form', 'search');
  form.setAttribute('role', 'search');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Search a name: variable, function, term…';
  input.setAttribute('aria-label', 'Search this repository');
  input.value = ctx.route.q || '';
  const button = el('button', '', 'Search');
  button.type = 'submit';
  form.append(input, button);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const q = input.value.trim();
    const view = ctx.route.view === 'files' ? 'files' : 'map';
    ctx.go('/learn/' + ctx.route.course + '/' + view + (q ? '?q=' + encodeURIComponent(q) : ''));
  });
  return form;
}

export function installLinks(parent) {
  const row = el('p', 'install-links');
  const market = el('a', 'primary', 'Install from the Marketplace');
  market.href = MARKET;
  market.target = '_blank';
  market.rel = 'noopener';
  const github = el('a', '', 'View on GitHub');
  github.href = GITHUB;
  github.target = '_blank';
  github.rel = 'noopener';
  row.append(market, github);
  parent.append(row);
}

export const links = { MARKET, GITHUB };
