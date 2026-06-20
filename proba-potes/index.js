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
  ensurePlayer,
  playerKey,
} from './game.js';
import { loadRooms, saveRooms } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3003;

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const rooms = loadRooms();
const socketSession = new Map();

function persist() {
  saveRooms(rooms);
}

function getRoomByCode(code) {
  return rooms.get(code?.toUpperCase());
}

function setPlayerConnected(room, key, connected) {
  const player = room.players.find((p) => p.key === key);
  if (player) player.connected = connected;
}

function broadcastRoom(room) {
  room.players.forEach((player) => {
    if (!player.connected) return;
    for (const [sid, session] of socketSession.entries()) {
      if (session.code === room.code && session.playerKey === player.key) {
        io.to(sid).emit('room_update', sanitizeRoomForPlayer(room, player.key));
      }
    }
  });
}

function sendToPlayer(room, playerKey) {
  const player = room.players.find((p) => p.key === playerKey);
  if (!player?.connected) return;
  for (const [sid, session] of socketSession.entries()) {
    if (session.code === room.code && session.playerKey === playerKey) {
      io.to(sid).emit('room_update', sanitizeRoomForPlayer(room, playerKey));
    }
  }
}

function attachSession(socket, room, name) {
  const key = playerKey(name);
  ensurePlayer(room, name);
  setPlayerConnected(room, key, true);

  socketSession.set(socket.id, { code: room.code, playerKey: key, name: name.trim() });
  socket.join(room.code);

  return key;
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ playerName }, cb) => {
    const name = playerName?.trim();
    if (!name) return cb?.({ error: 'Nom requis' });

    const key = playerKey(name);
    const room = createRoom(key, name, rooms.keys());
    room.players[0].connected = true;

    rooms.set(room.code, room);
    attachSession(socket, room, name);
    persist();

    cb?.({ success: true, code: room.code, playerKey: key });
    sendToPlayer(room, key);
  });

  socket.on('join_room', ({ code, playerName }, cb) => {
    const name = playerName?.trim();
    const room = getRoomByCode(code);

    if (!name) return cb?.({ error: 'Nom requis' });
    if (!room) return cb?.({ error: 'Forum introuvable' });

    const key = attachSession(socket, room, name);
    persist();

    cb?.({ success: true, code: room.code, playerKey: key });
    broadcastRoom(room);
  });

  socket.on('create_proba', ({ description, cote, reverse }, cb) => {
    const session = socketSession.get(socket.id);
    const room = session ? rooms.get(session.code) : null;
    if (!room || !session) return cb?.({ error: 'Pas connecté au forum' });

    const result = createProba(room, session.playerKey, { description, cote, reverse });
    if (result.error) return cb?.({ error: result.error });

    persist();
    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('accept_proba', ({ probaId }, cb) => {
    const session = socketSession.get(socket.id);
    const room = session ? rooms.get(session.code) : null;
    if (!room || !session) return cb?.({ error: 'Pas connecté au forum' });

    const result = acceptProba(room, probaId, session.playerKey);
    if (result.error) return cb?.({ error: result.error });

    persist();
    cb?.({ success: true });
    broadcastRoom(room);
  });

  socket.on('submit_pick', ({ probaId, number }, cb) => {
    const session = socketSession.get(socket.id);
    const room = session ? rooms.get(session.code) : null;
    if (!room || !session) return cb?.({ error: 'Pas connecté au forum' });

    const result = submitPick(room, probaId, session.playerKey, number);
    if (result.error) return cb?.({ error: result.error });

    persist();
    cb?.({ success: true, resolved: result.resolved });
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    const session = socketSession.get(socket.id);
    socketSession.delete(socket.id);
    if (!session) return;

    const room = rooms.get(session.code);
    if (!room) return;

    setPlayerConnected(room, session.playerKey, false);
    persist();
    broadcastRoom(room);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Proba Potes — port ${PORT}`);
  console.log(`Forums chargés : ${rooms.size}`);
});