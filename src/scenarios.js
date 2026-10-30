/* =========================================================
   The company the applicant answers for, its phone directory, the
   applicant's call note, the AI caller's voices, and the mock-call
   scenarios.
   ---------------------------------------------------------
   SCENARIOS is empty on purpose: the HR scenarios will be added here.
   Until then every call is an open call: HR plays any caller live,
   or types the AI caller's persona on the console.

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
     ai: true                                                                 // false = live only (HR plays it)
   }
   ========================================================= */

export const COMPANY = {
  name: 'Legal Support Help',
  line: 'Main Line',
  number: '(555) 010-2000'
};

// The extensions an applicant can transfer a caller to. HR decides on the call whether a live transfer
// picks up; on an AI call, an extension in the scenario's `unavailable` list doesn't.
export const DIRECTORY = [
  { name: 'Supervisor', role: 'Team Lead', ext: '201' },
  { name: 'Case Manager', role: 'Case Management', ext: '301' },
  { name: 'Billing', role: 'Accounts', ext: '401' },
  { name: 'Intake Team', role: 'New clients', ext: '501' }
];

// The note the applicant takes during the call. HR sees it as it's typed.
export const NOTE_FIELDS = [
  { k: 'caller', label: 'Caller name' },
  { k: 'number', label: 'Callback number' },
  { k: 'reason', label: 'Reason for the call', type: 'textarea' },
  { k: 'action', label: 'Action taken / next step', type: 'textarea' }
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
  // The HR mock-call scenarios go here (see the shape above).
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
    ai: o.ai !== false
  };
}

export const scenarioById = (id) => { const s = SCENARIOS.find((x) => x.id === id); return s ? cleanScenario(s) : null; };
export const listScenarios = () => SCENARIOS.map(cleanScenario);

// A call with no scenario: HR plays whoever they like (live), or types the AI caller's persona.
export function openCall(o) {
  o = o || {};
  return cleanScenario({ id: o.persona ? 'custom' : 'open', title: o.persona ? 'AI caller (custom persona)' : 'Open call', caller: { name: o.callerName || (o.persona ? 'Caller' : 'WIRELESS CALLER'), gender: o.gender, number: o.callerNumber }, persona: o.persona, opening: o.opening, ai: true });
}

// What the applicant's phone shows of a call: the caller ID only, never the script.
export const callerIdOf = (s, withheld) => withheld ? { name: 'PRIVATE CALLER', number: 'Unknown' } : { name: (s.caller.name || 'Caller').toUpperCase(), number: s.caller.number || '' };
