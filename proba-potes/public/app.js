const socket = io();
const app = document.getElementById('app');

let room = null;
let myId = socket.id;
let errorMsg = '';
let expandedProba = null;

socket.on('connect', () => {
  myId = socket.id;
  render();
});

socket.on('room_update', (data) => {
  room = data;
  render();
});

function emit(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res ?? {}));
  });
}

function getMe() {
  return room?.players?.find((p) => p.id === myId);
}

function getPlayerName(id) {
  return room?.players?.find((p) => p.id === id)?.name ?? '?';
}

function stateLabel(state) {
  if (state === 'open') return 'Ouverte';
  if (state === 'picking') return 'En jeu';
  return 'Terminée';
}

function stateBadge(state) {
  const cls =
    state === 'open' ? 'badge-open' : state === 'picking' ? 'badge-picking' : 'badge-done';
  return `<span class="badge ${cls}">${stateLabel(state)}</span>`;
}

function renderHome() {
  return `
    <h1>Proba Potes</h1>
    <p class="subtitle">Défie tes potes avec des probas et des cotes</p>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    <div class="card">
      <h2>Créer un salon</h2>
      <label>Ton pseudo</label>
      <input id="create-name" placeholder="Ex: Rayan" maxlength="20" />
      <button class="btn btn-primary" id="btn-create">Créer</button>
    </div>
    <div class="divider">ou</div>
    <div class="card">
      <h2>Rejoindre un salon</h2>
      <label>Code</label>
      <input id="join-code" placeholder="Ex: PROBA" maxlength="8" style="text-transform:uppercase" />
      <label>Ton pseudo</label>
      <input id="join-name" placeholder="Ex: Sarah" maxlength="20" />
      <button class="btn btn-secondary" id="btn-join">Rejoindre</button>
    </div>
    <div class="card">
      <h2>Règles</h2>
      <ul class="rules">
        <li>Tu proposes une <strong>proba</strong> avec une <strong>cote</strong> (ex: 10 → nombre entre 0 et 10)</li>
        <li>Un pote <strong>accepte</strong> — vous jouez chacun un nombre <em>en secret</em></li>
        <li><strong>Même nombre</strong> → le joueur du tour perd</li>
        <li><strong>Nombres différents</strong> + reverse → tour 2 pour l'accepteur, cote ÷ 2</li>
        <li><strong>Nombres différents</strong> sans reverse (ou tour 2 gagné) → le joueur du tour gagne</li>
      </ul>
    </div>
  `;
}

function renderPickPanel(proba) {
  if (!proba.waitingForMe && !proba.waitingForOther && proba.state !== 'picking') return '';

  if (proba.waitingForOther) {
    return `<div class="status-msg">✓ Ton nombre est enregistré. En attente de l'autre joueur…</div>`;
  }

  if (!proba.waitingForMe) return '';

  const val = Math.floor(proba.currentCote / 2);
  return `
    <div class="pick-panel">
      <p class="rules">Choisis un nombre secret entre <strong>0</strong> et <strong>${proba.currentCote}</strong></p>
      <div class="pick-range" id="pick-display">${val}</div>
      <input type="range" id="pick-slider" min="0" max="${proba.currentCote}" value="${val}" step="1" />
      <button class="btn btn-primary" id="btn-submit-pick" data-proba="${proba.id}">Valider mon nombre</button>
    </div>
  `;
}

function renderProbaResult(proba) {
  if (!proba.result) return '';

  const r = proba.result;
  const iWon = r.winnerId === myId;
  const iLost = r.loserId === myId;
  const cls =
    r.outcome === 'reverse_next_round'
      ? 'neutral'
      : iWon
        ? 'win'
        : iLost
          ? 'lose'
          : 'neutral';

  const picks =
    proba.creatorPick != null
      ? `<p class="rules" style="margin-top:8px">Nombres : ${getPlayerName(proba.creatorId)} = <strong>${proba.creatorPick}</strong> · ${getPlayerName(proba.accepterId)} = <strong>${proba.accepterPick}</strong></p>`
      : '';

  return `
    <div class="result-banner ${cls}">
      <p>${r.message}</p>
      ${picks}
    </div>
  `;
}

function renderProbaCard(proba) {
  const isCreator = proba.creatorId === myId;
  const isAccepter = proba.accepterId === myId;
  const isParticipant = isCreator || isAccepter;
  const holderName = getPlayerName(proba.roundHolderId);
  const expanded = expandedProba === proba.id;

  let actions = '';
  if (proba.state === 'open' && !isCreator) {
    actions = `<button class="btn btn-primary btn-sm" data-accept="${proba.id}">Accepter ce pari</button>`;
  }

  return `
    <div class="card proba-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <strong>${proba.description}</strong>
          <div class="proba-meta">
            <span>Cote ${proba.initialCote}</span>
            <span>${proba.reverse ? 'Reverse ON' : 'Reverse OFF'}</span>
            <span>Par ${getPlayerName(proba.creatorId)}</span>
            ${proba.accepterId ? `<span>vs ${getPlayerName(proba.accepterId)}</span>` : ''}
          </div>
        </div>
        ${stateBadge(proba.state)}
      </div>
      ${
        proba.state === 'picking'
          ? `<p class="rules" style="margin-top:10px">Tour ${proba.round} — pari pour <strong>${holderName}</strong> (cote actuelle : ${proba.currentCote})</p>`
          : ''
      }
      ${isParticipant ? renderPickPanel(proba) : ''}
      ${proba.state === 'done' || proba.result?.outcome === 'reverse_next_round' ? renderProbaResult(proba) : ''}
      ${actions}
      ${
        !expanded && proba.state !== 'open'
          ? `<button class="btn btn-secondary btn-sm" data-expand="${proba.id}" style="margin-top:10px">Détails</button>`
          : ''
      }
    </div>
  `;
}

function renderLobby() {
  const probas = room.probas ?? [];

  return `
    <h1>Salon Proba</h1>
    <div class="room-code">
      <span>Code à partager</span>
      <strong>${room.code}</strong>
      <button class="btn btn-secondary btn-sm" id="btn-copy">Copier</button>
    </div>
    <div class="card">
      <h2>Joueurs (${room.players.length})</h2>
      <ul class="player-list">
        ${room.players
          .map(
            (p) =>
              `<li><span>${p.name}${p.id === myId ? ' (toi)' : ''}</span><span>${p.connected ? '🟢' : '⚫'}</span></li>`
          )
          .join('')}
      </ul>
    </div>
    <div class="card">
      <h2>Proposer une proba</h2>
      <label>Description du pari</label>
      <textarea id="proba-desc" placeholder="Ex: Mbappé marque contre le Portugal" maxlength="120"></textarea>
      <label>Cote (nombre max à choisir)</label>
      <input type="number" id="proba-cote" min="${room.minCote}" max="${room.maxCote}" value="10" />
      <label class="toggle-row">
        <input type="checkbox" id="proba-reverse" checked />
        <span>Reverse — si nombres différents au tour 1, tour 2 pour l'accepteur (cote ÷ 2)</span>
      </label>
      <button class="btn btn-primary" id="btn-create-proba">Publier la proba</button>
    </div>
    <div class="card">
      <h2>Probas du salon (${probas.length})</h2>
      ${probas.length === 0 ? '<p class="rules">Aucune proba pour l\'instant. Sois le premier !</p>' : ''}
      ${probas.map((p) => renderProbaCard(p)).join('')}
    </div>
  `;
}

function render() {
  if (!room) {
    app.innerHTML = renderHome();
    bindHomeEvents();
    return;
  }
  app.innerHTML = renderLobby();
  bindLobbyEvents();
}

function bindHomeEvents() {
  document.getElementById('btn-create')?.addEventListener('click', async () => {
    errorMsg = '';
    const name = document.getElementById('create-name')?.value;
    const res = await emit('create_room', { playerName: name });
    if (res.error) {
      errorMsg = res.error;
      render();
    }
  });

  document.getElementById('btn-join')?.addEventListener('click', async () => {
    errorMsg = '';
    const code = document.getElementById('join-code')?.value;
    const name = document.getElementById('join-name')?.value;
    const res = await emit('join_room', { code, playerName: name });
    if (res.error) {
      errorMsg = res.error;
      render();
    }
  });
}

function bindLobbyEvents() {
  document.getElementById('btn-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(room.code);
  });

  document.getElementById('btn-create-proba')?.addEventListener('click', async () => {
    const description = document.getElementById('proba-desc')?.value;
    const cote = document.getElementById('proba-cote')?.value;
    const reverse = document.getElementById('proba-reverse')?.checked;
    const res = await emit('create_proba', { description, cote, reverse });
    if (res.error) alert(res.error);
    else {
      document.getElementById('proba-desc').value = '';
    }
  });

  const slider = document.getElementById('pick-slider');
  const display = document.getElementById('pick-display');
  slider?.addEventListener('input', () => {
    if (display) display.textContent = slider.value;
  });

  document.getElementById('btn-submit-pick')?.addEventListener('click', async () => {
    const probaId = document.getElementById('btn-submit-pick')?.dataset.proba;
    const number = document.getElementById('pick-slider')?.value;
    const res = await emit('submit_pick', { probaId, number });
    if (res.error) alert(res.error);
  });

  document.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await emit('accept_proba', { probaId: btn.dataset.accept });
      if (res.error) alert(res.error);
    });
  });

  document.querySelectorAll('[data-expand]').forEach((btn) => {
    btn.addEventListener('click', () => {
      expandedProba = btn.dataset.expand;
      render();
    });
  });
}

render();