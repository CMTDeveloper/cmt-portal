import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export { portalFirestore };

export async function cleanupTestData(): Promise<void> {
  const db = portalFirestore();

  try {
    // Delete test families and their subcollections
    const familiesSnap = await db.collection('families').where('_test', '==', true).get();
    for (const familyDoc of familiesSnap.docs) {
      const fid = familyDoc.id;

      // Delete members subcollection
      const membersSnap = await db.collection('families').doc(fid).collection('members').get();
      for (const memberDoc of membersSnap.docs) {
        await memberDoc.ref.delete();
      }

      // Delete invites subcollection
      const invitesSnap = await db.collection('families').doc(fid).collection('invites').get();
      for (const inviteDoc of invitesSnap.docs) {
        await inviteDoc.ref.delete();
      }

      await familyDoc.ref.delete();
    }
  } catch (err) {
    console.error('[e2e cleanup] families cleanup failed:', err);
  }

  try {
    // Delete contactKeys that point to test families (fid-based cleanup)
    // We query by _test flag on contactKeys where we can, otherwise rely on
    // the families cleanup above having removed the family docs.
    const contactKeysSnap = await db.collection('contactKeys').where('_test', '==', true).get();
    for (const ckDoc of contactKeysSnap.docs) {
      await ckDoc.ref.delete();
    }
  } catch (err) {
    console.error('[e2e cleanup] contactKeys cleanup failed:', err);
  }

  try {
    // Delete test donationPeriods
    const periodsSnap = await db.collection('donationPeriods').where('_test', '==', true).get();
    for (const periodDoc of periodsSnap.docs) {
      await periodDoc.ref.delete();
    }
  } catch (err) {
    console.error('[e2e cleanup] donationPeriods cleanup failed:', err);
  }

  try {
    // Delete test enrollments — sub-collection under test families.
    // Test families are already deleted above, but enrollment docs inside them
    // may persist in Firestore if the family delete didn't cascade.
    // We use a collectionGroup query tagged with _test: true.
    const enrollmentsSnap = await db.collectionGroup('enrollments').where('_test', '==', true).get();
    for (const enrollmentDoc of enrollmentsSnap.docs) {
      await enrollmentDoc.ref.delete();
    }
  } catch (err) {
    console.error('[e2e cleanup] enrollments cleanup failed:', err);
  }
}
