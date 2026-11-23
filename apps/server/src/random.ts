import type { RandomSource } from '@bgx/protocol';

/**
 * 由对局种子派生可复现的随机源。
 *
 * 同一 seed 在任意进程/任意时间都会得到相同的序列；种子只保存在服务端，
 * 不下发给客户端。游戏在 setup() 里用它洗牌、发牌或决定随机先手，
 * 把结果写进状态后，后续 reduce() 不需要再取随机数。
 */
export function createRng(seed: string): RandomSource {
  // xmur3：把字符串散列成 32 位种子
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;

  // mulberry32：小、快、够用的确定性 PRNG
  let a = h >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('int(maxExclusive) 需要正整数');
      }
      return Math.floor(next() * maxExclusive);
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick() 不能用于空数组');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
