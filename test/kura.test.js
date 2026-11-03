import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKuraServer, isHomeAddress, syncRepo } from '../tools/kura.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/kura.mjs', import.meta.url));
// パスワードの窓（Git の askpass・資格情報マネージャー）を出さない。出ると、テストが待ったままになる
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: '', SSH_ASKPASS: '' };
// サーバーと同じ中で動かすので、git は「待たない」形で呼ぶ
const git = (cwd, ...a) => run('git', ['-c', 'credential.helper=', '-c', 'core.askPass=', ...a], { cwd, env: gitEnv }).then((r) => r.stdout.trim());
const gitSync = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: gitEnv }).trim();
const ident = (cwd) => { gitSync(cwd, 'config', 'user.email', 'kura@example.com'); gitSync(cwd, 'config', 'user.name', 'kura'); };

test('家の中のアドレスだけ通す', () => {
  for (const a of ['127.0.0.1', '::1', '192.168.188.172', '::ffff:192.168.1.5', '10.0.0.3', '172.20.1.1', 'fe80::1', 'fd12::3']) assert.ok(isHomeAddress(a), a);
  for (const a of ['8.8.8.8', '59.132.250.213', '172.32.0.1', '2001:4860::8888', '']) assert.ok(!isHomeAddress(a), a);
});

test('🏡 2台目の端末：倉庫から受け取って、直して送る。合言葉がないと断る。🐾 モグが GitHub とそろえる', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kura-'));
  const env = { ...gitEnv, KURA_HOME: join(root, 'kura') };
  const tool = (...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: 'utf8', env });
  let server;
  try {
    // 1台目（このパソコン）のリポジトリと、にせの GitHub
    const pc1 = join(root, 'pc1', 'app');
    mkdirSync(pc1, { recursive: true });
    gitSync(pc1, 'init', '-q', '-b', 'main');
    ident(pc1);
    writeFileSync(join(pc1, 'app.js'), 'console.log(1);\n');
    gitSync(pc1, 'add', '-A');
    gitSync(pc1, 'commit', '-q', '-m', 'first');
    const github = join(root, 'github', 'app.git');
    gitSync(root, 'clone', '-q', '--bare', pc1, github);

    // 倉庫を作って入れる
    const init = tool('init');
    const token = init.stdout.match(/合言葉（いまだけ表示）：(\S+)/)[1];
    assert.match(tool('add', pc1).stdout, /倉庫に入れた/);
    const bare = join(root, 'kura', 'repos', 'app.git');
    gitSync(bare, 'remote', 'add', 'github', github);
    const cfg = JSON.parse(readFileSync(join(root, 'kura', 'kura.json'), 'utf8'));
    assert.ok(!JSON.stringify(cfg).includes(token), '合言葉そのものは保存しない');

    server = createKuraServer({ tokenHash: cfg.tokenHash, root: join(root, 'kura', 'repos') });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/app.git`;
    const withToken = `http://pc2:${token}@127.0.0.1:${port}/app.git`;

    // 合言葉なし・ちがう合言葉は断る
    await assert.rejects(git(root, 'ls-remote', url));
    await assert.rejects(git(root, 'ls-remote', `http://pc2:wrong@127.0.0.1:${port}/app.git`));

    // 2台目の端末：受け取る → 直す → 送る（ブランチと main）
    const pc2 = join(root, 'pc2');
    await git(root, 'clone', '-q', withToken, pc2);
    ident(pc2);
    assert.equal(readFileSync(join(pc2, 'app.js'), 'utf8'), 'console.log(1);\n');
    await git(pc2, 'checkout', '-q', '-b', 'feature/map');
    writeFileSync(join(pc2, 'map.js'), 'export const map = 1;\n');
    await git(pc2, 'add', '-A');
    await git(pc2, 'commit', '-q', '-m', 'Add map');
    await git(pc2, 'push', '-q', 'origin', 'feature/map');
    assert.match(gitSync(bare, 'log', '--oneline', 'feature/map'), /Add map/);

    // 🐾 GitHub とそろえる：倉庫のブランチは GitHub へ。GitHub の main が進んでいれば、倉庫も合わせる
    const pcGh = join(root, 'pc-gh');
    gitSync(root, 'clone', '-q', github, pcGh);
    ident(pcGh);
    writeFileSync(join(pcGh, 'README.md'), 'merged on GitHub\n');
    gitSync(pcGh, 'add', '-A');
    gitSync(pcGh, 'commit', '-q', '-m', 'Merge on GitHub');
    gitSync(pcGh, 'push', '-q', 'origin', 'main');
    const s = syncRepo(bare);
    assert.equal(s.main, 'GitHub と同じにした');
    assert.deepEqual(s.pushed, ['feature/map']);
    assert.match(gitSync(github, 'log', '--oneline', 'feature/map'), /Add map/);
    assert.match(gitSync(bare, 'log', '--oneline', '-1', 'main'), /Merge on GitHub/);

    // インターネットが切れたとき（GitHub に届かない）：止まらずに知らせるだけ
    gitSync(bare, 'remote', 'set-url', 'github', join(root, 'no-such-github.git'));
    assert.equal(syncRepo(bare).offline, true);
  } finally {
    server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
