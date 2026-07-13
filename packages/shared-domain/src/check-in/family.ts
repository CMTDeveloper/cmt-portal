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
  // True for adult family members (parents/guardians): legacy roster rows with
  // grade 99, or Setu members of type 'Adult'. The kiosk shows the whole family
  // so a sevak can check who actually came; adults render an "Adult" label
  // instead of a school level. Absent/false = child. Non-kiosk consumers
  // (teacher rosters, etc.) only ever build children and can omit it.
  isAdult?: boolean;
}

export interface Family {
  fid: string;
  name: string;
  contacts: ContactInfo[];
  paymentStatus: PaymentStatus;
  students: Student[];
  notes?: string;
}
