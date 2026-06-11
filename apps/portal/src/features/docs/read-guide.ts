import { promises as fs } from 'node:fs';
import path from 'node:path';

// The guides live at the REPO root (docs/runbooks/), outside apps/portal.
//   - local dev / vitest / next build: cwd = apps/portal → ../../docs/runbooks
//   - Vercel runtime: outputFileTracingIncludes (next.config.ts) bundles the
//     files; the traced layout preserves the relative monorepo structure, but
//     we probe a couple of roots in case the function cwd differs.
// `file` only ever comes from the registry (never user input), so no path
// traversal is possible — unknown slugs 404 before reaching this function.
const CANDIDATE_DIRS = ['../../docs/runbooks', 'docs/runbooks', '../docs/runbooks'];

export async function readGuideMarkdown(file: string): Promise<string | null> {
  for (const dir of CANDIDATE_DIRS) {
    try {
      return await fs.readFile(path.join(process.cwd(), dir, file), 'utf8');
    } catch {
      // try the next candidate root
    }
  }
  return null;
}
