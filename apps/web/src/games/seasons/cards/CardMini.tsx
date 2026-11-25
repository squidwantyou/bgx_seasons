import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import type { SeasonsCardView } from '@bgx/protocol/games/seasons';
import { cardArt } from '../art';
import { ElementPips } from '../energy/ElementStack';

function nameOf(id: number): string {
  return CARD_BY_ID.get(id)?.nameZh ?? `卡牌 #${id}`;
}

/** 场上/选择列表用的横向小卡：缩略图 + 名称 + 状态。 */
export function CardMini({
  card,
  hint,
  onClick,
  onInspect,
  selected = false,
  fresh = false,
}: {
  card: SeasonsCardView;
  hint?: string;
  onClick?: () => void;
  onInspect?: (cardId: number) => void;
  selected?: boolean;
  fresh?: boolean;
}) {
  const name = nameOf(card.i);
  const art = cardArt(card.i);
  const interactive = Boolean(onClick);
  const def = CARD_BY_ID.get(card.i);
  const stored = (card as { stored?: Partial<Record<'water' | 'air' | 'fire' | 'earth', number>> }).stored;
  const activatable =
    !card.used &&
    Boolean(def?.effect && (def.effect.trigger === 'activation' || def.effect.triggers?.includes('activation')));
  return (
    <div
      className={[
        'ss-card-mini',
        selected ? 'ss-card-mini-selected' : '',
        fresh ? 'ss-card-mini-fresh' : '',
        interactive ? 'ss-card-mini-clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
      title={`${name}${def?.desc ? ` · ${def.desc}` : ''}${hint ? ` · ${hint}` : ''}`}
    >
      {onInspect && (
        <button
          type="button"
          className="ss-card-mini-info"
          aria-label={`查看${name}详情`}
          onClick={(event) => {
            event.stopPropagation();
            onInspect(card.i);
          }}
        >
          ?
        </button>
      )}
      {art ? (
        <img src={art} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className="ss-card-mini-missing">{name}</span>
      )}
      <span className="ss-card-mini-body">
        <span className="ss-card-mini-name">
          {name}
          {activatable && <span className="ss-card-mini-badge">可激活</span>}
        </span>
        <span className="ss-card-mini-meta">
          {card.used ? '本回合已激活' : hint ?? ''}
        </span>
        {stored && (
          <span className="ss-card-mini-stored">
            {(['water', 'air', 'fire', 'earth'] as const).map((element) =>
              stored[element] ? <ElementPips key={element} element={element} count={stored[element]} size="sm" /> : null,
            )}
          </span>
        )}
      </span>
    </div>
  );
}
