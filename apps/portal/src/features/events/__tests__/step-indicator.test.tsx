import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator } from '../step-indicator';

describe('StepIndicator', () => {
  it('renders step 1 as active when currentStep is 1', () => {
    render(<StepIndicator currentStep={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders checkmark for step 1 when currentStep is 2', () => {
    const { container } = render(<StepIndicator currentStep={2} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
