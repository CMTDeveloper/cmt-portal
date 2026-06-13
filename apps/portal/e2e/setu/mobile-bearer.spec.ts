import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { TEST_ACCOUNT_EMAILS, TEST_ACCOUNTS_PASSWORD, hasTestAccounts } from '../_helpers';

// End-to-end proof of the MOBILE auth path against deployed UAT: the app gets a
// Firebase customToken (mode=mobile), exchanges it for an ID token via the
// Firebase REST API exactly as the RN Firebase SDK would, then calls the portal
// APIs with `Authorization: Bearer <idToken>` and NO cookie. This is the path
// the cookie-coupled-route fix unblocks (GET /api/setu/family) plus the two new
// mobile endpoints (dashboard, donations). Read-only — no UAT mutations.
//
// Rate-limit discipline: password-sign-in shares the OTP limiter (5 per contact
// per 15 min). We sign in ONCE per persona in beforeAll and reuse the ID token
// (valid 1h) across this file's tests — never per-test — so the whole spec
// costs 2 sign-ins total. Serial so the personas' sign-ins don't interleave.
test.describe.configure({ mode: 'serial' });

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY;

/** Exchange a Firebase custom token for an ID token (what the RN SDK does). */
async function customTokenToIdToken(apiKey: string, customToken: string): Promise<string> {
  const ctx = await request.newContext();
  const res = await ctx.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { data: { token: customToken, returnSecureToken: true } },
  );
  expect(res.ok(), `custom-token exchange failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { idToken?: string };
  expect(body.idToken, 'no idToken in exchange response').toBeTruthy();
  await ctx.dispose();
  return body.idToken!;
}

/** Sign in mobile-style: password-sign-in?mode=mobile → customToken → idToken. */
async function mobileSignIn(baseURL: string, apiKey: string, email: string): Promise<string> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in?mode=mobile', {
    data: { email, password: TEST_ACCOUNTS_PASSWORD },
  });
  expect(res.ok(), `password-sign-in?mode=mobile failed for ${email}: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { customToken?: string };
  expect(body.customToken, 'mobile sign-in did not return a customToken').toBeTruthy();
  await ctx.dispose();
  return customTokenToIdToken(apiKey, body.customToken!);
}

/** A request context that sends Bearer auth and NEVER a cookie. */
async function bearerContext(baseURL: string, idToken: string): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${idToken}` },
  });
}

test.describe('mobile Bearer auth path (deployed UAT)', () => {
  test.skip(!hasTestAccounts, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');
  test.skip(!FIREBASE_API_KEY, 'NEXT_PUBLIC_PORTAL_FIREBASE_API_KEY required for the token exchange');

  let managerToken = '';
  let memberToken = '';

  test.beforeAll(async ({ baseURL }) => {
    // One sign-in per persona for the whole file (ID tokens last ~1h).
    managerToken = await mobileSignIn(baseURL!, FIREBASE_API_KEY!, TEST_ACCOUNT_EMAILS.parentBrampton);
    memberToken = await mobileSignIn(baseURL!, FIREBASE_API_KEY!, TEST_ACCOUNT_EMAILS.memberBrampton);
  });

  test('GET /api/setu/family works over Bearer (the cookie-coupled fix)', async ({ baseURL }) => {
    const ctx = await bearerContext(baseURL!, managerToken);
    const res = await ctx.get('/api/setu/family');
    expect(res.status(), `family GET over Bearer: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { family: { name: string }; members: unknown[]; isManager: boolean };
    expect(body.family.name).toContain('Test Family Brampton');
    expect(Array.isArray(body.members)).toBeTruthy();
    expect(body.isManager).toBe(true);
    await ctx.dispose();
  });

  test('GET /api/setu/dashboard returns the family home aggregate over Bearer', async ({ baseURL }) => {
    const ctx = await bearerContext(baseURL!, managerToken);
    const res = await ctx.get('/api/setu/dashboard');
    expect(res.status(), `dashboard GET over Bearer: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as {
      family: { fid: string };
      balaVihar: { isEnrolled: boolean; attendance: { total: number } };
      seva: unknown;
      members: unknown[];
    };
    expect(body.family.fid).toBeTruthy();
    expect(body.balaVihar).toBeTruthy();
    expect(Array.isArray(body.members)).toBeTruthy();
    // UI-only fields must not leak to the mobile client
    expect(JSON.stringify(body)).not.toContain('var(--');
    await ctx.dispose();
  });

  test('GET /api/setu/donations lists the family donations over Bearer', async ({ baseURL }) => {
    const ctx = await bearerContext(baseURL!, managerToken);
    const res = await ctx.get('/api/setu/donations');
    expect(res.status(), `donations GET over Bearer: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { donations: unknown[] };
    expect(Array.isArray(body.donations)).toBeTruthy();
    await ctx.dispose();
  });

  test('a family-member (non-manager) is allowed dashboard read but denied a manager write', async ({ baseURL }) => {
    const ctx = await bearerContext(baseURL!, memberToken);
    const dash = await ctx.get('/api/setu/dashboard');
    expect(dash.status()).toBe(200); // member Bearer read works
    // The donation status POST is manager-only. Against the FULL stack the
    // middleware's canAccessRoute denies the non-manager FIRST, with 401
    // `unauthorized` (the handler's 403 is only reachable on a direct call —
    // see the unit test). 401 `unauthorized` (not `no-session`) proves the
    // Bearer token was valid but carried an insufficient role.
    const post = await ctx.post('/api/setu/donations/nonexistent-did/status', {
      data: { status: 'completed' },
    });
    expect(post.status()).toBe(401);
    expect((await post.json()).error).toBe('unauthorized');
    await ctx.dispose();
  });
});
