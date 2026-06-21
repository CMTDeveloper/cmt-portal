import { notFound } from 'next/navigation';
import { KioskHome } from '@/features/check-in/kiosk';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Check in' };

export default function CheckInKioskPage() {
  if (!flags.checkInKiosk) notFound();
  return <KioskHome />;
}
