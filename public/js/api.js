/* The Worker's API, the signed-in user, and small helpers every page uses. */
(function () {
  'use strict';
  // Two views, each with its own sign-in in the browser: Admin & HR (/) and the applicant's phone (/interview).
  const VIEW = window.HRMC_VIEW === 'staff' ? 'staff' : 'applicant';
  const K_TOKEN = `hrmc_${VIEW}_token`, K_ME = `hrmc_${VIEW}_me`;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  let memToken = store.get(K_TOKEN), memMe = null;
  try { memMe = JSON.parse(store.get(K_ME) || 'null'); } catch (e) { memMe = null; }

  const API = {
    get token() { return memToken; },
    get me() { return memMe; },
    signIn(res) { memToken = res.token; memMe = { role: res.role, id: res.id, name: res.name, position: res.position || '' }; store.set(K_TOKEN, memToken); store.set(K_ME, JSON.stringify(memMe)); },
    signOut() { memToken = null; memMe = null; store.set(K_TOKEN, null); store.set(K_ME, null); },
    isHR() { return !!memMe && (memMe.role === 'h' || memMe.role === 'a'); },
    isAdmin() { return !!memMe && memMe.role === 'a'; },
    view: VIEW,
    async post(path, body) {
      let res;
      try {
        res = await fetch(path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, memToken ? { Authorization: 'Bearer ' + memToken } : {}), body: JSON.stringify(body || {}) });
      } catch (e) { throw new Error('Can\'t reach the server. Check your internet connection.'); }
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && memToken && !/^\/api\/auth\//.test(path)) { try { sessionStorage.setItem('hrmc_msg', data.error || ''); } catch (e) {} API.signOut(); location.hash = '#/'; location.reload(); }
      if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.status = res.status; e.code = data.code; throw e; }
      return data;
    },
    async postBlob(path, blob, type, headers) {
      const res = await fetch(path, { method: 'POST', headers: Object.assign({ 'Content-Type': type || blob.type || 'application/octet-stream', Authorization: 'Bearer ' + memToken }, headers || {}), body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    },
    async getBlob(path, body) {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + memToken }, body: JSON.stringify(body || {}) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Error ${res.status}`); }
      return res.blob();
    }
  };

  const U = {
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    since(ts) { return ts ? U.dur(Date.now() - ts) : ''; },
    ringText(ts) { return ts ? 'Ring ' + U.rings(Date.now() - ts) : ''; },
    dur(ms) { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; },
    rings(ms) { return Math.max(1, Math.ceil((ms || 0) / 6000)); },
    when(ts) {
      if (!ts) return '';
      const d = new Date(ts), today = new Date();
      const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (d.toDateString() === today.toDateString()) return 'Today ' + time;
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ' ' + time;
    },
    stamp() { const d = new Date(); return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); },
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },
    toast(msg, kind) {
      const t = document.getElementById('toast');
      if (!t) return;
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || '');
      el.textContent = msg;
      t.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 6000 : 3500);
    },
    debounce(fn, ms) { let h; return function () { clearTimeout(h); const a = arguments; h = setTimeout(() => fn.apply(this, a), ms); }; },
    initials(name) { return String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase(); }
  };

  window.API = API;
  window.U = U;
})();
