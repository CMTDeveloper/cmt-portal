import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { torontoToday } from './constants';
import { getCurrentPrasadPeriods } from './current-periods';

/** One manager contact for a family on a prasad Sunday. Null parts are kept so the UI can omit them. */
export interface PrasadContact {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface PrasadFamily {
  fid: string;
  familyName: string;
  status: 'proposed' | 'assigned';
  contacts: PrasadContact[];
}

export interface PrasadSunday {
  date: string; // YYYY-MM-DD
  families: PrasadFamily[];
}

export interface PrasadLocation {
  location: string;
  sundays: PrasadSunday[];
}

export interface UpcomingPrasadResponse {
  locations: PrasadLocation[];
}

const SUNDAYS_PER_LOCATION = 4;
// Pull a generous window per period (status isn't in the (pid,date) index, so
// cancelled/moved rows still count toward the limit — 60 comfortably covers the
// first 4 future Sundays of assigned/proposed families per location).
const QUERY_LIMIT = 60;

/**
 * "Who's bringing prasad this/next Sunday + how to reach them" for the welcome
 * team. For each current prasad period: read upcoming assignments (backed
 * by the (pid,date) index), keep assigned + proposed (confirmed first;
 * cancelled/moved-out rows excluded), group by date, take the first 4 dates,
 * then join each family's manager contacts (bulk per-fid fetch).
 */
export async function getUpcomingPrasad(): Promise<UpcomingPrasadResponse> {
  const db = portalFirestore();
  const todayYmd = torontoToday();

  const locations: PrasadLocation[] = [];
  // Collect every unique fid across all kept Sundays so manager contacts are
  // fetched exactly once per family (bounded fan-out via Promise.all).
  const fids = new Set<string>();
  // Intermediate: per-location grouped dates (fids only) before the contact join.
  const grouped: Array<{ location: string; sundays: Array<{ date: string; rows: Array<{ fid: string; familyName: string; status: 'proposed' | 'assigned' }> }> }> = [];

  for (const { pid, location } of await getCurrentPrasadPeriods(db)) {
    const snap = await db.collection('prasadAssignments')
      .where('pid', '==', pid)
      .where('date', '>=', todayYmd)
      .orderBy('date', 'asc')
      .limit(QUERY_LIMIT)
      .get();

    // status isn't part of the index ordering — filter in memory.
    const kept = snap.docs
      .map((d) => d.data() as { fid?: string; familyName?: string; date?: string; status?: string })
      .filter((a) => (a.status === 'assigned' || a.status === 'proposed') && typeof a.fid === 'string' && typeof a.date === 'string');

    // Group by date, preserving the (date asc) order; take the first 4 dates.
    const byDate = new Map<string, Array<{ fid: string; familyName: string; status: 'proposed' | 'assigned' }>>();
    for (const a of kept) {
      const list = byDate.get(a.date!) ?? [];
      list.push({ fid: a.fid!, familyName: a.familyName ?? a.fid!, status: a.status as 'proposed' | 'assigned' });
      byDate.set(a.date!, list);
    }
    const sundays = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, SUNDAYS_PER_LOCATION)
      .map(([date, rows]) => {
        // Confirmed first within each Sunday (stable, so the per-date order holds otherwise).
        rows.sort((x, y) => (x.status === y.status ? 0 : x.status === 'assigned' ? -1 : 1));
        return { date, rows };
      });

    for (const s of sundays) for (const r of s.rows) fids.add(r.fid);
    grouped.push({ location, sundays });
  }

  // Bulk-fetch manager contacts once per unique fid.
  const contactsByFid = new Map<string, PrasadContact[]>();
  await Promise.all([...fids].map(async (fid) => {
    const memSnap = await db.collection('families').doc(fid)
      .collection('members').where('manager', '==', true).get();
    const contacts = memSnap.docs.map((m) => {
      const mem = m.data() as { firstName?: string; lastName?: string; email?: string | null; phone?: string | null };
      const name = `${mem.firstName ?? ''} ${mem.lastName ?? ''}`.trim() || fid;
      return { name, email: mem.email ?? null, phone: mem.phone ?? null };
    });
    contactsByFid.set(fid, contacts);
  }));

  for (const g of grouped) {
    locations.push({
      location: g.location,
      sundays: g.sundays.map((s) => ({
        date: s.date,
        families: s.rows.map((r) => ({
          fid: r.fid,
          familyName: r.familyName,
          status: r.status,
          contacts: contactsByFid.get(r.fid) ?? [],
        })),
      })),
    });
  }

  return { locations };
}
