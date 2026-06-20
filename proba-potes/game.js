const MIN_COTE = 2;
const MAX_COTE = 100;
const BASE_ROOM_CODE = 'PROBA';

export function generateRoomCode(existingCodes = []) {
  const taken = new Set([...existingCodes].map((c) => c.toUpperCase()));

  if (!taken.has(BASE_ROOM_CODE)) return BASE_ROOM_CODE;

  let suffix = 1;
  while (taken.has(`${BASE_ROOM_CODE}${suffix}`)) suffix += 1;
  return `${BASE_ROOM_CODE}${suffix}`;
}

export function createRoom(hostId, hostName, existingCodes = []) {
  return {
    code: generateRoomCode(existingCodes),
    hostId,
    players: [
      { id: hostId, name: hostName, connected: true },
    ],
    probas: [],
    createdAt: Date.now(),
  };
}

function getPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId);
}

function newProbaId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createProba(room, creatorId, { description, cote, reverse }) {
  const creator = getPlayer(room, creatorId);
  if (!creator) return { error: 'Joueur introuvable' };

  const desc = description?.trim();
  if (!desc) return { error: 'Description requise' };

  const parsedCote = Number.parseInt(cote, 10);
  if (!Number.isInteger(parsedCote) || parsedCote < MIN_COTE || parsedCote > MAX_COTE) {
    return { error: `La cote doit être entre ${MIN_COTE} et ${MAX_COTE}` };
  }

  const proba = {
    id: newProbaId(),
    creatorId,
    accepterId: null,
    description: desc,
    initialCote: parsedCote,
    reverse: !!reverse,
    round: 1,
    roundHolderId: creatorId,
    currentCote: parsedCote,
    state: 'open',
    picks: {},
    result: null,
    createdAt: Date.now(),
  };

  room.probas.unshift(proba);
  return { proba };
}

export function acceptProba(room, probaId, accepterId) {
  const proba = room.probas.find((p) => p.id === probaId);
  if (!proba || proba.state !== 'open') return { error: 'Proba introuvable ou déjà prise' };

  const accepter = getPlayer(room, accepterId);
  if (!accepter) return { error: 'Joueur introuvable' };
  if (accepterId === proba.creatorId) return { error: 'Tu ne peux pas accepter ta propre proba' };

  proba.accepterId = accepterId;
  proba.state = 'picking';
  proba.picks = {};
  return { proba };
}

export function submitPick(room, probaId, playerId, number) {
  const proba = room.probas.find((p) => p.id === probaId);
  if (!proba || proba.state !== 'picking') return { error: 'Cette proba n\'est pas en cours' };

  const pick = Number.parseInt(number, 10);
  if (!Number.isInteger(pick) || pick < 0 || pick > proba.currentCote) {
    return { error: `Choisis un nombre entre 0 et ${proba.currentCote}` };
  }

  const isParticipant = playerId === proba.creatorId || playerId === proba.accepterId;
  if (!isParticipant) return { error: 'Tu ne participes pas à cette proba' };

  if (proba.picks[playerId] != null) return { error: 'Tu as déjà joué ce tour' };

  proba.picks[playerId] = pick;

  const creatorPick = proba.picks[proba.creatorId];
  const accepterPick = proba.picks[proba.accepterId];

  if (creatorPick == null || accepterPick == null) {
    return { proba, resolved: false };
  }

  return resolveRound(room, proba, creatorPick, accepterPick);
}

function resolveRound(room, proba, creatorPick, accepterPick) {
  const sameNumber = creatorPick === accepterPick;
  const roundHolder = getPlayer(room, proba.roundHolderId);
  const otherId =
    proba.roundHolderId === proba.creatorId ? proba.accepterId : proba.creatorId;
  const other = getPlayer(room, otherId);

  if (sameNumber) {
    proba.state = 'done';
    proba.result = {
      outcome: 'holder_lost',
      winnerId: otherId,
      loserId: proba.roundHolderId,
      creatorPick,
      accepterPick,
      round: proba.round,
      currentCote: proba.currentCote,
      message: `${roundHolder?.name ?? 'Le joueur'} perd — même nombre (${creatorPick}).`,
    };
    return { proba, resolved: true };
  }

  if (proba.reverse && proba.round === 1) {
    proba.round = 2;
    proba.roundHolderId = proba.accepterId;
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
      message: `Nombres différents — reverse ! Tour 2 pour ${getPlayer(room, proba.accepterId)?.name ?? 'l\'accepteur'} (cote ÷ 2 = ${proba.currentCote}).`,
    };
    return { proba, resolved: true, nextRound: true };
  }

  proba.state = 'done';
  proba.result = {
    outcome: 'holder_won',
    winnerId: proba.roundHolderId,
    loserId: otherId,
    creatorPick,
    accepterPick,
    round: proba.round,
    currentCote: proba.currentCote,
    message: `${roundHolder?.name ?? 'Le joueur'} gagne — nombres différents.`,
  };
  return { proba, resolved: true };
}

export function sanitizeProba(proba, viewerId) {
  const isParticipant = viewerId === proba.creatorId || viewerId === proba.accepterId;
  const bothPicked =
    proba.picks[proba.creatorId] != null && proba.picks[proba.accepterId] != null;
  const revealPicks = proba.state === 'done' || (proba.state === 'picking' && bothPicked);

  const myPick = isParticipant ? proba.picks[viewerId] : undefined;
  const otherId =
    viewerId === proba.creatorId
      ? proba.accepterId
      : viewerId === proba.accepterId
        ? proba.creatorId
        : null;
  const otherPick =
    otherId && revealPicks ? proba.picks[otherId] : undefined;
  const otherHasPlayed =
    otherId != null && proba.picks[otherId] != null && !revealPicks;

  return {
    id: proba.id,
    description: proba.description,
    initialCote: proba.initialCote,
    reverse: proba.reverse,
    round: proba.round,
    roundHolderId: proba.roundHolderId,
    currentCote: proba.currentCote,
    state: proba.state,
    creatorId: proba.creatorId,
    accepterId: proba.accepterId,
    result: proba.result,
    myPick: myPick ?? null,
    myHasPlayed: isParticipant && proba.picks[viewerId] != null,
    otherHasPlayed: isParticipant ? otherHasPlayed : false,
    creatorPick: revealPicks ? proba.picks[proba.creatorId] : null,
    accepterPick: revealPicks ? proba.picks[proba.accepterId] : null,
    waitingForMe:
      isParticipant &&
      proba.state === 'picking' &&
      proba.picks[viewerId] == null,
    waitingForOther:
      isParticipant &&
      proba.state === 'picking' &&
      proba.picks[viewerId] != null &&
      proba.picks[otherId] == null,
  };
}

export function sanitizeRoomForPlayer(room, playerId) {
  return {
    code: room.code,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
    })),
    probas: room.probas.map((p) => sanitizeProba(p, playerId)),
    minCote: MIN_COTE,
    maxCote: MAX_COTE,
  };
}

export { MIN_COTE, MAX_COTE };