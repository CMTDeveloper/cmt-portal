import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// The panel calls these client wrappers; mock the -client module (never the
// server fn) per repo rule. All four are declared - the reused
// AssignTeacherPopover imports searchTeachersClient.
const clientMock = vi.hoisted(() => ({
  searchTeachersClient: vi.fn(),
  addLevelTeacherClient: vi.fn(),
  removeLevelTeacherClient: vi.fn(),
  setLevelLeadTeacherClient: vi.fn(),
}));
vi.mock('../assign-teacher-client', () => clientMock);

import { LevelDetailPanel } from '../level-detail-panel';
import type { LevelRow, LevelTeacher } from '../levels-table';

const NOW = new Date().toISOString();

const M1 = 'CMT-AAAA1111-01';
const M2 = 'CMT-BBBB2222-01';

const LEVEL: LevelRow = {
  levelId: 'brampton-level-2-bv-brampton-2025-26',
  programKey: 'bala-vihar',
  location: 'Brampton',
  levelName: 'Level 2',
  levelKind: 'level',
  order: 4,
  gradeBand: ['2', '3'],
  ageLabel: 'Grade 2 & 3',
  curriculum: 'Hanuman',
  pid: 'bv-brampton-2025-26',
  periodLabel: '2025-26',
  teacherRefs: [M1, M2],
  leadTeacherRef: M1, // Meera is the Lead; Anil is the Assistant.
  enabled: true,
  createdAt: NOW,
  createdBy: 'admin',
  updatedAt: NOW,
  updatedBy: 'admin',
};

const TEACHERS: LevelTeacher[] = [
  { mid: M1, name: 'Meera Rao' },
  { mid: M2, name: 'Anil Kumar' },
];

function noop() {}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LevelDetailPanel', () => {
  it('renders an empty-state prompt when no level is selected', () => {
    render(
      <LevelDetailPanel
        level={null}
        teachers={[]}
        onTeacherAdded={noop}
        onTeacherRemoved={noop}
        onLeadChanged={noop}
      />,
    );
    expect(screen.getByText(/select a level/i)).toBeTruthy();
  });

  it('shows a Lead badge on the lead and Assistant on the others', () => {
    render(
      <LevelDetailPanel
        level={LEVEL}
        teachers={TEACHERS}
        onTeacherAdded={noop}
        onTeacherRemoved={noop}
        onLeadChanged={noop}
      />,
    );
    expect(screen.getByText('Meera Rao')).toBeTruthy();
    expect(screen.getByText('Anil Kumar')).toBeTruthy();
    // One Lead Teacher badge (Meera), one Assistant Teacher badge (Anil).
    expect(screen.getByText('Lead Teacher')).toBeTruthy();
    expect(screen.getByText('Assistant Teacher')).toBeTruthy();
  });

  it('promotes the assistant when "Make Lead" is clicked', async () => {
    clientMock.setLevelLeadTeacherClient.mockResolvedValue(undefined);
    const onLeadChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <LevelDetailPanel
        level={LEVEL}
        teachers={TEACHERS}
        onTeacherAdded={noop}
        onTeacherRemoved={noop}
        onLeadChanged={onLeadChanged}
      />,
    );

    // Only the assistant (Anil) exposes a "Make Lead" control - the current lead's is hidden.
    await user.click(screen.getByRole('button', { name: /make lead/i }));

    await waitFor(() =>
      expect(clientMock.setLevelLeadTeacherClient).toHaveBeenCalledWith(LEVEL.levelId, M2),
    );
    await waitFor(() => expect(onLeadChanged).toHaveBeenCalledWith(M2));
  });

  it('removes a teacher when its × is clicked', async () => {
    clientMock.removeLevelTeacherClient.mockResolvedValue(undefined);
    const onTeacherRemoved = vi.fn();
    const user = userEvent.setup();
    render(
      <LevelDetailPanel
        level={LEVEL}
        teachers={TEACHERS}
        onTeacherAdded={noop}
        onTeacherRemoved={onTeacherRemoved}
        onLeadChanged={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Anil Kumar' }));

    await waitFor(() =>
      expect(clientMock.removeLevelTeacherClient).toHaveBeenCalledWith(LEVEL.levelId, M2),
    );
    await waitFor(() => expect(onTeacherRemoved).toHaveBeenCalledWith(M2));
  });

  it('clears the lead when the lead teacher is removed', async () => {
    clientMock.removeLevelTeacherClient.mockResolvedValue(undefined);
    const onTeacherRemoved = vi.fn();
    const onLeadChanged = vi.fn();
    const user = userEvent.setup();
    render(
      <LevelDetailPanel
        level={LEVEL}
        teachers={TEACHERS}
        onTeacherAdded={noop}
        onTeacherRemoved={onTeacherRemoved}
        onLeadChanged={onLeadChanged}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove Meera Rao' }));

    await waitFor(() =>
      expect(clientMock.removeLevelTeacherClient).toHaveBeenCalledWith(LEVEL.levelId, M1),
    );
    await waitFor(() => expect(onTeacherRemoved).toHaveBeenCalledWith(M1));
    // Meera was the Lead - the panel mirrors the server's clear-on-lead-removal.
    await waitFor(() => expect(onLeadChanged).toHaveBeenCalledWith(null));
  });

  it('hides the interactive controls when readOnly', () => {
    render(
      <LevelDetailPanel
        level={LEVEL}
        teachers={TEACHERS}
        readOnly
        onTeacherAdded={noop}
        onTeacherRemoved={noop}
        onLeadChanged={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /make lead/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^remove /i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add teacher/i })).toBeNull();
  });
});
