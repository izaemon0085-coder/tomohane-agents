// 🐰 ウサギのコミットメッセージ案（工程 N-1 (a)：オフライン・決まりで作る）
// コミットするとき、ステージした変更を読んで、コミットメッセージの「案」を作る。
// ・1行目は英語（いつもの書き方：Add / Update / Fix / Remove / Rename / Test / Document …）
// ・本文は、変えたファイルと増えた関数
// ・合言葉らしいものがあれば、🦉 フクロウの注意をコメントで付ける
// 人はエディタで見て、直してから保存する。案のまま勝手に保存はしない。AI は使わない（電波なしでも動く）
import { execFileSync } from 'node:child_process';
import { riskyLine, riskyFile } from './owl-check.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// ステージした変更を読む
export function readStaged(cwd = process.cwd()) {
  const files = git(cwd, 'diff', '--cached', '--name-status', '-M').split('\n').filter(Boolean).map((l) => {
    const [status, ...paths] = l.split('\t');
    return { status: status[0], path: paths.at(-1), from: paths.length > 1 ? paths[0] : null };
  });
  const counts = Object.fromEntries(git(cwd, 'diff', '--cached', '--numstat', '-M').split('\n').filter(Boolean).map((l) => {
    const [add, del, ...p] = l.split('\t');
    const path = p.join('\t').replace(/^.*\{.* => (.*)\}.*$/, (m, x) => m.replace(/\{.* => (.*)\}/, x)).replace(/^.* => /, '');
    return [path, { add: Number(add) || 0, del: Number(del) || 0 }];
  }));
  // 足した行（関数の名前とフクロウのため）
  // 消した行もとっておく（中身を直しただけの関数を「新しい」と数えないため）
  const added = {};
  const removed = {};
  let current = null;
  for (const line of git(cwd, 'diff', '--cached', '-U0', '-M').split('\n')) {
    if (line.startsWith('diff --git')) { current = null; continue; }
    if (line.startsWith('--- ')) continue;
    if (line.startsWith('+++ ')) { current = line.slice(6); added[current] = []; removed[current] = []; continue; }
    if (!current) continue;
    if (line.startsWith('+')) added[current].push(line.slice(1));
    else if (line.startsWith('-')) removed[current].push(line.slice(1));
  }
  return files.map((f) => ({ ...f, ...(counts[f.path] ?? { add: 0, del: 0 }), added: added[f.path] ?? [], removed: removed[f.path] ?? [] }));
}

const FUNC = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
];
const isTest = (p) => /(^|\/)(test|tests|__tests__)\/|\.test\.[cm]?js$/.test(p);
const isDoc = (p) => /\.(md|txt)$/i.test(p);
const isCi = (p) => p.startsWith('.github/');

function topicOf(path) {
  const parts = path.split('/');
  const base = parts.at(-1).replace(/\.[^.]+$/, '').replace(/\.test$/, '');
  if (['index', 'README', 'app', 'main'].includes(base) && parts.length > 1) return parts.at(-2);
  return base;
}

// 案を作る（files は readStaged の形）
export function suggest(files) {
  if (!files.length) return null;
  const st = new Set(files.map((f) => f.status));
  const paths = files.map((f) => f.path);
  let verb = 'Update';
  if (st.size === 1 && st.has('A')) verb = 'Add';
  else if (st.size === 1 && st.has('D')) verb = 'Remove';
  else if (st.size === 1 && st.has('R')) verb = 'Rename';
  else if (paths.every(isTest)) verb = 'Test';
  else if (paths.every(isDoc)) verb = 'Document';
  else if (paths.every(isCi)) verb = 'Update GitHub checks:';

  const topics = [...new Set(files.filter((f) => !isTest(f.path) || paths.every(isTest)).map((f) => topicOf(f.path)))];
  const what = topics.length <= 3 ? topics.join(', ') : `${topics.slice(0, 2).join(', ')} and ${topics.length - 2} more`;
  // 新しい関数：足した行にあって、消した行にはない名前（中身を直しただけの関数は数えない）
  // 外から使える（export した）関数を先に。テストの中の関数は数えない
  const namesIn = (lines, exportedOnly) => lines
    .filter((line) => !exportedOnly || /^\s*export\s/.test(line))
    .flatMap((line) => FUNC.map((re) => line.match(re)?.[1]).filter(Boolean));
  const collect = (exportedOnly) => {
    const out = [];
    for (const f of files.filter((x) => !isTest(x.path))) {
      const before = new Set(namesIn(f.removed ?? [], false));
      for (const name of namesIn(f.added, exportedOnly)) if (!before.has(name) && !out.includes(name)) out.push(name);
    }
    return out;
  };
  const exported = collect(true);
  const funcs = exported.length ? exported : collect(false);
  let subject = `${verb} ${what}`.replace(/\s+/g, ' ').trim();
  if (funcs.length) subject += ` (${funcs.slice(0, 3).join(', ')}${funcs.length > 3 ? ', …' : ''})`;
  if (subject.length > 72) subject = `${subject.slice(0, 71)}…`;

  const MARK = { A: '足した', M: '変えた', D: '消した', R: '名前を変えた' };
  const body = files.map((f) => `- ${f.path}：${MARK[f.status] ?? '変えた'}${f.from ? `（もとは ${f.from}）` : ''}（+${f.add} −${f.del}）`);
  if (funcs.length) body.push(`- 新しい関数：${funcs.slice(0, 6).join('、')}${funcs.length > 6 ? ` ほか ${funcs.length - 6} 個` : ''}`);

  // フクロウの注意（コメントなので、保存すると消える）
  const warnings = [];
  for (const f of files) {
    const bf = riskyFile(f.path);
    if (bf && f.status !== 'D') warnings.push(`${f.path}：${bf}は入れないでくだされ`);
    f.added.forEach((line) => {
      const bad = riskyLine(line);
      if (bad) warnings.push(`${f.path}：${bad}のようなものがあります`);
    });
  }
  return { subject, body, warnings };
}

// コミットメッセージのファイルの、先頭に案を書く（git のコメント「#」の行はそのまま残す）
export function render(s, existing = '') {
  const lines = [
    s.subject,
    '',
    ...s.body,
    '',
    '# 🐰 ウサギの案だよ。直してから保存してね（「なぜ変えたか」を1行足すと、あとで読む人が助かるよ）',
    '# 　このまま保存しても大丈夫。やめるときは、全部消して保存すると、コミットしないで終わるよ',
    ...s.warnings.map((w) => `# 🦉 フクロウ：${w}。コミットする前に消してくだされ`),
  ];
  return `${lines.join('\n')}\n${existing}`;
}
