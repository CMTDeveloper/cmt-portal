import { readFileSync } from 'node:fs';
import { test as setup, expect, request as playwrightRequest } from '@playwright/test';
import { E2E_FAMILY_EMAIL, E2E_BASE_URL } from './_helpers';
import { FAMILY_STORAGE_STATE } from './auth-helpers';
import { mintSessionStorageState } from './mint-session';

setup('authenticate family by minting a session with the Admin SDK', async () => {
  setup.skip(!E2E_FAMILY_EMAIL, 'E2E_FAMILY_EMAIL required');

  // Deliberately NOT /api/setu/auth/password-sign-in. That route shares the OTP
  // rate limiter - 5 per 15 minutes keyed on the normalized email - and this
  // shared family address is also used by several specs, so between them and any
  // re-run inside the window it 429s and the failures read as product
  // regressions. See mint-session.ts for why this is not an auth bypass, why
  // nothing here ships, and what remains to be migrated.
  await mintSessionStorageState(E2E_FAMILY_EMAIL as string, FAMILY_STORAGE_STATE);

  // Prove the minted cookie is one the TARGET app accepts, not merely that it is
  // well-formed. Without this the suite could run its whole length signed out:
  // protected pages would quietly redirect to /sign-in, and any spec asserting
  // that something is absent would pass. A setup step that cannot fail is not a
  // setup step - and a signed-out run scoring "healthy" is exactly the false
  // green that cost hours on 2026-08-04.
  const ctx = await playwrightRequest.newContext({
    baseURL: E2E_BASE_URL,
    storageState: FAMILY_STORAGE_STATE,
  });
  const probe = await ctx.get('/api/setu/family');
  const cookieCount = (
    JSON.parse(readFileSync(FAMILY_STORAGE_STATE, 'utf8')) as { cookies: unknown[] }
  ).cookies.length;
  expect(cookieCount, 'no cookie was written to the storageState file').toBeGreaterThan(0);
  expect(
    probe.status(),
    `the minted session was rejected by ${E2E_BASE_URL} (HTTP ${probe.status()}). `
      + 'Check that PORTAL_FIREBASE_* and NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY point at the '
      + 'SAME Firebase project as the target environment.',
  ).toBe(200);
  await ctx.dispose();
});
