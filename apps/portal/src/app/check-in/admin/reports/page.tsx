import { notFound } from 'next/navigation';
import { ReportExportButton } from '@/features/check-in/admin/report-export-button';
import { flags } from '@/lib/flags';

export const metadata = { title: 'Reports — CMT Portal' };

export default function AdminReportsPage() {
  if (!flags.checkInAdmin) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Reports</h1>
      <div className="flex flex-wrap gap-3">
        <ReportExportButton kind="check-ins" label="Export check-ins CSV" />
        <ReportExportButton kind="guests" label="Export guests CSV" />
      </div>
    </main>
  );
}
