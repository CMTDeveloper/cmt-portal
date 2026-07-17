import { test, expect } from '@playwright/test';
import { hasFamilyCreds, visibleText } from '../_helpers';

// Pending co-manager invite - deployed UAT. Feature B: an invited co-manager is
// created immediately at invite-SEND as inviteStatus:'pending' (visible before
// they accept), badged "Invite pending", and cancellable by a manager. This spec
// seeds a pending member + invite DIRECTLY (mirroring what /api/setu/invite/send
// writes) so it needs no real email, then verifies the badge on /family/members
// and the Cancel-invite UI. The seeded family CMT-FSWEDU2X is the shared E2E
// family (family-manager session in family.json).

const FID = 'CMT-FSWEDU2X';
const PENDING_MID = `${FID}-90`; // high sequence id so it never collides with real members
const TOKEN = 'e2e-pending-invite-token';
const INVITEE_NAME = 'E2E Pending Invitee';

async function seedPendingInvite(): Promise<void> {
  const { portalFirestore, FieldValue, Timestamp } = await import('@cmt/firebase-shared/admin/firestore');
  const db = portalFirestore();
  const memberRef = db.collection('families').doc(FID).collection('members').doc(PENDING_MID);
  await memberRef.set({
    mid: PENDING_MID,
    publicMid: '59990',
    uid: null,
    firstName: 'E2E Pending',
    lastName: 'Invitee',
    type: 'Adult',
    gender: 'PreferNotToSay',
    manager: true,
    joinedAt: FieldValue.serverTimestamp(),
    email: 'e2e-pending-invitee@chinmayatoronto.org',
    phone: null,
    schoolGrade: null,
    birthMonthYear: null,
    volunteeringSkills: [],
    foodAllergies: null,
    emergencyContacts: [null, null],
    inviteStatus: 'pending',
    _test: true,
  });
  await db.collection('families').doc(FID).collection('invites').doc(TOKEN).set({
    token: TOKEN,
    email: 'e2e-pending-invitee@chinmayatoronto.org',
    relation: 'Spouse',
    firstName: 'E2E Pending',
    lastName: 'Invitee',
    memberMid: PENDING_MID,
    inviterMid: `${FID}-01`,
    inviterName: 'E2E Family',
    familyName: 'E2E Family',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 14 * 86400_000)),
    acceptedAt: null,
    acceptedByMid: null,
    _test: true,
  });
}

async function cleanupPendingInvite(): Promise<void> {
  const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
  const db = portalFirestore();
  await db.collection('families').doc(FID).collection('members').doc(PENDING_MID).delete().catch(() => {});
  await db.collection('families').doc(FID).collection('invites').doc(TOKEN).delete().catch(() => {});
}

test.describe('Family - pending co-manager invite', () => {
  test.skip(!hasFamilyCreds, 'E2E_FAMILY_EMAIL / E2E_FAMILY_PASSWORD required');

  test.beforeAll(seedPendingInvite);
  test.afterAll(cleanupPendingInvite);

  test('a pending invitee shows an "Invite pending" badge and a manager can cancel it', async ({ page }) => {
    await page.goto('/family/members');
    await expect(page, 'redirected off /family - gate or auth').toHaveURL(/\/family\/members/);

    // The pending invitee is listed by the name the manager gave at invite time,
    // with an "Invite pending" badge (NOT a missing-fields / complete nag).
    await expect(visibleText(page, INVITEE_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(visibleText(page, /Invite pending/i).first()).toBeVisible();

    // The pending card offers a manager-only Cancel action. Scope to the card
    // holding the invitee so we click the right one (desktop copy is visible).
    const card = page.locator('.card').filter({ hasText: INVITEE_NAME }).filter({ visible: true }).first();
    await card.getByRole('button', { name: /^Cancel invite$/i }).click();

    // Confirm the cancel → POST /api/setu/invite/cancel → member + invite deleted.
    const [cancelResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/setu/invite/cancel') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      card.getByRole('button', { name: /confirm cancel/i }).click(),
    ]);
    expect(cancelResp.status(), await cancelResp.text()).toBe(200);

    // The pending invitee is gone from the list after the refresh.
    await expect(visibleText(page, INVITEE_NAME)).toHaveCount(0, { timeout: 15_000 });

    // And gone from Firestore (member + invite both deleted).
    const { portalFirestore } = await import('@cmt/firebase-shared/admin/firestore');
    const db = portalFirestore();
    expect((await db.collection('families').doc(FID).collection('members').doc(PENDING_MID).get()).exists).toBe(false);
    expect((await db.collection('families').doc(FID).collection('invites').doc(TOKEN).get()).exists).toBe(false);
  });
});
