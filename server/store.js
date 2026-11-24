'use strict';
/**
 * Общая логика: пользователи, сессии, объявления, чаты, сделки.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, save, id, now, UPLOAD_DIR } = require('./db');

const CATEGORIES = [
  'Электроника',
  'Транспорт',
  'Недвижимость',
  'Для дома и дачи',
  'Личные вещи',
  'Хобби и отдых',
  'Детские товары',
  'Работа',
  'Услуги',
  'Животные',
];

const DEAL_TYPES = {
  meet: 'Личная встреча',
  delivery: 'Доставка',
  transfer: 'Перевозка',
};

const DEAL_STATUS = {
  proposed: 'Предложена',
  confirmed: 'Подтверждена',
  declined: 'Отклонена',
  done: 'Завершена',
  canceled: 'Отменена',
};

/* ---------- пароли и сессии ---------- */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function login(user) {
  const token = crypto.randomBytes(24).toString('base64url');
  db().sessions[token] = { userId: user.id, createdAt: now() };
  save();
  return token;
}

function userByToken(token) {
  const s = db().sessions[token];
  if (!s) return null;
  return db().users.find(u => u.id === s.userId) || null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, phone: u.phone, city: u.city, about: u.about,
    avatar: u.avatar, createdAt: u.createdAt, verified: u.verified,
    rating: u.ratingCount ? Math.round((u.ratingSum / u.ratingCount) * 10) / 10 : null,
    reviews: u.ratingCount,
  };
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  if (digits.length === 10) return '+7' + digits;
  return null;
}

/* ---------- объявления ---------- */

function adView(ad, viewerId) {
  const d = db();
  const owner = d.users.find(u => u.id === ad.ownerId);
  const fav = viewerId ? d.favorites.some(f => f.userId === viewerId && f.adId === ad.id) : false;
  return {
    id: ad.id,
    title: ad.title,
    description: ad.description,
    price: ad.price,
    category: ad.category,
    condition: ad.condition,
    city: ad.city,
    metro: ad.metro,
    photos: ad.photos || [],
    deals: ad.deals,
    status: ad.status,
    views: ad.views || 0,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
    ownerId: ad.ownerId,
    isMine: !!viewerId && viewerId === ad.ownerId,
    favorite: fav,
    owner: publicUser(owner),
  };
}

function searchAds(params, viewerId) {
  const d = db();
  const q = (params.get('q') || '').trim().toLowerCase();
  const category = params.get('category') || '';
  const city = params.get('city') || '';
  const min = Number(params.get('min') || 0);
  const max = Number(params.get('max') || 0);
  const sort = params.get('sort') || 'new';
  const onlyMine = params.get('owner') === 'me';
  const ownerId = params.get('ownerId') || '';
  const deal = params.get('deal') || '';
  const limit = Math.min(Number(params.get('limit') || 24), 60);
  const offset = Number(params.get('offset') || 0);

  let list = d.ads.filter(a => a.status === 'active' || (onlyMine && viewerId && a.ownerId === viewerId && a.status !== 'deleted'));
  if (onlyMine && viewerId) list = d.ads.filter(a => a.ownerId === viewerId);
  if (ownerId) list = list.filter(a => a.ownerId === ownerId);
  if (category) list = list.filter(a => a.category === category);
  if (city) list = list.filter(a => a.city.toLowerCase() === city.toLowerCase());
  if (min) list = list.filter(a => a.price >= min);
  if (max) list = list.filter(a => a.price <= max);
  if (deal === 'delivery') list = list.filter(a => a.deals && a.deals.delivery);
  if (deal === 'transfer') list = list.filter(a => a.deals && a.deals.transfer);
  if (deal === 'meeting') list = list.filter(a => a.deals && a.deals.meeting);
  if (q) {
    list = list.filter(a => (a.title + ' ' + a.description + ' ' + a.city + ' ' + a.category).toLowerCase().includes(q));
  }
  const sorted = list.slice().sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'views') return (b.views || 0) - (a.views || 0);
    return b.createdAt - a.createdAt;
  });
  return {
    total: sorted.length,
    items: sorted.slice(offset, offset + limit).map(a => adView(a, viewerId)),
    categories: CATEGORIES,
    cities: [...new Set(d.ads.filter(a => a.status === 'active').map(a => a.city))].sort(),
  };
}

/* ---------- чаты ---------- */

function chatView(chat, viewerId) {
  const d = db();
  const ad = d.ads.find(a => a.id === chat.adId);
  const peerId = chat.buyerId === viewerId ? chat.sellerId : chat.buyerId;
  const peer = d.users.find(u => u.id === peerId);
  const msgs = d.messages.filter(m => m.chatId === chat.id);
  const last = msgs[msgs.length - 1] || null;
  const unread = msgs.filter(m => m.fromId !== viewerId && !(m.readBy || []).includes(viewerId)).length;
  return {
    id: chat.id,
    adId: chat.adId,
    ad: ad ? { id: ad.id, title: ad.title, price: ad.price, photos: (ad.photos || []).slice(0, 1), status: ad.status } : null,
    peer: publicUser(peer),
    role: chat.sellerId === viewerId ? 'seller' : 'buyer',
    lastMessage: last ? { text: last.text, kind: last.kind, createdAt: last.createdAt, mine: last.fromId === viewerId } : null,
    unread,
    updatedAt: last ? last.createdAt : chat.createdAt,
  };
}

function findOrCreateChat(ad, buyerId) {
  const d = db();
  let chat = d.chats.find(c => c.adId === ad.id && c.buyerId === buyerId);
  if (chat) return chat;
  chat = {
    id: id('c_'), adId: ad.id, buyerId, sellerId: ad.ownerId,
    createdAt: now(), updatedAt: now(),
  };
  d.chats.push(chat);
  save();
  return chat;
}

function dealView(deal, viewerId) {
  const d = db();
  const ad = d.ads.find(a => a.id === deal.adId);
  const other = deal.fromId === viewerId ? deal.toId : deal.fromId;
  return {
    id: deal.id,
    adId: deal.adId,
    ad: ad ? { id: ad.id, title: ad.title, price: ad.price, photos: (ad.photos || []).slice(0, 1) } : null,
    chatId: deal.chatId,
    type: deal.type,
    typeLabel: DEAL_TYPES[deal.type] || deal.type,
    place: deal.place,
    when: deal.when,
    price: deal.price,
    comment: deal.comment,
    status: deal.status,
    statusLabel: DEAL_STATUS[deal.status] || deal.status,
    mine: deal.fromId === viewerId,
    peer: publicUser(d.users.find(u => u.id === other)),
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
  };
}

/* ---------- картинки ---------- */

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

function saveDataUrl(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { error: 'Поддерживаются только изображения PNG, JPEG, WEBP или GIF' };
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > MAX_PHOTO_BYTES) return { error: 'Файл больше 4 МБ' };
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const name = crypto.randomBytes(10).toString('hex') + '.' + ext;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: '/uploads/' + name };
}

/**
 * Пути, которые уже существуют на сервере (загруженные фото или демо-картинки).
 * Принимаем и массив путей — клиент может прислать их пачкой.
 */
function existingPhotoPaths(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    if (typeof item !== 'string') return null;
    if (!item.startsWith('/') || item.startsWith('//')) return null;
    if (!item.startsWith('/uploads/') && !item.startsWith('/seed/')) return null;
    out.push(item);
  }
  return out.length ? out : null;
}

module.exports = {
  CATEGORIES, DEAL_TYPES, DEAL_STATUS,
  hashPassword, checkPassword, login, userByToken, publicUser, normalizePhone,
  adView, searchAds, chatView, findOrCreateChat, dealView, saveDataUrl, existingPhotoPaths,
};
