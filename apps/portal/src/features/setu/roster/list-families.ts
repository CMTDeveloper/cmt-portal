import 'server-only';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { RosterFamilyRow, RosterListResponse, RosterQuery } from '@cmt/shared-domain/setu';
import { deriveFamilyPayment } from './payment';

type RawFamily = {
  legacyFid?: unknown; name?: unknown; location?: unknown;
};

function nameOf(fid: string, d: RawFamily): string {
  return typeof d.name === 'string' && d.name ? d.name : fid;
}
function locationOf(d: RawFamily): string {
  return typeof d.location === 'string' && d.location ? d.location : 'Brampton';
}
function legacyOf(d: RawFamily): string | null {
  return typeof d.legacyFid === 'string' ? d.legacyFid : null;
}

const PROGRAM_FAMILY_CHUNK = 300;

async function activeProgramLabels(fid: string): Promise<string[]> {
  // Active program labels for the chip/CSV. Bounded read per family.
  const snap = await portalFirestore()
    .collection('families').doc(fid).collection('enrollments')
    .where('status', '==', 'active').get();
  return [...new Set(snap.docs.map((e) => String((e.data() as { programLabel?: unknown }).programLabel ?? '')).filter(Boolean))];
}

async function toRow(fid: string, d: RawFamily): Promise<RosterFamilyRow> {
  const db = portalFirestore();
  const [memberSnap, payment, programs] = await Promise.all([
    db.collection('families').doc(fid).collection('members').limit(100).get(),
    deriveFamilyPayment(fid),
    activeProgramLabels(fid),
  ]);
  return {
    fid,
    legacyFid: legacyOf(d),
    name: nameOf(fid, d),
    location: locationOf(d),
    memberCount: memberSnap.docs.length,
    payment,
    programs,
  };
}

export async function listRosterFamilies(params: RosterQuery): Promise<RosterListResponse> {
  const db = portalFirestore();
  const familiesCol = db.collection('families');
  const limit = params.limit ?? 50;

  // --- Program filter: in-memory intersect path ---
  if (params.program) {
    const enrSnap = await db
      .collectionGroup('enrollments')
      .where('programKey', '==', params.program)
      .where('status', '==', 'active')
      .get();
    const fids = [...new Set(enrSnap.docs.map((e) => String((e.data() as { fid?: unknown }).fid ?? '')).filter(Boolean))];

    const docs: Array<{ fid: string; data: RawFamily }> = [];
    for (let i = 0; i < fids.length; i += PROGRAM_FAMILY_CHUNK) {
      const refs = fids.slice(i, i + PROGRAM_FAMILY_CHUNK).map((f) => familiesCol.doc(f));
      const got = await db.getAll(...refs);
      for (const snap of got) {
        if (!snap.exists) continue;
        const data = snap.data() as RawFamily;
        if (params.location && locationOf(data) !== params.location) continue;
        docs.push({ fid: snap.id, data });
      }
    }
    docs.sort((a, b) => {
      const c = nameOf(a.fid, a.data).localeCompare(nameOf(b.fid, b.data));
      return c !== 0 ? c : a.fid.localeCompare(b.fid);
    });
    let startIdx = 0;
    if (params.cursor) {
      const idx = docs.findIndex((x) => x.fid === params.cursor);
      // Stale/invalid cursor (family left the program/location set, or a
      // hand-edited cursor): return a terminal empty page rather than silently
      // rewinding to page 1 (which could make a paging consumer loop).
      if (idx < 0) return { families: [], nextCursor: null, total: null };
      startIdx = idx + 1;
    }
    const slice = docs.slice(startIdx, startIdx + limit);
    const families = await Promise.all(slice.map((x) => toRow(x.fid, x.data)));
    const lastFid = slice.at(-1)?.fid ?? null;
    const nextCursor = startIdx + limit < docs.length ? lastFid : null;
    return { families, nextCursor, total: params.cursor ? null : docs.length };
  }

  // --- No program filter: Firestore-ordered cursor path ---
  // Apply the equality filter first, THEN a single orderBy('name'). Calling
  // orderBy('name') twice (e.g. once before and once after where) makes the
  // real Admin SDK throw "you cannot specify the same field multiple times in
  // the order by clause" — so the where + single orderBy must be composed in
  // this order. The (location, name) composite index backs the filtered case
  // (see Task 8).
  let query = params.location
    ? familiesCol.where('location', '==', params.location).orderBy('name')
    : familiesCol.orderBy('name');
  if (params.cursor) {
    const curDoc = await familiesCol.doc(params.cursor).get();
    if (curDoc.exists) query = query.startAfter(curDoc);
  }
  const snap = await query.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const pageDocs = snap.docs.slice(0, limit);
  const families = await Promise.all(pageDocs.map((doc) => toRow(doc.id, doc.data() as RawFamily)));
  const nextCursor = hasMore ? (pageDocs.at(-1)?.id ?? null) : null;

  let total: number | null = null;
  if (!params.cursor) {
    const countQuery = params.location ? familiesCol.where('location', '==', params.location) : familiesCol;
    total = (await countQuery.count().get()).data().count;
  }
  return { families, nextCursor, total };
}
