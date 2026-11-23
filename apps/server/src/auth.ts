import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRow } from './db.js';
import { createSession, createUser, sessionUser } from './db.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'bgx_sid';

export function setSessionCookie(reply: FastifyReply, sid: string): void {
  reply.setCookie(SESSION_COOKIE, sid, {
    path: config.basePath,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

/** 新建一个游客身份并写入会话 Cookie */
export function startGuestSession(reply: FastifyReply): UserRow {
  const user = createUser();
  const sid = createSession(user.id, config.sessionTtlMs);
  setSessionCookie(reply, sid);
  return user;
}

export function userFromRequest(request: FastifyRequest, reply: FastifyReply): UserRow {
  const sid = request.cookies[SESSION_COOKIE];
  if (sid) {
    const user = sessionUser(sid);
    if (user) return user;
  }
  return startGuestSession(reply);
}

export function userFromCookieHeader(header: string | undefined): UserRow | null {
  const sid = parseCookieHeader(header)[SESSION_COOKIE];
  return sid ? sessionUser(sid) : null;
}

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      cookies[key] = part.slice(eq + 1).trim();
    }
  }
  return cookies;
}
