/** 牌堆 / 牌库 / 弃牌堆：背面堆叠 + 数量，和手牌正面明显区分。 */
export function CardPile({
  count,
  label,
  kind = 'deck',
}: {
  count: number;
  label: string;
  kind?: 'deck' | 'library' | 'discard';
}) {
  return (
    <span className={`ss-pile ss-pile-${kind}`} title={`${label}：${count} 张`}>
      <span className="ss-pile-stack" aria-hidden>
        <span className="ss-pile-back ss-pile-back-3" />
        <span className="ss-pile-back ss-pile-back-2" />
        <span className="ss-pile-back ss-pile-back-1" />
        <span className="ss-pile-count">{count}</span>
      </span>
      <span className="ss-pile-label">{label}</span>
    </span>
  );
}
