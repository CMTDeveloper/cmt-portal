import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// router.refresh() is fired after a successful save.
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

vi.mock('@cmt/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../set-grade-client', () => ({ setGradeClient: vi.fn() }));
vi.mock('../set-grade-staff-client', () => ({ setGradeStaffClient: vi.fn() }));

import { MemberGradeEditor } from '../member-grade-editor';
import { setGradeClient } from '../set-grade-client';
import { setGradeStaffClient } from '../set-grade-staff-client';
import { toast } from '@cmt/ui';

beforeEach(() => {
  mockRefresh.mockReset();
  vi.mocked(setGradeClient).mockReset();
  vi.mocked(setGradeStaffClient).mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

it('renders a grade select + Save and defaults to the member current ladder grade', () => {
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade="Grade 4" />);
  const select = screen.getByRole('combobox', { name: /grade for priya/i });
  // "Grade 4" normalizes to the "4" ladder rung and is pre-selected.
  expect((select as HTMLSelectElement).value).toBe('4');
  expect(screen.getByRole('button', { name: /save grade for priya/i })).toBeDefined();
});

it('falls back to the placeholder when the current grade is off-ladder or null', () => {
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} />);
  const select = screen.getByRole('combobox', { name: /grade for priya/i });
  expect((select as HTMLSelectElement).value).toBe('');
});

it('Save writes the chosen grade via setGradeClient, toasts, and refreshes', async () => {
  vi.mocked(setGradeClient).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} />);

  await user.selectOptions(screen.getByRole('combobox', { name: /grade for priya/i }), '5');
  await user.click(screen.getByRole('button', { name: /save grade for priya/i }));

  expect(setGradeClient).toHaveBeenCalledWith({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: '5' });
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('toasts an error and does NOT refresh when the client throws', async () => {
  vi.mocked(setGradeClient).mockRejectedValue(new Error('boom'));
  const user = userEvent.setup();
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade="Grade 1" />);

  await user.click(screen.getByRole('button', { name: /save grade for priya/i }));

  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(mockRefresh).not.toHaveBeenCalled();
});

it('Save is disabled when no grade is chosen', () => {
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} />);
  const save = screen.getByRole('button', { name: /save grade for priya/i });
  expect((save as HTMLButtonElement).disabled).toBe(true);
});

// ── Endpoint selection ────────────────────────────────────────────────────────
// set-grade-client.ts is shared with the /admin/school-year rollover preview.
// Changing that wrapper to reach the staff route would silently reroute admin
// rollover, so the component picks the endpoint instead.

it('saves through the STAFF client when staff is set', async () => {
  vi.mocked(setGradeStaffClient).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} staff />,
  );

  await user.selectOptions(screen.getByRole('combobox', { name: /grade for priya/i }), '5');
  await user.click(screen.getByRole('button', { name: /save grade for priya/i }));

  expect(setGradeStaffClient).toHaveBeenCalledWith({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: '5' });
  expect(setGradeClient).not.toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('saves through the ADMIN client by default, so the rollover preview is unaffected', async () => {
  vi.mocked(setGradeClient).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} />);

  await user.selectOptions(screen.getByRole('combobox', { name: /grade for priya/i }), '5');
  await user.click(screen.getByRole('button', { name: /save grade for priya/i }));

  expect(setGradeClient).toHaveBeenCalledWith({ fid: 'FAM001', mid: 'FAM001-02', schoolGrade: '5' });
  expect(setGradeStaffClient).not.toHaveBeenCalled();
});

it('labels the panel for the role that is actually using it', () => {
  const { unmount } = render(
    <MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} />,
  );
  expect(screen.getByText(/Admin · Set grade/i)).toBeDefined();
  unmount();

  render(<MemberGradeEditor fid="FAM001" mid="FAM001-02" childName="Priya" currentGrade={null} staff />);
  expect(screen.getByText(/Staff · Set grade/i)).toBeDefined();
});
