/**
 * Slice 3a — Seed current donation periods.
 *
 * Populates donationPeriods/ in UAT Firestore with the current Bala Vihar
 * periods for each active CMT location. Idempotent — re-runs are safe (uses
 * set() which overwrites). By default targets UAT; refuses prod unless
 * --allow-prod is passed.
 *
 * Usage:
 *   pnpm --filter @cmt/portal seed:donation-periods
 *   pnpm --filter @cmt/portal seed:donation-periods -- --dry-run
 *   pnpm --filter @cmt/portal seed:donation-periods -- --allow-prod
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { toTorontoStartOfDay, toTorontoEndOfDay } from '../src/lib/toronto-date';

function parseArgs(argv: string[]): { dryRun: boolean; allowProd: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    allowProd: argv.includes('--allow-prod'),
  };
}

interface PeriodSeed {
  pid: string;
  programKey: 'bala-vihar';
  programLabel: 'Bala Vihar';
  location: 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
  periodLabel: string;
  startDate: Date;
  endDate: Date;
  suggestedAmount: number;
  amountTiers: number[];
  enabled: boolean;
}

// Current periods for go-live. Update before each semester.
const PERIODS: PeriodSeed[] = [
  {
    pid: 'bv-brampton-fall-2025',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    periodLabel: 'Fall 2025',
    startDate: toTorontoStartOfDay('2025-09-07'),
    endDate: toTorontoEndOfDay('2026-01-26'),
    suggestedAmount: 500,
    amountTiers: [500, 750, 1000, 1500],
    enabled: true,
  },
  {
    pid: 'bv-brampton-winter-2026',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    periodLabel: 'Winter 2026',
    startDate: toTorontoStartOfDay('2026-02-01'),
    endDate: toTorontoEndOfDay('2026-06-28'),
    suggestedAmount: 500,
    amountTiers: [500, 750, 1000, 1500],
    enabled: true,
  },
  {
    pid: 'bv-mississauga-fall-2025',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Mississauga',
    periodLabel: 'Fall 2025',
    startDate: toTorontoStartOfDay('2025-09-07'),
    endDate: toTorontoEndOfDay('2026-01-26'),
    suggestedAmount: 500,
    amountTiers: [500, 750, 1000, 1500],
    enabled: true,
  },
  {
    pid: 'bv-mississauga-winter-2026',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Mississauga',
    periodLabel: 'Winter 2026',
    startDate: toTorontoStartOfDay('2026-02-01'),
    endDate: toTorontoEndOfDay('2026-06-28'),
    suggestedAmount: 500,
    amountTiers: [500, 750, 1000, 1500],
    enabled: true,
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  if (!projectId) {
    console.error('PORTAL_FIREBASE_PROJECT_ID is not set. Is .env.local loaded?');
    process.exit(1);
  }
  const isProd = projectId === 'chinmaya-setu-715b8';
  if (isProd && !args.allowProd) {
    console.error(
      `Refusing to write to prod (${projectId}) without --allow-prod. ` +
        'Pass --allow-prod only after double-checking you want to seed prod.',
    );
    process.exit(1);
  }

  console.log(`Target project: ${projectId}${args.dryRun ? ' [DRY RUN]' : ''}`);

  const db = getFirestore(getPortalApp());
  const systemUid = 'seed-script';
  const now = Timestamp.now();

  for (const period of PERIODS) {
    if (args.dryRun) {
      console.log(`[dry-run] Would upsert ${period.pid} (${period.periodLabel} @ ${period.location})`);
      continue;
    }
    try {
      await db.collection('donationPeriods').doc(period.pid).set({
        pid: period.pid,
        programKey: period.programKey,
        programLabel: period.programLabel,
        location: period.location,
        periodLabel: period.periodLabel,
        startDate: Timestamp.fromDate(period.startDate),
        endDate: Timestamp.fromDate(period.endDate),
        suggestedAmount: period.suggestedAmount,
        amountTiers: period.amountTiers,
        enabled: period.enabled,
        createdAt: now,
        createdBy: systemUid,
        updatedAt: now,
        updatedBy: systemUid,
      });
      console.log(`  ✔ upserted ${period.pid}`);
    } catch (err) {
      console.error(`  ✘ failed ${period.pid}:`, err);
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
