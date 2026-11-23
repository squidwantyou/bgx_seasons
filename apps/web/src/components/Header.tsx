import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useMe } from '../hooks/useMe';
import { hueOf } from '../lib/format';
import { AuthDialog } from './AuthDialog';

export function Header() {
  const { me } = useMe();
  const location = useLocation();
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [leaving, setLeaving] = useState(false);

  const inRoom = location.pathname.startsWith('/m/');

  async function logout() {
    if (leaving) return;
    if (!window.confirm('退出当前账号？会切换成一个新的游客身份。')) return;
    setLeaving(true);
    try {
      await api.logout();
      window.location.reload();
    } catch (e) {
      window.alert(errorMessage(e));
      setLeaving(false);
    }
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="brand" aria-label="BGX 首页">
          <span className="brand-mark" aria-hidden>
            ●
          </span>
          <span className="brand-name">BGX</span>
          <span className="brand-sub">在线桌游</span>
        </Link>

        <div className="header-right">
          {me ? (
            <div className="account-box">
              <Link
                to={`/p/${me.id}`}
                className="user-chip"
                title="查看我的主页"
                aria-label="查看我的主页"
              >
                <span
                  className="avatar avatar-sm"
                  style={{ background: `hsl(${hueOf(me.id)} 55% 42%)` }}
                >
                  {me.name.slice(0, 1)}
                </span>
                <span className="user-name">{me.name}</span>
                <span className="user-account">{me.username ? `@${me.username}` : '游客'}</span>
              </Link>
              {me.username ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void logout()}
                  disabled={leaving}
                >
                  {leaving ? '退出中…' : '退出'}
                </button>
              ) : (
                <div className="auth-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAuthMode('login')}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setAuthMode('register')}
                  >
                    注册
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span className="user-name muted">连接中…</span>
          )}
          {!inRoom && (
            <Link to="/" className="btn btn-ghost btn-sm">
              大厅
            </Link>
          )}
        </div>
      </div>

      {authMode && <AuthDialog initialMode={authMode} onClose={() => setAuthMode(null)} />}
    </header>
  );
}
