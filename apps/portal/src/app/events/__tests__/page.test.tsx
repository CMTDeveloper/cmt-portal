import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventsPage from '../page';

describe('/events placeholder', () => {
  it('renders the ComingSoon component with "Events" label', () => {
    render(<EventsPage />);
    expect(screen.getByRole('heading', { name: 'Events' })).toBeDefined();
  });

  it('renders a back link to the home page', () => {
    render(<EventsPage />);
    const backLink = screen.getByRole('link', { name: /back to portal home/i });
    expect(backLink.getAttribute('href')).toBe('/');
  });
});
