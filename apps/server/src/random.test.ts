import { describe, expect, it } from 'vitest';
import { createRng } from './random.js';

describe('createRng', () => {
  it('同一 seed 产生同一序列', () => {
    const a = createRng('room-seed-1');
    const b = createRng('room-seed-1');
    for (let i = 0; i < 20; i += 1) expect(a.next()).toBe(b.next());
  });

  it('不同 seed 产生不同序列', () => {
    const a = createRng('room-seed-1');
    const b = createRng('room-seed-2');
    expect(a.next()).not.toBe(b.next());
  });

  it('int/pick/shuffle 不越界且可复现', () => {
    const a = createRng('shuffle-seed');
    const b = createRng('shuffle-seed');
    for (let i = 0; i < 50; i += 1) {
      const n = a.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    const items = [1, 2, 3, 4, 5];
    const c = createRng('shuffle-seed');
    const d = createRng('shuffle-seed');
    expect(c.pick(items)).toBe(d.pick(items));
    expect(c.shuffle(items)).toEqual(d.shuffle(items));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
