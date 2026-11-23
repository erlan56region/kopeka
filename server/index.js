'use strict';
/**
 * Копейкино — маркетплейс.
 * HTTP-сервер без внешних зависимостей: статика + JSON API + realtime через SSE.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { load, db, save, UPLOAD_DIR } = require('./db');
const { seed } = require('./seed');
const S = require('./store');

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

load();
seed(process.argv.includes('--force-seed'));

/* ---------------- helpers ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.removeAllListeners('data'); reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error('Некорректный JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const token = cookies(req).sid;
  return token ? S.userByToken(token) : null;
}

/* ---------------- realtime (SSE) ---------------- */

const streams = new Map(); // userId -> Set(res)

function publish(userIds, event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  userIds.filter(Boolean).forEach((uid) => {
    const set = streams.get(uid);
    if (!set) return;
    set.forEach((res) => {
      try { res.write(data); } catch (e) { set.delete(res); }
    });
  });
}

function openStream(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ userId: user.id, at: Date.now() })}\n\n`);
  if (!streams.has(user.id)) streams.set(user.id, new Set());
  streams.get(user.id).add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = streams.get(user.id);
    if (set) { set.delete(res); if (!set.size) streams.delete(user.id); }
  });
}

/* ---------------- статика ---------------- */

function serveFile(res, filePath, cacheSeconds = 0) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Не найдено'); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- API ---------------- */

async function api(req, res, pathname, query) {
  const method = req.method;
  const user = currentUser(req);
  const needUser = () => { if (!user) throw Object.assign(new Error('Нужно войти в аккаунт'), { status: 401 }); };
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const [, resource, a1, a2, a3] = parts;

  /* --- мета --- */
  if (resource === 'meta' && method === 'GET') {
    const d = db();
    return json(res, 200, {
      categories: S.CATEGORIES,
      cities: [...new Set(d.users.map(u => u.city).concat(d.ads.map(x => x.city)))].filter(Boolean).sort(),
      dealTypes: Object.entries(S.DEAL_TYPES).map(([value, label]) => ({ value, label })),
      dealStatuses: S.DEAL_STATUS,
      demo: { phone: '+79990000001', password: 'demo1234' },
      stats: {
        ads: d.ads.filter(x => x.status === 'active').length,
        users: d.users.length,
        chats: d.chats.length,
      },
    });
  }

  /* --- авторизация --- */
  if (resource === 'auth') {
    if (a1 === 'register' && method === 'POST') {
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      const phone = S.normalizePhone(b.phone);
      const password = String(b.password || '');
      if (name.length < 2) return json(res, 400, { error: 'Укажите имя' });
      if (!phone) return json(res, 400, { error: 'Телефон в формате +7 999 000-00-00' });
      if (password.length < 6) return json(res, 400, { error: 'Пароль не короче 6 символов' });
      const d = db();
      if (d.users.some(u => u.phone === phone)) return json(res, 409, { error: 'Такой номер уже зарегистрирован' });
      const u = {
        id: require('./db').id('u_'), name, phone,
        password: S.hashPassword(password),
        city: String(b.city || 'Москва'), about: '', avatar: null,
        ratingSum: 0, ratingCount: 0, createdAt: Date.now(), verified: false,
      };
      d.users.push(u);
      const token = S.login(u);
      save();
      res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
      return json(res, 201, { user: S.publicUser(u) });
    }
    if (a1 === 'login' && method === 'POST') {
      const b = await readBody(req);
      const phone = S.normalizePhone(b.phone);
      const d = db();
      const u = d.users.find(x => x.phone === phone);
      if (!u || !S.checkPassword(b.password, u.password)) return json(res, 401, { error: 'Неверный телефон или пароль' });
      const token = S.login(u);
      res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
      return json(res, 200, { user: S.publicUser(u) });
    }
    if (a1 === 'logout' && method === 'POST') {
      const token = cookies(req).sid;
      if (token) delete db().sessions[token];
      save();
      res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res, 200, { ok: true });
    }
  }

  /* --- профиль --- */
  if (resource === 'me') {
    if (method === 'GET') {
      if (!user) return json(res, 200, { user: null });
      const d = db();
      return json(res, 200, {
        user: S.publicUser(user),
        counts: {
          ads: d.ads.filter(x => x.ownerId === user.id && x.status === 'active').length,
          chats: d.chats.filter(c => c.buyerId === user.id || c.sellerId === user.id).length,
          favorites: d.favorites.filter(f => f.userId === user.id).length,
          deals: d.deals.filter(x => (x.fromId === user.id || x.toId === user.id) && !['done', 'canceled', 'declined'].includes(x.status)).length,
        },
      });
    }
    if (method === 'PATCH') {
      needUser();
      const b = await readBody(req);
      if (b.name != null) {
        const name = String(b.name).trim();
        if (name.length < 2) return json(res, 400, { error: 'Слишком короткое имя' });
        user.name = name;
      }
      if (b.city != null) user.city = String(b.city).slice(0, 80);
      if (b.about != null) user.about = String(b.about).slice(0, 500);
      if (b.phone != null) {
        const phone = S.normalizePhone(b.phone);
        if (!phone) return json(res, 400, { error: 'Некорректный телефон' });
        if (db().users.some(u => u.phone === phone && u.id !== user.id)) return json(res, 409, { error: 'Телефон занят' });
        user.phone = phone;
      }
      save();
      return json(res, 200, { user: S.publicUser(user) });
    }
  }

  /* --- пользователи --- */
  if (resource === 'users' && a1 && method === 'GET') {
    const u = db().users.find(x => x.id === a1);
    if (!u) return json(res, 404, { error: 'Пользователь не найден' });
    const ads = db().ads.filter(x => x.ownerId === u.id && x.status === 'active');
    return json(res, 200, {
      user: S.publicUser(u),
      ads: ads.map(x => S.adView(x, user && user.id)),
      reviewsList: db().reviews.filter(r => r.toId === u.id).slice(-20).reverse().map(r => ({
        ...r, author: S.publicUser(db().users.find(x => x.id === r.fromId)),
      })),
    });
  }

  /* --- объявления --- */
  if (resource === 'ads') {
    if (!a1 && method === 'GET') return json(res, 200, S.searchAds(query, user && user.id));

    if (!a1 && method === 'POST') {
      needUser();
      const b = await readBody(req);
      const title = String(b.title || '').trim();
      const price = Math.round(Number(b.price));
      if (title.length < 5) return json(res, 400, { error: 'Заголовок не короче 5 символов' });
      if (!Number.isFinite(price) || price < 0) return json(res, 400, { error: 'Укажите цену числом' });
      if (!S.CATEGORIES.includes(b.category)) return json(res, 400, { error: 'Выберите категорию' });
      const photos = [];
      for (const raw of (Array.isArray(b.photos) ? b.photos.slice(0, 8) : [])) {
        const paths = S.existingPhotoPaths(raw);
        if (paths) { photos.push(...paths); continue; }
        const saved = S.saveDataUrl(raw);
        if (saved.error) return json(res, 400, { error: saved.error });
        photos.push(saved.url);
      }
      const ad = {
        id: require('./db').id('a_'),
        ownerId: user.id,
        title: title.slice(0, 120),
        description: String(b.description || '').slice(0, 5000),
        price, category: b.category,
        condition: String(b.condition || 'Хорошее').slice(0, 40),
        city: String(b.city || user.city || 'Москва').slice(0, 80),
        metro: String(b.metro || '').slice(0, 80),
        photos,
        deals: {
          meeting: b.deals ? !!b.deals.meeting : true,
          delivery: b.deals ? !!b.deals.delivery : false,
          transfer: b.deals ? !!b.deals.transfer : false,
        },
        status: 'active', views: 0, createdAt: Date.now(), updatedAt: Date.now(),
      };
      db().ads.push(ad);
      save();
      return json(res, 201, { ad: S.adView(ad, user.id) });
    }

    if (a1 && !a2 && method === 'GET') {
      const ad = db().ads.find(x => x.id === a1);
      if (!ad || ad.status === 'deleted') return json(res, 404, { error: 'Объявление не найдено' });
      ad.views = (ad.views || 0) + 1;
      if (!user || user.id !== ad.ownerId) save();
      const d = db();
      const similar = d.ads
        .filter(x => x.id !== ad.id && x.status === 'active' && x.category === ad.category)
        .sort((x, y) => Math.abs(x.price - ad.price) - Math.abs(y.price - ad.price))
        .slice(0, 4)
        .map(x => S.adView(x, user && user.id));
      return json(res, 200, { ad: S.adView(ad, user && user.id), similar });
    }

    if (a1 && !a2 && method === 'PATCH') {
      needUser();
      const ad = db().ads.find(x => x.id === a1);
      if (!ad) return json(res, 404, { error: 'Объявление не найдено' });
      if (ad.ownerId !== user.id) return json(res, 403, { error: 'Это не ваше объявление' });
      const b = await readBody(req);
      if (b.title != null) ad.title = String(b.title).slice(0, 120);
      if (b.description != null) ad.description = String(b.description).slice(0, 5000);
      if (b.price != null) ad.price = Math.round(Number(b.price));
      if (b.category != null && S.CATEGORIES.includes(b.category)) ad.category = b.category;
      if (b.city != null) ad.city = String(b.city).slice(0, 80);
      if (b.metro != null) ad.metro = String(b.metro).slice(0, 80);
      if (b.condition != null) ad.condition = String(b.condition).slice(0, 40);
      if (b.status === 'archived' || b.status === 'active') ad.status = b.status;
      if (Array.isArray(b.photos)) {
        ad.photos = b.photos.slice(0, 8).flatMap((raw) => {
          const paths = S.existingPhotoPaths(raw);
          if (paths) return paths;
          const saved = S.saveDataUrl(raw);
          return saved.url ? [saved.url] : [];
        });
      }
      if (b.deals) ad.deals = { meeting: !!b.deals.meeting, delivery: !!b.deals.delivery, transfer: !!b.deals.transfer };
      ad.updatedAt = Date.now();
      save();
      return json(res, 200, { ad: S.adView(ad, user.id) });
    }

    if (a1 && !a2 && method === 'DELETE') {
      needUser();
      const ad = db().ads.find(x => x.id === a1);
      if (!ad) return json(res, 404, { error: 'Объявление не найдено' });
      if (ad.ownerId !== user.id) return json(res, 403, { error: 'Это не ваше объявление' });
      ad.status = 'deleted';
      ad.updatedAt = Date.now();
      save();
      return json(res, 200, { ok: true });
    }

    if (a1 && a2 === 'favorite' && method === 'POST') {
      needUser();
      const d = db();
      const ad = d.ads.find(x => x.id === a1);
      if (!ad) return json(res, 404, { error: 'Объявление не найдено' });
      const idx = d.favorites.findIndex(f => f.userId === user.id && f.adId === a1);
      if (idx >= 0) d.favorites.splice(idx, 1); else d.favorites.push({ userId: user.id, adId: a1, createdAt: Date.now() });
      save();
      return json(res, 200, { favorite: idx < 0 });
    }
  }

  /* --- избранное --- */
  if (resource === 'favorites' && method === 'GET') {
    needUser();
    const d = db();
    const items = d.favorites
      .filter(f => f.userId === user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(f => d.ads.find(a => a.id === f.adId))
      .filter(a => a && a.status !== 'deleted')
      .map(a => S.adView(a, user.id));
    return json(res, 200, { items });
  }

  /* --- чаты и сообщения --- */
  if (resource === 'chats') {
    if (!a1 && method === 'GET') {
      needUser();
      const d = db();
      const items = d.chats
        .filter(c => c.buyerId === user.id || c.sellerId === user.id)
        .map(c => S.chatView(c, user.id))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return json(res, 200, { items, unreadTotal: items.reduce((s, c) => s + c.unread, 0) });
    }

    if (!a1 && method === 'POST') {
      needUser();
      const b = await readBody(req);
      const ad = db().ads.find(x => x.id === b.adId);
      if (!ad) return json(res, 404, { error: 'Объявление не найдено' });
      if (ad.ownerId === user.id) return json(res, 400, { error: 'Это ваше объявление — вам напишут покупатели' });
      const chat = S.findOrCreateChat(ad, user.id);
      if (b.text) {
        db().messages.push({
          id: require('./db').id('m_'), chatId: chat.id, fromId: user.id,
          text: String(b.text).slice(0, 4000), kind: 'text', createdAt: Date.now(), readBy: [user.id],
        });
        save();
        publish([ad.ownerId], 'message', { chatId: chat.id });
      }
      return json(res, 201, { chat: S.chatView(chat, user.id) });
    }

    if (a1 && a2 === 'messages' && method === 'GET') {
      needUser();
      const chat = db().chats.find(c => c.id === a1);
      if (!chat || !(chat.buyerId === user.id || chat.sellerId === user.id)) return json(res, 404, { error: 'Чат не найден' });
      const d = db();
      if (a2 === 'messages' && !a3) {
        const msgs = d.messages.filter(m => m.chatId === chat.id);
        msgs.forEach((m) => {
          m.readBy = m.readBy || [];
          if (!m.readBy.includes(user.id)) m.readBy.push(user.id);
          void m;
        });
        save();
        const peerId = chat.buyerId === user.id ? chat.sellerId : chat.buyerId;
        const deals = d.deals.filter(x => x.chatId === chat.id).map(x => S.dealView(x, user.id));
        return json(res, 200, {
          chat: S.chatView(chat, user.id),
          messages: msgs.map(m => ({
            id: m.id, fromId: m.fromId, text: m.text, kind: m.kind,
            dealId: m.dealId || null, createdAt: m.createdAt, mine: m.fromId === user.id,
          })),
          deals,
          peer: S.publicUser(d.users.find(u => u.id === peerId)),
        });
      }
    }

    if (a1 && a2 === 'messages' && method === 'POST') {
      needUser();
      const chat = db().chats.find(c => c.id === a1);
      if (!chat || !(chat.buyerId === user.id || chat.sellerId === user.id)) return json(res, 404, { error: 'Чат не найден' });
      const b = await readBody(req);
      const text = String(b.text || '').trim();
      if (!text) return json(res, 400, { error: 'Пустое сообщение' });
      const msg = {
        id: require('./db').id('m_'), chatId: chat.id, fromId: user.id,
        text: text.slice(0, 4000), kind: 'text', createdAt: Date.now(), readBy: [user.id],
      };
      db().messages.push(msg);
      chat.updatedAt = msg.createdAt;
      save();
      const peerId = chat.buyerId === user.id ? chat.sellerId : chat.buyerId;
      publish([peerId], 'message', { chatId: chat.id, messageId: msg.id });
      return json(res, 201, { message: { id: msg.id, fromId: msg.fromId, text: msg.text, kind: msg.kind, createdAt: msg.createdAt, mine: true } });
    }

    if (a1 && a2 === 'deals' && method === 'POST') {
      needUser();
      const chat = db().chats.find(c => c.id === a1);
      if (!chat || !(chat.buyerId === user.id || chat.sellerId === user.id)) return json(res, 404, { error: 'Чат не найден' });
      const b = await readBody(req);
      if (!S.DEAL_TYPES[b.type]) return json(res, 400, { error: 'Выберите способ сделки' });
      const ad = db().ads.find(x => x.id === chat.adId);
      const price = b.price != null && b.price !== '' ? Math.round(Number(b.price)) : (ad ? ad.price : null);
      const when = b.when ? Number(b.when) : null;
      const deal = {
        id: require('./db').id('d_'),
        adId: chat.adId, chatId: chat.id,
        fromId: user.id,
        toId: chat.buyerId === user.id ? chat.sellerId : chat.buyerId,
        type: b.type,
        place: String(b.place || '').slice(0, 200),
        when: Number.isFinite(when) ? when : null,
        price: Number.isFinite(price) ? price : null,
        comment: String(b.comment || '').slice(0, 1000),
        status: 'proposed', createdAt: Date.now(), updatedAt: Date.now(),
      };
      db().deals.push(deal);
      const label = S.DEAL_TYPES[deal.type];
      const text = `${label}: ${deal.place || 'место уточним в чате'}${deal.when ? ', ' + new Date(deal.when).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''}`;
      const msg = {
        id: require('./db').id('m_'), chatId: chat.id, fromId: user.id,
        text, kind: 'deal', dealId: deal.id, createdAt: Date.now(), readBy: [user.id],
      };
      db().messages.push(msg);
      chat.updatedAt = msg.createdAt;
      save();
      publish([chat.buyerId, chat.sellerId], 'deal', { chatId: chat.id, dealId: deal.id });
      publish([chat.buyerId, chat.sellerId], 'message', { chatId: chat.id });
      return json(res, 201, { deal: S.dealView(deal, user.id) });
    }
  }

  /* --- сделки --- */
  if (resource === 'deals') {
    if (!a1 && method === 'GET') {
      needUser();
      const items = db().deals
        .filter(x => x.fromId === user.id || x.toId === user.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(x => S.dealView(x, user.id));
      return json(res, 200, { items });
    }
    if (a1 && a2 === 'status' && method === 'POST') {
      needUser();
      const deal = db().deals.find(x => x.id === a1);
      if (!deal) return json(res, 404, { error: 'Сделка не найдена' });
      if (deal.fromId !== user.id && deal.toId !== user.id) return json(res, 403, { error: 'Нет доступа' });
      const b = await readBody(req);
      const next = b.status;
      if (!['confirmed', 'declined', 'done', 'canceled'].includes(next)) return json(res, 400, { error: 'Недопустимый статус' });
      if (next === 'confirmed' && deal.toId !== user.id) return json(res, 403, { error: 'Подтвердить может только получатель предложения' });
      deal.status = next;
      deal.updatedAt = Date.now();
      if (next === 'done') {
        const ad = db().ads.find(x => x.id === deal.adId);
        if (ad && (ad.ownerId === deal.fromId || ad.ownerId === deal.toId)) { ad.status = 'sold'; ad.updatedAt = Date.now(); }
      }
      const chat = db().chats.find(c => c.id === deal.chatId);
      if (chat) {
        const text = `Сделка ${S.DEAL_STATUS[next].toLowerCase()}`;
        db().messages.push({
          id: require('./db').id('m_'), chatId: chat.id, fromId: user.id,
          text, kind: 'deal', dealId: deal.id, createdAt: Date.now(), readBy: [user.id],
        });
        chat.updatedAt = Date.now();
      }
      save();
      publish([deal.fromId, deal.toId], 'deal', { dealId: deal.id, chatId: deal.chatId });
      publish([deal.fromId, deal.toId], 'message', { chatId: deal.chatId });
      return json(res, 200, { deal: S.dealView(deal, user.id) });
    }
  }

  /* --- отзывы --- */
  if (resource === 'reviews' && method === 'POST') {
    needUser();
    const b = await readBody(req);
    const target = db().users.find(u => u.id === b.toId);
    if (!target) return json(res, 404, { error: 'Пользователь не найден' });
    if (target.id === user.id) return json(res, 400, { error: 'Себя оценивать не нужно :)' });
    const rating = Math.max(1, Math.min(5, Number(b.rating) || 5));
    const review = {
      id: require('./db').id('r_'), fromId: user.id, toId: target.id,
      rating, text: String(b.text || '').slice(0, 800), createdAt: Date.now(),
    };
    db().reviews.push(review);
    target.ratingSum = (target.ratingSum || 0) + rating;
    target.ratingCount = (target.ratingCount || 0) + 1;
    save();
    return json(res, 201, { review });
  }

  /* --- realtime --- */
  if (resource === 'events' && method === 'GET') {
    needUser();
    return openStream(req, res, user);
  }

  return json(res, 404, { error: 'Не найдено' });
}

/* ---------------- сервер ---------------- */

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const searchParams = new URL(req.url, 'http://localhost').searchParams;
  const pathOnly = pathname.replace(/\/+$/, '') || '/';

  if (pathname.startsWith('/api/')) {
    try {
      return await api(req, res, pathOnly, searchParams);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', pathname, err);
      if (!res.headersSent) json(res, status, { error: err.message || 'Внутренняя ошибка' });
      else res.end();
      return;
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Метод не поддерживается');
  }

  // Загруженные пользователями фото
  if (pathname.startsWith('/uploads/')) {
    const name = path.basename(pathname);
    return serveFile(res, path.join(UPLOAD_DIR, name), 604800);
  }

  // Статика
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Запрещено');
  }

  fs.stat(filePath, (err, st) => {
    if (!err && st.isFile()) return serveFile(res, filePath, pathname.startsWith('/seed/') ? 86400 : 0);
    // SPA: любой другой путь отдаём как index.html
    if (!path.extname(pathname)) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Копейкино запущено: http://${HOST}:${PORT}`);
  console.log(`Демо-аккаунт: +7 999 000-00-01 / demo1234`);
});
