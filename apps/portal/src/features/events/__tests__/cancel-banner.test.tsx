import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CancelBanner } from '../cancel-banner';

describe('CancelBanner', () => {
  it('renders payment cancelled text', () => {
    render(<CancelBanner />);
    expect(screen.getByText('Payment Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/retry your payment/i)).toBeInTheDocument();
  });
});
