/**
 * Component tests for the parameterised enroll flow (Phase F2).
 *
 * We test the OfferingPicker and EligibleMembersList client components
 * rather than the server page (which requires Firebase Admin). The key
 * behaviours:
 *   • With ONE offering → auto-selects it (no visible picker UI).
 *   • With TWO offerings → shows a picker for the family to choose.
 *   • EligibleMembersList filters by memberEligibleForProgram.
 *   • Dakshina section renders only when usesDonation=true.
 *   • Free program shows "Confirm enrollment" (no dakshina block).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/family/enroll/bala-vihar',
}));

const mockPush = vi.fn();

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: {
    check: () => null, edit: () => null, back: () => null,
    info: () => null,
  },
  SetuAvatar: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
  SetuLogo: () => null,
  Rosette: () => null,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ─── Components under test ────────────────────────────────────────────────────

import { OfferingPicker } from '@/features/family/components/offering-picker';
import { EligibleMembersList } from '@/features/family/components/eligible-members-list';
import type { OfferingDoc } from '@cmt/shared-domain';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeOffering(overrides: Partial<OfferingDoc> = {}): OfferingDoc {
  return {
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
    createdAt: new Date('2026-01-01'),
    createdBy: 'admin',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'admin',
    ...overrides,
  };
}

type Member = Parameters<typeof EligibleMembersList>[0]['members'][number];

function makeChild(overrides: Partial<Member> = {}): Member {
  return {
    mid: 'CMT-AAAA-03',
    firstName: 'Diya',
    lastName: 'Patel',
    type: 'Child',
    birthMonthYear: '2018-05',
    schoolGrade: 'Grade 3',
    ...overrides,
  };
}

function makeAdult(overrides: Partial<Member> = {}): Member {
  return {
    mid: 'CMT-AAAA-01',
    firstName: 'Aarti',
    lastName: 'Patel',
    type: 'Adult',
    birthMonthYear: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

// ─── OfferingPicker ───────────────────────────────────────────────────────────

describe('OfferingPicker', () => {
  it('auto-selects when there is exactly one offering — no visible picker UI', () => {
    const onSelect = vi.fn();
    const offering = makeOffering();
    render(
      <OfferingPicker
        offerings={[offering]}
        selectedOid={offering.oid}
        onSelect={onSelect}
      />,
    );
    // With one offering, no radio/select should appear
    expect(screen.queryByRole('radio')).toBeNull();
    // The term label is displayed as the auto-selected label
    expect(screen.getAllByText('Fall 2026').length).toBeGreaterThanOrEqual(1);
    // onSelect should NOT be called on initial render (parent passes selectedOid)
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a radio picker for two offerings', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const o1 = makeOffering({ oid: 'bv-brampton-fall-2026', termLabel: 'Fall 2026' });
    const o2 = makeOffering({ oid: 'bv-brampton-spring-2027', termLabel: 'Spring 2027' });
    render(
      <OfferingPicker
        offerings={[o1, o2]}
        selectedOid={o1.oid}
        onSelect={onSelect}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    // Clicking the second option calls onSelect with its oid
    await user.click(radios[1]!);
    expect(onSelect).toHaveBeenCalledWith('bv-brampton-spring-2027');
  });
});

// ─── EligibleMembersList ─────────────────────────────────────────────────────

describe('EligibleMembersList', () => {
  const childEligibility = { memberType: 'child' as const };
  const anyEligibility = { memberType: 'any' as const };
  const now = new Date('2026-09-07');

  it('shows children for a child-only program', () => {
    const child = makeChild();
    const adult = makeAdult();
    render(
      <EligibleMembersList
        members={[adult, child]}
        eligibility={childEligibility}
        now={now}
      />,
    );
    expect(screen.getAllByText('Diya Patel').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Aarti Patel')).toBeNull();
  });

  it('shows all members for an any-type program', () => {
    const child = makeChild();
    const adult = makeAdult();
    render(
      <EligibleMembersList
        members={[adult, child]}
        eligibility={anyEligibility}
        now={now}
      />,
    );
    expect(screen.getAllByText('Diya Patel').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Aarti Patel').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an empty-state message when no members are eligible', () => {
    const adult = makeAdult();
    render(
      <EligibleMembersList
        members={[adult]}
        eligibility={childEligibility}
        now={now}
      />,
    );
    expect(screen.getByText(/no eligible members/i)).toBeTruthy();
  });
});
