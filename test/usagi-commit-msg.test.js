import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStaged, suggest } from '../agents/usagi-commit-msg.mjs';

const TOOL = fileURLToPath(new URL('../tools/tomo-agent.mjs', import.meta.url));
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'usagi-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'usagi@example.com');
  git('config', 'user.name', 'usagi');
  git('config', 'commit.gpgsign', 'false');
  return { dir, git };
}
const tool = (cwd, args, env = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...process.env, TOMO_AGENT_OFF: '', ...env } });

test('🐰 足したファイルは Add、新しい関数の名前も入れる', () => {
  const { dir, git } = repo();
  try {
    writeFileSync(join(dir, 'games.js'), 'export function recommendFor() {}\nexport const gamesFor = (x) => x;\n');
    git('add', '-A');
    const s = suggest(readStaged(dir));
    assert.equal(s.subject, 'Add games (recommendFor, gamesFor)');
    assert.match(s.body.join('\n'), /games\.js：足した（\+2 −0）/);
    assert.deepEqual(s.warnings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('🐰 変えただけなら Update、テストだけなら Test、説明だけなら Document', () => {
  const { dir, git } = repo();
  try {
    writeFileSync(join(dir, 'store.js'), 'a\n');
    writeFileSync(join(dir, 'README.md'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'store.js'), 'b\n');
    git('add', '-A');
    assert.equal(suggest(readStaged(dir)).subject, 'Update store');
    git('commit', '-q', '-m', 'second');
    writeFileSync(join(dir, 'README.md'), 'b\n');
    git('add', '-A');
    assert.equal(suggest(readStaged(dir)).subject, 'Document README');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('🦉 合言葉らしいものがあると、フクロウの注意を付ける', () => {
  const { dir, git } = repo();
  try {
    writeFileSync(join(dir, 'config.js'), `const k = "AKIA${'C'.repeat(16)}";\n`);
    git('add', '-A');
    const s = suggest(readStaged(dir));
    assert.match(s.warnings.join('\n'), /config\.js：AWS のアクセスキー/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('フック：入れると git commit で案が出る。-m のときと止めたときは何もしない。ほかのフックは上書きしない', () => {
  const { dir, git } = repo();
  try {
    assert.match(tool(dir, ['install', dir]).stdout, /入れた/);
    const hook = join(dir, '.git', 'hooks', 'prepare-commit-msg');
    assert.ok(readFileSync(hook, 'utf8').includes('tomo-agent'));

    // エディタのかわりに「案をそのまま保存」する
    writeFileSync(join(dir, 'map.js'), 'export function drawMap() {}\n');
    git('add', '-A');
    git('-c', 'core.editor=true', 'commit', '-q');
    assert.equal(git('log', '-1', '--format=%s').trim(), 'Add map (drawMap)');
    assert.doesNotMatch(git('log', '-1', '--format=%B'), /ウサギの案/); // コメントは残らない

    // -m のときは、人の書いたまま
    writeFileSync(join(dir, 'map.js'), 'export function drawMap() { return 1; }\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'Fix the map');
    assert.equal(git('log', '-1', '--format=%s').trim(), 'Fix the map');

    // 止めるボタン
    writeFileSync(join(dir, 'map.js'), 'export function drawMap() { return 2; }\n');
    git('add', '-A');
    const msg = join(dir, 'msg.txt');
    writeFileSync(msg, '# git のコメント\n');
    tool(dir, ['commit-msg', msg, ''], { TOMO_AGENT_OFF: '1' });
    assert.equal(readFileSync(msg, 'utf8'), '# git のコメント\n');
    tool(dir, ['commit-msg', msg, '']);
    assert.match(readFileSync(msg, 'utf8'), /^Update map\n/);

    // 外す → ほかのフックは上書きしない
    assert.match(tool(dir, ['uninstall', dir]).stdout, /外した/);
    assert.ok(!existsSync(hook));
    writeFileSync(hook, '#!/bin/sh\necho mine\n');
    assert.match(tool(dir, ['install', dir]).stdout, /上書きしない/);
    assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
