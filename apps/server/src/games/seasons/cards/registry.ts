import type { SeasonsCardDef } from '@bgx/protocol/games/seasons';
import { CARD_BY_ID } from './base.js';

/**
 * 卡牌注册表：内置 90 张之外，允许在运行时登记额外卡牌。
 *
 * 这是「卡池可插拔」的最小接缝：数据住在协议包，引擎只通过 cardById()
 * 查表；新增/移除卡牌不需要改引擎逻辑，只要数据合法、效果 key 已登记。
 */
const REGISTERED = new Map<number, SeasonsCardDef>();

export function registerCards(cards: readonly SeasonsCardDef[]): void {
  for (const def of cards) REGISTERED.set(def.id, def);
}

export function unregisterCards(ids: readonly number[]): void {
  for (const id of ids) REGISTERED.delete(id);
}

export function cardById(id: number): SeasonsCardDef | undefined {
  return REGISTERED.get(id) ?? CARD_BY_ID.get(id);
}

export function registeredCardCount(): number {
  return REGISTERED.size;
}
