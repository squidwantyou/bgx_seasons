import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import type { SeasonsCardView } from '@bgx/protocol/games/seasons';
import { cardArt } from '../art';
import { ElementCost } from '../energy/ElementStack';

function nameOf(id: number): string {
  return CARD_BY_ID.get(id)?.nameZh ?? `卡牌 #${id}`;
}

/**
 * 手牌/牌堆正面的“大卡”：卡图 + 费用堆叠 + 名称 + 分数。
 * 手牌统一用这个尺寸，点击可抬升；场上与牌堆用 CardMini / CardPile。
 */
export function CardTile({
  card,
  selected = false,
  disabled = false,
  hint,
  tag,
  onClick,
  onInspect,
}: {
  card: SeasonsCardView;
  selected?: boolean;
  disabled?: boolean;
  hint?: string;
  tag?: string;
  onClick?: () => void;
  onInspect?: (cardId: number) => void;
}) {
  const def = CARD_BY_ID.get(card.i);
  const name = nameOf(card.i);
  const art = cardArt(card.i);
  const cost = def?.cost;
  const interactive = Boolean(onClick) && !disabled;
  return (
    <figure
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={[
        'ss-card-tile',
        selected ? 'ss-card-tile-selected' : '',
        interactive ? 'ss-card-tile-clickable' : '',
        disabled ? 'ss-card-tile-disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={`${name}${hint ? ` · ${hint}` : ''}`}
      onClick={interactive ? onClick : undefined}
    >
      {art ? (
        <img className="ss-card-tile-art" src={art} alt={name} loading="lazy" draggable={false} />
      ) : (
        <div className="ss-card-missing">{name}</div>
      )}
      <span className="ss-card-tile-points">{def?.points ?? 0}</span>
      {cost && <ElementCost counts={cost} crystal={cost.crystal} />}
      <figcaption className="ss-card-tile-foot">
        <span className="ss-card-tile-name">{name}</span>
        {tag && <span className="ss-card-tile-tag">{tag}</span>}
      </figcaption>
      {card.used && <span className="ss-card-used">已激活</span>}
      {onInspect && (
        <button
          type="button"
          className="ss-card-tile-info"
          aria-label={`查看${name}详情`}
          onClick={(event) => {
            event.stopPropagation();
            onInspect(card.i);
          }}
        >
          ?
        </button>
      )}
      {hint && <span className="ss-card-tile-hint">{hint}</span>}
    </figure>
  );
}
