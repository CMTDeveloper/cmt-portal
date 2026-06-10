import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getMasterApp } from './apps';

export function masterRtdb(): Database {
  return getDatabase(getMasterApp());
}

// RTDB downloads are billed per GB and the legacy layout forces full-node
// reads (no .indexOn), so every read here is defensively de-duplicated:
//  - RTDB_SNAPSHOT_DIR set → resolve from a local JSON snapshot (scripts/dev;
//    captured via `pnpm --filter @cmt/portal snapshot:rtdb`) and NEVER touch
//    the network. Missing files throw rather than silently fall back.
//  - live mode → an in-process TTL cache so repeat reads of the same path
//    (per-family full-roster parses, warm-lambda page loads) download once.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
let snapshotLogged = false;

/** Test hook: clear the read cache + snapshot log latch. */
export function __resetRtdbCacheForTests(): void {
  cache.clear();
  snapshotLogged = false;
}

function readFromSnapshot(dir: string, path: string): unknown {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const top = segments[0];
  if (!top) throw new Error(`readRtdb: cannot resolve path "${path}" from a snapshot`);
  const file = join(dir, `${top}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `readRtdb: snapshot file ${top}.json not found in ${dir} — run \`pnpm --filter @cmt/portal snapshot:rtdb\` to (re)capture it`,
    );
  }
  let node: unknown = JSON.parse(readFileSync(file, 'utf-8'));
  for (const seg of segments.slice(1)) {
    if (node == null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[seg];
  }
  return node ?? null;
}

export async function readRtdb<T>(path: string): Promise<T | null> {
  const snapshotDir = process.env.RTDB_SNAPSHOT_DIR;
  if (snapshotDir) {
    if (!snapshotLogged) {
      console.log(`readRtdb: serving from local RTDB snapshot at ${snapshotDir} (no network reads)`);
      snapshotLogged = true;
    }
    return readFromSnapshot(snapshotDir, path) as T | null;
  }

  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value as T | null;
  }
  const snap = await masterRtdb().ref(path).once('value');
  const value = ((snap.val() as T | null) ?? null) as T | null;
  cache.set(path, { at: Date.now(), value });
  return value;
}

// Intentionally: NO writeRtdb, NO updateRtdb, NO pushRtdb, NO removeRtdb.
// RTDB is read-only by convention and by absence of helpers.
