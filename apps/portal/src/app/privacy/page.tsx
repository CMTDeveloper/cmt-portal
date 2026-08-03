import Link from 'next/link';
import { CspRoot } from '@/features/family/components/atoms';
import { ORG_NAME, SITE_NAME, CONTACT_EMAIL } from '@/lib/branding';

/**
 * Privacy policy — PUBLIC, and it has to stay that way.
 *
 * Written because mobile carriers require a reachable privacy policy URL before
 * they will verify a toll-free number for SMS, and the account had none. It is
 * also simply the right thing to publish for a portal holding children's
 * records.
 *
 * The "Text messages" section below is the one carriers read: who sends, what
 * for, how consent is given, and how to stop. Keep it in step with
 * SMS_CONSENT_NOTICE in lib/branding.ts and with what the code actually sends.
 *
 * Content lives in the repo rather than a CMS, per the standing decision that
 * admin-editable content belongs in the portal's own admin UI and static pages
 * are checked in.
 */
export const metadata = {
  title: 'Privacy policy',
  description: `How ${ORG_NAME} collects and uses the information families provide to ${SITE_NAME}.`,
};

const UPDATED = '3 August 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 10, letterSpacing: '-0.01em' }}>{title}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.65, color: 'var(--body-text)' }}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <CspRoot style={{ minHeight: '100dvh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 22px 80px' }}>
        <p style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>
          {ORG_NAME}
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 600, marginTop: 8, marginBottom: 6, letterSpacing: '-0.02em' }}>
          Privacy policy
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 34 }}>Last updated {UPDATED}</p>

        <Section title="Who we are">
          <p>
            {ORG_NAME} is a registered non-profit religious and educational organization in Ontario,
            Canada. {SITE_NAME} is the portal families use to manage their enrolment in our Bala
            Vihar programme and other classes. This policy covers information handled through the
            portal.
          </p>
          <p style={{ marginTop: 10 }}>
            Our main website has its own terms of use at{' '}
            <a
              href="https://chinmayatoronto.org/privacy-policy/"
              style={{ color: 'var(--accentDeep)' }}
              rel="noreferrer"
            >
              chinmayatoronto.org
            </a>
            . Where the two differ about the portal, this page applies.
          </p>
        </Section>

        <Section title="What we collect">
          <p>Only what we need to run the programme your family is enrolled in:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Names of the parents and children in your family, and each child&apos;s school grade and birth month and year.</li>
            <li>Your email address and mobile number, so we can reach you and so you can sign in.</li>
            <li>Your home address and the centre your family attends.</li>
            <li>Food allergies and emergency contacts, so a teacher can keep your child safe on a Sunday.</li>
            <li>Attendance, class assignments, and volunteering interests.</li>
            <li>A record of donations you make through the portal.</li>
          </ul>
        </Section>

        <Section title="How we use it">
          <p>
            To place your children in the right class, take attendance, contact you about your
            family&apos;s enrolment, and keep a record of donations. We do not sell your information,
            we do not share it with advertisers, and we do not use it to market anything to you.
          </p>
        </Section>

        <Section title="Text messages (SMS)">
          <p>
            <strong>You choose whether we text you.</strong> When you sign in, or when you add a phone
            number to your profile, you can ask for a code by email or by text. Selecting the text
            option is your consent to receive text messages from {ORG_NAME} at that number. We only
            ever text a number a family has entered themselves.
          </p>
          <p style={{ marginTop: 10 }}>We send two kinds of message, and nothing else:</p>
          <ul style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>
              <strong>Sign-in codes.</strong> A 6-digit code valid for 10 minutes, sent only when you
              have just asked for one. For example: <em>&ldquo;CMT portal code: 483920 (10 min)&rdquo;</em>
            </li>
            <li>
              <strong>Account notices</strong> to the parent who manages the family record — for
              example when someone requests access to your family, or when your family&apos;s
              volunteer Sunday needs confirming.
            </li>
          </ul>
          <p style={{ marginTop: 10 }}>
            We never send marketing or promotional text messages. Message and data rates may apply.
            Message frequency varies and depends on how often you sign in.
          </p>
          <p style={{ marginTop: 10 }}>
            <strong>To stop receiving texts</strong>, reply <strong>STOP</strong> to any message; this
            takes effect immediately. Reply <strong>HELP</strong> for help, or write to us at the
            address below. You can also remove or change your phone number in the portal at any time.
            Everything the portal does by text can also be done by email, so opting out never locks
            you out of your account.
          </p>
        </Section>

        <Section title="Who can see your information">
          <p>
            Within {ORG_NAME}: the welcome team and administrators, and the teachers assigned to your
            children&apos;s classes, who see only what they need for their class. Other families never
            see your details.
          </p>
          <p style={{ marginTop: 10 }}>
            We use a small number of service providers to operate the portal — cloud hosting,
            databases, email and text delivery, and a payment processor for donations. They process
            information only on our instructions. Card and bank details are handled entirely by our
            payment processor; the portal never sees or stores them.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep family records for as long as your family takes part, and afterwards as part of
            our historical records — a child who has finished the programme keeps their attendance
            history rather than being deleted. Donation records are kept as long as Canadian tax rules
            require. You can ask us to correct or remove information at any time.
          </p>
        </Section>

        <Section title="Your choices">
          <ul style={{ paddingLeft: 20 }}>
            <li>See and correct your family&apos;s information yourself in the portal.</li>
            <li>Choose email instead of text for everything.</li>
            <li>Ask us for a copy of what we hold, or ask us to delete it.</li>
          </ul>
        </Section>

        <Section title="Contact us">
          <p>
            Write to <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--accentDeep)' }}>{CONTACT_EMAIL}</a>{' '}
            with any question about this policy or about the information we hold on your family.
          </p>
        </Section>

        <p style={{ marginTop: 36 }}>
          <Link href="/" style={{ color: 'var(--accentDeep)', fontSize: 14, textDecoration: 'none' }}>
            ← Back to {SITE_NAME}
          </Link>
        </p>
      </div>
    </CspRoot>
  );
}
