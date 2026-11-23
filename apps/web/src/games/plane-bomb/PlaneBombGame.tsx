import { useEffect, useMemo, useState } from 'react';
import type {
  Orientation,
  PlaneBombAction,
  PlaneBombGameView,
  PlanePlacement,
  PlanePlacementInput,
  ShotMark,
} from '@bgx/protocol/games/plane-bomb';
import {
  cellName,
  checkDraft,
  footprintOf,
  ORIENTATION_ARROWS,
  ORIENTATION_NAMES,
} from './footprint';

interface PlaneBombGameProps {
  view: PlaneBombGameView;
  mySeat: number | null;
  disabled: boolean;
  onAction: (action: PlaneBombAction) => void;
}

type PlaneBed = PlanePlacement & { down?: boolean };

interface GridProps {
  marks: ShotMark[];
  planes?: PlaneBed[];
  revealed?: PlanePlacement[];
  preview?: number[];
  previewInvalid?: boolean;
  label: string;
  canPlay?: (cell: number) => boolean;
  onPlay?: (cell: number) => void;
}

const GLYPH = {
  miss: '·',
  body: '✕',
  cockpit: '💥',
  head: '▲',
  revealed: '◇',
} as const;

function Grid({
  marks,
  planes,
  revealed,
  preview,
  previewInvalid,
  label,
  canPlay,
  onPlay,
}: GridProps) {
  const planeAt = new Map<number, { cockpit: boolean; down: boolean }>();
  for (const plane of planes ?? []) {
    for (const cell of plane.cells) {
      planeAt.set(cell, { cockpit: plane.cockpit === cell, down: !!plane.down });
    }
  }
  const revealAt = new Map<number, { cockpit: boolean; cells: Set<number> }>();
  for (const plane of revealed ?? []) {
    const cells = new Set(plane.cells);
    for (const cell of plane.cells) revealAt.set(cell, { cockpit: plane.cockpit === cell, cells });
  }
  const previewSet = new Set(preview ?? []);

  return (
    <div className="pb-grid" role="grid" aria-label={label}>
      {marks.map((mark, cell) => {
        const plane = planeAt.get(cell);
        const reveal = !plane ? revealAt.get(cell) : undefined;
        const classes = ['pb-cell'];
        if (mark === 1) classes.push('pb-miss');
        if (mark === 2) classes.push('pb-body');
        if (mark === 3) classes.push('pb-cockpit-hit');
        if (plane) classes.push('pb-plane');
        if (plane?.cockpit) classes.push('pb-plane-head');
        if (plane?.down) classes.push('pb-down');
        if (reveal) {
          classes.push('pb-silhouette');
          if (!reveal.cells.has(cell - 10)) classes.push('pb-edge-t');
          if (cell % 10 !== 9 && !reveal.cells.has(cell + 1)) classes.push('pb-edge-r');
          if (!reveal.cells.has(cell + 10)) classes.push('pb-edge-b');
          if (cell % 10 !== 0 && !reveal.cells.has(cell - 1)) classes.push('pb-edge-l');
        }
        if (previewSet.has(cell)) classes.push(previewInvalid ? 'pb-preview-bad' : 'pb-preview');
        const playable = canPlay ? canPlay(cell) : false;
        if (playable) classes.push('pb-target');

        let content = '';
        if (mark === 3 && plane?.cockpit) content = GLYPH.cockpit;
        else if (mark === 2) content = GLYPH.body;
        else if (mark === 1) content = GLYPH.miss;
        else if (plane?.cockpit) content = GLYPH.head;
        else if (reveal?.cockpit) content = GLYPH.head;

        const stateText =
          mark === 1
            ? '炸空'
            : mark === 2
              ? '命中机身'
              : mark === 3
                ? '命中机头'
                : plane
                  ? '己方飞机'
                  : reveal
                    ? '对方飞机轮廓'
                    : '未知';
        return (
          <button
            key={cell}
            type="button"
            role="gridcell"
            className={classes.join(' ')}
            aria-label={`${cellName(cell)}，${stateText}${playable ? '，可以轰炸' : ''}`}
            disabled={!playable}
            onClick={() => onPlay?.(cell)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

function RoundReport({
  view,
  mySeat,
}: {
  view: PlaneBombGameView;
  mySeat: number | null;
}) {
  if (!view.lastRound) return null;
  const lines = view.lastRound.shots.map((shot) => {
    const who =
      mySeat === null ? (shot.seat === 0 ? '座位 1' : '座位 2') : shot.seat === mySeat ? '你' : '对方';
    const result =
      shot.result === 'miss' ? '炸空' : shot.result === 'body' ? '命中机身' : '命中机头，击落！';
    return `${who}炸 ${cellName(shot.cell)}：${result}`;
  });
  return (
    <p className="pb-report">
      <span className="pb-report-label">上一轮</span>
      {lines.join(' · ')}
    </p>
  );
}

function PlacementPanel({ view, disabled, onAction }: PlaneBombGameProps) {
  const own = view.mine?.planes;
  const ownKey = own?.map((p) => `${p.cockpit}:${p.orientation}`).join('|') ?? '';
  const [planes, setPlanes] = useState<(PlanePlacementInput | null)[]>([null, null, null]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (own && own.length === 3) {
      setPlanes(own.map((p) => ({ cockpit: p.cockpit, orientation: p.orientation })));
    }
  }, [ownKey, own]);

  const check = checkDraft(planes);
  const slot = planes[selected];
  const previewCockpit = slot?.cockpit ?? null;
  const preview = previewCockpit === null ? null : footprintOf(previewCockpit, slot?.orientation ?? 0);
  const previewInvalid =
    preview === null ||
    preview.some((cell) => {
      const bed = check.beds.find((b, i) => b && i !== selected && b.cells.includes(cell));
      return !!bed;
    });

  const submitted = (own?.length ?? 0) === 3;

  function placeAt(cell: number) {
    const occupant = planes.findIndex((p) => p?.cockpit === cell);
    if (occupant >= 0) {
      setSelected(occupant);
      return;
    }
    const inOther = planes.some(
      (p, i) => i !== selected && p && footprintOf(p.cockpit, p.orientation)?.includes(cell),
    );
    if (inOther) return;
    setPlanes((prev) =>
      prev.map((p, i) =>
        i === selected ? { cockpit: cell, orientation: p?.orientation ?? 0 } : p,
      ),
    );
  }

  function rotate(delta: number) {
    setPlanes((prev) =>
      prev.map((p, i) =>
        i === selected && p
          ? { ...p, orientation: (((p.orientation + delta + 4) % 4) as Orientation) }
          : p,
      ),
    );
  }

  function chooseOrientation(orientation: Orientation) {
    setPlanes((prev) =>
      prev.map((p, i) => (i === selected && p ? { ...p, orientation } : p)),
    );
  }

  function submit() {
    if (!check.complete || check.conflict || check.invalid || disabled) return;
    onAction({
      type: 'place',
      planes: planes as [PlanePlacementInput, PlanePlacementInput, PlanePlacementInput],
    });
  }

  const beds = check.beds.filter((b): b is PlanePlacement => b !== null);
  const previewCells = preview ?? [];

  return (
    <div className="pb-placement">
      <div className="pb-place-info">
        <p className="pb-place-title">
          {submitted ? '布阵已提交，等待对手' : '摆放你的三架飞机'}
        </p>
        <p className="muted small">
          {submitted
            ? '双方都提交后自动开战；在那之前你还可以修改。'
            : '点击格子放机头，再用方向按钮旋转。三架飞机不能重叠，机头不能越界。'}
        </p>
      </div>

      <div className="pb-place-layout">
        <div className="pb-board-card">
          <div className="pb-board-head">
            <span>我的海域</span>
            <span className="muted small">机头 ▲ · 点击放置</span>
          </div>
          <Grid
            marks={new Array<ShotMark>(100).fill(0)}
            planes={beds}
            preview={previewCells}
            previewInvalid={previewInvalid}
            label="布阵棋盘"
            canPlay={() => true}
            onPlay={(cell) => placeAt(cell)}
          />
        </div>

        <div className="pb-place-controls">
          <div className="pb-slots" role="tablist" aria-label="三架飞机">
            {planes.map((p, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={selected === i}
                className={`pb-slot${selected === i ? ' active' : ''}${p ? ' filled' : ''}`}
                onClick={() => setSelected(i)}
              >
                <span className="pb-slot-no">{i + 1} 号机</span>
                <span className="pb-slot-state">
                  {p ? `机头 ${cellName(p.cockpit)}` : '未放置'}
                </span>
                {p && (
                  <span className="pb-slot-dir">
                    {ORIENTATION_ARROWS[p.orientation]} {ORIENTATION_NAMES[p.orientation]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="pb-orientation">
            <span className="muted small">机头朝向</span>
            <div className="pb-dir-pad" role="group" aria-label="机头朝向">
              <button
                type="button"
                className={`pb-dir pb-dir-up${slot?.orientation === 0 ? ' active' : ''}`}
                aria-label="机头朝上"
                aria-pressed={slot?.orientation === 0}
                disabled={!slot}
                onClick={() => chooseOrientation(0)}
              >
                <span className="pb-dir-arrow">↑</span>
                <span className="pb-dir-label">上</span>
              </button>
              <button
                type="button"
                className={`pb-dir pb-dir-left${slot?.orientation === 3 ? ' active' : ''}`}
                aria-label="机头朝左"
                aria-pressed={slot?.orientation === 3}
                disabled={!slot}
                onClick={() => chooseOrientation(3)}
              >
                <span className="pb-dir-arrow">←</span>
                <span className="pb-dir-label">左</span>
              </button>
              <button
                type="button"
                className="pb-dir pb-dir-center"
                aria-label="顺时针旋转 90 度"
                disabled={!slot}
                onClick={() => rotate(1)}
              >
                <span className="pb-dir-arrow">↻</span>
                <span className="pb-dir-label">旋转</span>
              </button>
              <button
                type="button"
                className={`pb-dir pb-dir-right${slot?.orientation === 1 ? ' active' : ''}`}
                aria-label="机头朝右"
                aria-pressed={slot?.orientation === 1}
                disabled={!slot}
                onClick={() => chooseOrientation(1)}
              >
                <span className="pb-dir-arrow">→</span>
                <span className="pb-dir-label">右</span>
              </button>
              <button
                type="button"
                className={`pb-dir pb-dir-down${slot?.orientation === 2 ? ' active' : ''}`}
                aria-label="机头朝下"
                aria-pressed={slot?.orientation === 2}
                disabled={!slot}
                onClick={() => chooseOrientation(2)}
              >
                <span className="pb-dir-arrow">↓</span>
                <span className="pb-dir-label">下</span>
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm pb-remove-plane"
              disabled={!slot}
              onClick={() => setPlanes((prev) => prev.map((p, i) => (i === selected ? null : p)))}
            >
              移除此机
            </button>
          </div>

          <div className="pb-place-status" aria-live="polite">
            {check.conflict
              ? '有飞机重叠了，挪开或旋转一下'
              : check.invalid
                ? '有飞机越界了，换个机头位置或朝向'
                : !check.complete
                  ? '还差几架飞机'
                  : '三架就位，可以提交'}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!check.complete || check.conflict || check.invalid || disabled}
          >
            {submitted ? '更新布阵' : '确认布阵'}
          </button>
        </div>
      </div>

      <p className="muted small pb-place-foot">
        飞机形状：机头、5 格机翼、1 格机身、3 格机尾；可以贴边和相邻，但不能重叠。
      </p>
    </div>
  );
}

export function PlaneBombGame({ view, mySeat, disabled, onAction }: PlaneBombGameProps) {
  const enemyReveal = useMemo(() => {
    if (!view.reveal || mySeat === null) return [];
    return view.reveal.find((item) => item.seat === 1 - mySeat)?.planes ?? [];
  }, [view.reveal, mySeat]);

  if (view.phase === 'placing' && mySeat !== null) {
    return <PlacementPanel view={view} mySeat={mySeat} disabled={disabled} onAction={onAction} />;
  }

  const myPending = mySeat !== null && view.pendingShots[mySeat] === true;
  const canFire = (cell: number): boolean =>
    mySeat !== null &&
    view.phase === 'battle' &&
    !myPending &&
    !disabled &&
    (view.enemy?.marks[cell] ?? 1) === 0;

  function fire(cell: number) {
    if (!canFire(cell)) return;
    onAction({ type: 'fire', cell });
  }

  const statusText = (() => {
    if (view.phase === 'finished') {
      if (view.draw) return '本局平局：同轮双方都击落了第三架飞机';
      if (mySeat === null) return `本局结束，${view.winner === 0 ? '座位 1' : '座位 2'}获胜`;
      return view.winner === mySeat ? '你赢了！' : '这局输了';
    }
    if (view.phase === 'placing') return '布阵阶段，观战者看不到双方舰队';
    if (mySeat === null) {
      return `第 ${view.round} 轮 · 双方同时报点`;
    }
    if (myPending) return `第 ${view.round} 轮 · 已报点，等待对方`;
    return `第 ${view.round} 轮 · 选择要轰炸的格子`;
  })();

  return (
    <div className="pb-battle">
      <div className="pb-battle-head">
        <span className="pb-status-text">{statusText}</span>
        {view.phase === 'battle' && (
          <span className="muted small">
            {view.pendingShots[0] ? '座位 1 已报点' : '座位 1 思考中'} ·{' '}
            {view.pendingShots[1] ? '座位 2 已报点' : '座位 2 思考中'}
          </span>
        )}
      </div>

      <RoundReport view={view} mySeat={mySeat} />

      <div className="pb-boards">
        {mySeat === null ? (
          (view.spectate?.boards ?? []).map((board) => (
            <div className="pb-board-card" key={board.seat}>
              <div className="pb-board-head">
                <span>座位 {board.seat + 1} 的海域</span>
                <span className="pb-down-count">
                  击落 {board.down}/3 · {board.placed ? '已布阵' : '布阵中'}
                </span>
              </div>
              <Grid
                marks={board.marks}
                revealed={
                  view.reveal?.find((item) => item.seat === board.seat)?.planes ?? undefined
                }
                label={`座位 ${board.seat + 1} 的棋盘`}
              />
            </div>
          ))
        ) : (
          <>
            <div className="pb-board-card">
              <div className="pb-board-head">
                <span>敌方海域</span>
                <span className="pb-down-count">已击落 {view.enemy?.down ?? 0}/3</span>
              </div>
              <Grid
                marks={view.enemy?.marks ?? new Array<ShotMark>(100).fill(0)}
                revealed={enemyReveal}
                label="敌方棋盘，点击轰炸"
                canPlay={canFire}
                onPlay={fire}
              />
            </div>

            <div className="pb-board-card">
              <div className="pb-board-head">
                <span>我的海域</span>
                <span className="pb-down-count">
                  被击落 {view.down[mySeat] ?? 0}/3
                </span>
              </div>
              <Grid
                marks={view.mine?.incoming ?? new Array<ShotMark>(100).fill(0)}
                planes={view.mine?.planes}
                label="我的棋盘"
              />
            </div>
          </>
        )}
      </div>

      <p className="pb-battle-foot muted small">
        {view.phase === 'battle'
          ? '每轮双方各报一个未炸过的格子；双方都报完后同时结算，命中机头即击落该机。'
          : '结束后双方舰队以轮廓公开，用于复盘。'}
        {view.myShot !== null && view.phase === 'battle' && ` 你本轮报了 ${cellName(view.myShot)}。`}
      </p>
    </div>
  );
}
