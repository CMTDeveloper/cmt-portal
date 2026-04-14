export type PaymentStatus = 'paid' | 'unpaid' | 'partial';

export type ContactInfo =
  | { type: 'email'; value: string }
  | { type: 'phone'; value: string };

export interface Student {
  sid: string;
  fid: string;
  firstName: string;
  lastName: string;
  level: string;
  className?: string;
  dateOfBirth?: string;
}

export interface Family {
  fid: string;
  name: string;
  contacts: ContactInfo[];
  paymentStatus: PaymentStatus;
  students: Student[];
  notes?: string;
}
