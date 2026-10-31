# LSH HR Mock Calls

A browser phone system (VOIP) for the **mock calls in HR interviews**. HR rings the applicant's phone in the browser and the applicant answers it as an agent of Legal Support Help. The caller is either:

- **🎙 Live:** HR plays the caller over live audio; or
- **🤖 Agent caller:** an AI voice (Gemini Live) plays the caller, from a scenario or from a persona HR types on the console.

It **runs on its own, apart from the LSH training platform**: its own admin, its own HR accounts, and **one-time links** for applicants. Nothing here signs in through, or reports to, the Training Portal.

It is cloned from **LSH Ring Channel**'s phone system (the Switchboard, the WebRTC engine, the hold music, transfers, recording and the AI caller). Ring Channel's **CMS integration** (Case Lookup, the CMS Training Library), the **LSH Training Portal** sign-in and course results, the **training scenarios** and metrics, the autograding and the messaging simulators are **left out**.

Everything runs in the browser: no phone numbers, no phone bills. It's a Cloudflare Worker with one Durable Object (the Switchboard). The audio goes straight between the two browsers over WebRTC, through a TURN relay when a network blocks direct audio.

## Two pages: each side sees only its own sign-in

| Address | Who | What it shows |
|---|---|---|
| **`/`** (the main address, the default landing) | 🛡 Admin and 🧑‍💼 HR only | The **HR & Admin sign-in**, then 🎛 Console, 👥 Applicants, 🗂 Call Logs and (admin) 🛡 Admin. No applicant sign-in. `/admin` forwards here. |
| **`/interview`** | 👤 Applicants only | Reached through the **one-time link the system generates** on 👥 Applicants (`/interview?invite=…`): **"Welcome to your interview — your full name — Enter →"**. Opened without a link: the interview code and their full name. No HR or admin sign-in, and no link to it. |

Each page keeps its own sign-in in the browser, so an admin can open a test applicant link on the same computer without being signed out. An interview link opened on the main page (including links sent before the move, `/?invite=…`) goes to `/interview`. `public/index.html` (HR & Admin) and `public/interview.html` (applicants) share the same scripts (`window.HRMC_VIEW` says which view it is). The whole site is kept out of search engines.

## Who signs in

| Who | How | What they get |
|---|---|---|
| 🛡 **Admin** | On the main page: any name + the **admin passphrase** (`ADMIN_PASSPHRASE`) | Everything HR has, plus **🛡 Admin**: HR accounts, settings, status; deleting applicants (with their calls and recordings) and **removing call logs** (see below). |
| 🧑‍💼 **HR interviewer** | Their **username and password**, made by the admin on 🛡 Admin | 🎛 Console, 👥 Applicants, 🗂 Call Logs. |
| 👤 **Applicant** | Their **one-time link** | ☎ My phone, for one interview session. |

**🛡 Admin**
- **👤 HR accounts:** add one (name shown on calls, username, password of at least 8 characters, stored salted and hashed), change a password, **Disable** (signs them out at once), **Enable**, 🗑 delete. Their calls stay in the Call Logs.
- **⚙️ Settings:** how long an unopened one-time link works (default **72 hours**) and how long an applicant's session lasts once they open it (default **4 hours**).
- **🩺 Status:** the TURN relay, the agent caller's Gemini keys, recordings, and the counts (applicants, phones open, HR online, calls, calls not scored).

**🔗 One-time access**
- Each applicant gets **one link, good for one sign-in**. Opening it asks for their **full name**; sending it signs them in to their phone and **uses the link up**: used again (in any browser, by anyone) it says *already used*. Opening the link alone doesn't use it, so a link preview in an email or chat app can't. Reloading their own page keeps their session.
- The name they type is the one HR sees. HR's name for them is optional when adding them; when it differs, 👥 Applicants shows *invited as …*.
- **Submitting the call note ends their access for good:** they see *Thank you! Your interview call is complete*, this browser forgets the session, and reloading shows only the code-and-name entry, where the used link is refused. Signing out is final too (they're warned). For a second call, HR makes ↻ New link.
- The session ends after the hours set on ⚙️ Settings, when HR presses **⛔ End session**, or when HR makes **↻ New link** (which also cancels the old one). The applicant is signed out at once.
- 👥 Applicants shows each link's state: *Not opened yet* (with Copy), *In session*, *Used*, *Expired* or *Ended*. The link is only shown while it is unused.

## How a mock call goes

**HR**
1. Opens the main address and signs in with their **username and password** (or the admin with the admin passphrase).
2. **👥 Applicants → ＋ Add & get link:** the applicant's name if you like (they type theirs when they open the link). They get a **desk extension** (7001, 7002, …) and a **one-time link**, copied to the clipboard to send them.
3. **🎛 Console:** the applicants whose phones are open are on the left. Click one (or dial their extension on the keypad), then:
   - **📞 Call (live)**: their phone rings; once they answer, you are the caller. Set the **Caller ID** name and number they see (or **🙈 Hide caller ID**).
   - **🤖 Agent caller**: the AI rings their phone and plays the caller. Under **🤖 Agent caller setup**, type who the AI plays (a persona), an optional opening line, and the voice. **👂 Follow** shows the conversation and the note live; **⏹** ends it.
4. On a live call: **Mute**, **🔊 Speaker**, **End call**. When the applicant transfers the caller, you decide what the extension does: **Picks up** (the call ends), **No answer** or **Voicemail**.
5. The applicant's **note** shows as they type it. **Score this call** (1–5), a **verdict** (Pass / Hold / Fail) and your **interview notes**, during or after the call. Only HR sees these.
6. **🗂 Call Logs** (admins can remove calls: 🗑 on a row, tick rows and **🗑 Delete selected**, or **🗑 Delete all shown**; each asks first, deletes the recordings too, and never touches a call still on the line): every call, with the recording (▶ play, ⬇ download), the note, the transcript (agent calls), the score and notes, and **⬇ Export CSV**.

**Applicant**
1. Opens the one-time link in Chrome or Edge on a computer, with a headset, **types their full name** and presses **Enter →**. That signs them in to **☎ My phone** for this interview; the link can't be used again. (Or, on the main page, they type the interview code and their name.) They allow the microphone when the browser asks.
2. Waits with the phone open: the **📞 Answer** key lights up when it rings, with the caller ID on the screen.
3. On the call: **Mute**, **⏸ Hold** (the caller hears hold music), **↪ Transfer** (to an extension in the directory), **🔊 Speaker**, **Hang up**, and the **📝 call note**.
4. After the call they finish the note and **📨 Submit** it. Applicants never see HR's scores or notes, nor the call logs.

**Reliability:** an unanswered call rings out after 45 seconds (*Missed*); a phone that loses its connection has 30 seconds to come back; reloading either page mid-call reconnects it (the applicant clicks **🔊 Reconnect the call**).

## 📋 The scoring matrix

HR scores every call on the **HR mock-call scoring matrix** (`src/rubric.js`), on the console during or after the call, or on the call's page:

| | Criterion |
|---|---|
| A | Professional Tone |
| B | Clarity of Speech |
| C | Composure |
| D | Basic Call Structure |
| E | Probing Skills |
| F | Active Listening |
| G | Attention to Detail (Pre-Provided Information & Availability Verification) |
| H | Confidence in Delivery |
| I | Call Control |
| **J** | **Final Assessment**: 5 Excellent / Fully Client-Ready · 4 Above Expectations / Nearly Client-Ready · 3 Meets Basic Expectations / Trainable · 2 Below Expectations / Needs Significant Coaching · 1 Not Ready / Unsatisfactory Performance |

Each is scored 1–5; the chosen level's full description shows under it (hover a number to read any level), with an optional remark. The **A–I average** is worked out as you score. The call's score is **J**; its label is the call's assessment in 🗂 Call Logs. **⬇ Export CSV** has every criterion, the A–I average and J. Only HR sees the scorecard.

## Scenarios

`SCENARIOS` in `src/scenarios.js`. The first is the default: the console starts on it, and its **briefing** is the sheet the applicant reads on their phone.

**Initial Client Intake & Scheduling** (from *Mock Call Scenario for New Hire Interview*):
- **The applicant's briefing** (shown on their phone before and during the call, word for word from the document): the purpose, their role and task, the call type, what they know (Legal Support Help, Personal Injury / Civil Litigation, 1290 S. Jones Blvd. Las Vegas, NV 89146, recruitment@legalsupporthelp.com, consults by phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM, 30 minutes max, the attorney calls the client), what to obtain, what they're assessed on, what not to do, and the 5–10 minute duration.
- **The caller** (HR's script on a live call, and what the 🤖 agent caller plays; the applicant never sees it): **Rachel Morgan**, (702) 555-0148, rachel.morgan@email.com, rear-ended at a red light on West Sahara Avenue, Las Vegas, NV on Saturday, October 18; neck and back pain; hasn't spoken to another attorney. Emotional and talkative at first. She asks for the attorney right now, whether to give the other driver's insurance a recorded statement (legal advice), whether she has a good case and how much she'd get (a guarantee), and for Monday after 5 PM, then Friday morning, before accepting Thursday at 1:00 PM (or Tuesday at 2:30 PM). *This caller was written for the scenario; the document describes only the applicant's side. Change it in `src/scenarios.js`.*
- **What a good call does** (HR's checklist), from the document's tasks and challenges.

The **call note** the applicant fills in is the scenario's intake: full name, contact number, email, brief description, date of incident, city/state, spoken to another attorney, the consultation scheduled, and message / next steps. The **transfer directory**: Attorney 201 (consultations by appointment only: the scenario says the attorney doesn't pick up), Paralegal 301, Office Manager 401.

**Four more callers for the agent caller** (the same call and the same briefing, so the applicant's information holds for each; HR's script on a live call too). Each has its own voice, which HR's 🎚 Voice still overrides:

| Scenario | Caller | What it tests |
|---|---|---|
| Car Accident: Emotional Caller (the original) | Rachel Morgan, (702) 555-0148 | Composure, no legal advice or guarantees, availability (asks Monday 5 PM, then Friday) |
| Slip and Fall: Elderly Caller | Dorothy Haines, 74, (702) 555-0193 | Patience and clarity: hard of hearing, asks to repeat, wants an in-person Saturday meeting; no email of her own |
| Dog Bite: Angry, Impatient Caller | Marcus Reed, (702) 555-0127 | Composure and boundaries: demands a callback today, fired his last attorney, asks about fees and "yes or no, can I sue?" |
| Workplace Injury: Spouse Calling | Linda Alvarez for her husband Robert, (702) 555-0166 | Probing and call control with a scattered caller; workers' comp advice; can't commit to a time: a detailed message (or a tentative Tuesday) |
| Rideshare Passenger from Out of State | Kevin Tran, Phoenix AZ, (602) 555-0181 | Attention to detail: in a hurry, wants a one-hour consult and forms by email, "your time or mine?" (Las Vegas time) |

**🎲 Surprise me** (in the console's Scenario list) draws a random scenario for each call, so HR doesn't know which caller the AI will play either.

The scenario names are HR's only: the applicant's page shows the briefing under its own title, *Initial Client Intake & Scheduling*.

To add a scenario, copy the shape at the top of `src/scenarios.js`. A call can still be an **open call** (Scenario: — Open call —): HR plays any caller live, or types the agent caller's persona.

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
| `AI_MAX_MINUTES` | How long an agent call runs (default 5). The caller is paced to wrap up inside it, and the call hangs up when the caller says goodbye. |

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
