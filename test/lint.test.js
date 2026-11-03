import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText, lintFile } from '../agents/lint.mjs';

const LINT = fileURLToPath(new URL('../agents/lint.mjs', import.meta.url));
// あぶない書き方の見本は、ここで組み立てる（このファイル自体が止められないように）
const EV = 'ev' + 'al';

test('❌ eval・new Function は「まちがい」。lint:allow の行は見のがす', () => {
  const found = lintText('a.js', `const x = ${EV}(input);\nconst f = new Function('a', 'return a');\nconst y = ${EV}(z); // lint:allow 見本\nobj.${EV}(1);\n`);
  assert.deepEqual(found.map((x) => [x.level, x.line]), [['error', 1], ['error', 2]]);
});

test('⚠️ document.write・文字列をつないだ exec・使っていない import', () => {
  const src = [
    "import { readFile, writeFile as wf } from 'node:fs';",
    "import path from 'node:path';",
    "import * as os from 'node:os';",
    'readFile("x");',
    'document.write("<p>hi</p>");',
    'exec(`ls ${dir}`);',
    'console.log(os.EOL);',
  ].join('\n');
  const found = lintText('b.js', src).map((x) => `${x.line}:${x.msg}`);
  assert.ok(found.some((m) => m.startsWith('1:') && m.includes('「wf」')));
  assert.ok(found.some((m) => m.startsWith('2:') && m.includes('「path」')));
  assert.ok(!found.some((m) => m.includes('「readFile」') || m.includes('「os」')));
  assert.ok(found.some((m) => m.startsWith('5:') && m.includes('document.write')));
  assert.ok(found.some((m) => m.startsWith('6:') && m.includes('exec')));
});

test('❌ 構文のまちがいを見つける。--strict のときだけ止める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-'));
  try {
    const bad = join(dir, 'bad.mjs');
    writeFileSync(bad, 'export function x( {\n');
    assert.match(lintFile(bad)[0].msg, /構文のまちがい/);
    assert.equal(spawnSync(process.execPath, [LINT, bad], { encoding: 'utf8' }).status, 0);
    const strict = spawnSync(process.execPath, [LINT, '--strict', bad], { encoding: 'utf8' });
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /まちがい 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('🐱 フック：コミットの前に、ステージしたファイルだけ知らせる（コミットは止めない）', async () => {
  const { execFileSync } = await import('node:child_process');
  const TOOL = fileURLToPath(new URL('../tools/tomo-agent.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'lint-hook-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q');
    git('config', 'user.email', 'lint@example.com');
    git('config', 'user.name', 'lint');
    spawnSync(process.execPath, [TOOL, 'install', dir], { encoding: 'utf8', env: { ...process.env, TOMO_AGENT_OFF: '' } });
    writeFileSync(join(dir, 'a.js'), `const x = ${EV}("1");\n`);
    git('add', '-A');
    const r = spawnSync('git', ['commit', '-q', '-m', 'Add a'], { cwd: dir, encoding: 'utf8', env: { ...process.env, TOMO_AGENT_OFF: '' } });
    assert.equal(r.status, 0);
    assert.match(r.stdout + r.stderr, /a\.js:1 {2}eval は使わない/);
    assert.equal(git('log', '-1', '--format=%s').trim(), 'Add a');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
