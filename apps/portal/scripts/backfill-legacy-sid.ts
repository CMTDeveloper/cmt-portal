/**
 * Backfill `legacySid` onto already-migrated Setu child members.
 *
 * The check-in app's family-check-ins keys students by legacy roster `sid`, but
 * earlier migrations didn't store it on Setu members. This reads the prod RTDB
 * roster once (MASTER_FIREBASE, read-only), and for each Setu family with a
 * legacyFid matches each child member to a roster student row BY NAME (within
 * that family) and writes member.legacySid. New migrations capture sid directly
 * (legacy-parser/lazy-migrate) — this is the one-time catch-up for existing data.
 *
 * Idempotent: members that already have a legacySid are skipped. UAT by default;
 * refuses prod target unless --allow-prod.
 *
 * Usage:
 *   pnpm --filter @cmt/portal backfill:legacy-sid -- --dry-run
 *   pnpm --filter @cmt/portal backfill:legacy-sid
 *   pnpm --filter @cmt/portal backfill:legacy-sid -- --fid CMT-XXXXXXXX
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

interface RosterRow {
  fid?: string | number;
  sid?: string | number;
  fname?: string;
  lname?: string;
  grade?: number;
}

function parseArgs(argv: string[]) {
  const fidIdx = argv.indexOf('--fid');
  const limIdx = argv.indexOf('--limit');
  return {
    dryRun: argv.includes('--dry-run'),
    allowProd: argv.includes('--allow-prod'),
    onlyFid: fidIdx >= 0 ? argv[fidIdx + 1] : null,
    limit: limIdx >= 0 ? Number(argv[limIdx + 1]) : Infinity,
  };
}

function normName(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  if (!projectId) {
    console.error('PORTAL_FIREBASE_PROJECT_ID is not set. Is .env.local loaded?');
    process.exit(1);
  }
  if (projectId === 'chinmaya-setu-715b8' && !args.allowProd) {
    console.error(`Refusing to write to prod (${projectId}) without --allow-prod.`);
    process.exit(1);
  }
  console.log(`Target portal project: ${projectId}${args.dryRun ? ' [DRY RUN]' : ''}`);

  // 1. Read the prod roster once → map legacyFid → student rows (grade !== 99).
  console.log('Reading prod RTDB /roster…');
  const roster = (await readRtdb<Record<string, RosterRow>>('/roster')) ?? {};
  const studentsByFid = new Map<string, Array<{ sid: string; name: string }>>();
  for (const row of Object.values(roster)) {
    if (row.grade === 99) continue; // parent row
    if (row.fid == null || row.sid == null) continue;
    const fid = String(row.fid);
    const arr = studentsByFid.get(fid) ?? [];
    arr.push({ sid: String(row.sid), name: normName(row.fname ?? '', row.lname ?? '') });
    studentsByFid.set(fid, arr);
  }
  console.log(`Roster: ${studentsByFid.size} families with student rows.`);

  // 2. Iterate Setu families with a legacyFid; match child members by name.
  const db = getFirestore(getPortalApp());
  const famSnap = args.onlyFid
    ? await db.collection('families').where('fid', '==', args.onlyFid).get()
    : await db.collection('families').where('legacyFid', '!=', null).get();

  let processed = 0;
  let updated = 0;
  let unmatched = 0;
  for (const famDoc of famSnap.docs) {
    if (processed >= args.limit) break;
    const fam = famDoc.data() as { fid: string; legacyFid?: string | null };
    if (!fam.legacyFid) continue;
    processed++;

    const rosterStudents = studentsByFid.get(String(fam.legacyFid)) ?? [];
    const memSnap = await db.collection('families').doc(fam.fid).collection('members').get();
    const used = new Set<string>(); // sids already claimed within this family

    for (const memDoc of memSnap.docs) {
      const m = memDoc.data() as {
        mid: string;
        type: string;
        firstName: string;
        lastName: string;
        legacySid?: string | null;
      };
      if (m.type !== 'Child' || m.legacySid) continue; // skip non-children + already set
      const target = normName(m.firstName, m.lastName);
      const match = rosterStudents.find((s) => s.name === target && !used.has(s.sid));
      if (!match) {
        unmatched++;
        console.warn(`  ✘ no roster match: ${fam.fid} member ${m.mid} "${target}"`);
        continue;
      }
      used.add(match.sid);
      updated++;
      if (args.dryRun) {
        console.log(`  [dry-run] ${fam.fid} ${m.mid} → legacySid ${match.sid}`);
      } else {
        await memDoc.ref.set({ legacySid: match.sid }, { merge: true });
        console.log(`  ✔ ${fam.fid} ${m.mid} → legacySid ${match.sid}`);
      }
    }
  }

  console.log(`Done. families=${processed} membersUpdated=${updated} unmatched=${unmatched}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
