import * as data from './data.js';

export const MIN_COTE = 2;
export const MAX_COTE = 100;

function newId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function createProba(creatorId, { description, cote, reverse }) {
  const desc = description?.trim();
  if (!desc) return { error: 'Description requise' };

  const parsedCote = Number.parseInt(cote, 10);
  if (!Number.isInteger(parsedCote) || parsedCote < MIN_COTE || parsedCote > MAX_COTE) {
    return { error: `La cote doit être entre ${MIN_COTE} et ${MAX_COTE}` };
  }

  const proba = {
    id: newId(),
    creatorId,
    description: desc,
    initialCote: parsedCote,
    reverse: !!reverse,
    round: 1,
    roundHolderId: creatorId,
    currentCote: parsedCote,
    state: 'open',
    picks: {},
  };

  await data.insertProba(proba);
  return { proba };
}

export async function acceptProba(probaId, accepterId) {
  const proba = await data.getProba(probaId);
  if (!proba || proba.state !== 'open') return { error: 'Sujet introuvable ou déjà accepté' };
  if (accepterId === proba.creatorId) return { error: 'Tu ne peux pas accepter ta propre proba' };

  await data.updateProba(probaId, {
    accepterId,
    state: 'picking',
    picks: {},
    result: null,
    acceptedAt: new Date().toISOString(),
  });
  return { success: true };
}

export async function submitPick(probaId, userId, number) {
  const proba = await data.getProba(probaId);
  if (!proba || proba.state !== 'picking') return { error: 'Ce sujet n\'est pas en cours' };

  const pick = Number.parseInt(number, 10);
  if (!Number.isInteger(pick) || pick < 0 || pick > proba.currentCote) {
    return { error: `Choisis un nombre entre 0 et ${proba.currentCote}` };
  }

  if (userId !== proba.creatorId && userId !== proba.accepterId) {
    return { error: 'Tu ne participes pas à cette proba' };
  }

  const picks = { ...proba.picks };
  if (picks[userId] != null) return { error: 'Tu as déjà joué ce tour' };

  picks[userId] = pick;
  await data.updateProba(probaId, { picks });

  const creatorPick = picks[proba.creatorId];
  const accepterPick = picks[proba.accepterId];

  if (creatorPick == null || accepterPick == null) {
    return { resolved: false };
  }

  return resolveRound(proba, creatorPick, accepterPick, picks);
}

async function resolveRound(proba, creatorPick, accepterPick, picks) {
  const sameNumber = creatorPick === accepterPick;
  const holderId = proba.roundHolderId;
  const otherId = holderId === proba.creatorId ? proba.accepterId : proba.creatorId;

  const holder = await data.getUserById(holderId);
  const accepter = await data.getUserById(proba.accepterId);

  if (sameNumber) {
    const result = {
      outcome: 'tie',
      winnerId: null,
      loserId: null,
      creatorPick,
      accepterPick,
      round: proba.round,
      currentCote: proba.currentCote,
      message: `Égalité — vous avez tous les deux choisi ${creatorPick}.`,
    };
    await data.updateProba(proba.id, {
      state: 'done',
      result,
      resolvedAt: new Date().toISOString(),
    });
    return { resolved: true };
  }

  if (proba.reverse && proba.round === 1) {
    const nextCote = Math.max(MIN_COTE, Math.floor(proba.initialCote / 2));
    const result = {
      outcome: 'reverse_next_round',
      creatorPick,
      accepterPick,
      round: 1,
      currentCote: proba.initialCote,
      nextCote,
      message: `Nombres différents (${creatorPick} vs ${accepterPick}) — reverse ! Tour 2 pour ${accepter?.username ?? 'l\'accepteur'} (cote ÷ 2 = ${nextCote}).`,
    };
    await data.updateProba(proba.id, {
      round: 2,
      roundHolderId: proba.accepterId,
      currentCote: nextCote,
      state: 'picking',
      picks: {},
      result,
    });
    return { resolved: true, nextRound: true };
  }

  const result = {
    outcome: 'holder_won',
    winnerId: holderId,
    loserId: otherId,
    creatorPick,
    accepterPick,
    round: proba.round,
    currentCote: proba.currentCote,
    message: `${holder?.username ?? 'Le joueur'} gagne — nombres différents (${creatorPick} vs ${accepterPick}).`,
  };
  await data.updateProba(proba.id, {
    state: 'done',
    result,
    resolvedAt: new Date().toISOString(),
  });
  return { resolved: true };
}

export function sanitizeProba(proba, viewerId) {
  const isParticipant = viewerId === proba.creatorId || viewerId === proba.accepterId;
  const creatorPick = proba.picks[proba.creatorId];
  const accepterPick = proba.picks[proba.accepterId];
  const bothPicked = creatorPick != null && accepterPick != null;
  const revealPicks = proba.state === 'done' || bothPicked;

  const otherId =
    viewerId === proba.creatorId
      ? proba.accepterId
      : viewerId === proba.accepterId
        ? proba.creatorId
        : null;

  let myVerdict = null;
  if (proba.state === 'done' && proba.result && isParticipant) {
    const r = proba.result;
    if (r.outcome === 'tie') myVerdict = 'tie';
    else if (r.winnerId === viewerId) myVerdict = 'win';
    else if (r.loserId === viewerId) myVerdict = 'lose';
  }

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
    creatorName: proba.creatorName,
    accepterName: proba.accepterName,
    result:
      proba.state === 'done' ||
      proba.result?.outcome === 'reverse_next_round' ||
      revealPicks
        ? proba.result
        : null,
    myPick: isParticipant && proba.picks[viewerId] != null ? proba.picks[viewerId] : null,
    myHasPlayed: isParticipant && proba.picks[viewerId] != null,
    myVerdict,
    waitingForMe: isParticipant && proba.state === 'picking' && proba.picks[viewerId] == null,
    waitingForOther:
      isParticipant &&
      proba.state === 'picking' &&
      proba.picks[viewerId] != null &&
      proba.picks[otherId] == null,
    creatorPick: revealPicks ? creatorPick : null,
    accepterPick: revealPicks ? accepterPick : null,
    createdAt: proba.createdAt,
    acceptedAt: proba.acceptedAt,
    resolvedAt: proba.resolvedAt,
  };
}

export async function getForumForUser(userId) {
  const probas = await data.listProbas();
  return {
    probas: probas.map((p) => sanitizeProba(p, userId)),
    minCote: MIN_COTE,
    maxCote: MAX_COTE,
  };
}