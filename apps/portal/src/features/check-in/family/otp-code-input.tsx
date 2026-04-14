'use client';

import { Input, Label } from '@cmt/ui';

interface Props {
  value: string;
  onChange: (value: string) => void;
  id?: string;
}

export function OtpCodeInput({ value, onChange, id = 'otp-code' }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>Verification code</Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </div>
  );
}
