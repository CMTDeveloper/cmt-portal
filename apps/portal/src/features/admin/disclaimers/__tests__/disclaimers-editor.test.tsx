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
const baseProps = { initialIntro: 'Hari Om!', initialSections: SECTIONS, initialAcknowledgement: 'I confirm.', initialVersion: 2 };

beforeEach(() => { save.mockReset(); toastSuccess.mockReset(); toastError.mockReset(); });

describe('DisclaimersEditor', () => {
  it('renders the intro, each section, and the acknowledgement in editable inputs', () => {
    render(<DisclaimersEditor {...baseProps} />);
    expect(screen.getByDisplayValue('Hari Om!')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Respect')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Be kind.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('I confirm.')).toBeInTheDocument();
  });

  it('publishes intro + sections + acknowledgement and reports the new version', async () => {
    save.mockResolvedValue(3);
    render(<DisclaimersEditor {...baseProps} />);
    fireEvent.change(screen.getByDisplayValue('Be kind.'), { target: { value: 'Be very kind.' } });
    fireEvent.change(screen.getByTestId('disclaimers-intro'), { target: { value: 'Hari Om! (v2)' } });
    fireEvent.click(screen.getByTestId('disclaimers-publish'));
    fireEvent.click(screen.getByTestId('disclaimers-publish-confirm'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const payload = save.mock.calls[0]?.[0] as { intro: string; sections: Array<{ id: string; body: string }>; acknowledgement: string };
    expect(payload.intro).toBe('Hari Om! (v2)');
    expect(payload.sections[0]).toMatchObject({ id: 'respect-responsibility', body: 'Be very kind.' });
    expect(payload.acknowledgement).toBe('I confirm.');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('adds and removes sections', () => {
    render(<DisclaimersEditor {...baseProps} initialSections={[SECTIONS[0]!, { id: 'x', title: 'X', body: 'x body' }]} />);
    // Two sections → one more.
    fireEvent.click(screen.getByTestId('disclaimers-add-section'));
    expect(screen.getByTestId('disclaimers-remove-2')).toBeInTheDocument();
    // Remove the middle one.
    fireEvent.click(screen.getByTestId('disclaimers-remove-1'));
    expect(screen.queryByDisplayValue('X')).toBeNull();
  });

  it('disables Publish until every section has a title and text', () => {
    render(<DisclaimersEditor {...baseProps} />);
    expect(screen.getByTestId('disclaimers-publish')).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue('Respect'), { target: { value: '  ' } });
    expect(screen.getByTestId('disclaimers-publish')).toBeDisabled();
  });
});
