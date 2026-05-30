/**
 * Refresh the `family-check-ins` collection PROD → UAT (read-only on prod).
 *
 * The standalone check-in app writes family-check-ins to the prod
 * (MASTER_FIREBASE) project's Firestore — the same project that holds the
 * legacy roster RTDB. The portal reads family-check-ins from its OWN Firestore,
 * so to test current-year attendance in UAT we copy the live prod collection
 * into the UAT portal Firestore. This NEVER writes to prod — source (master) is
 * read-only; the only writes go to the UAT portal project.
 *
 * Path copied: family-check-ins/{fid} (parent) + .../checkIns/{YYYY-MM-DD}.
 *
 * Usage:
 *   pnpm --filter @cmt/portal refresh:check-ins -- --dry-run
 *   pnpm --filter @cmt/portal refresh:check-ins
 *   pnpm --filter @cmt/portal refresh:check-ins -- --fid 1257
 *   pnpm --filter @cmt/portal refresh:check-ins -- --since 2025-09-01   # only recent
 *
 * Refuses to write if the DEST (PORTAL_FIREBASE_PROJECT_ID) is prod, unless
 * --allow-prod-dest (you should never need that — UAT is the target).
 */

import { getFirestore } from 'firebase-admin/firestore';
import { getPortalApp, getMasterApp } from '@cmt/firebase-shared/admin/apps';

const COLLECTION = 'family-check-ins';
const SUB = 'checkIns';
const BATCH_FLUSH = 450; // < Firestore's 500-op batch limit

function parseArgs(argv: string[]) {
  const fidIdx = argv.indexOf('--fid');
  const limIdx = argv.indexOf('--limit');
  const sinceIdx = argv.indexOf('--since');
  return {
    dryRun: argv.includes('--dry-run'),
    allowProdDest: argv.includes('--allow-prod-dest'),
    onlyFid: fidIdx >= 0 ? argv[fidIdx + 1] : null,
    limit: limIdx >= 0 ? Number(argv[limIdx + 1]) : Infinity,
    since: sinceIdx >= 0 ? (argv[sinceIdx + 1] ?? null) : null, // YYYY-MM-DD
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const destProject = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '';
  const srcProject = process.env.MASTER_FIREBASE_PROJECT_ID ?? '';
  if (!destProject || !srcProject) {
    console.error('Missing PORTAL_FIREBASE_PROJECT_ID or MASTER_FIREBASE_PROJECT_ID. Is .env.local loaded?');
    process.exit(1);
  }
  if (destProject === 'chinmaya-setu-715b8' && !args.allowProdDest) {
    console.error(`Refusing to WRITE to prod dest (${destProject}). This script targets UAT.`);
    process.exit(1);
  }

  console.log(`Source (read-only): ${srcProject}  →  Dest: ${destProject}${args.dryRun ? ' [DRY RUN]' : ''}`);
  if (args.since) console.log(`Only copying check-ins on/after ${args.since}.`);

  const src = getFirestore(getMasterApp());
  const dst = getFirestore(getPortalApp());

  const familyRefs = args.onlyFid
    ? [src.collection(COLLECTION).doc(args.onlyFid)]
    : (await src.collection(COLLECTION).get()).docs.map((d) => d.ref);

  let famCount = 0;
  let docCount = 0;
  let minDate = '9999';
  let maxDate = '0000';
  let batch = dst.batch();
  let ops = 0;
  const flush = async () => {
    if (ops > 0 && !args.dryRun) {
      await batch.commit();
      batch = dst.batch();
      ops = 0;
    }
  };

  for (const famRef of familyRefs) {
    if (famCount >= args.limit) break;
    famCount++;
    const fid = famRef.id;

    const [parent, checkIns] = await Promise.all([
      famRef.get(),
      famRef.collection(SUB).get(),
    ]);

    if (!args.dryRun && parent.exists) {
      batch.set(dst.collection(COLLECTION).doc(fid), parent.data() ?? {}, { merge: true });
      ops++;
    }

    for (const c of checkIns.docs) {
      if (args.since && c.id < args.since) continue;
      if (c.id < minDate) minDate = c.id;
      if (c.id > maxDate) maxDate = c.id;
      docCount++;
      if (!args.dryRun) {
        batch.set(dst.collection(COLLECTION).doc(fid).collection(SUB).doc(c.id), c.data());
        ops++;
        if (ops >= BATCH_FLUSH) await flush();
      }
    }

    if (famCount % 100 === 0) console.log(`  …${famCount} families, ${docCount} check-in docs so far`);
  }
  await flush();

  console.log(
    `Done. families=${famCount} checkInDocs=${docCount} dateRange=${docCount ? `${minDate}..${maxDate}` : 'none'}${args.dryRun ? ' (dry run — nothing written)' : ''}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
