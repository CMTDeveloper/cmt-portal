import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SessionClaims } from '@cmt/shared-domain';
import {
  DOC_CATEGORIES,
  DOC_GUIDES,
  canViewGuide,
  findGuide,
  visibleGuides,
} from '../registry';

const admin: SessionClaims = { uid: 'a', role: 'admin' };
const welcomeTeam: SessionClaims = { uid: 'w', role: 'welcome-team' };
const parentTeacher: SessionClaims = {
  uid: 'pt',
  role: 'family-manager',
  fid: 'FAM001',
  mid: 'FAM001-01',
  extraRoles: ['teacher'],
};
const manager: SessionClaims = { uid: 'm', role: 'family-manager', fid: 'FAM001', mid: 'FAM001-01' };

describe('docs registry', () => {
  it('has unique slugs and files', () => {
    const slugs = DOC_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const files = DOC_GUIDES.map((g) => g.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it('every listed guide file exists in docs/runbooks (guards against renames)', () => {
    // vitest cwd = apps/portal → repo root is two levels up
    for (const guide of DOC_GUIDES) {
      const p = path.join(process.cwd(), '../../docs/runbooks', guide.file);
      expect(existsSync(p), `${guide.file} missing for slug "${guide.slug}"`).toBe(true);
    }
  });

  it('every guide has a known category and a non-empty audience', () => {
    for (const guide of DOC_GUIDES) {
      expect(DOC_CATEGORIES).toContain(guide.category);
      expect(guide.audience.length).toBeGreaterThan(0);
    }
  });

  it('findGuide resolves slugs and rejects unknowns', () => {
    expect(findGuide('prasad')?.file).toBe('prasad-module-guide.md');
    expect(findGuide('nope')).toBeUndefined();
  });
});

describe('docs audience filtering', () => {
  it('admin sees every guide', () => {
    expect(visibleGuides(admin)).toHaveLength(DOC_GUIDES.length);
  });

  it('welcome-team sees only welcome-team-tagged guides (no admin-only)', () => {
    const visible = visibleGuides(welcomeTeam);
    expect(visible.length).toBeGreaterThan(0);
    for (const g of visible) expect(g.audience).toContain('welcome-team');
    expect(visible.some((g) => g.slug === 'admin')).toBe(false);
    expect(visible.some((g) => g.slug === 'rollover')).toBe(false);
  });

  it('a parent-teacher (teacher via extraRoles) sees teacher-tagged guides only', () => {
    const visible = visibleGuides(parentTeacher);
    expect(visible.map((g) => g.slug)).toEqual(['teacher']);
    expect(canViewGuide(parentTeacher, findGuide('teacher')!)).toBe(true);
    expect(canViewGuide(parentTeacher, findGuide('prasad')!)).toBe(false);
  });

  it('plain family roles see nothing', () => {
    expect(visibleGuides(manager)).toHaveLength(0);
  });
});
