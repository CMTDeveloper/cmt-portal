import 'server-only';
import { sendEmail as realSendEmail, type SendEmailArgs } from './ses';
import { sendSMS as realSendSMS, type SendSMSArgs } from './sns';
import { mockSender } from '@/features/check-in/shared';

export interface ResolvedSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
}

// UAT safety net. Each list is a comma-separated allowlist of recipients
// that may receive REAL email or SMS. Anything else silently routes to
// mockSender even when NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY=true. Empty /
// unset means prod behavior (no filter — everyone gets real mail).
//
//   SETU_EMAIL_ALLOWLIST — emails only (e.g. dineshdm7@gmail.com)
//   SETU_PHONE_ALLOWLIST — phones only; non-digits are stripped on compare
//                           so +1 (437) 555-1212 and 14375551212 both match
function parseEmailAllowlist(): Set<string> {
  const raw = process.env.SETU_EMAIL_ALLOWLIST ?? '';
  return new Set(
    raw
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function parsePhoneAllowlist(): Set<string> {
  const raw = process.env.SETU_PHONE_ALLOWLIST ?? '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.replace(/[^\d]/g, ''))
      .filter(Boolean),
  );
}

function isEmailAllowed(email: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true;
  return allowlist.has(email.toLowerCase().trim());
}

function isPhoneAllowed(phone: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true;
  return allowlist.has(phone.replace(/[^\d]/g, ''));
}

export function resolveSender(): ResolvedSender {
  const enabled = process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY === 'true';
  if (!enabled) {
    return mockSender;
  }

  const emailAllowlist = parseEmailAllowlist();
  const phoneAllowlist = parsePhoneAllowlist();

  // TEST-MODE REDIRECT (takes precedence over the allowlists). When set, EVERY
  // outbound message is delivered to this single recipient instead of the real
  // one, so testers can see all mail/SMS in one inbox while no real family is
  // contacted. The intended recipient is preserved in the subject/message so
  // it's clear who it was meant for. Unset/empty → normal allowlist behavior.
  //   SETU_EMAIL_REDIRECT_TO — a single email (e.g. developer@chinmayatoronto.org)
  //   SETU_PHONE_REDIRECT_TO — a single E.164 phone (e.g. +16473852434)
  const emailRedirectTo = (process.env.SETU_EMAIL_REDIRECT_TO ?? '').trim();
  const phoneRedirectTo = (process.env.SETU_PHONE_REDIRECT_TO ?? '').trim();

  return {
    sendEmail: async (args) => {
      if (emailRedirectTo) {
        console.log(`[resolveSender] EMAIL REDIRECT (test): ${args.to} → ${emailRedirectTo} (subject: ${args.subject})`);
        try {
          await realSendEmail({ ...args, to: emailRedirectTo, subject: `[test → ${args.to}] ${args.subject}` });
          console.log(`[resolveSender] SES redirect send OK → ${emailRedirectTo}`);
        } catch (e) {
          const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          console.error(`[resolveSender] SES redirect send FAILED → ${emailRedirectTo}: ${err}`);
          throw e;
        }
        return;
      }
      if (!isEmailAllowed(args.to, emailAllowlist)) {
        console.log(`[resolveSender] email allowlist filter: skipping ${args.to} → mock`);
        await mockSender.sendEmail(args);
        return;
      }
      console.log(`[resolveSender] real SES send → ${args.to} (subject: ${args.subject})`);
      try {
        await realSendEmail(args);
        console.log(`[resolveSender] SES send OK → ${args.to}`);
      } catch (e) {
        const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error(`[resolveSender] SES send FAILED → ${args.to}: ${err}`);
        throw e;
      }
    },
    sendSMS: async (args) => {
      if (phoneRedirectTo) {
        console.log(`[resolveSender] SMS REDIRECT (test): ${args.phone} → ${phoneRedirectTo}`);
        try {
          await realSendSMS({ ...args, phone: phoneRedirectTo, message: `[test → ${args.phone}] ${args.message}` });
          console.log(`[resolveSender] SNS redirect send OK → ${phoneRedirectTo}`);
        } catch (e) {
          const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          console.error(`[resolveSender] SNS redirect send FAILED → ${phoneRedirectTo}: ${err}`);
          throw e;
        }
        return;
      }
      if (!isPhoneAllowed(args.phone, phoneAllowlist)) {
        console.log(`[resolveSender] phone allowlist filter: skipping ${args.phone} → mock`);
        await mockSender.sendSMS(args);
        return;
      }
      console.log(`[resolveSender] real SNS send → ${args.phone}`);
      try {
        await realSendSMS(args);
        console.log(`[resolveSender] SNS send OK → ${args.phone}`);
      } catch (e) {
        const err = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error(`[resolveSender] SNS send FAILED → ${args.phone}: ${err}`);
        throw e;
      }
    },
  };
}
