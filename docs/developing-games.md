# BGX 新游戏开发指南

BGX 的框架（房间、座位、聊天、断线重连、观战、幂等、事件日志、权限、部署）不认识任何具体棋种。一个游戏是一个**独立插件**，由三块组成：

```
protocol 类型/校验  +  服务端纯函数引擎  +  前端 UI 插件
```

三块都按目录自动发现。新增游戏时**不需要修改框架代码**，也不需要改 `package.json`、注册表、`MatchPage`、`Lobby`。

> 快速结论：照抄一个现有游戏目录（`reversi` 或 `plane-bomb`），替换规则、协议和界面即可。

---

## 1. 目录结构

以游戏 id `tic-tac-toe` 为例：

```
packages/protocol/src/games/
  tic-tac-toe.ts              # 协议：catalog、视图类型、动作类型、zod schema

apps/server/src/games/
  tic-tac-toe/
    engine.ts                 # 纯函数规则引擎
    index.ts                  # 导出 plugin（meta + schema + engine）
    engine.test.ts            # 引擎单测

apps/web/src/games/
  tic-tac-toe/
    index.tsx                 # 导出 plugin（meta + Panel + 文案函数）
    TicTacToeBoard.tsx        # 可选的棋盘组件
```

约定：

- 三处的 `<id>` 建议一致，且与 `catalog.id` 一致；服务端目录名可以不同，但不要用 `_` 或 `.` 开头（会被自动发现跳过）。
- 协议文件名就是子路径：`@bgx/protocol/games/tic-tac-toe`。`packages/protocol/package.json` 已配置通配导出，新增文件不用改包配置。
- 前端只发现 `games/<dir>/index.tsx`，服务端只发现 `games/<dir>/index.ts|js`。组件文件放旁边即可。

---

## 2. 协议模块

位置：`packages/protocol/src/games/<id>.ts`

它负责三件事：大厅展示信息、该游戏的视图类型、该游戏的动作类型与 Zod 校验。

```ts
import { z } from 'zod';
import type { GameCatalog, GameOptionDefinition } from '@bgx/protocol';

export interface TicTacToeView {
  board: (0 | 1 | 2)[];       // 0 空、1 X、2 O
  turn: 1 | 2;
  legal: number[];
  lastMove: number | null;
  moves: number;
  finished: boolean;
  winner: 1 | 2 | null;
}

export type TicTacToeAction =
  | { type: 'place'; cell: number }
  | { type: 'resign' };

// 多选示例：oneOf 的 default 必须是数组
export const multiCatalogOption: GameOptionDefinition = {
  id: 'variants',
  label: '附加规则（可多选）',
  type: 'multi',
  default: ['sudden-death'],
  choices: [
    { value: 'sudden-death', label: '突然死亡' },
    { value: 'no-draw', label: '必须分胜负' },
  ],
};

export const ticTacToeCatalog: GameCatalog = {
  id: 'tic-tac-toe',
  name: '井字棋',
  tagline: '三子连线，先手必胜？',
  minPlayers: 2,
  maxPlayers: 2,
  description: '在线井字棋：轮流落子，先连成三子者胜。',
  rules: ['双方轮流在 3×3 棋盘落子。', '横、竖、斜任意方向连成三子即获胜。'],
  options: [],
};

export const ticTacToeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('place'), cell: z.number().int().min(0).max(8) }).strict(),
  z.object({ type: z.literal('resign') }).strict(),
]);

export const ticTacToeOptionsSchema = z.object({}).strict();
export type TicTacToeOptions = z.infer<typeof ticTacToeOptionsSchema>;
```

要点：

- `GameCatalog` 是框架唯一认识的“游戏描述”，字段必须齐全。
- 视图类型由游戏自己定义；`MatchView<V>.game` 在框架里是 `unknown`，只有游戏插件知道 `V` 是什么。
- 动作 schema 要在服务端真正校验；建议 `.strict()`，避免客户端夹带字段。
- 不要在协议核心 `packages/protocol/src/index.ts` 里追加游戏联合类型。核心只保留 `GameId = string`、`GameView = unknown`、`GameAction = unknown`。

---

## 3. 服务端引擎与插件

### 3.1 纯函数引擎

位置：`apps/server/src/games/<id>/engine.ts`

实现 `GameEngine<S, V, A, O>`。`O` 是开局选项类型；没有选项时用 `{}`。`setup` 接收三个参数：人数、选项、框架注入的随机源：

```ts
import type { TicTacToeAction, TicTacToeView } from '@bgx/protocol/games/tic-tac-toe';
import type { ReduceResult } from '../types.js';
import type { RandomSource } from '@bgx/protocol';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(board: (0 | 1 | 2)[]): 1 | 2 | null {
  for (const [a, b, c] of LINES) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) {
      return board[a] as 1 | 2;
    }
  }
  return null;
}

export interface TicTacToeState {
  board: (0 | 1 | 2)[];
  turn: 1 | 2;
  moves: number;
  winner: 1 | 2 | null;
  finished: boolean;
}

export const ticTacToe = {
  setup(
    _playerCount: number,
    _options: {},
    _rng: RandomSource,
  ): TicTacToeState {
    return { board: Array(9).fill(0), turn: 1, moves: 0, winner: null, finished: false };
  },

  reduce(
    state: TicTacToeState,
    seat: number,
    action: TicTacToeAction,
    _ctx: { now: number; rng: RandomSource },
  ): ReduceResult<TicTacToeState> {
    if (state.finished) {
      return { ok: false, code: 'game_over', message: '对局已经结束' };
    }
    if (action.type === 'resign') {
      return {
        ok: true,
        state: { ...state, finished: true, winner: (1 - seat) as 1 | 2 },
        events: [{ type: 'game_over', winner: 1 - seat }],
      };
    }
    if (state.turn !== seat + 1) {
      return { ok: false, code: 'not_your_turn', message: '还没轮到你' };
    }
    if (state.board[action.cell] !== 0) {
      return { ok: false, code: 'cell_taken', message: '这个格子已经有棋子了' };
    }

    const board = state.board.slice();
    board[action.cell] = (seat + 1) as 1 | 2;
    // 胜负判断略：检查横/竖/斜三连
    const winner = checkWinner(board);
    const finished = winner !== null || board.every((cell) => cell !== 0);
    return {
      ok: true,
      state: { ...state, board, turn: state.turn === 1 ? 2 : 1, moves: state.moves + 1, winner, finished },
      events: [{ type: 'move', seat, cell: action.cell }, ...(finished ? [{ type: 'game_over' }] : [])],
    };
  },

  view(state: TicTacToeState, viewerSeat: number | null, _active: boolean): TicTacToeView {
    return {
      board: state.board,
      turn: state.turn,
      // 只有当前行动玩家拿到合法点；观战者永远为空
      legal: viewerSeat !== null && state.turn === viewerSeat + 1 && !state.finished
        ? state.board.flatMap((cell, index) => (cell === 0 ? [index] : []))
        : [],
      lastMove: null,
      moves: state.moves,
      finished: state.finished,
      winner: state.winner,
    };
  },

  finished(state: TicTacToeState): boolean {
    return state.finished;
  },

  winner(state: TicTacToeState): number | null {
    return state.winner === null ? null : state.winner - 1;
  },

  turn(state: TicTacToeState): number | null {
    return state.finished ? null : state.turn - 1;
  },

  resignable(state: TicTacToeState): boolean {
    return !state.finished;
  },

  // 可选：终局名次（2 人局胜者 1、负者 2；平局都 1）
  rankings(state: TicTacToeState) {
    if (!state.finished) return [];
    if (state.winner === null) return [{ seat: 0, rank: 1 }, { seat: 1, rank: 1 }];
    return [
      { seat: state.winner - 1, rank: 1 },
      { seat: 1 - (state.winner - 1), rank: 2 },
    ];
  },
};
```

硬性约束：

- **纯函数**：不读数据库、不发网络消息、不读环境变量、不 `Date.now()`、不 `Math.random()`。时间用 `ctx.now`，随机用 `setup` 注入的 `rng`（或 `reduce` 的 `ctx.rng`）。
- 状态必须 JSON 可序列化，因为 `matches.state` 直接存 JSON。
- `view()` 负责裁剪。隐藏信息（对手手牌、未引爆的舰队、未结算报点）绝对不能出现在返回值里。
- `reduce()` 收到的是已经过 `actionSchema` 校验的动作，因此不需要再做类型判断。
- `finished`/`winner`/`turn` 只读状态；框架用它们算 `MatchView.currentSeat` 与终局。
- 同时行动/无先后手的游戏，`turn()` 返回 `null`，前端用自己视图里的 phase/pending 判断可操作。

### 3.2 插件入口

位置：`apps/server/src/games/<id>/index.ts`

```ts
import {
  ticTacToeActionSchema,
  ticTacToeCatalog,
  ticTacToeOptionsSchema,
  type TicTacToeAction,
  type TicTacToeOptions,
  type TicTacToeView,
} from '@bgx/protocol/games/tic-tac-toe';
import type { GamePlugin } from '../types.js';
import { ticTacToe, type TicTacToeState } from './engine.js';

export const plugin: GamePlugin<TicTacToeState, TicTacToeView, TicTacToeAction, TicTacToeOptions> = {
  ...ticTacToe,
  meta: ticTacToeCatalog,
  actionSchema: ticTacToeActionSchema,
  actionType: (action) => action.type,
  optionSchema: ticTacToeOptionsSchema,
  defaultOptions: {},
};

export default plugin;
```

`actionType` 只用于写 `match_events.type`，让事件日志可读；框架不解释具体动作。

### 3.3 自动发现

`apps/server/src/games/loader.ts` 在启动时扫描 `games/<dir>/index.ts`（开发）或 `index.js`（构建后），动态 import `plugin` 并注册。

所以新增游戏**不要**改：

- `apps/server/src/index.ts`
- `apps/server/src/games/registry.ts`
- `apps/server/src/games/types.ts`

如果模块加载失败、没有导出 `plugin`、或 id 重复，服务会直接启动失败——这是故意的，避免静默缺少游戏。

### 3.4 开局选项（N 选一 / N 选多）

如果游戏在开局前需要选择规则，用 `GameOptionDefinition` 描述，框架会自动在大厅创建卡片和对局等待页渲染控件；游戏只需定义选项、校验选项，并在引擎里读取。

`type` 缺省为 `'select'`（下拉框）；`'multi'` 会渲染成 checkbox 组，值类型是 `string[]`，`default` 也必须是数组。

`packages/protocol/src/games/<id>.ts`：

```ts
export const fooOptionsSchema = z
  .object({ mode: z.enum(['classic', 'quick']) })
  .strict();
export type FooOptions = z.infer<typeof fooOptionsSchema>;
export const fooDefaultOptions: FooOptions = { mode: 'classic' };

export const fooCatalog: GameCatalog = {
  // ...其他字段
  options: [
    {
      id: 'mode',
      label: '对局模式',
      description: '选择本局的规则变体。',
      type: 'select',
      default: 'classic',
      choices: [
        { value: 'classic', label: '经典', description: '默认规则。' },
        { value: 'quick', label: '快速', description: '缩短对局。' },
      ],
    },
  ],
};
```

`apps/server/src/games/<id>/index.ts`：

```ts
export const plugin: GamePlugin<FooState, FooView, FooAction, FooOptions> = {
  ...fooEngine,
  meta: fooCatalog,
  actionSchema: fooActionSchema,
  actionType: (action) => action.type,
  optionSchema: fooOptionsSchema,
  defaultOptions: fooDefaultOptions,
};
```

引擎的 `setup(playerCount, options, rng)` 接收已校验、已补全默认值的选项和随机源。建议把选项存进状态，后续 `reduce`/`view` 直接读：

```ts
export interface FooState {
  options: FooOptions;
  // ...
}

setup(_playerCount, options, _rng) {
  return { options, /* ... */ };
}
```

框架负责：

- `POST /api/matches` 接受 `options`，用 `optionSchema` 校验并补默认值。
- `PATCH /api/matches/:id/options`：仅房主、仅 `waiting` 可改；等待阶段不再调用 `setup()`，只更新选项、`version+1`、`seq+1` 并广播 `options_changed`。
- `MatchView.options` 是当前选项值；`MatchView` 同时带 `minPlayers` / `maxPlayers`。
- 大厅创建卡片和 `MatchPage` 等待页自动渲染 `GameOptions`，不需要在 `Panel` 里写选项 UI。
- 多选值在 `GameOptionValues` 里是 `string[]`；`optionSchema` 仍需严格校验。

新增选项时不要改 `MatchPage`/`Lobby`；只要在 catalog 里加定义、在 schema 里加字段、在引擎里使用即可。

### 3.5 随机源与种子

对局创建时框架会生成一个只存在服务端的随机种子（`matches.seed`），并用它派生 `RandomSource` 注入 `setup()`。同一个种子在任何进程、任何时间都会得到相同的序列，方便测试和重放。

```ts
setup(playerCount, options, rng) {
  const deck = rng.shuffle(createDeck()); // 洗牌
  const first = rng.int(playerCount);      // 随机先手
  return { options, deck, turn: first, /* ... */ };
}
```

规则：

- 推荐**在 `setup()` 里取随机数**，把结果写进状态；这样重启、重放和并发都不会改变结果。
- 如果确实需要按动作随机，`reduce()` 的 `ctx.rng` 会按「房间种子 + 本次动作 seq」派生；同一个动作重放会得到同一序列。仍不要用它生成影响隐藏信息的随机值。
- 种子不会下发给客户端；不要把它放进 `MatchView` 或任何事件。
- `GET /api/games` 只暴露游戏 meta/options，不暴露种子。
- 重开（rematch）会生成新种子；同一局改选项会沿用原种子重建空状态。

`RandomSource` 提供 `next()`、`int(maxExclusive)`、`pick(items)`、`shuffle(items)`。实现见 `apps/server/src/random.ts`，单测见 `random.test.ts`。

### 3.6 2-N 人与房主开始

`GameMeta.minPlayers` / `maxPlayers` 决定房间容量，框架不再“坐满立刻开始”：

1. 创建房间时只坐房主一人，状态 `waiting`；其他人可以陆续加入，直到 `maxPlayers`。
2. `waiting` 阶段框架**不会调用 `setup()`**，`MatchView.game` 为 `null`；也不要渲染游戏 `Panel`。大厅/房间页只展示玩家、选项和开始按钮。
3. 至少达到 `minPlayers` 后，房主在房间页点击「开始对局」，调用 `POST /api/matches/:id/start`，状态才变 `active`。
4. 开局时框架会按**实际入座人数**重新调用 `setup(playerCount, options, rng)`，所以不要在创建时就把人数写死。
5. 开局后不能改选项、不能入座，只能观战。
6. 房主可以在 `active` 阶段调用 `POST /api/matches/:id/abort` 中止对局；终局 `aborted=true`，`winner=null`，不计平局。
7. 房间页会自动显示「还差 N 人」和房主的开始按钮；插件只在 `view.game` 非空时被调用，等待文案由框架负责。

新增游戏时只需要在 catalog 里给出正确的 `minPlayers`/`maxPlayers`，不需要改大厅或房间页。

---

## 4. 前端 UI 插件

位置：`apps/web/src/games/<id>/index.tsx`

```tsx
import {
  ticTacToeCatalog,
  type TicTacToeAction,
  type TicTacToeView,
} from '@bgx/protocol/games/tic-tac-toe';
import type { GamePanelProps, GameUiPlugin } from '../types';

function Panel({ view, mySeat, disabled, onAction }: GamePanelProps<TicTacToeView>) {
  const game = view.game;
  const myTurn = view.status === 'active' && mySeat !== null && view.currentSeat === mySeat;

  function play(cell: number) {
    if (!myTurn || disabled || !game.legal.includes(cell)) return;
    const action: TicTacToeAction = { type: 'place', cell };
    onAction(action);
  }

  return (
    <div className="ttt-board">
      {game.board.map((cell, index) => (
        <button
          key={index}
          type="button"
          disabled={!myTurn || disabled || cell !== 0}
          onClick={() => play(index)}
          aria-label={`第 ${index + 1} 格`}
        >
          {cell === 1 ? 'X' : cell === 2 ? 'O' : ''}
        </button>
      ))}
    </div>
  );
}

export const plugin: GameUiPlugin<TicTacToeView> = {
  meta: {
    ...ticTacToeCatalog,
    title: ticTacToeCatalog.name,
    icon: '#',
    seats: ['X', 'O'],
  },
  Panel,
  headline(view, mySeat) {
    if (view.status === 'waiting') {
      return view.players.length < view.minPlayers ? '等待玩家加入' : '等待房主开始';
    }
    if (view.status === 'finished') {
      if (view.winner === null) return '平局';
      if (mySeat === view.winner) return '你赢了';
      if (mySeat === null) return '对局结束';
      return '这局输了';
    }
    if (mySeat === null) return '观战中';
    return view.currentSeat === mySeat ? '轮到你落子' : '等待对手落子';
  },
  statusLine(view) {
    if (view.status === 'waiting') {
      const need = view.minPlayers - view.players.length;
      return need > 0 ? `还差 ${need} 人` : '等待房主点击「开始对局」';
    }
    if (view.status === 'finished') return '本局已结束';
    return `第 ${view.game.moves + 1} 手`;
  },
  playerBadge(view, seat) {
    return view.status === 'active' && view.currentSeat === seat ? '落子中' : null;
  },
  spectatorNote() {
    return '你正在观战，棋盘会实时同步。';
  },
  eventMessage(event) {
    if (event.type === 'match_started') return { text: '对局开始', tone: 'success' };
    if (event.type === 'game_over') return { text: '对局结束' };
    return null;
  },
};
```

接口说明：

```ts
interface GamePanelProps<V> {
  view: MatchView<V>;              // 服务端已按本人裁剪过的视图
  mySeat: number | null;           // null = 观战者
  disabled: boolean;               // socket 不在线时为 true
  onAction: (action: unknown) => void;  // 框架只负责发送，不解释动作
}

interface GameUiPlugin<V> {
  meta: GameUiMeta;                // 大厅/页面 description/rules/座位标签/options
  Panel: ComponentType<GamePanelProps<V>>;
  headline(view, mySeat): string;  // 大标题：等待/轮到你/观战/胜负
  statusLine(view): string;        // 副标题：轮次、状态
  playerBadge?(view, seat): string | null;  // 玩家行小徽标
  spectatorNote?(view): string;    // 观战提示
  eventMessage?(event): { text; tone? } | null;  // 引擎事件转提示，避免框架硬编码棋种文案
}
```

自动发现：`apps/web/src/games/index.ts` 用 `import.meta.glob('./*/index.tsx', { eager: true })` 收集所有插件。新增游戏不要改 `MatchPage` 或 `Lobby`。

大厅和页面会使用：

- `meta.icon`、`meta.title`、`meta.tagline`、`meta.rules`、`meta.seats`
- `meta.description`（`<meta name="description">`）
- `meta.options`（开局选项定义，框架自动渲染）
- `Panel`、`headline`、`statusLine`、`playerBadge`、`spectatorNote`、`eventMessage`

> 前端插件只渲染 UI 和发动作，不能自己改棋盘。所有合法性判断必须在服务端引擎里再做一遍。

---

## 5. 对局框架提供了什么

你不需要重复实现：

- 创建/加入房间、公开/私密、房间号、邀请链接、入座/观战
- 开局选项：创建时传入、等待页房主可改，自动校验/重建状态/广播
- 2-N 人房间、房主手动开始（`POST /api/matches/:id/start`）
- 对局种子与可复现随机源（`setup(playerCount, options, rng)`）
- `POST /api/matches`、`GET /api/matches`、`POST /api/matches/:id/join`
- Socket.IO 鉴权（Cookie）、`join / action / chat / leave`
- `actionId` 幂等（`match_actions`），重复提交不会执行两次
- 事务写 `match_actions`、`match_events`、`matches.state`、`version`、`seq`
- 每个连接按自己的 `userId` 重算 `MatchView` 并推送 `update`
- 断线重连 `snapshot`、聊天、再来一局、玩家主页历史
- 24 小时无活动的未结束房间清理
- 大厅列表、观战、移动端布局、账号/游客会话

框架不提供、由游戏自己决定：

- 棋盘/手牌长什么样、怎么交互
- 动作集合、合法条件、错误码
- 胜负/平局判定、回合/轮次语义
- 哪些信息对本人可见、对观战者可见、终局是否公开

---

## 6. 动作、错误与事件

### 动作

客户端发送：

```ts
socket.emit('action', {
  t: 'action',
  matchId,
  actionId: crypto.randomUUID(),
  action: { type: 'place', cell: 4 },
});
```

服务端顺序：

1. `clientMessageSchema` 校验消息外壳
2. `getGame(match.gameId).actionSchema.safeParse(action)`；失败返回 `bad_action`
3. 检查房间状态、座位、幂等
4. 若动作是 `resign`，先检查 `engine.resignable(state, seat)`；不允许返回 `resign_not_allowed`
5. `engine.reduce(state, seat, action, { now, rng })`
6. 事务写 `match_actions`（含 `payload`）、`match_events`、状态并广播

动作 schema 失败属于客户端错误，玩家会看到统一错误提示；不要把“非法走法”写成抛异常，应该返回 `ReduceResult` 的 `{ ok: false, code, message }`。

### 错误码

框架级：`game_not_found`、`match_not_found`、`not_in_match`、`match_not_active`、`match_not_started`、`match_full`、`bad_action`、`bad_message`、`not_enough_players`、`not_host`、`options_locked`、`resign_not_allowed`。

游戏级：自定义，例如 `not_your_turn`、`cell_taken`、`illegal_move`、`invalid_placement`。前端会把 `message` 直接弹 toast。

### 事件

`reduce` 返回的 `events` 会写入 `match_events` 并广播。事件是公开信息，**不要**把秘密坐标、对手舰队、未结算报点写进去。

事件要少：只发玩家需要即时看到的里程碑，常规状态变化靠 `MatchView` 的 `seq` 刷新。框架会把 `match_started`、`game_over`、`match_aborted`、`options_changed` 标为 `level:'major'`，其余默认 `info`。

```ts
{ type: 'move', seat: 0, cell: 4 }
{ type: 'game_over', winner: 0 }
```

`MatchPage` 会把事件交给当前插件的 `eventMessage(event)` 翻译成 toast；返回 `null` 就不提示。

---

## 7. 测试

### 引擎单测

位置：`apps/server/src/games/<id>/engine.test.ts`

只测纯函数，不启动服务器、不连数据库。至少覆盖：

- 初始状态与 `setup`；`waiting` 阶段不应有引擎状态
- `resignable()` 在未结束/已结束时分别返回什么
- 终局 `rankings()`（如果实现）名次是否唯一、覆盖所有座位
- 合法动作推进状态
- 非法动作的错误码
- 终局与 winner
- 视图裁剪（本人 vs 对手 vs 观战者）
- 隐藏字段不出现在 `view` 的 JSON 里

运行：

```bash
pnpm --filter @bgx/server test
```

### 端到端

参考 `apps/web/scripts/e2e-plane-bomb.mjs`，复制后替换动作与断言。它覆盖：

- `/api/games` 能看到新游戏
- 两个游客创建/加入/开局
- 双端 socket 拿到 snapshot/update
- 非法动作错误
- 观战者看不到秘密信息
- 终局与 rematch

本地跑（先用临时库启动服务）：

```bash
DB_PATH=/tmp/bgx-dev.db PORT=8788 HOST=127.0.0.1 \
  node apps/server/dist/index.js

BGX_ORIGIN=http://127.0.0.1:8788 \
BGX_BASE_PATH= \
BGX_SOCKET_PATH=/socket.io \
  node apps/web/scripts/e2e-your-game.mjs
```

---

## 8. 构建与部署

```bash
pnpm build          # protocol → server → web
pnpm test
bash scripts/deploy.sh
```

部署后验证：

- `https://thinktwice.top/bgx/` 大厅出现新游戏卡片
- `GET /bgx/api/games` 返回新游戏与 `description/rules`
- 创建房间、双方入座、动作、聊天、观战、断线重连
- 页面标题/description 随游戏变化
- 移动端棋盘不溢出

---

## 9. 接入检查清单

- [ ] `packages/protocol/src/games/<id>.ts`：catalog、view、action、schema
- [ ] `apps/server/src/games/<id>/engine.ts`：纯函数、JSON 状态、view 裁剪
- [ ] `apps/server/src/games/<id>/index.ts`：导出 `plugin`（含 `meta/actionSchema/actionType/optionSchema/defaultOptions`）
- [ ] `apps/web/src/games/<id>/index.tsx`：导出 `plugin`（含 `meta/Panel/headline/statusLine`）
- [ ] 没有修改 `MatchPage`、`Lobby`、`registry`、`index.ts`、`protocol/index.ts`
- [ ] 有选项时：`options` 定义、默认值、严格 schema 与引擎读取一致
- [ ] 引擎单测通过，隐藏信息不出现在 `view`
- [ ] 本地 e2e 通过，再部署
- [ ] 线上检查大厅、对局、观战、rematch、页面 meta

做到以上，框架不需要为这个游戏改动一行代码。
