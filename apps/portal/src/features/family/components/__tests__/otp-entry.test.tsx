import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpEntry } from '../otp-entry';

describe('OtpEntry', () => {
  it('renders 6 digit inputs by default', () => {
    render(<OtpEntry value="" onChange={() => {}} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);
  });

  it('renders custom length', () => {
    render(<OtpEntry value="" onChange={() => {}} length={4} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
  });

  it('populates inputs from value prop', () => {
    render(<OtpEntry value="123" onChange={() => {}} />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs[0]?.value).toBe('1');
    expect(inputs[1]?.value).toBe('2');
    expect(inputs[2]?.value).toBe('3');
    expect(inputs[3]?.value).toBe('');
  });

  it('calls onChange with new digit when a box is filled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OtpEntry value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[0]!, '5');
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('pastes a full code into all boxes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OtpEntry value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    await user.click(inputs[0]!);
    await user.paste('123456');
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('strips non-digit characters on paste', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OtpEntry value="" onChange={onChange} />);
    await user.click(screen.getAllByRole('textbox')[0]!);
    await user.paste('12-34 56');
    expect(onChange).toHaveBeenCalledWith('123456');
  });

  it('disables all inputs when disabled prop is true', () => {
    render(<OtpEntry value="" onChange={() => {}} disabled />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    inputs.forEach((input) => expect(input.disabled).toBe(true));
  });

  it('has aria-label on each input', () => {
    render(<OtpEntry value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Digit 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6')).toBeInTheDocument();
  });

  it('sets autocomplete="one-time-code" on first input only', () => {
    render(<OtpEntry value="" onChange={() => {}} />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs[0]?.autocomplete).toBe('one-time-code');
    expect(inputs[1]?.autocomplete).toBe('off');
  });
});
