import type { Family, PaymentStatus } from './family';
import type { CheckInHistoryEntry } from './check-in';

export interface SendCodeRequest {
  type: 'email' | 'phone';
  value: string;
}

export interface SendCodeResponse {
  success: true;
  throttleResetAt?: string;
}

export interface VerifyCodeRequest {
  type: 'email' | 'phone';
  value: string;
  code: string;
}

export interface VerifyCodeResponseWeb {
  redirectTo: string;
}

export interface VerifyCodeResponseMobile {
  customToken: string;
}

export interface FamilyDashboardResponse {
  family: Family;
  recentCheckIns: CheckInHistoryEntry[];
  paymentStatus: PaymentStatus;
}

export interface FamilySelfCheckInRequest {
  students: Record<string, boolean>;
}

export interface FamilySelfCheckInResponse {
  success: true;
  checkInIds: string[];
}

export interface ErrorResponse {
  error: string;
  details?: unknown;
  resetAt?: string;
}

export type { Family, Student, PaymentStatus } from './family';
export type { CheckInEvent, CheckInHistoryEntry, CheckedInBy } from './check-in';
