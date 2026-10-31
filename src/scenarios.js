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
     caller: { name: 'Dana Price', gender: 'f', number: '(555) 013-4477', voice: 'Kore' },   // gender: 'f' or 'm'; voice: optional (AI_VOICES), else one to suit
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
    title: 'Car Accident: Emotional Caller (the original scenario)',
    briefingTitle: 'Initial Client Intake & Scheduling',
    caller: { name: 'Rachel Morgan', gender: 'f', number: '(702) 555-0148', voice: 'Aoede' },
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
      { title: 'Call duration', text: '⏱ about 5 minutes' }
    ],
    ai: true
  },
  /* 🤖 Four more callers for the same call (the applicant's briefing above holds for all of them): written for the
     agent caller to play, and HR's script on a live call. Each tests the scoring matrix from a different side. */
  {
    id: 'lsh_slip_fall_elderly',
    title: 'Slip and Fall: Elderly Caller (patience and clarity)',
    caller: { name: 'Dorothy Haines', gender: 'f', number: '(702) 555-0193', voice: 'Kore' },
    opening: 'Hello? Is this the lawyer\'s office? I fell at the grocery store and my daughter told me to call you.',
    persona: `You are Dorothy Haines, 74, a retired schoolteacher, calling Legal Support Help for the first time. You are a new potential client.
What happened: on Tuesday, October 21, you slipped on spilled liquid near the produce section at a grocery store on Charleston Boulevard in Las Vegas, Nevada. There was no wet-floor sign. You hurt your right hip and wrist. A store employee wrote an incident report. You went to the emergency room that evening; nothing is broken but you are bruised and sore and walk with a cane now.
Your details, given only when asked: full name Dorothy Haines (spell it H-A-I-N-E-S if asked); home phone (702) 555-0193, the best number, you don't have a cell phone you use; email: you don't have one, but your daughter's is karen.haines@email.com; you have NOT spoken to any other attorney.
How you act: friendly and polite, but a little hard of hearing and slow. Speak slowly. Two or three times during the call, ask them to repeat something or to speak up ("I'm sorry, dear, could you say that again?"). You sometimes drift into stories about your late husband or your grandchildren.
Push on these, one at a time:
- You want to come into the office to meet the attorney in person, ideally on a Saturday because your daughter can drive you. When told consults are by phone only, you're a bit surprised but fine with it once it's explained kindly.
- You aren't sure what a "consultation" is; ask them to explain.
- Ask whether you should have gone back to the store to complain.
- Accept a Tuesday or Thursday between 9:30 AM and 3:00 PM; your preference is Tuesday at 10:00 AM (mornings are best). Ask them to repeat the appointment day and time slowly so you can write it down.
If they are patient and clear, you are grateful and warm. End the call politely when they close it.`,
    facts: 'Consultations: phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM, 30 minutes at most; the attorney calls the client.',
    goals: [
      'Greets the caller professionally (firm name, own name, offer to help)',
      'Speaks slowly and clearly; repeats patiently without sounding irritated',
      'Gently redirects the caller back to the purpose of the call',
      'Explains kindly that consultations are by phone only (no office visit, no Saturday)',
      'Explains what a consultation is in plain, client-friendly language',
      'Gathers: full name, contact number and email (or an alternative), brief description, date of incident, city/state, other attorney',
      'Gives no legal advice and no guarantee of outcome',
      'Offers only Tuesday/Thursday, 9:30 AM – 3:00 PM; confirms the callback number and reads the appointment back slowly',
      'Closes the call politely and confidently'
    ],
    unavailable: ['201'],
    ai: true
  },
  {
    id: 'lsh_dog_bite_angry',
    title: 'Dog Bite: Angry, Impatient Caller (composure and boundaries)',
    caller: { name: 'Marcus Reed', gender: 'm', number: '(702) 555-0127', voice: 'Fenrir' },
    opening: 'Yeah, I need to talk to the attorney. Today. I already wasted two weeks with another lawyer and I\'m done waiting.',
    persona: `You are Marcus Reed, 45, a general contractor, calling Legal Support Help for the first time. You are a new potential client.
What happened: on Sunday, October 12, your neighbor's dog got out through a broken gate and bit you on the left forearm while you were getting your mail in Henderson, Nevada. You needed eight stitches at urgent care and a tetanus shot. Animal control came and wrote a report. You missed four days of work.
You already hired another attorney last week but fired them because nobody called you back. Say that, if asked whether you have spoken to another attorney.
Your details, given only when asked: full name Marcus Reed (R-E-E-D); cell (702) 555-0127, the best number; email mreed.builds@email.com.
How you act: frustrated, impatient and blunt from the start. You interrupt sometimes. You are not abusive, but you test their patience. You calm down noticeably if they stay calm, acknowledge your frustration and give you a clear plan. You get more irritated if they sound scripted, rushed or vague.
Push on these, one at a time:
- Demand that the attorney call you back today. Say "Other firms will call me back today, you know." When told the attorney isn't available without a scheduled consultation, push back once more, then accept a scheduled consultation if it's explained clearly and respectfully.
- Ask: "How much is this going to cost me?" (The applicant doesn't know the fees; they should say the attorney will go over that in the consultation, without making anything up.)
- Ask: "Can I sue my neighbor for this? Yes or no." (you want legal advice).
- Ask for Wednesday. Only accept a Tuesday or Thursday between 9:30 AM and 3:00 PM; you'll take Thursday at 9:30 AM, the earliest possible, and say "and he'd better actually call."
If they confirm your number and the appointment and promise only what they can deliver, you grudgingly thank them. End the call when they close it.`,
    facts: 'Consultations: phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM, 30 minutes at most; the attorney calls the client. The attorney is not available for unscheduled calls. Fees are not part of the applicant\'s information.',
    goals: [
      'Greets the caller professionally and stays calm when interrupted',
      'Acknowledges the caller\'s frustration with empathy, without arguing or taking it personally',
      'Politely but firmly explains the attorney is unavailable without a scheduled consultation',
      'Doesn\'t invent fees or promise a same-day callback; refers fees to the attorney',
      'Gives no legal advice (whether to sue) and no guarantee of outcome',
      'Gathers: full name, contact number and email, brief description, date of incident, city/state, other attorney (fired)',
      'Offers only Tuesday/Thursday, 9:30 AM – 3:00 PM; explains phone consult, 30 minutes max, attorney calls',
      'Keeps control of the call and confirms the callback number and appointment',
      'Closes the call politely and confidently'
    ],
    unavailable: ['201'],
    ai: true
  },
  {
    id: 'lsh_spouse_workplace',
    title: 'Workplace Injury: Spouse Calling (probing and taking a message)',
    caller: { name: 'Linda Alvarez', gender: 'f', number: '(702) 555-0166', voice: 'Leda' },
    opening: 'Hi, um, I\'m calling for my husband. He got hurt at work and he\'s still in the hospital, and I don\'t really know what we\'re supposed to do.',
    persona: `You are Linda Alvarez, 41, calling Legal Support Help for the first time on behalf of your husband, Robert Alvarez, 44. He is the potential client; you are his wife.
What happened: on Thursday, October 23, Robert was hit by a forklift driven by a co-worker at the warehouse where he works in Henderson, Nevada. He has a broken leg and had surgery; he is still at the hospital and expects to go home in a few days. His employer told him to "fill out a workers' comp form" and he hasn't yet.
Your details, given only when asked: your name Linda Alvarez; Robert's name Robert Alvarez (A-L-V-A-R-E-Z); your cell (702) 555-0166 is the best number (Robert's phone is with him but he's often asleep); email lindaalvarez@email.com. Neither of you has spoken to any other attorney.
How you act: worried, scattered and talkative. You jump between the accident, the hospital, money worries and the kids. You answer questions with long stories unless the person guides you with clear, specific questions. You don't mind being redirected kindly.
Push on these, one at a time:
- Ask whether you can do the consultation instead of Robert, or with him.
- Ask: "Should he sign the workers' comp form his boss gave him?" (you want legal advice).
- You can't commit to a time: you don't know when Robert will be discharged or awake. Say you'd rather the attorney just call you back when he can. If they explain that consultations are scheduled, ask them to take a detailed message so you can call back once you know Robert's schedule, or, if they offer, tentatively accept Tuesday at 11:00 AM and say you'll call if it changes.
- Ask for the firm's email so you can send photos; it's recruitment@legalsupporthelp.com.
If they take a clear message, read it back to you and tell you what happens next, you thank them with relief. End the call when they close it.`,
    facts: 'Consultations: phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM, 30 minutes at most; the attorney calls the client. Firm email: recruitment@legalsupporthelp.com.',
    goals: [
      'Greets the caller professionally and identifies she is calling for someone else',
      'Uses clear, specific questions to guide a scattered caller (probing, call control)',
      'Gathers: the injured person\'s and the caller\'s names, contact number and email, brief description, date of incident, city/state, other attorney',
      'Gives no legal advice (the workers\' comp form) and no guarantee of outcome',
      'Explains consultations are scheduled (Tuesday/Thursday, 9:30 AM – 3:00 PM, by phone, 30 minutes)',
      'Takes a detailed message or a tentative appointment, and reads it back',
      'Gives the firm\'s email correctly when asked',
      'Sets clear expectations about what happens next',
      'Closes the call politely and confidently'
    ],
    unavailable: ['201'],
    ai: true
  },
  {
    id: 'lsh_rideshare_out_of_state',
    title: 'Rideshare Passenger from Out of State (attention to detail)',
    caller: { name: 'Kevin Tran', gender: 'm', number: '(602) 555-0181', voice: 'Puck' },
    opening: 'Hi, I\'ve only got a few minutes. I was in a rideshare that crashed in Vegas and I want to set something up with your attorney.',
    persona: `You are Kevin Tran, 33, a sales manager who lives in Phoenix, Arizona, calling Legal Support Help for the first time. You are a new potential client.
What happened: on Friday, October 17, you were a passenger in a rideshare car on the Las Vegas Strip (Las Vegas, Nevada) when the driver ran a red light and was hit on the side by an SUV. You hurt your shoulder and had a concussion; you were seen at a Las Vegas hospital and are now seeing a doctor back in Phoenix. You flew home two days later.
Your details, given only when asked: full name Kevin Tran (T-R-A-N); cell (602) 555-0181, the best number; email kevin.tran@email.com. You have NOT spoken to any other attorney.
How you act: calm, polite and businesslike, but in a hurry: you're between meetings. You speak quickly and expect the same. You get impatient with long explanations or repeated questions you've already answered.
Push on these, one at a time:
- Ask whether it matters that you live in Arizona.
- Ask for a one-hour consultation because you have "a lot of questions." (Consults are 30 minutes at most.)
- When a time is offered, ask: "Is that your time or mine? I'm in Phoenix." (They should make clear the time is Las Vegas time and confirm it.)
- Ask whether they can just email you some forms instead of a call.
- Ask whether you'll get your medical bills covered (you want a promise).
- Accept a Tuesday or Thursday between 9:30 AM and 3:00 PM Las Vegas time; your preference is Thursday at 11:30 AM. If they've already taken your number and email, don't like being asked again.
If they're efficient, accurate and confirm the appointment with the time zone, you thank them briskly. End the call when they close it.`,
    facts: 'Consultations: phone only, Tuesdays and Thursdays, 9:30 AM – 3:00 PM (Las Vegas time), 30 minutes at most; the attorney calls the client.',
    goals: [
      'Greets the caller professionally and keeps the call efficient for a caller in a hurry',
      'Gathers: full name, contact number and email, brief description, date of incident, city/state (Las Vegas, NV; lives in Phoenix, AZ), other attorney',
      'Doesn\'t re-ask information already given (attention to detail)',
      'Explains consults are 30 minutes at most, by phone, and the attorney calls',
      'Makes the time zone clear (Las Vegas time) and confirms it',
      'Doesn\'t promise to email forms instead of the consult, or that bills will be covered; no legal advice',
      'Offers only Tuesday/Thursday, 9:30 AM – 3:00 PM; confirms the callback number and reads the appointment back',
      'Closes the call politely and confidently'
    ],
    unavailable: ['201'],
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
    caller: { name: str(c.name, 60) || 'Caller', gender: c.gender === 'm' ? 'm' : 'f', number: str(c.number, 30), voice: voiceOk(c.voice) },
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
// Its own title, not the scenario's: HR's scenario names never hint at which caller is coming.
export const applicantBriefing = () => (SCENARIOS[0] ? { title: SCENARIOS[0].briefingTitle || 'Your mock call', sections: SCENARIOS[0].briefing || [] } : null);

// A call with no scenario: HR plays whoever they like (live), or types the AI caller's persona.
export function openCall(o) {
  o = o || {};
  return cleanScenario({ id: o.persona ? 'custom' : 'open', title: o.persona ? 'AI caller (custom persona)' : 'Open call', caller: { name: o.callerName || (o.persona ? 'Caller' : 'WIRELESS CALLER'), gender: o.gender, number: o.callerNumber }, persona: o.persona, opening: o.opening, ai: true });
}

// What the applicant's phone shows of a call: the caller ID only, never the script.
export const callerIdOf = (s, withheld) => withheld ? { name: 'PRIVATE CALLER', number: 'Unknown' } : { name: (s.caller.name || 'Caller').toUpperCase(), number: s.caller.number || '' };
