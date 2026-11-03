import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const agent = (name) => fileURLToPath(new URL(`../agents/${name}`, import.meta.url));
const tempRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'agents@example.com');
  git('config', 'user.name', 'agents');
  return { dir, git };
};
// 本物と同じ形の「にせもの」は、ここで組み立てる（このファイル自体がフクロウに止められないように）
const fakeGameSecret = () => `tg_${'a'.repeat(32)}`;
const fakeAwsKey = () => `AKIA${'B'.repeat(16)}`;

test('🦉 フクロウ：きれいなら通す。合言葉・カギ・保存データは止める。owl:allow の行は見のがす', () => {
  const { dir, git } = tempRepo();
  try {
    writeFileSync(join(dir, 'ok.js'), 'export const x = 1;\n');
    git('add', '-A');
    let r = spawnSync(process.execPath, [agent('owl-check.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);

    writeFileSync(join(dir, 'bad.js'), `const s = "${fakeGameSecret()}";\nconst k = "${fakeAwsKey()}";\nconst sample = "${fakeAwsKey()}"; // owl:allow 説明の見本\n`);
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'db.json'), '{}');
    git('add', '-A');
    r = spawnSync(process.execPath, [agent('owl-check.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /bad\.js:1：ともはね のゲームの合言葉/);
    assert.match(r.stdout, /bad\.js:2：AWS のアクセスキー/);
    assert.doesNotMatch(r.stdout, /bad\.js:3/);
    assert.match(r.stdout, /data\/db\.json：保存データ/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('🐕 シバ：TAP と spec の両方から、落ちたテストの名前を読む（トークンがなければ画面に出すだけ）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiba-'));
  try {
    const out = join(dir, 'out.txt');
    writeFileSync(out, 'not ok 2 - たし算ができる\n  error: \'3 !== 4\'\n✖ ひき算ができる (1.2ms)\n');
    const env = { ...process.env, GITHUB_TOKEN: '', PR_NUMBER: '' };
    const r = spawnSync(process.execPath, [agent('shiba-guide.mjs'), out], { encoding: 'utf8', env });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /- たし算ができる/);
    assert.match(r.stdout, /- ひき算ができる/);
    assert.match(r.stdout, /決めるのは人/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('🐰 ウサギ：前の版からのコミットを、なかま分けしてまとめる', () => {
  const { dir, git } = tempRepo();
  try {
    const commit = (msg) => { writeFileSync(join(dir, `${Math.random()}.txt`), msg); git('add', '-A'); git('commit', '-q', '-m', msg); };
    commit('Add first thing');
    git('tag', 'v0.1.0');
    commit('Add letter kit');
    commit('Fix the map on phones');
    commit('Link with soratomo');
    commit('Wonderful day');
    git('tag', 'v0.2.0');
    const out = execFileSync(process.execPath, [agent('usagi-notes.mjs'), 'v0.2.0'], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /v0\.1\.0 から 4 個の変更/);
    assert.match(out, /### ✨ 新しくできたこと\n- Add letter kit/);
    assert.match(out, /### 🔧 直したこと\n- Fix the map on phones/);
    assert.match(out, /### 🔗 つながったアプリ\n- Link with soratomo/);
    assert.match(out, /### 🌷 そのほか\n- Wonderful day/);
    assert.doesNotMatch(out, /Add first thing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
