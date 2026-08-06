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
 * NOT the standalone `sevak` account: its primary role already IS welcome-team,
 * so code that reads only the primary role passes for it and fails here. This
 * account is the one that proves `extraRoles` is consulted.
 *
 * (It is also not `parent-brampton`. That account carries COORDINATOR, which
 * this docstring used to describe as "deliberately denied family edit" - true
 * until the owner reversed spec 3.1 on 2026-08-05. Coordinator now inherits
 * welcome-team, so parent-brampton would no longer prove anything different
 * from this account.)
 */
const VOLUNTEER_PARENT = `setu-test-parent-volunteer@${DOMAIN}`;
const PLAIN_PARENT = `setu-test-parent-scarborough@${DOMAIN}`;
/**
 * Deleting a member is ADMIN-only (`requireAdmin: true` on the DELETE route,
 * tightened by 94f091b on 2026-08-04). A sevak may add and edit; only an admin
 * may remove. This spec kept asking the sevak to delete and so had been failing
 * on preview ever since - and, worse, its cleanup used the same denied context,
 * leaving a probe child on a real UAT family on every run.
 */
const ADMIN = `setu-test-admin@${DOMAIN}`;

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
    // ADMIN, not STAFF: a sevak's delete is refused, so a staff-context cleanup
    // silently leaves the probe behind - which is exactly what happened.
    const admin = await ctxFor(ADMIN);
    await admin.delete(`/api/welcome/families/${fid}/members/${probeMid}`, { failOnStatusCode: false });
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

  test('a plain family-manager is DENIED another family entirely', async () => {
    // ⚠️ COORDINATOR WAS REMOVED FROM THIS LIST ON 2026-08-06, and the removal
    // is the point rather than a convenience.
    //
    // This test used to assert that a coordinator is denied family edit, citing
    // spec 3.1. The owner REVERSED spec 3.1 on 2026-08-05 - "Coordinator gets
    // everything Welcome team has and plus" - and `isWelcomeTeam()` has
    // inherited coordinator ever since, which is the single gate both these
    // routes use. So the assertion had become false, and this spec would have
    // failed the moment it next ran against preview. It was not in the batch the
    // coordinator change was verified with.
    //
    // A plain family-manager with no staff grant is the real boundary, and it is
    // the one worth keeping: it proves the routes check a STAFF capability
    // rather than merely "is signed in".
    //
    // The POSITIVE half - that a coordinator now reaches the family PATCH - is
    // already asserted in coordinator.spec.ts, against a fid that does not
    // exist, so it proves the gate without mutating a real UAT family. Not
    // duplicated here.
    const ctx = await ctxFor(PLAIN_PARENT);
    const patch = await ctx.patch(`/api/welcome/families/${fid}`, {
      data: { location: 'Brampton' },
      failOnStatusCode: false,
    });
    expect([401, 403], `${PLAIN_PARENT} reached the family PATCH`).toContain(patch.status());

    const add = await ctx.post(`/api/welcome/families/${fid}/members`, {
      data: PROBE,
      failOnStatusCode: false,
    });
    expect([401, 403], `${PLAIN_PARENT} reached the member POST`).toContain(add.status());
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

  test('a sevak can add and edit another family member, but only an ADMIN may remove', async () => {
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
      // Removal is ADMIN-only. Asserting the refusal here rather than in a
      // separate test keeps it next to the add + edit a sevak IS allowed, so
      // the boundary between the two is visible in one place.
      const refused = await staff.delete(`/api/welcome/families/${fid}/members/${probeMid}`, {
        failOnStatusCode: false,
      });
      expect(refused.status(), await refused.text()).toBe(403);
    } finally {
      const admin = await ctxFor(ADMIN);
      const removed = await admin.delete(`/api/welcome/families/${fid}/members/${probeMid}`, {
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

    // The point of this test is the ADD - that a volunteer whose primary role
    // is family-manager is still recognised as staff. Removal is admin-only for
    // them exactly as for any other sevak, so the delete below is CLEANUP and
    // is done as admin; asserting 200 on the volunteer's own delete was the
    // second place this spec quietly required a permission the route refuses.
    const refused = await volunteer.delete(`/api/welcome/families/${fid}/members/${mid}`, {
      failOnStatusCode: false,
    });
    expect(refused.status(), await refused.text()).toBe(403);

    const admin = await ctxFor(ADMIN);
    const removed = await admin.delete(`/api/welcome/families/${fid}/members/${mid}`, {
      failOnStatusCode: false,
    });
    expect(removed.status(), await removed.text()).toBe(200);
    probeMid = null;
  });
});
