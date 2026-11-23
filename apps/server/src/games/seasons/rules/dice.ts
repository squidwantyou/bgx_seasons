import type { Element, SeasonsDieRewards } from '@bgx/protocol/games/seasons';

/**
 * 四季骰子定义（从旧项目 dice.json 生成，勿手改）。
 * 每季 5 颗骰子，每颗 6 面；开局从当季 5 颗中洗出「人数 + 1」颗。
 */
export interface DieFace {
  roll: number;
  pip: number;
  rewards: SeasonsDieRewards;
}

export interface DieDef {
  id: number;
  faces: readonly DieFace[];
}

export const DICE_BY_ELEMENT: Record<Element, readonly DieDef[]> = {
  water: [
    {
      id: 1,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "water": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "water": 1, "air": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 6} },
        { roll: 4, pip: 2, rewards: {"crystals": 2, "water": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "fire": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "transmute": true, "air": 1} },
      ],
    },
    {
      id: 2,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "fire": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "transmute": true, "air": 1} },
        { roll: 3, pip: 2, rewards: {"transmute": true, "air": 2} },
        { roll: 4, pip: 2, rewards: {"crystals": 1, "water": 2} },
        { roll: 5, pip: 3, rewards: {"crystals": 6} },
        { roll: 6, pip: 3, rewards: {"summon": true, "water": 2} },
      ],
    },
    {
      id: 3,
      faces: [
        { roll: 1, pip: 1, rewards: {"card": true} },
        { roll: 2, pip: 1, rewards: {"summon": true, "water": 2} },
        { roll: 3, pip: 2, rewards: {"summon": true, "fire": 1} },
        { roll: 4, pip: 2, rewards: {"summon": true, "transmute": true, "air": 1} },
        { roll: 5, pip: 3, rewards: {"transmute": true, "water": 1, "air": 1} },
        { roll: 6, pip: 3, rewards: {"crystals": 3, "water": 2} },
      ],
    },
    {
      id: 4,
      faces: [
        { roll: 1, pip: 1, rewards: {"crystals": 3, "water": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "water": 1, "air": 1} },
        { roll: 3, pip: 2, rewards: {"card": true} },
        { roll: 4, pip: 2, rewards: {"summon": true, "water": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "air": 2} },
        { roll: 6, pip: 3, rewards: {"summon": true, "transmute": true, "fire": 1} },
      ],
    },
    {
      id: 5,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "fire": 2} },
        { roll: 2, pip: 1, rewards: {"summon": true, "transmute": true, "air": 1} },
        { roll: 3, pip: 2, rewards: {"transmute": true, "water": 1, "air": 1} },
        { roll: 4, pip: 2, rewards: {"crystals": 1, "water": 2} },
        { roll: 5, pip: 3, rewards: {"card": true} },
        { roll: 6, pip: 3, rewards: {"summon": true, "water": 2} },
      ],
    },
  ],
  earth: [
    {
      id: 1,
      faces: [
        { roll: 1, pip: 1, rewards: {"transmute": true, "water": 1, "earth": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "earth": 2} },
        { roll: 3, pip: 2, rewards: {"crystals": 6} },
        { roll: 4, pip: 2, rewards: {"crystals": 2, "earth": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "transmute": true, "water": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "air": 1} },
      ],
    },
    {
      id: 2,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "air": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "transmute": true, "water": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 1, "earth": 2} },
        { roll: 4, pip: 2, rewards: {"transmute": true, "water": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "earth": 2} },
        { roll: 6, pip: 3, rewards: {"crystals": 6} },
      ],
    },
    {
      id: 3,
      faces: [
        { roll: 1, pip: 1, rewards: {"card": true} },
        { roll: 2, pip: 1, rewards: {"summon": true, "earth": 2} },
        { roll: 3, pip: 2, rewards: {"summon": true, "transmute": true, "water": 1} },
        { roll: 4, pip: 2, rewards: {"summon": true, "air": 1} },
        { roll: 5, pip: 3, rewards: {"crystals": 3, "earth": 2} },
        { roll: 6, pip: 3, rewards: {"transmute": true, "water": 1, "earth": 1} },
      ],
    },
    {
      id: 4,
      faces: [
        { roll: 1, pip: 1, rewards: {"crystals": 3, "earth": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "water": 1, "earth": 1} },
        { roll: 3, pip: 2, rewards: {"card": true} },
        { roll: 4, pip: 2, rewards: {"summon": true, "earth": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "transmute": true, "air": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "water": 2} },
      ],
    },
    {
      id: 5,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "air": 2} },
        { roll: 2, pip: 1, rewards: {"summon": true, "transmute": true, "water": 1} },
        { roll: 3, pip: 2, rewards: {"transmute": true, "water": 1, "earth": 1} },
        { roll: 4, pip: 2, rewards: {"crystals": 1, "earth": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "earth": 2} },
        { roll: 6, pip: 3, rewards: {"card": true} },
      ],
    },
  ],
  fire: [
    {
      id: 1,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "fire": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "fire": 1, "earth": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 6} },
        { roll: 4, pip: 2, rewards: {"crystals": 2, "fire": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "water": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "transmute": true, "earth": 1} },
      ],
    },
    {
      id: 2,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "water": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "transmute": true, "earth": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 1, "fire": 2} },
        { roll: 4, pip: 2, rewards: {"transmute": true, "earth": 2} },
        { roll: 5, pip: 3, rewards: {"crystals": 6} },
        { roll: 6, pip: 3, rewards: {"summon": true, "fire": 2} },
      ],
    },
    {
      id: 3,
      faces: [
        { roll: 1, pip: 1, rewards: {"crystals": 3, "fire": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "fire": 1, "earth": 1} },
        { roll: 3, pip: 2, rewards: {"card": true} },
        { roll: 4, pip: 2, rewards: {"summon": true, "fire": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "earth": 2} },
        { roll: 6, pip: 3, rewards: {"summon": true, "transmute": true, "water": 1} },
      ],
    },
    {
      id: 4,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "fire": 2} },
        { roll: 2, pip: 1, rewards: {"card": true} },
        { roll: 3, pip: 2, rewards: {"summon": true, "transmute": true, "earth": 1} },
        { roll: 4, pip: 2, rewards: {"summon": true, "water": 1} },
        { roll: 5, pip: 3, rewards: {"crystals": 3, "fire": 2} },
        { roll: 6, pip: 3, rewards: {"transmute": true, "fire": 1, "earth": 1} },
      ],
    },
    {
      id: 5,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "transmute": true, "earth": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "water": 2} },
        { roll: 3, pip: 2, rewards: {"crystals": 1, "fire": 2} },
        { roll: 4, pip: 2, rewards: {"transmute": true, "fire": 1, "earth": 1} },
        { roll: 5, pip: 3, rewards: {"summon": true, "fire": 2} },
        { roll: 6, pip: 3, rewards: {"card": true} },
      ],
    },
  ],
  air: [
    {
      id: 1,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "air": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "air": 1, "fire": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 6} },
        { roll: 4, pip: 2, rewards: {"crystals": 2, "air": 2} },
        { roll: 5, pip: 3, rewards: {"summon": true, "transmute": true, "fire": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "earth": 1} },
      ],
    },
    {
      id: 2,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "transmute": true, "fire": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "earth": 1} },
        { roll: 3, pip: 2, rewards: {"crystals": 1, "air": 2} },
        { roll: 4, pip: 2, rewards: {"transmute": true, "fire": 2} },
        { roll: 5, pip: 3, rewards: {"crystals": 6} },
        { roll: 6, pip: 3, rewards: {"summon": true, "air": 2} },
      ],
    },
    {
      id: 3,
      faces: [
        { roll: 1, pip: 1, rewards: {"crystals": 3, "air": 2} },
        { roll: 2, pip: 1, rewards: {"transmute": true, "air": 1, "fire": 1} },
        { roll: 3, pip: 2, rewards: {"summon": true, "air": 2} },
        { roll: 4, pip: 2, rewards: {"card": true} },
        { roll: 5, pip: 3, rewards: {"summon": true, "transmute": true, "earth": 1} },
        { roll: 6, pip: 3, rewards: {"summon": true, "fire": 2} },
      ],
    },
    {
      id: 4,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "air": 2} },
        { roll: 2, pip: 1, rewards: {"card": true} },
        { roll: 3, pip: 2, rewards: {"summon": true, "transmute": true, "fire": 1} },
        { roll: 4, pip: 2, rewards: {"summon": true, "earth": 1} },
        { roll: 5, pip: 3, rewards: {"crystals": 3, "air": 2} },
        { roll: 6, pip: 3, rewards: {"transmute": true, "fire": 1, "air": 1} },
      ],
    },
    {
      id: 5,
      faces: [
        { roll: 1, pip: 1, rewards: {"summon": true, "transmute": true, "fire": 1} },
        { roll: 2, pip: 1, rewards: {"summon": true, "earth": 2} },
        { roll: 3, pip: 2, rewards: {"crystals": 1, "air": 2} },
        { roll: 4, pip: 2, rewards: {"transmute": true, "air": 1, "fire": 1} },
        { roll: 5, pip: 3, rewards: {"summon": true, "air": 2} },
        { roll: 6, pip: 3, rewards: {"card": true} },
      ],
    },
  ],
};
