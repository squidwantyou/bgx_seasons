#!/usr/bin/env node
/**
 * 四季物语「前端动作契约」冒烟：只用 Panel 会发出的动作形状，从轮抽打到终局。
 *
 * 不是浏览器 e2e（仓库里没有 Playwright/Chromium，见 migration.md §12），
 * 但它保证「UI 能点的按钮」在规则层全部合法、且整局能自行走完。
 * 用法：先 `pnpm --filter @bgx/server build`，再 `node scripts/seasons-ui-flow.mjs`。
 */
import { seasons } from '../dist/games/seasons/engine.js';

const opts = { extensions: ['base'] };
function rng(seed) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return { next, int: (max) => Math.floor(next() * max), pick: (a) => a[Math.floor(next() * a.length)], shuffle: (a) => [...a].sort(() => next() - 0.5) };
}

let state = seasons.setup(2, opts, rng(20261121));
const ctxOf = (seat) => ({ now: 0, rng: rng(seat + 1), seat });
const apply = (seat, action) => {
  const res = seasons.reduce(state, seat, action, ctxOf(seat));
  if (!res.ok) throw new Error(`动作被拒（座位 ${seat}）：${JSON.stringify(action)} → ${res.code} ${res.message}`);
  state = res.state;
  return state;
};

const ELEMENTS = ['water', 'air', 'fire', 'earth'];
/** 前端 ChoiceModal 会发出的选择形状（渲染顺序无关，只求合法）。 */
function choicesOf(state) {
  const pending = state.pendingChoice;
  const seat = pending.choosingSeat;
  const me = state.players[seat];
  const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 1;
  const alloc = (count) => {
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    for (let i = 0; i < count; i += 1) out[ELEMENTS[i % ELEMENTS.length]] += 1;
    return out;
  };
  if (pending.kind === 'energy_discard') {
    const amount = typeof pending.options.amount === 'number' ? pending.options.amount : 0;
    const available = pending.options.available ?? {};
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    let left = amount;
    for (const el of ELEMENTS) { const take = Math.min(available[el] ?? 0, left); out[el] = take; left -= take; }
    return [out];
  }
  if (pending.kind === 'energy_swap') {
    const total = typeof pending.options.total === 'number' ? pending.options.total : 0;
    const out = { water: 0, air: 0, fire: 0, earth: 0 };
    out[ELEMENTS[0]] = total;
    return [out];
  }
  if (pending.kind === 'branch') return (pending.options.branches ?? []).map((branch) => ({ id: branch.id }));
  if (pending.kind === 'month_advance') return [{ direction: 'forward', steps: 1 }];
  if (pending.kind === 'element_multi') {
    return [(pending.options.elements ?? []).map((item) => item.element)];
  }
  if (pending.kind === 'element_pick') {
    return ELEMENTS.filter((element) => me.energies[element] > 0).map((element) => ({ element }));
  }
  if (pending.kind === 'card_pick') {
    const pool = pending.options.purpose === 'discard' ? me.hand : (state.pendingCards ?? []);
    return pool.map((card) => ({ uid: card.u }));
  }
  if (pending.kind === 'card_list') {
    const cards = state.pendingCards ?? [];
    const keep = typeof pending.options.keep === 'number' ? pending.options.keep : 1;
    return keep === 1 ? cards.map((card) => [card.u]) : [cards.slice(0, keep).map((card) => card.u)];
  }
  if (pending.kind === 'multi_player_pick') return me.played.map((card) => ({ uid: card.u }));
  if (pending.kind === 'sacrifice_cards') return me.played.map((card) => card.u);
  return [alloc(amount)];
}

let steps = 0;
while (!seasons.finished(state) && steps++ < 5000) {
  if (state.pendingChoice) {
    const seat = state.pendingChoice.choosingSeat;
    let done = false;
    for (const choice of choicesOf(state)) {
      const res = seasons.reduce(state, seat, { type: 'resolve-choice', choice }, ctxOf(seat));
      if (res.ok) {
        state = res.state;
        done = true;
        break;
      }
    }
    if (!done) throw new Error(`resolve-choice 无合法候选：${JSON.stringify(state.pendingChoice)}`);
  } else if (state.phase === 'draft') {
    const seat = state.players.find((p) => p.drafted.length === state.draftRound).seat;
    const hand = state.players[seat].draftHand;
    apply(seat, { type: 'draft-pick', cardUid: hand[0].u });
  } else if (state.phase === 'organize') {
    const seat = state.players.find((p) => !p.organizeDone).seat;
    const drafted = state.players[seat].drafted;
    const placed = new Set([...(state.players[seat].organizeYear1 ?? []), ...(state.players[seat].organizeYear2 ?? [])]);
    const rest = drafted.filter((card) => !placed.has(card.u)).slice(0, 3);
    apply(seat, { type: 'organize', cardUids: rest.map((card) => card.u) });
  } else if (state.phase === 'play') {
    if (state.turnOwner === null) {
      const seat = state.currentPicker;
      const dieIndex = state.season.dice.findIndex((die) => die.pickedBy === null);
      apply(seat, { type: 'draft-dice', dieIndex });
    } else {
      apply(state.turnOwner, { type: 'end-turn' });
    }
  }
}

if (!seasons.finished(state)) throw new Error('对局未在 5000 步内结束');
const view = seasons.view(state, null, false);
const scores = view.result.players.map((p) => `${p.seat}:${p.score}`).join(' ');
console.log(`OK 终局：${scores}，winner=${view.result.winner}，log=${state.log.length} 条`);
