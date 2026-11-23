/**
 * 卡表已挪到 `@bgx/protocol`（前端也要用）。
 * 这里保留原路径，规则层与测试无需改动 import。
 *
 * - `BASE_CARDS` / `BASE_CARD_BY_ID`：基础 50 张。
 * - `CARD_BY_ID`：基础 + 扩展的合并表（引擎查定义统一走它）。
 * - `cardsForExtensions()`：按扩展包选项组牌。
 */
export {
  BASE_CARDS,
  BASE_CARD_BY_ID,
  EXT1_CARDS,
  EXT2_CARDS,
  EXT_CARDS,
  EXT_CARD_BY_ID,
  EXTENSIONS,
  SEASONS_CARDS,
  SEASONS_CARD_BY_ID,
  CARD_BY_ID,
  cardsForExtensions,
} from '@bgx/protocol/games/seasons-cards-all';
export type { SeasonsExtensionId } from '@bgx/protocol/games/seasons-cards-all';
