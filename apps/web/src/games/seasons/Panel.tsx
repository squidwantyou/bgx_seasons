import { useState } from 'react';
import { ChoiceModal } from './ChoiceModal';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import {
  ELEMENTS,
  type Element,
  type SeasonsCardView,
  type SeasonsGameView,
  type SeasonsPlayerView,
} from '@bgx/protocol/games/seasons';
import type { SeasonsAction } from '@bgx/protocol/games/seasons';
import type { GamePanelProps } from '../types';
import { cardArt, dieArt } from './art';
import { ElementChoice, ElementPips, ElementRow } from './energy/ElementStack';
import './styles.css';

const ELEMENT_NAME: Record<Element, string> = {
  water: '水',
  air: '风',
  fire: '火',
  earth: '土',
};

/** 与引擎 rules/const.ts 的 MAX_BADGES 一致 */
const MAX_BADGES = 3;

const PHASE_NAME: Record<string, string> = {
  draft: '轮抽',
  organize: '组牌',
  play: '行动',
  ended: '已结束',
};

function cardName(id: number): string {
  return CARD_BY_ID.get(id)?.nameZh ?? `卡牌 #${id}`;
}

function cardCost(id: number): string {
  const def = CARD_BY_ID.get(id);
  if (!def) return '';
  if (def.costFlexible) {
    const { min, max } = def.costFlexible;
    return `灵活 ${min}–${max} 种`;
  }
  const cost = def.cost;
  if (!cost) return '';
  return ELEMENTS.filter((element) => cost[element] > 0)
    .map((element) => `${ELEMENT_NAME[element]}${cost[element]}`)
    .join(' ');
}

function isFlexCard(id: number): boolean {
  return Boolean(CARD_BY_ID.get(id)?.costFlexible);
}

/** 灵活费用支付：支付 min–max 种不同元素（每种最多 maxPerType 个）。 */
function PaymentModal({
  cardId,
  player,
  onCancel,
  onConfirm,
}: {
  cardId: number;
  player: SeasonsPlayerView;
  onCancel: () => void;
  onConfirm: (paid: Element[]) => void;
}) {
  const def = CARD_BY_ID.get(cardId);
  const flex = def?.costFlexible;
  const maxPer = flex?.maxPerType ?? 1;
  const min = flex?.min ?? 1;
  const max = flex?.max ?? 4;
  const [paid, setPaid] = useState<Element[]>([]);
  if (!flex) return null;
  const countOf = (element: Element) => paid.filter((item) => item === element).length;
  const toggle = (element: Element) => {
    const current = countOf(element);
    if (current >= maxPer) {
      setPaid((list) => list.filter((item) => item !== element));
      return;
    }
    if (paid.length >= max) return;
    setPaid((list) => [...list, element]);
  };
  const valid = paid.length >= min && paid.length <= max;
  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal" role="dialog" aria-modal="true">
        <h3>支付灵活费用：{def?.nameZh ?? '卡牌'}</h3>
        <p className="ss-muted">
          需支付 {min}–{max} 种不同能量，每种最多 {maxPer} 个。
        </p>
        <div className="ss-alloc">
          {ELEMENTS.map((element) => (
            <div className="ss-alloc-row" key={element}>
              <ElementChoice element={element} count={player.energies[element]} selected={countOf(element) > 0} />
              <ElementPips element={element} count={countOf(element)} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={player.energies[element] < countOf(element) + 1}
                onClick={() => toggle(element)}
              >
                支付
              </button>
            </div>
          ))}
        </div>
        <div className="ss-choice-row">
          <button type="button" className="ss-button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="ss-button ss-button-primary"
            disabled={!valid}
            onClick={() => onConfirm(paid)}
          >
            支付并召唤（{paid.length} 种）
          </button>
        </div>
      </div>
    </div>
  );
}

function CardChip({
  card,
  compact = false,
  onClick,
  selected = false,
  hint,
}: {
  card: SeasonsCardView;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
  hint?: string;
}) {
  const art = cardArt(card.i);
  const name = cardName(card.i);
  const cost = cardCost(card.i);
  return (
    <figure
      className={`ss-card${compact ? ' ss-card-compact' : ''}${selected ? ' ss-card-selected' : ''}${onClick ? ' ss-card-clickable' : ''}`}
      title={`${name}${cost ? ` · ${cost}` : ''}${hint ? ` · ${hint}` : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {art ? (
        <img src={art} alt={name} loading="lazy" draggable={false} />
      ) : (
        <div className="ss-card-missing">{name}</div>
      )}
      <figcaption>
        <span className="ss-card-name">{name}</span>
        {!compact && <span className="ss-card-cost">{cost}</span>}
      </figcaption>
      {card.used && <span className="ss-card-used">已激活</span>}
    </figure>
  );
}

function EnergyRow({ player }: { player: SeasonsPlayerView }) {
  return (
    <div className="ss-energies" aria-label="能量储备">
      <ElementRow counts={player.energies} label="能量储备" />
      <span className="ss-energy-total" title="元素储备上限">
        <ElementPips element="water" count={0} size="sm" />上限 {player.maxEnergy}
      </span>
    </div>
  );
}

function PlayerBlock({
  player,
  label,
  onPlayedClick,
}: {
  player: SeasonsPlayerView;
  label: string;
  onPlayedClick?: (uid: number) => void;
}) {
  return (
    <section className={`ss-player${player.isYou ? ' ss-player-you' : ''}`}>
      <header className="ss-player-head">
        <span className="ss-seat-tag">{label}</span>
        <strong>{player.isYou ? '你' : '对手'}</strong>
        <span className="ss-stat" title="水晶">
          💎 {player.crystals}
        </span>
        <span className="ss-stat" title="召唤等级">
          ⚡ 等级 {player.gauge}
        </span>
        <span className="ss-stat" title="第 2、3 年牌库">
          🂠 牌库 {player.libraryCount}
        </span>
        <span className="ss-stat" title="手牌数">
          ✋ {player.handCount}
        </span>
        {player.badgesUsed > 0 && <span className="ss-stat">🎖 徽章 {player.badgesUsed}</span>}
        {player.draftHandCount > 0 && <span className="ss-stat">🃏 轮抽 {player.draftHandCount} 张</span>}
        {player.organizeDone && <span className="ss-stat">✅ 已组牌</span>}
      </header>
      <EnergyRow player={player} />
      <div className="ss-played">
        {player.played.length === 0 ? (
          <span className="ss-muted">场上还没有牌</span>
        ) : (
          player.played.map((card) => (
            <CardChip
              key={card.u}
              card={card}
              compact
              hint={card.used ? '本回合已激活' : onPlayedClick ? '点击激活' : undefined}
              onClick={onPlayedClick && !card.used ? () => onPlayedClick(card.u) : undefined}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ResultBlock({ game }: { game: SeasonsGameView }) {
  if (!game.result) return null;
  return (
    <section className="ss-result">
      <h3>终局结算</h3>
      <ul>
        {game.result.players.map((score) => (
          <li key={score.seat} className={score.seat === game.result?.winner ? 'ss-winner' : undefined}>
            座位 {score.seat + 1}：{score.score} 分
            <span className="ss-muted">
              （水晶 {score.crystals} · 卡牌 {score.cardPoints} · 效果 {score.effectPoints} · 手牌 -
              {score.handPenalty} · 徽章 -{score.badgePenalty}）
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MyZone({
  player,
  game,
  canAct,
  onSend,
  onFlexSummon,
}: {
  player: SeasonsPlayerView;
  game: SeasonsGameView;
  canAct: boolean;
  onSend: (action: SeasonsAction) => void;
  onFlexSummon: (uid: number) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);

  if (game.phase === 'draft' && player.draftHand) {
    return (
      <section className="ss-hand">
        <h3>
          轮抽手牌 · 第 {game.draftRound + 1} / 9 轮
          {canAct ? ' · 点一张牌选中' : ''}
        </h3>
        <div className="ss-hand-cards">
          {player.draftHand.map((card) => (
            <CardChip
              key={card.u}
              card={card}
              onClick={canAct ? () => onSend({ type: 'draft-pick', cardUid: card.u }) : undefined}
            />
          ))}
        </div>
      </section>
    );
  }

  if (game.phase === 'organize' && player.drafted) {
    const year1 = player.organizeYear1 ?? [];
    const year2 = player.organizeYear2 ?? [];
    const remaining = player.drafted.filter((card) => !year1.includes(card.u) && !year2.includes(card.u));
    const fillingYear = year1.length === 0 ? 1 : year2.length === 0 ? 2 : 3;
    const toggle = (uid: number) => {
      setPicked((current) => {
        if (current.includes(uid)) return current.filter((item) => item !== uid);
        if (current.length >= 3) return current;
        const next = [...current, uid];
        if (next.length === 3) {
          onSend({ type: 'organize', cardUids: [next[0]!, next[1]!, next[2]!] });
          return [];
        }
        return next;
      });
    };
    return (
      <section className="ss-hand">
        <h3>
          组牌 · 第 {fillingYear} 年（选 3 张） · 已放 {year1.length + year2.length} / 9
        </h3>
        <div className="ss-hand-cards">
          {player.drafted.map((card) => {
            const belongs = year1.includes(card.u) ? '第 1 年' : year2.includes(card.u) ? '第 2 年' : undefined;
            return (
              <CardChip
                key={card.u}
                card={card}
                compact={Boolean(belongs)}
                selected={picked.includes(card.u)}
                hint={belongs ?? (canAct ? '点击选中' : undefined)}
                onClick={
                  canAct && !player.organizeDone && !belongs ? () => toggle(card.u) : undefined
                }
              />
            );
          })}
        </div>
        {canAct && !player.organizeDone && (
          <button
            type="button"
            className="ss-button ss-button-ghost"
            disabled={picked.length === 0}
            onClick={() => setPicked([])}
          >
            清空选择（{picked.length}/3）
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="ss-hand">
      <h3>手牌 {player.hand ? `· ${player.hand.length} 张` : ''}{canAct ? ' · 点一张牌召唤' : ''}</h3>
      <div className="ss-hand-cards">
        {player.hand && player.hand.length > 0 ? (
          player.hand.map((card) => (
            <CardChip
              key={card.u}
              card={card}
              hint={isFlexCard(card.i) ? '选择支付后召唤' : undefined}
              onClick={
                canAct
                  ? () =>
                      isFlexCard(card.i)
                        ? onFlexSummon(card.u)
                        : onSend({ type: 'summon', cardUid: card.u })
                  : undefined
              }
            />
          ))
        ) : (
          <span className="ss-muted">没有手牌</span>
        )}
      </div>
    </section>
  );
}

function PlayActions({
  game,
  player,
  canAct,
  onSend,
}: {
  game: SeasonsGameView;
  player: SeasonsPlayerView;
  canAct: boolean;
  onSend: (action: SeasonsAction) => void;
}) {
  if (game.phase !== 'play') return null;
  return (
    <section className="ss-actions">
      {canAct && player.canTransmute && (
        <div className="ss-transmute">
          <span className="ss-muted">转化 1 点能量 → 当季水晶：</span>
          {game.transmuteValues.map(({ element, value }) => (
            <button
              key={element}
              type="button"
              className="ss-button"
              onClick={() => onSend({ type: 'transmute', element })}
              title={`${ELEMENT_NAME[element]} → ${value} 水晶`}
            >
              {ELEMENT_NAME[element]} +{value}
            </button>
          ))}
        </div>
      )}
      <div className="ss-actions-row">
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={!canAct}
          onClick={() => onSend({ type: 'end-turn' })}
        >
          结束回合
        </button>
        <button
          type="button"
          className="ss-button ss-button-ghost"
          disabled={!canAct}
          onClick={() => onSend({ type: 'resign' })}
        >
          认输
        </button>
      </div>
    </section>
  );
}

function DicePool({
  game,
  canAct,
  onSend,
}: {
  game: SeasonsGameView;
  canAct: boolean;
  onSend: (action: SeasonsAction) => void;
}) {
  if (game.dice.length === 0) return null;
  const pickable = canAct && game.phase === 'play' && game.turnOwner === null;
  return (
    <section className="ss-dice" aria-label="本月骰子">
      {game.dice.map((die, index) => {
        const art = dieArt(die.letter, die.id, die.face);
        return (
          <figure
            className={`ss-die${die.pickedBy !== null ? ' ss-die-picked' : ''}${pickable && die.pickedBy === null ? ' ss-die-clickable' : ''}`}
            key={die.id}
            onClick={pickable && die.pickedBy === null ? () => onSend({ type: 'draft-dice', dieIndex: index }) : undefined}
          >
            {art ? (
              <img src={art} alt={`骰子 ${die.pip} 点`} draggable={false} />
            ) : (
              <div className="ss-die-missing">{die.pip}</div>
            )}
            <figcaption>
              {die.pip} 点
              {die.pickedBy !== null ? ` · 座位 ${die.pickedBy + 1}` : ''}
            </figcaption>
            <RewardLine die={die} />
          </figure>
        );
      })}
    </section>
  );
}

function RewardLine({ die }: { die: SeasonsGameView['dice'][number] }) {
  const parts: string[] = [];
  const rewards = die.rewards;
  if (rewards.summon) parts.push('召唤+1');
  if (rewards.transmute) parts.push('转化');
  if (rewards.card) parts.push('抽牌');
  if (rewards.crystals) parts.push(`水晶+${rewards.crystals}`);
  for (const element of ELEMENTS) {
    const count = rewards[element];
    if (count) parts.push(`${ELEMENT_NAME[element]}+${count}`);
  }
  return <span className="ss-die-reward">{parts.join(' ')}</span>;
}


function BadgeBar({
  player,
  canAct,
  onSend,
}: {
  player: SeasonsPlayerView;
  canAct: boolean;
  onSend: (action: SeasonsAction) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'swap' | 'crystal'>('idle');
  const [from, setFrom] = useState<Element[]>([]);
  const [to, setTo] = useState<Element[]>([]);
  const remaining = Math.max(0, MAX_BADGES - player.badgesUsed);
  const reset = () => {
    setMode('idle');
    setFrom([]);
    setTo([]);
  };
  const disabled = !canAct || remaining === 0;

  const clickSwap = (element: Element) => {
    if (from.length < 2) {
      setFrom([...from, element]);
      return;
    }
    if (to.length < 2) {
      const nextTo = [...to, element];
      setTo(nextTo);
      if (nextTo.length === 2) {
        onSend({ type: 'use-badge', badgeType: 1, fromElements: [from[0]!, from[1]!], toElements: nextTo as [Element, Element] });
        reset();
      }
    }
  };

  if (player.badgesUsed >= MAX_BADGES) {
    return (
      <section className="ss-badges">
        <span className="ss-muted">🎖 徽章已用完</span>
      </section>
    );
  }

  return (
    <section className="ss-badges" aria-label="徽章">
      <span className="ss-badges-count">🎖 徽章 {remaining}/{MAX_BADGES}</span>
      {mode === 'idle' && (
        <div className="ss-badges-row">
          <button type="button" className="ss-button" disabled={disabled} onClick={() => setMode('swap')}>
            ① 换能量
          </button>
          <button type="button" className="ss-button" disabled={disabled} onClick={() => setMode('crystal')}>
            ② 能量换水晶
          </button>
          <button
            type="button"
            className="ss-button"
            disabled={disabled}
            onClick={() => onSend({ type: 'use-badge', badgeType: 3 })}
          >
            ③ 召唤等级 +1
          </button>
          <button
            type="button"
            className="ss-button"
            disabled={disabled}
            onClick={() => onSend({ type: 'use-badge', badgeType: 4 })}
          >
            ④ 抽卡升级（摸 2 选 1）
          </button>
        </div>
      )}
      {mode === 'swap' && (
        <div className="ss-badges-row">
          <span className="ss-muted">
            先选 2 个移除（{from.map((element) => ELEMENT_NAME[element]).join('、') || '—'}），再选 2 个获得（
            {to.map((element) => ELEMENT_NAME[element]).join('、') || '—'}）
          </span>
          {ELEMENTS.map((element) => (
            <button
              key={element}
              type="button"
              className="ss-button"
              onClick={() => clickSwap(element)}
              title={`${ELEMENT_NAME[element]}（现有 ${player.energies[element]}）`}
            >
              <ElementChoice element={element} count={player.energies[element]} />
            </button>
          ))}
          <button type="button" className="ss-button ss-button-ghost" onClick={reset}>
            取消
          </button>
        </div>
      )}
      {mode === 'crystal' && (
        <div className="ss-badges-row">
          <span className="ss-muted">选择 1 个能量换水晶（当前季节转换值 +1）：</span>
          {ELEMENTS.map((element) => (
            <button
              key={element}
              type="button"
              className="ss-button"
              onClick={() => {
                onSend({ type: 'use-badge', badgeType: 2, element });
                reset();
              }}
            >
              <ElementChoice element={element} count={player.energies[element]} />
            </button>
          ))}
          <button type="button" className="ss-button ss-button-ghost" onClick={reset}>
            取消
          </button>
        </div>
      )}
    </section>
  );
}

function BadgeKeepModal({ cards, onKeep }: { cards: SeasonsCardView[]; onKeep: (uid: number) => void }) {
  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal ss-badge-keep">
        <h3>抽卡升级：保留 1 张</h3>
        <p className="ss-muted">选中的牌进入手牌，另一张进弃牌堆。</p>
        <div className="ss-badge-keep-row">
          {cards.map((card) => (
            <button
              key={card.u}
              type="button"
              className="ss-badge-keep-card"
              onClick={() => onKeep(card.u)}
            >
              {cardArt(card.i) ? <img src={cardArt(card.i)!} alt="" /> : <span>{card.i}</span>}
              <span>{CARD_BY_ID.get(card.i)?.nameZh ?? `#${card.i}`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SeasonsPanel({ view, mySeat, disabled, onAction }: GamePanelProps<SeasonsGameView>) {
  const game = view.game;
  const me = mySeat === null ? null : (game.players.find((player) => player.seat === mySeat) ?? null);
  const opponents = game.players.filter((player) => player.seat !== mySeat);
  const [paying, setPaying] = useState<{ uid: number; cardId: number } | null>(null);
  const hasChoice = game.pendingChoice !== null;
  const hasBadgeDraw = (me?.badgeDraw?.length ?? 0) > 0;
  const canAct = !disabled && view.status === 'active' && game.myTurn && !hasChoice && !hasBadgeDraw;
  const send = (action: SeasonsAction) => {
    if (disabled || view.status !== 'active') return;
    onAction(action);
  };

  return (
    <div className="ss-board">
      <header className="ss-topbar">
        <span className={`ss-phase ss-phase-${game.phase}`}>{PHASE_NAME[game.phase] ?? game.phase}</span>
        <span className="ss-meta">
          第 {game.year} 年 · {game.season?.name ?? '筹备中'} · 第 {game.month + 1} 月
        </span>
        <span className="ss-counts">
          牌堆 {game.deckCount} · 弃牌 {game.discardCount}
        </span>
      </header>

      {game.pendingChoice && game.pendingChoice.choosingSeat !== mySeat && (
        <p className="ss-wait">
          等待 座位 {game.pendingChoice.choosingSeat + 1} 完成选择
          {typeof game.pendingChoice.options.title === 'string'
            ? `：${game.pendingChoice.options.title}`
            : ''}
        </p>
      )}
      {game.pendingQueueCount > 0 && (
        <p className="ss-queue-hint">之后还有 {game.pendingQueueCount} 个选择将按序处理。</p>
      )}

      <DicePool game={game} canAct={canAct} onSend={send} />

      {opponents.map((player) => (
        <PlayerBlock key={player.seat} player={player} label={`座位 ${player.seat + 1}`} />
      ))}

      {me ? (
        <PlayerBlock
          player={me}
          label={`座位 ${me.seat + 1}`}
          onPlayedClick={canAct ? (uid) => send({ type: 'activate', cardUid: uid }) : undefined}
        />
      ) : (
        <p className="ss-muted">观战中</p>
      )}
      {me && <PlayActions game={game} player={me} canAct={canAct} onSend={send} />}
      {me && game.phase === 'play' && (
        <BadgeBar player={me} canAct={canAct} onSend={send} />
      )}
      {me && (
        <MyZone
          player={me}
          game={game}
          canAct={canAct}
          onSend={send}
          onFlexSummon={(uid) => {
            const card = me?.hand?.find((item) => item.u === uid);
            if (card) setPaying({ uid, cardId: card.i });
          }}
        />
      )}
      {me && paying && (
        <PaymentModal
          key={paying.uid}
          cardId={paying.cardId}
          player={me}
          onCancel={() => setPaying(null)}
          onConfirm={(paid) => {
            const uid = paying.uid;
            setPaying(null);
            send({ type: 'summon', cardUid: uid, paidElements: paid });
          }}
        />
      )}
      <ResultBlock game={game} />

      {me && hasChoice && game.pendingChoice?.choosingSeat === me.seat && (
        <ChoiceModal game={game} mySeat={me.seat} onSend={send} />
      )}
      {me && hasBadgeDraw && (
        <BadgeKeepModal
          cards={me.badgeDraw ?? []}
          onKeep={(uid) => send({ type: 'badge-keep', cardUid: uid })}
        />
      )}

      <section className="ss-log">
        <h3>对局记录</h3>
        <ol>
          {game.log.slice(-8).map((entry, index) => (
            <li key={`${entry.t}-${index}`} className={`ss-log-${entry.t}`}>
              {entry.msg}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
