/* =========================================================
   The Switchboard: one Durable Object that is the phone system.
   ---------------------------------------------------------
   • Every open phone (an applicant's softphone, HR's console) holds
     a WebSocket here (hibernation API, so an idle line costs nothing).
     Its attachment says who it is and what it's doing.
   • Live calls: HR rings an applicant, every tab the applicant has
     open rings, the first to answer takes the call, and the two
     browsers exchange WebRTC offers, answers and ICE candidates
     through here. The audio itself goes browser to browser (or
     through the TURN relay), never through this object.
   • 🤖 Agent caller: HR sends an AI caller to the applicant's phone.
     It rings like any call; the applicant's browser runs the
     conversation with Gemini Live and HR follows the transcript.
   • Hold, mute, transfer and the applicant's note travel as small
     messages, and the call record keeps the timings (rings, holds,
     transfers).
   • A dropped connection gets a grace period to come back before
     the call is ended; an unanswered call rings out as "missed".
   • Applicants, HR desks and call records are kept in this
     object's SQLite storage.
   Roles: h = HR, c = applicant.
   ========================================================= */
import { DurableObject } from 'cloudflare:workers';
import { COMPANY, DIRECTORY, NOTE_FIELDS, scenarioById, openCall, callerIdOf, voiceOk } from './scenarios.js';

const RING_MS = 45000;      // an unanswered call rings out after 45 seconds
const GRACE_MS = 30000;     // a dropped phone has 30 seconds to reconnect before its call ends
const MAX_CALL_MS = 2 * 3600 * 1000;
const HR_EXT = 8000;        // HR desk extensions: 8001, 8002, … (applicants are 7001 and up)
const APPLICANT_EXT = 7000;
const OPEN = 1;

const now = () => Date.now();
const newId = () => new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
const inviteCode = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(12)); return Array.from(b, (x) => a[x % a.length]).join(''); };
const aiMs = (env) => (Math.min(15, Math.max(2, Number(env.AI_MAX_MINUTES) || 8)) + 2) * 60000;

function cleanNote(note) {
  const out = {};
  NOTE_FIELDS.forEach((f) => { const v = note && note[f.k]; if (v != null && v !== '') out[f.k] = String(v).slice(0, f.type === 'textarea' ? 4000 : 400); });
  return out;
}

export class Switchboard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 🔗 One-time access: an applicant's invite link signs them in once (invite_used). That opens one session
    // (session, session_exp); a new link or a closed one ends it.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS applicants (id TEXT PRIMARY KEY, name TEXT, position TEXT, ext TEXT, invite TEXT, invite_exp INTEGER, invite_used INTEGER,
      session TEXT, session_exp INTEGER, created_by TEXT, created_at INTEGER, last_seen INTEGER, archived INTEGER DEFAULT 0)`);
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS applicants_by_ext ON applicants (ext)');
    // The name HR invited them under; `name` is the one the applicant types when they open their link.
    if (!this.sql.exec(`SELECT name FROM pragma_table_info('applicants') WHERE name = 'invited_as'`).toArray().length) this.sql.exec('ALTER TABLE applicants ADD COLUMN invited_as TEXT');
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS applicants_by_invite ON applicants (invite)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hr (name TEXT PRIMARY KEY, ext TEXT, created_at INTEGER, last_seen INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, mode TEXT, scenario_id TEXT, title TEXT, applicant_id TEXT, applicant_name TEXT, position TEXT, hr TEXT,
      status TEXT, created_at INTEGER, answered_at INTEGER, ended_at INTEGER, score REAL, data TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS calls_by_applicant ON calls (applicant_id, created_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS calls_by_time ON calls (created_at)`);
    // 👤 HR interviewer accounts, made by the admin (src/auth.js hashes the passwords).
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hr_users (username TEXT PRIMARY KEY, name TEXT, pass TEXT, disabled INTEGER DEFAULT 0, created_at INTEGER, last_login INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT, kind TEXT, at INTEGER)`);
    // Phones ping every 20 seconds; this answers without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /* ---------------- storage helpers ---------------- */
  row(id) {
    const r = this.sql.exec('SELECT * FROM calls WHERE id = ?', id).toArray()[0];
    if (!r) return null;
    r.data = JSON.parse(r.data || '{}');
    return r;
  }
  save(r) {
    this.sql.exec(`INSERT OR REPLACE INTO calls (id, mode, scenario_id, title, applicant_id, applicant_name, position, hr, status, created_at, answered_at, ended_at, score, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id, r.mode, r.scenario_id, r.title, r.applicant_id, r.applicant_name, r.position, r.hr, r.status,
    r.created_at, r.answered_at || null, r.ended_at || null, r.score == null ? null : r.score, JSON.stringify(r.data || {}));
  }
  applicant(id) { return this.sql.exec('SELECT * FROM applicants WHERE id = ?', id).toArray()[0] || null; }
  // An HR account's own desk extension, given the first time that name opens the console.
  hrExt(name) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) return '';
    const cur = this.sql.exec('SELECT ext FROM hr WHERE name = ?', n).toArray()[0];
    if (cur && cur.ext) { this.sql.exec('UPDATE hr SET last_seen = ? WHERE name = ?', now(), n); return cur.ext; }
    const top = this.sql.exec('SELECT MAX(CAST(ext AS INTEGER)) AS n FROM hr').toArray()[0].n;
    const ext = String(Math.max(HR_EXT, Number(top) || 0) + 1);
    this.sql.exec('INSERT OR REPLACE INTO hr (name, ext, created_at, last_seen) VALUES (?, ?, ?, ?)', n, ext, now(), now());
    return ext;
  }

  /* ---------------- sockets ---------------- */
  open(tag) { return this.ctx.getWebSockets(tag).filter((w) => w.readyState === OPEN); }
  byCid(cid) { return cid ? this.open('c:' + cid)[0] || null : null; }
  send(ws, msg) { if (!ws) return; try { ws.send(JSON.stringify(msg)); } catch (e) { /* closing */ } }
  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, patch) { const a = Object.assign(this.att(ws), patch); ws.serializeAttachment(a); return a; }
  tellHR(msg) { for (const w of this.open('r:h')) this.send(w, msg); }
  busy(phones) { return phones.some((w) => { const a = this.att(w); if (!a.call) return false; const c = this.row(a.call); return c && ['ringing', 'live'].includes(c.status); }); }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    let who; try { who = JSON.parse(request.headers.get('X-Who') || ''); } catch (e) { who = null; }
    if (!who || !who.role || !who.id) return new Response('Unauthorized', { status: 401 });
    const prof = who.role === 'c' ? this.applicant(who.id) : null;
    if (who.role === 'c' && (!prof || prof.archived)) return new Response('Unknown applicant', { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const cid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    this.ctx.acceptWebSocket(server, ['c:' + cid, 'u:' + who.id, 'r:' + who.role]);
    const ext = who.role === 'h' ? this.hrExt(who.id) : (prof ? prof.ext || '' : '');
    const me = { cid, role: who.role, id: who.id, user: who.user || '', name: prof ? prof.name : who.id, position: prof ? prof.position : '', ext, status: who.role === 'c' ? 'available' : 'online', call: null, at: now() };
    server.serializeAttachment(me);
    if (prof) this.sql.exec('UPDATE applicants SET last_seen = ? WHERE id = ?', now(), who.id);
    // A phone that reconnects mid-call is told about it, so it can resume.
    const active = this.sql.exec(`SELECT id FROM calls WHERE status IN ('ringing', 'live') AND ${who.role === 'c' ? 'applicant_id' : 'hr'} = ? AND mode = 'live' ORDER BY created_at DESC LIMIT 1`, who.id).toArray()[0];
    this.send(server, { t: 'hello', cid, me, active: active ? this.brief(this.row(active.id), who.role) : null, company: COMPANY.name });
    this.presence();
    // The phone sends its token as a WebSocket subprotocol ("hrmc", <token>), so it stays out of URLs and logs.
    const proto = /(^|,\s*)hrmc(\s*,|$)/.test(request.headers.get('Sec-WebSocket-Protocol') || '') ? { 'Sec-WebSocket-Protocol': 'hrmc' } : {};
    return new Response(null, { status: 101, webSocket: client, headers: proto });
  }

  // What each side is told about a call.
  brief(r, role) {
    const s = r.data.scenario;
    const b = { callId: r.id, mode: r.mode, status: r.status, lineLabel: COMPANY.line, lineNumber: COMPANY.number, callerId: callerIdOf(s, r.data.withheld),
      createdAt: r.created_at, answeredAt: r.answered_at || null, recording: !!r.data.record, hr: r.hr, live: r.data.live || {} };
    if (role === 'h') Object.assign(b, { scenario: s, applicant: { id: r.applicant_id, name: r.applicant_name, position: r.position, ext: (this.applicant(r.applicant_id) || {}).ext || '' }, note: r.data.note || {}, metrics: r.data.metrics || {} });
    else Object.assign(b, { hrCid: r.data.hrCid || null, note: r.data.note || {} });
    return b;
  }

  // HR sees every applicant phone that is open; an applicant sees only whether HR is on.
  presence(exclude) {
    const all = this.ctx.getWebSockets().filter((w) => w !== exclude && w.readyState === OPEN).map((w) => [w, this.att(w)]);
    const byId = new Map();
    for (const [, a] of all) {
      if (a.role !== 'c') continue;
      const cur = byId.get(a.id) || { id: a.id, name: a.name, position: a.position, ext: a.ext || '', status: 'away', call: null, tabs: 0 };
      cur.tabs++;
      if (a.status === 'available') cur.status = 'available';
      if (a.call) cur.call = a.call;
      byId.set(a.id, cur);
    }
    const desks = new Map();
    for (const [, a] of all) {
      if (a.role !== 'h') continue;
      const cur = desks.get(a.name) || { name: a.name, ext: a.ext || '', call: false };
      if (a.call) cur.call = true;
      desks.set(a.name, cur);
    }
    const applicants = [...byId.values()], hr = [...desks.values()];
    for (const [w, a] of all) {
      if (a.role === 'h') this.send(w, { t: 'presence', applicants, hr });
      else this.send(w, { t: 'presence', hr: hr.length });
    }
  }

  // The other party's phone on a live call.
  peerOf(r, role) { return this.byCid(role === 'h' ? r.data.applicantCid : r.data.hrCid); }
  clearCallOn(id) { for (const w of this.ctx.getWebSockets()) { const a = this.att(w); if (a.call === id) this.setAtt(w, { call: null }); } }

  endCall(r, by, reason) {
    if (!r || !['ringing', 'live'].includes(r.status)) return;
    const t = now();
    const m = r.data.metrics = r.data.metrics || {};
    if (r.status === 'ringing') r.status = reason === 'declined' ? 'declined' : reason === 'no-answer' ? 'missed' : 'cancelled';
    else {
      r.status = 'ended';
      m.talkMs = t - (r.answered_at || t);
      const h = (m.holds || [])[m.holds ? m.holds.length - 1 : 0];
      if (h && !h.end) h.end = t;
    }
    r.ended_at = t; m.endedBy = by; m.endReason = reason || '';
    delete r.data.lost; delete r.data.live;
    (r.data.events = r.data.events || []).push({ t: 'end', by, reason, at: t });
    this.save(r);
    // Every phone of both people hears it (a tab that reloaded mid-call isn't tied to the call yet).
    const msg = { t: 'ended', callId: r.id, by, reason, status: r.status };
    for (const w of this.ctx.getWebSockets()) {
      const a = this.att(w);
      if (a.call === r.id || (a.role === 'c' && a.id === r.applicant_id) || (a.role === 'h' && (a.cid === r.data.hrCid || a.id === r.hr))) this.send(w, msg);
    }
    this.clearCallOn(r.id);
    this.presence();
  }

  setLive(r, patch) { r.data.live = Object.assign({}, r.data.live || {}, patch); }

  async armAlarm(at) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > at) await this.ctx.storage.setAlarm(at);
  }

  // Rings out unanswered calls, ends calls whose phone didn't come back, and ends calls that ran too long
  // (live calls after 2 hours; AI calls a little after their time limit, even if the tab was closed).
  async alarm() {
    const t = now();
    let next = 0;
    const want = (at) => { next = next ? Math.min(next, at) : at; };
    for (const x of this.sql.exec(`SELECT id FROM calls WHERE status IN ('ringing', 'live')`).toArray()) {
      const r = this.row(x.id);
      if (r.mode === 'ai') {
        if (t - r.created_at >= aiMs(this.env)) {
          r.status = 'ended'; r.ended_at = t; r.data.metrics = Object.assign({ endedBy: 'caller', endReason: 'time-limit' }, r.data.metrics || {}); this.save(r);
          this.freePhones(r); this.tellHR({ t: 'ai-call', call: this.aiBrief(r) });
        } else want(r.created_at + aiMs(this.env));
        continue;
      }
      if (r.status === 'ringing') {
        if (t - r.created_at >= RING_MS) this.endCall(r, 'system', 'no-answer'); else want(r.created_at + RING_MS);
        continue;
      }
      const lost = r.data.lost || {};
      const gone = ['h', 'c'].find((role) => lost[role] && t - lost[role] >= GRACE_MS);
      if (gone) { this.endCall(r, gone === 'h' ? 'hr' : 'applicant', 'disconnected'); continue; }
      ['h', 'c'].forEach((role) => { if (lost[role]) want(lost[role] + GRACE_MS); });
      const end = (r.answered_at || r.created_at) + MAX_CALL_MS;
      if (t >= end) this.endCall(r, 'system', 'time-limit'); else want(end);
    }
    if (next) await this.ctx.storage.setAlarm(next + 250);
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 100000) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const me = this.att(ws);
    const t = now();
    const err = (msg) => this.send(ws, { t: 'error', msg });
    const r = m.callId ? this.row(String(m.callId)) : null;
    const party = r && ((me.role === 'h' && r.data.hrCid === me.cid) || (me.role === 'c' && r.applicant_id === me.id));

    switch (m.t) {
      case 'status':
        if (me.role === 'c') { this.setAtt(ws, { status: m.status === 'away' ? 'away' : 'available' }); this.presence(); }
        return;

      /* ----- 🤖 HR sends the agent caller to an applicant's phone -----
         The AI plays the caller (a scenario, or the persona HR typed); the applicant's phone rings like any
         call and their browser runs the conversation. HR follows it live (transcript and note). */
      case 'ai-ring': {
        if (me.role !== 'h') return;
        const ap = this.applicant(String(m.applicantId || ''));
        if (!ap || ap.archived) return this.send(ws, { t: 'ai-failed', reason: 'Dial an applicant first.' });
        let s;
        if (m.scenarioId) {
          s = scenarioById(String(m.scenarioId));
          if (!s) return this.send(ws, { t: 'ai-failed', reason: 'That scenario isn\'t in the list any more.' });
          if (s.ai === false) return this.send(ws, { t: 'ai-failed', reason: `"${s.title}" is live-only: ring it yourself.` });
        } else s = openCall({ persona: String(m.persona || ''), callerName: m.callerName, callerNumber: m.callerNumber, gender: m.gender, opening: m.opening });
        const phones = this.open('u:' + ap.id).filter((w) => this.att(w).role === 'c');
        if (!phones.length) return this.send(ws, { t: 'ai-failed', reason: `${ap.name}'s phone isn't open.` });
        if (this.busy(phones)) return this.send(ws, { t: 'ai-failed', reason: `${ap.name} is on another call.` });
        if (this.countUsage(me.id, 'aiassign', 3600000) >= 120) return this.send(ws, { t: 'ai-failed', reason: 'That\'s a lot of AI calls this hour. Try again in a little while.' });
        this.logUsage(me.id, 'aiassign');
        const r2 = { id: newId(), mode: 'ai', scenario_id: s.id, title: s.title, applicant_id: ap.id, applicant_name: ap.name, position: ap.position, hr: me.name,
          status: 'live', created_at: t, answered_at: null,
          data: { scenario: s, assigned: { by: me.name, cid: me.cid, at: t }, voice: voiceOk(m.voice), withheld: !!m.withhold, metrics: {}, note: {}, transcript: [], events: [{ t: 'ring', at: t }] } };
        this.save(r2);
        phones.forEach((w) => this.setAtt(w, { call: r2.id }));
        phones.forEach((w) => this.send(w, { t: 'ai-incoming', callId: r2.id, lineLabel: COMPANY.line, lineNumber: COMPANY.number, callerId: callerIdOf(s, r2.data.withheld), hr: me.name, gender: s.caller.gender, unavailable: s.unavailable }));
        this.tellHR({ t: 'ai-call', call: this.aiBrief(r2) });
        await this.armAlarm(t + aiMs(this.env));
        this.presence();
        return;
      }
      case 'ai-answer': {   // the applicant picked up (the other tabs stop ringing)
        if (!party || r.mode !== 'ai' || r.status !== 'live') return;
        r.data.assigned.answeredAt = t; r.answered_at = t;
        r.data.metrics = Object.assign(r.data.metrics || {}, { ringMs: t - r.created_at });
        this.save(r);
        for (const w of this.open('u:' + me.id)) if (w !== ws) { this.setAtt(w, { call: null }); this.send(w, { t: 'taken', callId: r.id }); }
        this.tellHR({ t: 'ai-call', call: this.aiBrief(r) });
        return;
      }
      case 'ai-decline': {   // not answered: declined, busy, or rang out
        if (!party || r.mode !== 'ai' || r.status !== 'live' || r.data.assigned.answeredAt) return;
        const why = ['declined', 'busy', 'no-answer'].includes(m.reason) ? m.reason : 'declined';
        r.status = why === 'no-answer' ? 'missed' : why === 'declined' ? 'declined' : 'cancelled'; r.ended_at = t;
        r.data.assigned.outcome = why;
        this.save(r);
        this.freePhones(r);
        this.tellHR({ t: 'ai-call', call: this.aiBrief(r) });
        return;
      }
      case 'ai-line': {   // what was said, as it's transcribed, for HR following the call
        if (!party || me.role !== 'c' || r.mode !== 'ai' || r.status !== 'live') return;
        this.tellHR({ t: 'ai-line', callId: r.id, who: m.who === 'caller' ? 'caller' : 'applicant', id: String(m.id || '').slice(0, 40), text: String(m.text || '').slice(0, 2000) });
        return;
      }
      case 'ai-stop': {   // HR ends an AI call they're following
        if (me.role !== 'h' || !r || r.mode !== 'ai' || r.status !== 'live') return;
        for (const w of this.open('u:' + r.applicant_id)) this.send(w, { t: 'ai-stop', callId: r.id });
        return;
      }

      /* ----- HR rings an applicant (live: HR plays the caller) ----- */
      case 'ring': {
        if (me.role !== 'h') return;
        if (me.call) { const cur = this.row(me.call); if (cur && ['ringing', 'live'].includes(cur.status)) return err('You are already on a call. Hang up first.'); this.setAtt(ws, { call: null }); }
        const s = m.scenarioId ? scenarioById(String(m.scenarioId)) : openCall({ callerName: m.callerName, callerNumber: m.callerNumber });
        const ap = this.applicant(String(m.applicantId || ''));
        if (!ap || ap.archived) return err('Dial an applicant first.');
        if (!s) return err('That scenario isn\'t in the list any more.');
        const phones = this.open('u:' + ap.id).filter((w) => this.att(w).role === 'c');
        if (!phones.length) return this.send(ws, { t: 'ring-failed', reason: `${ap.name} isn't online.` });
        if (this.busy(phones)) return this.send(ws, { t: 'ring-failed', reason: `${ap.name} is on another call.` });
        const r2 = { id: newId(), mode: 'live', scenario_id: s.id, title: s.title, applicant_id: ap.id, applicant_name: ap.name, position: ap.position, hr: me.name,
          status: 'ringing', created_at: t, data: { scenario: s, hrCid: me.cid, record: m.record !== false, withheld: !!m.withhold, metrics: {}, note: {}, events: [{ t: 'ring', at: t }] } };
        this.save(r2);
        this.setAtt(ws, { call: r2.id });
        phones.forEach((w) => { this.setAtt(w, { call: r2.id }); this.send(w, Object.assign({ t: 'incoming' }, this.brief(r2, 'c'))); });
        this.send(ws, Object.assign({ t: 'ringing' }, this.brief(r2, 'h')));
        await this.armAlarm(t + RING_MS);
        this.presence();
        return;
      }
      case 'cancel':
        // A cancel that crosses the applicant's answer still ends the call.
        if (party && me.role === 'h') this.endCall(r, 'hr', r.status === 'live' ? 'hangup' : m.reason === 'no-answer' ? 'no-answer' : 'cancelled');
        return;

      /* ----- the applicant answers or declines ----- */
      case 'accept': {
        if (!party || me.role !== 'c') return;
        if (r.status !== 'ringing') return this.send(ws, { t: 'gone', callId: r.id, status: r.status });
        r.status = 'live'; r.answered_at = t;
        r.data.applicantCid = me.cid;
        r.data.metrics.ringMs = t - r.created_at;
        r.data.events.push({ t: 'answer', at: t });
        this.save(r);
        for (const w of this.open('u:' + me.id)) if (w !== ws) { this.setAtt(w, { call: null }); this.send(w, { t: 'taken', callId: r.id }); }
        this.setAtt(ws, { call: r.id });
        const hr = this.byCid(r.data.hrCid);
        this.send(hr, { t: 'accepted', callId: r.id, applicantCid: me.cid, ringMs: r.data.metrics.ringMs });
        this.send(ws, Object.assign({ t: 'connected' }, this.brief(r, 'c')));
        if (!hr) { r.data.lost = { h: t }; this.save(r); await this.armAlarm(t + GRACE_MS); }
        await this.armAlarm(t + MAX_CALL_MS);
        this.presence();
        return;
      }
      case 'decline':
        if (party && me.role === 'c' && r.status === 'ringing') this.endCall(r, 'applicant', m.busy ? 'busy' : 'declined');
        return;

      /* ----- WebRTC signaling: passed straight to the other phone ----- */
      case 'signal':
        if (!party || r.status !== 'live') return;
        this.send(this.peerOf(r, me.role), { t: 'signal', callId: r.id, data: m.data });
        return;

      /* ----- what happens on the call ----- */
      case 'hold': {
        if (!party || r.status !== 'live' || me.role !== 'c') return;
        const holds = r.data.metrics.holds = r.data.metrics.holds || [];
        const last = holds[holds.length - 1];
        if (m.on && !(last && !last.end)) holds.push({ start: t });
        if (!m.on && last && !last.end) last.end = t;
        const o = holds[holds.length - 1];
        this.setLive(r, { held: !!(o && !o.end), holdAt: o && !o.end ? o.start : 0 });
        this.save(r);
        this.send(this.peerOf(r, 'c'), { t: 'hold', callId: r.id, on: !!m.on, at: t });
        return;
      }
      case 'rec':   // HR's ⏺ key: the call is (or isn't any more) being recorded
        if (!party || me.role !== 'h' || r.status !== 'live') return;
        r.data.record = r.data.record || !!m.on;
        this.setLive(r, { recording: !!m.on }); this.save(r);
        this.send(this.peerOf(r, 'h'), { t: 'rec', callId: r.id, on: !!m.on });
        return;
      case 'mute':
        if (!party || r.status !== 'live') return;
        this.setLive(r, me.role === 'c' ? { applicantMuted: !!m.on } : { hrMuted: !!m.on }); this.save(r);
        this.send(this.peerOf(r, me.role), { t: 'mute', callId: r.id, on: !!m.on });
        return;
      case 'transfer': {
        if (!party || r.status !== 'live' || me.role !== 'c') return;
        const d = DIRECTORY.find((x) => x.ext === String(m.ext));
        if (!d) return;
        const txs = r.data.metrics.transfers = r.data.metrics.transfers || [];
        const pending = txs[txs.length - 1];
        if (pending && !pending.result) pending.result = 'cancelled';
        const x = { to: d.name, ext: d.ext, role: d.role, unavailable: (r.data.scenario.unavailable || []).includes(d.ext) };
        txs.push({ to: d.name, ext: d.ext, at: t, result: null });
        this.setLive(r, { transfer: x });
        this.save(r);
        this.send(this.peerOf(r, 'c'), Object.assign({ t: 'transfer', callId: r.id }, x));
        return;
      }
      case 'transfer-cancel': {   // the applicant took the caller back before the extension answered
        if (!party || r.status !== 'live' || me.role !== 'c') return;
        const tx = (r.data.metrics.transfers || []).slice(-1)[0];
        if (!tx || tx.result) return;
        tx.result = 'cancelled'; tx.done = t;
        this.setLive(r, { transfer: null });
        this.save(r);
        this.send(this.peerOf(r, 'c'), { t: 'transfer-cancel', callId: r.id });
        return;
      }
      case 'transfer-result': {   // HR decides what the extension does
        if (!party || r.status !== 'live' || me.role !== 'h') return;
        const tx = (r.data.metrics.transfers || []).slice(-1)[0];
        if (!tx || tx.result) return;
        const result = ['connected', 'no-answer', 'voicemail'].includes(m.result) ? m.result : 'no-answer';
        tx.result = result; tx.done = t;
        this.setLive(r, { transfer: null, lastTransfer: { to: tx.to, ext: tx.ext, result } });
        this.save(r);
        this.send(this.peerOf(r, 'h'), { t: 'transfer-result', callId: r.id, result, to: tx.to, ext: tx.ext });
        if (result === 'connected') this.endCall(r, 'applicant', 'transferred');
        return;
      }
      case 'note': {
        if (!party || me.role !== 'c' || !['live', 'ended'].includes(r.status) || r.data.noteSubmittedAt) return;
        r.data.note = cleanNote(m.note);
        this.save(r);
        if (r.mode === 'ai') this.tellHR({ t: 'note', callId: r.id, note: r.data.note });
        else this.send(this.byCid(r.data.hrCid), { t: 'note', callId: r.id, note: r.data.note });
        return;
      }
      case 'hangup':
        if (party) this.endCall(r, me.role === 'h' ? 'hr' : 'applicant', String(m.reason || 'hangup').slice(0, 40));
        return;

      /* ----- a phone that reconnected mid-call picks the call back up ----- */
      case 'resume': {
        if (!r || r.status !== 'live' || r.mode !== 'live' || !((me.role === 'h' && r.hr === me.name) || (me.role === 'c' && r.applicant_id === me.id))) return this.send(ws, { t: 'gone', callId: m.callId, status: r ? r.status : 'unknown' });
        // The call moves to this phone; a tab that still held it is told, so it stops.
        const oldCid = me.role === 'h' ? r.data.hrCid : r.data.applicantCid;
        const old = oldCid && oldCid !== me.cid ? this.byCid(oldCid) : null;
        if (old) { this.setAtt(old, { call: null }); this.send(old, { t: 'moved', callId: r.id }); }
        if (me.role === 'h') r.data.hrCid = me.cid; else r.data.applicantCid = me.cid;
        if (r.data.lost) { delete r.data.lost[me.role]; if (!Object.keys(r.data.lost).length) delete r.data.lost; }
        this.save(r);
        this.setAtt(ws, { call: r.id });
        this.send(ws, Object.assign({ t: 'resumed' }, this.brief(r, me.role)));
        this.send(this.peerOf(r, me.role), { t: 'peer-back', callId: r.id, cid: me.cid });
        this.presence();
        return;
      }
    }
  }

  async webSocketClose(ws, code) { await this.gone(ws); try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) {} }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const me = this.att(ws);
    if (me.call) {
      const r = this.row(me.call);
      if (r && r.mode === 'live' && r.status === 'ringing') {
        if (me.role === 'h' && r.data.hrCid === me.cid) this.endCall(r, 'hr', 'cancelled');
      } else if (r && r.mode === 'live' && r.status === 'live') {
        const mine = me.role === 'h' ? r.data.hrCid === me.cid : r.data.applicantCid === me.cid;
        if (mine) {
          r.data.lost = Object.assign({}, r.data.lost, { [me.role]: now() });
          this.save(r);
          this.send(this.peerOf(r, me.role), { t: 'peer-lost', callId: r.id });
          await this.armAlarm(now() + GRACE_MS);
        }
      }
    }
    this.presence(ws);
  }

  /* =========================================================
     Called by the Worker (RPC). Identity is already checked there.
     ========================================================= */
  // 🔗 HR invites an applicant: a name (optional: the applicant types theirs), the position, a desk extension and a one-time link.
  createApplicant(name, position, by) {
    const id = 'ap_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const top = this.sql.exec('SELECT MAX(CAST(ext AS INTEGER)) AS n FROM applicants').toArray()[0].n;
    const ext = String(Math.max(APPLICANT_EXT, Number(top) || 0) + 1);
    this.sql.exec('INSERT INTO applicants (id, name, invited_as, position, ext, invite, invite_exp, created_by, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      id, name || `Applicant ${ext}`, name, position, ext, inviteCode(), now() + this.getSettings().linkHours * 3600000, String(by || ''), now());
    return this.applicantView(this.applicant(id));
  }
  // A new link: the old one (used or not) stops working, and any session it opened ends.
  renewInvite(id) {
    if (!this.applicant(id)) return null;
    this.sql.exec('UPDATE applicants SET invite = ?, invite_exp = ?, invite_used = NULL, session = NULL, session_exp = NULL, archived = 0 WHERE id = ?',
      inviteCode(), now() + this.getSettings().linkHours * 3600000, id);
    this.kick(id);
    return this.applicantView(this.applicant(id));
  }
  // The link works once: the applicant types their name, which starts their session (getSettings().sessionHours) and
  // burns the link. Opening the link only shows the name form, so a link preview in an email or chat app doesn't use it.
  // Reloading the page keeps the session (the browser holds it); the link again doesn't.
  redeemInvite(code, name) {
    const a = code ? this.sql.exec('SELECT * FROM applicants WHERE invite = ?', String(code)).toArray()[0] : null;
    if (!a) return { error: 'This interview link isn\'t valid. Ask HR for a new one.', status: 404 };
    if (a.archived) return { error: 'This interview link was closed. Ask HR for a new one.', status: 403 };
    if (a.invite_used) return { error: 'This interview link was already used. It works only once: ask HR for a new one.', status: 403, code: 'used' };
    if (now() > a.invite_exp) return { error: 'This interview link has expired. Ask HR for a new one.', status: 403 };
    const session = crypto.randomUUID().replace(/-/g, '').slice(0, 16), exp = now() + this.getSettings().sessionHours * 3600000;
    this.sql.exec('UPDATE applicants SET name = ?, invite_used = ?, session = ?, session_exp = ?, last_seen = ? WHERE id = ?', name, now(), session, exp, now(), a.id);
    return { applicant: this.applicant(a.id) };
  }
  // The applicant's session is still the one their link opened (not ended by a new link, a closed link or time).
  sessionOk(id, session) {
    const a = this.applicant(id);
    return !!(a && !a.archived && a.session && a.session === session && a.session_exp > now());
  }
  getApplicant(id) { return this.applicant(id); }
  // What HR sees of an applicant: the link only while it's still unused.
  applicantView(a) {
    if (!a) return null;
    const t = now();
    const link = a.archived ? 'closed' : a.invite_used ? (a.session && a.session_exp > t ? 'in-session' : 'used') : a.invite_exp < t ? 'expired' : 'unused';
    return { id: a.id, name: a.name, invitedAs: a.invited_as || '', position: a.position, ext: a.ext, createdBy: a.created_by || '', createdAt: a.created_at, lastSeen: a.last_seen, archived: !!a.archived,
      link, invite: link === 'unused' ? a.invite : '', inviteExp: a.invite_exp, usedAt: a.invite_used || null, sessionExp: a.session_exp || null, calls: a.calls, avg: a.avg };
  }
  listApplicants() {
    return this.sql.exec(`SELECT a.*,
      (SELECT COUNT(*) FROM calls c WHERE c.applicant_id = a.id AND c.status = 'ended') AS calls,
      (SELECT AVG(score) FROM calls c WHERE c.applicant_id = a.id AND c.score IS NOT NULL) AS avg
      FROM applicants a ORDER BY a.created_at DESC`).toArray().map((a) => this.applicantView(a));
  }
  setArchived(id, archived) {
    this.sql.exec('UPDATE applicants SET archived = ?, session = CASE WHEN ? THEN NULL ELSE session END WHERE id = ?', archived ? 1 : 0, archived ? 1 : 0, id);
    if (archived) this.kick(id);
    return this.applicantView(this.applicant(id));
  }
  // Signs the applicant out of every open phone (a closed link, a new link, or their record deleted).
  kick(id) { for (const w of this.open('u:' + id)) { try { w.close(4001, 'closed'); } catch (e) {} } }
  // 🗑 Admin: the applicant and every call of theirs. Returns the call ids, so the Worker can delete the recordings.
  deleteApplicant(id) {
    const ids = this.sql.exec('SELECT id FROM calls WHERE applicant_id = ?', id).toArray().map((x) => x.id);
    this.kick(id);
    this.sql.exec('DELETE FROM calls WHERE applicant_id = ?', id);
    this.sql.exec('DELETE FROM applicants WHERE id = ?', id);
    return ids;
  }

  /* ---------------- 🛡 Admin: HR accounts and settings ---------------- */
  hrUser(username) { return this.sql.exec('SELECT * FROM hr_users WHERE username = ?', String(username || '').toLowerCase()).toArray()[0] || null; }
  listHrUsers() { return this.sql.exec('SELECT username, name, disabled, created_at, last_login FROM hr_users ORDER BY name').toArray(); }
  saveHrUser(u) {
    const username = String(u.username || '').toLowerCase();
    const cur = this.hrUser(username);
    if (!cur && !u.pass) return { error: 'Set a password for the new account.' };
    if (!cur) this.sql.exec('INSERT INTO hr_users (username, name, pass, disabled, created_at) VALUES (?, ?, ?, 0, ?)', username, u.name, u.pass, now());
    else this.sql.exec('UPDATE hr_users SET name = ?, pass = ?, disabled = ? WHERE username = ?', u.name || cur.name, u.pass || cur.pass, u.disabled == null ? cur.disabled : u.disabled ? 1 : 0, username);
    // A disabled account is signed out of its open consoles.
    if (u.disabled) for (const w of this.open('r:h')) if (this.att(w).user === username) { try { w.close(4001, 'disabled'); } catch (e) {} }
    return { user: this.listHrUsers().find((x) => x.username === username) };
  }
  deleteHrUser(username) { this.saveHrUser({ username, disabled: true }); this.sql.exec('DELETE FROM hr_users WHERE username = ?', String(username || '').toLowerCase()); return true; }
  hrLogin(username) { this.sql.exec('UPDATE hr_users SET last_login = ? WHERE username = ?', now(), String(username || '').toLowerCase()); }

  getSettings() {
    const row = this.sql.exec(`SELECT v FROM settings WHERE k = 'main'`).toArray()[0];
    return Object.assign({ linkHours: 72, sessionHours: 4 }, row ? JSON.parse(row.v) : {});
  }
  saveSettings(o) {
    const cur = this.getSettings(), num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const v = { linkHours: num(o.linkHours, 1, 720, cur.linkHours), sessionHours: num(o.sessionHours, 1, 24, cur.sessionHours) };
    this.sql.exec(`INSERT OR REPLACE INTO settings (k, v) VALUES ('main', ?)`, JSON.stringify(v));
    return v;
  }
  stats() {
    const q = (x, ...a) => this.sql.exec(x, ...a).toArray()[0].n;
    return {
      applicants: q('SELECT COUNT(*) AS n FROM applicants WHERE archived = 0'),
      online: new Set(this.ctx.getWebSockets('r:c').filter((w) => w.readyState === OPEN).map((w) => this.att(w).id)).size,
      hrOnline: new Set(this.ctx.getWebSockets('r:h').filter((w) => w.readyState === OPEN).map((w) => this.att(w).name)).size,
      liveNow: q(`SELECT COUNT(*) AS n FROM calls WHERE status IN ('ringing', 'live')`),
      calls: q(`SELECT COUNT(*) AS n FROM calls WHERE status = 'ended'`),
      unscored: q(`SELECT COUNT(*) AS n FROM calls WHERE status = 'ended' AND score IS NULL`),
      hrUsers: q('SELECT COUNT(*) AS n FROM hr_users WHERE disabled = 0')
    };
  }

  listCalls(f) {
    f = f || {};
    const where = [], args = [];
    if (f.applicantId) { where.push('applicant_id = ?'); args.push(f.applicantId); }
    if (f.mode) { where.push('mode = ?'); args.push(f.mode); }
    if (f.before) { where.push('created_at < ?'); args.push(Number(f.before)); }
    const rows = this.sql.exec(`SELECT * FROM calls ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...args, Math.max(1, Math.min(Math.floor(Number(f.limit)) || 100, 500))).toArray();
    return rows.map((r) => {
      const d = JSON.parse(r.data || '{}');
      return { id: r.id, mode: r.mode, scenarioId: r.scenario_id, title: r.title, applicantId: r.applicant_id, applicantName: r.applicant_name, position: r.position, hr: r.hr,
        status: r.status, createdAt: r.created_at, answeredAt: r.answered_at, endedAt: r.ended_at, score: r.score, verdict: (d.review && d.review.verdict) || '',
        talkMs: d.metrics && d.metrics.talkMs, ringMs: d.metrics && d.metrics.ringMs, recording: !!d.recording, noteSubmitted: !!d.noteSubmittedAt };
    });
  }
  getCall(id) { return this.row(id); }
  deleteCall(id) { this.sql.exec('DELETE FROM calls WHERE id = ?', id); return true; }

  // Typed AI calls (no microphone): the conversation is kept here, so the caller's lines are the AI's, not the page's.
  appendTyped(id, who, lines) {
    const r = this.row(id);
    if (!r || r.mode !== 'ai' || r.applicant_id !== who.id || r.status !== 'live') return null;
    r.data.typed = true;
    r.data.transcript = (r.data.transcript || []).concat(lines).slice(-400);
    this.save(r);
    return r.data.transcript;
  }

  /* What may change on a call record once it's placed.
     The applicant: their own note (until they submit it); on AI calls also the transcript, timings and end.
     HR: their interview notes, the 1–5 score and the verdict. The applicant never sees these. */
  updateCall(id, who, p) {
    const r = this.row(id);
    if (!r) return { error: 'No such call' };
    const mine = who.role === 'c' && r.applicant_id === who.id;
    if (who.role !== 'h' && !mine) return { error: 'Not allowed' };
    const d = r.data;
    let freed = false, tell = false;
    if (mine) {
      if (p.note && !d.noteSubmittedAt) { d.note = cleanNote(p.note); tell = r.mode === 'ai'; }
      if (p.submit && !d.noteSubmittedAt && r.status !== 'live') d.noteSubmittedAt = now();
      if (r.mode === 'ai' && r.status === 'live') {
        if (Array.isArray(p.transcript) && !d.typed) d.transcript = p.transcript.slice(0, 400).map((x) => ({ who: x && x.who === 'caller' ? 'caller' : 'applicant', text: String((x && x.text) || '').slice(0, 1500) })).filter((x) => x.text);
        if (p.metrics && typeof p.metrics === 'object') {
          const m = p.metrics, n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : undefined);
          d.metrics = Object.assign({}, d.metrics, { talkMs: n(m.talkMs), endedBy: m.endedBy === 'caller' ? 'caller' : 'applicant', endReason: String(m.endReason || '').slice(0, 40),
            holds: (Array.isArray(m.holds) ? m.holds : []).slice(0, 30).map((h) => ({ start: n(h.start), end: n(h.end) })),
            transfers: (Array.isArray(m.transfers) ? m.transfers : []).slice(0, 10).map((x) => ({ to: String(x.to || '').slice(0, 80), ext: String(x.ext || '').slice(0, 8), result: String(x.result || '').slice(0, 20) })),
            voice: m.voice === 'text' ? 'text' : 'voice' });
        }
        if (p.end) { r.status = 'ended'; r.ended_at = now(); freed = tell = true; }
      }
    }
    if (who.role === 'h' && p.review) {
      const v = p.review, sc = Math.round(Number(v.score));
      d.review = { notes: String(v.notes || '').slice(0, 6000), score: sc >= 1 && sc <= 5 ? sc : null,
        verdict: ['Pass', 'Hold', 'Fail'].includes(v.verdict) ? v.verdict : '', by: who.id, at: now() };
      r.score = d.review.score;
    }
    this.save(r);
    if (freed) this.freePhones(r);
    if (tell) this.tellHR({ t: 'ai-call', call: this.aiBrief(r) });
    return { ok: true, call: r };
  }

  // 🤖 AI calls HR sent: what the console shows.
  aiBrief(r) {
    const d = r.data || {}, a = d.assigned || {};
    const status = r.status === 'live' ? (a.answeredAt ? 'live' : 'ringing') : r.status;
    return { callId: r.id, applicantId: r.applicant_id, applicantName: r.applicant_name, position: r.position, ext: (this.applicant(r.applicant_id) || {}).ext || '', title: r.title,
      status, outcome: a.outcome || '', by: a.by || r.hr || '', createdAt: r.created_at, answeredAt: a.answeredAt || null, endedAt: r.ended_at || null,
      note: d.note || {}, voice: d.voice || '', scenario: d.scenario };
  }
  freePhones(r) {
    for (const w of this.open('u:' + r.applicant_id)) if (this.att(w).call === r.id) this.setAtt(w, { call: null });
    this.presence();
  }
  aiCalls() {
    return this.sql.exec(`SELECT * FROM calls WHERE mode = 'ai' AND created_at > ? ORDER BY created_at DESC LIMIT 30`, now() - 12 * 3600000)
      .toArray().map((r) => { r.data = JSON.parse(r.data || '{}'); return this.aiBrief(r); });
  }

  setRecording(id, meta) {
    const r = this.row(id);
    if (!r) return null;
    r.data.recording = meta;
    this.save(r);
    return true;
  }

  logUsage(who, kind) { this.sql.exec('INSERT INTO usage (who, kind, at) VALUES (?, ?, ?)', who, kind, now()); if (Math.random() < 0.02) this.sql.exec('DELETE FROM usage WHERE at < ?', now() - 7 * 86400000); }
  countUsage(who, kind, sinceMs) { return this.sql.exec('SELECT COUNT(*) AS n FROM usage WHERE who = ? AND kind = ? AND at > ?', who, kind, now() - sinceMs).toArray()[0].n; }
}
