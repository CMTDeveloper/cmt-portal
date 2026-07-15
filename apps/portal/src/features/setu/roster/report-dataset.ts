import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount, formatFamilyParentNames } from '@cmt/shared-domain';
import type { OfferingDoc, RosterPersonCsvRow, RosterReportRow, RosterReportChild } from '@cmt/shared-domain';
import { paymentFromAmounts } from './payment';

export type RosterReportFamilyFull = { row: RosterReportRow; personRows: RosterPersonCsvRow[] };

const OFFERING_CHUNK = 300;
const BV_PROGRAM_KEY = 'bala-vihar';

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v instanceof Date ? v : new Date(v as string);
}

type Meta = { name: string; location: string; legacyFid: string; publicFid: string | null };
type Member = { mid: string; firstName: string; lastName: string; type: string; grade: string; manager: boolean };
type EnrolledVia = 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion' | 'kiosk';
type ActiveEnr = {
  programKey: string; programLabel: string; oid: string; pid: string; eid: string;
  schoolGrade: string | null; enrolledMids: string[]; snapshot: number; override: number | null;
  enrolledAt: Date; termLabel: string; enrolledVia: EnrolledVia;
};

/**
 * One bulk pass over the whole roster - families + members + active enrollments +
 * completed donations + offerings - assembled in memory into per-family report rows
 * AND per-person CSV rows. Index-free (mirrors build-csv-rows.ts). The `year` scope
 * mirrors list-families.ts: only enrollments with `termLabel === year` count as active,
 * and (non-live year only) families with no such enrollment are dropped.
 *
 * Never throws per family - a bad family degrades to payment:'unknown', empty children.
 */
export async function buildRosterReportDataset(params: { year?: string }): Promise<RosterReportFamilyFull[]> {
  const db = portalFirestore();

  // 1) families -> meta
  const famSnap = await db.collection('families').get();
  const meta = new Map<string, Meta>();
  for (const d of famSnap.docs) {
    const x = d.data() as { name?: unknown; location?: unknown; legacyFid?: unknown; publicFid?: unknown };
    meta.set(d.id, {
      name: typeof x.name === 'string' && x.name ? x.name : d.id,
      location: typeof x.location === 'string' && x.location ? x.location : 'Brampton',
      legacyFid: typeof x.legacyFid === 'string' ? x.legacyFid : '',
      publicFid: typeof x.publicFid === 'string' ? x.publicFid : null,
    });
  }

  // 2) all members grouped by parent fid
  const memberSnap = await db.collectionGroup('members').get();
  const membersByFid = new Map<string, Member[]>();
  for (const m of memberSnap.docs) {
    const fid = m.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const d = m.data() as { mid?: unknown; firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown; manager?: unknown };
    const arr = membersByFid.get(fid) ?? [];
    arr.push({
      mid: typeof d.mid === 'string' ? d.mid : m.id,
      firstName: String(d.firstName ?? ''),
      lastName: String(d.lastName ?? ''),
      type: String(d.type ?? ''),
      grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
      manager: d.manager === true,
    });
    membersByFid.set(fid, arr);
  }

  // 3) active enrollments grouped by fid (year-scoped when requested)
  const enrSnap = await db.collectionGroup('enrollments').get();
  const activeByFid = new Map<string, ActiveEnr[]>();
  for (const e of enrSnap.docs) {
    const d = e.data() as Record<string, unknown>;
    if (d['status'] !== 'active') continue;
    const termLabel = String(d['termLabel'] ?? '');
    if (params.year && termLabel !== params.year) continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : e.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const oid = String(d['oid'] ?? '');
    const arr = activeByFid.get(fid) ?? [];
    arr.push({
      programKey: String(d['programKey'] ?? ''),
      programLabel: String(d['programLabel'] ?? ''),
      oid,
      // pid is the level-roster join key (encodes location + year); enrollments do
      // NOT store per-child level, so the child's level is derived from grade below.
      pid: String(d['pid'] ?? d['oid'] ?? ''),
      eid: typeof d['eid'] === 'string' ? (d['eid'] as string) : `${fid}-${oid}`,
      schoolGrade: typeof d['schoolGrade'] === 'string' ? (d['schoolGrade'] as string) : null,
      enrolledMids: Array.isArray(d['enrolledMids']) ? (d['enrolledMids'] as string[]) : [],
      snapshot: typeof d['suggestedAmountSnapshot'] === 'number' ? (d['suggestedAmountSnapshot'] as number) : 0,
      override: typeof d['suggestedAmountOverride'] === 'number' ? (d['suggestedAmountOverride'] as number) : null,
      enrolledAt: toDate(d['enrolledAt']),
      termLabel,
      enrolledVia: (typeof d['enrolledVia'] === 'string' ? (d['enrolledVia'] as EnrolledVia) : 'promotion'),
    });
    activeByFid.set(fid, arr);
  }

  // 4) completed donations by fid: summed amount (payment) + the set of eids they
  // cover (issue #23 confirmation matches a completed donation to its enrollment eid).
  const donSnap = await db.collectionGroup('donations').get();
  const paidByFid = new Map<string, number>();
  const completedEidsByFid = new Map<string, Set<string>>();
  for (const dd of donSnap.docs) {
    const d = dd.data() as Record<string, unknown>;
    if (d['status'] !== 'completed') continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : dd.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const amt = typeof d['amountCAD'] === 'number' ? (d['amountCAD'] as number) : 0;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + amt);
    if (typeof d['eid'] === 'string') {
      const set = completedEidsByFid.get(fid) ?? new Set<string>();
      set.add(d['eid'] as string);
      completedEidsByFid.set(fid, set);
    }
  }

  // 4b) attendance: present/late marks graduate a carry-forward from Registered →
  // Enrolled (issue #23). Bulk-read attended events once, grouped by pid (which
  // encodes location+year), mirroring deriveConfirmedFidsForLevel's pid scoping.
  const attSnap = await db.collection('attendanceEvents').where('status', 'in', ['present', 'late']).get();
  const attendedMidsByPid = new Map<string, Set<string>>();
  for (const ad of attSnap.docs) {
    const a = ad.data() as { pid?: unknown; mid?: unknown };
    const pid = typeof a.pid === 'string' ? a.pid : '';
    const mid = typeof a.mid === 'string' ? a.mid : '';
    if (!pid || !mid) continue;
    const set = attendedMidsByPid.get(pid) ?? new Set<string>();
    set.add(mid);
    attendedMidsByPid.set(pid, set);
  }

  // 5) offerings for the active enrollments -> live effective suggested amount
  const oids = [...new Set([...activeByFid.values()].flat().map((a) => a.oid).filter(Boolean))];
  const offerings = new Map<string, OfferingDoc>();
  for (let i = 0; i < oids.length; i += OFFERING_CHUNK) {
    const refs = oids.slice(i, i + OFFERING_CHUNK).map((o) => db.collection('offerings').doc(o));
    const got = await db.getAll(...refs);
    for (const snap of got) if (snap.exists) offerings.set(snap.id, snap.data() as OfferingDoc);
  }

  // 5b) levels -> a BV child's level is their school grade matched to a level's
  // gradeBand, scoped by the enrollment's pid (which encodes location + year).
  // Enrollment docs do NOT carry per-child level (the enrollment is at the program
  // level), so we derive it here - the same grade-band rule the teacher roster uses.
  // Key: `${pid}|${grade}` -> levelName. Bands within one pid are disjoint by design;
  // a stray overlap is last-write-wins (rare, non-fatal).
  const levelSnap = await db.collection('levels').get();
  const levelByPidGrade = new Map<string, string>();
  for (const d of levelSnap.docs) {
    const x = d.data() as { pid?: unknown; levelName?: unknown; programKey?: unknown; gradeBand?: unknown };
    if (x.programKey !== BV_PROGRAM_KEY) continue;
    const pid = typeof x.pid === 'string' ? x.pid : '';
    const levelName = typeof x.levelName === 'string' ? x.levelName : '';
    if (!pid || !levelName) continue;
    const band = Array.isArray(x.gradeBand) ? x.gradeBand : [];
    for (const g of band) levelByPidGrade.set(`${pid}|${String(g)}`, levelName);
  }

  // 6) which families appear: all of them (live year), or year-scoped enrollees only
  const fids = params.year ? [...meta.keys()].filter((fid) => (activeByFid.get(fid) ?? []).length > 0) : [...meta.keys()];
  fids.sort((a, b) => {
    const c = meta.get(a)!.name.localeCompare(meta.get(b)!.name);
    return c !== 0 ? c : a.localeCompare(b);
  });

  // 7) assemble per-family
  const out: RosterReportFamilyFull[] = [];
  for (const fid of fids) {
    const fam = meta.get(fid)!;
    const active = activeByFid.get(fid) ?? [];
    const members = membersByFid.get(fid) ?? [];

    const expected = active.reduce((sum, a) => {
      const off = offerings.get(a.oid) ?? null;
      const eff = a.override ?? (off ? resolveSuggestedAmount(off, a.enrolledAt) : a.snapshot);
      return sum + (eff ?? 0);
    }, 0);
    const payment = paymentFromAmounts(active.length, expected, paidByFid.get(fid) ?? 0);

    const programs = [...new Set(active.map((a) => a.programLabel).filter(Boolean))];
    const programKeys = [...new Set(active.map((a) => a.programKey).filter(Boolean))];

    // BV children: expand each active Bala Vihar enrollment's enrolledMids. Grade from
    // the member doc (falls back to the enrollment's schoolGrade); level is derived by
    // matching that grade to a level's gradeBand for the enrollment's pid. levelByMid
    // drives the per-person CSV level column.
    const bvChildren: RosterReportChild[] = [];
    const levelByMid = new Map<string, string>();
    const memberByMid = new Map(members.map((m) => [m.mid, m] as const));
    for (const a of active) {
      if (a.programKey !== BV_PROGRAM_KEY) continue;
      for (const mid of a.enrolledMids) {
        const mem = memberByMid.get(mid);
        const grade = mem?.grade || a.schoolGrade || '';
        const levelName = grade ? (levelByPidGrade.get(`${a.pid}|${grade}`) ?? null) : null;
        bvChildren.push({ grade: grade || null, levelName });
        if (levelName) levelByMid.set(mid, levelName);
      }
    }

    // Issue #23 Bala Vihar engagement for the family's active BV enrollment(s):
    // 'confirmed' ("Enrolled") if any is engagement-confirmed — a deliberate
    // enrolledVia (family-initiated / first-attendance), a present/late mark by an
    // enrolled child (scoped by pid), or a completed donation matching its eid;
    // else 'registered' (an active carry-forward / staff backfill that hasn't
    // re-engaged); null when there's no active BV enrollment. legacyPaid is NOT
    // consulted — every active BV offering is portal-sourced (the 2025-26 legacy
    // cutover offerings are no longer active), so a legacy read can't change this.
    const activeBv = active.filter((a) => a.programKey === BV_PROGRAM_KEY);
    let bvEngagement: 'confirmed' | 'registered' | null = null;
    if (activeBv.length > 0) {
      const completedEids = completedEidsByFid.get(fid);
      const confirmed = activeBv.some((a) =>
        a.enrolledVia === 'family-initiated' ||
        a.enrolledVia === 'first-attendance' ||
        a.enrolledMids.some((mid) => attendedMidsByPid.get(a.pid)?.has(mid)) ||
        (completedEids?.has(a.eid) ?? false),
      );
      bvEngagement = confirmed ? 'confirmed' : 'registered';
    }

    const row: RosterReportRow = {
      fid,
      publicFid: fam.publicFid,
      legacyFid: fam.legacyFid || null,
      name: fam.name,
      parentName: formatFamilyParentNames(members, fam.name),
      location: fam.location,
      memberCount: members.length,
      payment,
      programs,
      programKeys,
      bvChildren,
      bvEngagement,
    };

    const programsJoined = programs.join('; ');
    const personRows: RosterPersonCsvRow[] = members.map((m) => ({
      familyName: fam.name,
      fid,
      legacyFid: fam.legacyFid,
      memberName: `${m.firstName} ${m.lastName}`.trim(),
      type: m.type,
      grade: m.grade,
      level: levelByMid.get(m.mid) ?? '',
      location: fam.location,
      programs: programsJoined,
      payment,
    }));

    out.push({ row, personRows });
  }
  return out;
}
