import { edgePath, fitTransform, neighbourSet, layoutApi, searchProject } from 'yamori:reading';
import { el } from './dom.js';
import { renderBlocks } from './render.js';

const posix = { dirname(file) { const index = file.lastIndexOf('/'); return index === -1 ? '.' : file.slice(0, index) || '.'; } };
const api = layoutApi(posix);
const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderMap(parent, ctx) {
  const { data, route, go } = ctx;
  const page = el('section', 'map-page');
  page.id = 'map-view';
  const tools = el('div', 'tools');
  const zoomOut = tool('−', 'Zoom out');
  const zoomIn = tool('+', 'Zoom in');
  const fit = tool('Fit', 'Fit the map to the window');
  const reset = tool('Reset layout', 'Put folders back where Yamori placed them');
  const details = tool('Details', 'Show the selected file');
  details.id = 'drawer-toggle';
  const hint = el('span', 'hint', 'Drag a folder to move it · drag the background to pan · scroll to zoom · double-click a file to read it');
  tools.append(zoomOut, zoomIn, fit, reset, details, hint);
  const stage = el('div', 'stage');
  const canvas = svg('svg', { id: 'canvas', tabindex: '0', role: 'application', 'aria-label': 'Project map. Drag folders, drag the background to pan, scroll to zoom. Double-click a file to read it.' });
  const defs = svg('defs');
  const marker = svg('marker', { id: 'arrow', viewBox: '0 0 8 8', refX: '7', refY: '4', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
  marker.append(svg('path', { class: 'arrow', d: 'M0 0 L8 4 L0 8 z' }));
  defs.append(marker);
  const viewport = svg('g', { id: 'viewport' });
  const edges = svg('g');
  const boxes = svg('g');
  const nodes = svg('g');
  viewport.append(boxes, edges, nodes);
  canvas.append(defs, viewport);
  const hits = el('aside', 'search-panel');
  hits.hidden = true;
  const drawer = el('aside', 'drawer');
  drawer.hidden = true;
  stage.append(canvas, hits, drawer);
  page.append(tools, stage);
  parent.append(page);

  let suppressClick = false;
  const collapsed = new Set();
  let layout = fresh();
  let view = { x: 40, y: 40, k: 1 };
  let selected = route.file || '';
  let drag = null;

  function fresh() {
    return api.layoutGrouped(data.graph, { collapsed: [...collapsed], order: data.notes.readingPath.map(step => step.file) });
  }
  function apply() {
    viewport.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
  }
  function fitNow() {
    const rect = canvas.getBoundingClientRect();
    view = fitTransform(layout.boxes, rect.width || 800, rect.height || 480);
    apply();
  }
  function zoom(factor, px, py) {
    const next = Math.min(2.4, Math.max(0.25, view.k * factor));
    view.x = px - (px - view.x) * (next / view.k);
    view.y = py - (py - view.y) * (next / view.k);
    view.k = next;
    apply();
  }

  function draw() {
    boxes.replaceChildren();
    nodes.replaceChildren();
    edges.replaceChildren();
    const byId = new Map(layout.nodes.map(node => [node.id, node]));
    for (const box of layout.boxes) {
      const group = svg('g', { class: 'box' + (box.entry ? ' entry' : ''), transform: 'translate(' + box.x + ' ' + box.y + ')' });
      group.append(svg('rect', { class: 'frame', width: box.w, height: box.h }));
      const head = svg('g', { class: 'head', tabindex: '0', role: 'button', 'aria-label': 'Folder ' + box.label });
      head.append(svg('rect', { class: 'head-bar', width: box.w, height: 26 }));
      head.append(svg('text', { class: 'title', x: 10, y: 17 }, (collapsed.has(box.folder) ? '▸ ' : '▾ ') + box.label));
      head.append(svg('text', { class: 'count', x: box.w - 10, y: 17, 'text-anchor': 'end' }, box.count + (box.count === 1 ? ' file' : ' files')));
      head.addEventListener('pointerdown', event => startDrag(event, box.folder, head));
      head.addEventListener('click', event => {
        if (suppressClick) { suppressClick = false; return; }
        if (collapsed.has(box.folder)) collapsed.delete(box.folder); else collapsed.add(box.folder);
        layout = fresh();
        draw();
      });
      group.append(head);
      boxes.append(group);
    }
    const hot = selected ? neighbourSet(layout.edges, selected) : null;
    for (const edge of layout.edges) {
      const from = byId.get(edge.from), to = byId.get(edge.to);
      if (!from || !to) continue;
      const path = svg('path', { class: 'edge' + (edge.imported ? '' : ' inferred') + (hot && hot.has(edge.from) && hot.has(edge.to) ? ' hot' : ''), d: edgePath(from, to), 'marker-end': 'url(#arrow)' });
      path.append(svg('title', {}, edge.from + ' uses ' + edge.to + (edge.names?.length ? ' · ' + edge.names.join(', ') : '')));
      edges.append(path);
    }
    for (const item of layout.nodes) {
      if (item.kind !== 'file') continue;
      const classes = ['node'];
      if (item.entry) classes.push('entry');
      if (item.test) classes.push('test');
      if (item.id === selected) classes.push('selected');
      if (item.hit) classes.push('hit');
      if (hot && !hot.has(item.id)) classes.push('dim');
      if (item.dimmed) classes.push('dim');
      const group = svg('g', { class: classes.join(' '), transform: 'translate(' + item.x + ' ' + item.y + ')', tabindex: '0', role: 'button', 'data-id': item.id });
      if (item.entry) group.append(svg('rect', { class: 'shadow', x: 3, y: 3, width: item.w, height: item.h }));
      group.append(svg('rect', { class: 'shape', width: item.w, height: item.h }));
      group.append(svg('text', { class: 'label', x: item.step ? 30 : 10, y: item.h / 2 + 4 }, item.label));
      if (item.step) {
        const badge = svg('g', { class: 'badge', transform: 'translate(5 ' + (item.h / 2 - 9) + ')' });
        badge.append(svg('rect', { width: 18, height: 18 }), svg('text', { x: 9, y: 13, 'text-anchor': 'middle' }, String(item.step)));
        group.append(badge);
      }
      if (item.hitCount) {
        const label = String(item.hitCount);
        const width = 12 + label.length * 6;
        const tag = svg('g', { class: 'hit-count', transform: 'translate(' + (item.w - width / 2) + ' -8)' });
        tag.append(svg('rect', { width, height: 16 }), svg('text', { x: width / 2, y: 12, 'text-anchor': 'middle' }, label));
        group.append(tag);
      }
      const purpose = data.notes.files[item.id]?.purpose || '';
      group.append(svg('title', {}, item.id + (purpose ? ' — ' + purpose : '') + ' · double-click to read'));
      group.addEventListener('click', () => { selected = item.id; draw(); showDetails(item.id); });
      group.addEventListener('dblclick', () => go('/learn/' + route.course + '/read/' + item.id));
      group.addEventListener('keydown', event => { if (event.key === 'Enter') go('/learn/' + route.course + '/read/' + item.id); });
      nodes.append(group);
    }
    apply();
  }

  function startDrag(event, folder, head) {
    head.dataset.dragged = '';
    const origin = point(event);
    drag = { folder, head, x: origin.x, y: origin.y, moved: false, clientX: event.clientX, clientY: event.clientY };
    event.stopPropagation();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - view.x) / view.k, y: (event.clientY - rect.top - view.y) / view.k };
  }
  window.addEventListener('pointermove', event => {
    if (!page.isConnected) return;
    if (!drag) {
      if (pan) {
        view.x += event.clientX - pan.x;
        view.y += event.clientY - pan.y;
        pan = { x: event.clientX, y: event.clientY };
        apply();
      }
      return;
    }
    const now = point(event);
    const dx = now.x - drag.x, dy = now.y - drag.y;
    if (!drag.moved && Math.hypot(event.clientX - (drag.clientX ?? event.clientX), event.clientY - (drag.clientY ?? event.clientY)) < 4) return;
    drag.moved = true;
    drag.head.dataset.dragged = '1';
    drag.x = now.x;
    drag.y = now.y;
    for (const box of layout.boxes) if (box.folder === drag.folder) { box.x += dx; box.y += dy; }
    for (const node of layout.nodes) if (node.folder === drag.folder) { node.x += dx; node.y += dy; }
    draw();
  });
  window.addEventListener('pointerup', () => {
    if (!page.isConnected) return;
    if (drag?.moved) suppressClick = true;
    drag = null;
    pan = null;
    canvas.classList.remove('panning');
  });
  let pan = null;
  canvas.addEventListener('pointerdown', event => {
    if (event.target !== canvas && event.target.closest?.('.head, .node')) return;
    pan = { x: event.clientX, y: event.clientY };
    canvas.classList.add('panning');
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.1 : 0.9, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  zoomOut.addEventListener('click', () => zoom(0.9, canvas.clientWidth / 2, canvas.clientHeight / 2));
  zoomIn.addEventListener('click', () => zoom(1.1, canvas.clientWidth / 2, canvas.clientHeight / 2));
  fit.addEventListener('click', fitNow);
  reset.addEventListener('click', () => { collapsed.clear(); layout = fresh(); fitNow(); draw(); });
  details.addEventListener('click', () => { drawer.hidden = !drawer.hidden; details.setAttribute('aria-expanded', String(!drawer.hidden)); });
  window.addEventListener('resize', () => { if (page.isConnected) fitNow(); });

  function showDetails(file) {
    drawer.hidden = false;
    details.setAttribute('aria-expanded', 'true');
    drawer.replaceChildren();
    const head = el('div', 'drawer-head');
    head.append(el('span', 'eyebrow', 'Details'));
    const close = el('button', '', 'Close ×');
    close.type = 'button';
    close.addEventListener('click', () => { drawer.hidden = true; details.setAttribute('aria-expanded', 'false'); });
    head.append(close);
    drawer.append(head);
    const note = data.notes.files[file];
    const info = data.graph.files[file];
    drawer.append(el('h2', 'card-title', file.split('/').at(-1)));
    drawer.append(el('p', 'muted', file));
    if (note?.purpose) drawer.append(el('p', '', note.purpose));
    if (note?.role) drawer.append(el('p', 'chip', note.role));
    const read = el('a', 'primary', data.explanations[file] ? 'Read as pseudocode' : 'Open source');
    read.href = '#';
    read.addEventListener('click', event => { event.preventDefault(); go('/learn/' + route.course + '/read/' + file); });
    drawer.append(read);
    const uses = data.graph.edges.filter(edge => edge.from === file);
    const used = data.graph.edges.filter(edge => edge.to === file);
    drawer.append(el('h2', '', 'Uses'));
    if (!uses.length) drawer.append(el('p', 'muted', 'Nothing in this repository.'));
    for (const edge of uses) drawer.append(fileButton(edge.to, edge.names));
    drawer.append(el('h2', '', 'Used by'));
    if (!used.length) drawer.append(el('p', 'muted', 'No file in this map imports it.'));
    for (const edge of used) drawer.append(fileButton(edge.from, edge.names));
    if (info?.defs?.length) {
      drawer.append(el('h2', '', 'Definitions'));
      for (const def of info.defs.slice(0, 12)) {
        const row = el('button', 'row');
        row.type = 'button';
        row.append(el('strong', '', def.name), el('span', '', def.kind + ' · L' + def.line));
        row.addEventListener('click', () => go('/learn/' + route.course + '/read/' + file + '?line=' + def.line));
        drawer.append(row);
      }
    }
    if (note?.terms?.length) {
      drawer.append(el('h2', '', 'Terms'));
      for (const term of note.terms) drawer.append(el('p', '', term.term + ' — ' + term.meaning));
    }
  }
  function fileButton(file, names) {
    const button = el('button', 'row');
    button.type = 'button';
    button.append(el('strong', '', file), el('span', '', (data.notes.files[file]?.purpose || '') + (names?.length ? ' · ' + names.join(', ') : '')));
    button.addEventListener('click', () => { selected = file; draw(); showDetails(file); });
    return button;
  }

  async function runSearch(query) {
    hits.hidden = !query;
    if (!query) { layout.nodes.forEach(node => { delete node.hit; delete node.hitCount; delete node.dimmed; }); draw(); return; }
    const found = (await searchProject(data.graph, query, async rel => data.sources[rel] || ''))?.result;
    const counts = new Map((found?.hits || []).map(hit => [hit.file, hit.count]));
    for (const node of layout.nodes) {
      if (node.kind !== 'file') continue;
      node.hit = counts.has(node.id);
      node.hitCount = counts.get(node.id) || 0;
      node.dimmed = !node.hit;
    }
    draw();
    hits.replaceChildren();
    const head = el('div', 'search-head');
    head.append(el('h2', '', found ? found.query : query));
    const close = el('button', '', 'Clear');
    close.type = 'button';
    close.addEventListener('click', () => go('/learn/' + route.course + '/map'));
    head.append(close);
    hits.append(head);
    hits.append(el('p', 'muted', found ? found.total + ' mentions in ' + found.hits.length + (found.hits.length === 1 ? ' file' : ' files') : 'No matches.'));
    const flow = data.flows[query];
    if (flow) {
      const button = el('button', 'explain-flow', 'Show how it flows');
      button.type = 'button';
      button.addEventListener('click', () => showFlow(query, flow));
      hits.append(button);
      hits.append(el('p', '', flow.summary));
    } else hits.append(el('p', 'muted', 'Prepared traces on this path: block_size and logits. Search either name to read how it moves.'));
    for (const hit of found?.hits || []) {
      hits.append(el('p', 'folder-label', hit.file + (hit.defines ? ' · defines it' : '')));
      for (const match of hit.matches) {
        const row = el('button', 'match');
        row.type = 'button';
        row.append(el('span', '', String(match.line)), el('code', '', match.text));
        row.addEventListener('click', () => go('/learn/' + route.course + '/read/' + hit.file + '?line=' + match.line));
        hits.append(row);
      }
    }
    hits.classList.toggle('wide', !!flow);
  }
  function showFlow(query, flow) {
    const block = el('div', 'flow');
    block.append(el('p', 'eyebrow', 'How ' + query + ' flows'));
    block.append(el('p', '', flow.summary));
    const glossary = data.glossary;
    const ctxFlow = {
      glossary,
      terms: null,
      symbols: null,
      symbolTable: null,
      onOpen: (file, line) => go('/learn/' + route.course + '/read/' + file + (line ? '?line=' + line : ''))
    };
    const reading = el('div', 'flow-reading');
    flow.sections.forEach((section, index) => {
      const wrap = el('div');
      wrap.append(el('p', 'folder-label', section.file));
      renderBlocks(wrap, [section], {
        ...ctxFlow,
        onRange: (_start, _end, jump) => { if (jump) go('/learn/' + route.course + '/read/' + section.file + '?line=' + section.startLine); }
      });
      reading.append(wrap);
    });
    if (flow.caveats) reading.append(el('p', 'muted', flow.caveats));
    block.append(reading);
    hits.append(block);
    hits.classList.add('wide');
  }

  draw();
  requestAnimationFrame(fitNow);
  if (selected && data.graph.files[selected]) showDetails(selected);
  if (route.q) runSearch(route.q);
}

function tool(label, title) {
  const button = el('button', '', label);
  button.type = 'button';
  button.title = title;
  return button;
}
