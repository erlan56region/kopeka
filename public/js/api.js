/* Мини-клиент для API. Без зависимостей. */
(function () {
  async function request(method, path, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Ошибка ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const qs = (params) => {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined && v !== false) sp.set(k, v);
    });
    const s = sp.toString();
    return s ? '?' + s : '';
  };

  window.API = {
    get: (p, params) => request('GET', p + qs(params)),
    post: (p, body) => request('POST', p, body || {}),
    patch: (p, body) => request('PATCH', p, body || {}),
    del: (p) => request('DELETE', p),
  };
  window.qs = qs;
})();
