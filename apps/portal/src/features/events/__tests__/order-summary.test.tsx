import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderSummary } from '../order-summary';

describe('OrderSummary', () => {
  it('renders adult line item', () => {
    render(
      <OrderSummary
        category="non-bv"
        adults={2}
        children={0}
        additionalAttendees={0}
        mothersInPuja={0}
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
        category="non-bv"
        adults={1}
        children={2}
        additionalAttendees={0}
        mothersInPuja={0}
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
        category="non-bv"
        adults={2}
        children={0}
        additionalAttendees={0}
        mothersInPuja={0}
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
        category="bv-family"
        adults={3}
        children={2}
        additionalAttendees={0}
        mothersInPuja={0}
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
        category="non-bv"
        adults={1}
        children={0}
        additionalAttendees={0}
        mothersInPuja={0}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/Total Amount/)).toBeInTheDocument();
  });

  it('renders sevak label', () => {
    render(
      <OrderSummary
        category="sevak"
        adults={1}
        children={0}
        additionalAttendees={0}
        mothersInPuja={0}
        subtotal={10}
        processingFee={0}
        total={10}
        paymentMethod="etransfer"
        isBvFamily={false}
      />,
    );
    expect(screen.getByText(/BV Teacher\/Sevak/)).toBeInTheDocument();
  });

  it('renders additional attendees when present', () => {
    render(
      <OrderSummary
        category="bv-family"
        adults={2}
        children={1}
        additionalAttendees={2}
        mothersInPuja={1}
        subtotal={30}
        processingFee={0}
        total={30}
        paymentMethod="etransfer"
        isBvFamily={true}
      />,
    );
    expect(screen.getByText(/Additional Attendees x 2/)).toBeInTheDocument();
    expect(screen.getByText(/Mothers in Matr Puja: 1/)).toBeInTheDocument();
  });
});
