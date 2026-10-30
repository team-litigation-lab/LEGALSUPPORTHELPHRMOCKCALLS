/* 📋 The HR mock-call scoring matrix: A–I scored 1 to 5, and J, the final assessment.
   The call's score is J (the final assessment); A–I's average is kept beside it. */
export const RUBRIC = [
  { k: 'A', name: 'Professional Tone', levels: {
    5: 'Excellent / Client-Ready: Consistently professional, warm, empathetic, and accommodating. Sounds approachable and genuinely willing to assist while maintaining appropriate boundaries.',
    4: 'Above Expectations: Maintains professionalism and warmth, with minor lapses in empathy, approachability, or accommodating delivery.',
    3: 'Meets Basic Expectations: Generally professional but may sound scripted, neutral, or occasionally lack warmth and an accommodating tone.',
    2: 'Below Expectations: Tone occasionally sounds indifferent, unwelcoming, or insufficiently accommodating, affecting the caller\'s experience.',
    1: 'Poor: Tone is inappropriate, dismissive, impatient, or unprofessional, making the caller feel unwelcome or unsupported.' } },
  { k: 'B', name: 'Clarity of Speech', levels: {
    5: 'Excellent / Client-Ready: Speaks clearly and articulately, with accurate pronunciation, crisp diction, grammatically correct sentence construction, appropriate pacing, and minimal fillers. Consistently easy to understand and communicate ideas naturally.',
    4: 'Above Expectations: Generally clear and articulate, with good pronunciation, diction, and grammar. Minor grammatical errors or mispronunciations do not affect understanding or professionalism.',
    3: 'Meets Basic Expectations: Generally understandable but demonstrates occasional pronunciation errors, unclear diction, grammatical inaccuracies, or awkward sentence construction that may affect fluency.',
    2: 'Below Expectations: Frequent pronunciation errors, indistinct diction, or grammatical issues that affect sentence clarity and make communication difficult to follow at times.',
    1: 'Poor Communication: Communication is consistently difficult to understand due to significant pronunciation, articulation, or grammatical construction issues that substantially impede effective communication.' } },
  { k: 'C', name: 'Composure', levels: {
    5: 'Remains calm and confident even under pressure or unexpected questions.',
    4: 'Maintains composure with slight but controlled hesitation.',
    3: 'Generally calm but visibly hesitant when challenged.',
    2: 'Noticeable nervousness affecting performance.',
    1: 'Becomes flustered or unable to proceed effectively.' } },
  { k: 'D', name: 'Basic Call Structure', levels: {
    5: 'Strong, structured flow with smooth transitions and clear call control.',
    4: 'Organized flow with minor transition gaps.',
    3: 'Basic structure present but lacks smooth transitions.',
    2: 'Inconsistent structure; sequencing needs improvement.',
    1: 'No clear call structure observed.' } },
  { k: 'E', name: 'Probing Skills', levels: {
    5: 'Strategic, relevant follow-up questions; gathers complete legal intake details.',
    4: 'Good probing with minor missed opportunities.',
    3: 'Basic follow-up questions but lacks depth.',
    2: 'Limited probing; misses important clarifications.',
    1: 'Does not ask relevant follow-up questions.' } },
  { k: 'F', name: 'Active Listening', levels: {
    5: 'Consistently paraphrases, confirms details, and demonstrates full engagement.',
    4: 'Strong listening with occasional missed confirmations.',
    3: 'Listens adequately but rarely confirms understanding.',
    2: 'Misses or repeats key information due to lack of confirmation.',
    1: 'Frequently misunderstands or overlooks key details.' } },
  { k: 'G', name: 'Attention to Detail (Pre-Provided Information & Availability Verification)',
    desc: 'How well the applicant reviewed and used the information given before the mock call, particularly in confirming availability.', levels: {
    5: 'Fully reviewed the provided information; accurately verified availability without errors, referenced pre-given data confidently, and avoided redundant questions.',
    4: 'Reviewed most of the provided information; minor clarification needed but demonstrated clear preparation.',
    3: 'Showed partial review; confirmed availability but missed or re-asked some already provided details.',
    2: 'Limited evidence of pre-call preparation; asked questions already answered in the provided information or overlooked availability specifics.',
    1: 'Did not demonstrate review of pre-provided information; failed to verify availability accurately.' } },
  { k: 'H', name: 'Confidence in Delivery', levels: {
    5: 'Highly confident, natural, and authoritative.',
    4: 'Confident overall with minor hesitation.',
    3: 'Moderate confidence with noticeable hesitation.',
    2: 'Frequent hesitation affecting credibility.',
    1: 'Significant lack of confidence.' } },
  { k: 'I', name: 'Call Control', levels: {
    5: 'Efficiently directs conversation while maintaining professionalism and empathy.',
    4: 'Generally in control with minor drift.',
    3: 'Some direction shown but allows conversation to wander.',
    2: 'Struggles to guide conversation effectively.',
    1: 'Unable to manage or structure the call flow.' } },
  { k: 'J', name: 'Final Assessment', final: true, levels: {
    5: 'Excellent / Fully Client-Ready: The applicant demonstrates strong call control, clear communication, accurate information verification, and professional confidence. Minimal to no coaching required before handling live client interactions.',
    4: 'Above Expectations / Nearly Client-Ready: The applicant shows solid communication skills and preparedness with only minor areas needing refinement. Can likely transition to live calls with light coaching and monitoring.',
    3: 'Meets Basic Expectations / Trainable: The applicant demonstrates foundational skills but requires structured training and guided practice before handling live legal client calls independently.',
    2: 'Below Expectations / Needs Significant Coaching: The applicant shows gaps in multiple key areas (e.g., probing, preparation, confidence, or structure). Substantial training and reassessment would be required before considering client-facing responsibilities.',
    1: 'Not Ready / Unsatisfactory Performance: The applicant does not demonstrate the communication readiness or preparation required for a Legal Virtual Assistant role at this time. Major improvements would be necessary before reconsideration.' } }
];

// J's label for a score: "Above Expectations / Nearly Client-Ready".
export const finalLabel = (n) => { const t = (RUBRIC.find((c) => c.final).levels[n] || ''); return t.split(':')[0]; };

// A review as it's kept: each criterion 1–5 (or not scored), a remark each, the A–I average and J.
export function cleanReview(v) {
  v = v || {};
  const scores = {}, remarks = {};
  for (const c of RUBRIC) {
    const n = Math.round(Number((v.scores || {})[c.k]));
    if (n >= 1 && n <= 5) scores[c.k] = n;
    const r = String((v.remarks || {})[c.k] || '').trim().slice(0, 1500);
    if (r) remarks[c.k] = r;
  }
  const parts = RUBRIC.filter((c) => !c.final && scores[c.k]).map((c) => scores[c.k]);
  const avg = parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100 : null;
  const final = scores.J || null;
  return { scores, remarks, avg, final, verdict: final ? finalLabel(final) : '', notes: String(v.notes || '').slice(0, 6000) };
}
