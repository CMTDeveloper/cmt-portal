import { test, expect } from '@playwright/test';
import { hasFamilyCreds } from '../../_helpers';

// Slice 3 · Workstream C — binary (Present/Absent) teacher attendance, deployed
// UAT. The single seeded UAT user is family-manager + admin; admin inherits
// teacher capability (isTeacher(admin) → true, canTeachLevel(admin) → 'ok'), so
// it can take attendance for any level. The target is the dedicated, isolated
// `_test` attendance fixture the seed provisions (a BV level with exactly TWO
// enrolled, grade-matched children — see scripts/seed-e2e-family.ts §6), so the
// roster is deterministic and never touches real families' attendance.
//
// The `/teacher/*` surface is gated behind NEXT_PUBLIC_FEATURE_SETU_TEACHER=true
// (middleware) — off ⇒ the page redirects to /family, which the URL assertion
// surfaces. The flag is on in UAT (see the 2026-06-09 runbook entry).
//
// The legacy /check-in/teacher marker's "Present/Absent only" (no Late/
// Uninformed) is covered by its unit test —
// features/check-in/teacher/__tests__/attendance-marker.test.tsx ("renders
// exactly two status columns (Present, Absent) and no Late/Uninformed radios") —
// and needs a separate kiosk/check-in session + legacy roster, so it is NOT
// re-driven here.

const ATT_LEVEL_ID = 'e2e-att-level';
// A fixed PAST Sunday (June 7, 2026 is a Sunday) so the roster is never in the
// future (which would hide it) and save+reload target the same date.
const DATE = '2026-06-07';

test.describe('Teacher — binary attendance', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test('tap-to-present rows (no Late/Uninformed); mark two present → auto-saves → persists on reload', async ({ page }) => {
    await page.goto(`/teacher/levels/${ATT_LEVEL_ID}/attendance?date=${DATE}`);
    // Flag guard: /teacher/* redirects to /family when the surface is disabled.
    await expect(
      page,
      'redirected off /teacher — set NEXT_PUBLIC_FEATURE_SETU_TEACHER=true on the target deploy',
    ).toHaveURL(new RegExp(`/teacher/levels/${ATT_LEVEL_ID}/attendance`));

    // The roster shows exactly the two seeded children as tap-to-present rows.
    // The teacher layout renders the marker twice (mobile `.block md:hidden` +
    // desktop `.hidden md:flex`), so scope to the single visible (desktop) copy -
    // else getByTestId sees 4 rows and nth() targets a hidden mobile row.
    const rows = page.getByTestId('att-row').filter({ visible: true });
    await expect(rows).toHaveCount(2, { timeout: 20_000 });

    // P2 Task 5 moved `aria-pressed` OFF the row and onto a toggle button inside
    // it: the row had to stop being a <button> so it could hold the "View
    // profile" link (an <a> inside a button is invalid nesting). Reading the
    // state therefore means reaching into the row for its toggle.
    const toggleIn = (idx: number) => rows.nth(idx).getByRole('button', { name: /present|not marked/i });

    // Binary model: NO Late/Uninformed control anywhere. The Setu marker uses tap
    // buttons (aria-pressed), never the legacy radio group, so zero radios + no
    // "uninformed"/"late" control proves the binary UI.
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByText(/uninformed/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^late$/i })).toHaveCount(0);

    // There is NO manual Save button — attendance auto-saves as the teacher taps.
    await expect(page.getByRole('button', { name: /save attendance/i })).toHaveCount(0);

    const setPresent = async (idx: number, want: boolean) => {
      const t = toggleIn(idx);
      if (((await t.getAttribute('aria-pressed')) === 'true') !== want) await t.click();
      await expect(t).toHaveAttribute('aria-pressed', want ? 'true' : 'false');
    };

    // One unconditional tap guarantees a state change (so the debounced autosave
    // definitely fires regardless of the fixture's prior state), then drive BOTH
    // rows to present. The autosave POSTs on its own ~¾s after the last tap.
    await toggleIn(0).click();
    await setPresent(0, true);
    await setPresent(1, true);

    const saveResp = await page.waitForResponse(
      (r) => r.url().includes('/api/setu/teacher/attendance') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    expect(saveResp.status(), await saveResp.text()).toBe(200);
    // Binary: an event per enrolled student (present/absent) — both here.
    expect(((await saveResp.json()) as { saved: number }).saved).toBeGreaterThanOrEqual(2);
    // Status confirms it saved — no button was clicked.
    await expect(page.getByText(/saved/i).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });

    // Reload the same date → the two marks persisted (both rows seed Present).
    await page.reload();
    const reloaded = page.getByTestId('att-row').filter({ visible: true });
    await expect(reloaded).toHaveCount(2, { timeout: 20_000 });
    const reloadedToggle = (idx: number) => reloaded.nth(idx).getByRole('button', { name: /present|not marked/i });
    await expect(reloadedToggle(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(reloadedToggle(1)).toHaveAttribute('aria-pressed', 'true');

    // ── P2 Task 5: the row restructure, against the deployed app ──────────────
    // The container must not be a button and must not carry role="button" -
    // either would put the link inside a button again. Asserted on the deployed
    // DOM, not just in jsdom, because this is the whole point of the change.
    const firstRow = reloaded.nth(0);
    await expect(firstRow).not.toHaveAttribute('role', 'button');
    await expect(firstRow).not.toHaveAttribute('aria-pressed', /.*/);

    // "View profile" is reachable and does NOT toggle attendance on the way out.
    const profileLink = firstRow.getByRole('link', { name: /view profile/i });
    await expect(profileLink).toHaveAttribute('href', /\/teacher\/students\/.+/);
    await profileLink.click();
    await expect(page).toHaveURL(/\/teacher\/students\/.+/, { timeout: 20_000 });

    // Back on the roster the mark is untouched - following the link neither
    // toggled the row nor wrote an attendance event.
    await page.goto(`/teacher/levels/${ATT_LEVEL_ID}/attendance?date=${DATE}`);
    const after = page.getByTestId('att-row').filter({ visible: true });
    await expect(after).toHaveCount(2, { timeout: 20_000 });
    await expect(after.nth(0).getByRole('button', { name: /present|not marked/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
