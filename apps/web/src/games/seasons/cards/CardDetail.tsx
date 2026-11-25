import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import type { SeasonsCardDef } from '@bgx/protocol/games/seasons';
import { ElementCost } from '../energy/ElementStack';
import { cardArt } from '../art';
import { useDialog } from '../useDialog';

const TRIGGER_NAME: Record<string, string> = {
  on_summon: '召唤时',
  activation: '激活',
  permanent: '常驻',
  score: '计分',
  dice_change: '行动开始',
  turn_end: '回合结束',
  season_change: '换季',
};

function abilityLabel(def: SeasonsCardDef): string[] {
  const effect = def.effect;
  if (!effect) return [];
  const labels: string[] = [];
  const triggers = effect.triggers?.length ? effect.triggers : effect.trigger ? [effect.trigger] : [];
  for (const trigger of triggers) {
    const name = TRIGGER_NAME[trigger];
    if (name) labels.push(name);
  }
  if (def.costFlexible) labels.push(`灵活费用 ${def.costFlexible.min}–${def.costFlexible.max} 种`);
  for (const ability of effect.abilities ?? []) {
    if (ability.kind === 'max_energy_plus') labels.push(`储备上限 +${ability.amount ?? 0}`);
    if (ability.kind === 'reserve_slot') labels.push('可作为储备容器');
    if (ability.kind === 'sealed_energy') labels.push('卡上能量封印');
    if (ability.kind === 'transmute_bonus') labels.push(`转化额外 +${ability.amount ?? 0}`);
    if (ability.kind === 'cost_reduction') labels.push(`召唤费用 −${ability.amount ?? 0}`);
    if (ability.kind === 'on_summon_crystal') labels.push(`召唤时水晶 +${ability.amount ?? 0}`);
    if (ability.kind === 'on_summon_energy') labels.push(`召唤时能量 +${ability.amount ?? 0}`);
    if (ability.kind === 'activation_cost' && ability.element) {
      labels.push(`激活需付 ${ability.amount ?? 1} 点${ability.element}`);
    }
    if (ability.kind === 'dice_reroll') labels.push('行动开始可重掷骰子');
  }
  return labels;
}

/** F5.1 卡牌详情浮层。 */
export function CardDetail({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const def = CARD_BY_ID.get(cardId);
  const dialogRef = useDialog(onClose);
  return (
    <div className="ss-detail-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="ss-detail"
        role="dialog"
        aria-modal="true"
        aria-label={def?.nameZh ?? '卡牌详情'}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ss-detail-head">
          <h3>{def?.nameZh ?? `卡牌 #${cardId}`}</h3>
          <button type="button" className="ss-button ss-button-ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="ss-detail-body">
          <img className="ss-detail-art" src={cardArt(cardId)} alt={def?.nameZh ?? ''} decoding="async" />
          <div className="ss-detail-meta">
            <div className="ss-detail-row">
              <span className="ss-muted">{def?.nameEn ?? ''}</span>
            </div>
            <div className="ss-detail-row">
              <span className="ss-muted">费用</span>
              <ElementCost counts={def?.cost ?? {}} crystal={def?.cost?.crystal ?? 0} />
            </div>
            <div className="ss-detail-row">
              <span className="ss-muted">分数</span>
              <strong>{def?.points ?? 0}</strong>
              <span className="ss-muted">·</span>
              <span className="ss-muted">{def?.type === 'familiar' ? '随从' : '魔法物品'}</span>
            </div>
            <p className="ss-detail-desc">{def?.desc ?? '暂无描述'}</p>
            {abilityLabel(def ?? ({ id: cardId } as SeasonsCardDef)).length > 0 && (
              <ul className="ss-detail-tags">
                {abilityLabel(def ?? ({ id: cardId } as SeasonsCardDef)).map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
