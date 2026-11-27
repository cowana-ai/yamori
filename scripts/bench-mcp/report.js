const fs = require('fs'), path = require('path');
// node scripts/bench-mcp/report.js [results dir]
const dir = path.resolve(process.argv[2] || path.join(__dirname, 'results'));
const rows = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const sum = a => a.reduce((x, y) => x + y, 0), mean = a => sum(a) / a.length;
const fresh = r => r.input - r.cached; // uncached input
const group = (keyOf) => { const g = {}; for (const r of rows) (g[keyOf(r)] ||= []).push(r); return g; };
const line = (label, rs) => [label, rs.length, (100 * mean(rs.map(r => r.score))).toFixed(0) + '%', rs.filter(r => r.score === 1).length + '/' + rs.length, Math.round(med(rs.map(r => r.tokens))), Math.round(med(rs.map(fresh))), Math.round(med(rs.map(r => r.output))), med(rs.map(r => r.seconds)), med(rs.map(r => r.tools)), mean(rs.map(r => r.yamori)).toFixed(1), rs[0].agent === 'claude' ? '$' + sum(rs.map(r => r.cost)).toFixed(2) : '-'].join('\t');
console.log(['group', 'n', 'score', 'all-correct', 'tok(med)', 'uncached in(med)', 'out(med)', 'sec(med)', 'tools(med)', 'yamori calls(avg)', 'cost(total)'].join('\t'));
for (const [k, rs] of Object.entries(group(r => r.agent + ' ' + r.arm)).sort()) console.log(line(k, rs));
console.log();
for (const [k, rs] of Object.entries(group(r => r.project + ' ' + r.agent + ' ' + r.arm)).sort()) console.log(line(k, rs));
console.log('\nper task: median tokens / sec / scores for without | with | mapfirst');
const tasks = [...new Set(rows.map(r => r.task))].sort();
const f = rs => rs.length ? `${Math.round(med(rs.map(r => r.tokens)) / 1000)}k ${med(rs.map(r => r.seconds))}s ${rs.map(r => r.score.toFixed(1)).join('/')} y${rs.map(r => r.yamori).join('/')}` : '-';
for (const t of tasks) for (const agent of ['claude', 'codex']) console.log([t, agent, ...['without', 'with', 'mapfirst'].map(arm => f(rows.filter(r => r.task === t && r.agent === agent && r.arm === arm)))].join('\t'));
console.log('\nerrors:', rows.filter(r => r.error || r.code).map(r => `${r.task}.${r.agent}.${r.arm}.${r.rep}:${r.code}:${r.error || ''}`).join(' | ') || 'none');
console.log('misses:', rows.filter(r => r.score < 1).map(r => `${r.task}.${r.agent}.${r.arm}.${r.rep} missed ${r.missed.join(',')}`).join('\n  '));
