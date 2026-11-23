#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка СТАТИЧЕСКОЙ версии маркетплейса «Копейкино» для GitHub Pages.

GitHub Pages умеет отдавать только файлы, поэтому маркетплейс собирается в
один самодостаточный index.html:
  • CSS и JS встраиваются внутрь файла;
  • шаблоны страниц (public/js/views.js) переносятся как есть;
  • server/seed.js выполняется настоящим Node.js и превращается в стартовые данные,
    поэтому демо-объявления, диалоги, сделки и избранное совпадают с серверной версией;
  • добавляется слой хранения (localStorage) и подсказка о том, что данные локальные.

Запуск:  python3 build_pages.py
Результат: pages/index.html  (его и публикует workflow GitHub Pages)
"""
import base64
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent
OUT_DIR = ROOT / 'pages'
OUT = OUT_DIR / 'index.html'

# Клиентский слой хранения: реализует те же ручки, что и серверный REST API.
STORE = r'''
// ---- клиентское хранилище (localStorage) ----
const DATA_KEY = 'kopeikino:data:v1';
const SESSION_KEY = 'kopeikino:session:v1';

function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function hashPass(password) {
  const mix = 'kopeikino|' + String(password);
  const bytes = new Uint8Array(32);
  for (let round = 0; round < 5000; round++) {
    let h = 0x811c9dc5;
    for (let i = 0; i < mix.length; i++) { h ^= mix.charCodeAt(i) + round; h = Math.imul(h, 16777619) >>> 0; }
    bytes[round % 32] = (bytes[round % 32] ^ (h & 0xff)) & 0xff;
  }
  return 'demo$' + bytesToB64(bytes);
}
function seedData() {
  const seed = JSON.parse(JSON.stringify(window.__KOPEIKINO_DEMO__ || { version: 1, sessions: {}, users: [], ads: [], chats: [], messages: [], favorites: [], deals: [], reviews: [] }));
  seed.meta = { seeded: true };
  seed.users.forEach(u => { if (!u.password) u.password = hashPass('demo1234'); });
  return seed;
}

// Данные жили в localStorage, но там всего ~5 МБ: несколько фото — и сохранение
// молча падало (объявление «исчезало» после перезагрузки). Переходим на IndexedDB:
// она вмещает сотни мегабайт и не блокирует интерфейс.
const IDB_NAME = 'kopeikino';
const IDB_STORE = 'state';
const IDB_KEY = 'data';
let memData = null;      // рабочая копия в памяти (синхронное чтение)
let idb = null;          // открытая база
let idbFailedAt = 0;     // когда IndexedDB отказала (чтобы не ждать её на каждой операции)
let persistChain = Promise.resolve();
let lastPersistError = null;

// Если хранилище недоступно, повторяем попытку не чаще раза в 30 секунд:
// иначе каждая операция снова ждала бы таймаут, и страница «висела» бы на скелетоне.
const IDB_RETRY_MS = 30000;

function openIdb() {
  if (idb) return Promise.resolve(idb);
  if (idbFailedAt && Date.now() - idbFailedAt < IDB_RETRY_MS) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (db) => {
      if (done) return; done = true;
      if (!db) idbFailedAt = Date.now();
      resolve(db);
    };
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return finish(null); }
    if (!req) return finish(null);
    // Страховка: в части браузеров (жёсткая приватность, встроенные браузеры мессенджеров,
    // webview) запрос может вообще не ответить — без таймаута страница осталась бы пустой.
    setTimeout(() => finish(null), 1500);
    req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch (e) {} };
    req.onsuccess = () => { idb = req.result; idbFailedAt = 0; finish(idb); };
    req.onerror = () => finish(null);
    req.onblocked = () => finish(null);
  });
}

function idbGet() {
  return openIdb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY);
        tx.onsuccess = () => resolve(tx.result || null);
        tx.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  });
}

function idbPut(value) {
  return openIdb().then((db) => {
    if (!db) throw new Error('no-idb');
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, IDB_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error || new Error('save-failed'));
        tx.onabort = () => reject(tx.error || new Error('save-aborted'));
      } catch (e) { reject(e); }
    });
  });
}

// Синхронное чтение всегда из памяти; память наполняется при старте (initStore)
function readData() {
  if (!memData) memData = seedData();
  return memData;
}

// Сколько примерно свободно в хранилище (если браузер умеет рассказать)
async function storageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    }
  } catch (e) {}
  return { usage: 0, quota: 0 };
}

// Сохранение: пишем в память сразу, на диск — по цепочке (чтобы не гонялись записи).
// Возвращаем промис с ошибкой записи (если она случится), но не «залипаем» ею для чтения.
let pendingSnapshot = null;   // что уже отправлено на запись

function writeData(d, force) {
  memData = d;
  const snapshot = JSON.stringify(d);
  // Одинаковые снимки подряд второй раз не пишем: частые GET-чтения (просмотры,
  // прочитанность) не должны гонять мегабайты в IndexedDB на каждый переход.
  if (!force && snapshot === pendingSnapshot) return persistChain;
  pendingSnapshot = snapshot;
  const task = persistChain.then(() => idbPut(snapshot)).then(
    () => { return true; },
    (err) => { pendingSnapshot = null; console.error('Не удалось сохранить данные:', err); throw err; }
  );
  persistChain = task.catch(() => {}); // цепочка продолжается даже после ошибки
  return task;
}

// Ждём, пока все записи доедут до IndexedDB (нужно перед перезагрузкой)
function flushData() { return persistChain.catch(() => {}); }

async function initStore() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  const stored = await idbGet();
  if (stored) {
    try { memData = JSON.parse(stored); } catch (e) { memData = seedData(); }
  } else {
    // миграция со старой версии на localStorage (если там что-то есть)
    let legacy = null;
    try { legacy = localStorage.getItem('kopeikino:data:v1'); } catch (e) {}
    if (legacy) {
      try { memData = JSON.parse(legacy); } catch (e) { memData = seedData(); }
      try { localStorage.removeItem('kopeikino:data:v1'); } catch (e) {}
    } else {
      memData = seedData();
    }
    writeData(memData, true);
  }
  return memData;
}

function getSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
function setSession(id) { try { localStorage.setItem(SESSION_KEY, id || ''); } catch (e) {} }

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  if (digits.length === 10) return '+7' + digits;
  return null;
}

/* ---------- формат ответов: 1:1 с сервером ---------- */
const repo = {
  nextId(prefix) { return prefix + Math.random().toString(36).slice(2, 10); },

  me(d) {
    const sid = getSession();
    const u = d.users.find(x => x.id === sid) || null;
    if (!u) return { user: null };
    return {
      user: publicUser(u),
      counts: {
        ads: d.ads.filter(x => x.ownerId === u.id && x.status === 'active').length,
        chats: d.chats.filter(c => c.buyerId === u.id || c.sellerId === u.id).length,
        favorites: d.favorites.filter(f => f.userId === u.id).length,
        deals: d.deals.filter(x => (x.fromId === u.id || x.toId === u.id) && !['done', 'canceled', 'declined'].includes(x.status)).length,
      },
    };
  },

  login(d, body) {
    const phone = normalizePhone(body.phone);
    const u = d.users.find(x => x.phone === phone);
    if (!u || u.password !== hashPass(body.password)) { const e = new Error('Неверный телефон или пароль'); e.status = 401; throw e; }
    setSession(u.id);
    return { user: publicUser(u) };
  },

  register(d, body) {
    const name = String(body.name || '').trim();
    const phone = normalizePhone(body.phone);
    const password = String(body.password || '');
    if (name.length < 2) { const e = new Error('Укажите имя'); e.status = 400; throw e; }
    if (!phone) { const e = new Error('Телефон в формате +7 999 000-00-00'); e.status = 400; throw e; }
    if (password.length < 6) { const e = new Error('Пароль не короче 6 символов'); e.status = 400; throw e; }
    if (d.users.some(u => u.phone === phone)) { const e = new Error('Такой номер уже зарегистрирован'); e.status = 409; throw e; }
    const u = { id: this.nextId('u_'), name, phone, password: hashPass(password), city: String(body.city || 'Москва'),
      about: '', avatar: null, ratingSum: 0, ratingCount: 0, createdAt: Date.now(), verified: false };
    d.users.push(u);
    setSession(u.id);
    return { user: publicUser(u) };
  },

  logout() { setSession(''); return { ok: true }; },

  patchMe(d, body) {
    const sid = getSession();
    const u = d.users.find(x => x.id === sid);
    if (!u) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    if (body.name != null) { if (String(body.name).trim().length < 2) { const e = new Error('Слишком короткое имя'); e.status = 400; throw e; } u.name = String(body.name).trim(); }
    if (body.city != null) u.city = String(body.city).slice(0, 80);
    if (body.about != null) u.about = String(body.about).slice(0, 500);
    if (body.phone != null) {
      const phone = normalizePhone(body.phone);
      if (!phone) { const e = new Error('Некорректный телефон'); e.status = 400; throw e; }
      if (d.users.some(x => x.phone === phone && x.id !== u.id)) { const e = new Error('Телефон занят'); e.status = 409; throw e; }
      u.phone = phone;
    }
    return { user: publicUser(u) };
  },

  searchAds(d, params) {
    const q = (params.q || '').trim().toLowerCase();
    const category = params.category || '';
    const city = params.city || '';
    const min = Number(params.min || 0);
    const max = Number(params.max || 0);
    const sort = params.sort || 'new';
    const onlyMine = params.owner === 'me';
    const deal = params.deal || '';
    const limit = Math.min(Number(params.limit || 24), 60);
    const offset = Number(params.offset || 0);
    const sid = getSession();
    let list = d.ads.filter(a => a.status !== 'deleted');
    if (onlyMine) list = list.filter(a => a.ownerId === sid);
    else list = list.filter(a => a.status === 'active');
    if (category) list = list.filter(a => a.category === category);
    if (city) list = list.filter(a => a.city.toLowerCase() === city.toLowerCase());
    if (min) list = list.filter(a => a.price >= min);
    if (max) list = list.filter(a => a.price <= max);
    if (deal === 'delivery') list = list.filter(a => a.deals && a.deals.delivery);
    if (deal === 'transfer') list = list.filter(a => a.deals && a.deals.transfer);
    if (deal === 'meeting') list = list.filter(a => a.deals && a.deals.meeting);
    if (q) list = list.filter(a => (a.title + ' ' + a.description + ' ' + a.city + ' ' + a.category).toLowerCase().includes(q));
    const sorted = list.slice().sort((a, b) => {
      if (sort === 'price-asc') return a.price - b.price;
      if (sort === 'price-desc') return b.price - a.price;
      if (sort === 'views') return (b.views || 0) - (a.views || 0);
      return b.createdAt - a.createdAt;
    });
    return {
      total: sorted.length,
      items: sorted.slice(offset, offset + limit).map(a => adView(d, a)),
      categories: CATEGORIES,
      cities: [...new Set(d.ads.filter(a => a.status === 'active').map(a => a.city))].sort(),
    };
  },

  getAd(d, id) {
    const ad = d.ads.find(x => x.id === id);
    if (!ad || ad.status === 'deleted') { const e = new Error('Объявление не найдено'); e.status = 404; throw e; }
    ad.views = (ad.views || 0) + 1;
    const similar = d.ads.filter(x => x.id !== ad.id && x.status === 'active' && x.category === ad.category)
      .sort((x, y) => Math.abs(x.price - ad.price) - Math.abs(y.price - ad.price)).slice(0, 4)
      .map(x => adView(d, x));
    return { ad: adView(d, ad), similar };
  },

  createAd(d, body) {
    const sid = getSession();
    const u = d.users.find(x => x.id === sid);
    if (!u) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const title = String(body.title || '').trim();
    if (title.length < 5) { const e = new Error('Заголовок не короче 5 символов'); e.status = 400; throw e; }
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price < 0) { const e = new Error('Укажите цену числом'); e.status = 400; throw e; }
    if (!CATEGORIES.includes(body.category)) { const e = new Error('Выберите категорию'); e.status = 400; throw e; }
    const ad = {
      id: this.nextId('a_'), ownerId: u.id, title: title.slice(0, 120),
      description: String(body.description || '').slice(0, 5000), price, category: body.category,
      condition: String(body.condition || 'Хорошее').slice(0, 40),
      city: String(body.city || u.city || 'Москва').slice(0, 80), metro: String(body.metro || '').slice(0, 80),
      photos: (body.photos || []).slice(0, 8), deals: {
        meeting: body.deals ? !!body.deals.meeting : true,
        delivery: body.deals ? !!body.deals.delivery : false,
        transfer: body.deals ? !!body.deals.transfer : false,
      },
      status: 'active', views: 0, createdAt: Date.now(), updatedAt: Date.now(),
    };
    d.ads.push(ad);
    return { ad: adView(d, ad) };
  },

  patchAd(d, id, body) {
    const sid = getSession();
    const ad = d.ads.find(x => x.id === id);
    if (!ad) { const e = new Error('Объявление не найдено'); e.status = 404; throw e; }
    if (ad.ownerId !== sid) { const e = new Error('Это не ваше объявление'); e.status = 403; throw e; }
    if (body.title != null) ad.title = String(body.title).slice(0, 120);
    if (body.description != null) ad.description = String(body.description).slice(0, 5000);
    if (body.price != null) ad.price = Math.round(Number(body.price));
    if (body.category != null && CATEGORIES.includes(body.category)) ad.category = body.category;
    if (body.city != null) ad.city = String(body.city).slice(0, 80);
    if (body.metro != null) ad.metro = String(body.metro).slice(0, 80);
    if (body.condition != null) ad.condition = String(body.condition).slice(0, 40);
    if (body.status === 'archived' || body.status === 'active') ad.status = body.status;
    if (Array.isArray(body.photos)) ad.photos = body.photos.slice(0, 8);
    if (body.deals) ad.deals = { meeting: !!body.deals.meeting, delivery: !!body.deals.delivery, transfer: !!body.deals.transfer };
    ad.updatedAt = Date.now();
    return { ad: adView(d, ad) };
  },

  deleteAd(d, id) {
    const sid = getSession();
    const ad = d.ads.find(x => x.id === id);
    if (!ad) { const e = new Error('Объявление не найдено'); e.status = 404; throw e; }
    if (ad.ownerId !== sid) { const e = new Error('Это не ваше объявление'); e.status = 403; throw e; }
    ad.status = 'deleted'; ad.updatedAt = Date.now();
    return { ok: true };
  },

  toggleFavorite(d, adId) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const i = d.favorites.findIndex(f => f.userId === sid && f.adId === adId);
    if (i >= 0) { d.favorites.splice(i, 1); return { favorite: false }; }
    d.favorites.push({ userId: sid, adId, createdAt: Date.now() });
    return { favorite: true };
  },

  favorites(d) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const items = d.favorites.filter(f => f.userId === sid).sort((a, b) => b.createdAt - a.createdAt)
      .map(f => d.ads.find(a => a.id === f.adId)).filter(a => a && a.status !== 'deleted').map(a => adView(d, a));
    return { items };
  },

  chats(d) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const items = d.chats.filter(c => c.buyerId === sid || c.sellerId === sid)
      .map(c => chatView(d, c, sid)).sort((a, b) => b.updatedAt - a.updatedAt);
    return { items, unreadTotal: items.reduce((s, c) => s + c.unread, 0) };
  },

  createChat(d, body) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const ad = d.ads.find(x => x.id === body.adId);
    if (!ad) { const e = new Error('Объявление не найдено'); e.status = 404; throw e; }
    if (ad.ownerId === sid) { const e = new Error('Это ваше объявление — вам напишут покупатели'); e.status = 400; throw e; }
    let chat = d.chats.find(c => c.adId === ad.id && c.buyerId === sid);
    if (!chat) { chat = { id: this.nextId('c_'), adId: ad.id, buyerId: sid, sellerId: ad.ownerId, createdAt: Date.now(), updatedAt: Date.now() }; d.chats.push(chat); }
    if (body.text) {
      d.messages.push({ id: this.nextId('m_'), chatId: chat.id, fromId: sid, text: String(body.text).slice(0, 4000), kind: 'text', createdAt: Date.now(), readBy: [sid] });
      chat.updatedAt = Date.now();
    }
    return { chat: chatView(d, chat, sid) };
  },

  chatMessages(d, chatId) {
    const sid = getSession();
    const chat = d.chats.find(c => c.id === chatId);
    if (!chat || (chat.buyerId !== sid && chat.sellerId !== sid)) { const e = new Error('Чат не найден'); e.status = 404; throw e; }
    const msgs = d.messages.filter(m => m.chatId === chat.id);
    msgs.forEach(m => { m.readBy = m.readBy || []; if (!m.readBy.includes(sid)) m.readBy.push(sid); });
    const peerId = chat.buyerId === sid ? chat.sellerId : chat.buyerId;
    return {
      chat: chatView(d, chat, sid),
      messages: msgs.map(m => ({ id: m.id, fromId: m.fromId, text: m.text, kind: m.kind, dealId: m.dealId || null, createdAt: m.createdAt, mine: m.fromId === sid })),
      deals: d.deals.filter(x => x.chatId === chat.id).map(x => dealView(d, x, sid)),
      peer: publicUser(d.users.find(u => u.id === peerId)),
    };
  },

  sendMessage(d, chatId, body) {
    const sid = getSession();
    const chat = d.chats.find(c => c.id === chatId);
    if (!chat || (chat.buyerId !== sid && chat.sellerId !== sid)) { const e = new Error('Чат не найден'); e.status = 404; throw e; }
    const text = String(body.text || '').trim();
    if (!text) { const e = new Error('Пустое сообщение'); e.status = 400; throw e; }
    const m = { id: this.nextId('m_'), chatId: chat.id, fromId: sid, text: text.slice(0, 2000), kind: 'text', createdAt: Date.now(), readBy: [sid] };
    d.messages.push(m); chat.updatedAt = m.createdAt;
    return { message: { id: m.id, fromId: m.fromId, text: m.text, kind: m.kind, createdAt: m.createdAt, mine: true } };
  },

  createDeal(d, chatId, body) {
    const sid = getSession();
    const chat = d.chats.find(c => c.id === chatId);
    if (!chat || (chat.buyerId !== sid && chat.sellerId !== sid)) { const e = new Error('Чат не найден'); e.status = 404; throw e; }
    if (!DEAL_TYPES[body.type]) { const e = new Error('Выберите способ сделки'); e.status = 400; throw e; }
    const ad = d.ads.find(x => x.id === chat.adId);
    const price = body.price != null && body.price !== '' ? Math.round(Number(body.price)) : (ad ? ad.price : null);
    const when = body.when ? Number(body.when) : null;
    const deal = { id: this.nextId('d_'), adId: chat.adId, chatId: chat.id, fromId: sid,
      toId: chat.buyerId === sid ? chat.sellerId : chat.buyerId, type: body.type,
      place: String(body.place || '').slice(0, 200), when: Number.isFinite(when) ? when : null,
      price: Number.isFinite(price) ? price : null, comment: String(body.comment || '').slice(0, 1000),
      status: 'proposed', createdAt: Date.now(), updatedAt: Date.now() };
    d.deals.push(deal);
    const label = DEAL_TYPES[deal.type];
    const text = label + ': ' + (deal.place || 'место уточним в чате') + (deal.when ? ', ' + new Date(deal.when).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');
    d.messages.push({ id: this.nextId('m_'), chatId: chat.id, fromId: sid, text, kind: 'deal', dealId: deal.id, createdAt: Date.now(), readBy: [sid] });
    chat.updatedAt = Date.now();
    return { deal: dealView(d, deal, sid) };
  },

  deals(d) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    return { items: d.deals.filter(x => x.fromId === sid || x.toId === sid).sort((a, b) => b.updatedAt - a.updatedAt).map(x => dealView(d, x, sid)) };
  },

  dealStatus(d, dealId, body) {
    const sid = getSession();
    const deal = d.deals.find(x => x.id === dealId);
    if (!deal) { const e = new Error('Сделка не найдена'); e.status = 404; throw e; }
    if (deal.fromId !== sid && deal.toId !== sid) { const e = new Error('Нет доступа'); e.status = 403; throw e; }
    const next = body.status;
    if (!['confirmed', 'declined', 'done', 'canceled'].includes(next)) { const e = new Error('Недопустимый статус'); e.status = 400; throw e; }
    if (next === 'confirmed' && deal.toId !== sid) { const e = new Error('Подтвердить может только получатель предложения'); e.status = 403; throw e; }
    deal.status = next; deal.updatedAt = Date.now();
    if (next === 'done') {
      const ad = d.ads.find(x => x.id === deal.adId);
      if (ad && (ad.ownerId === deal.fromId || ad.ownerId === deal.toId)) { ad.status = 'sold'; ad.updatedAt = Date.now(); }
    }
    const chat = d.chats.find(c => c.id === deal.chatId);
    if (chat) {
      d.messages.push({ id: this.nextId('m_'), chatId: chat.id, fromId: sid, text: 'Сделка ' + DEAL_STATUS[next].toLowerCase(), kind: 'deal', dealId: deal.id, createdAt: Date.now(), readBy: [sid] });
      chat.updatedAt = Date.now();
    }
    return { deal: dealView(d, deal, sid) };
  },

  user(d, id) {
    const u = d.users.find(x => x.id === id);
    if (!u) { const e = new Error('Пользователь не найден'); e.status = 404; throw e; }
    const sid = getSession();
    return {
      user: publicUser(u),
      ads: d.ads.filter(x => x.ownerId === u.id && x.status === 'active').map(x => adView(d, x)),
      reviewsList: d.reviews.filter(r => r.toId === u.id).slice(-20).reverse().map(r => Object.assign({}, r, { author: publicUser(d.users.find(x => x.id === r.fromId)) })),
    };
  },

  review(d, body) {
    const sid = getSession();
    if (!sid) { const e = new Error('Нужно войти в аккаунт'); e.status = 401; throw e; }
    const target = d.users.find(u => u.id === body.toId);
    if (!target) { const e = new Error('Пользователь не найден'); e.status = 404; throw e; }
    if (target.id === sid) { const e = new Error('Себя оценивать не нужно :)'); e.status = 400; throw e; }
    const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
    const review = { id: this.nextId('r_'), fromId: sid, toId: target.id, rating, text: String(body.text || '').slice(0, 800), createdAt: Date.now() };
    d.reviews.push(review);
    target.ratingSum = (target.ratingSum || 0) + rating;
    target.ratingCount = (target.ratingCount || 0) + 1;
    return { review };
  },
};

// Фото должны быть абсолютными: адрес страницы меняется (pushState), а <img src="seed/...">
// после этого резолвится не туда. Подставляем базу публикации.
function photoUrl(p) {
  if (typeof p !== 'string' || !p) return p;
  if (/^(data:|https?:|\/\/|\/)/.test(p)) return p;
  return (window.__BASE_PATH__ || '') + '/' + p.replace(/^\.?\//, '');
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, phone: u.phone, city: u.city, about: u.about, avatar: u.avatar,
    createdAt: u.createdAt, verified: u.verified,
    rating: u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null, reviews: u.ratingCount };
}
function adView(d, ad) {
  const sid = getSession();
  const owner = d.users.find(u => u.id === ad.ownerId);
  return { id: ad.id, title: ad.title, description: ad.description, price: ad.price, category: ad.category,
    condition: ad.condition, city: ad.city, metro: ad.metro, photos: (ad.photos || []).map(photoUrl), deals: ad.deals,
    status: ad.status, views: ad.views || 0, createdAt: ad.createdAt, updatedAt: ad.updatedAt,
    ownerId: ad.ownerId, isMine: !!sid && sid === ad.ownerId,
    favorite: !!sid && d.favorites.some(f => f.userId === sid && f.adId === ad.id), owner: publicUser(owner) };
}
function chatView(d, chat, sid) {
  const ad = d.ads.find(a => a.id === chat.adId);
  const peerId = chat.buyerId === sid ? chat.sellerId : chat.buyerId;
  const peer = d.users.find(u => u.id === peerId);
  const msgs = d.messages.filter(m => m.chatId === chat.id);
  const last = msgs[msgs.length - 1] || null;
  const unread = msgs.filter(m => m.fromId !== sid && !(m.readBy || []).includes(sid)).length;
  return { id: chat.id, adId: chat.adId,
    ad: ad ? { id: ad.id, title: ad.title, price: ad.price, photos: (ad.photos || []).slice(0, 1).map(photoUrl), status: ad.status } : null,
    peer: publicUser(peer), role: chat.sellerId === sid ? 'seller' : 'buyer',
    lastMessage: last ? { text: last.text, kind: last.kind, createdAt: last.createdAt, mine: last.fromId === sid } : null,
    unread, updatedAt: last ? last.createdAt : chat.createdAt };
}
function dealView(d, deal, sid) {
  const ad = d.ads.find(a => a.id === deal.adId);
  const other = deal.fromId === sid ? deal.toId : deal.fromId;
  return { id: deal.id, adId: deal.adId,
    ad: ad ? { id: ad.id, title: ad.title, price: ad.price, photos: (ad.photos || []).slice(0, 1).map(photoUrl) } : null,
    chatId: deal.chatId, type: deal.type, typeLabel: DEAL_TYPES[deal.type] || deal.type,
    place: deal.place, when: deal.when, price: deal.price, comment: deal.comment,
    status: deal.status, statusLabel: DEAL_STATUS[deal.status] || deal.status,
    mine: deal.fromId === sid, peer: publicUser(d.users.find(u => u.id === other)),
    createdAt: deal.createdAt, updatedAt: deal.updatedAt };
}

/* ---------- подмена window.API: те же вызовы, но локально ---------- */
const META = {
  categories: CATEGORIES,
  cities: ['Казань', 'Москва', 'Санкт-Петербург'],
  dealTypes: Object.entries(DEAL_TYPES).map(([value, label]) => ({ value, label })),
  dealStatuses: DEAL_STATUS,
  demo: { phone: '+79990000001', password: 'demo1234' },
  stats: {},
  static: true,
};

async function respondAsync(fn) {
  const d = readData();
  const backup = JSON.stringify(d);
  let result;
  try {
    result = fn(d);
  } catch (e) {
    try { Object.assign(d, JSON.parse(backup)); } catch (err) {}
    throw e;
  }
  // Сохраняем и ждём завершения записи: иначе объявление «создалось» и пропадёт после перезагрузки
  let saveError = null;
  try {
    await writeData(d);
  } catch (e) {
    saveError = e;
  }
  if (saveError) {
    try { Object.assign(d, JSON.parse(backup)); } catch (err) {}
    const hint = saveError && /quota/i.test(String(saveError.name || saveError.message))
      ? 'В браузере закончилось место — удалите лишние фотографии или объявления.'
      : 'Хранилище браузера недоступно (например, режим инкогнито). Данные не сохранены.';
    const err = new Error('Не удалось сохранить изменения. ' + hint);
    err.status = 507;
    throw err;
  }
  return result;
}

function respond(fn) { return respondAsync(fn); }

// Для GET: данные меняются (просмотры, прочитанность), но если запись не удалась —
// это не повод ломать чтение. Интерфейс должен работать даже в режиме инкогнито.
async function respondRead(fn) {
  const d = readData();
  const result = fn(d);
  // Если хранилище недоступно, писать некуда — отдаём данные сразу, без ожидания таймаутов.
  if (idbFailedAt && !idb) return result;
  try { await writeData(d); } catch (e) { console.warn('Данные показаны, но не сохранены:', e && e.message); }
  return result;
}

// До готовности IndexedDB API отвечает «загрузка» — интерфейс этого не увидит,
// потому что app.js ждёт window.__STORE_READY__ (см. app.js)
let storeReady = false;

window.API = {
  get(path, params) {
    try {
      if (path === '/api/meta') {
        return Promise.resolve(Object.assign({}, META, (() => {
          const d = readData();
          return { stats: { ads: d.ads.filter(a => a.status === 'active').length, users: d.users.length, chats: d.chats.length },
            cities: [...new Set(d.ads.filter(a => a.status === 'active').map(a => a.city))].sort() };
        })()));
      }
      if (path === '/api/me') return Promise.resolve(respondRead(d => repo.me(d)));
      if (path === '/api/ads') return Promise.resolve(respondRead(d => repo.searchAds(d, params || {})));
      if (path.startsWith('/api/ads/')) return Promise.resolve(respondRead(d => repo.getAd(d, decodeURIComponent(path.slice('/api/ads/'.length)))));
      if (path === '/api/favorites') return Promise.resolve(respondRead(d => repo.favorites(d)));
      if (path === '/api/chats') return Promise.resolve(respondRead(d => repo.chats(d)));
      if (path.startsWith('/api/chats/')) return Promise.resolve(respondRead(d => repo.chatMessages(d, decodeURIComponent(path.split('/')[3]))));
      if (path === '/api/deals') return Promise.resolve(respondRead(d => repo.deals(d)));
      if (path.startsWith('/api/users/')) return Promise.resolve(respondRead(d => repo.user(d, decodeURIComponent(path.slice('/api/users/'.length)))));
      return Promise.reject(new Error('Неизвестный запрос: ' + path));
    } catch (e) { return Promise.reject(e); }
  },
  post(path, body) {
    try {
      const b = body || {};
      // Всё, что меняет данные, идёт через respond(): успех — только после записи на диск.
      // respondRead оставлен только для чтения и для операций, которые ничего не меняют.
      // Сессия живёт в localStorage, логин/регистрацию/выход сохранять в IndexedDB нечего —
      // отвечаем сразу, иначе на переполненном хранилище нельзя было бы даже войти.
      if (path === '/api/auth/login') return Promise.resolve(repo.login(readData(), b));
      if (path === '/api/auth/register') return Promise.resolve(repo.register(readData(), b));
      if (path === '/api/auth/logout') return Promise.resolve(repo.logout());
      if (path === '/api/ads') return Promise.resolve(respond(d => repo.createAd(d, b)));
      const fav = /^\/api\/ads\/([^/]+)\/favorite$/.exec(path);
      if (fav) return Promise.resolve(respond(d => repo.toggleFavorite(d, decodeURIComponent(fav[1]))));
      if (path === '/api/chats') return Promise.resolve(respond(d => repo.createChat(d, b)));
      const msg = /^\/api\/chats\/([^/]+)\/messages$/.exec(path);
      if (msg) return Promise.resolve(respond(d => repo.sendMessage(d, decodeURIComponent(msg[1]), b)));
      const dl = /^\/api\/chats\/([^/]+)\/deals$/.exec(path);
      if (dl) return Promise.resolve(respond(d => repo.createDeal(d, decodeURIComponent(dl[1]), b)));
      const st = /^\/api\/deals\/([^/]+)\/status$/.exec(path);
      if (st) return Promise.resolve(respond(d => repo.dealStatus(d, decodeURIComponent(st[1]), b)));
      if (path === '/api/reviews') return Promise.resolve(respond(d => repo.review(d, b)));
      return Promise.reject(new Error('Неизвестный запрос: ' + path));
    } catch (e) { return Promise.reject(e); }
  },
  patch(path, body) {
    try {
      const b = body || {};
      if (path === '/api/me') return Promise.resolve(respond(d => repo.patchMe(d, b)));
      const ad = /^\/api\/ads\/([^/]+)$/.exec(path);
      if (ad) return Promise.resolve(respond(d => repo.patchAd(d, decodeURIComponent(ad[1]), b)));
      return Promise.reject(new Error('Неизвестный запрос: ' + path));
    } catch (e) { return Promise.reject(e); }
  },
  del(path) {
    try {
      const ad = /^\/api\/ads\/([^/]+)$/.exec(path);
      if (ad) return Promise.resolve(respond(d => repo.deleteAd(d, decodeURIComponent(ad[1]))));
      return Promise.reject(new Error('Неизвестный запрос: ' + path));
    } catch (e) { return Promise.reject(e); }
  },
};

// EventSource в статике не нужен — мягкая заглушка, чтобы app.js не падал
if (typeof window.EventSource === 'function') {
  const Native = window.EventSource;
  window.EventSource = function (url) {
    if (String(url).indexOf('/api/events') === -1) return new Native(url);
    const listeners = {};
    return { addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, close() {}, onerror: null };
  };
}
'''

PAGE_HEAD = '''<!DOCTYPE html>
<html lang="ru" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="theme-color" content="#ffffff"/>
<title>Копейкино — доска объявлений: купить, продать, договориться</title>
<meta name="description" content="Копейкино — доска объявлений. Размещайте товары, переписывайтесь с покупателями, договаривайтесь о встрече, доставке или перевозке."/>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' fill='%2316a34a'/%3E%3Ctext x='50' y='70' font-size='58' font-weight='bold' text-anchor='middle' fill='%23fff'%3E%D0%9A%3C/text%3E%3C/svg%3E"/>
<style>
'''

BASE_SCRIPT = '''<script>
(function () {
  // GitHub Pages публикует проект в подкаталог /<repo>/: запоминаем базу путей.
  var path = location.pathname || '/';
  // /kopeka/  |  /kopeka/index.html  |  /kopeka/auth.html  ->  '/kopeka';  корень домена -> ''
  var seg = path.split('/').filter(Boolean);
  if (path.charAt(path.length - 1) !== '/' && /\.[a-z0-9]+$/i.test(path)) seg.pop(); // отрезаем файл
  if (seg.length > 1) seg = seg.slice(0, seg.length - 1); // остаётся только первый сегмент (база)
  var base = seg.length ? '/' + seg[0] : '';
  if (base === '/' || base === '/index.html') base = '';
  window.__BASE_PATH__ = base;
  document.addEventListener('DOMContentLoaded', function () {
    var b = window.__BASE_PATH__;
    if (!b) return;
    document.querySelectorAll('a[href^="/"]').forEach(function (a) {
      // префикс ставим всем ссылкам (важно для Ctrl+клика и «открыть в новой вкладке»),
      // а при обычном клике роутер снимает его сам — двойного префикса не будет
      var href = a.getAttribute('href');
      if (href.indexOf('//') === 0) return;
      if (href.indexOf(b + '/') === 0) return;
      a.setAttribute('href', b + href);
    });
  });
})();
</script>'''

BANNER = '''
<div id="static-notice" style="background:var(--primary-soft);border-bottom:1px solid var(--border);font-size:13.5px">
  <div class="container" style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 20px;flex-wrap:wrap">
    <span>Демо на GitHub Pages: данные (объявления, чат, сделки) хранятся <b>в вашем браузере</b>. Версия с общим сервером — в репозитории, <code>npm start</code>.</span>
    <button class="btn btn-sm" id="reset-demo">Сбросить демо</button>
  </div>
</div>
'''


def build():
    css = (ROOT / 'public' / 'css' / 'app.css').read_text(encoding='utf-8')
    index_html = (ROOT / 'public' / 'index.html').read_text(encoding='utf-8')
    ui = (ROOT / 'public' / 'js' / 'ui.js').read_text(encoding='utf-8')
    views = (ROOT / 'public' / 'js' / 'views.js').read_text(encoding='utf-8')
    app = (ROOT / 'public' / 'js' / 'app.js').read_text(encoding='utf-8')

    # демо-данные: исполняем seed.js в Node и сохраняем результат как JS-литерал
    seed_js_path = ROOT / 'server' / 'seed.js'
    node_script = r'''
const path = require('path');
const fs = require('fs');
const Module = require('module');
const dbModulePath = path.join(process.argv[2], 'server', 'db.js');
const seedPath = path.join(process.argv[2], 'server', 'seed.js');
const { load } = require(dbModulePath);
load();
const { seed } = require(seedPath);
seed(true);
const raw = fs.readFileSync(path.join(process.argv[2], 'data', 'db.json'), 'utf8');
process.stdout.write(raw);
'''
    tmp = ROOT / '.build_seed.js'
    tmp.write_text(node_script, encoding='utf-8')
    try:
        raw = subprocess.run(['node', str(tmp), str(ROOT)], capture_output=True, check=True, text=True).stdout
    finally:
        tmp.unlink(missing_ok=True)
    seed_db = json.loads(raw)
    # в статике фото лежат рядом со страницей: /seed/... -> seed/...
    for ad in seed_db.get('ads', []):
        ad['photos'] = [p[1:] if isinstance(p, str) and p.startswith('/seed/') else p for p in ad.get('photos', [])]
    for u in seed_db.get('users', []):
        u['password'] = None  # пароль демо-аккаунтов задаётся в браузере через hashPass('demo1234')
    demo = json.dumps({k: seed_db[k] for k in ('users', 'ads', 'chats', 'messages', 'favorites', 'deals', 'reviews')}, ensure_ascii=False)

    # html без внешних <link>/<script>
    body = index_html
    body = re.sub(r'<link rel="stylesheet" href="/css/app\.css"/>\s*', BASE_SCRIPT, body)
    body = re.sub(r'<script src="/js/[a-z]+\.js"></script>\s*', '', body)
    # вставляем баннер сразу после <body>
    body = body.replace('<body>\n', '<body>\n' + BANNER, 1)
    # меняем title (уже правильный) и убираем дубли meta, если появятся
    body = body.replace('</body>', f'''
<script>
window.__KOPEIKINO_DEMO__ = {demo};
</script>
<script>
(function () {{
  const CATEGORIES = {json.dumps(['Электроника','Транспорт','Недвижимость','Для дома и дачи','Личные вещи','Хобби и отдых','Детские товары','Работа','Услуги','Животные'], ensure_ascii=False)};
  const DEAL_TYPES = {{ meet: 'Личная встреча', delivery: 'Доставка', transfer: 'Перевозка' }};
  const DEAL_STATUS = {{ proposed: 'Предложена', confirmed: 'Подтверждена', declined: 'Отклонена', done: 'Завершена', canceled: 'Отменена' }};
  {STORE}
  window.__STORE_READY__ = initStore().catch((e) => {{ console.error('Хранилище', e); return null; }});
  const btn = document.getElementById('reset-demo');
  if (btn) btn.onclick = async () => {{
    if (!confirm('Вернуть демо-объявления, чат и сделки? Ваши локальные изменения пропадут.')) return;
    try {{ localStorage.removeItem('kopeikino:data:v1'); localStorage.removeItem('kopeikino:session:v1'); }} catch (e) {{}}
    try {{
      if (window.indexedDB) {{
        // открытую базу нужно закрыть, иначе удаление повиснет в состоянии blocked
        try {{ if (idb && idb.close) idb.close(); }} catch (e) {{}}
        idb = null; idbFailedAt = 0; memData = null; persistChain = Promise.resolve(); pendingSnapshot = null;
        const del = indexedDB.deleteDatabase('kopeikino');
        await new Promise((resolve) => {{ del.onsuccess = del.onerror = del.onblocked = resolve; setTimeout(resolve, 1500); }});
      }}
    }} catch (e) {{}}
    location.reload();
  }};
}})();
</script>
<script>
{ui}
</script>
<script>
{views}
</script>
<script>
{app}
</script>
</body>''')

    OUT_DIR.mkdir(exist_ok=True)
    # фото демо-объявлений рядом со страницей
    seed_dir = ROOT / 'seed'          # рядом с корневым index.html (Pages: main /)
    seed_dir.mkdir(exist_ok=True)
    seed_dir.mkdir(exist_ok=True)
    for img in (ROOT / 'public' / 'seed').glob('*.jpg'):
        (seed_dir / img.name).write_bytes(img.read_bytes())

    # копия для артефакта workflow (pages/)
    art_seed = OUT_DIR / 'seed'
    art_seed.mkdir(exist_ok=True)
    for img in (ROOT / 'public' / 'seed').glob('*.jpg'):
        (art_seed / img.name).write_bytes(img.read_bytes())

    OUT.write_text(body, encoding='utf-8')
    (OUT_DIR / '.nojekyll').write_text('', encoding='utf-8')

    # GitHub Pages настроен как «deploy from branch: main /», поэтому тот же файл
    # нужен в корне репозитория: именно его отдаёт https://<user>.github.io/<repo>/
    (ROOT / 'index.html').write_text(body, encoding='utf-8')
    (ROOT / '.nojekyll').write_text('', encoding='utf-8')
    # Pages отдаёт 404.html на неизвестные пути — это спасает прямые ссылки /ad/<id>
    (ROOT / '404.html').write_text(body, encoding='utf-8')

    # Копии для «красивых» адресов: Pages отдаёт /kopeka/chats, если файл chats.html существует,
    # иначе сначала отдаёт 404.html — часть браузеров/встраивателей его не исполняет.
    for route in ('chats', 'deals', 'favorites', 'auth', 'new', 'my', 'me', 'ad', 'user', 'edit'):
        (ROOT / (route + '.html')).write_text(body, encoding='utf-8')
        (OUT_DIR / (route + '.html')).write_text(body, encoding='utf-8')

    # 404.html: при клиентской навигации не нужен, но спасает прямые ссылки вида /ad/xxx
    depth = body.count('/')
    fallback = body.replace('</head>', '<script>window.__DEEP_LINK__ = true;</script></head>')
    (OUT_DIR / '404.html').write_text(fallback, encoding='utf-8')
    print(f'Собрано: {OUT} ({OUT.stat().st_size / 1024:.0f} КБ) + photos in pages/seed/')


if __name__ == '__main__':
    build()
