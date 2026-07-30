import 'server-only';
import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  ConfigurationSetDoesNotExistException,
} from '@aws-sdk/client-ses';
import { sesRegion } from './region';
import { ORG_NAME } from '@/lib/branding';

let cached: SESClient | undefined;
function client(): SESClient {
  if (cached) return cached;
  cached = new SESClient({ region: sesRegion() });
  return cached;
}

/**
 * The `From:` header, WITH a display name.
 *
 * Vaibhav, 2026-07-30, of a delivered email showing only
 * `bvregistration@chinmayatoronto.org`: *"the name, can you adjust?"* A bare
 * address is what every mail client shows when the From carries no display
 * name, and for a charity asking families for money that reads as unbranded at
 * best and phishy at worst.
 *
 * ── 🔴 The name must NOT be folded into AWS_SES_FROM_EMAIL ──────────────────
 * The obvious "fix" is to set that var to `Chinmaya Mission Toronto
 * <bvregistration@…>`. It would fail at boot: `lib/env.ts` validates
 * `AWS_SES_FROM_EMAIL` with `z.string().email()`, and a display-name form is not
 * a valid email address. Hence a SEPARATE `AWS_SES_FROM_NAME`, composed here.
 *
 * ── Verification is unaffected ──────────────────────────────────────────────
 * SES verifies the ADDRESS, not the header. Adding a display name needs no new
 * identity and no DNS change.
 *
 * Defaults to `ORG_NAME` rather than to nothing: every email this portal sends
 * is from the charity, so the useful default is the charity's name, and an
 * environment that wants something narrower can set the var.
 */
function sesSource(): string {
  const from = process.env.AWS_SES_FROM_EMAIL;
  if (!from) {
    throw new Error('[aws/ses] AWS_SES_FROM_EMAIL is required');
  }
  const name = (process.env.AWS_SES_FROM_NAME ?? ORG_NAME).trim();
  if (!name) return from;
  return `${encodeDisplayName(name)} <${from}>`;
}

/**
 * A display name safe to put in a header.
 *
 * ASCII goes in an RFC 5322 quoted-string, with `\` and `"` escaped - an
 * unescaped quote would terminate the string early and produce a malformed
 * header. Anything non-ASCII becomes an RFC 2047 encoded-word, because a raw
 * 8-bit byte in a header is not legal and arrives as mojibake even when it is
 * accepted. `Chinmaya Mission Toronto` needs neither today; a future org name
 * with an accent would.
 */
function encodeDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(name)) {
    return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
  }
  return `"${name.replace(/([\\"])/g, '\\$1')}"`;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendSesTemplatedEmailArgs {
  to: string;
  /** The template's name on the SES side, from a SES_TEMPLATE_* env var. */
  templateName: string;
  /** Serialized to the TemplateData JSON string SES expects. */
  data: Record<string, unknown>;
}

/**
 * Send one SES-managed template.
 *
 * Named `sendSesTemplatedEmail`, not `sendTemplatedEmail`: that name is already
 * exported from `features/check-in/notifications/send-email-service.ts` for the
 * IN-CODE renderer, and two exports with one name meaning opposite things is a
 * trap for anyone reading a call site.
 *
 * This layer does no fallback and swallows nothing - in particular a
 * `TemplateDoesNotExistException` propagates untouched, because whether a
 * missing template should fall back to in-code rendering is the CALLER's
 * decision. Catching it here would make "template not configured" and
 * "delivered" indistinguishable.
 */
export async function sendSesTemplatedEmail(args: SendSesTemplatedEmailArgs): Promise<void> {
  const base = {
    Source: sesSource(),
    Destination: { ToAddresses: [args.to] },
    Template: args.templateName,
    // A JSON STRING, not an object. SES rejects anything else.
    TemplateData: JSON.stringify(args.data),
  };

  // The configuration set is the ONLY thing that makes a render failure
  // visible. SES accepts a message whose template fails to render, returns a
  // MessageId, and delivers nothing - so without a RENDERING_FAILURE event
  // destination the loss is silent to this process and to everyone else. The
  // key is omitted entirely when unset; `undefined` riding in on a spread is
  // not the same thing to the SDK's serializer.
  const configurationSet = (process.env.SES_CONFIGURATION_SET ?? '').trim();
  if (!configurationSet) {
    await client().send(new SendTemplatedEmailCommand(base));
    return;
  }

  try {
    await client().send(
      new SendTemplatedEmailCommand({ ...base, ConfigurationSetName: configurationSet }),
    );
  } catch (err) {
    if (!(err instanceof ConfigurationSetDoesNotExistException)) throw err;
    // Configuration sets are region-scoped exactly like templates, so a typo or
    // one created outside AWS_SES_REGION would otherwise make every managed
    // email throw - a failure that is impossible without this observability
    // feature, and worst where a throw is expensive: the invite (a 500 with the
    // row already written) and the payment-reminder cron (which retries forever
    // because lastReminderSentAt is written after the send). Losing the alarm
    // is bad; losing the email to gain the alarm is worse.
    console.error(
      `[aws/ses] SES_CONFIGURATION_SET "${configurationSet}" does not exist in this region - sending without it. Render failures will NOT be reported until this is fixed.`,
    );
    await client().send(new SendTemplatedEmailCommand(base));
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  await client().send(
    new SendEmailCommand({
      Source: sesSource(),
      Destination: { ToAddresses: [args.to] },
      Message: {
        Subject: { Data: args.subject },
        Body: {
          Text: { Data: args.text },
          ...(args.html ? { Html: { Data: args.html } } : {}),
        },
      },
    }),
  );
}
