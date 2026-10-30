/* =========================================================
   The company the applicant answers for, its phone directory, the
   applicant's call note, the AI caller's voices, and the mock-call
   scenarios.
   ---------------------------------------------------------
   SCENARIOS holds HR's scenarios. The first is the default: its
   briefing is the sheet the applicant reads on their phone. A call can
   also be an open call: HR plays any caller live, or types the AI
   caller's persona on the console.

   A scenario looks like this (only id, title and caller.name are required):
   {
     id: 'hr_angry_client',                // unique, letters/numbers/_ only
     title: 'Upset client wants an update',
     caller: { name: 'Dana Price', gender: 'f', number: '(555) 013-4477' },   // gender: 'f' or 'm' (picks the AI voice)
     opening: 'Hi, I have been waiting two weeks for a call back…',          // what the caller says first
     persona: 'Who the caller is, what they know, how they behave…',          // the AI caller's instructions (HR sees them as the script)
     facts: 'The situation today…',                                           // optional
     goals: ['Greets with the company name', 'Verifies the caller', '…'],     // optional: what a good call does (HR's checklist)
     unavailable: ['201'],                                                    // optional: extensions that don't pick up a transfer
     briefing: [{ title, items | text, ordered?, note? }],                    // optional: the applicant's own sheet (what they know before the call)
     ai: true                                                                 // false = live only (HR plays it)
   }
   ========================================================= */

export const COMPANY = {
  name: 'Legal Support Help',
  line: 'Main Line',
  number: '(702) 555-0100',
  address: '1290 S. Jones Blvd. Las Vegas, NV 89146',
  email: 'recruitment@legalsupporthelp.com'
};

// The extensions an applicant can transfer a caller to. HR decides on the call whether a live transfer
// picks up; on an AI call, an extension in the scenario's `unavailable` list doesn't.
export const DIRECTORY = [
  { name: 'Attorney', role: 'Consultations by appointment only', ext: '201' },
  { name: 'Paralegal', role: 'Existing cases', ext: '301' },
  { name: 'Office Manager', role: 'Administration', ext: '401' }
];

// The intake note the applicant takes during the call (the information the scenario asks them to obtain).
// HR sees it as it's typed.
export const NOTE_FIELDS = [
  { k: 'caller', label: 'Full name' },
  { k: 'number', label: 'Contact number (callback)' },
  { k: 'email', label: 'Email' },
  { k: 'reason', label: 'Brief description of the issue', type: 'textarea' },
  { k: 'incident', label: 'Date of incident' },
  { k: 'location', label: 'Location (city/state)' },
  { k: 'otherAtty', label: 'Spoken to another attorney?' },
  { k: 'consult', label: 'Consultation scheduled (day, date, time)' },
  { k: 'action', label: 'Message / next steps', type: 'textarea' }
];

/* 🎚 The voices the AI caller can speak with (Gemini Live's prebuilt voices). */
export const AI_VOICES = [
  { id: 'Kore', label: 'Kore', desc: 'Firm and clear', gender: 'f' },
  { id: 'Aoede', label: 'Aoede', desc: 'Bright and warm', gender: 'f' },
  { id: 'Leda', label: 'Leda', desc: 'Young and light', gender: 'f' },
  { id: 'Zephyr', label: 'Zephyr', desc: 'Easy and breezy', gender: 'f' },
  { id: 'Puck', label: 'Puck', desc: 'Upbeat and quick', gender: 'm' },
  { id: 'Charon', label: 'Charon', desc: 'Deep and measured', gender: 'm' },
  { id: 'Fenrir', label: 'Fenrir', desc: 'Gruff and forceful', gender: 'm' },
  { id: 'Orus', label: 'Orus', desc: 'Steady and business-like', gender: 'm' }
];
export const voiceOk = (v) => AI_VOICES.some((x) => x.id === v) ? String(v) : '';

export const SCENARIOS = [
  /* From "Mock Call Scenario for New Hire Interview": Initial Client Intake & Scheduling.
     `briefing` is the applicant's own sheet (shown on their phone before and during the call); the caller
     (persona, opening, facts) is HR's script and what the agent caller plays, and the applicant never sees it. */
  {
    id: 'lsh_intake_scheduling',
    title: 'Initial Client Intake & Scheduling',
    caller: { name: 'Rachel Morgan', gender: 'f', number: '(702) 555-0148' },
    opening: 'Hi, um, I was in a car accident and I really need to talk to a lawyer today. Can I speak to the attorney right now?',
    persona: `You are Rachel Morgan, 38, calling Legal Support Help, a personal injury law firm in Las Vegas, for the first time. You are a new potential client.
What happened: on Saturday, October 18, you were rear-ended while stopped at a red light on West Sahara Avenue in Las Vegas, Nevada. The other driver said he was looking at his phone. The police came and made a report.
Since then: your neck and lower back hurt; you went to urgent care the next day and have a follow-up visit next week. Your car is in the body shop. The other driver's insurance company keeps calling you and wants a recorded statement, which makes you nervous.
Your details, given only when asked: full name Rachel Morgan (spell it M-O-R-G-A-N if asked); cell phone (702) 555-0148, the best number for a callback; email rachel.morgan@email.com; you have NOT spoken to any other attorney.
How you act: you are upset and a little emotional at first, you talk quickly and tend to go off on tangents about the accident, your pain and your car. You calm down if the person is warm, patient and clear.
Push on these, one at a time, during the call:
- You want to speak to the attorney right now. If told the attorney isn't available, you are disappointed but accept a scheduled consultation once it's explained politely.
- Ask: "Should I give the insurance company that recorded statement?" (you want advice).
- Ask: "Do you think I have a good case? How much money could I get?" (you want a promise).
- For the consultation, first ask for Monday after 5 PM; then ask whether Friday morning works. You work days but can take a call on your lunch break. Only accept a time that is a Tuesday or a Thursday between 9:30 AM and 3:00 PM; your preference is Thursday at 1:00 PM, and Tuesday at 2:30 PM also works.
- Ask whether you have to come into the office (you'd prefer not to). Ask how long the consultation will be.
If they confirm your callback number and the appointment details back to you, thank them warmly. End the call politely when they close it.`,
    facts: 'Consultations: phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM, 30 minutes at most; the attorney calls the client. The attorney is not available for unscheduled calls.',
    goals: [
      'Greets the caller professionally (firm name, own name, offer to help)',
      'Identifies the purpose of the call',
      'Stays calm and empathetic while the caller is emotional; doesn\'t interrupt',
      'Politely explains the attorney is unavailable without a scheduled consultation',
      'Gathers: full name, contact number and email, brief description, date of incident, city/state, other attorney',
      'Gives no legal advice (recorded statement) and no guarantee of outcome',
      'Offers only Tuesday/Thursday, 9:30 AM – 3:00 PM; explains phone consult, 30 minutes max, attorney calls',
      'Confirms the callback number and reads the appointment back',
      'Sets clear expectations and closes the call politely and confidently'
    ],
    unavailable: ['201'],
    briefing: [
      { title: 'Purpose of the mock call', items: ['Professional phone etiquette', 'Clarity and confidence in communication', 'Ability to listen, probe, and clarify', 'Call flow control and client reassurance', 'Basic scheduling and intake skills'],
        note: 'This is not a test of legal knowledge. Focus on how you communicate, not giving legal advice.' },
      { title: 'Your role', text: 'You are a Legal Virtual Assistant answering inbound calls for a U.S.-based law firm. The attorney is not available to speak directly with callers unless a consultation is properly scheduled.' },
      { title: 'Your task', ordered: true, items: ['Greet the caller professionally', 'Identify the purpose of the call', 'Gather relevant information', 'Set expectations clearly', 'Offer to schedule a consultation or take a message', 'Close the call politely and confidently'] },
      { title: 'Call type', text: 'Inbound call: new potential client.' },
      { title: 'Scenario background (what you know)', items: ['Law firm: Legal Support Help', 'Practice area: Personal Injury / Civil Litigation (do not give legal advice)', 'Location: 1290 S. Jones Blvd. Las Vegas, NV 89146', 'Email address: recruitment@legalsupporthelp.com', 'Attorney\'s availability: limited; consultations must be scheduled', 'New client consults are only scheduled on Tuesdays and Thursdays.', 'Phone consults are max 30 minutes.', 'All consultation meetings are phone consults only.', 'Phone consults only between 9:30 AM – 3:00 PM; the attorney will call the client: you must confirm the callback number.', 'You may: ask clarifying questions, reassure the caller, schedule a consultation, take a detailed message.'] },
      { title: 'Information you should try to obtain', items: ['Full name', 'Contact number and email', 'Brief description of the issue', 'Date of incident', 'Location (city/state only)', 'Whether they have spoken to another attorney', 'Best time for a consultation'], note: 'Do not ask for unnecessary details or provide opinions.' },
      { title: 'Key challenges you\'ll be assessed on', items: ['Remaining calm and professional if the caller is emotional', 'Politely explaining that the attorney is unavailable', 'Redirecting the call toward scheduling without sounding dismissive', 'Using clear, neutral, client-friendly language', 'Proper call closing'] },
      { title: 'What you should NOT do', items: ['Do not provide legal advice', 'Do not guarantee outcomes', 'Do not interrupt the caller', 'Do not sound rushed or robotic'] },
      { title: 'Call duration', text: '⏱ 5–10 minutes' }
    ],
    ai: true
  }
];

const str = (x, n) => String(x == null ? '' : x).trim().slice(0, n);

// A scenario as it's kept on a call, from SCENARIOS or from what HR typed on the console.
export function cleanScenario(o) {
  o = o || {};
  const c = o.caller || {};
  return {
    id: str(o.id, 40).replace(/[^\w-]/g, '') || 'open',
    title: str(o.title, 120) || 'Open call',
    caller: { name: str(c.name, 60) || 'Caller', gender: c.gender === 'm' ? 'm' : 'f', number: str(c.number, 30) },
    opening: str(o.opening, 1000),
    persona: str(o.persona, 6000),
    facts: str(o.facts, 3000),
    goals: (Array.isArray(o.goals) ? o.goals : []).map((g) => str(g, 300)).filter(Boolean).slice(0, 20),
    unavailable: (Array.isArray(o.unavailable) ? o.unavailable : []).map((x) => str(x, 8)).filter(Boolean).slice(0, 10),
    briefing: Array.isArray(o.briefing) ? o.briefing : [],
    ai: o.ai !== false
  };
}

export const scenarioById = (id) => { const s = SCENARIOS.find((x) => x.id === id); return s ? cleanScenario(s) : null; };
export const listScenarios = () => SCENARIOS.map(cleanScenario);
// 📄 The applicant's briefing sheet: the default scenario's (the first), shown on their phone before and during the call.
export const applicantBriefing = () => (SCENARIOS[0] ? { title: SCENARIOS[0].title, sections: SCENARIOS[0].briefing || [] } : null);

// A call with no scenario: HR plays whoever they like (live), or types the AI caller's persona.
export function openCall(o) {
  o = o || {};
  return cleanScenario({ id: o.persona ? 'custom' : 'open', title: o.persona ? 'AI caller (custom persona)' : 'Open call', caller: { name: o.callerName || (o.persona ? 'Caller' : 'WIRELESS CALLER'), gender: o.gender, number: o.callerNumber }, persona: o.persona, opening: o.opening, ai: true });
}

// What the applicant's phone shows of a call: the caller ID only, never the script.
export const callerIdOf = (s, withheld) => withheld ? { name: 'PRIVATE CALLER', number: 'Unknown' } : { name: (s.caller.name || 'Caller').toUpperCase(), number: s.caller.number || '' };
