const TOKEN_KEY = 'proba_token';
const EMAIL_KEY = 'proba_email';

let token = localStorage.getItem(TOKEN_KEY);
let user = null;
let forum = null;
let socket = null;
let forumFilter = 'all';
let showNewTopic = false;

const authScreen = document.getElementById('auth-screen');
const forumScreen = document.getElementById('forum-screen');
const app = document.getElementById('app');

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}

function showAuthPanel(id) {
  ['panel-login', 'panel-register-email', 'panel-register-code'].forEach((p) => {
    document.getElementById(p).classList.toggle('hidden', p !== id);
  });
}

function showAuth() {
  authScreen.classList.remove('hidden');
  forumScreen.classList.add('hidden');
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

function showForum() {
  authScreen.classList.add('hidden');
  forumScreen.classList.remove('hidden');
}

function saveSession(data) {
  token = data.token;
  user = data.user;
  localStorage.setItem(TOKEN_KEY, token);
  if (data.user?.email) localStorage.setItem(EMAIL_KEY, data.user.email);
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('connect_error', () => {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
    showAuthError('Session expirée — reconnecte-toi.');
  });

  socket.on('forum_update', (data) => {
    user = data.user;
    forum = data;
    renderForum();
  });
}

function emit(event, payload) {
  return new Promise((resolve) => {
    if (!socket) return resolve({ error: 'Non connecté' });
    socket.emit(event, payload, (res) => resolve(res ?? {}));
  });
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function verdictLabel(v) {
  if (v === 'win') return { text: 'Tu as gagné', cls: 'win' };
  if (v === 'lose') return { text: 'Tu as perdu', cls: 'lose' };
  if (v === 'tie') return { text: 'Égalité', cls: 'tie' };
  return null;
}

function filterProbas(probas) {
  if (!user) return probas;
  return probas.filter((p) => {
    if (forumFilter === 'open') return p.state === 'open';
    if (forumFilter === 'mine') return p.creatorId === user.id || p.accepterId === user.id;
    if (forumFilter === 'action') return p.waitingForMe;
    return true;
  });
}

function renderPickPanel(proba) {
  if (proba.state !== 'picking') return '';
  if (proba.waitingForOther) {
    return `<div class="thread-reply pick-waiting">
      <p>✓ Ton nombre est enregistré (<strong>${proba.myPick}</strong>).</p>
      <p class="rules">L'autre n'a pas encore joué — reviens plus tard.</p>
    </div>`;
  }
  if (!proba.waitingForMe) return '';
  const val = Math.floor(proba.currentCote / 2);
  return `
    <div class="thread-reply pick-form">
      <p><strong>Tour ${proba.round}</strong> — nombre secret entre 0 et ${proba.currentCote}</p>
      <div class="pick-range" id="pick-display-${proba.id}">${val}</div>
      <input type="range" class="pick-slider" data-proba="${proba.id}" min="0" max="${proba.currentCote}" value="${val}" step="1" />
      <button class="btn btn-primary btn-sm btn-submit-pick" data-proba="${proba.id}">Enregistrer mon nombre</button>
    </div>`;
}

function renderReveal(proba) {
  const isParticipant = proba.creatorId === user?.id || proba.accepterId === user?.id;
  if (!isParticipant) return '';
  const revealed = proba.creatorPick != null && proba.accepterPick != null;
  if (!revealed && proba.state !== 'done') return '';

  const verdict = verdictLabel(proba.myVerdict);
  const verdictHtml = verdict
    ? `<span class="verdict verdict-${verdict.cls}">${verdict.text}</span>`
    : proba.result?.outcome === 'reverse_next_round'
      ? `<span class="verdict verdict-neutral">Tour 1 terminé — reverse en cours</span>`
      : '';

  return `
    <div class="thread-reply reveal-box">
      <p class="reveal-title">Révélation</p>
      <div class="reveal-numbers">
        <span>${proba.creatorName} : <strong>${proba.creatorPick ?? '?'}</strong></span>
        <span>${proba.accepterName ?? '?'} : <strong>${proba.accepterPick ?? '?'}</strong></span>
      </div>
      ${verdictHtml}
      ${proba.result?.message ? `<p class="rules" style="margin-top:8px">${proba.result.message}</p>` : ''}
    </div>`;
}

function renderThread(proba) {
  const isCreator = proba.creatorId === user?.id;
  let status = 'Ouvert';
  let statusCls = 'open';
  if (proba.state === 'picking') {
    status = 'En cours';
    statusCls = 'picking';
  } else if (proba.state === 'done') {
    status = 'Terminé';
    statusCls = 'done';
  }

  const acceptBtn =
    proba.state === 'open' && !isCreator
      ? `<button class="btn btn-primary btn-sm" data-accept="${proba.id}">Accepter ce pari</button>`
      : '';

  return `
    <article class="thread">
      <div class="thread-head">
        <div class="avatar">${(proba.creatorName || '?').charAt(0).toUpperCase()}</div>
        <div class="thread-meta">
          <strong>${proba.creatorName}</strong>
          <span class="thread-date">${formatDate(proba.createdAt)}</span>
        </div>
        <span class="thread-status status-${statusCls}">${status}</span>
      </div>
      <h3 class="thread-title">${proba.description}</h3>
      <div class="thread-tags">
        <span>Cote ${proba.initialCote}</span>
        <span>${proba.reverse ? 'Reverse' : 'Sans reverse'}</span>
        ${proba.accepterName ? `<span>vs ${proba.accepterName}</span>` : '<span>En attente d\'un accepteur</span>'}
        ${proba.state === 'picking' ? `<span>Tour ${proba.round} · cote ${proba.currentCote}</span>` : ''}
      </div>
      ${proba.result?.outcome === 'reverse_next_round' && proba.state === 'picking'
        ? `<div class="thread-reply interim">${proba.result.message}</div>`
        : ''}
      ${acceptBtn}
      ${renderPickPanel(proba)}
      ${renderReveal(proba)}
    </article>`;
}

function renderForum() {
  if (!forum || !user) return;
  const probas = filterProbas(forum.probas ?? []);
  const pending = (forum.probas ?? []).filter((p) => p.waitingForMe).length;

  app.innerHTML = `
    <header class="forum-header">
      <div>
        <h1>Forum public</h1>
        <p class="subtitle">Connecté en tant que <strong>${user.username}</strong></p>
      </div>
      <button class="btn btn-secondary btn-sm" id="logout-btn">Déconnexion</button>
    </header>

    <div class="forum-filters">
      <button class="filter-btn ${forumFilter === 'all' ? 'active' : ''}" data-filter="all">Tous</button>
      <button class="filter-btn ${forumFilter === 'open' ? 'active' : ''}" data-filter="open">Ouverts</button>
      <button class="filter-btn ${forumFilter === 'mine' ? 'active' : ''}" data-filter="mine">Mes paris</button>
      <button class="filter-btn ${forumFilter === 'action' ? 'active' : ''}" data-filter="action">À jouer${pending ? ` (${pending})` : ''}</button>
    </div>

    <button class="btn btn-primary" id="btn-toggle-topic">${showNewTopic ? 'Fermer' : '+ Nouveau sujet'}</button>

    <div class="new-topic ${showNewTopic ? '' : 'hidden'}">
      <div class="card">
        <h2>Déposer une proba</h2>
        <label>Ton pari</label>
        <textarea id="proba-desc" placeholder="Ex: Le PSG gagne ce soir" maxlength="120"></textarea>
        <label>Cote (0 à X)</label>
        <input type="number" id="proba-cote" min="${forum.minCote}" max="${forum.maxCote}" value="10" />
        <label class="toggle-row">
          <input type="checkbox" id="proba-reverse" checked />
          <span>Reverse — tour 2 pour l'accepteur si nombres différents (cote ÷ 2)</span>
        </label>
        <button class="btn btn-primary" id="btn-create-proba">Publier</button>
      </div>
    </div>

    <section class="thread-list">
      ${probas.length === 0 ? '<div class="card"><p class="rules">Aucun sujet. Dépose le premier !</p></div>' : ''}
      ${probas.map(renderThread).join('')}
    </section>`;

  bindForumEvents();
}

function bindForumEvents() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    token = null;
    user = null;
    forum = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  });

  document.getElementById('btn-toggle-topic')?.addEventListener('click', () => {
    showNewTopic = !showNewTopic;
    renderForum();
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      forumFilter = btn.dataset.filter;
      renderForum();
    });
  });

  document.getElementById('btn-create-proba')?.addEventListener('click', async () => {
    const res = await emit('create_proba', {
      description: document.getElementById('proba-desc')?.value,
      cote: document.getElementById('proba-cote')?.value,
      reverse: document.getElementById('proba-reverse')?.checked,
    });
    if (res.error) alert(res.error);
    else {
      showNewTopic = false;
      document.getElementById('proba-desc').value = '';
    }
  });

  document.querySelectorAll('.pick-slider').forEach((slider) => {
    slider.addEventListener('input', () => {
      const el = document.getElementById(`pick-display-${slider.dataset.proba}`);
      if (el) el.textContent = slider.value;
    });
  });

  document.querySelectorAll('.btn-submit-pick').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.proba;
      const slider = document.querySelector(`.pick-slider[data-proba="${id}"]`);
      const res = await emit('submit_pick', { probaId: id, number: slider?.value });
      if (res.error) alert(res.error);
    });
  });

  document.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await emit('accept_proba', { probaId: btn.dataset.accept });
      if (res.error) alert(res.error);
    });
  });
}

// ─── Auth UI ────────────────────────────────────────────────────────────────

document.getElementById('show-login')?.addEventListener('click', () => {
  document.getElementById('show-login').classList.add('active');
  document.getElementById('show-register').classList.remove('active');
  showAuthPanel('panel-login');
  hideAuthError();
  const saved = localStorage.getItem(EMAIL_KEY);
  if (saved) document.getElementById('login-email').value = saved;
});

document.getElementById('show-register')?.addEventListener('click', () => {
  document.getElementById('show-register').classList.add('active');
  document.getElementById('show-login').classList.remove('active');
  showAuthPanel('panel-register-email');
  hideAuthError();
});

document.getElementById('login-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe: document.getElementById('remember-me').checked }),
    });
    saveSession(data);
    showForum();
    connectSocket();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('send-code-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('register-email').value.trim();
  if (!email) return showAuthError('Entre ton email');
  const btn = document.getElementById('send-code-btn');
  btn.disabled = true;
  try {
    const check = await api(`/api/auth/check?email=${encodeURIComponent(email)}`);
    if (check.exists && check.hasPassword) {
      document.getElementById('show-login').click();
      document.getElementById('login-email').value = email;
      return showAuthError('Compte déjà créé — connecte-toi avec ton mot de passe.');
    }
    await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ email }) });
    document.getElementById('email-display').textContent = email;
    showAuthPanel('panel-register-code');
    hideAuthError();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('register-btn')?.addEventListener('click', async () => {
  const email = document.getElementById('register-email').value.trim();
  const code = document.getElementById('code-input').value.trim();
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('register-password').value;
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, code, username, password, rememberMe: true }),
    });
    saveSession(data);
    showForum();
    connectSocket();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('back-register-btn')?.addEventListener('click', () => {
  showAuthPanel('panel-register-email');
  hideAuthError();
});

async function boot() {
  if (!token) {
    showAuth();
    return;
  }
  try {
    const data = await api('/api/me');
    user = data.user;
    showForum();
    connectSocket();
  } catch {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }
}

boot();