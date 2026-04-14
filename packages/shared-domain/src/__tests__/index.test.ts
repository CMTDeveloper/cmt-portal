import { describe, it, expect } from 'vitest';
import * as sharedDomain from '../index';

describe('@cmt/shared-domain', () => {
  it('exports a barrel that loads without throwing', () => {
    expect(sharedDomain).toBeDefined();
  });

  it('exports auth surface added in slice B0', () => {
    expect(Object.keys(sharedDomain)).toContain('ROLES');
    expect(Object.keys(sharedDomain)).toContain('isAdmin');
    expect(Object.keys(sharedDomain)).toContain('canAccessRoute');
    expect(Object.keys(sharedDomain)).toContain('isPublicRoute');
  });
});
