import { redirect } from 'next/navigation';
import { ComingSoon } from '@/components/coming-soon';
import { flags } from '@/lib/flags';

export default function EventsPage() {
  if (flags.eventsRegister) redirect('/events/register');
  return <ComingSoon feature="Events" />;
}
