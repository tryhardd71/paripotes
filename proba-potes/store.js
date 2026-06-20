import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

export function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) return new Map();
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return new Map(Object.entries(raw.rooms ?? {}));
  } catch {
    return new Map();
  }
}

export function saveRooms(rooms) {
  const obj = { rooms: Object.fromEntries(rooms) };
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}