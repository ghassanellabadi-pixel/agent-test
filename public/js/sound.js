/* Game-show sounds, synthesised with Web Audio so there are no files to load.
 * Browsers only allow audio after the first tap, so everything is lazy. */
(function (G) {
  'use strict';

  var ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('gor.muted') === '1'; } catch (e) { muted = false; }

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
      } catch (e) {
        return null;
      }
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }

  // One enveloped oscillator note. at/dur in seconds from now.
  function tone(freq, at, dur, type, vol, slideTo) {
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (at || 0);
    var osc = c.createOscillator(), gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function chord(freqs, at, dur, type, vol) {
    freqs.forEach(function (f) { tone(f, at, dur, type, vol); });
  }

  var FX = {
    tick: function () { tone(1250, 0, 0.035, 'square', 0.035); },
    tock: function () { tone(880, 0, 0.07, 'square', 0.09); tone(1760, 0, 0.03, 'sine', 0.05); },
    hint: function () { tone(660, 0, 0.09, 'triangle', 0.14); tone(990, 0.08, 0.14, 'triangle', 0.14); },
    correct: function () { [784, 988, 1319].forEach(function (f, i) { tone(f, i * 0.075, 0.2, 'triangle', 0.22); }); },
    close: function () { tone(523, 0, 0.12, 'sine', 0.18, 620); tone(620, 0.12, 0.14, 'sine', 0.16, 560); },
    wrong: function () { tone(180, 0, 0.22, 'sawtooth', 0.09, 120); },
    join: function () { tone(740, 0, 0.07, 'sine', 0.18); tone(1110, 0.07, 0.1, 'sine', 0.16); },
    reveal: function () {
      [523, 659, 784].forEach(function (f, i) { tone(f, i * 0.09, 0.16, 'triangle', 0.2); });
      chord([523, 659, 784, 1047], 0.3, 0.55, 'triangle', 0.12);
    },
    timeup: function () { tone(330, 0, 0.18, 'square', 0.1); tone(247, 0.2, 0.45, 'square', 0.1); },
    start: function () { [392, 523, 659, 784].forEach(function (f, i) { tone(f, i * 0.07, 0.14, 'triangle', 0.18); }); },
    fanfare: function () {
      var seq = [[523, 0], [523, 0.14], [523, 0.28], [698, 0.42], [880, 0.7], [784, 0.9], [1047, 1.1]];
      seq.forEach(function (n) { tone(n[0], n[1], n[0] === 1047 ? 0.9 : 0.2, 'triangle', 0.2); });
      chord([523, 659, 784], 1.1, 0.9, 'sine', 0.08);
    },
  };

  G.sound = {
    play: function (name) {
      if (muted || !FX[name]) return;
      try { FX[name](); } catch (e) { /* audio is optional */ }
    },
    unlock: function () { if (!muted) ensure(); },
    muted: function () { return muted; },
    setMuted: function (m) {
      muted = !!m;
      try { localStorage.setItem('gor.muted', muted ? '1' : '0'); } catch (e) { /* private mode */ }
      if (!muted) ensure();
    },
  };
})(window.GOR = window.GOR || {});
