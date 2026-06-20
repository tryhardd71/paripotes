const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');

function showAuthPanel(id) {
  ['panel-login', 'panel-register-email', 'panel-register-code', 'panel-forgot'].forEach((p) => {
    document.getElementById(p).classList.toggle('hidden', p !== id);
  });
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}

function goToLogin(email, message) {
  document.getElementById('show-login').click();
  if (email) document.getElementById('login-email').value = email;
  if (message) showAuthError(message);
}

document.getElementById('show-login').onclick = () => {
  document.getElementById('show-login').classList.add('active');
  document.getElementById('show-register').classList.remove('active');
  showAuthPanel('panel-login');
  hideAuthError();
  const saved = localStorage.getItem('pp_email');
  if (saved) document.getElementById('login-email').value = saved;
};

document.getElementById('show-register').onclick = () => {
  document.getElementById('show-register').classList.add('active');
  document.getElementById('show-login').classList.remove('active');
  showAuthPanel('panel-register-email');
  hideAuthError();
};

document.getElementById('login-btn').onclick = async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const rememberMe = document.getElementById('remember-me').checked;
  if (!email || !password) return showAuthError('Email et mot de passe requis');
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Connexion...';
  try {
    const data = await window.fetchWithTimeout('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
    });
    window.saveSession(data);
    window.showMain();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
};

document.getElementById('send-code-btn').onclick = async () => {
  const email = document.getElementById('register-email').value.trim();
  if (!email) return showAuthError('Entre ton email');
  const btn = document.getElementById('send-code-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';
  hideAuthError();
  try {
    const check = await window.fetchWithTimeout(`/api/auth/check?email=${encodeURIComponent(email)}`);
    if (check.exists && check.hasPassword) {
      goToLogin(email, 'Compte déjà créé — connecte-toi avec ton mot de passe (pas besoin de code).');
      return;
    }
    await window.fetchWithTimeout('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    document.getElementById('email-display').textContent = email;
    showAuthPanel('panel-register-code');
    document.getElementById('code-input').focus();
    window.toast('Code envoyé ! Vérifie ta boîte mail.');
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Recevoir mon code';
  }
};

document.getElementById('register-btn').onclick = async () => {
  const email = document.getElementById('register-email').value.trim();
  const code = document.getElementById('code-input').value.trim();
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('register-password').value;
  const rememberMe = document.getElementById('remember-me-register').checked;
  if (!code || !password) return showAuthError('Code et mot de passe requis');
  if (password.length < 6) return showAuthError('Mot de passe : 6 caractères minimum');
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  btn.textContent = 'Création...';
  try {
    const data = await window.fetchWithTimeout('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, username, password, rememberMe }),
    });
    window.saveSession(data);
    window.showMain();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer mon compte';
  }
};

document.getElementById('back-register-btn').onclick = () => {
  showAuthPanel('panel-register-email');
  hideAuthError();
};

document.getElementById('forgot-btn').onclick = () => {
  const email = document.getElementById('login-email').value.trim();
  document.getElementById('forgot-email').value = email;
  document.getElementById('forgot-reset-fields').classList.add('hidden');
  showAuthPanel('panel-forgot');
  hideAuthError();
};

document.getElementById('back-login-btn').onclick = () => {
  document.getElementById('show-login').click();
};

document.getElementById('forgot-send-btn').onclick = async () => {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showAuthError('Entre ton email');
  const btn = document.getElementById('forgot-send-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi...';
  try {
    await window.fetchWithTimeout('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, reset: true }),
    });
    document.getElementById('forgot-reset-fields').classList.remove('hidden');
    hideAuthError();
    window.toast('Code envoyé !');
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Envoyer le code';
  }
};

document.getElementById('forgot-reset-btn').onclick = async () => {
  const email = document.getElementById('forgot-email').value.trim();
  const code = document.getElementById('forgot-code').value.trim();
  const password = document.getElementById('forgot-password').value;
  if (!code || !password) return showAuthError('Code et nouveau mot de passe requis');
  try {
    const data = await window.fetchWithTimeout('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password, rememberMe: true }),
    });
    window.saveSession(data);
    window.showMain();
    window.toast('Mot de passe mis à jour !');
  } catch (e) {
    showAuthError(e.message);
  }
};

document.getElementById('logout-btn').onclick = async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  window.clearSession();
  authScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
  document.getElementById('show-login').click();
};

if (localStorage.getItem('pp_email') && localStorage.getItem('pp_remember')) {
  document.getElementById('login-email').value = localStorage.getItem('pp_email');
  document.getElementById('remember-me').checked = true;
}