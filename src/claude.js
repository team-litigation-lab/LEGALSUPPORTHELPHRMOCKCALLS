/* 🤖 Claude answers first (gemini.js generate calls claudeGenerate before any Gemini key).

   When the Worker has the secret ANTHROPIC_API_KEY, every text request (a practice caller's line, a call's grading) goes to
   Claude through the official Anthropic SDK. Anything Claude can't take or doesn't answer falls through to the Gemini path,
   unchanged: a request with a recording in it (audio), a missing key, a rate limit, an outage, a declined request.
   Gemini Live (the live voice callers) never comes here: it stays on Gemini.

   Model: ANTHROPIC_MODEL, or claude-opus-5-5. Opus 5.5 always thinks, so no `thinking` or `temperature` is sent; depth is
   output_config.effort: "low" for a caller's line (a phone call: latency matters), "medium" for gradings. Thinking counts
   against max_tokens, so the caller's small maxTokens isn't passed through. Server-side fallbacks ("default") re-run a safety
   decline on Anthropic's recommended model; a decline that still comes back is a failure here, and Gemini answers.
   One try per request (maxRetries 0): a busy Claude costs one call, and Gemini carries on. The key is never logged. */
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const keyOf = (env) => String((env && env.ANTHROPIC_API_KEY) || '').trim();
export const claudeOn = (env) => !!keyOf(env);
export const claudeModel = (env) => String((env && env.ANTHROPIC_MODEL) || '').trim() || CLAUDE_DEFAULT_MODEL;

// a refused key or a rate limit rests Claude for a while, so every request doesn't pay for a failing call first
let restUntil = 0;
const rest = (ms) => { restUntil = Math.max(restUntil, Date.now() + ms); };

let client = null, clientKey = '';
function clientFor(env) {
  const k = keyOf(env);
  if (!client || clientKey !== k) { client = new Anthropic({ apiKey: k, maxRetries: 0, fetch: (url, init) => fetch(url, init) }); clientKey = k; }
  return client;
}

/* The Gemini-shaped request ({ contents: [{ role: 'user'|'model', parts: [{ text }] }] } or { parts }) as Claude's messages:
   text only (null when a part isn't text, e.g. a recording), alternating, starting and ending on the user's turn
   (Opus 5.5 refuses an assistant prefill). A conversation the AI caller opened gets a short user turn in front. */
export function toMessages(opts) {
  const contents = opts.contents || [{ role: 'user', parts: opts.parts || [] }];
  const out = [];
  for (const c of contents) {
    const parts = (c && c.parts) || [];
    if (parts.some((p) => p == null || p.text == null)) return null;
    const text = parts.map((p) => p.text).join('\n');
    if (!text.trim()) continue;
    const role = c.role === 'model' ? 'assistant' : 'user';
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content += '\n\n' + text; else out.push({ role, content: text });
  }
  if (out.length && out[0].role === 'assistant') out.unshift({ role: 'user', content: '[The call is connected.]' });
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out.length ? out : null;
}

// the request Claude gets (exported for the checks)
export function claudeParams(env, opts) {
  const line = !opts.json;
  const system = String(opts.system || '') + (opts.json ? '\n\nReply with only the JSON object: no other text, no code fences.' : '');
  const p = {
    model: claudeModel(env),
    max_tokens: line ? 4000 : 16000,
    output_config: { effort: line ? 'low' : 'medium' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    messages: toMessages(opts)
  };
  if (system.trim()) p.system = system;
  return p;
}

/* → { text, model, via: 'claude' }, or null: Claude isn't set up, can't take this request, or didn't answer
   (the Gemini path takes over). */
export async function claudeGenerate(env, opts) {
  if (!claudeOn(env) || restUntil > Date.now()) return null;
  const params = claudeParams(env, opts);
  if (!params.messages) return null;   // a recording or an empty request: Gemini's
  let msg;
  try {
    msg = await clientFor(env).beta.messages.create(params, { timeout: opts.json ? 90000 : 9000 });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) { console.error('claude: request refused as malformed (400), a bug in claude.js:', e.message); return null; }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) { console.error(`claude: ANTHROPIC_API_KEY refused (${e.status})`); rest(600000); return null; }
    if (e instanceof Anthropic.NotFoundError) { console.error('claude: model not found:', params.model); rest(600000); return null; }
    if (e instanceof Anthropic.RateLimitError) {
      const after = Number(e.headers && (e.headers.get ? e.headers.get('retry-after') : e.headers['retry-after'])) || 60;
      console.warn('claude: rate limit (429), resting', after, 's'); rest(Math.min(Math.max(after, 5), 600) * 1000); return null;
    }
    if (e instanceof Anthropic.APIConnectionError) { console.warn('claude: unreachable or timed out:', e.message); return null; }
    if (e instanceof Anthropic.APIError) { console.warn(`claude: error ${e.status}:`, e.message); if (/credit balance|billing/i.test(e.message || '')) rest(3600000); return null; }
    console.error('claude: call failed:', e && e.stack || e);
    return null;
  }
  if (msg.stop_reason === 'refusal') { console.warn('claude: declined the request; Gemini answers'); return null; }
  const text = (msg.content || []).filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
  if (!text.trim()) { console.warn(`claude: no text came back (${msg.stop_reason || 'empty'})`); return null; }
  return { text, model: msg.model || params.model, via: 'claude' };
}
