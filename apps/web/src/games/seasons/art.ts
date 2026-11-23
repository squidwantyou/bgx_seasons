import type { Element } from '@bgx/protocol/games/seasons';

/**
 * 四季物语的静态美术资源。
 *
 * 图片由 `apps/web/scripts/build-seasons-assets.py` 从旧项目
 * （`/home/squid/seasons_web/seasons-web/public/assets`）转成 webp，
 * 放到 `src/assets/seasons/`。这里用 `import.meta.glob` 收集 URL，
 * 构建时由 Vite 输出带 hash 的静态文件。
 */

const cardModules = import.meta.glob<string>('../../assets/seasons/cards/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const diceModules = import.meta.glob<string>('../../assets/seasons/dice/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const elementModules = import.meta.glob<string>('../../assets/seasons/elements/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** 从 glob 的键里取文件名（不含扩展名）。 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.webp$/, '');
}

function byName(modules: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(modules).map(([path, url]) => [baseName(path), url]));
}

const cards = byName(cardModules);
const dice = byName(diceModules);
const elements = byName(elementModules);

/** 卡牌正面图；未知 id（例如扩展包还没接入）返回 undefined。 */
export function cardArt(cardId: number): string | undefined {
  return cards.get(String(cardId));
}

/** 牌背。 */
export function cardBackArt(): string | undefined {
  return cards.get('back');
}

/** 骰面图：letter 为 w/s/u/f，die 为 1–5，face 为 1–6。 */
export function dieArt(letter: string, die: number, face: number): string | undefined {
  return dice.get(`${letter}${die}r${face}`);
}

/** 元素图标。 */
export function elementArt(element: Element): string | undefined {
  return elements.get(element);
}

/** 已打包的资源数量，测试/调试用。 */
export const SEASONS_ART_COUNTS = {
  cards: cards.size,
  dice: dice.size,
  elements: elements.size,
} as const;
