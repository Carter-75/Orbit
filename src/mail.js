// Delivery is required for verification/recovery; secrets never reach browser responses.
export function createMailer(config) {
  if (!config.emailApiKey || !config.emailFrom) return null;
  return async ({ to, subject, text, signal }) => {
    if (!config.emailApiKey || !config.emailFrom) throw new Error('Email delivery is not configured.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Email provider rejected delivery.');
  };
}
