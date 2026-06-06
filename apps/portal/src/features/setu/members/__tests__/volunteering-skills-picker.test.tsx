import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VolunteeringSkillsPicker } from '../volunteering-skills-picker';

function mockFetchOptions(options: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VolunteeringSkillsPicker', () => {
  it('renders the admin options once fetched', async () => {
    mockFetchOptions(['Teaching', 'AV / Tech']);
    render(<VolunteeringSkillsPicker value={[]} onChange={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Teaching' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AV / Tech' })).toBeInTheDocument();
  });

  it('selecting an option calls onChange with it added', async () => {
    mockFetchOptions(['Teaching']);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VolunteeringSkillsPicker value={[]} onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'Teaching' }));
    expect(onChange).toHaveBeenCalledWith(['Teaching']);
  });

  it('deselecting a selected option removes it', async () => {
    mockFetchOptions(['Teaching']);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VolunteeringSkillsPicker value={['Teaching']} onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'Teaching' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('keeps a pre-existing value that is not in the admin list (no data loss)', async () => {
    mockFetchOptions(['Teaching']);
    render(<VolunteeringSkillsPicker value={['Legacy Skill']} onChange={() => {}} />);
    const chip = await screen.findByRole('button', { name: 'Legacy Skill' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an empty-state message when no options exist and none are selected', async () => {
    mockFetchOptions([]);
    render(<VolunteeringSkillsPicker value={[]} onChange={() => {}} />);
    expect(await screen.findByText(/no volunteering options have been set up/i)).toBeInTheDocument();
  });
});
