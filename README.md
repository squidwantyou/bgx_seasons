# BGX · 在线多人桌游

> `bgx_seasons` 的 `Angel-develop` 分支保存 2026-11-27 用户验收的完整 BGX
> 工作区，不是主分支的插件摘录。安装：`pnpm install --frozen-lockfile`；
> 构建：`pnpm run build`；本地启动：`node scripts/start-seasons-local.mjs`。
> 规则表与规则书在 `docs/reference/`，验收说明见
> `docs/seasons-rework-2026-11-27.md`，后续交接见远端主分支的 `TO_DS.md`。
> 当前不继续开发、不自动合并、不部署，等待用户具体指令。

前后端分离的在线桌游站点。目前内置**黑白棋（Reversi）**、**炸飞机（Plane Bomb）**和**四季物语（Seasons，2–4 人）**，房间、玩家、对局状态、实时同步、聊天、账号、观战、断线恢复都是通用的。

游戏是**可插拔模块**：服务端引擎、共享协议、前端界面各自按目录自动发现，新增棋种不改框架代码。

- 线上地址：<https://thinktwice.top/bgx/>
- 服务器：单机 Apache（443 上的 piwigo 站点旁边按路径挂载）+ systemd + SQLite
- 前端只做 UI 和请求；棋盘、回合、胜负、玩家数据全部由服务端计算和记录

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19、Vite 6、react-router 7、socket.io-client、手写 CSS |
| 后端 | Node.js 22、Fastify 5、Socket.IO 4、Zod |
| 数据 | SQLite（Node 内置 `node:sqlite`，WAL 模式） |
| 共享 | pnpm workspace + `@bgx/protocol`（核心类型 + 按游戏拆分的类型/schema） |
| 部署 | systemd 单元 `bgx.service` + Apache 反代 + 静态目录 |

选型取舍（为什么不上 PostgreSQL/Redis/消息队列）见 `docs/tech-selection.md`：单服务器、单进程、状态量小的场景下，SQLite + 进程内事件总线足够，后续要横向扩展时再替换。

## 目录结构

```
apps/
  server/        Fastify + Socket.IO；数据层、对局服务、HTTP/WS 入口
    src/games/
      types.ts      游戏引擎/插件契约（框架唯一依赖）
      registry.ts   注册表
      loader.ts     启动时自动发现 games/<id>
      reversi/      黑白棋：engine.ts + index.ts + engine.test.ts
      plane-bomb/   炸飞机：engine.ts + index.ts + engine.test.ts
      seasons/      四季物语：engine.ts + rules/ + cards/ + 测试
  web/           React SPA；只渲染服务端下发的 view
    src/games/
      types.ts      前端游戏插件契约
      index.ts      自动发现 games/<id>/index.tsx
      reversi/      黑白棋 UI 插件
      plane-bomb/   炸飞机 UI 插件
      seasons/      四季物语 UI 插件 + 卡图/骰面资源
packages/
  protocol/
    src/index.ts        与游戏无关的传输/对局结构
    src/games/<id>.ts   每个游戏自己的 catalog、视图、动作、Zod schema
deploy/
  bgx.service    systemd 单元
  apache-bgx.conf Apache 站点片段（/bgx 路径挂载）
scripts/
  deploy.sh      一键构建 + 部署
docs/
  architecture/  BGX 架构图与说明
  games/         游戏规则、接口文档、一图流、新游戏开发指南、四季物语迁移记录
```

### 游戏插件

一个游戏由三块组成，目录名建议与 `catalog.id` 一致：

| 位置 | 内容 |
| --- | --- |
| `packages/protocol/src/games/<id>.ts` | `GameCatalog`、`XxxGameView`、`XxxAction`、`xxxActionSchema`、可选 `xxxOptionsSchema` |
| `apps/server/src/games/<id>/` | 纯函数 `engine.ts`，以及导出 `plugin` 的 `index.ts` |
| `apps/web/src/games/<id>/` | 导出 `plugin` 的 `index.tsx`，以及棋盘/面板组件 |

框架只依赖：

- 服务端 `GamePlugin<S,V,A,O>`：`meta / optionSchema / defaultOptions / actionSchema / actionType / setup / reduce / view / finished / winner / turn`
- 开局选项：`GameCatalog.options` 定义 N 选一 / N 选多；创建房间可传 `options`，等待页房主可通过 `PATCH /api/matches/:id/options` 修改，开局后锁定
- 前端 `GameUiPlugin<V>`：`meta / Panel / headline / statusLine / playerBadge / spectatorNote / eventMessage`

新增游戏时**不需要**改 `MatchPage`、`Lobby`、`registry.ts`、`index.ts` 或 `protocol/index.ts`。完整步骤、接口签名、示例代码和检查清单见 **[docs/games/developing-games.md](docs/games/developing-games.md)**。

### 服务端模块

- `apps/server/src/games/types.ts` — 引擎与插件契约（`GameEngine` / `GamePlugin`）
- `apps/server/src/games/<id>/engine.ts` — 游戏规则（纯函数，不碰数据库和时钟）
- `apps/server/src/games/loader.ts` — 启动时扫描并注册游戏模块
- `apps/server/src/matches.ts` — 房间生命周期、动作 schema 校验、幂等、事件日志、按玩家裁剪视图
- `apps/server/src/realtime.ts` — Socket.IO 鉴权、join/action/chat、按连接重算视图
- `apps/server/src/http.ts` — REST：`/api/me`、`/api/auth/*`、`/api/games`、`/api/matches`、`/api/users/:id`（玩家主页）、聊天记录
- `apps/server/src/profiles.ts` — 玩家主页：公开资料、战绩统计、历史对局（私密对局仅参与者可见）
- `apps/server/src/password.ts` — scrypt 密码哈希与校验（不引入额外依赖）

游戏相关文档：

- `docs/games/plane-bomb-rules.md` — 炸飞机规则（v1.1）
- `docs/games/plane-bomb-interface.md` — 炸飞机技术接口（引擎 / 协议 / 视图 / 测试）
- `docs/games/plane-bomb-one-pager.md` — 炸飞机一图流玩法（PNG）
- `docs/games/developing-games.md` — **新游戏开发指南**
- `docs/architecture/README.md` — BGX 架构全貌（分层、接口、链路、数据模型）

## 账号

- 游客开箱即用：首次访问自动建游客身份（Cookie 会话），可直接玩
- 注册：用户名（字母开头，3-24 位字母/数字/下划线）+ 密码（≥8 位，scrypt 加盐哈希）
- 游客注册会**升级当前用户**，保留已参与的对局与座位
- 登录成功后换发新会话并绑定账号（防会话固定），可在其他设备登录同一账号
- 登录失败限流：单 IP 5 分钟 10 次；错误提示不区分“用户不存在/密码错误”

## 玩家主页

- 点击任意玩家头像（页头、房间玩家列表、大厅房间卡、聊天）进入 `/p/:userId`
- 展示该玩家的胜/负/和统计与所有历史对局，可直接点进对局回看
- 私密房间只对参与者可见，不会通过主页泄露邀请链接

## 本地开发

要求 Node.js ≥ 22（需要内置 `node:sqlite`）和 pnpm。

```bash
pnpm install
pnpm dev          # protocol + server(8787) + web(5173) 并行
```

打开 <http://localhost:5173/bgx/>。Vite 会把 `/bgx/api` 和 `/bgx/socket.io` 代理到 `127.0.0.1:8787`。

```bash
pnpm test         # 引擎单元测试（Vitest）
pnpm build        # 构建三个包
pnpm smoke        # 线上端到端冒烟（默认 https://thinktwice.top/bgx，可用 BGX_ORIGIN 覆盖）
node apps/web/scripts/e2e-plane-bomb.mjs   # 炸飞机线上端到端
```

服务端环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DB_PATH` | `apps/server/data/bgx.db` | SQLite 文件 |
| `PUBLIC_BASE_PATH` | `/` | 对外路径前缀，决定 Cookie Path，线上为 `/bgx` |
| `COOKIE_SECURE` | 关闭 | `1` 时 Cookie 加 `Secure` |
| `LOG_LEVEL` | `info` | pino 日志级别 |

## 架构约定

1. **服务端权威**：前端不能直接改棋盘。所有动作都走 `action`，由当前游戏的 `actionSchema` 校验、`engine.reduce` 判定，再把新视图广播出去。
2. **插件隔离**：框架不 import 任何具体游戏；服务端靠目录扫描，前端靠 `import.meta.glob`。游戏规则/视图类型只在各自的协议模块里。
3. **事件日志与幂等**：每次动作写入 `match_events` 与 `match_actions`（`action_id` 幂等，重复提交不会执行两次），`matches.state` 存当前快照。
4. **按玩家投影**：`buildView(matchId, userId)` 对每个连接重新计算 `view`；隐藏信息（对手舰队、未结算报点、可落子位置）不会下发。引擎代码不进前端 bundle。
5. **会话**：首次请求自动创建匿名用户与 httpOnly Cookie（`bgx_sid`，Path=`/bgx`），Socket.IO 握手复用同一个 Cookie。
6. **随机与开局**：每局创建时生成只存服务端的 `seed`，引擎 `setup` 通过注入的 `RandomSource` 得到可复现随机序列；房间支持 2-N 人，房主点击「开始对局」后框架才按实际人数初始化并开战；等待阶段没有引擎状态。

## 部署

```bash
pnpm deploy
```

`scripts/deploy.sh` 会：

1. `pnpm install && pnpm build`
2. 前端 `apps/web/dist` → `/var/www/bgx`
3. 整个仓库（含 `node_modules`）→ `/opt/bgx/app`，供 systemd 以 `bgx` 用户运行 `apps/server/dist/index.js`
4. 创建系统用户 `bgx`、数据目录 `/var/lib/bgx`（SQLite：`/var/lib/bgx/bgx.db`）
5. 安装并重启 `bgx.service`（监听 `127.0.0.1:8787`）
6. 安装 `/etc/apache2/conf-available/bgx.conf`，启用 `proxy_http`、`proxy_wstunnel`，`configtest` 后 reload Apache
7. 健康检查 `http://127.0.0.1:8787/healthz` 

Apache 只做了路径级挂载：`/bgx` 走静态目录 + SPA 回退，`/bgx/api`、`/bgx/socket.io` 反代到本机 8787。

常用运维命令：

```bash
sudo systemctl status bgx
sudo journalctl -u bgx -f
sudo systemctl restart bgx
```

## 新增一个游戏

1. 在 `packages/protocol/src/games/<id>.ts` 写 catalog、视图、动作和 Zod schema
2. 在 `apps/server/src/games/<id>/` 实现纯函数引擎并导出 `plugin`
3. 在 `apps/web/src/games/<id>/` 实现 `GameUiPlugin` 并导出 `plugin`
4. 写引擎单测，跑 `pnpm test && pnpm build`
5. `pnpm deploy`，线上验证大厅、对局、观战、断线重连

不用改框架。详细接口、示例代码与检查清单见 **[docs/games/developing-games.md](docs/games/developing-games.md)**。

## 开发记录

按里程碑整理的开发过程见 **[CHANGELOG.md](CHANGELOG.md)**。

## 后续可加

- 回合计时与超时判负（引擎 `ctx.now` 已预留）
- 排行榜与对局回放（`match_actions` 已保存动作原文；隐藏信息仍需按视角处理）
- 多实例部署时把 `bus` 换成 Redis pub/sub，SQLite 换 PostgreSQL
- 观战聊天、好友/邀请、邮件验证与找回密码
