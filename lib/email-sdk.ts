const GATEWAY = process.env.TERMINAL_AI_GATEWAY_URL!;

interface SendEmailOptions {
  /** Fan-out: send to a different Terminal AI user instead of the token holder.
   *  Only valid when called with a task execution token (cron callbacks).
   *  Credits are charged to the app owner, not the recipient. */
  recipientUserId?: string;
}

/** Send an email to the authenticated user (or a specific recipient from a cron callback).
 *  The gateway resolves the recipient email from the embed token — apps never see
 *  the user's email address. */
export async function sendEmail(
  subject: string,
  html: string,
  embedToken: string,
  options?: SendEmailOptions,
): Promise<{ sent: boolean; messageId: string }> {
  const body: Record<string, unknown> = { subject, html };
  if (options?.recipientUserId) body.recipientUserId = options.recipientUserId;
  const res = await fetch(`${GATEWAY}/email/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${embedToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Email send failed (${res.status}): ${(err as Record<string, string>).error ?? res.statusText}`);
  }
  return res.json();
}
