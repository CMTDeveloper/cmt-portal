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
            className="flex items-center justify-between rounded border border-[hsl(var(--border))] p-3"
          >
            <div>
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-[hsl(var(--foreground))]">
                Family ID <code>{f.fid}</code> · Status: {f.paymentStatus}
              </div>
            </div>
            {email && <SendDonationEmailButton email={email} familyName={f.name} />}
          </li>
        );
      })}
    </ul>
  );
}
