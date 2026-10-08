// Suara plugin Drums: semua disintesis lewat WebAudio (tanpa sample), jadi ringan dan tidak butuh file.
// Pemetaan nada piano roll mengikuti General MIDI: C2 = Kick, D2 = Snare, dst. Nada di luar daftar dibunyikan sebagai Tom bernada.
// Output tiap hit masuk ke jalur track (fader -> efek -> out), jadi Reverb / EQ / volume / mute track ikut berlaku.

import { trackInput } from './audio-engine';
import { velGain } from './velocity';

export interface DrumsParams { on: boolean; level: number; tune: number; decay: number; pads?: Record<string, number> }   // semua 0..1; pads = volume per alat (kunci = DrumPad.id, kosong = 0.8)

export interface DrumPad { id: string; name: string; midi: number }
export const DRUM_KIT: readonly DrumPad[] = [
  { id: 'kick', name: 'Kick', midi: 36 },
  { id: 'snare', name: 'Snare', midi: 38 },
  { id: 'clap', name: 'Clap', midi: 39 },
  { id: 'rim', name: 'Rim', midi: 37 },
  { id: 'chat', name: 'Hat', midi: 42 },
  { id: 'ohat', name: 'Open', midi: 46 },
  { id: 'tom', name: 'Tom', midi: 45 },
  { id: 'crash', name: 'Crash', midi: 49 }
];

// baris alat untuk sebuah nada MIDI (alias GM ikut: 35 -> Kick, 40 -> Snare, 44 -> Hat, 57 -> Crash; lainnya -> Tom)
export const drumRow = (midi: number): number => {
  const i = DRUM_KIT.findIndex(d => d.midi === midi);
  if (i >= 0) return i;
  return midi === 35 ? 0 : midi === 40 ? 1 : midi === 44 ? 4 : midi === 57 ? 7 : 6;
};

export const PAD_DEF = 0.8;
export const padMul = (v: number): number => { const x = Math.max(0, Math.min(1, v)); return x * x / (PAD_DEF * PAD_DEF); };   // 0.8 = 1x (standar), 1.0 = ~1.56x, 0 = senyap

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const drumLevel = (v: number): number => clamp01(v) * clamp01(v) * 1.6;      // 0.8 ≈ 1.0 (level standar, sama dengan Supersaw)
export const drumTuneSemis = (v: number): number => (clamp01(v) - 0.5) * 12;         // -6 .. +6 semiton
export const drumDecayMul = (v: number): number => 0.4 * Math.pow(6.25, clamp01(v)); // 0.4x .. 2.5x (0.5 = 1x)

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ctx, b);
  }
  return b;
}

interface Ctl { ctx: AudioContext; out: AudioNode; t: number; g: number; tune: number; dec: number }

// letusan noise lewat filter + envelope turun eksponensial
function noiseHit(c: Ctl, type: BiquadFilterType, freq: number, q: number, dur: number, gain: number, delay = 0): void {
  const s = c.ctx.createBufferSource(), f = c.ctx.createBiquadFilter(), e = c.ctx.createGain(), t0 = c.t + delay, d = dur * c.dec;
  s.buffer = noise(c.ctx); s.loop = true;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  e.gain.setValueAtTime(gain * c.g, t0);
  e.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
  s.connect(f); f.connect(e); e.connect(c.out);
  s.start(t0, Math.random()); s.stop(t0 + d + 0.02);
  s.onended = () => { s.disconnect(); f.disconnect(); e.disconnect(); };
}

// nada dengan sapuan frekuensi (kick / tom / snare body)
function toneHit(c: Ctl, type: OscillatorType, f0: number, f1: number, sweep: number, dur: number, gain: number): void {
  const o = c.ctx.createOscillator(), e = c.ctx.createGain(), k = Math.pow(2, c.tune / 12), d = dur * c.dec;
  o.type = type;
  o.frequency.setValueAtTime(f0 * k, c.t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * k), c.t + sweep);
  e.gain.setValueAtTime(gain * c.g, c.t);
  e.gain.exponentialRampToValueAtTime(0.0008, c.t + d);
  o.connect(e); e.connect(c.out);
  o.start(c.t); o.stop(c.t + d + 0.02);
  o.onended = () => { o.disconnect(); e.disconnect(); };
}

export function playDrum(ctx: AudioContext, dest: AudioNode, track: string, midi: number, when: number, vel: number | undefined, p: DrumsParams): void {
  if (!p.on) return;
  const out = ctx.createGain(), t = Math.max(when, ctx.currentTime);
  out.gain.value = 1; out.connect(trackInput(ctx, dest, track));
  const c: Ctl = { ctx, out, t, g: drumLevel(p.level) * padMul(p.pads?.[DRUM_KIT[drumRow(midi)].id] ?? PAD_DEF) * velGain(vel) * 0.9, tune: drumTuneSemis(p.tune), dec: drumDecayMul(p.decay) };
  const k = Math.pow(2, c.tune / 12);
  let tail = 0.6;
  switch (midi) {
    case 35: case 36:   // Kick: sapuan sinus turun + klik pendek
      toneHit(c, 'sine', 160, 46, 0.09, 0.45, 1.0);
      noiseHit(c, 'highpass', 3000, 0.7, 0.012, 0.25);
      tail = 0.6; break;
    case 38: case 40:   // Snare: badan segitiga + noise
      toneHit(c, 'triangle', 220, 150, 0.05, 0.14, 0.55);
      noiseHit(c, 'highpass', 1800 * k, 0.8, 0.2, 0.8);
      tail = 0.4; break;
    case 39:            // Clap: tiga letupan noise berurutan + ekor
      noiseHit(c, 'bandpass', 1500 * k, 1.1, 0.02, 0.9, 0);
      noiseHit(c, 'bandpass', 1500 * k, 1.1, 0.02, 0.9, 0.012);
      noiseHit(c, 'bandpass', 1500 * k, 1.1, 0.02, 0.9, 0.024);
      noiseHit(c, 'bandpass', 1400 * k, 1.0, 0.22, 0.7, 0.036);
      tail = 0.45; break;
    case 37:            // Rim: klik nada tinggi pendek
      toneHit(c, 'square', 820, 700, 0.01, 0.035, 0.35);
      noiseHit(c, 'bandpass', 2400 * k, 2, 0.03, 0.5);
      tail = 0.2; break;
    case 42: case 44:   // Hat tertutup
      noiseHit(c, 'highpass', 7500 * k, 0.8, 0.05, 0.55);
      tail = 0.2; break;
    case 46:            // Hat terbuka
      noiseHit(c, 'highpass', 7000 * k, 0.8, 0.32, 0.5);
      tail = 0.7; break;
    case 49: case 57:   // Crash
      noiseHit(c, 'highpass', 5200 * k, 0.6, 1.1, 0.6);
      tail = 1.6; break;
    default: {          // Tom (juga dipakai untuk nada lain): tinggi nada mengikuti MIDI
      const f = 440 * Math.pow(2, (Math.max(36, Math.min(84, midi)) - 69) / 12) * 0.55;
      toneHit(c, 'sine', f * 1.6, f, 0.08, 0.35, 0.9);
      tail = 0.5;
    }
  }
  const end = t + tail * c.dec + 0.1;
  window.setTimeout(() => out.disconnect(), Math.max(200, (end - ctx.currentTime) * 1000));
}
