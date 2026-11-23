export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  /** SQLite 文件位置；默认放到进程工作目录下的 data/ */
  dbPath: process.env.DB_PATH ?? new URL('../data/bgx.db', import.meta.url).pathname,
  /** 对外 URL 前缀（用于 Cookie Path，例如 /bgx） */
  basePath: normalizeBase(process.env.PUBLIC_BASE_PATH ?? '/'),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  sessionTtlMs: 180 * 24 * 60 * 60 * 1000,
  isProd: process.env.NODE_ENV === 'production',
};

function normalizeBase(v: string): string {
  if (!v || v === '/') return '/';
  return ('/' + v.replace(/^\/+|\/+$/g, '')).replace(/\/+$/, '');
}
