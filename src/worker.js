/**
 * LSH HR Mock Calls: a browser VOIP phone for the mock calls in HR interviews.
 * Cloned from LSH Ring Channel's phone system, without the CMS, the Training Portal or the training scenarios.
 * It stands alone: its own admin, its own HR accounts, and one-time interview links for applicants.
 *
 * Cloudflare Worker + one Durable Object (the Switchboard, src/switchboard.js):
 *   /             the app (public/): HR's console and the applicant's phone
 *   /ws           each phone's WebSocket to the Switchboard (presence, ringing, WebRTC signaling)
 *   /api/...      sign-in (the admin passphrase, HR accounts, applicants' one-time links), applicants, call records,
 *                 recordings, TURN credentials, the 🤖 agent caller (Gemini Live), and 🛡 /api/admin/... (admin only)
 *
 * Secrets (wrangler secret put <NAME>):
 *   ADMIN_PASSPHRASE     required: the admin's sign-in (any name), and it signs sign-in tokens
 *   SESSION_SECRET       optional; signs sign-in tokens instead (changing it signs everyone out)
 *   TURN_KEY_ID, TURN_KEY_API_TOKEN
 *                        optional but recommended: Cloudflare Realtime TURN, so calls connect on
 *                        networks that block direct audio (strict home routers, mobile data, offices)
 *   GEMINI_API_KEY20, GEMINI_API_KEY21
 *                        optional: this site's own Gemini keys, used in turn, for the 🤖 agent caller (without a key, live calls only).
 *                        GEMINI_API_KEY5 … GEMINI_API_KEY9 (and GEMINI_API_KEY, _KEY1, _KEY2), the shared LSH pool, are fallbacks.
 * Variables: RECORDING_DAYS (default 90), AI_MAX_MINUTES (default 8). How long a link and a session last is
 * set on 🛡 Admin → Settings (kept in the Switchboard).
 * Recordings are kept in the LSH_KV namespace under "hrmc:rec:" and expire on their own.
 */
import { Switchboard } from './switchboard.js';
import { makeToken, readToken, readTokenString, safeEqual, secretOf, hashPassword, checkPassword } from './auth.js';
import { COMPANY, DIRECTORY, NOTE_FIELDS, AI_VOICES, listScenarios } from './scenarios.js';
import { hasAI, generate, liveToken } from './gemini.js';
import { callerPrompt, liveSetup } from './prompts.js';

export { Switchboard };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
const board = (env) => env.SWITCHBOARD.get(env.SWITCHBOARD.idFromName('main'));
const REC = 'hrmc:rec:';
const recDays = (env) => Math.min(365, Math.max(1, Number(env.RECORDING_DAYS) || 90));
const aiMinutes = (env) => Math.min(15, Math.max(2, Number(env.AI_MAX_MINUTES) || 8));

/* Who a token belongs to, checked against the Switchboard every time: an HR account that was disabled or
   deleted, or an applicant whose session ended (a new link, a closed link, its time up), is signed out.
   Admin and HR are both staff (role 'h' on the phone system); `admin` opens 🛡 Admin. */
async function identify(env, tok) {
  if (!tok) return null;
  const sb = board(env);
  if (tok.role === 'a') return { role: 'h', admin: true, id: tok.id, name: tok.id, user: '' };
  if (tok.role === 'h') {
    const u = await sb.hrUser(tok.id);
    return u && !u.disabled ? { role: 'h', admin: false, id: u.name, name: u.name, user: u.username } : null;
  }
  const [id, session] = String(tok.id).split(':');
  if (!(await sb.sessionOk(id, session))) return null;
  const a = await sb.getApplicant(id);
  return { role: 'c', id: a.id, name: a.name, position: a.position, ext: a.ext };
}

// What HR sees of a call record (the applicant never reads call records).
function forHR(r) {
  const d = r.data || {};
  return {
    id: r.id, mode: r.mode, title: r.title, status: r.status, createdAt: r.created_at, answeredAt: r.answered_at, endedAt: r.ended_at,
    applicantId: r.applicant_id, applicantName: r.applicant_name, position: r.position, hr: r.hr, score: r.score,
    scenario: d.scenario, metrics: d.metrics || {}, note: d.note || {}, noteSubmittedAt: d.noteSubmittedAt || null, transcript: d.transcript || [],
    recording: d.recording || null, review: d.review || null, voice: d.voice || '', events: d.events || []
  };
}

async function iceServers(env) {
  const fallback = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { iceServers: fallback, turn: false };
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 })
    });
    const d = await r.json();
    let list = d.iceServers;
    if (list && !Array.isArray(list)) list = [list];
    if (!r.ok || !list || !list.length) throw new Error('TURN ' + r.status);
    // Port 53 is blocked by browsers and only slows the connection down.
    list = list.map((s) => Object.assign({}, s, { urls: [].concat(s.urls).filter((u) => !/:53\b/.test(u)) })).filter((s) => s.urls.length);
    return { iceServers: list, turn: true };
  } catch (e) {
    return { iceServers: fallback, turn: false, error: String(e.message || e) };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      /* ---------- a phone's WebSocket to the Switchboard ---------- */
      if (path === '/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
        const protos = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map((x) => x.trim());
        const who = await identify(env, await readTokenString(env, protos[0] === 'hrmc' && protos[1] ? protos[1] : ''));
        if (!who) return new Response('Sign-in required', { status: 401 });
        const headers = new Headers(request.headers);
        headers.set('X-Who', JSON.stringify({ role: who.role, id: who.id, user: who.user || '' }));
        return board(env).fetch(new Request(request.url, { headers }));
      }

      // The app's files are served from public/ before the Worker runs (their headers are in public/_headers).
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

      /* ---------- sign-in ---------- */
      if (path === '/api/auth/status') return json({ configured: !!secretOf(env), company: COMPANY.name });
      // 🛡 Staff sign-in: an HR account (username and its password), or the admin passphrase (any name).
      if (path === '/api/auth/staff') {
        if (!env.ADMIN_PASSPHRASE) return json({ error: 'Sign-in isn\'t set up yet: add the ADMIN_PASSPHRASE secret in Cloudflare.' }, 501);
        const { username, password } = await request.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 400));   // slows down guessing
        const uname = String(username || '').trim().toLowerCase().slice(0, 40);
        const u = uname ? await board(env).hrUser(uname) : null;
        if (u && !u.disabled && (await checkPassword(String(password || ''), u.pass))) {
          await board(env).hrLogin(u.username);
          return json({ token: await makeToken(env, 'h', u.username, 12), role: 'h', id: u.username, name: u.name });
        }
        if (safeEqual(String(password || ''), env.ADMIN_PASSPHRASE)) {
          const who = String(username || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Admin';
          return json({ token: await makeToken(env, 'a', who, 12), role: 'a', id: who, name: who });
        }
        return json({ error: u && u.disabled ? 'This account is disabled. Ask the admin.' : 'Incorrect username or password' }, 401);
      }
      // 🔗 The applicant's one-time link (?invite=<code>): the first open signs them in for one session.
      if (path === '/api/auth/invite') {
        if (!secretOf(env)) return json({ error: 'The phone system isn\'t set up yet.' }, 501);
        const { code } = await request.json().catch(() => ({}));
        await new Promise((r) => setTimeout(r, 300));
        const res = await board(env).redeemInvite(String(code || '').trim().slice(0, 40));
        if (res.error) return json({ error: res.error, code: res.code || '' }, res.status || 400);
        const a = res.applicant;
        const hours = Math.max(1, (a.session_exp - Date.now()) / 3600000);
        return json({ token: await makeToken(env, 'c', `${a.id}:${a.session}`, hours), role: 'c', id: a.id, name: a.name, position: a.position });
      }

      const tok = await readToken(env, request);
      const me = await identify(env, tok);
      if (!me) return json({ error: tok && tok.role === 'c' ? 'Your interview session has ended.' : 'Sign-in required' }, 401);
      const hr = me.role === 'h', admin = !!me.admin;
      const sb = board(env);
      const body = path === '/api/recording/put' ? null : await request.json().catch(() => ({}));
      const hrOnly = () => json({ error: 'Not allowed' }, 403);
      const adminOnly = () => json({ error: 'Admin only' }, 403);

      if (path === '/api/config') {
        const st = await sb.getSettings();
        return json({
          me: { role: me.role, admin, id: me.id, name: me.name, position: me.position || '', ext: me.ext || '' }, company: COMPANY, directory: DIRECTORY, noteFields: NOTE_FIELDS,
          scenarios: hr ? listScenarios() : [], voices: hr ? AI_VOICES : [],
          features: { ai: hasAI(env), recordings: !!env.LSH_KV, aiMinutes: aiMinutes(env), turn: !!(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN), linkHours: st.linkHours, sessionHours: st.sessionHours, recordingDays: recDays(env) }
        });
      }
      if (path === '/api/ice') {
        if ((await sb.countUsage(me.id, 'ice', 3600000)) >= 120) return json({ error: 'Too many requests.' }, 429);
        await sb.logUsage(me.id, 'ice');
        return json(await iceServers(env));
      }

      /* ---------- HR: applicants and their invite links ---------- */
      if (path === '/api/applicants') { if (!hr) return hrOnly(); return json({ applicants: await sb.listApplicants() }); }
      if (path === '/api/applicants/create') {
        if (!hr) return hrOnly();
        const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (!name) return json({ error: 'Type the applicant\'s name.' }, 400);
        return json({ applicant: await sb.createApplicant(name, String(body.position || '').trim().slice(0, 60), me.name) });
      }
      if (path === '/api/applicants/renew') { if (!hr) return hrOnly(); return json({ applicant: await sb.renewInvite(String(body.id || '')) }); }
      if (path === '/api/applicants/archive') { if (!hr) return hrOnly(); return json({ applicant: await sb.setArchived(String(body.id || ''), !!body.archived) }); }

      /* ---------- 🛡 Admin ---------- */
      if (path === '/api/admin/overview') {
        if (!admin) return adminOnly();
        const ice = await iceServers(env);
        return json({ stats: await sb.stats(), settings: await sb.getSettings(), hrUsers: await sb.listHrUsers(),
          setup: { ai: hasAI(env), turn: ice.turn, turnError: ice.error || '', recordings: !!env.LSH_KV, recordingDays: recDays(env), aiMinutes: aiMinutes(env), sessionSecret: !!env.SESSION_SECRET } });
      }
      if (path === '/api/admin/settings') { if (!admin) return adminOnly(); return json({ settings: await sb.saveSettings(body.settings || {}) }); }
      if (path === '/api/admin/hr/save') {
        if (!admin) return adminOnly();
        const username = String(body.username || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'The username is 3 to 30 letters, numbers, dots, dashes or underscores.' }, 400);
        const password = String(body.password || '');
        if (password && password.length < 8) return json({ error: 'The password needs at least 8 characters.' }, 400);
        const res = await sb.saveHrUser({ username, name: String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) || username,
          pass: password ? await hashPassword(password) : '', disabled: body.disabled == null ? null : !!body.disabled });
        return res.error ? json({ error: res.error }, 400) : json(res);
      }
      if (path === '/api/admin/hr/delete') { if (!admin) return adminOnly(); await sb.deleteHrUser(String(body.username || '')); return json({ ok: true }); }
      // An applicant, every call of theirs and the recordings.
      if (path === '/api/admin/applicant/delete') {
        if (!admin) return adminOnly();
        const ids = await sb.deleteApplicant(String(body.id || ''));
        if (env.LSH_KV) await Promise.all(ids.map((id) => env.LSH_KV.delete(REC + id)));
        return json({ ok: true, calls: ids.length });
      }

      /* ---------- call records (HR) ---------- */
      if (path === '/api/calls') { if (!hr) return hrOnly(); return json({ calls: await sb.listCalls(body || {}) }); }
      if (path === '/api/ai/calls') { if (!hr) return hrOnly(); return json({ calls: await sb.aiCalls() }); }
      if (path === '/api/call') {
        if (!hr) return hrOnly();
        const r = await sb.getCall(String(body.id || ''));
        return r ? json({ call: forHR(r) }) : json({ error: 'No such call' }, 404);
      }
      if (path === '/api/call/update') {
        const res = await sb.updateCall(String(body.id || ''), me, body);
        if (res.error) return json({ error: res.error }, 403);
        return json(hr ? { call: forHR(res.call) } : { ok: true });
      }
      if (path === '/api/call/delete') {
        if (!admin) return adminOnly();
        await sb.deleteCall(String(body.id || ''));
        if (env.LSH_KV) await env.LSH_KV.delete(REC + String(body.id || ''));
        return json({ ok: true });
      }

      /* ---------- recordings ---------- */
      if (path === '/api/recording/put') {
        if (!env.LSH_KV) return json({ error: 'Recordings need the LSH_KV binding.' }, 501);
        const id = url.searchParams.get('id') || '';
        const r = await sb.getCall(id);
        if (!r) return json({ error: 'No such call' }, 404);
        // Live calls are recorded on HR's console; agent-caller calls on the applicant's phone.
        if (r.mode === 'live' ? !hr : r.applicant_id !== me.id) return json({ error: 'Not allowed' }, 403);
        const type = (request.headers.get('Content-Type') || 'audio/webm').split(';')[0];
        if (!/^audio\/(webm|ogg|mp4|mpeg|wav)$/.test(type)) return json({ error: 'Unsupported audio type' }, 415);
        const buf = await request.arrayBuffer();
        if (buf.byteLength < 200) return json({ error: 'Empty recording' }, 400);
        if (buf.byteLength > 24 * 1024 * 1024) return json({ error: 'The recording is too large to keep (over 24 MB).' }, 413);
        const meta = { type, size: buf.byteLength, at: Date.now(), durMs: Number(url.searchParams.get('dur')) || null, expires: Date.now() + recDays(env) * 86400000 };
        await env.LSH_KV.put(REC + id, buf, { expirationTtl: recDays(env) * 86400, metadata: meta });
        await sb.setRecording(id, meta);
        return json({ ok: true, recording: meta });
      }
      if (path === '/api/recording/get') {
        if (!hr) return hrOnly();
        if (!env.LSH_KV) return json({ error: 'No recordings on this site.' }, 404);
        const got = await env.LSH_KV.getWithMetadata(REC + String(body.id || ''), { type: 'arrayBuffer' });
        if (!got || !got.value) return json({ error: 'This recording has expired or was never saved.' }, 404);
        return new Response(got.value, { headers: { 'Content-Type': (got.metadata && got.metadata.type) || 'audio/webm', 'Cache-Control': 'private, no-store' } });
      }

      /* ---------- 🤖 the agent caller, on the applicant's phone ---------- */
      if (path === '/api/ai/live' || path === '/api/ai/text') {
        if (!hasAI(env)) return json({ error: 'The agent caller isn\'t set up on this site yet.' }, 501);
        const r = await sb.getCall(String(body.callId || ''));
        if (!r || r.mode !== 'ai' || r.applicant_id !== me.id || r.status !== 'live') return json({ error: 'This call is over.' }, 404);
        const s = r.data.scenario;
        if (Date.now() - r.created_at > (aiMinutes(env) + 1) * 60000) return json({ error: 'This call reached its time limit.' }, 409);
        if (path === '/api/ai/live') {
          // A call gets a few tries (busy keys, models); every token is one Gemini Live session.
          if ((await sb.countUsage(me.id, 'live:' + r.id, 3600000)) >= 8 || (await sb.countUsage(me.id, 'live', 3600000)) >= 60) return json({ error: 'Too many voice connections; this call runs as text.', code: 'RATE_LIMIT' }, 429);
          await sb.logUsage(me.id, 'live:' + r.id); await sb.logUsage(me.id, 'live');
          const t = await liveToken(env, (model) => liveSetup(s, model, r.data.voice), aiMinutes(env), Array.isArray(body.skip) ? body.skip.map(String) : []);
          return t.ok ? json({ token: t.token, model: t.model, url: t.url, pair: t.pair, maxSeconds: aiMinutes(env) * 60 }) : json({ error: t.error, code: t.code }, t.code === 'BUSY' ? 429 : 502);
        }
        // Text mode: the same caller, one turn at a time (no microphone, or live voice unavailable).
        if ((await sb.countUsage(me.id, 'aitext', 3600000)) >= 400) return json({ error: 'Too many messages this hour.' }, 429);
        await sb.logUsage(me.id, 'aitext');
        const said = String(body.text || '').trim().slice(0, 1500);
        const turns = (await sb.appendTyped(r.id, me, said ? [{ who: 'applicant', text: said }] : [])) || [];
        const contents = [];
        for (const x of turns) {
          const role = x && x.who === 'caller' ? 'model' : 'user';
          const text = String((x && x.text) || '').slice(0, 1500);
          if (!text) continue;
          if (contents.length && contents[contents.length - 1].role === role) contents[contents.length - 1].parts[0].text += '\n' + text;
          else contents.push({ role, parts: [{ text }] });
        }
        if (!contents.length || contents[0].role !== 'user') contents.unshift({ role: 'user', parts: [{ text: '(The call is answered.)' }] });
        if (contents[contents.length - 1].role !== 'user') contents.push({ role: 'user', parts: [{ text: '(The line is quiet.)' }] });
        try {
          const g = await generate(env, { system: callerPrompt(s) + '\n\nThis call is typed: reply with only what you say out loud, one or two short sentences.', contents: contents.slice(-60), maxTokens: 200, temperature: 0.8 });
          const text = g.text.replace(/^\s*(caller|[A-Z][a-z]+ [A-Z][a-z]+)\s*:\s*/i, '').trim();
          if (text) await sb.appendTyped(r.id, me, [{ who: 'caller', text }]);
          return json({ text });
        } catch (e) { return json({ error: String(e.message || e) }, 502); }
      }

      return json({ error: 'Unknown endpoint' }, 404);
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  }
};
