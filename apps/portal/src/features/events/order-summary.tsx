'use client';

interface OrderSummaryProps {
  adults: number;
  children: number;
  subtotal: number;
  processingFee: number;
  total: number;
  paymentMethod: 'etransfer' | 'stripe';
  isBvFamily: boolean;
}

export function OrderSummary({
  adults,
  children,
  subtotal,
  processingFee,
  total,
  paymentMethod,
  isBvFamily,
}: OrderSummaryProps) {
  return (
    <div className="border border-gray-200 rounded-xl p-6 mb-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
      <div className="space-y-2">
        {isBvFamily ? (
          <div className="flex justify-between text-gray-700">
            <span>BV Family (flat rate)</span>
            <span>${subtotal.toFixed(2)}</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between text-gray-700">
              <span>Adults x {adults}</span>
              <span>${(adults * (subtotal / Math.max(adults + children, 1))).toFixed(2)}</span>
            </div>
            {children > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Children x {children}</span>
                <span>${(children * (subtotal / Math.max(adults + children, 1))).toFixed(2)}</span>
              </div>
            )}
          </>
        )}
        {paymentMethod === 'stripe' && processingFee > 0 && (
          <div className="flex justify-between text-gray-500 text-sm">
            <span>Processing Fee (2.20% + 30c)</span>
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
