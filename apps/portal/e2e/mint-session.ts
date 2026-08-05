import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { portalAuth } from '@cmt/firebase-shared/admin/auth';
import {
  createPortalSessionCookie,
  exchangeCustomTokenForIdToken,
} from '@cmt/firebase-shared/admin/session';
import { E2E_BASE_URL } from './_helpers';

/**
 * ── Mint an E2E session WITHOUT going through /api/setu/auth/password-sign-in ──
 *
 * WHY THIS EXISTS. That route runs `checkAndRecordOtpRateLimit(normalizedEmail)`
 * (mint-password-session.ts:49) — the SAME limiter the OTP flow uses, **5
 * attempts per 15 minutes, keyed on the normalized email**.
 *
 * Thirteen specs sign in through it, 31 calls in all. Those are spread across
 * several personas (TEST_ACCOUNT_EMAILS.*, KIOSK_EMAIL, PENDING_EMAIL), so each
 * has its own budget — the suite is not doomed by that count alone. What DOES
 * run out is any single address used by both this setup step and the specs that
 * re-authenticate, plus re-runs within the window. On 2026-08-04 that produced
 * `password-sign-in?mode=mobile failed for e2e-family@chinmayatoronto.org: 429`
 * and five red specs mid-investigation, which reads exactly like a product
 * regression and cost real time to tell apart from one.
 *
 * Removing the setup step's dependency on the route takes the shared account out
 * of the limiter entirely. The 13 specs still call it directly; migrating them
 * to this helper is the obvious follow-up and would remove the last of it.
 *
 * WHAT THIS IS NOT. It is NOT an auth bypass, and no part of it ships. There is
 * no test header, no magic token and no "skip the check if env X" branch in the
 * app — adding one would be a live authentication hole in front of ~570 real
 * families and live PAD mandates, and env-gating does not make that safe
 * (preview and production build the same code).
 *
 * WHAT IT ACTUALLY DOES. Exactly what the portal does after it has decided a
 * caller is genuine — using the service-account credentials the E2E run already
 * holds, entirely outside the app:
 *
 *   getUserByEmail  ->  createCustomToken  ->  exchange for an idToken
 *                   ->  createSessionCookie  ->  write it into storageState
 *
 * The credential check is not skipped so much as replaced by a stronger one: you
 * need the project's private key to do this at all. Custom claims ride along
 * because `mint-password-session.ts:92` persists them with
 * `setCustomUserClaims`, so the user carries role/fid/mid between sign-ins and
 * the exchanged idToken (and therefore the cookie) contains them.
 *
 * REQUIRES the same env as any other admin script: PORTAL_FIREBASE_* service
 * account creds plus NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY (used by the custom
 * token exchange). Run under `--env-file=.env.local`, as the rest of the suite is.
 */

/** Cookie flags copied from the real route (password-sign-in/route.ts:74-80). */
const COOKIE_NAME = '__session';

function hostFor(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

/**
 * Mint a session for `email` and write a Playwright storageState file.
 *
 * @param email   a seeded UAT account. Never a real family — this runs against
 *                whatever project `.env.local` points at, so it must stay UAT.
 * @param outPath storageState path the Playwright project loads.
 */
export async function mintSessionStorageState(email: string, outPath: string): Promise<void> {
  const auth = portalAuth();

  const user = await auth.getUserByEmail(email).catch((e: unknown) => {
    throw new Error(
      `[e2e] no Firebase user for ${email}. Seed the fixture first `
        + `(pnpm --filter @cmt/portal seed:e2e-family). Cause: ${String(e).slice(0, 160)}`,
    );
  });

  const customToken = await auth.createCustomToken(user.uid);
  const idToken = await exchangeCustomTokenForIdToken(customToken);

  // Firebase caps session cookies at 14 days; the app reads the same env var and
  // is likewise capped. Keep them in step rather than hard-coding a number here.
  const expiresInDays = Math.min(Number(process.env['SESSION_COOKIE_EXPIRES_DAYS'] ?? '14'), 14);
  const cookieValue = await createPortalSessionCookie(idToken, expiresInDays);

  const isHttps = E2E_BASE_URL.startsWith('https://');
  const state = {
    cookies: [
      {
        name: COOKIE_NAME,
        value: cookieValue,
        domain: hostFor(E2E_BASE_URL),
        path: '/',
        expires: Math.floor(Date.now() / 1000) + expiresInDays * 24 * 60 * 60,
        httpOnly: true,
        // The route sets `secure` only in production. Mirror the TARGET instead:
        // WebKit silently DROPS a Secure cookie on http://localhost (Chromium
        // exempts localhost), which reads as "signed out" and, in a hydration
        // probe, as a healthy 0%. Getting this wrong produces a false GREEN.
        secure: isHttps,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [] as unknown[],
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(state, null, 2));
}
