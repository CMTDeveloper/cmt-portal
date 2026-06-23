import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { YearReadiness } from '@cmt/shared-domain';
import { YearReadinessChecklist } from '../year-readiness-checklist';

function readiness(over: Partial<YearReadiness> = {}): YearReadiness {
  return {
    toYear: '2026-27',
    promotionRan: false,
    offerings: true,
    levels: true,
    calendar: false,
    teachers: false,
    prasad: false,
    seva: false,
    ...over,
  };
}

describe('YearReadinessChecklist', () => {
  it('disables Activate until promotion has run', () => {
    render(
      <YearReadinessChecklist
        readiness={readiness({ promotionRan: false })}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        activating={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Activate 2026-27/i })).toBeDisabled();
    expect(screen.getByText(/Class calendar/i)).toBeInTheDocument();
  });

  it('enables Activate once promotion has run', () => {
    render(
      <YearReadinessChecklist
        readiness={readiness({ promotionRan: true })}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        activating={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Activate 2026-27/i })).toBeEnabled();
  });

  it('renders all six readiness items', () => {
    render(
      <YearReadinessChecklist
        readiness={readiness()}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        activating={false}
      />,
    );
    for (const label of ['Offerings', 'Levels', 'Class calendar', 'Teachers', 'Prasad', 'Seva']) {
      expect(screen.getByText(new RegExp(label, 'i'))).toBeInTheDocument();
    }
  });

  it('the Copy-from-last-year button fires onCopyCalendar', async () => {
    const onCopyCalendar = vi.fn();
    const user = userEvent.setup();
    render(
      <YearReadinessChecklist
        readiness={readiness()}
        onActivate={() => {}}
        onCopyCalendar={onCopyCalendar}
        activating={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: /copy from last year/i }));
    expect(onCopyCalendar).toHaveBeenCalledTimes(1);
  });
});
