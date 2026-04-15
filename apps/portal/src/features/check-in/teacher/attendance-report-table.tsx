import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';
import { AttendanceStatusBadge } from './attendance-status-badge';

interface Props {
  entries: TeacherReportEntry[];
}

export function AttendanceReportTable({ entries }: Props) {
  if (entries.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">No records.</p>;
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">Date</th>
          <th className="p-2">Class</th>
          <th className="p-2">Student</th>
          <th className="p-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.date}-${e.classId}-${e.sid}`} className="border-b">
            <td className="p-2">{e.date}</td>
            <td className="p-2">{e.classId}</td>
            <td className="p-2">{e.firstName} {e.lastName}</td>
            <td className="p-2"><AttendanceStatusBadge status={e.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
