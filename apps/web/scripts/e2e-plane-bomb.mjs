/**
 * 炸飞机端到端测试。
 * 本地：BGX_ORIGIN=http://127.0.0.1:8790 BGX_BASE_PATH= BGX_SOCKET_PATH=/socket.io node apps/web/scripts/e2e-plane-bomb.mjs
 * 线上：node apps/web/scripts/e2e-plane-bomb.mjs
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

let seq = 0;
function nextUpdate(socket, label = 'update') {
  return waitFor(socket, 'update', (m) => m?.view?.seq > seq, label);
}

function emitAction(socket, matchId, action) {
  const actionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  socket.emit('action', { t: 'action', matchId, actionId, action });
  return actionId;
}

async function act(socket, otherSocket, matchId, action, label) {
  const expected = seq + 1;
  const actorPending = waitFor(socket, 'update', (m) => m?.view?.seq >= expected, `${label} actor`);
  const otherPending = waitFor(
    otherSocket,
    'update',
    (m) => m?.view?.seq >= expected,
    `${label} other`,
  );
  const actionId = emitAction(socket, matchId, action);
  const errorPromise = waitFor(socket, 'error', (m) => m.actionId === actionId, `${label} error`).then(
    (m) => {
      throw new Error(`${label} rejected: ${m.code} ${m.message}`);
    },
  );
  const [actorMessage, otherMessage] = await Promise.race([
    Promise.all([actorPending, otherPending]),
    errorPromise,
  ]);
  seq = actorMessage.view.seq;
  return { actor: actorMessage, other: otherMessage };
}

async function joinRoom(socket, matchId) {
  const snapshotPromise = waitFor(socket, 'snapshot', (m) => m?.view?.matchId === matchId);
  socket.emit('join', { t: 'join', matchId });
  const snapshot = (await snapshotPromise).view;
  seq = Math.max(seq, snapshot.seq);
  return snapshot;
}

function findShotQueued(events) {
  return (events ?? []).find((e) => e.type === 'shot_queued');
}

const A_PLACES = [
  { cockpit: 22, orientation: 0 }, // C3 朝上
  { cockpit: 7, orientation: 0 }, // H1 朝上
  { cockpit: 92, orientation: 2 }, // C10 朝下
];
const B_PLACES = [
  { cockpit: 92, orientation: 2 }, // C10 朝下
  { cockpit: 39, orientation: 1 }, // J4 朝右
  { cockpit: 66, orientation: 3 }, // G7 朝左
];

async function main() {
  const games = (await api('/api/games')).data.games;
  check('games 列表包含炸飞机', games.some((g) => g.id === 'plane-bomb' && g.maxPlayers === 2));

  const a = await api('/api/me');
  const b = await api('/api/me');
  check('两个游客 session 建立', !!a.sid && !!b.sid && a.sid !== b.sid);

  const created = await api('/api/matches', {
    method: 'POST',
    cookie: a.sid,
    body: { gameId: 'plane-bomb', visibility: 'public' },
  });
  const matchId = created.data.match.id;
  check('创建炸飞机房间', created.data.match.gameId === 'plane-bomb' && created.data.match.status === 'waiting');

  const joined = await api(`/api/matches/${matchId}/join`, { method: 'POST', cookie: b.sid });
  check('第二个玩家加入后等待房主开始', joined.data.match.status === 'waiting' && joined.data.match.playerCount === 2);
  const started = await api(`/api/matches/${matchId}/start`, { method: 'POST', cookie: a.sid });
  check('房主开始后进入布阵', started.data.match.status === 'active');

  const socketA = await connect(a.sid);
  const socketB = await connect(b.sid);
  const snapA = await joinRoom(socketA, matchId);
  const snapB = await joinRoom(socketB, matchId);
  check('A 入座 0 且处于布阵', snapA.you.seat === 0 && snapA.game.phase === 'placing');
  check('B 入座 1 且看不到对方舰队', snapB.you.seat === 1 && snapB.game.mine.planes.length === 0);

  const spectator = await api('/api/me');
  const socketC = await connect(spectator.sid);
  const snapC = await joinRoom(socketC, matchId);
  check(
    '观战者看不到双方舰队',
    snapC.you.spectator === true &&
      snapC.game.mine === null &&
      snapC.game.enemy === null &&
      snapC.game.spectate.boards.length === 2 &&
      !JSON.stringify(snapC).includes('"fleets"') &&
      !JSON.stringify(snapC).includes('"pending"'),
  );

  const overlap = emitAction(socketA, matchId, {
    type: 'place',
    planes: [
      { cockpit: 22, orientation: 0 },
      { cockpit: 23, orientation: 0 },
      { cockpit: 82, orientation: 2 },
    ],
  });
  const overlapError = await waitFor(socketA, 'error', (m) => m.actionId === overlap, 'overlap error');
  check('重叠布阵被拒绝', overlapError.code === 'invalid_placement', overlapError.code);

  const afterPlaceA = await act(socketA, socketB, matchId, { type: 'place', planes: A_PLACES }, 'A place');
  check('A 提交后仍等 B 布阵', afterPlaceA.actor.view.game.phase === 'placing' && afterPlaceA.actor.view.game.placed[0] === true);
  check('A 的视图不含秘密字段', !JSON.stringify(afterPlaceA.actor.view).includes('"fleets"') && !JSON.stringify(afterPlaceA.actor.view).includes('"pending"'));

  const afterPlaceB = await act(socketB, socketA, matchId, { type: 'place', planes: B_PLACES }, 'B place');
  check('双方布阵后开战且 round=1', afterPlaceB.actor.view.game.phase === 'battle' && afterPlaceB.actor.view.game.round === 1);
  check('开战后 A 视图拿到自己的三架飞机', afterPlaceB.other.view.game.mine.planes.length === 3);

  const aShot1 = await act(socketA, socketB, matchId, { type: 'fire', cell: 92 }, 'A fire 1');
  check('A 报点后 pendingShots=[true,false]', aShot1.actor.view.game.pendingShots[0] === true && aShot1.actor.view.game.pendingShots[1] === false);
  check('A 能看到自己报的格子', aShot1.actor.view.game.myShot === 92);
  const queued = findShotQueued(aShot1.actor.events);
  check('shot_queued 事件不带格子', !!queued && !('cell' in queued), JSON.stringify(queued));

  check('B 看得到 A 已报点但看不到格子', aShot1.other.view.game.pendingShots[0] === true && aShot1.other.view.game.myShot === null);
  check('结算前 B 的棋盘没有被炸', aShot1.other.view.game.mine.incoming[92] === 0);

  const dup = emitAction(socketA, matchId, { type: 'fire', cell: 39 });
  const dupError = await waitFor(socketA, 'error', (m) => m.actionId === dup, 'dup error');
  check('本轮重复报点被拒绝', dupError.code === 'already_queued', dupError.code);

  const bShot1 = await act(socketB, socketA, matchId, { type: 'fire', cell: 0 }, 'B fire 1');
  check('双方报点后同时结算，round 前进到 2', bShot1.actor.view.game.round === 2 && bShot1.actor.view.game.pendingShots[1] === false);
  check('A 视图击落 B 第一架机头', bShot1.other.view.game.enemy.down === 1);
  check('本轮战报包含两炮', bShot1.actor.view.game.lastRound?.shots.length === 2);
  check('B 的 miss 落在 A 棋盘', bShot1.other.view.game.mine.incoming[0] === 1);

  const aShot2 = await act(socketA, socketB, matchId, { type: 'fire', cell: 82 }, 'A fire body');
  const bShot2 = await act(socketB, socketA, matchId, { type: 'fire', cell: 1 }, 'B fire 2');
  check('已击落飞机机身仍算命中', bShot2.other.view.game.lastRound?.shots.find((s) => s.seat === 0)?.result === 'body');
  check('机身命中不增加击落数', bShot2.other.view.game.enemy.down === 1 && bShot2.other.view.game.enemy.marks[82] === 2);
  void aShot2;

  await act(socketA, socketB, matchId, { type: 'fire', cell: 39 }, 'A fire 2');
  const bShot3 = await act(socketB, socketA, matchId, { type: 'fire', cell: 2 }, 'B fire 3');
  check('击落第二架', bShot3.other.view.game.enemy.down === 2);

  await act(socketA, socketB, matchId, { type: 'fire', cell: 66 }, 'A fire 3');
  const bShot4 = await act(socketB, socketA, matchId, { type: 'fire', cell: 3 }, 'B fire 4');
  check('第三架击落后结束', bShot4.actor.view.status === 'finished' && bShot4.actor.view.game.finished);
  check('座位 0 获胜', bShot4.actor.view.winner === 0 && bShot4.actor.view.game.winner === 0);
  check('终局公开双方舰队', bShot4.actor.view.game.reveal?.length === 2);
  check('终局视图仍不含 fleets/pending 字段', !JSON.stringify(bShot4.actor.view).includes('"fleets"') && !JSON.stringify(bShot4.actor.view).includes('"pending"'));

  socketA.close();
  socketB.close();
  socketC.close();

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nALL PLANE BOMB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
