import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
for (const file of ['server.mjs', ...readdirSync('public').filter(f=>f.endsWith('.js')).map(f=>`public/${f}`), 'functions/api/[[path]].js']) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  assert.equal(result.status, 0, file);
}
const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8'));
assert.deepEqual(routes.include, ['/api/*']);
assert.ok(existsSync('supabase/migrations/202611250001_init.sql'));
console.log('Sintaks JavaScript dan berkas penerapan diperiksa.');
