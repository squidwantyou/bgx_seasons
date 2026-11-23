import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('哈希后可以用原密码校验通过', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('错误密码校验失败', () => {
    const stored = hashPassword('s3cret-password');
    expect(verifyPassword('s3cret-passwore', stored)).toBe(false);
  });

  it('相同密码两次哈希结果不同（含随机盐）', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });

  it('空/畸形哈希返回 false 而不是抛错', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'md5$abc')).toBe(false);
    expect(verifyPassword('x', 'scrypt$abc$$$')).toBe(false);
  });
});
