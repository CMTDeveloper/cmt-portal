/**
 * READ-ONLY: is a contact known to Setu in whatever project `.env.local`
 * targets? Answers the question the sign-in route deliberately will NOT answer
 * over HTTP - `purpose:'signin'` returns a silent 200 for an unknown contact
 * (anti-enumeration), so a 200 from the API tells you nothing about whether a
 * code was actually sent.
 *
 * Checks the same two places the real lookup does: the `contactKeys/{hash}`
 * index and Firebase Auth.
 *
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/lookup-prod-contact.ts a@b.com c@d.com
 */
import { getAuth } from 'firebase-admin/auth';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import { getPortalApp } from '@cmt/firebase-shared/admin/apps';
import { hashContactKey } from '../src/features/setu/registration/hash-contact-key';

async function main() {
  const contacts = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (contacts.length === 0) {
    console.error('usage: lookup-prod-contact.ts <contact> [contact...]');
    process.exitCode = 1;
    return;
  }

  const db = portalFirestore();
  const auth = getAuth(getPortalApp());
  console.log(`project: ${process.env.PORTAL_FIREBASE_PROJECT_ID}\n`);

  for (const contact of contacts) {
    const normalized = contact.trim().toLowerCase();
    const type = normalized.includes('@') ? 'email' : 'phone';
    const hash = hashContactKey(type, normalized);
    const ck = await db.collection('contactKeys').doc(hash).get();

    let authState = 'no auth user';
    try {
      const u = await auth.getUserByEmail(normalized);
      authState = `auth user ${u.uid} (claims: ${JSON.stringify(u.customClaims ?? {})})`;
    } catch {
      /* stays 'no auth user' */
    }

    console.log(`${normalized}`);
    console.log(`   contactKeys/${hash.slice(0, 12)}…: ${ck.exists ? `FOUND → fid=${ck.data()?.['fid']}` : 'not found'}`);
    console.log(`   ${authState}`);
    console.log(`   → sign-in would ${ck.exists ? 'SEND a code' : 'return a silent 200 and send NOTHING'}`);
    console.log('');
  }
}

void main();
