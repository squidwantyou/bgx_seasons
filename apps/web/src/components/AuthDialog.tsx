import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';

type Mode = 'login' | 'register';

export function AuthDialog({ initialMode, onClose }: { initialMode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function switchMode(next: Mode) {
    setMode(next);
    setErr('');
    setPassword('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!name) {
      setErr('请输入用户名');
      return;
    }
    if (password.length < 8) {
      setErr('密码至少 8 位');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      if (mode === 'register') await api.register(name, password);
      else await api.login(name, password);
      // 身份变化后重置连接与页面状态，避免沿用旧 socket 会话
      window.location.reload();
    } catch (e2) {
      setErr(errorMessage(e2));
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'register' ? '注册账号' : '登录账号'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-tabs" role="tablist" aria-label="登录或注册">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        <p className="dialog-hint">
          {mode === 'register'
            ? '注册后可以跨设备登录，当前游客身份下的对局记录会保留。'
            : '登录后继续使用你的账号，未注册也可以直接玩。'}
        </p>

        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">用户名</span>
            <input
              className="input"
              value={username}
              autoFocus
              autoComplete="username"
              maxLength={24}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="字母开头，3-24 位字母/数字/下划线"
            />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          {err && <p className="form-error">{err}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '请稍候…' : mode === 'register' ? '注册并登录' : '登录'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
