import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

export function registrationsCollection(campaign?: string) {
  const c = campaign || process.env.NEXT_PUBLIC_EVENT_CAMPAIGN || '2026MothersDay';
  return portalFirestore()
    .collection('events')
    .doc(c)
    .collection('registrations');
}
