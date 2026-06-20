import { VoiceCall } from './webrtc.js';

const app = document.getElementById('app');
const IMPOSTEUR_SERVER = window.HUB_CONFIG?.imposteurApi || undefined;

if (typeof io === 'undefined') {
  app.innerHTML =
    '<div class="card"><p class="error">Impossible de charger le jeu. Rafraîchis la page (Ctrl+F5).</p></div>';
  throw new Error('Socket.io non chargé');
}

const socket = io(IMPOSTEUR_SERVER);

let room = null;
let myId = socket.id;
let errorMsg = '';
let timerInterval = null;
let wasInRoom = false;

const voiceCall = new VoiceCall(socket, () => myId, getPlayerName);

socket.on('connect', () => {
  myId = socket.id;
  if (room) {
    voiceCall.onReconnect();
    render();
  }
});

socket.on('room_update', (data) => {
  room = data;
  if (!wasInRoom) {
    voiceCall.onEnterRoom();
    wasInRoom = true;
  }
  render();
});

socket.on('kicked', ({ message }) => {
  room = null;
  wasInRoom = false;
  errorMsg = message || 'Tu as été expulsé du salon.';
  clearTimer();
  voiceCall.leaveAndHide();
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

function playingPlayers() {
  return room?.players?.filter((p) => !p.isChef) ?? [];
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  clearTimer();
  if (!room?.timerEndsAt) return;
  timerInterval = setInterval(() => renderTimer(), 200);
}

function getTimeLeft() {
  if (!room?.timerEndsAt) return 0;
  return Math.max(0, Math.ceil((room.timerEndsAt - Date.now()) / 1000));
}

function renderTimer() {
  const el = document.getElementById('timer-value');
  if (el) el.textContent = getTimeLeft();
}

function copyCode(code) {
  navigator.clipboard?.writeText(code);
}

function renderHome() {
  return `
    <h1>Imposteur Mots</h1>
    <p class="subtitle">Trouvez l'imposteur parmi vos amis</p>
    ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
    <div class="card">
      <h2>Créer une partie</h2>
      <p class="rules" style="margin-bottom:14px">Tu seras le <strong style="color:var(--chef)">Chef</strong> : tu choisis les mots et gères les tours.</p>
      <label>Ton pseudo</label>
      <input id="create-name" placeholder="Ex: Rayan" maxlength="20" />
      <button class="btn btn-primary" id="btn-create">Créer un salon</button>
    </div>
    <div class="divider">ou</div>
    <div class="card">
      <h2>Rejoindre une partie</h2>
      <label>Code du salon</label>
      <input id="join-code" placeholder="Ex: KEO" maxlength="6" style="text-transform:uppercase" />
      <label>Ton pseudo</label>
      <input id="join-name" placeholder="Ex: Sarah" maxlength="20" />
      <button class="btn btn-secondary" id="btn-join">Rejoindre</button>
    </div>
    <div class="card">
      <h2>Règles</h2>
      <ul class="rules">
        <li>Minimum <strong>4 personnes</strong> (chef inclus), pas de maximum</li>
        <li>Le chef donne un mot à tous sauf un (l'imposteur)</li>
        <li>Vocal & caméra intégrés dans le salon</li>
        <li>Chacun dit son mot à voix haute (15 sec / tour)</li>
        <li>2 tours minimum, le chef peut en ajouter</li>
        <li>Vote final : majorité gagne, égalité = imposteur gagne</li>
      </ul>
    </div>
  `;
}

function canChefKick() {
  return getMe()?.isChef && ['waiting', 'results'].includes(room?.state);
}

function canChefTransfer() {
  return getMe()?.isChef && ['waiting', 'results'].includes(room?.state);
}

function renderChefTransfer() {
  if (!canChefTransfer()) return '';

  const candidates = room.players.filter((p) => !p.isChef && p.connected);
  if (candidates.length === 0) return '';

  return `
    <div class="card">
      <h2>👨‍🍳 Passer le rôle de chef</h2>
      <p class="rules" style="margin-bottom:12px">Tu peux désigner un nouveau chef pour la prochaine partie.</p>
      <div class="transfer-grid">
        ${candidates
          .map(
            (p) => `
          <button class="btn btn-secondary transfer-btn" data-transfer-chef="${p.id}">
            ${p.name}
          </button>`
          )
          .join('')}
      </div>
    </div>`;
}

function renderPlayerRow(p, { showKick = false } = {}) {
  return `
    <li>
      <span><span class="status-dot"></span>${p.name}${p.id === myId ? ' (toi)' : ''}</span>
      <span class="player-actions">
        ${p.isChef ? '<span class="badge badge-chef">Chef</span>' : ''}
        ${p.id === myId && !p.isChef ? '<span class="badge badge-you">Joueur</span>' : ''}
        ${
          showKick && !p.isChef
            ? `<button class="kick-btn" data-kick="${p.id}" title="Expulser ${p.name}">✕</button>`
            : ''
        }
      </span>
    </li>`;
}

function renderLobby() {
  const me = getMe();
  const isChef = me?.isChef;
  const count = room.playerCount ?? room.players.length;
  const showKick = canChefKick();

  return `
    <h1>Salon</h1>
    <div class="room-code">
      <span>Code à partager</span>
      <strong>${room.code}</strong>
      <button class="btn btn-secondary copy-btn" id="btn-copy">Copier le code</button>
    </div>
    <div class="card">
      <h2>Joueurs (${count}/${room.minPlayers} min.)</h2>
      ${showKick ? '<p class="rules" style="margin-bottom:10px">Clique sur ✕ pour expulser un joueur.</p>' : ''}
      <ul class="player-list">
        ${room.players.map((p) => renderPlayerRow(p, { showKick })).join('')}
      </ul>
    </div>
    ${
      isChef
        ? `
      <div class="card">
        <h2>Configurer la partie</h2>
        <label>Mot pour la majorité</label>
        <input id="word-majority" placeholder="Ex: Pizza" />
        <label>Mot pour l'imposteur</label>
        <input id="word-impostor" placeholder="Ex: Burger" />
        <button class="btn btn-primary" id="btn-start" ${!room.canStart ? 'disabled' : ''}>
          Lancer la partie
        </button>
        ${!room.canStart ? `<p class="rules" style="margin-top:10px;color:var(--warning)">Il faut encore ${room.minPlayers - count} personne(s).</p>` : ''}
      </div>
      ${renderChefTransfer()}`
        : `
      <div class="card" style="text-align:center">
        <p class="rules">En attente du chef pour lancer la partie…</p>
        <p style="margin-top:12px;font-size:2rem">🎭</p>
      </div>`
    }
  `;
}

function renderPlaying() {
  const me = getMe();
  const isChef = me?.isChef;
  const currentId = room.currentTurnPlayerId;
  const isMyTurn = currentId === myId;
  const timeLeft = getTimeLeft();

  startTimer();

  return `
    <div class="round-info">Tour ${room.currentRound} · Joueur ${room.currentTurnIndex + 1}/${playingPlayers().length}</div>
    ${
      isChef
        ? `<div class="chef-panel"><h3>👨‍🍳 Mode Chef</h3><p class="rules">Observe les joueurs. Tu peux passer au joueur suivant si besoin.</p></div>`
        : ''
    }
    ${
      !isChef
        ? `
      <div class="card word-reveal">
        <div class="label">Ton mot secret</div>
        <div class="word">${me?.word ?? '???'}</div>
        <div class="hint">Dis-le en vocal quand c'est ton tour !</div>
      </div>`
        : ''
    }
    <div class="turn-banner ${isMyTurn ? 'your-turn' : 'waiting'}">
      ${
        isMyTurn
          ? `<h3>🎤 C'est ton tour !</h3><p>Dis ton mot en vocal (${timeLeft}s)</p>`
          : `<h3>🎧 ${getPlayerName(currentId)} parle…</h3><p>Écoute et analyse</p>`
      }
    </div>
    <div class="timer-ring">
      <div class="timer-circle ${isMyTurn ? 'active' : ''}" id="timer-circle">
        <span id="timer-value">${timeLeft}</span>
      </div>
    </div>
    ${
      isMyTurn || isChef
        ? `<button class="btn btn-secondary" id="btn-end-turn">Passer au suivant</button>`
        : ''
    }
  `;
}

function renderBetweenRounds() {
  const me = getMe();
  const isChef = me?.isChef;
  clearTimer();

  return `
    <div class="card" style="text-align:center">
      <h2>Tour ${room.completedRounds} terminé ✓</h2>
      <p class="rules" style="margin-top:8px">${room.completedRounds} tour(s) joué(s) sur ${room.minRounds} minimum</p>
    </div>
    ${
      !isChef
        ? `
      <div class="card word-reveal">
        <div class="label">Ton mot</div>
        <div class="word">${me?.word ?? '???'}</div>
        <div class="hint">Prépare-toi pour le prochain tour ou le vote…</div>
      </div>`
        : ''
    }
    ${
      isChef
        ? `
      <div class="chef-panel">
        <h3>👨‍🍳 Décision du Chef</h3>
        <p class="rules">Tu peux ajouter un tour ou lancer le vote.</p>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-add-round">+ 1 tour</button>
        <button class="btn btn-danger" id="btn-vote" ${!room.canVote ? 'disabled' : ''}>Lancer le vote</button>
      </div>
      ${!room.canVote ? `<p class="rules" style="margin-top:10px;text-align:center;color:var(--warning)">Encore ${room.minRounds - room.completedRounds} tour(s) minimum requis.</p>` : ''}`
        : `<p class="rules" style="text-align:center">Le chef décide de la suite…</p>`
    }
  `;
}

function renderVoting() {
  const me = getMe();
  const isChef = me?.isChef;
  clearTimer();

  if (isChef) {
    return `
      <div class="card" style="text-align:center">
        <h2>🗳️ Phase de vote</h2>
        <p class="rules" style="margin-top:8px">Les joueurs votent pour l'imposteur. Toi tu observes.</p>
      </div>
      <ul class="player-list">
        ${playingPlayers()
          .map(
            (p) => `
          <li>
            <span>${p.name}</span>
            <span>${p.hasVoted ? '✅ A voté' : '⏳ En attente'}</span>
          </li>`
          )
          .join('')}
      </ul>
    `;
  }

  const myVote = me?.myVote;

  return `
    <div class="card" style="text-align:center">
      <h2>🗳️ Qui est l'imposteur ?</h2>
      <p class="rules" style="margin-top:8px">Vote pour le joueur suspect</p>
    </div>
    <div class="vote-grid">
      ${playingPlayers()
        .filter((p) => p.id !== myId)
        .map(
          (p) => `
        <button class="vote-btn ${myVote === p.id ? 'selected' : ''}" data-vote="${p.id}" ${myVote ? 'disabled' : ''}>
          ${p.name}
          ${myVote === p.id ? '✓' : ''}
        </button>`
        )
        .join('')}
    </div>
    ${myVote ? `<p class="rules" style="text-align:center;margin-top:12px">Vote enregistré ! En attente des autres…</p>` : ''}
  `;
}

function renderResults() {
  clearTimer();
  const results = room.results;
  if (!results) return '<div class="card">Résultats en chargement…</div>';

  const impostor = room.players.find((p) => p.id === results.impostorId);
  const innocentsWin = results.innocentsWin;

  return `
    <div class="results-banner ${innocentsWin ? 'win-innocents' : 'win-impostor'}">
      <h2>${innocentsWin ? '🎉 Les innocents gagnent !' : '🕵️ L\'imposteur gagne !'}</h2>
      <p>${results.tie ? 'Égalité au vote — l\'imposteur l\'emporte.' : innocentsWin ? 'L\'imposteur a été démasqué !' : 'Mauvais vote !'}</p>
    </div>
    <div class="card">
      <h2>L'imposteur était…</h2>
      <p style="font-size:1.4rem;font-weight:800;margin:12px 0">${impostor?.name ?? '?'}</p>
      <p class="rules">Mot imposteur : <strong>${impostor?.word}</strong></p>
      <p class="rules">Mot majorité : <strong>${room.players.find((p) => !p.isImpostor && !p.isChef)?.word}</strong></p>
    </div>
    <div class="card">
      <h2>Détail des votes</h2>
      <ul class="player-list">
        ${playingPlayers()
          .map((p) => {
            const votes = results.voteCounts?.[p.id] ?? 0;
            return `<li><span>${p.name}${p.isImpostor ? ' 🕵️' : ''}</span><span>${votes} vote(s)</span></li>`;
          })
          .join('')}
      </ul>
    </div>
    <div class="card">
      <h2>Joueurs</h2>
      ${canChefKick() ? '<p class="rules" style="margin-bottom:10px">Clique sur ✕ pour expulser un joueur.</p>' : ''}
      <ul class="player-list">
        ${room.players.map((p) => renderPlayerRow(p, { showKick: canChefKick() })).join('')}
      </ul>
    </div>
    ${renderChefTransfer()}
    ${
      getMe()?.isChef
        ? `<button class="btn btn-primary" id="btn-new-game">Nouvelle partie</button>`
        : `<p class="rules" style="text-align:center">En attente du chef pour relancer…</p>`
    }
  `;
}

function render() {
  if (!room) {
    app.innerHTML = renderHome();
    bindHomeEvents();
    return;
  }

  switch (room.state) {
    case 'waiting':
      app.innerHTML = renderLobby();
      bindLobbyEvents();
      break;
    case 'playing':
      app.innerHTML = renderPlaying();
      bindPlayingEvents();
      break;
    case 'between_rounds':
      app.innerHTML = renderBetweenRounds();
      bindBetweenRoundsEvents();
      break;
    case 'voting':
      app.innerHTML = renderVoting();
      bindVotingEvents();
      break;
    case 'results':
      app.innerHTML = renderResults();
      bindResultsEvents();
      break;
    default:
      app.innerHTML = renderLobby();
      bindLobbyEvents();
  }
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

function bindKickEvents() {
  document.querySelectorAll('[data-kick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.kick;
      const name = getPlayerName(targetId);
      if (!confirm(`Expulser ${name} du salon ?`)) return;
      const res = await emit('kick_player', { targetId });
      if (res.error) alert(res.error);
    });
  });
}

function bindChefTransferEvents() {
  document.querySelectorAll('[data-transfer-chef]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.transferChef;
      const name = getPlayerName(targetId);
      if (!confirm(`Passer le rôle de chef à ${name} ?`)) return;
      const res = await emit('transfer_chef', { targetId });
      if (res.error) alert(res.error);
    });
  });
}

function bindLobbyEvents() {
  document.getElementById('btn-copy')?.addEventListener('click', () => copyCode(room.code));
  document.getElementById('btn-start')?.addEventListener('click', async () => {
    const wordMajority = document.getElementById('word-majority')?.value;
    const wordImpostor = document.getElementById('word-impostor')?.value;
    const res = await emit('start_game', { wordMajority, wordImpostor });
    if (res.error) alert(res.error);
  });
  bindKickEvents();
  bindChefTransferEvents();
}

function bindPlayingEvents() {
  document.getElementById('btn-end-turn')?.addEventListener('click', async () => {
    const res = await emit('end_turn');
    if (res.error) alert(res.error);
  });
}

function bindBetweenRoundsEvents() {
  document.getElementById('btn-add-round')?.addEventListener('click', async () => {
    const res = await emit('add_round');
    if (res.error) alert(res.error);
  });
  document.getElementById('btn-vote')?.addEventListener('click', async () => {
    const res = await emit('start_voting');
    if (res.error) alert(res.error);
  });
}

function bindVotingEvents() {
  document.querySelectorAll('[data-vote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.vote;
      const res = await emit('vote', { targetId });
      if (res.error) alert(res.error);
    });
  });
}

function bindResultsEvents() {
  document.getElementById('btn-new-game')?.addEventListener('click', async () => {
    const res = await emit('new_game');
    if (res.error) alert(res.error);
  });
  bindKickEvents();
  bindChefTransferEvents();
}

render();