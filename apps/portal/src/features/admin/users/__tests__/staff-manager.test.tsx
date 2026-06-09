import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StaffRow } from '@cmt/shared-domain';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

const { mockGrant, mockRevoke, mockList } = vi.hoisted(() => ({
  mockGrant: vi.fn(),
  mockRevoke: vi.fn(),
  mockList: vi.fn(),
}));
vi.mock('../users-client', () => ({
  grantRoleClient: mockGrant,
  revokeRoleClient: mockRevoke,
  listStaffClient: mockList,
}));

import { StaffManager } from '../staff-manager';

// N=2: a dual-role admin+welcome-team person AND a teacher with two levels.
const DUAL: StaffRow = {
  key: 'CMT-FAM1-01',
  mid: 'CMT-FAM1-01',
  fid: 'CMT-FAM1',
  uid: null,
  name: 'Asha Rao',
  contact: 'asha@example.com',
  roles: ['admin', 'welcome-team'],
  isTeacher: false,
  teacherLevels: [],
  source: 'family',
};

const TEACHER: StaffRow = {
  key: 'CMT-FAM2-02',
  mid: 'CMT-FAM2-02',
  fid: 'CMT-FAM2',
  uid: null,
  name: 'Ravi Kumar',
  contact: 'ravi@example.com',
  roles: [],
  isTeacher: true,
  teacherLevels: ['Level 2 (West)', 'Level 3 (West)'],
  source: 'family',
};

const PLAIN_ADMIN: StaffRow = {
  key: 'uid-staff',
  mid: null,
  fid: null,
  uid: 'uid-staff',
  name: 'Staff Person',
  contact: 'staff@example.com',
  roles: ['admin'],
  isTeacher: false,
  teacherLevels: [],
  source: 'staff',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([DUAL, TEACHER, PLAIN_ADMIN]);
});

describe('StaffManager — role badges (N=2)', () => {
  it('renders BOTH chips for a dual-role admin + welcome-team person', () => {
    render(<StaffManager initialStaff={[DUAL]} />);
    // Rendered in both desktop and mobile branches (DOM-hidden via CSS, both present).
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Welcome team').length).toBeGreaterThan(0);
    // The dual person's name shows.
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0);
  });

  it('renders the teacher badge with its level names', () => {
    render(<StaffManager initialStaff={[TEACHER]} />);
    expect(screen.getAllByText('Teacher').length).toBeGreaterThan(0);
    // Levels join into the badge text.
    expect(screen.getAllByText(/Level 2 \(West\), Level 3 \(West\)/).length).toBeGreaterThan(0);
  });

  it('shows the "Manage as teacher" deep link for a teacher row', () => {
    render(<StaffManager initialStaff={[TEACHER]} />);
    const links = screen.getAllByText('Manage as teacher →');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.closest('a')?.getAttribute('href')).toBe('/admin/levels');
  });
});

describe('StaffManager — grant/revoke', () => {
  it('grants welcome-team to a row that lacks it', async () => {
    const user = userEvent.setup();
    mockGrant.mockResolvedValue(undefined);
    render(<StaffManager initialStaff={[TEACHER]} />);
    // TEACHER has no roles → both grant buttons present. Click "Grant welcome team".
    const btn = screen.getAllByText('Grant welcome team')[0]!;
    await user.click(btn);
    expect(mockGrant).toHaveBeenCalledWith({ contact: 'ravi@example.com', role: 'welcome-team' });
  });

  it('surfaces the last-admin 409 as an error toast on revoke', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockRevoke.mockRejectedValue(new Error('last-admin'));
    render(<StaffManager initialStaff={[PLAIN_ADMIN]} />);
    const btn = screen.getAllByText('Revoke admin')[0]!;
    await user.click(btn);
    expect(mockRevoke).toHaveBeenCalledWith({ contact: 'staff@example.com', role: 'admin' });
    // Wait a microtask for the rejection to settle.
    await screen.findAllByText('Revoke admin');
    expect(toastMock.error).toHaveBeenCalledWith(
      'Cannot revoke the last admin — grant another admin first.',
    );
  });
});

describe('StaffManager — filter + search', () => {
  it('filters to teachers only', async () => {
    const user = userEvent.setup();
    render(<StaffManager initialStaff={[DUAL, TEACHER, PLAIN_ADMIN]} />);
    // Desktop filter bar is one of the "Teachers" chips.
    await user.click(screen.getAllByText('Teachers')[0]!);
    // Ravi (teacher) stays; Asha (no teacher) filtered out in the desktop list.
    const desktop = document.querySelector('.hidden.md\\:block') as HTMLElement;
    expect(within(desktop).queryByText('Ravi Kumar')).toBeTruthy();
    expect(within(desktop).queryByText('Asha Rao')).toBeNull();
  });

  it('searches by contact', async () => {
    const user = userEvent.setup();
    render(<StaffManager initialStaff={[DUAL, TEACHER]} />);
    const desktop = document.querySelector('.hidden.md\\:block') as HTMLElement;
    const input = within(desktop).getByLabelText('Search staff');
    await user.type(input, 'ravi@');
    expect(within(desktop).queryByText('Ravi Kumar')).toBeTruthy();
    expect(within(desktop).queryByText('Asha Rao')).toBeNull();
  });
});
