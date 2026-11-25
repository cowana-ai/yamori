'use strict';

const EDGE_CASE_MIN_LINES = 12;
const EDGE_CASE_LIMIT = 3;
const CARD_ANNOTATIONS = ['note', 'why', 'shapes', 'formula'];

const CARD_FORMAT = `FUNCTION AND METHOD CARDS (override legacy grouping and lineMap rules):
- One section per function or method, titled with its symbol. For module-level code or incomplete selections use the legacy pseudocode + lineMap section.
- In card, p is one-line purpose, i inputs and preconditions, r result or error, x meaningful side effects (write a short ✓ None statement when this is grounded, or leave empty when unknown), s steps, c checks.
- Steps s contain objects such as {"a":18,"b":19,"d":0,"t":"Return null","n":[]}. a and b are the smallest inclusive original source range, both inside this section. Use a=b for one line. d is the nesting depth, starting at 0. t is the one-line action. n is an array of annotations with k (note, why, shapes, formula) and t (annotation text). Preserve source rationale and existing annotations. Only refinement adds new annotations.
- Checks c contain objects with a and b (the inclusive source range), k (handled or risk), q (scenario), and o (behavior or question). Include up to ${EDGE_CASE_LIMIT} grounded checks for functions spanning ${EDGE_CASE_MIN_LINES}+ lines. For shorter functions omit c when the schema omits it, or use [] when c is required.
- Only steps and checks carry source links. Return objects for s and c, with plain text in text fields. Do not emit pseudocode or lineMap for cards.`;

const CARD_REFINEMENT = `Keep function cards compact. Decide per step whether to append:
- WHY: for a surprising constant, scaling, guard or ordering. Prefix the explanation with "likely:" if inferred.
- SHAPES: for tensor or array-heavy code, naming before and after shapes.
- FORMULA: for math that benefits from short inline LaTeX.
Omit these on routine steps. Put them in the step's n array using the corresponding k and t fields.`;

function expandCardSection(section) {
  if (!section || !Object.hasOwn(section, 'card')) return section;
  const card = section.card;
  const short = section.endLine - section.startLine + 1 < EDGE_CASE_MIN_LINES;
  const checks = short && card?.c === undefined ? [] : card?.c;
  const field = text => typeof text === 'string' && !/[\r\n]/.test(text);
  const range = (start, end = start) => {
    const s = Number(start), e = Number(end);
    return Number.isSafeInteger(s) && Number.isSafeInteger(e) &&
      s >= section.startLine && e <= section.endLine && s <= e ? [s, e] : undefined;
  };
  const invalid = detail => new Error('The provider returned an invalid compact function card for ' +
    JSON.stringify(typeof section.title === 'string' ? section.title.slice(0, 120) : 'this block') + ': ' + detail + '.');
  if (!card || ![card.p, card.i, card.r, card.x].every(field) || !card.p.trim() ||
      !card.i.trim() || !card.r.trim() || !Array.isArray(card.s) || !card.s.length || !Array.isArray(checks)) throw invalid('expected purpose, inputs, returns, steps and the permitted checks');
  if (checks.length > EDGE_CASE_LIMIT || checks.length && short) throw invalid('too many checks for this source range');
  const lines = ['PURPOSE: ' + card.p.trim(), 'INPUTS: ' + card.i.trim(), 'RETURNS: ' + card.r.trim(), 'STEPS:'];
  const lineMap = [];
  const append = (text, link) => { lines.push(text); lineMap.push([lines.length, ...link]); };
  const nonempty = text => field(text) && !!text.trim();
  const linkedRange = row => Number.isSafeInteger(row?.a) && Number.isSafeInteger(row.b) ? range(row.a, row.b) : undefined;
  for (const [index, row] of card.s.entries()) {
    const label = 'step ' + (index + 1);
    if (typeof row !== 'string') {
      const link = linkedRange(row);
      if (!link) throw invalid(label + ' has a source range outside the block or in reverse order');
      if (!Number.isSafeInteger(row.d) || row.d < 0 || row.d > 64 || !nonempty(row.t) || !Array.isArray(row.n)) {
        throw invalid(label + ' needs a depth, action and annotations array');
      }
      const indent = '    '.repeat(row.d);
      append(indent + '- ' + row.t.trim(), link);
      for (const annotation of row.n) {
        if (!CARD_ANNOTATIONS.includes(annotation?.k) || !nonempty(annotation.t)) throw invalid(label + ' has an invalid annotation');
        lines.push(indent + '    ' + (annotation.k === 'note' ? '# ' : annotation.k.toUpperCase() + ': ') + annotation.t.trim());
      }
      continue;
    }
    const [first, ...annotations] = row.split(/\r?\n/);
    const match = /^(\d+)(?:-(\d+))? ( *)(\S.*)$/.exec(first);
    const link = match && range(match[1], match[2]);
    if (!link || annotations.some(value => !/^\s*(?:#|(?:WHY|SHAPES|FORMULA):)\s*\S/.test(value))) throw invalid(label + ' has an invalid source range or annotation');
    const [, , , indent, action] = match;
    append(indent + '- ' + action.trimEnd(), link);
    for (const annotation of annotations) lines.push(indent + '    ' + annotation.trim());
  }
  if (card.x.trim()) lines.push('SIDE EFFECTS: ' + card.x.trim());
  if (checks.length) lines.push('EDGE CASES:');
  for (const [index, row] of checks.entries()) {
    const label = 'check ' + (index + 1);
    if (typeof row !== 'string') {
      const link = linkedRange(row);
      if (!link) throw invalid(label + ' has a source range outside the block or in reverse order');
      if (!['handled', 'risk'].includes(row.k) || !nonempty(row.q) || !nonempty(row.o)) throw invalid(label + ' needs a kind, scenario and behavior');
      append((row.k === 'handled' ? '✓ ' : '⚠ ') + row.q.trim() + ' -> ' + row.o.trim(), link);
      continue;
    }
    const match = field(row) && /^([+!])(\d+)(?:-(\d+))? (\S.*?\s*->\s*\S.*)$/.exec(row);
    const link = match && range(match[2], match[3]);
    if (!link) throw invalid(label + ' has an invalid source range or scenario');
    append((match[1] === '+' ? '✓ ' : '⚠ ') + match[4].trimEnd(), link);
  }
  const { card: ignored, ...scope } = section;
  return { ...scope, pseudocode: lines.join('\n'), lineMap };
}

// Keep physical line indices intact so cards use the same links as older explanations.
function parseCard(pseudocode) {
  const lines = pseudocode.split(/\r?\n/);
  const purpose = /^PURPOSE: (\S.*)$/.exec(lines[0])?.[1]?.trim();
  if (!purpose || !/^INPUTS: \S/.test(lines[1]) || !/^RETURNS: \S/.test(lines[2]) || lines[3]?.trim() !== 'STEPS:') return undefined;
  let area = 'steps';
  let riskCount = 0;
  const counters = [];
  const rows = lines.map((text, index) => {
    if (index <= 3 || /^SIDE EFFECTS: \S/.test(text) || text.trim() === 'EDGE CASES:') {
      if (text.startsWith('SIDE EFFECTS:')) area = 'effects';
      if (text.trim() === 'EDGE CASES:') area = 'edges';
      return { text, kind: 'card-heading' };
    }
    const step = /^( *)(- )(.+)$/.exec(text);
    if (area === 'steps' && step) {
      const depth = Math.min(Math.floor(step[1].length / 4), counters.length);
      counters[depth] = (counters[depth] || 0) + 1;
      counters.length = depth + 1;
      return { text: step[1] + step[3], kind: 'card-step', number: counters.join('.') };
    }
    if (area === 'steps' && /^\s*(WHY|SHAPES|FORMULA): \S/.test(text)) return { text, kind: 'card-annotation' };
    const edge = /^\s*([✓⚠])\s+(.+?)\s*->\s*(\S.*)$/.exec(text);
    if (area === 'edges' && edge) {
      if (edge[1] === '⚠') riskCount++;
      return { text: edge[2] + ' → ' + edge[3], kind: edge[1] === '✓' ? 'card-handled' : 'card-risk', number: edge[1] };
    }
    return { text, kind: /^\s*#/.test(text) ? 'note' : '' };
  });
  return rows.some(row => row.kind === 'card-step') ? { purpose, riskCount, rows } : undefined;
}

module.exports = { CARD_FORMAT, CARD_REFINEMENT, EDGE_CASE_MIN_LINES, EDGE_CASE_LIMIT, CARD_ANNOTATIONS, parseCard, expandCardSection };
