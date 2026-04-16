import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CounterInput } from '../counter-input';

describe('CounterInput', () => {
  it('renders label and current value', () => {
    render(<CounterInput label="Adults" value={2} min={1} onChange={() => {}} />);
    expect(screen.getByText('Adults')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('calls onChange with incremented value on + click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CounterInput label="Adults" value={2} min={1} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /\+/i }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('calls onChange with decremented value on - click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CounterInput label="Adults" value={2} min={1} onChange={onChange} />);
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disables - button at min value', () => {
    render(<CounterInput label="Adults" value={1} min={1} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toBeDisabled();
  });

  it('disables + button at max value', () => {
    render(<CounterInput label="Adults" value={50} min={1} max={50} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[1]).toBeDisabled();
  });
});
