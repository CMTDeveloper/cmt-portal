import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChildProfile, ChildProfileProgram, ChildProgramAttendance } from '../get-child-profile';

vi.mock('@cmt/ui', () => ({
  SetuIcon: new Proxy({}, { get: () => () => <span data-testid="icon" /> }),
  SetuAvatar: ({ name }: { name?: string }) => <div data-testid="avatar" aria-label={name} />,
}));

import { ChildProfileView } from '../child-profile-view';

function makeMarks(n: number, present = true): { date: string; present: boolean }[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2025-09-${String(i + 1).padStart(2, '0')}`, present }));
}

const teacherAtt: ChildProgramAttendance = {
  mode: 'teacher', available: true, attended: 9, total: 10, attendedPct: 90, marks: makeMarks(10), note: null,
};
const checkInAtt: ChildProgramAttendance = {
  mode: 'check-in', available: true, attended: 18, total: 20, attendedPct: 90, marks: makeMarks(20), note: null,
};
const noneAtt: ChildProgramAttendance = {
  mode: 'none', available: false, attended: 0, total: 0, attendedPct: 0, marks: [], note: null,
};

function makeProgram(over: Partial<ChildProfileProgram> = {}): ChildProfileProgram {
  return {
    eid: 'e1', programKey: 'bala-vihar', label: 'Bala Vihar', term: '2025–26', location: 'Brampton',
    status: 'active', attendance: teacherAtt, ...over,
  };
}

function makeProfile(over: Partial<ChildProfile> = {}): ChildProfile {
  return {
    mid: 'CMT-FAM1-03', fid: 'CMT-FAM1', firstName: 'Anaya', lastName: 'Patel',
    type: 'Child', schoolGrade: 'Grade 5', birthMonthYear: '2015-03', foodAllergies: null,
    programs: [
      makeProgram({ eid: 'e1', label: 'Bala Vihar', programKey: 'bala-vihar', attendance: teacherAtt }),
      makeProgram({ eid: 'e2', label: 'Tabla', programKey: 'tabla', attendance: checkInAtt }),
      makeProgram({ eid: 'e3', label: 'Gita Chanting', programKey: 'gita', attendance: noneAtt }),
    ],
    pastPrograms: [],
    achievements: [],
    stats: { programCount: 3, overallAttendedPct: 90, hasAnyAttendance: true },
    ...over,
  };
}

describe('ChildProfileView', () => {
  it('renders identity: name, Child · Grade 5 sub-line, and MID', () => {
    render(<ChildProfileView profile={makeProfile()} />);
    expect(screen.getByText('Anaya Patel')).toBeTruthy();
    expect(screen.getByText(/Child · Grade 5/)).toBeTruthy();
    expect(screen.getByText(/MID CMT-FAM1-03/)).toBeTruthy();
  });

  it('shows quick stats with program count and overall %', () => {
    render(<ChildProfileView profile={makeProfile()} />);
    expect(screen.getByText(/3 programs/)).toBeTruthy();
    expect(screen.getByText(/90% attendance/)).toBeTruthy();
  });

  it('drops the % attendance clause when there is no attendance', () => {
    render(<ChildProfileView profile={makeProfile({
      programs: [makeProgram({ attendance: noneAtt })],
      stats: { programCount: 1, overallAttendedPct: 0, hasAnyAttendance: false },
    })} />);
    expect(screen.getByText(/1 program/)).toBeTruthy();
    expect(screen.queryByText(/% attendance/)).toBeNull();
  });

  it('renders all three program labels with term and a status indicator', () => {
    render(<ChildProfileView profile={makeProfile()} />);
    expect(screen.getByText('Bala Vihar')).toBeTruthy();
    expect(screen.getByText('Tabla')).toBeTruthy();
    expect(screen.getByText('Gita Chanting')).toBeTruthy();
    // term appears at least once
    expect(screen.getAllByText(/2025–26/).length).toBeGreaterThan(0);
    // status indicator(s)
    expect(screen.getAllByText('active').length).toBe(3);
  });

  it('renders attendance summaries and heatmap cells for teacher + check-in programs', () => {
    render(<ChildProfileView profile={makeProfile()} />);
    expect(screen.getByText(/9 of 10/)).toBeTruthy();
    expect(screen.getByText(/18 of 20/)).toBeTruthy();
    expect(screen.getAllByText(/90%/).length).toBeGreaterThanOrEqual(2);
    // 10 teacher cells + 20 check-in cells = 30
    expect(screen.getAllByTestId('att-cell').length).toBe(30);
  });

  it('shows the no-attendance message and no heatmap for a none-mode program', () => {
    render(<ChildProfileView profile={makeProfile({
      programs: [makeProgram({ label: 'Gita Chanting', programKey: 'gita', attendance: noneAtt })],
      stats: { programCount: 1, overallAttendedPct: 0, hasAnyAttendance: false },
    })} />);
    expect(screen.getByText(/No attendance for this program/i)).toBeTruthy();
    expect(screen.queryAllByTestId('att-cell').length).toBe(0);
  });

  it('shows a program note when attendance.note is set', () => {
    const noteAtt: ChildProgramAttendance = {
      mode: 'check-in', available: false, attended: 0, total: 0, attendedPct: 0, marks: [],
      note: "Attendance isn't linked for this member yet.",
    };
    render(<ChildProfileView profile={makeProfile({
      programs: [makeProgram({ attendance: noteAtt })],
      stats: { programCount: 1, overallAttendedPct: 0, hasAnyAttendance: false },
    })} />);
    expect(screen.getByText(/Attendance isn't linked for this member yet\./)).toBeTruthy();
  });

  it('renders an Edit details link when editHref is provided', () => {
    render(<ChildProfileView profile={makeProfile()} editHref="/family/members/CMT-FAM1-03/edit" />);
    const link = screen.getByRole('link', { name: /Edit details/i });
    expect(link.getAttribute('href')).toBe('/family/members/CMT-FAM1-03/edit');
  });

  it('omits the Edit details link when editHref is not provided', () => {
    render(<ChildProfileView profile={makeProfile()} />);
    expect(screen.queryByRole('link', { name: /Edit details/i })).toBeNull();
  });

  it('shows an empty state with an enroll link when there are no programs', () => {
    render(<ChildProfileView profile={makeProfile({
      programs: [],
      stats: { programCount: 0, overallAttendedPct: 0, hasAnyAttendance: false },
    })} />);
    expect(screen.getByText(/not enrolled/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /enroll/i });
    expect(link.getAttribute('href')).toBe('/family/enroll');
  });

  it('renders a Past programs disclosure listing past program labels', () => {
    render(<ChildProfileView profile={makeProfile({
      pastPrograms: [makeProgram({ eid: 'p1', label: 'Sanskrit 101', programKey: 'sanskrit', status: 'cancelled', attendance: noneAtt })],
    })} />);
    const details = screen.getByText(/Past programs/i);
    expect(details).toBeTruthy();
    expect(screen.getByText(/Sanskrit 101/)).toBeTruthy();
  });
});
