#!/usr/bin/env node
// tomo-agent：パソコンで動くエージェントの道具（外部パッケージなし）
//
//   node tools/tomo-agent.mjs suggest              いまステージした変更の、コミットメッセージ案を出す（🐰 ウサギ）
//   node tools/tomo-agent.mjs install [フォルダ…]   Git のフックを入れる（ふだんは Projects の中の全部のリポジトリ）
//   node tools/tomo-agent.mjs uninstall [フォルダ…] フックを外す
//   node tools/tomo-agent.mjs off | on            止めるボタン（全部のリポジトリで、その場で止まる／もどる）
//   node tools/tomo-agent.mjs status              いまの状態
//   （commit-msg <ファイル> <種類> は、Git のフックが呼ぶ）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStaged, suggest, render } from '../agents/usagi-commit-msg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = resolve(HERE, 'tomo-agent.mjs').replace(/\\/g, '/');
const MARK = 'tomo-agent';
const DEFAULT_PROJECTS = resolve(HERE, '..', '..');

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
const isOff = (cwd) => {
  if (process.env.TOMO_AGENT_OFF === '1') return true;
  try { return git(['config', '--get', 'tomo-agent.off'], { cwd }) === 'true'; } catch { return false; }
};

const HOOK = `#!/bin/sh
# ${MARK}：🐰 ウサギのコミットメッセージ案（案だけ。保存するかは人が決める）
# 止める：node "${SELF}" off　　このリポジトリだけ外す：node "${SELF}" uninstall .
node "${SELF}" commit-msg "$1" "$2" || true
`;

function reposIn(dir) {
  return readdirSync(dir).map((d) => join(dir, d)).filter((d) => {
    try { return statSync(d).isDirectory() && existsSync(join(d, '.git')); } catch { return false; }
  });
}
function hookPath(repo) {
  let hooks = '';
  try { hooks = git(['config', '--get', 'core.hooksPath'], { cwd: repo }); } catch { /* ふつう */ }
  if (hooks) return { path: null, why: `core.hooksPath（${hooks}）を使っているので、さわらない` };
  return { path: join(git(['rev-parse', '--absolute-git-dir'], { cwd: repo }), 'hooks', 'prepare-commit-msg') };
}

const commands = {
  // Git のフック（prepare-commit-msg）から呼ばれる
  'commit-msg'(file, source = '') {
    // -m・テンプレート・マージ・まとめ・--amend のときは、人がもう書いているので何もしない
    if (!file || source || isOff(process.cwd())) return;
    const s = suggest(readStaged(process.cwd()));
    if (!s) return;
    writeFileSync(file, render(s, readFileSync(file, 'utf8')));
  },
  suggest() {
    const s = suggest(readStaged(process.cwd()));
    if (!s) return console.log('🐰 ステージした変更がないよ（git add してから、もう一度どうぞ）');
    console.log(render(s).trimEnd());
  },
  install(...dirs) {
    const repos = dirs.length ? dirs.map((d) => resolve(d)) : reposIn(DEFAULT_PROJECTS);
    for (const repo of repos) {
      const { path, why } = hookPath(repo);
      const name = repo.split(/[\\/]/).pop();
      if (!path) { console.log(`⏭️ ${name}：${why}`); continue; }
      if (existsSync(path) && !readFileSync(path, 'utf8').includes(MARK)) {
        console.log(`⏭️ ${name}：ほかのフックがあるので、上書きしない`);
        continue;
      }
      writeFileSync(path, HOOK);
      try { chmodSync(path, 0o755); } catch { /* Windows */ }
      console.log(`🐰 ${name}：入れた`);
    }
  },
  uninstall(...dirs) {
    const repos = dirs.length ? dirs.map((d) => resolve(d)) : reposIn(DEFAULT_PROJECTS);
    for (const repo of repos) {
      const { path } = hookPath(repo);
      const name = repo.split(/[\\/]/).pop();
      if (path && existsSync(path) && readFileSync(path, 'utf8').includes(MARK)) {
        rmSync(path);
        console.log(`🧹 ${name}：外した`);
      }
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
      const { path } = hookPath(repo);
      const on = path && existsSync(path) && readFileSync(path, 'utf8').includes(MARK);
      console.log(`  ${on ? '🐰' : '・'} ${repo.split(/[\\/]/).pop()}`);
    }
  },
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!commands[cmd]) {
    console.log('使い方：node tools/tomo-agent.mjs suggest | install | uninstall | off | on | status');
    process.exit(cmd ? 1 : 0);
  }
  commands[cmd](...args);
}
