import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  createRoom,
  assignWords,
  advanceTurn,
  startNextRound,
  startVoting,
  castVote,
  allVotesIn,
  computeResults,
  resetRoom,
  sanitizeRoomForPlayer,
  setRoomResults,
  getPlayingPlayers,
  MIN_TOTAL_PLAYERS,
} from './game.js';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

const rooms = new Map();
const playerRoom = new Map();

function broadcastRoom(room) {
  room.players.forEach((player) => {
    if (player.connected) {
      io.to(player.id).emit('room_update', sanitizeRoomForPlayer(room, player.id));
    }
  });
}

function getRoomByCode(code) {
  return rooms.get(code?.toUpperCase());
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ playerName }, cb) => {
    const name = playerName?.trim();
    if (!name) return cb?.({ error: 'Nom requis' });

    const room = createRoom(socket.id, name, rooms.keys());
    rooms.set(room.code, room);
    playerRoom.set(socket.id, room.code);
    socket.join(room.code);

    cb?.({ success: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('join_room', ({ code, playerName }, cb) => {
    const name = playerName?.trim();
    const room = getRoomByCode(code);

    if (!name) return cb?.({ error: 'Nom requis' });
    if (!room) return cb?.({ error: 'Salon introuvable' });
    if (room.state !== 'waiting') return cb?.({ error: 'La partie a déjà commencé' });

    const existing = room.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.connected
    );
    if (existing) return cb?.({ error: 'Ce pseudo est déjà pris' });

    const disconnected = room.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && !p.connected
    );

    if (disconnected) {
      disconnected.id = socket.id;
      disconnected.connected = true;
    } else {
      room.players.push({
        id: socket.id,
        name,
        isChef: false,
        word: null,
        isImpostor: false,
        connected: true,
      });
    }

    playerRoom.set(socket.id, room.code);
    socket.join(room.code);

    cb?.({ success: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('start_game', ({ wordMajority, wordImpostor }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.chefId !== socket.id) {
      return cb?.({ error: 'Seul le chef peut lancer la partie' });
    }

    if (!wordMajority?.trim() || !wordImpostor?.trim()) {
      return cb?.({ error: 'Les deux mots sont requis' });
    }

    if (room.players.filter((p) => p.connected).length < MIN_TOTAL_PLAYERS) {
      return cb?.({ error: `Il faut au moins ${MIN_TOTAL_PLAYERS} personnes (chef inclus)` });
    }

    assignWords(room, wordMajority, wordImpostor);
    room.results = null;
    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('end_turn', (_, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return cb?.({ error: 'Tour invalide' });

    const currentId = room.turnPlayerIds[room.currentTurnIndex];
    if (socket.id !== currentId && socket.id !== room.chefId) {
      return cb?.({ error: 'Ce n\'est pas ton tour' });
    }

    const { roundComplete } = advanceTurn(room);
    cb?.({ success: true, roundComplete });
    broadcastRoom(room);
  });

  socket.on('add_round', (_, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.chefId !== socket.id) {
      return cb?.({ error: 'Seul le chef peut ajouter un tour' });
    }

    if (!startNextRound(room)) return cb?.({ error: 'Action impossible' });

    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('start_voting', (_, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.chefId !== socket.id) {
      return cb?.({ error: 'Seul le chef peut lancer le vote' });
    }

    if (!startVoting(room)) return cb?.({ error: 'Il faut au moins 2 tours joués' });

    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('vote', ({ targetId }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room) return cb?.({ error: 'Salon introuvable' });
    if (!castVote(room, socket.id, targetId)) return cb?.({ error: 'Vote invalide' });

    cb?.({ success: true });

    if (allVotesIn(room)) {
      const results = computeResults(room);
      setRoomResults(room, results);
    }

    broadcastRoom(room);
  });

  socket.on('new_game', (_, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.chefId !== socket.id) {
      return cb?.({ error: 'Seul le chef peut relancer' });
    }

    resetRoom(room);
    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('kick_player', ({ targetId }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.chefId !== socket.id) {
      return cb?.({ error: 'Seul le chef peut expulser' });
    }

    if (!['waiting', 'results'].includes(room.state)) {
      return cb?.({ error: 'Impossible pendant la partie' });
    }

    const target = room.players.find((p) => p.id === targetId);
    if (!target) return cb?.({ error: 'Joueur introuvable' });
    if (target.isChef) return cb?.({ error: 'Impossible d\'expulser le chef' });

    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      io.to(room.code).emit('call_peer_left', { peerId: targetId });
      targetSocket.emit('kicked', { message: 'Tu as été expulsé par le chef.' });
      targetSocket.leave(room.code);
      playerRoom.delete(targetId);
    }

    room.players = room.players.filter((p) => p.id !== targetId);

    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('call_ready', (_, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb?.({ error: 'Pas de salon' });

    const player = room.players.find((p) => p.id === socket.id);
    const peers = room.players
      .filter((p) => p.connected && p.id !== socket.id)
      .map((p) => ({ id: p.id, name: p.name }));

    socket.to(room.code).emit('call_peer_joined', {
      peerId: socket.id,
      name: player?.name ?? 'Joueur',
    });

    cb?.({ peers });
  });

  socket.on('call_signal', ({ to, signal }) => {
    if (!to || !signal) return;
    io.to(to).emit('call_signal', { from: socket.id, signal });
  });

  socket.on('call_leave', () => {
    const code = playerRoom.get(socket.id);
    if (!code) return;
    socket.to(code).emit('call_peer_left', { peerId: socket.id });
  });

  socket.on('disconnect', () => {
    const code = playerRoom.get(socket.id);
    playerRoom.delete(socket.id);

    if (!code) return;

    io.to(code).emit('call_peer_left', { peerId: socket.id });

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.connected = false;
      player.id = `offline-${player.name}`;
    }

    if (room.chefId === socket.id) {
      const newChef = room.players.find((p) => p.connected && !p.isChef);
      if (newChef) {
        room.chefId = newChef.id;
        const oldChef = room.players.find((p) => p.isChef);
        if (oldChef) {
          oldChef.isChef = false;
          oldChef.connected = false;
        }
        newChef.isChef = true;
      } else {
        rooms.delete(code);
        return;
      }
    }

    broadcastRoom(room);
  });
});

setInterval(() => {
  rooms.forEach((room) => {
    if (room.state !== 'playing' || !room.timerEndsAt) return;
    if (Date.now() >= room.timerEndsAt) {
      advanceTurn(room);
      broadcastRoom(room);
    }
  });
}, 500);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Imposteur Mots — port ${PORT}`);
});