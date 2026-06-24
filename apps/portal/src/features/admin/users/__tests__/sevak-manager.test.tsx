import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SevakRow } from '@cmt/shared-domain';
import { SevakManager, type SelfIdentity } from '../sevak-manager';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    plus: () => <svg aria-hidden="true" />,
    x: () => <svg aria-hidden="true" />,
    check: () => <svg aria-hidden="true" />,
  },
  toast: toastMock,
}));

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

// N=2: a dual-role admin+welcome-team person AND a teacher with two levels.
const DUAL: SevakRow = {
  key: 'CMT-FAM1-01', mid: 'CMT-FAM1-01', fid: 'CMT-FAM1', uid: null,
  name: 'Asha Rao', contact: 'asha@example.com', roles: ['admin', 'welcome-team'],
  isTeacher: false, teacherLevels: [], source: 'family', lastSignIn: '2026-06-22T14:00:00.000Z',
};
const TEACHER: SevakRow = {
  key: 'CMT-FAM2-02', mid: 'CMT-FAM2-02', fid: 'CMT-FAM2', uid: null,
  name: 'Ravi Kumar', contact: 'ravi@example.com', roles: [],
  isTeacher: true, teacherLevels: ['Level 2 (West)', 'Level 3 (West)'], source: 'family', lastSignIn: null,
};
const PLAIN_ADMIN: SevakRow = {
  key: 'uid-staff', mid: null, fid: null, uid: 'uid-staff',
  name: 'Staff Person', contact: 'staff@example.com', roles: ['admin'],
  isTeacher: false, teacherLevels: [], source: 'staff', lastSignIn: null,
};

const NO_SELF: SelfIdentity = { mid: null, uid: null, contact: '' };
function renderMgr(rows: SevakRow[], self: SelfIdentity = NO_SELF) {
  return render(<SevakManager initialSevaks={rows} self={self} />);
}
const desktop = () => document.querySelector('.hidden.md\\:block') as HTMLElement;
const drawer = () => screen.getByTestId('sevak-drawer');

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([DUAL, TEACHER, PLAIN_ADMIN]);
});

describe('SevakManager — rows + drawer', () => {
  it('opening a row shows its granted-role chips in the drawer (N=2 dual-role)', async () => {
    const user = userEvent.setup();
    renderMgr([DUAL]);
    await user.click(within(desktop()).getAllByTestId('sevak-row')[0]!);
    const d = within(drawer());
    // "Admin"/"Welcome team" appear as the granted-role chips (and again as
    // access-section headings) — both roles are represented in the drawer.
    expect(d.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(d.getAllByText('Welcome team').length).toBeGreaterThan(0);
    expect(d.getByText('Asha Rao')).toBeTruthy();
  });

  it('renders the teacher badge with its level names', () => {
    renderMgr([TEACHER]);
    expect(screen.getAllByText('Teacher').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Level 2 \(West\), Level 3 \(West\)/).length).toBeGreaterThan(0);
  });

  it('shows the "Manage as teacher" deep link in a teacher\'s drawer', async () => {
    const user = userEvent.setup();
    renderMgr([TEACHER]);
    await user.click(within(desktop()).getAllByTestId('sevak-row')[0]!);
    const link = within(drawer()).getByText('Manage as teacher →');
    expect(link.closest('a')?.getAttribute('href')).toBe('/admin/levels');
  });

  it('shows a Last sign-in date, and "Never" for someone who has not signed in', () => {
    renderMgr([DUAL, TEACHER]);
    const d = within(desktop());
    expect(d.getByText('Jun 22')).toBeTruthy(); // DUAL signed in 2026-06-22
    expect(d.getAllByText('Never').length).toBeGreaterThan(0); // TEACHER never
  });

  it('flags the viewer\'s own row with a "You" badge', () => {
    renderMgr([DUAL, PLAIN_ADMIN], { mid: 'CMT-FAM1-01', uid: null, contact: '' });
    // Asha is "me" → a You tag renders (desktop + mobile both in the DOM).
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
  });
});

describe('SevakManager — edit-then-save workflow', () => {
  async function openEdit(name: string) {
    const user = userEvent.setup();
    // Each row carries an "Edit roles" button → opens the drawer straight in edit mode.
    await user.click(within(desktop()).getByRole('button', { name: 'Edit roles' }));
    return { user, d: within(drawer()), name };
  }

  it('opens the Add-sevak dialog from the desktop action', async () => {
    const user = userEvent.setup();
    renderMgr([PLAIN_ADMIN]);
    expect(screen.queryByLabelText('Registered portal email')).toBeNull();
    await user.click(within(desktop()).getByRole('button', { name: 'Add sevak role' }));
    const dialog = screen.getByRole('dialog', { name: 'Add sevak role' });
    expect(within(dialog).getByLabelText('Registered portal email')).toBeTruthy();
  });

  it('shows a grant error INLINE in the Add dialog, never as a corner toast', async () => {
    mockGrant.mockRejectedValue(new Error('registered-user-required'));
    const user = userEvent.setup();
    renderMgr([PLAIN_ADMIN]);
    await user.click(within(desktop()).getByRole('button', { name: 'Add sevak role' }));
    const dialog = screen.getByRole('dialog', { name: 'Add sevak role' });
    await user.type(within(dialog).getByLabelText('Registered portal email'), '222@gmail.com');
    await user.click(within(dialog).getByRole('button', { name: /Grant role/ }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('This email is not registered in the portal');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('a row click opens a read-only drawer — no checkboxes, just an Edit roles button', async () => {
    const user = userEvent.setup();
    renderMgr([PLAIN_ADMIN]);
    await user.click(within(desktop()).getAllByTestId('sevak-row')[0]!);
    const d = within(drawer());
    expect(d.queryByRole('checkbox')).toBeNull();
    expect(d.getByRole('button', { name: 'Edit roles' })).toBeTruthy();
  });

  it('Edit roles reveals checkboxes pre-checked to the current state, with no mutation', async () => {
    renderMgr([DUAL]);
    const { d } = await openEdit('Asha Rao');
    expect((d.getByRole('checkbox', { name: /^Admin/ }) as HTMLInputElement).checked).toBe(true);
    expect((d.getByRole('checkbox', { name: /^Welcome team/ }) as HTMLInputElement).checked).toBe(true);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('toggling a role + Save issues exactly the changed revoke call', async () => {
    mockGrant.mockResolvedValue(undefined);
    mockRevoke.mockResolvedValue(undefined);
    renderMgr([DUAL]);
    const { user, d } = await openEdit('Asha Rao');
    await user.click(d.getByRole('checkbox', { name: /^Admin/ })); // uncheck admin → revoke
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith({ contact: 'asha@example.com', role: 'admin' });
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it('granting a new role via Save issues a single grant call', async () => {
    mockGrant.mockResolvedValue(undefined);
    renderMgr([TEACHER]);
    const { user, d } = await openEdit('Ravi Kumar');
    await user.click(d.getByRole('checkbox', { name: /^Welcome team/ }));
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledWith({ contact: 'ravi@example.com', role: 'welcome-team' });
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('Cancel discards the draft (no calls) and returns the drawer to read-only', async () => {
    renderMgr([DUAL]);
    const { user, d } = await openEdit('Asha Rao');
    await user.click(d.getByRole('checkbox', { name: /^Admin/ }));
    await user.click(d.getByRole('checkbox', { name: /^Welcome team/ }));
    await user.click(d.getByRole('button', { name: 'Cancel' }));
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(within(drawer()).queryByRole('checkbox')).toBeNull();
    expect(within(drawer()).getByRole('button', { name: 'Edit roles' })).toBeTruthy();
  });

  it('Save with no changes makes no calls and returns to read-only', async () => {
    renderMgr([DUAL]);
    const { user, d } = await openEdit('Asha Rao');
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(within(drawer()).getByRole('button', { name: 'Edit roles' })).toBeTruthy();
  });

  it('surfaces the last-admin 409 as an INLINE error (not a corner toast) and reloads state', async () => {
    mockRevoke.mockRejectedValue(new Error('last-admin'));
    renderMgr([PLAIN_ADMIN]);
    const { user, d } = await openEdit('Staff Person');
    await user.click(d.getByRole('checkbox', { name: /^Admin/ }));
    await user.click(d.getByRole('button', { name: 'Save changes' }));
    expect(mockRevoke).toHaveBeenCalledWith({ contact: 'staff@example.com', role: 'admin' });
    // The error shows inline in the drawer (role=alert), never as a toast.
    const alert = await within(drawer()).findByRole('alert');
    expect(alert.textContent).toContain('Cannot revoke the last admin — grant another admin first.');
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(mockList).toHaveBeenCalled();
  });
});

describe('SevakManager — filter + search + sort', () => {
  it('filters to teachers only', async () => {
    const user = userEvent.setup();
    renderMgr([DUAL, TEACHER, PLAIN_ADMIN]);
    await user.click(within(desktop()).getByRole('button', { name: 'Teachers' }));
    const d = within(desktop());
    expect(d.queryByText('Ravi Kumar')).toBeTruthy();
    expect(d.queryByText('Asha Rao')).toBeNull();
  });

  it('searches by contact', async () => {
    const user = userEvent.setup();
    renderMgr([DUAL, TEACHER]);
    const d = within(desktop());
    await user.type(d.getByLabelText('Search sevaks'), 'ravi@');
    expect(d.queryByText('Ravi Kumar')).toBeTruthy();
    expect(d.queryByText('Asha Rao')).toBeNull();
  });

  it('sorting by name toggles ascending/descending order', async () => {
    const user = userEvent.setup();
    renderMgr([PLAIN_ADMIN, DUAL]); // Staff Person, Asha Rao
    const d = within(desktop());
    const namesAsc = d.getAllByTestId('sevak-row').map((r) => within(r).getByText(/Rao|Person/).textContent);
    expect(namesAsc[0]).toBe('Asha Rao'); // default asc
    await user.click(d.getByRole('button', { name: /^Name/ }));
    const namesDesc = within(desktop()).getAllByTestId('sevak-row').map((r) => within(r).getByText(/Rao|Person/).textContent);
    expect(namesDesc[0]).toBe('Staff Person');
  });
});
