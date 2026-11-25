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
  selected = false,
}: {
  card: SeasonsCardView;
  hint?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  const name = nameOf(card.i);
  const art = cardArt(card.i);
  const interactive = Boolean(onClick);
  const stored = (card as { stored?: Partial<Record<'water' | 'air' | 'fire' | 'earth', number>> }).stored;
  return (
    <button
      type="button"
      className={[
        'ss-card-mini',
        selected ? 'ss-card-mini-selected' : '',
        interactive ? 'ss-card-mini-clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={!interactive}
      onClick={onClick}
      title={`${name}${hint ? ` · ${hint}` : ''}`}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" draggable={false} />
      ) : (
        <span className="ss-card-mini-missing">{name}</span>
      )}
      <span className="ss-card-mini-body">
        <span className="ss-card-mini-name">{name}</span>
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
    </button>
  );
}
