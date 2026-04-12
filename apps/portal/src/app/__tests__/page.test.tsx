import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../page';

describe('Landing page', () => {
  it('renders the heading', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /Chinmaya Mission Toronto/i, level: 1 })).toBeDefined();
  });

  it('renders both feature cards as links', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /events/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /check.in/i })).toBeDefined();
  });

  it('event card links to /events', () => {
    render(<HomePage />);
    const eventsLink = screen.getByRole('link', { name: /events/i });
    expect(eventsLink.getAttribute('href')).toBe('/events');
  });

  it('check-in card links to /check-in', () => {
    render(<HomePage />);
    const checkInLink = screen.getByRole('link', { name: /check.in/i });
    expect(checkInLink.getAttribute('href')).toBe('/check-in');
  });
});
