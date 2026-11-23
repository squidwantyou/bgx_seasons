import type { Element, SeasonsCardCost } from '@bgx/protocol/games/seasons';

/** 回合结束时手上每张牌的扣分。 */
export const HAND_PENALTY = 5;

/** 基础能量上限（部分卡牌会提高）。 */
export const BASE_MAX_ENERGY = 7;

export const YEARS = 3;
export const SEASONS_PER_YEAR = 4;
export const MONTHS_PER_SEASON = 3;
export const MONTHS_PER_YEAR = SEASONS_PER_YEAR * MONTHS_PER_SEASON;
export const TOTAL_MONTHS = YEARS * MONTHS_PER_YEAR;

export const CARDS_PER_PLAYER = 9;
export const DRAFT_ROUNDS = CARDS_PER_PLAYER;

export const MAX_BADGES = 3;
/** 使用 0/1/2/3 个徽章的终局扣分。 */
export const BADGE_PENALTY = [0, 5, 12, 20] as const;

export interface SeasonDef {
  nameZh: string;
  nameEn: string;
  element: Element;
  /** 骰子/图标上的季节字母 */
  letter: string;
}

/** 季节顺序：冬 → 春 → 夏 → 秋。 */
export const SEASONS: readonly SeasonDef[] = [
  { nameZh: '冬季', nameEn: 'Winter', element: 'water', letter: 'w' },
  { nameZh: '春季', nameEn: 'Spring', element: 'earth', letter: 's' },
  { nameZh: '夏季', nameEn: 'Summer', element: 'fire', letter: 'u' },
  { nameZh: '秋季', nameEn: 'Fall', element: 'air', letter: 'f' },
];

/**
 * 转换 1 个能量可得的水晶数，按季节索引（冬/春/夏/秋）。
 * 与旧引擎的 TRANSMUTE_VALUE 完全一致。
 */
export const TRANSMUTE_VALUE: Record<
  Element,
  readonly [number, number, number, number]
> = {
  water: [1, 1, 2, 3],
  air: [1, 2, 3, 1],
  fire: [2, 3, 1, 1],
  earth: [3, 1, 1, 2],
};

export const ZERO_COST: SeasonsCardCost = {
  water: 0,
  air: 0,
  fire: 0,
  earth: 0,
  crystal: 0,
};

export const COPIES_PER_CARD = 2;
