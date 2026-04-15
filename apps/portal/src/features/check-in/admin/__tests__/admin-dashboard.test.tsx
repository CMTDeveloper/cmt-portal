import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminDashboard } from '../admin-dashboard';

describe('AdminDashboard', () => {
  it('renders four stat cards', () => {
    render(
      <AdminDashboard
        stats={{ checkInsToday: 12, checkInsThisWeek: 40, guestsToday: 3, unpaidFamilies: 5 }}
      />,
    );
    expect(screen.getByText(/check-ins today/i)).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText(/this week/i)).toBeInTheDocument();
    expect(screen.getByText(/40/)).toBeInTheDocument();
    expect(screen.getByText(/guests today/i)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getAllByText(/unpaid/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('renders nav links to users, guests, unpaid, reports', () => {
    render(
      <AdminDashboard
        stats={{ checkInsToday: 0, checkInsThisWeek: 0, guestsToday: 0, unpaidFamilies: 0 }}
      />,
    );
    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/check-in/admin/users');
    expect(screen.getByRole('link', { name: /guests/i })).toHaveAttribute('href', '/check-in/admin/guests');
    expect(screen.getByRole('link', { name: /unpaid/i })).toHaveAttribute('href', '/check-in/admin/unpaid');
    expect(screen.getByRole('link', { name: /reports/i })).toHaveAttribute('href', '/check-in/admin/reports');
  });
});
