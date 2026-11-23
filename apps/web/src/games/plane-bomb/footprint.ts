import type { Orientation, PlanePlacement, PlanePlacementInput } from '@bgx/protocol/games/plane-bomb';

export const ORIENTATIONS: Orientation[] = [0, 1, 2, 3];
export const ORIENTATION_NAMES = ['上', '右', '下', '左'] as const;
export const ORIENTATION_ARROWS = ['↑', '→', '↓', '←'] as const;

/** 与服务端 footprintOf 保持一致的纯 UI 预览；正式判定仍在服务端。 */
export function footprintOf(cockpit: number, orientation: Orientation): number[] | null {
  if (!Number.isInteger(cockpit) || cockpit < 0 || cockpit > 99) return null;
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [-1, 0],
    [0, 1],
    [1, 0],
    [0, -1],
  ];
  const dir = dirs[orientation];
  if (!dir) return null;
  const [dr, dc] = dir;
  const br = -dr;
  const bc = -dc;
  const pr = dc;
  const pc = -dr;
  const r0 = Math.floor(cockpit / 10);
  const c0 = cockpit % 10;
  const offsets: Array<[number, number]> = [[0, 0]];

  for (let k = -2; k <= 2; k += 1) offsets.push([br + pr * k, bc + pc * k]);
  offsets.push([2 * br, 2 * bc]);
  for (let k = -1; k <= 1; k += 1) offsets.push([3 * br + pr * k, 3 * bc + pc * k]);

  const cells: number[] = [];
  for (const [rr, cc] of offsets) {
    const r = r0 + rr;
    const c = c0 + cc;
    if (r < 0 || r > 9 || c < 0 || c > 9) return null;
    cells.push(r * 10 + c);
  }
  return [...new Set(cells)].sort((a, b) => a - b);
}

export function cellName(cell: number): string {
  return `${String.fromCharCode(65 + (cell % 10))}${Math.floor(cell / 10) + 1}`;
}

export interface DraftCheck {
  complete: boolean;
  conflict: boolean;
  invalid: boolean;
  beds: (PlanePlacement | null)[];
}

/** 本地检查三架飞机是否完整、是否越界/重叠；仅用于按钮状态与预览。 */
export function checkDraft(planes: (PlanePlacementInput | null)[]): DraftCheck {
  const beds = planes.map((p) => {
    if (!p) return null;
    const cells = footprintOf(p.cockpit, p.orientation);
    return cells ? { cockpit: p.cockpit, orientation: p.orientation, cells } : null;
  });
  const used = new Set<number>();
  let conflict = false;
  for (const bed of beds) {
    if (!bed) continue;
    for (const cell of bed.cells) {
      if (used.has(cell)) conflict = true;
      used.add(cell);
    }
  }
  const complete = planes.every((p) => p !== null);
  const invalid = beds.some((b) => b === null);
  return { complete, conflict, invalid, beds };
}
