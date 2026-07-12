/**
 * ⚠️ UNRUN (owner-gated) — deployed-UAT E2E for the Setu kiosk new-ID lookup +
 * auto-enroll slice (Tasks 1-7). Authored under Task 8 but DELIBERATELY NOT RUN:
 * running it needs the kiosk account seeded and the UAT flag + creds the owner
 * supplies out-of-band. Hand the spec + branch diff back for approval first.
 *
 * ── What it proves (against the DEPLOYED UAT app, the system-under-test) ────────
 *   1. Auth is required — an UNAUTHENTICATED POST /api/check-in/setu/check-in and
 *      GET /api/check-in/setu/lookup each 401 (middleware `no-session`), proving
 *      the routes are NOT public.
 *   2. Lookup (step 1) — GET /api/check-in/setu/lookup?id=<publicFid> as the kiosk
 *      session → 200, the family's children in the legacy `Family.students` shape
 *      (N≥2 students).
 *   3. Check-in + auto-enroll — POST /api/check-in/setu/check-in with the family's
 *      publicFid and both children present → 200; family.publicFid matches;
 *      enroll.enrolled === true; enroll.created === true.
 *   4. Idempotent — re-POST the same → enroll.created === false.
 *   5. Legacy id resolves the SAME family — POST with the family's legacyFid → 200
 *      and family.fid equals the CMT- doc id captured in step 3.
 *   6. Enrollment now exists — a direct Firestore read of
 *      families/{fid}/enrollments/{eid} shows an ACTIVE Bala Vihar enrollment
 *      covering the eligible children. (The kiosk role cannot reach
 *      /api/setu/dashboard or the /welcome roster — those need a family or
 *      welcome/admin session — so the enrollment is verified with the SAME admin
 *      SDK the cleanup uses, the pattern admin/level-management.spec.ts follows.)
 *   7. Self-clean — afterAll deletes the enrollment + check_in_events this run
 *      wrote, so the fixture returns to "no active BV enrollment" and re-runs get
 *      enroll.created === true again.
 *
 * ── OWNER-GATED preconditions before this can go green (in order) ───────────────
 *   1. The branch DEPLOYED to UAT (https://cmt-setu.vercel.app) with the kiosk
 *      feature flag ON: NEXT_PUBLIC_FEATURE_CHECK_IN_KIOSK=true (flags.checkInKiosk).
 *      With the flag OFF both routes 404 and every assertion below fails on the
 *      flag gate, not the feature.
 *   2. The generic kiosk account seeded on UAT:
 *        pnpm --filter @cmt/portal seed:kiosk-account
 *      with KIOSK_ACCOUNT_EMAIL + KIOSK_ACCOUNT_PASSWORD set in .env.local. That
 *      account carries the least-privilege `kiosk` role that authorizes both routes.
 *   3. A UAT fixture family that HAS a publicFid, HAS a legacyFid (legacy check-in
 *      id), has ≥2 children eligible for Bala Vihar (valid birthMonthYear), and has
 *      NO active Bala Vihar enrollment. Point the spec at it via:
 *        KIOSK_FIXTURE_PUBLIC_FID=<the family's publicFid>
 *        KIOSK_FIXTURE_LEGACY_FID=<the family's legacy check-in id>
 *      (Reuse a migrated family or designate a seeded one; the spec never mutates
 *      the family itself — only the enrollment it creates, which it then removes.)
 *   4. An OPEN Bala Vihar offering must exist for that family's location on UAT
 *      (the standing UAT seed provides one — the E2E family enrolls in it).
 *   5. .env.local carries the portal admin creds (PORTAL_FIREBASE_PROJECT_ID=
 *      chinmaya-setu-uat + service account) — playwright.config.ts loads .env.local
 *      into process.env, so the afterAll admin SDK read/cleanup works.
 *
 * Run (against deployed UAT only — never prod), AFTER the owner approves:
 *   PLAYWRIGHT_BASE_URL=https://cmt-setu.vercel.app \
 *     pnpm --filter @cmt/portal exec playwright test --project=setu kiosk-auto-enroll
 *
 * Mutating spec: creates ONE Bala Vihar enrollment (+ per-child check_in_events)
 * and self-cleans in afterAll so re-runs are idempotent.
 */
import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { BALA_VIHAR } from '@cmt/shared-domain';

// ── Owner-supplied creds + fixture identity (read in-spec, mirroring how
// mobile-bearer / public-ids read FIREBASE_API_KEY directly from process.env). ──
const KIOSK_EMAIL = process.env.KIOSK_ACCOUNT_EMAIL;
const KIOSK_PASSWORD = process.env.KIOSK_ACCOUNT_PASSWORD;
const FIXTURE_PUBLIC_FID = process.env.KIOSK_FIXTURE_PUBLIC_FID;
const FIXTURE_LEGACY_FID = process.env.KIOSK_FIXTURE_LEGACY_FID;

const hasKioskCreds = Boolean(KIOSK_EMAIL && KIOSK_PASSWORD);
const hasKioskFixture = Boolean(FIXTURE_PUBLIC_FID && FIXTURE_LEGACY_FID);

// ── Response shapes (mirror the route handlers) ─────────────────────────────────
type EnrollResult =
  | { enrolled: true; created: boolean; eid: string }
  | { enrolled: false; reason: string };

type CheckInBody = {
  family: { fid: string; publicFid: string | null; legacyFid: string | null; name: string };
  enroll: EnrollResult;
  checkInIds: string[];
};

type LookupStudent = { sid: string; fid: string; firstName: string; lastName: string; level: string };
type LookupBody = {
  fid: string;
  name: string;
  contacts: unknown[];
  paymentStatus: string;
  students: LookupStudent[];
};

/**
 * Sign the generic kiosk account in via password-sign-in (never OTP) and return a
 * request context whose cookie jar carries the resulting `__session`. Same
 * mechanism as auth-helpers.signInFamilyAndSaveStorage, but kept on its own
 * context so the spec never touches the shared family.json session (the `setu`
 * project loads family.json by default — a kiosk request must NOT use it).
 */
async function signInKioskContext(baseURL: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/setu/auth/password-sign-in', {
    data: { email: KIOSK_EMAIL, password: KIOSK_PASSWORD },
  });
  expect(
    res.ok(),
    `kiosk password-sign-in failed: ${res.status()} ${await res.text()} — is seed:kiosk-account run on UAT?`,
  ).toBeTruthy();
  return ctx;
}

// Serial: one kiosk sign-in for the whole file (password-sign-in shares the OTP
// limiter, 5 per contact per 15 min) and the assertions build on captured state
// (the resolved CMT- fid, the created eid, the child sids).
test.describe.configure({ mode: 'serial' });

test.describe('Setu kiosk new-ID lookup + auto-enroll (deployed UAT) — UNRUN', () => {
  test.skip(!hasKioskCreds, 'KIOSK_ACCOUNT_EMAIL / KIOSK_ACCOUNT_PASSWORD required (run seed:kiosk-account on UAT)');
  test.skip(!hasKioskFixture, 'KIOSK_FIXTURE_PUBLIC_FID / KIOSK_FIXTURE_LEGACY_FID required (a publicFid family, ≥2 BV-eligible children, no active BV enrollment)');

  let kioskCtx: APIRequestContext;

  // Captured across the serial tests for the enrollment assertion + cleanup.
  let familyDocFid = ''; // the CMT- doc id (parent of the enrollment subcollection)
  let createdEid = ''; // families/{fid}/enrollments/{eid} — the enrollment we made
  let childSids: string[] = []; // lookup student sids === member mids === enrolledMids entries
  const writtenCheckInIds: string[] = []; // every check_in_events doc this run appended

  test.beforeAll(async ({ baseURL }) => {
    kioskCtx = await signInKioskContext(baseURL!);
  });

  test.afterAll(async () => {
    if (kioskCtx) await kioskCtx.dispose();
    if (!familyDocFid) return; // nothing was created — nothing to undo

    // Delete directly with the SAME admin SDK the seeds use (playwright.config
    // loads .env.local, so the portal creds are in process.env). Removing the
    // enrollment doc returns the fixture to "no active BV enrollment" so the next
    // run's enroll.created is true again; the check_in_events are append-only
    // event rows, cleared here so the fixture's history stays clean.
    try {
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      if (createdEid) {
        await db
          .collection('families')
          .doc(familyDocFid)
          .collection('enrollments')
          .doc(createdEid)
          .delete();
      }
      for (const id of writtenCheckInIds) {
        await db.collection('check_in_events').doc(id).delete();
      }
    } catch (err) {
      console.warn('kiosk-auto-enroll cleanup failed:', err);
    }
  });

  test('unauthenticated check-in + lookup are denied (routes are not public)', async ({ baseURL }) => {
    // A fresh context with NO session cookie — middleware `canAccessRoute` gates
    // both paths to the kiosk role, so no-session returns 401 (proves not public).
    const anon = await request.newContext({ baseURL: baseURL! });
    try {
      const post = await anon.post('/api/check-in/setu/check-in', {
        data: { id: FIXTURE_PUBLIC_FID, students: {} },
      });
      expect(post.status(), `unauth check-in should 401, got ${post.status()}`).toBe(401);
      expect((await post.json()).error).toBe('no-session');

      const get = await anon.get(`/api/check-in/setu/lookup?id=${encodeURIComponent(FIXTURE_PUBLIC_FID!)}`);
      expect(get.status(), `unauth lookup should 401, got ${get.status()}`).toBe(401);
      expect((await get.json()).error).toBe('no-session');
    } finally {
      await anon.dispose();
    }
  });

  test('lookup (step 1) returns the family children in the Family.students shape', async () => {
    const res = await kioskCtx.get(`/api/check-in/setu/lookup?id=${encodeURIComponent(FIXTURE_PUBLIC_FID!)}`);
    expect(res.status(), `lookup GET: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as LookupBody;

    // The kiosk panel renders the legacy Family shape: fid + students[].
    expect(body.fid).toBeTruthy();
    expect(Array.isArray(body.students)).toBeTruthy();
    // N≥2 fixture invariant — this family has at least two children.
    expect(body.students.length, 'fixture must have ≥2 children').toBeGreaterThanOrEqual(2);
    for (const s of body.students) {
      expect(s.sid, 'student sid (member mid) missing').toBeTruthy();
      expect(s.firstName).toBeTruthy();
    }
    childSids = body.students.map((s) => s.sid);
  });

  test('check-in by publicFid records + auto-enrolls into the current Bala Vihar (created)', async () => {
    // Mark BOTH children present (the N=2 path), exactly as the kiosk panel submits.
    const students = Object.fromEntries(childSids.map((sid) => [sid, true]));
    const res = await kioskCtx.post('/api/check-in/setu/check-in', {
      data: { id: FIXTURE_PUBLIC_FID, students },
    });
    expect(res.status(), `check-in POST: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as CheckInBody;

    // The resolved family echoes the entered publicFid; capture the CMT- doc id
    // (the join key resolveKioskFamily returns) for the legacy-id + enrollment
    // assertions and for cleanup.
    expect(body.family.publicFid).toBe(FIXTURE_PUBLIC_FID);
    expect(body.family.fid).toBeTruthy();
    familyDocFid = body.family.fid;
    writtenCheckInIds.push(...body.checkInIds);

    // First check-in for this family this term → a NEW active enrollment.
    expect(body.enroll.enrolled, `enroll not enrolled: ${JSON.stringify(body.enroll)}`).toBe(true);
    if (body.enroll.enrolled) {
      expect(body.enroll.created, 'first check-in should CREATE the enrollment').toBe(true);
      expect(body.enroll.eid).toBeTruthy();
      createdEid = body.enroll.eid;
    }
  });

  test('a second identical check-in is idempotent (created === false)', async () => {
    const students = Object.fromEntries(childSids.map((sid) => [sid, true]));
    const res = await kioskCtx.post('/api/check-in/setu/check-in', {
      data: { id: FIXTURE_PUBLIC_FID, students },
    });
    expect(res.status(), `re-check-in POST: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as CheckInBody;
    writtenCheckInIds.push(...body.checkInIds);

    expect(body.enroll.enrolled).toBe(true);
    if (body.enroll.enrolled) {
      // Same deterministic eid, already active → no new enrollment written.
      expect(body.enroll.created, 're-check-in must NOT re-create the enrollment').toBe(false);
      expect(body.enroll.eid).toBe(createdEid);
    }
  });

  test('the legacy check-in id resolves the SAME family', async () => {
    const students = Object.fromEntries(childSids.map((sid) => [sid, true]));
    const res = await kioskCtx.post('/api/check-in/setu/check-in', {
      data: { id: FIXTURE_LEGACY_FID, students },
    });
    expect(res.status(), `legacy-id check-in POST: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as CheckInBody;
    writtenCheckInIds.push(...body.checkInIds);

    // resolveKioskFamily falls through publicFid → legacyFid, so the legacy id
    // lands on the exact same family doc (and its enrollment is already active).
    expect(body.family.fid).toBe(familyDocFid);
    expect(body.family.legacyFid).toBe(FIXTURE_LEGACY_FID);
    expect(body.enroll.enrolled).toBe(true);
    if (body.enroll.enrolled) {
      expect(body.enroll.created).toBe(false);
    }
  });

  test('an active Bala Vihar enrollment now exists for the eligible children', async () => {
    expect(familyDocFid, 'no family resolved — earlier step failed').toBeTruthy();
    expect(createdEid, 'no enrollment created — earlier step failed').toBeTruthy();

    // The kiosk session cannot read /api/setu/dashboard or the /welcome roster
    // (both need a family or welcome/admin session), so verify the enrollment
    // straight from Firestore with the admin SDK — the same reader the cleanup
    // targets (pattern: admin/level-management.spec.ts).
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    const snap = await db
      .collection('families')
      .doc(familyDocFid)
      .collection('enrollments')
      .doc(createdEid)
      .get();

    expect(snap.exists, `enrollment ${createdEid} missing under ${familyDocFid}`).toBe(true);
    const data = snap.data() as { status?: string; programKey?: string; enrolledMids?: string[] };
    expect(data.status).toBe('active');
    expect(data.programKey).toBe(BALA_VIHAR);
    // Both children the lookup surfaced are enrolled (N≥2 eligible children).
    const enrolledMids = data.enrolledMids ?? [];
    expect(enrolledMids.length, 'expected ≥2 enrolled children').toBeGreaterThanOrEqual(2);
    for (const sid of childSids) {
      expect(enrolledMids, `child ${sid} not in enrolledMids`).toContain(sid);
    }
  });
});
