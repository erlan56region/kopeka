'use strict';
/**
 * Хранилище: обычный JSON-файл (data/db.json).
 * Никаких нативных зависимостей — работает на любом Node.js >= 18.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let state = null;
let saveTimer = null;

function id(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

function now() {
  return Date.now();
}

function emptyDb() {
  return {
    version: 1,
    users: [],
    sessions: {},
    ads: [],
    chats: [],
    messages: [],
    favorites: [],
    deals: [],
    reviews: [],
    meta: { seeded: false },
  };
}

function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    state = Object.assign(emptyDb(), JSON.parse(raw));
  } catch (e) {
    state = emptyDb();
  }
  return state;
}

function db() {
  if (!state) load();
  return state;
}

function saveNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DB_FILE);
}

/** Отложенная запись — чтобы не дёргать диск на каждый чих. */
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveNow(); } catch (e) { console.error('db save failed', e.message); }
  }, 120);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

module.exports = { db, save, saveNow, load, id, now, DATA_DIR, DB_FILE, UPLOAD_DIR };
