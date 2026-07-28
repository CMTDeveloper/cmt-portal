import { test, expect, request as apiRequest, type APIRequestContext } from '@playwright/test';
import { E2E_BASE_URL } from '../../_helpers';

/**
 * Staff cross-family edit, walked against DEPLOYED UAT.
 *
 * Everything these routes depend on is invisible to mocks: the middleware
 * allow-list, the in-handler role check, Next's static-vs-dynamic segment
 * resolution (`families/migration-status` sits beside `families/[fid]`), and
 * whether the audit row actually commits with the write.
 *
 * Mutating, so it cleans up: one probe member is added to a real UAT family and
 * removed again, in a finally AND in afterAll.
 *
 * Auth is password sign-in, never OTP, and each persona signs in ONCE with its
 * cookies cached - the password limiter is 5 per 15 minutes and shared across
 * every spec, so per-test sign-in trips it inside one file.
 */

const DOMAIN = 'chinmayatoronto.org';
const PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD ?? '';
const STAFF = `setu-test-sevak@${DOMAIN}`;
/**
 * welcome-team volunteer whose PRIMARY role is family-manager.
 *
 * NOT `parent-brampton`, which looks identical but carries COORDINATOR - a role
 * deliberately denied family edit, so it proves the opposite thing. And not the
 * standalone `sevak` account either: its primary role already IS welcome-team,
 * so code that reads only the primary role passes for it and fails here.
 */
const VOLUNTEER_PARENT = `setu-test-parent-volunteer@${DOMAIN}`;
const PLAIN_PARENT = `setu-test-parent-scarborough@${DOMAIN}`;
const COORDINATOR = `setu-test-coordinator@${DOMAIN}`;

test.skip(!PASSWORD, 'TEST_ACCOUNTS_PASSWORD required (run seed:test-accounts first)');

const contexts = new Map<string, APIRequestContext>();

async function ctxFor(email: string): Promise<APIRequestContext> {
  const cached = contexts.get(email);
  if (cached) return cached;
  const ctx = await apiRequest.newContext({
    baseURL: E2E_BASE_URL,
  });
  const res = await ctx.post('/api/setu/auth/password-sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(res.ok(), `password-sign-in failed for ${email}: ${res.status()}`).toBeTruthy();
  contexts.set(email, ctx);
  return ctx;
}

let fid = '';
let probeMid: string | null = null;

const PROBE = {
  firstName: 'ZZE2EProbe',
  lastName: 'StaffEdit',
  type: 'Child',
  gender: 'Female',
  foodAllergies: 'None',
  schoolGrade: 'Grade 4',
  birthMonthYear: '2016-04',
};

test.beforeAll(async () => {
  const staff = await ctxFor(STAFF);
  const res = await staff.get('/api/welcome/roster/report?limit=5');
  expect(res.ok(), `roster report failed: ${res.status()}`).toBeTruthy();
  const rows = ((await res.json()) as { rows?: Array<{ fid?: string }> }).rows ?? [];
  const target = rows.find((r) => r.fid)?.fid;
  expect(target, 'no family found in the UAT roster to edit').toBeTruthy();
  fid = target!;
});

test.afterAll(async () => {
  // Belt and braces: the probe is also removed inline, but a mid-spec failure
  // must not leave a stray child on a real UAT family.
  if (probeMid) {
    const staff = await ctxFor(STAFF);
    await staff.delete(`/api/welcome/families/${fid}/members/${probeMid}`, { failOnStatusCode: false });
  }
  for (const ctx of contexts.values()) await ctx.dispose();
});

test.describe.serial('staff cross-family edit', () => {
  test('the [fid] segment does not shadow the migration-status sibling', async () => {
    // A static and a dynamic segment side by side. Static must win, and only a
    // deployed request can tell us that - the build succeeding does not.
    const staff = await ctxFor(STAFF);
    const res = await staff.get('/api/welcome/families/migration-status');
    expect(res.status()).toBe(200);
  });

  test('a plain family-manager and a coordinator are both DENIED', async () => {
    // Coordinator is the interesting one: spec 3.1 grants it family READ (it
    // reaches the roster and the member detail page) but NOT family EDIT.
    for (const email of [PLAIN_PARENT, COORDINATOR]) {
      const ctx = await ctxFor(email);
      const patch = await ctx.patch(`/api/welcome/families/${fid}`, {
        data: { location: 'Brampton' },
        failOnStatusCode: false,
      });
      expect([401, 403], `${email} reached the family PATCH`).toContain(patch.status());

      const add = await ctx.post(`/api/welcome/families/${fid}/members`, {
        data: PROBE,
        failOnStatusCode: false,
      });
      expect([401, 403], `${email} reached the member POST`).toContain(add.status());
    }
  });

  test('the shared required-field matrix runs on the staff path', async () => {
    // Without it staff could create a Child with no grade, which immediately
    // traps that family on its own /complete-profile gate.
    const staff = await ctxFor(STAFF);
    const { schoolGrade: _dropped, ...noGrade } = PROBE;
    void _dropped;

    const res = await staff.post(`/api/welcome/families/${fid}/members`, {
      data: noGrade,
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('grade-required');
  });

  test('staff can add, edit and remove a member of another family', async () => {
    const staff = await ctxFor(STAFF);

    const created = await staff.post(`/api/welcome/families/${fid}/members`, {
      data: PROBE,
      failOnStatusCode: false,
    });
    expect(created.status(), await created.text()).toBe(201);
    probeMid = ((await created.json()) as { mid: string }).mid;
    expect(probeMid).toContain(fid);

    try {
      // The exact request the welcome grade editor makes.
      const graded = await staff.patch(`/api/welcome/families/${fid}/members/${probeMid}`, {
        data: { schoolGrade: '5' },
        failOnStatusCode: false,
      });
      expect(graded.status(), await graded.text()).toBe(200);

      const cleared = await staff.patch(`/api/welcome/families/${fid}/members/${probeMid}`, {
        data: { schoolGrade: null },
        failOnStatusCode: false,
      });
      expect(cleared.status()).toBe(400);
      expect((await cleared.json()).error).toBe('grade-required');

      const parent = await ctxFor(PLAIN_PARENT);
      const stolen = await parent.patch(`/api/welcome/families/${fid}/members/${probeMid}`, {
        data: { schoolGrade: '6' },
        failOnStatusCode: false,
      });
      expect([401, 403]).toContain(stolen.status());
    } finally {
      const removed = await staff.delete(`/api/welcome/families/${fid}/members/${probeMid}`, {
        failOnStatusCode: false,
      });
      expect(removed.status(), await removed.text()).toBe(200);
      probeMid = null;
    }
  });

  test('a volunteer whose PRIMARY role is family-manager can still do staff work', async () => {
    // Welcome-team volunteers are usually parents, so this - not the standalone
    // account - is the shape production actually sees, and the one a raw
    // x-portal-role comparison would 403.
    const volunteer = await ctxFor(VOLUNTEER_PARENT);

    const created = await volunteer.post(`/api/welcome/families/${fid}/members`, {
      data: { ...PROBE, firstName: 'ZZE2EVolunteer' },
      failOnStatusCode: false,
    });
    expect(created.status(), await created.text()).toBe(201);
    const mid = ((await created.json()) as { mid: string }).mid;
    probeMid = mid;

    const removed = await volunteer.delete(`/api/welcome/families/${fid}/members/${mid}`, {
      failOnStatusCode: false,
    });
    expect(removed.status()).toBe(200);
    probeMid = null;
  });
});
