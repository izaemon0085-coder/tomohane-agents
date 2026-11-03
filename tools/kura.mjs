#!/usr/bin/env node
// 🏡 家の倉庫（工程 N-3 / A-2）：ローカル回線の Git サーバー（外部パッケージなし）
// ・Git についている「git http-backend」を使う。SSH のサーバーは要らない
// ・つなげるのは家の中（ローカル回線）の端末だけ。インターネットからは断る
// ・送る・受け取るには、合言葉（トークン）が要る
// ・🐾 モグが、インターネットがあるときに GitHub とそろえる（sync）
//
//   node tools/kura.mjs init                 倉庫を作って、合言葉を1回だけ出す
//   node tools/kura.mjs add <リポジトリ…>     倉庫に入れて、そのリポジトリに remote「kura」を足す
//   node tools/kura.mjs serve [--port 3990]   倉庫を開く（止めるのは Ctrl+C）
//   node tools/kura.mjs sync                  🐾 GitHub とそろえる（main は GitHub から受け取るだけ。ほかのブランチは GitHub へ送る）
//   node tools/kura.mjs status                倉庫の中と、家の中のアドレス
// 置き場所：KURA_HOME（ふだんは ホーム\tomohane-kura）
import http from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 3990;
const home = () => resolve(process.env.KURA_HOME || join(homedir(), 'tomohane-kura'));
const reposDir = () => join(home(), 'repos');
const configFile = () => join(home(), 'kura.json');
const logFile = () => join(home(), 'kura-log.jsonl');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const log = (entry) => { try { appendFileSync(logFile(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`); } catch { /* 記録できなくても止めない */ } };

// 家の中（ローカル回線）のアドレスか
export function isHomeAddress(addr = '') {
  const a = String(addr).replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])];
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254);
  }
  return /^(fe8|fe9|fea|feb|fc|fd)/i.test(a); // IPv6 のリンクローカル・家の中のアドレス
}
export function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((a) => a && !a.internal && a.family === 'IPv4' && isHomeAddress(a.address)).map((a) => a.address);
}

function readConfig() {
  if (!existsSync(configFile())) throw new Error('倉庫がありません。はじめに「node tools/kura.mjs init」');
  return JSON.parse(readFileSync(configFile(), 'utf8'));
}

// ---- 倉庫を開く（git http-backend をよぶ）----
export function createKuraServer({ tokenHash, root = reposDir() }) {
  const backend = join(git(['--exec-path']), process.platform === 'win32' ? 'git-http-backend.exe' : 'git-http-backend');
  const tokenOk = (given) => {
    const a = Buffer.from(sha(given), 'hex');
    const b = Buffer.from(tokenHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return http.createServer((req, res) => {
    const who = req.socket.remoteAddress;
    if (!isHomeAddress(who)) {
      log({ action: 'refused-outside', from: who, url: req.url });
      res.writeHead(403).end('家の中からだけ使えます\n');
      return;
    }
    const auth = String(req.headers.authorization || '');
    const [user, pass] = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString().split(/:(.*)/s) : [];
    if (!pass || !tokenOk(pass)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="tomohane-kura"' }).end('合言葉が要ります\n');
      return;
    }
    const url = new URL(req.url, 'http://kura');
    // 倉庫の外へは出さない
    if (!/^\/[\w.-]+\.git(\/|$)/.test(url.pathname) || url.pathname.includes('..')) {
      res.writeHead(404).end('見つかりません\n');
      return;
    }
    const env = {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] || '',
      REMOTE_USER: user || 'kura',
      REMOTE_ADDR: who,
      GIT_HTTP_MAX_REQUEST_BUFFER: '100M',
    };
    if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = req.headers['content-encoding'];
    if (req.headers['git-protocol']) env.GIT_PROTOCOL = req.headers['git-protocol'];
    const cgi = spawn(backend, [], { env });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0);
    let headerDone = false;
    cgi.stdout.on('data', (chunk) => {
      if (headerDone) { res.write(chunk); return; }
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n') >= 0 ? head.indexOf('\r\n\r\n') : head.indexOf('\n\n');
      if (end < 0) return;
      const sep = head[end] === 0x0d ? 4 : 2;
      const headers = {};
      let status = 200;
      for (const line of head.subarray(0, end).toString().split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k.toLowerCase() === 'status') status = Number(v.split(' ')[0]) || 200;
        else headers[k] = v;
      }
      res.writeHead(status, headers);
      res.write(head.subarray(end + sep));
      headerDone = true;
    });
    cgi.stdout.on('end', () => res.end());
    cgi.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    if (url.pathname.endsWith('/git-receive-pack')) {
      cgi.on('close', (code) => log({ action: 'push', from: who, repo: url.pathname.split('/')[1], ok: code === 0 }));
    }
  });
}

// ---- モグが GitHub とそろえる ----
// main：GitHub の main を受け取る（倉庫の main が GitHub より先なら、さわらずに知らせる）
// ほかのブランチ：倉庫にあって GitHub にないもの・進んでいるものを GitHub へ送る（上書きはしない）
export function syncRepo(bare, { remote = 'github', timeoutMs = 15000 } = {}) {
  const name = basename(bare);
  let url;
  try { url = git(['-C', bare, 'remote', 'get-url', remote]); } catch { return { name, skipped: 'GitHub につないでいない' }; }
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  const fetched = spawnSync('git', ['-C', bare, 'fetch', '--quiet', '--prune', remote, `+refs/heads/*:refs/remotes/${remote}/*`], { encoding: 'utf8', env, timeout: timeoutMs });
  if (fetched.status !== 0) return { name, offline: true, why: 'GitHub につながらない（家の中だけで続けられる）' };
  const out = { name, url, main: null, pushed: [], notes: [] };
  const has = (ref) => spawnSync('git', ['-C', bare, 'rev-parse', '--verify', '--quiet', ref]).status === 0;
  const isAncestor = (a, b) => spawnSync('git', ['-C', bare, 'merge-base', '--is-ancestor', a, b]).status === 0;
  if (has(`refs/remotes/${remote}/main`)) {
    if (!has('refs/heads/main') || isAncestor('refs/heads/main', `refs/remotes/${remote}/main`)) {
      git(['-C', bare, 'update-ref', 'refs/heads/main', `refs/remotes/${remote}/main`]);
      out.main = 'GitHub と同じにした';
    } else {
      out.main = '倉庫の main が GitHub より先（main は GitHub のプルリクエストで入れる）';
    }
  }
  for (const b of git(['-C', bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean)) {
    if (b === 'main') continue;
    const theirs = `refs/remotes/${remote}/${b}`;
    if (has(theirs) && isAncestor(`refs/heads/${b}`, theirs)) continue; // もう同じか、GitHub が先
    if (has(theirs) && !isAncestor(theirs, `refs/heads/${b}`)) { out.notes.push(`${b}：GitHub と分かれているので送らない`); continue; }
    const p = spawnSync('git', ['-C', bare, 'push', '--quiet', remote, `refs/heads/${b}:refs/heads/${b}`], { encoding: 'utf8', env, timeout: timeoutMs });
    if (p.status === 0) out.pushed.push(b);
    else out.notes.push(`${b}：送れなかった`);
  }
  return out;
}

const commands = {
  init() {
    mkdirSync(reposDir(), { recursive: true });
    if (existsSync(configFile())) return console.log(`🏡 倉庫はもうあります：${home()}`);
    const token = randomBytes(24).toString('base64url');
    writeFileSync(configFile(), JSON.stringify({ tokenHash: sha(token), port: DEFAULT_PORT, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(`🏡 倉庫を作った：${home()}`);
    console.log(`🔑 合言葉（いまだけ表示）：${token}`);
    console.log('   家の端末で、はじめて送る・受け取るときに聞かれます（ユーザー名は何でもよい）。人には見せない');
  },
  add(...paths) {
    readConfig();
    const ip = lanAddresses()[0] ?? '127.0.0.1';
    for (const p of paths.map((x) => resolve(x))) {
      const name = `${basename(p)}.git`;
      const bare = join(reposDir(), name);
      if (!existsSync(bare)) {
        git(['clone', '--quiet', '--bare', p, bare]);
        git(['-C', bare, 'config', 'http.receivepack', 'true']);
      }
      // GitHub のアドレスを、倉庫にも教える（モグがそろえるため）
      try {
        const gh = git(['-C', p, 'remote', 'get-url', 'origin']);
        if (/github\.com/.test(gh)) { try { git(['-C', bare, 'remote', 'add', 'github', gh]); } catch { /* もうある */ } }
      } catch { /* GitHub につないでいない（ともあい など） */ }
      try { git(['-C', bare, 'remote', 'remove', 'origin']); } catch { /* ない */ }
      const kuraUrl = `http://${ip}:${readConfig().port}/${name}`;
      try { git(['-C', p, 'remote', 'add', 'kura', kuraUrl]); } catch { git(['-C', p, 'remote', 'set-url', 'kura', kuraUrl]); }
      console.log(`🏡 ${basename(p)} を倉庫に入れた → ${kuraUrl}`);
    }
  },
  serve(...rest) {
    const cfg = readConfig();
    const i = rest.indexOf('--port');
    const port = i >= 0 ? Number(rest[i + 1]) : cfg.port;
    const server = createKuraServer({ tokenHash: cfg.tokenHash });
    server.listen(port, '0.0.0.0', () => {
      console.log(`🏡 家の倉庫を開いた（Ctrl+C で閉じる）。家の中の端末からだけ使えます`);
      for (const ip of lanAddresses()) console.log(`   http://${ip}:${port}/<名前>.git`);
      log({ action: 'open', port });
    });
  },
  sync() {
    const dirs = existsSync(reposDir()) ? readdirSync(reposDir()).filter((d) => d.endsWith('.git')) : [];
    for (const d of dirs) {
      const r = syncRepo(join(reposDir(), d));
      log({ action: 'sync', ...r });
      if (r.skipped) console.log(`・ ${r.name}：${r.skipped}`);
      else if (r.offline) console.log(`📵 ${r.name}：${r.why}`);
      else console.log(`🐾 ${r.name}：main ${r.main ?? 'なし'}${r.pushed.length ? `／GitHub へ送った：${r.pushed.join('・')}` : ''}${r.notes.length ? `／${r.notes.join('、')}` : ''}`);
    }
    if (!dirs.length) console.log('倉庫は空です（node tools/kura.mjs add <リポジトリ>）');
  },
  status() {
    const cfg = readConfig();
    console.log(`🏡 倉庫：${home()}（ポート ${cfg.port}）`);
    for (const ip of lanAddresses()) console.log(`   家の中のアドレス：http://${ip}:${cfg.port}/`);
    for (const d of readdirSync(reposDir()).filter((x) => x.endsWith('.git'))) console.log(`   ・${d}`);
  },
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (!commands[cmd]) { console.log('使い方：node tools/kura.mjs init | add | serve | sync | status'); process.exitCode = cmd ? 1 : 0; }
    else commands[cmd](...rest);
  } catch (e) {
    console.log(`❌ ${e.message}`);
    process.exitCode = 1;
  }
}
