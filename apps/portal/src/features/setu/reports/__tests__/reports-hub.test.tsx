import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type {
  EnrollmentReport,
  AttendanceReport,
  DonationsReport,
} from '@cmt/shared-domain';

// vi.hoisted so the (hoisted) vi.mock factory can reference the mock.
const { fetchReport } = vi.hoisted(() => ({ fetchReport: vi.fn() }));
vi.mock('../reports-client', () => ({ fetchReport }));

import { ReportsHub } from '../reports-hub';

const enrollment: EnrollmentReport = {
  byProgram: [
    // issue #23: only the bala-vihar group carries the confirmed/registered split
    // (confirmed + registered === families); other programs omit them.
    { programKey: 'bala-vihar', programLabel: 'Bala Vihar', families: 13, members: 18, confirmed: 7, registered: 6 },
    { programKey: 'tabla', programLabel: 'Tabla', families: 4, members: 5 },
  ],
  byLevel: [
    { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', members: 9 },
    { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar', members: 9 },
  ],
  totalActiveEnrollments: 16,
  totalMembers: 23,
};

const attendance: AttendanceReport = {
  byLevel: [
    { levelId: 'l1', levelName: 'Level 1', programKey: 'bala-vihar', present: 9, absent: 1, total: 10, rate: 0.9 },
    { levelId: 'l2', levelName: 'Level 2', programKey: 'bala-vihar', present: 5, absent: 2, total: 7, rate: 0.714 },
  ],
  byProgram: [
    { programKey: 'bala-vihar', programLabel: 'bala-vihar', present: 14, absent: 3, total: 17, rate: 0.823 },
  ],
  from: '2025-06-09',
  to: '2026-06-09',
  totalEvents: 17,
};

const donations: DonationsReport = {
  byPeriod: [
    { pid: 'p1', label: 'BV 2025-26', programLabel: 'Bala Vihar', completedCAD: 500, completedCount: 5 },
    { pid: 'p2', label: 'Tabla 2025', programLabel: 'Tabla', completedCAD: 200, completedCount: 2 },
  ],
  byProgram: [
    { programKey: 'bala-vihar', programLabel: 'Bala Vihar', completedCAD: 500, completedCount: 5 },
    { programKey: 'tabla', programLabel: 'Tabla', completedCAD: 200, completedCount: 2 },
  ],
  paidFamilies: 5,
  outstandingFamilies: 3,
  totalCompletedCAD: 700,
};

// Resolve each report by the kind the card requests.
function routeByKind(kind: string) {
  if (kind === 'enrollment') return Promise.resolve(enrollment);
  if (kind === 'attendance') return Promise.resolve(attendance);
  if (kind === 'donations') return Promise.resolve(donations);
  return Promise.reject(new Error(`unexpected-kind-${kind}`));
}

beforeEach(() => {
  fetchReport.mockReset();
  fetchReport.mockImplementation((kind: string) => routeByKind(kind));
});

// NOTE: ReportsHub renders BOTH a mobile (`block md:hidden`) and a desktop
// (`hidden md:block`) branch — CSS media queries don't apply in jsdom, so every
// element appears twice. We use the repo's dual-branch convention
// (getAllBy*/findAllBy* + `.length`).
describe('ReportsHub', () => {
  it('renders the enrollment card with mocked summary data', async () => {
    render(<ReportsHub isAdmin={false} />);
    expect(screen.getAllByTestId('report-card-enrollment').length).toBeGreaterThanOrEqual(1);
    // Program row + total chips load from the mocked report.
    expect((await screen.findAllByText('Bala Vihar')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/16/)).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the confirmed/registered split — numbers on the BV row, em-dash on others', async () => {
    render(<ReportsHub isAdmin={false} />);
    // Wait for the enrollment report to resolve (the split lives in the same
    // "By program" table as the "Bala Vihar" label).
    await screen.findAllByText('Bala Vihar');
    // BV program row carries the split. Dual mobile+desktop branch ⇒ each ≥1.
    expect((await screen.findAllByText('7')).length).toBeGreaterThanOrEqual(1); // confirmed
    expect((await screen.findAllByText('6')).length).toBeGreaterThanOrEqual(1); // registered
    // The non-BV (Tabla) program row omits the split ⇒ the em-dash empty cells.
    expect((await screen.findAllByText('—')).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the attendance card with a from/to range and rolled-up rows', async () => {
    render(<ReportsHub isAdmin={false} />);
    expect(screen.getAllByTestId('report-card-attendance').length).toBeGreaterThanOrEqual(1);
    // Level rows render once the attendance report resolves.
    expect((await screen.findAllByText('Level 1')).length).toBeGreaterThanOrEqual(1);
    // Rate rendered as a percentage.
    expect((await screen.findAllByText(/90%/)).length).toBeGreaterThanOrEqual(1);
  });

  it('renders the donations + legacy cards when isAdmin is true', async () => {
    render(<ReportsHub isAdmin />);
    expect(screen.getAllByTestId('report-card-donations').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('report-card-legacy').length).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(screen.getAllByText(/BV 2025-26/).length).toBeGreaterThanOrEqual(1),
    );
  });

  it('hides the donations + legacy cards when isAdmin is false', () => {
    render(<ReportsHub isAdmin={false} />);
    expect(screen.queryByTestId('report-card-donations')).toBeNull();
    expect(screen.queryByTestId('report-card-legacy')).toBeNull();
  });
});
