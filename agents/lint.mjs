// 🦉🐱 静的解析（工程 N-2）：コードを動かさずに、まちがい・あぶない書き方を見つける（外部パッケージなし）
//   node agents/lint.mjs [ファイル…]        ファイルを渡さなければ、Git に入っている .js / .mjs / .cjs を全部見る
//   --staged                                  ステージしたファイルだけ（コミットの前）
//   --strict                                  「まちがい」があれば終了コード 1（ふだんは知らせるだけで 0）
// 見つけるもの（形だけで、はっきり分かるもの）
//   ❌ まちがい：構文のまちがい（node --check）／eval・new Function（文字列をプログラムとして動かす）
//   ⚠️ 確かめて：document.write／文字列をつないだコマンドを exec する／import したのに使っていない名前
// HTML へのエスケープもれ（XSS）のように、データの流れを追う必要があるものは、GitHub の CodeQL にまかせる
// （形だけで見ると、知らせが多すぎて役に立たないため）
// 見本としてどうしても必要な行は、行の中に「lint:allow」と理由を書くと見のがす
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const JS = /\.(c|m)?js$/;

export function lintText(path, text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const add = (level, i, msg) => out.push({ level, path, line: i + 1, msg });

  lines.forEach((line, i) => {
    if (line.includes('lint:allow')) return;
    const code = line.replace(/\/\/.*$/, '');
    if (/(^|[^\w.$])eval\s*\(/.test(code)) add('error', i, 'eval は使わない（文字列をプログラムとして動かすと、のっとられるおそれ）');
    if (/\bnew\s+Function\s*\(/.test(code)) add('error', i, 'new Function は使わない（eval と同じ）');
    if (/\bdocument\.write\s*\(/.test(code)) add('warn', i, 'document.write は使わない');
    if (/\b(exec|execSync)\s*\(\s*`[^`]*\$\{/.test(code)) add('warn', i, 'コマンドを文字列でつながない（execFile に配列で渡す）');
  });

  // import したのに使っていない名前
  const body = lines.filter((l) => !/^\s*import\b/.test(l)).join('\n');
  for (const m of text.matchAll(/^\s*import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/gm)) {
    if (m[0].includes('lint:allow')) continue;
    const names = [];
    const spec = m[1];
    const def = spec.match(/^([A-Za-z_$][\w$]*)/);
    if (def) names.push(def[1]);
    const ns = spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) names.push(ns[1]);
    const braces = spec.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (n) names.push(n);
      }
    }
    const lineNo = text.slice(0, m.index + m[0].search(/\S/)).split('\n').length - 1;
    for (const n of names) {
      const used = new RegExp(`(^|[^\\w$])${n.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(body);
      if (!used) add('warn', lineNo, `import した「${n}」を使っていない`);
    }
  }
  return out;
}

export function lintFile(path) {
  const out = [];
  const r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (r.status !== 0) {
    const where = r.stderr.match(/:(\d+)\r?\n/);
    const msg = (r.stderr.split('\n').find((l) => /Error/.test(l)) || '構文のまちがい').trim();
    out.push({ level: 'error', path, line: where ? Number(where[1]) : 1, msg: `構文のまちがい：${msg}` });
  }
  return [...out, ...lintText(path, readFileSync(path, 'utf8'))];
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const staged = args.includes('--staged');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    const list = staged
      ? execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' })
      : execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
    files = list.split('\0').filter(Boolean);
  }
  files = files.filter((f) => JS.test(f) && existsSync(f) && statSync(f).size < 1024 * 1024
    && !/(^|\/)(node_modules|vendor)\//.test(f) && !/\.min\.js$/.test(f));

  const found = files.flatMap(lintFile);
  const errors = found.filter((x) => x.level === 'error');
  const warns = found.filter((x) => x.level === 'warn');
  for (const x of [...errors, ...warns]) console.log(`${x.level === 'error' ? '❌' : '⚠️'} ${x.path}:${x.line}  ${x.msg}`);
  if (!found.length) console.log(`🐱 ${files.length} 個のファイルを見た。気になるところはなかったぞ。`);
  else console.log(`🐱 ${files.length} 個のファイルを見た。まちがい ${errors.length}・確かめて ${warns.length}。${strict ? '' : '（いまは知らせるだけ）'}`);
  if (strict && errors.length) process.exit(1);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
