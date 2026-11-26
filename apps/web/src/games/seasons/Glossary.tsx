import { dieArt } from './art';
import { useDialog } from './useDialog';

const TERMS: { term: string; text: string }[] = [
  { term: '储备区', text: '存放能量的地方，默认上限 7 点。召唤、激活、晶化都从这里支付；超过上限的能量必须弃掉，或存到带「储备容器」的卡上。' },
  { term: '晶化（Transmute）', text: '支付 1 点能量，换取数量等于当季转换值的水晶（冬 1/1/2/3，春 1/2/3/1，夏 2/3/1/1，秋 3/1/1/2，按水/风/火/土顺序）。只有骰面授予时才可晶化，每回合一次。' },
  { term: '召唤等级', text: '场上可拥有的卡牌数量上限，每张在场卡占 1 级。等级不足时不能召唤。' },
  { term: '徽章', text: '每局 3 个。可换 2 点能量、把 1 点能量换成当季水晶 +1、召唤等级 +1，或让下次抽卡升级为「抽 2 选 1」。' },
  { term: '封印能量', text: '放在某些卡上的能量，既不能支付也不计入储备上限，只有该卡自己的效果能使用。' },
  { term: '灵活费用', text: '支付指定数量、不同种类的能量，每种元素最多支付 maxPerType 个。' },
  { term: '行动顺序', text: '每月按选骰顺序行动，不按座位顺序；选骰阶段每人选一颗，选完立刻结算该骰的奖励。' },
  { term: '牌库与手牌', text: '轮抽结束后，每人把 9 张牌分成三年各 3 张。第 1 年进手牌，第 2/3 年进牌库，每年开始时从牌库入手。' },
];

/** 骰面符号图例（F10.1）：用真实骰图做示例，说明每种符号的含义。 */
const DICE_SYMBOLS: { name: string; text: string; art?: string }[] = [
  { name: '星星', text: '召唤等级 +1（此面同时还给 2 点水能量）', art: dieArt('w', 1, 1) },
  { name: '元素图标', text: '获得对应元素能量（此面为火 +1）', art: dieArt('w', 2, 1) },
  { name: '数字', text: '获得等量水晶（此面为 6 水晶）', art: dieArt('w', 1, 3) },
  { name: '卡牌', text: '抽 1 张牌', art: dieArt('w', 3, 1) },
  { name: '外圈描边', text: '本回合可以晶化能量（此面同时给水、风各 1 点）', art: dieArt('w', 1, 2) },
  { name: '底部小点', text: '时间：本月所有骰子选完后，按最后留下的骰子的点数推进月份' },
];

/** F5.2 术语速查。 */
export function Glossary({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  return (
    <div className="ss-detail-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="ss-detail ss-glossary"
        role="dialog"
        aria-modal="true"
        aria-label="术语速查"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ss-detail-head">
          <h3>术语速查</h3>
          <button type="button" className="ss-button ss-button-ghost" onClick={onClose}>
            关闭
          </button>
        </header>
        <dl className="ss-glossary-list">
          {TERMS.map(({ term, text }) => (
            <div key={term} className="ss-glossary-item">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <section className="ss-dice-legend" aria-label="骰面符号">
          <h4>骰面符号</h4>
          <p className="ss-muted">示例图里同一面通常有多个符号，下面说明的是标题所指的那一个。</p>
          <ul>
            {DICE_SYMBOLS.map(({ name, text, art }) => (
              <li key={name}>
                {art ? <img src={art} alt="" width={48} height={48} draggable={false} /> : <span className="ss-dice-legend-dots">· · ·</span>}
                <span>
                  <strong>{name}</strong>
                  <span className="ss-muted"> {text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
