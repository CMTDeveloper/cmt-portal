// Shared types for the welcome-team family-search feature.
// Side-effect-free — safe to import from both server and client modules.

export type FamilySearchHit = {
  fid: string;
  publicFid: string | null;
  legacyFid: string | null;
  name: string;
  location: string;
  memberCount: number;
};
