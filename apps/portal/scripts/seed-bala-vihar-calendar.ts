/**
 * Slice 4b — Seed the Bala Vihar (Brampton/West) 2025-26 class calendar +
 * weekly schedule, transcribed from "BV Calendar Brampton 2025-26.pdf".
 * Replaces the per-year PDF; admin/welcome-team edit via /admin/calendar.
 * Idempotent (set()). UAT by default; refuses prod unless --allow-prod.
 *
 * Usage: pnpm --filter @cmt/portal seed:bala-vihar-calendar [-- --dry-run]
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { calendarEntryId, type CalendarKind, type ClassType } from '@cmt/shared-domain';

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes('--dry-run'), allowProd: argv.includes('--allow-prod') };
}

const LOCATION = 'Brampton';

interface EntrySeed {
  date: string; // YYYY-MM-DD (Toronto class Sunday)
  kind: CalendarKind;
  classType: ClassType | null;
  noClassReason: string | null;
  specialEvents: string | null;
}

const c = (date: string, classType: ClassType, specialEvents: string | null = null): EntrySeed => ({
  date, kind: 'class', classType, noClassReason: null, specialEvents,
});
const nc = (date: string, reason: string, specialEvents: string | null = null): EntrySeed => ({
  date, kind: 'no-class', classType: null, noClassReason: reason, specialEvents,
});

// Brampton (West) 2025-26 — Fall + Winter/Spring semesters, from the PDF.
const ENTRIES: EntrySeed[] = [
  c('2025-09-07', 'first', 'Ganesh Puja and Visarjan'),
  c('2025-09-14', 'regular', 'Pitr Paksh'),
  c('2025-09-21', 'regular', 'Navaratri, Swami Ramakrishnananda Ji Yagna'),
  c('2025-09-28', 'regular'),
  c('2025-10-05', 'regular'),
  nc('2025-10-12', 'Thanksgiving Weekend'),
  c('2025-10-19', 'regular', 'Parent Teacher Meetings'),
  nc('2025-10-26', 'CMT Diwali Celebrations at the Ashram'),
  c('2025-11-02', 'regular', 'Hindu Heritage Month Begins'),
  c('2025-11-09', 'regular', 'Swami Prakashanandaji Yajna (Nov 10 to 16)'),
  c('2025-11-16', 'regular'),
  c('2025-11-23', 'regular'),
  c('2025-11-30', 'regular', 'Hindu Heritage Month Culmination, Brahmacharini Shubhani ji’s Visit (Nov 28 to 30)'),
  c('2025-12-07', 'regular', 'CMT Gita Jayanti at the Ashram (Dec 6)'),
  c('2025-12-14', 'regular'),
  c('2025-12-21', 'regular'),
  nc('2025-12-28', 'Winter Break'),
  c('2026-01-04', 'regular'),
  c('2026-01-11', 'regular'),
  c('2026-01-18', 'regular'),
  c('2026-01-25', 'regular', 'Level 3/4 Sleepover (TBC)'),
  c('2026-02-01', 'regular'),
  c('2026-02-08', 'regular'),
  nc('2026-02-15', 'Family Day Weekend', 'Mahashivratri'),
  c('2026-02-22', 'regular', 'Chinmaya Chess Championship (TBD), Chai, Chaat and Chat (Adult Social)'),
  c('2026-03-01', 'regular', 'Holi (March 4)'),
  c('2026-03-08', 'regular'),
  nc('2026-03-15', 'March Break'),
  c('2026-03-22', 'regular', 'Ram Navami (March 26), Hanuman Jayanti (March 31)'),
  c('2026-03-29', 'regular'),
  nc('2026-04-05', 'Easter Weekend'),
  c('2026-04-12', 'regular'),
  c('2026-04-19', 'regular'),
  c('2026-04-26', 'regular', 'Gita Chanting Competition'),
  c('2026-05-03', 'regular', 'Chinmaya Jayanti (May 8)'),
  c('2026-05-10', 'regular', "Mother's Day Puja"),
  nc('2026-05-17', 'Victoria Day Weekend'),
  c('2026-05-24', 'regular'),
  c('2026-05-31', 'regular', 'Showcase - All Levels'),
  c('2026-06-07', 'regular', 'BV Graduation'),
  c('2026-06-14', 'short', 'Father’s Day Assembly, Music Showcase, Gita Chanting Awards, BV Picnic'),
];

const WEEKLY_ROWS = [
  { time: '10:00 – 10:45 am', label: 'Assembly' },
  { time: '10:30 – 12:00 pm', label: 'All Classes' },
  { time: '12:15 – 1:15 pm', label: 'Tabla & Vocals' },
];

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

  console.log(`Target project: ${projectId}${args.dryRun ? ' [DRY RUN]' : ''}`);
  const db = getFirestore(getPortalApp());
  const systemUid = 'seed-script';
  const now = Timestamp.now();

  for (const e of ENTRIES) {
    const entryId = calendarEntryId(LOCATION, e.date);
    if (args.dryRun) {
      console.log(`[dry-run] ${entryId} — ${e.kind}${e.noClassReason ? ` (${e.noClassReason})` : ''}`);
      continue;
    }
    try {
      await db.collection('classCalendarEntries').doc(entryId).set({
        entryId,
        programKey: 'bala-vihar',
        location: LOCATION,
        date: e.date,
        kind: e.kind,
        classType: e.classType,
        noClassReason: e.noClassReason,
        specialEvents: e.specialEvents,
        enabled: true,
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

  if (!args.dryRun) {
    await db.collection('weeklySchedules').doc(LOCATION).set({
      location: LOCATION,
      rows: WEEKLY_ROWS,
      updatedAt: now,
      updatedBy: systemUid,
    });
    console.log('  ✔ weekly schedule');
  }

  console.log(`Done. ${ENTRIES.length} entries processed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
