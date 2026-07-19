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

  it('has NO per-section checkboxes — a single acknowledgement gates the button', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    expect(screen.queryByTestId('disclaimer-check-a')).toBeNull();
    expect(screen.getByTestId('disclaimer-ack-checkbox')).toBeInTheDocument();
  });

  it('keeps the "I Acknowledge" button disabled until the single box is checked', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    const btn = screen.getByTestId('disclaimers-accept');
    expect(btn).toHaveTextContent('I Acknowledge');
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId('disclaimer-ack-checkbox'));
    expect(btn).toBeEnabled();
  });

  it('acknowledges then hard-navigates to /family', async () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} intro={INTRO} acknowledgement={ACK} />);
    fireEvent.click(screen.getByTestId('disclaimer-ack-checkbox'));
    fireEvent.click(screen.getByTestId('disclaimers-accept'));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });
});
