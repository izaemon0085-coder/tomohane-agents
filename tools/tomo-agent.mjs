#!/usr/bin/env node
// tomo-agent：パソコンで動くエージェントの道具（外部パッケージなし）
//
//   node tools/tomo-agent.mjs suggest              いまステージした変更の、コミットメッセージ案を出す（🐰 ウサギ）
//   node tools/tomo-agent.mjs lint [--staged]      静的解析（🦉🐱）。ふだんは知らせるだけ
//   node tools/tomo-agent.mjs install [フォルダ…]   Git のフックを入れる（ふだんは Projects の中の全部のリポジトリ）
//   node tools/tomo-agent.mjs uninstall [フォルダ…] フックを外す
//   node tools/tomo-agent.mjs off | on            止めるボタン（全部のリポジトリで、その場で止まる／もどる）
//   node tools/tomo-agent.mjs status              いまの状態
//   （commit-msg <ファイル> <種類>・pre-commit は、Git のフックが呼ぶ）
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStaged, suggest, render } from '../agents/usagi-commit-msg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = resolve(HERE, 'tomo-agent.mjs').replace(/\\/g, '/');
const LINT = resolve(HERE, '..', 'agents', 'lint.mjs');
const MARK = 'tomo-agent';
const DEFAULT_PROJECTS = resolve(HERE, '..', '..');

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
const isOff = (cwd) => {
  if (process.env.TOMO_AGENT_OFF === '1') return true;
  try { return git(['config', '--get', 'tomo-agent.off'], { cwd }) === 'true'; } catch { return false; }
};

// 入れるフック。どちらも「案・知らせ」だけで、コミットを止めない（|| true）
const HOOKS = {
  'prepare-commit-msg': `#!/bin/sh
# ${MARK}：🐰 ウサギのコミットメッセージ案（案だけ。保存するかは人が決める）
# 止める：node "${SELF}" off　　このリポジトリだけ外す：node "${SELF}" uninstall .
node "${SELF}" commit-msg "$1" "$2" || true
`,
  'pre-commit': `#!/bin/sh
# ${MARK}：🦉🐱 静的解析（ステージしたファイルだけ。いまは知らせるだけで、コミットは止めない）
# 止める：node "${SELF}" off　　このリポジトリだけ外す：node "${SELF}" uninstall .
node "${SELF}" pre-commit || true
`,
};

function reposIn(dir) {
  return readdirSync(dir).map((d) => join(dir, d)).filter((d) => {
    try { return statSync(d).isDirectory() && existsSync(join(d, '.git')); } catch { return false; }
  });
}
function hooksDir(repo) {
  let custom = '';
  try { custom = git(['config', '--get', 'core.hooksPath'], { cwd: repo }); } catch { /* ふつう */ }
  if (custom) return { dir: null, why: `core.hooksPath（${custom}）を使っているので、さわらない` };
  return { dir: join(git(['rev-parse', '--absolute-git-dir'], { cwd: repo }), 'hooks') };
}
const ours = (path) => existsSync(path) && readFileSync(path, 'utf8').includes(MARK);
const nameOf = (repo) => repo.split(/[\\/]/).pop();
const targets = (dirs) => (dirs.length ? dirs.map((d) => resolve(d)) : reposIn(DEFAULT_PROJECTS));

const commands = {
  // Git のフック（prepare-commit-msg）から呼ばれる
  'commit-msg'(file, source = '') {
    // -m・テンプレート・マージ・まとめ・--amend のときは、人がもう書いているので何もしない
    if (!file || source || isOff(process.cwd())) return;
    const s = suggest(readStaged(process.cwd()));
    if (!s) return;
    writeFileSync(file, render(s, readFileSync(file, 'utf8')));
  },
  // Git のフック（pre-commit）から呼ばれる：ステージしたファイルだけ静的解析（知らせるだけ）
  'pre-commit'() {
    if (isOff(process.cwd())) return;
    const r = spawnSync(process.execPath, [LINT, '--staged'], { encoding: 'utf8' });
    if (/[❌⚠️]/u.test(r.stdout)) process.stdout.write(r.stdout);
  },
  suggest() {
    const s = suggest(readStaged(process.cwd()));
    if (!s) return console.log('🐰 ステージした変更がないよ（git add してから、もう一度どうぞ）');
    console.log(render(s).trimEnd());
  },
  lint(...args) {
    const r = spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8', stdio: 'inherit' });
    process.exitCode = r.status ?? 0;
  },
  install(...dirs) {
    for (const repo of targets(dirs)) {
      const { dir, why } = hooksDir(repo);
      if (!dir) { console.log(`⏭️ ${nameOf(repo)}：${why}`); continue; }
      const done = [];
      for (const [hook, body] of Object.entries(HOOKS)) {
        const path = join(dir, hook);
        if (existsSync(path) && !ours(path)) { console.log(`⏭️ ${nameOf(repo)}：${hook} はほかのフックがあるので、上書きしない`); continue; }
        writeFileSync(path, body);
        try { chmodSync(path, 0o755); } catch { /* Windows */ }
        done.push(hook);
      }
      if (done.length) console.log(`🐰 ${nameOf(repo)}：入れた（${done.join('・')}）`);
    }
  },
  uninstall(...dirs) {
    for (const repo of targets(dirs)) {
      const { dir } = hooksDir(repo);
      if (!dir) continue;
      const removed = Object.keys(HOOKS).filter((hook) => {
        const path = join(dir, hook);
        if (!ours(path)) return false;
        rmSync(path);
        return true;
      });
      if (removed.length) console.log(`🧹 ${nameOf(repo)}：外した（${removed.join('・')}）`);
    }
  },
  off() {
    git(['config', '--global', 'tomo-agent.off', 'true']);
    console.log('⏸️ tomo-agent を止めた（全部のリポジトリ）。もどす：on');
  },
  on() {
    try { git(['config', '--global', '--unset', 'tomo-agent.off']); } catch { /* もともと動いている */ }
    console.log('▶️ tomo-agent をもどした');
  },
  status() {
    console.log(isOff(process.cwd()) ? '⏸️ 止まっている' : '▶️ 動いている');
    for (const repo of reposIn(DEFAULT_PROJECTS)) {
      const { dir } = hooksDir(repo);
      const marks = dir ? Object.keys(HOOKS).map((h) => (ours(join(dir, h)) ? (h === 'pre-commit' ? '🐱' : '🐰') : '・')).join('') : '⏭️';
      console.log(`  ${marks} ${nameOf(repo)}`);
    }
  },
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!commands[cmd]) {
    console.log('使い方：node tools/tomo-agent.mjs suggest | lint | install | uninstall | off | on | status');
    process.exit(cmd ? 1 : 0);
  }
  commands[cmd](...args);
}
