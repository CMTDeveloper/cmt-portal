/**
 * One-shot: dump a migrated Setu family + its members to stdout so we can
 * verify the new parser populated fields correctly.
 *
 * Usage:
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/inspect-setu-family.ts --legacy-fid 16
 *   pnpm --filter @cmt/portal exec tsx --env-file=.env.local scripts/inspect-setu-family.ts --fid CMT-LKBHRAXE
 */

import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';

interface Args {
  legacyFid: string | null;
  fid: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { legacyFid: null, fid: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--legacy-fid') args.legacyFid = argv[++i] ?? null;
    else if (a === '--fid') args.fid = argv[++i] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fid && !args.legacyFid) {
    console.error('Usage: --legacy-fid <id> | --fid <CMT-...>');
    process.exit(1);
  }

  const db = portalFirestore();
  let familyDoc;
  if (args.fid) {
    familyDoc = await db.collection('families').doc(args.fid).get();
    if (!familyDoc.exists) {
      console.error(`No family with fid=${args.fid}`);
      process.exit(1);
    }
  } else {
    const snap = await db.collection('families').where('legacyFid', '==', String(args.legacyFid)).limit(1).get();
    if (snap.empty) {
      console.error(`No family with legacyFid=${args.legacyFid}`);
      process.exit(1);
    }
    familyDoc = snap.docs[0]!;
  }

  console.log('=== Family ===');
  console.log(JSON.stringify(familyDoc.data(), null, 2));

  console.log('\n=== Members ===');
  const members = await familyDoc.ref.collection('members').get();
  for (const m of members.docs) {
    console.log(JSON.stringify(m.data(), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
