import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderSummary } from '../order-summary';

describe('OrderSummary', () => {
  it('renders adult line item', () => {
    render(
      <OrderSummary
        adults={2}
        children={0}
        subtotal={20}
        processingFee={0}
        total={20}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Adults x 2/)).toBeInTheDocument();
    expect(screen.getAllByText('$20.00').length).toBeGreaterThanOrEqual(1);
  });

  it('renders children line item when children > 0', () => {
    render(
      <OrderSummary
        adults={1}
        children={2}
        subtotal={30}
        processingFee={0}
        total={30}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Children x 2/)).toBeInTheDocument();
  });

  it('renders processing fee for stripe', () => {
    render(
      <OrderSummary
        adults={2}
        children={0}
        subtotal={20}
        processingFee={0.74}
        total={20.74}
        paymentMethod="stripe"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Processing Fee/)).toBeInTheDocument();
    expect(screen.getByText('$0.74')).toBeInTheDocument();
  });

  it('renders BV family label', () => {
    render(
      <OrderSummary
        adults={3}
        children={2}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={true}
      />,
    );
    expect(screen.getByText(/BV Family/)).toBeInTheDocument();
  });

  it('renders total amount', () => {
    render(
      <OrderSummary
        adults={1}
        children={0}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Total Amount/)).toBeInTheDocument();
  });
});
