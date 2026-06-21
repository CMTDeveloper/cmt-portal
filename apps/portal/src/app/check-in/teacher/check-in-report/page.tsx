import { notFound } from 'next/navigation';
import { flags } from '@/lib/flags';
import { FamilyCheckInReport } from '@/features/check-in/teacher';

export const metadata = { title: 'Sunday Attendance Overview' };

export default function CheckInReportPage() {
  if (!flags.checkInTeacher) notFound();
  return <FamilyCheckInReport />;
}
