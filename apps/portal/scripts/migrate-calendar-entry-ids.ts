/**
 * UAT-only migration: rewrite classCalendarEntries doc ids from the old
 * `{location}-{date}` format to the program-scoped `{programKey}-{location}-{date}`
 * (see calendarEntryId). Firestore doc ids are immutable, so each stale doc is
 * copied to the new id (preserving all fields, with entryId set to the new id)
 * and the old doc deleted.
 *
 * Idempotent — re-runs skip docs already on the new id. Refuses any project
 * other than chinmaya-setu-uat (classCalendarEntries is portal-only; prod is
 * off-limits per the firm UAT-only directive).
 *
 * Run: pnpm --filter @cmt/portal migrate:calendar-ids [-- --dry-run]
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { calendarEntryId } from '@cmt/shared-domain';

async function main(): Promise<void> {
  const projectId = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n=== calendar entry-id migration — project: ${projectId}${dryRun ? ' (DRY RUN)' : ''} ===\n`);
  if (projectId !== 'chinmaya-setu-uat') {
    console.error('REFUSING: PORTAL_FIREBASE_PROJECT_ID is not chinmaya-setu-uat. This migration is UAT-only.');
    process.exit(1);
  }

  const db = portalFirestore();
  const col = db.collection('classCalendarEntries');
  const snap = await col.get();
  console.log(`classCalendarEntries: ${snap.size} doc(s)\n`);

  let migrated = 0;
  let skipped = 0;
  let problems = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const programKey = (data['programKey'] as string) || 'bala-vihar';
    const location = data['location'] as string | null | undefined;
    const date = data['date'] as string | undefined;

    if (!location || !date) {
      console.warn(`  ! ${doc.id}: missing location/date — skipping`);
      problems++;
      continue;
    }

    const newId = calendarEntryId(programKey, location, date);
    if (doc.id === newId) {
      skipped++;
      continue;
    }

    console.log(`  ${doc.id} → ${newId}${dryRun ? '' : ' (rewriting)'}`);
    if (!dryRun) {
      const target = await col.doc(newId).get();
      if (target.exists) {
        // New-id doc already exists (a prior partial run, or a re-created entry):
        // drop the stale old-id doc rather than clobber the good one.
        console.warn(`    target already exists — deleting stale old doc only`);
        await doc.ref.delete();
      } else {
        await col.doc(newId).set({ ...data, entryId: newId });
        await doc.ref.delete();
      }
    }
    migrated++;
  }

  console.log(
    `\n${dryRun ? '[dry-run] would migrate' : 'migrated'}: ${migrated}, skipped (already new-format): ${skipped}, problems: ${problems}`,
  );
  console.log('=== done ===\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
