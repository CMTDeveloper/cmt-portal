import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const navigateTo = vi.fn();
vi.mock('@/features/setu/members/navigate-to', () => ({ navigateTo: (p: string) => navigateTo(p) }));
const accept = vi.fn();
vi.mock('../disclaimers-client', () => ({ acceptDisclaimersClient: () => accept() }));
vi.mock('@cmt/ui', () => ({
  SetuLogo: () => null,
  toast: { error: vi.fn() },
}));
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DisclaimerAcceptForm } from '../components/disclaimer-accept-form';

const SECTIONS = [
  { id: 'a', title: 'Alpha', body: '• A body' },
  { id: 'b', title: 'Beta', body: '• B body' },
];
const INTRO = 'Hari Om!\nRead the pledge here: https://chinmayatoronto.org/cmpledge';
const ACK = 'I confirm that I have read and agree to follow the values.';

beforeEach(() => { navigateTo.mockReset(); accept.mockReset(); accept.mockResolvedValue(undefined); });

describe('DisclaimerAcceptForm', () => {
  it('renders every section title + body, the intro, and the acknowledgement', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('• B body')).toBeInTheDocument();
    expect(screen.getByText(/Hari Om!/)).toBeInTheDocument();
    expect(screen.getByText(ACK)).toBeInTheDocument();
  });

  it('turns the pledge URL in the intro into a link', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    const link = screen.getByRole('link', { name: /chinmayatoronto\.org\/cmpledge/ });
    expect(link).toHaveAttribute('href', 'https://chinmayatoronto.org/cmpledge');
  });

  it('has a checkbox on EVERY section (Vaibhav)', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    expect(screen.getByTestId('disclaimer-check-a')).toBeInTheDocument();
    expect(screen.getByTestId('disclaimer-check-b')).toBeInTheDocument();
    // No single combined acknowledgement checkbox anymore.
    expect(screen.queryByTestId('disclaimer-ack-checkbox')).toBeNull();
  });

  it('shows a validation error (and does NOT submit) when "I Acknowledge" is clicked with any section unticked', async () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    const btn = screen.getByTestId('disclaimers-accept');
    expect(btn).toHaveTextContent('I Acknowledge');
    expect(screen.queryByTestId('disclaimer-ack-error')).toBeNull();

    // Tick only ONE of the two sections, then submit.
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    fireEvent.click(btn);
    expect(screen.getByTestId('disclaimer-ack-error')).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();

    // Ticking the remaining section clears the error.
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    expect(screen.queryByTestId('disclaimer-ack-error')).toBeNull();
  });

  it('acknowledges then hard-navigates to /family once every section is checked', async () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    fireEvent.click(screen.getByTestId('disclaimers-accept'));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });
});
