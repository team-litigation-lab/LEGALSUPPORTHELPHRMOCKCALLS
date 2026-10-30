/* =========================================================
   The app shell: sign-in, the top bar, the phone line to the
   Switchboard, and HR's pages other than the console.
     HR          #/console (js/hr.js) · #/applicants · #/calls · #/call/<id>
     Applicant   #/phone (js/applicant.js), signed in by their invite link
   ========================================================= */
(function () {
  'use strict';
  const esc = U.esc;
  const $app = () => document.getElementById('app');

  const App = {
    cfg: null, board: null, route: { name: '', arg: '' },
    isHR() { return API.me && API.me.role === 'h'; },

    async boot() {
      // 🔗 An applicant's invite link: ?invite=<code> signs them in, then leaves the address bar.
      const q = new URLSearchParams(location.search);
      const invite = q.get('invite');
      if (invite) {
        history.replaceState(null, '', location.pathname + '#/phone');
        try { API.signOut(); API.signIn(await API.post('/api/auth/invite', { code: invite })); }
        catch (e) { return App.gate(e.message); }
      }
      if (!API.token) return App.gate();
      try { App.cfg = await API.post('/api/config'); }
      catch (e) { return App.gate(e.status === 401 ? '' : e.message); }
      App.connect();
      window.addEventListener('hashchange', () => App.render());
      App.render();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    },

    /* ---------- sign-in ---------- */
    gate(error) {
      document.getElementById('nav').innerHTML = '';
      document.getElementById('who').innerHTML = '';
      $app().innerHTML = `<div class="gate"><div class="card">
        <h1>LSH HR Mock Calls</h1>
        ${error ? `<p class="badge red" style="display:block;padding:8px 10px;border-radius:10px">${esc(error)}</p>` : ''}
        <p class="muted"><b>Applicants:</b> open the interview link HR sent you. It signs you in to your phone.</p>
        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
        <h3>HR sign-in</h3>
        <form id="hrForm">
          <label class="f" for="hrName">Your name</label><input type="text" id="hrName" autocomplete="name" maxlength="40" required>
          <label class="f" for="hrPass">HR passphrase</label><input type="password" id="hrPass" autocomplete="current-password" required>
          <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Sign in</button></div>
        </form></div></div>`;
      try { document.getElementById('hrName').value = localStorage.getItem('hrmc_name') || ''; } catch (e) {}
      document.getElementById('hrForm').onsubmit = async (ev) => {
        ev.preventDefault();
        const name = document.getElementById('hrName').value.trim(), passphrase = document.getElementById('hrPass').value;
        try {
          API.signIn(await API.post('/api/auth/hr', { name, passphrase }));
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
        if (m.code === 4001) { API.signOut(); return App.gate('This interview link was closed by HR.'); }
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
      else if (!['console', 'applicants', 'calls', 'call'].includes(name)) name = 'console';
      App.route = { name, arg: h[1] || '' };
      const items = hr ? [['console', '🎛 Console'], ['applicants', '👥 Applicants'], ['calls', '🗂 Call Logs']] : [['phone', '☎ My phone']];
      document.getElementById('nav').innerHTML = items.map(([k, label]) => `<a href="#/${k}" class="${k === name || (k === 'calls' && name === 'call') ? 'on' : ''}">${label}</a>`).join('');
      const me = API.me || {};
      document.getElementById('who').innerHTML = `<span class="chip">${hr ? '🧑‍💼 HR' : '👤 Applicant'} · ${esc(me.name)}</span><button type="button" id="signOut">Sign out</button>`;
      document.getElementById('signOut').onclick = App.signOut;
      if (name === 'console') return HR.render($app());
      if (name === 'phone') return Applicant.render($app());
      if (name === 'applicants') return Pages.applicants($app());
      if (name === 'calls') return Pages.calls($app());
      if (name === 'call') return Pages.call($app(), App.route.arg);
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
        <p class="muted small">Add an applicant to give them a desk extension and an interview link. They open the link in Chrome or Edge on a computer with a headset; their phone signs in and you can ring it from 🎛 Console. A link works for ${App.cfg.features.inviteDays} days; ↻ New link replaces it, ⛔ Close link signs them out.</p>
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
        box.innerHTML = `<table class="t"><thead><tr><th>Ext</th><th>Applicant</th><th>Position</th><th>Interview link</th><th>Calls</th><th>Avg score</th><th>Last seen</th><th></th></tr></thead><tbody>
          ${list.map((a) => {
            const expired = a.invite_exp < Date.now();
            return `<tr><td class="mono"><b>${esc(a.ext)}</b></td><td><b>${esc(a.name)}</b>${a.archived ? ' <span class="badge">closed</span>' : ''}</td><td>${esc(a.position || '—')}</td>
            <td>${a.archived ? '<span class="muted small">closed</span>' : `<div class="linkbox"><input type="text" readonly value="${esc(App.inviteLink(a.invite))}"><button class="btn small" data-copy="${esc(a.invite)}">Copy</button></div>
              <div class="tiny ${expired ? '' : 'muted'}" style="${expired ? 'color:var(--red)' : ''}">${expired ? 'Expired' : 'Valid until'} ${esc(U.when(a.invite_exp))}</div>`}</td>
            <td>${a.calls || 0}</td><td>${a.avg != null ? (Math.round(a.avg * 10) / 10) + ' / 5' : '—'}</td><td class="small">${a.last_seen ? esc(U.when(a.last_seen)) : '<span class="muted">never</span>'}</td>
            <td class="row" style="flex-wrap:nowrap"><button class="btn small" data-renew="${esc(a.id)}">↻ New link</button>
              ${a.archived ? '' : `<button class="btn small" data-close="${esc(a.id)}">⛔ Close link</button>`}
              <a class="btn small" href="#/calls/${esc(a.id)}">Calls</a></td></tr>`;
          }).join('')}</tbody></table>`;
        box.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => App.copy(App.inviteLink(b.dataset.copy)); });
        box.querySelectorAll('[data-renew]').forEach((b) => { b.onclick = async () => {
          if (!confirm('Make a new link? The old one stops working.')) return;
          try { const r = await API.post('/api/applicants/renew', { id: b.dataset.renew }); await App.copy(App.inviteLink(r.applicant.invite)); draw(); } catch (e) { U.toast(e.message, 'error'); }
        }; });
        box.querySelectorAll('[data-close]').forEach((b) => { b.onclick = async () => {
          if (!confirm('Close this link? The applicant is signed out and can\'t open the phone again until you make a new link.')) return;
          try { await API.post('/api/applicants/archive', { id: b.dataset.close, archived: true }); draw(); } catch (e) { U.toast(e.message, 'error'); }
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
      el.innerHTML = `<div class="card"><div class="row"><a class="btn small" href="#/calls">← Call Logs</a><span class="spacer"></span><button class="btn small red" id="del">🗑 Delete call</button></div>
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
      el.querySelector('#del').onclick = async () => {
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

  window.App = App;
  window.Pages = Pages;
})();
