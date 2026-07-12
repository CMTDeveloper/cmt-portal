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
 *   2. Lookup by LEGACY id (the real door flow) - GET /api/check-in/setu/lookup?id=
 *      <legacyFid> as the kiosk session -> 200, children in the legacy Family shape
 *      (N>=2), and Family.fid is the family's NEW publicFid (the nudge target).
 *   3. Check-in by LEGACY id + auto-enroll - POST /api/check-in/setu/check-in with
 *      the family's legacyFid and both children present -> 200; family.legacyFid and
 *      family.publicFid both echoed; enroll.enrolled === true; enroll.created === true.
 *   4. Idempotent - re-POST the same -> enroll.created === false.
 *   5. The publicFid resolves the SAME family (publicFid fallback) - POST with the
 *      family's publicFid -> 200 and family.fid equals the CMT- doc id from step 3.
 *      (resolveKioskFamily is legacy-first; the fixture's publicFid is not any
 *      family's legacy id, so it resolves via the fallback.)
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
  // Start from an EMPTY cookie jar, not the setu project's default family.json
  // storageState (playwright.config setu project) - otherwise the context would
  // carry a pre-existing session and the kiosk sign-in would layer on top of it.
  const ctx = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
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

  // Delete every ACTIVE Bala Vihar enrollment on the fixture family. Index-free
  // (reads the small enrollments subcollection, filters in memory). Used both as
  // a clean-slate before the run (so enroll.created is deterministically true even
  // if a prior run leaked an enrollment) and as teardown after it.
  async function cleanFixtureBvEnrollments(): Promise<void> {
    if (!familyDocFid) return;
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    const enr = await db.collection('families').doc(familyDocFid).collection('enrollments').get();
    for (const d of enr.docs) {
      const x = d.data() as { programKey?: string; status?: string };
      if (x.programKey === BALA_VIHAR && x.status === 'active') await d.ref.delete();
    }
  }

  test.beforeAll(async ({ baseURL }) => {
    // Resolve the fixture family's CMT- doc id from its publicFid (admin SDK), so
    // both the enrollment assertion and cleanup have it even if a test fails early.
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const snap = await portalFirestore()
      .collection('families')
      .where('publicFid', '==', FIXTURE_PUBLIC_FID)
      .limit(1)
      .get();
    familyDocFid = snap.docs[0]?.id ?? '';
    // Clean slate: a prior/aborted run must not leave an active BV enrollment that
    // would make this run's first check-in return created:false.
    await cleanFixtureBvEnrollments();
    kioskCtx = await signInKioskContext(baseURL!);
  });

  test.afterAll(async () => {
    if (kioskCtx) await kioskCtx.dispose();
    if (!familyDocFid) return; // fixture never resolved - nothing to undo

    // Delete directly with the SAME admin SDK the seeds use (playwright.config
    // loads .env.local, so the portal creds are in process.env). Remove EVERY
    // active BV enrollment on the fixture (not just the tracked eid) so a partial
    // run can't leave the fixture enrolled; the check_in_events this run appended
    // are cleared too so the fixture's history stays clean.
    try {
      const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
      const db = portalFirestore();
      await cleanFixtureBvEnrollments();
      for (const id of writtenCheckInIds) {
        await db.collection('check_in_events').doc(id).delete();
      }
    } catch (err) {
      console.warn('kiosk-auto-enroll cleanup failed:', err);
    }
  });

  test('unauthenticated check-in + lookup are denied (routes are not public)', async ({ baseURL }) => {
    // A fresh context with NO session cookie - middleware `canAccessRoute` gates
    // both paths to the kiosk role, so no-session returns 401 (proves not public).
    // Explicit empty storageState overrides the setu project's family.json default
    // (playwright.config), which would otherwise make this context authenticated.
    const anon = await request.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } });
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

  test('lookup by the LEGACY id returns the children + the family NEW publicFid', async () => {
    // The real door flow: a family enters their LEGACY check-in id. resolveKioskFamily
    // is legacy-first, so this lands on the right family, and the returned Family.fid
    // is that family's NEW publicFid - the value the kiosk UI nudges them to adopt.
    const res = await kioskCtx.get(`/api/check-in/setu/lookup?id=${encodeURIComponent(FIXTURE_LEGACY_FID!)}`);
    expect(res.status(), `lookup GET: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as LookupBody;

    // The kiosk panel renders the legacy Family shape: fid + students[]. fid is the
    // NEW publicFid (the nudge target), NOT the entered legacy id.
    expect(body.fid, 'lookup should return the NEW publicFid').toBe(FIXTURE_PUBLIC_FID);
    expect(Array.isArray(body.students)).toBeTruthy();
    // N≥2 fixture invariant - this family has at least two children.
    expect(body.students.length, 'fixture must have ≥2 children').toBeGreaterThanOrEqual(2);
    for (const s of body.students) {
      expect(s.sid, 'student sid (member mid) missing').toBeTruthy();
      expect(s.firstName).toBeTruthy();
    }
    childSids = body.students.map((s) => s.sid);
  });

  test('check-in by the LEGACY id records + auto-enrolls, and returns the new publicFid', async () => {
    // Mark BOTH children present (the N=2 path), exactly as the kiosk panel submits.
    const students = Object.fromEntries(childSids.map((sid) => [sid, true]));
    const res = await kioskCtx.post('/api/check-in/setu/check-in', {
      data: { id: FIXTURE_LEGACY_FID, students },
    });
    expect(res.status(), `check-in POST: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as CheckInBody;

    // Legacy-first resolve lands on the right family; the response carries BOTH ids
    // so the UI can nudge "your new Family ID is <publicFid>". Capture the CMT- doc
    // id (the join key) for the fallback + enrollment assertions and for cleanup.
    expect(body.family.legacyFid).toBe(FIXTURE_LEGACY_FID);
    expect(body.family.publicFid, 'check-in must echo the new publicFid for the nudge').toBe(FIXTURE_PUBLIC_FID);
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
      data: { id: FIXTURE_LEGACY_FID, students },
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

  test('the new publicFid resolves the SAME family (publicFid fallback)', async () => {
    const students = Object.fromEntries(childSids.map((sid) => [sid, true]));
    const res = await kioskCtx.post('/api/check-in/setu/check-in', {
      data: { id: FIXTURE_PUBLIC_FID, students },
    });
    expect(res.status(), `publicFid check-in POST: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as CheckInBody;
    writtenCheckInIds.push(...body.checkInIds);

    // resolveKioskFamily is legacy-first; the publicFid is NOT any family legacy id
    // (fully-clean fixture), so it resolves via the publicFid fallback to the exact
    // same family doc (its enrollment is already active from the legacy check-in).
    expect(body.family.fid).toBe(familyDocFid);
    expect(body.family.publicFid).toBe(FIXTURE_PUBLIC_FID);
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
