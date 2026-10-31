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
  await hr.goto(BASE + '/');
  await hr.fill('#hrName', 'Recruiter Two');
  await hr.fill('#hrPass', PASS);
  await hr.click('#hrForm button[type=submit]');
  await hr.waitForSelector('#presence');
  await hr.goto(BASE + '/#/applicants');
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
  await ap.waitForSelector('#kAnsIdle');
  step('applicant signed in');

  await hr.goto(BASE + '/#/console');
  await hr.waitForSelector(`#presence [data-ext="${ext}"]`);
  await hr.click(`#presence [data-ext="${ext}"]`);
  await hr.selectOption('#scen', '');   // an open call: the AI plays the persona typed below
  await hr.fill('#cName', 'Maria Lopez');
  await hr.evaluate(() => { document.querySelector('#aiSetup').open = true; });
  await hr.fill('#persona', 'Maria Lopez, a client checking on her next appointment. Polite but in a hurry. ZEBRA-MARKER');
  await hr.click('#kAi');
  await ap.waitForSelector('#kAns', { timeout: 10000 });
  if (!(await ap.textContent('#screen')).includes('MARIA LOPEZ')) throw new Error('caller ID missing');
  step('agent caller rings the applicant');
  // While it rings, the phone opens the line to the caller, so there's no wait once it's answered.
  for (let i = 0; i < 50 && !(await (await fetch('http://127.0.0.1:9911/log')).json()).some((x) => x.token); i++) await ap.waitForTimeout(100);
  if (!(await (await fetch('http://127.0.0.1:9911/log')).json()).some((x) => x.token)) throw new Error('the line was not warmed up while ringing');
  step('the line to the caller opened while the phone rang');

  await ap.click('#kAns');
  await ap.waitForFunction(() => /On the call/.test(document.querySelector('#screen').textContent), null, { timeout: 20000 });
  const mock = await (await fetch('http://127.0.0.1:9911/log')).json();
  if (!mock.some((x) => x.token && x.system.includes('ZEBRA-MARKER'))) throw new Error('the persona HR typed did not reach the AI');
  if (mock.filter((x) => x.token).length !== 1) throw new Error('answering should use the warmed line, not open another');
  if (!mock.some((x) => x.token && x.vad.includes('START_SENSITIVITY_HIGH'))) throw new Error('the caller should hear soft voices (sensitive voice detection)');
  if (!mock.some((x) => x.token && x.system.includes('about 5 minutes'))) throw new Error('the caller was not told to keep the call to 5 minutes');
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

  // The applicant asks if there's anything else; the caller says goodbye and the line hangs up by itself.
  await ap.evaluate(() => AiCall.say('Is there anything else I can help you with?'));
  await ap.waitForFunction(() => !AiCall.active(), null, { timeout: 15000 });
  await ap.waitForSelector('#noteForm button[type=submit]');
  await ap.click('#noteForm button[type=submit]');
  await ap.waitForFunction(() => /interview call is complete/.test(document.body.textContent));
  step('the caller said goodbye, the call hung up by itself, and the applicant submitted the note');

  await hr.goto(BASE + '/#/calls');
  await hr.waitForSelector('#callList tr[data-id]');
  await hr.locator('#callList tr', { hasText: 'Alex Rivera' }).first().click();
  await hr.waitForSelector('#loadRec', { timeout: 10000 });
  const page = await hr.textContent('main');
  for (const want of ['Hi, this is Maria', 'Next appointment date.', 'ZEBRA-MARKER', 'Goodbye.', '(goodbye)']) if (!page.includes(want)) throw new Error('call page is missing: ' + want);
  await hr.screenshot({ path: shots + '/05-hr-agent-call.png', fullPage: true });
  step('call log has the transcript, the note, the persona and the recording');

  // 🗑 The admin removes call logs from the list: tick one, Delete selected; then Delete all shown.
  await hr.goto(BASE + '/#/calls');
  await hr.waitForSelector('#callList .sel');
  const before = (await hr.$$('#callList tr[data-id]')).length;
  hr.on('dialog', (d) => d.accept());
  await hr.locator('#callList .sel').first().check();
  await hr.click('#delSel');
  await hr.waitForFunction((n) => document.querySelectorAll('#callList tr[data-id]').length === n - 1 || (n === 1 && /No calls yet/.test(document.querySelector('#callList').textContent)), before);
  if (before > 1) { await hr.click('#delAll'); await hr.waitForFunction(() => /No calls yet/.test(document.querySelector('#callList').textContent)); }
  step('admin deleted call logs (selected, then all shown)');
  await browser.close();
  console.log('PASS');
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
