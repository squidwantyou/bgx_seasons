import type { PlayerProfile, ProfileMatch, ProfileResult, Visibility } from '@bgx/protocol';
import { db } from './db.js';
import { AppError } from './errors.js';
import { getGame } from './games/registry.js';

interface UserProfileRow {
  id: string;
  name: string;
  username: string | null;
  created_at: number;
}

interface ProfileMatchRow {
  id: string;
  game_id: string;
  status: 'waiting' | 'active' | 'finished';
  visibility: Visibility;
  state: string;
  seq: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  my_seat: number;
}

interface SeatNameRow {
  seat: number;
  user_id: string;
  name: string;
}

function gameNameOf(gameId: string): string {
  try {
    return getGame(gameId).meta.name;
  } catch {
    return gameId;
  }
}

/**
 * 结算结果优先取状态里的 winner；旧数据解析失败时按平局展示，不阻断整个主页。
 */
function winnerOf(row: ProfileMatchRow): number | null {
  if (row.status !== 'finished') return null;
  try {
    const engine = getGame(row.game_id);
    const state = JSON.parse(row.state) as unknown;
    return engine.winner(state as never);
  } catch {
    return null;
  }
}

function seatsOf(matchId: string): SeatNameRow[] {
  return db
    .prepare(
      `SELECT s.seat, s.user_id, COALESCE(u.name, s.name) AS name
         FROM match_seats s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.match_id = ?
        ORDER BY s.seat ASC`,
    )
    .all(matchId)
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        seat: Number(row.seat),
        user_id: String(row.user_id),
        name: String(row.name),
      };
    });
}

/**
 * 玩家主页。私密对局只对参与者本人可见；公开对局任何人都能看。
 * viewerId 为空表示未登录访客。
 */
export function getPlayerProfile(userId: string, viewerId: string | null): PlayerProfile {
  const user = db
    .prepare('SELECT id, name, username, created_at FROM users WHERE id = ?')
    .get(userId) as (Record<string, unknown> & UserProfileRow) | undefined;
  if (!user) throw new AppError('user_not_found', '玩家不存在', 404);

  const viewerSeats = new Set<string>();
  if (viewerId) {
    const rows = db
      .prepare('SELECT match_id FROM match_seats WHERE user_id = ?')
      .all(viewerId) as Array<{ match_id: string }>;
    for (const row of rows) viewerSeats.add(String(row.match_id));
  }

  const rows = db
    .prepare(
      `SELECT m.id, m.game_id, m.status, m.visibility, m.state, m.seq,
              m.created_at, m.started_at, m.ended_at, s.seat AS my_seat
         FROM matches m
         JOIN match_seats s ON s.match_id = m.id
        WHERE s.user_id = ?
        ORDER BY COALESCE(m.ended_at, m.started_at, m.created_at) DESC`,
    )
    .all(userId) as unknown as ProfileMatchRow[];

  const matches: ProfileMatch[] = [];
  for (const row of rows) {
    // 私密房间的邀请链接就是准入凭证，主页不应把它公开出去。
    const canSeePrivate = viewerId === userId || viewerSeats.has(row.id);
    if (row.visibility === 'private' && !canSeePrivate) continue;

    const players = seatsOf(row.id).map((seat) => ({
      seat: seat.seat,
      userId: seat.user_id,
      name: seat.name,
    }));
    const opponentName =
      players
        .filter((player) => player.seat !== row.my_seat)
        .map((player) => player.name)
        .join('、') || null;

    const winner = winnerOf(row);
    let result: ProfileResult;
    if (row.status === 'waiting') result = 'waiting';
    else if (row.status === 'active') result = 'playing';
    else if (winner === null) result = 'draw';
    else result = winner === row.my_seat ? 'win' : 'loss';

    matches.push({
      matchId: row.id,
      gameId: row.game_id,
      gameName: gameNameOf(row.game_id),
      status: row.status,
      visibility: row.visibility,
      mySeat: Number(row.my_seat),
      result,
      winner,
      createdAt: Number(row.created_at),
      startedAt: row.started_at === null ? null : Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      moveCount: Number(row.seq),
      players,
      opponentName,
    });
  }

  const stats = { total: matches.length, wins: 0, losses: 0, draws: 0, active: 0 };
  for (const match of matches) {
    if (match.result === 'win') stats.wins += 1;
    else if (match.result === 'loss') stats.losses += 1;
    else if (match.result === 'draw') stats.draws += 1;
    else if (match.result === 'playing') stats.active += 1;
  }

  return {
    user: {
      id: String(user.id),
      name: String(user.name),
      username: user.username === null ? null : String(user.username),
      createdAt: Number(user.created_at),
    },
    stats,
    matches,
  };
}
