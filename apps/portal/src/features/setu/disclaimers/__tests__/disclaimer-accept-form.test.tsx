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
  { id: 'a', title: 'Alpha', body: 'A body' },
  { id: 'b', title: 'Beta', body: 'B body' },
];

beforeEach(() => { navigateTo.mockReset(); accept.mockReset(); accept.mockResolvedValue(undefined); });

describe('DisclaimerAcceptForm', () => {
  it('renders every section title + body', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('B body')).toBeInTheDocument();
  });

  it('keeps the continue button disabled until every box is checked', () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    const btn = screen.getByTestId('disclaimers-accept');
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    expect(btn).toBeEnabled();
  });

  it('accepts then hard-navigates to /family', async () => {
    render(<DisclaimerAcceptForm sections={SECTIONS} />);
    fireEvent.click(screen.getByTestId('disclaimer-check-a'));
    fireEvent.click(screen.getByTestId('disclaimer-check-b'));
    fireEvent.click(screen.getByTestId('disclaimers-accept'));
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/family'));
  });
});
