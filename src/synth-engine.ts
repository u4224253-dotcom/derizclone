// Mesin synth: Supersaw = 7 oscillator sawtooth yang di-detune, disebar di panorama stereo, lalu low-pass + envelope ADSR.
// Output tiap voice masuk ke jalur track (fader -> efek -> out), jadi Reverb / EQ / volume / mute track ikut berlaku.
// Semua parameter 0..1 (sama seperti knob & slider di panel efek); konversi ke satuan nyata lewat fungsi di bawah.

import { trackInput } from './audio-engine';
import { velGain } from './velocity';
import { getMasterPitch, onMasterPitch } from './master-pitch';
import { playDrum, type DrumsParams } from './drums-audio';

export interface SupersawParams {
  on: boolean;
  detune: number; mix: number; level: number; cutoff: number; reso: number;
  attack: number; decay: number; sustain: number; release: number;
}

const params = new Map<string, SupersawParams>();
const drums = new Map<string, DrumsParams>();   // track yang punya plugin Drums: nadanya dibunyikan sebagai hit drum (bukan Supersaw)
export const hasSynth = (track: string): boolean => params.has(track) || drums.has(track);   // Drums ikut dihitung: pattern track-nya dijadwalkan lewat jalur yang sama
export const isDrumsTrack = (track: string): boolean => drums.has(track);
export function setDrums(track: string, p: DrumsParams | null): void {   // null = track ini tidak punya plugin Drums
  if (p) drums.set(track, { ...p }); else drums.delete(track);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const expMap = (v: number, min: number, max: number): number => min * Math.pow(max / min, clamp01(v));

export const detuneCents = (v: number): number => clamp01(v) * 60;          // sebaran detune terjauh, dalam cent
export const levelMul = (v: number): number => clamp01(v) * clamp01(v) * 1.6;   // 0.8 ≈ 1.0 (level standar)
export const cutoffHz = (v: number): number => expMap(v, 80, 18000);
export const resoQ = (v: number): number => 0.6 + clamp01(v) * clamp01(v) * 14;
export const attackSec = (v: number): number => expMap(v, 0.002, 2);
export const decaySec = (v: number): number => expMap(v, 0.01, 2.5);
export const releaseSec = (v: number): number => expMap(v, 0.02, 3);

const pitchCents = (): number => getMasterPitch() * 100;   // Pitch Project (card transport): geser semua voice Supersaw lewat detune
const OFFSETS = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1];       // posisi tiap saw terhadap sebaran detune
const PANS = [-0.9, -0.55, -0.2, 0, 0.2, 0.55, 0.9];
const CENTER = 3;
const VOICE_GAIN = 0.13;                                     // 7 saw dijumlah: dikecilkan supaya tidak clipping
const centerGain = (mix: number): number => 1 - 0.6 * clamp01(mix);
const sideGain = (mix: number): number => 0.15 + 0.85 * clamp01(mix);

export interface Voice {
  track: string; ctx: AudioContext;
  oscs: OscillatorNode[]; gains: GainNode[]; filter: BiquadFilterNode; env: GainNode;
  t0: number; peak: number; a: number; d: number; s: number; r: number;
  released: boolean;
}
const live = new Set<Voice>();
const MAX_VOICES = 28;

export function startVoice(ctx: AudioContext, dest: AudioNode, track: string, midi: number, when: number, vel?: number): Voice | null {
  const dr = drums.get(track);
  if (dr) { playDrum(ctx, dest, track, midi, when, vel, dr); return null; }   // Drums: hit sekali tembak, tidak ada voice yang perlu dilepas
  const p = params.get(track);
  if (!p || !p.on) return null;
  while (live.size >= MAX_VOICES) {   // terlalu banyak voice sekaligus membebani thread audio (7 saw per voice): curi voice yang sudah dilepas / paling lama
    let victim: Voice | null = null;
    for (const x of live) if (!victim || (x.released && !victim.released) || (x.released === victim.released && x.t0 < victim.t0)) victim = x;
    if (!victim) break;
    kill(victim, ctx.currentTime); live.delete(victim);
  }
  const t0 = Math.max(when, ctx.currentTime), f = 440 * Math.pow(2, (midi - 69) / 12);
  const env = ctx.createGain(), filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = cutoffHz(p.cutoff); filter.Q.value = resoQ(p.reso);
  const a = attackSec(p.attack), d = decaySec(p.decay), s = clamp01(p.sustain), r = releaseSec(p.release);
  env.gain.setValueAtTime(0, t0);
  const peak = VOICE_GAIN * levelMul(p.level) * velGain(vel);   // vel kosong = 1: volume tidak berubah
  env.gain.linearRampToValueAtTime(peak, t0 + a);
  env.gain.setTargetAtTime(peak * s, t0 + a, d / 3);
  filter.connect(env); env.connect(trackInput(ctx, dest, track));
  const oscs: OscillatorNode[] = [], gains: GainNode[] = [];
  for (let i = 0; i < OFFSETS.length; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = OFFSETS[i] * detuneCents(p.detune) + pitchCents();
    g.gain.value = i === CENTER ? centerGain(p.mix) : sideGain(p.mix);
    pan.pan.value = PANS[i];
    o.connect(g); g.connect(pan); pan.connect(filter);
    o.start(t0);
    oscs.push(o); gains.push(g);
  }
  const v: Voice = { track, ctx, oscs, gains, filter, env, t0, peak, a, d: Math.max(d, 0.005), s, r, released: false };
  oscs[0].onended = () => {
    oscs.forEach(o => o.disconnect()); gains.forEach(g => g.disconnect()); filter.disconnect(); env.disconnect();
    live.delete(v);
  };
  live.add(v);
  return v;
}

// Lepas voice pada waktu `at`: level envelope pada saat itu dihitung dari rumus (note bisa dilepas sebelum attack / decay selesai).
export function releaseVoice(v: Voice | null, at: number): void {
  if (!v || v.released) return;
  v.released = true;
  const t = Math.max(at, v.t0), dt = t - v.t0;
  const lvl = dt < v.a ? dt / v.a : v.s + (1 - v.s) * Math.exp(-(dt - v.a) / (v.d / 3));
  v.env.gain.cancelScheduledValues(t);
  v.env.gain.setValueAtTime(v.peak * lvl, t);
  v.env.gain.setTargetAtTime(0, t, v.r / 3);
  const end = t + v.r * 2 + 0.05;
  v.oscs.forEach(o => { try { o.stop(end); } catch { /* sudah berhenti */ } });
}

// Nada terjadwal (dari piano roll): mulai di `when`, lepas setelah `dur` detik.
export interface Glide { when: number; from: number; to: number; dur: number }   // meluncur dari MIDI `from` ke `to` mulai `when` (waktu AudioContext) selama `dur` detik
const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export function playNote(ctx: AudioContext, dest: AudioNode, track: string, midi: number, when: number, dur: number, glides?: Glide[], vel?: number): void {
  const v = startVoice(ctx, dest, track, midi, when, vel);
  if (!v) return;
  if (glides) for (const g of glides) {
    const t = Math.max(g.when, v.t0), d = Math.max(0.01, g.dur);
    v.oscs.forEach(o => { o.frequency.setValueAtTime(midiHz(g.from), t); o.frequency.exponentialRampToValueAtTime(midiHz(g.to), t + d); });
  }
  releaseVoice(v, when + Math.max(0.01, dur));
}

function kill(v: Voice, now: number): void {
  v.released = true;
  v.env.gain.cancelScheduledValues(now);
  v.env.gain.setTargetAtTime(0, now, 0.01);
  v.oscs.forEach(o => { try { o.stop(now + 0.08); } catch { /* sudah berhenti */ } });
}

export function stopAllSynth(ctx: AudioContext | null, track?: string): void {
  if (!ctx) return;
  live.forEach(v => { if (!track || v.track === track) kill(v, ctx.currentTime); });
}

// null = track ini bukan track synth (voice yang sedang bunyi dimatikan)
export function setSupersaw(track: string, p: SupersawParams | null): void {
  if (!p) {
    live.forEach(v => { if (v.track === track) kill(v, v.ctx.currentTime); });
    params.delete(track);
    return;
  }
  const wasOn = params.get(track)?.on ?? true;
  params.set(track, { ...p });
  live.forEach(v => {
    if (v.track !== track) return;
    const now = v.ctx.currentTime;
    if (!p.on && wasOn) { kill(v, now); return; }
    v.oscs.forEach((o, i) => o.detune.setTargetAtTime(OFFSETS[i] * detuneCents(p.detune) + pitchCents(), now, 0.02));
    v.gains.forEach((g, i) => g.gain.setTargetAtTime(i === CENTER ? centerGain(p.mix) : sideGain(p.mix), now, 0.02));
    v.filter.frequency.setTargetAtTime(cutoffHz(p.cutoff), now, 0.02);
    v.filter.Q.setTargetAtTime(resoQ(p.reso), now, 0.02);
  });
}

onMasterPitch(() => {   // Pitch Project diputar: voice yang sedang bunyi ikut bergeser mulus
  live.forEach(v => {
    const dc = detuneCents(params.get(v.track)?.detune ?? 0), now = v.ctx.currentTime;
    v.oscs.forEach((o, i) => o.detune.setTargetAtTime(OFFSETS[i] * dc + pitchCents(), now, 0.02));
  });
});
