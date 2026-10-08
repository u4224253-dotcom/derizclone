// Mesin audio clip: decode file, simpan buffer, gambar waveform sederhana, dan putar sesuai posisi playhead.
// Satu clip di timeline = elemen .pattern dengan data-clip (id buffer) dan data-off (offset dalam detik).

import { deesserLoaded, loadDeesser, createDeesser } from './deesser';
import { createDelay, type DelayParams, type DelayUnit } from './delay-fx';

interface Entry { buf: AudioBuffer; peaks?: Float32Array; chPeaks?: Float32Array[]; max: number; }
const buffers = new Map<number, Entry>();
let seq = 0;

export interface ClipPlacement {
  track: string;
  clip: number;
  startBar: number;
  endBar: number;
  offsetSec: number;
}

export async function decodeFile(ctx: AudioContext, file: File): Promise<AudioBuffer> {
  return ctx.decodeAudioData(await file.arrayBuffer());
}

// Decode file untuk plugin (mis. DERIZ) tanpa AudioContext yang sedang berjalan: OfflineAudioContext tidak butuh gestur pengguna.
export async function decodeStandalone(file: File): Promise<AudioBuffer> {
  const Ctor = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  return new Ctor(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
}

// Puncak (min, max) per "bucket" rata di seluruh durasi; semua channel digabung. Hasil: [min0, max0, min1, max1, ...]
export function bucketPeaks(buf: AudioBuffer, n: number): Float32Array {
  const p = new Float32Array(n * 2), len = buf.length;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let b = 0; b < n; b++) {
      const s0 = Math.floor(b * len / n), s1 = Math.min(len, Math.max(s0 + 1, Math.floor((b + 1) * len / n)));
      let lo = p[b * 2], hi = p[b * 2 + 1];
      for (let i = s0; i < s1; i++) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      p[b * 2] = lo; p[b * 2 + 1] = hi;
    }
  }
  return p;
}

export function addBuffer(buf: AudioBuffer): number {
  buffers.set(++seq, { buf, max: 0 });
  return seq;
}

export const getBuffer = (id: number): AudioBuffer | undefined => buffers.get(id)?.buf;

// AudioBuffer -> WAV 16-bit PCM (dipakai untuk menyimpan audio clip ke file project)
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({length: ch}, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i]));
    out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([out.buffer], {type: 'audio/wav'});
}

export const bufferDuration = (id: number): number => buffers.get(id)?.buf.duration ?? 0;

// ---------- waveform (sementara: bentuk gelombang polos, bisa diganti nanti) ----------
const PPS = 100;          // jumlah "bucket" puncak per detik audio
const WAVE_COLS = 1200;   // kolom maksimum yang digambar per clip

function peaksOf(e: Entry): Float32Array {
  if (e.peaks) return e.peaks;
  const { buf } = e, n = Math.max(1, Math.ceil(buf.duration * PPS)), p = new Float32Array(n * 2);
  const sr = buf.sampleRate, per: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c), q = new Float32Array(n * 2);   // q: puncak channel ini saja (untuk mode dua batang stereo)
    for (let b = 0; b < n; b++) {
      const s0 = Math.floor(b * sr / PPS), s1 = Math.min(d.length, Math.floor((b + 1) * sr / PPS));
      let lo = 0, hi = 0;
      for (let i = s0; i < s1; i++) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      q[b * 2] = lo; q[b * 2 + 1] = hi;
      if (lo < p[b * 2]) p[b * 2] = lo;
      if (hi > p[b * 2 + 1]) p[b * 2 + 1] = hi;
    }
    per.push(q);
  }
  let m = 0;
  for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i]));
  e.peaks = p; e.chPeaks = per; e.max = m;
  return p;
}

const SVGNS = 'http://www.w3.org/2000/svg';

export function renderWave(el: HTMLElement, clipId: number, offSec: number, durSec: number): void {
  const e = buffers.get(clipId);
  if (!e || durSec <= 0) return;
  let host = el.querySelector<HTMLElement>('.pattern__wave');
  if (!host) {
    host = document.createElement('div');
    host.className = 'pattern__wave';
    el.insertBefore(host, el.querySelector('.pattern__handle'));
  }
  const audioSec = Math.min(durSec, e.buf.duration - offSec);
  if (audioSec <= 0) { host.textContent = ''; return; }
  const merged = peaksOf(e), n = merged.length / 2;
  const stereo = document.documentElement.dataset.wfmode === 'stereo';   // Pengaturan > Waveform audio clip: 1 batang (semua channel digabung) / 2 batang (L atas, R bawah)
  const b0 = offSec * PPS, b1 = (offSec + audioSec) * PPS;
  const cols = Math.max(1, Math.min(WAVE_COLS, Math.ceil(b1 - b0)));
  const span = 1000 * (audioSec / durSec), norm = 0.92 / Math.max(e.max, 0.05);
  // satu batang gelombang di pita vertikal [cy - half, cy + half] (satuan viewBox 0..100); mengembalikan subpath tertutup
  const band = (p: Float32Array, cy: number, half: number): string => {
    const top: string[] = [], bot: string[] = [];
    for (let i = 0; i < cols; i++) {
      const lo = Math.min(n - 1, Math.floor(b0 + i * (b1 - b0) / cols));
      const hi = Math.min(n, Math.max(lo + 1, Math.ceil(b0 + (i + 1) * (b1 - b0) / cols)));
      let mn = 0, mx = 0;
      for (let b = lo; b < hi; b++) { if (p[b * 2] < mn) mn = p[b * 2]; if (p[b * 2 + 1] > mx) mx = p[b * 2 + 1]; }
      let yt = cy - mx * norm * half, yb = cy - mn * norm * half;
      if (yb - yt < 1) { yt -= .5; yb += .5; }
      const x = ((i + .5) / cols * span).toFixed(2);
      top.push(x + ' ' + yt.toFixed(1)); bot.push(x + ' ' + yb.toFixed(1));
    }
    return 'M' + top.join('L') + 'L' + bot.reverse().join('L') + 'Z';
  };
  let d: string;
  if (stereo) {
    const L = e.chPeaks![0], R = e.chPeaks![1] ?? L;   // file mono: kedua batang sama
    d = band(L, 25, 23.5) + band(R, 75, 23.5);
  } else d = band(merged, 50, 48);
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  host.replaceChildren(svg);
}

// ---------- playback ----------
const volumes = new Map<string, number>();       // persen per track (slider volume: 0-150, 100 = default)
const gains = new Map<string, GainNode>();
const active = new Set<{ src: AudioBufferSourceNode; env: GainNode; track: string }>();
const pctToLin = (pct: number) => pct / 100;   // 100% = gain 1.0 (tanpa perubahan), 150% = boost x1.5

const muted = new Set<string>();                  // track yang dimatikan lewat switch on/off di header track
export function setTrackMuted(track: string, off: boolean): void {
  if (off) muted.add(track); else muted.delete(track);
  const o = dests.get(track) as GainNode | undefined;   // `out` track: meter level ikut turun ke nol saat mati
  if (o) o.gain.setTargetAtTime(off ? 0 : 1, o.context.currentTime, .015);
}

export function setTrackVolume(track: string, pct: number): void {
  volumes.set(track, pct);
  const g = gains.get(track);
  if (g) g.gain.setTargetAtTime(pctToLin(pct), g.context.currentTime, .02);
}

export function trackInput(ctx: AudioContext, dest: AudioNode, track: string): GainNode {   // titik masuk jalur track (fader -> efek -> out); dipakai juga oleh synth
  return trackGain(ctx, dest, track);
}

function trackGain(ctx: AudioContext, dest: AudioNode, track: string): GainNode {
  let g = gains.get(track);
  if (!g || g.context !== ctx) {
    g = ctx.createGain();
    g.gain.value = pctToLin(volumes.get(track) ?? 100);
    // titik akhir jalur track: semua efek bermuara ke `out`, lalu ke master. Meter level membaca dari sini (setelah fader + efek).
    const out = ctx.createGain();
    out.gain.value = muted.has(track) ? 0 : 1;
    out.connect(dest);
    g.connect(out);
    gains.set(track, g);
    dests.set(track, out);
    makeMeter(ctx, track, out);
    syncFx(track);   // track ini sudah punya kartu efek sebelum pernah diputar
  }
  return g;
}

// ---------- meter level stereo per track ----------
interface Meter { ctx: BaseAudioContext; l: AnalyserNode; r: AnalyserNode; bufL: Float32Array<ArrayBuffer>; bufR: Float32Array<ArrayBuffer>; }
const meters = new Map<string, Meter>();

function makeMeter(ctx: BaseAudioContext, track: string, from: AudioNode): void {
  const split = ctx.createChannelSplitter(2), l = ctx.createAnalyser(), r = ctx.createAnalyser(), mute = ctx.createGain();
  l.fftSize = r.fftSize = 1024; l.smoothingTimeConstant = r.smoothingTimeConstant = 0;
  mute.gain.value = 0; mute.connect(ctx.destination);   // sambungan senyap: beberapa browser baru memproses node yang tersambung ke output
  from.connect(split); split.connect(l, 0); split.connect(r, 1); l.connect(mute); r.connect(mute);
  meters.set(track, { ctx, l, r, bufL: new Float32Array(l.fftSize), bufR: new Float32Array(r.fftSize) });
}

const peakOf = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number => {
  a.getFloatTimeDomainData(buf);
  let m = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
  return m;
};

// Level puncak [kiri, kanan] track ini, 0..1 linear (0 = senyap / track belum pernah diputar).
export function trackLevels(track: string): [number, number] {
  const m = meters.get(track);
  return m ? [peakOf(m.l, m.bufL), peakOf(m.r, m.bufR)] : [0, 0];
}

// ---------- effect per track: equalizer -> filter -> reverb ----------
// Jalur: gain track -> [EQ: low shelf -> low-mid -> mid -> high-mid peaking -> high shelf -> output] -> [Filter: low-pass -> high-pass] -> [Delay: delay-fx.ts] -> dry -> output, dan -> convolver -> wet -> output (reverb).
// Mix reverb memakai crossfade equal-power. Urutan di jalur audio selalu EQ, Filter, Delay, lalu reverb (tidak tergantung urutan card).
export interface ReverbParams { on: boolean; mix: number; size: number; pre?: number; tone?: number; low?: number }   // mix 0..1, size 0..1 (-> gema 0,4 s .. 5 s); pre = pre-delay, tone = peredam treble gema, low = potong bass gema (kosong = bawaan, suara sama seperti sebelum knob ini ada)
export const reverbPreSec = (v: number): number => 0.2 * Math.max(0, Math.min(1, v));                                   // pre-delay 0 .. 200 ms
export const reverbToneHz = (v: number): number => 1500 * Math.pow(20000 / 1500, Math.max(0, Math.min(1, v)));          // tone: 1,5 kHz .. 20 kHz (log); 1 = terbuka
export const reverbLowHz = (v: number): number => 20 * Math.pow(50, Math.max(0, Math.min(1, v)));                       // low cut: 20 Hz .. 1 kHz (log); 0 = mati
const reverbs = new Map<string, ReverbParams>();
const dests = new Map<string, AudioNode>();
export interface EqParams { on: boolean; v: Record<string, number> }   // semua nilai 0..1: gain per band (key band, 0,5 = 0 dB), <band>F = frekuensi, <band>Q = lebar (hanya band peaking), out = level akhir
const eqs = new Map<string, EqParams>();
// Filter ala DJ: satu knob Cutoff. Tengah = bypass, ke kiri = low-pass (makin kiri makin gelap), ke kanan = high-pass (makin kanan makin tipis).
export interface FilterParams { on: boolean; cutoff: number; reso: number }   // cutoff 0..1 (0,5 = bypass), reso 0..1
const filters = new Map<string, FilterParams>();
const FILTER_DEAD = 0.03;   // zona mati di sekitar tengah knob: benar-benar bypass
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const filterMode = (cutoff: number): 'off' | 'lp' | 'hp' => { const d = clamp01(cutoff) - 0.5; return Math.abs(d) * 2 < FILTER_DEAD ? 'off' : d < 0 ? 'lp' : 'hp'; };
// frekuensi potong (Hz): low-pass 20 kHz -> 80 Hz ke arah kiri, high-pass 20 Hz -> 8 kHz ke arah kanan (skala log)
export const filterHz = (cutoff: number): number => {
  const x = Math.abs(clamp01(cutoff) - 0.5) * 2, m = filterMode(cutoff);
  return m === 'lp' ? 20000 * Math.pow(80 / 20000, x) : m === 'hp' ? 20 * Math.pow(8000 / 20, x) : 0;
};
export const filterQ = (reso: number): number => 0.707 + clamp01(reso) * 11.3;   // 0.707 (datar) .. 12 (resonansi tajam)
export const EQ_RANGE_DB = 12;   // knob penuh = ±12 dB
export const eqDb = (v: number): number => (Math.max(0, Math.min(1, v)) - 0.5) * 2 * EQ_RANGE_DB;
// Equalizer 5 band: Low shelf, Low-Mid / Mid / High-Mid (peaking), High shelf. Tiap band punya jangkauan frekuensi sendiri (skala log) supaya band tidak saling menyeberang jauh.
// Default frekuensi Low / Mid / High sama dengan EQ lama (150 Hz / 1 kHz / 6 kHz, Q 0,8), band baru gain 0 dB, jadi project lama terdengar sama persis.
export interface EqBand { key: string; name: string; short: string; type: 'lowshelf' | 'peaking' | 'highshelf'; lo: number; hi: number; def: number; q: boolean; defQ: number }
export const EQ_BANDS: EqBand[] = [
  { key: 'low', name: 'Low', short: 'LOW', type: 'lowshelf', lo: 20, hi: 500, def: 150, q: false, defQ: 0.7 },
  { key: 'lm', name: 'Low-Mid', short: 'LM', type: 'peaking', lo: 80, hi: 1600, def: 400, q: true, defQ: 1 },
  { key: 'mid', name: 'Mid', short: 'MID', type: 'peaking', lo: 200, hi: 6000, def: 1000, q: true, defQ: 0.8 },
  { key: 'hm', name: 'High-Mid', short: 'HM', type: 'peaking', lo: 800, hi: 12000, def: 3200, q: true, defQ: 1 },
  { key: 'high', name: 'High', short: 'HIGH', type: 'highshelf', lo: 1500, hi: 20000, def: 6000, q: false, defQ: 0.7 },
];
export const eqHz = (b: EqBand, v: number): number => b.lo * Math.pow(b.hi / b.lo, clamp01(v));
export const eqFreqV = (b: EqBand, hz: number): number => clamp01(Math.log(Math.max(b.lo, hz) / b.lo) / Math.log(b.hi / b.lo));
export const eqQ = (v: number): number => 0.3 * Math.pow(8 / 0.3, clamp01(v));   // 0,3 (lebar) .. 8 (sempit), log
export const eqQV = (q: number): number => clamp01(Math.log(Math.max(0.3, q) / 0.3) / Math.log(8 / 0.3));
// De-esser: pereda desis "S" (worklet, lihat deesser.ts). Selalu di awal jalur efek, sebelum EQ / Filter / Reverb, supaya desis tidak ikut diperkeras atau dipantulkan reverb.
export interface DeesserParams { on: boolean; freq: number; thresh: number; amount: number }   // semua 0..1
const deessers = new Map<string, DeesserParams>();
const delays = new Map<string, DelayParams>();   // Delay: parameter lengkap di delay-fx.ts
export const deesserHz = (v: number): number => 3000 * Math.pow(4, clamp01(v));          // 3 kHz .. 12 kHz (log)
export const deesserThr = (v: number): number => -60 + clamp01(v) * 50;                  // -60 .. -10 dB
export const deesserMaxDb = (v: number): number => clamp01(v) * 20;                      // reduksi maksimum 0 .. 20 dB
interface Chain {
  ctx: BaseAudioContext; topo: string; ds: AudioWorkletNode | null; dl: DelayUnit | null;
  low: BiquadFilterNode; lm: BiquadFilterNode; mid: BiquadFilterNode; hm: BiquadFilterNode; high: BiquadFilterNode; eo: GainNode; an: AnalyserNode;
  lp: BiquadFilterNode; hp: BiquadFilterNode;
  dry: GainNode; wet: GainNode; conv: ConvolverNode; pd: DelayNode; rh: BiquadFilterNode; rl: BiquadFilterNode; decay: number;
}
const chains = new Map<string, Chain>();

export const reverbSeconds = (size: number): number => Math.round((0.4 + Math.max(0, Math.min(1, size)) * 4.6) * 10) / 10;

// impuls respons buatan: derau stereo yang meluruh, makin ke ekor makin redup (low-pass satu kutub)
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(seconds * sr)), pre = Math.floor(.012 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    let e = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre), a = 0.65 - 0.5 * t;
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 3);
      e += d[i] * d[i];
    }
    const k = e > 0 ? 1 / Math.sqrt(e) : 0;   // energi impuls dibuat 1, supaya level wet sama untuk ruang kecil maupun besar
    for (let i = pre; i < len; i++) d[i] *= k;
  }
  return buf;
}

function syncFx(track: string): void {
  const g = gains.get(track), dest = dests.get(track), rv = reverbs.get(track), eq = eqs.get(track), fl = filters.get(track), ds = deessers.get(track), dly = delays.get(track);
  if (!g || !dest) return;                       // belum pernah diputar: dipasang saat gain track dibuat
  const ctx = g.context;
  let ch = chains.get(track);
  if (ds && !deesserLoaded(ctx)) loadDeesser(ctx).then(() => syncFx(track), () => { /* worklet gagal dimuat: jalur jalan tanpa de-esser */ });
  const dsOn = !!ds && deesserLoaded(ctx);      // node baru dipasang setelah modul worklet siap (beberapa ms)
  if (!rv && !eq && !fl && !dsOn && !dly) {              // semua card efek dihapus: kembali ke jalur langsung
    if (ch) {
      g.disconnect(); [ch.low, ch.lm, ch.mid, ch.hm, ch.high, ch.eo, ch.lp, ch.hp, ch.dry, ch.wet, ch.conv, ch.pd, ch.rh, ch.rl].forEach(n => n.disconnect());
      if (ch.ds) ch.ds.disconnect();
      if (ch.dl) { ch.dl.output.disconnect(); ch.dl.dispose(); ch.dl = null; }
      g.connect(dest); chains.delete(track);
    }
    return;
  }
  if (!ch || ch.ctx !== ctx) {
    const [low, lm, mid, hm, high] = EQ_BANDS.map(b => { const n = ctx.createBiquadFilter(); n.type = b.type; n.frequency.value = b.def; if (b.q) n.Q.value = b.defQ; return n; });
    const eo = ctx.createGain();
    const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.82; an.minDecibels = -110; an.maxDecibels = -10;   // spektrum untuk grafik Equalizer
    const lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.707;
    hp.type = 'highpass'; hp.frequency.value = 20; hp.Q.value = 0.707;
    const conv = ctx.createConvolver();
    conv.normalize = false;   // normalisasi dilakukan sendiri di makeImpulse
    const pd = ctx.createDelay(0.5), rh = ctx.createBiquadFilter(), rl = ctx.createBiquadFilter();   // pre-delay, low cut (high-pass), tone (low-pass): hanya di jalur wet
    rh.type = 'highpass'; rh.frequency.value = 20; rh.Q.value = 0.707;
    rl.type = 'lowpass'; rl.frequency.value = 20000; rl.Q.value = 0.707;
    ch = { ctx, topo: '', ds: null, dl: null, low, lm, mid, hm, high, eo, an, lp, hp, dry: ctx.createGain(), wet: ctx.createGain(), conv, pd, rh, rl, decay: 0 };
    chains.set(track, ch);
  }
  if (dsOn && ds && !ch.ds) ch.ds = createDeesser(ctx, { fc: deesserHz(ds.freq), thr: deesserThr(ds.thresh), max: deesserMaxDb(ds.amount), on: ds.on });
  if (dly && !ch.dl) ch.dl = createDelay(ctx);
  if (!dly && ch.dl) { ch.dl.output.disconnect(); ch.dl.dispose(); ch.dl = null; ch.topo = ''; }
  const topo = (dsOn ? 'd' : '-') + (eq ? 'e' : '-') + (fl ? 'f' : '-') + (dly ? 'y' : '-') + (rv ? 'r' : '-');
  if (topo !== ch.topo) {                        // susun ulang jalur sesuai efek yang ada
    g.disconnect(); [ch.low, ch.lm, ch.mid, ch.hm, ch.high, ch.eo, ch.lp, ch.hp, ch.dry, ch.wet, ch.conv, ch.pd, ch.rh, ch.rl].forEach(n => n.disconnect());
    if (ch.ds) { ch.ds.disconnect(); if (!dsOn) ch.ds = null; }
    if (ch.dl) ch.dl.output.disconnect();
    let s: AudioNode = g;
    if (dsOn && ch.ds) { s.connect(ch.ds); s = ch.ds; }
    if (eq) { s.connect(ch.low); ch.low.connect(ch.lm); ch.lm.connect(ch.mid); ch.mid.connect(ch.hm); ch.hm.connect(ch.high); ch.high.connect(ch.eo); ch.eo.connect(ch.an); s = ch.eo; }
    if (fl) { s.connect(ch.lp); ch.lp.connect(ch.hp); s = ch.hp; }
    if (dly && ch.dl) { s.connect(ch.dl.input); s = ch.dl.output; }
    if (rv) { s.connect(ch.dry); ch.dry.connect(dest); s.connect(ch.pd); ch.pd.connect(ch.conv); ch.conv.connect(ch.rh); ch.rh.connect(ch.rl); ch.rl.connect(ch.wet); ch.wet.connect(dest); }
    else s.connect(dest);
    ch.topo = topo;
  }
  const now = ctx.currentTime;
  if (dsOn && ds && ch.ds) ch.ds.port.postMessage({ t: 'p', fc: deesserHz(ds.freq), thr: deesserThr(ds.thresh), max: deesserMaxDb(ds.amount), on: ds.on });
  if (dly && ch.dl) ch.dl.update(dly);
  if (eq) {
    const nodes = [ch.low, ch.lm, ch.mid, ch.hm, ch.high], v = eq.v;
    EQ_BANDS.forEach((b, i) => {
      nodes[i].gain.setTargetAtTime(eq.on ? eqDb(v[b.key] ?? 0.5) : 0, now, .02);
      nodes[i].frequency.setTargetAtTime(eqHz(b, v[b.key + 'F'] ?? eqFreqV(b, b.def)), now, .02);
      if (b.q) nodes[i].Q.setTargetAtTime(eqQ(v[b.key + 'Q'] ?? eqQV(b.defQ)), now, .02);
    });
    ch.eo.gain.setTargetAtTime(eq.on ? Math.pow(10, eqDb(v.out ?? 0.5) / 20) : 1, now, .02);
  }
  if (fl) {   // dua biquad seri: yang tidak aktif dibiarkan di luar jangkauan dengar (20 kHz / 20 Hz), Q datar
    const m = fl.on ? filterMode(fl.cutoff) : 'off', hz = filterHz(fl.cutoff), q = filterQ(fl.reso);
    ch.lp.frequency.setTargetAtTime(m === 'lp' ? hz : 20000, now, .02);
    ch.hp.frequency.setTargetAtTime(m === 'hp' ? hz : 20, now, .02);
    ch.lp.Q.setTargetAtTime(m === 'lp' ? q : 0.707, now, .02);
    ch.hp.Q.setTargetAtTime(m === 'hp' ? q : 0.707, now, .02);
  }
  if (rv) {
    const decay = reverbSeconds(rv.size);
    if (decay !== ch.decay) { ch.conv.buffer = makeImpulse(ctx, decay); ch.decay = decay; }
    const m = rv.on ? Math.max(0, Math.min(1, rv.mix)) : 0;
    ch.dry.gain.setTargetAtTime(Math.cos(m * Math.PI / 2), now, .02);
    ch.wet.gain.setTargetAtTime(Math.sin(m * Math.PI / 2), now, .02);
    ch.pd.delayTime.setTargetAtTime(reverbPreSec(rv.pre ?? 0), now, .03);
    ch.rl.frequency.setTargetAtTime(reverbToneHz(rv.tone ?? 1), now, .02);
    ch.rh.frequency.setTargetAtTime(reverbLowHz(rv.low ?? 0), now, .02);
  }
}

// null = track tidak punya reverb
export function setReverb(track: string, p: ReverbParams | null): void {
  if (p) reverbs.set(track, { ...p }); else reverbs.delete(track);
  syncFx(track);
}

// null = track tidak punya delay
export function setDelay(track: string, p: DelayParams | null): void {
  if (p) delays.set(track, { ...p }); else delays.delete(track);
  syncFx(track);
}

// puncak output Delay track ini [kiri, kanan], linear (0 kalau track tidak punya Delay / belum diputar)
export const delayLevels = (track: string): [number, number] => chains.get(track)?.dl?.levels() ?? [0, 0];

// Spektrum frekuensi (dB per bin FFT) di keluaran EQ track ini, untuk digambar di belakang kurva Equalizer.
// Mengembalikan false kalau track belum punya jalur EQ / belum pernah diputar. Array `out` dipakai ulang tiap frame supaya tidak membuat sampah memori.
export function eqSpectrum(track: string, out: Float32Array): { sr: number } | false {
  const ch = chains.get(track);
  if (!ch || ch.topo[1] !== 'e' || ch.ctx.state !== 'running' || out.length !== ch.an.frequencyBinCount) return false;
  ch.an.getFloatFrequencyData(out as Float32Array<ArrayBuffer>);
  return { sr: ch.ctx.sampleRate };
}
export const EQ_FFT_BINS = 2048;   // = fftSize / 2 (ukuran array untuk eqSpectrum)

// null = track tidak punya de-esser
export function setDeesser(track: string, p: DeesserParams | null): void {
  if (p) deessers.set(track, { ...p }); else deessers.delete(track);
  syncFx(track);
}

// null = track tidak punya equalizer
export function setEq(track: string, p: EqParams | null): void {
  if (p) eqs.set(track, { on: p.on, v: { ...p.v } }); else eqs.delete(track);
  syncFx(track);
}

// null = track tidak punya filter
export function setFilter(track: string, p: FilterParams | null): void {
  if (p) filters.set(track, { ...p }); else filters.delete(track);
  syncFx(track);
}

function release(r: { src: AudioBufferSourceNode; env: GainNode }, now: number): void {
  r.src.onended = null;
  const cur = r.env.gain.value;               // nilai saat ini (bisa sedang di tengah fade-in / fade-out clip)
  r.env.gain.cancelScheduledValues(now);
  r.env.gain.setValueAtTime(cur, now);        // tanpa ini gain loncat balik ke 1 setelah cancel -> klik
  r.env.gain.setTargetAtTime(0, now, .008);   // fade sangat singkat agar tidak ada bunyi "klik"
  try { r.src.stop(now + .06); } catch { /* sudah berhenti */ }
  setTimeout(() => { r.src.disconnect(); r.env.disconnect(); }, 120);
}

export function stopAll(ctx: AudioContext | null): void {
  if (!ctx) return;
  active.forEach(r => release(r, ctx.currentTime));
  active.clear();
}

export function stopTrack(ctx: AudioContext | null, track: string): void {
  if (!ctx) return;
  active.forEach(r => { if (r.track === track) { release(r, ctx.currentTime); active.delete(r); } });
}

const CLIP_FADE_IN = .004, CLIP_FADE_OUT = .006;   // detik; cukup singkat supaya serangan (transien) tidak terasa tumpul

// Jadwalkan semua clip mulai dari posisi `fromBar`; `t0` = waktu AudioContext saat fromBar dimainkan.
export function play(ctx: AudioContext, dest: AudioNode, clips: ClipPlacement[], fromBar: number, secPerBar: number, t0: number): void {
  stopAll(ctx);
  for (const c of clips) {
    const e = buffers.get(c.clip);
    if (!e || c.endBar <= fromBar + 1e-6) continue;
    let when: number, off: number, dur: number;
    if (c.startBar >= fromBar) {
      when = t0 + (c.startBar - fromBar) * secPerBar; off = c.offsetSec; dur = (c.endBar - c.startBar) * secPerBar;
    } else {
      when = t0; off = c.offsetSec + (fromBar - c.startBar) * secPerBar; dur = (c.endBar - fromBar) * secPerBar;
    }
    dur = Math.min(dur, e.buf.duration - off);
    if (dur < .001 || off < 0) continue;
    const src = ctx.createBufferSource(), env = ctx.createGain();
    src.buffer = e.buf;
    src.connect(env); env.connect(trackGain(ctx, dest, c.track));
    // clip dimulai / diakhiri di titik mana pun pada gelombang (offset, potongan, split): tanpa fade terdengar sebagai klik / kresek
    const fin = Math.min(CLIP_FADE_IN, dur / 2), fout = Math.min(CLIP_FADE_OUT, dur / 2), tNow = Math.max(when, ctx.currentTime);
    env.gain.setValueAtTime(0, tNow);
    env.gain.linearRampToValueAtTime(1, tNow + fin);
    if (when + dur - fout > tNow + fin) { env.gain.setValueAtTime(1, when + dur - fout); env.gain.linearRampToValueAtTime(0, when + dur); }
    const rec = { src, env, track: c.track };
    src.onended = () => { active.delete(rec); src.disconnect(); env.disconnect(); };
    active.add(rec);
    src.start(when, off, dur);
  }
}
