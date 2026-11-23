import type { GameEvent, RandomSource } from '@bgx/protocol';
import {
  planeBombDefaultOptions,
  type Orientation,
  type PlaneBombAction,
  type PlaneBombGameView,
  type PlaneBombOptions,
  type PlanePlacement,
  type PlanePlacementInput,
  type ShotMark,
  type ShotRecord,
  type ShotResult,
} from '@bgx/protocol/games/plane-bomb';
import type { GameEngine, ReduceResult } from '../types.js';

type Seat = 0 | 1;
type Phase = 'placing' | 'battle' | 'finished';

export interface PlaneBombState {
  /** 本局开局选项（随开局确定，不随后续动作改变） */
  options: PlaneBombOptions;
  phase: Phase;
  placed: [boolean, boolean];
  fleets: [PlanePlacement[] | null, PlanePlacement[] | null];
  /** marks[owner][cell]：对方炸在 owner 棋盘上的结果 */
  marks: [ShotMark[], ShotMark[]];
  /** placing 为 0；battle 从 1 开始 */
  round: number;
  /** 本轮双方已经报出的格子；尚未报为 null。这个字段绝不进 view。 */
  pending: [number | null, number | null];
  lastRound: { round: number; shots: ShotRecord[] } | null;
  winner: Seat | null;
  moveCount: number;
}

/** 朝上时的方向；旋转只改变这组向量的方向。 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

const ORIENTATION_NAMES = ['上', '右', '下', '左'] as const;

export function cellLabel(cell: number): string {
  const row = Math.floor(cell / 10) + 1;
  const col = String.fromCharCode(65 + (cell % 10));
  return `${col}${row}`;
}

export function isValidOrientation(value: unknown): value is Orientation {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/**
 * 以机头为锚点，按朝向生成 10 个占格（含机头），升序去重。
 * 越界返回 null。形状：机头 1 格；向后一行机翼 5 格；再后一行机身 1 格；
 * 最后一行机尾 3 格。
 */
export function footprintOf(cockpit: number, orientation: Orientation): number[] | null {
  if (!Number.isInteger(cockpit) || cockpit < 0 || cockpit > 99) return null;
  if (!isValidOrientation(orientation)) return null;

  const [dr, dc] = DIRS[orientation]!;
  // backward = 机头相反方向；perpendicular = 侧向
  const br = -dr;
  const bc = -dc;
  const pr = dc;
  const pc = -dr;

  const r0 = Math.floor(cockpit / 10);
  const c0 = cockpit % 10;
  const offsets: [number, number][] = [[0, 0]];

  for (let k = -2; k <= 2; k += 1) {
    offsets.push([br + pr * k, bc + pc * k]);
  }
  offsets.push([2 * br, 2 * bc]);
  for (let k = -1; k <= 1; k += 1) {
    offsets.push([3 * br + pr * k, 3 * bc + pc * k]);
  }

  const cells: number[] = [];
  for (const [drr, dcc] of offsets) {
    const r = r0 + drr;
    const c = c0 + dcc;
    if (r < 0 || r > 9 || c < 0 || c > 9) return null;
    cells.push(r * 10 + c);
  }
  return [...new Set(cells)].sort((a, b) => a - b);
}

type PlacementResult =
  | { fleets: PlanePlacement[] }
  | { error: string };

export function validatePlacement(planes: readonly PlanePlacementInput[]): PlacementResult {
  if (!Array.isArray(planes) || planes.length !== 3) {
    return { error: '需要三架飞机' };
  }

  const cockpits = new Set<number>();
  const fleets: PlanePlacement[] = [];
  const used = new Map<number, number>();

  for (let i = 0; i < planes.length; i += 1) {
    const p = planes[i]!;
    if (!p || !Number.isInteger(p.cockpit) || p.cockpit < 0 || p.cockpit > 99) {
      return { error: `${i + 1} 号机机头不在棋盘内` };
    }
    if (!isValidOrientation(p.orientation)) {
      return { error: `${i + 1} 号机朝向非法（只能是上/右/下/左）` };
    }
    if (cockpits.has(p.cockpit)) {
      return { error: '三个机头必须互不相同' };
    }
    cockpits.add(p.cockpit);

    const cells = footprintOf(p.cockpit, p.orientation);
    if (!cells) {
      return { error: `${i + 1} 号机（${cellLabel(p.cockpit)} 朝${ORIENTATION_NAMES[p.orientation]}）越界` };
    }
    for (const cell of cells) {
      const other = used.get(cell);
      if (other !== undefined) {
        return {
          error: `${other + 1} 号机与 ${i + 1} 号机在 ${cellLabel(cell)} 重叠`,
        };
      }
      used.set(cell, i);
    }
    fleets.push({ cockpit: p.cockpit, orientation: p.orientation, cells });
  }

  return { fleets };
}

function fail(code: string, message: string): ReduceResult<PlaneBombState> {
  return { ok: false, code, message };
}

function downOf(state: PlaneBombState, seat: Seat): number {
  const fleet = state.fleets[seat];
  if (!fleet) return 0;
  return fleet.filter((plane) => state.marks[seat]![plane.cockpit] === 3).length;
}

function countShots(marks: ShotMark[]): number {
  return marks.reduce<number>((n, mark) => n + (mark !== 0 ? 1 : 0), 0);
}

function isShotResult(mark: ShotMark): mark is 1 | 2 | 3 {
  return mark !== 0;
}

function markFor(result: ShotResult): ShotMark {
  return result === 'miss' ? 1 : result === 'body' ? 2 : 3;
}

/** 兼容旧对局：没有 options 字段的状态按默认规则处理。 */
export function optionsOf(state: PlaneBombState): PlaneBombOptions {
  return state.options ?? planeBombDefaultOptions;
}

function shotResult(
  fleet: PlanePlacement[],
  marks: ShotMark[],
  cell: number,
  options: PlaneBombOptions,
): ShotResult {
  const plane = fleet.find((p) => p.cells.includes(cell));
  if (!plane) return 'miss';
  if (plane.cockpit === cell) return 'cockpit';
  // 已坠落的飞机再次被炸：按本局选项返回“炸中”或“炸空”
  if (marks[plane.cockpit] === 3 && options.downedPlaneHit === 'miss') return 'miss';
  return 'body';
}

export function initialState(options: PlaneBombOptions = planeBombDefaultOptions): PlaneBombState {
  return {
    options,
    phase: 'placing',
    placed: [false, false],
    fleets: [null, null],
    marks: [new Array<ShotMark>(100).fill(0), new Array<ShotMark>(100).fill(0)],
    round: 0,
    pending: [null, null],
    lastRound: null,
    winner: null,
    moveCount: 0,
  };
}

function resolveRound(state: PlaneBombState): PlaneBombState {
  const p0 = state.pending[0]!;
  const p1 = state.pending[1]!;
  const shots: ShotRecord[] = ([0, 1] as Seat[]).map((seat) => {
    const cell = seat === 0 ? p0 : p1;
    const owner = (1 - seat) as Seat;
    const fleet = state.fleets[owner]!;
    const result = shotResult(fleet, state.marks[owner]!, cell, optionsOf(state));
    return { seat, cell, result, downed: result === 'cockpit' };
  });

  const marks: [ShotMark[], ShotMark[]] = [state.marks[0].slice(), state.marks[1].slice()];
  for (const shot of shots) {
    const owner = (1 - shot.seat) as Seat;
    marks[owner]![shot.cell] = markFor(shot.result);
  }

  const after: PlaneBombState = { ...state, marks };
  const down: [number, number] = [downOf(after, 0), downOf(after, 1)];
  const draw = down[0] >= 3 && down[1] >= 3;
  const finished = draw || down[0] >= 3 || down[1] >= 3;
  // down[i] 是座位 i 被击落的架数，所以先到 3 的一方是对方的胜利
  const winner: Seat | null = draw
    ? null
    : down[0] >= 3
      ? 1
      : down[1] >= 3
        ? 0
        : null;

  return {
    ...state,
    marks,
    pending: [null, null],
    lastRound: { round: state.round, shots },
    round: finished ? state.round : state.round + 1,
    phase: finished ? 'finished' : 'battle',
    winner,
    moveCount: state.moveCount + 1,
  };
}

export const planeBomb: GameEngine<
  PlaneBombState,
  PlaneBombGameView,
  PlaneBombAction,
  PlaneBombOptions
> = {
  setup(playerCount: number, options: PlaneBombOptions, _rng: RandomSource): PlaneBombState {
    if (playerCount !== 2) throw new Error('plane-bomb requires 2 players');
    return initialState(options);
  },

  reduce(
    state: PlaneBombState,
    seat: number,
    action: PlaneBombAction,
    _ctx: { now: number; rng: RandomSource },
  ): ReduceResult<PlaneBombState> {
    if (state.phase === 'finished') return fail('game_over', '这局已经结束了');
    if (seat !== 0 && seat !== 1) return fail('bad_action', '座位号不正确');

    if (action.type === 'resign') {
      const winner = (1 - seat) as Seat;
      const events: GameEvent[] = [
        { type: 'resign', seat },
        {
          type: 'game_over',
          winner,
          down: [downOf(state, 0), downOf(state, 1)],
          draw: false,
        },
      ];
      return {
        ok: true,
        state: {
          ...state,
          phase: 'finished',
          pending: [null, null],
          winner,
          moveCount: state.moveCount + 1,
        },
        events,
      };
    }

    if (action.type === 'place') {
      if (state.phase !== 'placing') return fail('bad_phase', '已经开打了，不能重新布阵');
      const validated = validatePlacement(action.planes);
      if ('error' in validated) return fail('invalid_placement', validated.error);

      const fleets: [PlanePlacement[] | null, PlanePlacement[] | null] = [
        state.fleets[0],
        state.fleets[1],
      ];
      fleets[seat] = validated.fleets;
      const placed: [boolean, boolean] = [state.placed[0], state.placed[1]];
      placed[seat] = true;

      const events: GameEvent[] = [{ type: 'plane_placed', seat }];
      const both = placed[0] && placed[1];
      if (both) events.push({ type: 'battle_started', round: 1 });

      return {
        ok: true,
        state: {
          ...state,
          fleets,
          placed,
          phase: both ? 'battle' : 'placing',
          round: both ? 1 : state.round,
          pending: [null, null],
          lastRound: null,
          moveCount: state.moveCount + 1,
        },
        events,
      };
    }

    if (action.type === 'fire') {
      if (state.phase !== 'battle') return fail('bad_phase', '还在布阵，不能开火');
      if (state.pending[seat] !== null) {
        return fail('already_queued', '本轮已经报过点了，等结算');
      }
      const cell = action.cell;
      if (!Number.isInteger(cell) || cell < 0 || cell > 99) {
        return fail('bad_action', '格子不在棋盘内');
      }
      if (state.marks[(1 - seat) as Seat][cell] !== 0) {
        return fail('cell_already_shot', '这个格子已经炸过了');
      }

      const pending: [number | null, number | null] = [state.pending[0], state.pending[1]];
      pending[seat] = cell;

      const opponentQueued = pending[(1 - seat) as Seat] !== null;
      if (!opponentQueued) {
        return {
          ok: true,
          state: { ...state, pending, moveCount: state.moveCount + 1 },
          events: [{ type: 'shot_queued', seat }],
        };
      }

      const next = resolveRound({ ...state, pending });
      const events: GameEvent[] = [
        { type: 'shot_queued', seat },
        { type: 'round_resolved', round: state.round, shots: next.lastRound!.shots },
      ];
      if (next.phase === 'finished') {
        events.push({
          type: 'game_over',
          winner: next.winner,
          down: [downOf(next, 0), downOf(next, 1)],
          draw: next.winner === null,
        });
      }
      return { ok: true, state: next, events };
    }

    return fail('bad_action', '不认识的动作');
  },

  resignable: (state) => state.phase !== 'finished',

  rankings: (state) => {
    if (state.phase !== 'finished') return [];
    if (state.winner === null) return [
      { seat: 0, rank: 1 },
      { seat: 1, rank: 1 },
    ];
    return [
      { seat: state.winner, rank: 1 },
      { seat: 1 - state.winner, rank: 2 },
    ];
  },

  view(state: PlaneBombState, viewerSeat: number | null, _active: boolean): PlaneBombGameView {
    const finished = state.phase === 'finished';
    const down: [number, number] = [downOf(state, 0), downOf(state, 1)];
    const reveal = finished
      ? [
          { seat: 0, planes: state.fleets[0] ?? [] },
          { seat: 1, planes: state.fleets[1] ?? [] },
        ]
      : null;

    const base = {
      phase: state.phase,
      placed: state.placed,
      round: state.round,
      pendingShots: [state.pending[0] !== null, state.pending[1] !== null] as [
        boolean,
        boolean,
      ],
      down,
      shots: [countShots(state.marks[1]), countShots(state.marks[0])] as [number, number],
      lastRound: state.lastRound,
      reveal,
      finished,
      winner: finished ? state.winner : null,
      draw: finished && state.winner === null,
    };

    if (viewerSeat === null) {
      return {
        ...base,
        myShot: null,
        mine: null,
        enemy: null,
        spectate: {
          boards: [
            {
              seat: 0,
              marks: state.marks[0],
              down: down[0],
              placed: state.placed[0],
            },
            {
              seat: 1,
              marks: state.marks[1],
              down: down[1],
              placed: state.placed[1],
            },
          ],
        },
      };
    }

    const seat = (viewerSeat === 0 ? 0 : 1) as Seat;
    const ownFleet = state.fleets[seat];
    const planes = ownFleet
      ? ownFleet.map((plane) => ({
          ...plane,
          down: state.marks[seat]![plane.cockpit] === 3,
        }))
      : [];

    return {
      ...base,
      myShot: state.pending[seat],
      mine: { planes, incoming: state.marks[seat]! },
      enemy: { marks: state.marks[(1 - seat) as Seat]!, down: down[(1 - seat) as Seat]! },
      spectate: null,
    };
  },

  finished(state: PlaneBombState): boolean {
    return state.phase === 'finished';
  },

  winner(state: PlaneBombState): number | null {
    return state.winner;
  },

  turn(): number | null {
    return null;
  },
};

