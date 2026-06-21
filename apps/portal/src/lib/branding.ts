/**
 * Centralized site / brand strings (issue #11). Keep ALL brand wording here
 * rather than hardcoding it across pages, components, and metadata.
 *
 * Per-deployment overrides come from NEXT_PUBLIC_* env vars, read with a LITERAL
 * `process.env.NEXT_PUBLIC_x` access so Next.js statically inlines them into the
 * client bundle — do NOT refactor these into a `readEnv(name)` helper, that
 * defeats the static replacement and the values silently become undefined.
 */
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? 'Chinmaya Setu';
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME ?? 'Chinmaya Mission Toronto';

/** Default document title — used on the home page and any page without its own
 *  title: "Chinmaya Setu | Chinmaya Mission Toronto". */
export const SITE_TITLE_DEFAULT = `${SITE_NAME} | ${ORG_NAME}`;

/** Title template applied to every child-page title → "Page title | Chinmaya Setu". */
export const SITE_TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** Default meta description. */
export const SITE_DESCRIPTION = `Bridging knowledge, community, and spiritual practice — ${ORG_NAME} portal.`;
