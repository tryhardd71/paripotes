import nodemailer from 'nodemailer';

function buildOtpHtml(code) {
  return `
    <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f172a;color:#f8fafc;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:40px">🎲</span>
        <h1 style="color:#f59e0b;margin:8px 0 4px;font-size:24px">Proba Potes</h1>
        <p style="color:#94a3b8;margin:0;font-size:14px">Forum de probas entre potes</p>
      </div>
      <p style="color:#cbd5e1;font-size:16px">Salut ! Voici ton code :</p>
      <div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#f59e0b;padding:20px;background:#1e293b;border-radius:12px;text-align:center;margin:16px 0">${code}</div>
      <p style="color:#64748b;font-size:13px;text-align:center">Ce code expire dans <strong>10 minutes</strong>.</p>
    </div>
  `;
}

async function fetchWithTimeout(url, opts, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function sendViaBrevo(to, subject, text, html) {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER;
  if (!apiKey || !sender) return null;

  const res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Proba Potes', email: sender },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Erreur Brevo ${res.status}`);
  }
  return { method: 'brevo' };
}

export async function sendOtpEmail(to, code) {
  const subject = `${code} — Ton code Proba Potes`;
  const text = `Ton code Proba Potes : ${code}\nExpire dans 10 minutes.`;
  const html = buildOtpHtml(code);

  if (process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) {
    const result = await sendViaBrevo(to, subject, text, html);
    if (result) return result;
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS.replace(/[\s-]/g, ''),
      },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || `Proba Potes <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    return { method: 'smtp' };
  }

  throw new Error('Email non configuré sur le serveur');
}