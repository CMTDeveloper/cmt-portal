import 'server-only';

export interface DonationThankYouProps {
  familyName: string;
}

export function donationThankYouEmail({ familyName }: DonationThankYouProps) {
  return {
    subject: 'Thank you from Chinmaya Mission Toronto',
    text: `Dear ${familyName}, thank you for your generous donation. Your seva makes our programs possible. Hari OM!`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Dear ${familyName},</p>
  <p>Thank you for your generous donation. Your seva makes our programs possible.</p>
  <p>Hari OM!</p>
</body></html>`,
  };
}
