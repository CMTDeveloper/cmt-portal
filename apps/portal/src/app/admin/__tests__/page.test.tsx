import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminPage from '../page';

describe('AdminPage dashboard', () => {
  it('renders the four section headings', () => {
    render(<AdminPage />);
    expect(screen.getByRole('heading', { name: /people & access/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /bala vihar/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^reports$/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /legacy/i })).toBeTruthy();
  });

  it('keeps every tile reachable via a link with an href', () => {
    render(<AdminPage />);
    for (const href of ['/welcome', '/admin/users', '/admin/programs', '/admin/levels', '/admin/calendar', '/admin/school-year', '/admin/volunteering-skills', '/check-in/admin/reports']) {
      const links = screen.getAllByRole('link');
      expect(links.some((l) => l.getAttribute('href') === href)).toBe(true);
    }
  });
});
