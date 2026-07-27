import 'server-only';
import { BALA_VIHAR, levelGradeSummary, sessionDateFor } from '@cmt/shared-domain';
import { getOpenOfferings } from '@/features/setu/enrollment/get-open-offerings';
import { fetchEnabledLevelsForPid } from '@/features/setu/enrollment/derive-child-level';
import {
  readDoorGuestCheckIns,
  readPortalGuestChildren,
  type DoorGuestChild,
} from '@/features/setu/attendance/check-in-attendance';
import { guestMatchesLevel } from './visitors';

export interface VisitorLevelGroup {
  levelId: string;
  levelName: string;
  ageLabel: string;
  location: string | null;
  children: DoorGuestChild[];
}

export interface AllVisitorsView {
  date: string;
  /** Only classes with at least one visitor. Ordered by centre, then class. */
  groups: VisitorLevelGroup[];
  /** Checked in, but their grade matches no enabled class. Never dropped. */
  unmatched: DoorGuestChild[];
  /** DISTINCT children, however many classes each one matches. */
  childCount: number;
}

/**
 * Every door guest for a date, grouped by the class their grade matches, across
 * ALL centres. The welcome-team's whole-day view; the teacher's own
 * `getLevelVisitorsView` covers one level and adds per-child confirmation state.
 *
 * ── Read budget ──────────────────────────────────────────────────────────────
 * The guest sources are read ONCE for the day, not once per level. Calling
 * `getLevelVisitorsView` in a loop would have multiplied a genuine per-family
 * fan-out by the level count: it lists every `guest-families` doc and point-reads
 * `checkIns/{date}` for each, then does a `contactKeys` get per matched child.
 * Here that cost is paid once, and the only per-level work is an in-memory
 * grade match. The offerings query is one indexed read and the level reads are
 * bounded by the number of open Bala Vihar offerings (two in practice, one per
 * centre), which is the "level-scoped bounded read" the roster fan-out rule
 * explicitly permits.
 *
 * Deliberately does NOT carry `alreadyConfirmed`. That is the per-child
 * `contactKeys` read, and it is the teacher's question on their own level page,
 * not the desk's on an overview.
 *
 * ── Why every offering, not one ──────────────────────────────────────────────
 * Bala Vihar runs as one offering PER CENTRE - `balaViharSourceOidsForYear`
 * returns `bv-brampton-*` AND `bv-scarborough-*` by construction - and
 * `fetchEnabledLevelsForPid` is scoped to a single pid. Every existing caller of
 * it is family-scoped, bound to that family's own centre, so a single oid is
 * correct there and wrong here: it would silently omit an entire centre's
 * classes from a page whose purpose is showing every visitor.
 *
 * `location` is OMITTED from the offerings query rather than passed as null.
 * `getOpenOfferings` treats the two differently - undefined means no location
 * filter, null means location-less offerings ONLY, which would match nothing
 * since every Bala Vihar offering is bound to a centre.
 */
export async function getAllVisitorsView(date: string): Promise<AllVisitorsView> {
  const [legacyDoor, portalDoor, offerings] = await Promise.all([
    // The legacy door keeps its own raw calendar-day key; portal guest docs are
    // keyed to the week's Sunday. Passing the same string to both would make one
    // of them match nothing on any midweek date.
    readDoorGuestCheckIns(date),
    readPortalGuestChildren(sessionDateFor(date)),
    getOpenOfferings({ programKey: BALA_VIHAR }),
  ]);

  const children = [...legacyDoor, ...portalDoor];

  const levelSets = await Promise.all(
    offerings.map(async (offering) => ({
      location: offering.location,
      levels: await fetchEnabledLevelsForPid(offering.oid),
    })),
  );

  // Matched-ness is tracked by INDEX, not by a name/email key: two siblings can
  // share a parent email, and two unrelated guests can share a name, so a value
  // key would wrongly mark one child matched because another one was.
  const matched = new Set<number>();
  const groups: VisitorLevelGroup[] = [];

  for (const { location, levels } of levelSets) {
    for (const level of levels) {
      const inLevel: DoorGuestChild[] = [];
      children.forEach((c, i) => {
        if (!guestMatchesLevel(c, level)) return;
        matched.add(i);
        inLevel.push(c);
      });
      // An overview listing every empty class is noise; the desk wants the ones
      // that actually have someone in them.
      if (inLevel.length === 0) continue;
      groups.push({
        levelId: level.levelId,
        levelName: level.levelName,
        ageLabel: levelGradeSummary(level),
        location,
        children: inLevel,
      });
    }
  }

  groups.sort(
    (a, b) =>
      (a.location ?? '').localeCompare(b.location ?? '') || a.levelName.localeCompare(b.levelName),
  );

  return {
    date,
    groups,
    unmatched: children.filter((_, i) => !matched.has(i)),
    // `children.length`, not the sum of group sizes: a child whose grade matches
    // a class at both centres appears in two groups but walked in once.
    childCount: children.length,
  };
}
