import type { PaymentStatus } from '@cmt/shared-domain/check-in';

export function PaymentStatusBanner({ status }: { status: PaymentStatus }) {
  if (status === 'paid') return null;

  const message = status === 'unpaid' ? 'Payment pending.' : 'Partial payment on file.';
  return (
    <div className="rounded border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-amber-900">
      {message} Please see a sevak to settle your account.
    </div>
  );
}
