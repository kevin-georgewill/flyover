import { env } from '../config';

/** Sends transactional email through Resend when configured. In development, logs a safe preview. */
export async function sendTransactionalEmail(input: { to: string; subject: string; html: string; text: string }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (env.NODE_ENV !== 'production') {
      console.info(`[email preview] To: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
      return { delivered: false, previewed: true };
    }
    console.error('Transactional email is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
    return { delivered: false, previewed: false };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Transactional email delivery failed:', response.status, detail.slice(0, 500));
      return { delivered: false, previewed: false };
    }
    return { delivered: true, previewed: false };
  } catch (error) {
    console.error('Transactional email request failed:', error);
    return { delivered: false, previewed: false };
  }
}
