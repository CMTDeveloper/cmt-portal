/**
 * Render tests for /family/programs (Phase F3).
 * Server page — tested via async component render.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/server', () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@cmt/ui', () => ({
  SetuIcon: { back: () => <span>back</span> },
  SetuLogo: () => null,
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockListPrograms = vi.fn();
const mockGetOpenOfferingsForFamily = vi.fn();
const mockGetCurrentFamily = vi.fn();
const mockGetEnrollments = vi.fn();

vi.mock('@/features/setu/programs/get-programs', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
}));
vi.mock('@/features/setu/enrollment/get-open-offerings', () => ({
  getOpenOfferingsForFamily: (...args: unknown[]) => mockGetOpenOfferingsForFamily(...args),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...args: unknown[]) => mockGetEnrollments(...args),
}));
vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: (...args: unknown[]) => mockGetCurrentFamily(...args),
}));

import ProgramsPage from '../page';

const FAMILY = {
  fid: 'CMT-AAAA1111',
  location: 'Brampton',
  legacyFid: null,
};

const BV_PROGRAM = {
  programKey: 'bala-vihar',
  label: 'Bala Vihar',
  shortDescription: 'Sunday school for children',
  status: 'active',
  locations: ['Brampton'],
  termType: 'term',
  eligibility: { memberType: 'child' },
  capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
  displayOrder: 0,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

const TABLA_PROGRAM = {
  programKey: 'tabla',
  label: 'Tabla',
  shortDescription: 'Rhythm and percussion for all ages',
  status: 'active',
  locations: [],
  termType: 'rolling',
  eligibility: { memberType: 'any' },
  capabilities: { usesOfferings: true, usesDonation: false, usesLevels: false, usesCalendar: false, attendanceMode: 'none' },
  displayOrder: 1,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

const BV_OFFERING = {
  oid: 'bv-brampton-fall-2026',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  termLabel: 'Fall 2026',
  termType: 'term',
  startDate: new Date('2026-09-07'),
  endDate: new Date('2027-01-25'),
  pricingTiers: [],
  enabled: true,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

const TABLA_OFFERING = {
  oid: 'tabla-rolling-2026',
  programKey: 'tabla',
  programLabel: 'Tabla',
  location: null,
  termLabel: 'Rolling 2026',
  termType: 'rolling',
  startDate: new Date('2026-09-01'),
  endDate: null,
  pricingTiers: [],
  enabled: true,
  createdAt: new Date(),
  createdBy: 'admin',
  updatedAt: new Date(),
  updatedBy: 'admin',
};

beforeEach(() => {
  mockGetCurrentFamily.mockResolvedValue({ family: FAMILY, members: [], isManager: true });
  mockListPrograms.mockResolvedValue([BV_PROGRAM]);
  mockGetOpenOfferingsForFamily.mockResolvedValue([BV_OFFERING]);
  mockGetEnrollments.mockResolvedValue([]);
});

describe('ProgramsPage', () => {
  it('lists active programs with open offerings', async () => {
    const page = await ProgramsPage();
    render(page);

    expect(screen.getAllByText('Bala Vihar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Sunday school for children').length).toBeGreaterThanOrEqual(1);
  });

  it('each program links to /family/enroll/[programKey]', async () => {
    const page = await ProgramsPage();
    render(page);

    // Mobile + desktop render both enroll links — use getAllByRole
    const links = screen.getAllByRole('link', { name: /enroll/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/family/enroll/bala-vihar');
  });

  it('shows multiple programs when available', async () => {
    mockListPrograms.mockResolvedValue([BV_PROGRAM, TABLA_PROGRAM]);
    mockGetOpenOfferingsForFamily
      .mockResolvedValueOnce([BV_OFFERING])
      .mockResolvedValueOnce([TABLA_OFFERING]);

    const page = await ProgramsPage();
    render(page);

    expect(screen.getAllByText('Bala Vihar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tabla').length).toBeGreaterThanOrEqual(1);

    const links = screen.getAllByRole('link', { name: /enroll/i });
    expect(links.length).toBeGreaterThanOrEqual(2);

    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/family/enroll/bala-vihar');
    expect(hrefs).toContain('/family/enroll/tabla');
  });

  it('shows empty state when no programs have open offerings', async () => {
    mockGetOpenOfferingsForFamily.mockResolvedValue([]);

    const page = await ProgramsPage();
    render(page);

    expect(screen.queryByRole('link', { name: /enroll/i })).toBeNull();
    expect(screen.getAllByText(/no programs available/i).length).toBeGreaterThanOrEqual(1);
  });

  it('handles session expired gracefully', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);

    const page = await ProgramsPage();
    render(page);

    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows an enrolled state (not "Enroll →") for a program the family is already in', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'CMT-AAAA1111-bv-brampton-fall-2026', status: 'active', programKey: 'bala-vihar', oid: 'bv-brampton-fall-2026', termLabel: 'Fall 2026' },
    ]);

    const page = await ProgramsPage();
    render(page);

    expect(screen.getAllByText(/enrolled/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Enroll →')).toBeNull();
  });
});
