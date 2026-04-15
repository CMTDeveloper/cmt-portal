import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceReportTable } from '../attendance-report-table';
import type { TeacherReportEntry } from '@cmt/shared-domain/check-in';

const entries: TeacherReportEntry[] = [
  { date: '2026-04-13', classId: 'K', sid: '1', firstName: 'Alice', lastName: 'Acme', status: 'present' },
  { date: '2026-04-13', classId: 'K', sid: '2', firstName: 'Bob', lastName: 'Bravo', status: 'late' },
];

describe('AttendanceReportTable', () => {
  it('renders a row per entry', () => {
    render(<AttendanceReportTable entries={entries} />);
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });
  it('shows empty state when no entries', () => {
    render(<AttendanceReportTable entries={[]} />);
    expect(screen.getByText(/no records/i)).toBeInTheDocument();
  });
});
