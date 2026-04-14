import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamilyDashboard } from '../family-dashboard';
import type { FamilyDashboardResponse } from '@cmt/shared-domain/check-in';

const data: FamilyDashboardResponse = {
  family: {
    fid: '42',
    name: 'Acme',
    paymentStatus: 'unpaid',
    contacts: [],
    students: [
      { sid: '1', fid: '42', firstName: 'Alice', lastName: 'Acme', level: 'K' },
      { sid: '2', fid: '42', firstName: 'Bob', lastName: 'Acme', level: '1' },
    ],
  },
  recentCheckIns: [
    {
      checkInId: 'ci-1',
      sid: '1',
      firstName: 'Alice',
      lastName: 'Acme',
      status: 'present',
      checkedInAt: '2026-04-10T14:00:00Z',
      checkedInBy: 'sevak',
    },
  ],
  paymentStatus: 'unpaid',
};

describe('FamilyDashboard', () => {
  it('renders family name', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
  });

  it('lists every student', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getAllByText(/alice/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/bob/i)).toBeInTheDocument();
  });

  it('shows unpaid banner when payment status is unpaid', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getByText(/payment.*pending|unpaid/i)).toBeInTheDocument();
  });

  it('lists recent check-ins', () => {
    render(<FamilyDashboard data={data} />);
    expect(screen.getAllByText(/alice/i).length).toBeGreaterThan(1);
  });
});
