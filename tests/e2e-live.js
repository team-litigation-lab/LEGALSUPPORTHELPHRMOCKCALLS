/* A live mock call between two browsers, against `wrangler dev` (tests/run.sh starts it).
   HR signs in, adds an applicant and copies the invite link; the applicant opens it; HR dials the
   extension and rings; the applicant answers, the audio connects, they hold and transfer, type the
   note; HR hangs up; the recording is saved; the applicant submits the note; HR scores the call. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const PASS = process.env.PASS || 'test-pass';
const shots = process.env.SHOTS || __dirname;

const step = (m) => console.log('•', m);
async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = (await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } }));
  const hr = await ctx.newPage();
  hr.on('pageerror', (e) => console.log('HR page error:', e.message));
  await hr.goto(BASE + '/');
  await hr.fill('#hrName', 'Hiring Manager');
  await hr.fill('#hrPass', PASS);
  await hr.click('#hrForm button[type=submit]');
  await hr.waitForSelector('#presence');
  step('HR signed in');

  // A new applicant and their link.
  await hr.goto(BASE + '/#/applicants');
  await hr.fill('#apName', 'Jamie Cruz');
  await hr.fill('#apPos', 'Receptionist');
  await hr.click('#addAp button[type=submit]');
  const link = await hr.waitForSelector('.linkbox input').then((x) => x.inputValue());
  const ext = (await hr.textContent('#apList td.mono')).trim();
  step(`applicant added: ext ${ext}, ${link}`);

  const ap = await (await browser.newContext({ permissions: ['microphone'], viewport: { width: 1200, height: 860 } })).newPage();
  ap.on('pageerror', (e) => console.log('Applicant page error:', e.message));
  await ap.goto(link);
  await ap.waitForSelector('#kAv');
  if (new URL(ap.url()).search) throw new Error('the invite code stayed in the address bar');
  step('applicant signed in by the link');

  await hr.goto(BASE + '/#/console');
  await hr.waitForSelector(`#presence [data-ext="${ext}"]`);
  await hr.click(`#presence [data-ext="${ext}"]`);
  await hr.fill('#cName', 'Dana Price');
  await hr.click('#kCall');
  await ap.waitForSelector('#kAns', { timeout: 10000 });
  if (!(await ap.textContent('#screen')).includes('DANA PRICE')) throw new Error('caller ID missing');
  await ap.screenshot({ path: shots + '/01-applicant-ringing.png' });
  step('applicant phone rings with the caller ID');

  await ap.click('#kAns');
  await ap.waitForFunction(() => /On the call/.test(document.querySelector('#screen').textContent), null, { timeout: 20000 });
  await hr.waitForFunction(() => /On the call/.test(document.querySelector('#screen').textContent), null, { timeout: 20000 });
  step('audio connected on both sides');

  await ap.click('#kHold');
  await hr.waitForFunction(() => /ON HOLD/.test(document.querySelector('#screen').textContent));
  await ap.click('#kHold');
  step('hold and resume');

  await ap.click('#kTx');
  await ap.click('#transferBox [data-ext="201"]');
  await hr.waitForSelector('[data-tx="no-answer"]');
  await hr.click('[data-tx="no-answer"]');
  await ap.waitForFunction(() => /no answer/.test(document.querySelector('#transferBox').textContent));
  await ap.click('#takeBack');
  step('transfer: HR answered "no answer", the applicant took the caller back');

  await ap.fill('#n_caller', 'Dana Price');
  await ap.fill('#n_reason', 'Wants an update on her file.');
  await hr.waitForFunction(() => /Wants an update/.test(document.querySelector('#liveNote').textContent));
  await hr.screenshot({ path: shots + '/02-hr-live.png' });
  step('HR sees the note as it is typed');

  await hr.waitForTimeout(2500);   // a few seconds of audio for the recording
  await hr.click('#kEnd');
  await ap.waitForSelector('#noteForm button[type=submit]');
  await hr.waitForFunction(() => [...document.querySelectorAll('#toast .toast')].some((t) => /Recording saved/.test(t.textContent)), null, { timeout: 15000 });
  step('call ended, recording saved');

  await ap.fill('#n_action', 'Message to the case manager.');
  await ap.click('#noteForm button[type=submit]');
  await ap.waitForFunction(() => /note was sent/.test(document.body.textContent));
  step('applicant submitted the note');

  await hr.click('#qStars [data-n="4"]');
  await hr.selectOption('#qVerdict', 'Pass');
  await hr.fill('#qNotes', 'Clear greeting, good hold etiquette.');
  await hr.click('#qSave');
  await hr.goto(BASE + '/#/calls');
  await hr.waitForSelector('#callList tr[data-id]');
  await hr.click('#callList tr[data-id]');
  await hr.waitForSelector('#loadRec');
  await hr.click('#loadRec');
  await hr.waitForSelector('#recBox audio');
  const page = await hr.textContent('main');
  for (const want of ['Message to the case manager.', 'Clear greeting', 'Transfers: Supervisor (no-answer)']) if (!page.includes(want)) throw new Error('call page is missing: ' + want);
  await hr.screenshot({ path: shots + '/03-hr-call-log.png', fullPage: true });
  step('call log shows the note, the score, the transfer and the recording');

  // Closing the link signs the applicant out.
  await hr.goto(BASE + '/#/applicants');
  hr.once('dialog', (d) => d.accept());
  await hr.click('[data-close]');
  await ap.waitForFunction(() => /closed by HR|isn't valid|Sign-in|link/.test(document.body.textContent), null, { timeout: 10000 });
  step('closing the link signs the applicant out');

  await browser.close();
  console.log('PASS');
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
