/* 🤖 The agent caller, against `wrangler dev` with tests/mock-gemini.js standing in for Google.
   HR types a persona and sends the agent caller; the applicant's phone rings; they answer; the AI
   talks (the mock); HR follows the transcript; the applicant holds, transfers to an extension the
   scenario lists as out, hangs up and submits the note; the call log has the transcript and recording. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const PASS = process.env.PASS || 'test-pass';
const shots = process.env.SHOTS || __dirname;
const step = (m) => console.log('•', m);

async function main() {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const hr = await (await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } })).newPage();
  hr.on('pageerror', (e) => console.log('HR page error:', e.message));
  await hr.goto(BASE + '/admin');
  await hr.fill('#hrName', 'Recruiter Two');
  await hr.fill('#hrPass', PASS);
  await hr.click('#hrForm button[type=submit]');
  await hr.waitForSelector('#presence');
  await hr.goto(BASE + '/admin#/applicants');
  await hr.fill('#apName', 'Alex Rivera');
  await hr.click('#addAp button[type=submit]');
  await hr.waitForFunction(() => /Alex Rivera/.test(document.querySelector('#apList').textContent));
  const row = hr.locator('#apList tr', { hasText: 'Alex Rivera' });
  const link = await row.locator('.linkbox input').inputValue();
  const ext = (await row.locator('td.mono').textContent()).trim();

  const ap = await (await browser.newContext({ permissions: ['microphone'] })).newPage();
  ap.on('pageerror', (e) => console.log('Applicant page error:', e.message));
  await ap.goto(link);
  await ap.fill('#apEnterName', 'Alex Rivera');
  await ap.click('#enterForm button[type=submit]');
  await ap.waitForSelector('#kAv');
  step('applicant signed in');

  await hr.goto(BASE + '/admin#/console');
  await hr.waitForSelector(`#presence [data-ext="${ext}"]`);
  await hr.click(`#presence [data-ext="${ext}"]`);
  await hr.fill('#cName', 'Maria Lopez');
  await hr.evaluate(() => { document.querySelector('#aiSetup').open = true; });
  await hr.fill('#persona', 'Maria Lopez, a client checking on her next appointment. Polite but in a hurry. ZEBRA-MARKER');
  await hr.click('#kAi');
  await ap.waitForSelector('#kAns', { timeout: 10000 });
  if (!(await ap.textContent('#screen')).includes('MARIA LOPEZ')) throw new Error('caller ID missing');
  step('agent caller rings the applicant');

  await ap.click('#kAns');
  await ap.waitForFunction(() => /On the call/.test(document.querySelector('#screen').textContent), null, { timeout: 20000 });
  const mock = await (await fetch('http://127.0.0.1:9911/log')).json();
  if (!mock.some((x) => x.token && x.system.includes('ZEBRA-MARKER'))) throw new Error('the persona HR typed did not reach the AI');
  step('applicant answered; the AI got the persona HR typed');

  await hr.waitForFunction(() => /Hi, this is Maria/.test(document.querySelector('#aiList').textContent), null, { timeout: 20000 });
  step('HR follows the transcript live');

  await ap.click('#kHold'); await ap.waitForTimeout(300); await ap.click('#kHold');
  await ap.click('#kTx');
  await ap.click('#transferBox [data-ext="301"]');
  await ap.waitForFunction(() => /no answer|Take the caller back/.test(document.querySelector('#transferBox').textContent) || /On the call/.test(document.querySelector('#screen').textContent), null, { timeout: 10000 });
  await ap.fill('#n_caller', 'Maria Lopez');
  await ap.fill('#n_reason', 'Next appointment date.');
  await hr.waitForFunction(() => /Next appointment date/.test(document.querySelector('#aiList').textContent), null, { timeout: 10000 });
  await hr.screenshot({ path: shots + '/04-hr-agent-follow.png' });
  step('hold, transfer, and HR sees the note');

  await ap.click('#kEnd');
  await ap.waitForSelector('#noteForm button[type=submit]');
  await ap.click('#noteForm button[type=submit]');
  await ap.waitForFunction(() => /note was sent/.test(document.body.textContent));
  step('applicant hung up and submitted the note');

  await hr.goto(BASE + '/admin#/calls');
  await hr.waitForSelector('#callList tr[data-id]');
  await hr.locator('#callList tr', { hasText: 'Alex Rivera' }).first().click();
  await hr.waitForSelector('#loadRec', { timeout: 10000 });
  const page = await hr.textContent('main');
  for (const want of ['Hi, this is Maria', 'Next appointment date.', 'ZEBRA-MARKER']) if (!page.includes(want)) throw new Error('call page is missing: ' + want);
  await hr.screenshot({ path: shots + '/05-hr-agent-call.png', fullPage: true });
  step('call log has the transcript, the note, the persona and the recording');
  await browser.close();
  console.log('PASS');
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
