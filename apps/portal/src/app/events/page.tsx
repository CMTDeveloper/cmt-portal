import Image from 'next/image';
import Link from 'next/link';
import { ComingSoon } from '@/components/coming-soon';
import { flags } from '@/lib/flags';

export default function EventsPage() {
  if (!flags.eventsRegister) {
    return <ComingSoon feature="Events" />;
  }

  const eventName = process.env.NEXT_PUBLIC_EVENT_DISPLAY_NAME || 'CMT Event';

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="flex justify-center mb-8">
          <div className="rounded-xl overflow-hidden shadow-md">
            <Image
              src="/gurudev.jpg"
              alt="Gurudev"
              width={400}
              height={400}
              className="w-full max-w-sm h-auto object-cover"
              priority
            />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
            {eventName} Registration
          </h1>

          <p className="text-amber-700 font-semibold text-lg mb-6">
            Hari Om!
          </p>

          <div className="text-gray-700 text-sm sm:text-base leading-relaxed space-y-4 text-left">
            <p>
              We are grateful that you are joining us for our special events,
              satsangs, and sacred gatherings. As our Chinmaya Mission Toronto
              family continues to grow, we strive to welcome every participant
              with love, respect, and the spirit of dedicated service. Each
              program is offered to support sincere seekers and to create an
              atmosphere of devotion and upliftment.
            </p>

            <p>
              To serve you better, we are moving to a paid registration system
              for select events. This nominal donation helps us prepare each
              gathering with the care it deserves &ndash; arranging seating,
              prasad, and other essentials &ndash; and also serves as your
              commitment to attend, allowing us to plan responsibly and
              wholeheartedly for all participants.
            </p>

            <p>
              In alignment with fire-code and safety guidelines, advance
              registration also allows us to honor capacity limits and maintain
              a safe and comfortable environment for all devotees.
            </p>

            <p>
              Your support enables the Ashram to continue offering meaningful,
              well-organized programs that reflect the values we cherish:
              discipline, service, and the sincere pursuit of spiritual growth.
            </p>

            <p className="text-center text-gray-800 font-medium pt-2">
              With Prem and Om,
              <br />
              CMT Events Team
            </p>
          </div>
        </div>

        <div className="text-center">
          <Link
            href="/events/register"
            className="inline-block w-full sm:w-auto sm:min-w-[280px] bg-gray-900 text-white rounded-lg py-3 px-8 font-semibold hover:bg-gray-800 transition-colors text-center"
          >
            Register Now
          </Link>
        </div>
      </div>
    </div>
  );
}
