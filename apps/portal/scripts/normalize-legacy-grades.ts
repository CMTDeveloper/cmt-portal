/**
 * Repair stale, non-canonical `schoolGrade` values on Setu member docs.
 *
 * Legacy families migrated BEFORE `legacy-parser.ts` learned to map the legacy
 * numeric grade (grade -1/0 = the JK/SK pre-level kids, "Grade 4" free-text,
 * etc.) left blobs like "Pre L1 (Gr JK-SK)", "Grade 4", or a stray "J" in
 * `members.schoolGrade`. Those surface as junk chips in the /welcome/roster
 * Grade filter. Current code never produces them; this is a one-time cleanup of
 * the residue.
 *
 * For every Child member whose stored `schoolGrade` is not already a canonical
 * grade token (JK, SK, 1..12) this script derives the correct value:
 *   1. Authoritative: re-read the legacy /roster row (family.legacyFid +
 *      member.legacySid) via fetchLegacyFamilyForMigration and take its
 *      correctly-mapped schoolGrade.
 *   2. Fallback: normalizeGrade the stored value; if it maps to a canonical
 *      ladder rung ("Grade 4" -> "4") use that.
 *   3. Unresolved: leave untouched and report (needs a human decision).
 *
 * Reads the legacy roster from the local snapshot (RTDB_SNAPSHOT_DIR), never
 * live RTDB. DRY-RUN by default; --apply to write. UAT-only: refuses unless
 * PORTAL_FIREBASE_PROJECT_ID=chinmaya-setu-uat (--allow-prod to override).
 *
 *   pnpm --filter @cmt/portal normalize:legacy-grades
 *   pnpm --filter @cmt/portal normalize:legacy-grades -- --apply
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { GRADE_LADDER, normalizeGrade } from '@cmt/shared-domain/setu';
import {
  fetchLegacyFamilyForMigration,
  type LegacyFamilyForMigration,
} from '@/features/setu/registration/legacy-parser';

// Canonical stored grade tokens (what the member forms + current migration write).
const CANONICAL = new Set<string>(GRADE_LADDER);
// normalized rung -> canonical token, for the fallback ("grade 4"/"4" -> "4").
const RUNG_BY_NORM = new Map<string, string>(GRADE_LADDER.map((r) => [normalizeGrade(r), r]));

type Resolution =
  | { kind: 'legacy'; grade: string }
  | { kind: 'normalized'; grade: string }
  | { kind: 'ambiguous' }
  | { kind: 'unresolved' };

// Memoize the legacy roster parse per legacyFid (readRtdb serves the snapshot).
const legacyCache = new Map<string, LegacyFamilyForMigration | null>();
async function legacyFamily(legacyFid: string): Promise<LegacyFamilyForMigration | null> {
  if (!legacyCache.has(legacyFid)) {
    legacyCache.set(legacyFid, await fetchLegacyFamilyForMigration(legacyFid).catch(() => null));
  }
  return legacyCache.get(legacyFid) ?? null;
}

async function resolveGrade(
  legacyFid: string | null,
  legacySid: string | null,
  raw: string,
): Promise<Resolution> {
  // 1) Authoritative: the legacy roster row(s) for this child.
  if (legacyFid) {
    const legacy = await legacyFamily(legacyFid);
    if (legacy) {
      // 1a) exact child by legacySid.
      const byId = legacySid ? legacy.children.find((c) => c.legacySid === legacySid) : undefined;
      if (byId?.schoolGrade && CANONICAL.has(byId.schoolGrade)) return { kind: 'legacy', grade: byId.schoolGrade };
      // 1b) the old migration lost legacySid on the pre-level kids but stored the
      // legacy `level` blob verbatim as schoolGrade - match on it. Only accept when
      // every same-blob child agrees on one canonical grade (else genuinely ambiguous).
      const grades = new Set(
        legacy.children.filter((c) => c.legacyLevel === raw && c.schoolGrade && CANONICAL.has(c.schoolGrade)).map((c) => c.schoolGrade!),
      );
      if (grades.size === 1) return { kind: 'legacy', grade: [...grades][0]! };
      if (grades.size > 1) return { kind: 'ambiguous' };
    }
  }
  // 2) Fallback: normalize the stored value onto a canonical rung ("Grade 4" -> "4").
  const rung = RUNG_BY_NORM.get(normalizeGrade(raw));
  if (rung) return { kind: 'normalized', grade: rung };
  return { kind: 'unresolved' };
}

async function main(): Promise<void> {
  const project = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  const apply = process.argv.includes('--apply');
  if (project !== 'chinmaya-setu-uat' && !process.argv.includes('--allow-prod')) {
    throw new Error(`REFUSED: PORTAL_FIREBASE_PROJECT_ID is "${project}", expected "chinmaya-setu-uat". Pass --allow-prod to bypass.`);
  }

  const db = portalFirestore();

  // Family legacyFid lookup (one read of the families collection).
  const famSnap = await db.collection('families').get();
  const legacyByFid = new Map<string, string | null>();
  for (const f of famSnap.docs) {
    const x = f.data() as { legacyFid?: unknown };
    legacyByFid.set(f.id, typeof x.legacyFid === 'string' && x.legacyFid ? x.legacyFid : null);
  }

  const memberSnap = await db.collectionGroup('members').get();
  const dirty = memberSnap.docs.filter((m) => {
    const d = m.data() as { type?: unknown; schoolGrade?: unknown };
    if (String(d.type ?? '') !== 'Child') return false;
    const g = typeof d.schoolGrade === 'string' ? d.schoolGrade.trim() : '';
    return g.length > 0 && !CANONICAL.has(g);
  });

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} on ${project}`);
  console.log(`${memberSnap.size} member docs scanned; ${dirty.length} with non-canonical schoolGrade\n`);

  let fixed = 0;
  const unresolved: string[] = [];

  for (const m of dirty) {
    const fid = m.ref.parent.parent?.id ?? '(?)';
    const d = m.data() as { schoolGrade?: unknown; legacySid?: unknown; firstName?: unknown; lastName?: unknown };
    const raw = String(d.schoolGrade ?? '');
    const legacySid = typeof d.legacySid === 'string' ? d.legacySid : null;
    const name = `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim() || '(unnamed)';

    const res = await resolveGrade(legacyByFid.get(fid) ?? null, legacySid, raw);

    if (res.kind === 'unresolved' || res.kind === 'ambiguous') {
      const why = res.kind === 'ambiguous' ? 'AMBIGUOUS (same-blob kids disagree)' : 'UNRESOLVED';
      unresolved.push(`${fid}/${m.id} "${name}" grade=${JSON.stringify(raw)} [${res.kind}]`);
      console.log(`  ? ${fid}/${m.id} "${name}"  ${JSON.stringify(raw)} -> ${why} (left as-is)`);
      continue;
    }

    console.log(`  ✓ ${fid}/${m.id} "${name}"  ${JSON.stringify(raw)} -> ${JSON.stringify(res.grade)}  [${res.kind}]`);
    if (apply) {
      await m.ref.update({ schoolGrade: res.grade });
      fixed++;
    }
  }

  console.log(`\n${apply ? `Updated ${fixed} member(s).` : `Dry-run only. ${dirty.length - unresolved.length} would be fixed. Re-run with --apply to write.`}`);
  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} unresolved (needs a human grade decision):`);
    for (const u of unresolved) console.log(`  - ${u}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => { console.error(err); process.exit(1); },
);
