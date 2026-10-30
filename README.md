# LSH HR Mock Calls

A browser phone system (VOIP) for the **mock calls in HR interviews**. HR rings the applicant's phone in the browser and the applicant answers it as an agent of Legal Support Help. The caller is either:

- **🎙 Live:** HR plays the caller over live audio; or
- **🤖 Agent caller:** an AI voice (Gemini Live) plays the caller, from a scenario or from a persona HR types on the console.

It **runs on its own, apart from the LSH training platform**: its own admin, its own HR accounts, and **one-time links** for applicants. Nothing here signs in through, or reports to, the Training Portal.

It is cloned from **LSH Ring Channel**'s phone system (the Switchboard, the WebRTC engine, the hold music, transfers, recording and the AI caller). Ring Channel's **CMS integration** (Case Lookup, the CMS Training Library), the **LSH Training Portal** sign-in and course results, the **training scenarios** and metrics, the autograding and the messaging simulators are **left out**.

Everything runs in the browser: no phone numbers, no phone bills. It's a Cloudflare Worker with one Durable Object (the Switchboard). The audio goes straight between the two browsers over WebRTC, through a TURN relay when a network blocks direct audio.

## The main page and the two views

**The main page (`/`)** has both ways in, side by side:
- **👤 Applicant:** the interview code and their full name. With their **one-time link** (`/?invite=…`) they only see **"Welcome to your interview — your full name — Enter →"**: they type their name and they're on their phone.
- **🧑‍💼 HR & Admin:** username and password (the admin: any name and the admin passphrase). Signing in here goes on to `/admin`.

**`/admin`** is the Admin & HR view on its own: its sign-in, then 🎛 Console, 👥 Applicants, 🗂 Call Logs and (admin) 🛡 Admin. Kept out of search engines.

Each view keeps its own sign-in in the browser, so an admin can open a test applicant link on the same computer without being signed out of `/admin`. An interview link opened on `/admin` goes to `/`. `public/index.html` and `public/admin.html` are the two pages; they share the same scripts (`window.HRMC_VIEW` says which view it is).

## Who signs in

| Who | How | What they get |
|---|---|---|
| 🛡 **Admin** | Any name + the **admin passphrase** (`ADMIN_PASSPHRASE`) | Everything HR has, plus **🛡 Admin**: HR accounts, settings, status; deleting applicants (with their calls and recordings) and single calls. |
| 🧑‍💼 **HR interviewer** | Their **username and password**, made by the admin on 🛡 Admin | 🎛 Console, 👥 Applicants, 🗂 Call Logs. |
| 👤 **Applicant** | Their **one-time link** | ☎ My phone, for one interview session. |

**🛡 Admin**
- **👤 HR accounts:** add one (name shown on calls, username, password of at least 8 characters, stored salted and hashed), change a password, **Disable** (signs them out at once), **Enable**, 🗑 delete. Their calls stay in the Call Logs.
- **⚙️ Settings:** how long an unopened one-time link works (default **72 hours**) and how long an applicant's session lasts once they open it (default **4 hours**).
- **🩺 Status:** the TURN relay, the agent caller's Gemini keys, recordings, and the counts (applicants, phones open, HR online, calls, calls not scored).

**🔗 One-time access**
- Each applicant gets **one link, good for one sign-in**. Opening it asks for their **full name**; sending it signs them in to their phone and **uses the link up**: used again (in any browser, by anyone) it says *already used*. Opening the link alone doesn't use it, so a link preview in an email or chat app can't. Reloading their own page keeps their session.
- The name they type is the one HR sees. HR's name for them is optional when adding them; when it differs, 👥 Applicants shows *invited as …*.
- The session ends after the hours set on ⚙️ Settings, when HR presses **⛔ End session**, or when HR makes **↻ New link** (which also cancels the old one). The applicant is signed out at once.
- 👥 Applicants shows each link's state: *Not opened yet* (with Copy), *In session*, *Used*, *Expired* or *Ended*. The link is only shown while it is unused.

## How a mock call goes

**HR**
1. Opens **`/admin`** and signs in with their **username and password** (or the admin with the admin passphrase).
2. **👥 Applicants → ＋ Add & get link:** the position, and the applicant's name if you like (they type theirs when they open the link). They get a **desk extension** (7001, 7002, …) and a **one-time link**, copied to the clipboard to send them.
3. **🎛 Console:** the applicants whose phones are open are on the left. Click one (or dial their extension on the keypad), then:
   - **📞 Call (live)**: their phone rings; once they answer, you are the caller. Set the **Caller ID** name and number they see (or **🙈 Hide caller ID**).
   - **🤖 Agent caller**: the AI rings their phone and plays the caller. Under **🤖 Agent caller setup**, type who the AI plays (a persona), an optional opening line, and the voice. **👂 Follow** shows the conversation and the note live; **⏹** ends it.
4. On a live call: **Mute**, **🔊 Speaker**, **End call**. When the applicant transfers the caller, you decide what the extension does: **Picks up** (the call ends), **No answer** or **Voicemail**.
5. The applicant's **note** shows as they type it. **Score this call** (1–5), a **verdict** (Pass / Hold / Fail) and your **interview notes**, during or after the call. Only HR sees these.
6. **🗂 Call Logs:** every call, with the recording (▶ play, ⬇ download), the note, the transcript (agent calls), the score and notes, and **⬇ Export CSV**.

**Applicant**
1. Opens the one-time link in Chrome or Edge on a computer, with a headset, **types their full name** and presses **Enter →**. That signs them in to **☎ My phone** for this interview; the link can't be used again. (Or, on the main page, they type the interview code and their name.) They allow the microphone when the browser asks.
2. Stays **● Available**. When the phone rings they see the caller ID and **📞 Answer**.
3. On the call: **Mute**, **⏸ Hold** (the caller hears hold music), **↪ Transfer** (to an extension in the directory), **🔊 Speaker**, **Hang up**, and the **📝 call note**.
4. After the call they finish the note and **📨 Submit** it. Applicants never see HR's scores or notes, nor the call logs.

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
| `ADMIN_PASSPHRASE` (secret) | **Required.** The admin's sign-in, and it signs the sign-in tokens. HR accounts are made on 🛡 Admin. |
| `SESSION_SECRET` (secret) | Optional: signs the tokens instead (changing it signs everyone out). |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (secrets) | Recommended: Cloudflare Realtime TURN, so calls connect on networks that block direct audio. Without them, calls use STUN only. |
| `GEMINI_API_KEY20`, `GEMINI_API_KEY21` (secrets) | Optional: **this site's own Gemini keys**, for the 🤖 agent caller. They're interchangeable: each call starts on the next one, and when one reaches its limit the other takes over. Keys from two different Google Cloud projects give twice the allowance. Either one alone works. Without a Gemini key, live calls only. |
| `GEMINI_API_KEY5` … `GEMINI_API_KEY9` (then `GEMINI_API_KEY`, `_KEY1`, `_KEY2`) (secrets) | Optional fallbacks: the shared LSH Gemini key pool (as on Ring Channel), used when `GEMINI_API_KEY20` and `_21` are busy or missing. |
| `LSH_KV` (KV binding) | The recordings, under `hrmc:rec:`. `wrangler.json` points at the shared LSH KV namespace (the same one as Ring Channel, a separate key prefix); give it its own namespace if you want the interview recordings kept apart. |
| `RECORDING_DAYS` | How long recordings are kept (default 90). |
| `AI_MAX_MINUTES` | The longest an agent call can run (default 8). |

## Local development and tests

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

`tests/run.sh` starts `wrangler dev` with a stand-in for Gemini (`tests/mock-gemini.js`) and runs two browser tests in Chromium with fake microphones: `tests/e2e-live.js` (the admin makes an HR account, HR signs in with it, the one-time link works once, ring, answer, audio, hold, transfer, the live note, recording, the submitted note, HR's score, ending the session, the admin deleting the applicant) and `tests/e2e-ai.js` (the agent caller with a typed persona, the live transcript, hold, transfer, the note, the call log). GitHub Actions runs them on every push and pull request (`.github/workflows/checks.yml`).

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
| `public/js/app.js` | Sign-in, the top bar, 👥 Applicants, 🗂 Call Logs, a call's page, and 🛡 Admin. |
| `public/js/hr.js`, `public/js/applicant.js` | HR's console and the applicant's phone. |
