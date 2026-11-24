'use strict';

const EDGE_CASE_MIN_LINES = 12;
const EDGE_CASE_LIMIT = 3;

const CARD_FORMAT = `FUNCTION AND METHOD CARDS (overrides conflicting grouping and formatting instructions):
- Use one section per function or method, titled with its actual symbol. Keep classes' methods separate. Use legacy explanatory sections for meaningful module-level code and selections without a complete routine.
- Use these exact lines in order inside each card's pseudocode string:
  PURPOSE: one short sentence
  INPUTS: parameters with key preconditions (or None)
  RETURNS: value, errors, or None
  STEPS:
  - first action or branch
      - nested action
  SIDE EFFECTS: external I/O, API or database calls, or shared state mutation (omit if none)
  EDGE CASES:
  ⚠ scenario -> behaviour worth checking
  ✓ scenario -> explicitly handled behaviour worth checking
- Start every step with "- " after its indentation. Nest branch consequences by four spaces. The reader numbers steps. Map each step and each edge case to its smallest relevant inclusive source range using lineMap. Map other lines as required by the surrounding request.
- Include at most ${EDGE_CASE_LIMIT} distinct, concrete edge cases or caveats, only when the function spans at least ${EDGE_CASE_MIN_LINES} source lines and there is something worth checking. Omit the entire EDGE CASES heading otherwise. Include material assumptions, ordering, numeric, state, and resource caveats when grounded in the source. Phrase each item as a scenario or condition -> behaviour worth checking, not a guarantee. When handling is not visible, qualify the expected behaviour and mark it ⚠.
- Keep important source comments beside their steps as # notes. Reserve new WHY:, SHAPES:, and FORMULA: annotations for the refinement pass. Preserve useful existing annotations when editing or refreshing a card.`;

const CARD_REFINEMENT = `For existing function cards, preserve the card format, step links and edge-case links. Decide independently for each step whether to add any of these optional indented lines immediately below it:
- WHY: only if a competent engineer would pause at the constant, scaling, numerical guard, or ordering. Prefix the rationale with "likely" when it is not explicit in source or comments.
- SHAPES: only for tensor/array-heavy code, showing the relevant before and after shapes with shared axes.
- FORMULA: only when compact inline LaTeX helps explain an actual mathematical operation.
Omit annotations on routine steps and never repeat facts already clear from the action. Recompute pseudocodeLine indices after adding or removing annotation lines.`;

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

module.exports = { CARD_FORMAT, CARD_REFINEMENT, EDGE_CASE_MIN_LINES, EDGE_CASE_LIMIT, parseCard };
