# 炸飞机（Plane Bomb）· 技术接口文档

- 版本：v1.1（设计稿，同时报点）
- 状态：只写文档，不改代码
- 配套文档：[规则文档](plane-bomb-rules.md)
- 目标：在**不改动现有 `GameEngine` 契约**、不改动 `matches.ts` / `realtime.ts` / 鉴权与房间逻辑的前提下，以纯增量的方式接入第二个游戏。

---

## 0. 设计约束

1. **复用现有引擎契约**，不新增框架能力。现有契约（`apps/server/src/games/types.ts`）已经够用：

   ```ts
   export interface GameEngine<S = unknown, V = GameView> {
     readonly meta: GameMeta;
     setup(playerCount: number): S;
     reduce(state: S, seat: number, action: GameAction, ctx: { now: number }): ReduceResult<S>;
     view(state: S, viewerSeat: number | null, active: boolean): V;
     finished(state: S): boolean;
     winner(state: S): number | null;
     turn(state: S): number | null;
   }
   ```

2. **纯函数**：`reduce` 不读数据库、不发网络消息、不取当前时间、不取随机数、不改入参。
3. **隐藏信息只在服务端**：对方的飞机位置绝不能出现在任何下发给客户端的数据里；`view()` 是唯一的出口。
4. **状态可 JSON 序列化**：`matches.state` 是 TEXT，直接 `JSON.stringify` 整个状态；不能出现 `Map` / `Set` / `undefined` / 函数 / `BigInt`。
5. **确定性**：不依赖随机数；双方同轮同时报点、同时结算，相同状态 + 相同动作序列必然得到相同结果，方便测试与重放。
6. **事件不泄密**：`bus` 的 `update` 事件是**整个房间广播同一份 events**（见 `realtime.ts`），所以事件里不能带对方飞机的秘密信息。

---

## 1. 现状与接入点

当前只有黑白棋：

| 位置 | 现状 |
| --- | --- |
| `packages/protocol/src/index.ts` | `GAME_IDS = ['reversi']`；`GameView = ReversiGameView`；`GameAction = ReversiAction`；`gameActionSchema` 是 `move` / `resign` 的 discriminated union |
| `apps/server/src/index.ts` | `registerGame(reversi)` |
| `apps/server/src/http.ts` | `POST /api/matches` 的 `gameId` 是任意字符串，未知 id 由 `getGame()` 抛 `game_not_found` 404 |
| `apps/server/src/matches.ts` | 创建房间时 `engine.setup(engine.meta.maxPlayers)`；`currentSeat = active ? engine.turn(state) : null`（炸飞机的 `turn()` 恒为 null，所以 `currentSeat` 也恒为 null）；`view = engine.view(state, viewerSeat, active)` |
| `apps/server/src/realtime.ts` | 每个连接按自己的 `userId` 重新 `buildView`，然后 emit `update`；动作经 `clientMessageSchema` 校验后交给 `matches.applyAction` |
| `apps/web/src` | 大厅硬编码 `createMatch('reversi', ...)` 与 `<Board view={view.game} />`，只认识黑白棋 |

**注意**：`active` 参数表示 **match 状态为 `active`**（房间坐满 2 人），布阵阶段 `active` 已经是 `true`。所以引擎不能把 `active` 当作“已经开打”来用，必须看自己的 `phase`。

---

## 2. 改动清单（实现阶段，本次不做）

全部为新增或加法修改，不改变已有行为：

### 2.1 `packages/protocol/src/index.ts`

```ts
// 1) 游戏目录
export const GAME_IDS = ['reversi', 'plane-bomb'] as const;

// 2) 新增视图并并入联合
export interface PlaneBombGameView { /* 见第 6 节 */ }
export type GameView = ReversiGameView | PlaneBombGameView;

// 3) 新增动作并并入联合
export type PlaneBombAction =
  | {
      type: 'place';
      planes: [PlanePlacementInput, PlanePlacementInput, PlanePlacementInput];
    }
  | { type: 'fire'; cell: number }
  | { type: 'resign' };
export type GameAction = ReversiAction | PlaneBombAction;

// 4) 在现有 discriminatedUnion 里追加选项（resign 已存在，不要再加一次，重复 literal 会让 zod 在模块加载时抛错）
const planePlacementSchema = z.object({
  cockpit: z.number().int().min(0).max(99),
  orientation: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), cell: z.number().int().min(0).max(63) }),
  z.object({ type: z.literal('resign') }),
  z.object({
    type: z.literal('place'),
    planes: z.tuple([planePlacementSchema, planePlacementSchema, planePlacementSchema]),
  }),
  z.object({ type: z.literal('fire'), cell: z.number().int().min(0).max(99) }),
]);
```

> `gameActionSchema` 是**所有游戏共用**的入站校验。`place` / `fire` 的字段名与 `move` 不冲突，黑白棋引擎收到 `place` 会走 `action.type !== 'move'` → `bad_action`，反之炸飞机引擎收到 `move` 也会拒绝，互不影响。

### 2.2 新增引擎

| 文件 | 内容 |
| --- | --- |
| `apps/server/src/games/plane-bomb.ts` | 状态机、形状计算、校验、投影 |
| `apps/server/src/games/plane-bomb.test.ts` | 单元测试（见第 12 节） |

### 2.3 注册

`apps/server/src/index.ts`：

```ts
import { planeBomb } from './games/plane-bomb.js';
registerGame(reversi);
registerGame(planeBomb);
```

`GET /api/games` 会自动多出一条，`POST /api/matches` 传 `'plane-bomb'` 即可建房，不需要改路由。

### 2.4 Web（后续单独做）

- `Lobby` 增加游戏选择（现在只有黑白棋一张卡，创建按钮硬编码 `'reversi'`）。
- `MatchPage` 按 `view.gameId` 选择游戏组件；新增 `games/plane-bomb/` 下的布阵盘与对战盘。
- `Board.tsx` 保持黑白棋专用，不复用（棋盘语义完全不同）。
- 由于 `GameView` 是联合类型且没有公共判别字段，建议在 web 侧写 `isPlaneBombView(view: MatchView): view is ...` 或直接 `if (view.gameId === 'plane-bomb')` 后断言；不要为了判别去改现有的 `ReversiGameView`。

---

## 3. 元数据

```ts
const META: GameMeta = {
  id: 'plane-bomb',
  name: '炸飞机',
  tagline: '秘密布阵，同轮对轰，击落对方三架飞机者胜（同轮 3:3 平局）',
  minPlayers: 2,
  maxPlayers: 2,
};
```

房间仍是 2 人；`setup(playerCount)` 只接受 2，其他值直接 `throw new Error('plane-bomb requires 2 players')`（正常路径不会发生）。

---

## 4. 对局状态机

```text
房间 waiting（1 人）
   │ 第 2 人 join（matches.joinMatch 把 match 置为 active，并发 match_started）
   ▼
phase = placing（双方各自布阵，无回合、无先后手）
   │ 双方都提交 place
   ▼
phase = battle，round = 1（双方同一轮各报一炮）
   │ 第一方 fire → pending[seat] = cell，等待
   │ 第二方 fire → 同时结算两炮，round + 1
   │ 一方击落数达到 3
   ▼
phase = finished（winner = 达到 3 的一方；双方同轮都到 3 → winner = null，平局）
```

- **match 状态**与 **game phase** 不是一回事：

  | match.status | game.phase | 含义 |
  | --- | --- | --- |
  | `waiting` | `placing` | 只有房主，等人 |
  | `active` | `placing` | 两人已到齐，正在布阵 |
  | `active` | `battle` | 双方布好，对战中（可能一方已报点、等另一方） |
  | `finished` | `finished` | 结束（有人 3 杀、双方 3:3 平局，或认输） |

- `view.phase` 是 UI 的唯一权威；本游戏**没有回合**：`MatchView.currentSeat` 恒为 `null`（`turn()` 返回 null），UI 必须用 `phase` + `pendingShots` 判断“我能不能报点”。
- `match_started` 事件由 `matches.joinMatch` 发出；`battle_started` / `shot_queued` / `round_resolved` / `game_over` 由本引擎在 `reduce` 的返回值里发出。

---

## 5. 状态定义

```ts
type Seat = 0 | 1;
type PlaneBombPhase = 'placing' | 'battle' | 'finished';

/** 0 未炸；1 炸空；2 命中机身；3 命中机头（该机击落） */
type ShotMark = 0 | 1 | 2 | 3;
type ShotResult = 'miss' | 'body' | 'cockpit';

/** 朝向：0 上、1 右、2 下、3 左（机头指向） */
type Orientation = 0 | 1 | 2 | 3;

/** 客户端提交的布阵：机头 + 朝向 */
interface PlanePlacementInput {
  cockpit: number;
  orientation: Orientation;
}

interface PlanePlacement extends PlanePlacementInput {
  /** 10 个占格（含机头），升序、去重；由机头 + 朝向唯一确定 */
  cells: number[];
}

/** 一次已经结算的报点（公开信息） */
export interface ShotRecord {
  seat: Seat;
  cell: number;
  result: ShotResult;
  /** 这一炮是否直接击落了一架（即 result === 'cockpit'） */
  downed: boolean;
}

interface PlaneBombState {
  phase: PlaneBombPhase;
  /** 每个座位是否已提交布阵；公开 */
  placed: [boolean, boolean];
  /** 布阵完成后才有值；未布阵为 null */
  fleets: [PlanePlacement[] | null, PlanePlacement[] | null];
  /**
   * marks[owner][cell]：**对方**炸在 owner 棋盘上的结果。
   * owner = 0 表示座位 0 的棋盘，marks[0][22] = 3 表示“座位 1 炸了座位 0 的 C3，且命中机头”。
   */
  marks: [ShotMark[], ShotMark[]];
  /** 当前轮次；placing 为 0，battle 从 1 开始，每轮结算后 +1 */
  round: number;
  /** 本轮已提交、尚未结算的报点；[座位0, 座位1]，未提交为 null */
  pending: [number | null, number | null];
  /** 最近一轮已结算的两个报点（公开）；尚无结算为 null */
  lastRound: {
    round: number;
    /** 按 seat 0、seat 1 排序，固定顺序 */
    shots: ShotRecord[];
  } | null;
  /** 平局时 winner 为 null，用 phase==='finished' && winner===null 判断 */
  winner: Seat | null;
  /** 总动作数（place 重提也计一次，仅用于展示/调试） */
  moveCount: number;
}
```

### 5.1 由状态推导、不单独存储的值

```ts
const downOf = (s: PlaneBombState, owner: Seat): number =>
  (s.fleets[owner] ?? []).filter((p) => s.marks[owner][p.cockpit] === 3).length;

const isDraw = (s: PlaneBombState): boolean =>
  s.phase === 'finished' && s.winner === null && downOf(s, 0) === 3 && downOf(s, 1) === 3;
```

- **击落数**由 `marks[owner][机头] === 3` 推导，避免“击落数”和“弹着图”两份数据不一致。
- **平局**就是“结束时双方都击落 3 架”，所以 `winner === null` 且 `phase === 'finished'` 且两边都是 3；不给 state 增加冗余的 `draw` 字段。
- **射击次数**：`marks[owner]` 中非 0 的个数；或维护 `shotCount: [number, number]` 简化视图，推荐后者（写入时 +1，纯展示用）。
- **某架飞机是否已击落**：`marks[owner][plane.cockpit] === 3`。
- **本轮是否已报点**：`pending[seat] !== null`；这个布尔值可以公开，但 `pending` 里的**格子**不能给对方看。

### 5.2 不变量

实现和测试都要保证：

1. `fleets[0] !== null` ⇔ `placed[0] === true`，对座位 1 同理。
2. `fleets[s]` 非 null 时恰好 3 架；每架 `cells.length === 10`、`orientation ∈ 0..3`，且 `cells` 恰好等于 `footprintOf(cockpit, orientation)`（升序、去重、全部在盘内）；三架两两不重叠。
3. `marks[s][c] !== 0` 当且仅当“对方在 c 报过点”。
4. 若 `marks[s][c] === 2`，则 `c` 必属于 `fleets[s]` 中某架飞机的机身（该机可能已被击落，机身命中仍然记为 2）；若 `=== 3`，则 `c` 必是某架飞机的机头，且该机自此次命中起视为已击落。
5. `phase === 'placing'` ⇒ `round === 0 && pending === [null, null] && lastRound === null && winner === null`。
6. `phase === 'battle'` ⇒ `round >= 1 && winner === null`；对每个座位，`pending[s]` 为 null，或满足 `marks[1-s][pending[s]] === 0`（报点时该格必须还没炸过）。
7. `phase === 'finished'` ⇒ `pending === [null, null]`；`winner` 为 `Seat` 或 `null`（平局）；非平局时 `downOf(state, winner) === 3` 且另一方 `< 3`；平局时双方都是 3。
8. `finished(state) === (phase === 'finished')`；`winner()` 只在 finished 时可能非 null，平局为 null。
9. 任何时刻 `downOf(s, 0) <= 3 && downOf(s, 1) <= 3`；允许 3:3（平局），但不允许“先到 3 就停”把另一方的同轮报点吞掉。

### 5.3 状态 JSON 示例

布阵完成、对战进行到第 3 轮开始前（第 1、2 轮已结算）。座位 0 的 1 号机（机头 `C3`）已被击落，座位 1 尚未被击落；双方本轮都还没报点。

```json
{
  "phase": "battle",
  "placed": [true, true],
  "fleets": [
    [
      {"cockpit": 22, "orientation": 0, "cells": [22, 30, 31, 32, 33, 34, 42, 51, 52, 53]},
      {"cockpit": 17, "orientation": 0, "cells": [17, 25, 26, 27, 28, 29, 37, 46, 47, 48]},
      {"cockpit": 62, "orientation": 0, "cells": [62, 70, 71, 72, 73, 74, 82, 91, 92, 93]}
    ],
    [
      {"cockpit": 12, "orientation": 0, "cells": [12, 20, 21, 22, 23, 24, 32, 41, 42, 43]},
      {"cockpit": 55, "orientation": 0, "cells": [55, 63, 64, 65, 66, 67, 75, 84, 85, 86]},
      {"cockpit": 7, "orientation": 0, "cells": [7, 15, 16, 17, 18, 19, 27, 36, 37, 38]}
    ]
  ],
  "marks": [
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
  ],
  "round": 3,
  "pending": [null, null],
  "lastRound": {
    "round": 2,
    "shots": [
      { "seat": 0, "cell": 32, "result": "body", "downed": false },
      { "seat": 1, "cell": 30, "result": "body", "downed": false }
    ]
  },
  "winner": null,
  "moveCount": 6
}
```

读法：

- `marks[0][22] === 3`：座位 1 炸中座位 0 的 `C3` 机头，座位 0 的 1 号机被击落。
- `marks[0][30] === 2`（`A4`）：座位 0 的 1 号机已经击落，但机身仍然记为“命中机身”，不增加击落数（规则 5.3）。
- `marks[1][33] === 1`（`D4`）：座位 0 炸空。
- `marks[1][32] === 2`（`C4`）：座位 0 命中座位 1 的机身。
- `round === 3`：第 1、2 轮已结算，下一轮是第 3 轮；`lastRound.round === 2` 是刚结算的一轮。
- `pending === [null, null]`：双方本轮都还没报点。一旦有一方报点，`pending` 会记下格子，但视图只暴露“已报/未报”的布尔值。
- `lastRound` 是**已结算**的两个报点，公开；其中 `seat` 0/1 的顺序固定，方便前端展示同轮对轰。
- 示例中三架飞机都朝上（`orientation: 0`）；数组长度均为 100，实际实现用 `new Array(100).fill(0)`。

---

## 6. 视图与投影

```ts
export interface PlaneBombGameView {
  phase: PlaneBombPhase;
  /** 双方是否已布阵（公开） */
  placed: [boolean, boolean];
  /** 当前轮次；placing 为 0，battle 从 1 开始 */
  round: number;

  /** 本轮双方是否已经报点；公开，只有布尔值，不含格子 */
  pendingShots: [boolean, boolean];
  /** 本人本轮已报的格子；观战者、未报点或已结算时为 null */
  myShot: number | null;

  /** 本人视角；观战者为 null */
  mine: {
    /** 自己的三架飞机；未布阵时为 [] */
    planes: { cockpit: number; orientation: Orientation; cells: number[]; down: boolean }[];
    /** 100 格：对方炸在本方棋盘上的弹着结果 */
    incoming: ShotMark[];
  } | null;

  /** 对手棋盘的火控图；观战者为 null */
  enemy: {
    /** 100 格：自己炸出的结果，0 未知 */
    marks: ShotMark[];
    /** 对手已被击落几架 */
    down: number;
  } | null;

  /** 观战者视角；玩家为 null */
  spectate: {
    boards: {
      seat: Seat;
      marks: ShotMark[];
      down: number;
      placed: boolean;
    }[];
  } | null;

  /** 双方击落数，公开 */
  down: [number, number];
  /** 双方射击次数，公开 */
  shots: [number, number];

  /** 最近一轮已结算的两个报点；公开，尚无结算为 null */
  lastRound: { round: number; shots: ShotRecord[] } | null;

  /** 结束后公开双方舰队，供复盘；进行中为 null */
  reveal: { seat: Seat; planes: PlanePlacement[] }[] | null;

  finished: boolean;
  /** 平局为 null；用 finished && winner === null 判断 */
  winner: Seat | null;
  /** 平局标记；等价于 finished && winner === null */
  draw: boolean;
}
```

### 6.1 投影矩阵

| 字段 | 本人（viewerSeat = v） | 观战者（viewerSeat = null） | 说明 |
| --- | --- | --- | --- |
| `phase` / `placed` / `round` / `pendingShots` / `down` / `shots` / `lastRound` | 有 | 有 | 公开信息；`pendingShots` 只有布尔值 |
| `myShot` | `state.pending[v]`（未报为 `null`） | `null` | **只给自己**看本轮的报点格子 |
| `mine.planes` | 自己的三架，含 `orientation` 与 `down` | `mine = null` | 绝不包含对方舰队 |
| `mine.incoming` | `marks[v]` | `mine = null` | 对方炸在我方的结果 |
| `enemy.marks` | `marks[1-v]` | `enemy = null` | 自己炸出的结果 |
| `enemy.down` | `downOf(1-v)` | `enemy = null` | 对手被击落数 |
| `spectate` | `null` | 两方 `marks` + `down` + `placed` | 无舰队 |
| `reveal` | 仅 `finished` 时两方舰队 | 仅 `finished` 时 | 复盘 |
| `finished` / `winner` / `draw` | 有 | 有 | 平局 `winner === null && draw === true` |

> `reveal` 在“还没布阵完就结束”（例如布阵阶段认输）时，未布阵一方的 `planes` 为 `[]`，不会补造飞机。
> `lastRound` 只包含**已经结算**的报点，所以公开；`pending` 里的格子永远不整体下发。

### 6.2 反泄密要求

- `view()` 的返回值里**任何时候都不能出现 `fleets` 或 `pending` 这个字段名**（测试用 `JSON.stringify(view)` 断言）。
- 对方本轮已报点、但尚未结算时：`pendingShots[s] === true`，但**不能**出现 `state.pending[s]` 的格子；只有 `myShot` 能带自己的格子。
- 对方未被打中的机头或机身格，在 `enemy.marks` 里必须是 `0`。
- 观战者在 `phase !== 'finished'` 时拿不到任何 `planes`。
- `lastRound`、`round_resolved` 只带已结算的格子与结果，不带“这是第几号机/哪个部位”，与规则一致（机身不区分机翼/机身/机尾）。
- 事件同理：`plane_placed` 只带 `seat`，不带机头位置与朝向；`shot_queued` 只带 `seat`，不带格子。
- 只有玩家自己的 `mine.planes` 和终局 `reveal` 可以带 `orientation` / `cells`；`spectate` 与事件里不能出现朝向或占格。

### 6.3 观战者为什么只看公开信息

规则文档 7.2 已定：观战者若能看完整舰队，房间聊天就可能直接泄密。`spectate.boards` 只给“弹着图 + 击落数 + 是否布阵”，和玩家听到的公开战报一致。观战者能看到“某方已报点/未报点”，但同样看不到格子。

---

## 7. 动作

```ts
export type PlaneBombAction =
  | {
      type: 'place';
      planes: [PlanePlacementInput, PlanePlacementInput, PlanePlacementInput];
    }
  | { type: 'fire'; cell: number }
  | { type: 'resign' };
```

- `place.planes`：三个 `{ cockpit, orientation }`，顺序无关；zod 保证 `cockpit` 为 0–99 整数、`orientation` 为 0–3，引擎再查机头重复、越界与重叠。
- `fire.cell`：0–99；**本轮报点**。若对方本轮也已经报点，服务端在这一次 `reduce` 里同时结算两炮；否则只把报点入队，等对方。
- 每轮每人只能报一次；已报点未结算时再报 → `already_queued`，不能改格子。
- `resign`：与黑白棋共用同一个 schema 分支，不需要在 zod 里重复声明；任何阶段、任何轮次都能认输。
- 所有动作都通过现有的 `{ t: 'action', matchId, actionId, action }` 发送；`actionId` 的幂等由 `matches.applyAction` 的 `match_actions` 表处理，引擎不需要关心重复请求。

---

## 8. 校验顺序与错误码

`matches.applyAction` 已经统一处理：房间不存在 / 未开始 / 已结束 / 非玩家 / 重复 actionId；引擎只负责“游戏内”校验。引擎返回 `{ ok: false, code, message }`，上层转成 HTTP 409 / socket error。

### 8.1 `reduce` 内的判断顺序

```text
if (state.phase === 'finished') → game_over
if (action.type === 'resign')                    → 立即结算（任何阶段、任何座位、任何轮次）
if (action.type === 'place')
    phase !== 'placing'                          → bad_phase
    校验三组 {机头, 朝向}                          → invalid_placement
    写入 fleets / placed；若双方都 placed → battle_started、phase=battle、round=1
if (action.type === 'fire')
    phase !== 'battle'                           → bad_phase
    state.pending[seat] !== null                 → already_queued
    marks[1-seat][cell] !== 0                    → cell_already_shot
    state.pending[seat] = cell
    if 对方 pending 仍为 null                     → 只入队，事件 shot_queued
    else                                         → 同时结算两炮（见 9.2），事件 round_resolved
其他                                             → bad_action
```

### 8.2 错误码

| code | HTTP/传输 | message 示例 | 触发 |
| --- | --- | --- | --- |
| `game_over` | 409 | 这局已经结束了 | 已结束还操作 |
| `bad_action` | 409 | 不认识的动作 | 动作类型不属于本游戏 |
| `bad_phase` | 409 | 还在布阵，不能开火 / 已经开打，不能重新布阵 | 阶段不符 |
| `invalid_placement` | 409 | 机头/机身越界 / 三架飞机重叠 / 三个机头必须互不相同 / 朝向非法 | 布阵非法 |
| `already_queued` | 409 | 本轮已经报过点了，等结算 | 本轮已报点、结算前再报 |
| `cell_already_shot` | 409 | 这个格子已经炸过了 | 重复报点 |
| `bad_message` | 400 | 消息格式不正确 | socket 入口的 zod 校验失败（如 `cell` 不在 0–99、缺少字段） |

> `invalid_placement` 建议把具体原因写进 message（“2 号机与 3 号机在 C5 重叠”），前端直接 toast。
> 因为双方同时报点，**不存在 `not_your_turn`**；能报点的条件是 `phase === 'battle' && pending[seat] === null`。

### 8.3 布阵校验细节

```ts
/** 机头指向：0 上、1 右、2 下、3 左 */
const DIRS = [
  { dr: -1, dc: 0 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
] as const;

/** 机头 + 朝向 → 10 格（升序）；越界返回 null */
function footprintOf(cockpit: number, orientation: Orientation): number[] | null {
  if ((orientation as number) < 0 || (orientation as number) > 3) return null;
  const r = Math.floor(cockpit / 10);
  const c = cockpit % 10;
  const f = DIRS[orientation];
  const b = { dr: -f.dr, dc: -f.dc };  // 机身向后（机头反方向）
  const p = { dr: -b.dc, dc: b.dr };   // 机翼展开方向（与机身垂直）
  const at = (back: number, side: number): number => {
    const rr = r + b.dr * back + p.dr * side;
    const cc = c + b.dc * back + p.dc * side;
    if (rr < 0 || rr > 9 || cc < 0 || cc > 9) return -1;
    return rr * 10 + cc;
  };
  const cells = [
    cockpit,
    ...[-2, -1, 0, 1, 2].map((s) => at(1, s)), // 机翼 5 格
    at(2, 0),                                  // 机身 1 格
    ...[-1, 0, 1].map((s) => at(3, s)),        // 机尾 3 格
  ];
  if (cells.some((x) => x < 0)) return null;
  return [...new Set(cells)].sort((a, b) => a - b);
}

function validatePlacement(
  planes: PlanePlacementInput[],
): { fleets: PlanePlacement[] } | { error: string } {
  if (planes.length !== 3) return { error: '需要三架飞机' };
  if (new Set(planes.map((p) => p.cockpit)).size !== 3)
    return { error: '三个机头必须互不相同' };
  const used = new Set<number>();
  const fleet: PlanePlacement[] = [];
  for (const [i, plane] of planes.entries()) {
    const cells = footprintOf(plane.cockpit, plane.orientation);
    if (!cells) return { error: `${i + 1} 号机越界` };
    for (const cell of cells) {
      if (used.has(cell)) return { error: `${i + 1} 号机与其他飞机在 ${label(cell)} 重叠` };
      used.add(cell);
    }
    fleet.push({ ...plane, cells });
  }
  return { fleets: fleet };
}
```

- 机头合法范围随朝向变化（规则文档 2.3）：上 C–H/1–7、右 D–J/3–8、下 C–H/4–10、左 A–G/3–8。
- 越界只可能来自非法客户端；正常 UI 会按朝向限制可选机头，并对预览格做越界标红。
- 允许贴边、允许相邻；只禁止重叠。
- `cockpit` 为 0–99、`orientation` 为 0–3 由 zod 保证；引擎对直接调用仍返回 `invalid_placement`。

---

## 9. `reduce` 流程（伪代码）

### 9.1 `place`

```ts
const v = validatePlacement(action.planes);
if ('error' in v) return fail('invalid_placement', v.error);

const fleets = state.fleets.slice() as typeof state.fleets;
fleets[seat] = v.fleets;
const placed = state.placed.slice() as [boolean, boolean];
placed[seat] = true;

const events: GameEvent[] = [{ type: 'plane_placed', seat }];
let phase = state.phase;
let round = state.round;
if (placed[0] && placed[1]) {
  phase = 'battle';
  round = 1;
  events.push({ type: 'battle_started', round: 1 });
}

return {
  ok: true,
  state: {
    ...state,
    fleets,
    placed,
    phase,
    round,
    pending: [null, null],
    lastRound: phase === 'battle' ? null : state.lastRound,
    moveCount: state.moveCount + 1,
  },
  events,
};
```

- 重提：`phase === 'placing'` 时直接覆盖该座位的 `fleets[seat]`，并再次发 `plane_placed`；UI 以最后一次为准。
- 一旦双方都 placed，phase 变 battle，round 从 1 开始，双方立刻都可以报点；此后再 `place` 一律 `bad_phase`。
- 布阵没有先手，`turn` 也不再存在；第一轮谁先提交报点都可以。

### 9.2 `fire`

```ts
// 前置：phase === 'battle'、pending[seat] === null、marks[1-seat][cell] === 0 已校验
const pending: [number, number] = [state.pending[0]!, state.pending[1]!];
pending[seat] = action.cell;

// 情况 A：对方还没报点 —— 只入队，不结算
if (pending[(1 - seat) as Seat] === null) {
  return {
    ok: true,
    state: { ...state, pending, moveCount: state.moveCount + 1 },
    events: [{ type: 'shot_queued', seat }],
  };
}

// 情况 B：双方都报点 —— 同时结算
const shots: ShotRecord[] = ([0, 1] as Seat[]).map((s) => {
  const cell = pending[s];
  const owner = (1 - s) as Seat; // s 的炮落在 owner 的棋盘上
  const fleet = state.fleets[owner]!;
  const plane = fleet.find((p) => p.cells.includes(cell));
  const result: ShotResult = !plane ? 'miss' : plane.cockpit === cell ? 'cockpit' : 'body';
  return { seat: s, cell, result, downed: result === 'cockpit' };
});

// 两炮都基于“本轮开始前”的 fleets/marks 计算；两块棋盘互不影响，顺序无关
const marks: [ShotMark[], ShotMark[]] = [state.marks[0].slice(), state.marks[1].slice()];
for (const shot of shots) {
  const owner = (1 - shot.seat) as Seat;
  marks[owner][shot.cell] = shot.result === 'miss' ? 1 : shot.result === 'body' ? 2 : 3;
}

const after = { ...state, marks };
const down: [number, number] = [downOf(after, 0), downOf(after, 1)];
const draw = down[0] >= 3 && down[1] >= 3;
const finished = draw || down[0] >= 3 || down[1] >= 3;
const winner: Seat | null = draw ? null : down[0] >= 3 ? 0 : down[1] >= 3 ? 1 : null;

const nextState: PlaneBombState = {
  ...state,
  marks,
  pending: [null, null],
  lastRound: { round: state.round, shots },
  round: finished ? state.round : state.round + 1,
  phase: finished ? 'finished' : 'battle',
  winner,
  moveCount: state.moveCount + 1,
};

const events: GameEvent[] = [
  { type: 'shot_queued', seat },
  { type: 'round_resolved', round: state.round, shots },
];
if (finished) {
  events.push({ type: 'game_over', winner, down, draw });
}

return { ok: true, state: nextState, events };
```

要点：

- **先入队、后结算**：第一炮只写 `pending` 并广播 `shot_queued`（只带座位、不带格子）；第二炮到达时，才用双方各自的 `pending[seat]` 同时计算两个结果。
- **两个结果都基于本轮开始前的状态**：两块棋盘独立，谁先算不影响谁；`marks` 一次性写入两个弹着点。
- **击落判定只看机头是否被标记为 3**，不用管机身剩余格；即使飞机已击落，炸到机身仍然记 `2`（规则 5.3）。
- **同轮双方都可能达到 3**：`draw = down[0] >= 3 && down[1] >= 3`；平局时 `winner = null`、`phase = 'finished'`，不能因为 `down[0]` 先到 3 就判座位 0 赢。
- 结算后 `pending` 清空、`lastRound` 记录这一轮（公开）、`round` 进入下一轮（未结束时）。
- `lastRound.shots` 固定按 seat 0、seat 1 排序，前端可稳定渲染“同轮对轰”。
- 本游戏**没有 `turn`、没有 `not_your_turn`**；能否报点只取决于 `phase === 'battle' && pending[seat] === null`。

### 9.3 `resign`

```ts
const winner = (1 - seat) as Seat;
return {
  ok: true,
  state: {
    ...state,
    phase: 'finished',
    pending: [null, null],
    winner,
    moveCount: state.moveCount + 1,
  },
  events: [
    { type: 'resign', seat },
    {
      type: 'game_over',
      winner,
      down: [downOf(state, 0), downOf(state, 1)],
      draw: false,
    },
  ],
};
```

- 布阵阶段、对战阶段、某一方已报点但未结算时，都可以认输；认输立即生效，未结算的报点作废。
- 因为认输时至少有一方击落数不到 3，所以 `draw: false`；`winner` 是认输方的对手。
- `turn` 校验不存在，天然支持“对方回合/等待结算时认输”。

### 9.4 其他方法

```ts
finished: (s) => s.phase === 'finished',
winner: (s) => s.winner,
turn: () => null, // 本游戏没有回合/先手；MatchView.currentSeat 恒为 null
```

- 布阵期和对战期 `turn()` 都返回 `null`；UI 必须用 `game.phase` 判断“该布阵了”、用 `game.pendingShots[mySeat]` 判断“我还能不能报点”，不能依赖 `currentSeat`。
- `setup(playerCount)`：

  ```ts
  setup(): PlaneBombState {
    return {
      phase: 'placing',
      placed: [false, false],
      fleets: [null, null],
      marks: [new Array<ShotMark>(100).fill(0), new Array<ShotMark>(100).fill(0)],
      round: 0,
      pending: [null, null],
      lastRound: null,
      winner: null,
      moveCount: 0,
    };
  }
  ```

---

## 10. 事件

`update` 消息里的 `events` 是房间内**所有人共享**的。新增事件：

| type | payload | 何时 | 会泄密吗 |
| --- | --- | --- | --- |
| `plane_placed` | `{ seat }` | 每次成功布阵/重提 | 否，只说明“已布好” |
| `battle_started` | `{ round: 1 }` | 双方都布好 | 否 |
| `shot_queued` | `{ seat }` | 一方报点、等对方 | **否，不带格子**；只表示“该座位已报点” |
| `round_resolved` | `{ round, shots: [{ seat, cell, result: 'miss'\|'body'\|'cockpit', downed }] }` | 双方都报点、同时结算 | 否，两个格子都已结算，属于公开战报；固定按 seat 0/1 排序 |
| `game_over` | `{ winner: 0\|1\|null, down: [number, number], draw: boolean }` | 3 杀、3:3 平局或认输 | 否 |
| `resign` | `{ seat }` | 认输 | 否 |

注意：

- **不要**在 `plane_placed` 里带 `planes` / `cells` / `cockpit`。
- **不要**在 `shot_queued` 里带 `cell`；这是本游戏唯一需要额外小心的“半公开”事件。
- **不要**在 `round_resolved` 里带 `planeIndex` 或 `part`（机翼/机身/机尾），规则上三者统一叫“机身”。
- 前端可以这样用事件：`shot_queued` → 显示“对方已报点，等待结算”；`round_resolved` 里两条 `result` 同时播放（miss 灰、body 橙、cockpit 红 + “击落”）；`game_over.draw` 为 true 时显示平局。
- `game_over` 的 `down` 是终局比分，可直接用于结果面板；完整舰队在 `view.reveal` 里。

---

## 11. 幂等、并发与持久化

- **动作幂等**：客户端重发同一个 `actionId` 时，`matches.applyAction` 命中 `match_actions` 直接返回现有 view、`events: []`，引擎不会执行第二次。引擎无需去重。
- **并发**：单进程 Node，`applyAction` 同步执行，事务内写 `match_actions` / `match_events` / `matches.state`，不存在两个动作同时改同一局；两人“同时”报点在服务端实际是两次串行 `reduce`，第二次负责同时结算。
- **持久化**：`matches.state` 存完整 JSON；炸飞机一局状态约 2–3 KB（200 个 marks + 6 架 ×（10 个占格 + 朝向）+ `pending` + `lastRound`），远小于现有 SQLite 压力。
- **不需要迁移**：新游戏只是 `matches.game_id` 多一个取值，`matches.state` 结构由引擎自己解释；旧房间不受影响。
- **重放**：`match_events` 已按 seq 记录每次动作与结果；配合引擎确定性，可离线重放/调试。
- **服务器重启**：状态全在 SQLite，重启后 `buildView` 重新投影，客户端重连 `join` 拿 snapshot 即可恢复；`pending` 里的半回合报点也持久化，不会因为重启丢炮。

---

## 12. 测试计划

### 12.1 引擎单元测试（`plane-bomb.test.ts`）

| # | 用例 | 断言 |
| --- | --- | --- |
| 1 | 初始状态 | `phase='placing'`、`round=0`、`pending=[null,null]`、`lastRound=null`、marks 全 0、`turn() === null` |
| 2 | 合法布阵（含旋转） | 三组 `{机头, 朝向}` 生成 30 个不同格；`placed[0]=true`；事件 `plane_placed` |
| 3 | 机头/机身越界 | 朝上的机头在第 8 行、朝右的机头在 `A1`、朝左的机头在 `J1` 等 → `invalid_placement` |
| 4 | 两机重叠（含旋转后重叠） | 返回 `invalid_placement`，message 含重叠格 |
| 5 | 重复机头 / 非法朝向 | `invalid_placement` |
| 6 | 重提布阵 | placing 阶段覆盖旧布阵，不报错 |
| 7 | 双方布阵 → 开战 | `phase='battle'`、`round=1`、`pending=[null,null]`、事件 `battle_started` |
| 8 | 非布阵期 place | `bad_phase` |
| 9 | 第一炮只入队 | `pending[0]=cell`、marks 不变、`round` 不变、事件 `shot_queued`；座位 0 的 view `pendingShots=[true,false]`、`myShot=cell` |
| 10 | 对方看不到已报格子 | 座位 1 的 view `pendingShots[0]=true`，但 JSON 不含座位 0 的 `myShot`，也不含 `pending` 字段 |
| 11 | 本轮重复报点 | 座位 0 再 `fire` → `already_queued`，`pending` 不变 |
| 12 | 第二炮触发结算 | 两炮 marks 同时写入；`lastRound.round=1`、`shots.length=2`（seat 0/1 顺序）；`round=2`；事件 `round_resolved` |
| 13 | 炸空 / 炸机身 / 炸机头 | mark 分别为 1/2/3；`result` 为 miss/body/cockpit；`downed` 仅 cockpit 为 true |
| 14 | 炸已击落飞机的机身 | 仍 `body`、mark=2、`downed=false`、`down` 不变（规则 5.3） |
| 15 | 重复炸同一格 | `cell_already_shot`，状态不变 |
| 16 | 第三杀获胜（对方未到 3） | 第 3 个机头结算后 `phase='finished'`、`winner=0`、`down=[3,x]`、`pending` 清空、事件 `game_over` |
| 17 | 对方同轮报点仍然结算 | 座位 0 第三杀的同时座位 1 打中座位 0 机身：`winner=0`，`lastRound.shots` 含两炮，marks 含座位 1 的 body |
| 18 | 3:3 平局 | 双方都已有 2 杀，同一轮各炸中对方第 3 个机头 → `phase='finished'`、`winner=null`、`draw=true`、`down=[3,3]`、事件 `game_over.draw=true` |
| 19 | 只有一方到 3 不是平局 | 一方 3、另一方 2 → `winner` 为到 3 的一方，`draw=false` |
| 20 | 认输（布阵期 / 对战期 / 已报点未结算） | 对方胜、`phase='finished'`、`pending` 清空；布阵期认输 `reveal` 中未布阵方 `planes=[]` |
| 21 | 视图隔离 | 玩家 view 的 JSON 不含对方 `fleets` / `pending`；`enemy.marks` 只有自己炸过的格 |
| 22 | 观战视图 | `mine=null`、`enemy=null`、`spectate` 有两块 marks、`pendingShots` 有值、`myShot=null`、无 `planes` |
| 23 | 终局 reveal | finished 后 view 含双方舰队；进行中不含 |
| 24 | 确定性重放 | 同一组动作序列（含“只报一炮”）跑两次，state 深相等 |
| 25 | 四个朝向的 footprint | 每个朝向取合法机头：10 格、全在盘内、无重复；`D6` 朝右 = `D6`、`C4`–`C8`、`B6`、`A5`–`A7` |
| 26 | 旋转后重叠检测 | 两架不同朝向但共享至少 1 格 → `invalid_placement` |
| 27 | 状态 JSON 往返 | 结算后 `JSON.parse(JSON.stringify(state))` 深相等，`orientation`、`pending`、`lastRound` 保留 |
| 28 | 朝向不泄密 | 对方 view 与事件不含 `orientation` / `cells`；终局 `reveal` 才出现 |
| 29 | `shot_queued` 不泄密 | 事件对象只有 `{ type, seat }`；不含 `cell` / `pending` |
| 30 | `lastRound` 只在结算后出现 | 第一炮后 `lastRound=null`；第二炮后才有两条 |

补充属性测试（可选，沿用 Vitest + fast-check 风格）：

- 随机合法布阵 × 随机射击序列：marks 单调（0 → 非 0 后不再变）、`down` 单调不减、总射击数 ≤ 200、结束时 `winner` 非 null 或 `draw === true`。
- 随机“只报一炮就停”的状态：`JSON.parse(JSON.stringify(state))` 后 `pending` 保留、view 仍然不泄密。

### 12.2 端到端（扩展 `apps/web/scripts/e2e-smoke.mjs`）

> 下面用“座位 1 的三架飞机机头与朝向”指代测试脚本自己选定的合法布阵；脚本要自己按朝向算出 10 个占格，不能读服务端状态。

1. 创建 `gameId='plane-bomb'` 的公开房；
2. 两个访客 join，双方 socket 收到 snapshot，`game.phase='placing'`、`currentSeat=null`；
3. 两人各发 `place`（三组机头 + 朝向，至少一架旋转），收到 `battle_started {round:1}`、`phase='battle'`；
4. 座位 0 `fire` 一个空点 → 双方 update 的 `shot_queued`、`pendingShots[0]=true`；座位 1 的 view `myShot=null`，座位 0 的 view `myShot=该格`；
5. 座位 1 也 `fire` 一个空点 → 双方收到 `round_resolved {round:1, shots:[...]}`，`round=2`，两块 marks 各有一个弹着；
6. 座位 0 炸座位 1 的第一架机头 → 只入队；座位 1 `fire` 空点 → 结算后 `down[1]=1`、`result='cockpit'`；
7. 座位 0 炸这架**已击落**飞机的机身格 → 仍 `result='body'`、`downed=false`、`down[1]` 仍为 1（回归规则 5.3）；
8. 重复炸第 7 步的格子 → `error.code='cell_already_shot'`；
9. 座位 0 再炸第二、第三架机头（每次都要等座位 1 也报点才结算）→ 最后一轮 `game_over`、`winner=0`、`reveal` 出现、`down=[x,3]`；
10. （可选）另开一局，双方打到 2:2，同一轮各炸中对方第 3 个机头 → `game_over.draw=true`、`winner=null`、`down=[3,3]`；
11. 观战者 view：`mine=null`、`enemy=null`、`spectate` 有数据、`pendingShots` 有值、无 `planes`；
12. rematch → 新房间、双方座位保留、`phase='placing'`。

### 12.3 安全回归

- 让双方故意布置**不同坐标**的舰队，再逐格检查：座位 0 视角的 `enemy.marks` 里，座位 1 未被打中的机头/机身格必须仍是 `0`。
- 对玩家 view 调 `JSON.stringify`，断言不含 `"fleets"` / `"pending"` 字段，也不含对方未击中飞机的 `cockpit` 值（用双方不同的坐标避免误判）；座位 0 已报点但未结算时，座位 1 的 view 不能出现该格子。
- 检查 `update` 事件的 payload：`shot_queued` 不含 `cell`；`plane_placed` 不含 `planes` / `cells` / `cockpit` / `orientation` / `planeIndex`；`round_resolved` 只含已结算的两炮。

---

## 13. 前端接入契约（后续实现）

### 13.1 布阵盘

- 10×10 网格，点击空格设置机头；悬停/选中时预览 10 格轮廓（绿色=可放，红色=越界/重叠）。
- 每个机头旁提供朝向选择（旋转按钮 / `R` 键循环 0→1→2→3），预览的 10 格随朝向旋转；默认朝上。
- 显示已放的三架飞机；允许撤回、重放；“确认布阵”发 `place`。
- 布阵期间双方都看不到对方棋盘，只显示“对方已布阵/未布阵”。
- 提交后仍可在对方提交前修改（界面提示“等待对手布阵，可继续调整”）。

### 13.2 对战盘（同时报点）

- 双盘并排（移动端上下）：己方盘显示飞机 + 对方弹着；敌方盘只显示自己炸过的结果。
- **可点击条件**：`phase === 'battle' && !pendingShots[mySeat] && enemy.marks[cell] === 0`。这里没有“轮到我”，双方随时都可以各报一炮。
- `pendingShots[mySeat] === true`：己方已报点，显示“已报点，等待对方”并锁定敌方盘；`pendingShots[1-mySeat] === true`：显示“对方已报点，等待你”。
- 点击后发 `fire`，等服务器 `update`，不做乐观更新（避免和隐藏信息冲突）；提交后不要自己把格子标成命中，等 `round_resolved`。
- 结果反馈：`round_resolved` 到达时，两条结果同时播放（炸空灰、机身橙、机头红 + “击落”）；顶部显示双方击落数（`×/3`）与当前轮次。
- 终局：`draw=true` 时显示“平局”，否则显示胜者；之后展示 `reveal` 双方舰队。
- 观战者：两块公开弹着盘，禁止点击，显示“观战中”；能看到“某方已报点”，但看不到格子。

### 13.3 与现有页面的衔接

- `MatchPage` 现在直接 `<Board view={view.game} />`；需要按 `view.gameId` 分支：

  ```tsx
  {view.gameId === 'reversi' ? (
    <Board view={view.game as ReversiGameView} playable={myTurn} onPlay={play} />
  ) : (
    <PlaneBombGame view={view.game as PlaneBombGameView} you={view.you} onAction={send} />
  )}
  ```

- 黑白棋仍用 `currentSeat` 判断 `myTurn`；炸飞机不要用 `currentSeat`（恒为 `null`），用 `pendingShots`。
- 大厅的“创建房间”目前固定 `reversi`；需要游戏选择器（卡片或下拉），并把 `gameId` 传给 `api.createMatch`。
- 房间列表已经显示 `gameName`，无需改协议。

---

## 14. 性能与规模

- 单局状态 ~2–3 KB；每次动作重算 `marks` 的 100 格与 3 架飞机的 `find`，O(100)，可忽略。
- 每个动作向房间内每个 socket 推一份裁剪后的 view（~2–4 KB），2 人 + 少量观战者无压力；只报一炮时 view 变化很小。
- 不需要额外的表、缓存或后台任务。

---

## 15. 后续扩展

| 扩展 | 做法 | 兼容性 |
| --- | --- | --- |
| 本轮报点倒计时 | 框架层加 timer（当前没有），到点自动报点/放弃；引擎只接受动作 | 独立功能，需产品确认 |
| 观战全知 | view 增加开关，仅对观战者返回舰队 | 需产品确认，默认关闭 |
| 战绩统计 | 由 `match_events` 离线聚合，引擎不存 | 不影响对局 |
| 新手引导/残局 | 单独页面，复用 view 类型 | 独立功能 |
| 轮次回放 | `match_events` 已有 `round_resolved`，可逐轮重放 | 不影响对局 |

---

## 16. 待确认

与规则文档第 11 节同一组问题，接口上对应：

1. **Q1 每轮一炮**：当前实现是“双方各报一炮、同时结算”，命中不加次数；没有 `turn` 连击概念。
2. **Q2 是否允许旋转**：已确认**允许**，`place` 带 `orientation: 0..3`，`footprintOf` 按朝向生成，状态与视图都保存朝向。
3. **Q3 观战者可见性**：影响 `spectate` 是否包含 `planes`（当前：不包含，结束后 `reveal`）；`pendingShots` 只给布尔值。
4. **Q4 相邻限制**：影响 `validatePlacement` 是否加“八邻域不得接触”的检查（当前：不检查）。
5. **Q5 先后手**：已确认**没有先后手**，双方同轮同时报点；`turn()` 返回 `null`，`MatchView.currentSeat` 恒为 `null`，不需要随机源。
6. **Q6 布阵重提**：当前允许；若要锁定，`place` 在 `placed[seat]` 为 true 时返回 `bad_phase`。
7. **Q7 计时**：当前无；若加，建议按“轮”计时，而不是按人。
8. **Q8 击落后的机身命中统计**：当前只反馈、不影响任何计数。
9. **Q9 机身全毁**：不击落；只有机头算。
10. **Q10 同轮 3:3**：平局，`winner=null`、`draw=true`；双方最后一炮都有效。
