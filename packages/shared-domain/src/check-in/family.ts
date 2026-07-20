export type PaymentStatus = 'paid' | 'unpaid' | 'partial';

export type ContactInfo =
  | { type: 'email'; value: string }
  | { type: 'phone'; value: string };

export interface Student {
  sid: string;
  fid: string;
  firstName: string;
  lastName: string;
  // A child's Bala Vihar level NAME for display (e.g. "Level 6"), NOT the raw
  // grade. The Setu kiosk lookup derives this from the child's grade via the
  // same level match the teacher roster/dashboard use; the legacy roster path
  // carries its stored level string. Empty for adults.
  level: string;
  // Friendly grade label shown ALONGSIDE the level (e.g. "Grade 6") so a family
  // can spot/correct a mis-placed child at check-in. Only the Setu path sets it;
  // absent on adults and on the legacy path.
  grade?: string;
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
