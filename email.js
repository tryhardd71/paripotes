import nodemailer from 'nodemailer';

let cachedTransporter = null;

function buildOtpHtml(code) {
  return `
    <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0f172a;color:#f8fafc;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <span style="font-size:40px">⚽</span>
        <h1 style="color:#22c55e;margin:8px 0 4px;font-size:24px">PariPotes</h1>
        <p style="color:#94a3b8;margin:0;font-size:14px">Paris entre potes — Coupe du Monde 2026</p>
      </div>
      <p style="color:#cbd5e1;font-size:16px">Salut ! Voici ton code de connexion :</p>
      <div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#22c55e;padding:20px;background:#1e293b;border-radius:12px;text-align:center;margin:16px 0">${code}</div>
      <p style="color:#64748b;font-size:13px;text-align:center">Ce code expire dans <strong>10 minutes</strong>.<br>Ne le partage avec personne.</p>
    </div>
  `;
}

function getSenderEmail() {
  return process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER || process.env.EMAIL_FROM;
}

async function sendViaBrevo(to, subject, text, html) {
  const apiKey = process.env.BREVO_API_KEY;
  const sender = getSenderEmail();
  if (!apiKey || !sender) return null;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'PariPotes', email: sender },
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

async function sendViaResend(to, subject, text, html) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'PariPotes <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Erreur Resend ${res.status}`);
  }
  return { method: 'resend' };
}

function cleanAppPassword(pass) {
  return (pass || '').replace(/[\s-]/g, '');
}

function getSmtpTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: cleanAppPassword(process.env.SMTP_PASS),
    },
  });
  return cachedTransporter;
}

async function sendViaSmtp(to, subject, text, html) {
  const transport = getSmtpTransporter();
  if (!transport) return null;

  await transport.sendMail({
    from: process.env.SMTP_FROM || `PariPotes <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
  return { method: 'smtp' };
}

export async function sendOtpEmail(to, code) {
  const subject = `${code} — Ton code PariPotes`;
  const text = `Salut !\n\nTon code de connexion PariPotes : ${code}\n\nIl expire dans 10 minutes.\n\nBons paris entre potes ! ⚽`;
  const html = buildOtpHtml(code);

  const methods = [sendViaBrevo, sendViaResend, sendViaSmtp];
  let lastError = null;

  for (const method of methods) {
    try {
      const result = await method(to, subject, text, html);
      if (result) {
        console.log(`📧 Code envoyé à ${to} (${result.method})`);
        return result;
      }
    } catch (err) {
      lastError = err;
      console.warn(`Email via ${method.name} échoué:`, err.message);
    }
  }

  if (lastError?.message?.includes('BadCredentials') || lastError?.message?.includes('535')) {
    throw new Error('Mot de passe Gmail incorrect. Regenere un mot de passe d\'application sur myaccount.google.com/apppasswords puis relance npm run setup');
  }
  throw lastError || new Error('Service email indisponible — relance le serveur apres npm run setup');
}