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

interface PricingTier {
  effectiveFrom: string; // YYYY-MM-DD
  amountCAD: number;
  label: string;
}

interface PeriodSeed {
  pid: string;
  programKey: 'bala-vihar';
  programLabel: 'Bala Vihar';
  location: 'Brampton' | 'Mississauga' | 'Scarborough' | 'Markham';
  periodLabel: string;
  startDate: Date;
  endDate: Date;
  pricingTiers: PricingTier[];
  // 'legacy' → payment status read from the prod RTDB roster (the cutover year);
  // 'portal' → Stripe donations through the portal (2026-27 onward).
  paymentSource: 'portal' | 'legacy';
  enabled: boolean;
}

// Bala Vihar is one continuous school year (Sept → June), one period per
// location. The suggested donation is prorated by enrollment date — admins
// adjust these tiers/amounts in the admin panel. Example amounts below.
const PRICING_2025_26: PricingTier[] = [
  { effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year (from September)' },
  { effectiveFrom: '2025-12-01', amountCAD: 300, label: 'Joined winter' },
  { effectiveFrom: '2026-02-01', amountCAD: 200, label: 'Joined spring' },
];

// 2026-27 mirrors 2025-26's tiers (admins adjust in the period editor).
const PRICING_2026_27: PricingTier[] = [
  { effectiveFrom: '2026-09-01', amountCAD: 500, label: 'Full year (from September)' },
  { effectiveFrom: '2026-12-01', amountCAD: 300, label: 'Joined winter' },
  { effectiveFrom: '2027-02-01', amountCAD: 200, label: 'Joined spring' },
];

const PERIODS: PeriodSeed[] = [
  {
    pid: 'bv-brampton-2025-26',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    periodLabel: '2025-26',
    startDate: toTorontoStartOfDay('2025-09-07'),
    endDate: toTorontoEndOfDay('2026-06-14'),
    pricingTiers: PRICING_2025_26,
    paymentSource: 'legacy',
    enabled: true,
  },
  {
    pid: 'bv-scarborough-2025-26',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Scarborough',
    periodLabel: '2025-26',
    startDate: toTorontoStartOfDay('2025-09-07'),
    endDate: toTorontoEndOfDay('2026-06-14'),
    pricingTiers: PRICING_2025_26,
    paymentSource: 'legacy',
    enabled: true,
  },
  // 2026-27 — portal/Stripe. Enrollment opens the day after the last 2025-26
  // class (Jun 14 2026); admin can shift these dates in the period editor.
  {
    pid: 'bv-brampton-2026-27',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Brampton',
    periodLabel: '2026-27',
    startDate: toTorontoStartOfDay('2026-06-15'),
    endDate: toTorontoEndOfDay('2027-06-13'),
    pricingTiers: PRICING_2026_27,
    paymentSource: 'portal',
    enabled: true,
  },
  {
    pid: 'bv-scarborough-2026-27',
    programKey: 'bala-vihar',
    programLabel: 'Bala Vihar',
    location: 'Scarborough',
    periodLabel: '2026-27',
    startDate: toTorontoStartOfDay('2026-06-15'),
    endDate: toTorontoEndOfDay('2027-06-13'),
    pricingTiers: PRICING_2026_27,
    paymentSource: 'portal',
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
        pricingTiers: period.pricingTiers,
        paymentSource: period.paymentSource,
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
