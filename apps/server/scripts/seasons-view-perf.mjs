#!/usr/bin/env node
/**
 * view 计算耗时与体积（T4.5b）：
 * 从完整一局里取若干状态，反复调用 view() 计时，并统计单次 JSON 体积。
 * 用法：pnpm --filter @bgx/server build && node apps/server/scripts/seasons-view-perf.mjs
 */
import { seasons } from '../dist/games/seasons/engine.js';
import { BASE_CARD_BY_ID } from '../dist/games/seasons/cards/base.js';

const ELEMENTS = ['water', 'air', 'fire', 'earth'];
function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { next, int: (max) => Math.floor(next() * max), pick: (a) => a[Math.floor(next() * a.length)], shuffle: (a) => [...a].sort(() => next() - 0.5) };
}
const rng = makeRng(7);
const ctx = { now: 0, rng };
const apply = (s, seat, action) => {
  const r = seasons.reduce(s, seat, action, ctx);
  if (!r.ok) throw new Error(`${action.type}: ${r.code}`);
  return r.state;
};
let state = seasons.setup(2, { extensions: ['base'] }, makeRng(99));
const samples = [];
let guard = 0;
while (state.phase !== 'ended' && guard++ < 20000) {
  samples.push(state);
  if (state.pendingChoice) {
    const seat = state.pendingChoice.choosingSeat;
    const p = state.pendingChoice;
    const me = state.players[seat];
    let choices = [];
    if (p.kind === 'branch') choices = (p.options.branches ?? []).map((b) => ({ id: b.id }));
    else if (p.kind === 'month_advance') choices = [{ direction: 'forward', steps: 1 }];
    else if (p.kind === 'card_pick') {
      const pool = p.options.purpose === 'discard' ? me.hand : (state.pendingCards ?? []);
      choices = pool.map((card) => ({ uid: card.u }));
    } else if (p.kind === 'card_list') {
      choices = (state.pendingCards ?? []).map((card) => [card.u]);
    } else if (p.kind === 'multi_player_pick') choices = me.played.map((card) => ({ uid: card.u }));
    else if (p.kind === 'element_multi') choices = [(p.options.elements ?? []).map((item) => item.element)];
    else if (p.kind === 'element_pick') choices = ELEMENTS.filter((el) => me.energies[el] > 0).map((el) => ({ element: el }));
    else if (p.kind === 'sacrifice_cards') choices = me.played.map((card) => card.u);
    else if (p.kind === 'energy_discard') {
      const amount = typeof p.options.amount === 'number' ? p.options.amount : 0;
      const available = p.options.available ?? {};
      const out = { water: 0, air: 0, fire: 0, earth: 0 };
      let left = amount;
      for (const el of ELEMENTS) { const take = Math.min(available[el] ?? 0, left); out[el] = take; left -= take; }
      choices = [out];
    }
    else if (p.kind === 'energy_swap') {
      const total = typeof p.options.total === 'number' ? p.options.total : 0;
      choices = [{ water: total }];
    } else if (p.key === 'cost_reduce') {
      const cost = p.options.cost ?? {};
      const caps = p.options.maxPerElement ?? {};
      const order = [
        ...ELEMENTS.filter((el) => (cost[el] ?? 0) > (me.energies[el] ?? 0)),
        ...ELEMENTS.filter((el) => (cost[el] ?? 0) <= (me.energies[el] ?? 0)),
      ];
      const out = { water: 0, air: 0, fire: 0, earth: 0 };
      let left = typeof p.options.amount === 'number' ? p.options.amount : 1;
      for (const el of order) {
        if (left <= 0) break;
        const cap = Math.min(left, typeof caps[el] === 'number' ? caps[el] : 0);
        out[el] += cap;
        left -= cap;
      }
      choices = [out];
    } else {
      const amount = typeof p.options.amount === 'number' ? p.options.amount : 1;
      const caps = p.options.maxPerElement ?? {};
      const out = { water: 0, air: 0, fire: 0, earth: 0 };
      let left = amount;
      for (const el of ELEMENTS) {
        const cap = Math.min(left, typeof caps[el] === 'number' ? caps[el] : left);
        out[el] = cap;
        left -= cap;
        if (left <= 0) break;
      }
      choices = [out];
    }
    let next = null;
    for (const choice of choices) {
      const r = seasons.reduce(state, seat, { type: 'resolve-choice', choice }, ctx);
      if (r.ok) { next = r.state; break; }
    }
    if (!next) throw new Error('resolve-choice 全部候选失败');
    state = next;
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
    state = apply(state, seat, { type: 'organize', cardUids: me.drafted.filter((c) => !taken.has(c.u)).slice(0, 3).map((c) => c.u) });
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

const pick = samples.filter((_, index) => index % 5 === 0).slice(0, 60);
const sizes = [];
const ROUNDS = 50;
let views = 0;
const start = process.hrtime.bigint();
for (let round = 0; round < ROUNDS; round++) {
  for (const sample of pick) {
    for (const seat of [0, 1, null]) {
      const view = seasons.view(sample, seat);
      views++;
      if (round === 0) sizes.push(JSON.stringify(view).length);
    }
  }
}
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
sizes.sort((a, b) => a - b);
console.log(JSON.stringify({
  states: pick.length,
  views,
  totalMs: Number(elapsedMs.toFixed(2)),
  avgViewMs: Number((elapsedMs / views).toFixed(4)),
  viewJsonAvg: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
  viewJsonMax: sizes.at(-1),
}));
