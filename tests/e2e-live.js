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
  // 🛡 The admin (the passphrase) makes an HR account.
  const adm = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  adm.on('pageerror', (e) => console.log('Admin page error:', e.message));
  await adm.goto(BASE + '/');
  await adm.fill('#hrName', 'Site Admin');
  await adm.fill('#hrPass', PASS);
  await adm.click('#hrForm button[type=submit]');
  await adm.waitForSelector('#nav a[href="#/admin"]');
  await adm.goto(BASE + '/#/admin');
  await adm.fill('#uName', 'Hiring Manager');
  await adm.fill('#uUser', 'hmanager');
  await adm.fill('#uPass', 'interview-pass');
  await adm.click('#hrSave button[type=submit]');
  await adm.waitForSelector('[data-rm="hmanager"]');
  await adm.screenshot({ path: shots + '/00-admin.png' });
  step('admin signed in and made an HR account');

  // The default landing (/) is the HR & Admin sign-in; the applicant's page (/interview) has only their own entry.
  const plain = await (await browser.newContext()).newPage();
  await plain.goto(BASE + '/interview');
  await plain.waitForSelector('#apCode');
  if (await plain.$('#hrForm') || await plain.$('.staff-link')) throw new Error('the applicant page shows the HR & Admin sign-in');
  await plain.screenshot({ path: shots + '/00-main-page.png' });
  await plain.goto(BASE + '/admin');   // an old bookmark
  await plain.waitForSelector('#hrForm');
  if (new URL(plain.url()).pathname !== '/') throw new Error('/admin should forward to the main page');
  if (await plain.$('#apCode') || await plain.$('#apEnterName')) throw new Error('the admin page shows the applicant sign-in');
  await plain.goto(BASE + '/?invite=oldstylecode');   // a link sent before the move
  await plain.waitForSelector('#apEnterName');
  if (new URL(plain.url()).pathname !== '/interview') throw new Error('an old-style link should open /interview');
  await plain.context().close();
  step('/ is the HR & Admin sign-in; /interview is the applicant\'s; /admin and old links forward');

  const ctx = (await browser.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 900 } }));
  const hr = await ctx.newPage();
  hr.on('pageerror', (e) => console.log('HR page error:', e.message));
  await hr.goto(BASE + '/');
  await hr.fill('#hrName', 'hmanager');
  await hr.fill('#hrPass', 'wrong-password');
  await hr.click('#hrForm button[type=submit]');
  await hr.waitForFunction(() => /Incorrect username or password/.test(document.body.textContent));
  await hr.fill('#hrPass', 'interview-pass');
  await hr.click('#hrForm button[type=submit]');
  await hr.waitForSelector('#presence');
  if (await hr.$('#nav a[href="#/admin"]')) throw new Error('an HR account sees 🛡 Admin');
  step('HR signed in with their account (no Admin for HR)');

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
  await ap.waitForSelector('#apEnterName');
  if (new URL(ap.url()).search) throw new Error('the invite code stayed in the address bar');
  await ap.screenshot({ path: shots + '/00-applicant-name.png' });
  await ap.fill('#apEnterName', 'Jamie Cruz');
  await ap.click('#enterForm button[type=submit]');
  await ap.waitForSelector('#kAv');
  step('applicant opened the link and typed their name');

  // One-time access: the same link, opened again anywhere, doesn't sign in.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await again.fill('#apEnterName', 'Someone Else');
  await again.click('#enterForm button[type=submit]');
  await again.waitForFunction(() => /already used/.test(document.body.textContent));
  await again.context().close();
  await ap.reload();
  await ap.waitForSelector('#kAv');
  step('the link works once; reloading keeps the session');

  await hr.goto(BASE + '/#/console');
  await hr.waitForSelector(`#presence [data-ext="${ext}"]`);
  await hr.click(`#presence [data-ext="${ext}"]`);
  if (!/Record the call: ON/.test(await hr.textContent('#kRec'))) throw new Error('recording should be on by default');
  if ((await hr.inputValue('#scen')) !== 'lsh_intake_scheduling') throw new Error('the console should start on the intake scenario');
  await hr.click('#kCall');
  await ap.waitForSelector('#kAns', { timeout: 10000 });
  if (!(await ap.textContent('#screen')).includes('RACHEL MORGAN')) throw new Error('caller ID missing');
  if (!/Tuesdays and Thursdays/.test(await ap.textContent('#side'))) throw new Error('the applicant should see their briefing');
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

  // ⏺ The record key: pause, the applicant sees it, resume.
  await hr.waitForFunction(() => /● REC/.test(document.querySelector('#screen').textContent));
  await hr.click('#kRec');
  await ap.waitForFunction(() => /RECORDING PAUSED/.test(document.querySelector('#screen').textContent));
  await hr.click('#kRec');
  await ap.waitForFunction(() => /RECORDED/.test(document.querySelector('#screen').textContent) && !/PAUSED/.test(document.querySelector('#screen').textContent));
  step('record key: pause and resume, shown on the applicant phone');

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

  // 📋 The scoring matrix: A–I and J, then save.
  for (const [k, n] of [['A', 5], ['B', 4], ['C', 4], ['D', 4], ['E', 3], ['F', 4], ['G', 5], ['H', 4], ['I', 4], ['J', 4]]) await hr.click(`#scBox .sc-row[data-k="${k}"] [data-n="${n}"]`);
  if (!/4\.11/.test(await hr.textContent('#scBox .sc-avg'))) throw new Error('A–I average should be 4.11');
  await hr.fill('#scBox .sc-rem[data-k="G"]', 'Offered only Tuesday/Thursday slots.');
  await hr.fill('#scNotes', 'Clear greeting, good hold etiquette.');
  await hr.screenshot({ path: shots + '/02b-hr-scorecard.png', fullPage: true });
  await hr.click('#scBox .sc-save');
  await hr.waitForFunction(() => [...document.querySelectorAll('#toast .toast')].some((t) => /Nearly Client-Ready/.test(t.textContent)));
  await hr.goto(BASE + '/#/calls');
  await hr.waitForSelector('#callList tr[data-id]');
  await hr.click('#callList tr[data-id]');
  await hr.waitForSelector('#loadRec');
  await hr.click('#loadRec');
  await hr.waitForSelector('#recBox audio');
  const page = await hr.textContent('main');
  if (!/Nearly Client-Ready/.test(await hr.textContent('#scBox'))) throw new Error('the call page lost the scorecard');
  if ((await hr.inputValue('#scBox .sc-rem[data-k="G"]')) !== 'Offered only Tuesday/Thursday slots.') throw new Error('the remark was not kept');
  for (const want of ['Message to the case manager.', 'Clear greeting', 'Transfers: Attorney (no-answer)']) if (!page.includes(want)) throw new Error('call page is missing: ' + want);
  await hr.screenshot({ path: shots + '/03-hr-call-log.png', fullPage: true });
  step('call log shows the note, the score, the transfer and the recording');

  // Ending the session signs the applicant out; the admin deletes the applicant and their calls.
  await hr.goto(BASE + '/#/applicants');
  hr.once('dialog', (d) => d.accept());
  await hr.click('[data-close]');
  await ap.waitForFunction(() => /session was ended|session has ended/.test(document.body.textContent), null, { timeout: 10000 });
  step('ending the session signs the applicant out');
  await adm.goto(BASE + '/#/applicants');
  adm.once('dialog', (d) => d.accept());
  await adm.click('[data-del]');
  await adm.waitForFunction(() => /No applicants yet/.test(document.querySelector('#apList').textContent));
  step('admin deleted the applicant, their calls and recordings');

  await browser.close();
  console.log('PASS');
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
