import type { ZodType } from 'zod';
import type { GameCatalog, GameEvent, GameOptionValues, RandomSource } from '@bgx/protocol';

export type ReduceResult<S> =
  | { ok: true; state: S; events: GameEvent[] }
  | { ok: false; code: string; message: string };

/**
 * 所有游戏引擎都实现这个接口。
 *
 * 约束：
 * - 必须是纯函数：不读写数据库、不发网络消息、不直接取时间。
 * - 优先在 setup() 使用注入的 rng，把随机结果写进状态；
 *   reduce() 也可以使用 ctx.rng（按 seed+seq 派生），但应保持可复现。
 * - view() 只返回该查看者可见的信息；隐藏信息绝不能出现在返回值里。
 * - reduce() 收到的是已经通过 actionSchema 校验的动作。
 */
export interface GameEngine<
  S = unknown,
  V = unknown,
  A = unknown,
  O extends GameOptionValues = GameOptionValues,
> {
  /** 创建初始状态；playerCount 是实际入座人数，options 是已校验的开局选项，rng 由框架按房间种子注入 */
  setup(playerCount: number, options: O, rng: RandomSource): S;
  /**
   * 由服务端在事务中调用；seat 从 0 开始。
   * ctx.rng 由框架按「房间种子 + 本次动作 seq」派生，保证重放时同一动作得到同一随机序列。
   * 仍建议优先在 setup 中消费随机数并把结果写进状态；reduce 中的随机只适合无状态随机判定。
   */
  reduce(
    state: S,
    seat: number,
    action: A,
    ctx: { now: number; rng: RandomSource },
  ): ReduceResult<S>;
  /** 该座位此刻是否允许认输；框架在调用 reduce 前检查 */
  resignable(state: S, seat: number): boolean;
  /** 按查看者裁剪视图；viewerSeat 为 null 表示观战者 */
  view(state: S, viewerSeat: number | null, active: boolean): V;
  finished(state: S): boolean;
  winner(state: S): number | null;
  /** 当前该行动的座位；无先后手/无人可动时返回 null */
  turn(state: S): number | null;
  /** 可选：终局名次；框架在 finished 时写入 match_rankings */
  rankings?(state: S): Array<{ seat: number; rank: number; score?: number }>;
}

/**
 * 一个可插拔游戏 = 目录信息 + 动作校验 + 纯函数引擎。
 * 服务端只依赖这个接口，不认识具体游戏类型。
 */
export interface GamePlugin<
  S = unknown,
  V = unknown,
  A = unknown,
  O extends GameOptionValues = GameOptionValues,
> extends GameEngine<S, V, A, O> {
  readonly meta: GameCatalog;
  readonly actionSchema: ZodType<A>;
  /** 写入 match_events.type 的动作名；框架不解释具体动作。 */
  readonly actionType: (action: A) => string;
  /** 开局选项的完整校验；框架在创建/修改时调用。 */
  readonly optionSchema: ZodType<O>;
  /** 选项缺省值；必须与 meta.options[].default 一致。 */
  readonly defaultOptions: O;
  /**
   * 可选：终局名次（4 人局等）。返回每个座位的 rank（1 为冠军）与可选 score。
   * 框架会在状态变为 finished 时写入 match_rankings。
   */
  readonly rankings?: (
    state: S,
  ) => Array<{ seat: number; rank: number; score?: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGamePlugin = GamePlugin<any, any, any, any>;
