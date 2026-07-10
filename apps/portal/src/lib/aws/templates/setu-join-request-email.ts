import 'server-only';

export interface SetuJoinRequestEmailProps {
  // The name the requester supplied (or a sensible fallback) — shown to the
  // manager so they know who is asking to join.
  requesterName: string;
  // The contact the requester matched on (email or phone) — echoed so the
  // manager can recognise them.
  requesterContact: string;
  familyName: string;
  // Link to the manager's approve page (/join-request/[token]).
  reviewUrl: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function setuJoinRequestEmail({
  requesterName,
  requesterContact,
  familyName,
  reviewUrl,
}: SetuJoinRequestEmailProps) {
  const requesterNameHtml = escapeHtml(requesterName);
  const requesterContactHtml = escapeHtml(requesterContact);
  const familyNameHtml = escapeHtml(familyName);
  const reviewUrlHtml = escapeHtml(reviewUrl);

  return {
    subject: `${requesterName} is requesting to join the ${familyName} family on Chinmaya Setu`,
    text: `Hari OM!\n\n${requesterName} (${requesterContact}) has asked to join the ${familyName} family on the Chinmaya Setu portal. As a family manager you can approve or decline this request.\n\nReview the request here:\n${reviewUrl}\n\nThis request will expire in 14 days.\n\nIf you don't recognise this person, you can safely decline or ignore this email.\n\nHari OM,\nChinmaya Mission Toronto`,
    html: `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; color: #214a54; max-width: 600px; margin: 0 auto; padding: 24px">
  <h1 style="color: #214a54">Chinmaya Mission Toronto</h1>
  <p>Hari OM!</p>
  <div style="background: #f5f4f0; border-left: 4px solid #214a54; padding: 16px; margin: 20px 0">
    <p style="margin: 0"><strong>${requesterNameHtml}</strong> (${requesterContactHtml}) has asked to join the <strong>${familyNameHtml}</strong> family on the Chinmaya Setu portal.</p>
  </div>
  <p>As a family manager you can approve or decline this request:</p>
  <p>
    <a href="${reviewUrlHtml}" style="display: inline-block; background: #214a54; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold">Review request</a>
  </p>
  <p style="color: #666; font-size: 14px">Or copy and paste this link into your browser:<br>${reviewUrlHtml}</p>
  <p style="color: #666; font-size: 14px">This request will expire in 14 days. If you don't recognise this person, you can safely decline or ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #e0ddd6; margin: 24px 0">
  <p style="color: #214a54; font-size: 14px">Hari OM,<br>Chinmaya Mission Toronto</p>
</body></html>`,
  };
}
