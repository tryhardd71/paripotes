import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createRoom,
  createProba,
  acceptProba,
  submitPick,
  sanitizeRoomForPlayer,
} from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3003;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

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

    const existing = room.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && p.connected
    );
    if (existing) return cb?.({ error: 'Ce pseudo est déjà pris' });

    const disconnected = room.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase() && !p.connected
    );

    if (disconnected) {
      const oldId = disconnected.id;
      disconnected.id = socket.id;
      disconnected.connected = true;

      room.probas.forEach((proba) => {
        if (proba.creatorId === oldId) proba.creatorId = socket.id;
        if (proba.accepterId === oldId) proba.accepterId = socket.id;
        if (proba.roundHolderId === oldId) proba.roundHolderId = socket.id;
        if (proba.picks[oldId] != null) {
          proba.picks[socket.id] = proba.picks[oldId];
          delete proba.picks[oldId];
        }
      });
    } else {
      room.players.push({
        id: socket.id,
        name,
        connected: true,
      });
    }

    playerRoom.set(socket.id, room.code);
    socket.join(room.code);

    cb?.({ success: true, code: room.code });
    broadcastRoom(room);
  });

  socket.on('create_proba', ({ description, cote, reverse }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb?.({ error: 'Pas de salon' });

    const result = createProba(room, socket.id, { description, cote, reverse });
    if (result.error) return cb?.({ error: result.error });

    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('accept_proba', ({ probaId }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb?.({ error: 'Pas de salon' });

    const result = acceptProba(room, probaId, socket.id);
    if (result.error) return cb?.({ error: result.error });

    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('submit_pick', ({ probaId, number }, cb) => {
    const code = playerRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room) return cb?.({ error: 'Pas de salon' });

    const result = submitPick(room, probaId, socket.id, number);
    if (result.error) return cb?.({ error: result.error });

    cb?.({ success: true, resolved: result.resolved });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const code = playerRoom.get(socket.id);
    playerRoom.delete(socket.id);
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (player) {
      player.connected = false;
      const offlineId = `offline-${player.name}`;
      room.probas.forEach((proba) => {
        if (proba.creatorId === socket.id) proba.creatorId = offlineId;
        if (proba.accepterId === socket.id) proba.accepterId = offlineId;
        if (proba.roundHolderId === socket.id) proba.roundHolderId = offlineId;
        if (proba.picks[socket.id] != null) {
          proba.picks[offlineId] = proba.picks[socket.id];
          delete proba.picks[socket.id];
        }
      });
      player.id = offlineId;
    }

    const anyoneConnected = room.players.some((p) => p.connected);
    if (!anyoneConnected) rooms.delete(code);
    else broadcastRoom(room);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Proba Potes — port ${PORT}`);
});