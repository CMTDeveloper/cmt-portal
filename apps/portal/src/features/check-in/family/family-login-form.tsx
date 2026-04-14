'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@cmt/ui';
import { OtpCodeInput } from './otp-code-input';

type ContactType = 'email' | 'phone';
type Step = 'contact' | 'otp';

export function FamilyLoginForm() {
  const [step, setStep] = useState<Step>('contact');
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/family/send-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value }),
      });
      if (!res.ok) {
        if (res.status === 404) setError(`Account not found for this ${type}`);
        else if (res.status === 429) setError('Too many requests. Try again later.');
        else setError('Something went wrong. Try again.');
        return;
      }
      setStep('otp');
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/family/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, value, code }),
      });
      if (!res.ok) {
        setError('Invalid or expired code');
        return;
      }
      const body = (await res.json()) as { redirectTo: string };
      globalThis.location.assign(body.redirectTo);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-[hsl(var(--heading))]">Family sign in</h1>

      {step === 'contact' && (
        <>
          <div role="tablist" className="flex gap-2 border-b pb-2">
            <button
              role="tab"
              type="button"
              aria-selected={type === 'email'}
              onClick={() => setType('email')}
              className={`rounded px-3 py-1 text-sm ${
                type === 'email' ? 'bg-[hsl(var(--primary))] text-white' : ''
              }`}
            >
              Email
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={type === 'phone'}
              onClick={() => setType('phone')}
              className={`rounded px-3 py-1 text-sm ${
                type === 'phone' ? 'bg-[hsl(var(--primary))] text-white' : ''
              }`}
            >
              Phone
            </button>
          </div>

          <form onSubmit={onSendCode} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact">{type === 'email' ? 'Email' : 'Phone'}</Label>
              <Input
                id="contact"
                aria-label={type === 'email' ? 'Email' : 'Phone'}
                type={type === 'email' ? 'email' : 'tel'}
                required
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
            {error && (
              <div role="alert" className="text-sm text-red-600">
                {error}
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending...' : 'Send code'}
            </Button>
          </form>
        </>
      )}

      {step === 'otp' && (
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          <p className="text-sm text-[hsl(var(--foreground))]">
            We sent a 6-digit code to <strong>{value}</strong>. Enter it below.
          </p>
          <OtpCodeInput value={code} onChange={setCode} />
          {error && (
            <div role="alert" className="text-sm text-red-600">
              {error}
            </div>
          )}
          <Button type="submit" disabled={pending || code.length !== 6}>
            {pending ? 'Verifying...' : 'Verify'}
          </Button>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => {
              setStep('contact');
              setCode('');
              setError(null);
            }}
          >
            Use a different {type}
          </button>
        </form>
      )}
    </div>
  );
}
