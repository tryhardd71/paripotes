import nodemailer from 'nodemailer';

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
  const sender = process.env.BREVO_SENDER_EMAIL || getSenderEmail();
  if (!apiKey || !sender) return null;

  let res;
  try {
    res = await fetchWithTimeout('https://api.brevo.com/v3/smtp/email', {
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
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Brevo met trop de temps à répondre');
    throw e;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.message || err.error || `Erreur Brevo ${res.status}`;
    throw new Error(detail);
  }
  return { method: 'brevo' };
}

async function sendViaResend(to, subject, text, html) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'PariPotes <onboarding@resend.dev>';
  if (!apiKey) return null;
  // onboarding@resend.dev = test uniquement, pas pour les potes
  if (from.includes('onboarding@resend.dev')) return null;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
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

function smtpAuth() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return {
    user: process.env.SMTP_USER.trim(),
    pass: cleanAppPassword(process.env.SMTP_PASS),
  };
}

async function sendViaSmtp(to, subject, text, html) {
  const auth = smtpAuth();
  if (!auth) return null;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const attempts = [
    { port: Number(process.env.SMTP_PORT || 587), secure: false, requireTLS: true },
    { port: 465, secure: true, requireTLS: false },
  ];

  let lastError = null;
  for (const cfg of attempts) {
    try {
      const transport = nodemailer.createTransport({
        host,
        port: cfg.port,
        secure: cfg.secure,
        requireTLS: cfg.requireTLS,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
        auth,
      });
      await transport.sendMail({
        from: process.env.SMTP_FROM || `PariPotes <${process.env.SMTP_USER}>`,
        to,
        subject,
        text,
        html,
      });
      transport.close();
      return { method: `smtp:${cfg.port}` };
    } catch (err) {
      lastError = err;
      console.warn(`SMTP ${cfg.port} failed:`, err.message);
    }
  }
  throw lastError || new Error('SMTP indisponible');
}

export async function sendOtpEmail(to, code) {
  const subject = `${code} — Ton code PariPotes`;
  const text = `Salut !\n\nTon code de connexion PariPotes : ${code}\n\nIl expire dans 10 minutes.\n\nBons paris entre potes ! ⚽`;
  const html = buildOtpHtml(code);

  // Brevo en premier. SMTP ignoré si Brevo configuré (bloqué sur Render de toute façon)
  const methods = [sendViaBrevo, sendViaResend];
  if (!process.env.BREVO_API_KEY) methods.push(sendViaSmtp);
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