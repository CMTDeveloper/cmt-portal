import { redirect } from 'next/navigation';
import { DonatePageContent } from './donate-page-content';

export const metadata = { title: 'Donate — CMT Portal' };

export default async function DonatePage() {
  if (process.env.NEXT_PUBLIC_FEATURE_SETU_DONATIONS !== 'true') {
    redirect('/family/enroll');
  }

  return <DonatePageContent />;
}
