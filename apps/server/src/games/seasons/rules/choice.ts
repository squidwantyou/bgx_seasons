import { ELEMENTS, type Element } from '@bgx/protocol/games/seasons';

/** 解析 element_alloc 弹窗提交的能量分配；返回错误码字符串表示不合法。 */
export function parseElementAlloc(
  value: unknown,
  amount: number,
  maxPerElement?: Partial<Record<Element, number>>,
): Record<Element, number> | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'invalid_choice';
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(ELEMENTS as readonly string[]).includes(key)) return 'invalid_choice';
  }
  const alloc: Record<Element, number> = { water: 0, air: 0, fire: 0, earth: 0 };
  let total = 0;
  for (const element of ELEMENTS) {
    const raw = record[element];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return 'invalid_choice';
    }
    if (maxPerElement && raw > (maxPerElement[element] ?? 0)) {
      return 'choice_over_limit';
    }
    alloc[element] = raw;
    total += raw;
  }
  if (total !== amount) return 'choice_amount_mismatch';
  return alloc;
}

/** 解析 card_list 弹窗提交的 uid 列表；返回错误码字符串表示不合法。 */
export function parseCardList(
  value: unknown,
  allowed: readonly number[],
  keep: number,
): number[] | string {
  if (!Array.isArray(value)) return 'invalid_choice';
  const uids: number[] = [];
  for (const raw of value) {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return 'invalid_choice';
    if (!allowed.includes(raw)) return 'invalid_choice';
    if (uids.includes(raw)) return 'choice_duplicate';
    uids.push(raw);
  }
  if (uids.length !== keep) return 'choice_card_count';
  return uids;
}
