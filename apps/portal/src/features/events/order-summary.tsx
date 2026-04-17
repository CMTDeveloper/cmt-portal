'use client';

import type { RegistrationCategory } from '@cmt/shared-domain/events/registration';

interface OrderSummaryProps {
  category: RegistrationCategory;
  adults: number;
  children: number;
  additionalAttendees: number;
  mothersInPuja: number;
  subtotal: number;
  processingFee: number;
  total: number;
  paymentMethod: 'etransfer' | 'stripe';
  isBvFamily: boolean;
}

export function OrderSummary({
  category,
  adults,
  children,
  additionalAttendees,
  mothersInPuja,
  processingFee,
  total,
  paymentMethod,
}: OrderSummaryProps) {
  return (
    <div className="border border-gray-200 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
      <div className="space-y-2">
        {category === 'bv-family' ? (
          <>
            <div className="flex justify-between text-gray-700">
              <span>BV Family (flat donation)</span>
              <span>$10.00</span>
            </div>
            {additionalAttendees > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Additional Attendees x {additionalAttendees}</span>
                <span>${(additionalAttendees * 10).toFixed(2)}</span>
              </div>
            )}
          </>
        ) : category === 'sevak' ? (
          <>
            <div className="flex justify-between text-gray-700">
              <span>BV Teacher/Sevak (flat donation)</span>
              <span>$10.00</span>
            </div>
            {additionalAttendees > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Additional Attendees x {additionalAttendees}</span>
                <span>${(additionalAttendees * 10).toFixed(2)}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-between text-gray-700">
              <span>Adults x {adults}</span>
              <span>${(adults * 10).toFixed(2)}</span>
            </div>
            {children > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Children x {children}</span>
                <span>${(children * 10).toFixed(2)}</span>
              </div>
            )}
          </>
        )}
        {mothersInPuja > 0 && (
          <div className="flex justify-between text-gray-500 text-sm">
            <span>Mothers in Matr Puja: {mothersInPuja}</span>
          </div>
        )}
        {paymentMethod === 'stripe' && processingFee > 0 && (
          <div className="flex justify-between text-gray-500 text-sm">
            <span>Processing Fee (2.20% + 30¢)</span>
            <span>${processingFee.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-gray-200 pt-2 mt-2">
          <div className="flex justify-between font-bold text-gray-900">
            <span>Total Amount</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
