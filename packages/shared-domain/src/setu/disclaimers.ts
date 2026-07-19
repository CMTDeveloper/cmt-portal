import type { DisclaimersConfig } from './schemas/disclaimers';

// Re-export the schema module so consumers (and the disclaimers tests) have a
// single import site for the config/section/acceptance schemas alongside the
// seed default + predicate below. Same-declaration re-export — no ambiguity in
// the setu barrel, and no cycle (schemas/disclaimers.ts imports only zod).
export * from './schemas/disclaimers';

// Seed content shown before any admin edit (getDisclaimersConfig falls back to
// this when app_config/disclaimers is absent). Admin-editable at
// /admin/disclaimers. Source: "CMT Bala Vihar Acknowledgements". Section bodies
// are newline-separated bullets ("• …"); acceptance is keyed on version + school
// year (NOT section ids), so section ids may be freely changed/added/removed.
export const DEFAULT_DISCLAIMERS_CONFIG: DisclaimersConfig = {
  version: 1,
  intro:
    'Hari Om!\n' +
    'At Chinmaya Mission, we strive to live by the values expressed in the Chinmaya Mission Pledge. We encourage all families to read the pledge here: https://chinmayatoronto.org/cmpledge\n' +
    'As one Chinmaya family, we come together with love, respect, discipline, and a spirit of service so that every child can learn, grow, and thrive in a safe and uplifting environment.',
  sections: [
    {
      id: 'sacred-spaces',
      title: 'Care for Our Sacred Spaces',
      body:
        '• Treat the ashram, classrooms, shrine, and common areas with care, cleanliness, and reverence.\n' +
        '• Help keep classrooms and shared spaces clean and tidy before, during, and after Bala Vihar.\n' +
        '• Treat all Chinmaya Mission property with care and respect.\n' +
        '• The shrine is a sacred space for prayer and reflection. Please do not eat or drink in the shrine.',
    },
    {
      id: 'respect-responsibility',
      title: 'Respect & Responsibility',
      body:
        '• Attend Bala Vihar regularly and arrive on time as an expression of discipline, respect for teachers, and commitment to learning.\n' +
        '• Treat teachers, volunteers, children, and all families with respect, kindness, and cooperation.\n' +
        '• Verbal or physical abuse will not be tolerated.\n' +
        '• For everyone’s safety, the ashram is a nut-free and egg-free zone.',
    },
    {
      id: 'seva-community',
      title: 'Seva & Community Values',
      body:
        '• Every family is expected to complete 20 hours of seva each year.\n' +
        '• Bala Vihar is sustained by the collective seva of families and volunteers. Each family is encouraged to contribute in whatever way they can to support the Mission and our children.\n' +
        '• Sharing Prasad is a cherished Chinmaya Mission tradition. Families are encouraged to sign up to offer Prasad on a birthday, anniversary, or another special occasion and receive the blessings of serving the Bala Vihar community. For more information on sponsoring Prasad contact Melisha at (647) 280-9613.',
    },
    {
      id: 'registration-parent',
      title: 'Registration & Parent Responsibility',
      body:
        '• Only a parent or legal guardian may register a child for Bala Vihar.\n' +
        '• If you need financial assistance, please contact Usha Kot at 613-729-8511.\n' +
        '• Children ages 1-5 will be placed in the appropriate Shishu Vihar class.\n' +
        '• Children must attend Bala Vihar regularly. If a child misses 3 or more classes, Chinmaya Mission may cancel their registration, including any additional classes, without a refund.',
    },
    {
      id: 'supervision',
      title: 'Bala Vihar Supervision',
      body:
        '• Bala Vihar children must be accompanied by a parent at all times when they are outside the Bala Vihar classroom. Chinmaya Mission will not be responsible for children outside the classroom.\n' +
        '• Shishu Vihar students must be accompanied at all times by a parent or legal guardian, both inside and outside the classroom.\n' +
        '• For Shishu Vihar, only a parent or legal guardian may accompany the child. Other family members are not permitted to accompany the child to Shishu Vihar in place of a parent or legal guardian.',
    },
  ],
  acknowledgement:
    'I confirm that I have read and agree to follow the values and expectations of Chinmaya Mission as taught by Pujya Gurudev Swami Chinmayananda.\n' +
    'I understand that Bala Vihar is sustained through the seva of families and volunteers, and I will support the Mission by contributing in whatever way I can.\n' +
    'Together, as one Chinmaya family, we help create a safe, respectful, disciplined, and uplifting environment where every child can learn, grow, and thrive.',
};

/**
 * True when a family's stored acceptance is current: same school year AND a
 * version at least the current content version. Absent/stale ⇒ must re-accept.
 * Pure — shared by the /family gate, GET /api/setu/disclaimers, and the mobile
 * dashboard so they never diverge.
 */
export function isDisclaimerAccepted(
  accepted: { schoolYear: string; version: number } | null | undefined,
  config: { version: number },
  currentYear: string,
): boolean {
  return (
    !!accepted && accepted.schoolYear === currentYear && accepted.version >= config.version
  );
}
