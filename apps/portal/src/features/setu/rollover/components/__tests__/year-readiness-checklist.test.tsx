import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('the prasad + teachers Copy-from-last-year buttons fire their own handlers', async () => {
    const onCopyPrasad = vi.fn();
    const onCopyTeachers = vi.fn();
    const user = userEvent.setup();
    render(
      <YearReadinessChecklist
        readiness={readiness()}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        onCopyPrasad={onCopyPrasad}
        onCopyTeachers={onCopyTeachers}
        activating={false}
      />,
    );
    // Each "Copy from last year" button lives inside its labelled row, so scope
    // the query to the prasad / teachers list items to disambiguate.
    const prasadRow = screen.getByRole('listitem', { name: /^Prasad:/i });
    const teachersRow = screen.getByRole('listitem', { name: /^Teachers:/i });
    await user.click(within(prasadRow).getByRole('button', { name: /copy from last year/i }));
    await user.click(within(teachersRow).getByRole('button', { name: /copy from last year/i }));
    expect(onCopyPrasad).toHaveBeenCalledTimes(1);
    expect(onCopyTeachers).toHaveBeenCalledTimes(1);
  });

  it('the seva Copy action fires onCopySeva', async () => {
    const onCopySeva = vi.fn();
    const user = userEvent.setup();
    render(
      <YearReadinessChecklist
        readiness={readiness()}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        onCopySeva={onCopySeva}
        activating={false}
      />,
    );
    const sevaRow = screen.getByRole('listitem', { name: /^Seva:/i });
    await user.click(within(sevaRow).getByRole('button', { name: /copy from last year/i }));
    expect(onCopySeva).toHaveBeenCalledTimes(1);
  });

  it('announces each row ready state to screen readers (aria-label)', () => {
    render(
      <YearReadinessChecklist
        readiness={readiness({ offerings: true, calendar: false })}
        onActivate={() => {}}
        onCopyCalendar={() => {}}
        activating={false}
      />,
    );
    expect(screen.getByRole('listitem', { name: 'Offerings: ready' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Class calendar: not ready' })).toBeInTheDocument();
  });
});
