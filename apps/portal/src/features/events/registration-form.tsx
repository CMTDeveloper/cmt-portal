'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CounterInput, StepIndicator } from '@/features/events';
import { calculatePricing } from '@cmt/shared-domain/events/pricing';
import type { RegistrationCategory } from '@cmt/shared-domain/events/registration';

interface RegistrationState {
  name: string;
  email: string;
  phone: string;
  adults: number;
  children: number;
  additionalAttendees: number;
  mothersInPuja: number;
  category: RegistrationCategory;
  paymentMethod: 'etransfer' | 'stripe';
  registrationId: string;
  subtotal: number;
  processingFee: number;
  total: number;
  stripePaymentLink?: string;
  etransferReference?: string;
  isBvFamily: boolean;
  paymentStatus: 'pending' | 'completed' | 'cancelled';
  fid?: string;
}

interface EventConfig {
  eventDisplayName: string;
  eventPosterUrl: string;
  eventCampaign: string;
  pricePerPerson: number;
  enableStripe: boolean;
  etransferEmail: string;
}

const STORAGE_KEY = 'cmtEventRegistration';

function generateRegistrationId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const array = new Uint8Array(7);
  crypto.getRandomValues(array);
  return `MD26-${Array.from(array, (byte) => chars[byte % chars.length]).join('')}`;
}

function saveRegistration(data: RegistrationState): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

interface DuplicateResult {
  registrationId: string;
  paymentStatus: string;
}

async function submitRegistration(
  data: RegistrationState,
): Promise<{ duplicate: DuplicateResult } | null> {
  const payload = {
    registrationId: data.registrationId,
    name: data.name,
    email: data.email,
    phone: data.phone,
    adults: data.adults,
    children: data.children,
    payment_source: data.paymentMethod === 'stripe' ? 'stripe' : 'etransfer',
    contribution: data.paymentMethod === 'stripe' ? data.total : data.subtotal,
    isBvFamily: data.isBvFamily,
    category: data.category,
    additionalAttendees: data.additionalAttendees,
    mothersInPuja: data.mothersInPuja,
    fid: data.fid ?? '',
  };

  const response = await fetch('/api/events/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (response.status === 409) {
    const body = await response.json() as { error?: string; existingRegistration?: DuplicateResult };
    if (body.existingRegistration) {
      return { duplicate: body.existingRegistration };
    }
  }

  if (!response.ok) {
    throw new Error('Failed to submit registration');
  }

  return null;
}

async function createCheckoutSession(
  data: RegistrationState,
  config: EventConfig,
): Promise<string> {
  const lineItems: { name: string; amount: number; quantity: number }[] = [];

  if (data.category === 'bv-family') {
    lineItems.push({ name: 'BV Family', amount: 10.0, quantity: 1 });
    if (data.additionalAttendees > 0) {
      lineItems.push({ name: 'Additional Attendees', amount: 10.0, quantity: data.additionalAttendees });
    }
  } else if (data.category === 'sevak') {
    lineItems.push({ name: 'BV Teacher/Sevak', amount: 10.0, quantity: 1 });
    if (data.additionalAttendees > 0) {
      lineItems.push({ name: 'Additional Attendees', amount: 10.0, quantity: data.additionalAttendees });
    }
  } else {
    if (data.adults > 0) {
      lineItems.push({ name: 'Adults', amount: config.pricePerPerson, quantity: data.adults });
    }
    if (data.children > 0) {
      lineItems.push({ name: 'Children', amount: config.pricePerPerson, quantity: data.children });
    }
  }
  lineItems.push({ name: 'Processing Fees', amount: data.processingFee, quantity: 1 });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const payload = {
    lineItems,
    customerEmail: data.email,
    client_reference_id: data.registrationId,
    successUrl: `${origin}/events/register/success?regId=${data.registrationId}`,
    cancelUrl: `${origin}/events/register/cancel?regId=${data.registrationId}`,
    metadata: { campaign: config.eventCampaign },
    branding_settings: { display_name: config.eventDisplayName },
  };

  const response = await fetch('/api/events/create-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Failed to create checkout session');
  }

  const result = await response.json() as { checkoutUrl?: string; url?: string };
  return result.checkoutUrl ?? result.url ?? '';
}

async function lookupRegistration(
  registrationId: string,
  email: string,
): Promise<RegistrationState | null> {
  try {
    const response = await fetch('/api/events/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, email }),
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    if (!data || !data.registrationId) return null;
    const category = (data.category as RegistrationCategory) || 'non-bv';
    return {
      name: String(data.name || ''),
      email: String(data.email || email),
      phone: String(data.phone || ''),
      adults: Number(data.adults) || 1,
      children: Number(data.children) || 0,
      additionalAttendees: Number(data.additionalAttendees) || 0,
      mothersInPuja: Number(data.mothersInPuja) || 0,
      category,
      paymentMethod: data.payment_source === 'stripe' ? 'stripe' : 'etransfer',
      registrationId: String(data.registrationId),
      subtotal: Number(data.contribution) || 0,
      processingFee: 0,
      total: Number(data.contribution) || 0,
      isBvFamily: category === 'bv-family',
      paymentStatus: (data.paymentStatus as RegistrationState['paymentStatus']) || 'pending',
    };
  } catch {
    return null;
  }
}

export function EventRegistrationForm({ config }: { config: EventConfig }) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [additionalAttendees, setAdditionalAttendees] = useState(0);
  const [mothersInPuja, setMothersInPuja] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'etransfer' | 'stripe'>('etransfer');

  const [category, setCategory] = useState<RegistrationCategory | null>(null);

  // BV family verification state
  const [bvLookupMethod, setBvLookupMethod] = useState<'familyId' | 'email'>('familyId');
  const [bvLookupValue, setBvLookupValue] = useState('');
  const [bvVerified, setBvVerified] = useState(false);
  const [bvChecking, setBvChecking] = useState(false);
  const [bvError, setBvError] = useState('');
  const [bvFamilyEmails, setBvFamilyEmails] = useState<string[]>([]);
  const [bvFamilyPhones, setBvFamilyPhones] = useState<string[]>([]);
  const [bvFid, setBvFid] = useState<string>('');

  // Sevak verification state
  const [sevakEmail, setSevakEmail] = useState('');
  const [sevakVerified, setSevakVerified] = useState(false);
  const [sevakChecking, setSevakChecking] = useState(false);
  const [sevakError, setSevakError] = useState('');

  // Duplicate registration detection
  const [existingRegistration, setExistingRegistration] = useState<{ registrationId: string; paymentStatus: string } | null>(null);

  const maxMothersFromParents = ((category === 'bv-family' || category === 'sevak') && adults === 2) ? 1 : adults;
  const maxMothers = maxMothersFromParents + additionalAttendees;

  const handleAdultsChange = (val: number) => {
    setAdults(val);
    if ((category === 'bv-family' || category === 'sevak') && val === 2) {
      setMothersInPuja((prev) => Math.max(prev, 1));
    }
    const newMaxFromParents = ((category === 'bv-family' || category === 'sevak') && val === 2) ? 1 : val;
    const newMax = newMaxFromParents + additionalAttendees;
    if (mothersInPuja > newMax) {
      setMothersInPuja(newMax);
    }
  };

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showLookup, setShowLookup] = useState(false);

  const [lookupRegId, setLookupRegId] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const isBvFamily = category === 'bv-family';

  const totals = useMemo(
    () => calculatePricing({
      category: category ?? 'non-bv',
      adults,
      children,
      additionalAttendees,
      paymentMethod,
      pricePerPerson: config.pricePerPerson,
    }),
    [category, adults, children, additionalAttendees, paymentMethod, config.pricePerPerson],
  );

  // Hide the entire form when a duplicate registration is found (hard block)
  const showForm = !existingRegistration && (
    category === 'non-bv'
    || (category === 'bv-family' && bvVerified)
    || (category === 'sevak' && sevakVerified)
  );

  function handleCategoryChange(newCategory: RegistrationCategory) {
    setCategory(newCategory);
    setBvVerified(false);
    setBvChecking(false);
    setBvError('');
    setBvLookupValue('');
    setBvFamilyEmails([]);
    setBvFamilyPhones([]);
    setBvFid('');
    setSevakVerified(false);
    setSevakChecking(false);
    setSevakError('');
    setSevakEmail('');
    setExistingRegistration(null);
    setAdults(1);
    setChildren(0);
    setAdditionalAttendees(0);
    setMothersInPuja(0);
  }

  const verifyBvStatus = useCallback(async () => {
    if (!bvLookupValue.trim()) {
      setBvError(bvLookupMethod === 'familyId' ? 'Please enter your Family ID' : 'Please enter your email');
      return;
    }
    if (bvLookupMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bvLookupValue)) {
      setBvError('Please enter a valid email address');
      return;
    }
    setBvChecking(true);
    setBvError('');
    try {
      const payload = bvLookupMethod === 'email'
        ? { email: bvLookupValue.trim() }
        : { familyId: bvLookupValue.trim() };
      const res = await fetch('/api/events/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { isBvFamily: boolean; fid?: string; familyEmails?: string[]; familyPhones?: string[]; existingRegistration?: { registrationId: string; paymentStatus: string } };
      if (data.isBvFamily) {
        setBvVerified(true);
        if (data.fid) setBvFid(data.fid);
        if (data.familyEmails) setBvFamilyEmails(data.familyEmails);
        if (data.familyPhones) setBvFamilyPhones(data.familyPhones);
        if (data.existingRegistration) setExistingRegistration(data.existingRegistration);
      } else {
        setBvError(bvLookupMethod === 'familyId'
          ? 'Family ID not found in BV roster. Please check and try again.'
          : 'Email not found in BV roster. Try using your Family ID instead.');
      }
    } catch {
      setBvError('Unable to verify. Please try again.');
    } finally {
      setBvChecking(false);
    }
  }, [bvLookupMethod, bvLookupValue]);

  const verifySevakStatus = useCallback(async () => {
    if (!sevakEmail.trim()) {
      setSevakError('Please enter your email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sevakEmail)) {
      setSevakError('Please enter a valid email address');
      return;
    }
    setSevakChecking(true);
    setSevakError('');
    try {
      const res = await fetch('/api/events/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sevakEmail: sevakEmail.trim() }),
      });
      const data = await res.json() as { isSevak: boolean; existingRegistration?: { registrationId: string; paymentStatus: string } };
      if (data.isSevak) {
        setSevakVerified(true);
        if (data.existingRegistration) setExistingRegistration(data.existingRegistration);
      } else {
        setSevakError('Email not found in the teacher/sevak list. Please check and try again.');
      }
    } catch {
      setSevakError('Unable to verify. Please try again.');
    } finally {
      setSevakChecking(false);
    }
  }, [sevakEmail]);

  const handleNonBvEmailBlur = useCallback(async () => {
    if (category !== 'non-bv') return;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    try {
      const res = await fetch('/api/events/verify-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkDuplicateEmail: email.trim(), category: 'non-bv' }),
      });
      const data = await res.json() as { existingRegistration?: { registrationId: string; paymentStatus: string } };
      if (data.existingRegistration) setExistingRegistration(data.existingRegistration);
    } catch {
      // Silently ignore duplicate check errors
    }
  }, [category, email]);

  function normalizePhone(p: string): string {
    const digits = p.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return digits.substring(1);
    }
    return digits;
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Full name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = 'Please enter a valid email address';
    if (!phone.trim()) newErrors.phone = 'Phone number is required';
    else if (phone.replace(/\D/g, '').length < 10)
      newErrors.phone = 'Please enter a valid phone number (at least 10 digits)';

    if (isBvFamily && bvLookupMethod === 'familyId' && (bvFamilyEmails.length > 0 || bvFamilyPhones.length > 0)) {
      const emailMatch = bvFamilyEmails.length > 0 && bvFamilyEmails.includes(email.toLowerCase().trim());
      const phoneMatch = bvFamilyPhones.length > 0 && bvFamilyPhones.includes(normalizePhone(phone));
      const canCheckEmail = bvFamilyEmails.length > 0;
      const canCheckPhone = bvFamilyPhones.length > 0;
      const passed = emailMatch || phoneMatch || (!canCheckEmail && !canCheckPhone);
      if (!passed) {
        const hint = canCheckEmail && !canCheckPhone
          ? 'Please use the email associated with your Bala Vihar registration.'
          : canCheckPhone && !canCheckEmail
          ? 'Please use the phone number associated with your Bala Vihar registration.'
          : 'Please use the email or phone associated with your Bala Vihar registration.';
        newErrors.form = `Your email or phone number must match your BV family record. ${hint}`;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const registrationId = generateRegistrationId();
      const { subtotal, processingFee, total } = totals;

      const registration: RegistrationState = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        adults,
        children,
        additionalAttendees,
        mothersInPuja,
        category: category ?? 'non-bv',
        paymentMethod,
        registrationId,
        subtotal,
        processingFee,
        total,
        isBvFamily,
        ...(category === 'bv-family' && bvLookupMethod === 'familyId' && { fid: bvLookupValue.trim() }),
        ...(category === 'bv-family' && bvLookupMethod === 'email' && bvFid && { fid: bvFid }),
        paymentStatus: 'pending',
      };

      if (paymentMethod === 'stripe') {
        const [duplicateResult, paymentLink] = await Promise.all([
          submitRegistration(registration),
          createCheckoutSession(registration, config),
        ]);
        if (duplicateResult) {
          setExistingRegistration(duplicateResult.duplicate);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        registration.stripePaymentLink = paymentLink;
      } else {
        const duplicateResult = await submitRegistration(registration);
        if (duplicateResult) {
          setExistingRegistration(duplicateResult.duplicate);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }

      saveRegistration(registration);
      router.push('/events/register/payment');
    } catch {
      setErrors({ form: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupError('');

    if (!lookupRegId.trim() || !lookupEmail.trim()) {
      setLookupError('Both fields are required');
      return;
    }

    setLookupLoading(true);
    try {
      const result = await lookupRegistration(lookupRegId.trim(), lookupEmail.trim());
      if (result) {
        saveRegistration(result);
        router.push('/events/register/payment');
      } else {
        setLookupError('Registration not found. Please check your details and try again.');
      }
    } catch {
      setLookupError('Something went wrong. Please try again.');
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className={`mx-auto px-4 py-8 ${config.eventPosterUrl ? 'max-w-6xl flex flex-col lg:flex-row lg:gap-10 lg:items-start' : 'max-w-lg'}`}>
        {config.eventPosterUrl && (
          <div className="hidden lg:block lg:sticky lg:top-8 lg:flex-1">
            <div className="rounded-xl overflow-hidden shadow-md cursor-pointer" onClick={() => window.open(config.eventPosterUrl, '_blank')}>
              <img
                src={config.eventPosterUrl}
                alt={config.eventDisplayName ? `${config.eventDisplayName} poster` : 'Event poster'}
                className="w-full h-auto max-h-72 sm:max-h-96 lg:max-h-none object-cover object-top"
              />
            </div>
            <p className="text-xs text-center text-gray-400 mt-1.5 hidden lg:block">Click to view full poster</p>
          </div>
        )}

        <div className={`w-full ${config.eventPosterUrl ? 'lg:flex-1 max-w-lg' : ''}`}>
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              {config.eventDisplayName || 'Event'} Registration
            </h1>
            <p className="text-gray-500 mt-1">Fill in your details to register</p>
          </div>

          <StepIndicator currentStep={1} />

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
            <p className="text-sm text-amber-800">
              Already registered?{' '}
              <button
                type="button"
                onClick={() => setShowLookup(!showLookup)}
                className="font-bold underline hover:text-amber-900"
              >
                Look up your registration
              </button>{' '}
              to complete payment.
            </p>
          </div>

          {showLookup && (
            <form onSubmit={handleLookup} className="mb-8 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Registration ID
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={lookupRegId}
                  onChange={(e) => setLookupRegId(e.target.value.toUpperCase())}
                  placeholder="e.g. MD26-ABC1234"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={lookupEmail}
                  onChange={(e) => setLookupEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                />
              </div>
              {lookupError && <p className="text-sm text-red-600">{lookupError}</p>}
              <button
                type="submit"
                disabled={lookupLoading}
                className="w-full bg-amber-600 text-white rounded-lg py-3 font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {lookupLoading ? 'Looking up...' : 'Look Up Registration'}
              </button>
              <button
                type="button"
                onClick={() => setShowLookup(false)}
                className="w-full text-sm text-gray-500 hover:text-gray-700"
              >
                Back to new registration
              </button>
            </form>
          )}

          {!showLookup && (
            <div className="space-y-5">
              {/* Category Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">
                  Registration Category
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  {([
                    { value: 'bv-family' as RegistrationCategory, label: 'Bala Vihar Family' },
                    { value: 'sevak' as RegistrationCategory, label: 'BV Teacher/Sevak' },
                    { value: 'non-bv' as RegistrationCategory, label: 'Non-Bala Vihar Family' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleCategoryChange(opt.value)}
                      className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-colors ${
                        category === opt.value
                          ? 'border-amber-500 bg-amber-50 text-amber-800'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* BV Family Verification */}
                {category === 'bv-family' && !bvVerified && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <p className="text-sm text-gray-600">Verify your BV family status using:</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setBvLookupMethod('familyId'); setBvLookupValue(''); setBvError(''); }}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          bvLookupMethod === 'familyId'
                            ? 'border-amber-500 bg-white text-amber-800'
                            : 'border-gray-200 text-gray-500 hover:bg-white'
                        }`}
                      >
                        Family ID
                      </button>
                      <button
                        type="button"
                        onClick={() => { setBvLookupMethod('email'); setBvLookupValue(''); setBvError(''); }}
                        className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          bvLookupMethod === 'email'
                            ? 'border-amber-500 bg-white text-amber-800'
                            : 'border-gray-200 text-gray-500 hover:bg-white'
                        }`}
                      >
                        Email
                      </button>
                    </div>
                    <input
                      type={bvLookupMethod === 'email' ? 'email' : 'text'}
                      value={bvLookupValue}
                      onChange={(e) => { setBvLookupValue(e.target.value); setBvError(''); }}
                      placeholder={bvLookupMethod === 'familyId' ? 'Enter your Family ID' : 'Enter your BV registered email'}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400 text-sm"
                    />
                    {bvError && <p className="text-sm text-red-600">{bvError}</p>}
                    <button
                      type="button"
                      onClick={() => void verifyBvStatus()}
                      disabled={bvChecking || !bvLookupValue.trim()}
                      className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {bvChecking ? 'Verifying...' : 'Verify BV Status'}
                    </button>
                  </div>
                )}

                {/* BV Family Verified */}
                {category === 'bv-family' && bvVerified && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="text-sm text-green-700 font-medium">BV Family verified</p>
                      <button type="button" onClick={() => { setBvVerified(false); setBvLookupValue(''); setBvFamilyEmails([]); setBvFamilyPhones([]); }} className="text-xs text-green-600 underline mt-0.5">Change</button>
                    </div>
                  </div>
                )}

                {/* Sevak Verification */}
                {category === 'sevak' && !sevakVerified && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                    <p className="text-sm text-gray-600">Verify your teacher/sevak status:</p>
                    <input
                      type="email"
                      value={sevakEmail}
                      onChange={(e) => { setSevakEmail(e.target.value); setSevakError(''); }}
                      placeholder="Enter your registered email"
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400 text-sm"
                    />
                    {sevakError && <p className="text-sm text-red-600">{sevakError}</p>}
                    <button
                      type="button"
                      onClick={() => void verifySevakStatus()}
                      disabled={sevakChecking || !sevakEmail.trim()}
                      className="w-full py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      {sevakChecking ? 'Verifying...' : 'Verify'}
                    </button>
                  </div>
                )}

                {/* Sevak Verified */}
                {category === 'sevak' && sevakVerified && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <div>
                      <p className="text-sm text-green-700 font-medium">BV Teacher/Sevak verified</p>
                      <button type="button" onClick={() => { setSevakVerified(false); setSevakEmail(''); }} className="text-xs text-green-600 underline mt-0.5">Change</button>
                    </div>
                  </div>
                )}

                {/* Non-BV Info */}
                {category === 'non-bv' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    <p className="text-sm text-amber-800 font-medium">Non-BV Family - ${config.pricePerPerson} per person (adults and children)</p>
                  </div>
                )}
              </div>

              {/* Duplicate Registration Warning */}
              {existingRegistration && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <div>
                    <p className="text-amber-800 font-medium">Existing Registration Found</p>
                    <p className="text-amber-700 text-sm mt-1">
                      A registration already exists with ID{' '}
                      <span className="font-mono font-bold text-amber-900">{existingRegistration.registrationId}</span>
                      {existingRegistration.paymentStatus === 'completed'
                        ? ' and payment is confirmed.'
                        : '. You can check your payment status on the payment page.'}
                    </p>
                    <p className="text-amber-700 text-sm mt-1">
                      Please check your email from <span className="font-semibold">events@chinmayatoronto.org</span> for confirmation details. Check your junk/spam folder if you don&apos;t see it.
                    </p>
                    <a
                      href={`/events/register/payment?regId=${existingRegistration.registrationId}`}
                      className="inline-block mt-2 text-sm text-amber-800 underline hover:text-amber-900"
                    >
                      Go to Payment Page →
                    </a>
                  </div>
                </div>
              )}

              {/* Registration form fields - shown after category selection + verification */}
              {showForm && (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* BV Family definition info */}
                  {category === 'bv-family' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                      <p className="text-sm text-blue-800">
                        Family registration covers parents and children enrolled in Bala Vihar. Please include all others (such as grandparents, relatives, or friends) as additional attendees.
                      </p>
                    </div>
                  )}

                  {/* Full Name */}
                  <div>
                    <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                      </div>
                      <input
                        id="fullName"
                        name="name"
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                      />
                    </div>
                    {errors.name && <p className="text-sm text-red-600 mt-1">{errors.name}</p>}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => void handleNonBvEmailBlur()}
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                      />
                    </div>
                    {errors.email && <p className="text-sm text-red-600 mt-1">{errors.email}</p>}
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                      </div>
                      <input
                        type="tel"
                        name="phone"
                        autoComplete="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+1 (555) 000-0000"
                        className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-gray-900 placeholder-gray-400"
                      />
                    </div>
                    {errors.phone && <p className="text-sm text-red-600 mt-1">{errors.phone}</p>}
                  </div>

                  {/* Attendee Counters - Category-specific */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                      </svg>
                      <span className="text-sm font-medium text-gray-700">Number of Attendees</span>
                    </div>

                    {/* BV Family Counters */}
                    {category === 'bv-family' && (
                      <>
                        <CounterInput label="Parents" value={adults} min={1} max={2} onChange={handleAdultsChange} />
                        <CounterInput label="Children" value={children} min={0} onChange={setChildren} />
                        <div className="border-t border-gray-200 mt-4 pt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">Additional Attendees</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 ml-7">Grandparents, relatives, friends — $10 per person</p>
                          <CounterInput label="Attendees" value={additionalAttendees} min={0} onChange={setAdditionalAttendees} />
                        </div>
                        <div className="border-t border-gray-200 mt-4 pt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">Number of Mothers</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 ml-7">Of above, how many Mothers will need seating for Matr Puja?</p>
                          <CounterInput label="Mothers" value={mothersInPuja} min={0} max={maxMothers} onChange={setMothersInPuja} />
                        </div>
                      </>
                    )}

                    {/* Sevak Counters */}
                    {category === 'sevak' && (
                      <>
                        <CounterInput label="Sevak & Spouse" value={adults} min={1} max={2} onChange={handleAdultsChange} />
                        <div className="border-t border-gray-200 mt-4 pt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">Additional Attendees</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 ml-7">$10 per person</p>
                          <CounterInput label="Attendees" value={additionalAttendees} min={0} onChange={setAdditionalAttendees} />
                        </div>
                        <div className="border-t border-gray-200 mt-4 pt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">Number of Mothers</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 ml-7">Of above, how many Mothers will need seating for Matr Puja?</p>
                          <CounterInput label="Mothers" value={mothersInPuja} min={0} max={maxMothers} onChange={setMothersInPuja} />
                        </div>
                      </>
                    )}

                    {/* Non-BV Counters */}
                    {category === 'non-bv' && (
                      <>
                        <CounterInput label="Adults" value={adults} min={1} onChange={handleAdultsChange} />
                        <CounterInput label="Children" value={children} min={0} onChange={setChildren} />
                        <div className="border-t border-gray-200 mt-4 pt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            <span className="text-sm font-medium text-gray-700">Number of Mothers</span>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 ml-7">Of above, how many Mothers will need seating for Matr Puja?</p>
                          <CounterInput label="Mothers" value={mothersInPuja} min={0} max={maxMothers} onChange={setMothersInPuja} />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Cost Display */}
                  <div className="pt-2 space-y-1">
                    {category === 'bv-family' && (
                      <>
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>BV Family (flat donation)</span>
                          <span>$10.00</span>
                        </div>
                        {additionalAttendees > 0 && (
                          <div className="flex justify-between text-sm text-gray-600">
                            <span>Additional Attendees ({additionalAttendees} x $10)</span>
                            <span>${(additionalAttendees * 10).toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {category === 'sevak' && (
                      <>
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>BV Teacher/Sevak (flat donation)</span>
                          <span>$10.00</span>
                        </div>
                        {additionalAttendees > 0 && (
                          <div className="flex justify-between text-sm text-gray-600">
                            <span>Additional Attendees ({additionalAttendees} x $10)</span>
                            <span>${(additionalAttendees * 10).toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {category === 'non-bv' && (
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Subtotal</span>
                        <span>${totals.subtotal.toFixed(2)} ({adults + children} x $10)</span>
                      </div>
                    )}
                    {paymentMethod === 'stripe' && (
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>+ Processing Fees</span>
                        <span>${totals.processingFee.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold text-gray-900 pt-1">
                      <span>Total</span>
                      <span>${totals.total.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="pt-2">
                    <label className="block text-sm font-medium text-gray-700 mb-3">Payment Method</label>
                    <div className="space-y-3">
                      <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        paymentMethod === 'etransfer' ? 'border-amber-500 bg-amber-50' : 'border-gray-300 hover:bg-gray-50'
                      }`}>
                        <input
                          type="radio"
                          name="paymentMethod"
                          value="etransfer"
                          checked={paymentMethod === 'etransfer'}
                          onChange={() => setPaymentMethod('etransfer')}
                          className="sr-only"
                        />
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'etransfer' ? 'border-amber-600' : 'border-gray-400'}`}>
                          {paymentMethod === 'etransfer' && <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />}
                        </div>
                        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                        <span className="text-gray-900 font-medium">e-Transfer</span>
                      </label>

                      {config.enableStripe && (
                        <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          paymentMethod === 'stripe' ? 'border-amber-500 bg-amber-50' : 'border-gray-300 hover:bg-gray-50'
                        }`}>
                          <input
                            type="radio"
                            name="paymentMethod"
                            value="stripe"
                            checked={paymentMethod === 'stripe'}
                            onChange={() => setPaymentMethod('stripe')}
                            className="sr-only"
                          />
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentMethod === 'stripe' ? 'border-amber-600' : 'border-gray-400'}`}>
                            {paymentMethod === 'stripe' && <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />}
                          </div>
                          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                          </svg>
                          <div>
                            <span className="text-gray-900 font-medium">Credit Card</span>
                            <span className="text-xs text-gray-400 ml-1">(2.20% + 30¢ processing fee)</span>
                          </div>
                        </label>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Note: Payment method cannot be changed after registration is submitted.
                    </p>
                  </div>

                  {errors.form && <p className="text-sm text-red-600 text-center">{errors.form}</p>}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gray-900 text-white rounded-lg py-3 font-semibold hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Submitting...' : 'Continue to Payment'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
