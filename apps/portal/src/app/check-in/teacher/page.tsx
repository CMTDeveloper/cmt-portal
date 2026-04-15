import { notFound } from 'next/navigation';
import { TeacherDashboard } from '@/features/check-in/teacher';
import { listClasses } from '@/features/check-in/shared';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Teacher — CMT Portal' };
export const dynamic = 'force-dynamic';

export default async function TeacherDashboardPage() {
  if (!flags.checkInTeacher) notFound();
  const classes = await listClasses();
  return <TeacherDashboard classes={classes} />;
}
