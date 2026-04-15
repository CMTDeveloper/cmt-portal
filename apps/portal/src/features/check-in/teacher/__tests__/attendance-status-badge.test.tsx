import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceStatusBadge } from '../attendance-status-badge';

describe('AttendanceStatusBadge', () => {
  it('renders present', () => {
    render(<AttendanceStatusBadge status="present" />);
    expect(screen.getByText(/present/i)).toBeInTheDocument();
  });
  it('renders absent', () => {
    render(<AttendanceStatusBadge status="absent" />);
    expect(screen.getByText(/absent/i)).toBeInTheDocument();
  });
  it('renders late', () => {
    render(<AttendanceStatusBadge status="late" />);
    expect(screen.getByText(/late/i)).toBeInTheDocument();
  });
  it('renders uninformed', () => {
    render(<AttendanceStatusBadge status="uninformed" />);
    expect(screen.getByText(/uninformed/i)).toBeInTheDocument();
  });
});
