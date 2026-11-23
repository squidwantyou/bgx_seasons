# 在线多人桌游网站 · 技术选型（项目立项文档）

> 实施注：这是项目立项时的选型文档。最终落地为单机 SQLite + Apache 路径挂载，而非文中的 PostgreSQL + Docker Compose + Caddy；三条架构原则（服务端权威、事件溯源、按玩家视图投影）保持不变。

> 日期：2026-11 · 范围：前后端分离的 Web 桌游平台（大厅 → 房间 → 对局 → 结算）
>
> 前提假设（若与实际不符，见 §9 的替换触发条件）：
> 1. **回合制/卡牌/棋盘类**桌游（非动作类实时游戏）；
> 2. **单台服务器**部署，目标是先跑通、能撑住千级并发对局；
> 3. 前端只做 UI 与发请求，**不含任何规则判定**；
> 4. 有隐藏信息（手牌、身份、牌堆顺序），需要防作弊。

---

## 0. 一句话结论

**TypeScript 全栈 monorepo**：前端 React + Vite，后端 Node/Fastify + Socket.IO，PostgreSQL 存权威状态，单机 Docker Compose + Caddy 部署。

但真正决定项目成败的不是框架，而是三条架构原则：**服务端权威、事件溯源、按玩家视图投影**。这三条选错了，换任何框架都救不回来；选对了，前端用 Vue 还是 React 都只是口味问题。

---

## 1. 推荐技术栈

| 层 | 选择 | 用途 / 理由 |
|---|---|---|
| 语言 | TypeScript 5.x（全栈） | 协议类型前后端共享，减少联调错误 |
| 仓库 | pnpm workspaces（+ Turborepo 可选） | 前后端 + 共享包同一仓库 |
| 前端框架 | React 19 + Vite | 生态最大、组件库多、招人容易 |
| 路由 | React Router | SPA 路由 |
| 样式 | Tailwind CSS v4 + shadcn/ui | 快速做桌面/移动端自适应 UI |
| 客户端状态 | Zustand | 轻量，按 matchId 建 store |
| 服务端数据 | TanStack Query | 大厅列表、战绩等 REST 数据的缓存/重试 |
| 实时 | Socket.IO client | 房间、重连、ack、心跳开箱即用 |
| 动画 | Motion（framer-motion） | 发牌/移动/翻牌动画，事件队列串行播放 |
| 后端运行时 | Node.js 24 LTS（或 22 LTS） | 与前端同语言，I/O 密集场景足够 |
| HTTP 框架 | Fastify 5 | 快、内置 JSON Schema 校验、插件生态好 |
| 实时服务 | Socket.IO 4 | 见 §2.2 与原生 ws 的取舍 |
| 校验 | Zod（`packages/protocol` 共享） | 同一份 schema 同时产出 TS 类型和运行时校验 |
| ORM | Drizzle ORM + postgres.js | SQL 友好、类型安全、迁移轻 |
| 数据库 | PostgreSQL 16+ | 事务、JSONB、并发控制；见 §2.5 |
| 认证 | better-auth，或自建 Cookie Session（约 100 行） | httpOnly Cookie + 服务端 session，可吊销 |
| 日志/监控 | pino + Sentry + `/metrics`（prom-client） | 结构化日志带 matchId/seq，便于复盘 |
| 测试 | Vitest + fast-check + Playwright + k6 | 引擎属性测试、多浏览器 E2E、WS 压测 |
| 部署 | 单台 VPS + Docker Compose + Caddy | 自动 HTTPS、反代、静态资源、WS 转发 |
| CI/CD | GitHub Actions → 镜像 → SSH 部署 | 单机不需要 K8s |

**不需要的东西（第一版）**：Redis、消息队列、微服务、Kubernetes、GraphQL、SSR。单机回合制游戏用不上，加了只是增加故障面。

---

## 2. 关键决策与理由

### 2.1 为什么全栈 TypeScript

- **协议即类型**：`packages/protocol` 里一份 Zod schema，前端 `z.infer` 得到类型，后端用它校验入站消息。改字段时前后端一起编译报错。
- **性能足够**：回合制对局的瓶颈是连接数和数据库小事务，不是 CPU。Node 单进程轻松处理数千条空闲 WebSocket。
- **协作成本低**：一个人也能同时改前后端；团队里前端同学能读后端逻辑。
- **代价**：规则计算如果很重（例如 AI 搜索、复杂路径规划）会阻塞事件循环。对策：每个房间的动作用串行队列，重计算丢 `worker_threads`；真到这一步再考虑把引擎拆成 Go 服务。

> 如果团队已经是 Vue 或 Go 技术栈，不要为了"推荐"硬换，见 §9。

### 2.2 通信：REST + 一条 WebSocket

| 方案 | 结论 | 理由 |
|---|---|---|
| REST + WebSocket | ✅ 采用 | 大厅/登录用 REST，对局用 WS 推送；职责清晰 |
| REST + 轮询 | ❌ | 延迟高、无效请求多、移动端耗电 |
| SSE + POST | ⚠️ 可行 | 回合制节奏慢，SSE 够用且走标准 HTTP；但每个动作两次往返、服务端主动 ack 麻烦、HTTP/1.1 下每域连接数受限 |
| GraphQL Subscription | ❌ | 多一层复杂度，实时游戏收益低 |
| WebRTC DataChannel | ❌ | 需要信令与 NAT 穿透，服务端权威反而更难做 |

**Socket.IO vs 原生 `ws`**：

- Socket.IO 自带房间广播、自动重连、ack、心跳、断线降级（polling fallback），这些恰好是桌游最需要的，能省 1~2 周。
- 代价：私有协议（非标准 WebSocket 帧）、客户端几十 KB、前后端版本要匹配。
- **建议**：用 Socket.IO，但在前端包一层 `Transport` 接口（`connect/emit/subscribe`），把重连与消息序号逻辑放在自己的 store 里。将来换原生 ws 或 SSE 时只改这一层。

### 2.3 服务端权威 + 事件溯源（最重要的一条）

客户端**只发送意图**，不计算规则、不产生随机数、不决定结果：

```ts
// packages/engine —— 纯函数，无 I/O、无全局状态
interface GameEngine<S, A, E> {
  setup(ctx: { seed: string; players: Seat[]; config: unknown }): S;
  reduce(state: S, action: A, ctx: { now: number; rng: Rng; seat: Seat }):
    | { ok: true; state: S; events: E[] }
    | { ok: false; code: string };
  legalActions(state: S, seat: Seat): ActionMeta[];
  viewFor(state: S, viewer: Viewer): PlayerView;   // 每个玩家只看到自己的视图
}
```

要点：

1. **确定性**：引擎里禁止直接调用 `Date.now()` / `Math.random()`，时间与随机数由 `ctx` 注入。否则回放、断线重连、bug 复现全部失效。
2. **追加事件日志**：每个成功动作写一条 `match_events(seq)`，`matches.state` 每 N 条或每回合存一次快照。状态 = 快照 + 重放。
3. **收益**：断线重连、观战、回放、审计、撤销、线上问题复现、防作弊，全部由这一条设计免费获得。
4. **成本**：事件 schema 会演进，需要 `version` 字段 + 升级函数；旧对局按旧版本重放。

### 2.4 按玩家视图投影（隐藏信息）

- 手牌、身份、牌堆顺序**只存在于服务端**，前端永远收不到全量 state。
- 每个连接只收到 `viewFor(state, viewer)`；观战者是脱敏视图（或延迟 N 回合的视图）。
- 服务端随视图下发 `legalActions`，前端只负责"哪些按钮可点"，**不复制规则**——这是"前端只做 UI"的落地方式。
- 防泄漏测试要进 CI：

```ts
const view = JSON.stringify(engine.viewFor(state, seatA));
expect(view).not.toContain(cardInHandOfB.id);
```

再加属性测试：遍历所有座位与所有观战者，视图里只允许出现自己的私有区域。

### 2.5 数据库：Postgres 为主，不要急着上 Redis

| 选项 | 结论 | 理由 |
|---|---|---|
| PostgreSQL | ✅ 默认 | 事务保证 seq 连续；JSONB 存快照与配置；`SELECT … FOR UPDATE` 处理并发；将来可加只读副本 |
| SQLite（WAL） | ✅ 可接受的极简版 | 单机零运维、备份简单（Litestream）；但并发写弱、无法多进程、未来迁移有成本 |
| MongoDB | ❌ | 用户/座位/对局是关系型数据，事务与约束更省心 |
| Redis | ⏳ 暂缓 | 单进程用内存 Map + Postgres 就够。等要多进程/多机时再加：Socket.IO adapter、session、限流、在线状态 |

**判断标准**：如果你确定"未来一年就是一台机器、一个 Node 进程"，SQLite 是更省事的选择；只要有一丝可能加进程或加机器，直接上 Postgres，别中途迁移。

### 2.6 前端渲染：DOM/CSS 优先

- 卡牌、棋盘、计分板用 **DOM + CSS Grid/绝对定位 + transform 动画**：文本清晰、可访问性好、调试直观、移动端适配简单。
- Canvas/PixiJS 只在"同屏几百个动态精灵/粒子/物理"时才需要；绝大多数桌游用不上。
- 3D（Three.js/Babylon.js）除非产品明确要求，否则不做——成本高、移动端性能差、UI 难做。

**动画与状态同步**：服务端事件带 `seq`，前端维护一个动画队列按序播放；播放期间禁止本地改状态，避免"动画还没播完状态已跳变"。

### 2.7 认证与账号

- **Cookie Session**：`httpOnly; Secure; SameSite=Lax` + `sessions` 表。比 JWT 更容易吊销、不用处理刷新令牌。
- WebSocket 握手校验同源 + session；**不要把 token 放 query string**（会进访问日志）。
- **游客账号**：匿名 ID 直接开局，之后可绑定邮箱/第三方登录升级。桌游的转化率非常依赖"点开就能玩"。
- 密码哈希用 argon2id；登录接口做限流与防枚举。

---

## 3. 系统结构

```
┌─────────────┐      HTTPS / WSS       ┌──────────────────────────────┐
│  浏览器      │ ─────────────────────▶ │  Caddy（TLS、静态资源、反代）  │
│  React SPA  │ ◀───────────────────── │                              │
└─────────────┘                        └───────────┬──────────────────┘
                                                   │
                        ┌──────────────────────────┴───────────────────┐
                        │  Fastify (Node 单进程)                        │
                        │  ├─ /api/*   REST：认证、大厅、战绩、回放       │
                        │  └─ /socket.io  WS：加入房间、动作、聊天、心跳  │
                        │                                               │
                        │  MatchRegistry（内存）                        │
                        │   └─ 每个 match 一个串行队列（避免竞态）        │
                        │        └─ engine.reduce（纯函数）              │
                        │             ├─ 写 match_events（事务）         │
                        │             ├─ 存快照（每 N 条/每回合）         │
                        │             └─ 广播 viewFor(seat) + 事件        │
                        │                                               │
                        │  TimerScheduler：扫描 deadline_at 到期对局      │
                        └──────────────────────────┬───────────────────┘
                                                   │
                                        ┌──────────┴─────────┐
                                        │   PostgreSQL        │
                                        │   users / matches   │
                                        │   match_events …    │
                                        └────────────────────┘
```

**目录结构**

```
.
├─ apps/
│  ├─ web/                 # React SPA（只依赖 protocol 包）
│  │  └─ src/{features/lobby, features/table, components, lib, stores}/
│  └─ server/              # Fastify + Socket.IO
│     └─ src/{http, ws, matches, timers, db, auth}/
├─ packages/
│  ├─ protocol/            # Zod schema + 消息类型（前后端共享）
│  └─ engine/              # 规则引擎（仅服务端引用，纯函数）
├─ docker-compose.yml
└─ Caddyfile
```

**依赖方向**：`web → protocol`；`server → protocol + engine`。**engine 永远不进前端 bundle**，从物理上杜绝隐藏信息泄漏。

---

## 4. 数据模型（草案）

```sql
users (
  id uuid pk, handle citext unique, display_name text,
  avatar_url text, password_hash text null, is_guest bool,
  created_at timestamptz default now()
);

sessions (
  id text pk, user_id uuid fk, expires_at timestamptz, created_at timestamptz
);

games (                          -- 游戏定义（代码注册，DB 只存元信息）
  id text pk, name text, version int,
  min_players int, max_players int, config_schema jsonb
);

rooms (
  id uuid pk, game_id text fk, host_id uuid,
  status text,                    -- lobby | playing | closed
  visibility text,                -- public | private
  created_at timestamptz
);

matches (
  id uuid pk, room_id uuid, game_id text, engine_version int,
  status text,                    -- active | finished | aborted
  version int default 0,          -- 乐观锁 + 客户端对账
  state jsonb,                    -- 最近一次快照
  snapshot_seq int,
  seed text,                      -- 服务端生成，永不外发
  deadline_at timestamptz null,   -- 当前行动者的超时时间
  created_at timestamptz, ended_at timestamptz
);

match_seats (
  match_id uuid, seat int, user_id uuid, ready bool,
  connected bool, last_seen_seq int,
  primary key (match_id, seat)
);

match_events (                    -- 追加日志，只增不改
  match_id uuid, seq int, actor_seat int null,
  type text, payload jsonb, created_at timestamptz,
  primary key (match_id, seq)
);

match_actions (                   -- 幂等：客户端重发不重复执行
  match_id uuid, action_id uuid, seat int, seq int,
  primary key (match_id, action_id)
);

chat_messages (
  id bigserial pk, match_id uuid, user_id uuid, body text, created_at timestamptz
);
```

关键约束：

- `match_events(match_id, seq)` 主键保证序号连续、不重复；
- 写事件与更新 `matches.version` 在**同一事务**内，配合 `UPDATE … WHERE version = ?` 防并发；
- 单进程下每个 match 先过内存串行队列，DB 约束只是兜底。

---

## 5. 实时协议（草案）

```ts
// 客户端 → 服务端
type ClientMsg =
  | { t: 'resume';  matchId: string; lastSeq: number }        // 连接/重连后恢复
  | { t: 'action';  matchId: string; actionId: string; action: unknown }
  | { t: 'chat';    matchId: string; text: string }
  | { t: 'ping';    at: number };

// 服务端 → 客户端
type ServerMsg =
  | { t: 'snapshot'; matchId: string; seq: number; view: PlayerView;
      legal: ActionMeta[]; deadline?: number }
  | { t: 'events';   matchId: string; from: number; to: number;
      events: GameEvent[]; view?: PlayerView }                 // view 可增量下发
  | { t: 'error';    code: string; message: string; actionId?: string }
  | { t: 'pong';     at: number };
```

约定：

- 每条动作带 `actionId`（UUID），服务端以 `match_actions` 去重；网络抖动重发不会执行两次。
- 客户端保存 `lastSeq`；重连时发 `resume`，服务端回 `snapshot` + `seq` 之后的事件。事件已清理则只回快照。
- 服务端对动作的校验顺序：鉴权 → 座位归属 → 幂等 → 引擎规则 → 事务写入 → 广播。
- 广播只发"事件 + 各自视图"，**不广播完整 state**。
- 同一用户多标签页：允许，但同一 match 只保留一个"活跃连接"用于操作，其余只读。

**超时**：`matches.deadline_at` 是唯一真相，调度器每秒扫一次到期对局并触发 `onTimeout`（托管/弃牌/跳过）。服务重启后从 DB 恢复，不依赖内存里的 `setTimeout`。

---

## 6. 单机部署

```
公网 443 ── Caddy ──┬── /            → 静态文件（apps/web/dist，SPA fallback）
                    ├── /api/*       → app:3000
                    └── /socket.io/* → app:3000（自动升级 WS）
```

`docker-compose.yml` 三件套：

| 服务 | 镜像 | 说明 |
|---|---|---|
| `caddy` | `caddy:2` | 自动申请证书；反代与静态资源 |
| `app` | 自建（多阶段构建，非 root 运行） | Node 单进程；`restart: unless-stopped` |
| `db` | `postgres:17` | 命名卷持久化；只监听内网 |

运维要点：

- **备份**：每日 `pg_dump -Fc` 到对象存储，保留 14 天；每月做一次恢复演练。数据量小，全量备份成本可忽略。
- **健康检查**：`/healthz`（进程 + DB ping）；Caddy/外部监控（Uptime Kuma）告警。
- **日志**：pino JSON → 文件 + 轮转；错误同时上报 Sentry（前后端）。
- **发布**：`docker compose up -d --build`，重启会断开所有 WS —— 客户端本来就要处理重连，所以可接受；选在低峰期。要做零掉线需双实例 + 共享状态，第一版不值得。
- **安全**：只暴露 80/443；DB 不对公网；容器非 root；定期 `docker scout`/`npm audit`。

---

## 7. 容量与成本估算

| 指标 | 估算 |
|---|---|
| 单条空闲 WS 连接内存 | ~10–50 KB（含 socket 缓冲） |
| 2 vCPU / 4 GB 可承载连接 | 约 5k–10k（回合制消息频率极低） |
| 1,000 场 4 人对局 | ~4,000 连接；动作消息峰值 < 200 msg/s；PG 写入 < 100 TPS |
| 单场对局状态大小 | JSONB 几 KB ~ 几十 KB；事件每场几十~几百条 |
| 服务器 | 2 vCPU / 4 GB VPS，约 $10–20/月，足够 MVP + 早期增长 |

结论：**性能不是这个项目的风险**，规则正确性、隐藏信息、断线体验才是。

---

## 8. 测试策略

1. **引擎单测**（Vitest）：每个动作的正常/非法路径；边界局面。
2. **属性测试**（fast-check）：随机动作序列下状态不变式成立、seq 单调、重放两次得到相同状态哈希、视图不含他人私有数据。
3. **E2E**（Playwright）：两个 browser context 模拟两名玩家，完整跑一局；覆盖刷新页面、断网重连、超时托管。
4. **压测**（k6 WebSocket）：1,000 连接 / 200 房间，测量动作往返 P95、内存增长。
5. **故障演练**：对局中 `kill -9` 服务，重启后玩家能恢复到正确状态。

---

## 9. 什么情况下换选型

| 你的实际情况 | 调整 |
|---|---|
| 团队熟 Vue | 前端换 Vue 3 + Pinia + Vite；后端与架构不变 |
| 团队熟 Go / 想要更强并发 | 后端换 Go（chi + coder/websocket + pgx + sqlc）；用 OpenAPI 生成前端 TS 类型 |
| 长期运营、海量房间、想要每房间独立进程 | Elixir + Phoenix（Channels + Presence + GenServer/Registry），这是实时房间类应用最顺的模型，但招人难 |
| 一周内要出可玩原型 | boardgame.io（内置回合、阶段、秘密状态、大厅）；注意其维护节奏已放缓，适合验证不适合长期底座 |
| 动作类/强实时（如实时对战） | Colyseus（房间 + 状态同步）或 Go 自研；前端 PixiJS；本方案不适用 |
| 需要语音（狼人杀/剧本杀） | 加 LiveKit（SFU），与游戏逻辑解耦；不要自己写 WebRTC |
| 确定永远单机、想零运维 DB | SQLite + WAL + Litestream 备份，替换 Postgres |
| 需要 3D 棋盘 | Three.js/Babylon.js + 服务端仍为权威；渲染层替换，协议不变 |

---

## 10. 风险清单

| 风险 | 影响 | 对策 |
|---|---|---|
| 规则引擎复杂度被低估 | 工期失控 | 先只做**一款**游戏端到端跑通，第二款再抽象；不要一上来做"通用桌游引擎" |
| 隐藏信息泄漏 | 作弊、口碑崩塌 | 视图投影 + CI 泄漏测试 + 前端 bundle 不含 engine |
| 断线/刷新体验差 | 玩家流失 | 第一版就做 `seq` + 快照恢复；不要留到"以后优化" |
| 计时器依赖内存 | 重启后对局卡死 | `deadline_at` 落库，启动时重建调度 |
| 事件 schema 演进 | 旧对局无法重放 | 事件带 `version`，写升级函数；回放测试进 CI |
| 单点故障 | 全站不可用 | 每日备份 + 快速重建脚本（compose + 镜像 + 卷）；接受 MVP 阶段的小时级 RTO |
| 框架锁定（Socket.IO / boardgame.io） | 迁移成本 | 传输层封装接口；引擎与传输解耦 |
| 过早加 Redis/微服务 | 复杂度爆炸 | 单机单进程，明确"何时才加"的触发条件（>1 进程 / >1 机器） |

---

## 11. 建议的落地顺序

1. **M1 骨架**：monorepo、CI、`protocol` 包、Fastify + Socket.IO 握手、Caddy 部署跑通。
2. **M2 单游戏闭环**：一款规则最简单的游戏（如井字棋/UNO 简化版），含房间、开始、动作、结算、重连、超时。
3. **M3 体验**：观战、回放、聊天、游客账号、移动端适配。
4. **M4 验证抽象**：接第二款规则差异大的游戏，重构引擎接口（此时才知道通用层该长什么样）。
5. **M5 上线**：备份、监控、压测、故障演练、限流与风控。

**一句话**：先把"权威状态 + 事件日志 + 视图投影 + 重连"这四件事做对，框架选型只是让它们写起来更顺手。
