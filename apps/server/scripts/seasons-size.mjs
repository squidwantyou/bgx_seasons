import { seasons } from '../dist/games/seasons/engine.js';
import { BASE_CARD_BY_ID } from '../dist/games/seasons/cards/base.js';

function rng(seed) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return {
    next,
    int: (max) => Math.floor(next() * max),
    pick: (a) => a[Math.floor(next() * a.length)],
    shuffle: (a) => [...a].sort(() => next() - 0.5),
  };
}
const rngSource = rng(20261121);
const ctx = { now: 0, rng: rngSource };
let state = seasons.setup(2, {}, rngSource);
const apply = (s, seat, action) => {
  const r = seasons.reduce(s, seat, action, ctx);
  if (!r.ok) {
    console.error('FAIL', action.type, r.code, JSON.stringify(s.pendingChoice));
    throw new Error(`${action.type}: ${r.code}`);
  }
  return r.state;
};
const draftAll = (s) => {
  let st = s;
  while (st.phase === 'draft') {
    for (const seat of [0, 1]) {
      const card = st.players[seat].draftHand[0];
      st = apply(st, seat, { type: 'draft-pick', cardUid: card.u });
    }
  }
  return st;
};
state = draftAll(state);
while (state.phase === 'organize') {
  const seat = state.players.findIndex((p) => !p.organizeDone);
  const me = state.players[seat];
  const uids = me.drafted.slice(0, 3).map((c) => c.u);
  state = apply(state, seat, { type: 'organize', cardUids: uids });
}
let sizes = [];
let guard = 0;
while (state.phase !== 'ended' && guard < 20000) {
  guard++;
  sizes.push(JSON.stringify(state).length);
  if (state.pendingChoice) {
    const p = state.pendingChoice;
    const seat = p.choosingSeat;
    if (p.kind === 'branch') {
      state = apply(state, seat, { type: 'resolve-choice', choice: { id: p.options.branches[0].id } });
    } else if (p.kind === 'month_advance') {
      state = apply(state, seat, { type: 'resolve-choice', choice: { direction: 'forward', steps: 1 } });
    } else if (p.kind === 'card_pick') {
      const uid = p.options.purpose === 'discard' ? state.players[seat].hand[0].u : state.pendingCards[0].u;
      state = apply(state, seat, { type: 'resolve-choice', choice: { uid } });
    } else if (p.kind === 'card_list') {
      state = apply(state, seat, { type: 'resolve-choice', choice: [state.pendingCards[0].u] });
    } else if (p.kind === 'multi_player_pick') {
      const me = state.players[seat];
      const target =
        me.played.find((card) => BASE_CARD_BY_ID.get(card.i)?.type === 'magic_item') ??
        me.played.find((card) => BASE_CARD_BY_ID.get(card.i)?.type === 'familiar') ??
        me.played[0];
      state = apply(state, seat, { type: 'resolve-choice', choice: { uid: target.u } });
    } else if (p.kind === 'element_multi') {
      const elements = (p.options.elements ?? []).map((item) => item.element);
      state = apply(state, seat, { type: 'resolve-choice', choice: elements });
    } else if (p.kind === 'element_pick') {
      const me = state.players[seat];
      const element = ['water', 'air', 'fire', 'earth'].find((el) => me.energies[el] > 0) ?? 'water';
      state = apply(state, seat, { type: 'resolve-choice', choice: { element } });
    } else if (p.kind === 'sacrifice_cards') {
      state = apply(state, seat, { type: 'resolve-choice', choice: state.players[seat].played[0].u });
    } else if (p.kind === 'energy_discard') {
      const amount = typeof p.options.amount === 'number' ? p.options.amount : 0;
      const available = p.options.available ?? {};
      const out = { water: 0, air: 0, fire: 0, earth: 0 };
      let left = amount;
      for (const el of ELEMENTS) { const take = Math.min(available[el] ?? 0, left); out[el] = take; left -= take; }
      state = apply(state, seat, { type: 'resolve-choice', choice: out });
    } else if (p.kind === 'energy_swap') {
      const total = typeof p.options.total === 'number' ? p.options.total : 0;
      state = apply(state, seat, { type: 'resolve-choice', choice: { water: total } });
    } else {
      const amount = typeof p.options.amount === 'number' ? p.options.amount : 0;
      state = apply(state, seat, { type: 'resolve-choice', choice: { water: amount } });
    }
    continue;
  }
  if (state.turnOwner === null) {
    const seat = state.currentPicker;
    const idx = state.season.dice.findIndex((d) => d.pickedBy === null);
    state = apply(state, seat, { type: 'draft-dice', dieIndex: idx });
    continue;
  }
  const seat = state.turnOwner;
  let summoned = false;
  for (const card of state.players[seat].hand) {
    const def = BASE_CARD_BY_ID.get(card.i);
    if (!def) continue;
    const r = seasons.reduce(state, seat, { type: 'summon', cardUid: card.u }, ctx);
    if (r.ok) { state = r.state; summoned = true; break; }
  }
  if (!summoned) {
    const r = seasons.reduce(state, seat, { type: 'end-turn' }, ctx);
    if (!r.ok) throw new Error('end-turn: ' + r.code);
    state = r.state;
  }
}
sizes.sort((a, b) => a - b);
const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
console.log(JSON.stringify({ steps: sizes.length, avg, p50: sizes[Math.floor(sizes.length / 2)], p95: sizes[Math.floor(sizes.length * 0.95)], max: sizes.at(-1), end: state.phase, month: state.month }));
