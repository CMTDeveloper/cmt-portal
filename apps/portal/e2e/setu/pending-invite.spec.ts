import { test, expect } from '@playwright/test';
import { hasFamilyCreds, visibleText } from '../_helpers';

// Pending co-manager invite - deployed UAT. Feature B: an invited co-manager is
// created immediately at invite-SEND as inviteStatus:'pending' (visible before
// they accept), badged "Invite pending", and cancellable by a manager. This spec
// drives the REAL routes (send / cancel) rather than direct Firestore writes, so
// the `family-${fid}` `use cache` is revalidated correctly (a direct write would
// leave the members list stale). The invitee email routes to mockSender in UAT
// (non-allowlisted / notify-off), so no real email is sent. Session = the shared
// E2E family CMT-FSWEDU2X (family-manager) from family.json.

const FID = 'CMT-FSWEDU2X';
const INVITEE_EMAIL = 'e2e-pending-invitee@chinmayatoronto.org';
const INVITEE_NAME = 'E2E Pending Invitee';

/** Remove any leftover pending member + its invite (safety before/after). */
async function cleanupPending(): Promise<void> {
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  const db = portalFirestore();
  const members = await db.collection('families').doc(FID).collection('members').where('inviteStatus', '==', 'pending').get();
  for (const m of members.docs) await m.ref.delete();
  const invites = await db.collection('families').doc(FID).collection('invites').where('email', '==', INVITEE_EMAIL).get();
  for (const inv of invites.docs) await inv.ref.delete();
}

test.describe('Family - pending co-manager invite', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(cleanupPending);
  test.afterAll(cleanupPending);

  test('sending an invite creates a pending "Invite pending" member a manager can cancel', async ({ page }) => {
    // The family home address became required (2026-07-10); the E2E seed does not
    // set one, so set it via the real PATCH route (revalidates the cache) so the
    // profile-completion gate lets us reach /family/members.
    const patch = await page.request.patch('/api/setu/family', {
      data: { familyAddress: { street: '12 Main St', city: 'Brampton', province: 'ON', postalCode: 'L6P 1A2' } },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    // Send the invite → creates the co-manager as inviteStatus:'pending'.
    const send = await page.request.post('/api/setu/invite/send', {
      data: { firstName: 'E2E Pending', lastName: 'Invitee', email: INVITEE_EMAIL, relation: 'Spouse' },
    });
    expect(send.status(), await send.text()).toBe(201);

    // The members page shows the invitee (by the manager-provided name) with an
    // "Invite pending" badge - NOT a completeness nag. (This exercises the real
    // getFamilyByFid → memberToDisplay path end-to-end.)
    await page.goto('/family/members');
    await expect(page, 'redirected off /family - gate or auth').toHaveURL(/\/family\/members/);
    await expect(visibleText(page, INVITEE_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(page, /Invite pending/i).first()).toBeVisible();

    // Cancel the invite from the pending card → POST /api/setu/invite/cancel.
    const card = page.locator('.card').filter({ hasText: INVITEE_NAME }).filter({ visible: true }).first();
    await card.getByRole('button', { name: /^Cancel invite$/i }).click();
    const [cancelResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/setu/invite/cancel') && r.request().method() === 'POST', { timeout: 15_000 }),
      card.getByRole('button', { name: /confirm cancel/i }).click(),
    ]);
    expect(cancelResp.status(), await cancelResp.text()).toBe(200);

    // Gone from the list after the refresh, and gone from Firestore.
    await expect(visibleText(page, INVITEE_NAME)).toHaveCount(0, { timeout: 15_000 });
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    const remaining = await db.collection('families').doc(FID).collection('members').where('inviteStatus', '==', 'pending').get();
    expect(remaining.size, 'the pending member should be deleted').toBe(0);
    const inviteLeft = await db.collection('families').doc(FID).collection('invites').where('email', '==', INVITEE_EMAIL).get();
    expect(inviteLeft.size, 'the invite doc should be deleted').toBe(0);
  });
});
