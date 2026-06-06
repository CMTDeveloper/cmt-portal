/**
 * READ-ONLY probe: can the portal read the door app's Firestore collections via
 * the master service account? The teacher-attendance feature (T1–T4) reads
 * `family-check-ins` / `guest-families` from prod 715b8 through
 * checkInSourceFirestore(). This confirms the master SA actually has Firestore
 * READ on 715b8 before go-live. It performs ONLY `.limit(1).get()` reads — no
 * writes, ever. Run: `pnpm --filter @cmt/portal check:door-access`.
 */
import { checkInSourceFirestore } from '../src/features/setu/attendance/check-in-source';

async function probe(collection: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const snap = await checkInSourceFirestore().collection(collection).limit(1).get();
    return { ok: true, count: snap.size };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

async function main() {
  const portalProject = process.env.PORTAL_FIREBASE_PROJECT_ID ?? '(unset)';
  const masterProject = process.env.MASTER_FIREBASE_PROJECT_ID ?? '(unset)';
  console.log('Door-Firestore access probe (READ-ONLY)');
  console.log(`  portal project: ${portalProject}`);
  console.log(`  master project: ${masterProject}`);
  console.log(`  reading via:    ${portalProject === masterProject ? 'portalFirestore (same project)' : 'masterFirestore (cross-project bridge)'}`);
  console.log('');

  let allOk = true;
  for (const c of ['family-check-ins', 'guest-families']) {
    const r = await probe(c);
    if (r.ok) {
      console.log(`  ✅ ${c}: readable (sampled ${r.count} doc${r.count === 1 ? '' : 's'})`);
    } else {
      allOk = false;
      console.log(`  ❌ ${c}: ${r.error}`);
    }
  }
  console.log('');
  if (allOk) {
    console.log('PASS — the master service account can read the door collections. Door data will appear in prod.');
  } else {
    console.log('FAIL — grant the master service account Cloud Firestore READ (roles/datastore.viewer)');
    console.log('on the prod project (chinmaya-setu-715b8). Until then teacher/family screens degrade to no-door-data (no crash).');
    process.exitCode = 1;
  }
}

void main();
