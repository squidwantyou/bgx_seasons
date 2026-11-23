import {
  ELEMENTS,
  type Element,
  type SeasonsCardAbility,
  type SeasonsCardCost,
  type SeasonsCardDef,
} from '@bgx/protocol/games/seasons';

/** 召唤费用/能量/效果声明的纯函数工具；不依赖引擎状态，方便单测。 */

export const ELEMENT_NAME_ZH: Record<Element, string> = {
  water: '水',
  air: '风',
  fire: '火',
  earth: '土',
};

/** 合并基础费用与按人数浮动段（旧引擎 resolveCost）。 */
export function resolveCost(def: SeasonsCardDef, playerCount: number): SeasonsCardCost {
  const base = def.cost;
  const scaled = def.costByPlayers?.[String(playerCount) as '2' | '3' | '4'];
  if (!scaled) return { ...base };
  return {
    water: scaled.water ?? base.water,
    air: scaled.air ?? base.air,
    fire: scaled.fire ?? base.fire,
    earth: scaled.earth ?? base.earth,
    crystal: scaled.crystal ?? base.crystal,
  };
}

export function energySum(energies: Record<Element, number>): number {
  return ELEMENTS.reduce((total, element) => total + (energies[element] ?? 0), 0);
}

/** 能量与水晶是否足够（与旧引擎 affordable 一致，不自动用水晶抵能量）。 */
export function affordable(
  energies: Record<Element, number>,
  cost: SeasonsCardCost,
  crystals: number,
): boolean {
  for (const element of ELEMENTS) {
    if ((energies[element] ?? 0) < cost[element]) return false;
  }
  return crystals >= cost.crystal;
}

/**
 * 骰面能量奖励入储备：总量受 maxEnergy 封顶，按元素顺序尽量装入。
 * 旧引擎在装不下时会弹 energy_swap 让玩家取舍；迷你版先截断（见 T2.2b/T3 待办）。
 */
export function addEnergyCapped(
  energies: Record<Element, number>,
  incoming: Partial<Record<Element, number>>,
  maxEnergy: number,
): Record<Element, number> {
  const next: Record<Element, number> = { ...energies };
  for (const element of ELEMENTS) {
    const amount = incoming[element] ?? 0;
    if (amount <= 0) continue;
    const room = Math.max(0, maxEnergy - energySum(next));
    if (room <= 0) break;
    next[element] += Math.min(amount, room);
  }
  return next;
}

export function abilitiesOf(def: SeasonsCardDef, kind: string): SeasonsCardAbility[] {
  return (def.effect?.abilities ?? []).filter((ability) => ability.kind === kind);
}

export function abilityAmount(def: SeasonsCardDef, kind: string): number {
  return abilitiesOf(def, kind).reduce(
    (total, ability) => total + (typeof ability.amount === 'number' ? ability.amount : 0),
    0,
  );
}
