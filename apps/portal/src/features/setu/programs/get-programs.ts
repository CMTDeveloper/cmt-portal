import { cacheLife, cacheTag } from 'next/cache';
import { portalFirestore } from '@cmt/firebase-shared/admin/firestore';
import type { ProgramDoc } from '@cmt/shared-domain';

function toDate(v: unknown): Date {
  if (v !== null && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (v instanceof Date) return v;
  return new Date(v as string);
}

function docToProgram(data: Record<string, unknown>): ProgramDoc {
  return {
    programKey: data['programKey'] as string,
    label: data['label'] as string,
    shortDescription: (data['shortDescription'] as string | undefined) ?? '',
    status: data['status'] as ProgramDoc['status'],
    locations: (data['locations'] as ProgramDoc['locations']) ?? [],
    termType: data['termType'] as ProgramDoc['termType'],
    eligibility: data['eligibility'] as ProgramDoc['eligibility'],
    capabilities: data['capabilities'] as ProgramDoc['capabilities'],
    displayOrder: (data['displayOrder'] as number) ?? 0,
    createdAt: toDate(data['createdAt']),
    createdBy: data['createdBy'] as string,
    updatedAt: toDate(data['updatedAt']),
    updatedBy: data['updatedBy'] as string,
  };
}

/**
 * Returns the program doc for a given key, or null if not found.
 * Cached via Next.js 16 Cache Components. revalidateTag('programs') or
 * revalidateTag(`program-${key}`) in mutation routes invalidates this.
 * cacheLife 'family' profile is defined in next.config.ts.
 */
export async function getProgram(programKey: string): Promise<ProgramDoc | null> {
  'use cache';
  cacheTag('programs', `program-${programKey}`);
  cacheLife('family');
  const snap = await portalFirestore().collection('programs').doc(programKey).get();
  return snap.exists ? docToProgram(snap.data() as Record<string, unknown>) : null;
}

/**
 * Returns all programs ordered by displayOrder ascending.
 * Cached at the 'programs' tag — invalidated when any program is created/updated.
 */
export async function listPrograms(): Promise<ProgramDoc[]> {
  'use cache';
  cacheTag('programs');
  cacheLife('family');
  const snap = await portalFirestore()
    .collection('programs')
    .orderBy('displayOrder', 'asc')
    .get();
  return snap.docs.map((d) => docToProgram(d.data() as Record<string, unknown>));
}

/**
 * Asserts that a program exists and is active.
 * Throws 'program-not-available' when missing or non-active.
 */
export async function assertProgramActive(programKey: string): Promise<ProgramDoc> {
  const p = await getProgram(programKey);
  if (!p || p.status !== 'active') throw new Error('program-not-available');
  return p;
}
