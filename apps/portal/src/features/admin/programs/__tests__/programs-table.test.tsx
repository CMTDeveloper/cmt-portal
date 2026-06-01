'use client';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/programs' }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: {
    check: () => null, edit: () => null, back: () => null, people: () => null,
    home: () => null, receipt: () => null, calendar: () => null, search: () => null,
    dots: () => null, user: () => null, shield: () => null, chevron: () => null,
    plus: () => null,
  },
  SetuAvatar: () => null,
  SetuLogo: () => null,
}));

import { ProgramsTable, type ProgramRow } from '../programs-table';

const NOW = new Date().toISOString();

const BASE_PROGRAM: ProgramRow = {
  programKey: 'bala-vihar',
  label: 'Bala Vihar',
  shortDescription: 'Sunday Bala Vihar classes',
  status: 'active',
  locations: ['Brampton', 'Mississauga'],
  termType: 'term',
  eligibility: { memberType: 'child' },
  capabilities: {
    usesOfferings: true,
    usesDonation: true,
    usesLevels: true,
    usesCalendar: true,
    attendanceMode: 'check-in',
  },
  displayOrder: 0,
  createdAt: NOW,
  createdBy: 'admin',
  updatedAt: NOW,
  updatedBy: 'admin',
};

const DRAFT_PROGRAM: ProgramRow = {
  ...BASE_PROGRAM,
  programKey: 'tabla',
  label: 'Tabla',
  shortDescription: 'Tabla drumming classes',
  status: 'draft',
  locations: [],
  eligibility: { memberType: 'any' },
  capabilities: {
    usesOfferings: true,
    usesDonation: false,
    usesLevels: false,
    usesCalendar: false,
    attendanceMode: 'none',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ programKey: 'new-program' }),
  }) as unknown as typeof fetch;
});

describe('ProgramsTable', () => {
  it('renders program rows with status badges (mobile+desktop)', () => {
    render(<ProgramsTable initialPrograms={[BASE_PROGRAM, DRAFT_PROGRAM]} />);
    // Both mobile and desktop render, so use getAllByText
    expect(screen.getAllByText('Bala Vihar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tabla').length).toBeGreaterThanOrEqual(1);
    // Status badges
    expect(screen.getAllByText('active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('draft').length).toBeGreaterThanOrEqual(1);
  });

  it('flags an active program with no open offerings as hidden from families', () => {
    render(<ProgramsTable initialPrograms={[{ ...BASE_PROGRAM, programKey: 'tabla', label: 'Tabla', openOfferingCount: 0 }]} />);
    expect(screen.getAllByText(/no open offerings/i).length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag an active program that has open offerings', () => {
    render(<ProgramsTable initialPrograms={[{ ...BASE_PROGRAM, openOfferingCount: 2 }]} />);
    expect(screen.queryAllByText(/no open offerings/i).length).toBe(0);
  });

  it('does not flag a draft program (its status already conveys hidden)', () => {
    render(<ProgramsTable initialPrograms={[{ ...DRAFT_PROGRAM, openOfferingCount: 0 }]} />);
    expect(screen.queryAllByText(/no open offerings/i).length).toBe(0);
  });

  it('shows "+ New program" button', () => {
    render(<ProgramsTable initialPrograms={[]} />);
    expect(screen.getByRole('button', { name: /new program/i })).toBeTruthy();
  });

  it('opens create modal on "+ New program" click', async () => {
    const user = userEvent.setup();
    render(<ProgramsTable initialPrograms={[]} />);
    await user.click(screen.getByRole('button', { name: /new program/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/program key/i)).toBeTruthy();
  });

  it('POSTs to /api/admin/programs on create', async () => {
    const user = userEvent.setup();
    render(<ProgramsTable initialPrograms={[]} />);
    await user.click(screen.getByRole('button', { name: /new program/i }));

    await user.type(screen.getByLabelText(/^label$/i), 'Tabla');
    await user.type(screen.getByLabelText(/program key/i), 'tabla');

    await user.click(screen.getByRole('button', { name: /create program/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/programs');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.label).toBe('Tabla');
    expect(body.programKey).toBe('tabla');
  });

  it('shows toast.success after create', async () => {
    const user = userEvent.setup();
    render(<ProgramsTable initialPrograms={[]} />);
    await user.click(screen.getByRole('button', { name: /new program/i }));
    await user.type(screen.getByLabelText(/^label$/i), 'OM Chanting');
    await user.type(screen.getByLabelText(/program key/i), 'om-chanting');
    await user.click(screen.getByRole('button', { name: /create program/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Program created.'));
  });

  it('shows toast.error on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'bad-request' }),
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ProgramsTable initialPrograms={[]} />);
    await user.click(screen.getByRole('button', { name: /new program/i }));
    await user.type(screen.getByLabelText(/^label$/i), 'Test');
    await user.type(screen.getByLabelText(/program key/i), 'test');
    await user.click(screen.getByRole('button', { name: /create program/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('bad-request'));
  });
});
