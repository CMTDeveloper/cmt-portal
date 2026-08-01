import 'server-only';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';
import { setuJoinRequestEmail } from '@/lib/aws/templates/setu-join-request-email';
import { createJoinRequest } from './create-request';

/**
 * Create a join request AND notify the family's managers - the single place
 * where "a pending member exists" turns into "a manager was actually told".
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * 🔴 Reported by Vaibhav from production, 2026-07-31: his wife signed in, saw
 * *"Your access is pending your family manager's approval. We've let them
 * know"*, and he received nothing. The claim was false by construction.
 * `verify-code` produced the pending state and sent NOTHING; the only code that
 * ever notified lived inside `POST /api/setu/join-request/send`, which fires
 * only when the requester finds and clicks a button labelled "**Re-send**
 * request" - a button whose wording says a first request already went out.
 *
 * So the rule lived in one route rather than at the point where the pending
 * state is created, and the second caller silently inherited nothing. Keeping
 * create-and-notify welded together here is the fix: a future caller cannot
 * produce a pending member without telling somebody, because there is no
 * separate "just create it" entry point to reach for.
 */
export interface RequestFamilyAccessInput {
  type: 'email' | 'phone';
  value: string;
  ttlDays: number;
  /** Absolute origin for the manager's review link - always `portalBaseUrl(req)`. */
  baseUrl: string;
  /**
   * Notify even when an open request already exists.
   *
   * Off by default so a member who signs in again next week does not re-ping
   * their manager. Turned ON only for an explicit "re-send" click, which would
   * otherwise dedupe into silence while the UI reported "Request sent" - the
   * same false claim in a different place.
   */
  notifyOnExisting?: boolean;
}

export interface RequestFamilyAccessResult {
  outcome: 'created' | 'deduped' | 'noop';
  /** Notification tasks dispatched (email + SMS across all managers). */
  notified: number;
}

export async function requestFamilyAccess(
  input: RequestFamilyAccessInput,
): Promise<RequestFamilyAccessResult> {
  const result = await createJoinRequest({
    type: input.type,
    value: input.value,
    ttlDays: input.ttlDays,
  });

  if (result.outcome === 'noop') return { outcome: 'noop', notified: 0 };

  const shouldNotify =
    result.outcome === 'created' || (result.outcome === 'deduped' && input.notifyOnExisting === true);
  if (!shouldNotify) return { outcome: result.outcome, notified: 0 };

  const reviewUrl = `${input.baseUrl}/join-request/${result.token}`;
  const sender = resolveSender();

  const tasks = result.managers.flatMap((m) => {
    const perManager: Array<Promise<unknown>> = [];
    if (m.email) {
      const managerEmail = m.email;
      const emailData = {
        requesterName: result.requesterName ?? result.requesterContact,
        requesterContact: result.requesterContact,
        familyName: result.familyName,
        reviewUrl,
      };
      perManager.push(
        sendManagedEmail({
          name: 'setu-join-request',
          to: managerEmail,
          data: emailData,
          fallback: () => sender.sendEmail({ to: managerEmail, ...setuJoinRequestEmail(emailData) }),
        }),
      );
    }
    if (m.phone) {
      perManager.push(
        sender.sendSMS({
          phone: m.phone,
          message: `Hari OM! ${result.requesterContact} asked to join your ${result.familyName} family on Chinmaya Setu. Review: ${reviewUrl}`,
        }),
      );
    }
    return perManager;
  });

  // Swallowed: a flaky notification must never reveal match state to an
  // anonymous caller (the send route always answers {ok:true}) and must never
  // fail a sign-in that has already succeeded.
  await Promise.allSettled(tasks);

  return { outcome: result.outcome, notified: tasks.length };
}
