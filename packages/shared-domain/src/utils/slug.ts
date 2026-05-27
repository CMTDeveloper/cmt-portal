/**
 * Converts an arbitrary string into a safe Firestore document-ID slug.
 *
 * Rules:
 *  1. Trim whitespace.
 *  2. Lowercase.
 *  3. Replace any character that is not [a-z0-9] with a dash.
 *  4. Collapse consecutive dashes into one.
 *  5. Strip leading/trailing dashes.
 *
 * Returns an empty string for inputs that produce no valid characters —
 * callers must reject empty slugs before writing to Firestore.
 */
export function toSafeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
