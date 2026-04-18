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

export const REGISTRATION_CATEGORIES = ['bv-family', 'sevak', 'non-bv'] as const;
export type RegistrationCategory = (typeof REGISTRATION_CATEGORIES)[number];

export interface EventRegistration {
  registrationId: string;
  campaign: string;
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  isBvFamily: boolean;
  category: RegistrationCategory;
  additionalAttendees: number;
  mothersInPuja: number;
  fid?: string;
  payment_source: PaymentSource;
  contribution: number;
  etransferReference?: string;
  paymentStatus: RegistrationPaymentStatus;
  createdAt: number;
  updatedAt: number;
}
