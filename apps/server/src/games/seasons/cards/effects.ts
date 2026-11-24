import type {
  CardRef,
  Element,
  SeasonsCardDef,
  SeasonsCardEffect,
} from '@bgx/protocol/games/seasons';
import type { CardInstance, SeasonsState } from '../engine.js';
import { addEnergyCapped, energySum } from '../rules/play.js';
import { drawToHand, patchPlayer, pushLog, seatName } from '../rules/state.js';
import { cardById } from './registry.js';

/**
 * 召唤时效果注册表。
 *
 * 只收「不需要玩家选择」的效果；需要 choice 的效果（抽 N 留 1、选能量、
 * 牺牲/回手等）留给 T2.2b-2 与 T3.4 的弹窗流程，未实现前 summon 会先拒绝，
 * 避免扣完费用才发现效果无法执行。
 */
export type SummonEffectHandler = (
  state: SeasonsState,
  seat: number,
  card: CardInstance,
  effect: SeasonsCardEffect,
) => SeasonsState;

function nameOf(card: CardInstance): string {
  return cardById(card.i)?.nameZh ?? `#${card.i}`;
}

function logEffect(
  state: SeasonsState,
  seat: number,
  card: CardInstance,
  detail: string,
): SeasonsState {
  return {
    ...state,
    log: pushLog(state.log, 'effect', `${seatName(seat)}「${nameOf(card)}」：${detail}`),
  };
}

/** 卡牌声明里与 on_summon 相关的效果（triggers 含 on_summon 或以 on_summon 为主触发）。 */
export function summonEffectOf(def: SeasonsCardDef): SeasonsCardEffect | null {
  const effect = def.effect;
  if (!effect) return null;
  const triggers = effect.triggers ?? [];
  if (effect.trigger !== 'on_summon' && !triggers.includes('on_summon')) return null;
  return effect;
}

export function summonEffectKey(effect: SeasonsCardEffect): string {
  return effect.typeKey ?? effect.type;
}

export const SUMMON_EFFECTS: Readonly<Record<string, SummonEffectHandler>> = {
  // 神圣圣杯（召唤位不足）：抽 4 张全部弃掉。
  divine_chalice: (state, seat, card) => {
    const me = state.players[seat];
    if (!me || me.gauge > me.played.length + 1) return state;
    const drawn = state.deck.slice(-4).reverse();
    if (drawn.length === 0) return state;
    return logEffect(
      {
        ...state,
        deck: state.deck.slice(0, -drawn.length),
        discard: [...state.discard, ...drawn],
      },
      seat,
      card,
      `召唤位不足，抽 ${drawn.length} 张并全部弃掉`,
    );
  },

  // 空气护符：召唤计量条前进 N 格
  summon_gauge: (state, seat, _card, effect) => {
    const amount = effect.amount ?? 0;
    if (amount <= 0) return state;
    return patchPlayer(state, seat, (player) => ({ gauge: player.gauge + amount }));
  },

  // 大地护符 / 水晶类：水晶 +N
  gain_crystals: (state, seat, _card, effect) => {
    const amount = effect.amount ?? 0;
    if (amount <= 0) return state;
    return patchPlayer(state, seat, (player) => ({ crystals: player.crystals + amount }));
  },

  // 伟大权杖：每有 1 张其他魔法物品在场，水晶 +N
  per_magic_item_crystal: (state, seat, card, effect) => {
    const amount = effect.amount ?? 0;
    const count = (state.players[seat]?.played ?? []).filter(
      (item) =>
        item.u !== card.u && cardById(item.i)?.type === 'magic_item',
    ).length;
    if (amount <= 0 || count === 0) return state;
    const gained = amount * count;
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + gained,
    }));
    return logEffect(next, seat, card, `水晶 +${gained}（${count} 张魔法物品）`);
  },

  // 阿尔戈斯恶魔：每位对手召唤等级 -1 并抽 1 张
  demon_of_argos: (state, seat, card) => {
    let next = state;
    for (const opponent of state.players) {
      if (opponent.seat === seat) continue;
      next = patchPlayer(next, opponent.seat, (player) => ({
        gauge: Math.max(0, player.gauge - 1),
      }));
      next = drawToHand(next, opponent.seat, 1);
    }
    return logEffect(next, seat, card, '所有对手召唤等级 -1 并抽 1 张');
  },

  // 空气元素：所有对手的储备能量转为空气能量（受上限截断）
  air_elemental: (state, seat, card) => {
    let next = state;
    for (const opponent of state.players) {
      if (opponent.seat === seat) continue;
      const storedOnCards = opponent.played.reduce(
        (total, item) =>
          total + (item.stored ? energySum(item.stored as Record<Element, number>) : 0),
        0,
      );
      const total = energySum(opponent.energies) + storedOnCards;
      next = patchPlayer(next, opponent.seat, (player) => ({
        energies: addEnergyCapped(
          { water: 0, air: 0, fire: 0, earth: 0 },
          { air: total },
          player.maxEnergy,
        ),
        played: player.played.map((item) =>
          item.stored ? { ...item, stored: undefined } : item,
        ),
      }));
    }
    return logEffect(next, seat, card, '所有对手的储备能量转为空气能量');
  },

  // 夜行者希德：若你水晶最多，从每位对手偷 5 水晶
  sid_nightshare: (state, seat, card) => {
    const me = state.players[seat];
    if (!me) return state;
    const opponents = state.players.filter((player) => player.seat !== seat);
    const isLeader = opponents.every((player) => me.crystals > player.crystals);
    if (!isLeader) return logEffect(state, seat, card, '不是水晶最多，未触发');

    let next = state;
    for (const opponent of opponents) {
      const stolen = Math.min(5, opponent.crystals);
      if (stolen <= 0) continue;
      next = patchPlayer(next, opponent.seat, (player) => ({
        crystals: player.crystals - stolen,
      }));
      next = patchPlayer(next, seat, (player) => ({
        crystals: player.crystals + stolen,
      }));
    }
    return logEffect(next, seat, card, '从每位对手偷取 5 水晶');
  },

  // 奥尼斯的诅咒圣物：水晶 +10，水能量 +1（受上限截断）
  cursed_relic: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + 10,
      energies: addEnergyCapped(player.energies, { water: 1 }, player.maxEnergy),
    }));
    return logEffect(next, seat, card, '水晶 +10，水能量 +1');
  },

  // 阿鲁斯的诅咒典籍：召唤时水晶 +10、召唤等级 +1（能量部分由选择弹窗结算）。
  cursed_treatise: (state, seat, card) => {
    const next = patchPlayer(state, seat, (player) => ({
      crystals: player.crystals + 10,
      gauge: player.gauge + 1,
    }));
    return logEffect(next, seat, card, '水晶 +10，召唤等级 +1');
  },

  // 元素护符：按实际支付的元素结算；水（选能量）需要选择，见 summonNeedsChoice。
  // 风 = 召唤等级 +1（前进一格），与旧项目卡片数据的「弃 1 张手牌」不同——旧数据有误，以用户裁定为准。
  elemental_amulet: (state, seat, card) => {
    const paid = card.paid ?? [];
    let next = state;
    const details: string[] = [];
    if (paid.includes('air')) {
      next = patchPlayer(next, seat, (player) => ({ gauge: player.gauge + 1 }));
      details.push('风：召唤等级 +1');
    }
    if (paid.includes('earth')) {
      next = patchPlayer(next, seat, (player) => ({ crystals: player.crystals + 5 }));
      details.push('土：水晶 +5');
    }
    if (paid.includes('fire')) {
      next = drawToHand(next, seat, 1);
      details.push('火：抽 1 张');
    }
    return details.length > 0
      ? logEffect(next, seat, card, details.join('，'))
      : next;
  },
  // 扩展包「召唤条件」：满足条件时给自己水晶 / 扣对手水晶（魔法骑士/魔法巨龙/命运冠军）。
  summon_condition: (state, seat, card, effect) => {
    const me = state.players[seat];
    if (!me) return state;
    const countType = (type: string) =>
      me.played.reduce((total, item) => {
        const def = cardById(item.i);
        return total + (def?.type === type ? 1 : 0);
      }, 0);
    if (typeof effect.requireMagic === 'number' && countType('magic_item') < effect.requireMagic) {
      return logEffect(state, seat, card, '召唤条件未满足（魔法物品不足）');
    }
    if (effect.requireLeader) {
      const leader = me.played.length >= 0
        && state.players.every((player) => player.seat === seat || player.crystals < me.crystals);
      if (!leader) return logEffect(state, seat, card, '召唤条件未满足（水晶未领先）');
    }
    const players = state.players.map((player) => {
      if (player.seat === seat) {
        return {
          ...player,
          crystals: player.crystals + (effect.selfCrystals ?? 0),
        };
      }
      const lose = Math.min(effect.opponentCrystals ?? 0, player.crystals);
      return lose > 0 ? { ...player, crystals: player.crystals - lose } : player;
    });
    const gain = effect.selfCrystals ?? 0;
    const drain = effect.opponentCrystals ?? 0;
    const detail = [gain > 0 ? `水晶 +${gain}` : '', drain > 0 ? `对手水晶 -${drain}` : '']
      .filter(Boolean)
      .join('，');
    return logEffect({ ...state, players }, seat, card, detail);
  },

};

/**
 * 召唤该卡是否需要尚未实现的玩家选择。
 * 元素护符按实际支付元素判断：土/火是自动效果，水/风需要弹窗。
 */
/** 召唤时需要先弹窗选择的事项。 */
export interface SummonChoiceRequest {
  kind:
    | 'element_alloc'
    | 'card_list'
    | 'card_pick'
    | 'multi_player_pick'
    | 'month_advance'
    | 'branch';
  key: string;
  /** element_alloc：reserve 进储备区；card 置于刚召唤的卡上。 */
  target?: 'reserve' | 'card';
  amount?: number;
  /** card_list：保留张数。 */
  keep?: number;
  title: string;
  label?: string;
  /** 每种元素最多分配几个；不传表示不限（只受总量约束）。 */
  maxPerElement?: Partial<Record<Element, number>>;
  /** 选择前先抽 N 张放进私密 pendingCards。 */
  draw?: number;
  /** element_alloc 结算后再丢弃 pendingCards（吸血鬼王冠）。 */
  then?: 'discard_pending';
  /** card_pick：免费召唤后把其余 pendingCards 弃掉（神圣圣杯）。 */
  discardRest?: boolean;
  /** card_list：未保留的牌分给对手；'choose' 表示由召唤者逐张指定（娜莉亚）。 */
  distribute?: boolean | 'choose';
  /** branch：牌堆顶的牌与它的声望（吸血鬼王冠）。 */
  card?: CardRef;
  points?: number;
  branches?: { id: string; label?: string; enabled?: boolean }[];
  /** element_alloc：允许只分配一部分（路易斯复制）。 */
  allowPartial?: boolean;
  /** multi_player_pick：依次由这些座位的玩家选择（西拉斯/阿姆苏格）。 */
  players?: number[];
  /** sacrifice：选 1 张在场卡进弃牌；return：选 1 张魔法物品回手。 */
  purpose?: 'sacrifice' | 'return' | 'discard';
}

/**
 * 召唤该卡需要的选择；`null` 表示无需选择（由 SUMMON_EFFECTS 自动结算），
 * `'unimplemented'` 表示需要选择但尚未接入，summon 会拒绝且不扣费。
 */
export function summonChoiceFor(
  def: SeasonsCardDef,
  paid: readonly Element[],
  state: SeasonsState,
  seat: number,
): SummonChoiceRequest | 'unimplemented' | null {
  const effect = summonEffectOf(def);
  if (!effect) return null;
  const key = summonEffectKey(effect);

  // 流水护符：从库存取 N 个任意能量置于本卡上。
  if (key === 'gain_energy') {
    const amount = typeof effect.amount === 'number' ? effect.amount : 4;
    return {
      kind: 'element_alloc',
      key: 'gain_energy',
      target: 'card',
      amount,
      title: `选择 ${amount} 个能量置于「${def.nameZh}」`,
      label: '放置',
    };
  }

  // 火焰护符：抽 N 张，保留 keep 张，其余弃掉。
  if (key === 'draw_cards') {
    const amount = typeof effect.amount === 'number' ? effect.amount : 1;
    const keep = typeof effect.keep === 'number' ? effect.keep : 1;
    return {
      kind: 'card_list',
      key: 'draw_cards',
      amount,
      keep,
      title: `抽 ${amount} 张，保留 ${keep} 张`,
      label: '保留',
    };
  }

  // 附魔魔典：获得 2 个任意能量（maxEnergy 已在召唤时 +3，先不支持溢出到卡上）。
  if (key === 'bespelled_grimoire') {
    return {
      kind: 'element_alloc',
      key: 'bespelled_grimoire',
      target: 'reserve',
      amount: 2,
      title: '选择获得 2 个能量',
      label: '获得',
    };
  }

  // 阿鲁斯的诅咒典籍：水晶 +10 直接结算，另得 2 个任意能量。
  if (key === 'cursed_treatise') {
    return {
      kind: 'element_alloc',
      key: 'cursed_treatise',
      target: 'reserve',
      amount: 2,
      title: '选择获得 2 个能量',
      label: '获得',
    };
  }

  // 拉格诺的吊坠：每有 1 张其他魔法物品，得 1 个任意能量。
  if (key === 'per_magic_item_energy') {
    const me = state.players[seat];
    if (!me) return null;
    const others = me.played.filter(
      (card) => cardById(card.i)?.type === 'magic_item',
    ).length;
    const per = typeof effect.amount === 'number' ? effect.amount : 1;
    const amount = others * per;
    if (amount <= 0) return null;
    return {
      kind: 'element_alloc',
      key: 'per_magic_item_energy',
      target: 'reserve',
      amount,
      title: `选择获得 ${amount} 个能量`,
      label: '获得',
    };
  }

  if (key === 'elemental_amulet') {
    if (paid.includes('water')) {
      return {
        kind: 'element_alloc',
        key: 'elemental_amulet_water',
        target: 'reserve',
        amount: 2,
        title: '元素护符（水）：获得 2 个能量',
        label: '获得',
      };
    }
    return null;
  }

  // 时光之靴：水晶 +2，然后在召唤时让季节轮前进/后退 1–3 格。
  if (key === 'temporal_boots') {
    return {
      kind: 'month_advance',
      key: 'temporal_boots',
      title: '选择季节轮移动方向和步数',
      label: '移动',
    };
  }

  // 灰脸路易斯：复制对手储备中的能量（数量可少于对手全部）。
  if (key === 'lewis') {
    const opponent = state.players.find((player) => player.seat !== seat);
    if (!opponent) return null;
    const counts: Partial<Record<Element, number>> = {};
    let total = 0;
    for (const element of ['water', 'air', 'fire', 'earth'] as const) {
      const onCards = opponent.played.reduce(
        (sum, card) =>
          sum +
          ((cardById(card.i)?.effect?.abilities ?? []).some(
            (ability) => ability.kind === 'reserve_slot',
          )
            ? (card.stored?.[element] ?? 0)
            : 0),
        0,
      );
      const count = (opponent.energies[element] ?? 0) + onCards;
      counts[element] = count;
      total += count;
    }
    if (total <= 0) return null;
    return {
      kind: 'element_alloc',
      key: 'lewis',
      target: 'reserve',
      amount: total,
      maxPerElement: counts,
      allowPartial: true,
      title: '选择要复制的能量（可少于对手全部）',
      label: '复制',
    };
  }

  // 忠实的西拉斯：每位有在场牌的对手各牺牲 1 张（对手自选）。
  if (key === 'syllas') {
    const targets = state.players
      .filter((player) => player.seat !== seat && player.played.length > 0)
      .map((player) => player.seat);
    if (targets.length === 0) return null;
    return {
      kind: 'multi_player_pick',
      key: 'syllas',
      players: targets,
      purpose: 'sacrifice',
      title: '每位对手牺牲 1 张在场牌',
      label: '牺牲',
    };
  }

  // 长颈阿姆苏格：每位有魔法物品的玩家收回 1 张。
  if (key === 'amsug') {
    const hasItem = (player: SeasonsState['players'][number]) =>
      player.played.some(
        (card) => cardById(card.i)?.type === 'magic_item',
      );
    const targets = state.players.filter(hasItem).map((player) => player.seat);
    if (targets.length === 0) return null;
    return {
      kind: 'multi_player_pick',
      key: 'amsug',
      players: targets,
      purpose: 'return',
      title: '每位玩家收回 1 张在场魔法物品',
      label: '收回',
    };
  }

  // 吸血鬼王冠：选择「抽入手牌」或「弃掉」，再按该牌声望得等量能量。
  if (key === 'vampiric_crown') {
    const top = state.deck[state.deck.length - 1];
    if (!top) return null;
    const points = cardById(top.i)?.points ?? 0;
    return {
      kind: 'branch',
      key: 'vampiric_crown',
      card: top,
      points,
      branches: [
        { id: 'draw', label: '抽入手牌' },
        { id: 'discard', label: '弃掉' },
      ],
      title: `吸血鬼王冠：抽 1 张牌入手，或弃掉它（声望 ${points}，获得等量能量）`,
    };
  }

  // 神圣圣杯：抽 4 张，免费召唤其中 1 张，其余弃掉；召唤位不足时直接抽 4 弃 4。
  if (key === 'divine_chalice') {
    // 此时圣杯尚未计入 played，免费召唤要再占 1 个槽位。
    const me = state.players[seat];
    if (!me || me.gauge <= me.played.length + 1) return null;
    return {
      kind: 'card_pick',
      key: 'divine_chalice',
      amount: 1,
      draw: 4,
      discardRest: true,
      title: '抽 4 张，选择 1 张免费召唤',
      label: '召唤',
    };
  }

  // 女先知娜莉亚：抽等于玩家人数张，自留 1 张，其余由召唤者逐张指定给各对手。
  if (key === 'naria') {
    const count = state.players.length;
    return {
      kind: 'card_list',
      key: 'naria',
      amount: count,
      keep: 1,
      draw: count,
      distribute: 'choose',
      title: `抽 ${count} 张，保留 1 张，其余分给对手`,
      label: '保留',
    };
  }

  return key in SUMMON_EFFECTS ? null : 'unimplemented';
}

/** 执行召唤时效果；未注册时原样返回（调用方应先检查 isSummonEffectImplemented）。 */
export function runSummonEffect(
  state: SeasonsState,
  seat: number,
  card: CardInstance,
): SeasonsState {
  const def = cardById(card.i);
  if (!def) return state;
  const effect = summonEffectOf(def);
  if (!effect) return state;
  const handler = SUMMON_EFFECTS[summonEffectKey(effect)];
  return handler ? handler(state, seat, card, effect) : state;
}
