import { NextResponse } from 'next/server';
import { isAdmin } from '@cmt/shared-domain';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { readSessionFromHeaders } from '@/lib/auth/headers';
import { flags } from '@/lib/flags';
import { CURRENT_PRASAD_PIDS } from '@/features/setu/prasad/constants';

/** Firestore Timestamp → ISO string, null-safe (anything without `.toDate` stays as-is). */
function toIso(v: unknown): string | null {
  if (v && typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

/**
 * GET /api/admin/prasad?pid=...&date=YYYY-MM-DD — list assignments for one
 * prasad period (optionally a single date). Admin-only. Timestamps are
 * serialized to ISO strings; rows sort by date then familyName.
 */
export async function GET(req: Request) {
  if (!flags.setuAuth) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = readSessionFromHeaders(req);
  if (!session) return NextResponse.json({ error: 'no-session' }, { status: 401 });
  if (!isAdmin({ role: session.role, extraRoles: session.extraRoles })) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const pid = url.searchParams.get('pid');
  const date = url.searchParams.get('date');
  if (!pid || !CURRENT_PRASAD_PIDS.some((p) => p.pid === pid)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  let query = portalFirestore().collection('prasadAssignments').where('pid', '==', pid);
  if (date) query = query.where('date', '==', date);
  const snap = await query.get();

  const assignments = snap.docs
    .map((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const remindedAt = (d.remindedAt ?? {}) as Record<string, unknown>;
      const date = typeof d.date === 'string' ? d.date : '';
      const familyName = typeof d.familyName === 'string' ? d.familyName : '';
      return {
        ...d,
        date,
        familyName,
        assignedAt: toIso(d.assignedAt),
        movedAt: toIso(d.movedAt),
        confirmedAt: toIso(d.confirmedAt),
        proposalNotifiedAt: toIso(d.proposalNotifiedAt),
        remindedAt: {
          weekBefore: toIso(remindedAt.weekBefore),
          twoDayBefore: toIso(remindedAt.twoDayBefore),
        },
      };
    })
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.familyName.localeCompare(b.familyName);
    });

  return NextResponse.json({ assignments }, { status: 200 });
}
