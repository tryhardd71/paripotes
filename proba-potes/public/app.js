const socket = io();
const app = document.getElementById('app');

let room = null;
let myKey = null;
let errorMsg = '';
let forumFilter = 'all';
let showNewTopic = false;

const STORAGE_KEY = 'proba_potes_session';

socket.on('connect', async () => {
  const saved = loadSession();
  if (saved && !room) {
    const res = await emit('join_room', saved);
    if (!res.error) {
      myKey = res.playerKey;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
  }
  render();
});

socket.on('room_update', (data) => {
  room = data;
  myKey = data.myKey ?? myKey;
  render();
});

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function emit(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res ?? {}));
  });
}

function getPlayerName(key) {
  return room?.players?.find((p) => p.key === key)?.name ?? '?';
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
  return probas.filter((p) => {
    if (forumFilter === 'open') return p.state === 'open';
    if (forumFilter === 'mine') return p.creatorKey === myKey || p.accepterKey === myKey;
    if (forumFilter === 'action') return p.waitingForMe;
    return true;
  });
}

function renderHome() {
  const saved = loadSession();
  return `
    <h1>Proba Potes</h1>
    <p class="subtitle">Forum de probas entre potes — joue quand tu veux</p>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    ${
      saved
        ? `<div class="card"><p class="rules">Reconnexion au forum <strong>${saved.code}</strong> en cours…</p></div>`
        : ''
    }
    <div class="card">
      <h2>Créer un forum</h2>
      <label>Ton pseudo (unique dans le forum)</label>
      <input id="create-name" placeholder="Ex: Rayan" maxlength="20" />
      <button class="btn btn-primary" id="btn-create">Créer le forum</button>
    </div>
    <div class="divider">ou</div>
    <div class="card">
      <h2>Rejoindre un forum</h2>
      <label>Code du forum</label>
      <input id="join-code" placeholder="Ex: PROBA" maxlength="8" style="text-transform:uppercase" />
      <label>Ton pseudo</label>
      <input id="join-name" placeholder="Ex: Sarah" maxlength="20" />
      <button class="btn btn-secondary" id="btn-join">Rejoindre</button>
    </div>
    <div class="card">
      <h2>Comment ça marche</h2>
      <ul class="rules">
        <li>Chacun <strong>dépose un sujet</strong> (proba + cote + reverse)</li>
        <li>N'importe qui peut <strong>accepter</strong>, même plus tard</li>
        <li>Ensuite chacun choisit son nombre <strong>quand il veut</strong> — l'autre ne le voit pas</li>
        <li>Quand les deux ont joué → <strong>révélation</strong> : gagné / perdu / égalité</li>
      </ul>
    </div>
  `;
}

function renderPickPanel(proba) {
  if (proba.state !== 'picking') return '';

  if (proba.myHasPlayed && proba.waitingForOther) {
    return `
      <div class="thread-reply pick-waiting">
        <p>✓ Ton nombre est enregistré (<strong>${proba.myPick}</strong>).</p>
        <p class="rules">L'autre n'a pas encore joué — tu peux te déconnecter, il sera notifié à ta prochaine visite.</p>
      </div>`;
  }

  if (!proba.waitingForMe) return '';

  const val = Math.floor(proba.currentCote / 2);
  return `
    <div class="thread-reply pick-form">
      <p><strong>Tour ${proba.round}</strong> — choisis ton nombre secret (0 à ${proba.currentCote})</p>
      <div class="pick-range" id="pick-display-${proba.id}">${val}</div>
      <input type="range" class="pick-slider" data-proba="${proba.id}" min="0" max="${proba.currentCote}" value="${val}" step="1" />
      <button class="btn btn-primary btn-sm btn-submit-pick" data-proba="${proba.id}">Enregistrer mon nombre</button>
    </div>
  `;
}

function renderReveal(proba) {
  const isParticipant = proba.creatorKey === myKey || proba.accepterKey === myKey;
  if (!isParticipant) return '';

  const revealed =
    proba.state === 'done' ||
    (proba.creatorPick != null && proba.accepterPick != null);

  if (!revealed) return '';

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
        <span>${getPlayerName(proba.creatorKey)} : <strong>${proba.creatorPick}</strong></span>
        <span>${getPlayerName(proba.accepterKey)} : <strong>${proba.accepterPick}</strong></span>
      </div>
      ${verdictHtml}
      ${proba.result?.message ? `<p class="rules" style="margin-top:8px">${proba.result.message}</p>` : ''}
    </div>
  `;
}

function renderThread(proba) {
  const isCreator = proba.creatorKey === myKey;
  const isParticipant = isCreator || proba.accepterKey === myKey;
  const initial = getPlayerName(proba.creatorKey).charAt(0).toUpperCase();

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

  const myPickHint =
    isParticipant && proba.myHasPlayed && proba.state === 'picking' && !proba.waitingForMe
      ? ''
      : isParticipant && proba.myHasPlayed
        ? `<span class="my-pick-hint">Ton nombre : ${proba.myPick} (secret jusqu'à révélation)</span>`
        : '';

  return `
    <article class="thread" data-thread="${proba.id}">
      <div class="thread-head">
        <div class="avatar">${initial}</div>
        <div class="thread-meta">
          <strong>${getPlayerName(proba.creatorKey)}</strong>
          <span class="thread-date">${formatDate(proba.createdAt)}</span>
        </div>
        <span class="thread-status status-${statusCls}">${status}</span>
      </div>
      <h3 class="thread-title">${proba.description}</h3>
      <div class="thread-tags">
        <span>Cote ${proba.initialCote}</span>
        <span>${proba.reverse ? 'Reverse' : 'Sans reverse'}</span>
        ${proba.accepterKey ? `<span>vs ${getPlayerName(proba.accepterKey)}</span>` : '<span>En attente d\'un accepteur</span>'}
        ${proba.state === 'picking' ? `<span>Tour ${proba.round} · cote ${proba.currentCote}</span>` : ''}
      </div>
      ${proba.result?.outcome === 'reverse_next_round' && proba.state === 'picking'
        ? `<div class="thread-reply interim">${proba.result.message}</div>`
        : ''}
      ${acceptBtn}
      ${myPickHint}
      ${isParticipant ? renderPickPanel(proba) : ''}
      ${renderReveal(proba)}
    </article>
  `;
}

function renderForum() {
  const probas = filterProbas(room.probas ?? []);
  const pendingCount = (room.probas ?? []).filter((p) => p.waitingForMe).length;

  return `
    <header class="forum-header">
      <div>
        <h1>Forum Proba</h1>
        <p class="subtitle">Code : <strong>${room.code}</strong> · ${room.players.length} membre(s)</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-copy">Copier le code</button>
    </header>

    <div class="forum-filters">
      <button class="filter-btn ${forumFilter === 'all' ? 'active' : ''}" data-filter="all">Tous</button>
      <button class="filter-btn ${forumFilter === 'open' ? 'active' : ''}" data-filter="open">Ouverts</button>
      <button class="filter-btn ${forumFilter === 'mine' ? 'active' : ''}" data-filter="mine">Mes paris</button>
      <button class="filter-btn ${forumFilter === 'action' ? 'active' : ''}" data-filter="action">À jouer${pendingCount ? ` (${pendingCount})` : ''}</button>
    </div>

    <button class="btn btn-primary" id="btn-toggle-topic">${showNewTopic ? 'Fermer' : '+ Nouveau sujet'}</button>

    <div class="new-topic ${showNewTopic ? '' : 'hidden'}">
      <div class="card">
        <h2>Déposer une proba</h2>
        <label>Ton pari</label>
        <textarea id="proba-desc" placeholder="Ex: Le PSG gagne ce soir" maxlength="120"></textarea>
        <label>Cote (0 à X)</label>
        <input type="number" id="proba-cote" min="${room.minCote}" max="${room.maxCote}" value="10" />
        <label class="toggle-row">
          <input type="checkbox" id="proba-reverse" checked />
          <span>Reverse — si nombres différents au tour 1, tour 2 pour l'accepteur (cote ÷ 2)</span>
        </label>
        <button class="btn btn-primary" id="btn-create-proba">Publier sur le forum</button>
      </div>
    </div>

    <section class="thread-list">
      ${probas.length === 0 ? '<div class="card"><p class="rules">Aucun sujet ici. Dépose le premier !</p></div>' : ''}
      ${probas.map((p) => renderThread(p)).join('')}
    </section>
  `;
}

function render() {
  if (!room) {
    app.innerHTML = renderHome();
    bindHomeEvents();
    return;
  }
  app.innerHTML = renderForum();
  bindForumEvents();
}

function bindHomeEvents() {
  document.getElementById('btn-create')?.addEventListener('click', async () => {
    errorMsg = '';
    const name = document.getElementById('create-name')?.value;
    const res = await emit('create_room', { playerName: name });
    if (res.error) {
      errorMsg = res.error;
      render();
      return;
    }
    myKey = res.playerKey;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: res.code, playerName: name.trim() }));
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    errorMsg = '';
    const code = document.getElementById('join-code')?.value;
    const name = document.getElementById('join-name')?.value;
    const res = await emit('join_room', { code, playerName: name });
    if (res.error) {
      errorMsg = res.error;
      render();
      return;
    }
    myKey = res.playerKey;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: code.toUpperCase(), playerName: name.trim() }));
  });
}

function bindForumEvents() {
  document.getElementById('btn-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(room.code);
  });

  document.getElementById('btn-toggle-topic')?.addEventListener('click', () => {
    showNewTopic = !showNewTopic;
    render();
  });

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      forumFilter = btn.dataset.filter;
      render();
    });
  });

  document.getElementById('btn-create-proba')?.addEventListener('click', async () => {
    const description = document.getElementById('proba-desc')?.value;
    const cote = document.getElementById('proba-cote')?.value;
    const reverse = document.getElementById('proba-reverse')?.checked;
    const res = await emit('create_proba', { description, cote, reverse });
    if (res.error) alert(res.error);
    else {
      showNewTopic = false;
      document.getElementById('proba-desc').value = '';
    }
  });

  document.querySelectorAll('.pick-slider').forEach((slider) => {
    slider.addEventListener('input', () => {
      const display = document.getElementById(`pick-display-${slider.dataset.proba}`);
      if (display) display.textContent = slider.value;
    });
  });

  document.querySelectorAll('.btn-submit-pick').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const probaId = btn.dataset.proba;
      const slider = document.querySelector(`.pick-slider[data-proba="${probaId}"]`);
      const res = await emit('submit_pick', { probaId, number: slider?.value });
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

render();