/**
 * READ-ONLY post-migration counts for whichever project `.env.local` points at.
 *
 * `check-uat-migrations.ts` hard-refuses a non-UAT project, which is right for a
 * routine audit but leaves the prod cutover with nothing to verify against. This
 * is the same idea with no project lock, and it still cannot write.
 *
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/count-setu-collections.ts
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

const TOP_LEVEL = [
  'families',
  'contactKeys',
  'offerings',
  'donationPeriods',
  'levels',
  'programs',
  'classCalendarEntries',
  'weeklySchedules',
  'donations',
  'pledges',
  'counters',
];

const GROUPS = ['members', 'enrollments'];

async function main() {
  const db = portalFirestore();
  console.log(`project: ${process.env.PORTAL_FIREBASE_PROJECT_ID}\n`);

  for (const c of TOP_LEVEL) {
    const n = await db.collection(c).count().get();
    console.log(`  ${c.padEnd(22)} ${String(n.data().count).padStart(6)}`);
  }
  console.log('');
  for (const g of GROUPS) {
    const n = await db.collectionGroup(g).count().get();
    console.log(`  ${(g + ' (group)').padEnd(22)} ${String(n.data().count).padStart(6)}`);
  }

  // The school year everything else is keyed on.
  const cfg = await db.collection('app_config').doc('school_year').get();
  console.log(`\n  app_config/school_year  ${cfg.exists ? JSON.stringify(cfg.data()?.['currentYear']) : '(ABSENT → falls back to 2025-26)'}`);

  // Spot-check one migrated family end to end.
  const sample = await db.collection('families').where('legacyFid', '!=', null).limit(1).get();
  if (!sample.empty) {
    const doc = sample.docs[0]!;
    const d = doc.data();
    const members = await doc.ref.collection('members').count().get();
    console.log(`\n  sample family ${doc.id}: legacyFid=${d['legacyFid']} location=${d['location']} members=${members.data().count} publicFid=${d['publicFid'] ?? 'null (lazy — correct)'}`);
  }
}

void main();
