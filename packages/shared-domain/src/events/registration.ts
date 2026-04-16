export const PAYMENT_SOURCES = ['etransfer', 'stripe'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const REGISTRATION_PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
  'cancelled',
] as const;
export type RegistrationPaymentStatus =
  (typeof REGISTRATION_PAYMENT_STATUSES)[number];

export interface EventRegistration {
  registrationId: string;
  campaign: string;
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  isBvFamily: boolean;
  payment_source: PaymentSource;
  contribution: number;
  etransferReference?: string;
  paymentStatus: RegistrationPaymentStatus;
  createdAt: number;
  updatedAt: number;
}
