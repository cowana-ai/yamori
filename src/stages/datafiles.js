'use strict';
// Which files a piece of code reads and writes (documents, tables, PDFs, data
// dumps), read from the code with no AI. Each access becomes a path pattern:
// literal parts are kept and variables become {name}, so
//   open(base / f"{month}/brief.md")  →  read  {base}/{month}/brief.md  (md)
// Works on Python and JS/TS text. It is a hint, not a proof: a path built far
// away (config, CLI flags) shows as {name}.

// --- a tiny scanner: strings, names, brackets ---
const STRING = /([rRbBuUfF]{0,2})("""|'''|"|'|`)((?:\\[\s\S]|(?!\2)[\s\S])*?)\2/y;
const NAME = /[A-Za-z_$][\w$]*/y;
function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#' && !/[\w$]/.test(text[i - 1] || '')) { while (i < text.length && text[i] !== '\n') i++; continue; }
    STRING.lastIndex = i;
    const string = STRING.exec(text);
    if (string) { out.push({ t: 'str', f: /f/i.test(string[1]) || string[2] === '`', v: string[3], s: i }); i = STRING.lastIndex; continue; }
    NAME.lastIndex = i;
    const name = NAME.exec(text);
    if (name) { out.push({ t: 'name', v: name[0], s: i }); i = NAME.lastIndex; continue; }
    out.push({ t: 'op', v: c, s: i }); i++;
  }
  return out;
}
// The arguments of the call whose "(" is at tokens[open]: [{ name?, tokens }], and the index after ")".
function callArgs(list, open) {
  const args = [];
  let depth = 0, current = [], i = open + 1;
  for (; i < list.length; i++) {
    const token = list[i];
    if (token.t === 'op' && '([{'.includes(token.v)) depth++;
    if (token.t === 'op' && ')]}'.includes(token.v)) { if (depth === 0) break; depth--; }
    if (depth === 0 && token.t === 'op' && token.v === ',') { args.push(current); current = []; continue; }
    current.push(token);
  }
  if (current.length) args.push(current);
  return { args: args.map(arg => arg.length > 2 && arg[0].t === 'name' && arg[1].v === '=' && arg[2]?.v !== '=' ? { name: arg[0].v, tokens: arg.slice(2) } : { tokens: arg }), end: i };
}

// --- path patterns ---
// Names that build paths but are not part of them.
const PLUMBING = new Set(['Path', 'PurePath', 'os', 'path', 'join', 'str', 'self', 'this', 'pathlib', 'resolve', 'absolute', 'expanduser', 'fspath', 'f', 'format', 'cwd', 'abspath', 'normpath', 'Paths', 'path_join', 'require', 'process', 'const', 'let', 'var', 'await', 'new', 'encoding', 'utf', 'utf8']);
// Words that never name a path on their own, and language keywords.
const STANDALONE_NOISE = new Set(['self', 'this', 'str', 'encoding', 'utf', 'utf8', 'None', 'null', 'undefined', 'True', 'False', 'true', 'false']);
const KEYWORDS = new Set(['assert', 'in', 'for', 'return', 'await', 'yield', 'if', 'else', 'elif', 'with', 'as', 'not', 'and', 'or', 'async', 'def', 'lambda', 'from', 'import', 'of', 'new', 'const', 'let', 'var', 'is', 'while', 'print']);
const lastName = text => (String(text).match(/[A-Za-z_$][\w$]*/g) || []).filter(name => !PLUMBING.has(name)).pop() || 'value';
const fString = (text, assigned) => text.replace(/\$?\{([^{}]*)\}/g, (_, inner) => { const name = lastName(inner), value = /^[A-Z][A-Z0-9_]*$/.test(inner.trim()) && assigned?.get(inner.trim()); return value?.length === 1 && value[0].t === 'str' && !value[0].f ? value[0].v : '{' + name + '}'; });
// A conditional (a if c else b, c ? a : b) or a boolean picks between values:
// the path is the first choice.
// Calls that only pass a value through.
const BUILTINS = new Set(['next', 'iter', 'sorted', 'list', 'tuple', 'set', 'len', 'any', 'all', 'enumerate', 'zip', 'map', 'filter', 'reversed', 'print', 'repr', 'int', 'float', 'dict', 'String', 'Array', 'Object', 'JSON']);
const PATH_BUILDER = /path|dir|root|folder|join|Path|with_suffix|with_name|with_stem|resolve/i;
const closing = (list, open) => { let depth = 0; for (let i = open; i < list.length; i++) { if (list[i].v === '(') depth++; else if (list[i].v === ')' && --depth === 0) return i; } return list.length - 1; };
const branch = token => (token.t === 'name' && ['if', 'else', 'and', 'or', 'for'].includes(token.v)) || (token.t === 'op' && token.v === '?');
const resolvable = value => value && !value.some(branch) && value.some(token => token.t === 'str' || token.v === '/' || token.t === 'name');
function patternOf(list, assigned, depth = 0) {
  if (!list?.length) return undefined;
  const cut = list.findIndex(branch);
  if (cut === 0) return undefined;
  if (cut > 0) list = list.slice(0, cut);
  // A bare name: what it was set to in the same function, if known.
  const plain = list.filter(token => !(token.t === 'op' && '()'.includes(token.v)));
  if (plain.length === 1 && plain[0].t === 'name' && resolvable(assigned.get(plain[0].v)) && depth < 3) { const known = patternOf(assigned.get(plain[0].v), assigned, depth + 1); if (known) return known; }
  const pieces = [];
  for (let i = 0; i < list.length; i++) {
    const token = list[i], next = list[i + 1], before = list[i - 1];
    if (token.t === 'str') {
      const text = token.f ? fString(token.v, assigned) : token.v;
      // Words and messages are not path parts.
      if (/\s/.test(text) || /^[^/]*:/.test(text) && !/^[A-Za-z]:[\\/]/.test(text) || text.length > 100) continue;
      // ".md" from with_suffix(".md") or + ".md" belongs to the last piece.
      if (/^\.[\w]{1,6}$/.test(text) && FORMATS.test(text) && pieces.length) pieces[pieces.length - 1] += text;
      else if (text) pieces.push(text);
      continue;
    }
    if (token.t !== 'name' || KEYWORDS.has(token.v)) continue;
    // A call that builds a path (Path(), os.path.join(), series_path()) shows its
    // parts; any other call (build_filename(), res.get()) is one value.
    if (next?.v === '(' && !PATH_BUILDER.test(token.v) && !PLUMBING.has(token.v)) {
      const close = closing(list, i + 1);
      if (before?.v !== '.' && !BUILTINS.has(token.v)) pieces.push('{' + token.v.replace(/^(build|get|make|create|compute|format|load|read)_/, '') + '}');
      i = close; continue;
    }
    if (next?.v === '(' || next?.v === '.') continue; // a call or the start of a.b
    if (STANDALONE_NOISE.has(token.v)) continue;
    if (before?.v === '.' && /^(parent|name|stem|suffix|parents)$/.test(token.v)) continue;
    // A name set earlier in the function stands for its own pattern.
    const known = resolvable(assigned.get(token.v)) && depth < 3 ? patternOf(assigned.get(token.v), assigned, depth + 1) : undefined;
    pieces.push(known || '{' + token.v + '}');
  }
  if (!pieces.length) return undefined;
  const joined = pieces.join('/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/\.(\w{1,6})$/, '.$1');
  return /^[a-z]+:\/\//i.test(joined) ? undefined : joined.slice(0, 160);
}
// name = expr (Python), const/let/var name = expr (JS), within the code given.
function assignments(list) {
  const found = new Map();
  for (let i = 0; i + 2 < list.length; i++) {
    if (list[i].t !== 'name' || list[i + 1].v !== '=' || list[i + 2].v === '=' || ['==', '!', '<', '>'].includes(list[i - 1]?.v)) continue;
    if (list[i - 1]?.v === '.' || list[i - 1]?.v === '=') continue;
    const value = [];
    let depth = 0;
    for (let j = i + 2; j < list.length; j++) {
      const token = list[j];
      // The statement ends at the next line's start (no open bracket) or ";".
      if (depth === 0 && value.length && (token.v === ';' || lineBreakBetween(list[j - 1], token))) break;
      if (token.t === 'op' && '([{'.includes(token.v)) depth++;
      if (token.t === 'op' && ')]}'.includes(token.v)) { if (depth === 0) break; depth--; }
      value.push(token);
    }
    // x: Path = ... names x, not the type.
    const target = list[i - 1]?.v === ':' && list[i - 2]?.t === 'name' ? list[i - 2].v : list[i].v;
    // x = x / "sub" refines x: keep the earlier value, never a loop.
    if (value.length && !value.some(token => token.t === 'name' && token.v === target)) found.set(target, value);
  }
  return found;
}
let SOURCE = '';
// A line break ends a statement unless the line ends in an operator or an open
// bracket (comments do not count).
const lineBreakBetween = (a, b) => {
  if (!a || !b) return false;
  const gap = SOURCE.slice(a.s, b.s);
  if (!gap.includes('\n')) return false;
  const rest = gap.split('\n')[0].replace(/\s(#|\/\/).*$/, '');
  return !/[\\(\[{,+/]\s*$/.test(rest);
};

// --- what counts as reading or writing a file ---
const FORMATS = /\.(md|markdown|mdx|csv|tsv|pdf|jsonl|ndjson|json|ya?ml|txt|parquet|xlsx|xls|docx|doc|pptx|pkl|pickle|npy|npz|pt|pth|ckpt|safetensors|h5|html?|xml|toml|ini|log|png|jpe?g|webp|gif|wav|mp3|mp4|sqlite|db)(?=$|[^\w])/i;
const formatOf = (pattern, fallback) => { const ext = (String(pattern).match(FORMATS) || [])[1]?.toLowerCase(); return ({ markdown: 'md', mdx: 'md', yml: 'yaml', htm: 'html', jpeg: 'jpg', pickle: 'pkl', ndjson: 'jsonl', xls: 'xlsx' })[ext] || ext || fallback || 'file'; };
// name → [mode, path argument index, format when the path has no extension]
const CALLS = {
  read_csv: ['read', 0, 'csv'], read_table: ['read', 0, 'csv'], read_json: ['read', 0, 'json'], read_parquet: ['read', 0, 'parquet'], read_excel: ['read', 0, 'xlsx'], read_pickle: ['read', 0, 'pkl'], read_feather: ['read', 0, 'feather'],
  to_csv: ['write', 0, 'csv'], to_json: ['write', 0, 'json'], to_parquet: ['write', 0, 'parquet'], to_excel: ['write', 0, 'xlsx'], to_pickle: ['write', 0, 'pkl'], to_feather: ['write', 0, 'feather'], to_markdown: ['write', 0, 'md'],
  PdfReader: ['read', 0, 'pdf'], PdfFileReader: ['read', 0, 'pdf'], PyPDFLoader: ['read', 0, 'pdf'], PyMuPDFLoader: ['read', 0, 'pdf'], PDFPlumberLoader: ['read', 0, 'pdf'], convert_from_path: ['read', 0, 'pdf'],
  TextLoader: ['read', 0, 'txt'], CSVLoader: ['read', 0, 'csv'], UnstructuredMarkdownLoader: ['read', 0, 'md'], UnstructuredPDFLoader: ['read', 0, 'pdf'], Docx2txtLoader: ['read', 0, 'docx'], JSONLoader: ['read', 0, 'json'], DirectoryLoader: ['read', 0, 'folder'], SimpleDirectoryReader: ['read', 0, 'folder'],
  load_workbook: ['read', 0, 'xlsx'], load_dataset: ['read', 0, 'dataset'],
  readFileSync: ['read', 0], readFile: ['read', 0], createReadStream: ['read', 0], readJson: ['read', 0, 'json'], readJsonSync: ['read', 0, 'json'],
  writeFileSync: ['write', 0], writeFile: ['write', 0], appendFileSync: ['write', 0], appendFile: ['write', 0], createWriteStream: ['write', 0], writeJson: ['write', 0, 'json'], outputFile: ['write', 0],
  glob: ['read', 0], rglob: ['read', 0], iglob: ['read', 0], listdir: ['read', 0, 'folder'], scandir: ['read', 0, 'folder'], readdirSync: ['read', 0, 'folder'], readdir: ['read', 0, 'folder']
};
// module.name(...) pairs whose meaning depends on the module.
const MODULE_CALLS = {
  'np.load': ['read', 0, 'npy'], 'numpy.load': ['read', 0, 'npy'], 'np.save': ['write', 0, 'npy'], 'np.savez': ['write', 0, 'npz'], 'np.loadtxt': ['read', 0, 'txt'], 'np.savetxt': ['write', 0, 'txt'],
  'torch.load': ['read', 0, 'pt'], 'torch.save': ['write', 1, 'pt'], 'joblib.load': ['read', 0, 'pkl'], 'joblib.dump': ['write', 1, 'pkl'],
  'fitz.open': ['read', 0, 'pdf'], 'pymupdf.open': ['read', 0, 'pdf'], 'pdfplumber.open': ['read', 0, 'pdf'], 'Image.open': ['read', 0, 'image'], 'docx.Document': ['read', 0, 'docx'],
  'shutil.copy': ['write', 1], 'shutil.copyfile': ['write', 1], 'shutil.move': ['write', 1], 'sqlite3.connect': ['read', 0, 'sqlite'],
  'io.open': ['open', 0], 'gzip.open': ['open', 0], 'codecs.open': ['open', 0], 'bz2.open': ['open', 0], 'lzma.open': ['open', 0]
};
// path.method(...): the receiver is the path.
const PATH_METHODS = { read_text: 'read', read_bytes: 'read', write_text: 'write', write_bytes: 'write', open: 'open', glob: 'read', rglob: 'read', iterdir: 'read', mkdir: undefined, exists: undefined };
const NOT_FILES = new Set(['webbrowser', 'requests', 'httpx', 'urllib', 'session', 'client', 'socket', 'subprocess', 'os']);
const modeOf = args => { const mode = args.find(arg => arg.name === 'mode') || args[1]; const text = mode?.tokens.length === 1 && mode.tokens[0].t === 'str' ? mode.tokens[0].v : ''; return /[wax+]/.test(text) ? 'write' : 'read'; };
// The tokens of the receiver ending just before list[dot] (a.b, Path(x), (a / "b")).
function receiver(list, dot) {
  let i = dot - 1, depth = 0;
  const start = i;
  for (; i >= 0; i--) {
    const token = list[i];
    // A new line at the outer level starts another statement.
    if (depth === 0 && i < start && lineBreakBetween(token, list[i + 1])) break;
    if (token.t === 'op' && ')]'.includes(token.v)) { depth++; continue; }
    if (token.t === 'op' && '(['.includes(token.v)) { if (depth === 0) break; depth--; continue; }
    if (depth > 0) continue;
    if (token.t === 'name' && KEYWORDS.has(token.v)) break;
    // Two names in a row are two expressions (for doc in x): the receiver ends here.
    if (token.t === 'name' && list[i - 1]?.t === 'name' && depth === 0) { i--; break; }
    if (token.t === 'name' || token.t === 'str' || token.v === '.') continue;
    if (token.v === '/' && list[i - 1] && (list[i - 1].t !== 'op' || ')]'.includes(list[i - 1].v))) continue;
    break;
  }
  return list.slice(i + 1, start + 1);
}

// Every file access in the code: [{ mode: 'read'|'write', pattern, format, line }] (line counts from 1).
// constants: Map(NAME → tokens) from moduleConstants, for names set outside the code given.
function fileAccess(text, { constants } = {}) {
  SOURCE = String(text || '');
  const list = tokens(SOURCE), assigned = new Map([...(constants || []), ...assignments(list)]), out = [];
  const lineAt = index => SOURCE.slice(0, index).split('\n').length;
  const add = (mode, tokensOfPath, fallback, at) => {
    const pattern = patternOf(tokensOfPath, assigned);
    if (!pattern || pattern === '{value}') return;
    out.push({ mode, pattern, format: formatOf(pattern, fallback), line: lineAt(at) });
  };
  for (let i = 0; i < list.length - 1; i++) {
    const token = list[i];
    if (token.t !== 'name' || list[i + 1].v !== '(') continue;
    const dotted = list[i - 1]?.v === '.' && list[i - 2]?.t === 'name' ? list[i - 2].v + '.' + token.v : undefined;
    const { args } = callArgs(list, i + 1);
    const known = dotted && MODULE_CALLS[dotted];
    if (known) {
      const mode = known[0] === 'open' ? modeOf(args) : known[0];
      if (args[known[1]]) add(mode, args[known[1]].tokens, known[2], token.s);
      continue;
    }
    if (dotted && NOT_FILES.has(list[i - 2].v)) continue;
    if (token.v === 'open' && list[i - 1]?.v !== '.') { if (args[0]) add(modeOf(args), args[0].tokens, undefined, token.s); continue; }
    if (list[i - 1]?.v === '.' && Object.hasOwn(PATH_METHODS, token.v) && !CALLS[token.v]?.length) {
      let mode = PATH_METHODS[token.v];
      if (!mode) continue;
      if (mode === 'open') { const first = args[0]?.tokens; mode = first?.length === 1 && first[0].t === 'str' && /[wax+]/.test(first[0].v) ? 'write' : 'read'; }
      add(mode, receiver(list, i - 1), token.v === 'iterdir' ? 'folder' : undefined, token.s);
      continue;
    }
    if (CALLS[token.v]) {
      const [mode, index, fallback] = CALLS[token.v];
      // path.glob("*.md"): the receiver is the folder and the argument the files.
      if ((token.v === 'glob' || token.v === 'rglob') && list[i - 1]?.v === '.' && list[i - 2]?.v !== 'glob') {
        const folder = receiver(list, i - 1), pattern = args[0]?.tokens || [];
        add(mode, [...folder, { t: 'op', v: '/' }, ...pattern], fallback, token.s);
        continue;
      }
      const arg = args.find(item => ['path', 'file', 'filename', 'fname', 'filepath', 'path_or_buf', 'io', 'fp'].includes(item.name)) || args.filter(item => !item.name)[index];
      if (arg) add(mode, arg.tokens, fallback, token.s);
    }
  }
  // One entry per (mode, pattern).
  const seen = new Set();
  return out.filter(item => { const key = item.mode + '\0' + item.pattern; return !seen.has(key) && seen.add(key); });
}

// UPPER_CASE = "..." at the top level of each file: names like SERIES_JSON_FILE
// that paths are built from. A name set in two files to different values is left out.
function moduleConstants(texts) {
  const found = new Map(), clash = new Set();
  for (const text of texts) {
    for (const match of String(text || '').matchAll(/^(?:export\s+)?(?:const\s+)?([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*([^\n]+)$/gm)) {
      SOURCE = match[2];
      const value = tokens(match[2]);
      if (!value.length || value.some(token => token.t === 'op' && '[{'.includes(token.v)) && !value.some(token => token.t === 'str')) continue;
      const key = JSON.stringify(value.map(token => token.v));
      if (found.has(match[1]) && found.get(match[1]).key !== key) clash.add(match[1]);
      found.set(match[1], { key, value });
    }
  }
  return new Map([...found].filter(([name]) => !clash.has(name)).map(([name, item]) => [name, item.value]));
}

// Matches a pattern against project paths: {name} and * stand for one path part.
function patternRegExp(pattern) {
  const body = pattern.split(/(\{[^}]*\}|\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' || /^\{.*\}$/.test(part) ? '[^/]*' : part.replace(/[.+?^$()|[\]\\]/g, '\\$&')).join('');
  return new RegExp('^(?:.*/)?' + body + (/\/$|\{[^}]*\}$/.test(pattern) ? '(?:/.*)?' : '') + '$');
}

// --- one part's data: what its steps read and write ---
const MAX_ITEMS = 18, MAX_HELPERS = 40;
const vague = pattern => /^\{[^}]+\}$/.test(pattern);
// steps: the part's steps; tree: its call tree (callgraph.callTree); texts: Map(file → source).
// Each step's own code is read, plus helpers it reaches without passing another step.
// Returns [{ id, pattern, format, reads: [step key], writes: [step key], at: [{ file, line }], examples, matches }].
function partData({ steps, tree, texts, listFiles }) {
  const constants = moduleConstants(texts.values());
  const keys = new Set(steps.map(step => step.file + '#' + step.symbol));
  const byId = new Map((tree?.nodes || []).map(node => [node.id, node]));
  const scan = (file, from, to) => {
    const text = texts.get(file); if (!text || !from) return [];
    return fileAccess(text.split('\n').slice(from - 1, to || from).join('\n'), { constants }).map(item => ({ ...item, file, line: from + item.line - 1 }));
  };
  const items = new Map();
  for (const step of steps) {
    const key = step.file + '#' + step.symbol;
    const nodes = (tree?.nodes || []).filter(node => node.file + '#' + node.symbol === key);
    const start = nodes.find(node => node.line === step.line_start) || nodes[0];
    const found = start ? scan(start.file, start.line, start.end) : scan(step.file, step.line_start, step.line_end);
    // Helpers the step calls that are not steps themselves.
    const seen = new Set(start ? [start.id] : []), queue = [...(start?.calls || [])];
    while (queue.length && seen.size < MAX_HELPERS) {
      const node = byId.get(queue.shift());
      if (!node || seen.has(node.id) || keys.has(node.file + '#' + node.symbol)) continue;
      seen.add(node.id); found.push(...scan(node.file, node.line, node.end)); queue.push(...node.calls);
    }
    for (const access of found) {
      const item = items.get(access.pattern) || items.set(access.pattern, { pattern: access.pattern, format: access.format, reads: [], writes: [], at: [] }).get(access.pattern);
      if (item.format === 'file' && access.format !== 'file') item.format = access.format;
      const list = access.mode === 'write' ? item.writes : item.reads;
      if (!list.includes(key)) list.push(key);
      if (item.at.length < 3 && !item.at.some(at => at.file === access.file && at.line === access.line)) item.at.push({ file: access.file, line: access.line });
    }
  }
  // Named paths first, then the most used; a bare {name} only when little else is known.
  const ranked = [...items.values()].sort((a, b) => vague(a.pattern) - vague(b.pattern) || (b.reads.length + b.writes.length) - (a.reads.length + a.writes.length) || (a.pattern < b.pattern ? -1 : 1));
  const shown = ranked.filter(item => !vague(item.pattern) || ranked.filter(other => !vague(other.pattern)).length < 4).slice(0, MAX_ITEMS);
  // Real files in the project that fit each pattern, as examples.
  const files = listFiles ? listFiles() : [];
  return shown.map((item, index) => {
    // Only a pattern with a fixed name in it (series.json, brief.md) points at real files.
    const fixed = item.pattern.split('/').some(part => /[A-Za-z0-9]/.test(part.replace(/\{[^}]*\}|\*/g, '')));
    const matches = fixed ? files.filter(file => patternRegExp(item.pattern).test(file)) : [];
    return { id: 'd' + index, ...item, examples: matches.slice(0, 3), matches: matches.length };
  });
}
// Project files, relative to root, for matching data patterns (bounded, skips dependencies).
function listProjectFiles(root, { skip = [], limit = 20000 } = {}) {
  const fs = require('node:fs'), path = require('node:path'), out = [], skipped = new Set(skip);
  const walk = (dir, rel, depth) => {
    if (out.length >= limit || depth > 8) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const next = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { if (!skipped.has(entry.name)) walk(path.join(dir, entry.name), next, depth + 1); }
      else if (entry.isFile()) out.push(next);
    }
  };
  walk(root, '', 0);
  return out;
}

module.exports = { partData, listProjectFiles, fileAccess, moduleConstants, patternOf, patternRegExp, formatOf, tokens };
