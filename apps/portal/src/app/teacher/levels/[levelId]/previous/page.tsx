import { redirect } from 'next/navigation';

// Previous students moved INTO the attendance screen's inline "Not in this class
// yet" section (Vaibhav: one list, not several). This route now redirects there,
// preserving the date, so any bookmark / old link still lands somewhere useful.
export default async function PreviousStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ levelId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { levelId } = await params;
  const { date } = await searchParams;
  const q = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : '';
  redirect(`/teacher/levels/${levelId}/attendance${q}`);
}
