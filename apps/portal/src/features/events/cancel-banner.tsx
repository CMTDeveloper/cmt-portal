'use client';

export function CancelBanner() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <p className="text-amber-700 font-bold text-lg">Payment Cancelled</p>
          <p className="text-amber-600 text-sm mt-1">You can retry your payment or start a new registration</p>
        </div>
      </div>
    </div>
  );
}
