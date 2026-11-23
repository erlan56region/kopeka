/* Роутер и вся интерактивность приложения. */
(function () {
  const { toast, modal, confirmDialog, esc, price } = UI;
  const app = document.getElementById('app');

  const state = {
    me: null,
    meta: null,
    filters: {},
    ads: [],
    total: 0,
    loading: false,
    photos: [],
    editAd: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);

  // База пути: '' на сервере, '/kopeka' на GitHub Pages (window.__BASE_PATH__)
  const BASE = String(window.__BASE_PATH__ || '').replace(/\/+$/, '');
  function appPath() {
    let p = location.pathname || '/';
    if (BASE && (p === BASE || p.startsWith(BASE + '/'))) p = p.slice(BASE.length) || '/';
    if (p === '/index.html') p = '/';
    p = p.replace(/\.html$/i, ''); // /kopeka/auth.html -> /auth
    return p || '/';
  }
  function toHref(path) { return BASE + (path === '/' ? '/' : path); }
  // href мог уже получить префикс базы (серверная разметка или script в Pages-сборке)
  function stripBase(href) {
    if (!BASE) return href;
    if (href === BASE) return '/';
    if (href.startsWith(BASE + '/')) return href.slice(BASE.length);
    return href;
  }
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------- навигация ---------------- */

  function navigate(path, opts) {
    if (opts && opts.replace) history.replaceState({}, '', toHref(path));
    else history.pushState({}, '', toHref(path));
    render();
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      const raw = link.getAttribute('href') || '';
      const href = stripBase(raw);
      if (href && href.startsWith('/')) {
        e.preventDefault();
        navigate(href);
      }
    }
  });

  window.addEventListener('popstate', render);

  // Поиск в шапке
  $('#header-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').toString().trim();
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    navigate('/' + (params.toString() ? '?' + params.toString() : ''));
  });

  /* ---------------- данные ---------------- */

  async function loadMe() {
    try {
      const r = await API.get('/api/me');
      state.me = r.user;
      renderUserSlot(r.counts);
    } catch (e) { state.me = null; }
  }

  async function loadMeta() {
    if (state.meta) return state.meta;
    state.meta = await API.get('/api/meta');
    return state.meta;
  }

  function renderUserSlot(counts) {
    const slot = $('#user-slot');
    if (!state.me) {
      slot.innerHTML = `<a class="btn btn-ghost btn-sm" href="/auth" data-link>Войти</a>`;
      return;
    }
    const c = counts || {};
    slot.innerHTML = `
      <div style="position:relative">
        <button class="icon-btn" id="user-menu-btn" title="${esc(state.me.name)}">
          <span class="avatar" style="width:32px;height:32px;font-size:14px">${esc(UI.initials(state.me.name))}</span>
        </button>
        <div id="user-menu" class="card" hidden
             style="position:absolute;right:0;top:48px;width:230px;padding:8px;z-index:60">
          <div style="padding:8px 10px">
            <div style="font-weight:700">${esc(state.me.name)}</div>
            <div class="small muted">${esc(state.me.phone)}</div>
          </div>
          <a class="side-link" href="/user/${esc(state.me.id)}" data-link>Мой профиль</a>
          <a class="side-link" href="/my" data-link>Мои объявления ${c.ads ? `<span class="muted small">${c.ads}</span>` : ''}</a>
          <a class="side-link" href="/chats" data-link>Сообщения ${c.chats ? `<span class="muted small">${c.chats}</span>` : ''}</a>
          <a class="side-link" href="/deals" data-link>Сделки ${c.deals ? `<span class="muted small">${c.deals}</span>` : ''}</a>
          <a class="side-link" href="/favorites" data-link>Избранное ${c.favorites ? `<span class="muted small">${c.favorites}</span>` : ''}</a>
          <a class="side-link" href="/new" data-link>+ Разместить</a>
          <button class="side-link" id="logout-btn" style="width:100%;color:var(--red)">Выйти</button>
        </div>
      </div>`;
    const btn = $('#user-menu-btn');
    const menu = $('#user-menu');
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    document.addEventListener('click', () => { if (menu) menu.hidden = true; });
    $('#logout-btn').onclick = async () => {
      await API.post('/api/auth/logout');
      state.me = null;
      if (es) { es.close(); es = null; }
      toast('Вы вышли из аккаунта');
      await loadMe();
      render();
    };
  }

  /* ---------------- realtime ---------------- */

  let es = null;
  function connectEvents() {
    if (!state.me || es) return;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('message', () => {
        bumpUnread();
        if (!appPath().startsWith('/chats')) return;
        const draft = document.querySelector('#chat-form textarea');
        if (draft && draft.value.trim()) { toast('Новое сообщение в чате'); return; }
        render(true);
      });
      es.addEventListener('deal', () => { const p = appPath(); if (p.startsWith('/chats') || p === '/deals') render(true); });
      es.onerror = () => { /* браузер сам переподключится */ };
    } catch (e) { /* окружение без SSE */ }
  }

  async function refreshUnread() {
    if (!state.me) return;
    try {
      const r = await API.get('/api/chats');
      setUnread(r.unreadTotal);
    } catch (e) {}
  }
  function setUnread(n) {
    const b = $('#unread-badge');
    if (!b) return;
    if (n > 0) { b.hidden = false; b.textContent = n > 99 ? '99+' : String(n); }
    else b.hidden = true;
  }
  function bumpUnread() { refreshUnread(); }

  /* ---------------- рендер ---------------- */

  async function render(silent) {
    const path = appPath();
    const params = new URLSearchParams(location.search);
    // если пользователь пришёл по прямому адресу файла (/kopeka/chats.html),
    // чистим адрес — при перезагрузке не будет лишней задержки из-за 404-фолбэка
    if (/\.html$/i.test(location.pathname) && !silent) {
      const cleanRoute = toHref(path) + location.search;
      try { history.replaceState({}, '', cleanRoute); } catch (e) {}
    }

    try {
      await loadMe();
      await loadMeta();

      connectEvents();
      if (path === '/' || path === '') return await renderHome(params);
      if (path === '/new') return await renderForm(null);
      if (path.startsWith('/edit/')) return await renderForm(path.split('/')[2]);
      if (path.startsWith('/ad/')) return await renderAd(path.split('/')[2]);
      if (path === '/chats') return await renderChats(null);
      if (path.startsWith('/chats/')) return await renderChats(path.split('/')[2]);
      if (path === '/deals') return await renderDeals();
      if (path === '/favorites') return await renderFavorites();
      if (path === '/auth') return renderAuth();
      if (path === '/me') return await renderSettings();
      if (path === '/my') return await renderMyAds();
      if (path.startsWith('/user/')) return await renderProfile(path.split('/')[2]);

      app.innerHTML = Views.notFound();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="container"><div class="empty">Ошибка: ${esc(e.message)}</div></div>`;
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    refreshUnread();
  }

  /* ---- главная ---- */
  async function renderHome(params) {
    state.filters = {
      q: params.get('q') || '',
      category: params.get('category') || '',
      city: params.get('city') || '',
      min: params.get('min') || '',
      max: params.get('max') || '',
      deal: params.get('deal') || '',
      sort: params.get('sort') || 'new',
      limit: 24,
      offset: 0,
    };
    app.innerHTML = Views.home(Object.assign({}, state, { ads: [], total: 0, loading: true }));
    const r = await API.get('/api/ads', state.filters);
    state.ads = r.items;
    state.total = r.total;
    app.innerHTML = Views.home(Object.assign({}, state));
    bindHome();
  }

  function bindHome() {
    const sort = $('#sort-select');
    if (sort) sort.onchange = () => {
      const u = new URLSearchParams(location.search);
      u.set('sort', sort.value);
      navigate('/?' + u.toString());
    };
    const form = $('#filter-form');
    if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const u = new URLSearchParams(location.search);
      ['city', 'min', 'max', 'deal'].forEach((k) => {
        const v = (fd.get(k) || '').toString().trim();
        if (v) u.set(k, v); else u.delete(k);
      });
      navigate('/?' + u.toString());
    };
    const more = $('#more-btn');
    if (more) more.onclick = async () => {
      more.disabled = true;
      const r = await API.get('/api/ads', Object.assign({}, state.filters, { offset: state.ads.length }));
      state.ads = state.ads.concat(r.items);
      app.innerHTML = Views.home(Object.assign({}, state));
      bindHome();
    };
    bindFavButtons();
  }

  /* ---- объявление ---- */
  async function renderAd(adId) {
    const r = await API.get('/api/ads/' + encodeURIComponent(adId));
    app.innerHTML = Views.adPage({ ad: r.ad, similar: r.similar, me: state.me });
    bindFavButtons();

    $$('[data-thumb]').forEach((img) => {
      img.onclick = () => {
        $('#main-img').src = img.dataset.thumb;
        $$('[data-thumb]').forEach(i => i.classList.remove('active'));
        img.classList.add('active');
      };
    });

    const del = $('[data-delete-ad]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('Снять объявление?', 'Объявление перестанет показываться в поиске.'))) return;
      await API.del('/api/ads/' + del.dataset.deleteAd);
      toast('Объявление снято');
      navigate('/my');
    };

    const phoneBtn = $('[data-show-phone]');
    if (phoneBtn) phoneBtn.onclick = () => {
      phoneBtn.textContent = phoneBtn.dataset.showPhone;
      phoneBtn.classList.add('btn-primary');
    };

    const chatBtn = $('[data-start-chat]');
    if (chatBtn) chatBtn.onclick = () => startChat(chatBtn.dataset.startChat);
  }

  async function startChat(adId) {
    if (!state.me) return navigate('/auth');
    try {
      const r = await API.post('/api/chats', { adId });
      navigate('/chats/' + r.chat.id);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---- форма ---- */
  async function renderForm(adId) {
    if (!state.me) {
      app.innerHTML = Views.loginRequired('Размещать объявления могут только зарегистрированные пользователи.');
      return;
    }
    state.editAd = null;
    state.photos = [];
    if (adId) {
      const r = await API.get('/api/ads/' + encodeURIComponent(adId));
      if (!r.ad.isMine) { app.innerHTML = Views.loginRequired('Редактировать объявление может только его автор.'); return; }
      state.editAd = r.ad;
      state.photos = r.ad.photos.slice();
    }
    renderFormBody();
  }

  function renderFormBody() {
    app.innerHTML = Views.adForm({ editAd: state.editAd, photos: state.photos, meta: state.meta, me: state.me });
    bindForm();
  }

  function bindForm() {
    const form = $('#ad-form');
    const input = $('#photo-input');

    const syncChecks = () => {
      $$('.check').forEach((l) => l.classList.toggle('checked', !!l.querySelector('input').checked));
    };
    syncChecks();
    $$('.check input').forEach((i) => i.addEventListener('change', syncChecks));

    const redrawPhotos = () => {
      const uploader = $('#uploader');
      if (!uploader) return;
      uploader.innerHTML =
        state.photos.map((p, i) => `<div class="upload-tile"><img src="${esc(p)}" alt=""/><button type="button" class="rm" data-remove-photo="${i}">×</button></div>`).join('') +
        (state.photos.length < 8 ? `<label class="upload-add"><input type="file" id="photo-input" accept="image/*" multiple hidden/><span style="font-size:22px;line-height:1">+</span><span>Добавить фото</span></label>` : '');
      bindPhotoInput();
      $$('[data-remove-photo]').forEach((b) => {
        b.onclick = () => { state.photos.splice(Number(b.dataset.removePhoto), 1); redrawPhotos(); };
      });
    };

    function bindPhotoInput() {
      const inp = $('#photo-input');
      if (!inp) return;
      inp.onchange = async () => {
        const files = Array.from(inp.files || []).slice(0, 8 - state.photos.length);
        for (const f of files) {
          if (f.size > 8 * 1024 * 1024) { toast(`Файл «${f.name}» больше 8 МБ`, 'err'); continue; }
          try {
            const dataUrl = await UI.compressImage(f);
            state.photos.push(dataUrl);
          } catch (e) { toast('Не удалось обработать ' + f.name, 'err'); }
        }
        redrawPhotos();
        if (state.photos.length >= 8) toast('Максимум 8 фотографий', 'err');
      };
    }
    bindPhotoInput();
    $$('[data-remove-photo]').forEach((b) => {
      b.onclick = () => { state.photos.splice(Number(b.dataset.removePhoto), 1); redrawPhotos(); };
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        title: fd.get('title').toString().trim(),
        category: fd.get('category').toString(),
        price: Number(fd.get('price')),
        city: fd.get('city').toString().trim(),
        metro: fd.get('metro').toString().trim(),
        condition: fd.get('condition').toString(),
        description: fd.get('description').toString().trim(),
        deals: {
          meeting: !!form.querySelector('[name="d-meeting"]').checked,
          delivery: !!form.querySelector('[name="d-delivery"]').checked,
          transfer: !!form.querySelector('[name="d-transfer"]').checked,
        },
        photos: state.photos,
      };
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Сохраняем…';
      try {
        if (state.editAd) {
          await API.patch('/api/ads/' + state.editAd.id, payload);
          toast('Изменения сохранены');
          navigate('/ad/' + state.editAd.id);
        } else {
          const r = await API.post('/api/ads', payload);
          toast('Объявление опубликовано');
          navigate('/ad/' + r.ad.id);
        }
      } catch (err) {
        // не сохранилось (нет места / хранилище недоступно) — сообщение держим дольше,
        // фото и текст остаются в форме, можно убрать пару снимков и повторить
        toast(err.message, 'err', err.status === 507 ? 12000 : 4000);
        submit.disabled = false;
        submit.textContent = 'Сохранить';
      }
    };
  }

  /* ---- чаты ---- */
  async function renderChats(chatId) {
    if (!state.me) { app.innerHTML = Views.loginRequired('Чтобы переписываться с продавцами, войдите в аккаунт.'); return; }
    const list = await API.get('/api/chats');
    let chat = null;
    if (chatId) {
      try {
        const r = await API.get(`/api/chats/${encodeURIComponent(chatId)}/messages`);
        chat = { chat: r.chat, messages: r.messages, peer: r.peer, deals: r.deals };
      } catch (e) { toast(e.message, 'err'); }
    }
    state.chat = chat;
    app.innerHTML = Views.chats({ me: state.me, chats: list.items, chat });
    setUnread(list.unreadTotal);

    const form = $('#chat-form');
    if (form) {
      const ta = form.querySelector('textarea');
      ta.focus();
      ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
      ta.onkeydown = (ev) => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
      };
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        ta.value = '';
        ta.style.height = 'auto';
        try {
          const r = await API.post(`/api/chats/${encodeURIComponent(chat.chat.id)}/messages`, { text });
          appendMessage(r.message);
        } catch (e) { toast(e.message, 'err'); ta.value = text; }
      };
      const box = $('#messages');
      if (box) box.scrollTop = box.scrollHeight;
    }

    const makeDeal = $('[data-make-deal]');
    if (makeDeal) makeDeal.onclick = () => openDealModal(chat.chat.id, chat.chat.ad);
  }

  function appendMessage(m) {
    const box = $('#messages');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'msg mine' + (m.kind === 'deal' ? ' deal' : '');
    el.innerHTML = esc(m.text) + `<span class="time">${esc(UI.clock(m.createdAt))}</span>`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  function openDealModal(chatId, ad) {
    const defaultWhen = new Date(Date.now() + 24 * 3600 * 1000);
    const local = new Date(defaultWhen.getTime() - defaultWhen.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    modal({
      title: 'Предложить сделку',
      body: `
        <div class="field"><label>Как передаём товар</label>
          <select class="select" id="deal-type">
            <option value="meet">Личная встреча</option>
            <option value="delivery">Доставка</option>
            <option value="transfer">Перевозка</option>
          </select>
        </div>
        <div class="field"><label>Место</label>
          <input class="input" id="deal-place" placeholder="м. Тверская, выход №3" value="${esc(ad ? ad.title : '')}"/>
        </div>
        <div class="row">
          <div class="field"><label>Дата и время</label><input class="input" id="deal-when" type="datetime-local" value="${local}"/></div>
          <div class="field"><label>Цена, ₽</label><input class="input" id="deal-price" type="number" min="0" value="${ad ? ad.price : ''}"/></div>
        </div>
        <div class="field"><label>Комментарий</label><textarea class="textarea" id="deal-comment" placeholder="Например: подъеду на 10 минут позже, оплата наличными"></textarea></div>
        <p class="small muted">Предложение появится в чате. Вторая сторона сможет подтвердить его в разделе «Сделки».</p>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="deal-send">Отправить предложение</button>`,
      onMount: (root, close) => {
        root.querySelector('#deal-send').onclick = async () => {
          const btn = root.querySelector('#deal-send');
          btn.disabled = true;
          const whenVal = root.querySelector('#deal-when').value;
          try {
            await API.post(`/api/chats/${encodeURIComponent(chatId)}/deals`, {
              type: root.querySelector('#deal-type').value,
              place: root.querySelector('#deal-place').value,
              when: whenVal ? new Date(whenVal).getTime() : null,
              price: root.querySelector('#deal-price').value,
              comment: root.querySelector('#deal-comment').value,
            });
            close();
            toast('Предложение отправлено');
            render(true);
          } catch (e) {
            toast(e.message, 'err');
            btn.disabled = false;
          }
        };
      },
    });
  }

  /* ---- сделки ---- */
  async function renderDeals() {
    if (!state.me) { app.innerHTML = Views.loginRequired('Войдите, чтобы видеть свои сделки.'); return; }
    const r = await API.get('/api/deals');
    app.innerHTML = Views.deals({ me: state.me, deals: r.items });
  }

  /* ---- избранное ---- */
  async function renderFavorites() {
    if (!state.me) { app.innerHTML = Views.loginRequired('Войдите, чтобы сохранять объявления в избранное.'); return; }
    const r = await API.get('/api/favorites');
    app.innerHTML = Views.favorites({ me: state.me, favorites: r.items });
    bindFavButtons();
  }

  /* ---- профиль ---- */
  async function renderProfile(userId) {
    const r = await API.get('/api/users/' + encodeURIComponent(userId));
    app.innerHTML = Views.profile({ me: state.me, profile: r.user, userAds: r.ads, reviewsList: r.reviewsList });
    bindFavButtons();
    const rev = $('[data-review]');
    if (rev) rev.onclick = () => openReviewModal(rev.dataset.review);
  }

  function openReviewModal(userId) {
    modal({
      title: 'Оставить отзыв',
      body: `
        <div class="field"><label>Оценка</label>
          <select class="select" id="rev-rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${'★'.repeat(n)} ${n}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Отзыв</label><textarea class="textarea" id="rev-text" placeholder="Как прошла сделка?"></textarea></div>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="rev-send">Отправить</button>`,
      onMount: (root, close) => {
        root.querySelector('#rev-send').onclick = async () => {
          try {
            await API.post('/api/reviews', {
              toId: userId,
              rating: Number(root.querySelector('#rev-rating').value),
              text: root.querySelector('#rev-text').value,
            });
            close();
            toast('Спасибо за отзыв!');
            render(true);
          } catch (e) { toast(e.message, 'err'); }
        };
      },
    });
  }

  async function renderSettings() {
    if (!state.me) { app.innerHTML = Views.loginRequired('Войдите, чтобы изменить профиль.'); return; }
    app.innerHTML = Views.settings({ me: state.me });
    $('#profile-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const r = await API.patch('/api/me', Object.fromEntries(fd.entries()));
        state.me = r.user;
        toast('Профиль обновлён');
        render(true);
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  async function renderMyAds() {
    if (!state.me) { app.innerHTML = Views.loginRequired('Войдите, чтобы видеть свои объявления.'); return; }
    const r = await API.get('/api/ads', { owner: 'me', limit: 60 });
    app.innerHTML = Views.myAds({ me: state.me, myAds: r.items });
  }

  /* ---- вход ---- */
  function renderAuth() {
    app.innerHTML = Views.auth({ meta: state.meta });
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.post('/api/auth/login', { phone: fd.get('phone'), password: fd.get('password') });
        await loadMe();
        toast('Добро пожаловать!');
        navigate('/');
      } catch (err) { toast(err.message, 'err'); }
    };
    $('#register-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.post('/api/auth/register', Object.fromEntries(fd.entries()));
        await loadMe();
        toast('Аккаунт создан');
        navigate('/');
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  /* ---- избранное: кнопки на любой странице ---- */
  function bindFavButtons() {
    $$('[data-fav]').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.me) { toast('Войдите, чтобы сохранять в избранное', 'err'); return navigate('/auth'); }
        try {
          const r = await API.post('/api/ads/' + btn.dataset.fav + '/favorite');
          btn.classList.toggle('on', r.favorite);
          if (btn.classList.contains('btn')) btn.innerHTML = UI.icons.heart + ' ' + (r.favorite ? 'В избранном' : 'В избранное');
          toast(r.favorite ? 'Добавлено в избранное' : 'Удалено из избранного');
        } catch (err) { toast(err.message, 'err'); }
      };
    });
  }

  // Глобальный делегированный обработчик (для карточек, отрисованных позже)
  document.addEventListener('click', async (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav && !fav.dataset.bound) {
      e.preventDefault();
      if (!state.me) { toast('Войдите, чтобы сохранять в избранное', 'err'); return navigate('/auth'); }
      try {
        const r = await API.post('/api/ads/' + fav.dataset.fav + '/favorite');
        fav.classList.toggle('on', r.favorite);
        toast(r.favorite ? 'Добавлено в избранное' : 'Удалено из избранного');
      } catch (err) { toast(err.message, 'err'); }
    }

    const st = e.target.closest('[data-deal-status]');
    if (st) {
      e.preventDefault();
      const label = { confirmed: 'Подтвердить сделку?', declined: 'Отклонить предложение?', done: 'Завершить сделку?', canceled: 'Отменить сделку?' }[st.dataset.next];
      if (!(await confirmDialog('Сделка', label, 'Да'))) return;
      try {
        await API.post('/api/deals/' + st.dataset.dealStatus + '/status', { status: st.dataset.next });
        toast('Статус обновлён');
        render(true);
      } catch (err) { toast(err.message, 'err'); }
    }
  });

  /* ---------------- старт ---------------- */
  UI.initTheme();
  (async () => {
    // на статической версии (GitHub Pages) данные лежат в IndexedDB — ждём загрузки
    if (window.__STORE_READY__ && typeof window.__STORE_READY__.then === 'function') {
      try { await window.__STORE_READY__; } catch (e) {}
    }
    await render();
    connectEvents();
  })();
})();
