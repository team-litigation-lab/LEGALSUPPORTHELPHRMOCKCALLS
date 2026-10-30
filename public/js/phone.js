/* =========================================================
   The VOIP engine
   ---------------------------------------------------------
   Board      this phone's line to the Switchboard (a WebSocket that
              reconnects on its own, pings every 20 s, and queues
              messages while it is reconnecting).
   RtcCall    one WebRTC audio call between HR's console and the
              applicant's phone. HR's side makes the offer;
              ICE candidates trickle both ways through the Switchboard.
              If the network drops, HR's side restarts ICE.
   Recorder   mixes both voices on HR's console into one WebM/Opus
              file (the applicant sees "recorded" on screen).
   Mic        opens the microphone with echo cancellation.
   ========================================================= */
(function () {
  'use strict';

  class Board {
    constructor() { this.ws = null; this.handlers = {}; this.queue = []; this.stopped = true; this.backoff = 1000; this.up = false; this.cid = null; this.fails = 0; }
    on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); return this; }
    emit(t, m) { (this.handlers[t] || []).forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } }); (this.handlers['*'] || []).forEach((fn) => { try { fn(m); } catch (e) {} }); }
    connect() {
      this.stopped = false;
      if (this.ws && this.ws.readyState <= 1) return;
      // The sign-in token travels as a subprotocol, not in the URL.
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws;
      try { ws = new WebSocket(url, ['hrmc', API.token || '']); } catch (e) { return this.retry(); }
      this.ws = ws;
      ws.onopen = () => { this.backoff = 1000; clearInterval(this.ping); this.ping = setInterval(() => { if (ws.readyState === 1) ws.send('ping'); }, 20000); };
      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') {
          this.up = true; this.cid = m.cid; this.fails = 0;
          this.emit('up', m);
          const q = this.queue; this.queue = [];
          q.forEach((x) => this.send(x));
        }
        this.emit(m.t, m);
      };
      ws.onclose = (ev) => {
        clearInterval(this.ping);
        const was = this.up; this.up = false;
        if (this.ws === ws) this.ws = null;
        if (was) this.emit('down', { code: ev.code });
        if (ev.code === 1008 || ev.code === 4001) return;
        this.retry();
      };
      ws.onerror = () => {};
    }
    retry() {
      if (this.stopped) return;
      // Several failures in a row: maybe the sign-in expired (a refused WebSocket can't say why).
      if (++this.fails >= 3) { this.fails = 0; this.emit('trouble', {}); }
      clearTimeout(this.rt);
      this.rt = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 1.7, 10000);
    }
    send(obj) {
      if (this.ws && this.ws.readyState === 1 && this.up) { this.ws.send(JSON.stringify(obj)); return true; }
      if (this.queue.length < 300) this.queue.push(obj);
      return false;
    }
    close() { this.stopped = true; clearTimeout(this.rt); clearInterval(this.ping); if (this.ws) try { this.ws.close(1000); } catch (e) {} this.ws = null; this.up = false; }
  }

  const Mic = {
    stream: null,
    async open() {
      if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('This browser can\'t use a microphone here. Use Chrome or Edge on a computer, over https.'), { code: 'NO_MIC' });
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      } catch (e) {
        const blocked = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        throw Object.assign(new Error(blocked ? 'The microphone is blocked. Click the 🔒 in the address bar, allow the microphone, then try again.' : 'No microphone was found. Plug in a headset, then try again.'), { code: 'NO_MIC' });
      }
      return this.stream;
    },
    close() { if (this.stream) this.stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); this.stream = null; },
    track() { return this.stream ? this.stream.getAudioTracks()[0] : null; }
  };

  let iceCache = null;
  async function ice() {
    if (iceCache && iceCache.at > Date.now() - 3600000) return iceCache.servers;
    try { const r = await API.post('/api/ice'); iceCache = { at: Date.now(), servers: r.iceServers, turn: r.turn }; return r.iceServers; }
    catch (e) { return [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]; }
  }

  /* A clear voice: Opus in full band at a speech-friendly 64 kbps with loss recovery, and no DTX (discontinuous
     transmission, which clips the starts of words and makes the far end sound muffled and far away). */
  function clear(desc) {
    const sdp = String(desc.sdp || '');
    const pt = (/a=rtpmap:(\d+) opus\/48000/i.exec(sdp) || [])[1];
    if (!pt) return desc;
    const want = { maxaveragebitrate: '64000', useinbandfec: '1', usedtx: '0', maxplaybackrate: '48000', 'sprop-maxcapturerate': '48000', stereo: '0' };
    const re = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
    let out;
    if (re.test(sdp)) out = sdp.replace(re, (all, params) => {
      const p = {}; params.split(';').map((x) => x.trim()).filter(Boolean).forEach((x) => { const [k, v] = x.split('='); p[k] = v; });
      Object.assign(p, want);
      return 'a=fmtp:' + pt + ' ' + Object.entries(p).map(([k, v]) => (v === undefined ? k : k + '=' + v)).join(';');
    });
    else out = sdp.replace(new RegExp('(a=rtpmap:' + pt + ' opus\\/48000[^\\r\\n]*\\r?\\n)'), '$1a=fmtp:' + pt + ' ' + Object.entries(want).map(([k, v]) => k + '=' + v).join(';') + '\r\n');
    return { type: desc.type, sdp: out };
  }

  class RtcCall {
    /* opts: { board, callId, offerer, iceServers, stream, onRemote(stream), onState(state), onQuality(q) } */
    constructor(o) {
      // gen: which connection this is. A phone that reloads mid-call starts a new one (a new gen),
      // and the other side drops its old connection when it sees the new gen's offer.
      this.o = o; this.callId = o.callId; this.gen = o.gen || 0; this.pending = []; this.closed = false; this.restarts = 0;
      const pc = this.pc = new RTCPeerConnection({ iceServers: o.iceServers, iceCandidatePoolSize: 2 });
      const track = o.stream.getAudioTracks()[0];
      this.sender = pc.addTrack(track, o.stream);
      pc.ontrack = (e) => { const s = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]); this.remote = s; o.onRemote && o.onRemote(s); };
      pc.onicecandidate = (e) => { if (e.candidate) this.signal({ candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        o.onState && o.onState(st);
        if (st === 'failed') this.recover();
        if (st === 'disconnected') { clearTimeout(this.dt); this.dt = setTimeout(() => { if (pc.connectionState === 'disconnected') this.recover(); }, 4000); }
        if (st === 'connected') { this.restarts = 0; this.startStats(); }
      };
    }
    signal(data) { this.o.board.send({ t: 'signal', callId: this.callId, data: Object.assign({ gen: this.gen }, data) }); }
    async start() {
      if (!this.o.offerer) return;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(clear(offer));
      this.signal({ sdp: this.pc.localDescription.toJSON() });
    }
    async handle(data) {
      if (this.closed || !data) return;
      const pc = this.pc;
      try {
        if (data.restart) { if (this.o.offerer) this.recover(true); return; }
        if (data.sdp) {
          if (data.sdp.type === 'offer' && pc.signalingState !== 'stable') await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
          await pc.setRemoteDescription(data.sdp);
          const p = this.pending; this.pending = [];
          for (const c of p) await pc.addIceCandidate(c).catch(() => {});
          if (data.sdp.type === 'offer') {
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(clear(ans));
            this.signal({ sdp: pc.localDescription.toJSON() });
          }
        } else if (data.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(data.candidate).catch(() => {});
          else this.pending.push(data.candidate);
        }
      } catch (e) { console.warn('signal', e); }
    }
    // The connection dropped: the offerer restarts ICE; the answerer asks it to.
    async recover(force) {
      if (this.closed) return;
      if (!this.o.offerer) { this.signal({ restart: true }); return; }
      if (!force && this.restarts > 6) return;
      this.restarts++;
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(clear(offer));
        this.signal({ sdp: this.pc.localDescription.toJSON() });
      } catch (e) { console.warn('ice restart', e); }
    }
    setOutgoing(track) { return this.sender.replaceTrack(track).catch(() => {}); }
    startStats() {
      if (this.statsTimer) return;
      let lastLost = 0, lastRecv = 0;
      this.statsTimer = setInterval(async () => {
        if (this.closed) return;
        try {
          const rep = await this.pc.getStats();
          let rtt = null, jitter = null, lost = 0, recv = 0, relay = false;
          rep.forEach((s) => {
            if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
              if (s.currentRoundTripTime != null) rtt = s.currentRoundTripTime * 1000;
              const lc = rep.get(s.localCandidateId), rc = rep.get(s.remoteCandidateId);
              relay = (lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay');
            }
            if (s.type === 'inbound-rtp' && s.kind === 'audio') { jitter = (s.jitter || 0) * 1000; lost = s.packetsLost || 0; recv = s.packetsReceived || 0; }
          });
          const dl = lost - lastLost, dr = recv - lastRecv; lastLost = lost; lastRecv = recv;
          const loss = dr + dl > 0 ? (dl / (dr + dl)) * 100 : 0;
          let bars = 4;
          if (rtt > 300 || loss > 3 || jitter > 50) bars = 3;
          if (rtt > 500 || loss > 8 || jitter > 90) bars = 2;
          if (rtt > 900 || loss > 20) bars = 1;
          this.o.onQuality && this.o.onQuality({ bars, rtt: rtt == null ? null : Math.round(rtt), loss: Math.round(loss * 10) / 10, jitter: jitter == null ? null : Math.round(jitter), relay });
        } catch (e) { /* closed */ }
      }, 2000);
    }
    close() { this.closed = true; clearInterval(this.statsTimer); clearTimeout(this.dt); try { this.pc.close(); } catch (e) {} }
  }

  // Both voices in one file. Chrome needs the remote stream to also play in an <audio> element (it does).
  class Recorder {
    constructor(streams) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.dest = this.ctx.createMediaStreamDestination();
      this.sources = [];
      streams.filter(Boolean).forEach((s) => this.add(s));
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const type = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      this.chunks = [];
      this.mr = new MediaRecorder(this.dest.stream, Object.assign({ audioBitsPerSecond: 32000 }, type ? { mimeType: type } : {}));
      this.mr.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
      this.started = Date.now();
      this.mr.start(1000);
    }
    pause() { try { if (this.mr.state === 'recording') this.mr.pause(); } catch (e) {} }
    resume() { try { if (this.mr.state === 'paused') this.mr.resume(); } catch (e) {} }
    add(stream) { try { const src = this.ctx.createMediaStreamSource(stream); src.connect(this.dest); this.sources.push(src); } catch (e) { console.warn('recorder', e); } }
    stop() {
      return new Promise((resolve) => {
        const done = () => {
          const type = (this.mr.mimeType || 'audio/webm').split(';')[0];
          const blob = new Blob(this.chunks, { type });
          try { this.ctx.close(); } catch (e) {}
          resolve({ blob, type, durMs: Date.now() - this.started });
        };
        if (this.mr.state === 'inactive') return done();
        this.mr.onstop = done;
        try { this.mr.stop(); } catch (e) { done(); }
      });
    }
  }

  // Microphone level (0 to 1) for the mic check and the "you're talking" light.
  function meter(stream, onLevel) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const c = new Ctx(), src = c.createMediaStreamSource(stream), an = c.createAnalyser();
    an.fftSize = 512; src.connect(an);
    const data = new Uint8Array(an.fftSize);
    let raf;
    const tick = () => { an.getByteTimeDomainData(data); let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128)); onLevel(Math.min(1, peak / 64)); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); try { c.close(); } catch (e) {} };
  }

  /* 🔊 Speaker: where the call is heard, like a desk phone's speaker key.
     Off: the headset (the computer's default audio output). On: the speakers, so a room can listen.
     The call audio, the phone's sounds (ringing, ringback, keypad tones) and the AI caller all follow it.
     Chrome and Edge can send audio to a chosen output (setSinkId); the speaker is found by its name
     ("Speakers", "Built-in", "Realtek"…) unless the audio check sets one. Kept on this computer. */
  const SPK_KEY = 'hrmc_speaker';
  const SPK_NAME = /speaker|built-?in|internal|realtek|lautsprecher|altavoz|haut-parleur|alto-falante|altoparlant/i;
  const NOT_SPK = /headset|headphone|earphone|earbud|airpods|buds|hands-?free|bluetooth/i;
  const Speaker = {
    on: false, headset: '', speaker: '', targets: new Set(), listeners: new Set(), last: null,
    load() { try { Object.assign(this, JSON.parse(localStorage.getItem(SPK_KEY) || '{}')); } catch (e) {} return this; },
    store() { try { localStorage.setItem(SPK_KEY, JSON.stringify({ on: this.on, headset: this.headset, speaker: this.speaker })); } catch (e) {} },
    supported() { return !!(window.HTMLMediaElement && 'setSinkId' in HTMLMediaElement.prototype); },
    async outputs() {
      try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch (e) { return []; }
    },
    // The outputs to use: { headset, speaker } device ids, their names, and whether the speaker is a different output.
    async route() {
      const list = await this.outputs();
      const real = list.filter((d) => !['default', 'communications', ''].includes(d.deviceId));
      const def = list.find((d) => d.deviceId === 'default') || real[0] || null;
      const has = (id) => id && list.some((d) => d.deviceId === id);
      const headset = has(this.headset) ? this.headset : 'default';
      let speaker = has(this.speaker) ? list.find((d) => d.deviceId === this.speaker) : null;
      if (!speaker) {
        const other = real.filter((d) => !def || d.groupId !== def.groupId);
        speaker = other.find((d) => SPK_NAME.test(d.label) && !NOT_SPK.test(d.label))
          || (def && SPK_NAME.test(def.label) && !NOT_SPK.test(def.label) ? def : null)
          || other.find((d) => !NOT_SPK.test(d.label)) || null;
      }
      const name = (id) => { const d = list.find((x) => x.deviceId === id); return d ? d.label.replace(/^(Default|Communications) - /, '') : ''; };
      const speakerId = speaker ? speaker.deviceId : headset;
      const same = (a, b) => { const x = list.find((d) => d.deviceId === a), y = list.find((d) => d.deviceId === b); return a === b || (x && y && x.groupId && x.groupId === y.groupId); };
      return { list, headset, speaker: speakerId, headsetName: name(headset) || 'the computer\'s sound', speakerName: name(speakerId) || 'the computer\'s sound', separate: !same(headset, speakerId) };
    },
    async sinkId() { const r = this.last = await this.route(); return this.on ? r.speaker : r.headset; },
    // A <audio> element or an AudioContext that plays call audio.
    async register(target) { if (!target) return; this.targets.add(target); try { await this.applyTo(target, await this.sinkId()); } catch (e) {} },
    unregister(target) { this.targets.delete(target); },
    async applyTo(t, id) {
      if (!t || typeof t.setSinkId !== 'function' || (t.state === 'closed')) return;
      const want = id === 'default' ? '' : id;
      if ((t.sinkId || '') === want || (t.sinkId && t.sinkId.type === 'none')) return;
      try { await t.setSinkId(want); } catch (e) { console.warn('setSinkId', e && e.message); }
    },
    async apply() { const id = await this.sinkId(); await Promise.all([...this.targets].map((t) => this.applyTo(t, id))); return id; },
    // Turn the speaker on or off. Returns a note when there's nothing to switch to.
    async set(on) {
      this.on = !!on; this.store();
      await this.apply();
      const r = this.last || {};
      let note = '';
      if (!this.supported()) note = 'This browser can\'t choose where sound plays: use Chrome or Edge.';
      else if (this.on && !r.separate) note = (r.list || []).length > 1 || (r.list || []).some((d) => d.label) ? `There's no separate speaker: the call plays on ${r.speakerName}. Choose one in 🎧 Audio check.` : 'Allow the microphone (🎧 Audio check) so the phone can find your speakers.';
      this.listeners.forEach((f) => { try { f(this.on); } catch (e) {} });
      return { on: this.on, note, name: this.on ? r.speakerName : r.headsetName };
    },
    toggle() { return this.set(!this.on); },
    onChange(f) { this.listeners.add(f); }
  }.load();
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => { Speaker.apply().catch(() => {}); });
  document.addEventListener('DOMContentLoaded', () => Speaker.register(document.getElementById('remoteAudio')));

  window.VoIP = { Board, Mic, RtcCall, Recorder, ice, meter, Speaker, iceInfo: () => iceCache };
})();
