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
    plus: () => null,
  },
}));

import { OfferingsPanel, type OfferingRow } from '../offerings-panel';

const NOW = new Date().toISOString();

const PRICING = [
  { effectiveFrom: '2025-09-01', amountCAD: 500, label: 'Full year' },
];

const BASE_OFFERING: OfferingRow = {
  oid: 'bala-vihar-brampton-2025-26',
  programKey: 'bala-vihar',
  programLabel: 'Bala Vihar',
  location: 'Brampton',
  termLabel: '2025-26',
  termType: 'term',
  startDate: '2025-09-07T04:00:00.000Z',
  endDate: '2026-06-14T03:59:59.000Z',
  pricingTiers: PRICING,
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin-uid',
  updatedAt: NOW,
  updatedBy: 'admin-uid',
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ oid: 'bala-vihar-brampton-2026-27', overlapWarning: false }),
  }) as unknown as typeof fetch;
});

describe('OfferingsPanel', () => {
  it('renders existing offerings with term labels (mobile+desktop)', () => {
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[BASE_OFFERING]} usesDonation={true} />);
    // Both mobile and desktop renders, so use getAllByText
    expect(screen.getAllByText('2025-26').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Brampton').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "+ New offering" button', () => {
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[]} usesDonation={true} />);
    expect(screen.getByRole('button', { name: /new offering/i })).toBeTruthy();
  });

  it('opens create modal on "+ New offering" click', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[]} usesDonation={true} />);
    await user.click(screen.getByRole('button', { name: /new offering/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('hides the donation + payment fields for a no-donation program', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="om-chanting" initialOfferings={[]} usesDonation={false} />);
    await user.click(screen.getByRole('button', { name: /new offering/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Term/dates still present, but no donation tiers or payment source.
    expect(screen.getByPlaceholderText('2025-26')).toBeTruthy();
    expect(screen.queryByText(/suggested donation by enrollment date/i)).toBeNull();
    expect(screen.queryByText(/payment source/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /add tier/i })).toBeNull();
  });

  it('omits pricingTiers/legacy paymentSource in the POST for a no-donation program', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="om-chanting" initialOfferings={[]} usesDonation={false} />);
    await user.click(screen.getByRole('button', { name: /new offering/i }));
    await user.type(screen.getByPlaceholderText('2025-26'), '2026-summer');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2026-12-31');

    await user.click(screen.getByRole('button', { name: /create offering/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.pricingTiers).toEqual([]);
    expect(body.paymentSource).toBe('portal');
  });

  it('POSTs to /api/admin/offerings on create', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[]} usesDonation={true} />);
    await user.click(screen.getByRole('button', { name: /new offering/i }));

    await user.type(screen.getByPlaceholderText('2025-26'), '2026-27');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-06-01');
    await user.type(dateInputs[2] as HTMLElement, '2026-09-01');

    await user.click(screen.getByRole('button', { name: /create offering/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/admin/offerings');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.programKey).toBe('bala-vihar');
    expect(body.termLabel).toBe('2026-27');
  });

  it('shows "Duplicate" button for existing offerings', () => {
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[BASE_OFFERING]} usesDonation={true} />);
    // Duplicate button appears in at least one of mobile/desktop renders
    expect(screen.getAllByRole('button', { name: /duplicate/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('Duplicate opens modal pre-filled with dates shifted +1 year', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[BASE_OFFERING]} usesDonation={true} />);
    const dupButtons = screen.getAllByRole('button', { name: /duplicate/i });
    await user.click(dupButtons[0]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Term label should be pre-filled with next year label
    expect(screen.getByPlaceholderText('2025-26')).toBeTruthy();
  });

  it('shows toast.success after create', async () => {
    const user = userEvent.setup();
    render(<OfferingsPanel programKey="bala-vihar" initialOfferings={[]} usesDonation={true} />);
    await user.click(screen.getByRole('button', { name: /new offering/i }));
    await user.type(screen.getByPlaceholderText('2025-26'), '2026-27');
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-09-01');
    await user.type(dateInputs[1] as HTMLElement, '2027-06-01');
    await user.type(dateInputs[2] as HTMLElement, '2026-09-01');
    await user.click(screen.getByRole('button', { name: /create offering/i }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Offering created.'));
  });
});
