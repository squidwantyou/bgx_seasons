import { useDialog } from './useDialog';

const KEY = 'seasons-onboarded';

const STEPS: { title: string; body: string }[] = [
  { title: '① 手牌与召唤', body: '底部是你今年的手牌。点一张牌会先选中并弹出确认条，确认后才召唤；付不起的牌会置灰并写明原因。' },
  { title: '② 骰子与行动顺序', body: '每月每人选一颗骰子，选完立刻结算该骰奖励。行动顺序就是选骰顺序，不按座位顺序。' },
  { title: '③ 拿不准就看这里', body: '顶栏「术语」随时查规则；任意卡牌左上角「?」看完整效果；悬停场上卡还能看到它的描述。' },
];

export function onboardingDone(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

export function markOnboardingDone() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    /* 忽略隐私模式下的存储失败 */
  }
}

/** F7.3 首局三步引导。 */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  return (
    <div className="ss-detail-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="ss-detail ss-onboarding"
        role="dialog"
        aria-modal="true"
        aria-label="新手引导"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ss-detail-head">
          <h3>三步上手</h3>
          <button type="button" className="ss-button ss-button-ghost" onClick={onClose}>
            跳过
          </button>
        </header>
        <ol className="ss-onboarding-list">
          {STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="ss-button ss-button-primary ss-onboarding-go"
          onClick={onClose}
        >
          知道了，开始出牌
        </button>
      </div>
    </div>
  );
}
