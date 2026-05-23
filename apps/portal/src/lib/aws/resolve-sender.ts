import 'server-only';
import { sendEmail as realSendEmail, type SendEmailArgs } from './ses';
import { sendSMS as realSendSMS, type SendSMSArgs } from './sns';
import { mockSender } from '@/features/check-in/shared';

export interface ResolvedSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
}

// SETU_EMAIL_ALLOWLIST is a comma-separated list of recipients (email
// addresses and/or phone numbers) that are allowed to receive REAL email/SMS
// in environments like UAT. When the env var is set and non-empty, any
// recipient NOT on the list silently routes to mockSender — so testing
// against UAT can't accidentally email real families. An empty / unset
// allowlist preserves prod behavior (everyone gets real mail).
function parseAllowlist(): Set<string> {
  const raw = process.env.SETU_EMAIL_ALLOWLIST ?? '';
  return new Set(
    raw
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function normalizeRecipient(s: string): string {
  // Strip non-digits for phone-like comparison; keep email as lowercase trim.
  const lower = s.toLowerCase().trim();
  if (lower.includes('@')) return lower;
  return lower.replace(/[^\d]/g, '');
}

function isAllowed(recipient: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true;
  if (allowlist.has(recipient.toLowerCase().trim())) return true;
  return allowlist.has(normalizeRecipient(recipient));
}

export function resolveSender(): ResolvedSender {
  const enabled = process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY === 'true';
  if (!enabled) {
    return mockSender;
  }

  const allowlist = parseAllowlist();
  return {
    sendEmail: async (args) => {
      if (!isAllowed(args.to, allowlist)) {
        console.log(`[resolveSender] allowlist filter: skipping real email to ${args.to} → mock`);
        await mockSender.sendEmail(args);
        return;
      }
      await realSendEmail(args);
    },
    sendSMS: async (args) => {
      if (!isAllowed(args.phone, allowlist)) {
        console.log(`[resolveSender] allowlist filter: skipping real SMS to ${args.phone} → mock`);
        await mockSender.sendSMS(args);
        return;
      }
      await realSendSMS(args);
    },
  };
}
