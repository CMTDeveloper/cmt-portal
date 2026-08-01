/**
 * READ-ONLY. Everything that matters about one family's enrollment + payment
 * state, in one shot, so a live payment test can be diffed before/after instead
 * of trusting a green screen.
 *
 * Prints the family doc, every member (with grade), EVERY enrollment (not just
 * the "active" one - the N=2 trap: a bespoke surface that picks
 * `find(status==='active')` silently follows the wrong program once a second
 * enrollment exists), every donation, and every pledge.
 *
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/inspect-family-payment-state.ts <email-or-fid>
 */
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { hashContactKey } from '../src/features/setu/registration/hash-contact-key';

function ts(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object' && v !== null && '_seconds' in (v as Record<string, unknown>)) {
    return new Date((v as { _seconds: number })._seconds * 1000).toISOString();
  }
  if (typeof v === 'number') return new Date(v).toISOString();
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate().toISOString();
  return String(v);
}

async function main() {
  const input = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!input) { console.error('usage: inspect-family-payment-state.ts <email-or-fid>'); process.exitCode = 1; return; }
  const db = portalFirestore();
  console.log(`project: ${process.env.PORTAL_FIREBASE_PROJECT_ID}\n`);

  let fid = input;
  if (input.includes('@')) {
    const ck = await db.collection('contactKeys').doc(hashContactKey('email', input.trim().toLowerCase())).get();
    if (!ck.exists) { console.log(`no contactKey for ${input}`); return; }
    fid = String(ck.data()?.['fid']);
  }

  const famRef = db.collection('families').doc(fid);
  const fam = await famRef.get();
  if (!fam.exists) { console.log(`family ${fid} not found`); return; }
  const f = fam.data()!;
  console.log(`FAMILY ${fid}`);
  console.log(`   legacyFid=${f['legacyFid'] ?? '—'}  publicFid=${f['publicFid'] ?? 'null (not yet enrolled)'}  location=${f['location']}`);
  console.log(`   disclaimersAccepted=${JSON.stringify(f['disclaimersAccepted'] ?? null)}`);

  const members = await famRef.collection('members').get();
  console.log(`\nMEMBERS (${members.size})`);
  for (const m of members.docs) {
    const d = m.data();
    console.log(`   ${m.id}  ${String(d['firstName'] ?? '')} ${String(d['lastName'] ?? '')}`.trimEnd() +
      `  grade=${JSON.stringify(d['schoolGrade'] ?? null)}  gradeSchoolYear=${d['gradeSchoolYear'] ?? '—'}  publicMid=${d['publicMid'] ?? '—'}`);
  }

  // EVERY enrollment, not just active - see the N=2 note above.
  const enrollments = await famRef.collection('enrollments').get();
  console.log(`\nENROLLMENTS (${enrollments.size})`);
  for (const e of enrollments.docs) {
    const d = e.data();
    console.log(`   ${e.id}`);
    console.log(`      programKey=${d['programKey'] ?? '—'}  oid=${d['oid'] ?? '—'}  status=${d['status']}  enrolledVia=${d['enrolledVia'] ?? '—'}`);
    console.log(`      enrolledMids=${JSON.stringify(d['enrolledMids'] ?? d['childrenMids'] ?? [])}`);
    console.log(`      pendingEmailSentAt=${ts(d['pendingEmailSentAt'])}`);
  }

  const donations = await db.collection('donations').where('fid', '==', fid).get();
  console.log(`\nDONATIONS (${donations.size})`);
  for (const dn of donations.docs) {
    const d = dn.data();
    console.log(`   ${dn.id}  status=${d['status']}  amount=${d['amount'] ?? d['amountCad'] ?? '?'}  eid=${d['eid'] ?? '—'}  createdAt=${ts(d['createdAt'])}`);
  }

  const pledges = await db.collection('pledges').where('fid', '==', fid).get();
  console.log(`\nPLEDGES (${pledges.size})`);
  for (const p of pledges.docs) {
    const d = p.data();
    console.log(`   ${p.id}  status=${d['status']}  createdAt=${ts(d['createdAt'])}  activatedAt=${ts(d['activatedAt'])}`);
    console.log(`      setupSessionId=${d['setupSessionId'] ?? '—'}  subscriptionId=${d['subscriptionId'] ?? '—'}`);
  }
  if (pledges.empty && donations.empty) console.log('\n(no payment records yet)');
}

void main();
