/* Утилиты UI: форматирование, тосты, модальные окна, иконки. */
(function () {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const price = (n) => {
    if (n == null || n === '' || Number.isNaN(Number(n))) return 'Цена не указана';
    const v = Number(n);
    if (v === 0) return 'Даром';
    return v.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₽';
  };

  const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',') + ' тыс.' : String(n));

  const timeAgo = (ts) => {
    const diff = Math.max(0, Date.now() - Number(ts || 0));
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ч назад';
    const d = Math.floor(h / 24);
    if (d === 1) return 'вчера';
    if (d < 7) return d + ' дн назад';
    return new Date(Number(ts)).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  const dateTime = (ts) => {
    if (!ts) return 'не выбрано';
    return new Date(Number(ts)).toLocaleString('ru-RU', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
  };

  const clock = (ts) => new Date(Number(ts)).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase();

  const icons = {
    heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9Z"/></svg>',
    meet: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    delivery: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>',
    transfer: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 16h20M4 16V9h11l4 4v3"/><circle cx="8" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 1 1 21 12Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m4 12 5 5L20 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  /* ---- тосты ---- */
  function toast(text, kind) {
    const host = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---- модальное окно ---- */
  function modal({ title, body, footer, onMount }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><strong>${esc(title || '')}</strong>
          <button class="icon-btn" data-close aria-label="Закрыть">${icons.x}</button></div>
        <div class="modal-body">${body || ''}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    root.appendChild(backdrop);
    const close = () => { root.innerHTML = ''; };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    if (onMount) onMount(backdrop, close);
    return { close, el: backdrop };
  }

  function confirmDialog(title, text, okLabel = 'Удалить') {
    return new Promise((resolve) => {
      modal({
        title,
        body: `<p>${esc(text)}</p>`,
        footer: `<button class="btn" data-close>Отмена</button><button class="btn btn-danger" data-ok>${esc(okLabel)}</button>`,
        onMount: (root, close) => {
          root.querySelector('[data-ok]').onclick = () => { close(); resolve(true); };
          root.querySelector('[data-close]').onclick = () => { close(); resolve(false); };
          root.querySelector('.modal-foot [data-close]').onclick = () => { close(); resolve(false); };
        },
      });
    });
  }

  /* ---- тема ---- */
  const THEME_KEY = 'kopeikino:theme';
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }
  function initTheme() {
    let t = 'light';
    try { t = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) {}
    applyTheme(t);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.onclick = () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    };
  }

  /* ---- чтение файлов в dataURL ---- */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Не удалось прочитать файл'));
      r.readAsDataURL(file);
    });
  }

  /* ---- ресайз картинки перед загрузкой (экономим трафик) ---- */
  async function compressImage(file, maxSide = 1280, quality = 0.82) {
    if (!/^image\//.test(file.type) || /gif$/.test(file.type)) return readFileAsDataUrl(file);
    const dataUrl = await readFileAsDataUrl(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Битое изображение'));
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 400 * 1024) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  window.UI = {
    esc, price, compact, timeAgo, dateTime, clock, initials, icons,
    toast, modal, confirmDialog, initTheme, applyTheme, compressImage, readFileAsDataUrl,
  };
})();
