import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../page';

describe('Landing page', () => {
  it('renders the heading', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { name: /Chinmaya Mission Toronto/i, level: 1 })).toBeDefined();
  });

  it('renders all four feature cards as links', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /events/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /family check.in/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /teacher portal/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /admin dashboard/i })).toBeDefined();
  });

  it('event card links to /events', () => {
    render(<HomePage />);
    const eventsLink = screen.getByRole('link', { name: /events/i });
    expect(eventsLink.getAttribute('href')).toBe('/events');
  });

  it('family check-in card links to /login/family', () => {
    render(<HomePage />);
    const checkInLink = screen.getByRole('link', { name: /family check.in/i });
    expect(checkInLink.getAttribute('href')).toBe('/login/family');
  });

  it('teacher portal card links to /login/teacher', () => {
    render(<HomePage />);
    const teacherLink = screen.getByRole('link', { name: /teacher portal/i });
    expect(teacherLink.getAttribute('href')).toBe('/login/teacher');
  });

  it('admin dashboard card links to /login/admin', () => {
    render(<HomePage />);
    const adminLink = screen.getByRole('link', { name: /admin dashboard/i });
    expect(adminLink.getAttribute('href')).toBe('/login/admin');
  });
});
