import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirectMock(...a) }));
vi.mock('next/server', () => ({ connection: vi.fn(async () => undefined) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@cmt/ui', () => ({
  SetuIcon: { back: () => <span>back</span> },
  Rosette: () => <div />,
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/family/components/donate-form', () => ({
  DonateForm: (props: { mode: string }) => <div data-testid="donate-form">donate-form:{props.mode}</div>,
}));

const mockGetCurrentFamily = vi.fn();
const mockGetEnrollments = vi.fn();
vi.mock('@/features/setu/members/get-current-family', () => ({
  getCurrentFamily: (...a: unknown[]) => mockGetCurrentFamily(...a),
}));
vi.mock('@/features/setu/enrollment/get-enrollments', () => ({
  getEnrollments: (...a: unknown[]) => mockGetEnrollments(...a),
}));

import DonatePage from '../page';

const FAMILY = { family: { fid: 'fid1', location: 'Brampton' }, members: [], isManager: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentFamily.mockResolvedValue(FAMILY);
  mockGetEnrollments.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe('DonatePage — flag gate', () => {
  it('redirects to /family/enroll when flag is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'false');
    await DonatePage({ searchParams: Promise.resolve({}) });
    expect(redirectMock).toHaveBeenCalledWith('/family/enroll');
  });

  it('redirects when flag is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', '');
    await DonatePage({ searchParams: Promise.resolve({}) });
    expect(redirectMock).toHaveBeenCalledWith('/family/enroll');
  });
});

describe('DonatePage — flag on', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true'));

  it('renders the general donate form when no eid', async () => {
    const page = await DonatePage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(/donate-form:general/).length).toBeGreaterThan(0);
  });

  it('renders the enrollment donate form when a valid active eid is given', async () => {
    mockGetEnrollments.mockResolvedValue([
      { eid: 'fid1-oid1', status: 'active', programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', effectiveSuggestedAmount: 500, offering: { programKey: 'bala-vihar', programLabel: 'Bala Vihar', termLabel: 'Fall 2026', amountTiers: [500, 750] } },
    ]);
    const page = await DonatePage({ searchParams: Promise.resolve({ eid: 'fid1-oid1' }) });
    render(page);
    expect(screen.getAllByText(/donate-form:enrollment/).length).toBeGreaterThan(0);
  });

  it('falls back to general giving when the eid is stale/unknown', async () => {
    mockGetEnrollments.mockResolvedValue([]);
    const page = await DonatePage({ searchParams: Promise.resolve({ eid: 'missing' }) });
    render(page);
    expect(screen.getAllByText(/donate-form:general/).length).toBeGreaterThan(0);
  });

  it('shows the manager-only message to a non-manager', async () => {
    mockGetCurrentFamily.mockResolvedValue({ ...FAMILY, isManager: false });
    const page = await DonatePage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(screen.getAllByText(/only the family manager/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('donate-form')).toBeNull();
  });

  it('shows session-expired when no family', async () => {
    mockGetCurrentFamily.mockResolvedValue(null);
    const page = await DonatePage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(screen.getByText(/session expired/i)).toBeTruthy();
  });
});
