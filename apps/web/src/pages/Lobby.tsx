import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameMeta, GameOptionValues, MatchSummary } from '@bgx/protocol';
import { api, errorMessage } from '../lib/api';
import { useMe } from '../hooks/useMe';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { hueOf, timeAgo } from '../lib/format';
import { getGameUi, listGameUis } from '../games';
import { defaultOptionValues, GameOptions } from '../components/GameOptions';

const POLL_MS = 3000;

export function Lobby() {
  const navigate = useNavigate();
  const { me } = useMe();
  const { toast, show } = useToast();

  const [games, setGames] = useState<GameMeta[]>([]);
  const gameUis = listGameUis();
  const [selectedGame, setSelectedGame] = useState(gameUis[0]?.meta.id ?? '');
  const [createOptions, setCreateOptions] = useState<GameOptionValues>(() =>
    defaultOptionValues(gameUis[0]?.meta.options ?? []),
  );
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pollError, setPollError] = useState('');
  const [creating, setCreating] = useState<'public' | 'private' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.matches();
      setMatches(res.matches);
      setPollError('');
    } catch (err) {
      setPollError(errorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setCreateOptions(defaultOptionValues(getGameUi(selectedGame)?.meta.options ?? []));
  }, [selectedGame]);

  useEffect(() => {
    api
      .games()
      .then((res) => setGames(res.games))
      .catch(() => setGames([]));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  async function create(visibility: 'public' | 'private') {
    if (creating) return;
    setCreating(visibility);
    try {
      const defs = getGameUi(selectedGame)?.meta.options ?? [];
      const options = Object.fromEntries(
        defs.map((def) => [def.id, createOptions[def.id] ?? def.default]),
      );
      const res = await api.createMatch(selectedGame, visibility, options);
      navigate(`/m/${res.match.id}`);
    } catch (err) {
      show(errorMessage(err), 'error');
      setCreating(null);
    }
  }

  async function joinByCode(e: FormEvent) {
    e.preventDefault();
    const id = code.trim();
    if (!id || joining) return;
    setJoining(true);
    try {
      await api.joinMatch(id);
      navigate(`/m/${id}`);
    } catch (err) {
      show(errorMessage(err), 'error');
      setJoining(false);
    }
  }

  async function enter(match: MatchSummary) {
    if (!me) return;
    const joined = match.players.some((p) => p.userId === me.id);
    const full = match.playerCount >= match.maxPlayers;
    if (joined || match.status !== 'waiting' || full) {
      navigate(`/m/${match.id}`);
      return;
    }
    setBusyId(match.id);
    try {
      await api.joinMatch(match.id);
      navigate(`/m/${match.id}`);
    } catch (err) {
      show(errorMessage(err), 'error');
      setBusyId(null);
    }
  }

  const sorted = [...matches].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'waiting' ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  const selectedUi = getGameUi(selectedGame) ?? gameUis[0] ?? null;
  const liveGame = games.find((g) => g.id === selectedGame) ?? null;
  const pickerGames = gameUis.map((ui) => {
    const live = games.find((g) => g.id === ui.meta.id);
    return {
      id: ui.meta.id,
      name: live?.name ?? ui.meta.title,
      tagline: live?.tagline ?? ui.meta.tagline,
      icon: ui.meta.icon,
    };
  });

  return (
    <div className="page lobby-page">
      <section className="hero">
        <div className="hero-copy">
          <h1>
            开一局{selectedUi?.meta.title ?? '桌游'}，
            <br />
            把朋友拉进来。
          </h1>
          <p className="hero-sub">
            不用注册，打开就能玩。刷新页面、关掉浏览器再回来，棋局都还在。
          </p>

          <div className="game-picker" role="tablist" aria-label="选择游戏">
            {pickerGames.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selectedGame === item.id}
                className={`game-pick${selectedGame === item.id ? ' active' : ''}`}
                onClick={() => setSelectedGame(item.id)}
              >
                <span className="pick-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="pick-text">
                  <span className="pick-name">{item.name}</span>
                  <span className="pick-tag">{item.tagline}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => void create('public')}
              disabled={creating !== null}
            >
              {creating === 'public' ? '创建中…' : '创建公开房间'}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-lg"
              onClick={() => void create('private')}
              disabled={creating !== null}
            >
              {creating === 'private' ? '创建中…' : '创建私密房间'}
            </button>
          </div>
          <form className="code-join" onSubmit={joinByCode}>
            <input
              className="input"
              placeholder="有房间号？直接加入"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={32}
              aria-label="房间号"
            />
            <button type="submit" className="btn btn-ghost" disabled={joining || !code.trim()}>
              {joining ? '加入中…' : '加入'}
            </button>
          </form>
        </div>

        <aside className="hero-side">
          <div className="hero-card">
            <div className="hero-card-head">
              <span className="hero-card-icon" aria-hidden>
                {selectedUi?.meta.icon ?? '◌'}
              </span>
              <div>
                <h2>{liveGame?.name ?? selectedUi?.meta.title ?? '桌游'}</h2>
                <p className="muted small">{liveGame?.tagline ?? selectedUi?.meta.tagline ?? ''}</p>
              </div>
            </div>
            <ul className="rule-list">
              {(selectedUi?.meta.rules ?? []).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            {selectedUi && selectedUi.meta.options.length > 0 && (
              <div className="lobby-options">
                <p className="option-title">对局设置</p>
                <GameOptions
                  definitions={selectedUi.meta.options}
                  values={createOptions}
                  disabled={creating !== null}
                  onChange={(patch) => setCreateOptions((prev) => ({ ...prev, ...patch }))}
                />
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="rooms" aria-labelledby="rooms-title">
        <div className="section-head">
          <h2 id="rooms-title">
            公开房间
            <span className="live-dot" aria-hidden />
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
            刷新
          </button>
        </div>

        {pollError && (
          <p className="poll-error" role="status">
            暂时连不上服务器（{pollError}），正在重试…
          </p>
        )}

        {!loaded && <p className="muted">正在读取房间…</p>}

        {loaded && sorted.length === 0 && (
          <div className="empty-rooms">
            <p>还没有公开房间。</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void create('public')}
              disabled={creating !== null}
            >
              开第一局
            </button>
          </div>
        )}

        <div className="room-grid">
          {sorted.map((match) => {
            const joined = me ? match.players.some((p) => p.userId === me.id) : false;
            const isHost = me ? match.hostId === me.id : false;
            const full = match.playerCount >= match.maxPlayers;
            const label =
              match.status === 'waiting'
                ? joined
                  ? '进入房间'
                  : full
                    ? '观战'
                    : '加入对局'
                : joined
                  ? '返回对局'
                  : '观战';
            return (
              <article key={match.id} className="room-card">
                <div className="room-card-top">
                  <span className={`badge badge-${match.status}`}>
                    {match.status === 'waiting' ? '等待中' : '进行中'}
                  </span>
                  <span className="room-game">{match.gameName}</span>
                  <span className="room-age">{timeAgo(match.createdAt)}</span>
                </div>

                <h3 className="room-title">
                  {isHost ? '我的房间' : `${match.hostName} 的房间`}
                </h3>

                <div className="room-players">
                  {match.players.map((p) => (
                    <span key={p.userId} className="player-pill">
                      <Link
                        to={`/p/${p.userId}`}
                        className="avatar-link"
                        title={`查看 ${p.name} 的主页`}
                        aria-label={`查看 ${p.name} 的主页`}
                      >
                        <span
                          className="avatar avatar-xs"
                          style={{ background: `hsl(${hueOf(p.userId)} 52% 40%)` }}
                        >
                          {p.name.slice(0, 1)}
                        </span>
                      </Link>
                      {p.name}
                      <span className="seat-tag">{getGameUi(match.gameId)?.meta.seats[p.seat] ?? `座位 ${p.seat + 1}`}</span>
                    </span>
                  ))}
                  {Array.from({ length: Math.max(0, match.maxPlayers - match.playerCount) }).map(
                    (_, i) => (
                      <span key={`empty-${i}`} className="player-pill empty">
                        <span className="avatar avatar-xs avatar-empty">?</span>
                        等待玩家
                      </span>
                    ),
                  )}
                </div>

                <div className="room-card-bottom">
                  <span className="room-code" title="房间号">
                    #{match.id} · {match.playerCount}/{match.maxPlayers}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === match.id || !me}
                    onClick={() => void enter(match)}
                  >
                    {busyId === match.id ? '进入中…' : label}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <p className="rooms-note muted small">
          <Link to="/" className="inline-link">
            私密房间
          </Link>{' '}
          不会出现在这里。
        </p>
      </section>

      <Toast toast={toast} />
    </div>
  );
}
