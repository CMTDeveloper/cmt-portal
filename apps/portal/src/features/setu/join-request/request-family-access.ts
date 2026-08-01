import 'server-only';
import { resolveSender } from '@/lib/aws/resolve-sender';
import { sendManagedEmail } from '@/lib/aws/send-managed-email';
import { setuJoinRequestEmail } from '@/lib/aws/templates/setu-join-request-email';
import { createJoinRequest, markJoinRequestNotified } from './create-request';

/**
 * Minimum gap between notifications about the SAME join request.
 *
 * 🔴 Codex review of 1e498a0: `POST /api/setu/join-request/send` is
 * unauthenticated, and the `resend` flag added there turned it into a
 * manager-spam primitive - anyone who knows a pending member's address could
 * drive repeated email AND SMS to every manager on that family. The only
 * ceiling was 30 requests per IP per 15 minutes, which a distributed caller
 * simply steps around.
 *
 * The cooldown therefore keys on the REQUEST DOCUMENT, not the caller: rotating
 * IPs buys nothing, because the state that says "these managers were pinged 90
 * seconds ago" lives next to the request itself. Ten minutes is long enough to
 * make bulk sending pointless and short enough that a family member who did not
 * receive the first mail is not stuck waiting.
 */
const RENOTIFY_COOLDOWN_MS = 10 * 60_000;

/**
 * Ceiling on how long a caller waits for the notification to go out.
 *
 * The SES client is documented (send-managed-email.ts) as having NO request
 * timeout, and verify-code now awaits this on the sign-in path - so a
 * never-settling send would hang a family's sign-in until the platform killed
 * the function. It also narrows the timing gap between a real gated address
 * (which does several reads and then a send) and an unknown one (a single read
 * that returns immediately), so response time is a weaker signal about whether
 * an address is real.
 */
const NOTIFY_TIMEOUT_MS = 5_000;

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
  /** True when a re-send was refused because the cooldown had not elapsed. */
  throttled?: boolean;
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

  // Cooldown applies to the re-send path only. A `created` outcome cannot be
  // driven in a loop: the doc id is deterministic, so the second attempt
  // dedupes, and returning to `created` needs a manager to approve or decline.
  if (result.outcome === 'deduped' && result.lastNotifiedAt) {
    const since = Date.now() - result.lastNotifiedAt.getTime();
    if (since < RENOTIFY_COOLDOWN_MS) {
      return { outcome: result.outcome, notified: 0, throttled: true };
    }
  }

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

  // Stamped BEFORE the sends settle, not after. If the process dies mid-send
  // the stamp is already down, so the cooldown holds; stamping afterwards would
  // let a caller who kills the connection each time bypass it entirely.
  await markJoinRequestNotified(result.fid, result.matchedMid);

  // Swallowed: a flaky notification must never reveal match state to an
  // anonymous caller (the send route always answers {ok:true}) and must never
  // fail a sign-in that has already succeeded. Bounded so a hung SES cannot
  // hold the response open - the sends themselves keep running, we simply stop
  // waiting on them.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((resolve) => {
      timer = setTimeout(resolve, NOTIFY_TIMEOUT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);

  return { outcome: result.outcome, notified: tasks.length };
}
