const MIN_COTE = 2;
const MAX_COTE = 100;
const BASE_ROOM_CODE = 'PROBA';

export function playerKey(name) {
  return `user-${name.trim().toLowerCase()}`;
}

export function generateRoomCode(existingCodes = []) {
  const taken = new Set([...existingCodes].map((c) => c.toUpperCase()));
  if (!taken.has(BASE_ROOM_CODE)) return BASE_ROOM_CODE;
  let suffix = 1;
  while (taken.has(`${BASE_ROOM_CODE}${suffix}`)) suffix += 1;
  return `${BASE_ROOM_CODE}${suffix}`;
}

export function createRoom(hostKey, hostName, existingCodes = []) {
  return {
    code: generateRoomCode(existingCodes),
    hostKey,
    players: [{ key: hostKey, name: hostName, connected: false }],
    probas: [],
    createdAt: Date.now(),
  };
}

export function ensurePlayer(room, name) {
  const key = playerKey(name);
  let player = room.players.find((p) => p.key === key);
  if (!player) {
    player = { key, name: name.trim(), connected: false };
    room.players.push(player);
  } else {
    player.name = name.trim();
  }
  return player;
}

function getPlayer(room, key) {
  return room.players.find((p) => p.key === key);
}

function newProbaId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createProba(room, creatorKey, { description, cote, reverse }) {
  const creator = getPlayer(room, creatorKey);
  if (!creator) return { error: 'Joueur introuvable' };

  const desc = description?.trim();
  if (!desc) return { error: 'Description requise' };

  const parsedCote = Number.parseInt(cote, 10);
  if (!Number.isInteger(parsedCote) || parsedCote < MIN_COTE || parsedCote > MAX_COTE) {
    return { error: `La cote doit être entre ${MIN_COTE} et ${MAX_COTE}` };
  }

  const proba = {
    id: newProbaId(),
    creatorKey,
    accepterKey: null,
    description: desc,
    initialCote: parsedCote,
    reverse: !!reverse,
    round: 1,
    roundHolderKey: creatorKey,
    currentCote: parsedCote,
    state: 'open',
    picks: {},
    result: null,
    createdAt: Date.now(),
    acceptedAt: null,
    resolvedAt: null,
  };

  room.probas.unshift(proba);
  return { proba };
}

export function acceptProba(room, probaId, accepterKey) {
  const proba = room.probas.find((p) => p.id === probaId);
  if (!proba || proba.state !== 'open') return { error: 'Sujet introuvable ou déjà accepté' };

  const accepter = getPlayer(room, accepterKey);
  if (!accepter) return { error: 'Joueur introuvable' };
  if (accepterKey === proba.creatorKey) return { error: 'Tu ne peux pas accepter ta propre proba' };

  proba.accepterKey = accepterKey;
  proba.state = 'picking';
  proba.picks = {};
  proba.result = null;
  proba.acceptedAt = Date.now();
  return { proba };
}

export function submitPick(room, probaId, playerKey, number) {
  const proba = room.probas.find((p) => p.id === probaId);
  if (!proba || proba.state !== 'picking') return { error: 'Ce sujet n\'est pas en cours de jeu' };

  const pick = Number.parseInt(number, 10);
  if (!Number.isInteger(pick) || pick < 0 || pick > proba.currentCote) {
    return { error: `Choisis un nombre entre 0 et ${proba.currentCote}` };
  }

  const isParticipant = playerKey === proba.creatorKey || playerKey === proba.accepterKey;
  if (!isParticipant) return { error: 'Tu ne participes pas à cette proba' };

  if (proba.picks[playerKey] != null) return { error: 'Tu as déjà joué ce tour' };

  proba.picks[playerKey] = pick;

  const creatorPick = proba.picks[proba.creatorKey];
  const accepterPick = proba.picks[proba.accepterKey];

  if (creatorPick == null || accepterPick == null) {
    return { proba, resolved: false };
  }

  return resolveRound(room, proba, creatorPick, accepterPick);
}

function verdictForViewer(proba, viewerKey, outcome, winnerKey, loserKey) {
  if (!viewerKey || viewerKey !== proba.creatorKey && viewerKey !== proba.accepterKey) return null;
  if (outcome === 'tie') return 'tie';
  if (outcome === 'reverse_next_round') return 'round_done';
  if (winnerKey === viewerKey) return 'win';
  if (loserKey === viewerKey) return 'lose';
  return null;
}

function resolveRound(room, proba, creatorPick, accepterPick) {
  const sameNumber = creatorPick === accepterPick;
  const roundHolder = getPlayer(room, proba.roundHolderKey);
  const otherKey =
    proba.roundHolderKey === proba.creatorKey ? proba.accepterKey : proba.creatorKey;

  if (sameNumber) {
    proba.state = 'done';
    proba.resolvedAt = Date.now();
    proba.result = {
      outcome: 'tie',
      winnerKey: null,
      loserKey: null,
      creatorPick,
      accepterPick,
      round: proba.round,
      currentCote: proba.currentCote,
      message: `Égalité — vous avez tous les deux choisi ${creatorPick}.`,
    };
    return { proba, resolved: true };
  }

  if (proba.reverse && proba.round === 1) {
    proba.round = 2;
    proba.roundHolderKey = proba.accepterKey;
    proba.currentCote = Math.max(MIN_COTE, Math.floor(proba.initialCote / 2));
    proba.state = 'picking';
    proba.picks = {};
    proba.result = {
      outcome: 'reverse_next_round',
      creatorPick,
      accepterPick,
      round: 1,
      currentCote: proba.initialCote,
      nextCote: proba.currentCote,
      message: `Nombres différents (${creatorPick} vs ${accepterPick}) — reverse ! Tour 2 pour ${getPlayer(room, proba.accepterKey)?.name ?? 'l\'accepteur'} (cote ÷ 2 = ${proba.currentCote}). Reconnecte-toi quand tu veux pour jouer ton nombre.`,
    };
    return { proba, resolved: true, nextRound: true };
  }

  proba.state = 'done';
  proba.resolvedAt = Date.now();
  proba.result = {
    outcome: 'holder_won',
    winnerKey: proba.roundHolderKey,
    loserKey: otherKey,
    creatorPick,
    accepterPick,
    round: proba.round,
    currentCote: proba.currentCote,
    message: `${roundHolder?.name ?? 'Le joueur'} gagne — nombres différents (${creatorPick} vs ${accepterPick}).`,
  };
  return { proba, resolved: true };
}

export function sanitizeProba(proba, viewerKey) {
  const isParticipant = viewerKey === proba.creatorKey || viewerKey === proba.accepterKey;
  const creatorPick = proba.picks[proba.creatorKey];
  const accepterPick = proba.picks[proba.accepterKey];
  const bothPickedThisRound = creatorPick != null && accepterPick != null;
  const revealPicks = proba.state === 'done' || bothPickedThisRound;

  const otherKey =
    viewerKey === proba.creatorKey
      ? proba.accepterKey
      : viewerKey === proba.accepterKey
        ? proba.creatorKey
        : null;

  const myPick = isParticipant && proba.picks[viewerKey] != null ? proba.picks[viewerKey] : null;
  const myHasPlayed = isParticipant && proba.picks[viewerKey] != null;

  let myVerdict = null;
  if (proba.state === 'done' && proba.result && isParticipant) {
    myVerdict = verdictForViewer(
      proba,
      viewerKey,
      proba.result.outcome,
      proba.result.winnerKey,
      proba.result.loserKey
    );
  }

  return {
    id: proba.id,
    description: proba.description,
    initialCote: proba.initialCote,
    reverse: proba.reverse,
    round: proba.round,
    roundHolderKey: proba.roundHolderKey,
    currentCote: proba.currentCote,
    state: proba.state,
    creatorKey: proba.creatorKey,
    accepterKey: proba.accepterKey,
    result:
      proba.state === 'done' ||
      proba.result?.outcome === 'reverse_next_round' ||
      revealPicks
        ? proba.result
        : null,
    myPick,
    myHasPlayed,
    myVerdict,
    otherHasPlayed: isParticipant && otherKey != null && proba.picks[otherKey] != null && !revealPicks,
    creatorPick: revealPicks ? creatorPick : null,
    accepterPick: revealPicks ? accepterPick : null,
    waitingForMe: isParticipant && proba.state === 'picking' && proba.picks[viewerKey] == null,
    waitingForOther:
      isParticipant &&
      proba.state === 'picking' &&
      proba.picks[viewerKey] != null &&
      proba.picks[otherKey] == null,
    createdAt: proba.createdAt,
    acceptedAt: proba.acceptedAt,
    resolvedAt: proba.resolvedAt,
  };
}

export function sanitizeRoomForPlayer(room, viewerKey) {
  return {
    code: room.code,
    myKey: viewerKey,
    players: room.players.map((p) => ({
      key: p.key,
      name: p.name,
      connected: p.connected,
    })),
    probas: room.probas.map((p) => sanitizeProba(p, viewerKey)),
    minCote: MIN_COTE,
    maxCote: MAX_COTE,
  };
}

export { MIN_COTE, MAX_COTE };