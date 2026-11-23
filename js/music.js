/*
 * Soothing background music, generated live in the browser (Web Audio API):
 * slow, soft chords with a little reverb, and scattered piano-like notes.
 * No audio files, nothing to license. Off by default; the 🎵 button toggles it
 * and the choice is remembered. It quietens while a voice recording plays.
 */
(function () {
  "use strict";
  const tools = document.querySelector(".tools");
  if (!tools || !(window.AudioContext || window.webkitAudioContext)) return;

  const btn = document.createElement("button");
  btn.className = "pill-btn"; btn.id = "music-toggle"; btn.innerHTML = "<span>♪</span><span class=\"lb\">Musica</span>";
  btn.title = "Musica di sottofondo"; btn.setAttribute("aria-label", "Musica di sottofondo");
  btn.setAttribute("aria-pressed", "false");
  tools.insertBefore(btn, document.getElementById("zoom-group"));

  const VOLUME = 0.22;
  let ctx = null, master = null, bus = null, playing = false, timer = null, step = 0;

  // C major, slow progression: Cmaj7 – Am7 – Fmaj7 – G6sus
  const CHORDS = [
    [48, 55, 59, 64, 67], [45, 52, 55, 60, 64],
    [41, 48, 52, 57, 60], [43, 50, 55, 57, 62],
  ];
  const MELODY = [72, 74, 76, 79, 81, 84, 79, 76];
  const BAR = 8; // seconds per chord
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    // simple reverb: decaying noise impulse
    const len = ctx.sampleRate * 3.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
    bus = ctx.createGain();
    bus.connect(lp); lp.connect(dry); lp.connect(verb); verb.connect(wet);
    dry.connect(master); wet.connect(master);
  }

  function pad(midi, t, dur) {
    [0, 4].forEach((detune) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = detune ? "triangle" : "sine"; o.frequency.value = hz(midi); o.detune.value = detune;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + dur * 0.35);
      g.gain.linearRampToValueAtTime(0, t + dur * 1.1);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur * 1.15);
    });
  }
  function note(midi, t) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = hz(midi);
    o2.type = "sine"; o2.frequency.value = hz(midi) * 2; // soft overtone
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 3.5);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    o.start(t); o2.start(t); o.stop(t + 3.6); o2.stop(t + 3.6);
  }

  function scheduleBar() {
    const t = ctx.currentTime + 0.1, chord = CHORDS[step % CHORDS.length];
    chord.forEach((m) => pad(m, t, BAR));
    // two to four gentle notes per bar, from the chord and a pentatonic line
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const pool = Math.random() < 0.5 ? chord.map((m) => m + 24) : MELODY;
      note(pool[Math.floor(Math.random() * pool.length)], t + 0.6 + i * (BAR / n) + Math.random() * 0.8);
    }
    step++;
  }

  function fade(to, secs) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(to, t + secs);
  }
  function start() {
    if (!ctx) build();
    ctx.resume();
    playing = true; btn.classList.add("on"); btn.setAttribute("aria-pressed", "true");
    scheduleBar(); timer = setInterval(scheduleBar, BAR * 1000);
    fade(VOLUME, 3);
    try { localStorage.setItem("ft-music", "on"); } catch (e) {}
  }
  function stop() {
    playing = false; btn.classList.remove("on"); btn.setAttribute("aria-pressed", "false");
    clearInterval(timer);
    if (ctx) { fade(0, 1.5); setTimeout(() => { if (!playing) ctx.suspend(); }, 1700); }
    try { localStorage.setItem("ft-music", "off"); } catch (e) {}
  }
  btn.addEventListener("click", () => (playing ? stop() : start()));

  // If the visitor had it on last time, start at their first interaction (browsers block autoplay).
  let wanted = false;
  try { wanted = localStorage.getItem("ft-music") === "on"; } catch (e) {}
  if (wanted) {
    const kick = (e) => {
      if (e.target === btn) return;
      if (!playing) start();
      removeEventListener("pointerdown", kick, true); removeEventListener("keydown", kick, true);
    };
    addEventListener("pointerdown", kick, true); addEventListener("keydown", kick, true);
  }

  // Quieter while a voice recording plays
  document.addEventListener("play", (e) => { if (playing && e.target.tagName === "AUDIO") fade(0.03, 1); }, true);
  ["pause", "ended"].forEach((ev) =>
    document.addEventListener(ev, (e) => { if (playing && e.target.tagName === "AUDIO") fade(VOLUME, 2); }, true));
})();
