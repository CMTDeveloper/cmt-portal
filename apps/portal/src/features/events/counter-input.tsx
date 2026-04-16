'use client';

interface CounterInputProps {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}

export function CounterInput({ label, value, min, max = 50, onChange }: CounterInputProps) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-base text-gray-700">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-xl text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          &minus;
        </button>
        <span className="w-8 text-center text-lg font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-xl text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}
