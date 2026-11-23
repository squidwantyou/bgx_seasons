import type { Server, Socket } from 'socket.io';
import { clientMessageSchema, type GameEvent } from '@bgx/protocol';
import { userFromCookieHeader } from './auth.js';
import * as matches from './matches.js';
import { AppError } from './errors.js';

const roomOf = (matchId: string) => `match:${matchId}`;

const CHAT_MIN_INTERVAL_MS = 400;

export function attachRealtime(io: Server): void {
  io.use((socket, next) => {
    const user = userFromCookieHeader(socket.handshake.headers.cookie);
    if (!user) return next(new Error('unauthorized'));
    socket.data.userId = user.id;
    socket.data.userName = user.name;
    next();
  });

  io.on('connection', (socket: Socket) => {
    socket.data.joinedMatch = null as string | null;
    socket.data.lastChatAt = 0;

    socket.on('join', (raw: unknown) => {
      const msg = clientMessageSchema.safeParse(raw);
      if (!msg.success || msg.data.t !== 'join') {
        return emitError(socket, new AppError('bad_message', '消息格式不正确', 400));
      }
      try {
        const view = matches.buildView(msg.data.matchId, socket.data.userId as string);
        const previous = socket.data.joinedMatch as string | null;
        if (previous && previous !== msg.data.matchId) socket.leave(roomOf(previous));
        socket.join(roomOf(msg.data.matchId));
        socket.data.joinedMatch = msg.data.matchId;
        socket.emit('snapshot', { t: 'snapshot', view });
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('action', (raw: unknown) => {
      const msg = clientMessageSchema.safeParse(raw);
      if (!msg.success || msg.data.t !== 'action') {
        return emitError(socket, new AppError('bad_message', '消息格式不正确', 400));
      }
      // 动作不做时间限流：回合制本身保证一回合只有一个动作生效，
      // 重复的 actionId 会被幂等表拦截，滥用由后续网关限流处理。
      if (socket.data.joinedMatch !== msg.data.matchId) {
        return emitError(socket, new AppError('not_in_match', '还没有进入这个房间', 409), msg.data.actionId);
      }
      try {
        matches.applyAction(
          msg.data.matchId,
          { id: socket.data.userId as string, name: socket.data.userName as string, username: null },
          msg.data.action,
          msg.data.actionId,
        );
      } catch (err) {
        emitError(socket, err, msg.data.actionId);
      }
    });

    socket.on('chat', (raw: unknown) => {
      const msg = clientMessageSchema.safeParse(raw);
      if (!msg.success || msg.data.t !== 'chat') {
        return emitError(socket, new AppError('bad_message', '消息格式不正确', 400));
      }
      const now = Date.now();
      if (now - (socket.data.lastChatAt as number) < CHAT_MIN_INTERVAL_MS) {
        return emitError(socket, new AppError('too_fast', '发得太快了', 429));
      }
      if (socket.data.joinedMatch !== msg.data.matchId) {
        return emitError(socket, new AppError('not_in_match', '还没有进入这个房间', 409));
      }
      socket.data.lastChatAt = now;
      try {
        const message = matches.addChat(
          msg.data.matchId,
          { id: socket.data.userId as string, name: socket.data.userName as string, username: null },
          msg.data.text,
        );
        io.to(roomOf(msg.data.matchId)).emit('chat', { t: 'chat', message });
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('leave', (raw: unknown) => {
      const msg = clientMessageSchema.safeParse(raw);
      if (msg.success && msg.data.t === 'leave') {
        socket.leave(roomOf(msg.data.matchId));
        if (socket.data.joinedMatch === msg.data.matchId) socket.data.joinedMatch = null;
      }
    });
  });

  matches.bus.on('update', (payload: { matchId: string; events: GameEvent[]; seq?: number }) => {
    void broadcastUpdate(io, payload.matchId, payload.events);
  });

  matches.bus.on('rematch', (payload: { oldMatchId: string; newMatchId: string }) => {
    io.to(roomOf(payload.oldMatchId)).emit('rematch', {
      t: 'rematch',
      matchId: payload.newMatchId,
    });
  });
}

async function broadcastUpdate(io: Server, matchId: string, events: GameEvent[]): Promise<void> {
  try {
    const sockets = await io.in(roomOf(matchId)).fetchSockets();
    for (const socket of sockets) {
      try {
        const view = matches.buildView(matchId, socket.data.userId as string);
        socket.emit('update', { t: 'update', view, events });
      } catch {
        // 对局刚被删除或用户数据异常时忽略单个连接
      }
    }
  } catch (err) {
    console.error('broadcast failed', err);
  }
}

function emitError(socket: Socket, err: unknown, actionId?: string): void {
  if (err instanceof AppError) {
    socket.emit('error', { t: 'error', code: err.code, message: err.message, actionId });
    return;
  }
  console.error('socket error', err);
  socket.emit('error', {
    t: 'error',
    code: 'internal',
    message: '服务器开小差了',
    actionId,
  });
}
