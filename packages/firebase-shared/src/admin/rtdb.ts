import { getDatabase, type Database } from 'firebase-admin/database';
import { getMasterApp } from './apps';

export function masterRtdb(): Database {
  return getDatabase(getMasterApp());
}

export async function readRtdb<T>(path: string): Promise<T | null> {
  const snap = await masterRtdb().ref(path).once('value');
  const value = snap.val();
  return (value as T | null) ?? null;
}

// Intentionally: NO writeRtdb, NO updateRtdb, NO pushRtdb, NO removeRtdb.
// RTDB is read-only by convention and by absence of helpers.
