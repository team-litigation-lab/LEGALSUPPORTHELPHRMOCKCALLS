/* =========================================================
   The AI agent caller (HR sends it to an applicant's phone)
   ---------------------------------------------------------
   Voice: Gemini Live, as in LSH Ring Channel. The Worker makes a
   single-use token with the caller's script locked in; this page talks
   straight to Google with it. The microphone goes up as 16-bit PCM; the
   caller comes back as 24 kHz PCM and can be interrupted. Both sides are
   transcribed, and both voices are recorded for HR.
   Text: the same caller, typed, when there's no microphone or live voice
   isn't available (the caller's lines can be read aloud).

   AiCall.prepare(callId) while it rings · unprepare() if it isn't answered
   AiCall.start({ callId, onState, onLine, onError, onNotice })  → 'voice' | 'text'
     onState(state, reason): connecting · live · ended (reason: goodbye · time-limit)      onLine(who, text, id)   who: applicant | caller
   AiCall.hold(on) · mute(on) · transfer(name, available) · say(text) · stop() → { transcript, recording }
   ========================================================= */
(function () {
  'use strict';
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const WORKLET = `class LshMic extends AudioWorkletProcessor {
    constructor() { super(); this.size = Math.round(sampleRate / 10); this.buf = new Int16Array(this.size); this.n = 0; }
    process(inputs) {
      const ch = inputs[0] && inputs[0][0];
      if (ch) for (let i = 0; i < ch.length; i++) {
        const s = Math.tanh(ch[i] * 1.6) / 0.9217;   // a little more receptive: soft voices lifted, loud ones rounded off, never clipped
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.size) { this.port.postMessage(this.buf.buffer.slice(0)); this.n = 0; }
      }
      return true;
    }
  }
  registerProcessor('lsh-mic', LshMic);`;
  const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const t = atob(s), o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o.buffer; };

  let C = null;   // the call in progress

  function voiceSupported() { return !!(Ctx && window.WebSocket && window.AudioWorkletNode && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  async function start(opts) {
    stop(true, true);
    const call = C = { opts, mode: 'voice', ws: null, ctx: null, mic: null, node: null, src: null, muted: false, held: false, ended: false, playing: [], playAt: 0,
      line: null, seq: 0, heard: false, transcript: [], rec: null, recDest: null };
    opts.onState && opts.onState('connecting');
    if (opts.forceText || !voiceSupported()) return startText(call, opts.forceText ? '' : 'This browser can\'t do voice calls, so this call is typed.');
    try {
      call.ctx = new Ctx();
      if (window.VoIP && VoIP.Speaker) VoIP.Speaker.register(call.ctx);   // 🔊 the caller's voice follows the speaker key
      if (call.ctx.state === 'suspended') call.ctx.resume().catch(() => {});
      call.mic = await VoIP.Mic.open();
    } catch (e) { return startText(call, e.message + ' This call is typed instead.'); }
    if (C !== call) return 'ended';
    // The line the phone warmed up while it rang, if it's ready; otherwise connect now.
    let link = await takeWarm(opts.callId);
    if (C !== call) { if (link && link.ws) closeLink(link); return 'ended'; }
    const skip = link && link.pair ? [link.pair] : [];
    for (let tries = 0; !(link && link.ws) && tries < 6 && C === call; tries++) {
      try { link = await connect(opts.callId, skip); }
      catch (e) { return startText(call, (e.message || 'Live voice isn\'t available') + ' This call is typed instead.'); }
      if (C !== call) { if (link.ws) closeLink(link); return 'ended'; }
      if (!link.ws) skip.push(link.pair);
    }
    if (!(link && link.ws)) return startText(call, 'The voice service didn\'t accept the call, so this call is typed.');
    call.maxSeconds = link.maxSeconds;
    bind(call, link);
    await onReady(call);
    if (C !== call) return 'ended';
    link.early.forEach((m) => handle(call, m));
    return 'voice';
  }

  /* ---------- the line to Gemini Live ---------- */
  // Fetches a token and opens the socket up to "setup complete". Resolves { ws, ... } when ready, or { ws: null, pair } when that
  // key or model didn't take it (try the next); throws when no token can be had (the call runs typed).
  async function connect(callId, skip) {
    const t = await API.post('/api/ai/live', { callId, skip });
    return new Promise((resolve) => {
      const link = { ws: null, pair: t.pair, maxSeconds: t.maxSeconds, early: [], callId };
      const ws = new WebSocket(t.url + (t.url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(t.token));
      let ready = false;
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + t.model } }));
      ws.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
        if (msg.setupComplete && !ready) { ready = true; link.ws = ws; return resolve(link); }
        if (ready) link.early.push(msg);   // anything before the call takes the line over
      };
      ws.onerror = () => {};
      ws.onclose = () => { if (!ready) resolve(link); else link.closed = true; };
    });
  }
  function closeLink(link) { try { if (link.ws && link.ws.readyState <= 1) link.ws.close(1000); } catch (e) {} }

  // The call takes the line over: its messages and its closing are now the call's.
  function bind(call, link) {
    const ws = call.ws = link.ws;
    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
      if (C === call) handle(call, msg);
    };
    const dropped = (code, reason) => {
      if (C !== call || call.ended) return;
      const why = code === 1000 ? '' : reason || '';
      finish(call);
      if (code !== 1000) call.opts.onError && call.opts.onError('The call dropped' + (why ? ` (${why})` : '') + '.');
      call.opts.onState && call.opts.onState('ended');
    };
    ws.onclose = (ev) => dropped(ev.code, ev.reason);
    if (link.closed || ws.readyState > 1) setTimeout(() => dropped(1006, 'the line closed'), 0);
  }

  /* While the phone rings, the line to the caller is opened, so the caller is there the moment it's answered.
     Nothing goes up it until then (no microphone), so the caller stays quiet. */
  let warm = null;
  function prepare(callId) {
    if (warm && warm.callId === callId) return;
    unprepare();
    if (!voiceSupported() || document.visibilityState === 'hidden') return;
    const w = warm = { callId, at: Date.now() };
    w.link = connect(callId, []).catch(() => null).then((link) => {
      if (warm !== w && !w.taken && link && link.ws) { closeLink(link); return null; }   // unprepared before it was ready
      return link;
    });
  }
  function unprepare() { const w = warm; warm = null; if (w) w.link.then((l) => { if (l && l.ws) closeLink(l); }); }
  async function takeWarm(callId) {
    const w = warm; warm = null;
    if (!w || w.callId !== callId) { if (w) w.link.then((l) => { if (l && l.ws) closeLink(l); }); return null; }
    w.taken = true;   // answered before it was ready: wait for it rather than open another
    const link = await w.link;
    if (link && link.ws && (link.closed || link.ws.readyState !== 1)) return null;
    return link;
  }

  async function onReady(call) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await call.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    call.src = call.ctx.createMediaStreamSource(call.mic);
    call.node = new AudioWorkletNode(call.ctx, 'lsh-mic');
    const rate = call.ctx.sampleRate;
    call.node.port.onmessage = (e) => {
      if (C !== call || call.muted || call.held || !call.ws || call.ws.readyState !== 1) return;
      if (!call.voiced) { const a = new Int16Array(e.data); let sum = 0; for (let i = 0; i < a.length; i += 4) sum += a[i] * a[i]; if (Math.sqrt(sum / (a.length / 4)) > 700) call.voiced = true; }
      call.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(e.data), mimeType: 'audio/pcm;rate=' + rate } } }));
    };
    call.src.connect(call.node);
    const sink = call.ctx.createGain(); sink.gain.value = 0; call.node.connect(sink); sink.connect(call.ctx.destination);
    // Both voices into the recording.
    try {
      call.recDest = call.ctx.createMediaStreamDestination();
      call.src.connect(call.recDest);
      call.rec = new MediaRecorder(call.recDest.stream, { audioBitsPerSecond: 32000 });
      call.recChunks = []; call.rec.ondataavailable = (e) => { if (e.data && e.data.size) call.recChunks.push(e.data); };
      call.rec.start(1000);
    } catch (e) { call.rec = null; }
    call.opts.onState && call.opts.onState('live');
    timeLimit(call);
    call.kick = setTimeout(() => { if (C === call && !call.heard && !call.voiced) say('(The person who answered hasn\'t said anything yet.)', true); }, 3000);
  }

  function timeLimit(call) {
    if (!call.maxSeconds) return;
    const ms = call.maxSeconds * 1000, lead = Math.min(30000, ms / 2);
    // The caller's sense of time: two quiet cues steer it to close well before the limit.
    call.cues = [[ms - 150000, '(About two minutes are left on this call: no new problems; move to the next step.)'],
      [ms - 75000, '(About a minute is left. At your next turn, accept what they offer, confirm it, thank them and say goodbye.)']]
      .filter(([at]) => at > 20000).map(([at, text]) => setTimeout(() => cue(call, text), at));
    call.warn = setTimeout(() => { if (C === call) call.opts.onNotice && call.opts.onNotice(`⏱ ${Math.round(lead / 1000)} seconds left on this call. Wrap it up.`); }, ms - lead);
    call.limit = setTimeout(() => { if (C === call) { call.opts.onNotice && call.opts.onNotice(`The call reached its ${Math.round(call.maxSeconds / 60)}-minute limit.`); call.endedBy = 'caller'; call.opts.onState && call.opts.onState('ended', 'time-limit'); } }, ms);
  }

  // A cue said while the caller is on hold would make it speak; it waits for the line to come back.
  function cue(call, text) {
    if (C !== call || call.ended) return;
    if (call.held) { call.pendingCue = text; return; }
    say(text, true);
  }

  function handle(call, msg) {
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) { flush(call); call.talking = false; }
    const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
    parts.forEach((p) => { if (p.inlineData && p.inlineData.data && /audio/.test(p.inlineData.mimeType || 'audio')) { call.talking = true; play(call, p.inlineData.data, p.inlineData.mimeType); } });
    if (sc.inputTranscription && sc.inputTranscription.text) { call.heard = true; addText(call, 'applicant', sc.inputTranscription.text); }
    if (sc.outputTranscription && sc.outputTranscription.text) { addText(call, 'caller', sc.outputTranscription.text); if (!call.talking) byeCheck(call); }
    if (sc.turnComplete) { call.line = null; call.talking = false; byeCheck(call); }
  }

  /* ---------- the caller says goodbye: the line hangs up ---------- */
  // The end of the caller's last line, e.g. "Okay, thank you. Bye!", "Goodbye, Sarah." or "Have a good day."
  const BYE = /(?:good[\s-]?bye|\bbye(?:[\s-]?bye)?(?:\s+now)?|take care(?:\s+now)?|have a (?:good|nice|great|wonderful|lovely|blessed) (?:day|one|night|evening|afternoon|weekend))[\s.!,]*(?:[a-z']+[\s.!]*)?$/i;
  // The caller's last turn (transcription that came in late is joined on). What the applicant says after it,
  // like their own "Bye!", doesn't cancel it; the caller carrying on talking does.
  function saidBye(call) {
    const t = call.transcript; let i = t.length - 1, text = '';
    while (i >= 0 && t[i].who !== 'caller') i--;
    while (i >= 0 && t[i].who === 'caller') text = t[i--].text + ' ' + text;
    return BYE.test(text.trim().slice(-60));
  }
  // Once the caller's goodbye has finished playing (and a breath after), it hangs up, as a real caller would.
  function byeCheck(call) {
    if (C !== call || call.ended || call.held || call.byeTimer || !call.heard || !saidBye(call)) return;
    const wait = () => {
      if (C !== call || call.ended) return;
      if (call.talking || call.held || !saidBye(call)) { call.byeTimer = null; return; }   // it carried on talking, or is on hold
      const left = call.mode === 'voice' && call.ctx ? (call.playAt - call.ctx.currentTime) * 1000 : (window.speechSynthesis && speechSynthesis.speaking ? 300 : 0);
      if (left > 50) { call.byeTimer = setTimeout(wait, Math.min(left + 20, 1000)); return; }
      if (!call.byeSince) { call.byeSince = Date.now(); call.byeTimer = setTimeout(wait, 1200); return; }
      call.byeTimer = null;
      call.opts.onNotice && call.opts.onNotice('📞 The caller said goodbye and hung up.');
      call.endedBy = 'caller'; call.opts.onState && call.opts.onState('ended', 'goodbye');
    };
    call.byeSince = 0;
    call.byeTimer = setTimeout(wait, 300);
  }

  function addText(call, who, text) {
    if (!call.line || call.line.who !== who) { call.line = { who, text: '', id: who + (++call.seq) }; call.transcript.push(call.line); }
    call.line.text = (call.line.text + text).replace(/\s+/g, ' ').replace(/^\s+/, '');
    call.opts.onLine && call.opts.onLine(who, call.line.text, call.line.id);
  }

  function play(call, data, mime) {
    const ctx = call.ctx; if (!ctx || ctx.state === 'closed' || call.held) return;
    const rate = Number((/rate=(\d+)/.exec(mime || '') || [])[1]) || 24000;
    const pcm = new Int16Array(unb64(data));
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, rate), ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(voiceOut(call));
    if (call.recDest) src.connect(call.recDest);
    const at = Math.max(ctx.currentTime + 0.03, call.playAt);
    src.start(at); call.playAt = at + buf.duration;
    call.playing.push(src);
    src.onended = () => { call.playing = call.playing.filter((s) => s !== src); };
  }
  // The caller's voice: evened out (a gentle compressor) and lifted, so it sounds close and clear, not faint and far away.
  function voiceOut(call) {
    if (call.voiceOut) return call.voiceOut;
    const ctx = call.ctx, comp = ctx.createDynamicsCompressor(), gain = ctx.createGain();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    gain.gain.value = 1.8;
    comp.connect(gain); gain.connect(ctx.destination);
    return (call.voiceOut = comp);
  }
  function flush(call) { call.playing.forEach((s) => { try { s.stop(); } catch (e) {} }); call.playing = []; call.playAt = 0; }

  /* ---------- text mode ---------- */
  async function startText(call, why) {
    unprepare();   // the line warmed while it rang isn't needed
    call.mode = 'text';
    if (call.ctx) { if (window.VoIP && VoIP.Speaker) VoIP.Speaker.unregister(call.ctx); try { call.ctx.close(); } catch (e) {} call.ctx = null; }
    if (why) call.opts.onNotice && call.opts.onNotice(why);
    call.opts.onState && call.opts.onState('live');
    call.maxSeconds = call.maxSeconds || 0;
    return 'text';
  }
  async function textTurn(call, text) {
    if (text) { call.heard = true; call.line = null; addText(call, 'applicant', text); call.line = null; }
    call.busy = true; call.opts.onBusy && call.opts.onBusy(true);
    try {
      const r = await API.post('/api/ai/text', { callId: call.opts.callId, text: text || '' });
      if (C !== call || call.ended) return;
      if (r.text) { call.line = null; addText(call, 'caller', r.text); call.line = null; speak(call, r.text); byeCheck(call); }
    } catch (e) { call.opts.onError && call.opts.onError(e.message); }
    finally { call.busy = false; call.opts.onBusy && call.opts.onBusy(false); }
  }
  function speak(call, text) {
    if (!call.opts.readAloud || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
      if (vs.length) u.voice = vs[(call.opts.gender === 'm' ? 1 : 0) % vs.length];
      u.rate = 1.02; speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------- controls ---------- */
  function say(text, hidden) {
    const call = C; if (!call) return false;
    if (call.mode === 'text') { if (hidden) return false; textTurn(call, String(text)); return true; }
    if (!call.ws || call.ws.readyState !== 1) return false;
    call.ws.send(JSON.stringify({ realtimeInput: { text: String(text) } }));
    if (!hidden) { call.heard = true; call.line = null; addText(call, 'applicant', String(text)); call.line = null; }
    return true;
  }
  function mute(on) { if (C) C.muted = !!on; return C ? C.muted : false; }
  function hold(on) {
    const call = C; if (!call) return false;
    call.held = !!on;
    if (on) flush(call);
    if (call.mode === 'voice') say(on ? '(You are on hold.)' : '(The line is back.)', true);
    if (!on && call.pendingCue) { const t = call.pendingCue; call.pendingCue = null; say(t, true); }
    return call.held;
  }
  // The transfer rings the extension for a few seconds: someone picks up (the call is handed over and ends) or nobody does.
  function transfer(name, available) {
    const call = C; if (!call) return Promise.resolve('ended');
    if (call.mode === 'voice') say(`(The person on the line is transferring you to ${name}. You are on hold.)`, true);
    call.held = true; flush(call);
    return new Promise((resolve) => setTimeout(() => {
      if (C !== call) return resolve('ended');
      if (available) return resolve('connected');
      call.held = false;
      if (call.mode === 'voice') say(`(The transfer to ${name} didn't go through: nobody picked up. The person who answered is back on the line.)`, true);
      if (call.pendingCue) { const t = call.pendingCue; call.pendingCue = null; say(t, true); }
      resolve('no-answer');
    }, 5500));
  }

  function finish(call) {
    call.ended = true;
    clearTimeout(call.kick); clearTimeout(call.warn); clearTimeout(call.limit); clearTimeout(call.byeTimer); (call.cues || []).forEach(clearTimeout);
    try { if (call.ws && call.ws.readyState <= 1) call.ws.close(1000); } catch (e) {}
    flush(call);
    try { if (call.src) call.src.disconnect(); } catch (e) {}
    try { if (call.node) { call.node.port.onmessage = null; call.node.disconnect(); } } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  }
  // Ends the call; resolves with the transcript and the recording (if any).
  function stop(silent, keepWarm) {
    if (!keepWarm) unprepare();
    const call = C; if (!call) return Promise.resolve(null);
    C = null;
    finish(call);
    const transcript = call.transcript.map((x) => ({ who: x.who, text: x.text })).filter((x) => x.text);
    const closeCtx = () => { if (window.VoIP && VoIP.Speaker) VoIP.Speaker.unregister(call.ctx); try { if (call.ctx && call.ctx.state !== 'closed') call.ctx.close(); } catch (e) {} };
    return new Promise((resolve) => {
      const done = (recording) => { closeCtx(); if (!silent && call.opts.onState) call.opts.onState('ended'); resolve({ transcript, recording, mode: call.mode, endedBy: call.endedBy || 'applicant' }); };
      if (!call.rec || call.rec.state === 'inactive') return done(null);
      call.rec.onstop = () => done(call.recChunks.length ? { blob: new Blob(call.recChunks, { type: (call.rec.mimeType || 'audio/webm').split(';')[0] }), type: (call.rec.mimeType || 'audio/webm').split(';')[0] } : null);
      try { call.rec.stop(); } catch (e) { done(null); }
    });
  }

  window.addEventListener('pagehide', () => { if (C) stop(true); });
  window.AiCall = { start, prepare, unprepare, stop, say, mute, hold, transfer, voiceSupported, active: () => !!C, mode: () => (C ? C.mode : null), busy: () => !!(C && C.busy) };
})();
