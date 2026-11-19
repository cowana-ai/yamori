'use strict';
// Deterministic checks of pseudocode against the source it explains. No AI, no
// network. An LLM wrote the pseudocode; these rules test it, so a reader (or an
// agent saving pseudocode) hears about invented names, dropped constants and
// hidden side effects before trusting it. Every finding names its cause.
//
//   name      a code-like name (snake_case, camelCase, `quoted`) that is not in
//             the source or the project: likely invented.
//   effect    the source writes files, calls a network, runs a process or
//             evaluates code, and the block never says so.
//   constant  a number in the block's source that the pseudocode never mentions.
//   uncovered code lines no block explains (Logic, whole files only).
//
// `name` and `effect` are warnings. `constant` and `uncovered` are notes: a
// good explanation may leave them out on purpose.

const KNOWN_PRODUCTS = new Set(['PyTorch', 'TensorFlow', 'NumPy', 'SciPy', 'OpenAI', 'GitHub', 'GitLab', 'JavaScript', 'TypeScript', 'VSCode', 'ChatGPT', 'LaTeX', 'McNemar', 'PyPI', 'GraphQL', 'MongoDB', 'PostgreSQL', 'FastAPI', 'ReLU', 'LeakyReLU', 'AdamW', 'DataFrame', 'ModuleList', 'NumPy', 'HuggingFace', 'OpenRouter', 'LoRA', 'QLoRA', 'BatchNorm', 'LayerNorm', 'DataLoader', 'NaN', 'cuDNN', 'cuBLAS', 'cuDF', 'nvJPEG', 'PyPI', 'JSONL', 'KeyError', 'ValueError', 'TypeError', 'IndexError', 'RuntimeError', 'StopIteration', 'NotImplementedError']);
// Standard exception names (AssertionError, FileNotFoundError, ...) are never invented.
const STANDARD_NAME = /(?:Error|Exception|Warning)$/;
const NUMBER_WORDS = { 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 12: 'twelve', 20: 'twenty' };
const IGNORED_NUMBERS = new Set([0, 1, 2, -1]);

// What a block's source does that a reader should hear about, and words that count as saying so.
const EFFECTS = [
  { label: 'writes or deletes files', code: /\b(?:open\([^)\n]*['"][wa]b?\+?['"]|\.write\(|writeFile(?:Sync)?|appendFile|unlink|rmtree|os\.remove|os\.rename|fs\.rm|shutil\.(?:copy|move)|\.to_csv|\.to_json\(|np\.save|torch\.save|pickle\.dump|\.save\()/, words: /\b(?:writ|sav|delet|remov|stor|append|copy|copies|mov|export|dump|persist|renam|creat|output|log)/i },
  { label: 'makes network requests', code: /\b(?:requests\.(?:get|post|put|delete|request)|httpx\.|urllib|urlopen|fetch\(|axios|http\.request|socket\.|aiohttp)/, words: /\b(?:send|request|fetch|call|download|post|api|network|http|upload|query|contact)/i },
  { label: 'runs another process', code: /\b(?:subprocess\.|os\.system|child_process|spawn\(|execFile|Popen)/, words: /\b(?:run|launch|execut|command|process|shell|spawn|start|invok|call)/i },
  { label: 'evaluates code', code: /(?<![\w.])(?:eval|exec)\(|\bnew Function\(/, words: /\b(?:eval|execut|run|dynamic)/i }
];

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const stripMath = text => text.replace(/\$\$[^$]+\$\$|\$[^$\n]+\$/g, ' ');
const isComment = line => /^\s*(?:#|\/\/|\/\*|\*\s|\*\/|--\s)/.test(line);
// Source lines that are code: no comments, and nothing inside triple-quoted docstrings.
function codeOnly(lines) {
  const out = []; let inside = false;
  for (const line of lines) {
    const marks = (line.match(/"""|'''/g) || []).length;
    if (inside) { if (marks % 2 === 1) inside = false; continue; }
    if (marks % 2 === 1) { inside = true; continue; }
    if (marks && /^\s*(?:[rbuf]*)(?:"""|''')/.test(line)) continue;
    out.push(line);
  }
  return out;
}
const isBoilerplate = line => /^\s*(?:import\s|from\s+\S+\s+import\s|(?:const|let|var)\s+\S+\s*=\s*require\(|['"]use strict['"]|#!|@\w|package\s|using\s|use\s)/.test(line) || /^[\s)\]}:;,]*$/.test(line);

function sourceNames(text) { return new Set(String(text).match(IDENTIFIER) || []); }
const flat = name => name.toLowerCase().replace(/_/g, '');
// KryptoNet for load_kryptonet is a recased paraphrase, not an invention.
const recased = (name, flatNames) => name.length >= 6 && flatNames.has(flat(name)) || (flat(name).length >= 6 && [...flatNames].some(item => item.includes(flat(name))));
// snake_case / CONSTANT_CASE (an inner underscore) or camelCase / PascalCase with two humps.
function codeLike(name) { return /[A-Za-z0-9]_[A-Za-z0-9]/.test(name) || /[a-z][A-Z]/.test(name); }

// Code-like names in a block's pseudocode that appear nowhere in the source or the project.
function unknownNames(pseudocode, source, known) {
  const found = new Set(), flatNames = new Set([...source, ...(known || [])].map(flat));
  for (const raw of String(pseudocode).split('\n')) {
    if (/^\s*#\s*Unresolved:/i.test(raw)) continue;
    const quoted = [...raw.matchAll(/`([^`\n]+)`/g)].flatMap(match => match[1].match(IDENTIFIER) || []).filter(name => name.length > 2);
    // Names after e.g. / such as / like are examples, not claims about the code.
    const line = stripMath(raw).split(/(?:\be\.g\.|\b(?:for example|for instance|such as|like)\b)/i)[0].replace(/`/g, ' ').replace(/\*\*/g, ' ');
    for (const name of [...(line.match(IDENTIFIER) || []), ...quoted]) {
      if (!quoted.includes(name) && !codeLike(name)) continue;
      if (/^_+$/.test(name) || KNOWN_PRODUCTS.has(name) || STANDARD_NAME.test(name) || source.has(name) || known?.has(name) || recased(name, flatNames)) continue;
      // A name with a leading or trailing underscore stands for its bare form.
      const bare = name.replace(/^_+|_+$/g, '');
      if (bare && bare !== name && (source.has(bare) || known?.has(bare))) continue;
      found.add(name);
    }
  }
  return [...found];
}

function numbersIn(text) {
  const clean = String(text).replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  // 0.001, .001 and 1e-3 are the same number.
  return new Set([...clean.matchAll(/(?<![\w.])-?(?:\d+\.\d+|\.\d+|\d+)(?:e-?\d+)?(?![\w])/gi)].map(match => Number(match[0])).filter(Number.isFinite));
}
// Numbers in source code (comments left out) that the pseudocode does not mention.
function missingConstants(codeLines, pseudocode) {
  const wanted = new Set();
  for (const line of codeOnly(codeLines)) if (!isComment(line)) for (const value of numbersIn(line.replace(/(['"]).*?\1/g, ' '))) if (!IGNORED_NUMBERS.has(value)) wanted.add(value);
  if (!wanted.size) return [];
  const has = numbersIn(pseudocode), lower = String(pseudocode).toLowerCase();
  return [...wanted].filter(value => {
    if (has.has(value) || has.has(value * 100) || has.has(-value)) return false;
    if (NUMBER_WORDS[value] && new RegExp('\\b' + NUMBER_WORDS[value] + '\\b').test(lower)) return false;
    if (value === 0.5 && /\bhalf\b/.test(lower)) return false;
    return true;
  });
}
// Numbers the pseudocode states (outside math) that appear nowhere in the source and cannot be derived from it.
function inventedNumbers(pseudocode, sourceText) {
  // Any number in the file counts, docstrings and comments included.
  const have = numbersIn(String(sourceText)), found = [];
  for (const raw of String(pseudocode).split('\n')) {
    // Notes (# Insight, # Context) carry worked examples; this check is for steps.
    if (/^\s*#/.test(raw)) continue;
    for (const value of numbersIn(stripMath(raw))) {
      if (IGNORED_NUMBERS.has(value) || value <= 10 && Number.isInteger(value) || have.has(value) || have.has(value / 100) || have.has(value * 100) || have.has(-value)) continue;
      // A product or ratio of two source numbers (160 = 0.8 x 200) is derived, not invented.
      if ([...have].some(a => a && (have.has(value / a) || have.has(value * a)))) continue;
      found.push(value);
    }
  }
  return [...new Set(found)];
}
function hiddenEffects(codeLines, pseudocode) {
  const code = codeOnly(codeLines).filter(line => !isComment(line)).join('\n');
  return EFFECTS.filter(effect => effect.code.test(code) && !effect.words.test(pseudocode)).map(effect => effect.label);
}

// source: { text, startLine } (startLine of the first line of text). sections: [{ title,
// startLine, endLine, pseudocode }]. known: names that exist elsewhere in the project.
// complete: the text is a whole file, so uncovered code is meaningful (Logic only).
function verifyPseudocode({ source, sections, known, level = 'logic', complete = false }) {
  const lines = String(source.text).split('\n'), first = source.startLine || 1, names = sourceNames(source.text), findings = [];
  const range = (start, end) => lines.slice(Math.max(0, start - first), Math.max(0, end - first + 1));
  sections.forEach((section, index) => {
    const body = section.pseudocode || '', code = range(section.startLine, section.endLine);
    const invented = unknownNames(body, names, known);
    if (invented.length) findings.push({ kind: 'name', severity: 'warn', section: index, names: invented, text: invented.map(name => '`' + name + '`').join(', ') + (invented.length === 1 ? ' is' : ' are') + ' not in the source or the project.' });
    const stray = inventedNumbers(body, source.text);
    if (stray.length) findings.push({ kind: 'number', severity: 'warn', section: index, text: 'States numbers that are not in the source: ' + stray.slice(0, 5).join(', ') + '. Derived or invented? Check them.' });
    for (const label of hiddenEffects(code, body)) findings.push({ kind: 'effect', severity: 'warn', section: index, text: 'The source ' + label + ', but this block does not say so.' });
    if (level === 'logic') {
      const missing = missingConstants(code, body);
      if (missing.length) findings.push({ kind: 'constant', severity: 'note', section: index, text: 'Numbers in the source that this block never mentions: ' + missing.slice(0, 6).join(', ') + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more' : '') + '.' });
    }
  });
  if (complete && level === 'logic') {
    const covered = new Set();
    for (const section of sections) for (let line = section.startLine; line <= section.endLine; line++) covered.add(line);
    // Docstring lines are not code.
    const codeSet = new Set(); { let inside = false; lines.forEach((line, i) => { const marks = (line.match(/"""|'''/g) || []).length; if (inside) { if (marks % 2 === 1) inside = false; return; } if (marks % 2 === 1) { inside = true; return; } if (marks && /^\s*[rbuf]*(?:"""|''')/.test(line)) return; codeSet.add(i); }); }
    const runs = []; let run;
    lines.forEach((text, i) => {
      const line = first + i;
      if (!text.trim() || isComment(text) || isBoilerplate(text) || !codeSet.has(i)) return;
      if (covered.has(line)) { run = undefined; return; }
      // Uncovered code lines separated only by blank or comment lines form one run.
      if (run && line - run.end <= 4) { run.end = line; run.count++; } else { run = { start: line, end: line, count: 1 }; runs.push(run); }
    });
    const big = runs.filter(item => item.count >= 6).slice(0, 3);
    if (big.length) findings.push({ kind: 'uncovered', severity: 'note', section: -1, text: 'No block explains ' + big.map(item => 'L' + item.start + '–' + item.end + ' (' + item.count + ' lines)').join(', ') + '.' });
  }
  return { findings, warnings: findings.filter(item => item.severity === 'warn').length, notes: findings.filter(item => item.severity === 'note').length };
}

module.exports = { verifyPseudocode, inventedNumbers, unknownNames, missingConstants, hiddenEffects, sourceNames, codeLike };
