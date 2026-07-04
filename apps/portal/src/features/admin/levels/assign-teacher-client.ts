'use client';

// Client-only fetch wrappers for the inline per-level teacher UI. The table (a
// client component) may NOT call the server-only search/assign helpers directly,
// so it routes through these thin wrappers (repo rule: mock the -client wrapper
// in tests, never the server fn).

export interface TeacherHit {
  mid: string;
  name: string;
  email: string | null;
  fid: string;
  location: string;
}

/** Search assignable teachers by name/email (Task 9 route). Throws on non-OK. */
export async function searchTeachersClient(q: string): Promise<TeacherHit[]> {
  const res = await fetch(`/api/admin/teachers/search?q=${encodeURIComponent(q)}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`teacher-search-${res.status}`);
  return ((await res.json()).hits as TeacherHit[]) ?? [];
}

/** Add a teacher (by mid) to a level (Task 10 route). Throws on non-OK. */
export async function addLevelTeacherClient(levelId: string, mid: string): Promise<void> {
  const res = await fetch(`/api/admin/levels/${encodeURIComponent(levelId)}/teachers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mid }),
  });
  if (!res.ok) throw new Error(`add-teacher-${res.status}`);
}

/** Remove a teacher (by mid) from a level (Task 10 route). Throws on non-OK. */
export async function removeLevelTeacherClient(levelId: string, mid: string): Promise<void> {
  const res = await fetch(`/api/admin/levels/${encodeURIComponent(levelId)}/teachers`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mid }),
  });
  if (!res.ok) throw new Error(`remove-teacher-${res.status}`);
}
