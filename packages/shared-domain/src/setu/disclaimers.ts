import type { DisclaimersConfig } from './schemas/disclaimers';

// Re-export the schema module so consumers (and the disclaimers tests) have a
// single import site for the config/section/acceptance schemas alongside the
// seed default + predicate below. Same-declaration re-export — no ambiguity in
// the setu barrel, and no cycle (schemas/disclaimers.ts imports only zod).
export * from './schemas/disclaimers';

// Seed content shown before any admin edit (getDisclaimersConfig falls back to
// this when app_config/disclaimers is absent). DRAFT copy — admin-editable at
// /admin/disclaimers. Section ids are stable and must not change.
export const DEFAULT_DISCLAIMERS_CONFIG: DisclaimersConfig = {
  version: 1,
  sections: [
    {
      id: 'respect-responsibility',
      title: 'Respect & Responsibility',
      body:
        'We treat every sevak, teacher, family, and child with kindness and respect. We arrive on time, follow the guidance of teachers and volunteers, and take responsibility for our children’s conduct while on Mission premises.',
    },
    {
      id: 'sacred-spaces',
      title: 'Care for Sacred Spaces',
      body:
        'Chinmaya Mission’s halls, shrines, and grounds are sacred. We remove footwear where required, keep spaces clean, handle sacred images and materials with reverence, and help leave every room better than we found it.',
    },
    {
      id: 'community-values',
      title: 'Community Values',
      body:
        'Our community runs on seva (selfless service). Each family commits to contributing at least 20 hours of seva per school year — helping with events, classes, kitchen, setup, or other needs — and to participating in the life of the Mission beyond the classroom.',
    },
    {
      id: 'chinmaya-values',
      title: 'Acknowledgement of Chinmaya Values',
      body:
        'We understand that Chinmaya Mission Toronto is a Hindu spiritual and cultural organization rooted in the teachings of Pujya Gurudev Swami Chinmayananda, and we acknowledge and support the Mission’s values and the spiritual nature of its programs.',
    },
  ],
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
