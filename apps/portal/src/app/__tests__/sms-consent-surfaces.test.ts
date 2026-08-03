import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicRoute } from '@cmt/shared-domain';
import { SMS_CONSENT_NOTICE, SMS_OPT_OUT_SUFFIX, PRIVACY_PATH } from '@/lib/branding';

/**
 * Carrier toll-free verification checks three things a unit test can actually
 * assert, and each one has cost people weeks when it was missing:
 *
 *  1. a REACHABLE privacy policy URL (unauthenticated - the reviewer has no login)
 *  2. an opt-in disclosure AT THE POINT the phone number is collected
 *  3. an opt-out route on messages that arrive unprompted
 *
 * These are string/route assertions rather than renders on purpose: the failure
 * mode is "somebody deleted the line" or "somebody put the page behind the auth
 * gate", not "React rendered it wrong".
 */

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('the privacy policy is reachable without signing in', () => {
  it('is a PUBLIC route', () => {
    // Behind the gate it is useless to the carrier AND to the family following
    // the link from the consent notice - both are logged out at that moment.
    expect(isPublicRoute(PRIVACY_PATH)).toBe(true);
  });

  it('answers the questions a reviewer looks for', () => {
    const page = read('app/privacy/page.tsx');
    expect(page).toMatch(/Text messages/i);           // a section about SMS at all
    expect(page).toMatch(/STOP/);                     // how to stop
    expect(page).toMatch(/HELP/);                     // how to get help
    expect(page).toMatch(/Message and data rates/i);  // the required disclosure
    // "we never send marketing" is the single line that most often decides an
    // OTP use case, because it separates us from a promotional sender.
    expect(page).toMatch(/never send marketing/i);
  });
});

describe('the opt-in disclosure sits where the number is typed', () => {
  it('names the sender, the purpose, and the way out', () => {
    expect(SMS_CONSENT_NOTICE).toMatch(/Chinmaya Mission Toronto/);
    expect(SMS_CONSENT_NOTICE).toMatch(/text messages/i);
    expect(SMS_CONSENT_NOTICE).toMatch(/Message and data rates may apply/i);
    expect(SMS_CONSENT_NOTICE).toMatch(/STOP/);
    expect(SMS_CONSENT_NOTICE).toMatch(/HELP/);
  });

  it('renders on BOTH the sign-in and register screens', () => {
    expect(read('app/sign-in/page.tsx')).toContain('SMS_CONSENT_NOTICE');
    expect(read('app/register/page.tsx')).toContain('SMS_CONSENT_NOTICE');
  });

  it('reaches BOTH sign-in layout trees', () => {
    // The sign-in page renders its whole form twice, mobile and desktop, and
    // both are in the DOM at once. A screenshot is taken of ONE of them - so a
    // notice added to only one tree is a coin flip on whether the reviewer
    // sees it. Two render sites, one shared element.
    const signIn = read('app/sign-in/page.tsx');
    expect(signIn.match(/\{smsConsent\}/g) ?? []).toHaveLength(2);
    expect(signIn.match(/const smsConsent =/g) ?? []).toHaveLength(1);
  });

  it('links to the privacy policy', () => {
    expect(read('app/sign-in/page.tsx')).toContain('PRIVACY_PATH');
    expect(read('app/register/page.tsx')).toContain('PRIVACY_PATH');
  });
});

describe('unprompted messages carry a way out', () => {
  it('the suffix says STOP', () => {
    expect(SMS_OPT_OUT_SUFFIX).toMatch(/STOP/);
  });

  it('is appended to the join-request and prasad TEXTS', () => {
    // These arrive without the family having just asked for anything, which is
    // the category carriers require an opt-out on. A sign-in code is exempt -
    // the user pressed a button one second earlier - so it deliberately does
    // NOT carry the suffix and stays inside the 160-character segment.
    expect(read('features/setu/join-request/request-family-access.ts')).toContain('SMS_OPT_OUT_SUFFIX');
    expect(read('features/setu/prasad/proposal-notify.ts')).toContain('SMS_OPT_OUT_SUFFIX');
    expect(read('features/setu/prasad/reminder-service.ts')).toContain('SMS_OPT_OUT_SUFFIX');
  });

  it('does NOT bloat the sign-in code message', () => {
    const sendCode = read('app/api/setu/auth/send-code/route.ts');
    expect(sendCode).toContain('CMT portal code:');
    expect(sendCode).not.toContain('SMS_OPT_OUT_SUFFIX');
  });
});
