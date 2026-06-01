/**
 * Multi-Program Foundation — Phase C migration (UAT-only).
 *
 * Additive, idempotent backfill that promotes the Bala-Vihar-only data model
 * into the program-agnostic foundation. It does THREE things, all via
 * `.set(..., { merge: true })` so re-runs are safe and nothing is destroyed:
 *
 *   1. Seed `programs/bala-vihar` (the first Program definition).
 *   2. Copy each `donationPeriods/*` doc → `offerings/{sameId}` (periodLabel →
 *      termLabel, termType: 'term'). The originals are LEFT IN PLACE so the
 *      currently-deployed main app keeps reading them — rollback-safe.
 *   3. For each `families/{fid}/enrollments/*`, merge the generalized fields
 *      (`oid`, `programKey`, `termLabel`, `enrolledMids`, `location`) onto the
 *      existing doc. Old fields (`pid`, `periodLabel`, `childrenMids`) are LEFT
 *      IN PLACE for rollback.
 *
 * Because every write is additive + merge, the live main app (which reads the
 * untouched `donationPeriods` collection and legacy enrollment fields) is
 * unaffected while this populates the new shapes the refactored portal reads.
 *
 * Usage:
 *   pnpm --filter @cmt/portal migrate:programs [-- --dry-run] [--allow-prod]
 *
 * Defaults: writes against UAT (PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat).
 * Refuses to run against any other project unless --allow-prod is passed.
 */

import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';

interface Args {
  dryRun: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, allowProd: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-prod') args.allowProd = true;
  }
  return args;
}

const BALA_VIHAR_PROGRAM = {
  programKey: 'bala-vihar',
  label: 'Bala Vihar',
  shortDescription: 'Sunday Bala Vihar classes',
  status: 'active',
  locations: ['Brampton', 'Mississauga', 'Scarborough', 'Markham'],
  termType: 'term',
  eligibility: { memberType: 'child' },
  capabilities: {
    usesOfferings: true,
    usesDonation: true,
    usesLevels: true,
    usesCalendar: true,
    attendanceMode: 'check-in',
  },
  displayOrder: 0,
} as const;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID;
  if (!portalProject) {
    console.error('REFUSED: PORTAL_FIREBASE_PROJECT_ID must be set in .env.local');
    process.exit(1);
  }
  if (portalProject !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(
      `REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${portalProject}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`,
    );
    process.exit(1);
  }

  console.log('\nMulti-Program Foundation migration (Phase C)');
  console.log(`  Write to:   ${portalProject} (Firestore${args.dryRun ? ', DRY-RUN — no writes' : ''})`);
  console.log('');

  const db = portalFirestore();
  const counts = { offerings: 0, enrollments: 0 };

  // ── 1. Seed programs/bala-vihar ───────────────────────────────────────────
  {
    const ref = db.collection('programs').doc('bala-vihar');
    const existing = await ref.get();
    const verb = existing.exists ? 'merge (exists)' : 'seed (new)';
    console.log(`programs/bala-vihar — would ${verb}`);
    if (!args.dryRun) {
      const now = FieldValue.serverTimestamp();
      await ref.set(
        {
          ...BALA_VIHAR_PROGRAM,
          // Only stamp createdAt/createdBy on first write; merge preserves them after.
          ...(existing.exists ? {} : { createdAt: now, createdBy: 'migration' }),
          updatedAt: now,
          updatedBy: 'migration',
        },
        { merge: true },
      );
    }
  }

  // ── 2. donationPeriods/* → offerings/{sameId} ─────────────────────────────
  {
    const periodsSnap = await db.collection('donationPeriods').get();
    console.log(`\ndonationPeriods → offerings: ${periodsSnap.size} source docs`);
    for (const doc of periodsSnap.docs) {
      const data = doc.data();
      const oid = doc.id;
      const offering: Record<string, unknown> = {
        oid,
        programKey: (data['programKey'] as string | undefined) ?? 'bala-vihar',
        programLabel: (data['programLabel'] as string | undefined) ?? 'Bala Vihar',
        location: data['location'] ?? null,
        termLabel: data['periodLabel'] ?? data['termLabel'] ?? oid,
        termType: 'term',
        startDate: data['startDate'],
        endDate: data['endDate'] ?? null,
        pricingTiers: data['pricingTiers'] ?? [],
        enabled: data['enabled'] ?? false,
        createdAt: data['createdAt'] ?? FieldValue.serverTimestamp(),
        createdBy: data['createdBy'] ?? 'migration',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'migration',
      };
      // Optional fields: only set when present (keep Firestore docs clean).
      if (data['amountTiers'] !== undefined) offering['amountTiers'] = data['amountTiers'];
      if (data['paymentSource'] !== undefined) offering['paymentSource'] = data['paymentSource'];

      console.log(`  offerings/${oid} — would write (termLabel="${String(offering['termLabel'])}")`);
      if (!args.dryRun) {
        await db.collection('offerings').doc(oid).set(offering, { merge: true });
      }
      counts.offerings++;
    }
  }

  // ── 3. families/{fid}/enrollments/* → add generalized fields ──────────────
  {
    const familiesSnap = await db.collection('families').get();
    console.log(`\nfamilies: ${familiesSnap.size} docs — scanning enrollments`);
    for (const fam of familiesSnap.docs) {
      const enrollmentsSnap = await fam.ref.collection('enrollments').get();
      for (const enr of enrollmentsSnap.docs) {
        const data = enr.data();
        const patch: Record<string, unknown> = {
          oid: data['pid'] ?? data['oid'],
          programKey: 'bala-vihar',
          programLabel: data['programLabel'] ?? 'Bala Vihar',
          termLabel: data['periodLabel'] ?? data['termLabel'] ?? null,
          enrolledMids: data['childrenMids'] ?? data['enrolledMids'] ?? [],
          location: data['location'] ?? null,
        };
        console.log(`  families/${fam.id}/enrollments/${enr.id} — would merge (oid=${String(patch['oid'])})`);
        if (!args.dryRun) {
          await enr.ref.set(patch, { merge: true });
        }
        counts.enrollments++;
      }
    }
  }

  console.log('\nSummary:');
  console.log(`  program seeded: bala-vihar`);
  console.log(`  offerings:      ${counts.offerings}`);
  console.log(`  enrollments:    ${counts.enrollments}`);
  if (args.dryRun) console.log('  (DRY-RUN — no writes performed)');
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
