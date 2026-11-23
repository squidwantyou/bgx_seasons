# 文件清单（MANIFEST）

本仓库按 BGX 仓库路径镜像；把 `packages/`、`apps/` 下的文件按同路径拷回 BGX 即可接入。

## 源码与文档

| 路径 | 字节 |
|---|---:|
| `apps/server/scripts/oracle-seasons-l1.mjs` | 34213 |
| `apps/server/scripts/oracle-seasons.mjs` | 4531 |
| `apps/server/scripts/seasons-size.mjs` | 5203 |
| `apps/server/scripts/seasons-soak.mjs` | 10736 |
| `apps/server/scripts/seasons-ui-flow.mjs` | 5373 |
| `apps/server/scripts/seasons-view-perf.mjs` | 6123 |
| `apps/server/src/games/seasons/cards/base.ts` | 656 |
| `apps/server/src/games/seasons/cards/effects.ts` | 18680 |
| `apps/server/src/games/seasons/cards/registry.ts` | 901 |
| `apps/server/src/games/seasons/cards/support.ts` | 4074 |
| `apps/server/src/games/seasons/engine.test.ts` | 132253 |
| `apps/server/src/games/seasons/engine.ts` | 133263 |
| `apps/server/src/games/seasons/index.ts` | 708 |
| `apps/server/src/games/seasons/rules/choice.ts` | 1775 |
| `apps/server/src/games/seasons/rules/const.ts` | 1697 |
| `apps/server/src/games/seasons/rules/dice.ts` | 9961 |
| `apps/server/src/games/seasons/rules/play.ts` | 2505 |
| `apps/server/src/games/seasons/rules/random.ts` | 1871 |
| `apps/server/src/games/seasons/rules/state.ts` | 2020 |
| `apps/web/scripts/build-seasons-assets.py` | 2826 |
| `apps/web/scripts/seasons-render-smoke.mjs` | 13618 |
| `apps/web/src/games/seasons/ChoiceModal.tsx` | 13660 |
| `apps/web/src/games/seasons/Panel.tsx` | 23233 |
| `apps/web/src/games/seasons/art.ts` | 2064 |
| `apps/web/src/games/seasons/index.tsx` | 2206 |
| `apps/web/src/games/seasons/styles.css` | 8153 |
| `docs/developing-games.md` | 23735 |
| `docs/seasons-migration.md` | 77066 |
| `docs/seasons_bga_rules_spec.md` | 62310 |
| `packages/protocol/src/games/seasons-cards-all.ts` | 1610 |
| `packages/protocol/src/games/seasons-cards-ext.ts` | 19524 |
| `packages/protocol/src/games/seasons-cards.ts` | 26768 |
| `packages/protocol/src/games/seasons.ts` | 14171 |

## 素材（webp）

| 目录 | 文件数 | 说明 |
|---|---:|---|
| `apps/web/src/assets/seasons/cards` | 51 | 卡图 1–90（扩展卡缺图，前端按名称兜底） |
| `apps/web/src/assets/seasons/dice` | 120 | 4 季 × 5 颗 × 6 面 |
| `apps/web/src/assets/seasons/elements` | 4 | 水/风/火/土 元素图标 |

## 与 BGX 的对应关系

- 协议与卡表 → `packages/protocol/src/games/`（需改 `packages/protocol/src/index.ts` 的导出，若 BGX 版本不同）
- 引擎 → `apps/server/src/games/seasons/`（由 loader 自动发现 `index.ts`）
- 前端插件 → `apps/web/src/games/seasons/`；素材 → `apps/web/src/assets/seasons/`
- 验证脚本 → `apps/server/scripts/`、`apps/web/scripts/`（`apps/web/package.json` 需有 `smoke` 脚本）

## 本文档未列出的大文件

- `README.md`、`MANIFEST.md` 自身。
