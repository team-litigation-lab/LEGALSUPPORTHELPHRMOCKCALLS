# LSH HR Mock Calls

A browser phone system (VOIP) for the **mock calls in HR interviews**. HR rings the applicant's phone in the browser and the applicant answers it as an agent of Legal Support Help. The caller is either:

- **🎙 Live:** HR plays the caller over live audio; or
- **🤖 Agent caller:** an AI voice (Gemini Live) plays the caller, from a scenario or from a persona HR types on the console.

It is cloned from **LSH Ring Channel**'s phone system (the Switchboard, the WebRTC engine, the hold music, transfers, recording and the AI caller). Ring Channel's **CMS integration** (Case Lookup, the CMS Training Library), the **LSH Training Portal** sign-in and course results, the **training scenarios** and metrics, the autograding and the messaging simulators are **left out**.

Everything runs in the browser: no phone numbers, no phone bills. It's a Cloudflare Worker with one Durable Object (the Switchboard). The audio goes straight between the two browsers over WebRTC, through a TURN relay when a network blocks direct audio.

## How a mock call goes

**HR**
1. Opens the site and signs in with their name and the **HR passphrase**.
2. **👥 Applicants → ＋ Add & get link:** the applicant's name and the position. They get a **desk extension** (7001, 7002, …) and an **interview link**, copied to the clipboard to send them.
3. **🎛 Console:** the applicants whose phones are open are on the left. Click one (or dial their extension on the keypad), then:
   - **📞 Call (live)**: their phone rings; once they answer, you are the caller. Set the **Caller ID** name and number they see (or **🙈 Hide caller ID**).
   - **🤖 Agent caller**: the AI rings their phone and plays the caller. Under **🤖 Agent caller setup**, type who the AI plays (a persona), an optional opening line, and the voice. **👂 Follow** shows the conversation and the note live; **⏹** ends it.
4. On a live call: **Mute**, **🔊 Speaker**, **End call**. When the applicant transfers the caller, you decide what the extension does: **Picks up** (the call ends), **No answer** or **Voicemail**.
5. The applicant's **note** shows as they type it. **Score this call** (1–5), a **verdict** (Pass / Hold / Fail) and your **interview notes**, during or after the call. Only HR sees these.
6. **🗂 Call Logs:** every call, with the recording (▶ play, ⬇ download), the note, the transcript (agent calls), the score and notes, and **⬇ Export CSV**.

**Applicant**
1. Opens the interview link in Chrome or Edge on a computer, with a headset, and allows the microphone. The link signs them in to **☎ My phone** and leaves the address bar.
2. Stays **● Available**. When the phone rings they see the caller ID and **📞 Answer**.
3. On the call: **Mute**, **⏸ Hold** (the caller hears hold music), **↪ Transfer** (to an extension in the directory), **🔊 Speaker**, **Hang up**, and the **📝 call note**.
4. After the call they finish the note and **📨 Submit** it. Applicants never see HR's scores or notes, nor the call logs.

A link works for `INVITE_DAYS` (default 7) days, on any computer. **↻ New link** replaces it; **⛔ Close link** signs the applicant out at once.

**Reliability:** an unanswered call rings out after 45 seconds (*Missed*); a phone that loses its connection has 30 seconds to come back; reloading either page mid-call reconnects it (the applicant clicks **🔊 Reconnect the call**).

## Scenarios (to be added)

`SCENARIOS` in `src/scenarios.js` is **empty for now**: the HR scenarios will be added there. Until then every call is an *open call*: HR plays any caller live, or types the agent caller's persona on the console. The shape of a scenario is documented at the top of that file (title, caller, opening, persona, goals, extensions that don't pick up a transfer, live-only or AI). Once added, they appear in the console's **Scenario** list; HR sees the persona and goals as their script on a live call, and the agent caller plays them.

The same file holds the **company** name and line, the **transfer directory** (Supervisor 201, Case Manager 301, Billing 401, Intake Team 501) and the **note fields** the applicant fills in. Change them there.

## Deploy (Cloudflare)

```bash
npm install
```

```bash
npx wrangler secret put ADMIN_PASSPHRASE
```

```bash
npx wrangler deploy
```

| Setting | |
|---|---|
| `ADMIN_PASSPHRASE` (secret) | **Required.** HR's sign-in, and it signs the sign-in tokens. |
| `SESSION_SECRET` (secret) | Optional: signs the tokens instead (changing it signs everyone out). |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (secrets) | Recommended: Cloudflare Realtime TURN, so calls connect on networks that block direct audio. Without them, calls use STUN only. |
| `GEMINI_API_KEY5` … `GEMINI_API_KEY9` (then `GEMINI_API_KEY`, `_KEY1`, `_KEY2`) (secrets) | Optional: the 🤖 agent caller (the same LSH Gemini key pool as Ring Channel). Without them, live calls only. |
| `LSH_KV` (KV binding) | The recordings, under `hrmc:rec:`. `wrangler.json` points at the shared LSH KV namespace (the same one as Ring Channel, a separate key prefix); give it its own namespace if you want the interview recordings kept apart. |
| `RECORDING_DAYS` | How long recordings are kept (default 90). |
| `AI_MAX_MINUTES` | The longest an agent call can run (default 8). |
| `INVITE_DAYS` | How long an interview link works (default 7). |

## Local development and tests

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

`tests/run.sh` starts `wrangler dev` with a stand-in for Gemini (`tests/mock-gemini.js`) and runs two browser tests in Chromium with fake microphones: `tests/e2e-live.js` (invite link, ring, answer, audio, hold, transfer, the live note, recording, the submitted note, HR's score, closing the link) and `tests/e2e-ai.js` (the agent caller with a typed persona, the live transcript, hold, transfer, the note, the call log). GitHub Actions runs them on every push and pull request (`.github/workflows/checks.yml`).

```bash
npm install --prefix tests && tests/node_modules/.bin/playwright install chromium
```

```bash
NODE_PATH=tests/node_modules bash tests/run.sh
```

## Files

| File | |
|---|---|
| `src/worker.js` | The API: sign-in, applicants and links, call records, recordings, TURN, the agent caller's token. |
| `src/switchboard.js` | The Durable Object: presence, ringing, WebRTC signaling, hold / transfer / note, call records. |
| `src/scenarios.js` | The company, the directory, the note fields, the voices, and the scenarios (empty for now). |
| `src/prompts.js` | What the agent caller is told. |
| `src/gemini.js`, `src/auth.js` | The Gemini key pool and Live tokens; the sign-in tokens. |
| `public/js/phone.js`, `sounds.js`, `ai-call.js` | The VOIP engine (from Ring Channel), the phone sounds and hold music, the agent caller in the browser. |
| `public/js/app.js` | Sign-in, the top bar, 👥 Applicants, 🗂 Call Logs and a call's page. |
| `public/js/hr.js`, `public/js/applicant.js` | HR's console and the applicant's phone. |
