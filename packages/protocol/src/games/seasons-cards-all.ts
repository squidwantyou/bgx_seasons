/**
 * 四季物语全部卡表（基础 + 扩展）的合并入口。
 *
 * 服务端引擎用 `CARD_BY_ID` 查任意一张牌的定义；`cardsForExtensions()`
 * 按扩展包选项组牌。前端也可以从这里取扩展卡名/费用。
 */
import { BASE_CARDS, BASE_CARD_BY_ID } from './seasons-cards.js';
import { EXT1_CARDS, EXT2_CARDS, EXT_CARDS, EXT_CARD_BY_ID, EXTENSIONS } from './seasons-cards-ext.js';
import type { SeasonsCardDef } from './seasons.js';

export { BASE_CARDS, BASE_CARD_BY_ID, EXT1_CARDS, EXT2_CARDS, EXT_CARDS, EXT_CARD_BY_ID, EXTENSIONS };

export type SeasonsExtensionId = 'base' | 'ext1' | 'ext2';

export const SEASONS_CARDS: readonly SeasonsCardDef[] = [...BASE_CARDS, ...EXT_CARDS];

export const SEASONS_CARD_BY_ID: ReadonlyMap<number, SeasonsCardDef> = new Map([
  ...BASE_CARD_BY_ID,
  ...EXT_CARD_BY_ID,
]);

/** 别名：引擎里统一叫 CARD_BY_ID。 */
export const CARD_BY_ID = SEASONS_CARD_BY_ID;

/**
 * 按扩展包选项取卡表。`base` 必须包含（卡表为空会抽不到牌）；
 * ext1/ext2 按传入顺序追加，重复的选择去重。
 */
export function cardsForExtensions(extensions: readonly SeasonsExtensionId[]): readonly SeasonsCardDef[] {
  if (!extensions.includes('base')) {
    throw new Error('基础卡包（base）是必选项');
  }
  const cards = [...BASE_CARDS];
  const seen = new Set<SeasonsExtensionId>(['base']);
  for (const id of extensions) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === 'ext1') cards.push(...EXT1_CARDS);
    else if (id === 'ext2') cards.push(...EXT2_CARDS);
  }
  return cards;
}
