import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ChatMessage } from '@bgx/protocol';
import { clock, hueOf } from '../lib/format';

interface ChatProps {
  messages: ChatMessage[];
  meId: string | null;
  onSend: (text: string) => boolean;
  disabled?: boolean;
}

export function Chat({ messages, meId, onSend, disabled }: ChatProps) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const ok = onSend(value);
    if (!ok) {
      setError('发送太频繁了，稍等一下');
      return;
    }
    setError('');
    setText('');
  }

  return (
    <section className="panel chat-panel" aria-label="房间聊天">
      <div className="panel-head">
        <h2>房间聊天</h2>
        <span className="muted small">旁观也能聊</span>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="chat-empty">还没有人说话，打个招呼吧。</p>}
        {messages.map((msg) => {
          const mine = msg.userId === meId;
          return (
            <div key={msg.id} className={`chat-row${mine ? ' mine' : ''}`}>
              <Link
                to={`/p/${msg.userId}`}
                className="avatar-link"
                title={`查看 ${msg.name} 的主页`}
                aria-label={`查看 ${msg.name} 的主页`}
              >
                <span
                  className="avatar avatar-xs"
                  style={{ background: `hsl(${hueOf(msg.userId)} 52% 40%)` }}
                >
                  {msg.name.slice(0, 1)}
                </span>
              </Link>
              <div className="chat-bubble">
                <div className="chat-meta">
                  <span className="chat-name">{mine ? '我' : msg.name}</span>
                  <span className="chat-time">{clock(msg.createdAt)}</span>
                </div>
                <p className="chat-text">{msg.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          className="input input-sm"
          value={text}
          maxLength={200}
          disabled={disabled}
          placeholder={disabled ? '连接后才能聊天' : '说点什么…'}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={disabled || !text.trim()}>
          发送
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
