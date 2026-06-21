import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SevakRow } from '@cmt/shared-domain';

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
  listSevaksClient: mockList,
}));

import { SevakManager } from '../sevak-manager';

// N=2: a dual-role admin+welcome-team person AND a teacher with two levels.
const DUAL: SevakRow = {
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

const TEACHER: SevakRow = {
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

const PLAIN_ADMIN: SevakRow = {
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

describe('SevakManager — role badges (N=2)', () => {
  it('renders BOTH chips for a dual-role admin + welcome-team person', () => {
    render(<SevakManager initialSevaks={[DUAL]} />);
    // Rendered in both desktop and mobile branches (DOM-hidden via CSS, both present).
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Welcome team').length).toBeGreaterThan(0);
    // The dual person's name shows.
    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0);
  });

  it('renders the teacher badge with its level names', () => {
    render(<SevakManager initialSevaks={[TEACHER]} />);
    expect(screen.getAllByText('Teacher').length).toBeGreaterThan(0);
    // Levels join into the badge text.
    expect(screen.getAllByText(/Level 2 \(West\), Level 3 \(West\)/).length).toBeGreaterThan(0);
  });

  it('shows the "Manage as teacher" deep link for a teacher row', () => {
    render(<SevakManager initialSevaks={[TEACHER]} />);
    const links = screen.getAllByText('Manage as teacher →');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.closest('a')?.getAttribute('href')).toBe('/admin/levels');
  });
});

describe('SevakManager — edit-mode workflow', () => {
  // Scope assertions to the desktop branch so the duplicated mobile DOM (both
  // branches render; CSS hides one) doesn't double-match "Edit roles" etc.
  function desktop() {
    return document.querySelector('.hidden.md\\:block') as HTMLElement;
  }

  it('default view exposes NO grant/revoke controls — only an Edit roles button', () => {
    render(<SevakManager initialSevaks={[PLAIN_ADMIN]} />);
    const d = within(desktop());
    // The cramped one-click grant/revoke buttons are gone from the read-only view.
    expect(d.queryByText(/^Grant /)).toBeNull();
    expect(d.queryByText(/^Revoke /)).toBeNull();
    // A single deliberate entry point is present instead.
    expect(d.getByRole('button', { name: 'Edit roles for Staff Person' })).toBeTruthy();
  });

  it('clicking Edit roles reveals role checkboxes pre-checked to current state', async () => {
    const user = userEvent.setup();
    render(<SevakManager initialSevaks={[DUAL]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Asha Rao' }));
    // DUAL has admin + welcome-team → both checkboxes checked.
    const admin = d.getByRole('checkbox', { name: /Admin/ }) as HTMLInputElement;
    const welcome = d.getByRole('checkbox', { name: /Welcome team/ }) as HTMLInputElement;
    expect(admin.checked).toBe(true);
    expect(welcome.checked).toBe(true);
    // Entering edit mode alone must not call any mutation endpoint.
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('toggling a role + Save issues exactly the changed grant/revoke calls', async () => {
    const user = userEvent.setup();
    mockGrant.mockResolvedValue(undefined);
    mockRevoke.mockResolvedValue(undefined);
    // DUAL = admin + welcome-team. We will: uncheck admin (revoke), leave
    // welcome-team (no-op). Only one revoke call must fire.
    render(<SevakManager initialSevaks={[DUAL]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Asha Rao' }));
    await user.click(d.getByRole('checkbox', { name: /Admin/ }));
    await user.click(d.getByRole('button', { name: 'Save role changes for Asha Rao' }));

    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith({ contact: 'asha@example.com', role: 'admin' });
    // welcome-team was left checked → no grant, and admin's only the revoke.
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it('granting a new role via Save issues a single grant call', async () => {
    const user = userEvent.setup();
    mockGrant.mockResolvedValue(undefined);
    // TEACHER has no grantable roles. Check welcome-team, then Save.
    render(<SevakManager initialSevaks={[TEACHER]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Ravi Kumar' }));
    await user.click(d.getByRole('checkbox', { name: /Welcome team/ }));
    await user.click(d.getByRole('button', { name: 'Save role changes for Ravi Kumar' }));

    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith({ contact: 'ravi@example.com', role: 'welcome-team' });
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('Cancel discards the draft and makes NO grant/revoke calls', async () => {
    const user = userEvent.setup();
    render(<SevakManager initialSevaks={[DUAL]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Asha Rao' }));
    // Toggle both roles off in the draft...
    await user.click(d.getByRole('checkbox', { name: /Admin/ }));
    await user.click(d.getByRole('checkbox', { name: /Welcome team/ }));
    // ...then Cancel — nothing should be persisted.
    await user.click(d.getByRole('button', { name: 'Cancel editing roles for Asha Rao' }));

    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    // Back to read-only: the Edit button is shown again, checkboxes gone.
    expect(d.getByRole('button', { name: 'Edit roles for Asha Rao' })).toBeTruthy();
    expect(d.queryByRole('checkbox', { name: /Admin/ })).toBeNull();
  });

  it('Save with no changes makes no calls and returns to read-only', async () => {
    const user = userEvent.setup();
    render(<SevakManager initialSevaks={[DUAL]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Asha Rao' }));
    // No toggles — Save immediately.
    await user.click(d.getByRole('button', { name: 'Save role changes for Asha Rao' }));
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(d.getByRole('button', { name: 'Edit roles for Asha Rao' })).toBeTruthy();
  });

  it('surfaces the last-admin 409 as an error toast when Save revokes the last admin', async () => {
    const user = userEvent.setup();
    mockRevoke.mockRejectedValue(new Error('last-admin'));
    render(<SevakManager initialSevaks={[PLAIN_ADMIN]} />);
    const d = within(desktop());
    await user.click(d.getByRole('button', { name: 'Edit roles for Staff Person' }));
    // Uncheck admin → Save attempts a revoke that the API rejects.
    await user.click(d.getByRole('checkbox', { name: /Admin/ }));
    await user.click(d.getByRole('button', { name: 'Save role changes for Staff Person' }));

    expect(mockRevoke).toHaveBeenCalledWith({ contact: 'staff@example.com', role: 'admin' });
    // Wait for the rejection to settle (re-renders the Save button back to idle).
    await d.findByRole('button', { name: 'Save role changes for Staff Person' });
    expect(toastMock.error).toHaveBeenCalledWith(
      'Cannot revoke the last admin — grant another admin first.',
    );
    // State is reloaded so the UI reflects the server's actual (unchanged) roles.
    expect(mockList).toHaveBeenCalled();
  });
});

describe('SevakManager — filter + search', () => {
  it('filters to teachers only', async () => {
    const user = userEvent.setup();
    render(<SevakManager initialSevaks={[DUAL, TEACHER, PLAIN_ADMIN]} />);
    // Desktop filter bar is one of the "Teachers" chips.
    await user.click(screen.getAllByText('Teachers')[0]!);
    // Ravi (teacher) stays; Asha (no teacher) filtered out in the desktop list.
    const desktop = document.querySelector('.hidden.md\\:block') as HTMLElement;
    expect(within(desktop).queryByText('Ravi Kumar')).toBeTruthy();
    expect(within(desktop).queryByText('Asha Rao')).toBeNull();
  });

  it('searches by contact', async () => {
    const user = userEvent.setup();
    render(<SevakManager initialSevaks={[DUAL, TEACHER]} />);
    const desktop = document.querySelector('.hidden.md\\:block') as HTMLElement;
    const input = within(desktop).getByLabelText('Search sevaks');
    await user.type(input, 'ravi@');
    expect(within(desktop).queryByText('Ravi Kumar')).toBeTruthy();
    expect(within(desktop).queryByText('Asha Rao')).toBeNull();
  });
});
