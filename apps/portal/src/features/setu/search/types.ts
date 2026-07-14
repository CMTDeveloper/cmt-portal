// Shared types for the welcome-team family-search feature.
// Side-effect-free — safe to import from both server and client modules.

export type FamilySearchHit = {
  fid: string;
  publicFid: string | null;
  legacyFid: string | null;
  name: string;         // stored family name (legacy-derived; kept for fallback)
  parentName: string;   // parents' display name for the card title
  location: string;
  memberCount: number;
};
