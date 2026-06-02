import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

import { CalendarEditor } from '../calendar-editor';
import type { ProgramRow } from '../../programs/programs-table';

const NOW = new Date().toISOString();

const PROGRAMS: ProgramRow[] = [
  {
    programKey: 'bala-vihar',
    label: 'Bala Vihar',
    shortDescription: '',
    status: 'active',
    locations: ['Brampton'],
    termType: 'term',
    eligibility: { memberType: 'child' },
    capabilities: { usesOfferings: true, usesDonation: true, usesLevels: true, usesCalendar: true, attendanceMode: 'check-in' },
    displayOrder: 0,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
  {
    programKey: 'tabla',
    label: 'Tabla',
    shortDescription: '',
    status: 'active',
    locations: [],
    termType: 'term',
    eligibility: { memberType: 'any' },
    // tabla does NOT use calendar
    capabilities: { usesOfferings: true, usesDonation: false, usesLevels: true, usesCalendar: false, attendanceMode: 'none' },
    displayOrder: 1,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
  {
    programKey: 'om-chanting',
    label: 'OM Chanting',
    shortDescription: '',
    status: 'active',
    locations: ['Brampton'],
    termType: 'term',
    eligibility: { memberType: 'any' },
    // a SECOND calendar-using program → can share a date with Bala Vihar
    capabilities: { usesOfferings: true, usesDonation: false, usesLevels: false, usesCalendar: true, attendanceMode: 'none' },
    displayOrder: 2,
    createdAt: NOW,
    createdBy: 'admin',
    updatedAt: NOW,
    updatedBy: 'admin',
  },
];

const NOW_ISO = NOW;
function entryFixture(programKey: string, specialEvents: string) {
  return {
    entryId: `${programKey}-brampton-2026-11-15`,
    programKey,
    location: 'Brampton',
    date: '2026-11-15',
    kind: 'class',
    classType: 'regular',
    noClassReason: null,
    specialEvents,
    enabled: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entries: [], rows: [] }),
  }) as unknown as typeof fetch;
});

describe('CalendarEditor — program filter', () => {
  it('renders a Program selector when programs prop is provided', () => {
    render(<CalendarEditor locations={['Brampton']} programs={PROGRAMS} />);
    expect(screen.getByLabelText(/program/i)).toBeTruthy();
  });

  it('only shows programs that usesCalendar', () => {
    render(<CalendarEditor locations={['Brampton']} programs={PROGRAMS} />);
    // Bala Vihar uses calendar; Tabla does not
    expect(screen.getByRole('option', { name: 'Bala Vihar' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Tabla' })).toBeNull();
  });

  it('defaults to bala-vihar when programs are provided', () => {
    render(<CalendarEditor locations={['Brampton']} programs={PROGRAMS} />);
    const select = screen.getByLabelText(/program/i) as HTMLSelectElement;
    expect(select.value).toBe('bala-vihar');
  });

  it('does NOT render program selector when programs prop absent', () => {
    render(<CalendarEditor locations={['Brampton']} />);
    expect(screen.queryByLabelText(/program/i)).toBeNull();
  });

  it('includes programKey in POST body for new calendar entries', async () => {
    const user = userEvent.setup();
    render(<CalendarEditor locations={['Brampton']} programs={PROGRAMS} />);

    // Wait for initial load
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    // Mock subsequent fetch for POST
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entryId: 'brampton-2026-09-06' }),
    });

    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    await user.type(dateInput, '2026-09-06');
    await user.click(screen.getByRole('button', { name: /add entry/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const allCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const postCall = allCalls.find(([, init]) => init.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall![1]).body as string);
    expect(body.programKey).toBe('bala-vihar');
  });

  it('shows only the selected program\'s entries (two programs, same date)', async () => {
    const user = userEvent.setup();
    // Location-wide GET returns BOTH programs' entries for the same date.
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/weekly')
            ? { rows: [] }
            : { entries: [entryFixture('bala-vihar', 'BV Diwali'), entryFixture('om-chanting', 'OM Session')] },
      }),
    ) as unknown as typeof fetch;

    render(<CalendarEditor locations={['Brampton']} programs={PROGRAMS} />);

    // Default selected program is bala-vihar → only its entry is listed.
    await waitFor(() => expect(screen.getAllByText('BV Diwali').length).toBeGreaterThan(0));
    expect(screen.queryByText('OM Session')).toBeNull();

    // Switch the program selector → list re-filters to OM Chanting only.
    await user.selectOptions(screen.getByLabelText('Program'), 'om-chanting');
    await waitFor(() => expect(screen.getAllByText('OM Session').length).toBeGreaterThan(0));
    expect(screen.queryByText('BV Diwali')).toBeNull();
  });
});
