import { redirect } from 'next/navigation';

/**
 * /family/enroll → /family/enroll/bala-vihar
 *
 * All existing links to /family/enroll (dashboard card, nav) continue to work.
 * The parameterised [programKey] page handles the actual enroll UI for each
 * program, with bala-vihar rendering the same UX as the previous enroll page.
 */
export default function EnrollIndexPage() {
  redirect('/family/enroll/bala-vihar');
}
