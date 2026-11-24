'use strict';

const EDGE_CASE_MIN_LINES = 12;
const EDGE_CASE_LIMIT = 3;

const CARD_FORMAT = `FUNCTION AND METHOD CARDS (override legacy grouping and lineMap rules):
- One section per function or method, titled with its symbol. For module-level code or incomplete selections use the legacy pseudocode + lineMap section.
- In card, p is one-line purpose, i inputs and preconditions, r result or error, x meaningful side effects (empty if none), s steps, c checks.
- Step string: "18 Return null" or "18-19 Return null". Start with the smallest inclusive original source range, then a space, then the action. Add four more spaces for each branch depth. Put source rationale or existing annotations on newline(s) in that same string using #, WHY:, SHAPES:, or FORMULA:. Only refinement adds new annotations.
- Check string: "+18 scenario -> behaviour" if explicitly handled, or "!18-19 scenario -> behaviour" if risky. Prefix the source range with + or !. Up to ${EDGE_CASE_LIMIT} grounded checks for functions spanning ${EDGE_CASE_MIN_LINES}+ lines. Cover material assumptions, ordering, numerical, state or resource caveats. Use [] if none.
- Only steps and checks carry source links. Do not emit pseudocode or lineMap for cards.`;

const CARD_REFINEMENT = `Keep function cards compact. Decide per step whether to append:
- WHY: for a surprising constant, scaling, guard or ordering. Prefix with "likely" if inferred.
- SHAPES: for tensor or array-heavy code, naming before and after shapes.
- FORMULA: for math that benefits from short inline LaTeX.
Omit these on routine steps. Append them as newline(s) inside that step string; there is no separate line map.`;

function expandCardSection(section) {
  if (!section || !Object.hasOwn(section, 'card')) return section;
  const card = section.card;
  const field = text => typeof text === 'string' && !/[\r\n]/.test(text);
  const range = (start, end = start) => {
    const s = Number(start), e = Number(end);
    return Number.isSafeInteger(s) && Number.isSafeInteger(e) &&
      s >= section.startLine && e <= section.endLine && s <= e ? [s, e] : undefined;
  };
  const invalid = () => new Error('The provider returned an invalid compact function card. Try Refresh.');
  if (!card || ![card.p, card.i, card.r, card.x].every(field) || !card.p.trim() ||
      !card.i.trim() || !card.r.trim() || !Array.isArray(card.s) || !card.s.length || !Array.isArray(card.c)) throw invalid();
  if (card.c.length > EDGE_CASE_LIMIT || card.c.length && section.endLine - section.startLine + 1 < EDGE_CASE_MIN_LINES) throw invalid();
  const lines = ['PURPOSE: ' + card.p.trim(), 'INPUTS: ' + card.i.trim(), 'RETURNS: ' + card.r.trim(), 'STEPS:'];
  const lineMap = [];
  const append = (text, link) => { lines.push(text); lineMap.push([lines.length, ...link]); };
  for (const row of card.s) {
    if (typeof row !== 'string') throw invalid();
    const [first, ...annotations] = row.split(/\r?\n/);
    const match = /^(\d+)(?:-(\d+))? ( *)(\S.*)$/.exec(first);
    const link = match && range(match[1], match[2]);
    if (!link || annotations.some(value => !/^\s*(?:#|(?:WHY|SHAPES|FORMULA):)\s*\S/.test(value))) throw invalid();
    const [, , , indent, action] = match;
    append(indent + '- ' + action.trimEnd(), link);
    for (const annotation of annotations) lines.push(indent + '    ' + annotation.trim());
  }
  if (card.x.trim()) lines.push('SIDE EFFECTS: ' + card.x.trim());
  if (card.c.length) lines.push('EDGE CASES:');
  for (const row of card.c) {
    const match = field(row) && /^([+!])(\d+)(?:-(\d+))? (\S.*?\s*->\s*\S.*)$/.exec(row);
    const link = match && range(match[2], match[3]);
    if (!link) throw invalid();
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

module.exports = { CARD_FORMAT, CARD_REFINEMENT, EDGE_CASE_MIN_LINES, EDGE_CASE_LIMIT, parseCard, expandCardSection };
