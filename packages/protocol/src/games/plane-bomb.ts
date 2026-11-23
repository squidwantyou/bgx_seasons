import { z } from 'zod';
import type { GameCatalog } from '../index.js';

/** “已坠落飞机再次被炸”的两种返回方式。 */
export type DownedPlaneHit = 'body' | 'miss';

export const planeBombOptionsSchema = z
  .object({
    downedPlaneHit: z.enum(['body', 'miss']),
  })
  .strict();

export type PlaneBombOptions = z.infer<typeof planeBombOptionsSchema>;

export const planeBombDefaultOptions: PlaneBombOptions = { downedPlaneHit: 'body' };

export const planeBombCatalog: GameCatalog = {
  id: 'plane-bomb',
  name: '炸飞机',
  tagline: '秘密布阵，同轮对轰，击落对方三架飞机者胜（同轮 3:3 平局）',
  description:
    '在线炸飞机对局：10×10 海域秘密布阵，双方同轮报点、同时结算，先击落三架者胜。',
  minPlayers: 2,
  maxPlayers: 2,
  rules: [
    '各自秘密摆放三架“士”字形飞机，可以旋转。',
    '每轮双方同时报一个格子，都报完后同时结算。',
    '炸中机头即击落该机；已击落的飞机，炸中机身按本局设置结算。',
    '先击落对方三架者胜；同轮双方都到三架则平局。',
  ],
  options: [
    {
      id: 'downedPlaneHit',
      label: '已坠落飞机再次被炸',
      description: '选择已击落飞机的机身再次被炸时，返回“炸中”还是“炸空”。',
      default: 'body',
      choices: [
        { value: 'body', label: '返回炸中', description: '传统规则：机身仍算命中。' },
        { value: 'miss', label: '返回炸空', description: '机身已随飞机坠毁，不再算命中。' },
      ],
    },
  ],
};

/** 炸飞机：0 未炸；1 炸空；2 命中机身；3 命中机头（该机击落） */
export type ShotMark = 0 | 1 | 2 | 3;
export type ShotResult = 'miss' | 'body' | 'cockpit';
/** 0 上、1 右、2 下、3 左 */
export type Orientation = 0 | 1 | 2 | 3;

export interface PlanePlacementInput {
  cockpit: number;
  orientation: Orientation;
}

export interface PlanePlacement extends PlanePlacementInput {
  /** 10 个占格（含机头），升序、去重 */
  cells: number[];
}

/** 一次已经结算的报点（公开信息） */
export interface ShotRecord {
  seat: number;
  cell: number;
  result: ShotResult;
  downed: boolean;
}

export interface PlaneBombGameView {
  phase: 'placing' | 'battle' | 'finished';
  placed: [boolean, boolean];
  /** placing 为 0，battle 从 1 开始 */
  round: number;
  /** 本轮双方是否已经报点；只有布尔值，不含格子 */
  pendingShots: [boolean, boolean];
  /** 本人本轮已报的格子；观战者、未报点或已结算时为 null */
  myShot: number | null;
  mine: {
    planes: (PlanePlacement & { down: boolean })[];
    incoming: ShotMark[];
  } | null;
  enemy: { marks: ShotMark[]; down: number } | null;
  spectate: {
    boards: { seat: number; marks: ShotMark[]; down: number; placed: boolean }[];
  } | null;
  down: [number, number];
  shots: [number, number];
  lastRound: { round: number; shots: ShotRecord[] } | null;
  reveal: { seat: number; planes: PlanePlacement[] }[] | null;
  finished: boolean;
  winner: number | null;
  draw: boolean;
}

export type PlaneBombAction =
  | { type: 'place'; planes: [PlanePlacementInput, PlanePlacementInput, PlanePlacementInput] }
  | { type: 'fire'; cell: number }
  | { type: 'resign' };

const orientationSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const planePlacementSchema = z.object({
  cockpit: z.number().int().min(0).max(99),
  orientation: orientationSchema,
});

export const planeBombActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('place'),
    planes: z.tuple([planePlacementSchema, planePlacementSchema, planePlacementSchema]),
  }),
  z.object({ type: z.literal('fire'), cell: z.number().int().min(0).max(99) }),
  z.object({ type: z.literal('resign') }),
]);
