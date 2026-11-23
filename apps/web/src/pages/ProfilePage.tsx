import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProfileMatch, ProfileResult, PlayerProfile } from '@bgx/protocol';
import { api, ApiError, errorMessage, setCachedMe } from '../lib/api';
import { useMe } from '../hooks/useMe';
import { usePageMeta } from '../hooks/usePageMeta';
import { hueOf, timeAgo } from '../lib/format';

const RESULT_LABEL: Record<ProfileResult, string> = {
  win: '胜',
  loss: '负',
  draw: '和',
  playing: '进行中',
  waiting: '等待中',
};

const STATUS_LABEL: Record<ProfileMatch['status'], string> = {
  waiting: '等待对手',
  active: '正在进行',
  finished: '已结束',
};

function profileDescription(profile: PlayerProfile | null): string {
  if (!profile) return 'BGX 玩家主页：查看玩家资料和历史对局。';
  return `${profile.user.name} 的 BGX 主页：共 ${profile.stats.total} 局，${profile.stats.wins} 胜 ${profile.stats.losses} 负 ${profile.stats.draws} 和。`;
}

function HistoryRow({ match }: { match: ProfileMatch }) {
  const opponent = match.players.find((player) => player.seat !== match.mySeat);
  const when = match.endedAt ?? match.startedAt ?? match.createdAt;
  return (
    <li>
      <Link className="history-row" to={`/m/${match.matchId}`}>
        <span className={`history-result result-${match.result}`}>
          {RESULT_LABEL[match.result]}
        </span>
        <span
          className="avatar avatar-sm"
          style={{
            background: opponent ? `hsl(${hueOf(opponent.userId)} 52% 40%)` : 'transparent',
          }}
          aria-hidden
        >
          {opponent ? opponent.name.slice(0, 1) : '?'}
        </span>
        <span className="history-body">
          <span className="history-title">
            {match.gameName}
            <span className="history-vs">vs</span>
            <span className="history-opponent">{match.opponentName ?? '等待对手'}</span>
            {match.visibility === 'private' && <span className="private-tag">私密</span>}
          </span>
          <span className="history-meta">
            {timeAgo(when)} · {match.moveCount} 个动作 · #{match.matchId}
          </span>
        </span>
        <span className={`history-status status-${match.status}`}>{STATUS_LABEL[match.status]}</span>
      </Link>
    </li>
  );
}

export function ProfilePage() {
  const { userId = '' } = useParams();
  const { me, setMe } = useMe();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .profile(userId)
      .then((data) => {
        if (alive) setProfile(data);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setError('这个玩家不存在，可能链接已经失效。');
        else setError(errorMessage(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!renameOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRenameOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renameOpen]);

  function openRename() {
    setNameValue(profile?.user.name ?? '');
    setNameError('');
    setRenameOpen(true);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (savingName) return;
    const name = nameValue.trim();
    if (!name) {
      setNameError('名字不能为空');
      return;
    }
    setSavingName(true);
    setNameError('');
    try {
      const res = await api.rename(name);
      setCachedMe(res.user);
      setMe(res.user);
      setProfile((prev) =>
        prev ? { ...prev, user: { ...prev.user, name: res.user.name } } : prev,
      );
      setRenameOpen(false);
    } catch (err) {
      setNameError(errorMessage(err));
    } finally {
      setSavingName(false);
    }
  }

  usePageMeta(
    profile ? `${profile.user.name} 的主页 · BGX` : '玩家主页 · BGX',
    profileDescription(profile),
  );

  if (loading) {
    return (
      <div className="page profile-page">
        <div className="notice-card">
          <p className="eyebrow">玩家主页</p>
          <p className="muted">正在读取资料…</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="page profile-page">
        <div className="notice-card">
          <p className="eyebrow">玩家主页</p>
          <h1>看不到这个主页</h1>
          <p className="muted">{error || '玩家不存在。'}</p>
          <Link to="/" className="btn btn-primary">
            回到大厅
          </Link>
        </div>
      </div>
    );
  }

  const isMe = me?.id === profile.user.id;
  const stats = profile.stats;

  return (
    <div className="page profile-page">
      <Link to="/" className="back-link">
        ← 回到大厅
      </Link>

      <section className="panel profile-hero">
        <span
          className="avatar profile-avatar"
          style={{ background: `hsl(${hueOf(profile.user.id)} 55% 42%)` }}
          aria-hidden
        >
          {profile.user.name.slice(0, 1)}
        </span>
        <div className="profile-identity">
          <p className="eyebrow">玩家主页</p>
          <h1 className="profile-name">
            {profile.user.name}
            {isMe && <span className="you-tag">你</span>}
          </h1>
          <p className="profile-meta">
            {profile.user.username ? `@${profile.user.username}` : '游客玩家'}
            <span className="footer-dot" aria-hidden>
              ·
            </span>
            加入于 {timeAgo(profile.user.createdAt)}
          </p>
          {isMe && (
            <button type="button" className="btn btn-ghost btn-sm profile-rename" onClick={openRename}>
              修改昵称
            </button>
          )}
        </div>

        <div className="profile-stats" aria-label="对局统计">
          <div className="profile-stat">
            <strong>{stats.total}</strong>
            <span>对局</span>
          </div>
          <div className="profile-stat stat-win">
            <strong>{stats.wins}</strong>
            <span>胜</span>
          </div>
          <div className="profile-stat stat-loss">
            <strong>{stats.losses}</strong>
            <span>负</span>
          </div>
          <div className="profile-stat stat-draw">
            <strong>{stats.draws}</strong>
            <span>和</span>
          </div>
        </div>
      </section>

      <section className="panel profile-history">
        <div className="panel-head">
          <h2>历史对局</h2>
          <span className="muted small">
            {profile.matches.length} 局
            {stats.active > 0 ? ` · ${stats.active} 局进行中` : ''}
          </span>
        </div>

        {profile.matches.length === 0 ? (
          <div className="profile-empty">
            <p>还没有历史对局。</p>
            {isMe && (
              <Link to="/" className="btn btn-primary btn-sm">
                去大厅开一局
              </Link>
            )}
          </div>
        ) : (
          <ul className="history-list">
            {profile.matches.map((match) => (
              <HistoryRow key={match.matchId} match={match} />
            ))}
          </ul>
        )}

        {profile.matches.length > 0 && (
          <p className="muted small profile-history-foot">
            只展示公开对局，以及你作为参与者能看到的私密对局。
          </p>
        )}
      </section>

      {renameOpen && (
        <div className="dialog-backdrop" onClick={() => setRenameOpen(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="修改昵称"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="dialog-title">修改昵称</h2>
            <p className="dialog-hint">其他玩家在房间里看到的名字，最多 16 个字符。</p>
            <form onSubmit={submitRename}>
              <input
                className="input"
                value={nameValue}
                maxLength={32}
                autoFocus
                onChange={(e) => setNameValue(e.target.value)}
                placeholder="给自己起个名字"
              />
              {nameError && <p className="form-error">{nameError}</p>}
              <div className="dialog-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setRenameOpen(false)}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingName}>
                  {savingName ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
