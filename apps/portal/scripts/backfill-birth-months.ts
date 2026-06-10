/**
 * Backfill members.birthMonth (1-12) from the legacy roster's dob_m, matched
 * via members.legacySid. Reads /roster once through readRtdb (local snapshot —
 * zero RTDB downloads). UAT-guarded; idempotent (skips members whose stored
 * birthMonth already equals the roster value).
 *
 * Usage: pnpm --filter @cmt/portal backfill:birth-months [--dry-run] [--limit N] [--fid CMT-X]
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readRtdb } from '@cmt/firebase-shared/admin/rtdb';

interface Args { dryRun: boolean; limit: number | null; fid: string | null; allowProd: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, limit: null, fid: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--allow-prod') a.allowProd = true;
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--fid') a.fid = argv[++i] ?? null;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const project = process.env['PORTAL_FIREBASE_PROJECT_ID'];
  if (project !== 'chinmaya-setu-uat' && !args.allowProd) {
    console.error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected chinmaya-setu-uat (--allow-prod to bypass).`);
    process.exit(1);
  }

  const roster = (await readRtdb<Record<string, { sid?: string | number; dob_m?: number | string }>>('/roster')) ?? {};
  const monthBySid = new Map<string, number>();
  for (const row of Object.values(roster)) {
    const sid = row.sid != null ? String(row.sid) : null;
    const m = Number(row.dob_m);
    if (sid && Number.isFinite(m) && m >= 1 && m <= 12) monthBySid.set(sid, m);
  }
  console.log(`roster rows with usable dob_m: ${monthBySid.size}`);

  const db = portalFirestore();
  const membersSnap = await db.collectionGroup('members').get();
  let updated = 0, skipped = 0, noMatch = 0, processed = 0;
  for (const doc of membersSnap.docs) {
    const m = doc.data() as { type?: string; legacySid?: string | null; birthMonth?: number | null; mid?: string };
    const fid = doc.ref.parent.parent?.id ?? '';
    if (args.fid && fid !== args.fid) continue;
    if (m.type !== 'Child' || m.legacySid == null) continue;
    if (args.limit !== null && processed >= args.limit) break;
    processed++;
    const month = monthBySid.get(String(m.legacySid));
    if (month == null) { noMatch++; continue; }
    if (m.birthMonth === month) { skipped++; continue; }
    if (!args.dryRun) await doc.ref.set({ birthMonth: month }, { merge: true });
    updated++;
  }
  console.log(`processed=${processed} updated=${updated}${args.dryRun ? ' (dry-run)' : ''} alreadySet=${skipped} noRosterMatch=${noMatch}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
