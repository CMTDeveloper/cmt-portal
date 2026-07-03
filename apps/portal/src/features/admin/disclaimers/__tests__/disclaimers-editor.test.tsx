import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// vi.hoisted so the vi.mock factories (hoisted above module scope) can safely
// reference these fns — matches the repo convention (see family/settings/contacts).
const { save, toastSuccess, toastError } = vi.hoisted(() => ({
  save: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/features/setu/disclaimers/disclaimers-client', () => ({
  saveDisclaimersClient: (...a: unknown[]) => save(...a),
}));
vi.mock('@cmt/ui', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DisclaimersEditor } from '../disclaimers-editor';

const SECTIONS = [{ id: 'respect-responsibility', title: 'Respect', body: 'Be kind.' }];

beforeEach(() => { save.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

describe('DisclaimersEditor', () => {
  it('renders each section title + body in editable inputs', () => {
    render(<DisclaimersEditor initialSections={SECTIONS} initialVersion={2} />);
    expect(screen.getByDisplayValue('Respect')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Be kind.')).toBeInTheDocument();
  });

  it('publishes edited content and reports the new version', async () => {
    save.mockResolvedValue(3);
    render(<DisclaimersEditor initialSections={SECTIONS} initialVersion={2} />);
    fireEvent.change(screen.getByDisplayValue('Be kind.'), { target: { value: 'Be very kind.' } });
    fireEvent.click(screen.getByTestId('disclaimers-publish'));
    // Confirm dialog gate: confirm before the network call.
    fireEvent.click(screen.getByTestId('disclaimers-publish-confirm'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // Optional chaining satisfies noUncheckedIndexedAccess; the waitFor above
    // already guarantees the call happened, so these indexes exist at runtime.
    expect(save.mock.calls[0]?.[0]?.[0]).toMatchObject({ id: 'respect-responsibility', body: 'Be very kind.' });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
