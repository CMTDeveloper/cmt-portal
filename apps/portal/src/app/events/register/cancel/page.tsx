'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StepIndicator, OrderSummary, CancelBanner } from '@/features/events';

interface RegistrationState {
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  additionalAttendees?: number;
  mothersInPuja?: number;
  category?: 'bv-family' | 'sevak' | 'non-bv';
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

function clearRegistration(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export default function EventsCancelPage() {
  return (
    <Suspense fallback={null}>
      <CancelContent />
    </Suspense>
  );
}

function CancelContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void searchParams.get('regId');
    const data = loadRegistration();
    if (!data) {
      router.push('/events/register');
      return;
    }
    setRegistration(data);
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
          <h1 className="text-2xl font-bold text-gray-900">Event Registration</h1>
          <p className="text-gray-500 mt-1">Complete your payment</p>
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
          category={registration.category ?? (registration.isBvFamily ? 'bv-family' : 'non-bv')}
          adults={registration.adults}
          children={registration.children}
          additionalAttendees={registration.additionalAttendees ?? 0}
          mothersInPuja={registration.mothersInPuja ?? 0}
          subtotal={registration.subtotal}
          processingFee={registration.processingFee}
          total={registration.total}
          paymentMethod={registration.paymentMethod}
          isBvFamily={registration.isBvFamily}
        />

        <div className="mb-4">
          {registration.stripePaymentLink ? (
            <div className="space-y-3">
              <p className="text-gray-700">Your payment was cancelled. You can retry below.</p>
              <button
                onClick={() => window.open(registration.stripePaymentLink, '_blank')}
                className="w-full bg-gray-900 text-white py-3 px-4 rounded-lg font-semibold hover:bg-gray-800 transition-colors"
              >
                Retry Payment
              </button>
            </div>
          ) : (
            <p className="text-gray-700">Payment was cancelled. Please start a new registration.</p>
          )}
        </div>

        <CancelBanner />

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
