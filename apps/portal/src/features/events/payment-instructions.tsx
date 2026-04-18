'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { StepIndicator, OrderSummary } from '@/features/events';

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
  paymentStatus: 'pending' | 'completed' | 'cancelled' | 'review';
  contributionExpected?: string;
  contributionReceived?: string;
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

export function PaymentInstructions() {
  const router = useRouter();
  const [registration, setRegistration] = useState<RegistrationState | null>(null);
  const [copiedField, setCopiedField] = useState<'registrationId' | 'email' | null>(null);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [referenceSaved, setReferenceSaved] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(false);

  useEffect(() => {
    const data = loadRegistration();
    if (!data) {
      router.push('/events/register');
      return;
    }
    setRegistration(data);
  }, [router]);

  const pollPaymentStatus = useCallback(async (regId: string, email: string) => {
    try {
      const res = await fetch('/api/events/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: regId, email }),
      });
      if (!res.ok) return;
      const data = await res.json() as { paymentStatus?: string; contributionExpected?: string; contributionReceived?: string };
      if (data.paymentStatus && data.paymentStatus !== 'pending') {
        const current = loadRegistration();
        if (current && current.paymentStatus !== data.paymentStatus) {
          const updated: RegistrationState = {
            ...current,
            paymentStatus: data.paymentStatus as RegistrationState['paymentStatus'],
            ...(data.contributionExpected ? { contributionExpected: data.contributionExpected } : {}),
            ...(data.contributionReceived ? { contributionReceived: data.contributionReceived } : {}),
          };
          saveRegistration(updated);
          setRegistration(updated);
        }
      }
    } catch {
      // Silently ignore polling errors
    }
  }, []);

  useEffect(() => {
    if (!registration || registration.paymentStatus === 'completed' || registration.paymentStatus === 'cancelled') return;
    const interval = setInterval(() => {
      void pollPaymentStatus(registration.registrationId, registration.email);
    }, 15000);
    return () => clearInterval(interval);
  }, [registration, pollPaymentStatus]);

  const handleCopy = async (field: 'registrationId' | 'email') => {
    if (!registration) return;
    const value = field === 'registrationId' ? registration.registrationId : etransferEmail;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleStartNew = () => {
    clearRegistration();
    router.push('/events/register');
  };

  if (!registration) {
    return null;
  }

  const etransferEmail = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || 'vaibhav@chinmayatoronto.org';

  return (
    <main className="min-h-screen bg-white flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME || 'Event'} Registration
          </h1>
          <p className="text-gray-500 mt-1">
            {registration.paymentStatus === 'completed' ? 'Registration complete' : registration.paymentStatus === 'review' ? 'Payment under review' : 'Complete your payment'}
          </p>
        </div>

        <StepIndicator currentStep={2} />

        {registration.paymentStatus !== 'completed' && registration.paymentStatus !== 'review' && (
          <div className="mb-4">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Payment Instructions</h2>

            {registration.paymentMethod === 'etransfer' ? (
              <div className="bg-gray-50 rounded-xl p-6 space-y-4">
                <p className="text-gray-700">Please send your e-Transfer to:</p>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900">{etransferEmail}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy('email')}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Copy e-Transfer email"
                  >
                    {copiedField === 'email' ? (
                      <span className="text-xs text-green-600 font-medium">Copied!</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-gray-700">
                  <span className="text-red-900">Important!</span> Include your
                  Registration ID in the e-Transfer message or reference field. Do
                  not include any <em>other</em> information in the message.
                </p>
                <p className="text-gray-700">
                  <span className="inline-flex items-center gap-2 align-middle">
                    <span className="font-bold text-gray-900">{registration.registrationId}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopy('registrationId')}
                      className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Copy registration ID"
                    >
                      {copiedField === 'registrationId' ? (
                        <span className="text-xs text-green-600 font-medium">Copied!</span>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </span>
                </p>
                <p className="text-gray-700">
                  Amount to send:{' '}
                  <span className="font-bold text-gray-900">${registration.total.toFixed(2)}</span>
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-gray-700">
                  Click the button below to complete your payment securely via credit card.
                </p>
                <button
                  onClick={() => {
                    if (registration.stripePaymentLink) {
                      window.open(registration.stripePaymentLink, '_blank');
                    }
                  }}
                  className="w-full bg-gray-900 text-white py-3 px-4 rounded-lg font-semibold hover:bg-gray-800 transition-colors"
                >
                  Pay Now
                </button>
              </div>
            )}
          </div>
        )}

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

        {registration.paymentMethod === 'etransfer' && registration.paymentStatus !== 'completed' && registration.paymentStatus !== 'review' && (
          <div className="border border-gray-200 rounded-xl p-6 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              e-Transfer Reference Number{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              You can find this in your bank&apos;s transfer confirmation
            </p>
            {referenceSaved ? (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-sm text-green-700 font-medium">
                    Reference number saved: <span className="font-bold">{referenceNumber}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReferenceSaved(false)}
                  className="text-xs text-green-600 underline mt-1 ml-7"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="e.g. C1AsjcyW6gqU"
                  maxLength={50}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400 text-sm"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!referenceNumber.trim() || !registration || referenceLoading) return;
                    setReferenceLoading(true);
                    const updated = { ...registration, etransferReference: referenceNumber.trim() };
                    saveRegistration(updated);
                    setRegistration(updated);
                    try {
                      await fetch('/api/events/update-reference', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          registrationId: registration.registrationId,
                          email: registration.email,
                          etransferReference: referenceNumber.trim(),
                        }),
                      });
                    } catch {
                      // Don't block UX if update fails
                    }
                    setReferenceLoading(false);
                    setReferenceSaved(true);
                  }}
                  disabled={!referenceNumber.trim() || referenceLoading}
                  className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {referenceLoading ? 'Submitting...' : 'Submit Reference Number'}
                </button>
              </div>
            )}
          </div>
        )}

        {registration.paymentStatus === 'completed' ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-green-700 font-bold">Payment Confirmed</p>
              <p className="text-green-600 text-sm">Your registration is complete!</p>
            </div>
          </div>
        ) : registration.paymentStatus === 'review' ? (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3 mb-6">
            <svg className="w-6 h-6 text-orange-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-orange-700 font-bold">Under Review</p>
              <p className="text-orange-600 text-sm">
                We have received your donation, but it does not match the expected amount.
                {registration.contributionExpected && (
                  <> Expected: <span className="font-semibold">${parseFloat(registration.contributionExpected).toFixed(2)}</span>, Received: <span className="font-semibold">${parseFloat(registration.contributionReceived || '0').toFixed(2)}</span>.</>
                )}
                {' '}We will review your donation and update the status accordingly.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 mb-6">
            <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-amber-700 font-bold">Awaiting Payment</p>
              <p className="text-amber-600 text-sm">Complete your payment to finish registration</p>
            </div>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 mb-6">
          <svg className="w-6 h-6 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <div>
            <p className="text-blue-700 font-bold text-sm">
              {registration.paymentStatus === 'completed'
                ? 'Check your email for confirmation'
                : 'You will receive a confirmation email'}
            </p>
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
