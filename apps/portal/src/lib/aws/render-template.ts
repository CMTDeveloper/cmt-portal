import 'server-only';
import { otpCodeEmail, type OtpCodeProps } from './templates/otp-code-email';
import { paymentReminderEmail, type PaymentReminderProps } from './templates/payment-reminder-email';
import { donationThankYouEmail, type DonationThankYouProps } from './templates/donation-thank-you-email';

export type TemplateName = 'otp-code' | 'payment-reminder' | 'donation-thank-you';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmailTemplate(name: 'otp-code', props: OtpCodeProps): RenderedEmail;
export function renderEmailTemplate(name: 'payment-reminder', props: PaymentReminderProps): RenderedEmail;
export function renderEmailTemplate(name: 'donation-thank-you', props: DonationThankYouProps): RenderedEmail;
export function renderEmailTemplate(name: TemplateName, props: unknown): RenderedEmail {
  switch (name) {
    case 'otp-code':
      return otpCodeEmail(props as OtpCodeProps);
    case 'payment-reminder':
      return paymentReminderEmail(props as PaymentReminderProps);
    case 'donation-thank-you':
      return donationThankYouEmail(props as DonationThankYouProps);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown email template: ${String(exhaustive)}`);
    }
  }
}
