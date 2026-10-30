/* Phone sounds, all synthesized (no audio files):
     ring()       the applicant's phone ringing (double ring)
     ringback()   what HR hears while it rings (US ringback, 440 + 480 Hz)
     endTone()    three short beeps when a call ends
     dtmf(key)    a keypad tone (HR's dialer)
     holdStream() hold music as a MediaStream track, sent down the line to the caller
   Browsers only play sound after the person has clicked on the page; any click unlocks it. */
(function () {
  'use strict';
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  function ac() {
    if (!ctx) { ctx = new Ctx(); if (window.VoIP && VoIP.Speaker) VoIP.Speaker.register(ctx); }   // 🔊 follows the speaker key
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { try { ac(); } catch (e) {} }, { capture: true, passive: true }));

  function tone(freqs, at, dur, gain, dest, type) {
    const c = ac(), g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.015);
    g.gain.setValueAtTime(gain, Math.max(at + 0.02, at + dur - 0.03));
    g.gain.linearRampToValueAtTime(0, at + dur);
    g.connect(dest);
    freqs.forEach((f) => { const o = c.createOscillator(); o.type = type || 'sine'; o.frequency.value = f; o.connect(g); o.start(at); o.stop(at + dur + 0.05); });
  }

  let loop = null;
  function stop() { if (!loop) return; clearInterval(loop.timer); try { loop.bus.disconnect(); } catch (e) {} loop = null; }
  function play(kind, pattern, freqs, gain) {
    stop();
    let c; try { c = ac(); } catch (e) { return; }
    const bus = c.createGain(); bus.connect(c.destination);
    const period = pattern.reduce((a, [on, off]) => a + on + off, 0);
    let next = c.currentTime + 0.05;
    const schedule = () => { while (next < c.currentTime + period + 0.5) { let t = next; pattern.forEach(([on, off]) => { tone(freqs, t, on, gain, bus); t += on + off; }); next += period; } };
    schedule();
    loop = { kind, bus, timer: setInterval(schedule, 500) };
  }

  const Sounds = {
    unlock: ac,
    ring() { play('ring', [[0.4, 0.2], [0.4, 2.0]], [400, 450], 0.16); },
    ringback() { play('ringback', [[2, 4]], [440, 480], 0.05); },
    stop,
    playing() { return loop ? loop.kind : null; },
    endTone() { try { const c = ac(); for (let i = 0; i < 3; i++) tone([480, 620], c.currentTime + 0.05 + i * 0.5, 0.25, 0.06, c.destination); } catch (e) {} },
    beep() { try { const c = ac(); tone([880], c.currentTime + 0.02, 0.12, 0.05, c.destination); } catch (e) {} },
    // A keypad tone (DTMF), as a desk phone makes when you press a key.
    dtmf(key) {
      const rows = { 1: 697, 2: 697, 3: 697, 4: 770, 5: 770, 6: 770, 7: 852, 8: 852, 9: 852, '*': 941, 0: 941, '#': 941 };
      const cols = { 1: 1209, 4: 1209, 7: 1209, '*': 1209, 2: 1336, 5: 1336, 8: 1336, 0: 1336, 3: 1477, 6: 1477, 9: 1477, '#': 1477 };
      if (!rows[key]) return;
      try { const c = ac(); tone([rows[key], cols[key]], c.currentTime + 0.01, 0.12, 0.035, c.destination); } catch (e) {}
    },
    // Soft looping hold music (C – Am – F – G, arpeggiated) as a track the phone can send.
    holdStream() {
      const c = ac();
      const dest = c.createMediaStreamDestination();
      const bus = c.createGain(); bus.gain.value = 0.9; bus.connect(dest);
      const chords = [[261.6, 329.6, 392.0, 523.3], [220.0, 261.6, 329.6, 440.0], [174.6, 220.0, 261.6, 349.2], [196.0, 246.9, 293.7, 392.0]];
      const beat = 0.3;
      let next = c.currentTime + 0.1, bar = 0;
      const schedule = () => {
        while (next < c.currentTime + 2.5) {
          const ch = chords[bar % chords.length];
          tone([ch[0] / 2], next, beat * 8, 0.05, bus, 'sine');
          [0, 1, 2, 3, 2, 1, 2, 3].forEach((n, i) => tone([ch[n]], next + i * beat, beat * 0.95, 0.07, bus, 'triangle'));
          next += beat * 8; bar++;
        }
      };
      schedule();
      const timer = setInterval(schedule, 800);
      return { stream: dest.stream, track: dest.stream.getAudioTracks()[0], stop() { clearInterval(timer); try { bus.disconnect(); } catch (e) {} } };
    }
  };
  window.Sounds = Sounds;
})();
