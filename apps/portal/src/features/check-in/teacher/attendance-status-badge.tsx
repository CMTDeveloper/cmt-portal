import type { AttendanceStatus } from '@cmt/shared-domain/check-in';

const palette: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  absent: 'bg-red-100 text-red-900 border-red-300',
  late: 'bg-amber-100 text-amber-900 border-amber-300',
  uninformed: 'bg-slate-200 text-slate-900 border-slate-400',
};

const labels: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  uninformed: 'Uninformed',
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      {labels[status]}
    </span>
  );
}
