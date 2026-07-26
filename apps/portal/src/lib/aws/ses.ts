import 'server-only';
import { SESClient, SendEmailCommand, SendTemplatedEmailCommand } from '@aws-sdk/client-ses';
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
  await client().send(
    new SendTemplatedEmailCommand({
      Source: from,
      Destination: { ToAddresses: [args.to] },
      Template: args.templateName,
      // A JSON STRING, not an object. SES rejects anything else.
      TemplateData: JSON.stringify(args.data),
    }),
  );
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
