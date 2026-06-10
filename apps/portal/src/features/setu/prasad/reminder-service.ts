import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { torontoToday, daysUntil } from './constants';

type Kind = 'weekBefore' | 'twoDayBefore';
const KIND_BY_DAYS: Record<number, Kind> = { 7: 'weekBefore', 2: 'twoDayBefore' };

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export interface ReminderRunResult { checked: number; sent: number; skipped: number; failed: number }

/** Send 7-day / 2-day prasad reminders to family managers. Idempotent via remindedAt stamps. */
export async function sendDuePrasadReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const db = portalFirestore();
  const today = torontoToday(now);
  const sender = resolveSender();

  // status==assigned + date in the two target days → backed by the (status,date) index.
  const targets = Object.keys(KIND_BY_DAYS).map((d) => addDays(today, Number(d)));
  const snap = await db.collection('prasadAssignments')
    .where('status', '==', 'assigned').where('date', 'in', targets).get();

  let sent = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const a = doc.data() as {
      fid: string; date: string; familyName: string;
      remindedAt?: { weekBefore?: unknown; twoDayBefore?: unknown };
    };
    const kind = KIND_BY_DAYS[daysUntil(a.date, today)];
    if (!kind) continue;
    if (a.remindedAt?.[kind] != null) { skipped++; continue; }

    try {
      const managersSnap = await db.collection('families').doc(a.fid)
        .collection('members').where('manager', '==', true).get();
      const when = formatDate(a.date);
      const lead = kind === 'weekBefore' ? 'is one week away' : 'is this Sunday';
      for (const m of managersSnap.docs) {
        const mem = m.data() as { email?: string | null; phone?: string | null; firstName?: string };
        const msg = `Namaste ${mem.firstName ?? ''}! Your family's Bala Vihar prasad day ${lead} — ${when}. Please bring prasad for the assembly. — Chinmaya Mission Toronto`;
        if (mem.email) await sender.sendEmail({ to: mem.email, subject: `Prasad reminder — ${when}`, text: msg });
        if (mem.phone) await sender.sendSMS({ phone: mem.phone, message: msg });
      }
      // Relies on Admin SDK deep merge: set({ remindedAt: { [kind]: ts } }, { merge: true })
      // merges the nested map field-by-field, so stamping twoDayBefore does NOT erase a
      // previously-stamped weekBefore (and vice versa). Do not switch to update() with a
      // dotted path — set+merge is the intended, verified behavior here.
      // Stamp-after-send ordering: if a send throws, we do NOT stamp, so the next run
      // retries. Managers who already received a message for this family may get a
      // duplicate on retry — accepted v1 trade-off (skip-risk is worse than dup-risk
      // for a seva reminder). A caught failure increments `failed` and the loop
      // continues so the rest of the batch is not aborted.
      await doc.ref.set({ remindedAt: { [kind]: FieldValue.serverTimestamp() } }, { merge: true });
      sent++;
    } catch (err) {
      console.error(`[prasad-reminder] family ${a.fid} failed:`, err);
      failed++;
    }
  }
  return { checked: snap.size, sent, skipped, failed };
}
