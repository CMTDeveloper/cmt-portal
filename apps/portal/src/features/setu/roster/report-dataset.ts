import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { formatFamilyParentNames, isParticipating, memberMatchesLevel } from '@cmt/shared-domain';
import type { LevelKind } from '@cmt/shared-domain';
import type { OfferingDoc, RosterPersonCsvRow, RosterReportRow, RosterReportChild } from '@cmt/shared-domain';
import { classifyBulkPayment } from './payment';
import { loadActivePledgeFids } from '@/features/setu/pledges/active-pledge-fids';

export type RosterReportFamilyFull = { row: RosterReportRow; personRows: RosterPersonCsvRow[] };

/** A level, shaped for `memberMatchesLevel`. Mirrors `LevelForMatch` in
 *  derive-child-level.ts, minus the levelId this builder does not use. */
type LevelForMatch = { levelName: string; levelKind: LevelKind; gradeBand: string[] };

const OFFERING_CHUNK = 300;
const BV_PROGRAM_KEY = 'bala-vihar';

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v instanceof Date ? v : new Date(v as string);
}

type Meta = { name: string; location: string; legacyFid: string; publicFid: string | null };
type Member = { mid: string; firstName: string; lastName: string; type: string; grade: string; birthMonthYear: string | null; manager: boolean; participating: boolean };
type EnrolledVia = 'family-initiated' | 'first-attendance' | 'welcome-team' | 'promotion' | 'kiosk';
type ActiveEnr = {
  programKey: string; programLabel: string; oid: string; pid: string; eid: string;
  schoolGrade: string | null; enrolledMids: string[]; snapshot: number; override: number | null;
  settledOffPortal: boolean;
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
    const d = m.data() as { mid?: unknown; firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown; birthMonthYear?: unknown; manager?: unknown; participation?: unknown };
    const arr = membersByFid.get(fid) ?? [];
    arr.push({
      mid: typeof d.mid === 'string' ? d.mid : m.id,
      firstName: String(d.firstName ?? ''),
      lastName: String(d.lastName ?? ''),
      type: String(d.type ?? ''),
      grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
      // Needed to place a shishu child: their level is matched by AGE, not by
      // grade band. Omitting it here is what put all 5 in "(no level)".
      birthMonthYear: typeof d.birthMonthYear === 'string' ? d.birthMonthYear : null,
      manager: d.manager === true,
      // Through the shared helper: absent means active, and every migrated
      // member doc predates the field.
      participating: isParticipating(d as { participation?: string | null }),
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
      settledOffPortal: d['settledOffPortal'] === true,
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

  // 5b) levels -> a BV child's level, scoped by the enrollment's pid (which
  // encodes location + year). Enrollment docs do NOT carry per-child level (the
  // enrollment is at the program level), so it is derived here.
  //
  // Through `memberMatchesLevel`, the SAME predicate the teacher roster, the
  // family dashboard and the annual rollover use. This used to be a
  // `${pid}|${grade}` -> levelName map built from gradeBand alone, which cannot
  // express the rule for a shishu level: Shishu Vihar carries `gradeBand: []` and
  // is matched by AGE (18-60 months from birthMonthYear). So every shishu child
  // fell into "(no level)" here while the teacher roster placed them correctly -
  // 5 of the 27 enrolled children in production, reported 2026-08-05.
  const levelSnap = await db.collection('levels').get();

  // The monthly pledge IS the Bala Vihar donation, paid monthly (2026-07-27), so
  // this roster has to see it. ONE query for every pledging family, joined in
  // memory like every other signal here.
  //
  // This file is the ONLY data source behind /welcome/roster (see the route's
  // own comment). The pledge rework originally wired `family-engagement.ts`
  // instead, which has had no production caller since f754c61 retired the
  // paginated browse - so the screen welcome-team uses every day showed a
  // pledging family as "Registered"/"outstanding" permanently. Caught in review.
  const pledgedFids = await loadActivePledgeFids();
  const levelsByPid = new Map<string, LevelForMatch[]>();
  for (const d of levelSnap.docs) {
    const x = d.data() as { pid?: unknown; levelName?: unknown; levelKind?: unknown; programKey?: unknown; gradeBand?: unknown; enabled?: unknown };
    if (x.programKey !== BV_PROGRAM_KEY) continue;
    // A paused level must not place a child - the same exclusion
    // `fetchEnabledLevelsForPid` makes. `=== false` because the field is absent
    // on older level docs and absent means enabled.
    //
    // No effect on today's data, but NOT for the reason first written here: the
    // one disabled level (Scarborough "Parents") could never have matched
    // anyway, because every mid in `enrolledMids` is matched as a Child below
    // and a 'parents' level matches Adults only. Its empty gradeBand is
    // irrelevant to its own matching branch. The skip earns its place against
    // a future paused LEVEL, not against that one.
    if (x.enabled === false) continue;
    const pid = typeof x.pid === 'string' ? x.pid : '';
    const levelName = typeof x.levelName === 'string' ? x.levelName : '';
    if (!pid || !levelName) continue;
    // `levelKind` is required by LevelDoc and present on every level in both
    // projects - but it is now load-bearing in a way it was not before. The old
    // grade-band map was kind-blind, so a doc missing the field still placed
    // children by its band; `memberMatchesLevel` falls through to `return
    // false` on an unknown kind and places NOBODY. That is the safer direction
    // (never guess a child into a class), but it would be silent, so say it
    // out loud rather than let a level quietly empty itself.
    const levelKind = x.levelKind;
    if (levelKind !== 'level' && levelKind !== 'pre-level' && levelKind !== 'shishu' && levelKind !== 'parents') {
      console.warn(`[roster-report] level "${levelName}" (pid ${pid}) has no usable levelKind (${String(levelKind)}); it will place nobody`);
      continue;
    }
    const arr = levelsByPid.get(pid) ?? [];
    arr.push({
      levelName,
      levelKind,
      gradeBand: Array.isArray(x.gradeBand) ? x.gradeBand.map(String) : [],
    });
    levelsByPid.set(pid, arr);
  }
  // Bands within a pid are meant to be disjoint, and in production today they
  // are (audited 2026-08-05: no two enabled levels in either offering claim the
  // same normalized grade). But `memberMatchesLevel` normalizes both sides, so
  // an admin entering "3" on one level and "Grade 3" on another WOULD make both
  // match, and `.find()` would then be settled by document-id order - stable,
  // but arbitrary, and different from the order `fetchEnabledLevelsForPid`
  // happens to return for the family dashboard. Sorting by name makes the
  // winner the same on both surfaces and the same as a human reading the
  // levels list, so a data-entry mistake shows up as one consistently wrong
  // level rather than two screens naming different ones.
  for (const arr of levelsByPid.values()) arr.sort((a, b) => a.levelName.localeCompare(b.levelName));
  // One clock for the whole report, so two children of the same age cannot land
  // in different levels because the loop crossed a month boundary.
  const now = new Date();

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

    // A live monthly plan reads as paid on the chip, exactly as the family's own
    // dashboard and the teacher roster report it. Three surfaces, one answer.
    const payment = pledgedFids.has(fid)
      ? 'paid'
      : classifyBulkPayment(active, offerings, paidByFid.get(fid) ?? 0);

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
        // A mid with no member doc still gets a shot at a level from the
        // enrollment's own grade - and is treated as a Child, which is what
        // being in `enrolledMids` on a Bala Vihar enrollment means.
        const forMatch = {
          type: 'Child' as const,
          schoolGrade: grade || null,
          birthMonthYear: mem?.birthMonthYear ?? null,
        };
        const match = (levelsByPid.get(a.pid) ?? []).find((l) => memberMatchesLevel(forMatch, l, now));
        const levelName = match?.levelName ?? null;
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
      // NOTE: this is an inline reimplementation of `isEnrollmentConfirmed`
      // (kept for the bulk path). It must stay in step with that rule - the
      // pledge clause below is the second time the two have had to be updated
      // together, and the first time it was missed.
      const confirmed =
        pledgedFids.has(fid) ||
        activeBv.some((a) =>
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
      participating: m.participating ? 'yes' : 'no',
    }));

    out.push({ row, personRows });
  }
  return out;
}
