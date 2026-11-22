'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('learning-site lessons match the pinned nanoGPT source', () => {
  const result = spawnSync(process.execPath, ['site/scripts/validate.mjs'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
