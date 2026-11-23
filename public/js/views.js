/* Шаблоны страниц. Каждый view возвращает HTML-строку; app.js навешивает обработчики. */
(function () {
  const { esc, price, timeAgo, dateTime, clock, initials, icons, compact } = UI;

  const noPhoto = (title) => `
    <div class="noimg" style="background:linear-gradient(135deg,var(--primary-soft),var(--bg2));color:var(--muted)">
      <div>
        <div style="font-size:26px;font-weight:900;color:var(--primary);opacity:.5">${esc(initials(title))}</div>
        <div>${esc(title || 'Без фото')}</div>
      </div>
    </div>`;

  function adCard(ad, opts) {
    if (!ad) return '';
    const o = opts || {};
    const cover = ad.photos && ad.photos[0];
    return `
    <article class="ad-card" data-ad-id="${esc(ad.id)}">
      <a class="ad-thumb" href="/ad/${esc(ad.id)}" data-link>
        ${cover ? `<img src="${esc(cover)}" alt="${esc(ad.title)}" loading="lazy"/>` : noPhoto(ad.title)}
        ${ad.status && ad.status !== 'active' ? `<span class="pill ${ad.status === 'sold' ? 'gold' : 'red'}" style="position:absolute;left:8px;top:8px">${ad.status === 'sold' ? 'Продано' : 'В архиве'}</span>` : ''}
      </a>
      ${o.showFav !== false && ad.status === 'active' ? `
        <button class="ad-fav ${ad.favorite ? 'on' : ''}" data-fav="${esc(ad.id)}" aria-label="В избранное">${icons.heart}</button>` : ''}
      <div class="ad-body">
        <div class="ad-price">${esc(price(ad.price))}</div>
        <a class="ad-name" href="/ad/${esc(ad.id)}" data-link>${esc(ad.title)}</a>
        <div class="ad-tags">
          ${ad.deals && ad.deals.meeting ? '<span class="tag">Встреча</span>' : ''}
          ${ad.deals && ad.deals.delivery ? '<span class="tag">Доставка</span>' : ''}
          ${ad.deals && ad.deals.transfer ? '<span class="tag">Перевозка</span>' : ''}
        </div>
        <div class="ad-meta"><span>${esc(ad.city)}${ad.metro ? ' · ' + esc(ad.metro) : ''}</span><span>·</span><span>${esc(timeAgo(ad.createdAt))}</span></div>
      </div>
    </article>`;
  }

  const sidebar = (state) => {
    const meta = state.meta || { categories: [], cities: [] };
    const cat = state.filters.category || '';
    return `
    <aside class="sidebar">
      <div class="card card-pad">
        <div class="card-title">Категории</div>
        <div>
          <a class="side-link ${cat ? '' : 'active'}" href="/" data-link>Все объявления <span class="muted small">${compact(meta.stats ? meta.stats.ads : '')}</span></a>
          ${meta.categories.map((c) => `
            <a class="side-link ${cat === c ? 'active' : ''}" href="/?category=${encodeURIComponent(c)}" data-link>${esc(c)}</a>`).join('')}
        </div>
      </div>
      <div class="card card-pad">
        <div class="card-title">Как это работает</div>
        <p class="small muted" style="margin-bottom:10px">Найдите товар, напишите продавцу и договоритесь: встреча, доставка или перевозка — всё внутри чата.</p>
        <a class="btn btn-primary btn-sm" href="/new" data-link>Разместить объявление</a>
      </div>
    </aside>`;
  };

  function home(state) {
    const f = state.filters;
    const items = state.ads || [];
    const meta = state.meta || { categories: [], cities: [] };
    return `
    <div class="container">
      <div class="hero">
        <h1>Купить, продать и договориться — на Копейкино</h1>
        <p>Объявления рядом с вами: фото, честные описания, переписка с продавцом и сделки в один клик — личная встреча, доставка или перевозка.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="/new" data-link>Разместить объявление</a>
          <a class="btn" href="/chats" data-link>Мои сообщения</a>
          <a class="btn" href="/deals" data-link>Сделки</a>
        </div>
      </div>

      <div class="layout">
        ${sidebar(state)}
        <section>
          <div class="page-head">
            <div>
              <div class="page-title">${f.q ? 'Поиск: ' + esc(f.q) : cat(f)}</div>
              <div class="muted small">${state.total || 0} объявлений${f.city ? ' · ' + esc(f.city) : ''}${f.deal ? ' · ' + dealLabel(f.deal) : ''}</div>
            </div>
            <div class="chips">
              <select class="chip" id="sort-select" style="height:34px">
                <option value="new" ${f.sort === 'new' ? 'selected' : ''}>Сначала новые</option>
                <option value="price-asc" ${f.sort === 'price-asc' ? 'selected' : ''}>Дешевле</option>
                <option value="price-desc" ${f.sort === 'price-desc' ? 'selected' : ''}>Дороже</option>
                <option value="views" ${f.sort === 'views' ? 'selected' : ''}>Популярные</option>
              </select>
            </div>
          </div>

          <form class="card card-pad" id="filter-form" style="margin-bottom:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="flex:1;min-width:150px"><label>Город</label>
              <select class="select" name="city">
                <option value="">Любой</option>
                ${meta.cities.map(c => `<option ${f.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="width:120px"><label>Цена от</label><input class="input" name="min" type="number" min="0" value="${esc(f.min || '')}" placeholder="0"/></div>
            <div class="field" style="width:120px"><label>до</label><input class="input" name="max" type="number" min="0" value="${esc(f.max || '')}" placeholder="∞"/></div>
            <div class="field" style="min-width:150px"><label>Сделка</label>
              <select class="select" name="deal">
                <option value="">Любая</option>
                <option value="meeting" ${f.deal === 'meeting' ? 'selected' : ''}>Личная встреча</option>
                <option value="delivery" ${f.deal === 'delivery' ? 'selected' : ''}>Доставка</option>
                <option value="transfer" ${f.deal === 'transfer' ? 'selected' : ''}>Перевозка</option>
              </select>
            </div>
            <button class="btn btn-primary" type="submit">Показать</button>
            ${(f.city || f.min || f.max || f.deal || f.category) ? '<a class="btn btn-ghost" href="/" data-link>Сбросить</a>' : ''}
          </form>

          ${state.loading ? skeletonGrid() : (items.length ? `
            <div class="grid">${items.map(a => adCard(a)).join('')}</div>
            ${state.total > items.length ? `<div style="text-align:center;margin-top:22px"><button class="btn" id="more-btn">Показать ещё ${Math.min(24, state.total - items.length)}</button></div>` : ''}
          ` : `<div class="empty"><h3 style="margin-bottom:6px">Ничего не нашлось</h3><p>Попробуйте изменить фильтры или <a href="/new" data-link style="color:var(--primary)">разместите своё объявление</a>.</p></div>`)}
        </section>
      </div>
    </div>`;
  }

  function cat(f) {
    return f.category ? esc(f.category) : 'Свежие объявления';
  }
  function dealLabel(d) {
    return { meeting: 'личная встреча', delivery: 'доставка', transfer: 'перевозка' }[d] || d;
  }
  function skeletonGrid() {
    return `<div class="grid">${Array.from({ length: 6 }).map(() => socketCard()).join('')}</div>`;
  }
  function socketCard() {
    return `<div class="ad-card" style="border:0;box-shadow:none"><div class="skeleton" style="aspect-ratio:4/3"></div><div style="padding:12px"><div class="skeleton" style="height:18px;width:50%;margin-bottom:8px"></div><div class="skeleton" style="height:14px"></div></div></div>`;
  }

  /* ---------------- страница объявления ---------------- */
  function adPage(state) {
    const ad = state.ad;
    if (!ad) return notFound();
    const cover = ad.photos && ad.photos[0];
    const owner = ad.owner || {};
    const isMine = ad.isMine;
    const statusPill = ad.status === 'active'
      ? '<span class="pill green">Активно</span>'
      : ad.status === 'sold'
        ? '<span class="pill gold">Продано</span>'
        : '<span class="pill red">Снято с публикации</span>';
    return `
    <div class="container">
      <div class="muted small" style="margin-bottom:14px">
        <a href="/" data-link>Главная</a> / <a href="/?category=${encodeURIComponent(ad.category)}" data-link>${esc(ad.category)}</a> / ${esc(ad.title)}
      </div>
      <div class="ad-page">
        <div>
          <div class="gallery">
            ${cover ? `<img class="main-img" id="main-img" src="${esc(cover)}" alt="${esc(ad.title)}"/>` : noPhoto(ad.title)}
            ${ad.photos.length > 1 ? `<div class="gallery-thumbs">${ad.photos.map((p, i) => `<img src="${esc(p)}" data-thumb="${esc(p)}" class="${i === 0 ? 'active' : ''}" alt=""/>`).join('')}</div>` : ''}
          </div>

          <div class="ad-details">
            <div class="chips" style="margin-bottom:10px">
              ${statusPill}
              <span class="pill">${icons.eye} ${ad.views} просмотров</span>
              <span class="pill">${esc(timeAgo(ad.createdAt))}</span>
            </div>
            <h1>${esc(ad.title)}</h1>
            <div class="price-big">${esc(price(ad.price))}</div>

            <dl class="specs">
              <div class="spec"><dt>Категория</dt><dd>${esc(ad.category)}</dd></div>
              <div class="spec"><dt>Состояние</dt><dd>${esc(ad.condition)}</dd></div>
              <div class="spec"><dt>Город</dt><dd>${esc(ad.city)}</dd></div>
              <div class="spec"><dt>Район / метро</dt><dd>${esc(ad.metro || '—')}</dd></div>
            </dl>

            <h3 style="margin:18px 0 6px;font-size:16px">Описание</h3>
            <p class="description">${esc(ad.description || 'Продавец не добавил описание.')}</p>

            <h3 style="margin:22px 0 8px;font-size:16px">Как договоримся</h3>
            <div class="deal-options">
              ${ad.deals.meeting ? `<div class="deal-option"><span class="ic">${icons.meet}</span><div><b>Личная встреча</b><div class="small muted">Договоритесь о времени и месте в чате, проверьте товар на месте.</div></div></div>` : ''}
              ${ad.deals.delivery ? `<div class="deal-option"><span class="ic">${icons.delivery}</span><div><b>Доставка</b><div class="small muted">Согласуйте адрес и способ доставки в чате.</div></div></div>` : ''}
              ${ad.deals.transfer ? `<div class="deal-option"><span class="ic">${icons.transfer}</span><div><b>Перевозка</b><div class="small muted">Помощь с перевозкой крупногабаритных покупок.</div></div></div>` : ''}
            </div>
          </div>
        </div>

        <aside class="side-sticky">
          <div class="card card-pad">
            <div class="owner">
              <div class="avatar lg">${esc(initials(owner.name))}</div>
              <div>
                <a href="/user/${esc(owner.id)}" data-link><b>${esc(owner.name || 'Продавец')}</b></a>
                <div class="small muted">${owner.rating ? '★ ' + owner.rating + ' · ' + owner.reviews + ' отзывов' : 'Новый продавец'}</div>
                <div class="small muted">${esc(owner.city || '')}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
              ${isMine ? `
                ${ad.status === 'active' ? `<a class="btn btn-primary" href="/edit/${esc(ad.id)}" data-link>Редактировать</a>` : ''}
                <a class="btn" href="/chats" data-link>Сообщения по объявлению</a>
                ${ad.status === 'active'
                  ? `<button class="btn btn-danger" data-delete-ad="${esc(ad.id)}">${icons.trash} Снять с публикации</button>`
                  : ad.status === 'archived'
                    ? `<button class="btn btn-primary" data-restore-ad="${esc(ad.id)}">${icons.check} Вернуть в публикацию</button>`
                    : ''}
              ` : `
                <button class="btn btn-primary" data-start-chat="${esc(ad.id)}">${icons.chat} Написать продавцу</button>
                <button class="btn" data-fav="${esc(ad.id)}">${icons.heart} ${ad.favorite ? 'В избранном' : 'В избранное'}</button>
                <a class="btn" href="/user/${esc(owner.id)}" data-link>Профиль продавца</a>
                <button class="btn btn-ghost" data-show-phone="${esc(owner.phone || '')}">Показать телефон</button>
              `}
            </div>
            <p class="small muted" style="margin-top:12px">Не переводите предоплату незнакомым. Встречайтесь в людных местах.</p>
          </div>

          <div class="card card-pad">
            <div class="card-title">Безопасная сделка</div>
            <div class="deal-options">
              <div class="deal-option"><span class="ic">${icons.meet}</span><div><b>Встреча</b><div class="small muted">Назначьте место и время прямо в чате.</div></div></div>
              <div class="deal-option"><span class="ic">${icons.transfer}</span><div><b>Перевозка</b><div class="small muted">Обсудите грузчиков и транспорт.</div></div></div>
            </div>
          </div>
        </aside>
      </div>

      ${state.similar && state.similar.length ? `
        <h2 style="margin:30px 0 14px;font-size:20px">Похожие объявления</h2>
        <div class="grid">${state.similar.map(a => adCard(a)).join('')}</div>` : ''}
    </div>`;
  }

  /* ---------------- форма объявления ---------------- */
  function adForm(state) {
    const ad = state.editAd;
    const meta = state.meta || { categories: [], cities: [] };
    const photos = state.photos || (ad ? ad.photos.slice() : []);
    const v = ad || {};
    const deals = v.deals || { meeting: true, delivery: false, transfer: false };
    return `
    <div class="container">
      <div class="page-head"><div>
        <div class="page-title">${ad ? 'Редактировать объявление' : 'Новое объявление'}</div>
        <div class="muted small">Фотографии, честное описание и условия сделки повышают шансы на быструю продажу.</div>
      </div></div>

      <form class="form" id="ad-form">
        <div class="card card-pad">
          <div class="card-title">Фотографии <span class="muted small">до 8 штук</span></div>
          <div class="uploader" id="uploader">
            ${photos.map((p, i) => uploadTile(p, i)).join('')}
            ${photos.length < 8 ? `<label class="upload-add">
              <input type="file" id="photo-input" accept="image/*" multiple hidden/>
              <span style="font-size:22px;line-height:1">+</span><span>Добавить фото</span>
            </label>` : ''}
          </div>
          <p class="hint small muted" style="margin-top:8px">Первое фото станет обложкой. JPG/PNG/WEBP до 4 МБ.</p>
        </div>

        <div class="card card-pad" style="display:flex;flex-direction:column;gap:14px">
          <div class="field">
            <label for="f-title">Заголовок *</label>
            <input class="input" id="f-title" name="title" maxlength="120" required placeholder="Например: iPhone 13, 128 ГБ, белый" value="${esc(v.title || '')}"/>
          </div>
          <div class="row">
            <div class="field">
              <label for="f-category">Категория *</label>
              <select class="select" id="f-category" name="category" required>
                ${meta.categories.map(c => `<option ${v.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="f-price">Цена, ₽ *</label>
              <input class="input" id="f-price" name="price" type="number" min="0" step="1" required placeholder="0" value="${v.price != null ? esc(v.price) : ''}"/>
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="f-city">Город *</label>
              <input class="input" id="f-city" name="city" list="cities" required value="${esc(v.city || (state.me && state.me.city) || 'Москва')}"/>
              <datalist id="cities">${meta.cities.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
            </div>
            <div class="field">
              <label for="f-metro">Район или метро</label>
              <input class="input" id="f-metro" name="metro" placeholder="м. Тверская" value="${esc(v.metro || '')}"/>
            </div>
          </div>
          <div class="field">
            <label for="f-condition">Состояние</label>
            <select class="select" id="f-condition" name="condition">
              ${['Новое', 'Отличное', 'Хорошее', 'Б/у', 'Требует ремонта'].map(x => `<option ${v.condition === x ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-description">Описание</label>
            <textarea class="textarea" id="f-description" name="description" maxlength="5000" placeholder="Состояние, комплект, причина продажи, возможность торга...">${esc(v.description || '')}</textarea>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-title">Как вы готовы передать товар</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="check ${deals.meeting ? 'checked' : ''}"><input type="checkbox" name="d-meeting" ${deals.meeting ? 'checked' : ''}/>
              <span><b>Личная встреча</b><br/><span class="small muted">Покупатель приезжает, проверяет и забирает товар.</span></span></label>
            <label class="check ${deals.delivery ? 'checked' : ''}"><input type="checkbox" name="d-delivery" ${deals.delivery ? 'checked' : ''}/>
              <span><b>Доставка</b><br/><span class="small muted">Отправка или доставка по городу/РФ.</span></span></label>
            <label class="check ${deals.transfer ? 'checked' : ''}"><input type="checkbox" name="d-transfer" ${deals.transfer ? 'checked' : ''}/>
              <span><b>Перевозка</b><br/><span class="small muted">Нужен транспорт/грузчики — обсудите в чате.</span></span></label>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-primary" type="submit">${ad ? 'Сохранить изменения' : 'Опубликовать объявление'}</button>
          <a class="btn" href="${ad ? '/ad/' + esc(ad.id) : '/'}" data-link>Отмена</a>
        </div>
      </form>
    </div>`;
  }

  function uploadTile(p, i) {
    return `<div class="upload-tile"><img src="${esc(p)}" alt=""/><button type="button" class="rm" data-remove-photo="${i}" aria-label="Удалить">×</button></div>`;
  }

  /* ---------------- чаты ---------------- */
  function chats(state) {
    if (!state.me) return loginRequired('Чтобы переписываться с продавцами, войдите в аккаунт.');
    const items = state.chats || [];
    const cur = state.chat;
    return `
    <div class="container">
      <div class="page-head"><div class="page-title">Сообщения</div></div>
      <div class="chat-wrap">
        <div class="chat-list">
          ${items.length ? items.map(c => `
            <a class="chat-item ${cur && cur.chat.id === c.id ? 'active' : ''}" href="/chats/${esc(c.id)}" data-link>
              ${c.ad && c.ad.photos[0] ? `<img class="thumb" src="${esc(c.ad.photos[0])}" alt=""/>` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">${esc(initials(c.peer && c.peer.name))}</div>`}
              <div class="meta">
                <div class="name"><span>${esc(c.peer ? c.peer.name : 'Пользователь')}</span><span class="small muted">${esc(clock(c.updatedAt))}</span></div>
                <div class="last">${c.lastMessage ? esc(c.lastMessage.text) : 'Нет сообщений'}</div>
                <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.ad ? c.ad.title : '')}</div>
              </div>
              ${c.unread ? `<span class="pill green" style="align-self:center">${c.unread}</span>` : ''}
            </a>`).join('') : `<div class="empty" style="border:0">Пока нет переписок.<br/><a href="/" data-link style="color:var(--primary)">Найти товар</a> и напишите продавцу.</div>`}
        </div>
        <div class="chat-panel">
          ${cur ? chatPanel(state) : `<div class="empty" style="border:0;margin:auto;text-align:center">Выберите диалог слева</div>`}
        </div>
      </div>
    </div>`;
  }

  function chatPanel(state) {
    const chat = state.chat;
    const ad = chat.chat.ad;
    return `
      <div class="chat-head">
        ${ad && ad.photos[0] ? `<img src="${esc(ad.photos[0])}" style="width:44px;height:44px;border-radius:10px;object-fit:cover" alt=""/>` : ''}
        <div style="min-width:0;flex:1">
          <div style="font-weight:700">${esc(chat.peer ? chat.peer.name : '')}</div>
          <a class="small muted" href="/ad/${esc(chat.chat.adId)}" data-link style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block">${esc(ad ? ad.title + ' · ' + price(ad.price) : '')}</a>
        </div>
        <button class="btn btn-sm" data-make-deal="${esc(chat.chat.id)}">Договориться</button>
      </div>
      <div class="messages" id="messages">
        ${(chat.messages || []).map(m => `
          <div class="msg ${m.mine ? 'mine' : ''} ${m.kind === 'deal' ? 'deal' : ''}">
            ${esc(m.text)}
            <span class="time">${esc(clock(m.createdAt))}</span>
          </div>`).join('')}
      </div>
      <form class="chat-input" id="chat-form">
        <textarea name="text" placeholder="Напишите сообщение..." rows="1" maxlength="2000"></textarea>
        <button class="btn btn-primary" type="submit">Отправить</button>
      </form>`;
  }

  /* ---------------- сделки (в чате) ---------------- */
  function deals(state) {
    if (!state.me) return loginRequired('Войдите, чтобы видеть свои сделки.');
    const items = state.deals || [];
    return `
    <div class="container">
      <div class="page-head">
        <div><div class="page-title">Сделки</div><div class="muted small">Встречи, доставка и перевозка — договорённости из ваших чатов.</div></div>
      </div>
      ${items.length ? `<div class="deal-grid">${items.map(d => `
        <div class="deal-card">
          <div class="top">
            ${d.ad && d.ad.photos[0] ? `<img src="${esc(d.ad.photos[0])}" alt=""/>` : `<div class="avatar">${esc(initials(d.ad ? d.ad.title : ''))}</div>`}
            <div style="min-width:0">
              <a href="/ad/${esc(d.adId)}" data-link style="font-weight:700;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.ad ? d.ad.title : 'Объявление')}</a>
              <div class="small muted">${esc(d.ad ? price(d.ad.price) : '')}</div>
            </div>
            <span class="pill ${d.status === 'confirmed' ? 'green' : d.status === 'done' ? 'gold' : d.status === 'proposed' ? '' : 'red'}" style="margin-left:auto">${esc(d.statusLabel)}</span>
          </div>
          <div class="deal-facts">
            <span><b>${esc(d.typeLabel)}</b> ${d.mine ? '· вы предложили' : '· вам предложили'}</span>
            <span>Место: <b>${esc(d.place || '—')}</b></span>
            <span>Когда: <b>${esc(dateTime(d.when))}</b></span>
            ${d.price != null ? `<span>Цена: <b>${esc(price(d.price))}</b></span>` : ''}
            <span>С кем: <a href="/user/${esc(d.peer.id)}" data-link style="color:var(--primary)">${esc(d.peer.name)}</a></span>
          </div>
          <div class="actions">
            <a class="btn btn-sm" href="/chats/${esc(d.chatId)}" data-link>Открыть чат</a>
            ${!d.mine && d.status === 'proposed' ? `<button class="btn btn-sm btn-primary" data-deal-status="${esc(d.id)}" data-next="confirmed">${icons.check} Подтвердить</button>
              <button class="btn btn-sm btn-danger" data-deal-status="${esc(d.id)}" data-next="declined">${icons.x} Отклонить</button>` : ''}
            ${d.status === 'confirmed' ? `<button class="btn btn-sm" data-deal-status="${esc(d.id)}" data-next="done">Завершить</button>
              <button class="btn btn-sm btn-danger" data-deal-status="${esc(d.id)}" data-next="canceled">Отменить</button>` : ''}
          </div>
        </div>`).join('')}</div>` : `<div class="empty">Сделок пока нет. Откройте чат и нажмите «Договориться», чтобы предложить встречу, доставку или перевозку.</div>`}
    </div>`;
  }

  /* ---------------- избранное ---------------- */
  function favorites(state) {
    if (!state.me) return loginRequired('Войдите, чтобы сохранять объявления в избранное.');
    const items = state.favorites || [];
    return `
    <div class="container">
      <div class="page-head"><div><div class="page-title">Избранное</div><div class="muted small">${items.length} объявлений</div></div></div>
      ${items.length ? `<div class="grid">${items.map(a => adCard(a)).join('')}</div>`
        : `<div class="empty">Здесь пока пусто. Нажмите ♡ на объявлении, чтобы сохранить его.</div>`}
    </div>`;
  }

  /* ---------------- профиль ---------------- */
  function profile(state) {
    const u = state.profile;
    if (!u) return notFound();
    const isMe = state.me && state.me.id === u.id;
    return `
    <div class="container">
      <div class="card card-pad" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div class="avatar lg">${esc(initials(u.name))}</div>
        <div style="flex:1;min-width:200px">
          <div style="font-size:22px;font-weight:800">${esc(u.name)} ${u.verified ? '<span class="pill green">Проверен</span>' : ''}</div>
          <div class="small muted">${esc(u.city || '')} · на сайте с ${new Date(u.createdAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</div>
          <div class="small">${u.rating ? '★ ' + u.rating + ' · ' + u.reviews + ' отзывов' : 'Пока нет отзывов'}</div>
        </div>
        ${isMe ? `<a class="btn" href="/me" data-link>Настройки профиля</a>` : (state.me ? `<button class="btn" data-review="${esc(u.id)}">Оставить отзыв</button>` : '')}
      </div>
      ${u.about ? `<div class="card card-pad" style="margin-top:14px"><div class="card-title">О себе</div><p>${esc(u.about)}</p></div>` : ''}

      <h2 style="margin:24px 0 12px;font-size:20px">Объявления (${(state.userAds || []).length})</h2>
      ${(state.userAds || []).length ? `<div class="grid">${state.userAds.map(a => adCard(a)).join('')}</div>` : `<div class="empty">Объявлений пока нет.</div>`}

      ${(state.reviewsList || []).length ? `<h2 style="margin:24px 0 12px;font-size:20px">Отзывы</h2>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${state.reviewsList.map(r => `<div class="card card-pad">
            <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(r.author ? r.author.name : 'Покупатель')}</b><span class="pill gold">★ ${r.rating}</span></div>
            <p class="small" style="margin-top:4px">${esc(r.text)}</p></div>`).join('')}
        </div>` : ''}
    </div>`;
  }

  function settings(state) {
    const u = state.me;
    if (!u) return loginRequired('Войдите, чтобы изменить профиль.');
    return `
    <div class="container">
      <div class="page-head"><div class="page-title">Профиль</div></div>
      <form class="form" id="profile-form">
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>Имя</label><input class="input" name="name" value="${esc(u.name)}" required/></div>
          <div class="row">
            <div class="field"><label>Телефон</label><input class="input" name="phone" value="${esc(u.phone)}" required/></div>
            <div class="field"><label>Город</label><input class="input" name="city" value="${esc(u.city || '')}"/></div>
          </div>
          <div class="field"><label>О себе</label><textarea class="textarea" name="about" maxlength="500">${esc(u.about || '')}</textarea></div>
        </div>
        <div class="actions"><button class="btn btn-primary" type="submit">Сохранить</button>
          <a class="btn" href="/user/${esc(u.id)}" data-link>Мой профиль</a>
          <a class="btn" href="/my" data-link>Мои объявления</a>
        </div>
      </form>
    </div>`;
  }

  function myAds(state) {
    if (!state.me) return loginRequired('Войдите, чтобы управлять объявлениями.');
    const items = state.myAds || [];
    // снятые объявления не теряются: лежат в архиве и возвращаются в публикацию одной кнопкой
    const active = items.filter(a => a.status === 'active');
    const archived = items.filter(a => a.status !== 'active');
    const card = (a) => `
      <div class="my-ad">
        ${adCard(a, { showFav: false })}
        ${a.status === 'archived' ? `<div class="my-ad-actions"><button class="btn btn-sm btn-primary" data-restore-ad="${esc(a.id)}">Вернуть в публикацию</button></div>` : ''}
      </div>`;
    return `
    <div class="container">
      <div class="page-head">
        <div><div class="page-title">Мои объявления</div><div class="muted small">${active.length} в публикации${archived.length ? ' · ' + archived.length + ' в архиве' : ''}</div></div>
        <a class="btn btn-primary" href="/new" data-link>+ Новое</a>
      </div>
      ${active.length ? `<div class="grid">${active.map(card).join('')}</div>` : `<div class="empty">Вы ещё ничего не размещали. <a href="/new" data-link style="color:var(--primary)">Разместить объявление</a></div>`}
      ${archived.length ? `
        <h2 style="margin:30px 0 12px;font-size:18px">Архив</h2>
        <p class="muted small" style="margin-bottom:12px">Снятые и проданные объявления. В публикацию можно вернуть одним нажатием.</p>
        <div class="grid">${archived.map(card).join('')}</div>` : ''}
    </div>`;
  }

  /* ---------------- вход / регистрация ---------------- */
  function auth(state) {
    const meta = state.meta || {};
    const demo = meta.demo || { phone: '+79990000001', password: 'demo1234' };
    return `
    <div class="container" style="max-width:920px">
      <div class="page-head"><div>
        <div class="page-title">Вход и регистрация</div>
        <div class="muted small">Аккаунт нужен, чтобы размещать объявления и переписываться.</div>
      </div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px" class="auth-grid">
        <form class="card card-pad" id="login-form" style="display:flex;flex-direction:column;gap:14px">
          <div class="card-title">У меня уже есть аккаунт</div>
          <div class="field"><label>Телефон</label><input class="input" name="phone" value="${esc(demo.phone)}" autocomplete="tel"/></div>
          <div class="field"><label>Пароль</label><input class="input" name="password" type="password" value="${esc(demo.password)}" autocomplete="current-password"/></div>
          <button class="btn btn-primary" type="submit">Войти</button>
          <p class="small muted">Демо-аккаунт уже подставлен — просто нажмите «Войти».</p>
        </form>
        <form class="card card-pad" id="register-form" style="display:flex;flex-direction:column;gap:14px">
          <div class="card-title">Я новый пользователь</div>
          <div class="field"><label>Имя</label><input class="input" name="name" placeholder="Как к вам обращаться" autocomplete="name"/></div>
          <div class="field"><label>Телефон</label><input class="input" name="phone" placeholder="+7 999 000-00-00" autocomplete="tel"/></div>
          <div class="row">
            <div class="field"><label>Пароль</label><input class="input" name="password" type="password" placeholder="минимум 6 символов" autocomplete="new-password"/></div>
            <div class="field"><label>Город</label><input class="input" name="city" placeholder="Москва" value="Москва"/></div>
          </div>
          <button class="btn btn-primary" type="submit">Создать аккаунт</button>
        </form>
      </div>
      <style>@media(max-width:780px){.auth-grid{grid-template-columns:1fr !important}}</style>
    </div>`;
  }

  function loginRequired(text) {
    return `<div class="container"><div class="empty" style="max-width:560px;margin:40px auto">
      <h3 style="margin-bottom:8px">Нужен аккаунт</h3>
      <p style="margin-bottom:16px">${esc(text)}</p>
      <a class="btn btn-primary" href="/auth" data-link>Войти или зарегистрироваться</a>
    </div></div>`;
  }

  // detail — уточнение от сервера/хранилища («Объявление не найдено», «Чат не найден»)
  function notFound(detail) {
    const hint = detail && !/^страница/i.test(detail) ? esc(detail) + '. ' : '';
    return `<div class="container"><div class="empty" style="max-width:560px;margin:40px auto">
      <h3 style="margin-bottom:8px">Страница не найдена</h3>
      <p style="margin-bottom:16px">${hint}Возможно, объявление снято с публикации или ссылка устарела.</p>
      <a class="btn btn-primary" href="/" data-link>На главную</a>
    </div></div>`;
  }

  window.Views = { home, adPage, adForm, chats, chatPanel, deals, favorites, profile, settings, myAds, auth, notFound, adCard, loginRequired };
})();
