/**
 * 端到端冒烟测试（线上路径 https://thinktwice.top/bgx/）
 * 用法：NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/e2e-smoke.mjs
 */
import { io } from 'socket.io-client';

const ORIGIN = process.env.BGX_ORIGIN ?? 'https://thinktwice.top';
const BASE_PATH = process.env.BGX_BASE_PATH ?? '/bgx';
const SOCKET_PATH = process.env.BGX_SOCKET_PATH ?? '/bgx/socket.io';
const BASE = `${ORIGIN}${BASE_PATH}`;

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
  if (!ok) failures++;
}

async function api(path, { method = 'GET', cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  const sid = setCookie.find((c) => c.startsWith('bgx_sid='))?.split(';')[0];
  return { data, sid };
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(ORIGIN, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 10000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitFor(socket, event, predicate = () => true, label = event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${label}`)), 8000);
    const handler = (msg) => {
      if (!predicate(msg)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(msg);
    };
    socket.on(event, handler);
  });
}

async function joinRoom(socket, matchId) {
  const snapshotPromise = waitFor(socket, 'snapshot', (m) => m?.view?.matchId === matchId);
  socket.emit('join', { t: 'join', matchId });
  return (await snapshotPromise).view;
}

function emitAction(socket, matchId, action) {
  const actionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  socket.emit('action', { t: 'action', matchId, actionId, action });
  return actionId;
}

async function expectError(fn, status) {
  try {
    await fn();
    return false;
  } catch (err) {
    return String(err?.message ?? '').includes(`-> ${status}`);
  }
}

async function main() {
  console.log(`# BGX smoke @ ${BASE}`);
  const skipStatic = process.env.BGX_SKIP_STATIC === '1';

  // 静态资源
  if (!skipStatic) {
  const home = await fetch(`${BASE}/`);
  check('GET /bgx/ 返回 HTML', home.ok && (await home.text()).includes('<div id="root">'));
  check('index.html 不缓存', (home.headers.get('cache-control') ?? '').includes('no-cache'));
  const html = await (await fetch(`${BASE}/`)).text();
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  const assetRes = await fetch(`${ORIGIN}${asset}`);
  check('入口 JS 可访问', !!asset && assetRes.ok, asset ?? '');
  check(
    'assets 长缓存',
    (assetRes.headers.get('cache-control') ?? '').includes('immutable'),
    assetRes.headers.get('cache-control') ?? '',
  );

  // SPA 深链接
  const deep = await fetch(`${BASE}/m/does-not-exist`);
  const deepHtml = await deep.text();
  check('SPA 深链接回退 index.html', deep.ok && deepHtml.includes('<div id="root">'));
  }

  // 两个匿名用户
  const a = await api('/api/me');
  const b = await api('/api/me');
  check('两个用户拿到不同 session', !!a.sid && !!b.sid && a.sid !== b.sid);
  const a2 = await api('/api/me', { cookie: a.sid });
  check('同一 Cookie 返回同一用户', a2.data?.user?.id === a.data?.user?.id);

  // 创建房间 + 加入
  const created = await api('/api/matches', {
    method: 'POST',
    cookie: a.sid,
    body: { gameId: 'reversi', visibility: 'public' },
  });
  const matchId = created.data.match.id;
  check('创建房间', created.data.match.status === 'waiting', matchId);

  const waitingSocket = await connect(a.sid);
  const waitingView = await joinRoom(waitingSocket, matchId);
  check(
    '等待阶段不初始化游戏状态',
    waitingView.status === 'waiting' && waitingView.game === null && waitingView.canResign === false,
  );
  waitingSocket.close();

  const listed = await api('/api/matches');
  check(
    '公开房间出现在大厅',
    listed.data.matches.some((m) => m.id === matchId),
  );

  const joined = await api(`/api/matches/${matchId}/join`, { method: 'POST', cookie: b.sid });
  check('第二名玩家加入后仍等待房主开始', joined.data.match.status === 'waiting' && joined.data.match.playerCount === 2);
  const started = await api(`/api/matches/${matchId}/start`, { method: 'POST', cookie: a.sid });
  check('房主点击开始后进入对局', started.data.match.status === 'active');

  // 两个玩家接入 websocket
  const sa = await connect(a.sid);
  const sb = await connect(b.sid);
  const va = await joinRoom(sa, matchId);
  const vb = await joinRoom(sb, matchId);
  check('玩家 A 收到 snapshot', va?.you?.seat === 0 && va.game?.board.filter(Boolean).length === 4 && va.canResign === true);
  check('玩家 B 收到 snapshot', vb?.you?.seat === 1);
  check('黑棋先手，只有 A 有合法点', va.game.legal.length === 4 && vb.game.legal.length === 0);

  // A 落子，双方都应收到 update（开局本身已占一个 seq）
  const seq0 = va.seq;
  const updateA = waitFor(sa, 'update', (m) => m.view?.seq === seq0 + 1);
  const updateB = waitFor(sb, 'update', (m) => m.view?.seq === seq0 + 1);
  const actionId = emitAction(sa, matchId, { type: 'move', cell: va.game.legal[0] });
  const [ua, ub] = await Promise.all([updateA, updateB]);
  check(`A 落子后双方收到 seq=${seq0 + 1}`, ua.view.seq === seq0 + 1 && ub.view.seq === seq0 + 1);
  check('棋盘更新：黑子+2', ub.view.game.scores.black === 4 && ub.view.game.scores.white === 1);
  check('轮到 B，且 B 拿到合法点', ub.view.currentSeat === 1 && ub.view.game.legal.length > 0);

  // 幂等：重复提交同一 actionId 不应产生新事件
  let dupUpdate = null;
  const dupListener = (msg) => {
    dupUpdate = msg;
  };
  sb.on('update', dupListener);
  sa.emit('action', { t: 'action', matchId, actionId, action: { type: 'move', cell: va.game.legal[0] } });
  await new Promise((r) => setTimeout(r, 500));
  sb.off('update', dupListener);
  check('重复 actionId 不重复执行', dupUpdate === null);

  // B 落子
  const updateB2 = waitFor(sb, 'update', (m) => m.view?.seq === seq0 + 2);
  emitAction(sb, matchId, { type: 'move', cell: ub.view.game.legal[0] });
  const u2 = await updateB2;
  check(`B 落子后 seq=${seq0 + 2}`, u2.view.seq === seq0 + 2 && u2.view.currentSeat === 0);

  // 聊天
  const chatA = waitFor(sa, 'chat', (m) => m.message?.body === 'hello from A');
  const chatB = waitFor(sb, 'chat', (m) => m.message?.body === 'hello from A');
  sa.emit('chat', { t: 'chat', matchId, text: 'hello from A' });
  const [ca, cb] = await Promise.all([chatA, chatB]);
  check('聊天广播给双方', ca.message.body === cb.message.body && ca.message.name === a.data.user.name);

  // 观战者
  const c = await api('/api/me');
  const spectatorSocket = await connect(c.sid);
  const vc = await joinRoom(spectatorSocket, matchId);
  check('观战者进入房间', vc.you.spectator === true && vc.game.legal.length === 0);
  check('观战者看到相同棋盘', JSON.stringify(vc.game.board) === JSON.stringify(u2.view.game.board));

  // 认输
  const overA = waitFor(sa, 'update', (m) => m.view?.status === 'finished');
  const overB = waitFor(sb, 'update', (m) => m.view?.status === 'finished');
  emitAction(sb, matchId, { type: 'resign' });
  const [oa] = await Promise.all([overA, overB]);
  check('认输结束对局，黑方获胜', oa.view.winner === 0 && oa.view.status === 'finished');

  // 再来一局
  const rematchA = waitFor(sa, 'rematch');
  const rematchB = waitFor(sb, 'rematch');
  const rematch = await api(`/api/matches/${matchId}/rematch`, { method: 'POST', cookie: a.sid });
  const [ra, rb] = await Promise.all([rematchA, rematchB]);
  check('再来一局广播给双方', ra.matchId === rematch.data.matchId && rb.matchId === ra.matchId);
  const fresh = await api(`/api/matches/${ra.matchId}`, { cookie: a.sid });
  check('再来一局保留座位但等待开始', fresh.data.match.status === 'waiting' && fresh.data.match.playerCount === 2);
  const freshStarted = await api(`/api/matches/${ra.matchId}/start`, { method: 'POST', cookie: a.sid });
  check('再来一局由房主开始', freshStarted.data.match.status === 'active');

  // 私密房间不出现在大厅
  const priv = await api('/api/matches', {
    method: 'POST',
    cookie: a.sid,
    body: { gameId: 'reversi', visibility: 'private' },
  });
  const listed2 = await api('/api/matches');
  check(
    '私密房间不在大厅展示',
    !listed2.data.matches.some((m) => m.id === priv.data.match.id),
  );

  /* ----------------------------- 账号 ---------------------------- */
  const cSess = await api('/api/me');
  check('新访客是未注册身份', cSess.data.user.username === null);

  const uname = `smoke_${Date.now().toString(36)}`;
  const pw = 'smoke-pass-123';
  const reg = await api('/api/auth/register', {
    method: 'POST',
    cookie: cSess.sid,
    body: { username: uname, password: pw },
  });
  check('注册成功并返回用户名', reg.data.user.username === uname);
  check('注册保留原游客用户 id', reg.data.user.id === cSess.data.user.id);
  const afterReg = await api('/api/me', { cookie: cSess.sid });
  check(
    '注册后会话仍是同一账号',
    afterReg.data.user.username === uname && afterReg.data.user.id === cSess.data.user.id,
  );

  const other = await api('/api/me');
  const dup = await expectError(
    () =>
      api('/api/auth/register', {
        method: 'POST',
        cookie: other.sid,
        body: { username: uname, password: 'another-pass-123' },
      }),
    409,
  );
  check('重复用户名被拒绝', dup);

  const badLogin = await expectError(
    () =>
      api('/api/auth/login', {
        method: 'POST',
        cookie: other.sid,
        body: { username: uname, password: 'wrong-password-123' },
      }),
    401,
  );
  check('错误密码登录被拒绝', badLogin);

  const login = await api('/api/auth/login', {
    method: 'POST',
    cookie: other.sid,
    body: { username: uname, password: pw },
  });
  check('正确密码登录成功', login.data.user.id === reg.data.user.id);
  check('登录后换发了新 session', login.sid !== other.sid && !!login.sid);
  const meOnOther = await api('/api/me', { cookie: login.sid });
  check('登录后新会话得到同一账号', meOnOther.data.user.id === reg.data.user.id);

  const out = await api('/api/auth/logout', { method: 'POST', cookie: login.sid });
  check('退出后变成新的游客', out.data.user.username === null && out.data.user.id !== reg.data.user.id);

  sa.disconnect();
  sb.disconnect();
  spectatorSocket.disconnect();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});
