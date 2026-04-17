import { notFound } from 'next/navigation';
import { flags } from '@/lib/flags';
import { FamilyCheckInReport } from '@/features/check-in/teacher';

export const metadata = { title: 'Sunday Attendance Overview — CMT Portal' };
export const dynamic = 'force-dynamic';

export default function CheckInReportPage() {
  if (!flags.checkInTeacher) notFound();
  return <FamilyCheckInReport />;
}
