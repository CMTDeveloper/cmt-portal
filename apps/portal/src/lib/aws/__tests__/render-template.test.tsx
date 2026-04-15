import { describe, it, expect } from 'vitest';
import { renderEmailTemplate } from '../render-template';

describe('renderEmailTemplate', () => {
  it('renders otp-code template', () => {
    const { subject, html, text } = renderEmailTemplate('otp-code', { code: '123456' });
    expect(subject).toMatch(/verification code/i);
    expect(html).toContain('123456');
    expect(text).toContain('123456');
  });

  it('renders payment-reminder template', () => {
    const { subject, html, text } = renderEmailTemplate('payment-reminder', {
      familyName: 'Acme',
    });
    expect(subject).toMatch(/payment/i);
    expect(html).toContain('Acme');
    expect(text).toContain('Acme');
  });

  it('renders donation-thank-you template', () => {
    const { subject, html, text } = renderEmailTemplate('donation-thank-you', {
      familyName: 'Acme',
    });
    expect(subject).toMatch(/thank/i);
    expect(html).toContain('Acme');
    expect(text).toContain('Acme');
  });

  it('throws on unknown template', () => {
    expect(() =>
      // @ts-expect-error testing unknown
      renderEmailTemplate('unknown', {}),
    ).toThrow(/unknown.*template/i);
  });
});
