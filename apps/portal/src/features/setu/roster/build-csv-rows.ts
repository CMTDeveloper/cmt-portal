import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { resolveSuggestedAmount } from '@cmt/shared-domain';
import type { OfferingDoc, RosterPersonCsvRow } from '@cmt/shared-domain';
import { paymentFromAmounts } from './payment';

const EXPORT_FAMILY_CAP = 2000;
const OFFERING_CHUNK = 300;

function toDate(v: unknown): Date {
  if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  return v instanceof Date ? v : new Date(v as string);
}

export async function buildRosterCsvRows(filters: { location?: string; program?: string }): Promise<RosterPersonCsvRow[]> {
  const db = portalFirestore();

  // 1) families (optional location filter) → meta
  let famQuery: FirebaseFirestore.Query = db.collection('families');
  if (filters.location) famQuery = famQuery.where('location', '==', filters.location);
  const famSnap = await famQuery.get();
  const meta = new Map<string, { name: string; location: string; legacyFid: string }>();
  for (const d of famSnap.docs) {
    const x = d.data() as { name?: unknown; location?: unknown; legacyFid?: unknown };
    meta.set(d.id, {
      name: typeof x.name === 'string' && x.name ? x.name : d.id,
      location: typeof x.location === 'string' && x.location ? x.location : 'Brampton',
      legacyFid: typeof x.legacyFid === 'string' ? x.legacyFid : '',
    });
  }

  // 2) ALL members (one unfiltered collectionGroup read; group by parent fid)
  const memberSnap = await db.collectionGroup('members').get();
  const membersByFid = new Map<string, Array<{ firstName: string; lastName: string; type: string; grade: string }>>();
  for (const m of memberSnap.docs) {
    const fid = m.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const d = m.data() as { firstName?: unknown; lastName?: unknown; type?: unknown; schoolGrade?: unknown };
    const arr = membersByFid.get(fid) ?? [];
    arr.push({
      firstName: String(d.firstName ?? ''),
      lastName: String(d.lastName ?? ''),
      type: String(d.type ?? ''),
      grade: typeof d.schoolGrade === 'string' ? d.schoolGrade : '',
    });
    membersByFid.set(fid, arr);
  }

  // 3) ALL enrollments (one unfiltered read; keep active only, group by fid)
  const enrSnap = await db.collectionGroup('enrollments').get();
  type ActiveEnr = { oid: string; programKey: string; programLabel: string; snapshot: number; override: number | null; enrolledAt: Date };
  const activeByFid = new Map<string, ActiveEnr[]>();
  for (const e of enrSnap.docs) {
    const d = e.data() as Record<string, unknown>;
    if (d['status'] !== 'active') continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : e.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const arr = activeByFid.get(fid) ?? [];
    arr.push({
      oid: String(d['oid'] ?? ''),
      programKey: String(d['programKey'] ?? ''),
      programLabel: String(d['programLabel'] ?? ''),
      snapshot: typeof d['suggestedAmountSnapshot'] === 'number' ? (d['suggestedAmountSnapshot'] as number) : 0,
      override: typeof d['suggestedAmountOverride'] === 'number' ? (d['suggestedAmountOverride'] as number) : null,
      enrolledAt: toDate(d['enrolledAt']),
    });
    activeByFid.set(fid, arr);
  }

  // 4) ALL completed donations (one unfiltered read; sum by fid)
  const donSnap = await db.collectionGroup('donations').get();
  const paidByFid = new Map<string, number>();
  for (const dd of donSnap.docs) {
    const d = dd.data() as Record<string, unknown>;
    if (d['status'] !== 'completed') continue;
    const fid = typeof d['fid'] === 'string' ? (d['fid'] as string) : dd.ref.parent.parent?.id;
    if (!fid || !meta.has(fid)) continue;
    const amt = typeof d['amountCAD'] === 'number' ? (d['amountCAD'] as number) : 0;
    paidByFid.set(fid, (paidByFid.get(fid) ?? 0) + amt);
  }

  // 5) offerings for the active enrollments (batched getAll) → live effective amount
  const oids = [...new Set([...activeByFid.values()].flat().map((a) => a.oid).filter(Boolean))];
  const offerings = new Map<string, OfferingDoc>();
  for (let i = 0; i < oids.length; i += OFFERING_CHUNK) {
    const refs = oids.slice(i, i + OFFERING_CHUNK).map((o) => db.collection('offerings').doc(o));
    const got = await db.getAll(...refs);
    for (const snap of got) if (snap.exists) offerings.set(snap.id, snap.data() as OfferingDoc);
  }

  // 6) fid set (program filter intersect), sorted by name, capped
  let fids = [...meta.keys()];
  if (filters.program) {
    fids = fids.filter((fid) => (activeByFid.get(fid) ?? []).some((a) => a.programKey === filters.program));
  }
  fids.sort((a, b) => {
    const c = meta.get(a)!.name.localeCompare(meta.get(b)!.name);
    return c !== 0 ? c : a.localeCompare(b);
  });
  if (fids.length > EXPORT_FAMILY_CAP) {
    console.warn(`roster CSV: capped at ${EXPORT_FAMILY_CAP} families; dropped ${fids.length - EXPORT_FAMILY_CAP}`);
    fids = fids.slice(0, EXPORT_FAMILY_CAP);
  }

  // 7) build one row per member
  const rows: RosterPersonCsvRow[] = [];
  for (const fid of fids) {
    const fam = meta.get(fid)!;
    const active = activeByFid.get(fid) ?? [];
    const programs = [...new Set(active.map((a) => a.programLabel).filter(Boolean))].join('; ');
    const expected = active.reduce((sum, a) => {
      const off = offerings.get(a.oid) ?? null;
      const eff = a.override ?? (off ? resolveSuggestedAmount(off, a.enrolledAt) : a.snapshot);
      return sum + (eff ?? 0);
    }, 0);
    const payment = paymentFromAmounts(active.length, expected, paidByFid.get(fid) ?? 0);
    for (const m of membersByFid.get(fid) ?? []) {
      rows.push({
        familyName: fam.name, fid, legacyFid: fam.legacyFid,
        memberName: `${m.firstName} ${m.lastName}`.trim(),
        type: m.type, grade: m.grade, level: '', location: fam.location, programs, payment,
      });
    }
  }
  return rows;
}
