import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/programs/bala-vihar' }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: {
    check: () => null, edit: () => null, back: () => null, people: () => null,
    home: () => null, receipt: () => null, calendar: () => null, search: () => null,
    dots: () => null, user: () => null, shield: () => null, chevron: () => null,
  },
}));

import { ProgramForm, type ProgramRow } from '../program-form';

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

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }) as unknown as typeof fetch;
});

describe('ProgramForm', () => {
  it('renders all key fields pre-filled from program', () => {
    render(<ProgramForm program={BASE_PROGRAM} />);
    expect((screen.getByLabelText(/^label$/i) as HTMLInputElement).value).toBe('Bala Vihar');
    expect((screen.getByLabelText(/short description/i) as HTMLInputElement).value).toBe('Sunday Bala Vihar classes');
  });

  it('PATCHes only changed fields on save', async () => {
    const user = userEvent.setup();
    render(<ProgramForm program={BASE_PROGRAM} />);

    const labelInput = screen.getByLabelText(/^label$/i);
    await user.clear(labelInput);
    await user.type(labelInput, 'Bala Vihar 2');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/programs/bala-vihar');
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.label).toBe('Bala Vihar 2');
    // unchanged fields should not be in the PATCH body
    expect(body.programKey).toBeUndefined();
  });

  it('shows toast.success after save', async () => {
    const user = userEvent.setup();
    render(<ProgramForm program={BASE_PROGRAM} />);
    const labelInput = screen.getByLabelText(/^label$/i);
    await user.clear(labelInput);
    await user.type(labelInput, 'Updated');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Program updated.'));
  });

  it('shows toast.error on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'server-error' }),
    }) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ProgramForm program={BASE_PROGRAM} />);
    const labelInput = screen.getByLabelText(/^label$/i);
    await user.clear(labelInput);
    await user.type(labelInput, 'X');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('server-error'));
  });
});
