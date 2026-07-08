/**
 * Seed a Bala Vihar class calendar + weekly schedule for a school year, replacing
 * the per-year PDF. Admin/welcome-team edit via /admin/calendar afterward.
 * Idempotent (set()). UAT by default; refuses prod unless --allow-prod.
 *
 *   --year <YYYY-YY>       which year's transcription to seed (default 2026-27)
 *   --location <name|all>  Brampton | Scarborough | all  (default Brampton)
 *   --admin-mtg            surface "Teacher's Admin Meeting" as a specialEvent
 *                          on the flagged Sundays (default: omitted — internal note)
 *   --dry-run              print, write nothing
 *   --allow-prod           permit writing to prod 715b8 (never use here)
 *
 * Usage: pnpm --filter @cmt/portal seed:bala-vihar-calendar -- --year 2026-27 --dry-run
 *
 * Source transcriptions:
 *   2025-26 — "BV Calendar Brampton 2025-26.pdf" (Brampton/West).
 *   2026-27 — "CMT 2026-27 levels and classes.xlsx" → "Class Dates" tab.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { calendarEntryId, LOCATIONS, type CalendarKind, type ClassType, type Location } from '@cmt/shared-domain';

interface Args {
  year: string;
  locations: Location[];
  adminMtg: boolean;
  dryRun: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const val = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const year = val('--year') ?? '2026-27';
  const locArg = (val('--location') ?? 'Brampton').trim();
  let locations: Location[];
  if (locArg.toLowerCase() === 'all') {
    locations = ['Brampton', 'Scarborough'];
  } else if ((LOCATIONS as readonly string[]).includes(locArg)) {
    locations = [locArg as Location];
  } else {
    console.error(`--location must be one of Brampton|Scarborough|all (got "${locArg}")`);
    process.exit(1);
  }
  return {
    year,
    locations,
    adminMtg: argv.includes('--admin-mtg'),
    dryRun: argv.includes('--dry-run'),
    allowProd: argv.includes('--allow-prod'),
  };
}

interface EntrySeed {
  date: string; // YYYY-MM-DD (Toronto class Sunday)
  kind: CalendarKind;
  classType: ClassType | null;
  noClassReason: string | null;
  specialEvents: string | null;
  /** Sheet-flagged "Teacher's Admin Mtg" day — surfaced only with --admin-mtg. */
  adminMtg?: boolean;
}

const c = (
  date: string,
  classType: ClassType,
  opts: { specialEvents?: string | null; adminMtg?: boolean } = {},
): EntrySeed => ({
  date,
  kind: 'class',
  classType,
  noClassReason: null,
  specialEvents: opts.specialEvents ?? null,
  adminMtg: opts.adminMtg ?? false,
});
const nc = (date: string, reason: string, specialEvents: string | null = null): EntrySeed => ({
  date, kind: 'no-class', classType: null, noClassReason: reason, specialEvents,
});

// Brampton (West) 2025-26 — Fall + Winter/Spring semesters, from the PDF.
const ENTRIES_2025_26: EntrySeed[] = [
  c('2025-09-07', 'first', { specialEvents: 'Ganesh Puja and Visarjan' }),
  c('2025-09-14', 'regular', { specialEvents: 'Pitr Paksh' }),
  c('2025-09-21', 'regular', { specialEvents: 'Navaratri, Swami Ramakrishnananda Ji Yagna' }),
  c('2025-09-28', 'regular'),
  c('2025-10-05', 'regular'),
  nc('2025-10-12', 'Thanksgiving Weekend'),
  c('2025-10-19', 'regular', { specialEvents: 'Parent Teacher Meetings' }),
  nc('2025-10-26', 'CMT Diwali Celebrations at the Ashram'),
  c('2025-11-02', 'regular', { specialEvents: 'Hindu Heritage Month Begins' }),
  c('2025-11-09', 'regular', { specialEvents: 'Swami Prakashanandaji Yajna (Nov 10 to 16)' }),
  c('2025-11-16', 'regular'),
  c('2025-11-23', 'regular'),
  c('2025-11-30', 'regular', { specialEvents: 'Hindu Heritage Month Culmination, Brahmacharini Shubhani ji’s Visit (Nov 28 to 30)' }),
  c('2025-12-07', 'regular', { specialEvents: 'CMT Gita Jayanti at the Ashram (Dec 6)' }),
  c('2025-12-14', 'regular'),
  c('2025-12-21', 'regular'),
  nc('2025-12-28', 'Winter Break'),
  c('2026-01-04', 'regular'),
  c('2026-01-11', 'regular'),
  c('2026-01-18', 'regular'),
  c('2026-01-25', 'regular', { specialEvents: 'Level 3/4 Sleepover (TBC)' }),
  c('2026-02-01', 'regular'),
  c('2026-02-08', 'regular'),
  nc('2026-02-15', 'Family Day Weekend', 'Mahashivratri'),
  c('2026-02-22', 'regular', { specialEvents: 'Chinmaya Chess Championship (TBD), Chai, Chaat and Chat (Adult Social)' }),
  c('2026-03-01', 'regular', { specialEvents: 'Holi (March 4)' }),
  c('2026-03-08', 'regular'),
  nc('2026-03-15', 'March Break'),
  c('2026-03-22', 'regular', { specialEvents: 'Ram Navami (March 26), Hanuman Jayanti (March 31)' }),
  c('2026-03-29', 'regular'),
  nc('2026-04-05', 'Easter Weekend'),
  c('2026-04-12', 'regular'),
  c('2026-04-19', 'regular'),
  c('2026-04-26', 'regular', { specialEvents: 'Gita Chanting Competition' }),
  c('2026-05-03', 'regular', { specialEvents: 'Chinmaya Jayanti (May 8)' }),
  c('2026-05-10', 'regular', { specialEvents: "Mother's Day Puja" }),
  nc('2026-05-17', 'Victoria Day Weekend'),
  c('2026-05-24', 'regular'),
  c('2026-05-31', 'regular', { specialEvents: 'Showcase - All Levels' }),
  c('2026-06-07', 'regular', { specialEvents: 'BV Graduation' }),
  c('2026-06-14', 'short', { specialEvents: 'Father’s Day Assembly, Music Showcase, Gita Chanting Awards, BV Picnic' }),
];

// 2026-27 — "CMT 2026-27 levels and classes.xlsx" → "Class Dates" tab (32 class
// Sundays + 8 no-class). The sheet is a single unified schedule (no location
// column); which location(s) it seeds is chosen with --location. "Teacher's
// Admin Mtg" days are flagged adminMtg — shown as a specialEvent only with
// --admin-mtg. Sat Jun 19 (Teacher's Retreat) is a Saturday, not a class Sunday,
// so it is intentionally NOT a calendar entry.
const ENTRIES_2026_27: EntrySeed[] = [
  c('2026-09-13', 'first'),                        // #1 First Regular Bala Vihar Class
  c('2026-09-20', 'regular'),                      // #2
  c('2026-09-27', 'regular'),                      // #3
  c('2026-10-04', 'regular', { adminMtg: true }),  // #4
  nc('2026-10-11', 'Thanksgiving'),
  c('2026-10-18', 'regular'),                      // #5
  c('2026-10-25', 'regular'),                      // #6
  c('2026-11-01', 'regular', { adminMtg: true }),  // #7
  c('2026-11-08', 'regular'),                      // #8
  nc('2026-11-15', 'CMT Diwali'),
  c('2026-11-22', 'regular'),                      // #9
  c('2026-11-29', 'regular'),                      // #10
  c('2026-12-06', 'regular'),                      // #11
  c('2026-12-13', 'regular', { adminMtg: true }),  // #12
  c('2026-12-20', 'regular'),                      // #13
  nc('2026-12-27', 'Winter Break'),
  nc('2027-01-03', 'Winter Break'),
  c('2027-01-10', 'regular'),                      // #14
  c('2027-01-17', 'regular', { adminMtg: true }),  // #15
  c('2027-01-24', 'regular'),                      // #16
  c('2027-01-31', 'regular'),                      // #17
  c('2027-02-07', 'regular', { adminMtg: true }),  // #18
  c('2027-02-14', 'regular'),                      // #19
  nc('2027-02-21', 'Family Day Weekend'),
  c('2027-02-28', 'regular'),                      // #20
  c('2027-03-07', 'regular'),                      // #21
  c('2027-03-14', 'regular', { adminMtg: true }),  // #22
  nc('2027-03-21', 'March Break'),
  nc('2027-03-28', 'Easter'),
  c('2027-04-04', 'regular', { adminMtg: true }),  // #23
  c('2027-04-11', 'regular'),                      // #24
  c('2027-04-18', 'regular'),                      // #25
  c('2027-04-25', 'regular'),                      // #26
  c('2027-05-02', 'regular'),                      // #27
  c('2027-05-09', 'regular', { adminMtg: true }),  // #28
  c('2027-05-16', 'regular'),                      // #29
  nc('2027-05-23', 'Victoria Day Weekend'),
  c('2027-05-30', 'regular'),                      // #30
  c('2027-06-06', 'regular', { adminMtg: true }),  // #31
  c('2027-06-13', 'short'),                        // #32 Last class (short)
];

const ENTRIES_BY_YEAR: Record<string, EntrySeed[]> = {
  '2025-26': ENTRIES_2025_26,
  '2026-27': ENTRIES_2026_27,
};

// Brampton (West) weekly time header — the only schedule we have transcribed.
// Scarborough (East) times aren't in the sheet, so we don't overwrite them.
const WEEKLY_ROWS_BY_LOCATION: Partial<Record<Location, { time: string; label: string }[]>> = {
  Brampton: [
    { time: '10:00 – 10:45 am', label: 'Assembly' },
    { time: '10:30 – 12:00 pm', label: 'All Classes' },
    { time: '12:15 – 1:15 pm', label: 'Tabla & Vocals' },
  ],
};

/** Family-facing specialEvents string: base note, plus admin-mtg when opted in. */
function resolveSpecialEvents(e: EntrySeed, adminMtgOptIn: boolean): string | null {
  const parts: string[] = [];
  if (e.specialEvents) parts.push(e.specialEvents);
  if (e.adminMtg && adminMtgOptIn) parts.push("Teacher's Admin Meeting");
  return parts.length ? parts.join(', ') : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  if (!projectId) {
    console.error('PORTAL_FIREBASE_PROJECT_ID is not set. Is .env.local loaded?');
    process.exit(1);
  }
  if (projectId === 'chinmaya-setu-715b8' && !args.allowProd) {
    console.error(`Refusing to write to prod (${projectId}) without --allow-prod.`);
    process.exit(1);
  }

  const entries = ENTRIES_BY_YEAR[args.year];
  if (!entries) {
    console.error(`No transcription for --year ${args.year}. Known: ${Object.keys(ENTRIES_BY_YEAR).join(', ')}`);
    process.exit(1);
  }

  console.log(
    `Target: ${projectId} | year ${args.year} | locations ${args.locations.join(', ')} | ` +
      `admin-mtg ${args.adminMtg ? 'shown' : 'omitted'}${args.dryRun ? ' [DRY RUN]' : ''}`,
  );
  const db = getFirestore(getPortalApp());
  const systemUid = 'seed-script';
  const now = Timestamp.now();

  for (const location of args.locations) {
    console.log(`\n— ${location} —`);
    for (const e of entries) {
      const entryId = calendarEntryId('bala-vihar', location, e.date);
      const specialEvents = resolveSpecialEvents(e, args.adminMtg);
      if (args.dryRun) {
        const tag = e.kind === 'class' ? e.classType : `no-class (${e.noClassReason})`;
        console.log(`  [dry-run] ${entryId} — ${tag}${specialEvents ? ` · ${specialEvents}` : ''}`);
        continue;
      }
      try {
        await db.collection('classCalendarEntries').doc(entryId).set({
          entryId,
          programKey: 'bala-vihar',
          location,
          date: e.date,
          kind: e.kind,
          classType: e.classType,
          noClassReason: e.noClassReason,
          specialEvents,
          enabled: true,
          prasadNeeded: e.kind === 'class', // prasad only applies to class Sundays
          createdAt: now,
          createdBy: systemUid,
          updatedAt: now,
          updatedBy: systemUid,
        });
        console.log(`  ✔ ${entryId}`);
      } catch (err) {
        console.error(`  ✘ ${entryId}:`, err);
      }
    }

    const weeklyRows = WEEKLY_ROWS_BY_LOCATION[location];
    if (weeklyRows && !args.dryRun) {
      await db.collection('weeklySchedules').doc(location).set({
        location,
        rows: weeklyRows,
        updatedAt: now,
        updatedBy: systemUid,
      });
      console.log(`  ✔ weekly schedule (${location})`);
    } else if (!weeklyRows) {
      console.log(`  · no weekly schedule transcribed for ${location} — left untouched`);
    }
  }

  console.log(`\nDone. ${entries.length} entries × ${args.locations.length} location(s)${args.dryRun ? ' [DRY RUN]' : ''}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
