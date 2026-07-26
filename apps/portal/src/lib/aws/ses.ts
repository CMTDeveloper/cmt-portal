import 'server-only';
import {
  SESClient,
  SendEmailCommand,
  SendTemplatedEmailCommand,
  ConfigurationSetDoesNotExistException,
} from '@aws-sdk/client-ses';
import { sesRegion } from './region';

let cached: SESClient | undefined;
function client(): SESClient {
  if (cached) return cached;
  cached = new SESClient({ region: sesRegion() });
  return cached;
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
  const from = process.env.AWS_SES_FROM_EMAIL;
  if (!from) {
    throw new Error('[aws/ses] AWS_SES_FROM_EMAIL is required');
  }

  const base = {
    Source: from,
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
  const from = process.env.AWS_SES_FROM_EMAIL;
  if (!from) {
    throw new Error('[aws/ses] AWS_SES_FROM_EMAIL is required');
  }
  await client().send(
    new SendEmailCommand({
      Source: from,
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
