// MGCHORD: suara preview = piano ASLI (sample) + rantai mixing. Murni Web Audio (tanpa DOM), jadi bisa dirender offline untuk dites (tools/mgchord-audio-test.ts).
//   loadPiano / pianoTone: sample Salamander Grand Piano (Alexander Holm, CC BY 3.0; file di public/samples/piano, tiap 3 nada C2..C7). Nada diambil dari sample terdekat lalu digeser pitch-nya
//              (playbackRate), velocity mengatur volume + kecerahan, nada dilepas dengan damper. Selama sample belum termuat (atau gagal dimuat) dipakai synthTone sebagai cadangan.
//   synthTone: piano sintetis (senar sumbang + spektrum piano + ketukan palu), hanya cadangan.
//   voiceTone: pilihan suara preview = 'piano' (sample asli) / 'pad' (Synth 1: saw hangat, tebal) / 'pluck' (Synth 2: saw cerah, petik pendek).
//   createMaster: low-cut -> EQ halus -> compressor perekat -> limiter -> soft-clip pengaman (tidak pernah pecah), plus reverb ruang kecil (paralel) supaya chord terdengar penuh tanpa tebal / bising.

const waves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();
const samples = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

// ---------- piano sample ----------
const SEMI_NAME: Record<number, string> = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' };   // nama file: C4.mp3, Ds4.mp3, Fs4.mp3, A4.mp3 (Ds = D#, Fs = F#)
/** Nomor MIDI -> nama file (tanpa .mp3) untuk semua sample: C2..C7 tiap 3 nada (21 file). */
export const PIANO_FILES: Map<number, string> = (() => {
  const m = new Map<number, string>();
  for (let oct = 2; oct <= 6; oct++) for (const semi of [0, 3, 6, 9]) m.set(12 * (oct + 1) + semi, SEMI_NAME[semi] + oct);
  m.set(96, 'C7'); return m;
})();

/** Muat semua sample piano ke `c`. `getBytes(namaFile)` mengambil isi file mp3 (di browser: fetch, di tes: baca dari disk). Mengembalikan jumlah sample yang berhasil dimuat; sample yang gagal dilewati. */
export async function loadPiano(c: BaseAudioContext, getBytes: (file: string) => Promise<ArrayBuffer>): Promise<number> {
  const got = new Map<number, AudioBuffer>();
  await Promise.all([...PIANO_FILES].map(async ([midi, file]) => {
    try { got.set(midi, await c.decodeAudioData(await getBytes(file))); } catch { /* satu sample gagal: sisanya tetap dipakai */ }
  }));
  if (got.size) samples.set(c, got);
  return got.size;
}
export const pianoReady = (c: BaseAudioContext): boolean => samples.has(c);

// Satu nada dari sample terdekat (selisih seri paling kecil, seri -> yang lebih rendah), pitch digeser lewat playbackRate
function sampleTone(c: BaseAudioContext, dest: AudioNode, bank: Map<number, AudioBuffer>, midi: number, when: number, dur: number, vel: number): void {
  let key = -1; for (const k of bank.keys()) if (key < 0 || Math.abs(k - midi) < Math.abs(key - midi) || (Math.abs(k - midi) === Math.abs(key - midi) && k < key)) key = k;
  const v = clamp(vel, 0.05, 1), end = when + Math.max(0.08, dur), rel = 0.09 + 0.16 * clamp((72 - midi) / 48, 0, 1);   // damper: nada rendah dilepas lebih lambat
  const src = c.createBufferSource(), lp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = bank.get(key)!; src.playbackRate.value = 2 ** ((midi - key) / 12);
  lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = clamp(440 * 2 ** ((midi - 69) / 12) * (10 + v * 40), 3000, 18000);   // nada pelan sedikit lebih gelap, nada keras cerah
  const peak = SAMPLE_GAIN * (0.18 + 0.82 * v ** 1.3);
  g.gain.setValueAtTime(peak, when); g.gain.setValueAtTime(peak, end); g.gain.setTargetAtTime(0, end, rel);
  src.connect(lp); lp.connect(g); g.connect(dest);
  src.start(when); src.stop(end + rel * 7 + 0.05);
  src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); };
}
const SAMPLE_GAIN = 0.8;   // level sample asli sebelum master: disamakan dengan synth cadangan supaya tidak melompat saat sample selesai dimuat (dikalibrasi lewat tools/mgchord-audio-test.ts)

/** Bunyikan satu nada piano ke `dest`. midi = nomor nada, when = waktu mulai (detik AudioContext), dur = lama tuts ditahan (detik), vel = 0..1. Pakai sample kalau sudah termuat, kalau belum synth cadangan. */
export function pianoTone(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const bank = samples.get(c);
  if (bank) sampleTone(c, dest, bank, midi, when, dur, vel); else synthTone(c, dest, midi, when, dur, vel);
}

// Spektrum satu senar piano: partial n = |sin(n*pi/8)| (palu memukul di 1/8 senar, partial ke-8 / 16 melemah) / n^1.05, dibatasi sebelum aliasing
function waveFor(c: BaseAudioContext, midi: number): PeriodicWave {
  let m = waves.get(c); if (!m) { m = new Map(); waves.set(c, m); }
  let w = m.get(midi); if (w) return w;
  const f = 440 * 2 ** ((midi - 69) / 12), N = clamp(Math.floor(10000 / f), 6, 40);
  const re = new Float32Array(N + 1), im = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) im[n] = (0.15 + 0.85 * Math.abs(Math.sin(Math.PI * n / 8))) / n ** 1.05;
  w = c.createPeriodicWave(re, im); m.set(midi, w); return w;
}
function noiseFor(c: BaseAudioContext): AudioBuffer {
  let b = noises.get(c); if (b) return b;
  b = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
  const d = b.getChannelData(0); let s = 12345;
  for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; }   // noise deterministik (tidak berubah tiap bunyi)
  noises.set(c, b); return b;
}

/** Piano sintetis (cadangan): sama arti parameternya dengan pianoTone. */
function synthTone(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const f = 440 * 2 ** ((midi - 69) / 12), v = clamp(vel, 0.05, 1), end = when + Math.max(0.08, dur);
  const peak = 0.2 * (0.12 + 0.88 * v ** 1.5);
  const tau = Math.max(0.45, 3.2 * 2 ** (-(midi - 36) / 30));          // decay panjang: makin tinggi makin cepat habis
  const rel = 0.07 + 0.11 * clamp((72 - midi) / 48, 0, 1);              // damper: nada rendah dilepas lebih lambat
  const g = c.createGain(), lp = c.createBiquadFilter(), pan = c.createStereoPanner();
  pan.pan.value = clamp((midi - 60) / 40, -0.55, 0.55);
  lp.type = 'lowpass'; lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(clamp(f * (6 + v * 18), 1800, 14000), when);                 // awal cerah (makin keras makin cerah) ...
  lp.frequency.setTargetAtTime(clamp(f * (3 + v * 3), 700, 6000), when + 0.01, 0.45);      // ... lalu menutup jadi hangat
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.setTargetAtTime(peak * 0.38, when + 0.004, 0.2);                                  // tahap 1: jatuh cepat setelah ketukan
  if (end > when + 0.35) g.gain.setTargetAtTime(0.0001, when + 0.35, tau);                 // tahap 2: sustain yang pelan menghilang
  g.gain.setTargetAtTime(0.0001, end, rel);                                                // tuts dilepas
  const detunes = midi < 44 ? [-1.2, 1.2] : [-1.5, 0.2, 1.4], oscs: OscillatorNode[] = [], per = 1 / Math.sqrt(detunes.length);
  const pw = waveFor(c, midi), stop = end + rel * 7 + 0.05;
  detunes.forEach(dt => {
    const o = c.createOscillator(), og = c.createGain();
    o.setPeriodicWave(pw); o.frequency.value = f; o.detune.value = dt; og.gain.value = per;
    o.connect(og); og.connect(lp); o.start(when); o.stop(stop); oscs.push(o);
  });
  lp.connect(g); g.connect(pan); pan.connect(dest);
  // ketukan palu: noise pendek lewat bandpass, tidak ikut filter yang menutup
  const nz = c.createBufferSource(), bp = c.createBiquadFilter(), hg = c.createGain();
  nz.buffer = noiseFor(c); bp.type = 'bandpass'; bp.frequency.value = clamp(f * 3, 700, 5000); bp.Q.value = 0.8;
  const hp = 0.16 * v * v * peak / 0.2;
  hg.gain.setValueAtTime(0.0001, when); hg.gain.linearRampToValueAtTime(hp, when + 0.0015); hg.gain.setTargetAtTime(0.0001, when + 0.0015, 0.012);
  nz.connect(bp); bp.connect(hg); hg.connect(pan); nz.start(when, (midi % 7) * 0.02); nz.stop(when + 0.08);
  oscs[oscs.length - 1].onended = () => { g.disconnect(); lp.disconnect(); pan.disconnect(); hg.disconnect(); };
}

// ---------- synth (dua pilihan suara selain piano) ----------
const DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;   // true hanya di build demo; tanpa import supaya modul ini tetap bisa dites di Node
export type Voice = 'piano' | 'pad' | 'pluck';
export const VOICES: { id: Voice; label: string }[] = [{ id: 'piano', label: 'Piano' }, { id: 'pad', label: 'Pad' }, { id: 'pluck', label: 'Pluck' }];

/** Synth 1 "Pad": tiga saw sumbang halus + sub sine, filter terbuka pelan lalu menghangat, attack lembut, release panjang. Enak untuk chord panjang. */
function padTone(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const f = 440 * 2 ** ((midi - 69) / 12), v = clamp(vel, 0.05, 1), end = when + Math.max(0.15, dur), rel = 0.14 + 0.1 * clamp((72 - midi) / 48, 0, 1);
  const peak = PAD_GAIN * (0.2 + 0.8 * v ** 1.2), atk = 0.035;
  const g = c.createGain(), lp = c.createBiquadFilter(), pan = c.createStereoPanner();
  pan.pan.value = clamp((midi - 60) / 36, -0.5, 0.5);
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(clamp(f * 2.2, 500, 3000), when);                                // mulai agak tertutup ...
  lp.frequency.setTargetAtTime(clamp(f * (4 + v * 5), 1400, 7500), when, 0.25);                // ... membuka pelan, jadi tidak tajam
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + atk);
  g.gain.setTargetAtTime(peak * 0.78, when + atk, 0.5);                                         // sedikit turun ke sustain
  g.gain.setValueAtTime(peak * 0.78, Math.max(end, when + atk + 0.02)); g.gain.setTargetAtTime(0.0001, Math.max(end, when + atk + 0.02), rel);
  const stop = end + rel * 7 + 0.05, oscs: OscillatorNode[] = [];
  [[-9, 'sawtooth', 0.36], [0, 'sawtooth', 0.36], [9, 'sawtooth', 0.36], [0, 'sine', 0.3]].forEach(([dt, type, amp], i) => {
    const o = c.createOscillator(), og = c.createGain();
    o.type = type as OscillatorType; o.frequency.value = i === 3 ? f / 2 : f; o.detune.value = dt as number; og.gain.value = amp as number;
    o.connect(og); og.connect(lp); o.start(when); o.stop(stop); oscs.push(o);
  });
  lp.connect(g); g.connect(pan); pan.connect(dest);
  oscs[oscs.length - 1].onended = () => { g.disconnect(); lp.disconnect(); pan.disconnect(); };
}

/** Synth 2 "Pluck": dua saw + sub kotak, filter menutup cepat (petikan cerah lalu hangat), amplitudo jatuh ke sustain rendah. Enak untuk pola arpeggio / stab. */
function pluckTone(c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void {
  const f = 440 * 2 ** ((midi - 69) / 12), v = clamp(vel, 0.05, 1), end = when + Math.max(0.1, dur), rel = 0.12 + 0.12 * clamp((72 - midi) / 48, 0, 1);
  const peak = PLUCK_GAIN * (0.18 + 0.82 * v ** 1.3);
  const g = c.createGain(), lp = c.createBiquadFilter(), pan = c.createStereoPanner();
  pan.pan.value = clamp((midi - 60) / 30, -0.6, 0.6);
  lp.type = 'lowpass'; lp.Q.value = 2.2;
  lp.frequency.setValueAtTime(clamp(f * (9 + v * 9), 2500, 14000), when);                      // petikan cerah (makin keras makin cerah) ...
  lp.frequency.setTargetAtTime(clamp(f * 2.2, 500, 3500), when + 0.005, 0.16);                 // ... lalu menutup cepat
  g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(peak, when + 0.003);
  g.gain.setTargetAtTime(peak * 0.28, when + 0.003, 0.22);                                      // jatuh ke sustain rendah
  g.gain.setValueAtTime(peak * 0.28, Math.max(end, when + 0.05)); g.gain.setTargetAtTime(0.0001, Math.max(end, when + 0.05), rel);
  const stop = end + rel * 7 + 0.05, oscs: OscillatorNode[] = [];
  [[-7, 'sawtooth', 0.5, 1], [7, 'sawtooth', 0.5, 1], [0, 'square', 0.2, 0.5]].forEach(([dt, type, amp, mul]) => {
    const o = c.createOscillator(), og = c.createGain();
    o.type = type as OscillatorType; o.frequency.value = f * (mul as number); o.detune.value = dt as number; og.gain.value = amp as number;
    o.connect(og); og.connect(lp); o.start(when); o.stop(stop); oscs.push(o);
  });
  lp.connect(g); g.connect(pan); pan.connect(dest);
  oscs[oscs.length - 1].onended = () => { g.disconnect(); lp.disconnect(); pan.disconnect(); };
}
const PAD_GAIN = 0.095, PLUCK_GAIN = 0.14;   // level synth disamakan dengan piano (dikalibrasi lewat tools/mgchord-audio-test.ts)

/** Bunyikan satu nada dengan suara pilihan (piano / pad / pluck). Parameter sama dengan pianoTone. */
export function voiceTone(c: BaseAudioContext, dest: AudioNode, voice: Voice, midi: number, when: number, dur: number, vel: number): void {
  // Build demo: hanya piano. padTone / pluckTone tidak lagi dirujuk, jadi tidak ikut di bundel demo (di Node / build penuh __DEMO__ = false).
  if (!DEMO && voice === 'pad') padTone(c, dest, midi, when, dur, vel);
  else if (!DEMO && voice === 'pluck') pluckTone(c, dest, midi, when, dur, vel);
  else pianoTone(c, dest, midi, when, dur, vel);
}

export interface Master { input: GainNode; tap: AudioNode }

/** Rantai mixing preview: sambungkan semua suara ke `input`; `tap` (setelah soft-clip) cocok untuk analyser waveform. */
export function createMaster(c: BaseAudioContext, dest: AudioNode = c.destination): Master {
  const input = c.createGain(); input.gain.value = 5;   // gain masuk + compressor kuat + limiter: progression ~ -14 dBFS RMS (volume musik biasa), akor 7 nada velocity penuh tetap tidak pecah (diukur lewat tools/mgchord-audio-test.ts)
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.7;                                // buang gemuruh di bawah piano
  const mud = c.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 300; mud.Q.value = 1; mud.gain.value = -1.5;       // kurangi gumam akor
  const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.8; pres.gain.value = 0.8;  // presence: jelas di speaker kecil
  const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 1;                          // udara
  const comp = c.createDynamicsCompressor();                                                                                           // perekat: puncak nada keras dirapikan
  comp.threshold.value = -28; comp.knee.value = 20; comp.ratio.value = 5; comp.attack.value = 0.01; comp.release.value = 0.25;
  const lim = c.createDynamicsCompressor();                                                                                            // limiter
  lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
  const clip = c.createWaveShaper(), curve = new Float32Array(2049);                                                                   // soft-clip pengaman: lurus sampai 0.7, lalu melengkung, tidak pernah lewat ~0.98
  for (let i = 0; i < curve.length; i++) { const x = (i / 1024) - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28)); }
  clip.curve = curve; clip.oversample = '2x';
  input.connect(hp); hp.connect(mud); mud.connect(pres); pres.connect(air); air.connect(comp); comp.connect(lim); lim.connect(clip); clip.connect(dest);
  // reverb ruang kecil, paralel: impuls noise yang meluruh (stereo), bagian bawah dibuang supaya tidak menggumpal
  const len = Math.floor(c.sampleRate * 1.5), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let s = 777 + ch * 91; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 2147483648 - 1) * (1 - i / len) ** 3.2; } }
  const rhp = c.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 280;
  const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 7000;
  const conv = c.createConvolver(); conv.buffer = ir; conv.normalize = true;
  const wet = c.createGain(); wet.gain.value = 0.12;
  comp.connect(rhp); rhp.connect(rlp); rlp.connect(conv); conv.connect(wet); wet.connect(lim);
  return { input, tap: clip };
}
