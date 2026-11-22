// Copy a pinned repository into site/public/content/<id>/source and write meta.json.
// Lessons, notes and the graph are separate steps. See README.md.
//
//   node scripts/import-repo.mjs <id> <source-dir> <commit> <upstream-url>
//
// Example:
//   node scripts/import-repo.mjs nanogpt /path/to/nanoGPT 3adf61e154c3fe3fca428ad6bc3818b27a3b8291 https://github.com/karpathy/nanoGPT
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [id, source, commit, upstream] = process.argv.slice(2);
if (!id || !source || !/^[0-9a-f]{7,40}$/.test(commit || '') || !upstream) {
  console.error('Usage: node scripts/import-repo.mjs <id> <source-dir> <commit> <upstream-url>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'content', id);
const dest = path.join(root, 'source');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(source, dest, { recursive: true, filter: item => !item.includes(`${path.sep}.git`) });
writeFileSync(path.join(root, 'meta.json'), JSON.stringify({
  id, commit, upstream,
  commitUrl: upstream.replace(/\/$/, '') + '/commit/' + commit,
  treeUrl: upstream.replace(/\/$/, '') + '/tree/' + commit,
  license: 'SEE SOURCE',
  copyright: '',
  attribution: 'Source snapshot of ' + upstream + ' at ' + commit + '. Record the license and copyright before publishing.',
  prepared: 'Explanations are not written yet.'
}, null, 2) + '\n');
console.log('Copied source to ' + dest);
console.log('Next: add course.json, notes.json, explanations/*.json and flows.json, then run npm run scan && npm run validate.');
