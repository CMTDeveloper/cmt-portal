import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeacherDashboard } from '../teacher-dashboard';

const classes = [
  { classId: 'K', name: 'Kindergarten', studentCount: 12 },
  { classId: 'G1', name: 'Grade 1', studentCount: 10 },
];

describe('TeacherDashboard', () => {
  it('renders a card per class', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByText(/kindergarten/i)).toBeInTheDocument();
    expect(screen.getByText(/grade 1/i)).toBeInTheDocument();
  });

  it('shows student counts', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('links each class to /check-in/teacher/attendance?classId=<id>', () => {
    render(<TeacherDashboard classes={classes} />);
    const kLink = screen.getByRole('link', { name: /kindergarten/i });
    expect(kLink).toHaveAttribute('href', '/check-in/teacher/attendance?classId=K');
  });

  it('has nav links to report and uninformed', () => {
    render(<TeacherDashboard classes={classes} />);
    expect(screen.getByRole('link', { name: /report/i })).toHaveAttribute(
      'href',
      '/check-in/teacher/report',
    );
    expect(screen.getByRole('link', { name: /uninformed/i })).toHaveAttribute(
      'href',
      '/check-in/teacher/uninformed',
    );
  });

  it('shows empty state when no classes', () => {
    render(<TeacherDashboard classes={[]} />);
    expect(screen.getByText(/no classes/i)).toBeInTheDocument();
  });
});
