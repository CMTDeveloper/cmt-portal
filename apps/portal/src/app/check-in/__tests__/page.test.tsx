import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CheckInPage from '../page';

describe('/check-in placeholder', () => {
  it('renders the ComingSoon component with "Family Check-in" label', () => {
    render(<CheckInPage />);
    expect(screen.getByRole('heading', { name: 'Family Check-in' })).toBeDefined();
  });

  it('renders a back link to the home page', () => {
    render(<CheckInPage />);
    const backLink = screen.getByRole('link', { name: /back to portal home/i });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});
