import { expect, type APIRequestContext } from '@playwright/test';
import { E2E_FAMILY_EMAIL, E2E_FAMILY_PASSWORD } from './_helpers';

/**
 * Shared storageState file the `setu` Playwright project loads for every test
 * (see playwright.config.ts). Both the API `request` and browser `page`/`context`
 * fixtures are created per-test from this path, and Playwright re-reads the file
 * at each context creation — so overwriting it mid-suite refreshes the session
 * for every subsequent fixture.
 */
export const FAMILY_STORAGE_STATE = 'e2e/.auth/family.json';

/**
 * Sign the shared E2E family in via the password-sign-in route (never OTP) and
 * persist the resulting `__session` cookie to {@link FAMILY_STORAGE_STATE}.
 *
 * This is the exact mechanism `auth.setup.ts` uses to establish the session once
 * up front. It is extracted here so a spec that reseeds the fixture mid-suite can
 * re-establish a fresh session: the seed calls `auth.updateUser(uid, { password })`
 * on every run, which bumps the Firebase user's `tokensValidAfterTime` and
 * invalidates the previously-issued session cookie. Re-writing the storageState
 * file makes the next-created `request`/`page` fixtures pick up a live session.
 *
 * @param request an `APIRequestContext` whose baseURL points at the target app
 *   (the per-test `request` fixture in auth.setup, or a fresh
 *   `request.newContext({ baseURL })` from a spec's `beforeAll`).
 */
export async function signInFamilyAndSaveStorage(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/setu/auth/password-sign-in', {
    data: { email: E2E_FAMILY_EMAIL, password: E2E_FAMILY_PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();

  // The __session cookie is now in the request context; persist it so the
  // `setu` project's per-test fixtures load it on their next creation.
  await request.storageState({ path: FAMILY_STORAGE_STATE });
}
