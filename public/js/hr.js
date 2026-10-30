/* =========================================================
   🎛 HR's console
   ---------------------------------------------------------
   • The applicants whose phones are open, with their extensions.
   • The dialer: dial an extension and
       📞 Call            HR plays the caller over live audio (WebRTC);
       🤖 Agent caller    the AI plays the caller on the applicant's phone.
   • On a live call: mute, end, what the applicant's transfer does,
     the applicant's note as it's typed, the scenario script (if any),
     and HR's score and notes. The call is recorded here (both voices)
     and uploaded when it ends.
   • 🤖 Agent calls: the AI calls sent today, with 👂 Follow (the
     transcript and the note, live) and ⏹ to end one.
   ========================================================= */
(function () {
  'use strict';
  const esc = U.esc;
  const remote = () => document.getElementById('remoteAudio');
  const SETUP_KEY = 'hrmc_setup';
  const RANDOM = '__random';
  // The scenario picked on the console; 🎲 Surprise me draws one at random for each call (one the AI can play, for the agent caller).
  function pickScenario(forAi) {
    const all = (App.cfg.scenarios || []).filter((x) => !forAi || x.ai !== false);
    if (HR.setup.scenarioId === RANDOM) return all[Math.floor(Math.random() * all.length)] || null;
    return all.find((x) => x.id === HR.setup.scenarioId) || null;
  }

  const HR = {
    t: null,                 // the live call on this console
    last: null,              // the last call (for scoring after it ends)
    applicants: [], desks: [],
    ai: new Map(),           // agent calls: callId → { brief, lines: Map, note }
    follow: '',              // the agent call being followed
    dial: '',
    setup: { scenarioId: '', callerName: '', callerNumber: '', withhold: false, record: true, persona: '', opening: '', gender: 'f', voice: '' },
    busy() { return !!(HR.t && ['placing', 'ringing', 'connecting', 'live'].includes(HR.t.status)); }
  };
  try { Object.assign(HR.setup, JSON.parse(localStorage.getItem(SETUP_KEY) || '{}')); } catch (e) {}
  // A console that never picked a scenario starts on the first one: the call the applicant's briefing is for.
  if (HR.setup.scenarioId === undefined || HR.setup.scenarioId === '') HR.setup.scenarioPicked || (HR.setup.scenarioId = 'lsh_intake_scheduling');
  const saveSetup = () => { try { localStorage.setItem(SETUP_KEY, JSON.stringify(HR.setup)); } catch (e) {} };
  let el = null;
  const on = () => el && document.body.contains(el) && App.route.name === 'console';
  const byExt = (ext) => HR.applicants.find((a) => a.ext === String(ext || '').trim());

  /* ---------- the page ---------- */
  HR.render = function (root) {
    el = root;
    const cfg = App.cfg, f = cfg.features, s = HR.setup;
    const scen = cfg.scenarios || [];
    el.innerHTML = `<div class="cols">
      <div>
        <div class="card"><h3>☎ Applicants online</h3><div class="list" id="presence"></div>
          <p class="tiny muted" style="margin-top:10px">Click an applicant to put their extension on the dialer. Add applicants and copy their links on <a href="#/applicants">👥 Applicants</a>.</p></div>
        <div class="card" id="audioBox"></div>
      </div>
      <div>
        <div class="phone" id="phone">
          <div class="phone-brand"><img src="lsh-logo-dark.png" alt="Legal Support Help" width="646" height="397"><div class="pb-sub">HR Mock Calls · Dialer</div></div>
          <div class="screen" id="screen"></div>
          <div id="dialPad"></div>
          <div class="callkeys" id="callKeys"></div>
          <div class="opts">
            <label class="f" for="scen">Scenario</label>
            <select id="scen"><option value="">${scen.length ? '— Open call (no scenario) —' : 'No scenarios yet: open call'}</option>${scen.map((x) => `<option value="${esc(x.id)}" ${x.id === s.scenarioId ? 'selected' : ''}>${esc(x.title)}${x.ai === false ? ' (live only)' : ''}</option>`).join('')}${scen.length > 1 ? `<option value="${RANDOM}" ${s.scenarioId === RANDOM ? 'selected' : ''}>🎲 Surprise me (a random scenario each call)</option>` : ''}</select>
            <div class="row" style="gap:8px;margin-top:4px">
              <div style="flex:1;min-width:120px"><label class="f" for="cName">Caller ID name</label><input type="text" id="cName" maxlength="60" placeholder="WIRELESS CALLER" value="${esc(s.callerName)}"></div>
              <div style="flex:1;min-width:120px"><label class="f" for="cNum">Caller ID number</label><input type="text" id="cNum" maxlength="30" placeholder="(555) 012-3456" value="${esc(s.callerNumber)}"></div>
            </div>
            <label class="check"><input type="checkbox" id="withhold" ${s.withhold ? 'checked' : ''}> 🙈 Hide caller ID (PRIVATE CALLER)</label>
            <details id="aiSetup" ${s.persona ? 'open' : ''} style="margin-top:8px"><summary style="cursor:pointer;font-weight:700">🤖 Agent caller setup${f.ai ? '' : ' (off: no Gemini key)'}</summary>
              <label class="f" for="persona">Who the AI plays (used when no scenario is picked)</label>
              <textarea id="persona" rows="5" maxlength="6000" placeholder="e.g. Maria, a client of the firm. Her car accident case is open; she wants to know when her next appointment is and is a little impatient. DOB 03/14/1985.">${esc(s.persona)}</textarea>
              <label class="f" for="opening">Opening line (optional)</label><input type="text" id="opening" maxlength="1000" value="${esc(s.opening)}">
              <div class="row" style="gap:8px">
                <div style="flex:1"><label class="f" for="gender">Caller</label><select id="gender"><option value="f" ${s.gender !== 'm' ? 'selected' : ''}>Female voice</option><option value="m" ${s.gender === 'm' ? 'selected' : ''}>Male voice</option></select></div>
                <div style="flex:1"><label class="f" for="voice">Voice</label><select id="voice"><option value="">To suit the caller</option>${(cfg.voices || []).map((v) => `<option value="${esc(v.id)}" ${v.id === s.voice ? 'selected' : ''}>${esc(v.label)} · ${esc(v.desc)}</option>`).join('')}</select></div>
              </div>
            </details>
          </div>
        </div>
      </div>
      <div>
        <div id="livePanel"></div>
        <div class="card"><div class="row"><h3 style="margin:0">🤖 Agent calls</h3><span class="spacer"></span><button class="btn small" id="aiRefresh">↻</button></div><div id="aiList" style="margin-top:10px"></div></div>
      </div>
    </div>`;
    App.audioCheck(el.querySelector('#audioBox'));
    const bind = (id, k, ev, val) => { const x = el.querySelector('#' + id); x.addEventListener(ev || 'input', () => { HR.setup[k] = val ? val(x) : x.value; saveSetup(); renderScreen(); }); };
    bind('scen', 'scenarioId', 'change'); el.querySelector('#scen').addEventListener('change', () => { HR.setup.scenarioPicked = true; saveSetup(); }); bind('cName', 'callerName'); bind('cNum', 'callerNumber');
    bind('withhold', 'withhold', 'change', (x) => x.checked);
    bind('persona', 'persona'); bind('opening', 'opening'); bind('gender', 'gender', 'change'); bind('voice', 'voice', 'change');
    el.querySelector('#aiRefresh').onclick = loadAi;
    renderPresence(); renderPad(); renderScreen(); renderKeys(); renderLive(); loadAi();
  };

  function renderPresence() {
    const box = on() && el.querySelector('#presence'); if (!box) return;
    const list = HR.applicants.slice().sort((a, b) => Number(a.ext) - Number(b.ext));
    box.innerHTML = (list.length ? list.map((a) => `<div class="item ${a.ext === HR.dial ? 'sel' : ''}" data-ext="${esc(a.ext)}">
        <span class="dot ${a.call ? 'call' : a.status}"></span><span class="ext">${esc(a.ext)}</span>
        <span style="flex:1;min-width:0"><b>${esc(a.name)}</b></span>
        <span class="tiny muted">${a.call ? 'on a call' : a.status === 'available' ? 'available' : 'away'}</span></div>`).join('')
      : '<p class="muted small">No applicant has their phone open right now.</p>')
      + (HR.desks.length ? `<p class="tiny muted" style="margin-top:8px">HR on: ${HR.desks.map((d) => `${esc(d.name)} (${esc(d.ext)})${d.call ? ' 📞' : ''}`).join(', ')}</p>` : '');
    box.querySelectorAll('[data-ext]').forEach((x) => { x.onclick = () => { if (HR.busy()) return; HR.dial = x.dataset.ext; renderPresence(); renderScreen(); }; });
  }

  function renderPad() {
    const box = on() && el.querySelector('#dialPad'); if (!box) return;
    box.innerHTML = `<div class="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '⌫'].map((k) => `<button class="key" data-k="${k}">${k}</button>`).join('')}</div>`;
    box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => key(b.dataset.k); });
  }
  function key(k) {
    if (HR.busy()) return;
    if (k === '⌫') HR.dial = HR.dial.slice(0, -1);
    else if (/^[0-9]$/.test(k) && HR.dial.length < 6) { HR.dial += k; Sounds.dtmf(k); }
    renderScreen(); renderPresence();
  }
  document.addEventListener('keydown', (e) => {
    if (!on() || HR.busy() || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    if (/^[0-9]$/.test(e.key)) key(e.key);
    else if (e.key === 'Backspace') key('⌫');
    else if (e.key === 'Escape') { HR.dial = ''; renderScreen(); renderPresence(); }
    else if (e.key === 'Enter') ringLive();
  });

  function callerIdPreview() {
    const s = HR.setup, sc = (App.cfg.scenarios || []).find((x) => x.id === s.scenarioId);
    if (s.withhold) return 'PRIVATE CALLER';
    if (s.scenarioId === RANDOM) return '🎲 a random scenario\'s caller';
    if (sc) return `${sc.caller.name.toUpperCase()} ${sc.caller.number || ''}`;
    return `${(s.callerName || 'WIRELESS CALLER').toUpperCase()} ${s.callerNumber || ''}`;
  }
  function renderScreen() {
    const box = on() && el.querySelector('#screen'); if (!box) return;
    const t = HR.t;
    el.querySelector('#phone').classList.toggle('ringing', !!(t && t.status === 'ringing'));
    if (t && t.status !== 'ended') {
      const a = t.applicant || {};
      const state = { ringing: 'Ringing…', connecting: 'Connecting…', live: 'On the call' }[t.status] || t.status;
      const time = t.status === 'live' && t.answeredAt ? U.since(t.answeredAt) : t.status === 'ringing' ? U.ringText(t.createdAt) : '';
      box.innerHTML = `<div class="line">${esc(App.cfg.company.line)} → ext ${esc(a.ext || '')}</div><div class="big">${esc(a.name || '')}</div>
        <div>${esc(state)} <span id="clock">${esc(time)}</span></div>
        <div class="tags">${t.rec && !t.recPaused ? '<span class="tag rec">● REC</span>' : t.rec ? '<span class="tag">⏸ REC PAUSED</span>' : t.record ? '<span class="tag rec">● REC (starts on answer)</span>' : ''}${t.muted ? '<span class="tag">MUTED</span>' : ''}${t.appHeld ? '<span class="tag">ON HOLD (applicant)</span>' : ''}${t.appMuted ? '<span class="tag">APPLICANT MUTED</span>' : ''}
          ${t.peerLost ? '<span class="tag">applicant reconnecting…</span>' : ''}${t.quality ? `<span class="tag">${'▮'.repeat(t.quality.bars)}${'▯'.repeat(4 - t.quality.bars)}${t.quality.relay ? ' relay' : ''}</span>` : ''}</div>
        <div class="tiny" style="margin-top:6px">Caller ID shown: ${esc(t.callerId ? `${t.callerId.name} ${t.callerId.number}` : '')}</div>`;
      return;
    }
    const a = byExt(HR.dial);
    box.innerHTML = `<div class="line">Dial an applicant's extension</div><div class="big">${esc(HR.dial || '—')}</div>
      <div>${!HR.dial ? '&nbsp;' : a ? `${a.call ? '📞 On a call: ' : '✔ Ready to call: '}<b>${esc(a.name)}</b>` : HR.applicants.length ? 'Not signed in / no such extension' : 'Not signed in'}</div>
      <div class="tiny" style="margin-top:6px">Caller ID: ${esc(callerIdPreview())}</div>`;
  }
  setInterval(() => { if (on() && HR.t && ['ringing', 'live'].includes(HR.t.status)) { const c = el.querySelector('#clock'); if (c) c.textContent = HR.t.status === 'live' ? U.since(HR.t.answeredAt) : U.ringText(HR.t.createdAt); } }, 1000);

  function renderKeys() {
    const box = on() && el.querySelector('#callKeys'); if (!box) return;
    const t = HR.t;
    if (t && t.status !== 'ended') {
      const recLabel = !t.rec ? (t.status === 'live' ? '⏺ Record' : t.record ? '⏺ Rec on' : '⏺ Rec off') : t.recPaused ? '⏺ Resume rec' : '⏸ Pause rec';
      box.innerHTML = `<button class="pkey ${t.muted ? 'on' : ''}" id="kMute" ${t.status === 'live' ? '' : 'disabled'}>${t.muted ? '🔇 Unmute' : '🎙 Mute'}</button>
        <button class="pkey ${VoIP.Speaker.on ? 'on' : ''}" id="kSpk">🔊 Speaker</button>
        <button class="pkey rec ${t.rec && !t.recPaused ? 'on' : ''}" id="kRec" style="grid-column:1/-1" ${App.cfg.features.recordings && t.status === 'live' ? '' : 'disabled'}>${recLabel}</button>
        <button class="pkey end" id="kEnd" style="grid-column:1/-1">${t.status === 'ringing' ? '✖ Cancel' : '📞 End call'}</button>`;
      box.querySelector('#kEnd').onclick = hangup;
      box.querySelector('#kMute').onclick = toggleMute;
      box.querySelector('#kRec').onclick = toggleRec;
      box.querySelector('#kSpk').onclick = async () => { const r = await VoIP.Speaker.toggle(); if (r.note) U.toast(r.note); renderKeys(); };
      return;
    }
    const canRec = App.cfg.features.recordings, recOn = canRec && HR.setup.record;
    box.innerHTML = `<button class="pkey rec ${recOn ? 'on' : ''}" id="kRec" style="grid-column:1/-1" ${canRec ? '' : 'disabled title="Recordings need the LSH_KV binding"'}>${recOn ? '⏺ Record the call: ON' : '⏺ Record the call: OFF'}</button>
      <button class="pkey go" id="kCall">📞 Call (live)</button><button class="pkey ai" id="kAi" ${App.cfg.features.ai ? '' : 'disabled title="Add a Gemini key to use the agent caller"'}>🤖 Agent caller</button>`;
    box.querySelector('#kRec').onclick = () => { HR.setup.record = !HR.setup.record; saveSetup(); renderKeys(); };
    box.querySelector('#kCall').onclick = ringLive;
    box.querySelector('#kAi').onclick = ringAi;
  }

  /* ---------- the right-hand panel: the live call, then the last call ---------- */
  function renderLive() {
    const box = on() && el.querySelector('#livePanel'); if (!box) return;
    const t = HR.t && HR.t.status !== 'ended' ? HR.t : null;
    const c = t || HR.last;
    if (!c) { box.innerHTML = `<div class="card"><h3>How a mock call goes</h3><ol class="small" style="padding-left:18px;margin:0">
        <li>The applicant opens their interview link and keeps <b>☎ My phone</b> open with a headset.</li>
        <li>Dial their extension (or click them on the left).</li>
        <li><b>📞 Call</b> to play the caller yourself, or <b>🤖 Agent caller</b> to let the AI play the caller.</li>
        <li>Their note shows here as they type it. Score the call and add your notes; the recording is kept in <a href="#/calls">🗂 Call Logs</a>.</li></ol></div>`; return; }
    const s = c.scenario || {};
    box.innerHTML = `${t && t.transfer ? `<div class="card" style="border-color:var(--orange)"><h3>↪ The applicant is transferring the caller</h3>
          <p>To <b>${esc(t.transfer.to)}</b> (ext ${esc(t.transfer.ext)})${t.transfer.unavailable ? ' — the scenario says they are <b>out</b>' : ''}. What happens?</p>
          <div class="row"><button class="btn green" data-tx="connected">Picks up (call ends)</button><button class="btn" data-tx="no-answer">No answer</button><button class="btn" data-tx="voicemail">Voicemail</button></div></div>` : ''}
      ${t && (s.persona || s.opening || (s.goals || []).length) ? `<div class="card"><h3>🎭 You are the caller</h3>${s.opening ? `<p><b>Opening:</b> ${esc(s.opening)}</p>` : ''}${s.persona ? `<div class="script">${esc(s.persona)}</div>` : ''}${(s.goals || []).length ? `<h4 style="margin-top:10px">What a good call does</h4><ul class="small">${s.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      <div class="card"><h3>📝 ${esc((c.applicant || {}).name || '')}'s note ${t ? '<span class="badge red">LIVE</span>' : ''}</h3><div id="liveNote">${App.noteHtml(c.note)}</div></div>
      <div class="card"><div class="row"><h3 style="margin:0">📋 Scoring matrix</h3><span class="spacer"></span><a class="btn small" href="#/call/${esc(c.callId)}">Open call ↗</a></div><div id="scBox" style="margin-top:8px"></div></div>`;
    box.querySelectorAll('[data-tx]').forEach((b) => { b.onclick = () => { App.board.send({ t: 'transfer-result', callId: t.callId, result: b.dataset.tx }); t.transfer = null; renderLive(); }; });
    App.scorecard(box.querySelector('#scBox'), c.callId, c.review = c.review || {});
  }
  function renderNote() { const n = on() && el.querySelector('#liveNote'); const c = HR.t || HR.last; if (n && c) n.innerHTML = App.noteHtml(c.note); }

  /* ---------- placing a call ---------- */
  function target() {
    const a = byExt(HR.dial);
    if (!HR.dial) { U.toast('Dial an applicant\'s extension first.', 'error'); return null; }
    if (!a) { U.toast(`Extension ${HR.dial} isn't signed in.`, 'error'); return null; }
    if (a.call) { U.toast(`${a.name} is on a call.`, 'error'); return null; }
    return a;
  }
  async function ringLive() {
    if (HR.busy()) return;
    const a = target(); if (!a) return;
    const s = HR.setup, sc = pickScenario(false);
    try { await VoIP.Mic.open(); } catch (e) { return U.toast(e.message, 'error'); }
    VoIP.ice();   // warm up the TURN credentials
    HR.t = { status: 'placing', applicant: a };
    App.board.send({ t: 'ring', applicantId: a.id, scenarioId: sc ? sc.id : '', callerName: s.callerName, callerNumber: s.callerNumber, withhold: s.withhold, record: !!(s.record && App.cfg.features.recordings) });
  }
  function ringAi() {
    const a = target(); if (!a) return;
    const s = HR.setup, sc = pickScenario(true);
    if (!sc && !s.persona.trim() && !confirm('No scenario and no persona: the AI will make up an everyday caller. Send it anyway?')) return;
    App.board.send({ t: 'ai-ring', applicantId: a.id, scenarioId: sc ? sc.id : '', persona: s.persona, opening: s.opening, callerName: s.callerName, callerNumber: s.callerNumber, gender: s.gender, voice: s.voice, withhold: s.withhold });
    U.toast(`🤖 Agent caller sent to ${a.name}.`);
  }

  const fromBrief = (m) => ({ callId: m.callId, status: m.status, applicant: m.applicant, scenario: m.scenario, callerId: m.callerId, record: !!m.recording,
    createdAt: m.createdAt, answeredAt: m.answeredAt, note: m.note || {}, appHeld: !!(m.live && m.live.held), appMuted: !!(m.live && m.live.applicantMuted), transfer: (m.live && m.live.transfer) || null });

  async function connect(t, gen) {
    let stream;
    try { stream = await VoIP.Mic.open(); } catch (e) { U.toast(e.message, 'error'); return; }
    const servers = await VoIP.ice();
    if (HR.t !== t) return;
    if (t.rtc) t.rtc.close();
    if (t.muted) stream.getAudioTracks().forEach((x) => { x.enabled = false; });
    t.rtc = new VoIP.RtcCall({
      board: App.board, callId: t.callId, offerer: true, iceServers: servers, stream, gen,
      onRemote: (s) => {
        const a = remote(); a.srcObject = s; a.play().catch(() => {});
        t.remoteStream = s;
        if (t.record) { if (!t.rec) startRec(t); else t.rec.add(s); }
      },
      onState: (st) => { if (HR.t !== t) return; if (st === 'connected' && t.status === 'connecting') t.status = 'live'; renderScreen(); renderKeys(); },
      onQuality: (q) => { if (HR.t === t) { t.quality = q; renderScreen(); } }
    });
    t.rtc.start();
  }

  /* ⏺ The record key on a call: starts recording (both voices) if the call isn't recorded yet, then pauses and
     resumes it. One file per call, uploaded when the call ends. The applicant's phone shows whether it's recording. */
  function startRec(t) {
    try { t.rec = new VoIP.Recorder([VoIP.Mic.stream, t.remoteStream]); t.recPaused = false; t.record = true; }
    catch (e) { U.toast('Recording couldn\'t start: ' + e.message, 'error'); return; }
    App.board.send({ t: 'rec', callId: t.callId, on: true });
  }
  function toggleRec() {
    const t = HR.t; if (!t || t.status !== 'live') return;
    if (!t.rec) startRec(t);
    else { t.recPaused = !t.recPaused; t.rec[t.recPaused ? 'pause' : 'resume'](); App.board.send({ t: 'rec', callId: t.callId, on: !t.recPaused }); }
    renderScreen(); renderKeys();
  }

  function hangup() {
    const t = HR.t; if (!t) return;
    App.board.send({ t: t.status === 'ringing' ? 'cancel' : 'hangup', callId: t.callId });
    endCall({ by: 'hr', status: t.status === 'ringing' ? 'cancelled' : 'ended' });
  }
  function toggleMute() {
    const t = HR.t; if (!t || t.status !== 'live') return;
    t.muted = !t.muted;
    const tr = VoIP.Mic.track(); if (tr) tr.enabled = !t.muted;
    App.board.send({ t: 'mute', callId: t.callId, on: t.muted });
    renderScreen(); renderKeys();
  }

  async function endCall(m) {
    const t = HR.t; if (!t || t.status === 'ended') return;
    Sounds.stop();
    const answered = !!t.answeredAt;
    t.status = 'ended';
    if (t.rtc) { t.rtc.close(); t.rtc = null; }
    remote().srcObject = null;
    VoIP.Mic.close();
    if (answered) Sounds.endTone();
    HR.last = t; HR.t = null;
    const why = { missed: 'No answer.', declined: 'The applicant declined the call.', cancelled: '' }[m.status];
    if (why) U.toast(why);
    else if (m.reason === 'transferred') U.toast('The applicant transferred the caller: the call ended.');
    else if (m.by === 'applicant') U.toast('The applicant hung up.');
    if (!answered) HR.last = null;
    renderAll();
    // The recording: both voices, uploaded to the call record.
    if (t.rec) {
      const rec = t.rec; t.rec = null;
      try {
        const out = await rec.stop();
        if (out.blob.size > 200) { await API.postBlob(`/api/recording/put?id=${encodeURIComponent(t.callId)}&dur=${out.durMs}`, out.blob, out.type); U.toast('🎧 Recording saved.', 'ok'); }
      } catch (e) { U.toast('The recording couldn\'t be saved: ' + e.message, 'error'); }
    }
  }
  function renderAll() { renderPresence(); renderScreen(); renderKeys(); renderLive(); }

  /* ---------- 🤖 agent calls ---------- */
  async function loadAi() {
    try { (await API.post('/api/ai/calls')).calls.forEach((c) => { const x = HR.ai.get(c.callId) || { lines: new Map() }; x.brief = c; x.note = c.note; HR.ai.set(c.callId, x); }); }
    catch (e) { /* offline */ }
    renderAi();
  }
  function renderAi() {
    const box = on() && el.querySelector('#aiList'); if (!box) return;
    const list = [...HR.ai.values()].filter((x) => x.brief).sort((a, b) => b.brief.createdAt - a.brief.createdAt).slice(0, 15);
    if (!list.length) { box.innerHTML = '<p class="muted small">None today. Dial an extension and press 🤖 Agent caller.</p>'; return; }
    box.innerHTML = list.map(({ brief: c, lines, note }) => {
      const live = c.status === 'live' || c.status === 'ringing';
      const st = { ringing: ['amber', 'Ringing'], live: ['red', 'On the call'], ended: ['green', 'Ended'], missed: ['amber', 'Missed'], declined: ['amber', 'Declined'], cancelled: ['', 'Busy'] }[c.status] || ['', c.status];
      const open = HR.follow === c.callId;
      return `<div class="card" style="padding:12px;margin-bottom:8px">
        <div class="row"><b>${esc(c.applicantName)}</b><span class="tiny muted mono">ext ${esc(c.ext)}</span><span class="badge ${st[0]}">${st[1]}</span>${c.status === 'live' && c.answeredAt ? `<span class="tiny mono">${U.since(c.answeredAt)}</span>` : ''}<span class="spacer"></span>
          ${live ? `<button class="btn small" data-follow="${esc(c.callId)}">${open ? 'Hide' : '👂 Follow'}</button><button class="btn small red" data-stop="${esc(c.callId)}">⏹</button>` : `<a class="btn small" href="#/call/${esc(c.callId)}">Open ↗</a>`}</div>
        <div class="tiny muted">${esc(c.title)} · ${esc(U.when(c.createdAt))}</div>
        ${open ? `<div class="grid" style="margin-top:8px"><div class="transcript">${App.transcriptHtml([...lines.values()])}</div><h4 style="margin-top:8px">📝 Note</h4>${App.noteHtml(note)}</div>` : ''}</div>`;
    }).join('');
    box.querySelectorAll('[data-follow]').forEach((b) => { b.onclick = () => { HR.follow = HR.follow === b.dataset.follow ? '' : b.dataset.follow; renderAi(); }; });
    box.querySelectorAll('[data-stop]').forEach((b) => { b.onclick = () => { if (confirm('End this agent call?')) App.board.send({ t: 'ai-stop', callId: b.dataset.stop }); }; });
    const tr = box.querySelector('.transcript'); if (tr) tr.scrollTop = tr.scrollHeight;
  }

  /* ---------- the Switchboard's messages ---------- */
  HR.onBoard = function (m) {
    const t = HR.t;
    const mine = t && t.callId && t.callId === m.callId;
    switch (m.t) {
      case 'hello':
        // This console reloaded mid-call: pick the call back up.
        if (m.active && !HR.t) {
          HR.t = Object.assign(fromBrief(m.active), { resuming: true });
          if (HR.t.status === 'live') { App.board.send({ t: 'resume', callId: HR.t.callId }); HR.t.status = 'connecting'; }
          else if (HR.t.status === 'ringing') Sounds.ringback();
          renderAll();
        }
        return;
      case 'presence': HR.applicants = m.applicants || []; HR.desks = m.hr || []; renderPresence(); renderScreen(); return;
      case 'error': U.toast(m.msg, 'error'); if (t && t.status === 'placing') { HR.t = null; VoIP.Mic.close(); renderAll(); } return;
      case 'ringing': HR.t = Object.assign(fromBrief(m), { status: 'ringing', record: !!m.recording }); Sounds.ringback(); renderAll(); return;
      case 'ring-failed': HR.t = null; VoIP.Mic.close(); U.toast(m.reason, 'error'); renderAll(); return;
      case 'accepted':
        if (!mine) { App.board.send({ t: 'hangup', callId: m.callId }); return; }   // answered just as this console cancelled
        Sounds.stop();
        t.status = 'connecting'; t.answeredAt = Date.now();
        connect(t, Date.now());
        renderAll();
        return;
      case 'resumed':
        if (!mine) return;
        Object.assign(t, fromBrief(m), { status: 'connecting', resuming: false, muted: false });
        connect(t, Date.now());
        renderAll();
        return;
      case 'moved':
        if (!mine) return;
        if (t.rtc) t.rtc.close();
        if (t.rec) { t.rec.stop(); t.rec = null; }   // the tab that has the call now records the rest of it
        remote().srcObject = null; VoIP.Mic.close();
        HR.t = null; U.toast('The call moved to your other tab.'); renderAll();
        return;
      case 'signal':
        if (!mine || !t.rtc || !m.data) return;
        if (m.data.rejoin) { connect(t, Date.now()); return; }   // the applicant's page reloaded: start a new connection
        if (m.data.gen != null && m.data.gen !== t.rtc.gen) return;
        t.rtc.handle(m.data);
        return;
      case 'hold': if (mine) { t.appHeld = !!m.on; renderScreen(); } return;
      case 'mute': if (mine) { t.appMuted = !!m.on; renderScreen(); } return;
      case 'transfer': if (mine) { t.transfer = { to: m.to, ext: m.ext, unavailable: !!m.unavailable }; Sounds.beep(); renderLive(); } return;
      case 'transfer-cancel': if (mine) { t.transfer = null; renderLive(); U.toast('The applicant took the caller back.'); } return;
      case 'note': {
        if (mine) { t.note = m.note || {}; renderNote(); return; }
        if (HR.last && HR.last.callId === m.callId) { HR.last.note = m.note || {}; renderNote(); }
        const x = HR.ai.get(m.callId); if (x) { x.note = m.note || {}; if (HR.follow === m.callId) renderAi(); }
        return;
      }
      case 'peer-lost': if (mine) { t.peerLost = true; renderScreen(); } return;
      case 'peer-back': if (mine) { t.peerLost = false; renderScreen(); } return;
      case 'ended': if (mine) endCall(m); return;
      case 'gone': if (mine) endCall({ by: 'system', status: m.status }); return;
      // 🤖 agent calls
      case 'ai-failed': U.toast(m.reason, 'error'); return;
      case 'ai-call': {
        const x = HR.ai.get(m.call.callId) || { lines: new Map() };
        x.brief = m.call; if (m.call.note) x.note = m.call.note;
        HR.ai.set(m.call.callId, x);
        if (m.call.status === 'live' && !HR.follow) HR.follow = m.call.callId;
        renderAi();
        return;
      }
      case 'ai-line': {
        const x = HR.ai.get(m.callId) || { lines: new Map() };
        x.lines.set(m.id, { who: m.who, text: m.text });
        HR.ai.set(m.callId, x);
        if (HR.follow === m.callId) renderAi();
        return;
      }
    }
  };

  window.HR = HR;
})();
