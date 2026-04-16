'use client';

interface StepIndicatorProps {
  currentStep: 1 | 2;
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-gray-900 text-white">
        {currentStep > 1 ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          '1'
        )}
      </div>
      <div className="w-16 h-0.5 bg-gray-300" />
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
          currentStep === 2
            ? 'bg-gray-900 text-white'
            : 'bg-white text-gray-400 border-2 border-gray-300'
        }`}
      >
        2
      </div>
    </div>
  );
}
