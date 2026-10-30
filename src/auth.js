/* Sign-in tokens: "<role>.<subject>.<expiry>.<hmac>"
   role h = HR (subject: their name), c = applicant (subject: applicant id). */
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const secretOf = (env) => env.SESSION_SECRET || env.ADMIN_PASSPHRASE || '';

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function makeToken(env, role, subject, hours) {
  const exp = Date.now() + hours * 3600 * 1000;
  const body = `${role}.${encodeURIComponent(subject).replace(/\./g, '%2E')}.${exp}`;   // a "." in a name would split the token
  return `${body}.${await hmac(secretOf(env), body)}`;
}

export async function readTokenString(env, t) {
  if (!secretOf(env)) return null;
  const parts = String(t || '').split('.');
  if (parts.length !== 4) return null;
  const [role, subj, exp, sig] = parts;
  if (!/^[hc]$/.test(role) || Date.now() > Number(exp)) return null;
  const good = await hmac(secretOf(env), `${role}.${subj}.${exp}`);
  if (!safeEqual(good, sig)) return null;
  let id; try { id = decodeURIComponent(subj); } catch (e) { return null; }
  return { role, id };
}

export async function readToken(env, request) {
  const h = request.headers.get('Authorization') || '';
  return readTokenString(env, h.startsWith('Bearer ') ? h.slice(7) : '');
}
