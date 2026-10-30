/* =========================================================
   ☎ The applicant's phone
   ---------------------------------------------------------
   Rings when HR calls (live) or sends the 🤖 agent caller. The
   applicant answers and handles the call like a real one:
   Mute, Hold (the caller hears hold music), Transfer (to an
   extension in the directory), Hang up, and the call note,
   which HR sees as it's typed. After the call they submit the note.
   On an agent call this page runs the conversation (js/ai-call.js),
   streams the transcript to HR, and uploads the recording.
   ========================================================= */
(function () {
  'use strict';
  const esc = U.esc;
  const remote = () => document.getElementById('remoteAudio');
  const RING_OUT = 45000;

  const Applicant = { p: null, status: 'available', hrOnline: 0 };
  Applicant.busy = () => !!(Applicant.p && ['ringing', 'connecting', 'live'].includes(Applicant.p.status));
  let el = null;
  const on = () => el && document.body.contains(el);
  const active = (p) => p && ['ringing', 'connecting', 'live'].includes(p.status);

  /* ---------- the page ---------- */
  Applicant.render = function (root) {
    el = root;
    el.innerHTML = `<div class="cols2">
      <div>
        <div class="phone" id="phone"><div class="screen" id="screen"></div><div id="keys"></div><div id="transferBox"></div></div>
        <div class="card" id="audioBox" style="margin-top:16px"></div>
      </div>
      <div id="side"></div>
    </div>`;
    App.audioCheck(el.querySelector('#audioBox'));
    renderAll();
  };
  function renderAll() { renderScreen(); renderKeys(); renderTransfer(); renderSide(); flashTitle(); }

  function renderScreen() {
    const box = on() && el.querySelector('#screen'); if (!box) return;
    const p = Applicant.p, me = API.me || {}, cfg = App.cfg;
    el.querySelector('#phone').classList.toggle('ringing', !!(p && p.status === 'ringing'));
    if (!p || p.status === 'ended') {
      box.innerHTML = `<div class="line">${esc(cfg.company.name)} · ${esc(cfg.company.line)}</div><div class="big">${esc(me.name || '')}</div>
        <div>Desk extension <b>${esc(cfg.me.ext || '')}</b></div>
        <div class="tags"><span class="tag">${Applicant.status === 'available' ? '● AVAILABLE' : '◌ AWAY'}</span><span class="tag">${Applicant.hrOnline ? '🧑‍💼 HR is online' : 'Waiting for HR'}</span></div>`;
      return;
    }
    const state = p.needRejoin ? 'Call in progress' : { ringing: '📞 Incoming call…', connecting: 'Connecting…', live: 'On the call' }[p.status] || '';
    const time = p.status === 'live' && p.answeredAt ? U.since(p.answeredAt) : '';
    box.innerHTML = `<div class="line">${esc(p.lineLabel || cfg.company.line)} ${esc(p.lineNumber || '')}</div>
      <div class="big">${esc(p.callerId.name)}</div><div>${esc(p.callerId.number || '')}</div>
      <div style="margin-top:6px">${esc(state)} <span id="clock">${esc(time)}</span></div>
      <div class="tags">${p.rec ? '<span class="tag rec">● RECORDED</span>' : ''}${p.muted ? '<span class="tag">MUTED</span>' : ''}${p.held ? '<span class="tag">ON HOLD</span>' : ''}
        ${VoIP.Speaker.on ? '<span class="tag">🔊 SPEAKER</span>' : ''}${p.peerLost ? '<span class="tag">caller reconnecting…</span>' : ''}${p.typed ? '<span class="tag">TYPED CALL</span>' : ''}</div>`;
  }
  setInterval(() => { const p = Applicant.p; if (on() && p && p.status === 'live') { const c = el.querySelector('#clock'); if (c) c.textContent = U.since(p.answeredAt); } }, 1000);

  function renderKeys() {
    const box = on() && el.querySelector('#keys'); if (!box) return;
    const p = Applicant.p;
    if (p && p.needRejoin) { box.innerHTML = '<div class="callkeys"><button class="pkey go" id="kRejoin" style="grid-column:1/-1">🔊 Reconnect the call</button></div>'; box.querySelector('#kRejoin').onclick = rejoin; return; }
    if (p && p.status === 'ringing') {
      box.innerHTML = '<div class="callkeys"><button class="pkey go" id="kAns">📞 Answer</button><button class="pkey end" id="kDec">✖ Decline</button></div>';
      box.querySelector('#kAns').onclick = answer; box.querySelector('#kDec').onclick = decline;
      return;
    }
    if (p && (p.status === 'connecting' || p.status === 'live')) {
      const live = p.status === 'live';
      box.innerHTML = `<div class="keys">
          <button class="pkey ${p.muted ? 'on' : ''}" id="kMute" ${live ? '' : 'disabled'}>${p.muted ? '🔇 Unmute' : '🎙 Mute'}</button>
          <button class="pkey ${p.held ? 'on' : ''}" id="kHold" ${live ? '' : 'disabled'}>${p.held ? '▶ Resume' : '⏸ Hold'}</button>
          <button class="pkey ${p.showDir ? 'on' : ''}" id="kTx" ${live && !p.transfer ? '' : 'disabled'}>↪ Transfer</button>
          <button class="pkey ${VoIP.Speaker.on ? 'on' : ''}" id="kSpk" style="grid-column:span 3">🔊 Speaker</button></div>
        ${p.typed ? '<form id="typeForm" class="row" style="margin-top:10px"><input type="text" id="typeIn" placeholder="Type what you say…" autocomplete="off" style="flex:1"><button class="pkey" type="submit">Send</button></form>' : ''}
        <div class="callkeys"><button class="pkey end" id="kEnd" style="grid-column:1/-1">📞 Hang up</button></div>`;
      box.querySelector('#kMute').onclick = toggleMute;
      box.querySelector('#kHold').onclick = () => toggleHold();
      box.querySelector('#kTx').onclick = () => { p.showDir = !p.showDir; renderKeys(); renderTransfer(); };
      box.querySelector('#kSpk').onclick = async () => { const r = await VoIP.Speaker.toggle(); if (r.note) U.toast(r.note); renderKeys(); renderScreen(); };
      box.querySelector('#kEnd').onclick = hangup;
      const tf = box.querySelector('#typeForm');
      if (tf) tf.onsubmit = (ev) => { ev.preventDefault(); const i = tf.querySelector('#typeIn'); const v = i.value.trim(); if (v && !AiCall.busy()) { AiCall.say(v); i.value = ''; } };
      return;
    }
    box.innerHTML = `<div class="callkeys"><button class="pkey ${Applicant.status === 'available' ? 'on' : ''}" id="kAv">● Available</button><button class="pkey ${Applicant.status === 'away' ? 'on' : ''}" id="kAw">◌ Away</button></div>`;
    box.querySelector('#kAv').onclick = () => setStatus('available');
    box.querySelector('#kAw').onclick = () => setStatus('away');
  }
  function setStatus(s) { Applicant.status = s; App.board.send({ t: 'status', status: s }); renderScreen(); renderKeys(); }

  // ↪ The directory, and what's happening with a transfer.
  function renderTransfer() {
    const box = on() && el.querySelector('#transferBox'); if (!box) return;
    const p = Applicant.p;
    if (!p || p.status !== 'live') { box.innerHTML = ''; return; }
    if (p.transfer) {
      const st = p.transfer.state;
      box.innerHTML = `<div class="opts"><b>↪ ${esc(p.transfer.to)}</b> (ext ${esc(p.transfer.ext)}): ${st === 'ringing' ? 'ringing… the caller is on hold.' : st === 'voicemail' ? 'went to voicemail.' : st === 'no-answer' ? 'no answer.' : esc(st)}
        ${st !== 'connected' ? '<div style="margin-top:8px"><button class="pkey" id="takeBack">↩ Take the caller back</button></div>' : ''}</div>`;
      const b = box.querySelector('#takeBack');
      if (b) b.onclick = () => { if (p.held) toggleHold(); p.transfer = null; renderTransfer(); renderKeys(); };
      return;
    }
    if (!p.showDir) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="opts"><b>📇 Transfer to…</b><div class="list" style="margin-top:8px">${App.cfg.directory.map((d) => `<button class="pkey" data-ext="${esc(d.ext)}" style="text-align:left">${esc(d.ext)} · ${esc(d.name)} <span class="tiny" style="opacity:.7">${esc(d.role)}</span></button>`).join('')}</div></div>`;
    box.querySelectorAll('[data-ext]').forEach((b) => { b.onclick = () => transfer(b.dataset.ext); });
  }

  function renderSide() {
    const box = on() && el.querySelector('#side'); if (!box) return;
    const p = Applicant.p;
    if (!p || p.status === 'ringing' || (p.status === 'ended' && p.noteDone)) {
      box.innerHTML = `<div class="card"><h2>Your interview mock call</h2>
        ${p && p.noteDone ? '<p class="badge green" style="display:inline-block">✔ Your note was sent to HR.</p>' : ''}
        <ol style="padding-left:18px">
          <li>Keep this page open, with a headset on. Use <b>🎧 Audio check</b> to test your microphone.</li>
          <li>Stay <b>● Available</b>. When the phone rings, answer it as an agent of ${esc(App.cfg.company.name)}.</li>
          <li>Handle the call as you would a real one: greet the caller, find out what they need, use <b>Hold</b> or <b>Transfer</b> when it's right.</li>
          <li>Take the call note as you go (it appears here once you answer), and <b>submit</b> it after the call.</li>
        </ol>
        <p class="small muted">Use Chrome or Edge on a computer. Allow the microphone when the browser asks.</p></div>`;
      return;
    }
    const fields = App.cfg.noteFields;
    const done = p.status === 'ended';
    box.innerHTML = `<div class="card"><h2>📝 Call note</h2>${done ? '<p class="small">The call has ended. Finish your note and submit it.</p>' : '<p class="small muted">HR sees this as you type.</p>'}
      <form id="noteForm">${fields.map((f) => `<label class="f" for="n_${f.k}">${esc(f.label)}</label>${f.type === 'textarea'
        ? `<textarea id="n_${f.k}" data-k="${f.k}" rows="3">${esc(p.note[f.k] || '')}</textarea>`
        : `<input type="text" id="n_${f.k}" data-k="${f.k}" value="${esc(p.note[f.k] || '')}">`}`).join('')}
      ${done ? '<div class="row" style="margin-top:12px"><button class="btn primary" type="submit">📨 Submit the note</button></div>' : ''}</form></div>`;
    const form = box.querySelector('#noteForm');
    form.addEventListener('input', (ev) => { const k = ev.target.dataset.k; if (k) { p.note[k] = ev.target.value; sendNote(p); } });
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      try { await API.post('/api/call/update', { id: p.callId, note: p.note, submit: true }); p.noteDone = true; U.toast('Your note was sent to HR.', 'ok'); renderSide(); }
      catch (e) { U.toast(e.message, 'error'); }
    };
  }
  function sendNote(p) { clearTimeout(p.noteTimer); p.noteTimer = setTimeout(() => App.board.send({ t: 'note', callId: p.callId, note: p.note }), 350); }

  /* ---------- ringing ---------- */
  let titleTimer = null;
  function flashTitle() {
    const ringing = Applicant.p && Applicant.p.status === 'ringing';
    clearInterval(titleTimer);
    if (!ringing) { document.title = 'LSH HR Mock Calls'; return; }
    let f = false; titleTimer = setInterval(() => { document.title = (f = !f) ? '📞 Incoming call…' : 'LSH HR Mock Calls'; }, 900);
  }
  function stopAlerts() { Sounds.stop(); clearInterval(titleTimer); document.title = 'LSH HR Mock Calls'; }

  function incoming(m) {
    if (active(Applicant.p)) { App.board.send({ t: 'decline', callId: m.callId, busy: true }); return; }
    Applicant.p = { mode: 'live', callId: m.callId, status: 'ringing', callerId: m.callerId, lineLabel: m.lineLabel, lineNumber: m.lineNumber, rec: !!m.recording, note: {}, muted: false, held: false };
    Sounds.ring();
    if (App.route.name !== 'phone') App.nav('#/phone'); else renderAll();
  }
  function aiIncoming(m) {
    if (active(Applicant.p)) { App.board.send({ t: 'ai-decline', callId: m.callId, reason: 'busy' }); return; }
    const p = Applicant.p = { mode: 'ai', callId: m.callId, status: 'ringing', callerId: m.callerId, lineLabel: m.lineLabel, lineNumber: m.lineNumber, gender: m.gender,
      unavailable: m.unavailable || [], rec: App.cfg.features.recordings, note: {}, muted: false, held: false, lines: [], metrics: { holds: [], transfers: [] } };
    Sounds.ring();
    p.ringTimer = setTimeout(() => { if (Applicant.p === p && p.status === 'ringing') { stopAlerts(); App.board.send({ t: 'ai-decline', callId: p.callId, reason: 'no-answer' }); Applicant.p = null; renderAll(); } }, RING_OUT);
    if (App.route.name !== 'phone') App.nav('#/phone'); else renderAll();
  }

  /* ---------- a live call (HR on the line) ---------- */
  function makeRtc(p, stream, iceServers, gen) {
    if (p.rtc) p.rtc.close();
    p.rtc = new VoIP.RtcCall({
      board: App.board, callId: p.callId, offerer: false, iceServers, stream, gen,
      onRemote: (s) => { const a = remote(); a.srcObject = s; a.muted = !!p.held; a.play().catch(() => {}); },
      onState: (st) => {
        if (Applicant.p !== p) return;
        if (st === 'connected' && p.status === 'connecting') { p.status = 'live'; if (!p.answeredAt) p.answeredAt = Date.now(); renderAll(); }
      }
    });
    if (p.held && p.music) p.rtc.setOutgoing(p.music.track);   // a new connection while the caller is on hold keeps the music
  }

  async function answer() {
    const p = Applicant.p;
    if (!p || p.status !== 'ringing') return;
    stopAlerts();
    clearTimeout(p.ringTimer);
    p.status = 'connecting'; renderAll();
    let stream;
    try { stream = await VoIP.Mic.open(); }
    catch (e) {
      U.toast(e.message, 'error');
      if (p.mode === 'ai') { p.typed = true; }   // no microphone: the agent call runs typed
      else { if (Applicant.p === p) { p.status = 'ringing'; Sounds.ring(); renderAll(); } return; }
    }
    if (p.mode === 'ai') return answerAi(p);
    const servers = await VoIP.ice();
    if (Applicant.p !== p || p.status !== 'connecting') return;
    makeRtc(p, stream, servers, 0);
    App.board.send({ t: 'accept', callId: p.callId });
  }

  // After a reload mid-call: a fresh connection, and HR's console sends a new offer.
  async function rejoin() {
    const p = Applicant.p;
    if (!p || !p.needRejoin) return;
    let stream;
    try { stream = await VoIP.Mic.open(); } catch (e) { return U.toast(e.message, 'error'); }
    const servers = await VoIP.ice();
    p.needRejoin = false;
    if (p.held && !p.music) { p.music = Sounds.holdStream(); remote().muted = true; }
    makeRtc(p, stream, servers, -1);
    App.board.send({ t: 'resume', callId: p.callId });
    App.board.send({ t: 'mute', callId: p.callId, on: false });
    App.board.send({ t: 'signal', callId: p.callId, data: { rejoin: true, gen: -1 } });
    renderAll();
  }

  function onSignal(data) {
    const p = Applicant.p;
    if (!p || p.mode !== 'live' || !p.rtc || !data) return;
    if (data.gen != null && data.gen !== p.rtc.gen) {
      // A new connection from HR (their page reloaded, or they rejoined us).
      if (data.sdp && data.sdp.type === 'offer') makeRtc(p, VoIP.Mic.stream, (VoIP.iceInfo() || {}).servers || [], data.gen);
      else return;
    }
    p.rtc.handle(data);
  }

  function decline() {
    const p = Applicant.p; if (!p || p.status !== 'ringing') return;
    stopAlerts(); clearTimeout(p.ringTimer);
    App.board.send(p.mode === 'ai' ? { t: 'ai-decline', callId: p.callId, reason: 'declined' } : { t: 'decline', callId: p.callId });
    Applicant.p = null; renderAll();
  }

  async function toggleHold(force) {
    const p = Applicant.p; if (!p || p.status !== 'live') return;
    const on = force == null ? !p.held : !!force;
    if (on === p.held) return;
    p.held = on;
    if (p.mode === 'ai') {
      AiCall.hold(on);
      const hs = p.metrics.holds;
      if (on) hs.push({ start: Date.now() }); else if (hs.length && !hs[hs.length - 1].end) hs[hs.length - 1].end = Date.now();
    } else {
      if (on) { p.music = Sounds.holdStream(); await p.rtc.setOutgoing(p.music.track); remote().muted = true; }
      else { await p.rtc.setOutgoing(VoIP.Mic.track()); if (p.music) p.music.stop(); p.music = null; remote().muted = false; }
      // Taking the caller back while the extension still rings cancels the transfer.
      if (!on && p.transfer && p.transfer.state === 'ringing') App.board.send({ t: 'transfer-cancel', callId: p.callId });
      App.board.send({ t: 'hold', callId: p.callId, on });
    }
    if (!on) p.transfer = null;
    renderAll();
  }
  function toggleMute() {
    const p = Applicant.p; if (!p || p.status !== 'live') return;
    p.muted = !p.muted;
    if (p.mode === 'ai') AiCall.mute(p.muted);
    else { const tr = VoIP.Mic.track(); if (tr) tr.enabled = !p.muted; App.board.send({ t: 'mute', callId: p.callId, on: p.muted }); }
    renderKeys(); renderScreen();
  }
  async function transfer(ext) {
    const p = Applicant.p; if (!p || p.status !== 'live') return;
    const d = App.cfg.directory.find((x) => x.ext === ext); if (!d) return;
    p.showDir = false;
    p.transfer = { to: d.name, ext: d.ext, state: 'ringing' };
    if (p.mode === 'ai') {
      p.held = true;
      const tx = { to: d.name, ext: d.ext, result: null };
      p.metrics.transfers.push(tx);
      renderAll();
      const result = await AiCall.transfer(d.name, !(p.unavailable || []).includes(d.ext));
      if (Applicant.p !== p || p.status !== 'live') return;   // hung up while it rang
      tx.result = result;
      if (result === 'connected') { p.transfer.state = 'connected'; return endAi('applicant', 'transferred'); }
      p.held = false; p.transfer.state = 'no-answer';
      renderAll();
      return;
    }
    await toggleHold(true);
    p.transfer = { to: d.name, ext: d.ext, state: 'ringing' };
    App.board.send({ t: 'transfer', callId: p.callId, ext: d.ext });
    renderAll();
  }
  function hangup() {
    const p = Applicant.p; if (!p) return;
    if (p.mode === 'ai') return endAi('applicant', 'hangup');
    App.board.send({ t: 'hangup', callId: p.callId });
    endLive();
  }
  function endLive(m) {
    const p = Applicant.p; if (!p || p.status === 'ended') return;
    stopAlerts();
    const answered = p.status === 'live' || p.status === 'connecting';
    if (p.rtc) { p.rtc.close(); p.rtc = null; }
    if (p.music) { p.music.stop(); p.music = null; }
    remote().srcObject = null; remote().muted = false;
    VoIP.Mic.close();
    if (!answered) { Applicant.p = null; renderAll(); return; }
    Sounds.endTone();
    p.status = 'ended'; p.transfer = null;
    if (m && m.reason === 'transferred') U.toast('The caller was transferred. Finish your note.');
    else if (m && m.by === 'hr') U.toast('The caller hung up.');
    renderAll();
  }

  /* ---------- 🤖 an agent call (the AI plays the caller) ---------- */
  async function answerAi(p) {
    App.board.send({ t: 'ai-answer', callId: p.callId });
    p.answeredAt = Date.now();
    const mode = await AiCall.start({
      callId: p.callId, forceText: !!p.typed, readAloud: true, gender: p.gender,
      onState: (st) => {
        if (Applicant.p !== p) return;
        if (st === 'live' && p.status === 'connecting') { p.status = 'live'; p.typed = AiCall.mode() === 'text'; renderAll(); }
        if (st === 'ended' && p.status !== 'ended') endAi('caller', 'hangup');
      },
      onLine: (who, text, id) => {
        if (Applicant.p !== p) return;
        p.out = p.out || {}; p.out[id] = { who, text };
        if (p.lineTimer) return;
        p.lineTimer = setTimeout(() => { p.lineTimer = null; const o = p.out; p.out = {}; Object.entries(o).forEach(([k, v]) => App.board.send({ t: 'ai-line', callId: p.callId, id: k, who: v.who, text: v.text })); }, 400);
      },
      onError: (msg) => U.toast(msg, 'error'),
      onNotice: (msg) => U.toast(msg)
    });
    if (Applicant.p === p && mode === 'text') { p.typed = true; if (p.status === 'connecting') p.status = 'live'; renderAll(); }
  }
  async function endAi(by, reason) {
    const p = Applicant.p; if (!p || p.mode !== 'ai' || p.status === 'ended' || p.ending) return;
    p.ending = true;
    stopAlerts();
    const res = await AiCall.stop(true);
    Sounds.endTone();
    p.status = 'ended'; p.transfer = null; p.held = false;
    renderAll();
    VoIP.Mic.close();
    const m = p.metrics;
    m.transfers.forEach((x) => { if (!x.result) x.result = 'cancelled'; });
    try {
      await API.post('/api/call/update', { id: p.callId, end: true, transcript: res ? res.transcript : [],
        metrics: { talkMs: Date.now() - (p.answeredAt || Date.now()), endedBy: by === 'caller' ? 'caller' : 'applicant', endReason: reason, holds: m.holds, transfers: m.transfers, voice: res && res.mode === 'text' ? 'text' : 'voice' } });
    } catch (e) { U.toast(e.message, 'error'); }
    if (res && res.recording && res.recording.blob.size > 200) {
      try { await API.postBlob(`/api/recording/put?id=${encodeURIComponent(p.callId)}&dur=${Date.now() - p.answeredAt}`, res.recording.blob, res.recording.type); }
      catch (e) { console.warn('recording', e); }
    }
  }

  /* ---------- the Switchboard's messages ---------- */
  Applicant.onBoard = function (m) {
    const p = Applicant.p;
    const mine = p && p.callId === m.callId;
    switch (m.t) {
      case 'hello':
        App.cfg.me.ext = (m.me && m.me.ext) || App.cfg.me.ext;
        if (Applicant.status === 'away') App.board.send({ t: 'status', status: 'away' });
        // This page reloaded mid-call: the call waits for a click to reconnect (browsers need one to play audio).
        if (m.active && !active(Applicant.p)) {
          const a = m.active;
          Applicant.p = { mode: 'live', callId: a.callId, status: a.status, callerId: a.callerId, lineLabel: a.lineLabel, lineNumber: a.lineNumber, rec: !!a.recording,
            note: a.note || {}, muted: false, held: !!(a.live && a.live.held), answeredAt: a.answeredAt, needRejoin: a.status === 'live' };
          if (a.status === 'ringing') Sounds.ring();
        }
        renderAll();
        return;
      case 'presence': Applicant.hrOnline = m.hr || 0; renderScreen(); return;
      case 'error': U.toast(m.msg, 'error'); return;
      case 'incoming': return incoming(m);
      case 'ai-incoming': return aiIncoming(m);
      case 'ai-stop': if (mine && p.mode === 'ai') { U.toast('HR ended the call.'); endAi('caller', 'stopped'); } return;
      case 'taken': if (mine && p.status === 'ringing') { stopAlerts(); clearTimeout(p.ringTimer); Applicant.p = null; U.toast('Answered on another tab.'); renderAll(); } return;
      case 'moved': if (mine) { if (p.rtc) p.rtc.close(); if (p.music) p.music.stop(); VoIP.Mic.close(); Applicant.p = null; U.toast('The call moved to your other tab.'); renderAll(); } return;
      case 'gone': if (mine && p.status !== 'ended') { endLive(); Applicant.p = null; renderAll(); } return;
      case 'connected': if (mine) { p.answeredAt = p.answeredAt || Date.now(); renderAll(); } return;
      case 'signal': return onSignal(m.data);
      case 'transfer-result':
        if (!mine || !p.transfer) return;
        p.transfer.state = m.result;
        if (m.result !== 'connected') Sounds.beep();
        renderTransfer();
        return;
      case 'peer-lost': if (mine) { p.peerLost = true; renderScreen(); } return;
      case 'peer-back': if (mine) { p.peerLost = false; renderScreen(); } return;
      case 'ended': if (mine && p.mode === 'live') endLive(m); return;
    }
  };

  window.addEventListener('beforeunload', (e) => { if (Applicant.busy()) { e.preventDefault(); e.returnValue = ''; } });
  window.Applicant = Applicant;
})();
