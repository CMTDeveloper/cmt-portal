import 'server-only';

export interface OtpCodeProps {
  code: string;
}

export function otpCodeEmail({ code }: OtpCodeProps) {
  return {
    subject: 'Your CMT portal verification code',
    text: `Hari OM! Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM!</p>
  <p>Your verification code is:</p>
  <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px; background: #f5f4f0; padding: 12px; display: inline-block">${code}</p>
  <p>This code expires in 10 minutes.</p>
</body></html>`,
  };
}
