import { describe, it, expect } from 'vitest';
import { setuInviteEmail } from '../setu-invite-email';

const props = {
  inviterName: 'Raj Sharma',
  familyName: 'Sharma',
  relation: 'Spouse',
  acceptUrl: 'https://portal.chinmayatoronto.org/invite/abc123',
};

describe('setuInviteEmail', () => {
  it('includes inviter name in subject', () => {
    const { subject } = setuInviteEmail(props);
    expect(subject).toContain('Raj Sharma');
  });

  it('includes family name in subject', () => {
    const { subject } = setuInviteEmail(props);
    expect(subject).toContain('Sharma');
  });

  it('includes accept URL in text body', () => {
    const { text } = setuInviteEmail(props);
    expect(text).toContain(props.acceptUrl);
  });

  it('includes accept URL in html body', () => {
    const { html } = setuInviteEmail(props);
    expect(html).toContain(props.acceptUrl);
  });

  it('includes inviter name in text body', () => {
    const { text } = setuInviteEmail(props);
    expect(text).toContain('Raj Sharma');
  });

  it('includes family name in html body', () => {
    const { html } = setuInviteEmail(props);
    expect(html).toContain('Sharma');
  });

  it('includes Hari OM greeting in text', () => {
    const { text } = setuInviteEmail(props);
    expect(text).toContain('Hari OM');
  });

  it('includes Hari OM greeting in html', () => {
    const { html } = setuInviteEmail(props);
    expect(html).toContain('Hari OM');
  });

  it('includes relation in text', () => {
    const { text } = setuInviteEmail(props);
    expect(text).toContain('Spouse');
  });

  it('includes relation in html', () => {
    const { html } = setuInviteEmail(props);
    expect(html).toContain('Spouse');
  });
});
