import 'server-only';

export interface SetuInviteEmailProps {
  inviterName: string;
  familyName: string;
  relation: string;
  acceptUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function setuInviteEmail({ inviterName, familyName, relation, acceptUrl }: SetuInviteEmailProps) {
  const inviterNameHtml = escapeHtml(inviterName);
  const familyNameHtml = escapeHtml(familyName);
  const relationHtml = escapeHtml(relation);
  const acceptUrlHtml = escapeHtml(acceptUrl);

  return {
    subject: `${inviterName} invited you to join the ${familyName} family on Chinmaya Setu`,
    text: `Hari OM!\n\n${inviterName} has invited you to join the ${familyName} family on the Chinmaya Setu portal as a ${relation}.\n\nAccept the invitation here:\n${acceptUrl}\n\nThis invitation will expire in 14 days.\n\nIf you did not expect this invitation, you can safely ignore this email.\n\nHari OM,\nChinmaya Mission Toronto`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54; max-width: 600px; margin: 0 auto; padding: 24px">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM!</p>
  <div style="background: #f5f4f0; border-left: 4px solid #214a54; padding: 16px; margin: 20px 0">
    <p style="margin: 0"><strong>${inviterNameHtml}</strong> has invited you to join the <strong>${familyNameHtml}</strong> family on the Chinmaya Setu portal as a <strong>${relationHtml}</strong>.</p>
  </div>
  <p>Click the button below to accept the invitation:</p>
  <p>
    <a href="${acceptUrlHtml}" style="display: inline-block; background: #214a54; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold">Accept Invitation</a>
  </p>
  <p style="color: #666; font-size: 14px">Or copy and paste this link into your browser:<br>${acceptUrlHtml}</p>
  <p style="color: #666; font-size: 14px">This invitation will expire in 14 days. If you did not expect this invitation, you can safely ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #e0ddd6; margin: 24px 0">
  <p style="color: #214a54; font-size: 14px">Hari OM,<br>Chinmaya Mission Toronto</p>
</body></html>`,
  };
}
