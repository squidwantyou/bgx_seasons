# bgx_seasons — 四季物语 / Seasons（BGX 版）

BGX 平台上的《四季物语 / Seasons》完整实现快照：**规则引擎 + 协议/校验 + React 牌桌 + 素材 + 验证脚本 + 开发文档**。

- 支持 **2–4 人**（2 人局可认输，3–4 人不可）
- 卡池：基础 50 张 + 扩展包 ext1「魔法王国」20 张 + ext2「命运之路」20 张（每种 2 张）
- 轮抽 → 3/3/3 组牌库 → 3 年 × 4 季 × 3 月（36 个月）→ 计分结算
- 完整选择系统（11 种弹窗）、徽章、能量上限/重分配、特殊计分、卡牌离场规则
- 素材：175 个 webp（卡图 51 张 + 骰面 120 张 + 元素 4 张），约 1.7 MB

## 说明：这是插件源码快照，不是独立应用

本仓库只含《四季物语》插件本身的源码、素材、脚本与文档；它依赖 BGX 的框架包（`@bgx/protocol` 核心类型、`apps/server/src/games/types.ts`、Web 宿主等），因此**不能单独 `pnpm build`**。要运行/验证，请把文件按下列路径拷回一份 BGX 检出。

## 目录结构

本仓库**按 BGX 仓库原路径镜像**存放，方便直接拷回 BGX：

```
packages/protocol/src/games/      协议类型、Zod 动作/选项 schema、卡表（基础 + 扩展 + 合并表）
apps/server/src/games/seasons/    规则引擎（engine.ts / rules/ / cards/）与单测
apps/server/scripts/              差分 oracle、长跑 soak、体积/性能、UI 动作契约脚本
apps/web/src/games/seasons/       Panel / ChoiceModal / 插件入口 / 样式 / 卡图映射
apps/web/src/assets/seasons/      卡图/骰面/元素 webp
apps/web/scripts/                 素材生成脚本、无浏览器渲染冒烟
docs/                             迁移与开发文档、BGX 插件开发指南、BGA 规则规格
```

## 接入 BGX

把 `packages/`、`apps/` 下同名文件按原路径拷进 BGX 仓库（覆盖同名文件即可），然后：

```bash
cd <bgx-checkout>
pnpm --filter @bgx/protocol build
pnpm --filter @bgx/server build
pnpm --filter @bgx/web build        # 前端需要
```

插件由 BGX 的 loader 自动发现（`apps/server/src/games/seasons/index.ts` 导出 `plugin`），无需改框架代码。

## 验证

```bash
cd <bgx-checkout>
pnpm --filter @bgx/server test                 # 186 个单测
node apps/server/scripts/oracle-seasons.mjs    # 卡表/骰面数据基线（50 + 40 卡 + 120 骰面）
node apps/server/scripts/oracle-seasons-l1.mjs # L1 状态级差分（确定性路径）
node apps/server/scripts/oracle-seasons-l1.mjs --ext
node apps/server/scripts/seasons-soak.mjs 200 2 base,ext1,ext2   # 长跑 + 不变式
node apps/server/scripts/seasons-size.mjs      # state 体积采样（目标 < 15KB）
node apps/server/scripts/seasons-view-perf.mjs # view 渲染耗时
node apps/server/scripts/seasons-ui-flow.mjs   # 只用前端动作打完整局
pnpm --filter @bgx/web smoke                   # 无浏览器 SSR 渲染冒烟（需先 build server）
```

最近一次全量验证（2026-11-23）：

| 项目 | 结果 |
|---|---|
| 单测 | 186 passed |
| 数据基线 | 50 基础卡 + 40 扩展卡 + 4 季 × 5 骰 × 6 面，一致 |
| L1 差分 | 约 120 检查点（基础）/ 约 120（含扩展）一致（随机牌序会导致 ±3 浮动） |
| soak | 2 人 60 局（三包）不变式通过；另有 2/3/4 人各数百局记录 |
| 渲染冒烟 | 1151 次渲染，覆盖 11 种弹窗 |
| state 体积 | 平均 ~6.4KB，p95 ~7.3KB |
| view 耗时 | ~0.006–0.01ms / 次 |

## 文档

- [`docs/seasons-migration.md`](docs/seasons-migration.md) — **主文档**：状态速览（§0）、技术选型、State 设计、随机方案、文件清单、Phase 1–5 路线图与进度看板（§9）、作业流程（§11）、**开发日志与待确认事项（§12）**
- [`docs/developing-games.md`](docs/developing-games.md) — BGX 游戏插件开发指南
- [`docs/seasons_bga_rules_spec.md`](docs/seasons_bga_rules_spec.md) — 参考实现（BGA）的规则规格，效果语义对照用
- [`MANIFEST.md`](MANIFEST.md) — 本仓库文件清单、来源路径与体积

## 相对旧实现的已知取舍

- **随机数**：种子存 state，引擎内 mulberry32 + cursor 推进；不使用 `ctx.rng`，保证回放/差分可复现。
- **附魔魔典卡上能量**：与普通储备完全等价（可支付费用）；离场导致上限下降时，由玩家选择弃掉哪些能量（`energy_discard` 弹窗）。
- **能量上限**：统一按 `maxEnergy` 管理；旧引擎把容量拆成「储备 7 + reserve_slot 卡上空间」且费用不读卡上能量（自相矛盾），本实现不复刻该缺陷。
- **元素护符·风**：召唤等级 +1（前进一格），不是旧卡片数据里的「弃 1 张手牌」（旧数据有误，经确认后修正）。
- **选择 kind**：旧引擎 14 种 kind 中，`card_list_grouped`/`card_multi`/`player_list`/`card_distribute`/`energy_multi`/`card_energy` 由本实现的 `multi_player_pick`/`card_pick`/`branch`/`card_list`/`element_multi` 等价覆盖；`energy_swap` 独立实现。
- **未做**：真浏览器 e2e（机器内存不足，未装 Playwright/Chromium）；断线重连手测（由维护者人工验证）；扩展卡专属美术（复用名称兜底）。

## 许可

内部项目，未附许可证；如需开源请先与作者确认。
