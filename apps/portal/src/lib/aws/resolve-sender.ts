import 'server-only';
import { sendEmail as realSendEmail, type SendEmailArgs } from './ses';
import { sendSMS as realSendSMS, type SendSMSArgs } from './sns';
import { mockSender } from '@/features/check-in/shared';

export interface ResolvedSender {
  sendEmail(args: SendEmailArgs): Promise<void>;
  sendSMS(args: SendSMSArgs): Promise<void>;
}

export function resolveSender(): ResolvedSender {
  const enabled = process.env.NEXT_PUBLIC_FEATURE_CHECK_IN_NOTIFY === 'true';
  if (!enabled) {
    return mockSender;
  }
  return { sendEmail: realSendEmail, sendSMS: realSendSMS };
}
