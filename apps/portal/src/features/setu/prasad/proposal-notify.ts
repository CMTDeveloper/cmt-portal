import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export interface ProposalNotifyResult { disabled?: boolean; checked: number; sent: number; skipped: number; failed: number }

/**
 * One-time "your suggested prasad Sunday — please confirm" email+SMS to every
 * PROPOSED family that hasn't been notified yet. Self-healing by design: keyed
 * off the docs (status=='proposed' && proposalNotifiedAt==null), NOT the publish
 * response rows, so a crash between publish and notify is repaired by the next
 * publish click. Stamp-after-send + per-family try/catch — same semantics as
 * sendDuePrasadReminders. Gated by PRASAD_REMINDER_CRON_ENABLED (the master
 * prasad-send switch) + the UAT allowlists inside resolveSender.
 */
export async function notifyUnnotifiedProposals(pid: string): Promise<ProposalNotifyResult> {
  if (process.env.PRASAD_REMINDER_CRON_ENABLED !== 'true') {
    return { disabled: true, checked: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const db = portalFirestore();
  const sender = resolveSender();
  const base = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? 'https://cmt-setu.vercel.app';

  // Two equality filters — served by merged single-field indexes, no composite.
  const snap = await db.collection('prasadAssignments')
    .where('pid', '==', pid).where('status', '==', 'proposed').get();

  let sent = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const a = doc.data() as { fid: string; date: string; proposalNotifiedAt?: unknown };
    if (a.proposalNotifiedAt != null) { skipped++; continue; }
    try {
      const managersSnap = await db.collection('families').doc(a.fid)
        .collection('members').where('manager', '==', true).get();
      const when = formatDate(a.date);
      for (const m of managersSnap.docs) {
        const mem = m.data() as { email?: string | null; phone?: string | null; firstName?: string };
        const msg = `Namaste ${mem.firstName ?? ''}! Your family's suggested Bala Vihar prasad Sunday is ${when}. Please confirm it or pick another date: ${base}/family/prasad — Chinmaya Mission Toronto`;
        if (mem.email) await sender.sendEmail({ to: mem.email, subject: `Prasad Sunday — please confirm (${when})`, text: msg });
        if (mem.phone) await sender.sendSMS({ phone: mem.phone, message: msg });
      }
      // Stamp-after-send: a failed send is NOT stamped, so the next run retries
      // (dup-risk over skip-risk, same trade-off as the reminder service).
      await doc.ref.set({ proposalNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      sent++;
    } catch (err) {
      console.error(`[prasad-proposal] family ${a.fid} failed:`, err);
      failed++;
    }
  }
  return { checked: snap.size, sent, skipped, failed };
}
