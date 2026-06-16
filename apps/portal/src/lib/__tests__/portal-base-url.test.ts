import { describe, it, expect, afterEach } from 'vitest';
import { portalBaseUrl } from '../portal-base-url';

const ENV = process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
afterEach(() => {
  if (ENV === undefined) delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
  else process.env.NEXT_PUBLIC_PORTAL_BASE_URL = ENV;
});

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://x/api/setu/auth/send-code', { method: 'POST', headers });
}

describe('portalBaseUrl', () => {
  it('prefers the configured NEXT_PUBLIC_PORTAL_BASE_URL (origin only)', () => {
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL = 'https://setu.chinmayatoronto.org/some/path';
    // even a forged host must NOT win over the configured base
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'evil.com' }))).toBe(
      'https://setu.chinmayatoronto.org',
    );
  });

  it('IGNORES a forged x-forwarded-host and falls back to prod (host-poisoning guard)', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'evil.com' }))).toBe(
      'https://cmt-setu.vercel.app',
    );
    expect(portalBaseUrl(reqWith({ host: 'attacker.example' }))).toBe(
      'https://cmt-setu.vercel.app',
    );
  });

  it('accepts an allowlisted Vercel host when no env is set', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'cmt-setu.vercel.app' }))).toBe(
      'https://cmt-setu.vercel.app',
    );
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'cmt-setu-git-pr.vercel.app' }))).toBe(
      'https://cmt-setu-git-pr.vercel.app',
    );
  });

  it('accepts localhost (http) for local dev', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl(reqWith({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
  });

  it('falls back to prod with no request', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl()).toBe('https://cmt-setu.vercel.app');
  });
});
