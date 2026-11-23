import type { MatchView } from '@bgx/protocol';
import { reversiCatalog, type ReversiAction, type ReversiGameView } from '@bgx/protocol/games/reversi';
import { Board } from './Board';
import type { GamePanelProps, GameUiPlugin } from '../types';

function Panel({ view, mySeat, disabled, onAction }: GamePanelProps<ReversiGameView>) {
  const game = view.game;
  const myTurn =
    view.status === 'active' &&
    mySeat !== null &&
    view.currentSeat === mySeat &&
    !game.finished;
  const seat0 = view.players.find((p) => p.seat === 0);
  const seat1 = view.players.find((p) => p.seat === 1);

  function play(cell: number) {
    if (!myTurn || disabled || !game.legal.includes(cell)) return;
    const action: ReversiAction = { type: 'move', cell };
    onAction(action);
  }

  return (
    <>
      <div className="score-chips" aria-label="比分">
        <div className={`score-chip${myTurn && game.turn === 1 ? ' score-active' : ''}`}>
          <span className="score-disc black" aria-hidden />
          <span className="score-name">{seat0?.name ?? '黑方'}</span>
          <strong>{game.scores.black}</strong>
        </div>
        <div className={`score-chip${myTurn && game.turn === 2 ? ' score-active' : ''}`}>
          <span className="score-disc white" aria-hidden />
          <span className="score-name">{seat1?.name ?? '白方'}</span>
          <strong>{game.scores.white}</strong>
        </div>
      </div>

      <Board view={game} playable={myTurn && !disabled} onPlay={play} />

      {game.passes > 0 && !game.finished && (
        <p className="muted small">本局已自动跳过 {game.passes} 次</p>
      )}
    </>
  );
}

export const plugin: GameUiPlugin<ReversiGameView> = {
  meta: {
    ...reversiCatalog,
    title: reversiCatalog.name,
    icon: '⚫',
    seats: ['黑', '白'],
  },
  Panel,
  headline(view, mySeat) {
    if (view.status === 'finished') {
      if (view.winner === null) return '平局';
      const winnerName = view.players.find((p) => p.seat === view.winner)?.name;
      if (mySeat === view.winner) return '你赢了';
      if (mySeat === null) return `${winnerName ?? '对手'}获胜`;
      return '这局输了';
    }
    if (mySeat === null) return '观战中';
    const myTurn = view.status === 'active' && view.currentSeat === mySeat;
    return myTurn ? '轮到你落子' : '等待对手落子';
  },
  statusLine(view) {
    if (view.status === 'finished') return '本局已结束';
    const moveCount = view.game.moveCount ?? 0;
    return `第 ${moveCount + 1} 手 · ${view.currentSeat === 0 ? '黑方' : '白方'}行动`;
  },
  playerBadge(view, seat) {
    if (view.status === 'active' && view.currentSeat === seat) return '落子中';
    return null;
  },
  spectatorNote() {
    return '你正在观战，棋盘会实时同步。';
  },
  eventMessage(event) {
    if (event.type === 'player_joined') return { text: '新玩家已入座，等待房主开始' };
    if (event.type === 'match_started') return { text: '对局开始，黑棋先行', tone: 'success' };
    if (event.type === 'pass') return { text: '对方无子可下，跳过一手' };
    if (event.type === 'game_over') return { text: '对局结束' };
    return null;
  },
};
