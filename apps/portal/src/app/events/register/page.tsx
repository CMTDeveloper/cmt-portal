import { RegistrationFormShell } from '@/features/events/registration-form-shell';

export const metadata = { title: 'Register — CMT Portal' };
export const dynamic = 'force-dynamic';

export default function EventsRegisterPage() {
  return <RegistrationFormShell />;
}
