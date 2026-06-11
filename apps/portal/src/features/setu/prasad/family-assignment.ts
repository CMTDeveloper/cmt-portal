import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { CURRENT_PRASAD_PIDS, FALLBACK_CAP, MOVE_LOCK_DAYS, daysUntil, torontoToday } from './constants';

export interface FamilyPrasadView {
  paid: string; pid: string; date: string;
  youngestName: string | null; birthMonth: number | null;
  reason: string; status: string; movable: boolean;
}

/** The family's current-period assignment, or null. Looks across both location pids. */
export async function getFamilyAssignment(fid: string): Promise<FamilyPrasadView | null> {
  const db = portalFirestore();
  // One-assignment-per-family invariant: a family enrolls at ONE location, so at
  // most one pid yields an assigned doc. If both ever exist (two-campus anomaly),
  // first-pid-wins and the second stays hidden — enforced by enrollment data, not here.
  for (const { pid } of CURRENT_PRASAD_PIDS) {
    const snap = await db.collection('prasadAssignments').doc(`${pid}-${fid}`).get();
    if (!snap.exists) continue;
    const a = snap.data() as { pid: string; date: string; youngestName: string | null; birthMonth: number | null; reason: string; status: string };
    if (a.status !== 'assigned' && a.status !== 'proposed') continue;
    return {
      paid: snap.id, pid: a.pid, date: a.date,
      youngestName: a.youngestName, birthMonth: a.birthMonth,
      reason: a.reason, status: a.status,
      movable: daysUntil(a.date, torontoToday()) > MOVE_LOCK_DAYS,
    };
  }
  return null;
}

export interface MoveOption { date: string; seatsLeft: number }

/** Future class Sundays (beyond the lock window) with seats under the published cap. */
export async function getMoveOptions(fid: string): Promise<{ paid: string; options: MoveOption[] } | null> {
  const current = await getFamilyAssignment(fid);
  if (!current) return null;
  const db = portalFirestore();
  const period = CURRENT_PRASAD_PIDS.find((p) => p.pid === current.pid)!;
  const todayYmd = torontoToday();

  const [calSnap, cfgSnap, assignedSnap] = await Promise.all([
    db.collection('classCalendarEntries').where('location', '==', period.location).where('programKey', '==', 'bala-vihar').get(),
    db.collection('prasadConfig').doc(current.pid).get(),
    db.collection('prasadAssignments').where('pid', '==', current.pid).get(),
  ]);
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? FALLBACK_CAP;
  const countByDate = new Map<string, number>();
  for (const d of assignedSnap.docs) {
    const a = d.data() as { date: string; status: string };
    if (a.status === 'assigned' || a.status === 'proposed') countByDate.set(a.date, (countByDate.get(a.date) ?? 0) + 1);
  }
  const options = calSnap.docs
    .map((d) => d.data() as { date: string; kind: string; enabled?: boolean; prasadNeeded?: boolean })
    .filter((e) => e.kind === 'class' && e.enabled !== false && e.prasadNeeded !== false)
    // Confirmed families keep the 7-day move lock; a proposed family may pick
    // ANY future Sunday (confirming late beats not confirming at all).
    .filter((e) => daysUntil(e.date, todayYmd) > (current.status === 'proposed' ? 0 : MOVE_LOCK_DAYS) && e.date !== current.date)
    .map((e) => ({ date: e.date, seatsLeft: cap - (countByDate.get(e.date) ?? 0) }))
    .filter((o) => o.seatsLeft > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { paid: current.paid, options };
}

export type MoveResult = 'moved' | 'not-found' | 'locked' | 'target-full' | 'invalid-target';

/** Transactional self-serve move: re-validates lock + target capacity inside the txn. */
export async function moveAssignment(fid: string, targetDate: string, actorMid: string): Promise<MoveResult> {
  const current = await getFamilyAssignment(fid);
  if (!current) return 'not-found';
  if (current.status === 'proposed') return 'invalid-target'; // proposed rows confirm via confirmAssignment, never move
  if (!current.movable) return 'locked';
  const opts = await getMoveOptions(fid);
  if (!opts || !opts.options.some((o) => o.date === targetDate)) return 'invalid-target';

  const db = portalFirestore();
  const cfgSnap = await db.collection('prasadConfig').doc(current.pid).get();
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? FALLBACK_CAP;

  return db.runTransaction(async (tx) => {
    const targetQ = db.collection('prasadAssignments')
      .where('pid', '==', current.pid).where('date', '==', targetDate);
    const targetSnap = await tx.get(targetQ);
    const activeCount = targetSnap.docs.filter((d) => {
      const s = (d.data() as { status: string }).status;
      return s === 'assigned' || s === 'proposed';
    }).length;
    if (activeCount >= cap) return 'target-full' as const;
    tx.update(db.collection('prasadAssignments').doc(current.paid), {
      date: targetDate,
      movedFrom: current.date,
      movedAt: FieldValue.serverTimestamp(),
      movedBy: actorMid,
      source: 'family-move',
    });
    return 'moved' as const;
  });
}

export type ConfirmResult = 'confirmed' | 'not-found' | 'already-confirmed' | 'invalid-target' | 'target-full';

/**
 * Family confirm: no targetDate → flip the proposed doc to assigned in place
 * (the seat is already counted — no cap check). With targetDate → validate it
 * against the live options list, then re-count the target inside the txn
 * (mirrors moveAssignment) and move+flip in one update. confirmedBy:'family'.
 */
export async function confirmAssignment(
  fid: string,
  targetDate: string | undefined,
  actorMid: string,
): Promise<ConfirmResult> {
  const current = await getFamilyAssignment(fid);
  if (!current) return 'not-found';
  if (current.status !== 'proposed') return 'already-confirmed';
  // Day-of confirm is allowed (>= 0); a date already in the past is not.
  if ((targetDate === undefined || targetDate === current.date) && daysUntil(current.date, torontoToday()) < 0) {
    return 'invalid-target';
  }

  const db = portalFirestore();
  const ref = db.collection('prasadAssignments').doc(current.paid);

  if (targetDate === undefined || targetDate === current.date) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return 'not-found' as const;
      if ((snap.data() as { status?: string }).status !== 'proposed') return 'already-confirmed' as const;
      // The admin reassign route can change `date` without changing `status`
      // between the outside read and this txn — re-verify before flipping.
      if ((snap.data() as { date?: string }).date !== current.date) return 'invalid-target' as const;
      tx.update(ref, {
        status: 'assigned',
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: 'family',
      });
      return 'confirmed' as const;
    });
  }

  const opts = await getMoveOptions(fid);
  if (!opts || !opts.options.some((o) => o.date === targetDate)) return 'invalid-target';
  const cfgSnap = await db.collection('prasadConfig').doc(current.pid).get();
  const cap = (cfgSnap.data()?.capPerSunday as number | undefined) ?? FALLBACK_CAP;

  return db.runTransaction(async (tx) => {
    const targetSnap = await tx.get(
      db.collection('prasadAssignments').where('pid', '==', current.pid).where('date', '==', targetDate),
    );
    const liveCount = targetSnap.docs.filter((d) => {
      const s = (d.data() as { status: string }).status;
      return s === 'assigned' || s === 'proposed';
    }).length;
    if (liveCount >= cap) return 'target-full' as const;
    const meSnap = await tx.get(ref);
    if (!meSnap.exists) return 'not-found' as const;
    if ((meSnap.data() as { status?: string }).status !== 'proposed') return 'already-confirmed' as const;
    tx.update(ref, {
      date: targetDate,
      status: 'assigned',
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedBy: 'family',
      movedFrom: current.date,
      movedAt: FieldValue.serverTimestamp(),
      movedBy: actorMid,
      source: 'family-move',
    });
    return 'confirmed' as const;
  });
}
