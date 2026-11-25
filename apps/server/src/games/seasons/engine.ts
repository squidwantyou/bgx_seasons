import type { GameEvent, RandomSource } from '@bgx/protocol';
import {
  ELEMENTS,
  type CardRef,
  type Element,
  type SeasonsAction,
  type SeasonsCardCost,
  type SeasonsCardDef,
  type SeasonsCardView,
  type SeasonsDieRewards,
  type SeasonsDieView,
  type SeasonsGameView,
  type SeasonsLogEntry,
  type SeasonsOptions,
  type SeasonsPlayerScore,
  type SeasonsPlayerView,
  type SeasonsResultView,
  type SeasonsSeasonView,
} from '@bgx/protocol/games/seasons';
import type { GameEngine, ReduceResult } from '../types.js';
import { BASE_CARDS, CARD_BY_ID, SEASONS_CARDS } from './cards/base.js';
import { validateCardPool } from './cards/support.js';
import { cardById } from './cards/registry.js';
import { randInt } from './rules/random.js';
import { runSummonEffect, summonChoiceFor } from './cards/effects.js';
import {
  BADGE_PENALTY,
  BASE_MAX_ENERGY,
  CARDS_PER_PLAYER,
  COPIES_PER_CARD,
  DRAFT_ROUNDS,
  HAND_PENALTY,
  MAX_BADGES,
  MONTHS_PER_SEASON,
  MONTHS_PER_YEAR,
  SEASONS,
  SEASONS_PER_YEAR,
  TOTAL_MONTHS,
  TRANSMUTE_VALUE,
} from './rules/const.js';
import {
  abilitiesOf,
  abilityAmount,
  addEnergyCapped,
  affordable,
  ELEMENT_NAME_ZH,
  energySum,
  resolveCost,
} from './rules/play.js';
import { randIntAt, shuffleWithSeed } from './rules/random.js';
import { drawOne, drawToHand, patchPlayer, pushLog, seatName } from './rules/state.js';
import { parseCardList, parseElementAlloc } from './rules/choice.js';
import { DICE_BY_ELEMENT } from './rules/dice.js';

/* ------------------------------------------------------------------ */
/* 状态                                                                */
/* ------------------------------------------------------------------ */

/** 场上的卡：CardRef + 公开的动态信息。 */
export interface CardInstance extends CardRef {
  /** 存在卡上的能量（水晶球等） */
  stored?: Partial<Record<Element, number>>;
  /** 灵活费用卡实际支付的元素 */
  paid?: Element[];
}

export interface SeasonsDieState {
  id: number;
  letter: string;
  face: number;
  pip: number;
  rewards: SeasonsDieRewards;
  pickedBy: number | null;
}

export interface SeasonsSeasonState {
  index: number;
  dice: SeasonsDieState[];
}

export interface SeasonsPendingChoiceState {
  kind: string;
  key: string;
  choosingSeat: number;
  options: Record<string, unknown>;
}

export interface SeasonsPlayerState {
  seat: number;
  /** 第 1 年手牌 */
  hand: CardRef[];
  /** 第 2 / 3 年牌库 */
  library2: CardRef[];
  library3: CardRef[];
  played: CardInstance[];
  energies: Record<Element, number>;
  crystals: number;
  gauge: number;
  maxEnergy: number;
  /** 终局按 BADGE_PENALTY 扣分 */
  badgesUsed: number;
  badgeDrawUpgrade: boolean;
  /** 徽章升级后摸 2 选 1 的待选牌（仅本人可见） */
  badgeDraw: CardRef[] | null;
  /** 轮抽阶段的手牌（会左右传递） */
  draftHand: CardRef[];
  /** 已轮抽到的 9 张牌 */
  drafted: CardRef[];
  organizeYear1: number[];
  organizeYear2: number[];
  organizeDone: boolean;
  canTransmute: boolean;
  /** 本回合已激活的能力："<uid>:<abilityKey>" */
  activatedThisTurn: string[];
}

export interface SeasonsState {
  version: 1;
  rngSeed: number;
  rngCursor: number;
  phase: 'draft' | 'organize' | 'play' | 'ended';
  /** 已完成的轮抽轮数，0–9 */
  draftRound: number;
  players: SeasonsPlayerState[];
  deck: CardRef[];
  discard: CardRef[];
  /** 0–35 */
  month: number;
  year: number;
  seasonIdx: number;
  season: SeasonsSeasonState | null;
  startPlayer: number;
  currentPicker: number | null;
  turnOwner: number | null;
  /** 本月已行动完的座位 */
  pickedThisSeason: number[];
  /** 本月选骰顺序（决定行动顺序） */
  dicePicked: number[];
  pendingChoice: SeasonsPendingChoiceState | null;
  /** 同一时机排队等待的选择（花瓶、时光沙漏等被动），前一个结算后自动接上。 */
  pendingQueue: SeasonsPendingChoiceState[];
  /** 待选择卡牌（仅选择者可见）：抽 N 留 1 等弹窗。 */
  pendingCards: CardRef[] | null;
  result: SeasonsResultView | null;
  resignedSeat: number | null;
  log: SeasonsLogEntry[];
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function fail(code: string, message: string): ReduceResult<SeasonsState> {
  return { ok: false, code, message };
}

function promoteQueued(state: SeasonsState): SeasonsState {
  if (state.pendingChoice || state.pendingQueue.length === 0) return state;
  let queue = state.pendingQueue;
  while (queue.length > 0) {
    const [next, ...rest] = queue;
    if (!next) break;
    // 过期的弃置选择：排队之后储备可能已被其他效果清空，此时无需再弃。
    if (next.kind === 'energy_discard') {
      const player = state.players[next.choosingSeat];
      if (!player || reserveTotal(player) <= player.maxEnergy) {
        queue = rest;
        continue;
      }
    }
    return { ...state, pendingChoice: next, pendingQueue: rest };
  }
  return queue.length === state.pendingQueue.length
    ? state
    : { ...state, pendingQueue: queue };
}

/** 已经提升为 pendingChoice 的弃置选择，若储备已不超上限则直接作废。 */
function clearStaleDiscard(state: SeasonsState): SeasonsState {
  const pending = state.pendingChoice;
  if (!pending || pending.kind !== 'energy_discard') return state;
  const player = state.players[pending.choosingSeat];
  if (player && reserveTotal(player) > player.maxEnergy) return state;
  return { ...state, pendingChoice: null };
}

function queueChoice(
  state: SeasonsState,
  choice: SeasonsPendingChoiceState,
): SeasonsState {
  return { ...state, pendingQueue: [...state.pendingQueue, choice] };
}

function finish(
  prev: SeasonsState,
  res: ReduceResult<SeasonsState>,
): ReduceResult<SeasonsState> {
  if (!res.ok) return res;
  let next = normalizeReserve(prev, res.state);
  next = skipEmptyCardChoice(next);
  return { ...res, state: promoteQueued(next) };
}

/**
 * 牌堆见底时可能一张牌都抽不到；此时「选 1 张保留」之类的选择没有候选，
 * 直接作废，避免玩家卡在一个无解弹窗上（小卡池 / 长时间对局里会真实发生）。
 */
function skipEmptyCardChoice(state: SeasonsState): SeasonsState {
  const pending = state.pendingChoice;
  if (!pending) return state;
  if (pending.kind !== 'card_pick' && pending.kind !== 'card_list') return state;
  if (pending.options.purpose === 'discard') return state;
  if ((state.pendingCards?.length ?? 0) > 0) return state;
  return { ...state, pendingChoice: null, pendingCards: null };
}

/**
 * 储备上限可能因卡牌离场而降低；超出的能量必须由本人选择弃掉。
 * 放在 finish 统一收口，任何改动上限的路径都不会漏（也让新增卡牌不必各自处理）。
 */
function normalizeReserve(prev: SeasonsState, state: SeasonsState): SeasonsState {
  let next = state;
  for (const player of state.players) {
    const before = prev.players.find((item) => item.seat === player.seat);
    if (!before || player.maxEnergy >= before.maxEnergy) continue;
    const overflow = energySum(player.energies) - player.maxEnergy;
    if (overflow <= 0) continue;
    const queued =
      (next.pendingChoice?.kind === 'energy_discard' &&
        next.pendingChoice.choosingSeat === player.seat) ||
      next.pendingQueue.some(
        (choice) => choice.kind === 'energy_discard' && choice.choosingSeat === player.seat,
      );
    if (queued) continue;
    const available = { ...player.energies };
    next = queueChoice(next, {
      kind: 'energy_discard',
      key: 'energy_discard',
      choosingSeat: player.seat,
      options: {
        title: `储备上限变为 ${player.maxEnergy}，请弃掉 ${overflow} 个能量`,
        amount: overflow,
        available,
        label: '弃掉',
      },
    });
  }
  return next;
}

function newPlayer(seat: number): SeasonsPlayerState {
  return {
    seat,
    hand: [],
    library2: [],
    library3: [],
    played: [],
    energies: { water: 0, air: 0, fire: 0, earth: 0 },
    crystals: 0,
    gauge: 0,
    maxEnergy: BASE_MAX_ENERGY,
    badgesUsed: 0,
    badgeDrawUpgrade: false,
    badgeDraw: null,
    draftHand: [],
    drafted: [],
    organizeYear1: [],
    organizeYear2: [],
    organizeDone: false,
    canTransmute: false,
    activatedThisTurn: [],
  };
}

function cardView(ref: CardRef, extra?: Partial<SeasonsCardView>): SeasonsCardView {
  const view: SeasonsCardView = { i: ref.i, u: ref.u };
  if (extra?.stored) view.stored = extra.stored;
  if (extra?.used) view.used = true;
  if (extra?.paid) view.paid = extra.paid;
  return view;
}

function usedKeys(player: SeasonsPlayerState, uid: number): string[] {
  return player.activatedThisTurn.filter(
    (key) => key === String(uid) || key.startsWith(`${uid}:`),
  );
}


function playerView(
  state: SeasonsState,
  player: SeasonsPlayerState,
  viewerSeat: number | null,
): SeasonsPlayerView {
  const self = viewerSeat === player.seat;
  return {
    seat: player.seat,
    isYou: self,
    handCount: player.hand.length,
    hand: self ? player.hand.map((card) => cardView(card)) : null,
    played: player.played.map((card) => {
      const keys = usedKeys(player, card.u);
      return cardView(card, {
        stored: card.stored,
        used: keys.length > 0,
        paid: card.paid,
      });
    }),
    libraryCount: player.library2.length + player.library3.length,
    energies: { ...player.energies },
    crystals: player.crystals,
    gauge: player.gauge,
    maxEnergy: player.maxEnergy,
    canTransmute: player.canTransmute,
    badgesUsed: player.badgesUsed,
    badgeDrawUpgrade: player.badgeDrawUpgrade,
    badgeDraw: self ? (player.badgeDraw ? player.badgeDraw.map((card) => cardView(card)) : null) : null,
    draftPicked: player.drafted.length > state.draftRound,
    draftHandCount: player.draftHand.length,
    draftHand: self ? player.draftHand.map((card) => cardView(card)) : null,
    draftedCount: player.drafted.length,
    drafted: self ? player.drafted.map((card) => cardView(card)) : null,
    organizeDone: player.organizeDone,
    organizeYear1: self ? [...player.organizeYear1] : null,
    organizeYear2: self ? [...player.organizeYear2] : null,
  };
}

function seasonView(state: SeasonsState): SeasonsSeasonView | null {
  if (!state.season) return null;
  const def = SEASONS[state.season.index];
  if (!def) return null;
  return {
    name: def.nameZh,
    nameEn: def.nameEn,
    element: def.element,
    letter: def.letter,
    index: state.season.index,
  };
}

function dieViews(state: SeasonsState, season: SeasonsSeasonView | null): SeasonsDieView[] {
  if (!state.season) return [];
  return state.season.dice.map((die) => ({
    id: die.id,
    letter: die.letter,
    face: die.face,
    pip: die.pip,
    rewards: { ...die.rewards },
    picked: die.pickedBy !== null,
    pickedBy: die.pickedBy,
  }));
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

/** 组池：自定义 id 列表优先，否则使用标准基础卡池。 */
/** 卡池条目：一张卡的实例份数（标准池 2 份，五福季节 20 份）。 */
type PoolEntry = { def: SeasonsCardDef; copies: number };

/** 五福季节：空气 / 火焰 / 大地 / 流水 / 元素护符，每种 20 张。 */
export const FIVE_FORTUNES_IDS: readonly number[] = [1, 2, 3, 4, 31];
export const FIVE_FORTUNES_COPIES = 20;

function poolEntries(options: SeasonsOptions): PoolEntry[] {
  if (options.customDeck && options.customDeck.trim().length > 0) {
    const ids = [
      ...new Set(
        options.customDeck
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    const cards: PoolEntry[] = [];
    const missing: number[] = [];
    for (const id of ids) {
      const def = cardById(id);
      if (def) cards.push({ def, copies: COPIES_PER_CARD });
      else missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(`未知卡牌 id：${missing.join(', ')}`);
    }
    return cards;
  }
  if (options.pool === 'five_fortunes') {
    const entries: PoolEntry[] = [];
    const missing: number[] = [];
    for (const id of FIVE_FORTUNES_IDS) {
      const def = cardById(id);
      if (def) entries.push({ def, copies: FIVE_FORTUNES_COPIES });
      else missing.push(id);
    }
    if (missing.length > 0) {
      throw new Error(`五福季节卡池缺少卡牌 id：${missing.join(', ')}`);
    }
    return entries;
  }
  return SEASONS_CARDS.map((def) => ({ def, copies: COPIES_PER_CARD }));
}

/** 开局前校验卡池：id 唯一、数值合法、效果 key 都已登记。 */
function assertCardPool(cards: readonly SeasonsCardDef[]): void {
  const issues = validateCardPool(cards);
  if (issues.length > 0) {
    const detail = issues
      .map((issue) => `#${issue.cardId ?? '?'} ${issue.message}`)
      .join('；');
    throw new Error(`卡池校验失败：${detail}`);
  }
}

function buildDeck(entries: readonly PoolEntry[], playerCount: number): CardRef[] {
  const deck: CardRef[] = [];
  let uid = 1;
  for (const entry of entries) {
    for (let copy = 0; copy < entry.copies; copy++) {
      deck.push({ i: entry.def.id, u: uid });
      uid++;
    }
  }
  const needed = playerCount * DRAFT_ROUNDS;
  if (deck.length < needed) {
    throw new Error(`卡池只有 ${deck.length} 张牌，至少需要 ${needed} 张才能发牌`);
  }
  return deck;
}

function setup(
  playerCount: number,
  options: SeasonsOptions,
  rng: RandomSource,
): SeasonsState {
  if (playerCount < 2) throw new Error('四季物语至少需要 2 名玩家');
  if (playerCount > 4) throw new Error('四季物语最多支持 4 名玩家');

  const seed = rng.int(0x7fffffff);
  let cursor = 0;

  const entries = poolEntries(options);
  assertCardPool(entries.map((entry) => entry.def));
  const deck = buildDeck(entries, playerCount);
  cursor = shuffleWithSeed(deck, seed, cursor);

  const players = Array.from({ length: playerCount }, (_, seat) => newPlayer(seat));
  // 与旧引擎一致：逐张从牌堆顶发牌，每人 9 张。
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (const player of players) {
      const card = deck.pop();
      if (card) player.draftHand.push(card);
    }
  }

  return {
    version: 1,
    rngSeed: seed,
    rngCursor: cursor,
    phase: 'draft',
    draftRound: 0,
    players,
    deck,
    discard: [],
    month: 0,
    year: 1,
    seasonIdx: 0,
    season: null,
    startPlayer: 0,
    currentPicker: 0,
    turnOwner: null,
    pickedThisSeason: [],
    dicePicked: [],
    pendingChoice: null,
    pendingQueue: [],
    pendingCards: null,
    result: null,
    resignedSeat: null,
    log: [{ t: 'draft', msg: '轮抽开始：每人 9 张牌' }],
  };
}

/* ------------------------------------------------------------------ */
/* 阶段：轮抽 / 组牌                                                    */
/* ------------------------------------------------------------------ */

function draftPick(
  state: SeasonsState,
  seat: number,
  cardUid: number,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'draft') return fail('bad_phase', '当前不是轮抽阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.drafted.length !== state.draftRound) {
    return fail('already_picked', '你已选择过本轮，请等待其他玩家');
  }

  const index = me.draftHand.findIndex((card) => card.u === cardUid);
  if (index < 0) return fail('card_not_in_hand', '所选牌不在轮抽手牌中');
  const card = me.draftHand[index];
  if (!card) return fail('card_not_in_hand', '所选牌不在轮抽手牌中');

  let players = state.players.map((player) =>
    player.seat === seat
      ? {
          ...player,
          draftHand: player.draftHand.filter((_, i) => i !== index),
          drafted: [...player.drafted, card],
        }
      : player,
  );

  let draftRound = state.draftRound;
  let phase: SeasonsState['phase'] = state.phase;
  let log = state.log;
  const events: GameEvent[] = [
    { type: 'draft_pick', seat, cardUid, cardId: card.i },
  ];

  if (players.every((player) => player.drafted.length === state.draftRound + 1)) {
    draftRound = state.draftRound + 1;
    if (draftRound >= DRAFT_ROUNDS) {
      phase = 'organize';
      log = pushLog(log, 'draft', '轮抽完成，进入组牌阶段');
      events.push({ type: 'draft_complete' });
    } else {
      // 手牌传向左边：第 i 位拿到第 i-1 位的手牌。
      const hands = players.map((player) => player.draftHand);
      players = players.map((player, i) => ({
        ...player,
        draftHand: hands[(i - 1 + players.length) % players.length] ?? [],
      }));
      events.push({ type: 'draft_round', round: draftRound });
    }
  }

  return {
    ok: true,
    state: { ...state, players, draftRound, phase, log },
    events,
  };
}

/** 开始新的一个月：换季、从当季 5 颗骰子里洗出「人数 + 1」颗并掷面。 */
function startMonth(state: SeasonsState): SeasonsState {
  const seasonIdx =
    Math.floor(state.month / MONTHS_PER_SEASON) % SEASONS_PER_YEAR;
  const def = SEASONS[seasonIdx];
  if (!def) throw new Error(`非法月份：${state.month}`);

  const pool = [...DICE_BY_ELEMENT[def.element]];
  const count = Math.min(state.players.length + 1, pool.length);
  let cursor = shuffleWithSeed(pool, state.rngSeed, state.rngCursor);

  const dice: SeasonsDieState[] = [];
  for (const die of pool.slice(0, count)) {
    const faceIndex = randIntAt(state.rngSeed, cursor, die.faces.length);
    cursor++;
    const face = die.faces[faceIndex];
    if (!face) continue;
    dice.push({
      id: die.id,
      letter: def.letter,
      face: face.roll,
      pip: face.pip,
      rewards: { ...face.rewards },
      pickedBy: null,
    });
  }

  const year = Math.floor(state.month / MONTHS_PER_YEAR) + 1;
  const monthOfSeason = (state.month % MONTHS_PER_SEASON) + 1;
  return {
    ...state,
    rngCursor: cursor,
    year,
    seasonIdx,
    season: { index: seasonIdx, dice },
    currentPicker: state.startPlayer,
    turnOwner: null,
    pickedThisSeason: [],
    dicePicked: [],
    pendingChoice: null,
    pendingCards: null,
    log: pushLog(
      state.log,
      'month',
      `第 ${year} 年 · ${def.nameZh}季 · 第 ${monthOfSeason} 月 · 起始玩家：${seatName(state.startPlayer)}`,
    ),
  };
}

function startTournament(state: SeasonsState): SeasonsState {
  return startMonth({ ...state, phase: 'play' });
}

function organize(
  state: SeasonsState,
  seat: number,
  cardUids: readonly [number, number, number],
): ReduceResult<SeasonsState> {
  if (state.phase !== 'organize') return fail('bad_phase', '当前不是组牌阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.organizeDone) return fail('organize_done', '你已完成组牌');

  if (new Set(cardUids).size !== cardUids.length) {
    return fail('duplicate_card', '所选牌重复');
  }
  for (const uid of cardUids) {
    if (!me.drafted.some((card) => card.u === uid)) {
      return fail('card_not_drafted', '所选牌不在已轮抽的牌中');
    }
  }

  let players = state.players;
  let log = state.log;
  const events: GameEvent[] = [
    { type: 'organize', seat, step: me.organizeYear1.length === 0 ? 1 : 2 },
  ];

  if (me.organizeYear1.length === 0) {
    players = state.players.map((player) =>
      player.seat === seat ? { ...player, organizeYear1: [...cardUids] } : player,
    );
  } else {
    const allUids = new Set([...me.organizeYear1, ...cardUids]);
    const byUid = new Map(me.drafted.map((card) => [card.u, card]));
    const year1 = me.organizeYear1
      .map((uid) => byUid.get(uid))
      .filter((card): card is CardRef => card !== undefined);
    const year2 = cardUids
      .map((uid) => byUid.get(uid))
      .filter((card): card is CardRef => card !== undefined);
    const year3 = me.drafted.filter((card) => !allUids.has(card.u));
    players = state.players.map((player) =>
      player.seat === seat
        ? {
            ...player,
            organizeYear2: [...cardUids],
            hand: year1,
            library2: year2,
            library3: year3,
            organizeDone: true,
          }
        : player,
    );
    log = pushLog(log, 'organize', `${seatName(seat)} 完成组牌`);
    events.push({ type: 'organize_complete', seat });
  }

  let next: SeasonsState = { ...state, players, log };
  if (next.players.every((player) => player.organizeDone)) {
    next = startTournament(next);
    events.push({ type: 'tournament_start' });
  }
  return { ok: true, state: next, events };
}

function organizeReset(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase !== 'organize') return fail('bad_phase', '当前不是组牌阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (me.organizeDone) return fail('organize_done', '你已完成组牌，不能撤回');
  const players = state.players.map((player) =>
    player.seat === seat
      ? { ...player, organizeYear1: [], organizeYear2: [] }
      : player,
  );
  return { ok: true, state: { ...state, players }, events: [{ type: 'organize_reset', seat }] };
}

/** 场上是否有「恶意之骰」这类可重掷骰子的能力。 */
function dieRerollOf(player: SeasonsPlayerState): { crystals: number; name: string } | null {
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def) continue;
    const abilities = abilitiesOf(def, 'dice_reroll');
    const ability = abilities[0];
    if (!ability) continue;
    return {
      crystals: typeof ability.crystals === 'number' ? ability.crystals : 2,
      name: def.nameZh,
    };
  }
  return null;
}

/** 玩家开始行动：先问是否用「恶意之骰」重掷，再结算骰面奖励。 */
function beginTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  const player = state.players[seat];
  const reroll = player ? dieRerollOf(player) : null;
  if (!reroll) return { ok: true, state: resolveDieRewards(state, seat), events: [] };
  return {
    ok: true,
    state: {
      ...state,
      pendingChoice: {
        kind: 'branch',
        key: 'die_of_malice',
        choosingSeat: seat,
        options: {
          title: `${reroll.name}：是否重掷本回合的骰子？`,
          crystals: reroll.crystals,
          branches: [
            { id: 'normal', label: '正常结算骰面' },
            { id: 'alternative', label: `重掷骰子并得 ${reroll.crystals} 水晶` },
          ],
        },
      },
    },
    events: [],
  };
}

/** 行动阶段开始：结算该玩家骰面奖励（旧引擎 resolveDieEffects 的简化版）。 */
function resolveDieRewards(state: SeasonsState, seat: number): SeasonsState {
  const die = state.season?.dice.find((item) => item.pickedBy === seat);
  if (!die) return state;
  // 与旧引擎一致：每回合开始先失去转换能力，只有骰面奖励能重新给。
  let next = patchPlayer(state, seat, () => ({ canTransmute: false }));
  const parts: string[] = [];
  const me = (): SeasonsPlayerState => next.players[seat] as SeasonsPlayerState;

  if (die.rewards.summon) {
    next = patchPlayer(next, seat, (player) => ({ gauge: player.gauge + 1 }));
    parts.push('召唤等级+1');
  }
  if (die.rewards.crystals) {
    next = patchPlayer(next, seat, (player) => ({
      crystals: player.crystals + (die.rewards.crystals ?? 0),
    }));
    parts.push(`💎${die.rewards.crystals}`);
  }
  if (die.rewards.card) {
    const count = me().badgeDrawUpgrade ? 2 : 1;
    const drawn: CardRef[] = [];
    for (let i = 0; i < count; i++) {
      const [drawnState, card] = drawOne(next);
      next = drawnState;
      if (card) drawn.push(card);
    }
    if (drawn.length > 0) {
      if (count > 1 && drawn.length === 2) {
        // 徽章 4 的永久升级：摸 2 选 1，等待 badge-keep。
        next = patchPlayer(next, seat, () => ({ badgeDraw: drawn }));
        parts.push('抽卡×2（选 1 保留）');
      } else {
        next = patchPlayer(next, seat, (player) => ({ hand: [...player.hand, ...drawn] }));
        const name = cardById(drawn[0]?.i ?? -1)?.nameZh ?? '?';
        parts.push(`抽卡「${name}」`);
      }
    }
  }
  if (die.rewards.transmute) {
    next = patchPlayer(next, seat, () => ({ canTransmute: true }));
    parts.push('获得转换能力');
  }

  const incoming = {
    water: die.rewards.water,
    air: die.rewards.air,
    fire: die.rewards.fire,
    earth: die.rewards.earth,
  };
  const incomingTotal = ELEMENTS.reduce((sum, element) => sum + (incoming[element] ?? 0), 0);
  if (incomingTotal > 0) {
    const now = me();
    const room = Math.max(0, now.maxEnergy - reserveTotal(now));
    if (incomingTotal <= room) {
      const before = energySum(now.energies);
      next = patchPlayer(next, seat, (player) => ({
        energies: addEnergyCapped(player.energies, incoming, player.maxEnergy),
      }));
      const added = energySum(me().energies) - before;
      parts.push(added > 0 ? `能量+${added}` : '能量已满');
    } else {
      // 与旧引擎一致：装不下时让玩家在「当前储备 + 新获得」里挑，总量保持上限。
      next = queueChoice(next, {
        kind: 'energy_swap',
        key: 'energy_swap',
        choosingSeat: seat,
        options: {
          title: `储备区将超上限 — 骰子奖励 ${incomingTotal} 个能量，从 ${
            reserveTotal(now) + incomingTotal
          } 个中保留 ${now.maxEnergy} 个`,
          amount: incomingTotal,
          total: now.maxEnergy,
          pool: reserveTotal(now) + incomingTotal,
          current: { ...now.energies },
          incoming,
        },
      });
      parts.push(`能量${incomingTotal}（储备区将超上限，待分配）`);
    }
  }

  return {
    ...next,
    log: pushLog(
      next.log,
      'effect',
      `${seatName(seat)} 行动·骰子效果（点数 ${die.pip}）→ ${parts.join('，') || '无奖励'}`,
    ),
  };
}

/** 选骰：按 currentPicker 顺序挑选当月的骰子。 */
function draftDice(
  state: SeasonsState,
  seat: number,
  dieIndex: number,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('bad_phase', '现在不是对局阶段');
  if (state.pendingChoice) return fail('pending_choice', '请先完成当前选择');
  if (state.turnOwner !== null) return fail('action_phase', '还有玩家在行动中');
  if (state.currentPicker !== seat) return fail('not_your_turn', '还没轮到你选骰子');

  const season = state.season;
  if (!season) return fail('bad_state', '本月骰子尚未掷出');
  const die = season.dice[dieIndex];
  if (!die) return fail('invalid_die', '无效的骰子');
  if (die.pickedBy !== null) return fail('die_taken', '这颗骰子已被选走');

  const dice = season.dice.map((item, index) =>
    index === dieIndex ? { ...item, pickedBy: seat } : item,
  );
  const dicePicked = [...state.dicePicked, seat];
  const events: GameEvent[] = [
    { type: 'draft_dice', seat, dieIndex, pip: die.pip },
  ];

  let next: SeasonsState = {
    ...state,
    season: { ...season, dice },
    dicePicked,
    log: pushLog(
      state.log,
      'effect',
      `${seatName(seat)} 选定骰子（点数 ${die.pip}）`,
    ),
  };

  if (dicePicked.length >= state.players.length) {
    const first = dicePicked[0] ?? state.startPlayer;
    next = { ...next, currentPicker: first, turnOwner: first, pickedThisSeason: [] };
    events.push({ type: 'action_phase', seat: first });
    // 行动阶段开始：先结算首位玩家骰面奖励（可能先问恶意之骰重掷）；其余玩家在 end-turn 时结算。
    const begun = beginTurn(next, first);
    if (!begun.ok) return begun;
    next = begun.state;
  } else {
    next = { ...next, currentPicker: (seat + 1) % state.players.length };
  }

  return { ok: true, state: next, events };
}

/** 召唤一张手牌：校验召唤等级/费用，扣能量与水晶，进入场上。 */
/** 召唤时的被动能力：春之杖（水晶）与对手的奥术水蛭。 */
function applyPassiveSummonEffects(state: SeasonsState, seat: number): SeasonsState {
  let next = state;
  const me = state.players[seat];
  if (!me) return state;

  let crystalsGain = 0;
  for (const card of me.played) {
    const def = cardById(card.i);
    if (def) crystalsGain += abilityAmount(def, 'on_summon_crystal');
  }
  if (crystalsGain > 0) {
    next = patchPlayer(next, seat, (player) => ({
      crystals: player.crystals + crystalsGain,
    }));
    next = {
      ...next,
      log: pushLog(next.log, 'effect', `春之杖：水晶 +${crystalsGain}`),
    };
  }

  // 扩展包「对手召唤时」奖励（皇家书记官等）：按 triggerKind 过滤。
  const extraDraws: number[] = [];
  const withRewards = next.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      const effect = cardById(card.i)?.effect;
      if (!effect || (effect.typeKey ?? effect.type) !== 'opponent_action_reward') continue;
      if (effect.triggerKind && effect.triggerKind !== 'opponent_summon') continue;
      if (effect.crystals) crystals += effect.crystals;
      if (effect.draw) extraDraws.push(player.seat);
    }
    return crystals === player.crystals ? player : { ...player, crystals };
  });
  const crystalsChanged = withRewards.some((player, index) => player !== next.players[index]);
  if (crystalsChanged || extraDraws.length > 0) {
    next = { ...next, players: withRewards };
    if (crystalsChanged) {
      next = { ...next, log: pushLog(next.log, 'effect', '对手召唤奖励：水晶已结算') };
    }
  }
  for (const ownerSeat of extraDraws) {
    const [drawnState, drawn] = drawOne(next);
    next = drawnState;
    if (drawn) {
      next = patchPlayer(next, ownerSeat, (player) => ({ hand: [...player.hand, drawn] }));
      next = { ...next, log: pushLog(next.log, 'effect', '对手召唤奖励：抽 1 张牌') };
    }
  }

  let summonerCrystals = next.players[seat]?.crystals ?? 0;
  let stolen = 0;
  const players = next.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      const def = cardById(card.i);
      if (!def?.effect) continue;
      if ((def.effect.typeKey ?? def.effect.type) !== 'arcano_leech') continue;
      if (summonerCrystals <= 0) continue;
      summonerCrystals -= 1;
      crystals += 1;
      stolen += 1;
    }
    return crystals === player.crystals ? player : { ...player, crystals };
  });
  if (stolen > 0) {
    next = {
      ...next,
      players: players.map((player) =>
        player.seat === seat ? { ...player, crystals: summonerCrystals } : player,
      ),
      log: pushLog(next.log, 'effect', `奥术水蛭：对手获得 ${stolen} 水晶`),
    };
  }
  return next;
}

/** 场上永久卡提供的召唤费用减免总量（幸运之手等）。 */
function costReductionOf(me: SeasonsPlayerState): number {
  return me.played.reduce((sum, item) => {
    const def = cardById(item.i);
    if (!def) return sum;
    return (
      sum +
      abilitiesOf(def, 'cost_reduction').reduce(
        (inner, ability) => inner + (ability.amount ?? 0),
        0,
      )
    );
  }, 0);
}

/** 按当前能量/水晶还差多少点能量才能支付；水晶不够视为付不起。 */
function energyGap(player: SeasonsPlayerState, cost: SeasonsCardCost): number {
  if ((cost.crystal ?? 0) > player.crystals) return Number.POSITIVE_INFINITY;
  return ELEMENTS.reduce(
    (sum, element) => sum + Math.max(0, (cost[element] ?? 0) - reserveElementCount(player, element)),
    0,
  );
}

/** 是否存在某种减费分配，能让这张牌真的付得起。 */
function affordableAfterReduction(
  player: SeasonsPlayerState,
  cost: SeasonsCardCost,
  reducible: number,
): boolean {
  if ((cost.crystal ?? 0) > player.crystals) return false;
  const elements = ELEMENTS.filter((element) => (cost[element] ?? 0) > 0);
  let found = false;
  const walk = (index: number, left: number, reduced: Partial<Record<Element, number>>) => {
    if (found) return;
    if (index === elements.length) {
      const test: SeasonsCardCost = { ...cost };
      for (const element of elements) {
        test[element] = (cost[element] ?? 0) - (reduced[element] ?? 0);
      }
      if (
        test.crystal <= player.crystals &&
        ELEMENTS.every((element) => reserveElementCount(player, element) >= (test[element] ?? 0))
      ) {
        found = true;
      }
      return;
    }
    const element = elements[index]!;
    const cap = Math.min(cost[element] ?? 0, left);
    for (let take = 0; take <= cap; take += 1) {
      walk(index + 1, left - take, { ...reduced, [element]: take });
      if (found) return;
    }
  };
  walk(0, reducible, {});
  return found;
}

function summon(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  paidElements: Element[] | undefined,
  costOverride?: Partial<Record<Element, number>>,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('bad_phase', '现在不是对局阶段');
  if (state.pendingChoice) return fail('pending_choice', '请先完成当前选择');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');

  const index = me.hand.findIndex((card) => card.u === cardUid);
  const card = me.hand[index];
  if (!card) return fail('card_not_in_hand', '所选牌不在手牌中');
  if (me.gauge <= me.played.length) {
    return fail('gauge_low', '召唤等级必须大于已打出的卡牌数');
  }
  const def = cardById(card.i);
  if (!def) return fail('unknown_card', '未知卡牌');

  let cost = resolveCost(def, state.players.length);
  if (costOverride) {
    cost = { ...cost, ...costOverride };
  } else if (!def.costFlexible) {
    // 幸运之手等：费用减 N 个任意能量，总能量费用不低于 1；只有一种可减元素时自动减。
    const reducible = Math.min(
      costReductionOf(me),
      Math.max(0, energySum(cost) - 1),
    );
    if (reducible > 0) {
      // 减费只能「帮到」本来差一点的能量；差得比可减量还多时直接判付不起，
      // 不弹一个注定 cant_afford 的选择。
      const gap = energyGap(me, cost);
      if (
        !Number.isFinite(gap) ||
        reducible < gap ||
        !affordableAfterReduction(me, cost, reducible)
      ) {
        return fail('cant_afford', '能量或水晶不足');
      }
      const elements = ELEMENTS.filter((element) => (cost[element] ?? 0) > 0);
      const only = elements.length <= 1 ? elements[0] : undefined;
      if (only) {
        cost = { ...cost, [only]: cost[only] - reducible };
      } else {
        return {
          ok: true,
          state: {
            ...state,
            pendingChoice: {
              kind: 'element_alloc',
              key: 'cost_reduce',
              choosingSeat: seat,
              options: {
                title: `选择费用减 ${reducible} 个能量（总费用不低于 1）`,
                amount: reducible,
                maxPerElement: Object.fromEntries(
                  elements.map((element) => [element, cost[element]]),
                ),
                label: '减免',
                then: 'summon_cost',
                cardUid,
                paidElements: paidElements ?? [],
                cost,
              },
            },
          },
          events: [],
        };
      }
    }
  }
  // 储备区与 reserve_slot 卡上的能量视为同一池（用户确认的语义）：
  // 召唤费用、减费、激活费用都从这里扣，先扣储备区、再扣卡上。
  let payer: SeasonsPlayerState = me;
  let paid: Element[] | undefined;

  if (def.costFlexible) {
    const flex = def.costFlexible;
    const max = Math.min(flex.max || 4, ELEMENTS.length);
    const min = Math.max(flex.min || 1, 1);
    const chosen = paidElements ?? [];
    if (chosen.length < min || chosen.length > max) {
      return fail('flex_cost_count', `本卡需支付 ${min}~${max} 种能量`);
    }
    if (new Set(chosen).size !== chosen.length) {
      return fail('flex_cost_duplicate', '每种能量最多支付 1 个');
    }
    const maxPer = flex.maxPerType || 1;
    const counts: Partial<Record<Element, number>> = {};
    for (const element of chosen) counts[element] = (counts[element] ?? 0) + 1;
    for (const element of ELEMENTS) {
      if ((counts[element] ?? 0) > maxPer) {
        return fail('flex_cost_duplicate', '每种能量支付数量超出上限');
      }
      if (chosen.includes(element) && reserveElementCount(payer, element) < 1) {
        return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      }
    }
    for (const element of chosen) {
      const after = takeElementEnergy(payer, element, 1);
      if (!after) return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      payer = after;
    }
    paid = [...chosen];
  } else {
    for (const element of ELEMENTS) {
      if (reserveElementCount(payer, element) < (cost[element] ?? 0)) {
        return fail('cant_afford', '能量或水晶不足');
      }
    }
    if (payer.crystals < cost.crystal) {
      return fail('cant_afford', '能量或水晶不足');
    }
    for (const element of ELEMENTS) {
      const need = cost[element] ?? 0;
      if (need <= 0) continue;
      const after = takeElementEnergy(payer, element, need);
      if (!after) return fail('cant_afford', '能量或水晶不足');
      payer = after;
    }
    payer = { ...payer, crystals: payer.crystals - cost.crystal };
  }

  // 储备上限：max_energy_plus 叠加，max_energy 直接设定（后者优先）。
  let maxEnergy = me.maxEnergy + abilityAmount(def, 'max_energy_plus');
  if (def.effect?.type === 'max_energy' && typeof def.effect.amount === 'number') {
    maxEnergy = def.effect.amount;
  }

  // 需要弹窗的召唤效果：已接入的进入 pendingChoice；未接入的在扣费前拒绝。
  const summonChoice = summonChoiceFor(def, paid ?? [], state, seat);
  if (summonChoice === 'unimplemented') {
    return fail(
      'effect_not_implemented',
      `「${def.nameZh}」的召唤效果需要选择，尚未实现（T2.2b-2）`,
    );
  }

  const playedCard: CardInstance = { i: card.i, u: card.u };
  if (paid) playedCard.paid = paid;

  const players = state.players.map((player) =>
    player.seat === seat
      ? {
          ...payer,
          hand: payer.hand.filter((item) => item.u !== card.u),
          played: [...payer.played, playedCard],
          maxEnergy,
        }
      : player,
  );

  let next: SeasonsState = { ...state, players };
  // 召唤时效果（旧引擎 applyOnSummon）；先结算效果，再记召唤日志，保持日志顺序。
  next = runSummonEffect(next, seat, playedCard);
  next = applyPassiveSummonEffects(next, seat);
  if (summonChoice) {
    const options: Record<string, unknown> = { ...summonChoice, cardUid: card.u };
    let pendingCards: CardRef[] | null = null;
    const drawCount =
      typeof summonChoice.draw === 'number'
        ? summonChoice.draw
        : summonChoice.kind === 'card_list'
          ? (summonChoice.amount ?? 0)
          : 0;
    if (drawCount > 0) {
      // 抽到的牌先放进私有的 pendingCards，视图只对选择者展开。
      const drawn: CardRef[] = [];
      for (let i = 0; i < drawCount; i += 1) {
        const [drawnState, cardRef] = drawOne(next);
        next = drawnState;
        if (cardRef) drawn.push(cardRef);
      }
      pendingCards = drawn;
    }
    // 抽到的牌不足保留数时没有可选空间：直接全部保留，不挂弹窗。
    const keepCount =
      typeof summonChoice.keep === 'number'
        ? summonChoice.keep
        : summonChoice.kind === 'card_list'
          ? 1
          : 0;
    if (
      summonChoice.kind === 'card_list' &&
      (pendingCards?.length ?? 0) <= keepCount
    ) {
      const drawn = pendingCards ?? [];
      next = {
        ...next,
        players: next.players.map((player) =>
          player.seat === seat ? { ...player, hand: [...player.hand, ...drawn] } : player,
        ),
        pendingCards: null,
        log: pushLog(
          next.log,
          'choice',
          `${seatName(seat)} 抽到的牌不足以舍弃，全部保留`,
        ),
      };
      pendingCards = null;
    } else {
    next = {
      ...next,
      pendingChoice: {
        kind: summonChoice.kind,
        key: summonChoice.key,
        choosingSeat:
          summonChoice.kind === 'multi_player_pick' &&
          Array.isArray(summonChoice.players) &&
          summonChoice.players.length > 0
            ? summonChoice.players[0]!
            : seat,
        options,
      },
      pendingCards,
    };
    }
  }
  next = {
    ...next,
    log: pushLog(next.log, 'summon', `${seatName(seat)} 召唤「${def.nameZh}」`),
  };

  // 「扬被遗忘的花瓶」等永久被动：每次召唤后获得 N 个任意能量（旧引擎 applyPermanentOnSummon，排除本次召唤的牌）。
  const meAfter = next.players[seat];
  if (meAfter) {
    let bonus = 0;
    let source = '';
    for (const item of meAfter.played) {
      if (item.u === playedCard.u) continue;
      const itemDef = cardById(item.i);
      if (!itemDef) continue;
      const amount = abilityAmount(itemDef, 'on_summon_energy');
      if (amount > 0) {
        bonus += amount;
        source = itemDef.nameZh;
      }
    }
    if (bonus > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'on_summon_energy',
        choosingSeat: seat,
        options: {
          title: `「${source}」被动：选择获得 ${bonus} 个能量`,
          amount: bonus,
          target: 'reserve',
          label: '获得',
        },
      });
    }
  }

  return {
    ok: true,
    state: next,
    events: [{ type: 'summon', seat, cardUid: card.u, cardId: card.i }],
  };
}

/* ------------------------------------------------------------------ */
/* 弹窗选择                                                            */
/* ------------------------------------------------------------------ */

function addStoredEnergy(
  card: CardInstance,
  alloc: Record<Element, number>,
): CardInstance {
  const stored: Partial<Record<Element, number>> = { ...(card.stored ?? {}) };
  for (const element of ELEMENTS) {
    const add = alloc[element];
    if (add > 0) stored[element] = (stored[element] ?? 0) + add;
  }
  return { ...card, stored };
}

function resolveElementAlloc(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const amount =
    typeof pending.options.amount === 'number' ? pending.options.amount : 0;
  const target = pending.options.target === 'card' ? 'card' : 'reserve';
  const maxPerElement = pending.options.maxPerElement as
    | Partial<Record<Element, number>>
    | undefined;
  let alloc: Record<Element, number>;
  if (pending.options.allowPartial === true) {
    if (!choice || typeof choice !== 'object') {
      return fail('invalid_choice', '能量分配不合法');
    }
    alloc = { water: 0, air: 0, fire: 0, earth: 0 };
    let total = 0;
    for (const element of ELEMENTS) {
      const raw = (choice as Record<string, unknown>)[element];
      if (raw === undefined) continue;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        return fail('invalid_choice', '能量分配不合法');
      }
      const cap = maxPerElement?.[element] ?? amount;
      if (raw > cap) return fail('choice_over_limit', '超出可复制数量');
      alloc[element] = raw;
      total += raw;
    }
    if (total > amount) return fail('choice_over_limit', '超出可复制数量');
  } else {
    const parsed = parseElementAlloc(choice, amount, maxPerElement);
    if (typeof parsed === 'string') {
      return fail(parsed, '能量分配不合法');
    }
    alloc = parsed;
  }

  // 费用减免（幸运之手）：把选择结果折算成新费用后重跑召唤。
  if (pending.options.then === 'summon_cost' && pending.key === 'cost_reduce') {
    const base = pending.options.cost as Partial<Record<Element, number>> | undefined;
    const cardUid =
      typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
    if (!base || cardUid <= 0) return fail('invalid_choice', '缺少费用减免信息');
    const reduced: Partial<Record<Element, number>> = {};
    for (const element of ELEMENTS) {
      reduced[element] = Math.max(0, (base[element] ?? 0) - alloc[element]);
    }
    const paid = Array.isArray(pending.options.paidElements)
      ? (pending.options.paidElements as Element[])
      : undefined;
    return summon({ ...state, pendingChoice: null }, seat, cardUid, paid, reduced);
  }

  const payMode = pending.options.mode === 'pay';
  let paidPlayer: SeasonsPlayerState | undefined;
  if (payMode) {
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    let paid = me;
    for (const element of ELEMENTS) {
      const count = alloc[element];
      if (count <= 0) continue;
      const after = takeElementEnergy(paid, element, count);
      if (!after) {
        return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      }
      paid = after;
    }
    paidPlayer = paid;
  }

  // 无后续链路的储备能量获取：装不下时同样交给玩家分配（与骰面奖励一致）。
  const gainTotal = ELEMENTS.reduce((sum, element) => sum + alloc[element], 0);
  const swapThen = pending.options.then;
  const swapAfter =
    swapThen === 'discard_pending'
      ? ({ kind: swapThen } as const)
      : undefined;
  if (
    !payMode &&
    target === 'reserve' &&
    (swapThen === undefined || swapAfter !== undefined) &&
    gainTotal > 0
  ) {
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    const room = Math.max(0, me.maxEnergy - reserveTotal(me));
    if (gainTotal > room) {
      let queued: SeasonsState = {
        ...state,
        pendingChoice: null,
        log: pushLog(
          state.log,
          'choice',
          `${seatName(seat)} 选择：获得 ${gainTotal} 个能量（储备区将超上限，待分配）`,
        ),
      };
      if (typeof pending.options.actId === 'string') {
        queued = markActivated(queued, seat, pending.options.actId);
      }
      queued = queueChoice(queued, {
        kind: 'energy_swap',
        key: 'energy_swap',
        choosingSeat: seat,
        options: {
          title: `储备区将超上限 — 获得 ${gainTotal} 个能量，从 ${
            reserveTotal(me) + gainTotal
          } 个中保留 ${me.maxEnergy} 个`,
          amount: gainTotal,
          total: me.maxEnergy,
          pool: reserveTotal(me) + gainTotal,
          current: { ...me.energies },
          incoming: alloc,
          ...(swapAfter ? { after: swapAfter } : {}),
        },
      });
      return { ok: true, state: queued, events: [] };
    }
  }

  const players =
    target === 'card'
      ? state.players.map((player) =>
          player.seat === seat
            ? {
                ...player,
                played: player.played.map((item) =>
                  item.u === pending.options.cardUid
                    ? addStoredEnergy(item, alloc)
                    : item,
                ),
              }
            : player,
        )
      : state.players.map((player) =>
          player.seat === seat
            ? payMode && paidPlayer
              ? paidPlayer
              : {
                  ...player,
                  energies: addEnergyCapped(player.energies, alloc, player.maxEnergy),
                }
            : player,
        );

  const detail =
    ELEMENTS.filter((element) => alloc[element] > 0)
      .map((element) => `${ELEMENT_NAME_ZH[element]}×${alloc[element]}`)
      .join('、') || '无';

  let nextState: SeasonsState = {
    ...state,
    players,
    pendingChoice: null,
    log: pushLog(state.log, 'choice', `${seatName(seat)} 选择：${detail}`),
  };
  if (typeof pending.options.actId === 'string') {
    nextState = markActivated(nextState, seat, pending.options.actId);
  }
  if (pending.options.then === 'pay_energy_reward') {
    const reward = pending.options.reward as
      | {
          crystals?: number;
          energy?: number;
          draw?: number;
          opponentCrystals?: number;
        }
      | undefined;
    let paidState: SeasonsState = nextState;
    const me = paidState.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    if (reward?.crystals) {
      paidState = patchPlayer(paidState, seat, (player) => ({
        crystals: player.crystals + (reward.crystals ?? 0),
      }));
    }
    if (reward?.opponentCrystals) {
      const amount = reward.opponentCrystals;
      paidState = {
        ...paidState,
        players: paidState.players.map((player) =>
          player.seat === seat
            ? player
            : { ...player, crystals: player.crystals - Math.min(amount, player.crystals) },
        ),
      };
    }
    if (reward?.draw) {
      paidState = drawToHand(paidState, seat, reward.draw);
    }
    if (reward?.energy) {
      paidState = queueChoice(paidState, {
        kind: 'element_alloc',
        key: 'pay_energy_reward_energy',
        choosingSeat: seat,
        options: {
          title: `选择获得 ${reward.energy} 个能量`,
          amount: reward.energy,
          target: 'reserve',
          label: '获得',
        },
      });
    }
    paidState = {
      ...paidState,
      log: pushLog(paidState.log, 'effect', `${seatName(seat)} 支付能量并结算激活奖励`),
    };
    return { ok: true, state: paidState, events: [] };
  }
  if (pending.options.then === 'finish_end_turn') {
    return finishEndTurn(nextState, seat);
  }
  if (pending.options.then === 'discard_pending') {
    const dropped = state.pendingCards ?? [];
    return {
      ok: true,
      state: {
        ...nextState,
        pendingCards: null,
        discard: [...nextState.discard, ...dropped],
        log: pushLog(
          nextState.log,
          'effect',
          `弃掉 ${dropped.length} 张牌`,
        ),
      },
      events: [],
    };
  }
  if (pending.options.then === 'free_summon') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    const result = freeSummonCard(nextState, seat, card);
    if (!result.ok) return result;
    return { ok: true, state: result.state, events: result.events };
  }
  return { ok: true, state: nextState, events: [] };
}

function resolveCardList(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const cards = state.pendingCards;
  if (!cards) return fail('no_pending_choice', '当前没有待选择的卡牌');
  const keep = typeof pending.options.keep === 'number' ? pending.options.keep : 1;
  const kept = parseCardList(
    choice,
    cards.map((card) => card.u),
    keep,
  );
  if (typeof kept === 'string') return fail(kept, '卡牌选择不合法');

  const keptSet = new Set(kept);
  const gained = cards.filter((card) => keptSet.has(card.u));
  const dropped = cards.filter((card) => !keptSet.has(card.u));
  const distribute = pending.options.distribute === true || pending.options.distribute === 'choose';
  const opponents = state.players.filter((player) => player.seat !== seat);
  if (distribute && dropped.length > 0 && opponents.length > 0) {
    // 娜莉亚：由召唤者逐张指定每张牌交给哪位对手（每位对手各 1 张）。
    const targets = opponents.map((player) => player.seat);
    let queued: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === seat ? { ...player, hand: [...player.hand, ...gained] } : player,
      ),
      pendingCards: dropped,
      pendingChoice: null,
      log: pushLog(
        state.log,
        'choice',
        `${seatName(seat)} 保留 1 张，开始分配其余 ${dropped.length} 张`,
      ),
    };
    const first = targets[0];
    if (first !== undefined) {
      queued = queueChoice(queued, {
        kind: 'card_pick',
        key: 'naria_distribute',
        choosingSeat: seat,
        options: {
          purpose: 'distribute',
          targets,
          title: `选择交给 ${seatName(first)} 的牌`,
        },
      });
    }
    return { ok: true, state: queued, events: [] };
  }
  const players = state.players.map((player) =>
    player.seat === seat ? { ...player, hand: [...player.hand, ...gained] } : player,
  );
  const names = gained.map((card) => cardById(card.i)?.nameZh ?? `#${card.i}`);
  return {
    ok: true,
    state: {
      ...state,
      players,
      discard: [...state.discard, ...dropped],
      pendingChoice: null,
      pendingCards: null,
      log: pushLog(
        state.log,
        'choice',
        `${seatName(seat)} 保留：${names.join('、') || '无'}`,
      ),
    },
    events: [],
  };
}

function resolveSacrificeCards(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const raw = Array.isArray(choice) ? choice[0] : choice;
  const value =
    typeof raw === 'object' && raw !== null && 'uid' in raw
      ? (raw as { uid?: unknown }).uid
      : raw;
  const uid = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(uid)) return fail('invalid_choice', '请选择一张在场卡');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const fromHandOnly = pending.options.source === 'hand_or_play';
  const inPlay = me.played.find((item) => item.u === uid);
  const inHand = fromHandOnly ? me.hand.find((item) => item.u === uid) : undefined;
  const card = inPlay ?? inHand;
  if (!card) {
    return fail(
      'invalid_choice',
      fromHandOnly ? '这张牌不在手牌或场上' : '这张牌不在场上',
    );
  }

  const chosen = Array.isArray(pending.options.chosen)
    ? (pending.options.chosen as number[])
    : [];
  const remaining =
    typeof pending.options.remaining === 'number'
      ? pending.options.remaining - 1
      : 0;
  const def = cardById(card.i);
  const name = def?.nameZh ?? `#${card.i}`;
  const isNecrotic = pending.options.then === 'necrotic_energy';
  const logLine = isNecrotic
    ? inHand
      ? `死灵匕首：弃掉手牌「${name}」`
      : `死灵匕首：牺牲「${name}」`
    : `龙之头骨：牺牲「${name}」`;
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) => {
      if (player.seat !== seat) return player;
      if (inHand) {
        // 手牌随从只是弃掉：不从场上移除，也不触发离场上限恢复。
        return { ...player, hand: player.hand.filter((item) => item.u !== uid) };
      }
      return cardSacrificed(
        { ...player, played: player.played.filter((item) => item.u !== uid) },
        card,
      );
    }),
    discard: [...state.discard, { i: card.i, u: card.u }],
    log: pushLog(state.log, 'effect', logLine),
  };

  if (remaining > 0) {
    next = {
      ...next,
      pendingChoice: {
        ...pending,
        options: { ...pending.options, remaining, chosen: [...chosen, uid] },
      },
    };
    return { ok: true, state: next, events: [] };
  }

  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? uid);
  if (isNecrotic) {
    // 续接：获得 4 个任意能量（元素分配选择，完成时再标记已激活）。
    next = {
      ...next,
      pendingChoice: {
        kind: 'element_alloc',
        key: 'necrotic_kriss',
        choosingSeat: seat,
        options: {
          amount: 4,
          title: '选择获得 4 个能量',
          label: '获得',
          target: 'reserve',
          actId,
        },
      },
    };
    return { ok: true, state: next, events: [] };
  }
  next = patchPlayer(next, seat, (player) => ({
    crystals: player.crystals + 15,
  }));
  next = markActivated(next, seat, actId);
  next = {
    ...next,
    pendingChoice: null,
    log: pushLog(next.log, 'effect', '龙之头骨：水晶 +15'),
  };
  return { ok: true, state: next, events: [] };
}

function freeSummonCard(
  state: SeasonsState,
  seat: number,
  ref: CardRef,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (!(me.gauge > me.played.length)) {
    return fail('gauge_low', '召唤等级不足，无法免费召唤');
  }
  const def = cardById(ref.i);
  if (!def) return fail('invalid_choice', '未知卡牌');
  const summonChoice = summonChoiceFor(def, [], state, seat);
  if (summonChoice !== null) {
    return fail('effect_not_implemented', `「${def.nameZh}」的召唤效果需要选择`);
  }
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat
        ? { ...player, played: [...player.played, { i: ref.i, u: ref.u }] }
        : player,
    ),
  };
  next = runSummonEffect(next, seat, { i: ref.i, u: ref.u });
  next = applyPassiveSummonEffects(next, seat);
  next = {
    ...next,
    log: pushLog(next.log, 'summon', `${seatName(seat)} 免费召唤「${def.nameZh}」`),
  };
  return { ok: true, state: next, events: [{ type: 'summon', seat, cardUid: ref.u, cardId: ref.i }] };
}

function resolveMonthAdvance(
  state: SeasonsState,
  _seat: number,
  _pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  if (!choice || typeof choice !== 'object') {
    return fail('invalid_choice', '需要选择方向与步数');
  }
  const direction = (choice as { direction?: unknown }).direction;
  const steps = (choice as { steps?: unknown }).steps;
  if (direction !== 'forward' && direction !== 'backward') {
    return fail('invalid_choice', '方向不合法');
  }
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 1 || steps > 3) {
    return fail('invalid_choice', '步数需为 1–3');
  }
  const delta = direction === 'backward' ? -steps : steps;
  const next = advanceMonth(
    { ...state, pendingChoice: null, pendingCards: null },
    delta,
  );
  return { ok: true, state: next, events: [] };
}

function resolveMultiPlayerPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const queue = Array.isArray(pending.options.players)
    ? (pending.options.players as number[])
    : [];
  if (queue.length === 0) return fail('invalid_choice', '没有待选择的玩家');
  const current = queue[0];
  if (current !== seat) return fail('not_your_choice', '还没轮到你选择');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const card = me.played.find((item) => item.u === uid);
  if (!card) return fail('invalid_choice', '无效的卡牌');
  const purpose = pending.options.purpose;
  const def = cardById(card.i);
  let player: SeasonsPlayerState;
  let detail: string;
  if (purpose === 'return') {
    if (def?.type !== 'magic_item') {
      return fail('invalid_choice', '只能收回魔法物品');
    }
    player = cardLeavingPlay(
      {
        ...me,
        played: me.played.filter((item) => item.u !== uid),
        hand: [...me.hand, { i: card.i, u: card.u }],
      },
      card,
    );
    detail = `${seatName(seat)} 收回「${def?.nameZh ?? card.i}」`;
  } else if (purpose === 'sacrifice') {
    player = cardSacrificed(
      { ...me, played: me.played.filter((item) => item.u !== uid) },
      card,
    );
    detail = `${seatName(seat)} 牺牲「${def?.nameZh ?? card.i}」`;
  } else {
    return fail('invalid_choice', '选择类型不合法');
  }

  let next: SeasonsState = {
    ...state,
    players: state.players.map((item) => (item.seat === seat ? player : item)),
    discard:
      purpose === 'sacrifice' ? [...state.discard, card] : state.discard,
    log: pushLog(state.log, 'effect', detail),
  };

  const rest = queue.slice(1);
  if (rest.length > 0) {
    next = {
      ...next,
      pendingChoice: {
        ...pending,
        choosingSeat: rest[0]!,
        options: { ...pending.options, players: rest },
      },
    };
    return { ok: true, state: next, events: [] };
  }
  next = { ...next, pendingChoice: null };
  if (typeof pending.options.actId === 'string') {
    next = markActivated(next, seat, pending.options.actId);
  }
  return { ok: true, state: next, events: [] };
}

/** 元素护符（风）：从自己手牌里弃 1 张。 */
function resolveHandDiscard(
  state: SeasonsState,
  seat: number,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const picked = me.hand.find((card) => card.u === uid);
  if (!picked) return fail('invalid_choice', '无效的卡牌');
  return {
    ok: true,
    state: {
      ...state,
      players: state.players.map((player) =>
        player.seat === seat
          ? { ...player, hand: player.hand.filter((card) => card.u !== uid) }
          : player,
      ),
      pendingChoice: null,
      pendingCards: null,
      discard: [...state.discard, picked],
      log: pushLog(state.log, 'effect', `${seatName(seat)} 弃掉 1 张手牌（元素护符·风）`),
    },
    events: [],
  };
}

function resolveCardPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  if (pending.options.purpose === 'discard') {
    return resolveHandDiscard(state, seat, choice);
  }
  if (pending.options.purpose === 'distribute') {
    const remaining = state.pendingCards ?? [];
    if (remaining.length === 0) return fail('no_pending_choice', '当前没有待分配的卡牌');
    const targets = Array.isArray(pending.options.targets)
      ? (pending.options.targets as number[])
      : [];
    const target = targets[0];
    if (target === undefined) return fail('invalid_choice', '缺少分配目标');
    const rawUid =
      typeof choice === 'number'
        ? choice
        : choice && typeof choice === 'object' && 'uid' in choice
          ? (choice as { uid?: unknown }).uid
          : Array.isArray(choice)
            ? choice[0]
            : undefined;
    const uid = typeof rawUid === 'number' ? rawUid : NaN;
    const picked = remaining.find((card) => card.u === uid);
    if (!picked) return fail('invalid_choice', '无效的卡牌');
    const rest = remaining.filter((card) => card.u !== uid);
    let next: SeasonsState = {
      ...state,
      players: state.players.map((player) =>
        player.seat === target ? { ...player, hand: [...player.hand, picked] } : player,
      ),
      pendingCards: rest.length > 0 ? rest : null,
      pendingChoice: null,
      log: pushLog(
        state.log,
        'choice',
        `${seatName(seat)} 把「${cardById(picked.i)?.nameZh ?? picked.i}」交给 ${seatName(target)}`,
      ),
    };
    const nextTarget = targets[1];
    if (nextTarget !== undefined && rest.length > 0) {
      next = queueChoice(next, {
        kind: 'card_pick',
        key: 'naria_distribute',
        choosingSeat: seat,
        options: {
          purpose: 'distribute',
          targets: targets.slice(1),
          title: `选择交给 ${seatName(nextTarget)} 的牌`,
        },
      });
    }
    return { ok: true, state: next, events: [] };
  }
  const cards = state.pendingCards;
  if (!cards) return fail('no_pending_choice', '当前没有待选择的卡牌');
  const raw =
    typeof choice === 'number'
      ? choice
      : choice && typeof choice === 'object' && 'uid' in choice
        ? (choice as { uid?: unknown }).uid
        : Array.isArray(choice)
          ? choice[0]
          : undefined;
  const uid = typeof raw === 'number' ? raw : NaN;
  const picked = cards.find((card) => card.u === uid);
  if (!picked) return fail('invalid_choice', '无效的卡牌');

  const rest = cards.filter((card) => card.u !== uid);
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat
        ? { ...player, hand: player.hand.filter((card) => card.u !== uid) }
        : player,
    ),
    pendingCards: null,
    pendingChoice: null,
    discard:
      pending.options.discardRest === true
        ? [...state.discard, ...rest]
        : state.discard,
    log: pushLog(state.log, 'choice', `${seatName(seat)} 选择免费召唤一张手牌`),
  };
  if (typeof pending.options.actId === 'string') {
    next = markActivated(next, seat, pending.options.actId);
  }
  const result = freeSummonCard(next, seat, picked);
  return result;
}

function resolveBranch(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const raw =
    typeof choice === 'string'
      ? choice
      : choice && typeof choice === 'object' && 'id' in choice
        ? (choice as { id?: unknown }).id
        : undefined;
  const id = typeof raw === 'string' ? raw : '';
  const branches = Array.isArray(pending.options.branches)
    ? (pending.options.branches as { id: string; enabled?: boolean }[])
    : [];
  const branch = branches.find((item) => item.id === id);
  if (!branch) return fail('invalid_choice', '无效的选项');
  if (branch.enabled === false) return fail('invalid_choice', '该选项当前不可用');

  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? '');

  if (pending.key === 'vampiric_crown') {
    const top = pending.options.card as CardRef | undefined;
    if (!top) return fail('invalid_choice', '缺少牌堆顶信息');
    if (id !== 'draw' && id !== 'discard') return fail('invalid_choice', '无效的选项');
    const points = typeof pending.options.points === 'number' ? pending.options.points : 0;
    const toHand = id === 'draw';
    let next: SeasonsState = {
      ...state,
      deck: state.deck.filter((card) => card.u !== top.u),
      pendingChoice: null,
      discard: toHand ? state.discard : [...state.discard, top],
      players: toHand
        ? state.players.map((player) =>
            player.seat === seat ? { ...player, hand: [...player.hand, top] } : player,
          )
        : state.players,
      log: pushLog(
        state.log,
        'effect',
        `${seatName(seat)} 吸血鬼王冠：${toHand ? '抽入手牌' : '弃掉'}「${
          cardById(top.i)?.nameZh ?? top.i
        }」`,
      ),
    };
    if (points > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'vampiric_crown_energy',
        choosingSeat: seat,
        options: {
          title: `吸血鬼王冠：选择获得 ${points} 个能量`,
          amount: points,
          target: 'reserve',
          label: '获得',
        },
      });
    }
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'die_of_malice') {
    const player = state.players[seat];
    if (!player) return fail('bad_seat', '座位不存在');
    if (id === 'normal') {
      return {
        ok: true,
        state: resolveDieRewards({ ...state, pendingChoice: null }, seat),
        events: [],
      };
    }
    if (id !== 'alternative') return fail('invalid_choice', '无效的选项');
    const season = state.season;
    if (!season) return fail('invalid_choice', '没有可重掷的骰子');
    const seasonElement = SEASONS[season.index]?.element;
    if (!seasonElement) return fail('invalid_choice', '没有可重掷的骰子');
    const dieDef = DICE_BY_ELEMENT[seasonElement].find(
      (item) => item.id === season.dice.find((die) => die.pickedBy === seat)?.id,
    );
    const current = season.dice.find((die) => die.pickedBy === seat);
    if (!dieDef || !current) return fail('invalid_choice', '没有可重掷的骰子');
    const [faceIndex, rngState] = randInt(state, dieDef.faces.length);
    const face = dieDef.faces[faceIndex];
    if (!face) return fail('invalid_choice', '骰面数据异常');
    const dice = season.dice.map((die) =>
      die.pickedBy === seat
        ? { ...die, face: face.roll, pip: face.pip, rewards: face.rewards }
        : die,
    );
    const crystals = typeof pending.options.crystals === 'number' ? pending.options.crystals : 2;
    let next: SeasonsState = {
      ...state,
      ...rngState,
      season: { ...season, dice },
      pendingChoice: null,
    };
    next = patchPlayer(next, seat, (item) => ({ crystals: item.crystals + crystals }));
    next = {
      ...next,
      log: pushLog(
        next.log,
        'effect',
        `${seatName(seat)} 使用「恶意之骰」：重掷骰子（${face.pip} 点）+ 水晶 ${crystals}`,
      ),
    };
    return { ok: true, state: resolveDieRewards(next, seat), events: [] };
  }

  if (pending.key === 'mirror_of_seasons') {
    const step = typeof pending.options.step === 'string' ? pending.options.step : '';
    const actId =
      typeof pending.options.actId === 'string' ? pending.options.actId : '';
    const me = state.players[seat];
    if (!me) return fail('bad_seat', '座位不存在');
    if (step === 'source') {
      const element = id as Element;
      if (!ELEMENTS.includes(element)) return fail('invalid_choice', '未知能量类型');
      const count =
        (me.energies[element] ?? 0) +
        me.played.reduce((sum, item) => sum + (item.stored?.[element] ?? 0), 0);
      const maxX = Math.min(me.crystals, count);
      if (maxX < 1) return fail('energy_low', '能量或水晶不足');
      const proceed = (amount: number): ReduceResult<SeasonsState> => ({
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'target',
              source: element,
              amount,
              title: '四季之镜 — 选择目标能量类型',
              branches: ELEMENTS.filter((item) => item !== element).map((item) => ({
                id: item,
                label: `转为${ELEMENT_NAME_ZH[item]}能量`,
              })),
              actId,
            },
          },
        },
        events: [],
      });
      if (maxX === 1) return proceed(1);
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'amount',
              source: element,
              max: maxX,
              title: '四季之镜 — 选择转换数量',
              branches: Array.from({ length: maxX }, (_, index) => ({
                id: String(index + 1),
                label: `转换 ${index + 1} 个（付 ${index + 1} 水晶）`,
              })),
              actId,
            },
          },
        },
        events: [],
      };
    }
    if (step === 'amount') {
      const source = pending.options.source as Element;
      const amount = Number(id);
      const max = typeof pending.options.max === 'number' ? pending.options.max : 0;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) {
        return fail('invalid_choice', '转换数量不合法');
      }
      return {
        ok: true,
        state: {
          ...state,
          pendingChoice: {
            kind: 'branch',
            key: 'mirror_of_seasons',
            choosingSeat: seat,
            options: {
              step: 'target',
              source,
              amount,
              title: '四季之镜 — 选择目标能量类型',
              branches: ELEMENTS.filter((item) => item !== source).map((item) => ({
                id: item,
                label: `转为${ELEMENT_NAME_ZH[item]}能量`,
              })),
              actId,
            },
          },
        },
        events: [],
      };
    }
    if (step === 'target') {
      const source = pending.options.source as Element;
      const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
      const target = id as Element;
      if (!ELEMENTS.includes(target) || target === source) {
        return fail('invalid_choice', '目标能量类型不合法');
      }
      let player = me;
      const after = takeElementEnergy(player, source, amount);
      if (!after) return fail('energy_low', '能量不足');
      player = after;
      player = {
        ...player,
        crystals: player.crystals - amount,
        energies: addEnergyCapped(player.energies, { [target]: amount }, player.maxEnergy),
      };
      let next: SeasonsState = {
        ...state,
        players: state.players.map((item) => (item.seat === seat ? player : item)),
        pendingChoice: null,
        log: pushLog(
          state.log,
          'effect',
          `四季之镜：${ELEMENT_NAME_ZH[source]}×${amount} → ${ELEMENT_NAME_ZH[target]}×${amount}`,
        ),
      };
      next = markActivated(next, seat, actId);
      return { ok: true, state: next, events: [] };
    }
    return fail('invalid_choice', '四季之镜状态异常');
  }

  if (pending.key === 'crystal_orb' && id === 'keep') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    let next: SeasonsState = {
      ...state,
      deck: [...state.deck, card],
      pendingChoice: null,
      log: pushLog(state.log, 'effect', '水晶球：把牌堆顶放回'),
    };
    next = markActivated(next, seat, actId);
    return { ok: true, state: next, events: [] };
  }

  if (pending.key === 'crystal_orb' && id === 'summon') {
    const card = pending.options.card as CardRef | undefined;
    if (!card) return fail('invalid_choice', '缺少牌堆顶信息');
    return {
      ok: true,
      state: {
        ...state,
        pendingChoice: {
          kind: 'element_alloc',
          key: 'crystal_orb',
          choosingSeat: seat,
          options: {
            amount: 4,
            title: '选择弃掉 4 个能量',
            label: '弃掉',
            then: 'free_summon',
            mode: 'pay',
            card,
            actId,
          },
        },
      },
      events: [],
    };
  }

  return fail('not_implemented', '该选项尚未接入');
}

/** 储备区超上限重分配：玩家提交最终保留的各元素数量，总和必须等于上限。 */
function resolveEnergyDiscard(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
  const available = (pending.options.available ?? {}) as Partial<Record<Element, number>>;
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    return fail('invalid_choice', '能量弃置不合法');
  }
  const alloc: Record<Element, number> = { water: 0, air: 0, fire: 0, earth: 0 };
  let total = 0;
  for (const element of ELEMENTS) {
    const raw = (choice as Record<string, unknown>)[element];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return fail('invalid_choice', '能量弃置不合法');
    }
    if (raw > (available[element] ?? 0)) {
      return fail('choice_over_limit', '弃置数量超过可用能量');
    }
    alloc[element] = raw;
    total += raw;
  }
  if (total !== amount) {
    return fail('choice_amount_mismatch', `应弃掉 ${amount} 个能量，实际选择 ${total} 个`);
  }
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  let player = me;
  for (const element of ELEMENTS) {
    const need = alloc[element];
    if (need <= 0) continue;
    const after = takeElementEnergy(player, element, need);
    if (!after) return fail('choice_over_limit', '弃置数量超过可用能量');
    player = after;
  }
  const discarded = ELEMENTS.filter((element) => alloc[element] > 0)
    .map((element) => `${ELEMENT_NAME_ZH[element]}×${alloc[element]}`)
    .join('、');
  const next: SeasonsState = {
    ...state,
    players: state.players.map((item) => (item.seat === seat ? player : item)),
    pendingChoice: null,
    log: pushLog(state.log, 'effect', `${seatName(seat)} 弃掉 ${discarded}`),
  };
  return { ok: true, state: next, events: [] };
}

function resolveEnergySwap(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (!choice || typeof choice !== 'object') return fail('invalid_choice', '能量分配不合法');
  const total = typeof pending.options.total === 'number' ? pending.options.total : me.maxEnergy;
  const alloc: Record<Element, number> = { water: 0, air: 0, fire: 0, earth: 0 };
  let sum = 0;
  for (const element of ELEMENTS) {
    const raw = (choice as Record<string, unknown>)[element];
    if (raw === undefined || raw === 0) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return fail('invalid_choice', '能量分配不合法');
    }
    alloc[element] = raw;
    sum += raw;
  }
  if (sum !== total) {
    return fail('choice_amount_mismatch', `应保留 ${total} 个能量，实际选择 ${sum} 个`);
  }
  const beforeText =
    ELEMENTS.filter((element) => me.energies[element] > 0)
      .map((element) => `${me.energies[element]}${ELEMENT_NAME_ZH[element]}`)
      .join(' ') || '无';
  const afterText =
    ELEMENTS.filter((element) => alloc[element] > 0)
      .map((element) => `${alloc[element]}${ELEMENT_NAME_ZH[element]}`)
      .join(' ') || '无';
  const swapped: SeasonsState = {
    ...patchPlayer(state, seat, (player) => ({ energies: { ...alloc } })),
    pendingChoice: null,
    log: pushLog(state.log, 'effect', `${seatName(seat)} 储备区将超上限，重新分配能量：${beforeText} → ${afterText}`),
  };
  const after = pending.options.after as { kind?: string } | undefined;
  if (after?.kind === 'discard_pending') {
    const dropped = state.pendingCards ?? [];
    return {
      ok: true,
      state: {
        ...swapped,
        pendingCards: null,
        discard: [...swapped.discard, ...dropped],
        log: pushLog(swapped.log, 'effect', `弃掉 ${dropped.length} 张牌`),
      },
      events: [],
    };
  }
  return { ok: true, state: swapped, events: [] };
}

function resolveChoice(
  state: SeasonsState,
  seat: number,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const pending = state.pendingChoice;
  if (!pending) return fail('no_pending_choice', '当前没有待选择的事项');
  if (pending.choosingSeat !== seat) return fail('not_your_choice', '不是你的选择');

  switch (pending.kind) {
    case 'element_alloc':
      return resolveElementAlloc(state, seat, pending, choice);
    case 'card_list':
      return resolveCardList(state, seat, pending, choice);
    case 'card_pick':
      return resolveCardPick(state, seat, pending, choice);
    case 'multi_player_pick':
      return resolveMultiPlayerPick(state, seat, pending, choice);
    case 'month_advance':
      return resolveMonthAdvance(state, seat, pending, choice);
    case 'element_pick':
      return resolveElementPick(state, seat, pending, choice);
    case 'element_multi':
      return resolveElementMulti(state, seat, pending, choice);
    case 'sacrifice_cards':
      return resolveSacrificeCards(state, seat, pending, choice);
    case 'branch':
      return resolveBranch(state, seat, pending, choice);
    case 'energy_discard':
      return finish(state, resolveEnergyDiscard(state, seat, pending, choice));
    case 'energy_swap':
      return resolveEnergySwap(state, seat, pending, choice);
    default:
      return fail('not_implemented', `选择类型 ${pending.kind} 尚未接入`);
  }
}

/* ------------------------------------------------------------------ */
/* 回合内的动作：转换能量                                              */
/* ------------------------------------------------------------------ */

function transmute(
  state: SeasonsState,
  seat: number,
  element: Element,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  if (!me.canTransmute) return fail('no_transmute', '本回合没有转换能力');

  // 储备区与卡上能量（流水护符等）都可用于转换；贪吃锅的封印能量除外。
  const afterPay = takeElementEnergy(me, element, 1);
  if (!afterPay) return fail('energy_low', `没有可用的${ELEMENT_NAME_ZH[element]}能量`);
  const energies = afterPay.energies;
  const played = afterPay.played;

  let bonus = 0;
  for (const card of played) {
    const def = cardById(card.i);
    if (def) bonus += abilityAmount(def, 'transmute_bonus');
  }
  const value = (TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0) + bonus;
  const players = state.players.map((player) =>
    player.seat === seat
      ? { ...player, energies, played, crystals: player.crystals + value }
      : player,
  );
  return {
    ok: true,
    state: {
      ...state,
      players,
      log: pushLog(
        state.log,
        'transmute',
        `${seatName(seat)} 转换 1${ELEMENT_NAME_ZH[element]} → ${value} 水晶${bonus > 0 ? `（加成 +${bonus}）` : ''}`,
      ),
    },
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/* 结束回合 / 月份与年份推进                                           */
/* ------------------------------------------------------------------ */

/** 终局特殊计分（对应旧引擎 card-effects.js 的 score 注册表，返回值是额外水晶）。 */
function scoreEffectCrystals(player: SeasonsPlayerState, players: readonly SeasonsPlayerState[]): number {
  let extra = 0;
  for (const card of player.played) {
    const def = cardById(card.i);
    const effect = def?.effect;
    if (!effect) continue;
    const key = effect.typeKey ?? effect.type;
    if (key === 'ragfields_helm') {
      // 在场牌数严格多于所有对手 → +20
      const mine = player.played.length;
      const opponents = players.filter((other) => other.seat !== player.seat);
      if (opponents.length > 0 && opponents.every((other) => other.played.length < mine)) {
        extra += 20;
      }
    } else if (key === 'score_per_energy') {
      extra += reserveTotal(player) * (effect.amount ?? 0);
    } else if (key === 'sealed_chest') {
      // 场上没有随从 → +20
      const familiars = player.played.filter(
        (owned) => cardById(owned.i)?.type === 'familiar',
      ).length;
      if (familiars === 0) extra += 20;
    }
  }
  return extra;
}

/** 终局计分（水晶 + 卡面分 + 特殊计分 - 手牌与徽章惩罚）。 */
function finishGame(state: SeasonsState): SeasonsState {
  const players: SeasonsPlayerScore[] = state.players.map((player) => {
    const cardPoints = player.played.reduce(
      (total, card) => total + (cardById(card.i)?.points ?? 0),
      0,
    );
    const effectPoints = scoreEffectCrystals(player, state.players);
    const handPenalty = player.hand.length * HAND_PENALTY;
    const badgePenalty = BADGE_PENALTY[player.badgesUsed] ?? 0;
    return {
      seat: player.seat,
      crystals: player.crystals,
      cardPoints,
      effectPoints,
      handSize: player.hand.length,
      handPenalty,
      badgesUsed: player.badgesUsed,
      badgePenalty,
      cardsInPlay: player.played.length,
      energyLeft: energySum(player.energies),
      score: player.crystals + cardPoints + effectPoints - handPenalty - badgePenalty,
    };
  });
  players.sort((a, b) => b.score - a.score);
  const best = players[0];
  const second = players[1];
  const draw = !!best && !!second && best.score === second.score;
  const winner = draw ? null : (best?.seat ?? null);
  return {
    ...state,
    phase: 'ended',
    result: { players, winner, draw },
    log: pushLog(
      state.log,
      'score',
      draw
        ? '终局：平局'
        : `终局：${winner === null ? '?' : seatName(winner)} 获胜（${best?.score ?? 0} 分）`,
    ),
  };
}

/** 有效储备总量：储备区 + 「视为储备」卡（附魔魔典）上的能量。 */
function reserveElementCount(player: SeasonsPlayerState, element: Element): number {
  let total = player.energies[element];
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def || !card.stored) continue;
    if (abilitiesOf(def, 'sealed_energy').length > 0) continue;
    total += card.stored[element] ?? 0;
  }
  return total;
}

function reserveTotal(player: SeasonsPlayerState): number {
  let total = energySum(player.energies);
  for (const card of player.played) {
    const def = cardById(card.i);
    if (!def || !card.stored) continue;
    if (abilitiesOf(def, 'sealed_energy').length > 0) continue;
    total += Object.values(card.stored).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  return total;
}

/** 回合结束效果（T2.4b 起）：目前接 奇迹宝箱 / 深凝视的提图斯。 */
function applyTurnEndEffects(state: SeasonsState, seat: number): SeasonsState {
  const me = state.players[seat];
  if (!me) return state;
  let crystals = me.crystals;
  let players = state.players;
  const logs: string[] = [];
  const sacrificed: number[] = [];
  let energyGain = 0;

  for (const card of me.played) {
    const def = cardById(card.i);
    if (!def?.effect) continue;
    const key = def.effect.typeKey ?? def.effect.type;
    const isTurnEnd = def.effect.triggers.includes('turn_end');
    if (!isTurnEnd) continue;

    if (key === 'wondrous_chest') {
      if (reserveTotal(me) >= 4) {
        crystals += 3;
        logs.push('奇迹宝箱：水晶 +3');
      }
      continue;
    }

    if (key === 'cursed_relic') {
      // 奥尼斯的受诅咒灵魂：每位持有者回合结束失 3 水晶（不足则扣光）。
      const lost = Math.min(3, crystals);
      if (lost > 0) {
        crystals -= lost;
        logs.push('「奥尼斯的受诅咒灵魂」：水晶 -3');
      }
      continue;
    }

    if (key === 'turn_flat_reward') {
      const gain = def.effect.crystals ?? 0;
      if (gain > 0) {
        crystals += gain;
        logs.push(`「${def.nameZh}」：水晶 +${gain}`);
      }
      continue;
    }

    if (key === 'turn_condition_reward') {
      const effect = def.effect;
      let ok = false;
      if (typeof effect.minCards === 'number') ok = me.played.length >= effect.minCards;
      else if (typeof effect.minMagic === 'number') {
        ok = me.played.filter((item) => cardById(item.i)?.type === 'magic_item').length >= effect.minMagic;
      } else if (typeof effect.minFamiliar === 'number') {
        ok = me.played.filter((item) => cardById(item.i)?.type === 'familiar').length >= effect.minFamiliar;
      } else if (typeof effect.maxReserve === 'number') ok = reserveTotal(me) <= effect.maxReserve;
      if (!ok) continue;
      const gainCrystals = effect.crystals ?? 0;
      if (gainCrystals > 0) crystals += gainCrystals;
      if (typeof effect.energy === 'number') energyGain += effect.energy;
      logs.push(
        `「${def.nameZh}」：${[gainCrystals > 0 ? `水晶 +${gainCrystals}` : '', effect.energy ? `能量 +${effect.energy}` : ''].filter(Boolean).join('，')}`,
      );
      continue;
    }

    if (key === 'titus') {
      // 先检查所有对手都能付：只要有一人水晶为 0，就牺牲本卡，且不收任何人的水晶。
      const opponents = players.filter((player) => player.seat !== seat);
      const cannotPay = opponents.some((player) => player.crystals <= 0);
      if (cannotPay) {
        sacrificed.push(card.u);
        logs.push('深凝视的提图斯：有对手无法支付，被牺牲');
      } else {
        players = players.map((player) =>
          player.seat === seat ? player : { ...player, crystals: player.crystals - 1 },
        );
        crystals += opponents.length;
        logs.push('深凝视的提图斯：每位对手给 1 水晶');
      }
    }
  }

  if (crystals === me.crystals && logs.length === 0) return state;
  const played = me.played.filter((card) => !sacrificed.includes(card.u));
  const discarded = me.played.filter((card) => sacrificed.includes(card.u));
  let next: SeasonsState = {
    ...state,
    players: players.map((player) =>
      player.seat === seat
        ? { ...player, crystals, played, activatedThisTurn: [] }
        : player,
    ),
    discard: [...state.discard, ...discarded],
  };
  for (const msg of logs) next = { ...next, log: pushLog(next.log, 'effect', msg) };
  if (energyGain > 0) {
    next = queueChoice(next, {
      kind: 'element_alloc',
      key: 'turn_end_energy',
      choosingSeat: seat,
      options: {
        title: `回合结束：选择获得 ${energyGain} 个能量`,
        amount: energyGain,
        target: 'reserve',
        label: '获得',
      },
    });
  }
  return next;
}

/** 换季效果：贪婪的菲格里姆 / 魔法法师（对手税）、命运小径（抽牌）、时光沙漏（得能量）。 */
function applySeasonChangeEffects(state: SeasonsState): SeasonsState {
  const players = state.players.map((player) => ({
    ...player,
    energies: { ...player.energies },
    played: [...player.played],
  }));
  const logs: string[] = [];
  for (const player of players) {
    for (const card of player.played) {
      const def = cardById(card.i);
      if (!def?.effect) continue;
      const key = def.effect.typeKey ?? def.effect.type;
      const isSeason = def.effect.triggers.includes('season_change');
      if (!isSeason) continue;
      if (key === 'figrim') {
        let gained = 0;
        for (const other of players) {
          if (other.seat === player.seat) continue;
          if (other.crystals > 0) {
            other.crystals -= 1;
            gained += 1;
          }
        }
        player.crystals += gained;
        if (gained > 0) logs.push('贪婪的菲格里姆：每位对手给 1 水晶');
        continue;
      }

      if (key === 'season_opponent_tax') {
        const amount = typeof def.effect.amount === 'number' ? def.effect.amount : 1;
        let gained = 0;
        for (const other of players) {
          if (other.seat === player.seat) continue;
          const lost = Math.min(amount, other.crystals);
          other.crystals -= lost;
          gained += lost;
        }
        player.crystals += gained;
        if (gained > 0) logs.push(`「${def.nameZh}」：每位对手给 ${amount} 水晶`);
        continue;
      }
    }
  }
  let next: SeasonsState = { ...state, players };
  for (const msg of logs) next = { ...next, log: pushLog(next.log, 'effect', msg) };
  // 「命运小径」：换季时抽 N 张牌（按座位顺序）。
  for (const player of players) {
    let drawCount = 0;
    for (const card of player.played) {
      const def = cardById(card.i);
      if (def?.effect?.type !== 'season_draw') continue;
      drawCount += typeof def.effect.amount === 'number' ? def.effect.amount : 1;
    }
    if (drawCount <= 0) continue;
    let hand: CardRef[] = next.players[player.seat]?.hand ?? [];
    for (let index = 0; index < drawCount; index += 1) {
      const [drawnState, drawn] = drawOne(next);
      next = drawnState;
      if (drawn) hand = [...hand, drawn];
    }
    next = {
      ...next,
      players: next.players.map((item) =>
        item.seat === player.seat ? { ...item, hand } : item,
      ),
    };
    next = { ...next, log: pushLog(next.log, 'effect', `「命运小径」：抽 ${drawCount} 张牌`) };
  }
  // 「时光沙漏」：换季时获得 1 个任意能量（每位持有者各自选择，按座位顺序排队）。
  for (const player of players) {
    let amount = 0;
    for (const card of player.played) {
      const def = cardById(card.i);
      if (!def?.effect) continue;
      if (def.effect.type !== 'on_season_change_energy') continue;
      if (typeof def.effect.amount === 'number') amount += def.effect.amount;
    }
    if (amount > 0) {
      next = queueChoice(next, {
        kind: 'element_alloc',
        key: 'on_season_change_energy',
        choosingSeat: player.seat,
        options: {
          title: `「时光沙漏」：选择获得 ${amount} 个能量`,
          amount,
          target: 'reserve',
          label: '获得',
        },
      });
    }
  }
  return next;
}

function advanceMonth(state: SeasonsState, months: number): SeasonsState {
  const oldSeasonIdx = seasonIndexForMonth(state.month);
  let month = state.month + months;
  if (month < 0) month = 0;
  if (month >= TOTAL_MONTHS) return finishGame({ ...state, month: TOTAL_MONTHS });

  let next: SeasonsState = { ...state, month };
  const newYear = Math.floor(month / MONTHS_PER_YEAR) + 1;
  if (newYear > state.year) {
    next = {
      ...next,
      year: newYear,
      players: next.players.map((player) => {
        let hand = player.hand;
        let library2 = player.library2;
        let library3 = player.library3;
        if (newYear === 2 && library2.length > 0) {
          hand = [...hand, ...library2];
          library2 = [];
        }
        if (newYear === 3 && library3.length > 0) {
          hand = [...hand, ...library3];
          library3 = [];
        }
        return { ...player, hand, library2, library3 };
      }),
    };
    next = {
      ...next,
      log: pushLog(next.log, 'season', `第 ${newYear} 年：取回组牌阶段的第 ${newYear} 年手牌`),
    };
  }

  const newSeasonIdx = seasonIndexForMonth(month);
  if (newSeasonIdx !== oldSeasonIdx) {
    next = {
      ...next,
      log: pushLog(
        next.log,
        'season',
        `换季：${SEASONS[oldSeasonIdx]!.nameZh}季 → ${SEASONS[newSeasonIdx]!.nameZh}季`,
      ),
    };
    next = applySeasonChangeEffects(next);
  }
  return startMonth(next);
}

function useBadge(
  state: SeasonsState,
  seat: number,
  action:
    | { type: 'use-badge'; badgeType: 1; fromElements: [Element, Element]; toElements: [Element, Element] }
    | { type: 'use-badge'; badgeType: 2; element: Element }
    | { type: 'use-badge'; badgeType: 3 | 4 },
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const myPick = state.turnOwner === null && state.currentPicker === seat;
  if (state.turnOwner !== seat && !myPick) return fail('not_your_turn', '还没轮到你');
  if (me.badgeDraw) return fail('pending_badge', '请先选择保留的卡牌');
  if (me.badgesUsed >= MAX_BADGES) return fail('badge_used_up', '徽章已用完');

  let player: SeasonsPlayerState = me;
  let message = '';
  if (action.badgeType === 1) {
    const from = action.fromElements;
    const to = action.toElements;
    const fromCount: Partial<Record<Element, number>> = {};
    for (const element of from) fromCount[element] = (fromCount[element] ?? 0) + 1;
    for (const element of ELEMENTS) {
      const needed = fromCount[element] ?? 0;
      if (needed > reserveElementCount(player, element)) {
        return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      }
    }
    for (const element of ELEMENTS) {
      const needed = fromCount[element] ?? 0;
      if (needed === 0) continue;
      const taken = takeElementEnergy(player, element, needed);
      if (!taken) return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
      player = taken;
    }
    const incoming: Partial<Record<Element, number>> = {};
    for (const element of to) incoming[element] = (incoming[element] ?? 0) + 1;
    player = { ...player, energies: addEnergyCapped(player.energies, incoming, player.maxEnergy) };
    const label = (list: readonly Element[]) =>
      list.map((element) => ELEMENT_NAME_ZH[element]).join('+');
    message = `徽章：${label(from)} → ${label(to)}`;
  } else if (action.badgeType === 2) {
    const element = action.element;
    if (reserveElementCount(player, element) < 1) {
      return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
    }
    const taken = takeElementEnergy(player, element, 1);
    if (!taken) return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
    const value = (TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0) + 1;
    player = { ...taken, crystals: taken.crystals + value };
    message = `徽章：1${ELEMENT_NAME_ZH[element]} → ${value} 水晶`;
  } else if (action.badgeType === 3) {
    player = { ...player, gauge: player.gauge + 1 };
    message = '徽章：召唤等级 +1';
  } else {
    player = { ...player, badgeDrawUpgrade: true };
    message = '徽章：抽卡效果永久升级（摸 2 选 1）';
  }

  const next = patchPlayer(state, seat, () => ({
    ...player,
    badgesUsed: player.badgesUsed + 1,
  }));
  return {
    ok: true,
    state: { ...next, log: pushLog(next.log, 'badge', `${seatName(seat)} ${message}`) },
    events: [{ type: 'badge', seat }],
  };
}

function keepBadge(
  state: SeasonsState,
  seat: number,
  cardUid: number,
): ReduceResult<SeasonsState> {
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const pending = me.badgeDraw;
  if (!pending || pending.length !== 2) return fail('no_badge_draw', '没有待选的卡牌');
  const keep = pending.find((card) => card.u === cardUid);
  if (!keep) return fail('card_not_in_hand', '所选牌不在待选中');
  const discard = pending.filter((card) => card.u !== cardUid);
  return {
    ok: true,
    state: {
      ...state,
      discard: [...state.discard, ...discard],
      players: state.players.map((player) =>
        player.seat === seat
          ? { ...player, hand: [...player.hand, keep], badgeDraw: null }
          : player,
      ),
      log: pushLog(
        state.log,
        'badge',
        `${seatName(seat)} 保留「${cardById(keep.i)?.nameZh ?? '?'}」，弃掉「${
          cardById(discard[0]?.i ?? -1)?.nameZh ?? '?'
        }」`,
      ),
    },
    events: [{ type: 'badge-keep', seat }],
  };
}

function endTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');

  const players = state.players.map((player) =>
    player.seat === seat
      ? { ...player, canTransmute: false, activatedThisTurn: [] }
      : player,
  );
  const afterTurnEnd = applyTurnEndEffects(
    { ...state, players },
    seat,
  );

  // 乞丐之角：储备 ≤1 时可获得 1 个能量（选择），结算后继续结束回合。
  const me = afterTurnEnd.players[seat];
  const hasHorn = me?.played.some(
    (card) => cardById(card.i)?.effect?.typeKey === 'beggars_horn',
  );
  if (me && hasHorn && reserveTotal(me) <= 1) {
    return {
      ok: true,
      state: {
        ...afterTurnEnd,
        pendingChoice: {
          kind: 'element_alloc',
          key: 'beggars_horn',
          choosingSeat: seat,
          options: {
            amount: 1,
            target: 'reserve',
            title: '乞丐之角：获得 1 个能量',
            label: '获得',
            then: 'finish_end_turn',
          },
        },
        pendingCards: null,
      },
      events: [],
    };
  }

  return finishEndTurn(afterTurnEnd, seat);
}

/** 结束回合的后半段：轮到下一位，或推进月份。 */
function finishEndTurn(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  const pickedThisSeason = state.pickedThisSeason.includes(seat)
    ? state.pickedThisSeason
    : [...state.pickedThisSeason, seat];
  const nextSeat = state.dicePicked.find((item) => !pickedThisSeason.includes(item));

  if (nextSeat !== undefined) {
    let next: SeasonsState = {
      ...state,
      pickedThisSeason,
      turnOwner: nextSeat,
      currentPicker: nextSeat,
      log: pushLog(state.log, 'effect', `${seatName(seat)} 结束回合`),
    };
    // 下一位玩家开始行动时结算他的骰面奖励（旧引擎 startPlayerAction），可能先问恶意之骰。
    return beginTurn(next, nextSeat);
  }

  // 全员行动完毕：起始玩家顺时针轮转，按剩余骰子的点数推进月份。
  const nextStart = (state.startPlayer + 1) % state.players.length;
  const leftover = state.season?.dice.find((die) => die.pickedBy === null);
  const steps = leftover?.pip ?? 1;
  const advanced = advanceMonth(
    { ...state, pickedThisSeason, startPlayer: nextStart },
    steps,
  );
  return {
    ok: true,
    state: {
      ...advanced,
      log: pushLog(advanced.log, 'effect', `${seatName(seat)} 结束回合，月份前进 ${steps}`),
    },
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/* 认输                                                                */
/* ------------------------------------------------------------------ */

function resign(state: SeasonsState, seat: number): ReduceResult<SeasonsState> {
  if (state.phase === 'ended') return fail('game_over', '这局已经结束了');
  if (state.players.length !== 2) return fail('resign_not_allowed', '多人局不能认输');
  const winner = seat === 0 ? 1 : 0;
  const log = pushLog(state.log, 'score', `${seatName(seat)} 认输`);
  return {
    ok: true,
    state: {
      ...state,
      phase: 'ended',
      resignedSeat: seat,
      // 分数明细由 T2.5 的计分器补齐；认输时只需要胜者。
      result: { players: [], winner, draw: false },
      log,
    },
    events: [
      { type: 'resign', seat },
      { type: 'game_over', winner },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 激活                                                                */
/* ------------------------------------------------------------------ */

type ActivationRequest =
  | {
      kind: 'element_pick' | 'element_alloc' | 'sacrifice_cards' | 'card_pick';
      amount: number;
      title: string;
      label: string;
      source?: 'hand_or_play';
      then?: 'necrotic_energy';
    }
  | {
      kind: 'element_multi';
      elements: { element: Element; count: number }[];
      title: string;
      label: string;
    }
  | {
      kind: 'element_alloc';
      amount: number;
      title: string;
      label: string;
      pay: true;
      reward: {
        crystals?: number;
        energy?: number;
        draw?: number;
        opponentCrystals?: number;
      };
    }
  | null
  | 'unimplemented';

function isActivatable(def: SeasonsCardDef): boolean {
  const effect = def.effect;
  if (!effect) return false;
  return effect.trigger === 'activation' || effect.triggers.includes('activation');
}

function activationKeyOf(def: SeasonsCardDef): string {
  return def.effect ? def.effect.typeKey ?? def.effect.type : '';
}

function countPlayedType(player: SeasonsPlayerState, type: string): number {
  return player.played.filter((card) => cardById(card.i)?.type === type)
    .length;
}

/** 卡牌离场（牺牲/回手/转移）：恢复 max_energy_plus 提供的储备上限。 */
function cardLeavingPlay(
  player: SeasonsPlayerState,
  card: { i: number },
): SeasonsPlayerState {
  const def = cardById(card.i);
  const bonus = def ? abilityAmount(def, 'max_energy_plus') : 0;
  if (bonus <= 0) return player;
  return {
    ...player,
    maxEnergy: Math.max(BASE_MAX_ENERGY, player.maxEnergy - bonus),
  };
}

/** 牺牲离场：除上限恢复外，还触发 on_sacrifice（诅咒典籍：清空储备）。 */
function cardSacrificed(
  player: SeasonsPlayerState,
  card: { i: number },
): SeasonsPlayerState {
  const def = cardById(card.i);
  const key = def?.effect ? def.effect.typeKey ?? def.effect.type : '';
  const next = cardLeavingPlay(player, card);
  if (key === 'cursed_treatise') {
    return { ...next, energies: { water: 0, air: 0, fire: 0, earth: 0 } };
  }
  return next;
}

/** 从储备区优先扣能量，不足时再从场上卡牌的 stored 里扣。 */
function takeElementEnergy(
  player: SeasonsPlayerState,
  element: Element,
  amount: number,
): SeasonsPlayerState | null {
  let left = amount;
  const energies = { ...player.energies };
  const fromReserve = Math.min(energies[element], left);
  energies[element] -= fromReserve;
  left -= fromReserve;
  if (left === 0) return { ...player, energies };
  const played = player.played.map((card) => {
    if (left === 0) return card;
    const cardDef = cardById(card.i);
    if (!cardDef || abilitiesOf(cardDef, 'sealed_energy').length > 0) return card;
    const have = card.stored?.[element] ?? 0;
    if (have === 0) return card;
    const take = Math.min(have, left);
    left -= take;
    return { ...card, stored: { ...(card.stored ?? {}), [element]: have - take } };
  });
  if (left > 0) return null;
  return { ...player, energies, played };
}

function activationRequest(
  def: SeasonsCardDef,
  state: SeasonsState,
  seat: number,
  abilityKey?: string,
): ActivationRequest {
  const me = state.players[seat];
  switch (activationKeyOf(def)) {
    case 'per_familiar_crystal':
    case 'potion_power':
      return null;
    case 'potion_knowledge':
      return {
        kind: 'element_alloc',
        amount: 5,
        title: '选择获得 5 个能量',
        label: '获得',
      };
    case 'necrotic_kriss':
      // 弃手牌 1 随从或牺牲在场 1 随从，然后获得 4 任意能量（由 resolveSacrificeCards 续接）。
      return {
        kind: 'sacrifice_cards',
        amount: 1,
        title: '弃掉 1 张手牌随从，或牺牲 1 张在场随从',
        label: '选择',
        source: 'hand_or_play',
        then: 'necrotic_energy',
      };
    case 'pay_energy_reward': {
      const effect = def.effect;
      const cost = typeof effect?.cost === 'number' ? effect.cost : 1;
      return {
        kind: 'element_alloc',
        amount: cost,
        title: `弃 ${cost} 个任意能量`,
        label: '支付',
        pay: true,
        reward: {
          crystals: effect?.crystals,
          energy: effect?.energy,
          draw: effect?.draw,
          opponentCrystals: effect?.opponentCrystals,
        },
      };
    }
    case 'crystal_orb':
      // 由 activate 内部处理（需要先看牌堆顶）
      return 'unimplemented';
    case 'cursed_relic':
      // 无选择：直接转移控制权（在 applyActivationEffect 里处理）
      return null;
    case 'potion_dreams':
      return {
        kind: 'card_pick',
        amount: 1,
        title: '选择要免费召唤的手牌',
        label: '召唤',
      };
    case 'glutton_cauldron':
      return {
        kind: 'element_pick',
        amount: 1,
        title: '选择放入贪吃锅的 1 个能量',
        label: '放入',
      };
    case 'dragon_skull':
      return {
        kind: 'sacrifice_cards',
        amount: 3,
        title: '选择要牺牲的在场卡（共 3 张）',
        label: '牺牲',
      };
    case 'potion_life': {
      const elements = ELEMENTS.map((element) => ({
        element,
        count: reserveElementCount(me, element),
      })).filter((item) => item.count > 0);
      return {
        kind: 'element_multi',
        elements,
        title: '选择要转换的能量类型（每种的全部能量 ×4 水晶）',
        label: '转换',
      };
    }
    case 'tree_of_light':
      if (abilityKey === 'crystal_to_energy') {
        return {
          kind: 'element_alloc',
          amount: 1,
          title: '选择获得 1 个能量',
          label: '获得',
        };
      }
      if (abilityKey === 'energy_to_crystal') {
        return {
          kind: 'element_pick',
          amount: 1,
          title: '选择要转换的 1 个能量',
          label: '转换',
        };
      }
      return 'unimplemented';
    case 'kairn':
      return {
        kind: 'element_pick',
        amount: 1,
        title: '选择弃掉 1 个能量',
        label: '弃掉',
      };
    case 'balance_of_ishtar':
      return {
        kind: 'element_pick',
        amount: 4,
        title: '选择弃掉 4 个相同能量',
        label: '弃掉',
      };
    default:
      return 'unimplemented';
  }
}

function applyActivationEffect(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  key: string,
  element?: Element,
): SeasonsState {
  const me = state.players[seat];
  if (!me) return state;
  switch (key) {
    case 'per_familiar_crystal': {
      const amount = countPlayedType(me, 'familiar');
      const next = patchPlayer(state, seat, (player) => ({
        crystals: player.crystals + amount,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', `随从偶像：水晶 +${amount}`),
      };
    }
    case 'potion_power': {
      const removed = me.played.find((card) => card.u === cardUid);
      const withoutCard = patchPlayer(
        {
          ...state,
          discard: removed ? [...state.discard, removed] : state.discard,
        },
        seat,
        (player) => {
          const without = {
            ...player,
            played: player.played.filter((card) => card.u !== cardUid),
            gauge: player.gauge + 2,
          };
          return removed
            ? cardSacrificed(without, removed)
            : { played: without.played, gauge: without.gauge };
        },
      );
      return drawToHand(withoutCard, seat, 1);
    }
    case 'balance_of_ishtar': {
      const next = patchPlayer(state, seat, (player) => ({
        crystals: player.crystals + 12,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', '伊什塔尔天平：水晶 +12'),
      };
    }
    case 'tree_of_light': {
      if (!element) return state;
      const base = TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0;
      let bonus = 0;
      for (const item of me.played) {
        const def = cardById(item.i);
        if (def) bonus += abilityAmount(def, 'transmute_bonus');
      }
      const value = base + bonus;
      const next = patchPlayer(state, seat, (player) => ({
        crystals: player.crystals + value,
      }));
      return {
        ...next,
        log: pushLog(next.log, 'effect', `光之树：转化 ${ELEMENT_NAME_ZH[element]} → 水晶 +${value}`),
      };
    }
    case 'cursed_relic': {
      const card = me.played.find((item) => item.u === cardUid);
      if (!card) return state;
      const targetSeat = (seat + 1) % state.players.length;
      const def = cardById(card.i);
      const bonus = def ? abilityAmount(def, 'max_energy_plus') : 0;
      const players = state.players.map((player) => {
        if (player.seat === seat) {
          return {
            ...player,
            played: player.played.filter((item) => item.u !== cardUid),
            maxEnergy: bonus > 0 ? Math.max(BASE_MAX_ENERGY, player.maxEnergy - bonus) : player.maxEnergy,
          };
        }
        if (player.seat === targetSeat) {
          return {
            ...player,
            played: [...player.played, { i: card.i, u: card.u }],
            maxEnergy: player.maxEnergy + bonus,
          };
        }
        return player;
      });
      const next = { ...state, players };
      return {
        ...next,
        log: pushLog(
          next.log,
          'effect',
          `「奥尼斯的受诅咒灵魂」控制权转移至 ${seatName(targetSeat)}`,
        ),
      };
    }
    case 'kairn': {
      const players = state.players.map((player) =>
        player.seat === seat
          ? player
          : { ...player, crystals: Math.max(0, player.crystals - 4) },
      );
      const next = { ...state, players };
      return {
        ...next,
        log: pushLog(next.log, 'effect', '毁灭者凯恩：每位对手水晶 -4'),
      };
    }
    default:
      return state;
  }
}

function markActivated(
  state: SeasonsState,
  seat: number,
  actId: string,
): SeasonsState {
  const next = patchPlayer(state, seat, (player) => ({
    activatedThisTurn: [...player.activatedThisTurn, actId],
  }));
  return applyOpponentActivateEffects(next, seat);
}

/** 扩展包「对手激活时」奖励（小仙灵 / 命运守望者）：给持有者水晶或抽牌。 */
function applyOpponentActivateEffects(state: SeasonsState, seat: number): SeasonsState {
  const draws: number[] = [];
  let stolenTotal = 0;
  const players = state.players.map((player) => {
    if (player.seat === seat) return player;
    let crystals = player.crystals;
    for (const card of player.played) {
      const effect = cardById(card.i)?.effect;
      if (!effect) continue;
      const key = effect.typeKey ?? effect.type;
      if (key === 'thieving_fairies') {
        // 偷窃妖精：对手激活时前进 2 格（1 来自其水晶，1 额外）；对方没水晶时只拿额外 1。
        const have = (state.players[seat]?.crystals ?? 0) - stolenTotal;
        if (have > 0) {
          stolenTotal += 1;
          crystals += 2;
        } else {
          crystals += 1;
        }
        continue;
      }
      if (key !== 'opponent_action_reward') continue;
      if (effect.triggerKind && effect.triggerKind !== 'opponent_activate') continue;
      if (effect.crystals) crystals += effect.crystals;
      if (effect.draw) draws.push(player.seat);
    }
    return crystals === player.crystals ? player : { ...player, crystals };
  });
  if (stolenTotal > 0) {
    const activator = players.find((player) => player.seat === seat);
    if (activator) {
      players[players.indexOf(activator)] = {
        ...activator,
        crystals: activator.crystals - stolenTotal,
      };
    }
  }
  let next: SeasonsState = { ...state, players };
  if (stolenTotal > 0) {
    next = {
      ...next,
      log: pushLog(next.log, 'effect', `偷窃妖精：对手激活，水晶 +${stolenTotal + 1}`),
    };
  }
  if (draws.length > 0) {
    next = { ...next, log: pushLog(next.log, 'effect', '对手激活奖励：结算') };
  }
  for (const ownerSeat of draws) {
    const [drawnState, drawn] = drawOne(next);
    next = drawnState;
    if (drawn) {
      next = patchPlayer(next, ownerSeat, (player) => ({ hand: [...player.hand, drawn] }));
    }
  }
  return next;
}

function activate(
  state: SeasonsState,
  seat: number,
  cardUid: number,
  abilityKey?: string,
): ReduceResult<SeasonsState> {
  if (state.phase !== 'play') return fail('wrong_phase', '当前不是行动阶段');
  if (state.turnOwner !== seat) return fail('not_your_turn', '还没轮到你行动');
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');
  const card = me.played.find((item) => item.u === cardUid);
  if (!card) return fail('card_not_in_play', '这张牌不在场上');
  const def = cardById(card.i);
  if (!def || !isActivatable(def)) return fail('not_activatable', '这张牌不可激活');

  const actId = abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid);
  const used = me.activatedThisTurn.some(
    (key) => key === actId || key === String(cardUid),
  );
  if (used) return fail('already_activated', '这张牌本回合已激活过');

  // 激活费用（如诅咒圣物：1 水）
  let payer: SeasonsPlayerState = me;
  for (const ability of abilitiesOf(def, 'activation_cost')) {
    const element = ability.element as Element | undefined;
    const amount = ability.amount ?? 1;
    if (!element || !ELEMENTS.includes(element)) continue;
    const paid = takeElementEnergy(payer, element, amount);
    if (!paid) {
      return fail(
        'cant_afford',
        `激活需要 ${amount} 个${ELEMENT_NAME_ZH[element]}`,
      );
    }
    payer = paid;
  }
  const paidState: SeasonsState = {
    ...state,
    players: state.players.map((player) => (player.seat === seat ? payer : player)),
  };

  // 光之树 A：先弃 3 水晶
  let costed: SeasonsState = paidState;
  if (
    activationKeyOf(def) === 'tree_of_light' &&
    abilityKey === 'crystal_to_energy'
  ) {
    const payer2 = costed.players[seat];
    if (!payer2 || payer2.crystals < 3) {
      return fail('cant_afford', '水晶不足 3，无法激活光之树');
    }
    costed = patchPlayer(costed, seat, (player) => ({
      crystals: player.crystals - 3,
    }));
  }

  // 牺牲自身的激活（药水 / 死灵匕首）：先弃置本卡
  const SACRIFICE_ON_ACTIVATE = new Set([
    'potion_knowledge',
    'potion_life',
    'potion_dreams',
  ]);
  if (SACRIFICE_ON_ACTIVATE.has(activationKeyOf(def))) {
    const meNow = costed.players[seat];
    const removed = meNow?.played.find((item) => item.u === cardUid);
    costed = patchPlayer(
      {
        ...costed,
        discard: removed ? [...costed.discard, removed] : costed.discard,
      },
      seat,
      (player) => {
        const without = {
          ...player,
          played: player.played.filter((item) => item.u !== cardUid),
        };
        return removed
          ? cardSacrificed(without, removed)
          : { played: without.played };
      },
    );
    costed = {
      ...costed,
      log: pushLog(costed.log, 'activate', `${seatName(seat)} 牺牲「${def.nameZh}」`),
    };
  }

  // 梦境药水：牺牲后清空储备能量，再免费召唤一张手牌。
  if (activationKeyOf(def) === 'potion_dreams') {
    costed = patchPlayer(costed, seat, (player) => ({
      energies: { water: 0, air: 0, fire: 0, earth: 0 },
    }));
    costed = {
      ...costed,
      log: pushLog(costed.log, 'effect', '梦境药水：清空储备能量'),
    };
  }

  // 水晶球：先看牌堆顶，再让玩家选择放回或免费召唤。
  if (activationKeyOf(def) === 'crystal_orb') {
    if (abilityKey === 'discard') {
      const meNow = costed.players[seat];
      if (!meNow || meNow.crystals < 3) {
        return fail('cant_afford', '水晶不足 3，无法弃掉牌堆顶');
      }
      const paidCrystals = patchPlayer(costed, seat, (player) => ({
        crystals: player.crystals - 3,
      }));
      const [drawnState, drawn] = drawOne(paidCrystals);
      if (!drawn) return fail('deck_empty', '牌堆为空');
      return {
        ok: true,
        state: markActivated(
          {
            ...drawnState,
            discard: [...drawnState.discard, drawn],
            log: pushLog(
              drawnState.log,
              'effect',
              `水晶球：弃掉牌堆顶「${cardById(drawn.i)?.nameZh ?? drawn.i}」`,
            ),
          },
          seat,
          abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
        ),
        events: [],
      };
    }
    if (abilityKey !== 'summon') {
      return fail('invalid_choice', '水晶球需要指定能力：summon 或 discard');
    }
    const [peekState, peeked] = drawOne(costed);
    if (!peeked) return fail('deck_empty', '牌堆为空');
    const peekDef = cardById(peeked.i);
    const meNow = peekState.players[seat];
    const summonReq = peekDef ? summonChoiceFor(peekDef, [], peekState, seat) : 'unimplemented';
    const canSummon =
      !!meNow &&
      meNow.gauge > meNow.played.length &&
      energySum(meNow.energies) >= 4 &&
      summonReq === null;
    return {
      ok: true,
      state: {
        ...peekState,
        pendingChoice: {
          kind: 'branch',
          key: 'crystal_orb',
          choosingSeat: seat,
          options: {
            title: `牌堆顶是「${peekDef?.nameZh ?? peeked.i}」`,
            branches: [
              { id: 'keep', label: '放回牌堆顶', enabled: true },
              { id: 'summon', label: '弃 4 能量免费召唤', enabled: canSummon },
            ],
            card: peeked,
            canSummon,
            cardUid,
            actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
          },
        },
        log: pushLog(peekState.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (activationKeyOf(def) === 'mirror_of_seasons') {
    const meNow = costed.players[seat];
    if (!meNow || meNow.crystals < 1) {
      return fail('cant_afford', '水晶不足，无法激活四季之镜');
    }
    const available = ELEMENTS.filter(
      (element) =>
        (meNow.energies[element] ?? 0) > 0 ||
        meNow.played.some((item) => (item.stored?.[element] ?? 0) > 0),
    );
    if (available.length === 0) {
      return fail('energy_low', '储备区无能量可转换');
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: 'branch',
          key: 'mirror_of_seasons',
          choosingSeat: seat,
          options: {
            step: 'source',
            title: '四季之镜 — 选择要转换的能量类型',
            branches: available.map((element) => ({
              id: element,
              label: `${ELEMENT_NAME_ZH[element]}能量`,
            })),
            cardUid,
            actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
          },
        },
        log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
      },
      events: [],
    };
  }

  if (activationKeyOf(def) === 'necrotic_kriss') {
    const actor = costed.players[seat];
    const hasFamiliar = [...(actor?.hand ?? []), ...(actor?.played ?? [])].some(
      (card) => cardById(card.i)?.type === 'familiar',
    );
    if (!hasFamiliar) return fail('invalid_choice', '没有可弃置或牺牲的随从');
  }

  const request = activationRequest(def, costed, seat, abilityKey);
  if (request === 'unimplemented') {
    return fail(
      'effect_not_implemented',
      `「${def.nameZh}」的激活效果尚未实现`,
    );
  }
  if (request) {
    if (request.kind === 'card_pick') {
      const meNow = costed.players[seat];
      if (!meNow || meNow.hand.length === 0) {
        return fail('hand_empty', '手牌为空，无法选择召唤');
      }
      return {
        ok: true,
        state: {
          ...costed,
          pendingCards: [...meNow.hand],
          pendingChoice: {
            kind: 'card_pick',
            key: activationKeyOf(def),
            choosingSeat: seat,
            options: {
              title: request.title,
              label: request.label,
              actId: abilityKey ? `${cardUid}:${abilityKey}` : String(cardUid),
            },
          },
          log: pushLog(costed.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
        },
        events: [],
      };
    }
    return {
      ok: true,
      state: {
        ...costed,
        pendingChoice: {
          kind: request.kind,
          key: activationKeyOf(def),
          choosingSeat: seat,
          options: {
            ...(request.kind === 'element_multi'
              ? { amount: 0, elements: request.elements }
              : { amount: request.amount }),
            title: request.title,
            label: request.label,
            cardUid,
            actId,
            ...('pay' in request && request.pay
              ? { mode: 'pay', then: 'pay_energy_reward', reward: request.reward }
              : {}),
            ...(request.kind === 'sacrifice_cards'
              ? {
                  remaining: request.amount,
                  chosen: [],
                  ...('source' in request && request.source ? { source: request.source } : {}),
                  ...('then' in request && request.then ? { then: request.then } : {}),
                }
              : {}),
          },
        },
        log: pushLog(
          costed.log,
          'activate',
          `${seatName(seat)} 激活「${def.nameZh}」`,
        ),
      },
      events: [],
    };
  }

  let next = applyActivationEffect(costed, seat, cardUid, activationKeyOf(def));
  next = markActivated(next, seat, actId);
  return {
    ok: true,
    state: {
      ...next,
      log: pushLog(next.log, 'activate', `${seatName(seat)} 激活「${def.nameZh}」`),
    },
    events: [],
  };
}

function resolveElementMulti(
  state: SeasonsState,
  seat: number,
  pending: SeasonsPendingChoiceState,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const entries = Array.isArray(pending.options.elements)
    ? (pending.options.elements as { element: Element; count: number }[])
    : [];
  const values = Array.isArray(choice)
    ? choice.filter((item): item is Element => typeof item === 'string' && ELEMENTS.includes(item as Element))
    : [];
  if (!Array.isArray(choice) || values.length !== choice.length) {
    return fail('invalid_choice', '请提交能量类型列表');
  }
  const selected = [...new Set(values)];
  if (selected.length !== values.length) {
    return fail('invalid_choice', '同一种能量只能选择一次');
  }
  const available = new Map(entries.map((item) => [item.element, item.count]));
  if (selected.some((element) => !available.has(element))) {
    return fail('invalid_choice', '该元素没有可转换的能量');
  }
  const me = state.players[seat];
  if (!me) {
    return fail('seat_not_found', '座位不存在');
  }
  let payer: SeasonsPlayerState = me;
  let count = 0;
  for (const element of selected) {
    const amount = available.get(element) ?? 0;
    if (amount <= 0) continue;
    const taken = takeElementEnergy(payer, element, amount);
    if (!taken) continue;
    payer = taken;
    count += amount;
  }
  const crystals = count * 4;
  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(pending.options.cardUid ?? 0);
  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) =>
      player.seat === seat ? { ...payer, crystals: payer.crystals + crystals } : player,
    ),
  };
  next = markActivated(next, seat, actId);
  const names = selected.map((element) => ELEMENT_NAME_ZH[element]).join('、') || '无';
  return {
    ok: true,
    state: {
      ...next,
      pendingChoice: null,
      log: pushLog(
        next.log,
        'effect',
        `生命药水：${names} 共 ${count} 个能量 → 水晶 +${crystals}`,
      ),
    },
    events: [],
  };
}

function resolveElementPick(
  state: SeasonsState,
  seat: number,
  pending: NonNullable<SeasonsState['pendingChoice']>,
  choice: unknown,
): ReduceResult<SeasonsState> {
  const raw =
    typeof choice === 'string'
      ? choice
      : choice && typeof choice === 'object' && 'element' in choice
        ? (choice as { element?: unknown }).element
        : undefined;
  if (typeof raw !== 'string' || !ELEMENTS.includes(raw as Element)) {
    return fail('invalid_choice', '请选择一种能量');
  }
  const element = raw as Element;
  const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 1;
  const me = state.players[seat];
  if (!me) return fail('bad_seat', '座位不存在');

  // 贪吃锅：放入 1 个能量；满 7 时牺牲、能量回储备并得 15 水晶。
  if (pending.key === 'glutton_cauldron') {
    const jarUid =
      typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
    const jar = me.played.find((item) => item.u === jarUid);
    if (!jar) return fail('card_not_in_play', '贪吃锅不在场上');
    const paid = takeElementEnergy(me, element, 1);
    if (!paid) {
      return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足`);
    }
    let player: SeasonsPlayerState = {
      ...paid,
      played: paid.played.map((item) => {
        if (item.u !== jarUid) return item;
        const stored = { ...(item.stored ?? {}) };
        stored[element] = (stored[element] ?? 0) + 1;
        return { ...item, stored };
      }),
    };
    const updated = player.played.find((item) => item.u === jarUid);
    const storedTotal = ELEMENTS.reduce(
      (sum, key) => sum + (updated?.stored?.[key] ?? 0),
      0,
    );
    let next: SeasonsState = { ...state };
    let sacrificed = false;
    if (storedTotal >= 7) {
      const stored = updated?.stored ?? {};
      const energies = addEnergyCapped(
        player.energies,
        stored as Partial<Record<Element, number>>,
        player.maxEnergy,
      );
      player = cardSacrificed(
        {
          ...player,
          played: player.played.filter((item) => item.u !== jarUid),
          crystals: player.crystals + 15,
          energies,
        },
        jar,
      );
      const removed = { i: jar.i, u: jar.u };
      next = { ...state, discard: [...state.discard, removed] };
      sacrificed = true;
    }
    next = {
      ...next,
      players: state.players.map((item) =>
        item.seat === seat ? player : item,
      ),
      pendingChoice: null,
      log: pushLog(
        next.log,
        'effect',
        sacrificed
          ? `贪吃锅：${ELEMENT_NAME_ZH[element]}能量 +1，满 7 触发牺牲，水晶 +15`
          : `贪吃锅：${ELEMENT_NAME_ZH[element]}能量 +1`,
      ),
    };
    const actId =
      typeof pending.options.actId === 'string'
        ? pending.options.actId
        : String(jarUid);
    return { ok: true, state: markActivated(next, seat, actId), events: [] };
  }

  const paid = takeElementEnergy(me, element, amount);
  if (!paid) {
    return fail('energy_low', `${ELEMENT_NAME_ZH[element]}能量不足（需要 ${amount}）`);
  }

  const cardUid = typeof pending.options.cardUid === 'number' ? pending.options.cardUid : 0;
  const card = paid.played.find((item) => item.u === cardUid);
  const def = card ? cardById(card.i) : undefined;
  if (!card || !def) return fail('card_not_in_play', '这张牌不在场上');

  let next: SeasonsState = {
    ...state,
    players: state.players.map((player) => (player.seat === seat ? paid : player)),
  };
  next = applyActivationEffect(next, seat, cardUid, pending.key, element);
  const actId =
    typeof pending.options.actId === 'string'
      ? pending.options.actId
      : String(cardUid);
  next = markActivated(next, seat, actId);
  return {
    ok: true,
    state: {
      ...next,
      pendingChoice: null,
      log: pushLog(
        next.log,
        'choice',
        `${seatName(seat)} 弃掉 ${amount} 个${ELEMENT_NAME_ZH[element]}`,
      ),
    },
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/* 引擎                                                                */
/* ------------------------------------------------------------------ */

export const seasons: GameEngine<
  SeasonsState,
  SeasonsGameView,
  SeasonsAction,
  SeasonsOptions
> = {
  setup,

  reduce(state, seat, action, _ctx): ReduceResult<SeasonsState> {
    if (state.phase === 'ended') return fail('game_over', '这局已经结束了');
    if (!state.players[seat]) return fail('bad_seat', '座位不存在');
    state = clearStaleDiscard(state);
    if (
      state.pendingChoice &&
      action.type !== 'resolve-choice' &&
      action.type !== 'resign' &&
      action.type !== 'badge-keep'
    ) {
      return fail('pending_choice', '请先完成当前选择');
    }
    if (state.players[seat]?.badgeDraw && action.type !== 'badge-keep') {
      return fail('pending_badge', '请先选择保留的卡牌');
    }

    switch (action.type) {
      case 'resign':
        return finish(state, resign(state, seat));
      case 'draft-pick':
        return finish(state, draftPick(state, seat, action.cardUid));
      case 'organize':
        return finish(state, organize(state, seat, action.cardUids));
      case 'organize-reset':
        return finish(state, organizeReset(state, seat));
      case 'draft-dice':
        return finish(state, draftDice(state, seat, action.dieIndex));
      case 'summon':
        return finish(state, summon(state, seat, action.cardUid, action.paidElements));
      case 'resolve-choice':
        return finish(state, resolveChoice(state, seat, action.choice));
      case 'transmute':
        return finish(state, transmute(state, seat, action.element));
      case 'end-turn':
        return finish(state, endTurn(state, seat));
      case 'activate':
        return finish(state, activate(state, seat, action.cardUid, action.abilityKey));
      case 'use-badge':
        return finish(state, useBadge(state, seat, action));
      case 'badge-keep':
        return finish(state, keepBadge(state, seat, action.cardUid));
      default:
        // 对局阶段动作在 Phase 2 接入。
        return fail('not_implemented', '该动作尚未接入（Phase 2）');
    }
  },

  resignable(state, seat) {
    return (
      state.phase !== 'ended' &&
      state.players.length === 2 &&
      seat >= 0 &&
      seat < state.players.length
    );
  },

  view(state, viewerSeat): SeasonsGameView {
    const season = seasonView(state);
    const me = viewerSeat === null ? null : state.players[viewerSeat] ?? null;

    let myTurn = false;
    if (me && state.phase !== 'ended') {
      if (state.pendingChoice) {
        myTurn = state.pendingChoice.choosingSeat === me.seat;
      } else if (state.phase === 'draft') {
        myTurn = me.drafted.length === state.draftRound;
      } else if (state.phase === 'organize') {
        myTurn = !me.organizeDone;
      } else {
        myTurn =
          state.turnOwner === me.seat ||
          (state.turnOwner === null && state.currentPicker === me.seat);
      }
    }

    return {
      phase: state.phase,
      month: state.month,
      year: Math.floor(state.month / 12) + 1,
      seasonIdx: state.seasonIdx,
      season,
      startPlayer: state.startPlayer,
      currentPicker: state.currentPicker,
      turnOwner: state.turnOwner,
      draftRound: state.draftRound,
      draftPickedThisRound: state.players
        .filter((player) => player.drafted.length > state.draftRound)
        .map((player) => player.seat),
      pickedThisSeason: [...state.pickedThisSeason],
      dice: dieViews(state, season),
      playerCount: state.players.length,
      players: state.players.map((player) => playerView(state, player, viewerSeat)),
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      transmuteValues: ELEMENTS.map((element) => ({
        element,
        value: TRANSMUTE_VALUE[element][seasonIndexForMonth(state.month)] ?? 0,
      })),
      pendingChoice: state.pendingChoice
        ? state.pendingChoice.choosingSeat === viewerSeat
          ? {
              ...state.pendingChoice,
              options: state.pendingCards
                ? { ...state.pendingChoice.options, cards: state.pendingCards }
                : state.pendingChoice.options,
            }
          : {
              ...state.pendingChoice,
              // energy_swap 的当前储备与新获得属于私有信息，只发给应答者。
              options:
                state.pendingChoice.kind === 'energy_swap'
                  ? {
                      title: state.pendingChoice.options.title,
                      amount: state.pendingChoice.options.amount,
                      total: state.pendingChoice.options.total,
                      pool: state.pendingChoice.options.pool,
                    }
                  : state.pendingChoice.kind === 'energy_discard'
                    ? {
                        title: state.pendingChoice.options.title,
                        amount: state.pendingChoice.options.amount,
                      }
                    : state.pendingChoice.kind === 'branch' &&
                        state.pendingChoice.key === 'vampiric_crown'
                      ? {
                          title: state.pendingChoice.options.title,
                          branches: state.pendingChoice.options.branches,
                        }
                      : state.pendingChoice.options,
            }
        : null,
      pendingQueueCount: state.pendingQueue.length,
      myTurn,
      result: state.result,
      log: state.log.slice(-30),
    };
  },

  finished(state) {
    return state.phase === 'ended';
  },

  winner(state) {
    return state.result?.winner ?? null;
  },

  turn(state) {
    if (state.phase !== 'play') return null;
    return state.turnOwner ?? state.currentPicker;
  },

  rankings(state) {
    if (state.phase !== 'ended') return [];
    const winner = state.result?.winner ?? null;
    const ranked = state.result?.players ?? [];
    // 有完整计分表时按总分降序，分数相同并列（competition ranking）。
    if (ranked.length > 0) {
      const bySeat = new Map(ranked.map((score) => [score.seat, score]));
      return state.players.map((player) => {
        const score = bySeat.get(player.seat);
        const rank = score ? ranked.filter((other) => other.score > score.score).length + 1 : 2;
        return { seat: player.seat, rank, score: score?.score };
      });
    }
    // 认输没有完整计分表，只按 winner 给出 1/2 名。
    return state.players.map((player) => ({
      seat: player.seat,
      rank: winner === null || player.seat === winner ? 1 : 2,
    }));
  },
};

/* ------------------------------------------------------------------ */
/* 调试/测试辅助                                                        */
/* ------------------------------------------------------------------ */

/** 当前季节索引（由 month 推导），供 Phase 2 使用。 */
export function seasonIndexForMonth(month: number): number {
  return Math.floor(month / MONTHS_PER_SEASON) % SEASONS_PER_YEAR;
}
