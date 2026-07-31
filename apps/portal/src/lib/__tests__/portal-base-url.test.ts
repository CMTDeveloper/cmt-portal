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

  // ── Vaibhav, 2026-07-30 ───────────────────────────────────────────────────
  // "I created the subdomain setu-preview.chinmayatoronto.org but on Stripe it
  // was pointing to vercel Url for cancel... this will be an issue for prod as
  // well since we will be using custom domain."
  //
  // The allowlist knew only *.vercel.app, so a CMT custom domain fell through to
  // PROD_FALLBACK - which does not merely lose the custom domain, it returns the
  // family to PRODUCTION from a preview deployment.
  it('accepts a CMT custom domain when no env is set', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'setu-preview.chinmayatoronto.org' }))).toBe(
      'https://setu-preview.chinmayatoronto.org',
    );
    expect(portalBaseUrl(reqWith({ 'x-forwarded-host': 'setu.chinmayatoronto.org' }))).toBe(
      'https://setu.chinmayatoronto.org',
    );
    expect(portalBaseUrl(reqWith({ host: 'chinmayatoronto.org' }))).toBe(
      'https://chinmayatoronto.org',
    );
  });

  // The widening above must not become "anything with our name in it". Each of
  // these ends in or contains the brand and is controlled by someone else.
  it('rejects lookalike hosts that merely contain the CMT domain', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    for (const host of [
      'chinmayatoronto.org.evil.com',
      'evil-chinmayatoronto.org',
      'chinmayatoronto.com',
      'chinmayatoronto.org.br',
      'notchinmayatoronto.org',
    ]) {
      expect(portalBaseUrl(reqWith({ 'x-forwarded-host': host })), host).toBe(
        'https://cmt-setu.vercel.app',
      );
    }
  });

  // The old check was `h.startsWith('localhost')`, which also accepted
  // `localhost.evil.com` - and would have handed it an http:// origin.
  it('rejects a host that merely STARTS WITH localhost', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl(reqWith({ host: 'localhost.evil.com' }))).toBe(
      'https://cmt-setu.vercel.app',
    );
  });

  it('falls back to prod with no request', () => {
    delete process.env.NEXT_PUBLIC_PORTAL_BASE_URL;
    expect(portalBaseUrl()).toBe('https://cmt-setu.vercel.app');
  });
});
