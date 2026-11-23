#!/usr/bin/env node
/**
 * 四季物语 L2 冒烟：跑 N 局自动对局，每步检查不变式。
 * 用法：pnpm --filter @bgx/server build && node apps/server/scripts/seasons-soak.mjs [局数] [人数] [扩展包逗号列表]
 */
import { seasons } from '../dist/games/seasons/engine.js';
import { CARD_BY_ID } from '../dist/games/seasons/cards/base.js';

const GAMES = Number(process.argv[2] ?? 200);
const PLAYERS = Number(process.argv[3] ?? 2);
// 第 4 个参数（可选）：随机卡池大小。>0 时每局从内置 90 张里随机抽 POOL_SIZE 种，
// 用 customDeck 入池，验证「任意卡池都能开局并打完」。
const POOL_SIZE = Number(process.argv[4] ?? 0);
const ELEMENTS = ['water', 'air', 'fire', 'earth'];

function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (a) => a[Math.floor(next() * a.length)],
    shuffle: (a) => [...a].sort(() => next() - 0.5),
  };
}

const EXTENSIONS = (process.argv[4] ?? 'base').split(',');

function optionsFor(seed) {
  if (!POOL_SIZE) return { extensions: EXTENSIONS };
  const rnd = makeRng((seed ^ 0x9e3779b9) >>> 0);
  const ids = [...CARD_BY_ID.keys()];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = rnd.int(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const picked = ids.slice(0, Math.min(POOL_SIZE, ids.length));
  if (picked.length * 2 < PLAYERS * 9) {
    throw new Error(`随机卡池太小：${picked.length} 种 = ${picked.length * 2} 张，至少要 ${PLAYERS * 9} 张`);
  }
  return { extensions: ['base'], customDeck: picked.join(',') };
}

function checkInvariants(state, where) {
  const fail = (msg) => {
    throw new Error(`${where}: ${msg}`);
  };
  if (state.month < 0 || state.month > 36) fail(`month=${state.month}`);
  if (state.log.length > 80) fail(`log=${state.log.length}`);
  if (!state.pendingChoice && state.pendingQueue.length > 0) fail('队列未提升');
  if (state.pendingChoice && state.pendingChoice.choosingSeat >= state.players.length) fail('choosingSeat 越界');

  const seen = new Set();
  const count = (ref, zone) => {
    if (ref?.u === undefined) fail(`${zone} 里有缺 u 的卡 ${JSON.stringify(ref)}`);
    if (seen.has(ref.u)) fail(`重复 uid ${ref.u}（${zone}）`);
    seen.add(ref.u);
  };
  let expected = 0;
  const zone = (list, name) => {
    for (const ref of list) count(ref, name);
    expected += list.length;
  };
  zone(state.deck, 'deck');
  zone(state.discard, 'discard');
  zone(state.pendingCards ?? [], 'pendingCards');
  for (const player of state.players) {
    const at = `玩家${player.seat}`;
    zone(player.played, `${at}.played`);
    zone(player.badgeDraw ?? [], `${at}.badgeDraw`);
    if (state.phase === 'draft') {
      zone(player.draftHand, `${at}.draftHand`);
      zone(player.drafted, `${at}.drafted`);
    } else if (state.phase === 'organize') {
      zone(player.drafted, `${at}.drafted`);
    } else {
      zone(player.hand, `${at}.hand`);
      zone(player.library2, `${at}.library2`);
      zone(player.library3, `${at}.library3`);
    }
    if (player.crystals < 0) fail(`座位${player.seat} 水晶为负`);
    if (player.gauge < 0) fail(`座位${player.seat} 召唤等级为负`);
    const energyTotal = ELEMENTS.reduce((sum, element) => sum + player.energies[element], 0);
    if (energyTotal > player.maxEnergy + 16) fail(`座位${player.seat} 能量溢出 ${energyTotal}/${player.maxEnergy}`);
    if (player.played.some((card) => !CARD_BY_ID.has(card.i))) fail('场上有未知卡 id');
  }
  if (seen.size !== expected) fail('卡牌计数不一致');
}

function candidates(state) {
  const p = state.pendingChoice;
  const seat = p.choosingSeat;
  const me = state.players[seat];
  if (p.kind === 'branch') {
    return (p.options.branches ?? []).map((branch) => ({ id: branch.id }));
  }
  if (p.kind === 'month_advance') return [{ direction: 'forward', steps: 1 }];
  if (p.kind === 'card_pick') {
    const pool = p.options.purpose === 'discard' ? me.hand : (state.pendingCards ?? []);
    return pool.map((card) => ({ uid: card.u }));
  }
  if (p.kind === 'card_list') {
    const cards = state.pendingCards ?? [];
    const keep = typeof p.options.keep === 'number' ? p.options.keep : 1;
    return keep === 1 ? cards.map((card) => [card.u]) : [cards.slice(0, keep).map((card) => card.u)];
  }
  if (p.kind === 'multi_player_pick') return me.played.map((card) => ({ uid: card.u }));
  if (p.kind === 'element_multi') {
    const elements = (p.options.elements ?? []).map((item) => item.element);
    return [elements];
  }
  if (p.kind === 'element_pick') {
    return ELEMENTS.filter((element) => me.energies[element] > 0).map((element) => ({ element }));
  }
  if (p.kind === 'sacrifice_cards') return me.played.map((card) => card.u);
  if (p.kind === 'energy_discard') {
    const amount = typeof p.options.amount === 'number' ? p.options.amount : 0;
    const available = p.options.available ?? {};
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    let left = amount;
    for (const element of ELEMENTS) {
      const take = Math.min(available[element] ?? 0, left);
      out[element] = take;
      left -= take;
    }
    return [out];
  }
  if (p.kind === 'energy_swap') {
    const total = typeof p.options.total === 'number' ? p.options.total : 0;
    const current = p.options.current ?? {};
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    let left = total;
    for (const element of ELEMENTS) {
      const keep = Math.min(current[element] ?? 0, left);
      out[element] = keep;
      left -= keep;
    }
    for (let i = 0; left > 0; i += 1) {
      out[ELEMENTS[i % ELEMENTS.length]] += 1;
      left -= 1;
    }
    return [out];
  }

  const amount = typeof p.options.amount === 'number' ? p.options.amount : 1;
  const caps = p.options.maxPerElement ?? {};
  if (p.key === 'cost_reduce') {
    // 枚举所有可行的减费分配，只保留减完真的付得起的那些。
    const cost = p.options.cost ?? {};
    const payable = (reduced) =>
      ELEMENTS.every((element) => (reduced[element] ?? 0) <= (me.energies[element] ?? 0)) &&
      (cost.crystal ?? 0) <= me.crystals;
    const out = [];
    const walk = (index, left, alloc) => {
      if (index === ELEMENTS.length) {
        const reduced = { ...cost };
        for (const element of ELEMENTS) reduced[element] = Math.max(0, (cost[element] ?? 0) - (alloc[element] ?? 0));
        if (payable(reduced)) out.push({ ...alloc });
        return;
      }
      const element = ELEMENTS[index];
      const cap = Math.min(left, typeof caps[element] === 'number' ? caps[element] : 0);
      for (let take = 0; take <= cap; take += 1) {
        walk(index + 1, left - take, { ...alloc, [element]: take });
      }
    };
    walk(0, amount, { water: 0, air: 0, fire: 0, earth: 0 });
    return out.length > 0 ? out : [{ water: 0, air: 0, fire: 0, earth: 0 }];
  }
  const out = { water: 0, air: 0, fire: 0, earth: 0 };
  let left = amount;
  for (const element of ELEMENTS) {
    const cap = Math.min(left, typeof caps[element] === 'number' ? caps[element] : left);
    out[element] = cap;
    left -= cap;
    if (left <= 0) break;
  }
  if (left > 0) out.water += left;
  return [out];
}

const rngSource = makeRng(1);
const ctx = { now: 0, rng: rngSource };
const choiceCounts = {};
function apply(state, seat, action) {
  const r = seasons.reduce(state, seat, action, ctx);
  if (!r.ok) throw new Error(`${action.type} → ${r.code} ${JSON.stringify(state.pendingChoice)}`);
  return r.state;
}

let failed = 0;
for (let game = 0; game < GAMES; game++) {
  const seed = 1000 + game;
  try {
    let state = seasons.setup(PLAYERS, optionsFor(seed), makeRng(seed));
    let guard = 0;
    while (state.phase !== 'ended' && guard++ < 20000) {
      checkInvariants(state, `game=${seed} step=${guard}`);
      if (state.pendingChoice) {
        const kind = state.pendingChoice.kind;
        choiceCounts[kind] = (choiceCounts[kind] ?? 0) + 1;
        const seat = state.pendingChoice.choosingSeat;
        let resolved = null;
        let lastError = null;
        for (const choice of candidates(state)) {
          const r = seasons.reduce(state, seat, { type: 'resolve-choice', choice }, ctx);
          if (r.ok) { resolved = r.state; break; }
          lastError = r.code;
        }
        if (!resolved) {
          console.error('PENDING', JSON.stringify(state.pendingChoice), 'ENERGIES', JSON.stringify(state.players[seat].energies), 'CRYSTALS', state.players[seat].crystals, 'MAX', state.players[seat].maxEnergy);
          throw new Error(`resolve-choice 全部候选失败：${lastError}`);
        }
        state = resolved;
        continue;
      }
      if (state.phase === 'draft') {
        const seat = state.players.findIndex((p) => p.drafted.length === state.draftRound);
        state = apply(state, seat, { type: 'draft-pick', cardUid: state.players[seat].draftHand[0].u });
        continue;
      }
      if (state.phase === 'organize') {
        const seat = state.players.findIndex((p) => !p.organizeDone);
        const me = state.players[seat];
        const taken = new Set(me.organizeYear1);
        const uids = me.drafted.filter((card) => !taken.has(card.u)).slice(0, 3).map((card) => card.u);
        state = apply(state, seat, { type: 'organize', cardUids: uids });
        continue;
      }
      if (state.turnOwner === null) {
        const seat = state.currentPicker;
        state = apply(state, seat, { type: 'draft-dice', dieIndex: state.season.dice.findIndex((d) => d.pickedBy === null) });
        continue;
      }
      const seat = state.turnOwner;
      let summoned = false;
      for (const card of state.players[seat].hand) {
        const r = seasons.reduce(state, seat, { type: 'summon', cardUid: card.u }, ctx);
        if (r.ok) { state = r.state; summoned = true; break; }
      }
      if (!summoned) state = apply(state, seat, { type: 'end-turn' });
    }
    if (state.phase !== 'ended') throw new Error(`未结束 guard=${guard}`);
    checkInvariants(state, `game=${seed} end`);
    if (!state.result || state.result.players.length !== PLAYERS) throw new Error('终局结果缺失');
  } catch (error) {
    failed++;
    console.error(`✗ 第 ${seed} 局：${error.message}`);
    if (failed >= 5) break;
  }
}
if (failed > 0) {
  console.error(`\n✗ ${failed} 局失败（已跑 ${GAMES} 局）`);
  process.exitCode = 1;
} else {
  console.log(`OK ${GAMES} 局（${PLAYERS} 人）全部通过不变式检查`);
  console.log(`选择分布 ${JSON.stringify(choiceCounts)}`);
}
