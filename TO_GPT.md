# TO_GPT.md — 来自 DS（DeepSeek）的协作说明

> 你好！这是我们共同维护的「四季物语 / Seasons」BGX 移植项目。
> 我会持续更新这份文件；你给我的说明请写在同目录的 `TO_DS.md`，我每个工作时段开头都会读。
> 最后更新：2026-11-25 22:10（Asia/Shanghai）

---

## 1. 项目是什么

把旧项目 `/home/squid/seasons_web/seasons-web` 的《四季物语》桌游搬到 BGX 框架里，做成 BGX 插件：

- **后端 / 规则引擎**：`apps/server/src/games/seasons/`（纯函数 reducer，随机数用 mulberry32 + cursor，seed 存在 state 里）
- **协议层**：`packages/protocol/src/games/seasons*.ts`（Zod 动作外壳、视图类型、50 张基础卡数据）
- **前端**：`apps/web/src/games/seasons/`（React 19 + 自研牌桌，CSS 全部 `ss-` 前缀）
- **验证脚本**：`apps/server/scripts/`（数据基线 / L1 状态级差分 / soak / ui-flow / size / view-perf）
- **两个仓库**：
  - `/home/squid/DSH_workspace/bgx`：BGX 框架工作区（也含本插件与所有文档），远端 `git@github.com:squidwantyou/boardgamex.git`
  - `/home/squid/DSH_workspace/bgx_seasons`：本插件 + 文档的独立仓库（GitHub `squidwantyou/bgx_seasons`），是 `bgx` 的 submodule
  - 改动通常两边一起提交；`bgx` 里 submodule 指针要跟着前滚

线上：`https://thinktwice.top/bgx/`（Apache 静态 + `bgx.service`，端口 8787，`/bgx/api` 反代）

---

## 2. 现在做到哪了（2026-11-25）

**规则引擎：功能完整**
- 2–4 人局；轮抽 → 3/3/3 组牌 → 12 个月 × 3 年；召唤 / 激活 / 晶化 / 徽章 / 回合末 / 换季 / 计分全部实现
- 基础 50 张卡效果全部实现（含选择弹窗：元素分配、选牌、多人依次选、换牌、月份推进、能量重分配/弃置等 11+ 种）
- 3 种卡池：`standard`（标准 50 张 ×2）、`five_fortunes`（五福季节：5 张护符 ×20）、`dice_season`（骰子季节：100 张恶意之骰）
- 支持 `customDeck` 字符串选项（脚本/测试用，界面不暴露）
- 差分 oracle：L1 与旧引擎逐状态比对（约 118–121 检查点，旧引擎随机牌序会有浮动）

**前端：F1–F7 计划已完成**
- 三段式牌桌、座位四色、行动者高亮、骰池动效、事件横幅队列、资源浮字、回合提示
- 元素堆叠、卡牌三形态（手牌大卡 / 场上小卡 / 牌堆背面）、卡牌详情浮层、术语速查
- 召唤两步确认、费用不足置灰并给原因、组牌按年预览与撤回、结束回合防误触
- 响应式、44px 触控、键盘可达、focus trap、新手三步引导、reduced-motion
- 验证：`pnpm --filter @bgx/web build` + `pnpm --filter @bgx/web smoke`（smoke 会 SSR 渲染 1187 次，覆盖 11 种弹窗，并测渲染耗时）

**已知差异 / 待办**
- `energy_swap` 容量语义：旧引擎把「储备区 7 + 附魔魔典卡上 maxEnergy−7」分开算，我们统一按 maxEnergy（已记录为「待确认」，用户未拍板要复刻）
- 44 死灵匕首以卡面为准（弃手牌随从或牺牲场上随从），旧引擎是牺牲本卡；L1 因此跳过该卡
- 39 提图斯按用户裁定：有对手付不起就牺牲，不收其他人水晶
- 观战/断线重连只做了视图裁剪与隐私，未做真机重连测试
- 没有浏览器 e2e（用户以内存为由明确不装 Playwright）；`smoke` 是无浏览器 SSR 冒烟

---

## 3. 命令速查

```bash
cd /home/squid/DSH_workspace/bgx

# 构建（机器只有 2GB 内存，务必带内存参数，别把机器打爆）
NODE_OPTIONS=--max-old-space-size=384 pnpm --filter @bgx/protocol build
NODE_OPTIONS=--max-old-space-size=384 pnpm --filter @bgx/server build
NODE_OPTIONS=--max-old-space-size=512 pnpm --filter @bgx/web build

# 测试 / 冒烟
pnpm --filter @bgx/server test        # vitest，当前约 176 tests
pnpm --filter @bgx/web smoke          # SSR 渲染冒烟（需先 build protocol/server）

# 差分与压测（均不进 CI）
node apps/server/scripts/oracle-seasons.mjs          # 卡表/骰子数据基线
node apps/server/scripts/oracle-seasons-l1.mjs       # 与旧引擎逐状态差分
node apps/server/scripts/seasons-soak.mjs 100 2      # 局数 人数 [卡池/随机池大小]
node apps/server/scripts/seasons-size.mjs            # state 体积
node apps/server/scripts/seasons-view-perf.mjs       # view 耗时
node apps/server/scripts/seasons-ui-flow.mjs         # 只发前端会发的动作打完整局
```

部署（用户明确说「部署」时才做）：

```bash
# 1) 三包 build（见上，带内存参数）
# 2) 静态前端
sudo rsync -a --delete --chmod=D755,F644 apps/web/dist/ /var/www/bgx/
# 3) 服务端 + 协议 dist
sudo rsync -a --delete --chmod=D755,F644 --exclude '.git' --exclude 'data' \
  --exclude 'apps/web/src' --exclude 'apps/web/dist' ./ /opt/bgx/app/
sudo systemctl restart bgx
curl -s localhost:8787/healthz
```

---

## 4. 约定（请尽量遵守，避免互相踩）

1. **不动 BGX 框架核心**：`server.ts` / `matches.ts` / protocol 核心 / `MatchPage` 等，除非确实必要且说明理由。新东西放 `games/seasons/` 与 `protocol/games/`。
2. **规则层不猜**：卡面与旧引擎冲突、或用户裁定过的行为，以用户裁定为准；不确定就写进 `docs/games/seasons-migration.md` §12「待确认」并跳过。
3. **改完必须验证**：server test + web build + smoke；涉及差分/卡表再跑 oracle / L1。
4. **每次收工更新文档**：
   - `docs/games/seasons-migration.md`：§0 状态、§9 看板、§12 日志
   - `docs/games/seasons-frontend-plan.md`：§0 / §5 进度表 / §7 日志
   - 本文件 `TO_GPT.md`：最近做了什么、下一步、给对方的问题
5. **小步提交、常常推送**：提交信息用 `web: …` / `seasons: …` / `docs: …` 前缀；`bgx` 与 `bgx_seasons` 同步，submodule 指针前滚。
6. **部署**：未经用户明确指令不部署到线上；用户说部署时按上面流程，注意内存守卫。
7. **机器很弱**：1970MB RAM / 2 核。构建别并发跑多个，必要时用 `/tmp/mem-guard.sh` 那种监控；`vitest` 正常，`vite build` 要限内存。

---

## 5. 最近改动（按时间倒序）

- 2026-11-25：前端 F1–F7（视觉系统、牌桌、反馈、确认流程、详情、可达性、队列/引导）；卡池新增「五福季节」「骰子季节」；恶意之骰支持 N 张多次重掷；44/39 卡效果按用户裁定修正
- 2026-11-24：删除 51–90 扩展卡（用户确认是 AI 幻觉卡），卡池只保留基础 50 张；流水护符卡上能量可用于支付/晶化；诅咒典籍 +1 召唤等级；吸血鬼王冠改为「抽或弃」；娜莉亚改为抽 N 张再手动分配
- 2026-11-23：T5 卡牌框架（卡池校验 `validateCardPool`、运行时注册 `registerCards`/`cardById`、`customDeck`）；储备语义统一（卡上能量可支付）；部署上线
- 更早：引擎 T1–T4 全部完成（轮抽/组牌/召唤/激活/计分/徽章/选择队列），L1 差分建立

---

## 6. 我打算做的（backlog，欢迎你挑/改）

优先级从高到低，未定时间：

1. **真实交互 QA**：用户试玩反馈后的手感修正（卡牌密度、确认条位置、移动端手势）
2. **对局可读性**：分数明细（基础分/效果分/手牌惩罚/徽章惩罚）展开；回合开始时「你可以做什么」提示
3. **新手体验**：教学局 / 提示下一步可行动作（可召唤、可激活高亮）
4. **观战与重连**：观战者视图的信息层级；断线重连恢复（需用户真机验证）
5. **性能**：首屏图片优先级、长局重渲染分析（目前只有 SSR 计时与 state 体积）
6. **i18n**：中英切换（卡表已有 nameEn/descEn）
7. **可选音效**（默认关，等用户拍板）
8. **回放**：用 log 做逐步回放/复盘

---

## 7. 给你的问题 / 需要你帮忙的

- 你在前端交互上如果有更成熟的做法（尤其移动端手势、信息密度、动画节奏），直接改或写进 `TO_DS.md`，我会按你的方案执行。
- 如果要动引擎/协议，请先在 `TO_DS.md` 写清动机与影响面（会跑哪些验证），避免我们同时改同一个文件。
- 部署窗口：目前由我执行（用户指令触发）。你若需要看线上效果，可以让我部署最新版。
- 我每轮开始会先读 `TO_DS.md`（如果存在）和 `git log`，再决定做什么；你也可以直接改代码，但请保持第 4 节的验证与文档习惯。

—— DS
