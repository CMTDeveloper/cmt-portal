import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('@cmt/ui', () => ({
  toast: toastMock,
  SetuIcon: { x: () => <span>x</span> },
}));

import { SkillsEditor } from '../skills-editor';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkillsEditor', () => {
  it('renders the initial options as chips', () => {
    render(<SkillsEditor initialOptions={['Teaching', 'AV / Tech']} />);
    expect(screen.getByText('Teaching')).toBeInTheDocument();
    expect(screen.getByText('AV / Tech')).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no options', () => {
    render(<SkillsEditor initialOptions={[]} />);
    expect(screen.getByText(/no options yet/i)).toBeInTheDocument();
  });

  it('adds a new option', async () => {
    const user = userEvent.setup();
    render(<SkillsEditor initialOptions={[]} />);
    await user.type(screen.getByLabelText('New volunteering skill'), 'Photography');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Photography')).toBeInTheDocument();
  });

  it('rejects a duplicate option (case-insensitive) with a toast', async () => {
    const user = userEvent.setup();
    render(<SkillsEditor initialOptions={['Teaching']} />);
    await user.type(screen.getByLabelText('New volunteering skill'), 'teaching');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(toastMock.error).toHaveBeenCalled();
    // still only one Teaching chip
    expect(screen.getAllByText(/teaching/i)).toHaveLength(1);
  });

  it('removes an option', async () => {
    const user = userEvent.setup();
    render(<SkillsEditor initialOptions={['Teaching']} />);
    await user.click(screen.getByRole('button', { name: 'Remove Teaching' }));
    expect(screen.queryByText('Teaching')).not.toBeInTheDocument();
  });

  it('PUTs the current options on save and toasts success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: ['Teaching'] }) });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<SkillsEditor initialOptions={['Teaching']} />);
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/volunteering-skills',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    expect(toastMock.success).toHaveBeenCalled();
  });
});
