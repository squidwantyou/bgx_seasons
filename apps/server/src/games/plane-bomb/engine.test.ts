import { describe, expect, it } from 'vitest';
import type {
  GameAction,
  GameEvent,
  PlaneBombAction,
  PlaneBombGameView,
  PlanePlacementInput,
} from '@bgx/protocol/games/plane-bomb';
import { planeBombDefaultOptions } from '@bgx/protocol/games/plane-bomb';
import { footprintOf, initialState, planeBomb, validatePlacement } from './engine.js';
import type { ReduceResult } from '../types.js';
import type { PlaneBombState } from './engine.js';
import { createRng } from '../../random.js';

const rng = createRng('plane-bomb-test');
const ctx = { now: 0, rng };

type Seat = 0 | 1;

const UP = 0;

function p(cockpit: number, orientation = UP): PlanePlacementInput {
  return { cockpit, orientation: orientation as PlanePlacementInput['orientation'] };
}

const A_PLANES = [p(22), p(17), p(62)]; // C3 / H2 / C7，全部朝上
const B_PLANES = [p(12), p(55), p(7)]; // C2 / F6 / H1，全部朝上

function act(action: PlaneBombAction): GameAction {
  return action as GameAction;
}

function ok(result: ReduceResult<PlaneBombState>): PlaneBombState {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  return result.state;
}

function reduce(
  state: PlaneBombState,
  seat: number,
  action: PlaneBombAction,
): ReduceResult<PlaneBombState> {
  return planeBomb.reduce(state, seat, act(action), ctx);
}

function place(state: PlaneBombState, seat: Seat, planes: PlanePlacementInput[]) {
  return reduce(state, seat, { type: 'place', planes: planes as never });
}

function fire(state: PlaneBombState, seat: Seat, cell: number) {
  return reduce(state, seat, { type: 'fire', cell });
}

function bothPlaced(): PlaneBombState {
  return ok(place(ok(place(initialState(), 0, A_PLANES)), 1, B_PLANES));
}

/** 一轮：座位 0 先报 aCell，座位 1 报 bCell 时结算。 */
function round(state: PlaneBombState, aCell: number, bCell: number) {
  return ok(fire(ok(fire(state, 0, aCell)), 1, bCell));
}

function view(state: PlaneBombState, seat: number | null): PlaneBombGameView {
  return planeBomb.view(state, seat, state.phase !== 'placing');
}

describe('plane-bomb engine', () => {
  it('1. 初始状态', () => {
    const s = initialState();
    expect(s.phase).toBe('placing');
    expect(s.round).toBe(0);
    expect(s.pending).toEqual([null, null]);
    expect(s.lastRound).toBeNull();
    expect(s.winner).toBeNull();
    expect(s.marks[0].every((m) => m === 0)).toBe(true);
    expect(s.marks[1].every((m) => m === 0)).toBe(true);
    expect(planeBomb.turn(s)).toBeNull();
  });

  it('2. 合法布阵（含旋转）生成 30 个不同格并广播 plane_placed', () => {
    const res = place(initialState(), 0, [p(53, 1), p(4), p(17)]); // D6 朝右 + 两架朝上
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.placed[0]).toBe(true);
    expect(res.state.fleets[0]).toHaveLength(3);
    const cells = new Set(res.state.fleets[0]!.flatMap((plane) => plane.cells));
    expect(cells.size).toBe(30);
    expect(res.events).toEqual([{ type: 'plane_placed', seat: 0 }]);
  });

  it('3. 越界（按朝向）被拒绝', () => {
    expect(footprintOf(0, 0)).toBeNull(); // A1 朝上，机翼越出上边
    expect(footprintOf(33, 1)).not.toBeNull(); // D4 朝右仍可
    const res = place(initialState(), 0, [p(0), p(50), p(90)]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_placement');
  });

  it('4. 两机重叠（含旋转后重叠）被拒绝', () => {
    const res = place(initialState(), 0, [p(22), p(32), p(77)]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('invalid_placement');
      expect(res.message).toContain('重叠');
    }
    // C3 朝上占住 D4(32)，D4 朝上再放一架必然重叠
    expect(validatePlacement([p(22), p(32), p(77)]).error).toContain('重叠');
  });

  it('5. 重复机头 / 非法朝向被拒绝', () => {
    const dup = place(initialState(), 0, [p(22), p(22), p(62)]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('invalid_placement');

    const bad = place(initialState(), 0, [p(22, 9), p(17), p(62)]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('朝向');
  });

  it('6. 布阵阶段可以重提，以最后一次为准', () => {
    const first = ok(place(initialState(), 0, A_PLANES));
    const res = place(first, 0, [p(53, 1), p(4), p(17)]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.fleets[0]![0]!.cockpit).toBe(53);
    expect(res.state.placed[0]).toBe(true);
  });

  it('7. 双方布阵后进入 battle、round=1', () => {
    const s = bothPlaced();
    expect(s.phase).toBe('battle');
    expect(s.round).toBe(1);
    expect(s.pending).toEqual([null, null]);
    expect(s.lastRound).toBeNull();
    const res = place(ok(place(initialState(), 0, A_PLANES)), 1, B_PLANES);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events).toEqual([
      { type: 'plane_placed', seat: 1 },
      { type: 'battle_started', round: 1 },
    ]);
  });

  it('8. 开战后重新布阵返回 bad_phase', () => {
    const res = place(bothPlaced(), 0, A_PLANES);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_phase');
  });

  it('9. 第一炮只入队，对方看不到格子', () => {
    const s = ok(fire(bothPlaced(), 0, 33));
    expect(s.pending).toEqual([33, null]);
    expect(s.marks[1][33]).toBe(0);
    expect(s.round).toBe(1);

    const mine = view(s, 0);
    expect(mine.pendingShots).toEqual([true, false]);
    expect(mine.myShot).toBe(33);
    const theirs = view(s, 1);
    expect(theirs.pendingShots).toEqual([true, false]);
    expect(theirs.myShot).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain('"pending"');
    expect(JSON.stringify(theirs)).not.toContain('"fleets"');
  });

  it('10. 本轮已报点再报返回 already_queued', () => {
    const s = ok(fire(bothPlaced(), 0, 33));
    const res = fire(s, 0, 44);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('already_queued');
  });

  it('11. 第二炮触发同时结算，写入两个弹着并进入下一轮', () => {
    const s = round(bothPlaced(), 33, 22);
    expect(s.marks[1][33]).toBe(1); // 座位 0 炸空
    expect(s.marks[0][22]).toBe(3); // 座位 1 炸中座位 0 的机头
    expect(s.lastRound?.round).toBe(1);
    expect(s.lastRound?.shots.map((x) => x.seat)).toEqual([0, 1]);
    expect(s.round).toBe(2);
    expect(s.pending).toEqual([null, null]);
  });

  it('12. 炸空 / 炸机身 / 炸机头的结果与标记', () => {
    const miss = round(bothPlaced(), 99, 90);
    expect(miss.lastRound?.shots[0]).toMatchObject({ seat: 0, cell: 99, result: 'miss' });
    expect(miss.marks[1][99]).toBe(1);

    const body = round(bothPlaced(), 20, 90); // B 的 C2 机身
    expect(body.lastRound?.shots[0]).toMatchObject({ result: 'body', downed: false });
    expect(body.marks[1][20]).toBe(2);

    const cockpit = round(bothPlaced(), 12, 90); // B 的 C2 机头
    expect(cockpit.lastRound?.shots[0]).toMatchObject({ result: 'cockpit', downed: true });
    expect(cockpit.marks[1][12]).toBe(3);
    expect(cockpit.phase).toBe('battle');
  });

  it('13. 已击落飞机的机身仍然算命中', () => {
    const downed = round(bothPlaced(), 12, 90);
    expect(downed.marks[1][12]).toBe(3);
    const s = round(downed, 20, 91); // C2 的机身
    expect(s.marks[1][20]).toBe(2);
    expect(s.lastRound?.shots[0]).toMatchObject({ result: 'body', downed: false });
    expect(s.phase).toBe('battle');
  });

  it('13b. option=miss 时，已击落飞机的机身再次被炸返回炸空', () => {
    let s = initialState({ downedPlaneHit: 'miss' });
    s = ok(place(s, 0, A_PLANES));
    s = ok(place(s, 1, B_PLANES));
    s = round(s, 12, 90); // 炸掉 B 的 C2 机头
    expect(s.marks[1][12]).toBe(3);
    s = round(s, 20, 91); // 同一架飞机的机身
    expect(s.lastRound?.shots[0]).toMatchObject({ seat: 0, cell: 20, result: 'miss' });
    expect(s.marks[1][20]).toBe(1);
    expect(s.phase).toBe('battle');
  });

  it('13c. option=body 时，已击落飞机的机身再次被炸仍是炸中', () => {
    let s = initialState({ downedPlaneHit: 'body' });
    s = ok(place(s, 0, A_PLANES));
    s = ok(place(s, 1, B_PLANES));
    s = round(s, 12, 90);
    s = round(s, 20, 91);
    expect(s.lastRound?.shots[0]).toMatchObject({ result: 'body' });
    expect(s.marks[1][20]).toBe(2);
  });

  it('14. 重复炸同一格返回 cell_already_shot', () => {
    const s = round(bothPlaced(), 99, 90);
    const res = fire(s, 0, 99);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('cell_already_shot');
  });

  it('15. 击落三架机头后获胜', () => {
    let s = bothPlaced();
    s = round(s, 12, 90);
    s = round(s, 55, 91);
    s = round(s, 7, 92);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe(0);
    expect([s.marks[1][12], s.marks[1][55], s.marks[1][7]]).toEqual([3, 3, 3]);
    expect(s.lastRound?.shots[0]).toMatchObject({ result: 'cockpit', downed: true });
  });

  it('16. 对方同轮的报点仍然结算（不能先到 3 就吞掉）', () => {
    let s = bothPlaced();
    s = round(s, 12, 90);
    s = round(s, 55, 91);
    // 座位 0 第三杀的同时，座位 1 打中座位 0 的机身
    s = round(s, 7, 30);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe(0);
    expect(s.marks[0][30]).toBe(2);
    expect(s.lastRound?.shots).toHaveLength(2);
    expect(s.lastRound?.shots[1]).toMatchObject({ seat: 1, cell: 30, result: 'body' });
  });

  it('17. 同轮 3:3 判平局', () => {
    let s = bothPlaced();
    s = round(s, 12, 90); // A 杀 B1
    s = round(s, 91, 22); // B 杀 A1
    s = round(s, 55, 92); // A 杀 B2
    s = round(s, 93, 17); // B 杀 A2
    // 同一轮：A 炸 B 的第三个机头，B 炸 A 的第三个机头
    s = round(s, 7, 62);
    expect(s.phase).toBe('finished');
    expect(s.winner).toBeNull();
    expect(s.lastRound?.shots).toHaveLength(2);
    expect(s.marks[0][62]).toBe(3);
    expect(s.marks[1][7]).toBe(3);
  });

  it('18. 只有一方到 3 不是平局', () => {
    let s = bothPlaced();
    s = round(s, 12, 90);
    s = round(s, 55, 91);
    s = round(s, 7, 92);
    expect(s.winner).toBe(0);
    expect(s.marks[0].every((m) => m !== 3)).toBe(true);
  });

  it('19. 布阵阶段认输：对方胜，未布阵方 reveal 为空', () => {
    const res = reduce(initialState(), 0, { type: 'resign' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toBe('finished');
    expect(res.state.winner).toBe(1);
    const reveal = view(res.state, 0).reveal;
    expect(reveal).not.toBeNull();
    expect(reveal![0]!.planes).toEqual([]);
    expect(reveal![1]!.planes).toEqual([]);
  });

  it('20. 已报点未结算时认输：报点作废', () => {
    const s = ok(fire(bothPlaced(), 0, 33));
    const res = reduce(s, 0, { type: 'resign' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.winner).toBe(1);
    expect(res.state.pending).toEqual([null, null]);
    expect(res.state.marks[1][33]).toBe(0);
  });

  it('21. 观战视图没有舰队，只有公开弹着', () => {
    const s = bothPlaced();
    const v = view(s, null);
    expect(v.mine).toBeNull();
    expect(v.enemy).toBeNull();
    expect(v.spectate?.boards).toHaveLength(2);
    expect(v.myShot).toBeNull();
    expect(JSON.stringify(v)).not.toContain('"fleets"');
    expect(JSON.stringify(v)).not.toContain('"orientation"');
  });

  it('22. 终局才公开双方舰队', () => {
    let s = bothPlaced();
    expect(view(s, 0).reveal).toBeNull();
    s = round(s, 12, 90);
    s = round(s, 55, 91);
    s = round(s, 7, 92);
    const v = view(s, 1);
    expect(v.reveal).not.toBeNull();
    expect(v.reveal).toHaveLength(2);
    expect(v.reveal![0]!.planes).toHaveLength(3);
  });

  it('23. 同一组动作重放结果一致', () => {
    const actions: Array<[Seat, PlaneBombAction]> = [
      [0, { type: 'place', planes: A_PLANES as never }],
      [1, { type: 'place', planes: B_PLANES as never }],
      [0, { type: 'fire', cell: 12 }],
      [1, { type: 'fire', cell: 90 }],
      [0, { type: 'fire', cell: 20 }],
      [1, { type: 'fire', cell: 91 }],
    ];
    function run(): PlaneBombState {
      let s = initialState();
      for (const [seat, action] of actions) s = ok(reduce(s, seat, action));
      return s;
    }
    expect(run()).toEqual(run());
  });

  it('24. 四个朝向的 footprint 与文档一致', () => {
    expect(footprintOf(22, 0)).toEqual([22, 30, 31, 32, 33, 34, 42, 51, 52, 53]);
    expect(footprintOf(53, 1)).toEqual([32, 40, 42, 50, 51, 52, 53, 60, 62, 72]);
    expect(footprintOf(72, 2)).toEqual([41, 42, 43, 52, 60, 61, 62, 63, 64, 72]);
    expect(footprintOf(74, 3)).toEqual([55, 65, 67, 74, 75, 76, 77, 85, 87, 95]);
  });

  it('25. 旋转后不同朝向共享格子也算重叠', () => {
    const res = validatePlacement([p(22, 0), p(32, 0), p(77)]);
    expect(res.error).toContain('重叠');
  });

  it('26. 带 pending 与 lastRound 的状态 JSON 往返', () => {
    const s = ok(fire(bothPlaced(), 0, 33));
    const roundTrip = JSON.parse(JSON.stringify(s)) as PlaneBombState;
    expect(roundTrip).toEqual(s);
    expect(roundTrip.pending).toEqual([33, null]);
  });

  it('27. 事件不泄露布阵细节与未结算格子', () => {
    const queued = fire(bothPlaced(), 0, 33);
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.events).toEqual([{ type: 'shot_queued', seat: 0 }]);
    expect(JSON.stringify(queued.events)).not.toContain('orientation');
    expect(JSON.stringify(queued.events)).not.toContain('cells');
    expect(JSON.stringify(queued.events)).not.toContain('33');
  });

  it('28. 结算事件的 shots 按 seat 0/1 排序且包含两炮', () => {
    const res = reduce(ok(fire(bothPlaced(), 0, 33)), 1, { type: 'fire', cell: 22 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resolved = res.events.find((e: GameEvent) => e.type === 'round_resolved');
    expect(resolved).toBeTruthy();
    expect((resolved!.shots as unknown[]).length).toBe(2);
  });

  it('29. lastRound 只在结算后出现', () => {
    const s = ok(fire(bothPlaced(), 0, 33));
    expect(s.lastRound).toBeNull();
    const resolved = ok(fire(s, 1, 22));
    expect(resolved.lastRound?.shots).toHaveLength(2);
  });

  it('30. setup 只接受 2 人', () => {
    expect(() => planeBomb.setup(1, planeBombDefaultOptions, rng)).toThrow();
    expect(() => planeBomb.setup(3, planeBombDefaultOptions, rng)).toThrow();
    expect(planeBomb.setup(2, planeBombDefaultOptions, rng).phase).toBe('placing');
  });
});
