import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestList } from '../guest-list';

const guests = [
  {
    id: 'g1',
    firstName: 'Carol',
    lastName: 'Visitor',
    email: 'c@v.com',
    phone: '+16475550100',
    numberOfAdults: 2,
    numberOfChildren: 1,
    checkedInAt: '2026-04-13T14:00:00Z',
  },
];

describe('GuestList', () => {
  it('renders guests in a table', () => {
    render(<GuestList guests={guests} />);
    // Rendered in both the mobile card list and the desktop table, so match all.
    expect(screen.getAllByText(/carol/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/c@v.com/)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/2 adults/i)[0]).toBeInTheDocument();
  });
  it('shows empty state', () => {
    render(<GuestList guests={[]} />);
    expect(screen.getByText(/no guests/i)).toBeInTheDocument();
  });
});
