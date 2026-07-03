import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { paymentSourceOf } from '@cmt/shared-domain';
import type { DonationDoc, EnrollmentReport, PaymentSource, ReportQuery } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';

const BV_PROGRAM_KEY = 'bala-vihar';
const OFFERING_CHUNK = 300;
const IN_CHUNK = 30; // Firestore `where in` supports up to 30 values.

type EnrolledVia = EnrollmentWithOffering['enrolledVia'];
const ENROLLED_VIA_VALUES: readonly EnrolledVia[] = [
  'family-initiated',
  'first-attendance',
  'welcome-team',
  'promotion',
];
// Slice 1 (2026-07-06): the confirmed/registered split now also honours a
// deliberate 'family-initiated'/'first-attendance' enrollment, so the report
// must thread the real enrolledVia through to isEnrollmentConfirmed. A corrupt
// doc missing the field falls back to 'promotion' (engagement-required — the
// conservative pre-Slice-1 behaviour), never auto-confirming on a bad read.
function normalizeEnrolledVia(v: unknown): EnrolledVia {
  return typeof v === 'string' && (ENROLLED_VIA_VALUES as readonly string[]).includes(v)
    ? (v as EnrolledVia)
    : 'promotion';
}

type RawEnr = {
  fid?: unknown; programKey?: unknown; programLabel?: unknown; status?: unknown;
  enrolledMids?: unknown; levelSnapshots?: unknown; termLabel?: unknown;
  eid?: unknown; oid?: unknown; enrolledVia?: unknown;
};

/** An active Bala Vihar enrollment, distilled for the confirmed/registered split. */
interface BvEnr { fid: string; eid: string; oid: string; enrolledMids: string[]; enrolledVia: EnrolledVia }

export async function buildEnrollmentReport(params: ReportQuery): Promise<EnrollmentReport> {
  const db = portalFirestore();
  // All bulk reads up front (the enrollment kind aggregates ~800 families — never
  // per-family fan-out). families → legacyFid, donations → per-fid completed set;
  // both feed the issue #23 confirmed/registered split.
  const [enrSnap, lvlSnap, famSnap, donSnap] = await Promise.all([
    db.collectionGroup('enrollments').get(),
    db.collection('levels').get(),
    db.collection('families').get(),
    db.collectionGroup('donations').get(),
  ]);

  const levelName = new Map<string, { name: string; programKey: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown };
    levelName.set(d.id, { name: typeof x.levelName === 'string' ? x.levelName : d.id, programKey: String(x.programKey ?? '') });
  }

  const byProgramFamilies = new Map<string, Set<string>>();
  const byProgramMembers = new Map<string, Set<string>>();
  const programLabels = new Map<string, string>();
  const byLevelMembers = new Map<string, Set<string>>(); // levelId → mids
  const bvEnrollments: BvEnr[] = [];
  let totalActiveEnrollments = 0;
  const allMembers = new Set<string>();

  for (const d of enrSnap.docs) {
    const e = d.data() as RawEnr;
    if (e.status !== 'active') continue;
    // Year scope (in-memory, no index): the read is already unfiltered.
    if (params.year && String(e.termLabel ?? '') !== params.year) continue;
    const programKey = String(e.programKey ?? '');
    if (!programKey) continue;
    if (params.program && programKey !== params.program) continue;
    const fid = String(e.fid ?? '');
    const mids = Array.isArray(e.enrolledMids) ? e.enrolledMids.map(String) : [];
    totalActiveEnrollments++;
    programLabels.set(programKey, typeof e.programLabel === 'string' ? e.programLabel : programKey);
    if (!byProgramFamilies.has(programKey)) { byProgramFamilies.set(programKey, new Set()); byProgramMembers.set(programKey, new Set()); }
    if (fid) byProgramFamilies.get(programKey)!.add(fid);
    for (const mid of mids) { byProgramMembers.get(programKey)!.add(mid); allMembers.add(mid); }
    if (fid && programKey === BV_PROGRAM_KEY) {
      bvEnrollments.push({
        fid,
        eid: String(e.eid ?? ''),
        oid: String(e.oid ?? ''),
        enrolledMids: mids,
        enrolledVia: normalizeEnrolledVia(e.enrolledVia),
      });
    }
    const snaps = (e.levelSnapshots && typeof e.levelSnapshots === 'object') ? (e.levelSnapshots as Record<string, { levelId?: unknown }>) : {};
    for (const [mid, snap] of Object.entries(snaps)) {
      const levelId = typeof snap?.levelId === 'string' ? snap.levelId : null;
      if (!levelId) continue;
      if (!byLevelMembers.has(levelId)) byLevelMembers.set(levelId, new Set());
      byLevelMembers.get(levelId)!.add(mid);
    }
  }

  const confirmedFids = await deriveBvConfirmedFids(db, bvEnrollments, famSnap, donSnap);

  const byProgram = [...byProgramFamilies.keys()].sort().map((programKey) => {
    const familySet = byProgramFamilies.get(programKey)!;
    const base = {
      programKey,
      programLabel: programLabels.get(programKey) ?? programKey,
      families: familySet.size,
      members: byProgramMembers.get(programKey)!.size,
    };
    if (programKey !== BV_PROGRAM_KEY) return base;
    // issue #23: split BV families into engagement-confirmed vs merely registered.
    const confirmed = [...familySet].filter((f) => confirmedFids.has(f)).length;
    return { ...base, confirmed, registered: base.families - confirmed };
  });

  const byLevel = [...byLevelMembers.keys()]
    .map((levelId) => {
      const meta = levelName.get(levelId);
      return { levelId, levelName: meta?.name ?? levelId, programKey: meta?.programKey ?? '', members: byLevelMembers.get(levelId)!.size };
    })
    .filter((l) => !params.program || l.programKey === params.program)
    .sort((a, b) => a.levelName.localeCompare(b.levelName));

  return { byProgram, byLevel, totalActiveEnrollments, totalMembers: allMembers.size };
}

/**
 * The set of family ids whose active Bala Vihar enrollment is engagement-confirmed
 * (issue #23). BULK: joins the already-loaded families + donations with two more
 * bulk reads — teacher `attendanceEvents` scoped to the BV offering ids, and each
 * legacy-sourced BV family's cached legacy roster status. NO per-family fan-out.
 *
 * Tradeoff (stated in the Task 6 report): unlike the family dashboard's per-family
 * signal, this omits door self-check-ins (they'd need a per-family RTDB read). A
 * family whose ONLY engagement is a door check-in — no teacher mark, no donation,
 * not legacy-paid — undercounts here as `registered`.
 */
async function deriveBvConfirmedFids(
  db: FirebaseFirestore.Firestore,
  bvEnrollments: BvEnr[],
  famSnap: FirebaseFirestore.QuerySnapshot,
  donSnap: FirebaseFirestore.QuerySnapshot,
): Promise<Set<string>> {
  const confirmedFids = new Set<string>();
  if (bvEnrollments.length === 0) return confirmedFids;

  const legacyFidByFid = new Map<string, string | null>();
  for (const d of famSnap.docs) {
    const x = d.data() as { legacyFid?: unknown };
    legacyFidByFid.set(d.id, typeof x.legacyFid === 'string' ? x.legacyFid : null);
  }

  const donationsByFid = new Map<string, DonationDoc[]>();
  for (const dd of donSnap.docs) {
    const d = dd.data() as DonationDoc & { fid?: unknown };
    const fid = typeof d.fid === 'string' ? d.fid : dd.ref.parent.parent?.id;
    if (!fid) continue;
    const arr = donationsByFid.get(fid) ?? [];
    arr.push(d);
    donationsByFid.set(fid, arr);
  }

  const bvOids = [...new Set(bvEnrollments.map((e) => e.oid).filter(Boolean))];

  // offering paymentSource (batched getAll — no query, no index).
  const paymentSourceByOid = new Map<string, PaymentSource>();
  for (let i = 0; i < bvOids.length; i += OFFERING_CHUNK) {
    const refs = bvOids.slice(i, i + OFFERING_CHUNK).map((o) => db.collection('offerings').doc(o));
    const got = await db.getAll(...refs);
    for (const s of got) {
      if (!s.exists) continue;
      const o = s.data() as { paymentSource?: PaymentSource };
      paymentSourceByOid.set(s.id, paymentSourceOf(o.paymentSource !== undefined ? { paymentSource: o.paymentSource } : {}));
    }
  }

  // teacher attendance scoped to the BV offering ids (single-field `in`, no
  // composite index). Set of `${oid}::${mid}` that were present or late.
  const attendedPairs = new Set<string>();
  for (let i = 0; i < bvOids.length; i += IN_CHUNK) {
    const chunk = bvOids.slice(i, i + IN_CHUNK);
    if (chunk.length === 0) continue;
    const evSnap = await db.collection('attendanceEvents').where('pid', 'in', chunk).get();
    for (const d of evSnap.docs) {
      const e = d.data() as { pid?: unknown; mid?: unknown; status?: unknown };
      if (e.status !== 'present' && e.status !== 'late') continue;
      attendedPairs.add(`${String(e.pid ?? '')}::${String(e.mid ?? '')}`);
    }
  }

  // legacy roster status only for legacy-sourced BV offerings (one cached RTDB
  // index read serves every lookup).
  const legacyFidsToCheck = new Set<string>();
  for (const enr of bvEnrollments) {
    if (paymentSourceByOid.get(enr.oid) !== 'legacy') continue;
    const lf = legacyFidByFid.get(enr.fid);
    if (lf) legacyFidsToCheck.add(lf);
  }
  const legacyStatusByLegacyFid = new Map<string, string>();
  await Promise.all([...legacyFidsToCheck].map(async (lf) => {
    legacyStatusByLegacyFid.set(lf, await getLegacyPaymentStatus(lf));
  }));

  for (const enr of bvEnrollments) {
    const attendedCount = enr.enrolledMids.some((mid) => attendedPairs.has(`${enr.oid}::${mid}`)) ? 1 : 0;
    const legacyFid = legacyFidByFid.get(enr.fid);
    const legacyPaid =
      paymentSourceByOid.get(enr.oid) === 'legacy' && legacyFid
        ? legacyStatusByLegacyFid.get(legacyFid) === 'paid'
        : false;
    const donations = donationsByFid.get(enr.fid) ?? [];
    if (isEnrollmentConfirmed({ eid: enr.eid, enrolledVia: enr.enrolledVia }, { attendedCount, donations, legacyPaid })) {
      confirmedFids.add(enr.fid);
    }
  }
  return confirmedFids;
}
