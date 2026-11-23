import { describe, expect, it } from 'vitest';
import { flipsFor, initialBoard, legalMoves, reversi, type ReversiState } from './engine.js';
import { createRng } from '../../random.js';

const rng = createRng('reversi-test');
const ctx = { now: 0, rng };

describe('reversi engine', () => {
  it('标准开局：黑白各 4 个合法落点', () => {
    const board = initialBoard();
    expect(board.filter((c) => c === 1)).toHaveLength(2);
    expect(board.filter((c) => c === 2)).toHaveLength(2);
    expect(legalMoves(board, 1)).toHaveLength(4);
    expect(legalMoves(board, 2)).toHaveLength(4);
  });

  it('落子后翻转被夹住的棋子并交换行动方', () => {
    const state = reversi.setup(2, {}, rng);
    const cell = legalMoves(state.board, 1)[0];
    const flips = flipsFor(state.board, cell, 1);
    expect(flips.length).toBeGreaterThan(0);

    const result = reversi.reduce(state, 0, { type: 'move', cell }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.board[cell]).toBe(1);
    for (const f of flips) expect(result.state.board[f]).toBe(1);
    expect(result.state.turn).toBe(2);
    expect(result.state.moveCount).toBe(1);
    expect(result.state.lastMove).toEqual({ cell, seat: 0 });
    expect(reversi.turn(result.state)).toBe(1);
  });

  it('拒绝非本人回合与非法位置', () => {
    const state = reversi.setup(2, {}, rng);
    const wrongTurn = reversi.reduce(state, 1, { type: 'move', cell: 19 }, ctx);
    expect(wrongTurn.ok).toBe(false);
    if (!wrongTurn.ok) expect(wrongTurn.code).toBe('not_your_turn');

    const illegal = reversi.reduce(state, 0, { type: 'move', cell: 0 }, ctx);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.code).toBe('illegal_move');
  });

  it('认输直接结束并判对方胜', () => {
    const result = reversi.reduce(reversi.setup(2, {}, rng), 0, { type: 'resign' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finished).toBe(true);
    expect(result.state.winner).toBe(1);
    expect(result.events.map((e) => e.type)).toContain('game_over');

    const after = reversi.reduce(result.state, 1, { type: 'move', cell: 19 }, ctx);
    expect(after.ok).toBe(false);
  });

  it('轮到对方时也可以认输', () => {
    const state = reversi.setup(2, {}, rng);
    const first = reversi.reduce(state, 0, { type: 'move', cell: legalMoves(state.board, 1)[0] }, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const resign = reversi.reduce(first.state, 0, { type: 'resign' }, ctx);
    expect(resign.ok).toBe(true);
    if (!resign.ok) return;
    expect(resign.state.winner).toBe(1);
  });

  it('随机对局必然收敛且不移除棋子总数异常', () => {
    let state: ReversiState = reversi.setup(2, {}, rng);
    let steps = 0;
    while (!state.finished && steps < 200) {
      const seat = reversi.turn(state);
      expect(seat).not.toBeNull();
      const moves = legalMoves(state.board, state.turn);
      expect(moves.length).toBeGreaterThan(0);
      const cell = moves[(steps * 7 + 3) % moves.length];
      const result = reversi.reduce(state, seat!, { type: 'move', cell }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      steps++;
    }
    expect(state.finished).toBe(true);
    expect(state.moveCount).toBe(steps);
    const occupied = state.board.filter((c) => c !== 0).length;
    const { black, white } = reversi.view(state, null, false).scores;
    expect(black + white).toBe(occupied);
    expect(steps).toBeLessThan(200);
  });
});
