import { calendarEntryId, type CalendarCopyResult } from '@cmt/shared-domain';
import { FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { schoolYearDateRange } from './school-year';

type Db = FirebaseFirestore.Firestore;
const BV = 'bala-vihar';

/** Shift a YYYY-MM-DD date forward by 364 days (52 weeks → same weekday). */
function shift364(dateStr: string): string {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 364);
  return dt.toISOString().slice(0, 10);
}

/**
 * Copy a school year's Bala Vihar classCalendarEntries into the next year,
 * shifting each date +364 days so a class Sunday stays a Sunday. Idempotent:
 * an entry whose target id already exists is reported as `existing`, never
 * overwritten. Carries the source `enabled`/`prasadNeeded` and the original
 * `createdBy`/`updatedBy` actor faithfully (no actor is invented here).
 */
export async function cloneCalendarYear(
  db: Db,
  args: { fromYear: string; toYear: string; dryRun: boolean },
): Promise<CalendarCopyResult> {
  const { start, end } = schoolYearDateRange(args.fromYear);
  const snap = await db
    .collection('classCalendarEntries')
    .where('programKey', '==', BV)
    .where('date', '>=', start)
    .where('date', '<=', end)
    .get();

  const created: string[] = [];
  const existing: string[] = [];
  for (const doc of snap.docs) {
    const src = doc.data() as Record<string, unknown>;
    const programKey = String(src['programKey']);
    const location = String(src['location']);
    const newDate = shift364(String(src['date']));
    const targetId = calendarEntryId(programKey, location, newDate);
    const targetRef = db.collection('classCalendarEntries').doc(targetId);
    if ((await targetRef.get()).exists) {
      existing.push(targetId);
      continue;
    }
    created.push(targetId);
    if (!args.dryRun) {
      const now = FieldValue.serverTimestamp();
      await targetRef.set({
        entryId: targetId,
        programKey: src['programKey'],
        location: src['location'],
        date: newDate,
        kind: src['kind'],
        classType: src['classType'] ?? null,
        noClassReason: src['noClassReason'] ?? null,
        specialEvents: src['specialEvents'] ?? null,
        enabled: src['enabled'],
        prasadNeeded: src['prasadNeeded'] ?? true,
        createdAt: now,
        createdBy: src['createdBy'],
        updatedAt: now,
        updatedBy: src['updatedBy'],
      });
    }
  }
  return { fromYear: args.fromYear, toYear: args.toYear, created, existing };
}
