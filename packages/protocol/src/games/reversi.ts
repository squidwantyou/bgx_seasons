import { z } from 'zod';
import type { GameCatalog } from '../index.js';

export const reversiCatalog: GameCatalog = {
  id: 'reversi',
  name: '黑白棋',
  tagline: '夹住并翻转对方的棋子，终局子多者胜',
  description:
    '在线黑白棋对局：8×8 棋盘实时同步，服务端权威记录每一步，终局棋子多者胜。',
  minPlayers: 2,
  maxPlayers: 2,
  rules: [
    '黑棋先行，在能夹住对方棋子的位置落子。',
    '被夹住的棋子会翻成你的颜色。',
    '无子可下会自动跳过，双方都无子可下时结算。',
    '终局棋子多的一方获胜，同数则平局。',
  ],
  options: [],
};

/** 黑白棋目前没有开局选项；保留一个严格空 schema 给框架统一处理。 */
export const reversiOptionsSchema = z.object({}).strict();
export type ReversiOptions = z.infer<typeof reversiOptionsSchema>;

/** 0 = 空，1 = 黑，2 = 白 */
export type Cell = 0 | 1 | 2;

export interface ReversiGameView {
  board: Cell[];
  /** 1 = 黑，2 = 白 */
  turn: 1 | 2;
  /** 当前查看者可落子的格子；观战者/非己方回合为空 */
  legal: number[];
  scores: { black: number; white: number };
  lastMove: { cell: number; seat: number } | null;
  passes: number;
  moveCount: number;
  finished: boolean;
  winner: number | null;
}

export type ReversiAction =
  | { type: 'move'; cell: number }
  | { type: 'resign' };

export const reversiActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), cell: z.number().int().min(0).max(63) }),
  z.object({ type: z.literal('resign') }),
]);
