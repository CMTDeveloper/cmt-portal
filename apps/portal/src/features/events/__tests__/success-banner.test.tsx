import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessBanner } from '../success-banner';

describe('SuccessBanner', () => {
  it('renders payment confirmed text', () => {
    render(<SuccessBanner />);
    expect(screen.getByText('Payment Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/registration is complete/i)).toBeInTheDocument();
  });
});
