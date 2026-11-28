'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fileAccess, moduleConstants, partData, patternRegExp } = require('../src/stages/datafiles');

const found = (text, options) => fileAccess(text, options).map(item => [item.mode, item.pattern, item.format]);

test('reads and writes of documents and data become path patterns, with no AI', () => {
  const code = `
def propose(month, base):
    folder = base / "research" / month
    brief = (folder / "brief.md").read_text()
    with open(f"assets/research/{month}/topics.md", "w", encoding="utf-8") as f:
        f.write(text)
    df = pd.read_csv("data/leads.csv")
    df.to_parquet(out_dir / "leads.parquet")
    reader = PdfReader(path)
    for doc in Path("docs").glob("*.md"):
        pass
    torch.save(model.state_dict(), ckpt_path)
    webbrowser.open("http://example.com")
    requests.get(url)
`;
  assert.deepEqual(found(code), [
    ['read', '{base}/research/{month}/brief.md', 'md'],
    ['write', 'assets/research/{month}/topics.md', 'md'],
    ['read', 'data/leads.csv', 'csv'],
    ['write', '{out_dir}/leads.parquet', 'parquet'],
    ['read', '{path}', 'pdf'],
    ['read', 'docs/*.md', 'md'],
    ['write', '{ckpt_path}', 'pt']
  ]);
  assert.deepEqual(found("const raw = fs.readFileSync(path.join(root, 'config', name + '.yaml'), 'utf8');\nawait fs.writeFile(`out/${id}.json`, data);"),
    [['read', '{root}/config/{name}.yaml', 'yaml'], ['write', 'out/{id}.json', 'json']]);
});

test('paths are read the way people write them: constants, helpers, comments and conditionals', () => {
  const constants = moduleConstants(['SERIES_JSON_FILE = "series.json"\nBRIEF_FILE: str = "brief.md"\n']);
  const code = `
def save(research_root, series, topic):
    research_root = research_path.parent  # the month folder sits in: assets/research/<YYYY-MM>/
    json_path = series_path(research_root, series) / SERIES_JSON_FILE
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(saved, encoding="utf-8")
    for path in sorted(series_root(research_root).glob(f"*/{SERIES_JSON_FILE}")):
        pass
    filename = build_filename(title, res.get("url", ""), existing)
    (output_dir / filename).write_text(markdown)
    target = "a.md" if draft else "b.md"
    open(target, "w")
    (topic_path / BRIEF_FILE).write_text(brief)
`;
  const patterns = found(code, { constants });
  assert.deepEqual(patterns.find(item => item[1].endsWith('series.json') && item[0] === 'write'), ['write', '{research_root}/{series}/series.json', 'json'], 'constants fill in, a comment ending in / does not join lines');
  assert.ok(patterns.some(item => item[1] === '{research_root}/*/series.json'), 'a constant inside an f-string');
  assert.ok(patterns.some(item => item[1] === '{output_dir}/{filename}'), 'a helper that is not a path builder stays one value');
  assert.ok(patterns.some(item => item[1] === '{topic_path}/brief.md'));
  assert.ok(!patterns.some(item => /else|draft|url/.test(item[1])), 'conditionals and helper arguments do not leak into the path: ' + JSON.stringify(patterns));
});

test('a part\'s data: each step\'s own code and its helpers, grouped by path, with real files as examples', () => {
  const texts = new Map([['app/topics.py', [
    'def init_month(root, month):',            // 1
    '    write_brief(root, month)',            // 2
    '',                                        // 3
    'def write_brief(root, month):',           // 4
    '    (root / month / "brief.md").write_text("x")', // 5
    '',                                        // 6
    'def propose(root, month):',               // 7
    '    brief = (root / month / "brief.md").read_text()', // 8
    '    open(root / "topics.json", "w")'      // 9
  ].join('\n')]]);
  const steps = [{ file: 'app/topics.py', symbol: 'init_month', line_start: 1, line_end: 2 }, { file: 'app/topics.py', symbol: 'propose', line_start: 7, line_end: 9 }];
  const tree = { nodes: [
    { id: 'a', file: 'app/topics.py', symbol: 'init_month', line: 1, end: 2, calls: ['b'] },
    { id: 'b', file: 'app/topics.py', symbol: 'write_brief', line: 4, end: 5, calls: [] },
    { id: 'c', file: 'app/topics.py', symbol: 'propose', line: 7, end: 9, calls: [] }
  ] };
  const data = partData({ steps, tree, texts, listFiles: () => ['assets/2026-11/brief.md', 'assets/2026-12/brief.md', 'README.md'] });
  const brief = data.find(item => item.pattern === '{root}/{month}/brief.md');
  assert.deepEqual(brief.writes, ['app/topics.py#init_month'], 'a helper\'s write belongs to the step that calls it');
  assert.deepEqual(brief.reads, ['app/topics.py#propose']);
  assert.deepEqual(brief.at, [{ file: 'app/topics.py', line: 5 }, { file: 'app/topics.py', line: 8 }]);
  assert.equal(brief.matches, 2); assert.deepEqual(brief.examples, ['assets/2026-11/brief.md', 'assets/2026-12/brief.md']);
  assert.deepEqual(data.find(item => item.pattern === '{root}/topics.json').writes, ['app/topics.py#propose']);
  assert.ok(patternRegExp('{root}/*/series.json').test('assets/series/a/series.json'));
  assert.ok(!patternRegExp('{root}/brief.md').test('assets/x/topics.md'));
});
