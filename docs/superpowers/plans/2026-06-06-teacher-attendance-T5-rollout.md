# Teacher Attendance T5 — Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the code tasks (T5.1, T5.2, T5.3). The controller owns the operational steps (T5.4 infra probe run, T5.5 flag flip) since they touch prod env / IAM.

**Goal:** Take the teacher-attendance feature (T1–T4) live: harden teacher-assignment validation, confirm the door-data infra prerequisite, document the rollout, then flip `NEXT_PUBLIC_FEATURE_SETU_TEACHER=true`.

**Architecture:** Gating already exists and is correct — middleware hard-gates `/teacher/*` + `/api/setu/teacher/*` on `NEXT_PUBLIC_FEATURE_SETU_TEACHER !== 'true'` (404 API / redirect page), and `TeacherGate` re-checks `isTeacher`. T4's family union readers degrade gracefully if the door read fails (`getCheckInAttendance` try/catch → `[]`), so a missing infra perm never crashes a page — it only omits door data. The only code change T5 needs is closing a teacher-assignment validation gap; the rest is one read-only infra probe, a runbook, and the env flip.

**Tech Stack:** Next.js 16, TypeScript (`exactOptionalPropertyTypes`), Vitest, Firebase Admin, Vercel env + redeploy.

---

## Standing constraints
- Portal writes UAT only. The infra probe is **read-only** against prod `715b8` (exactly what the deployed app does by design) — it must NEVER write. No `--force` index deploys, ever.
- Role checks via helpers. New validation must not regress the existing admin/welcome gate on the assign route.
- Run the FULL `pnpm --filter @cmt/portal lint` before each commit; pre-push hook gates `typecheck && lint && test && build`; never `--no-verify`.
- Spawn subagents on Opus.

---

## Task T5.1: validate level existence on teacher assignment

**Why:** `assignTeacher` does `batch.set(db.collection('levels').doc(levelId), { teacherRefs: arrayUnion(ref) }, { merge: true })` for each added level. If `levelId` doesn't exist, this **creates a phantom level doc** containing only `teacherRefs` (no `levelName`/`programKey`/`enabled`…) — corrupting `getLevels()` / admin views. The POST route validates only the Zod shape (`ref` non-empty, `levelIds` string[]), not that the levels exist. Close the gap at the route.

**Files:**
- Modify: `apps/portal/src/features/setu/teacher/levels.ts` — add `findMissingLevelIds`.
- Modify: `apps/portal/src/app/api/admin/teacher-assignments/route.ts` — 400 on unknown levels.
- Test: `apps/portal/src/app/api/admin/teacher-assignments/__tests__/route.test.ts` (create if absent) and/or a `levels.ts` unit test.

- [ ] **Step 1: Write the failing test** for `findMissingLevelIds` (in `apps/portal/src/features/setu/teacher/__tests__/levels.test.ts` — create if absent; mirror the repo's firestore-mock style used in sibling teacher tests):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAll } = vi.hoisted(() => ({ mockGetAll: vi.fn() }));
vi.mock('@cmt/firebase-shared/admin/firestore', () => ({
  portalFirestore: () => ({
    getAll: mockGetAll,
    collection: (c: string) => ({ doc: (id: string) => ({ __c: c, __id: id }) }),
  }),
}));

import { findMissingLevelIds } from '../levels';

beforeEach(() => vi.clearAllMocks());

describe('findMissingLevelIds', () => {
  it('returns [] when all level docs exist', async () => {
    mockGetAll.mockResolvedValue([{ exists: true }, { exists: true }]);
    expect(await findMissingLevelIds(['a', 'b'])).toEqual([]);
  });
  it('returns the ids whose docs do not exist (order preserved)', async () => {
    mockGetAll.mockResolvedValue([{ exists: true }, { exists: false }]);
    expect(await findMissingLevelIds(['a', 'ghost'])).toEqual(['ghost']);
  });
  it('returns [] for an empty input without a read', async () => {
    expect(await findMissingLevelIds([])).toEqual([]);
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/levels.test.ts`
Expected: FAIL — `findMissingLevelIds` not exported.

- [ ] **Step 3: Implement `findMissingLevelIds`** (append to `levels.ts`)

```ts
/**
 * Of the given level ids, the ones with no `levels/{id}` doc. Used to reject a
 * teacher assignment that references a non-existent level (which would otherwise
 * create a phantom partial level doc via the denormalized teacherRefs write).
 * Deduplicates input; preserves first-seen order in the result.
 */
export async function findMissingLevelIds(levelIds: string[]): Promise<string[]> {
  const unique = [...new Set(levelIds)];
  if (unique.length === 0) return [];
  const db = portalFirestore();
  const refs = unique.map((id) => db.collection('levels').doc(id));
  const snaps = await db.getAll(...refs);
  return unique.filter((_, i) => !snaps[i]!.exists);
}
```
(Ensure `portalFirestore` is imported at the top of `levels.ts` — it already imports the admin firestore for `getMyLevels`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cmt/portal exec vitest run src/features/setu/teacher/__tests__/levels.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the route** (`api/admin/teacher-assignments/route.ts`) — after the Zod parse, before `assignTeacher`:

```ts
  const { ref, levelIds } = parsed.data;

  const missing = await findMissingLevelIds(levelIds);
  if (missing.length > 0) {
    return NextResponse.json({ error: 'unknown-levels', missing }, { status: 400 });
  }

  const { added, removed } = await assignTeacher({ ref, levelIds, byUid: session.uid });
```
Add the import: `import { findMissingLevelIds } from '@/features/setu/teacher/levels';`

- [ ] **Step 6: Write/extend the route test** — assert a 400 `unknown-levels` when a levelId doesn't exist, and a 200 when all exist (mock `findMissingLevelIds` + `assignTeacher`). If a route test file exists, extend it; else create `apps/portal/src/app/api/admin/teacher-assignments/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSession, mockMissing, mockAssign } = vi.hoisted(() => ({
  mockSession: vi.fn(), mockMissing: vi.fn(), mockAssign: vi.fn(),
}));
vi.mock('@/lib/auth/headers', () => ({ readSessionFromHeaders: mockSession }));
vi.mock('@/features/setu/teacher/levels', () => ({ findMissingLevelIds: mockMissing }));
vi.mock('@/features/setu/teacher/assignments', () => ({ assignTeacher: mockAssign }));

import { POST } from '../route';

const admin = { uid: 'u', role: 'admin', extraRoles: [], fid: null, mid: 'CMT-A-01' };
beforeEach(() => { vi.clearAllMocks(); mockSession.mockReturnValue(admin); mockMissing.mockResolvedValue([]); mockAssign.mockResolvedValue({ added: [], removed: [] }); });
function post(body: unknown) {
  return POST(new Request('http://t/api/admin/teacher-assignments', { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/admin/teacher-assignments', () => {
  it('403 for a non-admin non-welcome session', async () => {
    mockSession.mockReturnValue({ ...admin, role: 'family-manager' });
    expect((await post({ ref: 'CMT-T-01', levelIds: ['L1'] })).status).toBe(403);
  });
  it('400 unknown-levels when a level does not exist', async () => {
    mockMissing.mockResolvedValue(['ghost']);
    const res = await post({ ref: 'CMT-T-01', levelIds: ['ghost'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown-levels', missing: ['ghost'] });
    expect(mockAssign).not.toHaveBeenCalled();
  });
  it('assigns when all levels exist', async () => {
    mockAssign.mockResolvedValue({ added: ['L1'], removed: [] });
    const res = await post({ ref: 'CMT-T-01', levelIds: ['L1'] });
    expect(res.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith({ ref: 'CMT-T-01', levelIds: ['L1'], byUid: 'u' });
  });
});
```

- [ ] **Step 7: Run the route test + typecheck + lint**

Run:
```
pnpm --filter @cmt/portal exec vitest run "src/app/api/admin/teacher-assignments/__tests__/route.test.ts" src/features/setu/teacher/__tests__/levels.test.ts
pnpm --filter @cmt/portal exec tsc --noEmit
pnpm --filter @cmt/portal lint
```
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add apps/portal/src/features/setu/teacher/levels.ts apps/portal/src/features/setu/teacher/__tests__/levels.test.ts "apps/portal/src/app/api/admin/teacher-assignments/route.ts" "apps/portal/src/app/api/admin/teacher-assignments/__tests__/route.test.ts"
git commit -m "fix(teacher): reject teacher assignment to non-existent levels (T5)"
```

---

## Task T5.2: read-only door-Firestore infra probe

**Why:** The whole feature reads the door app's `family-check-ins` / `guest-families` from prod `715b8` via the master service account. The spec flags this perm as **unconfirmed** ("the bridge today only does RTDB"). A read-only probe gives a definitive yes/no before go-live. (If the perm is missing, the feature degrades silently to no-door-data — no crash — but the door-union value is lost.)

**Files:**
- Create: `apps/portal/scripts/check-door-firestore-access.ts`
- Modify: `apps/portal/package.json` — add a pnpm alias.

- [ ] **Step 1: Implement the probe** (`scripts/check-door-firestore-access.ts`) — mirror the existing read-only diagnostic scripts (e.g. `scripts/check-uat-migrations.ts`). It must use the SAME seam the app uses (`checkInSourceFirestore()`), do `.limit(1).get()` on both collections, and NEVER write:

```ts
/**
 * READ-ONLY probe: can the portal read the door app's Firestore collections via
 * the master service account? The teacher-attendance feature (T1–T4) reads
 * `family-check-ins` / `guest-families` from prod 715b8 through
 * checkInSourceFirestore(). This confirms the master SA actually has Firestore
 * READ on 715b8 before go-live. It performs ONLY `.limit(1).get()` reads — no
 * writes, ever. Run: `pnpm --filter @cmt/portal check:door-access`.
 */
import { checkInSourceFirestore } from '../src/features/setu/attendance/check-in-source';

async function probe(collection: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const snap = await checkInSourceFirestore().collection(collection).limit(1).get();
    return { ok: true, count: snap.size };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

async function main() {
  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '(unset)';
  const masterProject = process.env.MASTER_FIREBASE_PROJECT_ID ?? '(unset)';
  console.log('Door-Firestore access probe (READ-ONLY)');
  console.log(`  portal project: ${portalProject}`);
  console.log(`  master project: ${masterProject}`);
  console.log(`  reading via:    ${portalProject === masterProject ? 'portalFirestore (same project)' : 'masterFirestore (cross-project bridge)'}`);
  console.log('');

  let allOk = true;
  for (const c of ['family-check-ins', 'guest-families']) {
    const r = await probe(c);
    if (r.ok) {
      console.log(`  ✅ ${c}: readable (sampled ${r.count} doc${r.count === 1 ? '' : 's'})`);
    } else {
      allOk = false;
      console.log(`  ❌ ${c}: ${r.error}`);
    }
  }
  console.log('');
  if (allOk) {
    console.log('PASS — the master service account can read the door collections. Door data will appear in prod.');
  } else {
    console.log('FAIL — grant the master service account Cloud Firestore READ (roles/datastore.viewer)');
    console.log('on the prod project (chinmaya-setu-715b8). Until then teacher/family screens degrade to no-door-data (no crash).');
    process.exitCode = 1;
  }
}

void main();
```

- [ ] **Step 2: Add the pnpm alias** to `apps/portal/package.json` `scripts` (mirror the existing `check:migrations` alias's `tsx --env-file=.env.local` form):

```json
"check:door-access": "tsx --env-file=.env.local scripts/check-door-firestore-access.ts",
```
(Match the exact tsx invocation the sibling `check:migrations`/`check:*` scripts use in this package.json.)

- [ ] **Step 3: Typecheck the script** (do NOT run it against prod here — the controller runs it)

Run: `pnpm --filter @cmt/portal exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/portal/scripts/check-door-firestore-access.ts apps/portal/package.json
git commit -m "chore(teacher): read-only door-Firestore access probe for rollout (T5)"
```

---

## Task T5.3: rollout runbook

**Files:**
- Create: `apps/portal/docs/teacher-attendance-rollout.md`

- [ ] **Step 1: Write the runbook** capturing the go-live procedure (verbatim, no placeholders):

```markdown
# Teacher Attendance — Rollout Runbook (Slice 4 / T1–T5)

The portal-native teacher-attendance feature is built and merged behind the
`NEXT_PUBLIC_FEATURE_SETU_TEACHER` flag (default OFF). This is the go-live
checklist.

## 0. Pre-flight
- All of T1–T5 merged to `main`, pre-push gate green.
- T4 (family union) is ALREADY live for families on every deploy — it reads door
  check-ins via the read-only bridge and degrades to teacher-only data if the
  bridge can't read (no crash). The flag only controls the **teacher** screens.

## 1. Infra check (REQUIRED before flipping the flag)
The teacher + family screens read the door app's `family-check-ins` /
`guest-families` from prod `chinmaya-setu-715b8` via the **master service
account**. Confirm that SA has Cloud Firestore READ there:

    pnpm --filter @cmt/portal check:door-access

- PASS → door data will appear. Continue.
- FAIL (PERMISSION_DENIED) → grant the master SA `roles/datastore.viewer` on
  `chinmaya-setu-715b8` (GCP IAM), then re-run. Do NOT grant write. (Until
  fixed, the feature still works but shows no door check-ins / no door guests.)

## 2. Assign at least one teacher
As admin (or welcome-team), open `/admin/levels` → "Assign teacher": enter the
teacher's member `mid` (or standalone `tid`) and tick their level(s). The
`teacher` capability is computed from `teacherAssignments/{ref}` at the person's
NEXT sign-in. (Assignment to a non-existent level is now rejected — T5.1.)

## 3. Flip the flag
Set on the Vercel project (Production), then redeploy (NEXT_PUBLIC_* is build-time
inlined, so a redeploy is required):

    vercel env add NEXT_PUBLIC_FEATURE_SETU_TEACHER production
    # value: true

Redeploy by pushing an empty commit (or `git push` any change) — the GitHub
integration auto-deploys. Verify the var landed with `vercel env pull`.

## 4. UAT walkthrough (manual — needs OTP sign-in)
- As the assigned teacher: `/teacher` lists "My classes"; open a class →
  `/teacher/levels/[id]/attendance`. Roster opens all-present; door self-check-ins
  show a `· door` badge; flag late/absent; Save; reopen shows saved marks; prev/
  next Sunday nav works.
- Visitors: `/teacher/levels/[id]/visitors` — door guests matched by grade show;
  Confirm one; quick-add a name-only walk-in; both become guests.
- As that teacher's family: the dashboard BV card, the child profile, and the
  member-detail page show the UNION (a teacher-marked Sunday with no door
  check-in still counts).
- As a non-teacher family: `/teacher` redirects to `/family` (flag/role gate).

## 5. Rollback
Set `NEXT_PUBLIC_FEATURE_SETU_TEACHER=false` (or remove it) and redeploy. The
teacher area returns 404/redirect; family surfaces keep working (union readers
degrade to door-or-portal data independently of the flag).
```

- [ ] **Step 2: Commit**

```bash
git add apps/portal/docs/teacher-attendance-rollout.md
git commit -m "docs(teacher): rollout runbook (T5)"
```

---

## Controller-owned operational steps (NOT subagent tasks)

### T5.4 — run the infra probe
After T5.2 lands, the controller runs `pnpm --filter @cmt/portal check:door-access` (read-only) and records the result. This determines whether the flag flip delivers door data or silently degrades.

### T5.5 — flag flip (gated)
- The full code + runbook ship first (push T5.1–T5.3 through the pre-push gate).
- The actual production flag flip + redeploy is the go-live moment. Because it is outward-facing and its timing depends on (a) the infra probe result and (b) a teacher being assigned, the controller surfaces it to CMT Developer with the probe result rather than flipping silently. If directed to proceed, flip via the runbook's §3 and verify with `vercel env pull` + a redeploy.

---

## Self-review (controller)
- **Gating verified** (middleware + TeacherGate) — no code change needed; ✓.
- **Validation gap closed** (phantom level docs) — T5.1; ✓.
- **Infra prerequisite** made checkable + non-fatal (graceful degrade already in the readers) — T5.2; ✓.
- **Runbook** covers infra → assign → flip → walkthrough → rollback — T5.3; ✓.
- **Flag flip** is the one outward-facing step — controller-gated on the probe + assignment; ✓.
```
