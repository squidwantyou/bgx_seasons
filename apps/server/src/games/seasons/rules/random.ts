/**
 * 确定性随机源。
 *
 * 设计（见 apps/.../seasons-migration.md §5）：随机数只由「seed + cursor」决定，
 * 状态里只存这两个数字。这样 reduce 是纯函数、可重放，也不必信任框架的 rng 序列。
 */

export interface RngState {
  rngSeed: number;
  rngCursor: number;
}

/** mulberry32：32 位种子 → [0,1) 序列。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 第 cursor 次（0 基）的输出；纯函数，方便从 seed+cursor 复原。 */
export function randomAt(seed: number, cursor: number): number {
  const rng = mulberry32(seed);
  let x = 0;
  for (let i = 0; i <= cursor; i++) x = rng();
  return x;
}

/** [0, n) 的整数。 */
export function randIntAt(seed: number, cursor: number, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`randIntAt: 非法范围 ${n}`);
  return Math.floor(randomAt(seed, cursor) * n);
}

/** reduce 内取随机数：返回 [值, 新 state]，cursor 前进一位。 */
export function randInt<S extends RngState>(state: S, n: number): [number, S] {
  const value = randIntAt(state.rngSeed, state.rngCursor, n);
  return [value, { ...state, rngCursor: state.rngCursor + 1 }];
}

/**
 * Fisher–Yates 原地洗牌，返回消耗后的 cursor。
 * setup 阶段还没有 state，所以直接传 seed + cursor。
 */
export function shuffleWithSeed<T>(items: T[], seed: number, cursor: number): number {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randIntAt(seed, cursor, i + 1);
    cursor++;
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return cursor;
}
