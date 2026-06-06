import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({ toast: toastMock }));

// Stub the picker with a button that adds 'Teaching', so the test can drive
// selection without the real picker's mount-fetch.
vi.mock('@/features/setu/members/volunteering-skills-picker', () => ({
  VolunteeringSkillsPicker: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <button type="button" data-testid="add-teaching" onClick={() => onChange([...value, 'Teaching'])}>
      add Teaching ({value.length})
    </button>
  ),
}));

const saveMock = vi.hoisted(() => vi.fn());
const dismissMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/setu/members/volunteering-skills-client', () => ({
  saveVolunteeringSkills: saveMock,
  dismissVolunteeringSkillsNudge: dismissMock,
}));

import { VolunteeringSkillsNudge } from '../volunteering-skills-nudge';

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockResolvedValue({ ok: true });
  dismissMock.mockResolvedValue({ ok: true });
});

describe('VolunteeringSkillsNudge', () => {
  it('disables Save until at least one skill is selected', () => {
    render(<VolunteeringSkillsNudge mid="CMT-AB12CD34-02" />);
    expect(screen.getByRole('button', { name: /save skills/i })).toBeDisabled();
  });

  it('saves the selected skills via the self-edit PATCH wrapper, then hides', async () => {
    const user = userEvent.setup();
    render(<VolunteeringSkillsNudge mid="CMT-AB12CD34-02" />);
    await user.click(screen.getByTestId('add-teaching'));
    await user.click(screen.getByRole('button', { name: /save skills/i }));
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith('CMT-AB12CD34-02', ['Teaching']);
    });
    // hides after a successful save
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /save skills/i })).not.toBeInTheDocument();
    });
  });

  it('toasts and stays visible when the save fails', async () => {
    saveMock.mockResolvedValue({ ok: false, error: 'bad-request' });
    const user = userEvent.setup();
    render(<VolunteeringSkillsNudge mid="CMT-AB12CD34-02" />);
    await user.click(screen.getByTestId('add-teaching'));
    await user.click(screen.getByRole('button', { name: /save skills/i }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /save skills/i })).toBeInTheDocument();
  });

  it('"Not now" dismisses via the wrapper and hides', async () => {
    const user = userEvent.setup();
    render(<VolunteeringSkillsNudge mid="CMT-AB12CD34-02" />);
    await user.click(screen.getByRole('button', { name: /not now/i }));
    await waitFor(() => expect(dismissMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /not now/i })).not.toBeInTheDocument();
  });
});
