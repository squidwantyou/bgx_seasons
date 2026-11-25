import { useEffect, useState } from 'react';
import { CARD_BY_ID } from '@bgx/protocol/games/seasons-cards-all';
import {
  ELEMENTS,
  type Element,
  type SeasonsAction,
  type SeasonsCardView,
  type SeasonsGameView,
} from '@bgx/protocol/games/seasons';
import { cardArt } from './art';
import { ElementChoice, ElementPips, ElementRow } from './energy/ElementStack';
import './styles.css';

const ELEMENT_NAME: Record<Element, string> = { water: '水', air: '风', fire: '火', earth: '土' };

function nameOf(card: SeasonsCardView): string {
  return CARD_BY_ID.get(card.i)?.nameZh ?? `卡牌 #${card.i}`;
}

function ChoiceCardButton({
  card,
  selected,
  onClick,
}: {
  card: SeasonsCardView;
  selected: boolean;
  onClick: () => void;
}) {
  const art = cardArt(card.i);
  return (
    <button
      type="button"
      className={`ss-choice-card${selected ? ' ss-choice-card-selected' : ''}`}
      onClick={onClick}
    >
      {art ? <img src={art} alt={nameOf(card)} draggable={false} /> : <span>{nameOf(card)}</span>}
      <span className="ss-choice-card-name">{nameOf(card)}</span>
    </button>
  );
}

interface ChoiceModalProps {
  game: SeasonsGameView;
  mySeat: number;
  onSend: (action: SeasonsAction) => void;
}

export function ChoiceModal({ game, mySeat, onSend }: ChoiceModalProps) {
  const pending = game.pendingChoice;
  const [alloc, setAlloc] = useState<Record<Element, number>>({ water: 0, air: 0, fire: 0, earth: 0 });
  const [selectedCards, setSelectedCards] = useState<number[]>([]);
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [selectedElements, setSelectedElements] = useState<Element[]>([]);
  const [steps, setSteps] = useState(1);

  const choiceKey = pending ? `${pending.kind}:${pending.key}` : '';
  useEffect(() => {
    setAlloc({ water: 0, air: 0, fire: 0, earth: 0 });
    setSelectedCards([]);
    setSelectedElement(null);
    setSelectedElements([]);
    setSteps(1);
  }, [choiceKey]);

  if (!pending || pending.choosingSeat !== mySeat) return null;

  const options = pending.options;
  const title = typeof options.title === 'string' ? options.title : '请选择';
  const label = typeof options.label === 'string' ? options.label : '确认';
  const kind = pending.kind;
  const cards = Array.isArray(options.cards) ? (options.cards as SeasonsCardView[]) : [];
  const chooser = game.players.find((player) => player.seat === pending.choosingSeat);
  const amount = typeof options.amount === 'number' ? options.amount : 0;
  const keep = typeof options.keep === 'number' ? options.keep : 1;
  const maxPerElement = (options.maxPerElement ?? {}) as Partial<Record<Element, number>>;
  const allowPartial = options.allowPartial === true;
  const step = typeof options.step === 'string' ? options.step : null;
  const STEP_LABEL: Record<string, string> = {
    source: '第 1/3 步 · 选择源能量',
    amount: '第 2/3 步 · 选择转换数量',
    target: '第 3/3 步 · 选择目标能量',
  };
  const allocTotal = ELEMENTS.reduce((sum, element) => sum + alloc[element], 0);
  const allocValid = allowPartial ? allocTotal > 0 && allocTotal <= amount : allocTotal === amount;

  const toggleCard = (uid: number) => {
    setSelectedCards((current) => {
      if (current.includes(uid)) return current.filter((item) => item !== uid);
      if (current.length >= keep) return current;
      return [...current, uid];
    });
  };

  const submit = (choice: unknown) => onSend({ type: 'resolve-choice', choice });

  let body: React.ReactNode = null;

  if (kind === 'energy_swap') {
    const total = typeof options.total === 'number' ? options.total : 0;
    const current = (options.current ?? {}) as Partial<Record<Element, number>>;
    const incoming = (options.incoming ?? {}) as Partial<Record<Element, number>>;
    const sum = ELEMENTS.reduce((acc, element) => acc + alloc[element], 0);
    body = (
      <div className="ss-alloc">
        <p className="ss-muted">储备区上限 {total}。当前储备：</p>
        <ElementRow counts={current} size="sm" />
        {incoming && Object.values(incoming).some((n) => (n ?? 0) > 0) && (
          <>
            <p className="ss-muted">新获得：</p>
            <ElementRow counts={incoming} size="sm" />
          </>
        )}
        {ELEMENTS.map((element) => {
          const cap = (current[element] ?? 0) + (incoming[element] ?? 0);
          return (
            <div className="ss-alloc-row" key={element}>
              <ElementPips element={element} count={cap} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] <= 0}
                onClick={() => setAlloc((now) => ({ ...now, [element]: now[element] - 1 }))}
              >
                −
              </button>
              <ElementPips element={element} count={alloc[element]} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] >= cap || sum >= total}
                onClick={() => setAlloc((now) => ({ ...now, [element]: now[element] + 1 }))}
              >
                ＋
              </button>
            </div>
          );
        })}
        <p className="ss-muted">
          最终保留 {sum} / {total}
        </p>
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={sum !== total}
          onClick={() => submit(alloc)}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'element_alloc') {
    body = (
      <div className="ss-alloc">
        {ELEMENTS.map((element) => {
          const cap = maxPerElement[element] ?? amount;
          return (
            <div className="ss-alloc-row" key={element}>
              <ElementPips element={element} count={cap} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] <= 0}
                onClick={() => setAlloc((current) => ({ ...current, [element]: current[element] - 1 }))}
              >
                −
              </button>
              <ElementPips element={element} count={alloc[element]} size="sm" showEmpty />
              <button
                type="button"
                className="ss-button"
                disabled={alloc[element] >= cap || allocTotal >= amount}
                onClick={() => setAlloc((current) => ({ ...current, [element]: current[element] + 1 }))}
              >
                ＋
              </button>
            </div>
          );
        })}
        <p className="ss-muted">
          共 {allocTotal} / {amount}
          {allowPartial ? '（可以少选）' : ''}
        </p>
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={!allocValid}
          onClick={() => submit(alloc)}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'energy_discard') {
    const available = (options.available ?? {}) as Partial<Record<Element, number>>;
    body = (
      <div className="ss-alloc">
        {ELEMENTS.map((element) => (
          <div className="ss-alloc-row" key={element}>
            <ElementPips element={element} count={available[element] ?? 0} size="sm" showEmpty />
            <button
              type="button"
              className="ss-button"
              disabled={alloc[element] <= 0}
              onClick={() =>
                setAlloc((current) => ({ ...current, [element]: current[element] - 1 }))
              }
            >
              −
            </button>
            <ElementPips element={element} count={alloc[element]} size="sm" showEmpty />
            <button
              type="button"
              className="ss-button"
              disabled={alloc[element] >= (available[element] ?? 0)}
              onClick={() =>
                setAlloc((current) => ({ ...current, [element]: current[element] + 1 }))
              }
            >
              ＋
            </button>
          </div>
        ))}
        <p className="ss-muted">
          共 {allocTotal} / {amount}
        </p>
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={allocTotal !== amount}
          onClick={() => submit(alloc)}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'element_multi') {
    const entries = Array.isArray(options.elements)
      ? (options.elements as { element: Element; count: number }[])
      : [];
    const toggleElement = (element: Element) => {
      setSelectedElements((current) =>
        current.includes(element)
          ? current.filter((item) => item !== element)
          : [...current, element],
      );
    };
    body = (
      <div className="ss-choice-row">
        {entries.map(({ element, count }) => (
          <button
            key={element}
            type="button"
            className={`ss-button${selectedElements.includes(element) ? ' ss-button-primary' : ''}`}
            onClick={() => toggleElement(element)}
          >
            <ElementChoice element={element} count={count} selected={selectedElements.includes(element)} />
          </button>
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={selectedElements.length === 0}
          onClick={() => submit(selectedElements)}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'element_pick') {
    body = (
      <div className="ss-choice-row">
        {ELEMENTS.map((element) => (
          <button
            key={element}
            type="button"
            className={`ss-button${selectedElement === element ? ' ss-button-primary' : ''}`}
            onClick={() => setSelectedElement(element)}
          >
            <ElementChoice
              element={element}
              count={chooser?.energies[element] ?? 0}
              selected={selectedElement === element}
            />
          </button>
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={selectedElement === null}
          onClick={() => selectedElement && submit({ element: selectedElement })}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'card_pick' || kind === 'card_list' || kind === 'sacrifice_cards') {
    const pool =
      kind === 'sacrifice_cards'
        ? options.source === 'hand_or_play'
          ? [...(chooser?.played ?? []), ...(chooser?.hand ?? [])].filter(
              (card) => CARD_BY_ID.get(card.i)?.type === 'familiar',
            )
          : (chooser?.played ?? [])
        : kind === 'card_pick' && options.purpose === 'discard'
          ? (chooser?.hand ?? [])
          : cards;
    body = (
      <div className="ss-choice-cards">
        {pool.map((card) => (
          <ChoiceCardButton
            key={card.u}
            card={card}
            selected={selectedCards.includes(card.u)}
            onClick={() => toggleCard(card.u)}
          />
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={selectedCards.length !== keep}
          onClick={() =>
            submit(kind === 'card_list' ? selectedCards : { uid: selectedCards[0] })
          }
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'multi_player_pick') {
    body = (
      <div className="ss-choice-cards">
        {(chooser?.played ?? []).map((card) => (
          <ChoiceCardButton
            key={card.u}
            card={card}
            selected={selectedCards.includes(card.u)}
            onClick={() => setSelectedCards([card.u])}
          />
        ))}
        <button
          type="button"
          className="ss-button ss-button-primary"
          disabled={selectedCards.length !== 1}
          onClick={() => submit({ uid: selectedCards[0] })}
        >
          {label}
        </button>
      </div>
    );
  } else if (kind === 'branch') {
    const branches = Array.isArray(options.branches)
      ? (options.branches as { id: string; label?: string; enabled?: boolean }[])
      : [];
    body = (
      <div className="ss-choice-row">
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            className="ss-button"
            disabled={branch.enabled === false}
            onClick={() => submit({ id: branch.id })}
          >
            {branch.label ?? branch.id}
          </button>
        ))}
      </div>
    );
  } else if (kind === 'month_advance') {
    body = (
      <div className="ss-choice-row">
        {[1, 2, 3].map((step) => (
          <span key={step} className="ss-choice-row">
            <button
              type="button"
              className={`ss-button${steps === step ? ' ss-button-primary' : ''}`}
              onClick={() => setSteps(step)}
            >
              {step} 格
            </button>
          </span>
        ))}
        <button type="button" className="ss-button" onClick={() => submit({ direction: 'backward', steps })}>
          后退 {steps}
        </button>
        <button type="button" className="ss-button" onClick={() => submit({ direction: 'forward', steps })}>
          前进 {steps}
        </button>
      </div>
    );
  } else {
    body = <p className="ss-muted">暂不支持的选择类型：{kind}</p>;
  }

  return (
    <div className="ss-modal-backdrop">
      <div className="ss-modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {step && <p className="ss-choice-step">{STEP_LABEL[step] ?? step}</p>}
        {body}
      </div>
    </div>
  );
}
