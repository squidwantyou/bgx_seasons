# 开发记录

BGX 从一个空仓库开始，按“先跑通、再抽象、后加固”的顺序迭代。下面是主要里程碑；更细的规则、接口与架构说明见 `docs/`。

## 2026-11 · 立项与骨架

- 完成技术选型：[docs/tech-selection.md](docs/tech-selection.md)
- 建立 pnpm workspace：`packages/protocol`、`apps/server`、`apps/web`
- 服务端采用 Fastify 5 + Socket.IO 4 + Node 内置 SQLite（WAL）
- 前端采用 React 19 + Vite 6 + React Router 7
- 实现第一个游戏黑白棋，并确定三条架构原则：
  - 服务端权威：引擎是纯函数，前端只发动作意图
  - 事件溯源：`match_events` + `match_actions` + `matches.state` 快照
  - 按玩家投影：`buildView` 按 userId 裁剪隐藏信息

## 2026-11 · 上线与账号

- 路径式部署到 `https://thinktwice.top/bgx/`，不动同机 piwigo 站
- Apache 反代 REST 与 WebSocket；systemd `bgx.service` 管理 Node 进程
- 游客自动建号、Cookie Session、改昵称
- 注册 / 登录 / 退出：scrypt 密码哈希、唯一用户名、登录换发 session
- 玩家主页与历史对局，头像可点击进入

## 2026-11 · 第二个游戏与插件化

- 炸飞机（10×10、三架“士”字形飞机、同轮报点同时结算、3:3 平局）
- 规则文档、接口文档、一图流：[docs/games/](docs/games/)
- 游戏从框架剥离为可插拔模块：
  - 协议：`packages/protocol/src/games/<id>.ts` 自带 catalog/视图/动作/Zod
  - 服务端：`apps/server/src/games/<id>/` 导出 `GamePlugin`，启动时自动发现
  - 前端：`apps/web/src/games/<id>/` 导出 `GameUiPlugin`，`import.meta.glob` 自动发现
- 框架不再出现具体游戏 import 或分支；新增游戏只加三个目录
- 开发指南：[docs/games/developing-games.md](docs/games/developing-games.md)
- 架构图与说明：[docs/architecture/](docs/architecture/)

## 2026-11 · 开局选项与随机

- 游戏可声明 N 选一 / N 选多开局选项；创建房间时选择，等待阶段房主可改
- 炸飞机新增“已坠落飞机再次被炸返回炸中 / 炸空”选项
- 引擎 `setup(playerCount, options, rng)` 可复现随机源；种子只存服务端
- 房间支持 2–N 人；加入只入座，房主点击「开始对局」后才按实际人数初始化
- 再来一局回到等待状态，选项和随机种子重新处理

## 2026-11 · 机制加固

- `reduce` 可注入 `ctx.rng`；引擎声明 `resignable`，`MatchView.canResign` 控制认输按钮
- `waiting` 阶段不初始化引擎状态、不渲染游戏 Panel；`MatchView.game` 为 `null`
- `match_actions.payload` 保存动作原文；事件区分 `info` / `major`
- 房主可中止进行中的对局；终局 `aborted=true`
- `match_rankings` 持久化终局名次（2 人局已接入，4 人局为后续游戏预留）
- 四季物语（Seasons，2–4 人）插件与卡图资源迁移；迁移记录见 [docs/games/seasons-migration.md](docs/games/seasons-migration.md)

## 2026-11 · 仓库化

- 当前版本归档为 Git 仓库，包含源码、测试、部署配置、文档与开发记录
- 部署与测试入口：`README.md`、`scripts/deploy.sh`、`apps/web/scripts/e2e-*.mjs`
