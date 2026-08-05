import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { paymentSourceOf, memberMatchesLevel } from '@cmt/shared-domain';
import type { LevelKind } from '@cmt/shared-domain';
import type { DonationDoc, EnrollmentReport, PaymentSource, ReportQuery } from '@cmt/shared-domain';
import { getLegacyPaymentStatus } from '@/features/setu/donations/legacy-payment';
import { isEnrollmentConfirmed } from '@/app/family/_helpers/enrollment-confirmation';
import type { EnrollmentWithOffering } from '@/features/setu/enrollment/get-enrollments';
import { loadActivePledgeFids } from '@/features/setu/pledges/active-pledge-fids';

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
  eid?: unknown; oid?: unknown; pid?: unknown; enrolledVia?: unknown;
};

/** An active Bala Vihar enrollment, distilled for the confirmed/registered split. */
interface BvEnr { fid: string; eid: string; oid: string; enrolledMids: string[]; enrolledVia: EnrolledVia }

export async function buildEnrollmentReport(params: ReportQuery): Promise<EnrollmentReport> {
  const db = portalFirestore();
  // All bulk reads up front (the enrollment kind aggregates ~800 families — never
  // per-family fan-out). families → legacyFid, donations → per-fid completed set;
  // both feed the issue #23 confirmed/registered split.
  const [enrSnap, lvlSnap, famSnap, donSnap, offSnap, memSnap] = await Promise.all([
    db.collectionGroup('enrollments').get(),
    db.collection('levels').get(),
    db.collection('families').get(),
    db.collectionGroup('donations').get(),
    db.collection('offerings').get(),
    // Members join the bulk set for the level derivation below. Unfiltered, so
    // it needs no index - the same shape every other bulk pass here uses.
    db.collectionGroup('members').get(),
  ]);

  // pid → {location, termLabel} so a level row can be disambiguated by its offering
  // (same level NAME exists across locations/years).
  const offMeta = new Map<string, { location: string | null; termLabel: string }>();
  for (const d of offSnap.docs) {
    const x = d.data() as { location?: unknown; termLabel?: unknown };
    offMeta.set(d.id, {
      location: typeof x.location === 'string' ? x.location : null,
      termLabel: typeof x.termLabel === 'string' ? x.termLabel : '',
    });
  }

  const levelName = new Map<string, { name: string; programKey: string; pid: string }>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { levelName?: unknown; programKey?: unknown; pid?: unknown };
    levelName.set(d.id, {
      name: typeof x.levelName === 'string' ? x.levelName : d.id,
      programKey: String(x.programKey ?? ''),
      pid: String(x.pid ?? ''),
    });
  }

  /**
   * ── WHY THIS REPORT DERIVES A LEVEL AT ALL ─────────────────────────────────
   *
   * It used to count `enrollment.levelSnapshots[mid].levelId` and nothing else.
   * Only the ANNUAL ROLLOVER writes that field - `enrollFamily` never does - so
   * for a school year nobody has rolled over yet, it is empty on every
   * enrollment and every per-level row reads 0. Measured in production
   * 2026-08-05: 18 active Bala Vihar enrollments, ZERO with a snapshot.
   *
   * So: the snapshot when there is one, otherwise derive from the member's
   * grade/age exactly as the roster and the teacher roster do. That order is
   * deliberate and not just a fallback - for a PAST year the snapshot is the
   * honest record of where a child actually sat, and deriving live would
   * re-file them by the grade they are in NOW.
   */
  const levelsByPid = new Map<string, Array<{ levelId: string; levelKind: LevelKind; gradeBand: string[] }>>();
  for (const d of lvlSnap.docs) {
    const x = d.data() as { pid?: unknown; levelKind?: unknown; gradeBand?: unknown; enabled?: unknown };
    if (x.enabled === false) continue;
    const pid = typeof x.pid === 'string' ? x.pid : '';
    const kind = x.levelKind;
    if (!pid || (kind !== 'level' && kind !== 'pre-level' && kind !== 'shishu' && kind !== 'parents')) continue;
    const arr = levelsByPid.get(pid) ?? [];
    arr.push({ levelId: d.id, levelKind: kind, gradeBand: Array.isArray(x.gradeBand) ? x.gradeBand.map(String) : [] });
    levelsByPid.set(pid, arr);
  }
  // Ordered by levelId so an overlapping band resolves the same way here, on the
  // roster and on the family dashboard - see report-dataset.ts for why.
  for (const arr of levelsByPid.values()) arr.sort((a, b) => a.levelId.localeCompare(b.levelId));

  const memberByMid = new Map<string, { type: 'Adult' | 'Child'; schoolGrade: string | null; birthMonthYear: string | null }>();
  for (const d of memSnap.docs) {
    const x = d.data() as { mid?: unknown; type?: unknown; schoolGrade?: unknown; birthMonthYear?: unknown };
    const mid = typeof x.mid === 'string' ? x.mid : d.id;
    memberByMid.set(mid, {
      type: x.type === 'Adult' ? 'Adult' : 'Child',
      schoolGrade: typeof x.schoolGrade === 'string' ? x.schoolGrade : null,
      birthMonthYear: typeof x.birthMonthYear === 'string' ? x.birthMonthYear : null,
    });
  }
  // One clock for the whole report, so two children of the same age cannot land
  // in different levels because the loop crossed a month boundary.
  const now = new Date();

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
    const pid = String(e.pid ?? e.oid ?? '');
    for (const mid of mids) {
      const snapped = typeof snaps[mid]?.levelId === 'string' ? (snaps[mid]!.levelId as string) : null;
      let levelId = snapped;
      if (!levelId) {
        const mem = memberByMid.get(mid);
        // A mid with no member doc is still matched as a Child - that is what
        // being in `enrolledMids` means - so it can place on grade alone.
        const forMatch = {
          type: mem?.type ?? ('Child' as const),
          schoolGrade: mem?.schoolGrade ?? null,
          birthMonthYear: mem?.birthMonthYear ?? null,
        };
        levelId = (levelsByPid.get(pid) ?? []).find((l) => memberMatchesLevel(forMatch, l, now))?.levelId ?? null;
      }
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
      const off = meta?.pid ? offMeta.get(meta.pid) : undefined;
      return {
        levelId,
        levelName: meta?.name ?? levelId,
        programKey: meta?.programKey ?? '',
        ...(off ? { location: off.location, termLabel: off.termLabel } : {}),
        members: byLevelMembers.get(levelId)!.size,
      };
    })
    .filter((l) => !params.program || l.programKey === params.program)
    .sort((a, b) => a.levelName.localeCompare(b.levelName) || (a.termLabel ?? '').localeCompare(b.termLabel ?? ''));

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

  // Monthly pledges count as the enrollment donation (2026-07-27). One query,
  // like every other signal in this report.
  //
  // ⚠️ This report OVER-COUNTS a monthly giver who has stopped paying at their
  // bank: with no Stripe webhook the portal never learns a debit failed, so an
  // `active` pledge reads as satisfied until the reconciler or a human notices.
  // Accepted by CMT Developer 2026-07-27 as the cost of shipping the instalment
  // option for launch; revisit when invoice polling exists.
  const pledgedFids = await loadActivePledgeFids();

  for (const enr of bvEnrollments) {
    const attendedCount = enr.enrolledMids.some((mid) => attendedPairs.has(`${enr.oid}::${mid}`)) ? 1 : 0;
    const legacyFid = legacyFidByFid.get(enr.fid);
    const legacyPaid =
      paymentSourceByOid.get(enr.oid) === 'legacy' && legacyFid
        ? legacyStatusByLegacyFid.get(legacyFid) === 'paid'
        : false;
    const donations = donationsByFid.get(enr.fid) ?? [];
    if (
      isEnrollmentConfirmed(
        { eid: enr.eid, enrolledVia: enr.enrolledVia },
        { attendedCount, donations, legacyPaid, hasActivePledge: pledgedFids.has(enr.fid) },
      )
    ) {
      confirmedFids.add(enr.fid);
    }
  }
  return confirmedFids;
}
