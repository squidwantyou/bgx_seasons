import type { MatchView } from '@bgx/protocol';
import {
  planeBombCatalog,
  type PlaneBombAction,
  type PlaneBombGameView,
} from '@bgx/protocol/games/plane-bomb';
import { PlaneBombGame } from './PlaneBombGame';
import type { GamePanelProps, GameUiPlugin } from '../types';

function Panel({ view, mySeat, disabled, onAction }: GamePanelProps<PlaneBombGameView>) {
  const game = view.game;
  const displaySeat = (seat: number) =>
    view.players.find((p) => p.seat === seat)?.name ?? `座位 ${seat + 1}`;

  function send(action: PlaneBombAction) {
    if (!disabled) onAction(action);
  }

  return (
    <>
      <div className="score-chips" aria-label="击落数">
        {[0, 1].map((seat) => (
          <div className="score-chip pb-score-chip" key={seat}>
            <span className="pb-chip-plane" aria-hidden>
              ✈
            </span>
            <span className="score-name">{displaySeat(seat)}</span>
            <strong title={`${displaySeat(seat)} 已击落 ${game.down[1 - seat]} 架`}>
              {game.down[1 - seat]}/3
            </strong>
          </div>
        ))}
      </div>

      <PlaneBombGame view={game} mySeat={mySeat} disabled={disabled} onAction={send} />
    </>
  );
}

export const plugin: GameUiPlugin<PlaneBombGameView> = {
  meta: {
    ...planeBombCatalog,
    title: planeBombCatalog.name,
    icon: '✈',
    seats: ['甲', '乙'],
  },
  Panel,
  headline(view, mySeat) {
    const game = view.game;
    if (view.status === 'finished') {
      if (game.draw || view.winner === null) return '平局';
      const winnerName = view.players.find((p) => p.seat === view.winner)?.name;
      if (mySeat === view.winner) return '你赢了';
      if (mySeat === null) return `${winnerName ?? '对手'}获胜`;
      return '这局输了';
    }
    if (mySeat === null) {
      return game.phase === 'placing' ? '观战中 · 布阵阶段' : '观战中';
    }
    if (game.phase === 'placing') {
      return game.placed[mySeat] ? '等待对手布阵' : '布置你的飞机';
    }
    return game.pendingShots[mySeat] ? '已报点，等待对方' : '选择轰炸目标';
  },
  statusLine(view) {
    const game = view.game;
    if (view.status === 'finished') return '本局已结束';
    if (game.phase === 'placing') return '布阵阶段 · 双方各摆三架飞机';
    const downRule =
      view.options.downedPlaneHit === 'miss' ? '已坠落机身再炸算炸空' : '已坠落机身再炸算炸中';
    return `第 ${game.round} 轮 · 双方同时报点 · ${downRule}`;
  },
  playerBadge(view, seat) {
    const game = view.game;
    if (game.phase === 'placing' && game.placed[seat]) return '已布阵';
    return null;
  },
  spectatorNote(view) {
    return view.game.phase === 'placing'
      ? '你正在观战：布阵阶段看不到舰队，开战后只能看到公开弹着。'
      : '你正在观战：只能看到公开弹着与终局轮廓。';
  },
  eventMessage(event) {
    if (event.type === 'player_joined') return { text: '新玩家已入座，等待房主开始' };
    if (event.type === 'match_started') return { text: '对局开始，先摆放三架飞机', tone: 'success' };
    if (event.type === 'options_changed') return { text: '房主更新了开局设置' };
    if (event.type === 'game_over') return { text: '对局结束' };
    return null;
  },
};
