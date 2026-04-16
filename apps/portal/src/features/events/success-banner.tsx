'use client';

export function SuccessBanner() {
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
      <div className="flex flex-col items-center text-center gap-3">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-green-700 font-bold text-lg">Payment Confirmed</p>
          <p className="text-green-600 text-sm mt-1">Your registration is complete!</p>
        </div>
      </div>
    </div>
  );
}
