// SPECTRUM: inti DSP, murni (tanpa DOM / Web Audio) supaya bisa dites di Node (tools/spectrum-test.ts). UI-nya ada di spectrum.ts.
// Tampilan terdiri dari dua bagian yang dihitung terpisah:
//   1) Scope langsung (kanan): bentuk gelombang NYATA beberapa siklus terakhir, jadi "mengikuti frekuensi lagu": nada rendah = gelombang lebar, nada tinggi = rapat.
//        - PitchDetector: periode dominan lewat NSDF (McLeod & Wyvill), puncak dipilih dengan ambang 0,9 x puncak tertinggi (tidak salah turun satu oktaf)
//        - PitchTracker : periode dihaluskan + histeresis (pindah nilai harus bertahan beberapa analisis), jadi jumlah siklus tidak lompat-lompat
//        - TraceBuilder : jendela = N siklus utuh, dikunci ke zero-crossing naik (sub-sample), dipilih yang paling mirip dengan gambar sebelumnya
//                         (kunci fase), jadi gelombang diam di layar, tidak "berlari" atau bergetar. Dikecilkan ke M titik dengan filter kotak (tanpa aliasing).
//   2) Riwayat (kiri): amplitudo per ~6 ms yang bergulir, dengan peredam turun halus (Envelope) dan penguat otomatis (AutoGain).
// Acuan: McLeod & Wyvill 2005 (NSDF), trigger osiloskop dengan histeresis, Catmull-Rom untuk interpolasi.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------- deteksi periode (NSDF) ----------
export interface PitchEst { period: number; clarity: number }   // period dalam sample pada sample rate asli; 0 = tidak ada nada jelas

const DEC = 2;   // decimasi 2x (rata-rata pasangan sample): cukup untuk periode > 24 sample, menghemat 4x kerja
export class PitchDetector {
  private d: Float32Array;
  private nsdf: Float32Array;
  private pre: Float64Array;   // jumlah kumulatif kuadrat, supaya penyebut NSDF O(1) per lag
  constructor(n: number) {
    const m = Math.floor(n / DEC);
    this.d = new Float32Array(m); this.nsdf = new Float32Array((m >> 1) + 2); this.pre = new Float64Array(m + 1);
  }
  detect(x: Float32Array, sr: number): PitchEst {
    const m = this.d.length, d = this.d, pre = this.pre, nsdf = this.nsdf, base = x.length - m * DEC;
    let mean = 0;
    for (let i = 0; i < m; i++) { const v = (x[base + 2 * i] + x[base + 2 * i + 1]) * 0.5; d[i] = v; mean += v; }
    mean /= m;
    pre[0] = 0;
    for (let i = 0; i < m; i++) { d[i] -= mean; pre[i + 1] = pre[i] + d[i] * d[i]; }
    if (pre[m] / m < 1e-8) return { period: 0, clarity: 0 };   // senyap (< -80 dBFS rms)
    const maxLag = Math.min(nsdf.length - 2, Math.floor(sr / 20 / DEC)), minLag = Math.max(2, Math.ceil(sr / 2000 / DEC));   // 20 Hz .. 2 kHz
    for (let t = 0; t <= maxLag + 1; t++) {
      let r = 0;
      for (let i = 0, e = m - t; i < e; i++) r += d[i] * d[i + t];
      const mm = pre[m - t] + (pre[m] - pre[t]);
      nsdf[t] = mm > 1e-12 ? (2 * r) / mm : 0;
    }
    // puncak kunci: puncak tertinggi di tiap lobus positif (setelah lobus pertama di lag 0)
    let t = 1;
    while (t <= maxLag && nsdf[t] > 0) t++;
    const lags: number[] = [], vals: number[] = [];
    let gmax = 0;
    while (t <= maxLag) {
      while (t <= maxLag && nsdf[t] <= 0) t++;
      let pi = -1, pv = -1;
      while (t <= maxLag && nsdf[t] > 0) { if (nsdf[t] > pv) { pv = nsdf[t]; pi = t; } t++; }
      if (pi >= minLag && pv > 0) { lags.push(pi); vals.push(pv); if (pv > gmax) gmax = pv; }
    }
    for (let k = 0; k < lags.length; k++) {
      if (vals[k] < 0.9 * gmax) continue;
      const p = lags[k], a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1], den = a - 2 * b + c;
      const dl = den < -1e-9 ? clamp(0.5 * (a - c) / den, -1, 1) : 0;   // parabola melalui tiga titik: puncak sub-sample
      return { period: (p + dl) * DEC, clarity: clamp(b - 0.25 * (a - c) * dl, 0, 1) };
    }
    return { period: 0, clarity: 0 };
  }
}

// Penghalus hasil deteksi: nilai yang mirip dirata-ratakan pelan; lompat besar (mis. ganti nada, atau salah oktaf sesaat) baru diikuti kalau bertahan.
export class PitchTracker {
  period = 0; clarity = 0;
  private cand = 0; private candN = 0; private miss = 0;
  update(e: PitchEst): void {
    if (e.period > 0 && e.clarity >= 0.55) {
      this.miss = 0;
      if (this.period === 0) { this.period = e.period; this.clarity = e.clarity; this.candN = 0; return; }
      if (Math.abs(e.period / this.period - 1) < 0.04) {
        this.period += (e.period - this.period) * 0.4; this.clarity += (e.clarity - this.clarity) * 0.4; this.candN = 0;
        return;
      }
      if (this.candN > 0 && Math.abs(e.period / this.cand - 1) < 0.04) this.candN++; else { this.cand = e.period; this.candN = 1; }
      if (this.candN >= 3 || (this.candN >= 2 && e.clarity > 0.92)) { this.period = e.period; this.clarity = e.clarity; this.candN = 0; }
    } else {
      this.candN = 0;
      if (++this.miss >= 8) { this.period = 0; this.clarity = 0; } else this.clarity *= 0.9;   // nada hilang: tahan sebentar dulu, lalu lepas
    }
  }
  hz(sr: number): number { return this.period > 0 ? sr / this.period : 0; }
  reset(): void { this.period = 0; this.clarity = 0; this.cand = 0; this.candN = 0; this.miss = 0; }
}

// ---------- scope: jendela N siklus, terkunci fase ----------
export const CYCLES_MAX = 5;
export interface TraceInfo { win: number; cycles: number; peak: number; silent: boolean }

export class TraceBuilder {
  private n: number; private s: Float32Array; private cs: Float64Array; private tmpA: Float32Array; private tmpB: Float32Array;
  constructor(n: number, m: number) {
    this.n = n; this.s = new Float32Array(n); this.cs = new Float64Array(n + 1); this.tmpA = new Float32Array(m); this.tmpB = new Float32Array(m);
  }
  resize(m: number): void { if (this.tmpA.length !== m) { this.tmpA = new Float32Array(m); this.tmpB = new Float32Array(m); } }

  // x = sampel terbaru (terbaru di ujung). out = M titik (amplitudo mentah, DC dibuang). prev = gambar sebelumnya (untuk kunci fase), boleh null.
  build(x: Float32Array, period: number, sr: number, out: Float32Array, prev: Float32Array | null): TraceInfo {
    const n = this.n, m = out.length, s = this.s, cs = this.cs;
    this.resize(m);
    const maxWin = n >> 1;
    let cycles = 0, win: number;
    if (period > 0) { cycles = clamp(Math.floor(maxWin / period), 1, CYCLES_MAX); win = period * cycles; }
    else win = Math.min(maxWin, Math.round(sr * 0.02));   // tanpa nada: jendela tetap 20 ms
    const latest = Math.floor(n - win - 2);
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean /= n;
    cs[0] = 0;
    for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + (x[i] - mean);
    // salinan yang di-lowpass (batas ~3x fundamental) hanya untuk mencari zero-crossing, supaya riak frekuensi tinggi tidak membuat trigger loncat
    const a = period > 0 ? clamp(1 - Math.exp(-2 * Math.PI * (3 / period)), 0.02, 1) : 0.25;
    s[0] = x[0] - mean;
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + a * ((x[i] - mean) - s[i - 1]);
    const search = period > 0 ? Math.ceil(period * 1.25) : 600, lo = Math.max(2, latest - search);
    let pk = 0;
    for (let i = lo; i < Math.min(n, latest + Math.ceil(win)); i++) { const v = Math.abs(s[i]); if (v > pk) pk = v; }
    if (pk < 1e-6 || latest < 4) { out.fill(0); return { win, cycles, peak: 0, silent: true }; }
    const h = 0.05 * pk, gap = Math.max(4, Math.floor(period * 0.25));   // histeresis: sebelum naik melewati 0, sinyal harus pernah turun di bawah -h
    const cands: number[] = [];
    for (let i = latest; i >= lo && cands.length < 6; i--) {
      if (!(s[i - 1] <= 0 && s[i] > 0)) continue;
      let ok = false;
      for (let j = i - 1, e = Math.max(0, i - gap); j >= e; j--) if (s[j] < -h) { ok = true; break; }
      if (!ok) continue;
      const p = (i - 1) + (-s[i - 1]) / (s[i] - s[i - 1]);   // posisi crossing sub-sample
      if (p <= latest) cands.push(p);
    }
    if (!cands.length) cands.push(latest);
    const step = win / (m - 1);
    let bestScore = -2, pn = 0;
    if (prev && prev.length === m) { for (let k = 0; k < m; k++) pn += prev[k] * prev[k]; }
    if (cands.length === 1 || !prev || pn < 1e-12) { this.sample(x, mean, cands[0], step, this.tmpA); this.copy(this.tmpA, out); }   // belum ada gambar sebelumnya: ambil yang terbaru
    else {
      for (let c = 0; c < cands.length; c++) {
        const t = c & 1 ? this.tmpB : this.tmpA;
        this.sample(x, mean, cands[c], step, t);
        let dot = 0, tn = 0;
        for (let k = 0; k < m; k++) { dot += t[k] * prev[k]; tn += t[k] * t[k]; }
        const score = tn > 1e-12 ? dot / Math.sqrt(tn * pn) - 0.002 * c : -1;   // paling mirip dengan gambar sebelumnya; selisih kecil memihak yang terbaru
        if (score > bestScore) { bestScore = score; this.copy(t, out); }
      }
    }
    let peak = 0;
    for (let k = 0; k < m; k++) { const v = Math.abs(out[k]); if (v > peak) peak = v; }
    return { win, cycles, peak, silent: false };
  }
  private copy(src: Float32Array, dst: Float32Array): void { for (let k = 0; k < dst.length; k++) dst[k] = src[k]; }

  // M titik mulai dari p dengan jarak `step` sample. step >= 1,5: rata-rata kotak (anti-aliasing); lebih kecil: interpolasi Catmull-Rom
  private sample(x: Float32Array, mean: number, p: number, step: number, out: Float32Array): void {
    const n = this.n, cs = this.cs, m = out.length;
    const C = (t: number): number => { const tt = clamp(t, 0, n - 1e-9), i = Math.floor(tt); return cs[i] + (tt - i) * (x[i] - mean); };
    const X = (i: number): number => x[clamp(i, 0, n - 1)] - mean;
    if (step >= 1.5) {
      for (let k = 0; k < m; k++) { const c = p + k * step, a = c - step / 2, b = c + step / 2; out[k] = (C(b) - C(a)) / (b - a); }
    } else {
      for (let k = 0; k < m; k++) {
        const c = p + k * step, i = Math.floor(c), f = c - i, y0 = X(i - 1), y1 = X(i), y2 = X(i + 1), y3 = X(i + 2);
        out[k] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      }
    }
  }
}

// ---------- riwayat amplitudo (kiri) ----------
export class Envelope {
  readonly binSec: number; readonly cap: number;
  readonly env: Float32Array; readonly rms: Float32Array;
  private head = 0; private count = 0;
  private binSamples: number; private accMax = 0; private accSq = 0; private accN = 0; private last = 0; private decay: number;
  lastPeak = 0;   // puncak kolom yang selesai pada push terakhir (untuk penguat otomatis)
  constructor(sr: number, binSec = 0.006, histSec = 12, releaseSec = 0.05) {
    this.binSec = binSec; this.cap = Math.ceil(histSec / binSec);
    this.env = new Float32Array(this.cap); this.rms = new Float32Array(this.cap);
    this.binSamples = Math.max(1, Math.round(sr * binSec)); this.decay = Math.exp(-binSec / releaseSec);
  }
  // proses `count` sampel terakhir dari x (terbaru di ujung); mengembalikan banyaknya kolom yang selesai
  push(x: Float32Array, count: number): number {
    const n = Math.min(count, x.length);
    let done = 0; this.lastPeak = 0;
    for (let i = x.length - n; i < x.length; i++) {
      const v = Math.abs(x[i]);
      if (v > this.accMax) this.accMax = v;
      this.accSq += v * v; this.accN++;
      if (this.accN >= this.binSamples) {
        const e = Math.max(this.accMax, this.last * this.decay);   // naik seketika, turun halus (ekor pluck terlihat meluruh)
        this.last = e; this.env[this.head] = e; this.rms[this.head] = Math.sqrt(this.accSq / this.accN);
        if (e > this.lastPeak) this.lastPeak = e;
        this.head = (this.head + 1) % this.cap; if (this.count < this.cap) this.count++;
        this.accMax = 0; this.accSq = 0; this.accN = 0; done++;
      }
    }
    if (done === 0) this.lastPeak = Math.max(this.accMax, this.last * this.decay);
    return done;
  }
  get frac(): number { return this.accN / this.binSamples; }       // 0..1: kemajuan kolom yang sedang terisi (untuk geseran sub-piksel)
  get partial(): number { return Math.max(this.accMax, this.last * this.decay); }
  get partialRms(): number { return this.accN ? Math.sqrt(this.accSq / this.accN) : 0; }
  at(back: number): number { return back < 0 || back >= this.count ? 0 : this.env[(this.head - 1 - back + this.cap * 2) % this.cap]; }
  rmsAt(back: number): number { return back < 0 || back >= this.count ? 0 : this.rms[(this.head - 1 - back + this.cap * 2) % this.cap]; }
  // nilai kontinu di posisi `back` kolom ke belakang (0 = kolom terbaru), interpolasi Catmull-Rom
  cubic(back: number, rms = false): number {
    const f = rms ? (i: number) => this.rmsAt(i) : (i: number) => this.at(i);
    const i = Math.floor(back), t = back - i, y0 = f(i - 1), y1 = f(i), y2 = f(i + 1), y3 = f(i + 2);
    return Math.max(0, y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0))));
  }
  clear(): void { this.env.fill(0); this.rms.fill(0); this.head = 0; this.count = 0; this.accMax = 0; this.accSq = 0; this.accN = 0; this.last = 0; this.lastPeak = 0; }
}

// Penguat otomatis: naik cepat (puncak baru langsung masuk), turun lambat. Gelombang selalu mengisi tinggi layar tanpa terpotong, lagu pelan tetap kelihatan.
export class AutoGain {
  ref: number; private tau: number; private floor: number;
  constructor(tau: number, floor = 0.03) { this.tau = tau; this.floor = floor; this.ref = floor; }
  update(peak: number, dt: number): void {
    if (peak > this.ref) this.ref += (peak - this.ref) * (1 - Math.exp(-dt / 0.04));
    else this.ref = Math.max(this.floor, this.ref * Math.exp(-dt / this.tau));
  }
  get scale(): number { return 0.92 / this.ref; }
  reset(): void { this.ref = this.floor; }
}
// Lengkung tampilan: bagian pelan sedikit diangkat supaya ekor pluck dan detail kecil terlihat; 1 = tinggi penuh
export const shape = (y: number): number => (y <= 0 ? 0 : Math.pow(y > 1 ? 1 : y, 0.8));

// ---------- bantu ----------
export const rmsDb = (x: Float32Array, n = 1024): number => {
  let s = 0; const e = x.length, a = Math.max(0, e - n);
  for (let i = a; i < e; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(s / Math.max(1, e - a)) + 1e-9);
};
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(hz: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(hz / 440), r = Math.round(midi);
  return { name: NOTES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents: Math.round((midi - r) * 100) };
}
