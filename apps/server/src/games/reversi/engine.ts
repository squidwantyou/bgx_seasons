import type { GameEvent, RandomSource } from '@bgx/protocol';
import type {
  Cell,
  ReversiAction,
  ReversiGameView,
  ReversiOptions,
} from '@bgx/protocol/games/reversi';
import type { GameEngine, ReduceResult } from '../types.js';

export interface ReversiState {
  board: Cell[];
  turn: 1 | 2;
  lastMove: { cell: number; seat: number } | null;
  /** 连续被迫 pass 的次数（对手无子可下） */
  passes: number;
  moveCount: number;
  finished: boolean;
  winner: number | null;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function initialBoard(): Cell[] {
  const board: Cell[] = new Array<Cell>(64).fill(0);
  // 标准开局：d4/e5 白，e4/d5 黑，黑先
  board[3 * 8 + 3] = 2;
  board[3 * 8 + 4] = 1;
  board[4 * 8 + 3] = 1;
  board[4 * 8 + 4] = 2;
  return board;
}

/** 返回在 cell 落子后会被翻转的格子；非法则为空数组 */
export function flipsFor(board: Cell[], cell: number, player: 1 | 2): number[] {
  if (cell < 0 || cell > 63 || board[cell] !== 0) return [];
  const r0 = Math.floor(cell / 8);
  const c0 = cell % 8;
  const flips: number[] = [];

  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const line: number[] = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === 3 - player) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (
      line.length > 0 &&
      r >= 0 && r < 8 && c >= 0 && c < 8 &&
      board[r * 8 + c] === player
    ) {
      flips.push(...line);
    }
  }
  return flips;
}

export function legalMoves(board: Cell[], player: 1 | 2): number[] {
  const moves: number[] = [];
  for (let cell = 0; cell < 64; cell++) {
    if (board[cell] === 0 && flipsFor(board, cell, player).length > 0) moves.push(cell);
  }
  return moves;
}

function hasMoves(board: Cell[], player: 1 | 2): boolean {
  return legalMoves(board, player).length > 0;
}

function count(board: Cell[]): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (const cell of board) {
    if (cell === 1) black++;
    else if (cell === 2) white++;
  }
  return { black, white };
}

function winnerOf(board: Cell[]): number | null {
  const { black, white } = count(board);
  if (black === white) return null;
  return black > white ? 0 : 1;
}

function fail(code: string, message: string): ReduceResult<ReversiState> {
  return { ok: false, code, message };
}

export const reversi: GameEngine<
  ReversiState,
  ReversiGameView,
  ReversiAction,
  ReversiOptions
> = {
  setup(_playerCount: number, _options: ReversiOptions, _rng: RandomSource): ReversiState {
    return {
      board: initialBoard(),
      turn: 1,
      lastMove: null,
      passes: 0,
      moveCount: 0,
      finished: false,
      winner: null,
    };
  },

  reduce(state, seat, action): ReduceResult<ReversiState> {
    if (state.finished) return fail('game_over', '这局已经结束了');

    // 认输不受回合限制：轮到对方时也可以随时认输
    if (action.type === 'resign') {
      const events: GameEvent[] = [
        { type: 'resign', seat },
        { type: 'game_over', winner: 1 - seat, scores: count(state.board) },
      ];
      return {
        ok: true,
        state: { ...state, finished: true, winner: 1 - seat },
        events,
      };
    }

    if (state.turn - 1 !== seat) return fail('not_your_turn', '还没轮到你');
    if (action.type !== 'move') return fail('bad_action', '不认识的动作');

    const player = state.turn;
    const flips = flipsFor(state.board, action.cell, player);
    if (flips.length === 0) return fail('illegal_move', '这个位置不能落子');

    const board = state.board.slice();
    board[action.cell] = player;
    for (const f of flips) board[f] = player;

    const me = player;
    const opponent = (3 - player) as 1 | 2;
    let next: 1 | 2 = opponent;
    let passes = 0;
    let finished = false;
    const events: GameEvent[] = [
      { type: 'move', seat, cell: action.cell, flips, scores: count(board) },
    ];

    if (!hasMoves(board, opponent)) {
      if (hasMoves(board, me)) {
        // 对手无子可下，自己继续下
        next = me;
        passes = state.passes + 1;
        events.push({ type: 'pass', seat: opponent - 1 });
      } else {
        finished = true;
      }
    }

    const scores = count(board);
    let winner: number | null = null;
    if (finished) {
      winner = winnerOf(board);
      events.push({ type: 'game_over', winner, scores });
    }

    return {
      ok: true,
      state: {
        board,
        turn: next,
        lastMove: { cell: action.cell, seat },
        passes,
        moveCount: state.moveCount + 1,
        finished,
        winner,
      },
      events,
    };
  },

  view(state, viewerSeat, active): ReversiGameView {
    const legal =
      active && !state.finished && viewerSeat !== null && state.turn - 1 === viewerSeat
        ? legalMoves(state.board, state.turn)
        : [];
    return {
      board: state.board.slice(),
      turn: state.turn,
      legal,
      scores: count(state.board),
      lastMove: state.lastMove,
      passes: state.passes,
      moveCount: state.moveCount,
      finished: state.finished,
      winner: state.winner,
    };
  },

  resignable: (state) => !state.finished,
  rankings: (state) => {
    if (!state.finished) return [];
    if (state.winner === null) return [
      { seat: 0, rank: 1 },
      { seat: 1, rank: 1 },
    ];
    return [
      { seat: state.winner, rank: 1 },
      { seat: 1 - state.winner, rank: 2 },
    ];
  },
  finished: (state) => state.finished,
  winner: (state) => state.winner,
  turn: (state) => (state.finished ? null : state.turn - 1),
};
