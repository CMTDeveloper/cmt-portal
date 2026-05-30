import type { Family } from '@cmt/shared-domain/check-in';
import { SendDonationEmailButton } from './send-donation-email-button';

interface Props {
  families: Family[];
}

export function UnpaidFamilyList({ families }: Props) {
  if (families.length === 0) {
    return <p className="text-sm text-[hsl(var(--foreground))]">All families are paid up.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {families.map((f) => {
        const email = f.contacts.find((c) => c.type === 'email')?.value;
        return (
          <li
            key={f.fid}
            className="flex flex-col gap-2 rounded border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-[hsl(var(--foreground))]">
                Family ID <code className="break-all">{f.fid}</code> · Status: {f.paymentStatus}
              </div>
            </div>
            {email && (
              <div className="shrink-0">
                <SendDonationEmailButton email={email} familyName={f.name} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
