// Tampilan Equalizer: grafik respons frekuensi dengan node yang bisa diseret (kiri-kanan = frekuensi, atas-bawah = gain).
// Gaya: panel biru-abu terang, kurva putih halus, node berwarna per band. Nilai tetap 0..1 di fx.v; satuan nyata ada di audio-engine.ts.

import { EQ_BANDS, eqDb, eqHz, eqQ, eqFreqV, eqQV, EQ_RANGE_DB, type EqBand } from './audio-engine';

type V = Record<string, number>;

export const EQ_COLORS = ['#4f86f7', '#25b99a', '#f0a92b', '#ee6a68', '#9b62e3'];
const FMIN = 20, FMAX = 20000, PAD_X = 12, PAD_Y = 16, FS = 48000, NODE_HIT = 22;
const GRID_HZ: Array<[number, string]> = [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const LOGSPAN = Math.log(FMAX / FMIN);

// spektrum frekuensi hidup (dB per bin FFT, dari audio-engine.eqSpectrum), digambar di belakang kurva
export interface EqSpec { db: Float32Array; sr: number }
const SPEC_LO = -96, SPEC_HI = -30, SPEC_TILT = 4.5;   // rentang dB yang ditampilkan; kemiringan +4,5 dB/oktaf supaya spektrum musik tampak seimbang (seperti analyzer pada umumnya)

export const bandOf = (fx: { tab?: number }): number => Math.max(0, Math.min(EQ_BANDS.length - 1, fx.tab ?? 2));   // band terpilih (default Mid); disimpan di fx.tab

// ---------- respons biquad (rumus RBJ, sama dengan filter bawaan browser) ----------
function bandDb(b: EqBand, f0: number, gDb: number, q: number, f: number): number {
  if (Math.abs(gDb) < 1e-4) return 0;
  const A = Math.pow(10, gDb / 40), w0 = 2 * Math.PI * f0 / FS, cs = Math.cos(w0), sn = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (b.type === 'peaking') {
    const al = sn / (2 * q);
    b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
  } else {
    const al = sn / 2 * Math.SQRT2, be = 2 * Math.sqrt(A) * al;   // slope shelf S = 1
    if (b.type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cs + be); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - be);
      a0 = (A + 1) + (A - 1) * cs + be; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - be;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cs + be); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - be);
      a0 = (A + 1) - (A - 1) * cs + be; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - be;
    }
  }
  const w = 2 * Math.PI * f / FS, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export interface BandVals { hz: number; db: number; q: number }
export function bandVals(v: V, b: EqBand): BandVals {
  return { hz: eqHz(b, v[b.key + 'F'] ?? eqFreqV(b, b.def)), db: eqDb(v[b.key] ?? 0.5), q: eqQ(v[b.key + 'Q'] ?? eqQV(b.defQ)) };
}

// ---------- koordinat ----------
const xOf = (hz: number, w: number): number => PAD_X + Math.log(hz / FMIN) / LOGSPAN * (w - 2 * PAD_X);
const yOf = (db: number, h: number): number => h / 2 - db / EQ_RANGE_DB * (h / 2 - PAD_Y);
export const hzAt = (x: number, w: number): number => FMIN * Math.exp(Math.max(0, Math.min(1, (x - PAD_X) / Math.max(1, w - 2 * PAD_X))) * LOGSPAN);
export const dbAt = (y: number, h: number): number => Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, (h / 2 - y) / (h / 2 - PAD_Y) * EQ_RANGE_DB));

// node terdekat dari titik (x, y) dalam px CSS; -1 kalau tidak ada yang cukup dekat. Kalau dua node bertumpuk, yang terpilih dulu menang.
export function hitNode(v: V, w: number, h: number, x: number, y: number, sel: number): number {
  let best = -1, bd = NODE_HIT * NODE_HIT;
  const order = EQ_BANDS.map((_, i) => i).sort((a, b) => (a === sel ? -1 : b === sel ? 1 : 0));
  for (const i of order) {
    const bv = bandVals(v, EQ_BANDS[i]), dx = xOf(bv.hz, w) - x, dy = yOf(bv.db, h) - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------- gambar ----------
// bin FFT -> nilai dB di frekuensi tertentu: antar bin diinterpolasi (bass, bin jarang), di treble beberapa bin per piksel diambil yang terbesar
function specAt(spec: EqSpec, f0: number, f1: number): number {
  const n = spec.db.length, k = n / (spec.sr / 2), b0 = f0 * k, b1 = f1 * k;
  let m: number;
  if (b1 - b0 < 1) {
    const c = (b0 + b1) / 2, i = Math.max(0, Math.min(n - 2, Math.floor(c))), t = Math.max(0, Math.min(1, c - i));
    m = spec.db[i] * (1 - t) + spec.db[i + 1] * t;
  } else {
    m = -Infinity;
    for (let i = Math.max(0, Math.ceil(b0)), e = Math.min(n - 1, Math.floor(b1)); i <= e; i++) if (spec.db[i] > m) m = spec.db[i];
  }
  return Number.isFinite(m) ? m : -200;
}
export function specActive(spec: EqSpec): boolean {   // false kalau semuanya senyap (tidak perlu digambar)
  for (let i = 0; i < spec.db.length; i += 4) if (spec.db[i] > SPEC_LO - 6) return true;
  return false;
}
function paintSpectrum(g: CanvasRenderingContext2D, spec: EqSpec, w: number, h: number): void {
  const x0 = PAD_X, x1 = w - PAD_X, top = 18, base = h, span = base - top;
  const pts: Array<[number, number]> = [];
  for (let x = x0; x <= x1 + 0.1; x += 2) {
    const f0 = hzAt(x - 1, w), f1 = hzAt(x + 1, w), fc = Math.sqrt(f0 * f1);
    const db = specAt(spec, f0, f1) + SPEC_TILT * Math.log2(fc / 1000);
    pts.push([x, base - Math.max(0, Math.min(1, (db - SPEC_LO) / (SPEC_HI - SPEC_LO))) * span]);
  }
  if (pts.length < 2) return;
  const path = (): void => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); } g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
  g.save(); g.beginPath(); g.rect(0, 12, w, h - 12); g.clip();
  path(); g.lineTo(x1, base); g.lineTo(x0, base); g.closePath();
  const fill = g.createLinearGradient(0, top, 0, base); fill.addColorStop(0, 'rgba(70,98,132,.50)'); fill.addColorStop(1, 'rgba(70,98,132,.10)');
  g.fillStyle = fill; g.fill();
  path(); g.lineJoin = 'round'; g.lineWidth = 1.2; g.strokeStyle = 'rgba(58,86,120,.55)'; g.stroke();
  g.restore();
}

export function paintEqCanvas(cv: HTMLCanvasElement, v: V, on: boolean, sel: number, spec?: EqSpec | null): void {
  const r = cv.getBoundingClientRect(), w = r.width, h = r.height; if (w < 10 || h < 10) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3), pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  const g = cv.getContext('2d'); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const zero = yOf(0, h);

  // latar: gradasi biru-abu lembut
  const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#e9f0f7'); bg.addColorStop(1, '#b7c8da');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);

  // grid frekuensi + label di atas
  g.font = '600 9.5px system-ui, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'center';
  const wide = w >= 330;   // grafik sempit: hanya 100 / 1k / 10k yang diberi label supaya tidak bertumpuk
  for (const [hz, label] of GRID_HZ) {
    const x = Math.round(xOf(hz, w)) + .5;
    g.strokeStyle = 'rgba(70,100,135,.16)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 14); g.lineTo(x, h); g.stroke();
    if (wide || hz === 100 || hz === 1000 || hz === 10000) { g.fillStyle = 'rgba(52,78,108,.78)'; g.fillText(label, x, 3); }
  }
  // grid gain: ±6 dan ±12 dB, garis 0 dB lebih tegas
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const db of [12, 6, 0, -6, -12]) {
    const y = Math.round(yOf(db, h)) + .5;
    g.strokeStyle = db === 0 ? 'rgba(52,78,108,.38)' : 'rgba(70,100,135,.14)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    if (db !== 12 && db !== -12) { g.fillStyle = 'rgba(52,78,108,.62)'; g.fillText(db > 0 ? '+' + db : db === 0 ? '0' : '\u2212' + -db, w - 4, y - 7); }
  }

  // spektrum hidup: isi abu-biru lembut yang naik-turun mengikuti audio (satu titik tiap 2 px, skala frekuensi log sama dengan grid)
  if (spec) paintSpectrum(g, spec, w, h);

  // respons per band + total (dalam dB, dijumlahkan)
  const N = Math.max(60, Math.round(w / 3)), vals = EQ_BANDS.map(b => bandVals(v, b));
  const total = new Float32Array(N + 1), one = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const f = FMIN * Math.exp(i / N * LOGSPAN);
    let t = 0;
    EQ_BANDS.forEach((b, k) => { const d = on ? bandDb(b, vals[k].hz, vals[k].db, vals[k].q, f) : 0; t += d; if (k === sel) one[i] = d; });
    total[i] = t;
  }
  const px = (i: number): number => PAD_X + i / N * (w - 2 * PAD_X);
  const curve = (arr: Float32Array): void => { g.beginPath(); for (let i = 0; i <= N; i++) { const y = yOf(Math.max(-EQ_RANGE_DB * 1.4, Math.min(EQ_RANGE_DB * 1.4, arr[i])), h); i ? g.lineTo(px(i), y) : g.moveTo(px(i), y); } };

  // band terpilih: isi tipis berwarna dari garis 0 dB
  g.save(); g.beginPath(); g.rect(0, 12, w, h - 12); g.clip();
  curve(one); g.lineTo(px(N), zero); g.lineTo(px(0), zero); g.closePath();
  g.fillStyle = EQ_COLORS[sel] + '38'; g.fill();
  // kurva total: isi putih memudar + garis putih halus
  const area = g.createLinearGradient(0, 0, 0, h); area.addColorStop(0, 'rgba(255,255,255,.55)'); area.addColorStop(1, 'rgba(255,255,255,.08)');
  curve(total); g.lineTo(px(N), zero); g.lineTo(px(0), zero); g.closePath(); g.fillStyle = area; g.fill();
  curve(total); g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke();
  curve(total); g.lineWidth = 2.2; g.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,.6)'; g.stroke();
  g.restore();

  // node
  vals.forEach((bv, i) => {
    const x = xOf(bv.hz, w), y = yOf(bv.db, h), s = i === sel;
    g.globalAlpha = on ? 1 : .55;
    if (s) { g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fillStyle = EQ_COLORS[i] + '30'; g.fill(); }
    g.beginPath(); g.arc(x, y, s ? 7.5 : 5.5, 0, Math.PI * 2);
    g.fillStyle = EQ_COLORS[i]; g.fill(); g.lineWidth = s ? 2.5 : 2; g.strokeStyle = '#fff'; g.stroke();
    g.globalAlpha = 1;
  });
}

const fmtHzE = (hz: number): string => (hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz' : Math.round(hz) + ' Hz');
const fmtDbE = (db: number): string => (db > 0.049 ? '+' : db < -0.049 ? '\u2212' : '') + Math.abs(db).toFixed(1) + ' dB';

// teks ringkas band terpilih di bawah grafik
export function eqReadout(v: V, sel: number): string {
  const b = EQ_BANDS[sel], bv = bandVals(v, b);
  return `${b.name} \u00b7 ${fmtHzE(bv.hz)} \u00b7 ${fmtDbE(bv.db)}` + (b.q ? ` \u00b7 Q ${bv.q.toFixed(2)}` : '');
}
