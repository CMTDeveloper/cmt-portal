'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StepIndicator, OrderSummary, SuccessBanner } from '@/features/events';

interface RegistrationState {
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  paymentMethod: 'etransfer' | 'stripe';
  registrationId: string;
  subtotal: number;
  processingFee: number;
  total: number;
  stripePaymentLink?: string;
  etransferReference?: string;
  isBvFamily: boolean;
  paymentStatus: 'pending' | 'completed' | 'cancelled';
}

const STORAGE_KEY = 'cmtEventRegistration';

function loadRegistration(): RegistrationState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RegistrationState) : null;
  } catch {
    return null;
  }
}

function saveRegistration(data: RegistrationState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function clearRegistration(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export default function EventsSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  );
}

function SuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // searchParams.get used for side-effect parity with standalone
    void searchParams.get('regId');
    const data = loadRegistration();
    if (!data) {
      router.push('/events/register');
      return;
    }
    const updated = { ...data, paymentStatus: 'completed' as const };
    saveRegistration(updated);
    setRegistration(updated);

    fetch('/api/events/update-payment-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationId: data.registrationId,
        paymentStatus: 'completed',
        payment_source: 'stripe',
      }),
    }).catch(() => {});
  }, [router, searchParams]);

  const handleCopy = async () => {
    if (!registration) return;
    await navigator.clipboard.writeText(registration.registrationId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartNew = () => {
    clearRegistration();
    router.push('/events/register');
  };

  if (!registration) {
    return null;
  }

  return (
    <main className="min-h-screen bg-white flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME || 'Event'} Registration
          </h1>
          <p className="text-gray-500 mt-1">Registration complete</p>
        </div>

        <StepIndicator currentStep={2} />

        <div className="bg-gray-50 rounded-xl p-6 mb-4">
          <p className="text-sm text-gray-500 mb-1">Your Registration ID</p>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-bold tracking-wider text-gray-900">
              {registration.registrationId}
            </span>
            <button
              onClick={handleCopy}
              className="ml-3 p-2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Copy registration ID"
            >
              {copied ? (
                <span className="text-sm text-green-600 font-medium">Copied!</span>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-sm text-gray-400 mt-2">Please save this ID for your records</p>
        </div>

        <OrderSummary
          adults={registration.adults}
          children={registration.children}
          subtotal={registration.subtotal}
          processingFee={registration.processingFee}
          total={registration.total}
          paymentMethod={registration.paymentMethod}
          isBvFamily={registration.isBvFamily}
        />

        <SuccessBanner />

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 mb-6">
          <svg className="w-6 h-6 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <div>
            <p className="text-blue-700 font-bold text-sm">Check your email for confirmation</p>
            <p className="text-blue-600 text-sm mt-0.5">
              A confirmation email will be sent from{' '}
              <span className="font-semibold">events@chinmayatoronto.org</span>.
              Please check your <span className="font-semibold">junk/spam folder</span> if
              you don&apos;t see it in your inbox.
            </p>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={handleStartNew}
            className="text-gray-500 hover:text-gray-700 text-sm underline transition-colors"
          >
            Start New Registration
          </button>
        </div>
      </div>
    </main>
  );
}
