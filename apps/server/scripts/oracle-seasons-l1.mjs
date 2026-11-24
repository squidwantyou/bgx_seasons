#!/usr/bin/env node
/**
 * L1 状态级差分（T4.6c，不进 CI）：
 * 让旧引擎与新引擎从「同一副牌」出发，执行同一串动作，逐步比较状态。
 *
 * 旧引擎用 Math.random 洗牌/掷骰，这里不追求随机可复现：直接取旧引擎洗出的
 * 牌堆作为基准，把同一份牌（同 id、同 uid）灌进新引擎，于是轮抽/组牌这类
 * 无随机动作可以逐步比对；掷骰类动作用注入状态的方式测试。
 *
 * 用法：pnpm --filter @bgx/server build && node apps/server/scripts/oracle-seasons-l1.mjs
 */
import { pathToFileURL } from 'node:url';
import { seasons } from '../dist/games/seasons/engine.js';
import { BASE_MAX_ENERGY } from '../dist/games/seasons/rules/const.js';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';

const OLD = '/home/squid/seasons_web/seasons-web/src/games/seasons/index.js';
// 加 --ext 时启用 ext1 + ext2（40 张），默认只跑基础 50 张。
const EXT_MODE = process.argv.includes('--ext');
const old = await import(pathToFileURL(OLD).href);

const ELEMENTS = ['water', 'air', 'fire', 'earth'];
let checks = 0;
const failures = [];

function fail(message) {
  failures.push(message);
}

function normalizeCard(card) {
  return { i: card.id, u: card.uid };
}

function oldUidMap(state) {
  // 旧引擎的 uid 是字符串（c47），统一换成数字，方便两边比对。
  let next = 1;
  const map = new Map();
  const assign = (card) => {
    if (!map.has(card.uid)) map.set(card.uid, next++);
    return map.get(card.uid);
  };
  for (const player of state.players) {
    for (const zone of ['hand', 'draftHand', 'drafted', 'library2', 'library3', 'played']) {
      for (const card of player[zone] ?? []) card.uid = assign(card);
    }
  }
  for (const card of [...state.deck, ...state.discard]) card.uid = assign(card);
  return map;
}

function toRefs(cards) {
  return (cards ?? []).map((card) => ({ i: card.id, u: card.uid }));
}

function oldPhase(phase) {
  return phase === 'finished' ? 'ended' : phase;
}

function oldSeatOf(state, id) {
  const index = state.players.findIndex((player) => player.id === id);
  return index < 0 ? null : index;
}

function resultSnapshot(result, seatOf) {
  if (!result) return null;
  return {
    winner: result.winner === null || result.winner === undefined ? null : seatOf(result.winner),
    draw: Boolean(result.draw),
    scores: (result.players ?? []).map((entry) => ({
      seat: entry.seat,
      score: entry.score,
      crystals: entry.crystals,
      cardPoints: entry.cardPoints,
      effectPoints: entry.effectPoints ?? entry.effectScore ?? 0,
      handPenalty: entry.handPenalty,
      badgePenalty: entry.badgePenalty,
    })),
  };
}

// 旧引擎终局后 month 会因剩余骰子继续前进（可能 >36），新引擎夹在 36；
// 终局后月份已无意义，统一归一化。
function monthOf(state) {
  return oldPhase(state.phase) === 'ended' ? 'ended' : state.month;
}

function snapshotOld(state) {
  return {
    phase: oldPhase(state.phase),
    draftRound: state.draftRound,
    month: monthOf(state),
    year: state.year,
    startPlayer: state.startPlayer,
    currentPicker: state.currentPicker,
    turnOwner: state.turnOwner,
    deck: state.deck.map((card) => card.uid),
    discard: state.discard.map((card) => card.uid),
    result: resultSnapshot(state.result, (id) => oldSeatOf(state, id)),
    players: state.players.map((player) => ({
      hand: player.hand.map((card) => card.uid),
      draftHand: player.draftHand.map((card) => card.uid),
      drafted: player.drafted.map((card) => card.uid),
      library2: player.library2.map((card) => card.uid),
      library3: player.library3.map((card) => card.uid),
      played: player.played.map((card) => ({ id: card.id, u: card.uid })),
      energies: { ...player.energies },
      crystals: player.crystals,
      gauge: player.gauge,
      maxEnergy: player.maxEnergy,
      canTransmute: player.canTransmute,
      badgesUsed: player.badgesUsed,
      badgeDrawUpgrade: Boolean(player.badgeDrawUpgrade),
      badgeDraw: player.badgeDraw ? player.badgeDraw.map((card) => card.uid) : null,
      organizeDone: player.organizeDone,
    })),
  };
}

function snapshotNew(state) {
  return {
    phase: state.phase,
    draftRound: state.draftRound,
    month: monthOf(state),
    year: state.year,
    startPlayer: state.startPlayer,
    currentPicker: state.currentPicker,
    turnOwner: state.turnOwner,
    deck: state.deck.map((card) => card.u),
    discard: state.discard.map((card) => card.u),
    result: resultSnapshot(state.result, (id) => id),
    players: state.players.map((player) => ({
      hand: player.hand.map((card) => card.u),
      draftHand: player.draftHand.map((card) => card.u),
      drafted: player.drafted.map((card) => card.u),
      library2: player.library2.map((card) => card.u),
      library3: player.library3.map((card) => card.u),
      played: player.played.map((card) => ({ id: card.i, u: card.u })),
      energies: { ...player.energies },
      crystals: player.crystals,
      gauge: player.gauge,
      maxEnergy: player.maxEnergy,
      canTransmute: player.canTransmute,
      badgesUsed: player.badgesUsed,
      badgeDrawUpgrade: Boolean(player.badgeDrawUpgrade),
      badgeDraw: player.badgeDraw ? player.badgeDraw.map((card) => card.u) : null,
      organizeDone: player.organizeDone,
    })),
  };
}

function compare(label, oldState, newState) {
  checks++;
  const a = JSON.stringify(snapshotOld(oldState));
  const b = JSON.stringify(snapshotNew(newState));
  if (a !== b) {
    const left = JSON.parse(a);
    const right = JSON.parse(b);
    const diffs = [];
    for (const key of Object.keys(left)) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
        diffs.push(`${key}: 旧=${JSON.stringify(left[key])} 新=${JSON.stringify(right[key])}`);
      }
    }
    fail(`${label}\n  ${diffs.slice(0, 4).join('\n  ')}`);
  }
}

/** 旧引擎动作（就地修改 state），新引擎动作（返回新 state）。 */
function stepOld(state, seat, type, payload) {
  try {
    old.reduce(state, { playerId: state.players[seat].id, type, payload });
  } catch (error) {
    console.error('OLD 报错：', type, 'seat=', seat, 'draftRound=', state.draftRound,
      'players=', state.players.map((p) => [p.id, p.seat, p.drafted.length]), 'phase=', state.phase);
    throw error;
  }
}
function stepNew(state, seat, action) {
  const result = seasons.reduce(state, seat, action, { now: 0, rng: oldRng });
  if (!result.ok) throw new Error(`${action.type} 失败：${result.code} ${result.message}`);
  return result.state;
}
const oldRng = {
  next: () => 0.5,
  int: (max) => 0,
  pick: (items) => items[0],
  shuffle: (items) => [...items],
};

/** 建立两边同牌的对局。 */
function createPaired(playerCount = 2) {
  const oldState = old.createGame(
    Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}`, username: `p${i}` })),
    EXT_MODE ? { extensions: ['ext1', 'ext2'] } : {},
  );
  oldUidMap(oldState);
  let newState = seasons.setup(
    playerCount,
    { extensions: EXT_MODE ? ['base', 'ext1', 'ext2'] : ['base'] },
    oldRng,
  );
  newState = {
    ...newState,
    deck: oldState.deck.map((card) => ({ i: card.id, u: card.uid })),
    discard: oldState.discard.map((card) => ({ i: card.id, u: card.uid })),
    players: newState.players.map((player, seat) => ({
      ...player,
      draftHand: oldState.players[seat].draftHand.map((card) => ({ i: card.id, u: card.uid })),
    })),
  };
  return { oldState, newState };
}

function pickFor(state, seat) {
  return state.players[seat].draftHand[0];
}

// ---------------- 1. 轮抽 + 组牌 ----------------
const allSummonedIds = [];
for (const playerCount of [2, 3]) {
  const { oldState, newState } = createPaired(playerCount);
  let current = newState;
  compare(`setup ${playerCount} 人`, oldState, current);

  while (current.phase === 'draft') {
    const seat = current.players.findIndex((player) => player.drafted.length === current.draftRound);
    const card = pickFor(current, seat);
    stepOld(oldState, seat, 'draft-pick', { cardUid: card.u });
    current = stepNew(current, seat, { type: 'draft-pick', cardUid: card.u });
    compare(`draft ${playerCount} 人 seat=${seat} round=${current.draftRound}`, oldState, current);
  }

  for (const seat of current.players.map((player) => player.seat)) {
    const drafted = current.players[seat].drafted;
    const year1 = drafted.slice(0, 3).map((card) => card.u);
    const year2 = drafted.slice(3, 6).map((card) => card.u);
    stepOld(oldState, seat, 'organize', { cardUids: year1 });
    current = stepNew(current, seat, { type: 'organize', cardUids: year1 });
    compare(`organize1 ${playerCount} 人 seat=${seat}`, oldState, current);
    stepOld(oldState, seat, 'organize', { cardUids: year2 });
    current = stepNew(current, seat, { type: 'organize', cardUids: year2 });
    compare(`organize2 ${playerCount} 人 seat=${seat}`, oldState, current);
  }
  compare(`play 开局 ${playerCount} 人`, oldState, current);

  // ---------------- 2. 召唤（从牌堆取牌入手，固定能量，绕过掷骰） ----------------
  // 选「召唤效果已实现且不需要选择」的牌：比较费用支付、入场与召唤效果。
  const SIMPLE_SUMMON = new Set([
    'summon_gauge',
    'gain_crystals',
    'per_magic_item_crystal',
    'demon_of_argos',
    'air_elemental',
    'sid_nightshare',
    'cursed_relic',
    'summon_condition',
  ]);
  const qualifies = (ref) => {
    const def = cardDef(ref.i);
    return (
      def &&
      !def.costFlexible &&
      def.effect?.trigger === 'on_summon' &&
      SIMPLE_SUMMON.has(def.effect.typeKey ?? def.effect.type)
    );
  };
  const summonedIds = allSummonedIds;
  for (const seat of [0, 1]) {
    for (let index = 0; index < 3; index++) {
    const picked =
      EXT_MODE && seat === 0 && index === 0
        ? current.deck.find((ref) => ref.i > 50 && qualifies(ref)) ?? current.deck.find((ref) => qualifies(ref))
        : current.deck.find((ref) => qualifies(ref));
    if (!picked) break;
    const cardId = picked.i;
    // 旧引擎的卡对象要先取出来（带完整 cost/effect），再把牌从牌堆移到手牌。
    const oldCard = oldState.deck.find((card) => card.uid === picked.u);
    if (!oldCard) continue;
    for (const side of [oldState, current]) {
      const player = side.players[seat];
      player.gauge = player.played.length + 1;
      player.energies = { water: 9, air: 9, fire: 9, earth: 9 };
      player.crystals = 20;
      side.deck = side.deck.filter((card) => (card.uid ?? card.u) !== picked.u);
      side.turnOwner = seat;
    }
    oldState.players[seat].hand.push(oldCard);
    current = {
      ...current,
      deck: current.deck.filter((card) => card.u !== picked.u),
      turnOwner: seat,
      players: current.players.map((p) =>
        p.seat === seat ? { ...p, gauge: p.played.length + 1, hand: [...p.hand, picked] } : p,
      ),
    };
    try {
      stepOld(oldState, seat, 'summon', { cardUid: picked.u });
    } catch (error) {
      console.warn(`跳过 summon seat=${seat} card=${cardId}（旧引擎拒绝：${error.message}）`);
      continue;
    }
    current = stepNew(current, seat, { type: 'summon', cardUid: picked.u });
    summonedIds.push(cardId);
    compare(`summon ${playerCount} 人 seat=${seat} card=${cardId}`, oldState, current);
    }
  }

  // ---------------- 3. 转换（transmute） ----------------
  for (const seat of [0, 1]) {
    const element = ELEMENTS.find((el) => current.players[seat].energies[el] > 0);
    if (!element) continue;
    oldState.players[seat].canTransmute = true;
    oldState.turnOwner = seat;
    current = {
      ...current,
      turnOwner: seat,
      players: current.players.map((p) => (p.seat === seat ? { ...p, canTransmute: true } : p)),
    };
    stepOld(oldState, seat, 'transmute', { element });
    current = stepNew(current, seat, { type: 'transmute', element });
    compare(`transmute ${playerCount} 人 seat=${seat} ${element}`, oldState, current);
  }

  // ---------------- 4. 激活（注入一张简单无选择的激活卡） ----------------
  for (const seat of [0, 1]) {
    const picked = current.deck.find((ref) => {
      const def = cardDef(ref.i);
      return def?.effect?.trigger === 'activation' && (def.effect.typeKey ?? def.effect.type) === 'per_familiar_crystal';
    });
    if (!picked) continue;
    const oldCard = oldState.deck.find((card) => card.uid === picked.u);
    if (!oldCard) continue;
    for (const side of [oldState, current]) {
      const player = side.players[seat];
      player.activatedThisTurn = [];
      side.deck = side.deck.filter((card) => (card.uid ?? card.u) !== picked.u);
      side.turnOwner = seat;
    }
    oldState.players[seat].played.push(oldCard);
    current = {
      ...current,
      deck: current.deck.filter((card) => card.u !== picked.u),
      turnOwner: seat,
      players: current.players.map((p) =>
        p.seat === seat ? { ...p, played: [...p.played, picked], activatedThisTurn: [] } : p,
      ),
    };
    stepOld(oldState, seat, 'activate', { cardUid: picked.u });
    current = stepNew(current, seat, { type: 'activate', cardUid: picked.u });
    compare(`activate ${playerCount} 人 seat=${seat} card=${picked.i}`, oldState, current);
  }

  // ---------------- 4b. 扩展激活（pay_energy_reward：弃能量换奖励） ----------------
  if (EXT_MODE) {
    const seat = 0;
    const picked = current.deck.find((ref) => {
      const def = cardDef(ref.i);
      return def?.effect?.trigger === 'activation'
        && (def.effect.typeKey ?? def.effect.type) === 'pay_energy_reward'
        && (def.effect.crystals ?? 0) > 0
        && !def.effect.energy
        && !def.effect.draw;
    });
    if (picked) {
      const oldCard = oldState.deck.find((card) => card.uid === picked.u);
      if (oldCard) {
        for (const side of [oldState, current]) {
          const player = side.players[seat];
          player.energies = { water: 9, air: 9, fire: 9, earth: 9 };
          player.activatedThisTurn = [];
          side.deck = side.deck.filter((card) => (card.uid ?? card.u) !== picked.u);
          side.turnOwner = seat;
        }
        oldState.players[seat].played.push(oldCard);
        current = {
          ...current,
          deck: current.deck.filter((card) => card.u !== picked.u),
          turnOwner: seat,
          players: current.players.map((p) =>
            p.seat === seat
              ? { ...p, played: [...p.played, picked], activatedThisTurn: [] }
              : p,
          ),
        };
        stepOld(oldState, seat, 'activate', { cardUid: picked.u });
        current = stepNew(current, seat, { type: 'activate', cardUid: picked.u });
        // 旧引擎逐点询问元素（kind 'element'），新引擎一次问数量（element_alloc）。
        let guardChoice = 0;
        while (oldState.pendingChoice && guardChoice < 4) {
          guardChoice += 1;
          stepOld(oldState, seat, 'resolve-choice', { choice: 'water' });
        }
        const cost = Number(cardDef(picked.i)?.effect?.cost ?? 1);
        current = stepNew(current, seat, {
          type: 'resolve-choice',
          choice: { water: cost, air: 0, fire: 0, earth: 0 },
        });
        compare(`ext activate ${playerCount} 人 card=${picked.i}`, oldState, current);
      }
    }
  }

  // ---------------- 4b2. 基础激活 · 诅咒圣物控制权转移 ----------------
  {
    const seat = 0;
    const picked = current.deck.find((ref) => ref.i === 50);
    if (picked) {
      const oldCard = oldState.deck.find((card) => card.uid === picked.u);
      if (oldCard) {
        for (const side of [oldState, current]) {
          const player = side.players[seat];
          player.energies = { water: 3, air: 0, fire: 0, earth: 0 };
          player.activatedThisTurn = [];
          side.deck = side.deck.filter((card) => (card.uid ?? card.u) !== picked.u);
          side.turnOwner = seat;
        }
        oldState.players[seat].played.push(oldCard);
        current = {
          ...current,
          deck: current.deck.filter((card) => card.u !== picked.u),
          turnOwner: seat,
          players: current.players.map((p) =>
            p.seat === seat
              ? { ...p, played: [...p.played, picked], activatedThisTurn: [] }
              : p,
          ),
        };
        stepOld(oldState, seat, 'activate', { cardUid: picked.u });
        current = stepNew(current, seat, { type: 'activate', cardUid: picked.u });
        compare(`cursed relic transfer ${playerCount} 人`, oldState, current);
      }
    }
  }

  // ---------------- 4e. 牺牲离场：上限恢复 + on_sacrifice ----------------
  {
    const seat = 0;
    const ids = [37, 18, 42]; // 龙之头骨 / 附魔魔典 / 阿鲁斯的诅咒典籍
    const refs = ids
      .map((id) => current.deck.find((ref) => ref.i === id))
      .filter(Boolean);
    if (refs.length === 3) {
      const olds = refs
        .map((ref) => oldState.deck.find((card) => card.uid === ref.u))
        .filter(Boolean);
      if (olds.length === 3) {
        const used = new Set(refs.map((ref) => ref.u));
        for (const side of [oldState, current]) {
          const player = side.players[seat];
          player.energies = { water: 2, air: 2, fire: 2, earth: 2 };
          player.crystals = 10;
          player.activatedThisTurn = [];
          side.turnOwner = seat;
          side.deck = side.deck.filter((card) => !used.has(card.uid ?? card.u));
        }
        oldState.players[seat].maxEnergy = 10;
        oldState.players[seat].played.push(...olds);
        current = {
          ...current,
          turnOwner: seat,
          players: current.players.map((player) =>
            player.seat === seat
              ? {
                  ...player,
                  maxEnergy: 10,
                  played: [...player.played, ...refs],
                  activatedThisTurn: [],
                }
              : player,
          ),
        };
        // 旧引擎：激活后逐次提交「牺牲哪一张」（card_multi 每次 1 张）。
        stepOld(oldState, seat, 'activate', { cardUid: olds[0].uid });
        for (const card of [olds[1], olds[2], olds[0]]) {
          if (oldState.pendingChoice) {
            stepOld(oldState, seat, 'resolve-choice', { choice: [card.uid] });
          }
        }
        // 新引擎：逐张确认牺牲（先魔典、再典籍、最后头骨自身 → 结算 +15 水晶）。
        current = stepNew(current, seat, { type: 'activate', cardUid: refs[0].u });
        for (const uid of [refs[1].u, refs[2].u, refs[0].u]) {
          current = stepNew(current, seat, { type: 'resolve-choice', choice: uid });
        }
        compare(`sacrifice restore ${playerCount} 人`, oldState, current);
      }
    }
  }

  // ---------------- 4c. energy_swap 差分（骰面能量装不下时的重分配） ----------------
  {
    const zero = { summon: false, transmute: false, card: false, crystals: 0, water: 0, air: 0, fire: 0, earth: 0 };
    for (const side of [oldState, current]) {
      side.players.forEach((player) => {
        player.energies =
          player.seat === 0
            ? { water: 6, air: 1, fire: 0, earth: 0 }
            : { water: 0, air: 0, fire: 0, earth: 0 };
        player.crystals = 0;
        player.played = [];
        player.maxEnergy = BASE_MAX_ENERGY;
        player.canTransmute = false;
      });
      side.season.dice.forEach((die, index) => {
        die.picked = false;
        die.pickedBy = null;
        die.rewards = index === 0 ? { ...zero, water: 2 } : zero;
      });
      side.pickedThisSeason = [];
      side.turnOwner = null;
      side.currentPicker = 0;
      side.startPlayer = 0;
    }
    oldState.draftPicked = [];
    oldState.diceResolved = [];
    current = { ...current, dicePicked: [] };
    for (let i = 0; i < current.players.length; i += 1) {
      const seat = i % current.players.length;
      stepOld(oldState, seat, 'draft-dice', { dieIndex: i });
      current = stepNew(current, seat, { type: 'draft-dice', dieIndex: i });
    }
    if (oldState.pendingChoice?.kind !== 'energy_swap' || current.pendingChoice?.kind !== 'energy_swap') {
      console.error('energy_swap 未按预期挂起', oldState.pendingChoice, current.pendingChoice);
      process.exitCode = 1;
    }
    const swap = { water: 5, air: 2, fire: 0, earth: 0 };
    stepOld(oldState, 0, 'resolve-choice', { choice: swap });
    current = stepNew(current, 0, { type: 'resolve-choice', choice: swap });
    compare(`energy_swap ${playerCount} 人`, oldState, current);
  }

  // ---------------- 4d. 骰面奖励 + 回合轮转 + 月份推进差分 ----------------
  {
    const rewards = [
      { summon: true, transmute: true, card: true, crystals: 2, water: 1 },
      { earth: 2 },
      { fire: 1 },
    ];
    for (const side of [oldState, current]) {
      side.players.forEach((player) => {
        player.energies = { water: 0, air: 0, fire: 0, earth: 0 };
        player.crystals = 0;
        player.played = [];
        player.gauge = 3;
        player.canTransmute = false;
        player.maxEnergy = BASE_MAX_ENERGY;
      });
      side.season.dice.forEach((die, index) => {
        die.picked = false;
        die.pickedBy = null;
        die.pip = index === 2 ? 2 : 1;
        die.rewards = rewards[index] ?? {};
      });
      side.pickedThisSeason = [];
      side.turnOwner = null;
      side.currentPicker = 0;
    }
    oldState.draftPicked = [];
    oldState.diceResolved = [];
    current = { ...current, dicePicked: [] };

    for (let i = 0; i < current.players.length; i += 1) {
      stepOld(oldState, i, 'draft-dice', { dieIndex: i });
      current = stepNew(current, i, { type: 'draft-dice', dieIndex: i });
    }
    compare(`die rewards ${playerCount} 人 首行动者`, oldState, current);

    stepOld(oldState, 0, 'end-turn', {});
    current = stepNew(current, 0, { type: 'end-turn' });
    compare(`turn rotate ${playerCount} 人`, oldState, current);

    stepOld(oldState, 1, 'end-turn', {});
    current = stepNew(current, 1, { type: 'end-turn' });
    compare(`month advance ${playerCount} 人`, oldState, current);
  }

  // ---------------- 4f. 徽章（use-badge / badge-keep） ----------------
  {
    const resetForBadges = () => {
      for (const side of [oldState, current]) {
        side.phase = 'play';
        side.month = 4; // 春季
        side.year = 1;
        side.currentPicker = 0;
        side.turnOwner = 0;
        side.pendingChoice = null;
        side.pickedThisSeason = [];
        side.players.forEach((player) => {
          player.energies = { water: 2, air: 2, fire: 2, earth: 2 };
          player.crystals = 0;
          player.played = [];
          player.gauge = 5;
          player.canTransmute = false;
          // 8：让 2×4 的摆位装得下，避免上限裁剪干扰徽章语义对比。
          player.maxEnergy = BASE_MAX_ENERGY + 1;
          player.badgesUsed = 0;
          player.badgeDraw = null;
          player.badgeDrawUpgrade = false;
          player.hand = [];
        });
      }
      oldState.energySwapPending = null;
      current = { ...current, pendingQueue: [], badgeDraw: null };
    };

    resetForBadges();
    stepOld(oldState, 0, 'use-badge', { badgeType: 3 });
    current = stepNew(current, 0, { type: 'use-badge', badgeType: 3 });
    compare(`badge3 gauge ${playerCount} 人`, oldState, current);

    resetForBadges();
    stepOld(oldState, 0, 'use-badge', { badgeType: 2, element: 'air' });
    current = stepNew(current, 0, { type: 'use-badge', badgeType: 2, element: 'air' });
    compare(`badge2 crystals ${playerCount} 人`, oldState, current);

    resetForBadges();
    stepOld(oldState, 0, 'use-badge', {
      badgeType: 1,
      fromElements: ['water', 'fire'],
      toElements: ['earth', 'earth'],
    });
    current = stepNew(current, 0, {
      type: 'use-badge',
      badgeType: 1,
      fromElements: ['water', 'fire'],
      toElements: ['earth', 'earth'],
    });
    compare(`badge1 swap ${playerCount} 人`, oldState, current);

    resetForBadges();
    stepOld(oldState, 0, 'use-badge', { badgeType: 4 });
    current = stepNew(current, 0, { type: 'use-badge', badgeType: 4 });
    compare(`badge4 upgrade ${playerCount} 人`, oldState, current);

    // 0 号骰带抽卡奖励：徽章升级后应摸 2 张进 badgeDraw，再由 badge-keep 选 1。
    for (const side of [oldState, current]) {
      side.currentPicker = 0;
      side.turnOwner = null;
      side.pickedThisSeason = [];
      side.season.dice.forEach((die, index) => {
        die.picked = false;
        die.pickedBy = null;
        die.rewards = index === 0 ? { card: true } : {};
      });
    }
    oldState.draftPicked = [];
    oldState.diceResolved = [];
    current = { ...current, dicePicked: [] };
    for (let i = 0; i < current.players.length; i += 1) {
      stepOld(oldState, i, 'draft-dice', { dieIndex: i });
      current = stepNew(current, i, { type: 'draft-dice', dieIndex: i });
    }
    compare(`badge4 draw2 ${playerCount} 人`, oldState, current);

    const drawn = current.players[0].badgeDraw;
    if (!drawn || drawn.length !== 2) {
      fail(`badge4 draw2 ${playerCount} 人：期望 badgeDraw 2 张，实际 ${drawn ? drawn.length : 'null'}`);
    } else {
      const keepRef = drawn[0];
      stepOld(oldState, 0, 'badge-keep', { cardId: keepRef.i });
      current = stepNew(current, 0, { type: 'badge-keep', cardUid: keepRef.u });
      compare(`badge-keep ${playerCount} 人`, oldState, current);
    }
  }

  // ---------------- 4g. 基础激活效果逐卡对照 ----------------
  {
    // 覆盖「旧引擎与新引擎都只需要 0–1 次选择」的激活卡；
    // 生命药水（多选元素）已对齐（element_multi），场景在 4g 末尾单独覆盖。
    const runBaseActivation = (label, cardId, abilityKey, options = {}) => {
      const newRef = (card) => card.u;
      const oldRef = (card) => card.uid;
      const locate = (side, refOf) => {
        const inDeck = side.deck.find((card) => card.i === cardId || card.id === cardId);
        if (inDeck) return inDeck;
        for (const zone of side.players.flatMap((player) => [player.hand, player.library2, player.library3, player.played])) {
          const found = zone.find((card) => card.i === cardId || card.id === cardId);
          if (found) return found;
        }
        return undefined;
      };
      const picked = locate(current, newRef);
      if (!picked) {
        fail(`${label}：任何区域都找不到卡 id=${cardId}`);
        return;
      }
      const oldCard = locate(oldState, oldRef, picked.u);
      if (!oldCard) {
        fail(`${label}：旧引擎任何区域都找不到 uid=${picked.u}`);
        return;
      }
      const strip = (side, uid) => {
        side.deck = side.deck.filter((card) => (card.uid ?? card.u) !== uid);
        side.players = side.players.map((player) => ({
          ...player,
          hand: player.hand.filter((card) => (card.uid ?? card.u) !== uid),
          library2: player.library2.filter((card) => (card.uid ?? card.u) !== uid),
          library3: player.library3.filter((card) => (card.uid ?? card.u) !== uid),
          played: player.played.filter((card) => (card.uid ?? card.u) !== uid),
          discard: (player.discard ?? []).filter((card) => (card.uid ?? card.u) !== uid),
        }));
        if (side.discard) side.discard = side.discard.filter((card) => (card.uid ?? card.u) !== uid);
        if (side.pendingCards) side.pendingCards = side.pendingCards.filter((card) => (card.uid ?? card.u) !== uid);
        return side;
      };
      strip(oldState, picked.u);
      current = strip(current, picked.u);

      for (const side of [oldState, current]) {
        side.turnOwner = 0;
        side.pendingChoice = null;
        side.players.forEach((player) => {
          player.energies = { water: 0, air: 0, fire: 0, earth: 0 };
          player.crystals = 0;
          player.played = [];
          player.hand = [];
          player.gauge = 3;
          player.maxEnergy = BASE_MAX_ENERGY;
          player.activatedThisTurn = [];
        });
        side.players[0].energies = { ...(options.energies ?? { water: 0, air: 0, fire: 0, earth: 0 }) };
        side.players[0].crystals = options.crystals ?? 0;
        for (let i = 1; i < side.players.length; i += 1) {
          side.players[i].crystals = options.opponentCrystals ?? 0;
        }
      }
      current = { ...current, pendingQueue: [], pendingChoice: null };

      oldState.players[0].played.push(oldCard);
      current = {
        ...current,
        players: current.players.map((player) =>
          player.seat === 0 ? { ...player, played: [...player.played, picked] } : player,
        ),
      };

      const payload = { cardUid: picked.u, ...(abilityKey ? { abilityKey } : {}) };
      stepOld(oldState, 0, 'activate', payload);
      current = stepNew(current, 0, { type: 'activate', ...payload });

      for (const choice of options.oldChoices ?? []) {
        if (!oldState.pendingChoice) break;
        stepOld(oldState, 0, 'resolve-choice', choice);
      }
      for (const choice of options.newChoices ?? []) {
        if (!current.pendingChoice) break;
        current = stepNew(current, 0, { type: 'resolve-choice', choice });
      }
      compare(label, oldState, current);
    };

    // 力量药水：牺牲本卡、抽 1、召唤等级 +2（无选择）
    runBaseActivation('4g potion_power', 23);
    // 毁灭者凯恩：只有一种可用能量 → 自动弃 1，对手 -4 水晶（无选择）
    runBaseActivation('4g kairn', 16, undefined, {
      energies: { water: 2, air: 0, fire: 0, earth: 0 },
      opponentCrystals: 5,
      newChoices: ['water'],
    });
    // 伊什塔尔天平：只有一种元素够 4 个 → 自动弃 4，水晶 +12（无选择）
    runBaseActivation('4g balance_of_ishtar', 5, undefined, {
      energies: { water: 4, air: 0, fire: 0, earth: 0 },
      opponentCrystals: 0,
      newChoices: ['water'],
    });
    // 知识药水：牺牲本卡，选 5 个能量
    runBaseActivation('4g potion_knowledge', 25, undefined, {
      oldChoices: [{ choice: { water: 5, air: 0, fire: 0, earth: 0 } }],
      newChoices: [{ water: 5, air: 0, fire: 0, earth: 0 }],
    });
    // 死灵匕首：牺牲本卡，选 4 个能量
    runBaseActivation('4g necrotic_kriss', 44, undefined, {
      oldChoices: [{ choice: { air: 4, water: 0, fire: 0, earth: 0 } }],
      newChoices: [{ air: 4, water: 0, fire: 0, earth: 0 }],
    });
    // 光之树 A：弃 3 水晶换 1 能量
    runBaseActivation('4g tree_of_light A', 32, 'crystal_to_energy', {
      crystals: 5,
      oldChoices: [{ choice: { earth: 1, water: 0, air: 0, fire: 0 } }],
      newChoices: [{ earth: 1, water: 0, air: 0, fire: 0 }],
    });
    // 生命药水：牺牲本卡，可一次勾选多种元素（每种全部 ×4 水晶）
    runBaseActivation('4g potion_life', 26, undefined, {
      energies: { water: 2, air: 3, fire: 0, earth: 0 },
      oldChoices: [{ choice: ['water', 'air'] }],
      newChoices: [['water', 'air']],
    });
    // 光之树 B：弃 1 水换当季转换值的水晶
    runBaseActivation('4g tree_of_light B', 32, 'energy_to_crystal', {
      energies: { water: 2, air: 0, fire: 0, earth: 0 },
      oldChoices: [{ choice: 'water' }],
      newChoices: ['water'],
    });
  }

  // ---------------- 5. 终局计分（人工摆一个简单终局 + 特殊计分卡） ----------------
  const scoreCards = [45, 19, 46]
    .map((id) => findOldCard(oldState, id))
    .filter((card) => card !== null);
  for (const side of [oldState, current]) {
    side.month = 35;
    side.turnOwner = 0;
    side.players.forEach((player, seat) => {
      player.played = [];
      player.hand = player.hand.slice(0, 2);
      player.crystals = 7 + seat;
      player.badgesUsed = 1;
      player.canTransmute = false;
    });
  }
  // 座位 0 摆上「希迪特的灯笼 / 拉格菲尔德的头盔」等计分卡，验证 score 注册表
  // （灯笼：储备能量 ×3；头盔：在场牌严格多于对手 → +20；宝箱：无随从 → +20）。
  oldState.players[0].played = scoreCards;
  current = {
    ...current,
    players: current.players.map((player, seat) =>
      seat === 0
        ? { ...player, played: scoreCards.map((card) => ({ i: card.id, u: card.uid })) }
        : player,
    ),
  };
  stepOld(oldState, 0, 'end-turn', {});
  current = stepNew(current, 0, { type: 'end-turn' });
  // 3–4 人局需要所有人都结束回合才会真正终局。
  let endGuard = 0;
  while (!current.result && endGuard < 8) {
    endGuard++;
    const nextSeat = current.turnOwner;
    if (nextSeat === null || nextSeat === undefined) break;
    stepOld(oldState, nextSeat, 'end-turn', {});
    current = stepNew(current, nextSeat, { type: 'end-turn' });
  }
  compare(`endgame ${playerCount} 人（含特殊计分）`, oldState, current);
  const scored = current.result?.players?.find((row) => row.seat === 0);
  if (!scored || scored.effectPoints <= 0) {
    fail(`特殊计分未生效（scoreCards=${scoreCards.length}，effectPoints=${scored?.effectPoints}）`);
  }
}

function findOldCard(state, id) {
  const zones = [
    state.deck,
    state.discard,
    ...state.players.flatMap((player) => [
      player.hand,
      player.draftHand,
      player.played,
      player.library2,
      player.library3,
    ]),
  ];
  for (const zone of zones) {
    const found = (zone ?? []).find((card) => card.id === id);
    if (found) return found;
  }
  return null;
}

function cardDef(id) {
  return CARD_BY_ID.get(id) ?? null;
}

function totalCost(def) {
  return ELEMENTS.reduce((sum, element) => sum + (def.cost?.[element] ?? 0), 0) + (def.cost?.crystal ?? 0);
}

if (failures.length > 0) {
  console.error(`✗ L1 差分失败 ${failures.length}/${checks} 项：\n\n${failures.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log(
  `OK L1 状态级差分一致：${checks} 个检查点（轮抽/组牌/召唤/转换/激活/能量重分配/特殊计分/控制权转移${EXT_MODE ? '，含扩展包' : ''}），召唤卡 ${allSummonedIds.join(',')}`,
);
}
