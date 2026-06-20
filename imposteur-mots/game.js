const MIN_TOTAL_PLAYERS = 3;
const MIN_ROUNDS = 2;
const TURN_DURATION_MS = 15000;

const BASE_ROOM_CODE = 'KEO';

export function generateRoomCode(existingCodes = []) {
  const taken = new Set([...existingCodes].map((c) => c.toUpperCase()));

  if (!taken.has(BASE_ROOM_CODE)) {
    return BASE_ROOM_CODE;
  }

  let suffix = 1;
  while (taken.has(`${BASE_ROOM_CODE}${suffix}`)) {
    suffix += 1;
  }
  return `${BASE_ROOM_CODE}${suffix}`;
}

export function createRoom(chefId, chefName, existingCodes = []) {
  return {
    code: generateRoomCode(existingCodes),
    chefId,
    state: 'waiting',
    wordMajority: '',
    wordImpostor: '',
    impostorId: null,
    currentRound: 0,
    completedRounds: 0,
    currentTurnIndex: 0,
    turnPlayerIds: [],
    timerEndsAt: null,
    votes: {},
    players: [
      {
        id: chefId,
        name: chefName,
        isChef: true,
        word: null,
        isImpostor: false,
        connected: true,
      },
    ],
    createdAt: Date.now(),
  };
}

export function getPlayingPlayers(room) {
  return room.players.filter((p) => !p.isChef);
}

export function getTotalPlayers(room) {
  return room.players.filter((p) => p.connected).length;
}

export function canStartGame(room) {
  return room.state === 'waiting' && getTotalPlayers(room) >= MIN_TOTAL_PLAYERS;
}

export function assignWords(room, wordMajority, wordImpostor) {
  const playing = getPlayingPlayers(room);
  const impostorIndex = Math.floor(Math.random() * playing.length);

  room.wordMajority = wordMajority.trim();
  room.wordImpostor = wordImpostor.trim();
  room.impostorId = playing[impostorIndex].id;

  playing.forEach((player, index) => {
    const isImpostor = index === impostorIndex;
    player.isImpostor = isImpostor;
    player.word = isImpostor ? room.wordImpostor : room.wordMajority;
  });

  room.state = 'playing';
  room.currentRound = 1;
  room.completedRounds = 0;
  room.turnPlayerIds = playing.map((p) => p.id);
  room.currentTurnIndex = 0;
  room.timerEndsAt = Date.now() + TURN_DURATION_MS;
  room.votes = {};
}

export function getCurrentTurnPlayerId(room) {
  if (room.state !== 'playing' || room.turnPlayerIds.length === 0) return null;
  return room.turnPlayerIds[room.currentTurnIndex] ?? null;
}

export function advanceTurn(room) {
  room.currentTurnIndex += 1;

  if (room.currentTurnIndex >= room.turnPlayerIds.length) {
    room.completedRounds += 1;
    room.currentTurnIndex = 0;

    if (room.completedRounds >= room.currentRound) {
      room.state = 'between_rounds';
      room.timerEndsAt = null;
      return { roundComplete: true };
    }
  }

  room.timerEndsAt = Date.now() + TURN_DURATION_MS;
  return { roundComplete: false };
}

export function startNextRound(room) {
  if (room.state !== 'between_rounds') return false;
  room.currentRound += 1;
  room.state = 'playing';
  room.currentTurnIndex = 0;
  room.timerEndsAt = Date.now() + TURN_DURATION_MS;
  return true;
}

export function startVoting(room) {
  if (room.state !== 'between_rounds') return false;
  if (room.completedRounds < MIN_ROUNDS) return false;

  room.state = 'voting';
  room.timerEndsAt = null;
  room.votes = {};
  return true;
}

export function castVote(room, voterId, targetId) {
  const voter = room.players.find((p) => p.id === voterId);
  const target = room.players.find((p) => p.id === targetId);

  if (!voter || voter.isChef || room.state !== 'voting') return false;
  if (!target || target.isChef) return false;

  room.votes[voterId] = targetId;
  return true;
}

export function allVotesIn(room) {
  const playing = getPlayingPlayers(room);
  return playing.every((p) => room.votes[p.id]);
}

export function computeResults(room) {
  const voteCounts = {};
  Object.values(room.votes).forEach((targetId) => {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let topCandidates = [];

  Object.entries(voteCounts).forEach(([playerId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      topCandidates = [playerId];
    } else if (count === maxVotes) {
      topCandidates.push(playerId);
    }
  });

  const impostorFound =
    topCandidates.length === 1 && topCandidates[0] === room.impostorId;
  const tie = topCandidates.length > 1;
  const innocentsWin = impostorFound;
  const impostorWins = tie || !impostorFound;

  room.state = 'results';

  return {
    voteCounts,
    topCandidates,
    impostorId: room.impostorId,
    impostorFound,
    tie,
    innocentsWin,
    impostorWins,
  };
}

export function resetRoom(room) {
  room.state = 'waiting';
  room.wordMajority = '';
  room.wordImpostor = '';
  room.impostorId = null;
  room.currentRound = 0;
  room.completedRounds = 0;
  room.currentTurnIndex = 0;
  room.turnPlayerIds = [];
  room.timerEndsAt = null;
  room.votes = {};
  room.results = null;

  room.players.forEach((p) => {
    if (!p.isChef) {
      p.word = null;
      p.isImpostor = false;
    }
  });
}

export function sanitizeRoomForPlayer(room, playerId) {
  const player = room.players.find((p) => p.id === playerId);
  const isChef = player?.isChef ?? false;
  const showWords = room.state === 'results';

  return {
    code: room.code,
    state: room.state,
    chefId: room.chefId,
    currentRound: room.currentRound,
    completedRounds: room.completedRounds,
    minRounds: MIN_ROUNDS,
    currentTurnPlayerId: getCurrentTurnPlayerId(room),
    currentTurnIndex: room.currentTurnIndex,
    timerEndsAt: room.timerEndsAt,
    turnDurationMs: TURN_DURATION_MS,
    minPlayers: MIN_TOTAL_PLAYERS,
    playerCount: getTotalPlayers(room),
    canStart: canStartGame(room),
    canAddRound: room.state === 'between_rounds',
    canVote:
      room.state === 'between_rounds' && room.completedRounds >= MIN_ROUNDS,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isChef: p.isChef,
      connected: p.connected,
      word:
        p.id === playerId
          ? p.word
          : showWords
            ? p.word
            : null,
      isImpostor: showWords ? p.isImpostor : null,
      hasVoted: room.state === 'voting' ? !!room.votes[p.id] : undefined,
      myVote: p.id === playerId ? room.votes[p.id] : undefined,
    })),
    myRole: {
      isChef,
      word: player?.word ?? null,
      isImpostor: showWords ? (player?.isImpostor ?? null) : null,
    },
    votes:
      room.state === 'results' || room.state === 'voting'
        ? Object.fromEntries(
            room.players
              .filter((p) => room.votes[p.id])
              .map((p) => [p.id, room.votes[p.id]])
          )
        : undefined,
    results: room.results ?? null,
  };
}

export function setRoomResults(room, results) {
  room.results = results;
}

export { MIN_TOTAL_PLAYERS, MIN_ROUNDS, TURN_DURATION_MS };