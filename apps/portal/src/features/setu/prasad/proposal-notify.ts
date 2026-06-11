import { portalFirestore, FieldValue } from '@cmt/firebase-shared/admin/firestore';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { formatPrasadDate } from './constants';

/** `error` is set by the publish route when the whole fan-out threw (the publish itself landed). */
export interface ProposalNotifyResult { disabled?: boolean; error?: boolean; checked: number; sent: number; skipped: number; failed: number }

/** Families are processed in chunks of this size with Promise.allSettled. */
const CONCURRENCY = 10;

/**
 * One-time "your suggested prasad Sunday — please confirm" email+SMS to every
 * PROPOSED family that hasn't been notified yet. Self-healing by design: keyed
 * off the docs (status=='proposed' && proposalNotifiedAt==null), NOT the publish
 * response rows, so a crash between publish and notify is repaired by the next
 * publish click. Stamp-after-send + per-family failure isolation — same
 * semantics as sendDuePrasadReminders. A family that dispatches ZERO messages
 * (no managers, or no manager has email/phone) is NOT stamped and counts as
 * failed so the run report surfaces it. Chunked — a full first publish is ~357
 * families; sequential sends previously timed out a route at ~45s in this repo.
 * Gated by PRASAD_REMINDER_CRON_ENABLED (the master prasad-send switch) + the
 * UAT allowlists inside resolveSender.
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

  async function notifyOne(doc: (typeof snap.docs)[number]): Promise<'sent' | 'unreachable' | 'failed'> {
    const a = doc.data() as { fid: string; date: string };
    try {
      const managersSnap = await db.collection('families').doc(a.fid)
        .collection('members').where('manager', '==', true).get();
      const when = formatPrasadDate(a.date);
      let dispatched = 0;
      for (const m of managersSnap.docs) {
        const mem = m.data() as { email?: string | null; phone?: string | null; firstName?: string };
        const msg = `Namaste ${mem.firstName ?? ''}! Your family's suggested Bala Vihar prasad Sunday is ${when}. Please confirm it or pick another date: ${base}/family/prasad — Chinmaya Mission Toronto`;
        if (mem.email) { await sender.sendEmail({ to: mem.email, subject: `Prasad Sunday — please confirm (${when})`, text: msg }); dispatched++; }
        if (mem.phone) { await sender.sendSMS({ phone: mem.phone, message: msg }); dispatched++; }
      }
      // Zero messages dispatched → do NOT stamp; surface in the run report.
      if (dispatched === 0) {
        console.error(`[prasad-proposal] family ${a.fid} unreachable: no manager with an email or phone — left unstamped`);
        return 'unreachable';
      }
      // Stamp-after-send: a failed send is NOT stamped, so the next run retries
      // (dup-risk over skip-risk, same trade-off as the reminder service).
      await doc.ref.set({ proposalNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      return 'sent';
    } catch (err) {
      console.error(`[prasad-proposal] family ${a.fid} failed:`, err);
      return 'failed';
    }
  }

  const pending = snap.docs.filter((doc) => (doc.data() as { proposalNotifiedAt?: unknown }).proposalNotifiedAt == null);
  const skipped = snap.size - pending.length;
  let sent = 0, failed = 0;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(pending.slice(i, i + CONCURRENCY).map((doc) => notifyOne(doc)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === 'sent') sent++;
      else failed++;
    }
  }
  return { checked: snap.size, sent, skipped, failed };
}
