/* =========================================================
   The app shell: sign-in, the top bar, the phone line to the
   Switchboard, and HR's pages other than the console.
   Two views, each its own page and its own sign-in (js/api.js):
     /admin      Admin & HR (admin.html): the staff sign-in, then
     HR          #/console (js/hr.js) · #/applicants · #/calls · #/call/<id>
     Admin       all of HR's pages, and #/admin (HR accounts, settings, status)
     /           the applicant's view (index.html): #/phone (js/applicant.js), signed in once by their one-time link
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
      // 🔗 An applicant's one-time link: ?invite=<code> signs them in (the link is then used up) and leaves the address bar.
      const q = new URLSearchParams(location.search);
      const invite = q.get('invite');
      // An interview link always opens the applicant's view, never Admin & HR.
      if (invite && API.view === 'staff') { location.replace('/?invite=' + encodeURIComponent(invite)); return; }
      if (invite) {
        history.replaceState(null, '', location.pathname + '#/phone');
        try { API.signOut(); API.signIn(await API.post('/api/auth/invite', { code: invite })); }
        catch (e) { return App.gate(e.message); }
      }
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
    // The sign-in page: on / the applicant's (no sign-in form: their link signs them in); on /admin, HR's and the admin's.
    gate(error) {
      document.getElementById('nav').innerHTML = '';
      document.getElementById('who').innerHTML = '';
      const err = error ? `<p class="badge red" style="display:block;padding:8px 10px;border-radius:10px;white-space:normal">${esc(error)}</p>` : '';
      const logo = '<img class="gate-logo" src="lsh-logo-dark.png" alt="Legal Support Help" width="646" height="397">';
      if (API.view !== 'staff') {
        $app().innerHTML = `<div class="gate"><div class="card">${logo}<h1>Your interview mock call</h1>${err}
          <p>Open the <b>interview link</b> HR sent you, in Chrome or Edge on a computer, with a headset.</p>
          <p class="muted small">The link works <b>once</b>: it signs you in to your phone for this interview. Keep that browser tab open until HR tells you the interview is over. If the link was already used or has expired, ask HR for a new one.</p></div></div>`;
        return;
      }
      $app().innerHTML = `<div class="gate"><div class="card">${logo}<h1>Admin &amp; HR sign-in</h1>${err}
        <form id="hrForm">
          <label class="f" for="hrName">Username</label><input type="text" id="hrName" autocomplete="username" maxlength="40" required>
          <label class="f" for="hrPass">Password</label><input type="password" id="hrPass" autocomplete="current-password" required>
          <p class="tiny muted" style="margin:6px 0 0">Admin: type your name and the admin passphrase.</p>
          <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Sign in</button></div>
        </form></div></div>`;
      try { document.getElementById('hrName').value = localStorage.getItem('hrmc_name') || ''; } catch (e) {}
      document.getElementById('hrForm').onsubmit = async (ev) => {
        ev.preventDefault();
        const name = document.getElementById('hrName').value.trim(), password = document.getElementById('hrPass').value;
        try {
          API.signIn(await API.post('/api/auth/staff', { username: name, password }));
          try { localStorage.setItem('hrmc_name', name); } catch (e) {}
          location.hash = '#/console';
          location.reload();
        } catch (e) { U.toast(e.message, 'error'); }
      };
    },
    signOut() {
      if ((window.HR && HR.busy()) || (window.Applicant && Applicant.busy())) { if (!confirm('You are on a call. Sign out anyway?')) return; }
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
    inviteLink(code) { return `${location.origin}/?invite=${encodeURIComponent(code)}`; },
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
          <div style="flex:2;min-width:180px"><label class="f" for="apName">Applicant's name</label><input type="text" id="apName" maxlength="60" required></div>
          <div style="flex:2;min-width:160px"><label class="f" for="apPos">Position applied for</label><input type="text" id="apPos" maxlength="60" placeholder="e.g. Receptionist"></div>
          <button class="btn primary" type="submit">＋ Add &amp; get link</button>
        </form></div>
        <div class="card"><div class="tablewrap" id="apList"><div class="empty">Loading…</div></div></div>`;
      el.querySelector('#addAp').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          const r = await API.post('/api/applicants/create', { name: el.querySelector('#apName').value, position: el.querySelector('#apPos').value });
          el.querySelector('#apName').value = ''; el.querySelector('#apPos').value = '';
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
        const LINK = { unused: ['blue', 'Not opened yet'], 'in-session': ['green', 'In session'], used: ['', 'Used'], expired: ['amber', 'Expired'], closed: ['', 'Ended'] };
        box.innerHTML = `<table class="t"><thead><tr><th>Ext</th><th>Applicant</th><th>Position</th><th>One-time link</th><th>Calls</th><th>Avg score</th><th>Last seen</th><th></th></tr></thead><tbody>
          ${list.map((a) => {
            const [c, label] = LINK[a.link] || ['', a.link];
            return `<tr><td class="mono"><b>${esc(a.ext)}</b></td><td><b>${esc(a.name)}</b><div class="tiny muted">added by ${esc(a.createdBy || '—')}</div></td><td>${esc(a.position || '—')}</td>
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
        ${applicantId ? '<a class="btn small" href="#/calls">Show every applicant</a>' : ''}<button class="btn small" id="csv">⬇ Export CSV</button></div></div>
        <div class="card"><div class="tablewrap" id="callList"><div class="empty">Loading…</div></div></div>`;
      let calls;
      try { calls = (await API.post('/api/calls', applicantId ? { applicantId, limit: 500 } : { limit: 500 })).calls; } catch (e) { return U.toast(e.message, 'error'); }
      const box = el.querySelector('#callList');
      if (!calls.length) box.innerHTML = '<div class="empty">No calls yet.</div>';
      else box.innerHTML = `<table class="t"><thead><tr><th>When</th><th>Applicant</th><th>Call</th><th>Status</th><th>Length</th><th>Score</th><th>Verdict</th><th></th></tr></thead><tbody>
        ${calls.map((c) => `<tr class="click" data-id="${esc(c.id)}"><td class="small">${esc(U.when(c.createdAt))}</td><td><b>${esc(c.applicantName)}</b><div class="tiny muted">${esc(c.position || '')}</div></td>
          <td>${c.mode === 'ai' ? '<span class="badge violet">🤖 AGENT CALLER</span> ' : '<span class="badge blue">🎙 LIVE</span> '}${esc(c.title)}<div class="tiny muted">by ${esc(c.hr)}</div></td>
          <td>${App.statusBadge(c.status)}</td><td class="mono">${c.talkMs ? U.dur(c.talkMs) : '—'}</td><td>${c.score != null ? c.score + ' / 5' : '—'}</td><td>${esc(c.verdict || '—')}</td>
          <td>${c.recording ? '🎧' : ''}${c.noteSubmitted ? ' 📝' : ''}</td></tr>`).join('')}</tbody></table>`;
      box.querySelectorAll('tr[data-id]').forEach((tr) => { tr.onclick = () => App.nav('#/call/' + tr.dataset.id); });
      el.querySelector('#csv').onclick = () => {
        const rows = [['When', 'Applicant', 'Position', 'Type', 'Call', 'HR', 'Status', 'Length (s)', 'Score (1-5)', 'Verdict']]
          .concat(calls.map((c) => [new Date(c.createdAt).toISOString(), c.applicantName, c.position || '', c.mode === 'ai' ? 'Agent caller' : 'Live', c.title, c.hr, c.status, c.talkMs ? Math.round(c.talkMs / 1000) : '', c.score == null ? '' : c.score, c.verdict || '']));
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
          <div class="row small"><b>${esc(c.applicantName)}</b>${c.position ? `<span class="muted">· ${esc(c.position)}</span>` : ''}<span class="muted">· ${esc(U.when(c.createdAt))} · by ${esc(c.hr)}</span>${App.statusBadge(c.status)}</div>
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
            <div class="card"><h3>🧑‍💼 HR assessment</h3><p class="tiny muted">Only HR sees this.</p>
              <label class="f">Score (1–5)</label><div class="stars" id="stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" class="${rv.score === n ? 'on' : ''}">${n}</button>`).join('')}</div>
              <label class="f" for="verdict">Verdict</label><select id="verdict"><option value="">—</option>${['Pass', 'Hold', 'Fail'].map((v) => `<option ${rv.verdict === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
              <label class="f" for="notes">Interview notes</label><textarea id="notes" rows="7">${esc(rv.notes || '')}</textarea>
              <div class="row" style="margin-top:10px"><button class="btn primary" id="saveRv">💾 Save</button>${rv.at ? `<span class="tiny muted">Saved ${esc(U.when(rv.at))} by ${esc(rv.by)}</span>` : ''}</div></div>
            ${c.mode === 'ai' ? `<div class="card"><h3>💬 Transcript</h3><div class="transcript">${App.transcriptHtml(c.transcript)}</div></div>` : ''}
          </div>
        </div>`;
      let score = rv.score || null;
      el.querySelectorAll('#stars button').forEach((b) => { b.onclick = () => { score = Number(b.dataset.n); el.querySelectorAll('#stars button').forEach((x) => x.classList.toggle('on', Number(x.dataset.n) === score)); }; });
      el.querySelector('#saveRv').onclick = async () => {
        try { await API.post('/api/call/update', { id, review: { score, verdict: el.querySelector('#verdict').value, notes: el.querySelector('#notes').value } }); U.toast('Saved.', 'ok'); }
        catch (e) { U.toast(e.message, 'error'); }
      };
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
