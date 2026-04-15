import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export interface GuestCheckInInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  numberOfAdults: number;
  numberOfChildren: number;
  notes?: string;
}

export async function recordGuestCheckIn(input: GuestCheckInInput): Promise<string> {
  const ref = await portalFirestore().collection('guest_check_ins').add({
    ...input,
    checkedInAt: new Date().toISOString(),
  });
  return ref.id;
}
