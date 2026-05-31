/**
 * Client-side fetch wrapper for GET /api/setu/programs.
 *
 * Used by client components and server pages that need to avoid importing
 * server-only Firebase Admin modules. The API route does the Firestore work;
 * this wrapper just parses the JSON response.
 *
 * Per feedback_client_server_boundary: never call server-only code from a
 * 'use client' component — use a -client fetch wrapper instead.
 */

export interface ClientOfferingItem {
  oid: string;
  termLabel: string;
  startDate: string; // ISO string
  endDate: string | null; // ISO string or null
}

export interface ClientProgramItem {
  programKey: string;
  label: string;
  shortDescription: string;
  termType: string;
  openOfferings: ClientOfferingItem[];
}

/**
 * Fetches the list of active programs with open offerings for the current
 * family's location. Throws on non-OK responses.
 */
export async function fetchEligiblePrograms(): Promise<ClientProgramItem[]> {
  const res = await fetch('/api/setu/programs', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(json.error ?? `programs-fetch-failed:${res.status}`);
  }

  const json = await res.json() as { programs: ClientProgramItem[] };
  return json.programs ?? [];
}
