import { flags } from '@/lib/flags';
import { notFound } from 'next/navigation';
import { EventRegistrationForm } from './registration-form';

export function RegistrationFormShell() {
  if (!flags.eventsRegister) notFound();

  const config = {
    eventDisplayName: process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME || 'Event',
    eventPosterUrl: process.env.NEXT_PUBLIC_EVENT_POSTER_URL || '',
    eventCampaign: process.env.NEXT_PUBLIC_EVENT_CAMPAIGN || '2026MothersDay',
    pricePerPerson: Number(process.env.NEXT_PUBLIC_PRICE_PER_PERSON || '10'),
    enableStripe: process.env.NEXT_PUBLIC_ENABLE_STRIPE === 'true',
    etransferEmail: process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || '',
  };

  return <EventRegistrationForm config={config} />;
}
