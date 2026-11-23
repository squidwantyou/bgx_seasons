import type { ReversiGameView } from '@bgx/protocol/games/reversi';

interface BoardProps {
  view: ReversiGameView;
  playable: boolean;
  onPlay: (cell: number) => void;
}

const COLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function Board({ view, playable, onPlay }: BoardProps) {
  const legal = new Set(view.legal);
  const lastCell = view.lastMove?.cell ?? null;

  return (
    <div className="board-frame">
      <div className="board" role="grid" aria-label="黑白棋棋盘">
        {view.board.map((cell, index) => {
          const isLegal = playable && legal.has(index);
          const classes = ['cell'];
          if (cell === 1) classes.push('stone-black');
          if (cell === 2) classes.push('stone-white');
          if (isLegal) classes.push('legal');
          if (lastCell === index) classes.push('last');
          const row = Math.floor(index / 8) + 1;
          const label = `${COLS[index % 8]}${row}`;
          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              className={classes.join(' ')}
              aria-label={`${label}${cell === 1 ? ' 黑子' : cell === 2 ? ' 白子' : ' 空'}${
                isLegal ? '，可以落子' : ''
              }`}
              disabled={!isLegal}
              onClick={() => onPlay(index)}
            >
              {cell !== 0 && <span className="disc" />}
              {isLegal && <span className="legal-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
