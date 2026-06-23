import type { YearReadiness } from '@cmt/shared-domain';
import { balaViharSourceOidsForYear, schoolYearDateRange } from './school-year';

type Db = FirebaseFirestore.Firestore;
const BV = 'bala-vihar';

async function anyExists(q: FirebaseFirestore.Query): Promise<boolean> {
  return !(await q.limit(1).get()).empty;
}

/**
 * Per-item readiness for the next school year (`toYear`): is each piece of setup
 * present, plus the `promotionRan` gate. Backs the Year-center checklist and the
 * Activate gate. All queries are index-safe — see the WHY notes in the design:
 *  - offerings/seva: equality-only → single-field merge, no composite.
 *  - levels/teachers: one `pid in [...]` read; teachers derived in memory from
 *    teacherRefs (avoids a `teacherRefs != []` query).
 *  - calendar: equality + date range → reuses the (programKey, date) index.
 *  - promotionRan: collectionGroup enrollments (oid in [...], status ==) →
 *    reuses the existing enrollments (oid, status) collection-group index.
 *  - prasad: direct prasadConfig/{oid} doc reads (pid == offering oid) — no query.
 */
export async function computeYearReadiness(
  db: Db,
  args: { fromYear: string; toYear: string },
): Promise<YearReadiness> {
  const oids = balaViharSourceOidsForYear(args.toYear); // ['bv-brampton-{toYear}','bv-scarborough-{toYear}']
  const { start, end } = schoolYearDateRange(args.toYear);

  const [offerings, levelsSnap, calendar, seva, promotionRan, prasadSnaps] = await Promise.all([
    anyExists(
      db.collection('offerings').where('programKey', '==', BV).where('termLabel', '==', args.toYear),
    ),
    db.collection('levels').where('pid', 'in', oids).get(),
    anyExists(
      db
        .collection('classCalendarEntries')
        .where('programKey', '==', BV)
        .where('date', '>=', start)
        .where('date', '<=', end),
    ),
    anyExists(db.collection('seva_opportunities').where('sevaYear', '==', args.toYear)),
    anyExists(
      db.collectionGroup('enrollments').where('oid', 'in', oids).where('status', '==', 'active'),
    ),
    Promise.all(oids.map((oid) => db.collection('prasadConfig').doc(oid).get())),
  ]);

  const levels = !levelsSnap.empty;
  const teachers = levelsSnap.docs.some((d) => {
    const refs = (d.data() as { teacherRefs?: unknown }).teacherRefs;
    return Array.isArray(refs) && refs.length > 0;
  });
  const prasad = prasadSnaps.some((s) => s.exists);

  return { toYear: args.toYear, promotionRan, offerings, levels, calendar, teachers, prasad, seva };
}
