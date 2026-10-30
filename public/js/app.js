/* =========================================================
   The app shell: sign-in, the top bar, the phone line to the
   Switchboard, and HR's pages other than the console.
   Two views, each its own page and its own sign-in (js/api.js):
     /           Admin & HR (index.html, the default landing; /admin forwards here): the staff sign-in, then
     HR          #/console (js/hr.js) · #/applicants · #/calls · #/call/<id>
     Admin       all of HR's pages, and #/admin (HR accounts, settings, status)
     /interview  the applicant's view (interview.html): #/phone (js/applicant.js), signed in once by the one-time link
                 the system generates for them (/interview?invite=<code>)
   ========================================================= */
(function () {
  'use strict';
  const esc = U.esc;
  const $app = () => document.getElementById('app');

  const App = {
    cfg: null, board: null, route: { name: '', arg: '' },
    isHR() { return API.isHR(); },
    isAdmin() { return API.isAdmin(); },

    async boot() {
      // 🔗 An applicant's one-time link: ?invite=<code> leaves the address bar at once, and the page asks for their name.
      // The link is used up only when they send it (so a link preview in an email or chat app doesn't use it).
      const q = new URLSearchParams(location.search);
      const invite = q.get('invite');
      // An interview link always opens the applicant's page (/interview), never Admin & HR (links sent as /?invite= too).
      if (invite && API.view === 'staff') { location.replace('/interview?invite=' + encodeURIComponent(invite)); return; }
      if (invite) { history.replaceState(null, '', location.pathname); API.signOut(); return App.gate('', invite); }
      let msg = ''; try { msg = sessionStorage.getItem('hrmc_msg') || ''; sessionStorage.removeItem('hrmc_msg'); } catch (e) {}
      // Each view signs in its own people only: staff on /admin, applicants on /.
      if (API.token && API.me && (API.view === 'staff') !== API.isHR()) API.signOut();
      if (!API.token) return App.gate(msg);
      try { App.cfg = await API.post('/api/config'); }
      catch (e) { return App.gate(e.status === 401 ? '' : e.message); }
      App.connect();
      window.addEventListener('hashchange', () => App.render());
      App.render();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    },

    /* ---------- sign-in ---------- */
    /* The sign-in pages.
       /           HR's and the admin's sign-in only (the default landing).
       /interview  applicants only: with their link, just their name; without it, the interview code and their name.
       Neither shows the other's sign-in. */
    gate(error, invite) {
      document.getElementById('nav').innerHTML = '';
      document.getElementById('who').innerHTML = '';
      const err = error ? `<p class="badge red" style="display:block;padding:8px 10px;border-radius:10px;white-space:normal">${esc(error)}</p>` : '';
      const logo = '<img class="gate-logo" src="lsh-logo-dark.png" alt="Legal Support Help" width="646" height="397">';
      const staffCard = `<div class="card"><h2>🧑‍💼 HR &amp; Admin</h2>
        <form id="hrForm">
          <label class="f" for="hrName">Username</label><input type="text" id="hrName" autocomplete="username" maxlength="40" required>
          <label class="f" for="hrPass">Password</label><input type="password" id="hrPass" autocomplete="current-password" required>
          <p class="tiny muted" style="margin:6px 0 0">Admin: type your name and the admin passphrase.</p>
          <div class="row" style="margin-top:14px"><button class="btn navy" type="submit">Sign in</button></div>
        </form></div>`;
      const nameField = `<label class="f" for="apEnterName">Your full name</label><input type="text" id="apEnterName" autocomplete="name" maxlength="60" required>`;
      if (API.view !== 'staff' && invite) {
        $app().innerHTML = `<div class="gate"><div class="card">${logo}<h1>Welcome to your interview</h1>${err}
          <form id="enterForm">${nameField}
            <p class="tiny muted" style="margin:6px 0 0">Use Chrome or Edge on a computer, with a headset. This link works once: keep this tab open until HR tells you the interview is over.</p>
            <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Enter →</button></div></form></div></div>`;
      } else if (API.view !== 'staff') {
        $app().innerHTML = `<div class="gate"><div class="card">${logo}<h1>Your interview mock call</h1>${err}
          <p class="small muted">Open the interview link HR sent you, or type the code from it.</p>
          <form id="enterForm"><label class="f" for="apCode">Interview code</label><input type="text" id="apCode" maxlength="40" required autocomplete="off" placeholder="e.g. 9hcwhb5yczn4">
            ${nameField}<div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Enter →</button></div></form></div></div>`;
      } else $app().innerHTML = `<div class="gate">${logo}${err}${staffCard.replace('🧑‍💼 HR &amp; Admin', 'Admin &amp; HR sign-in')}</div>`;
      const enter = document.getElementById('enterForm');
      if (enter) enter.onsubmit = async (ev) => {
        ev.preventDefault();
        const code = invite || document.getElementById('apCode').value.trim().replace(/^.*[?&]invite=/, '');
        try {
          API.signIn(await API.post('/api/auth/invite', { code, name: document.getElementById('apEnterName').value }));
          location.hash = '#/phone';
          location.reload();
        } catch (e) { U.toast(e.message, 'error'); }
      };
      const staff = document.getElementById('hrForm');
      if (!staff) return;
      try { document.getElementById('hrName').value = localStorage.getItem('hrmc_name') || ''; } catch (e) {}
      staff.onsubmit = async (ev) => {
        ev.preventDefault();
        const name = document.getElementById('hrName').value.trim(), password = document.getElementById('hrPass').value;
        try {
          const res = await API.post('/api/auth/staff', { username: name, password });
          try { localStorage.setItem('hrmc_name', name); } catch (e) {}
          API.signIn(res);
          location.hash = '#/console';
          location.reload();
        } catch (e) { U.toast(e.message, 'error'); }
      };
    },
    // 🔗 One-time access, done: the applicant submitted their note, their session is over and this browser forgets it.
    finished() {
      if (App.board) App.board.close();
      API.signOut();
      document.getElementById('nav').innerHTML = '';
      document.getElementById('who').innerHTML = '';
      $app().innerHTML = `<div class="gate"><div class="card" style="text-align:center"><img class="gate-logo" src="lsh-logo-dark.png" alt="Legal Support Help" width="646" height="397">
        <h1>Thank you!</h1><p>Your interview call is complete and your note was sent to HR.</p>
        <p class="small muted">You can close this window. Your interview link has been used and won't open again; HR will be in touch about the next steps.</p></div></div>`;
    },
    signOut() {
      if ((window.HR && HR.busy()) || (window.Applicant && Applicant.busy())) { if (!confirm('You are on a call. Sign out anyway?')) return; }
      if (!App.isHR() && !confirm('Sign out? Your interview link works only once: you can\'t come back without a new link from HR.')) return;
      if (App.board) App.board.close();
      API.signOut();
      location.hash = '';
      location.reload();
    },

    /* ---------- the phone line ---------- */
    connect() {
      const b = App.board = new VoIP.Board();
      const net = document.getElementById('netbar');
      b.on('up', () => net.classList.add('hidden'));
      b.on('down', (m) => {
        if (m.code === 4001) { const msg = App.isHR() ? 'Your account was disabled by the admin.' : 'Your interview session was ended by HR.'; b.close(); API.signOut(); return App.gate(msg); }
        net.classList.remove('hidden');
      });
      // A refused line may mean the sign-in ended: ask the API, which signs out on a 401.
      b.on('trouble', () => { API.post('/api/config').catch(() => {}); });
      b.on('*', (m) => { if (App.isHR()) HR.onBoard(m); else Applicant.onBoard(m); });
      b.connect();
    },

    /* ---------- the top bar and the pages ---------- */
    nav(hash) { if (location.hash === hash) App.render(); else location.hash = hash; },
    render() {
      const h = (location.hash || '').replace(/^#\/?/, '').split('/');
      const hr = App.isHR();
      let name = h[0] || (hr ? 'console' : 'phone');
      if (!hr) name = 'phone';
      else if (!['console', 'applicants', 'calls', 'call'].concat(App.isAdmin() ? ['admin'] : []).includes(name)) name = 'console';
      App.route = { name, arg: h[1] || '' };
      const items = hr ? [['console', '🎛 Console'], ['applicants', '👥 Applicants'], ['calls', '🗂 Call Logs']].concat(App.isAdmin() ? [['admin', '🛡 Admin']] : []) : [['phone', '☎ My phone']];
      document.getElementById('nav').innerHTML = items.map(([k, label]) => `<a href="#/${k}" class="${k === name || (k === 'calls' && name === 'call') ? 'on' : ''}">${label}</a>`).join('');
      const me = API.me || {};
      document.getElementById('who').innerHTML = `<span class="chip">${App.isAdmin() ? '🛡 Admin' : hr ? '🧑‍💼 HR' : '👤 Applicant'} · ${esc(me.name)}</span><button type="button" id="signOut">Sign out</button>`;
      document.getElementById('signOut').onclick = App.signOut;
      if (name === 'console') return HR.render($app());
      if (name === 'phone') return Applicant.render($app());
      if (name === 'applicants') return Pages.applicants($app());
      if (name === 'calls') return Pages.calls($app());
      if (name === 'call') return Pages.call($app(), App.route.arg);
      if (name === 'admin') return Admin.render($app());
    },

    // 🎧 Audio check: the microphone level, and a test tone in the headset.
    audioCheck(el) {
      el.innerHTML = `<h3>🎧 Audio check</h3><p class="small muted">Speak: the bar should move. Use a headset for the best sound.</p>
        <div class="meter"><i id="micLevel"></i></div>
        <div class="row" style="margin-top:10px"><button class="btn small" id="micTest">🎙 Test my microphone</button><button class="btn small" id="toneTest">🔊 Play a test tone</button></div>`;
      let stop = null;
      el.querySelector('#micTest').onclick = async (ev) => {
        if (stop) { stop(); stop = null; ev.target.textContent = '🎙 Test my microphone'; el.querySelector('#micLevel').style.width = '0'; return; }
        try {
          const s = await VoIP.Mic.open();
          stop = VoIP.meter(s, (v) => { const i = el.querySelector('#micLevel'); if (i) i.style.width = Math.round(v * 100) + '%'; });
          ev.target.textContent = '⏹ Stop the test';
        } catch (e) { U.toast(e.message, 'error'); }
      };
      el.querySelector('#toneTest').onclick = () => Sounds.endTone();
    },

    noteHtml(note) {
      const fields = (App.cfg && App.cfg.noteFields) || [];
      const n = note || {};
      if (!fields.some((f) => n[f.k])) return '<p class="muted small">Nothing typed yet.</p>';
      return `<dl class="notebox">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(n[f.k] || '—')}</dd>`).join('')}</dl>`;
    },
    transcriptHtml(lines) {
      if (!lines || !lines.length) return '<p class="muted small">No transcript.</p>';
      return lines.map((x) => `<div class="l ${x.who === 'caller' ? 'caller' : ''}"><b>${x.who === 'caller' ? '📞 Caller' : '👤 Applicant'}</b>${esc(x.text)}</div>`).join('');
    },
    statusBadge(s) {
      const map = { ended: ['green', 'Ended'], live: ['red', 'On the call'], ringing: ['amber', 'Ringing'], missed: ['amber', 'Missed'], declined: ['amber', 'Declined'], cancelled: ['', 'Cancelled'] };
      const [c, t] = map[s] || ['', s];
      return `<span class="badge ${c}">${esc(t)}</span>`;
    },
    /* 📋 The scoring matrix (src/rubric.js) as HR fills it in: A–I 1 to 5 each with the level's description and a
       remark, the A–I average, J (the final assessment) and the interview notes. `rv` is kept as they type, so the
       console can redraw without losing it. Only HR sees it. */
    scorecard(box, callId, rv) {
      rv.scores = rv.scores || {}; rv.remarks = rv.remarks || {};
      const R = App.cfg.rubric || [];
      const avg = () => { const v = R.filter((c) => !c.final && rv.scores[c.k]).map((c) => rv.scores[c.k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—'; };
      const level = (c) => rv.scores[c.k] ? `<b>${rv.scores[c.k]}</b> – ${esc(c.levels[rv.scores[c.k]])}` : '<span class="muted">Not scored yet.</span>';
      box.innerHTML = `<div class="sc">${R.map((c) => `<div class="sc-row ${c.final ? 'final' : ''}" data-k="${c.k}">
          <div class="sc-head"><b>${c.k}. ${esc(c.name)}</b><span class="spacer"></span><span class="sc-btns">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${rv.scores[c.k] === n ? 'on' : ''}" title="${esc(n + ' – ' + c.levels[n])}">${n}</button>`).join('')}</span></div>
          ${c.desc ? `<div class="tiny muted">${esc(c.desc)}</div>` : ''}
          ${c.final ? `<div class="sc-sum">Average of A–I: <b class="sc-avg">${avg()}</b> / 5</div>` : ''}
          <div class="sc-desc small">${level(c)}</div>
          <input type="text" class="sc-rem" data-k="${c.k}" maxlength="1500" placeholder="Remark (optional)" value="${esc(rv.remarks[c.k] || '')}"></div>`).join('')}
        <label class="f" for="scNotes">Interview notes</label><textarea class="sc-notes" id="scNotes" rows="5">${esc(rv.notes || '')}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary sc-save" type="button">💾 Save the scorecard</button><span class="tiny muted sc-at">${rv.at ? `Saved ${esc(U.when(rv.at))} by ${esc(rv.by)}` : 'Only HR sees this.'}</span></div></div>`;
      box.querySelectorAll('.sc-row').forEach((row) => {
        const c = R.find((x) => x.k === row.dataset.k);
        row.querySelectorAll('.sc-btns button').forEach((b) => { b.onclick = () => {
          const n = Number(b.dataset.n);
          rv.scores[c.k] = rv.scores[c.k] === n ? undefined : n;   // a second click clears it
          row.querySelectorAll('.sc-btns button').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) === rv.scores[c.k]));
          row.querySelector('.sc-desc').innerHTML = level(c);
          const a = box.querySelector('.sc-avg'); if (a) a.textContent = avg();
        }; });
      });
      box.querySelectorAll('.sc-rem').forEach((i) => { i.oninput = () => { rv.remarks[i.dataset.k] = i.value; }; });
      box.querySelector('.sc-notes').oninput = (e) => { rv.notes = e.target.value; };
      box.querySelector('.sc-save').onclick = async () => {
        try {
          const r = await API.post('/api/call/update', { id: callId, review: { scores: rv.scores, remarks: rv.remarks, notes: rv.notes || '' } });
          Object.assign(rv, r.call.review || {});
          box.querySelector('.sc-at').textContent = `Saved ${U.when(rv.at)} by ${rv.by}`;
          U.toast(rv.verdict ? `Saved: ${rv.verdict}.` : 'Saved.', 'ok');
        } catch (e) { U.toast(e.message, 'error'); }
      };
    },
    // 📄 The applicant's briefing sheet (the default scenario's): what they know before the call.
    briefingHtml(b) {
      if (!b || !(b.sections || []).length) return '';
      return `<h2>📄 ${esc(b.title)}</h2>${b.sections.map((x) => `<h4 style="margin:12px 0 4px">${esc(x.title)}</h4>
        ${x.text ? `<p class="small" style="margin:0">${esc(x.text)}</p>` : ''}
        ${(x.items || []).length ? `<${x.ordered ? 'ol' : 'ul'} class="small" style="margin:0;padding-left:20px">${x.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${x.ordered ? 'ol' : 'ul'}>` : ''}
        ${x.note ? `<p class="small" style="margin:4px 0 0"><b>${esc(x.note)}</b></p>` : ''}`).join('')}`;
    },
    inviteLink(code) { return `${location.origin}/interview?invite=${encodeURIComponent(code)}`; },
    async copy(text) { try { await navigator.clipboard.writeText(text); U.toast('Copied.', 'ok'); } catch (e) { prompt('Copy this:', text); } }
  };

  /* =========================================================
     HR's pages: 👥 Applicants, 🗂 Call Logs, one call
     ========================================================= */
  const Pages = {
    async applicants(el) {
      el.innerHTML = `<div class="card"><h2>👥 Applicants</h2>
        <p class="muted small">Add an applicant to give them a desk extension and a <b>one-time interview link</b>. They open it in Chrome or Edge on a computer with a headset: it signs them in to their phone for one session (${App.cfg.features.sessionHours} h) and can't be used again. An unopened link lasts ${App.cfg.features.linkHours} h. ↻ New link replaces it (and ends any session); ⛔ End session signs them out.</p>
        <form id="addAp" class="row" style="align-items:end">
          <div style="flex:2;min-width:180px"><label class="f" for="apName">Applicant's name (optional: they type theirs)</label><input type="text" id="apName" maxlength="60"></div>
          <button class="btn primary" type="submit">＋ Add &amp; get link</button>
        </form></div>
        <div class="card"><div class="tablewrap" id="apList"><div class="empty">Loading…</div></div></div>`;
      el.querySelector('#addAp').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const r = await API.post('/api/applicants/create', { name: el.querySelector('#apName').value });
          el.querySelector('#apName').value = '';
          await App.copy(App.inviteLink(r.applicant.invite));
          U.toast(`${r.applicant.name} is extension ${r.applicant.ext}. Their link is copied: send it to them.`, 'ok');
          draw();
        } catch (e) { U.toast(e.message, 'error'); }
      };
      const draw = async () => {
        let list;
        try { list = (await API.post('/api/applicants')).applicants; } catch (e) { return U.toast(e.message, 'error'); }
        const box = el.querySelector('#apList'); if (!box) return;
        if (!list.length) { box.innerHTML = '<div class="empty">No applicants yet. Add one above.</div>'; return; }
        const LINK = { unused: ['blue', 'Not opened yet'], 'in-session': ['green', 'In session'], used: ['', 'Completed (link used)'], expired: ['amber', 'Expired'], closed: ['', 'Ended'] };
        box.innerHTML = `<table class="t"><thead><tr><th>Ext</th><th>Applicant</th><th>One-time link</th><th>Calls</th><th>Avg score</th><th>Last seen</th><th></th></tr></thead><tbody>
          ${list.map((a) => {
            const [c, label] = LINK[a.link] || ['', a.link];
            return `<tr><td class="mono"><b>${esc(a.ext)}</b></td><td><b>${esc(a.name)}</b>${a.invitedAs && a.invitedAs !== a.name ? `<div class="tiny muted">invited as ${esc(a.invitedAs)}</div>` : ''}<div class="tiny muted">added by ${esc(a.createdBy || '—')}</div></td>
            <td><span class="badge ${c}">${label}</span>
              ${a.link === 'unused' ? `<div class="linkbox" style="margin-top:4px"><input type="text" readonly value="${esc(App.inviteLink(a.invite))}"><button class="btn small" data-copy="${esc(a.invite)}">Copy</button></div><div class="tiny muted">Unused link valid until ${esc(U.when(a.inviteExp))}</div>` : ''}
              ${a.link === 'in-session' ? `<div class="tiny muted">Opened ${esc(U.when(a.usedAt))} · session until ${esc(U.when(a.sessionExp))}</div>` : ''}
              ${a.link === 'used' ? `<div class="tiny muted">Opened ${esc(U.when(a.usedAt))}</div>` : ''}</td>
            <td>${a.calls || 0}</td><td>${a.avg != null ? (Math.round(a.avg * 10) / 10) + ' / 5' : '—'}</td><td class="small">${a.lastSeen ? esc(U.when(a.lastSeen)) : '<span class="muted">never</span>'}</td>
            <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-renew="${esc(a.id)}">↻ New link</button>
              ${a.link === 'unused' || a.link === 'in-session' ? `<button class="btn small" data-close="${esc(a.id)}">⛔ ${a.link === 'unused' ? 'Cancel link' : 'End session'}</button>` : ''}
              <a class="btn small" href="#/calls/${esc(a.id)}">Calls</a>
              ${App.isAdmin() ? `<button class="btn small red" data-del="${esc(a.id)}" title="Delete the applicant, their calls and recordings">🗑</button>` : ''}</td></tr>`;
          }).join('')}</tbody></table>`;
        box.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => App.copy(App.inviteLink(b.dataset.copy)); });
        box.querySelectorAll('[data-renew]').forEach((b) => { b.onclick = async () => {
          if (!confirm('Make a new one-time link? The old link stops working and any open session ends.')) return;
          try { const r = await API.post('/api/applicants/renew', { id: b.dataset.renew }); await App.copy(App.inviteLink(r.applicant.invite)); draw(); } catch (e) { U.toast(e.message, 'error'); }
        }; });
        box.querySelectorAll('[data-close]').forEach((b) => { b.onclick = async () => {
          if (!confirm('End this applicant\'s access? They are signed out and need a new link to come back.')) return;
          try { await API.post('/api/applicants/archive', { id: b.dataset.close, archived: true }); draw(); } catch (e) { U.toast(e.message, 'error'); }
        }; });
        box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
          if (!confirm('Delete this applicant, every call of theirs and the recordings? This can\'t be undone.')) return;
          try { const r = await API.post('/api/admin/applicant/delete', { id: b.dataset.del }); U.toast(`Deleted, with ${r.calls} call(s).`, 'ok'); draw(); } catch (e) { U.toast(e.message, 'error'); }
        }; });
      };
      draw();
    },

    async calls(el) {
      const applicantId = App.route.arg;
      el.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">🗂 Call Logs</h2><span class="spacer"></span>
        ${applicantId ? '<a class="btn small" href="#/calls">Show every applicant</a>' : ''}<button class="btn small" id="csv">⬇ Export CSV</button>
        ${App.isAdmin() ? '<button class="btn small red" id="delSel" disabled>🗑 Delete selected</button><button class="btn small red" id="delAll">🗑 Delete all shown</button>' : ''}</div></div>
        <div class="card"><div class="tablewrap" id="callList"><div class="empty">Loading…</div></div></div>`;
      let calls;
      try { calls = (await API.post('/api/calls', applicantId ? { applicantId, limit: 500 } : { limit: 500 })).calls; } catch (e) { return U.toast(e.message, 'error'); }
      const box = el.querySelector('#callList');
      if (!calls.length) box.innerHTML = '<div class="empty">No calls yet.</div>';
      const adm = App.isAdmin();
      if (calls.length) box.innerHTML = `<table class="t"><thead><tr>${adm ? '<th><input type="checkbox" id="selAll" title="Select all"></th>' : ''}<th>When</th><th>Applicant</th><th>Call</th><th>Status</th><th>Length</th><th>Final (J)</th><th>Assessment</th><th></th></tr></thead><tbody>
        ${calls.map((c) => `<tr class="click" data-id="${esc(c.id)}">${adm ? `<td class="nogo"><input type="checkbox" class="sel" value="${esc(c.id)}"></td>` : ''}<td class="small">${esc(U.when(c.createdAt))}</td><td><b>${esc(c.applicantName)}</b></td>
          <td>${c.mode === 'ai' ? '<span class="badge violet">🤖 AGENT CALLER</span> ' : '<span class="badge blue">🎙 LIVE</span> '}${esc(c.title)}<div class="tiny muted">by ${esc(c.hr)}</div></td>
          <td>${App.statusBadge(c.status)}</td><td class="mono">${c.talkMs ? U.dur(c.talkMs) : '—'}</td><td>${c.scores && c.scores.J ? `<b>${c.scores.J}</b> / 5` : c.avg != null ? `${c.avg} / 5 <span class="tiny muted">(A–I avg)</span>` : '—'}${c.scores && c.scores.J && c.avg != null ? `<div class="tiny muted">A–I avg ${c.avg}</div>` : ''}</td><td>${esc(c.verdict || '—')}</td>
          <td class="${adm ? 'nogo' : ''}">${c.recording ? '🎧' : ''}${c.noteSubmitted ? ' 📝' : ''}${adm ? ` <button class="btn small red" data-del1="${esc(c.id)}" title="Delete this call and its recording">🗑</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = (ev) => { if (!ev.target.closest('.nogo')) App.nav('#/call/' + tr.dataset.id); }; });
      if (adm) {
        // 🗑 Removing call logs: a row, the ticked rows, or every call shown. Calls still on the line are kept.
        const del = async (ids, what) => {
          if (!ids.length || !confirm(`Delete ${what} and the recording${ids.length > 1 ? 's' : ''}? This can't be undone.`)) return;
          try {
            const r = await API.post('/api/admin/calls/delete', { ids });
            U.toast(`Deleted ${r.deleted} call${r.deleted === 1 ? '' : 's'}.${r.skipped ? ` ${r.skipped} still on the line ${r.skipped === 1 ? 'was' : 'were'} kept.` : ''}`, 'ok');
            Pages.calls(el);
          } catch (e) { U.toast(e.message, 'error'); }
        };
        const picked = () => [...box.querySelectorAll('.sel:checked')].map((x) => x.value);
        const sync = () => { el.querySelector('#delSel').disabled = !picked().length; el.querySelector('#delSel').textContent = `🗑 Delete selected${picked().length ? ` (${picked().length})` : ''}`; };
        box.querySelectorAll('.sel').forEach((x) => { x.onchange = sync; });
        const all = box.querySelector('#selAll');
        if (all) all.onchange = () => { box.querySelectorAll('.sel').forEach((x) => { x.checked = all.checked; }); sync(); };
        box.querySelectorAll('[data-del1]').forEach((b) => { b.onclick = () => del([b.dataset.del1], 'this call'); });
        el.querySelector('#delSel').onclick = () => del(picked(), `${picked().length} selected call${picked().length > 1 ? 's' : ''}`);
        el.querySelector('#delAll').onclick = () => del(calls.map((c) => c.id), `all ${calls.length} call${calls.length > 1 ? 's' : ''} shown${applicantId ? ' for this applicant' : ''}`);
        el.querySelector('#delAll').disabled = !calls.length;
      }
      el.querySelector('#csv').onclick = () => {
        const R = App.cfg.rubric || [];
        const rows = [['When', 'Applicant', 'Type', 'Call', 'HR', 'Status', 'Length (s)'].concat(R.map((x) => `${x.k}. ${x.name}`), ['A–I average', 'Final assessment'])]
          .concat(calls.map((c) => [new Date(c.createdAt).toISOString(), c.applicantName, c.mode === 'ai' ? 'Agent caller' : 'Live', c.title, c.hr, c.status, c.talkMs ? Math.round(c.talkMs / 1000) : '']
            .concat(R.map((x) => (c.scores || {})[x.k] || ''), [c.avg == null ? '' : c.avg, c.verdict || ''])));
        const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
        a.download = `hr-mock-calls-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      };
    },

    async call(el, id) {
      el.innerHTML = '<div class="empty">Loading…</div>';
      let c;
      try { c = (await API.post('/api/call', { id })).call; } catch (e) { el.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
      const m = c.metrics || {}, s = c.scenario || {}, rv = c.review || {};
      const holds = (m.holds || []).length, tx = m.transfers || [];
      el.innerHTML = `<div class="card"><div class="row"><a class="btn small" href="#/calls">← Call Logs</a><span class="spacer"></span>${App.isAdmin() ? '<button class="btn small red" id="del">🗑 Delete call</button>' : ''}</div>
          <h2 style="margin-top:12px">${c.mode === 'ai' ? '🤖 ' : '🎙 '}${esc(c.title)}</h2>
          <div class="row small"><b>${esc(c.applicantName)}</b><span class="muted">· ${esc(U.when(c.createdAt))} · by ${esc(c.hr)}</span>${App.statusBadge(c.status)}</div>
          <div class="row small muted" style="margin-top:6px">
            ${m.ringMs != null ? `<span>Answered after ${U.rings(m.ringMs)} ring(s)</span>` : ''}${m.talkMs ? `<span>· Call ${U.dur(m.talkMs)}</span>` : ''}
            <span>· ${holds} hold(s)</span>${tx.length ? `<span>· Transfers: ${tx.map((x) => esc(`${x.to} (${x.result || '—'})`)).join(', ')}</span>` : ''}
            ${m.endedBy ? `<span>· Ended by ${esc(m.endedBy === 'hr' || m.endedBy === 'caller' ? 'the caller' : m.endedBy)}${m.endReason ? ' (' + esc(m.endReason) + ')' : ''}</span>` : ''}</div></div>
        <div class="cols2">
          <div>
            <div class="card"><h3>🎧 Recording</h3><div id="recBox">${c.recording ? '<button class="btn small" id="loadRec">▶ Load the recording</button>' : '<p class="muted small">No recording for this call.</p>'}</div></div>
            <div class="card"><h3>📝 The applicant's note</h3>${App.noteHtml(c.note)}${c.noteSubmittedAt ? `<p class="tiny muted">Submitted ${esc(U.when(c.noteSubmittedAt))}</p>` : '<p class="tiny muted">Not submitted.</p>'}</div>
            ${s.persona || s.opening || (s.goals || []).length ? `<div class="card"><h3>🎭 The caller</h3>${s.opening ? `<p><b>Opening:</b> ${esc(s.opening)}</p>` : ''}${s.persona ? `<div class="script">${esc(s.persona)}</div>` : ''}${(s.goals || []).length ? `<h4 style="margin-top:10px">What a good call does</h4><ul>${s.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}</div>` : ''}
          </div>
          <div>
            <div class="card"><h3>📋 Scoring matrix</h3><div id="scBox"></div></div>
            ${c.mode === 'ai' ? `<div class="card"><h3>💬 Transcript</h3><div class="transcript">${App.transcriptHtml(c.transcript)}</div></div>` : ''}
          </div>
        </div>`;
      App.scorecard(el.querySelector('#scBox'), id, Object.assign({}, rv));
      if (el.querySelector('#del')) el.querySelector('#del').onclick = async () => {
        if (!confirm('Delete this call and its recording? This can\'t be undone.')) return;
        try { await API.post('/api/call/delete', { id }); App.nav('#/calls'); } catch (e) { U.toast(e.message, 'error'); }
      };
      const lr = el.querySelector('#loadRec');
      if (lr) lr.onclick = async () => {
        try {
          const blob = await API.getBlob('/api/recording/get', { id });
          const url = URL.createObjectURL(blob), ext = (blob.type.split('/')[1] || 'webm').replace('mpeg', 'mp3');
          el.querySelector('#recBox').innerHTML = `<audio controls src="${url}" style="width:100%"></audio>
            <div class="row" style="margin-top:8px"><a class="btn small" href="${url}" download="${esc(c.applicantName.replace(/[^\w]+/g, '_'))}_${esc(c.id)}.${ext}">⬇ Download</a>
            <span class="tiny muted">Kept until ${esc(U.when(c.recording.expires))}</span></div>`;
        } catch (e) { U.toast(e.message, 'error'); }
      };
    }
  };

  /* =========================================================
     🛡 Admin (the admin passphrase only): the system on its own,
     apart from the training platform.
       👤 HR accounts   who can sign in to interview, each with a password
       ⚙️ Settings      how long a one-time link and a session last
       🩺 Status        what's set up (TURN, the agent caller, recordings)
     Deleting applicants is on 👥 Applicants (🗑), admin only.
     ========================================================= */
  const Admin = {
    async render(el) {
      el.innerHTML = '<div class="empty">Loading…</div>';
      let d;
      try { d = await API.post('/api/admin/overview'); } catch (e) { el.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
      const st = d.stats, set = d.setup, ok = (v) => v ? '<span class="badge green">On</span>' : '<span class="badge amber">Off</span>';
      el.innerHTML = `<div class="card"><h2>🛡 Admin</h2><p class="muted small">LSH HR Mock Calls runs on its own, apart from the LSH training platform: its own sign-in, its own HR accounts and one-time links for applicants.</p>
          <div class="row small" style="gap:18px"><span><b>${st.applicants}</b> applicants</span><span><b>${st.online}</b> applicant phones open</span><span><b>${st.hrOnline}</b> HR online</span>
            <span><b>${st.liveNow}</b> calls now</span><span><b>${st.calls}</b> calls in all</span><span><b>${st.unscored}</b> not scored</span><span><b>${st.hrUsers}</b> HR accounts</span></div></div>
        <div class="cols2">
          <div>
            <div class="card"><h3>👤 Add or update an HR account</h3>
              <form id="hrSave">
                <label class="f" for="uName">Name (shown on calls)</label><input type="text" id="uName" maxlength="40" required>
                <label class="f" for="uUser">Username</label><input type="text" id="uUser" maxlength="30" required autocomplete="off" placeholder="e.g. jsmith">
                <label class="f" for="uPass">Password (at least 8 characters; leave empty to keep it)</label><input type="password" id="uPass" autocomplete="new-password">
                <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">💾 Save account</button></div></form></div>
            <div class="card"><h3>⚙️ Settings</h3>
              <form id="setSave">
                <label class="f" for="sLink">An unopened one-time link works for (hours)</label><input type="number" id="sLink" min="1" max="720" value="${d.settings.linkHours}">
                <label class="f" for="sSess">An applicant's session lasts (hours, after the link is opened)</label><input type="number" id="sSess" min="1" max="24" value="${d.settings.sessionHours}">
                <div class="row" style="margin-top:12px"><button class="btn primary" type="submit">💾 Save settings</button></div></form></div>
            <div class="card"><h3>🩺 Status</h3><table class="t"><tbody>
              <tr><td>TURN relay (calls through strict networks)</td><td>${ok(set.turn)}${set.turnError ? `<div class="tiny muted">${esc(set.turnError)}</div>` : ''}</td></tr>
              <tr><td>🤖 Agent caller (Gemini keys)</td><td>${ok(set.ai)} <span class="tiny muted">up to ${set.aiMinutes} min a call</span></td></tr>
              <tr><td>Recordings (LSH_KV)</td><td>${ok(set.recordings)} <span class="tiny muted">kept ${set.recordingDays} days</span></td></tr>
              <tr><td>SESSION_SECRET</td><td>${ok(set.sessionSecret)} <span class="tiny muted">${set.sessionSecret ? '' : 'tokens are signed with the admin passphrase'}</span></td></tr></tbody></table></div>
          </div>
          <div class="card"><h3>👤 HR accounts</h3><p class="tiny muted">HR interviewers sign in with their username and password. The admin signs in with the admin passphrase (ADMIN_PASSPHRASE).</p>
            <div class="tablewrap">${d.hrUsers.length ? `<table class="t"><thead><tr><th>Name</th><th>Username</th><th>Last sign-in</th><th>State</th><th></th></tr></thead><tbody>
              ${d.hrUsers.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.username)}</td><td class="small">${u.last_login ? esc(U.when(u.last_login)) : '<span class="muted">never</span>'}</td>
                <td>${u.disabled ? '<span class="badge">Disabled</span>' : '<span class="badge green">Active</span>'}</td>
                <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-edit="${esc(u.username)}" data-name="${esc(u.name)}">✎</button>
                  <button class="btn small" data-toggle="${esc(u.username)}" data-on="${u.disabled ? 1 : 0}">${u.disabled ? 'Enable' : 'Disable'}</button>
                  <button class="btn small red" data-rm="${esc(u.username)}">🗑</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No HR accounts yet. Add one on the left.</p>'}</div></div>
        </div>`;
      const again = () => Admin.render(el);
      el.querySelector('#hrSave').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          await API.post('/api/admin/hr/save', { name: el.querySelector('#uName').value, username: el.querySelector('#uUser').value, password: el.querySelector('#uPass').value });
          U.toast('Account saved.', 'ok'); again();
        } catch (e) { U.toast(e.message, 'error'); }
      };
      el.querySelector('#setSave').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const r = await API.post('/api/admin/settings', { settings: { linkHours: el.querySelector('#sLink').value, sessionHours: el.querySelector('#sSess').value } });
          Object.assign(App.cfg.features, r.settings);
          U.toast('Settings saved.', 'ok'); again();
        } catch (e) { U.toast(e.message, 'error'); }
      };
      el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { el.querySelector('#uName').value = b.dataset.name; el.querySelector('#uUser').value = b.dataset.edit; el.querySelector('#uPass').focus(); }; });
      el.querySelectorAll('[data-toggle]').forEach((b) => { b.onclick = async () => {
        try { await API.post('/api/admin/hr/save', { username: b.dataset.toggle, disabled: b.dataset.on !== '1' }); again(); } catch (e) { U.toast(e.message, 'error'); }
      }; });
      el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => {
        if (!confirm(`Delete the account ${b.dataset.rm}? Their calls stay in the Call Logs.`)) return;
        try { await API.post('/api/admin/hr/delete', { username: b.dataset.rm }); again(); } catch (e) { U.toast(e.message, 'error'); }
      }; });
    }
  };

  window.App = App;
  window.Pages = Pages;
  window.Admin = Admin;
})();
