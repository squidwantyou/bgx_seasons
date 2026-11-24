/**
 * 四季物语卡表入口。
 *
 * 目前只有 50 张基础牌；`CARD_BY_ID` 是引擎查定义、前端查名称/费用的
 * 唯一入口。以后要加牌时，把数据写进 seasons-cards.ts（或单独的卡包文件），
 * 再在这里合并即可——引擎不直接依赖具体卡表。
 */
import { BASE_CARDS, BASE_CARD_BY_ID } from './seasons-cards.js';
import type { SeasonsCardDef } from './seasons.js';

export { BASE_CARDS, BASE_CARD_BY_ID };

/** 全部卡牌（目前 = 基础 50 张）。 */
export const SEASONS_CARDS: readonly SeasonsCardDef[] = BASE_CARDS;

export const SEASONS_CARD_BY_ID: ReadonlyMap<number, SeasonsCardDef> = BASE_CARD_BY_ID;

/** 别名：引擎里统一叫 CARD_BY_ID。 */
export const CARD_BY_ID = SEASONS_CARD_BY_ID;
