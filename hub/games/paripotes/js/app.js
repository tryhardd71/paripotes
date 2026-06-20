const API = window.HUB_CONFIG?.paripotesApi || '';
let token = localStorage.getItem('pp_token');
let user = null;
let leagues = [];

async function fetchWithTimeout(url, opts, ms = 45000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || 'Erreur serveur');
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Le serveur met du temps à démarrer (plan gratuit). Réessaie dans 30 secondes.');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function saveSession(data) {
  token = data.token;
  user = data.user;
  localStorage.setItem('pp_token', token);
  if (data.rememberMe !== false) {
    localStorage.setItem('pp_remember', '1');
    localStorage.setItem('pp_email', user.email);
  } else {
    localStorage.removeItem('pp_remember');
  }
}

function clearSession() {
  token = null;
  user = null;
  localStorage.removeItem('pp_token');
  localStorage.removeItem('pp_active_league');
}

function normId(v) {
  return Number(v);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setAppLoading(on) {
  document.getElementById('app-loading')?.classList.toggle('hidden', !on);
}

function saveActiveLeague(id) {
  if (id != null) localStorage.setItem('pp_active_league', String(id));
  else localStorage.removeItem('pp_active_league');
}


let activeLeague = null;
let matches = [];
let matchFilter = 'upcoming';
let selectedBookmakers = {};

// ─── API helper ───────────────────────────────────────────────────────────────

async function api(path, opts = {}, retries = 3) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastErr = new Error('Erreur serveur');
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(API + path, { ...opts, headers, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erreur serveur');
      return data;
    } catch (e) {
      lastErr = e.name === 'AbortError'
        ? new Error('Le serveur met du temps à démarrer (plan gratuit). Réessaie.')
        : e;
      if (attempt < retries - 1) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function outcomeLabel(outcome, match) {
  if (outcome === 'home') return match.home_team;
  if (outcome === 'away') return match.away_team;
  return 'Match nul';
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');

async function showMain() {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  document.getElementById('user-badge').textContent = user.username;
  await refreshAppData();
}

async function refreshAppData() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn?.classList.add('spinning');
  setAppLoading(true);
  try {
    await loadLeagues();
    const savedId = normId(localStorage.getItem('pp_active_league'));
    const target = leagues.find((l) => normId(l.id) === savedId) || leagues[0];
    if (target) {
      await selectLeague(target.id, false);
    } else {
      activeLeague = null;
      saveActiveLeague(null);
      updateLeagueBar();
      matches = [];
      renderMatches();
    }
    const betsTab = document.querySelector('.tab[data-tab="bets"]');
    if (betsTab?.classList.contains('active')) await loadBets();
    const lbTab = document.querySelector('.tab[data-tab="leaderboard"]');
    if (lbTab?.classList.contains('active')) await loadLeaderboard();
  } catch (e) {
    toast(e.message);
    renderLeaguesError(e.message);
  } finally {
    setAppLoading(false);
    refreshBtn?.classList.remove('spinning');
  }
}

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
  switchAuthTab('login');
  if (email) document.getElementById('login-email').value = email;
  if (message) showAuthError(message);
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('show-login').classList.toggle('active', isLogin);
  document.getElementById('show-register').classList.toggle('active', !isLogin);
  showAuthPanel(isLogin ? 'panel-login' : 'panel-register-email');
  hideAuthError();
  if (isLogin) {
    const saved = localStorage.getItem('pp_email');
    if (saved) document.getElementById('login-email').value = saved;
  }
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const rememberMe = document.getElementById('remember-me').checked;
  if (!email) return showAuthError('Entre ton email');
  if (!password) return showAuthError('Entre ton mot de passe');
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.textContent = 'Connexion...';
  hideAuthError();
  try {
    const data = await fetchWithTimeout(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe }),
    });
    saveSession(data);
    await showMain();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
}

async function requestCode(email, { sync = false, btn = null, busyLabel = 'Envoi...', idleLabel = 'Recevoir mon code' } = {}) {
  if (!email?.includes('@')) return showAuthError('Entre un email valide');
  if (btn) {
    btn.disabled = true;
    btn.textContent = busyLabel;
  }
  hideAuthError();
  try {
    const data = await fetchWithTimeout(API + '/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, sync }),
    }, sync ? 25000 : 15000);
    document.getElementById('email-display').textContent = email;
    showAuthPanel('panel-register-code');
    document.getElementById('code-input').focus();
    toast(data.message || 'Code envoyé ! Vérifie ta boîte mail.');
    return true;
  } catch (e) {
    const msg = e.message || 'Erreur envoi';
    if (msg.includes('déjà') || msg.includes('Connecte-toi')) {
      goToLogin(email, msg);
      return false;
    }
    showAuthError(msg);
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = idleLabel;
    }
  }
}

async function handleSendCode() {
  const email = document.getElementById('register-email').value.trim();
  if (!email) return showAuthError('Entre ton email');
  await requestCode(email, {
    btn: document.getElementById('send-code-btn'),
    busyLabel: 'Envoi en cours...',
    idleLabel: 'Recevoir mon code',
  });
}

async function handleResendCode() {
  const email = document.getElementById('register-email').value.trim();
  await requestCode(email, {
    sync: true,
    btn: document.getElementById('resend-code-btn'),
    busyLabel: 'Renvoi...',
    idleLabel: 'Renvoyer le code',
  });
}

async function handleRegister() {
  const email = document.getElementById('register-email').value.trim();
  const code = document.getElementById('code-input').value.trim();
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('register-password').value;
  const rememberMe = document.getElementById('remember-me-register').checked;
  if (!code) return showAuthError('Entre le code reçu par email');
  if (!password) return showAuthError('Choisis un mot de passe');
  if (password.length < 6) return showAuthError('Mot de passe : 6 caractères minimum');
  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  btn.textContent = 'Création...';
  hideAuthError();
  try {
    const data = await fetchWithTimeout(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, username, password, rememberMe }),
    });
    saveSession(data);
    await showMain();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Créer mon compte';
  }
}

async function handleForgotSend() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) return showAuthError('Entre ton email');
  const btn = document.getElementById('forgot-send-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi...';
  hideAuthError();
  try {
    await fetchWithTimeout(API + '/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, reset: true, sync: true }),
    }, 25000);
    document.getElementById('forgot-reset-fields').classList.remove('hidden');
    toast('Code envoyé !');
  } catch (e) {
    showAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Envoyer le code';
  }
}

async function handleForgotReset() {
  const email = document.getElementById('forgot-email').value.trim();
  const code = document.getElementById('forgot-code').value.trim();
  const password = document.getElementById('forgot-password').value;
  if (!code) return showAuthError('Entre le code reçu par email');
  if (!password) return showAuthError('Choisis un nouveau mot de passe');
  if (password.length < 6) return showAuthError('Mot de passe : 6 caractères minimum');
  hideAuthError();
  try {
    const data = await fetchWithTimeout(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password, rememberMe: true }),
    });
    saveSession(data);
    await showMain();
    toast('Mot de passe mis à jour !');
  } catch (e) {
    showAuthError(e.message);
  }
}

function initAuth() {
  const card = document.getElementById('auth-card');
  if (!card) return;

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.classList.contains('password-toggle')) {
      e.preventDefault();
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('visible', show);
      btn.textContent = show ? '🙈' : '👁';
      btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      return;
    }

    e.preventDefault();

    switch (btn.id) {
      case 'show-login':
        switchAuthTab('login');
        break;
      case 'show-register':
        switchAuthTab('register');
        break;
      case 'login-btn':
        handleLogin();
        break;
      case 'send-code-btn':
        handleSendCode();
        break;
      case 'resend-code-btn':
        handleResendCode();
        break;
      case 'register-btn':
        handleRegister();
        break;
      case 'back-register-btn':
        showAuthPanel('panel-register-email');
        hideAuthError();
        break;
      case 'forgot-btn': {
        const email = document.getElementById('login-email').value.trim();
        document.getElementById('forgot-email').value = email;
        document.getElementById('forgot-reset-fields').classList.add('hidden');
        showAuthPanel('panel-forgot');
        hideAuthError();
        break;
      }
      case 'back-login-btn':
        switchAuthTab('login');
        break;
      case 'forgot-send-btn':
        handleForgotSend();
        break;
      case 'forgot-reset-btn':
        handleForgotReset();
        break;
      default:
        break;
    }
  });

  if (localStorage.getItem('pp_email') && localStorage.getItem('pp_remember')) {
    document.getElementById('login-email').value = localStorage.getItem('pp_email');
    document.getElementById('remember-me').checked = true;
  }
}

async function resumeSession() {
  fetch(API + '/api/health').catch(() => {});
  if (!token) return;
  try {
    const data = await api('/api/me');
    user = data.user;
    await showMain();
  } catch {
    clearSession();
    switchAuthTab('login');
  }
}

function initApp() {
  document.getElementById('refresh-btn')?.addEventListener('click', () => refreshAppData());

  document.getElementById('logout-btn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    clearSession();
    authScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
    switchAuthTab('login');
  });

// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'leagues') loadLeagues().catch((e) => toast(e.message));
    if (tab.dataset.tab === 'matches') loadMatches().catch((e) => toast(e.message));
    if (tab.dataset.tab === 'bets') loadBets().catch((e) => toast(e.message));
    if (tab.dataset.tab === 'leaderboard') loadLeaderboard().catch((e) => toast(e.message));
  };
});

document.querySelectorAll('.pill').forEach((pill) => {
  pill.onclick = () => {
    document.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    matchFilter = pill.dataset.filter;
    renderMatches();
  };
});

// ─── Leagues ──────────────────────────────────────────────────────────────────

document.getElementById('create-league-btn').onclick = () => {
  showModal(`
    <h3>Créer une ligue</h3>
    <input id="modal-league-name" placeholder="Ex: KEO" maxlength="40">
    <input id="modal-starting-points" type="number" placeholder="Points de départ (1000)" value="1000" min="100" max="10000">
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Annuler</button>
      <button class="btn btn-primary" id="modal-create">Créer</button>
    </div>
  `);
  document.getElementById('modal-cancel').onclick = hideModal;
  document.getElementById('modal-create').onclick = async () => {
    const name = document.getElementById('modal-league-name').value.trim();
    const startingPoints = parseInt(document.getElementById('modal-starting-points').value, 10) || 1000;
    if (!name) return toast('Donne un nom à ta ligue');
    try {
      const data = await api('/api/leagues', { method: 'POST', body: JSON.stringify({ name, startingPoints }) });
      hideModal();
      toast(`Ligue créée ! Code : ${data.league.code}`);
      await loadLeagues();
      selectLeague(data.league.id);
    } catch (e) {
      toast(e.message);
    }
  };
};

document.getElementById('join-league-btn').onclick = async () => {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) return toast('Entre le code de la ligue');
  try {
    const data = await api('/api/leagues/join', { method: 'POST', body: JSON.stringify({ code }) });
    toast(data.alreadyMember ? 'Tu es déjà dans cette ligue' : 'Bienvenue dans la ligue !');
    document.getElementById('join-code-input').value = '';
    await loadLeagues();
    selectLeague(data.league.id);
  } catch (e) {
    toast(e.message);
  }
};

async function loadLeagues() {
  const list = document.getElementById('leagues-list');
  if (list) list.innerHTML = '<div class="loading-state">Chargement des ligues…</div>';
  const data = await api('/api/leagues');
  leagues = data.leagues || [];
  renderLeagues();
}

function renderLeaguesError(msg) {
  const list = document.getElementById('leagues-list');
  if (!list) return;
  list.innerHTML = `
    <div class="load-error">
      <p>Impossible de charger tes ligues.</p>
      <p style="font-size:.8rem;margin-top:6px">${esc(msg)}</p>
      <button type="button" class="btn btn-secondary btn-sm" id="retry-leagues-btn">Réessayer</button>
    </div>
  `;
  document.getElementById('retry-leagues-btn')?.addEventListener('click', () => refreshAppData());
}

function renderLeagues() {
  const list = document.getElementById('leagues-list');
  if (!leagues.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">🏟️</div><p>Crée une ligue ou rejoins tes potes avec un code</p></div>`;
    return;
  }
  list.innerHTML = leagues.map((l) => `
    <div class="league-card ${normId(activeLeague?.id) === normId(l.id) ? 'selected' : ''}" data-id="${l.id}">
      <div class="league-card-top">
        <h3>${esc(l.name)}</h3>
        <button type="button" class="league-leave-btn" data-leave="${l.id}" title="Quitter la ligue">Quitter</button>
      </div>
      <div class="league-meta">
        <span class="league-code">${esc(l.code)}</span>
        <span>${l.memberCount} joueur${l.memberCount > 1 ? 's' : ''}</span>
        <span>${l.points} pts</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.league-card').forEach((card) => {
    card.onclick = () => selectLeague(parseInt(card.dataset.id, 10));
  });
  list.querySelectorAll('.league-leave-btn').forEach((btn) => {
    btn.onclick = (e) => leaveLeague(parseInt(btn.dataset.leave, 10), e);
  });
}

async function leaveLeague(id, e) {
  e.stopPropagation();
  const league = leagues.find((l) => l.id === id);
  if (!league) return;
  if (!confirm(`Quitter la ligue « ${league.name} » ?`)) return;
  try {
    await api(`/api/leagues/${id}/leave`, { method: 'POST' });
    toast('Tu as quitté la ligue');
    if (normId(activeLeague?.id) === normId(id)) {
      activeLeague = null;
      saveActiveLeague(null);
      matches = [];
      updateLeagueBar();
      renderMatches();
    }
    await loadLeagues();
    if (leagues.length) selectLeague(leagues[0].id);
  } catch (err) {
    toast(err.message);
  }
}

async function selectLeague(id, save = true) {
  activeLeague = leagues.find((l) => normId(l.id) === normId(id));
  if (!activeLeague) return;
  if (save) saveActiveLeague(activeLeague.id);
  renderLeagues();
  updateLeagueBar();
  try {
    await loadMatches();
  } catch (e) {
    toast(e.message);
  }
}

function updateLeagueBar() {
  const bar = document.getElementById('active-league-bar');
  if (!activeLeague) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  document.getElementById('active-league-name').textContent = activeLeague.name;
  document.getElementById('active-league-points').textContent = `${activeLeague.points} pts`;
}

// ─── Matches ──────────────────────────────────────────────────────────────────

async function loadMatches() {
  const list = document.getElementById('matches-list');
  if (list) list.innerHTML = '<div class="loading-state">Chargement des matchs…</div>';

  const params = new URLSearchParams();
  if (activeLeague) params.set('leagueId', activeLeague.id);
  if (matchFilter === 'upcoming') params.set('upcoming', 'true');
  else if (matchFilter === 'finished') params.set('status', 'finished');

  const data = await api(`/api/matches?${params}`);
  matches = data.matches || [];
  renderMatches();
}

function renderMatches() {
  const list = document.getElementById('matches-list');
  const hint = document.getElementById('no-league-hint');
  hint.classList.toggle('hidden', !!activeLeague);

  let filtered = matches;
  if (matchFilter === 'finished') filtered = matches.filter((m) => m.status === 'finished');
  else if (matchFilter === 'upcoming') filtered = matches.filter((m) => m.status !== 'finished');

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">📅</div><p>Aucun match trouvé</p></div>`;
    return;
  }

  list.innerHTML = filtered.map((m) => renderMatchCard(m)).join('');
  attachMatchListeners();
}

function canBetOnMatch(m) {
  if (!m || m.status === 'live' || m.status === 'finished') return false;
  if (m.status !== 'scheduled') return false;
  return new Date(m.commence_time) > new Date();
}

function canEditBet(m, bet) {
  return bet?.status === 'pending' && canBetOnMatch(m);
}

function renderMatchCard(m) {
  const isLive = m.status === 'live';
  const isFinished = m.status === 'finished';
  const hasBet = m.myBets?.length > 0;
  const bet = m.myBets?.[0];
  const editable = hasBet && canEditBet(m, bet);
  const bettingOpen = canBetOnMatch(m) && !hasBet;
  const oddsDisabled = !canBetOnMatch(m) || (hasBet && !editable);

  const score = isFinished || isLive
    ? `<span>${m.home_score ?? 0}</span> - <span>${m.away_score ?? 0}</span>`
    : '<span class="vs">vs</span>';

  const odds = m.odds || [];
  const bmKey = selectedBookmakers[m.id] || odds[0]?.bookmaker;
  const bmOdds = odds.find((o) => o.bookmaker === bmKey) || odds[0];

  const bmTabs = odds.length > 1 ? `
    <div class="bookmaker-tabs">
      ${odds.map((o) => `
        <button class="bm-tab ${o.bookmaker === bmKey ? 'active' : ''}" data-match="${m.id}" data-bm="${esc(o.bookmaker)}">${esc(o.bookmaker)}</button>
      `).join('')}
    </div>
  ` : (bmOdds ? `<div style="font-size:.7rem;color:var(--muted);margin-bottom:8px">Cotes ${esc(bmOdds.bookmaker)}</div>` : '');

  const oddsButtons = bmOdds ? `
    <div class="odds-grid">
      ${oddsBtn(m, 'home', bmOdds.home_odds, oddsDisabled)}
      ${bmOdds.draw_odds ? oddsBtn(m, 'draw', bmOdds.draw_odds, oddsDisabled) : '<div></div>'}
      ${oddsBtn(m, 'away', bmOdds.away_odds, oddsDisabled)}
    </div>
    ${!bettingOpen && !hasBet ? `<p class="bets-closed-hint">${isLive ? 'Match en cours — paris fermés' : isFinished ? 'Match terminé' : 'Paris fermés'}</p>` : ''}
  ` : '<p style="color:var(--muted);font-size:.8rem">Cotes non disponibles</p>';

  const betInfo = hasBet ? `
    <div class="bet-placed">
      <div>Pari : ${outcomeLabel(bet.outcome, m)} @ ${bet.odds} — Mise ${bet.stake} pts (${bet.status})</div>
      ${editable ? `
        <div class="bet-actions">
          <button type="button" class="bet-action-btn" data-edit-bet="${bet.id}" data-match="${m.id}">Modifier</button>
          <button type="button" class="bet-action-btn danger" data-cancel-bet="${bet.id}">Annuler</button>
        </div>
      ` : ''}
    </div>
  ` : '';

  return `
    <div class="match-card ${isLive ? 'live' : ''} ${isFinished ? 'finished' : ''}" data-id="${m.id}">
      <div class="match-top">
        <span>${formatDate(m.commence_time)}</span>
        <span class="match-stage">${esc(m.group_name || m.stage || '')}</span>
        ${isLive ? '<span class="live-badge">LIVE</span>' : ''}
      </div>
      <div class="match-teams">
        <div class="team home">
          ${m.home_flag ? `<img src="${m.home_flag}" alt="">` : ''}
          <span class="team-name">${esc(m.home_team)}</span>
        </div>
        <div class="match-score">${score}</div>
        <div class="team away">
          ${m.away_flag ? `<img src="${m.away_flag}" alt="">` : ''}
          <span class="team-name">${esc(m.away_team)}</span>
        </div>
      </div>
      ${bmTabs}
      ${oddsButtons}
      ${betInfo}
    </div>
  `;
}

function oddsBtn(m, outcome, value, disabled) {
  if (!value) return '<div></div>';
  const labels = { home: '1', draw: 'N', away: '2' };
  return `
    <button class="odds-btn" data-match="${m.id}" data-outcome="${outcome}" ${disabled ? 'disabled' : ''}>
      <span class="label">${labels[outcome]}</span>
      <span class="value">${value.toFixed(2)}</span>
    </button>
  `;
}

function attachMatchListeners() {
  document.querySelectorAll('.bm-tab').forEach((tab) => {
    tab.onclick = (e) => {
      e.stopPropagation();
      selectedBookmakers[tab.dataset.match] = tab.dataset.bm;
      renderMatches();
    };
  });

  document.querySelectorAll('.odds-btn:not(:disabled)').forEach((btn) => {
    btn.onclick = () => {
      const matchId = parseInt(btn.dataset.match, 10);
      const m = matches.find((x) => x.id === matchId);
      const existing = m?.myBets?.[0];
      if (existing && canEditBet(m, existing)) {
        openBetSlip(matchId, btn.dataset.outcome, { editBet: existing });
      } else {
        openBetSlip(matchId, btn.dataset.outcome);
      }
    };
  });

  document.querySelectorAll('[data-edit-bet]').forEach((btn) => {
    btn.onclick = () => {
      const m = matches.find((x) => x.id === parseInt(btn.dataset.match, 10));
      const bet = m?.myBets?.find((b) => b.id === parseInt(btn.dataset.editBet, 10));
      if (m && bet) openBetSlip(m.id, bet.outcome, { editBet: bet });
    };
  });

  document.querySelectorAll('[data-cancel-bet]').forEach((btn) => {
    btn.onclick = () => cancelBet(parseInt(btn.dataset.cancelBet, 10));
  });
}

// ─── Bet slip ─────────────────────────────────────────────────────────────────

let pendingBet = null;

function openBetSlip(matchId, outcome, { editBet = null } = {}) {
  if (!activeLeague) return toast('Choisis d\'abord une ligue');
  const m = matches.find((x) => x.id === matchId);
  if (!m) return;
  if (!canBetOnMatch(m)) return toast(m.status === 'live' ? 'Match en cours — paris fermés' : 'Paris fermés pour ce match');
  if (!editBet && m.myBets?.length) return toast('Tu as déjà un pari sur ce match');

  if (editBet) selectedBookmakers[m.id] = editBet.bookmaker;
  const bmKey = selectedBookmakers[m.id] || m.odds[0]?.bookmaker;
  const bmOdds = m.odds.find((o) => o.bookmaker === bmKey) || m.odds[0];
  if (!bmOdds) return toast('Pas de cotes disponibles');

  const odds = outcome === 'home' ? bmOdds.home_odds : outcome === 'away' ? bmOdds.away_odds : bmOdds.draw_odds;
  if (!odds) return toast('Pas de cote pour ce résultat');

  const defaultStake = editBet?.stake || 25;
  pendingBet = {
    matchId, outcome, odds, bookmaker: bmOdds.bookmaker, match: m,
    editBetId: editBet?.id || null,
  };

  const slip = document.getElementById('bet-slip');
  document.getElementById('bet-slip-body').innerHTML = `
    <p style="font-weight:700;margin-bottom:4px">${esc(m.home_team)} vs ${esc(m.away_team)}</p>
    <p style="color:var(--muted);font-size:.85rem">${editBet ? 'Modifier — ' : ''}${outcomeLabel(outcome, m)} @ <strong style="color:var(--accent)">${odds.toFixed(2)}</strong> (${esc(bmOdds.bookmaker)})</p>
    <p style="color:var(--muted);font-size:.8rem;margin-top:8px">Solde : ${activeLeague.points} pts</p>
    <div class="stake-presets">
      ${[10, 25, 50, 100].map((v) => `<button class="stake-preset" data-stake="${v}">${v}</button>`).join('')}
    </div>
    <div class="stake-input">
      <span>Mise</span>
      <input type="number" id="stake-input" value="${defaultStake}" min="1" max="500">
      <span>pts</span>
    </div>
    <div class="potential-win">Gain potentiel : <span id="potential-win">${(defaultStake * odds).toFixed(0)}</span> pts</div>
    <button class="btn btn-primary" id="confirm-bet">${editBet ? 'Enregistrer' : 'Valider le pari'}</button>
    ${editBet ? '<button type="button" class="btn btn-ghost" id="cancel-edit-bet">Annuler le pari</button>' : ''}
  `;

  slip.classList.remove('hidden');

  const stakeInput = document.getElementById('stake-input');
  const updateWin = () => {
    const stake = parseFloat(stakeInput.value) || 0;
    document.getElementById('potential-win').textContent = (stake * odds).toFixed(0);
  };
  stakeInput.oninput = updateWin;

  document.querySelectorAll('.stake-preset').forEach((p) => {
    p.onclick = () => { stakeInput.value = p.dataset.stake; updateWin(); };
  });

  document.getElementById('confirm-bet').onclick = placeBet;
  const cancelEditBtn = document.getElementById('cancel-edit-bet');
  if (cancelEditBtn) {
    cancelEditBtn.onclick = async () => {
      document.getElementById('bet-slip').classList.add('hidden');
      pendingBet = null;
      await cancelBet(editBet.id, false);
    };
  }
}

document.getElementById('close-bet-slip').onclick = () => {
  document.getElementById('bet-slip').classList.add('hidden');
  pendingBet = null;
};

async function placeBet() {
  if (!pendingBet || !activeLeague) return;
  const stake = parseFloat(document.getElementById('stake-input').value);
  if (!stake || stake < 1) return toast('Mise invalide');

  const payload = {
    outcome: pendingBet.outcome,
    stake,
    bookmaker: pendingBet.bookmaker,
  };

  try {
    const data = pendingBet.editBetId
      ? await api(`/api/bets/${pendingBet.editBetId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await api('/api/bets', {
        method: 'POST',
        body: JSON.stringify({
          leagueId: activeLeague.id,
          matchId: pendingBet.matchId,
          ...payload,
        }),
      });
    const isEdit = !!pendingBet.editBetId;
    activeLeague.points = data.points;
    updateLeagueBar();
    document.getElementById('bet-slip').classList.add('hidden');
    pendingBet = null;
    toast(isEdit
      ? `Pari mis à jour ! Gain potentiel : ${data.bet.potentialWin} pts`
      : `Pari placé ! Gain potentiel : ${data.bet.potentialWin} pts`);
    await loadMatches();
    const betsTab = document.querySelector('.tab[data-tab="bets"]');
    if (betsTab?.classList.contains('active')) await loadBets();
  } catch (e) {
    toast(e.message);
  }
}

async function cancelBet(betId, askConfirm = true) {
  if (askConfirm && !confirm('Annuler ce pari ? La mise sera remboursée.')) return;
  try {
    const data = await api(`/api/bets/${betId}`, { method: 'DELETE' });
    if (activeLeague) {
      activeLeague.points = data.points;
      updateLeagueBar();
    }
    document.getElementById('bet-slip')?.classList.add('hidden');
    pendingBet = null;
    toast('Pari annulé — points remboursés');
    await loadMatches();
    const betsTab = document.querySelector('.tab[data-tab="bets"]');
    if (betsTab?.classList.contains('active')) await loadBets();
  } catch (e) {
    toast(e.message);
  }
}

// ─── Bets history ─────────────────────────────────────────────────────────────

async function loadBets() {
  const list = document.getElementById('bets-list');
  if (!activeLeague) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">🎰</div><p>Sélectionne une ligue pour voir tes paris</p></div>`;
    return;
  }
  list.innerHTML = '<div class="loading-state">Chargement des paris…</div>';
  const data = await api(`/api/bets?leagueId=${activeLeague.id}`);

  if (!data.bets?.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">🎰</div><p>Aucun pari pour l'instant — vas-y !</p></div>`;
    return;
  }

  list.innerHTML = data.bets.map((b) => {
    const statusLabels = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Annulé' };
    const resultClass = b.status;
    const resultText = b.status === 'won'
      ? `+${b.payout} pts`
      : b.status === 'lost' ? `-${b.stake} pts` : statusLabels[b.status];

    const editable = b.status === 'pending'
      && b.match_status === 'scheduled'
      && new Date(b.commence_time) > new Date();

    return `
      <div class="bet-card ${resultClass}">
        <div class="bet-match">${esc(b.home_team)} vs ${esc(b.away_team)}</div>
        <div class="bet-details">
          ${outcomeLabel(b.outcome, b)} @ ${b.odds} — Mise ${b.stake} pts (${esc(b.bookmaker)})
          <br>${formatDate(b.commence_time)}
          ${b.match_status === 'finished' ? ` — Score : ${b.home_score}-${b.away_score}` : ''}
        </div>
        <div class="bet-result ${resultClass}">${resultText}</div>
        ${editable ? `
          <div class="bet-actions">
            <button type="button" class="bet-action-btn" data-bets-edit="${b.id}" data-bets-match="${b.match_id}" data-bets-outcome="${b.outcome}">Modifier</button>
            <button type="button" class="bet-action-btn danger" data-bets-cancel="${b.id}">Annuler</button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-bets-edit]').forEach((btn) => {
    btn.onclick = async () => {
      document.querySelector('.tab[data-tab="matches"]')?.click();
      await loadMatches();
      const m = matches.find((x) => x.id === parseInt(btn.dataset.betsMatch, 10));
      const bet = m?.myBets?.find((x) => x.id === parseInt(btn.dataset.betsEdit, 10));
      if (m && bet) openBetSlip(m.id, btn.dataset.betsOutcome, { editBet: bet });
    };
  });
  list.querySelectorAll('[data-bets-cancel]').forEach((btn) => {
    btn.onclick = () => cancelBet(parseInt(btn.dataset.betsCancel, 10));
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

async function loadLeaderboard() {
  if (!activeLeague) {
    document.getElementById('leaderboard').innerHTML = `<div class="empty-state"><div class="emoji">🏆</div><p>Sélectionne une ligue</p></div>`;
    return;
  }
  const data = await api(`/api/leagues/${activeLeague.id}`);
  const lb = data.leaderboard;
  const rankClass = ['gold', 'silver', 'bronze'];

  document.getElementById('leaderboard').innerHTML = lb.map((p, i) => `
    <div class="lb-row ${p.id === user?.id ? 'me' : ''}">
      <div class="lb-rank ${rankClass[i] || ''}">${i + 1}</div>
      <div class="lb-info">
        <div class="lb-name">${esc(p.username)}${p.id === user?.id ? ' (toi)' : ''}</div>
        <div class="lb-stats">${p.wins} victoire${p.wins > 1 ? 's' : ''} / ${p.total_bets} pari${p.total_bets > 1 ? 's' : ''}</div>
      </div>
      <div class="lb-points">${Math.round(p.points)}</div>
    </div>
  `).join('');
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}
document.getElementById('modal-overlay').onclick = (e) => {
  if (e.target.id === 'modal-overlay') hideModal();
};

}

function boot() {
  initAuth();
  initApp();
  resumeSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

