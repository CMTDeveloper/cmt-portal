import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── next/navigation — redirect ────────────────────────────────────────────────
const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

// ── next/link ─────────────────────────────────────────────────────────────────
vi.mock('next/link', () => ({
  default: ({ children, href, className, style }: { children: React.ReactNode; href: string; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// ── CMT UI ────────────────────────────────────────────────────────────────────
vi.mock('@cmt/ui', () => ({
  SetuIcon: {
    back: () => <span>back</span>,
    card: () => <span>card</span>,
    mail: () => <span>mail</span>,
    receipt: () => <span>receipt</span>,
  },
  Rosette: () => <div />,
}));

// ── Chrome atoms ──────────────────────────────────────────────────────────────
vi.mock('@/features/family/components/atoms', () => ({
  CspRoot: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PayMethod: ({ label }: { label: string }) => <div>{label}</div>,
}));

import DonatePage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag off → redirect
// ─────────────────────────────────────────────────────────────────────────────

describe('DonatePage — flag off', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to /family/enroll when donations flag is false', async () => {
    await DonatePage();
    expect(redirectMock).toHaveBeenCalledWith('/family/enroll');
  });

  it('does not render page UI when flag is off', async () => {
    await DonatePage();
    expect(screen.queryByText(/dakshina/i)).toBeNull();
  });
});

describe('DonatePage — flag unset (defaults to off)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('redirects to /family/enroll when donations flag is empty string', async () => {
    await DonatePage();
    expect(redirectMock).toHaveBeenCalledWith('/family/enroll');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag on → renders content
// ─────────────────────────────────────────────────────────────────────────────

describe('DonatePage — flag on', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_FEATURE_SETU_DONATIONS', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not redirect when donations flag is true', async () => {
    const page = await DonatePage();
    render(page);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('renders the donation placeholder UI', async () => {
    const page = await DonatePage();
    render(page);
    expect(screen.getAllByText(/dakshina/i).length).toBeGreaterThan(0);
  });

  it('renders the "Coming soon" banner', async () => {
    const page = await DonatePage();
    render(page);
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0);
  });
});
