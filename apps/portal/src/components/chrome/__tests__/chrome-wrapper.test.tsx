import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChromeWrapper } from '../chrome-wrapper';

// ChromeWrapper hides the public marketing chrome on routes that own their own
// themed chrome. We drive usePathname() to assert which routes suppress it.
let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function renderAt(pathname: string) {
  mockPathname = pathname;
  return render(
    <ChromeWrapper>
      <div data-testid="marketing-chrome">marketing header</div>
    </ChromeWrapper>,
  );
}

describe('ChromeWrapper suppression', () => {
  beforeEach(() => {
    mockPathname = '/';
  });

  it('renders the marketing chrome on a public marketing route (/about)', () => {
    renderAt('/about');
    expect(screen.getByTestId('marketing-chrome')).toBeInTheDocument();
  });

  it.each([
    '/family',
    '/complete-profile',
    '/acknowledgements',
    '/acknowledgements/',
    '/sign-in',
    '/welcome',
    '/admin',
    '/teacher',
  ])('suppresses the marketing chrome on the self-chromed route %s', (pathname) => {
    renderAt(pathname);
    expect(screen.queryByTestId('marketing-chrome')).toBeNull();
  });
});
