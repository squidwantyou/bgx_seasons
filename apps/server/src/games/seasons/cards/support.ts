import type { SeasonsCardDef } from '@bgx/protocol/games/seasons';

/**
 * 已实现的效果处理器登记表。
 *
 * 卡牌数据（协议包）与效果实现（服务端）分离后，这张表就是两者的契约：
 * 新增一张牌时，先在 cards/*.ts 里写数据，再在这里登记它的效果 key；
 * setup 会校验整副牌，任何未登记 key 都会在开局前报错，而不是进场后静默无效。
 */
export const IMPLEMENTED_EFFECT_KEYS = {
  on_summon: new Set([
    'summon_gauge',
    'draw_cards',
    'gain_crystals',
    'gain_energy',
    'temporal_boots',
    'divine_chalice',
    'syllas',
    'naria',
    'amsug',
    'lewis',
    'per_magic_item_crystal',
    'elemental_amulet',
    'vampiric_crown',
    'demon_of_argos',
    'air_elemental',
    'cursed_treatise',
    'per_magic_item_energy',
    'sid_nightshare',
    'summon_condition',
  ]),
  activation: new Set([
    'balance_of_ishtar',
    'kairn',
    'potion_power',
    'potion_dreams',
    'potion_knowledge',
    'potion_life',
    'tree_of_light',
    'crystal_orb',
    'glutton_cauldron',
    'dragon_skull',
    'per_familiar_crystal',
    'necrotic_kriss',
    'mirror_of_seasons',
    'cursed_relic',
    'pay_energy_reward',
  ]),
  permanent: new Set([
    'on_play_card_crystal',
    'purse_of_io',
    'figrim',
    'wondrous_chest',
    'beggars_horn',
    'bespelled_grimoire',
    'cost_reduction',
    'on_season_change_energy',
    'on_play_card_energy',
    'arcano_leech',
    'titus',
    'thieving_fairies',
    'turn_condition_reward',
    'opponent_action_reward',
    'season_opponent_tax',
    'turn_flat_reward',
    'season_draw',
    'fates_spire',
  ]),
  dice_change: new Set(['die_of_malice']),
  score: new Set(['ragfields_helm', 'points', 'score_per_energy', 'sealed_chest']),
} as const;

export type ImplementedTrigger = keyof typeof IMPLEMENTED_EFFECT_KEYS;

const TRIGGERS = new Set<string>(Object.keys(IMPLEMENTED_EFFECT_KEYS));

/** 与数据里的 effect.trigger 对应；子触发（triggers 数组）不影响登记表。 */
export function effectKeyOf(def: SeasonsCardDef): string {
  const effect = def.effect;
  if (!effect) return '';
  return effect.typeKey ?? effect.type;
}

export interface CardPoolIssue {
  cardId: number | null;
  message: string;
}

/** 校验任意卡池能否被当前引擎完整支持；返回全部问题以便一次性修完。 */
export function validateCardPool(cards: readonly SeasonsCardDef[]): CardPoolIssue[] {
  const issues: CardPoolIssue[] = [];
  const seen = new Set<number>();
  for (const def of cards) {
    if (seen.has(def.id)) {
      issues.push({ cardId: def.id, message: `卡牌 id ${def.id} 重复` });
    }
    seen.add(def.id);
    if (!def.nameZh) issues.push({ cardId: def.id, message: '缺少中文名' });
    // 诅咒类卡牌可以是负分（如诅咒典籍 -5、受诅咒灵魂 -3）。
    if (!Number.isInteger(def.points)) {
      issues.push({ cardId: def.id, message: '分数必须是整数' });
    }
    if (!Number.isInteger(def.cost.crystal) || def.cost.crystal < 0) {
      issues.push({ cardId: def.id, message: '水晶费用必须是非负整数' });
    }
    for (const element of ['water', 'air', 'fire', 'earth'] as const) {
      if (!Number.isInteger(def.cost[element]) || def.cost[element] < 0) {
        issues.push({ cardId: def.id, message: `${element} 费用必须是非负整数` });
      }
    }
    const effect = def.effect;
    if (!effect) continue;
    const trigger = effect.trigger;
    if (!TRIGGERS.has(trigger)) {
      issues.push({ cardId: def.id, message: `未登记的效果时机：${trigger}` });
      continue;
    }
    const key = effectKeyOf(def);
    if (!key) {
      issues.push({ cardId: def.id, message: '效果缺少 type/typeKey' });
      continue;
    }
    const set = IMPLEMENTED_EFFECT_KEYS[trigger as ImplementedTrigger];
    if (!(set as ReadonlySet<string>).has(key)) {
      issues.push({ cardId: def.id, message: `效果未实现：${trigger} → ${key}` });
    }
  }
  return issues;
}
