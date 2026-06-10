'use client';
import type { FamilyPrasadView, MoveOption } from './family-assignment';
import type { PrasadPreviewResult } from './publish-assignments';

export async function fetchMyPrasad(): Promise<FamilyPrasadView | null> {
  const res = await fetch('/api/setu/prasad');
  if (!res.ok) throw new Error(`prasad fetch failed: ${res.status}`);
  return ((await res.json()) as { assignment: FamilyPrasadView | null }).assignment;
}

export async function fetchMoveOptions(): Promise<MoveOption[]> {
  const res = await fetch('/api/setu/prasad/options');
  if (!res.ok) throw new Error(`options fetch failed: ${res.status}`);
  return ((await res.json()) as { options: MoveOption[] }).options;
}

export async function movePrasad(date: string): Promise<void> {
  const res = await fetch('/api/setu/prasad/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `move failed: ${res.status}`);
  }
}

export async function fetchPrasadPreview(pid: string, cap?: number): Promise<PrasadPreviewResult> {
  const res = await fetch('/api/admin/prasad/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cap != null ? { pid, cap } : { pid }),
  });
  if (!res.ok) throw new Error(`preview failed: ${res.status}`);
  return (await res.json()) as PrasadPreviewResult;
}

export async function publishPrasad(pid: string, cap: number): Promise<PrasadPreviewResult> {
  const res = await fetch('/api/admin/prasad/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid, cap }),
  });
  if (!res.ok) throw new Error(`publish failed: ${res.status}`);
  return (await res.json()) as PrasadPreviewResult;
}

export interface AdminPrasadAssignment {
  paid: string;
  fid: string;
  familyName: string;
  location: string;
  date: string;
  youngestName: string | null;
  reason: string;
  source: string;
  status: string;
}

export async function fetchPrasadAssignments(pid: string, date?: string): Promise<AdminPrasadAssignment[]> {
  const qs = new URLSearchParams(date ? { pid, date } : { pid });
  const res = await fetch(`/api/admin/prasad?${qs}`);
  if (!res.ok) throw new Error(`assignments fetch failed: ${res.status}`);
  return ((await res.json()) as { assignments: AdminPrasadAssignment[] }).assignments;
}

export async function adminReassignPrasad(body: { paid: string; date?: string; cancel?: boolean }): Promise<void> {
  const res = await fetch('/api/admin/prasad/assignment', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`reassign failed: ${res.status}`);
}
