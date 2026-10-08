// MPCS (Manual Pitch Correct Sample): inti DSP, murni (tanpa DOM / Web Audio) supaya bisa dites di Node dan nanti diganti WASM tanpa menyentuh UI.
// Alur: analyze() sekali (pitch pYIN + segmentasi nada), lalu render() ulang tiap kali nada diedit.
//   analyze : mono -> kurva pitch per frame (f0) + daftar nada
//             - pYIN: tiap frame menghasilkan beberapa kandidat F0 (bukan satu ambang tetap), HMM + Viterbi memilih jalur yang mulus
//             - segmentasi dengan hysteresis (Schmitt trigger) + envelope energi pendek untuk nada berulang
//   render  : nada yang bersambung dirender sebagai satu rangkaian TD-PSOLA dengan rasio geser yang berubah mulus di zona transisi
//             (tidak ada "tangga" di perbatasan nada); titik pitch dipilih dengan pruning + korelasi lokal, grain ditaruh fraksional
// Acuan: Mauch & Dixon (pYIN), Colotte & Laprie (pitch marking PSOLA), Smuts (hysteresis, metrik evaluasi), DAFx-2023 (dynamic pitch warping).

export interface PitchTrack {
  sr: number;
  hop: number;          // jarak antar frame, dalam sample pada sample rate asli
  f0: Float32Array;     // Hz per frame, 0 = tanpa pitch (napas, konsonan, jeda)
  rms: Float32Array;    // level per frame (0..1) untuk menggambar
  env?: Float32Array;   // envelope energi pendek (~24 ms) per frame, untuk mendeteksi nada berulang (lembah energi)
}
export interface Note {
  s: number; e: number; // frame [s, e)
  midi: number;         // pitch asli (median), nomor MIDI pecahan
  target: number;       // pitch tujuan; selisih dari midi = geseran
  drift?: number;       // 0..1: seberapa banyak variasi lambat (drift) pitch asli dipertahankan; 1 = asli (default), 0 = diratakan ke target
  vib?: number;         // 0..1: seberapa banyak vibrato / variasi cepat dipertahankan; 1 = asli (default), 0 = vibrato dibuang
  man?: boolean;        // target diatur tangan (seret / panah): selalu dikoreksi penuh, tidak ikut knob Center, tidak disentuh snapTargets
}

// Tiga knob global (semua 0..1):
//   center     : seberapa jauh pitch pusat tiap nada ditarik ke targetnya (semiton terdekat). 0 = pitch asli, 1 = tepat di target
//   variation  : sisa variasi alami di dalam nada (drift lambat + vibrato). 1 = asli, 0 = datar (pitch tetap di pusat nada)
//   transition : cara pindah antar nada bersambung. 0.5 = bawaan: luncuran alami penyanyi dipertahankan.
//                ke 0 : luncuran asli dibuang, pindah nada makin tajam (2 ms = lompat robotik)
//                ke 1 : luncuran asli diganti luncuran sintetis yang makin lebar (300 ms = legato panjang)
export interface Controls { center: number; variation: number; transition: number }
export const DEFAULT_CONTROLS: Controls = { center: 0, variation: 1, transition: 0.5 };
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
// lebar zona halus pergantian target (ms): 2 ms (0) -> 45 ms (0.5, nilai lama) -> 300 ms (1), eksponensial supaya terasa rata di seluruh putaran knob
export function transitionMs(t: number): number { t = clamp01(t); return t <= 0.5 ? 2 * 22.5 ** (2 * t) : 45 * (300 / 45) ** (2 * t - 1); }
interface Ctl { center: number; variation: number; glide: number; transMs: number }   // glide: bagian luncuran asli di sambungan yang dipertahankan (1 di Transition 0.5, 0 di kedua ujung knob; kiri linear, kanan kuadratik supaya legato terasa sejak 60-70%)
function resolveCtl(c: Partial<Controls> | undefined, transMs: number): Ctl {
  const t = c?.transition;   // tanpa kontrol = perilaku lama: semua nada dikoreksi penuh, variasi dan luncuran asli utuh
  return { center: clamp01(c?.center ?? 1), variation: clamp01(c?.variation ?? 1), glide: t === undefined ? 1 : clamp01(t) <= 0.5 ? 2 * clamp01(t) : (2 - 2 * clamp01(t)) ** 2, transMs: t === undefined ? transMs : transitionMs(t) };
}

const FMIN = 28, FMAX = 2200;   // 808 / bass sampai synth tinggi (dulu 70-1000 Hz: nada di luar rentang itu tidak pernah terdeteksi)
const midiOf = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const hzOf = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export function toMono(chs: Float32Array[]): Float32Array {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length, out = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) out[i] += c[i] / chs.length;
  return out;
}

function median(a: number[]): number {
  const b = a.slice().sort((p, q) => p - q), m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

// ---------- analisis pitch: pYIN (kandidat banyak + HMM Viterbi), tiga band supaya rentang lebar (28 Hz - 2.2 kHz) tetap akurat ----------
//   band A: sample rate ~22 kHz  -> 110 Hz - 2.2 kHz  (resolusi pitch halus di nada tinggi)
//   band B: sample rate ~5.5 kHz -> 58 - 280 Hz       (jendela ~37 ms: vibrato suara rendah tidak ter-blur)
//   band C: sample rate ~2.8 kHz -> 28 - 75 Hz        (jendela ~80 ms, untuk 808 / bass sub; jarang butuh respons cepat)
const BIN_CENTS = 25;                                                       // resolusi state pitch HMM
const NBIN = Math.ceil(1200 * Math.log2(FMAX / FMIN) / BIN_CENTS) + 1;
const binHz = (b: number): number => FMIN * 2 ** (b * BIN_CENTS / 1200);
const binOf = (hz: number): number => 1200 * Math.log2(hz / FMIN) / BIN_CENTS;
const MAXC = 8;                                                             // kandidat F0 per frame
const JUMP = 6;                                                             // lompatan pitch maksimum antar frame (bin), ~1.5 semiton per ~6 ms
const NTH = 32;                                                             // jumlah ambang pYIN
const MAXV = 40;                                                            // lembah maksimum per tahap per frame

export function analyze(x: Float32Array, sr: number, onProgress?: (p: number) => void): { pt: PitchTrack; notes: Note[] } {
  const d = Math.max(1, Math.round(sr / 24000)), srA = sr / d, n = Math.floor(x.length / d);
  const xs = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let k = 0; k < d; k++) a += x[i * d + k]; xs[i] = a / d; }   // rata-rata d sample = low-pass sederhana
  const hopA = 128, hop = hopA * d;
  interface Band { sig: Float32Array; sr: number; k: number; W: number; tmin: number; tmax: number }
  const band = (k: number, fmin: number, fmax: number, wf: number): Band => {
    let sig = xs;
    if (k > 1) { const m = Math.floor(n / k); sig = new Float32Array(m); for (let i = 0; i < m; i++) { let a = 0; for (let q = 0; q < k; q++) a += xs[i * k + q]; sig[i] = a / k; } }
    const sr2 = srA / k, tmin = Math.max(2, Math.floor(sr2 / fmax)), tmax = Math.ceil(sr2 / fmin);
    return { sig, sr: sr2, k, W: Math.max(wf === 2.5 ? 256 : 0, Math.round(wf * tmax)), tmin, tmax };
  };
  const bands = [band(1, 110, FMAX, 2.5), band(4, 58, 280, 2.2), band(8, FMIN, 75, 2.3)];
  const frames = Math.max(1, Math.floor(n / hopA));
  const f0 = new Float32Array(frames), rms = new Float32Array(frames);

  // 1) level tiap frame
  const RW = Math.max(64, Math.round(0.032 * srA));
  for (let fi = 0; fi < frames; fi++) {
    const st = fi * hopA - (RW >> 1);
    let e = 0;
    for (let j = 0; j < RW; j++) { const v = xs[st + j] ?? 0; e += v * v; }
    rms[fi] = Math.sqrt(e / RW);
  }
  const env = new Float32Array(frames), EW = Math.max(16, Math.round(0.024 * srA));
  for (let fi = 0; fi < frames; fi++) { const st = fi * hopA - (EW >> 1); let e = 0; for (let j = 0; j < EW; j++) { const v = xs[st + j] ?? 0; e += v * v; } env[fi] = Math.sqrt(e / EW); }
  const sorted = Array.from(rms).sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.95)] || 0;
  // gerbang level adaptif: dari lantai noise sample sendiri (persentil 10), dibatasi -48..-28 dB dari bagian terkeras
  const p10 = sorted[Math.floor(sorted.length * 0.10)] || 0;
  const gate = Math.max(0.0004, Math.min(0.04 * ref, Math.max(0.004 * ref, 2.5 * p10)));
  // level acuan LOKAL (maks dalam +-150 ms): nada pelan di sebelah nada keras tidak ikut dianggap "kecil" karena acuan global
  const refLoc = new Float32Array(frames), LR = Math.max(1, Math.round(0.15 * srA / hopA));
  for (let fi = 0; fi < frames; fi++) { let m = 0; for (let k = Math.max(0, fi - LR); k <= Math.min(frames - 1, fi + LR); k++) if (rms[k] > m) m = rms[k]; refLoc[fi] = m; }

  // ambang pYIN: bobot Beta(2,18), kandidat = lembah pertama di bawah tiap ambang
  const TH = new Float64Array(NTH), WT = new Float64Array(NTH);
  { let sum = 0; for (let k = 0; k < NTH; k++) { const s = (k + 0.5) / NTH; TH[k] = s; WT[k] = s * (1 - s) ** 17; sum += WT[k]; } for (let k = 0; k < NTH; k++) WT[k] /= sum; }

  // 2) kandidat F0 + peluang bersuara tiap frame
  const candBin = new Float32Array(frames * MAXC), candP = new Float32Array(frames * MAXC), nCand = new Uint8Array(frames), pvA = new Float32Array(frames);
  const maxTau = Math.max(...bands.map(b => b.tmax)), dif = new Float32Array(maxTau + 2), cm = new Float32Array(maxTau + 2);
  const seg = new Float32Array(Math.max(...bands.map(b => b.W + b.tmax)) + 4);
  const NV = 3 * MAXV + 2, vHz = new Float64Array(NV), vCm = new Float64Array(NV), order = new Int32Array(NV);
  const cHz = new Float64Array(NV), cCm = new Float64Array(NV), pr = new Float64Array(NV), used = new Uint8Array(NV);
  let nv = 0;

  // lembah YIN (cmnd) satu frame di sinyal sig yang berpusat di c; menambah ke vHz / vCm, mengembalikan minimum cmnd
  const valleys = (bd: Band, fi: number): number => {
    const sig = bd.sig, W = bd.W, tauMin = bd.tmin, tauMax = bd.tmax, srX = bd.sr, st = Math.round(fi * hopA / bd.k) - (W >> 1), len = W + tauMax + 1;
    for (let j = 0; j < len; j++) seg[j] = sig[st + j] ?? 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const df = seg[j] - seg[j + tau]; s += df * df; }
      dif[tau] = s;
    }
    let run = 0, minCm = 1, cnt = 0; cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += dif[tau]; cm[tau] = run > 0 ? dif[tau] * tau / run : 1; }
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cm[tau] < minCm) minCm = cm[tau];
      if (cm[tau] < 0.75 && cm[tau] < cm[tau - 1] && cm[tau] <= cm[tau + 1] && cnt < MAXV && nv < NV) {
        const a = cm[tau - 1], b = cm[tau], g = cm[tau + 1], den = a - 2 * b + g;
        const dl = den > 0 ? Math.max(-1, Math.min(1, 0.5 * (a - g) / den)) : 0;   // interpolasi parabola: akurasi di bawah 1 sample
        vHz[nv] = srX / (tau + dl); vCm[nv] = b; nv++; cnt++;
      }
    }
    return minCm;
  };

  for (let fi = 0; fi < frames; fi++) {
    if (rms[fi] > 1e-4) {
      nv = 0;
      let minCm = 1;
      for (const bd of bands) { const m2 = valleys(bd, fi); if (m2 < minCm) minCm = m2; }

      // urut frekuensi menurun (= tau menaik), gabung kandidat kembar antar tahap (dalam 40 sen: ambil yang cmnd lebih rendah; kandidat kembar antar band wajar di zona tumpang-tindih)
      for (let i = 0; i < nv; i++) { let k = i; while (k > 0 && vHz[order[k - 1]] < vHz[i]) { order[k] = order[k - 1]; k--; } order[k] = i; }
      let nc = 0;
      for (let q = 0; q < nv; q++) {
        const i = order[q];
        if (nc > 0 && cHz[nc - 1] / vHz[i] < 1.0234) { if (vCm[i] < cCm[nc - 1]) { cHz[nc - 1] = vHz[i]; cCm[nc - 1] = vCm[i]; } continue; }
        cHz[nc] = vHz[i]; cCm[nc] = vCm[i]; nc++;
      }
      for (let i = 0; i < nc; i++) { pr[i] = 0; used[i] = 0; }
      let pv = 0;
      if (nc > 0) {
        let gi = 0; for (let i = 1; i < nc; i++) if (cCm[i] < cCm[gi]) gi = i;
        for (let k = 0; k < NTH; k++) {
          let hit = -1; for (let i = 0; i < nc; i++) if (cCm[i] < TH[k]) { hit = i; break; }   // lembah pertama (tau terkecil) di bawah ambang
          if (hit >= 0) { pr[hit] += WT[k]; pv += WT[k]; } else { pr[gi] += WT[k] * 0.01; pv += WT[k] * 0.01; }
        }
        for (let i = 0; i < nc; i++) pr[i] += 0.02 * (1 - cCm[i]) ** 4;   // bukti lunak: lembah yang dalam tetap berbobot walau di atas ambang (kasus glide)
        const m = Math.min(MAXC, nc);
        for (let q = 0; q < m; q++) {
          let bi = -1; for (let i = 0; i < nc; i++) if (!used[i] && (bi < 0 || pr[i] > pr[bi])) bi = i;
          used[bi] = 1; candBin[fi * MAXC + q] = binOf(cHz[bi]); candP[fi * MAXC + q] = pr[bi];
        }
        nCand[fi] = m;
      }
      // frame glide / transisi / sample berisik: lembah dangkal (cm 0.3-0.5) tetap bukti periodik, asal energinya cukup (relatif ke level LOKAL)
      const soft = Math.max(0, Math.min(1, (0.75 - minCm) / 0.45)) * Math.max(0, Math.min(1, rms[fi] / (0.1 * refLoc[fi] + 1e-9)));
      pvA[fi] = Math.min(0.98, Math.max(Math.min(1, pv), 0.85 * soft));
    }
    if (onProgress && fi % 200 === 0) onProgress(0.9 * fi / frames);
  }

  // 3) HMM: state = NBIN bin pitch (25 cent) + 1 state tanpa suara, Viterbi
  const lStay = Math.log(0.99), lSwitch = Math.log(0.01), lToV = Math.log(0.01 / NBIN);
  const trW = new Float64Array(JUMP + 1);
  // segitiga dengan PUNCAK 0.99 (bukan massa total 0.99): bertahan di pitch yang sama ~tanpa biaya, sama seperti bertahan di "tanpa suara".
  // Versi lama membagi 0.99 ke 13 bin sehingga tiap frame bersuara kena denda ~2 nat dan jalur bersuara baru menang kalau peluang bersuara > ~0.88
  // -> sample berisik / akustik / reverb dibuang hampir seluruhnya atau terpecah jadi potongan kecil.
  for (let k = 0; k <= JUMP; k++) trW[k] = Math.log(0.99 * (JUMP + 1 - k) / (JUMP + 1));
  const bp = new Uint8Array(frames * NBIN), uBack = new Int16Array(frames);
  let dv: Float64Array = new Float64Array(NBIN), nvv: Float64Array = new Float64Array(NBIN), du = 0;
  const G = new Float64Array(NBIN), SQ2PI = Math.sqrt(2 * Math.PI);
  for (let fi = 0; fi < frames; fi++) {
    const pe = pvA[fi], nc = nCand[fi];
    G.fill(0);
    let ps = 0; for (let q = 0; q < nc; q++) ps += candP[fi * MAXC + q];
    if (nc > 0 && ps > 0) {
      for (let q = 0; q < nc; q++) {
        const bc = candBin[fi * MAXC + q], pw = candP[fi * MAXC + q] / ps / SQ2PI;
        for (let b = Math.max(0, Math.floor(bc) - 3); b <= Math.min(NBIN - 1, Math.ceil(bc) + 3); b++) G[b] += pw * Math.exp(-0.5 * (b - bc) * (b - bc));
      }
    } else G.fill(1 / NBIN);
    const lEu = Math.log(1 - pe + 1e-6);
    // energi tinggi (relatif level lokal) = penyanyi masih bersuara: biaya pindah ke "tanpa suara" dinaikkan (glide / ujung nada tidak gampang kebuang)
    const hot = Math.max(0, Math.min(1, rms[fi] / (0.15 * refLoc[fi] + 1e-9))), lSw = lSwitch - 1.6 * hot;
    for (let b = 0; b < NBIN; b++) G[b] = Math.min(1, 2.5 * G[b]);
    let bestV = -Infinity, bestVi = 0;
    if (fi === 0) {
      for (let b = 0; b < NBIN; b++) { dv[b] = Math.log(pe * (0.9 * G[b] + 0.1 / NBIN) + 1e-12) - Math.log(2 * NBIN); }
      du = lEu - Math.log(2);
    } else {
      for (let b = 0; b < NBIN; b++) if (dv[b] > bestV) { bestV = dv[b]; bestVi = b; }
      const fromU = du + lToV;
      for (let b = 0; b < NBIN; b++) {
        let best = fromU, code = 254;
        for (let dd = -JUMP; dd <= JUMP; dd++) {
          const pb = b - dd; if (pb < 0 || pb >= NBIN) continue;
          const v = dv[pb] + trW[dd < 0 ? -dd : dd];
          if (v > best) { best = v; code = dd + JUMP; }
        }
        nvv[b] = best + Math.log(pe * (0.9 * G[b] + 0.1 / NBIN) + 1e-12);
        bp[fi * NBIN + b] = code;
      }
      const stayU = du + lStay, fromV = bestV + lSw;
      if (stayU >= fromV) { uBack[fi] = -1; du = stayU + lEu; } else { uBack[fi] = bestVi; du = fromV + lEu; }
      const t = dv; dv = nvv; nvv = t;
      let mx = du; for (let b = 0; b < NBIN; b++) if (dv[b] > mx) mx = dv[b];
      du -= mx; for (let b = 0; b < NBIN; b++) dv[b] -= mx;
    }
    if (onProgress && fi % 400 === 0) onProgress(0.9 + 0.1 * fi / frames);
  }
  // telusur balik
  let state = NBIN, bestEnd = du;   // NBIN = state tanpa suara
  for (let b = 0; b < NBIN; b++) if (dv[b] > bestEnd) { bestEnd = dv[b]; state = b; }
  const pathBin = new Int16Array(frames);
  for (let fi = frames - 1; fi >= 0; fi--) {
    pathBin[fi] = state === NBIN ? -1 : state;
    if (fi === 0) break;
    if (state === NBIN) state = uBack[fi] >= 0 ? uBack[fi] : NBIN;
    else { const code = bp[fi * NBIN + state]; state = code === 254 ? NBIN : state - (code - JUMP); }
  }
  for (let fi = 0; fi < frames; fi++) {
    const b = pathBin[fi]; if (b < 0) continue;
    let hz = binHz(b), bd = 2.01;   // haluskan ke kandidat terdekat (resolusi lebih halus dari bin 25 cent)
    for (let q = 0; q < nCand[fi]; q++) { const dd = Math.abs(candBin[fi * MAXC + q] - b); if (dd < bd) { bd = dd; hz = binHz(candBin[fi * MAXC + q]); } }
    f0[fi] = hz;
  }

  // gerbang level: frame yang hampir tenggelam di lantai noise dianggap tanpa pitch
  for (let i = 0; i < frames; i++) if (rms[i] < gate) f0[i] = 0;

  // celah di antara dua bagian bernada ditambal supaya satu nada tidak terputus: <= 3 frame bebas, sampai ~70 ms asal pitch kiri-kanan sama dan energi tidak jatuh dalam
  // (jeda sungguhan antar nada = energi nyaris nol -> tidak ditambal)
  const GAPMAX = Math.max(4, Math.round(0.07 * sr / hop));
  for (let i = 1; i < frames - 1; i++) {
    if (f0[i]) continue;
    let j = i; while (j < frames && !f0[j]) j++;
    if (j < frames && j - i <= GAPMAX && f0[i - 1]) {
      const a = Math.log(f0[i - 1]), b = Math.log(f0[j]), short = j - i <= 3;
      let me = Infinity; for (let k = i; k < j; k++) me = Math.min(me, env[k]);
      const edge = Math.min(env[i - 1], env[j]);
      if (Math.abs(a - b) < (short ? 0.12 : 0.06) && (short || me >= 0.2 * edge)) for (let k = i; k < j; k++) f0[k] = Math.exp(a + (b - a) * (k - i + 1) / (j - i + 1));
    }
    i = j;
  }

  const pt: PitchTrack = { sr, hop, f0, rms, env };
  const notes = segment(pt);
  extendEdges(x, pt, notes);
  return { pt, notes };
}

// ---------- perpanjang tepi nada ke bagian bersuara yang belum terlacak ----------
// Di awal kata (konsonan bersuara, suara serak) dan di ujung nada (rilis), tracker baru "menyala" beberapa frame setelah sinyal sebenarnya sudah periodik. Frame itu
// berada di luar nada sehingga audio aslinya lewat TANPA koreksi, termasuk lonjakan pitch awal kata, lalu di-crossfade ke bagian terkoreksi: itu yang terdengar
// sebagai lonjakan kencang di pergantian kata. Di sini tepi nada digeser sampai ~35 ms ke frame yang masih periodik (autokorelasi di periode nada > 0.7) dan cukup keras.
// Frame konsonan (gesek / letup, tidak periodik) tidak lolos uji ini sehingga tidak ikut dikoreksi.
function extendEdges(x: Float32Array, pt: PitchTrack, notes: Note[]): void {
  const { sr, hop, f0, rms } = pt, frames = f0.length, MAXEXT = Math.max(2, Math.round(0.035 * sr / hop));
  const periodic = (k: number, hzN: number, ref: number): boolean => {
    if (k < 0 || k >= frames || f0[k] > 0 || rms[k] < 0.12 * ref) return false;
    const T = sr / hzN, W = Math.max(Math.round(2 * T), 96), c = Math.round(k * hop), a = c - (W >> 1);
    if (a < 0 || a + W + Math.ceil(T * 1.04) + 2 >= x.length) return false;
    let best = 0;
    for (let lag = Math.floor(T * 0.97); lag <= Math.ceil(T * 1.03); lag++) {
      let sc = 0, e0 = 0, e1 = 0;
      for (let i = 0; i < W; i++) { const p = x[a + i], q = x[a + i + lag]; sc += p * q; e0 += p * p; e1 += q * q; }
      best = Math.max(best, sc / Math.sqrt(e0 * e1 + 1e-12));
    }
    return best > 0.7;
  };
  const order = notes.slice().sort((p, q) => p.s - q.s);
  for (let i = 0; i < order.length; i++) {
    const nt = order[i], hzN = hzOf(nt.midi), prevE = i > 0 ? order[i - 1].e : 0, nextS = i + 1 < order.length ? order[i + 1].s : frames;
    let ref = 0; for (let u = nt.s; u < nt.e; u++) ref = Math.max(ref, rms[u]);
    for (let n = 0; n < MAXEXT && nt.s - 1 >= prevE && periodic(nt.s - 1, hzN, ref); n++) nt.s--;
    for (let n = 0; n < MAXEXT && nt.e < nextS && periodic(nt.e, hzN, ref); n++) nt.e++;
  }
}

// ---------- segmentasi: bagian bernada -> daftar nada ----------
const MINLEN = 6;       // panjang minimum potongan saat memecah
const MINNOTE = 8;      // nada final lebih pendek dari ini (~46 ms) dibuang: biasanya kedip tracker / konsonan, bukan nada
const VALLEY = 0.36;    // rasio lembah/puncak energi (env 24 ms): dip artikulasi 12 dB terukur ~0.32, tremolo 60% ~0.42; di bawah ambang = nada baru
const MERGE_GAP = 12;   // celah (frame, ~70 ms) maksimum antar dua potongan yang masih boleh digabung jadi satu nada

function trimmedMidi(mid: Float32Array, s: number, e: number): number {
  const len = e - s, m = len >= 10 ? Math.floor(len * 0.2) : 0;   // bagian tengah saja: ujung nada sering berisi glide dari / ke nada lain
  const v: number[] = [];
  for (let t = s + m; t < e - m; t++) if (mid[t] > 0) v.push(mid[t]);
  if (!v.length) for (let t = s; t < e; t++) if (mid[t] > 0) v.push(mid[t]);
  return v.length ? median(v) : 0;
}

export function segment(pt: PitchTrack): Note[] {
  const { f0, rms } = pt, frames = f0.length, notes: Note[] = [];
  const mid = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mid[i] = f0[i] ? midiOf(f0[i]) : 0;
  const sm = new Float32Array(frames);   // median 5 frame supaya vibrato tidak memecah nada
  for (let i = 0; i < frames; i++) {
    if (!f0[i]) continue;
    const nb: number[] = []; for (let k = Math.max(0, i - 2); k <= Math.min(frames - 1, i + 2); k++) if (f0[k]) nb.push(mid[k]);
    sm[i] = median(nb);
  }
  const env = pt.env ?? rms;   // envelope energi pendek untuk mendeteksi nada berulang

  const HI = 0.75, LO = 0.35, CONFIRM = 4;   // hysteresis (Schmitt): masuk > HI, batal hanya jika kembali < LO; di antaranya keadaan ditahan
  let i = 0;
  while (i < frames) {
    if (!f0[i]) { i++; continue; }
    let j = i; while (j < frames && f0[j]) j++;
    if (j - i >= MINLEN) {
      let run: Array<{ s: number; e: number }> = [];
      let s = i, buf = [sm[i]], cand = -1, cnt = 0;
      for (let k = i + 1; k < j; k++) {
        const dev = Math.abs(sm[k] - median(buf.length > 160 ? buf.slice(-160) : buf));
        if (dev > HI) { if (cand < 0) cand = k; cnt++; } else if (dev < LO) { cand = -1; cnt = 0; }
        if (cnt >= CONFIRM) {
          run.push({ s, e: cand }); s = cand; buf = []; for (let q = cand; q <= k; q++) buf.push(sm[q]); cand = -1; cnt = 0;
        } else buf.push(sm[k]);
      }
      run.push({ s, e: j });
      for (let r = 0; r < run.length; r++) {   // potongan terlalu pendek digabung ke tetangga
        if (run[r].e - run[r].s < MINLEN) {
          if (r > 0) { run[r - 1].e = run[r].e; run.splice(r, 1); r--; }
          else if (run.length > 1) { run[1].s = run[0].s; run.splice(0, 1); r--; }
        }
      }
      // nada berulang di pitch yang sama: lembah energi yang dalam di tengah satu potongan = artikulasi ulang
      const split: Array<{ s: number; e: number }> = [];
      for (const q of run) {
        let st = q.s;
        for (let m = q.s + MINLEN; m < q.e - MINLEN; m++) {
          let isMin = true; for (let u = m - 3; u <= m + 3; u++) if (env[u] < env[m]) { isMin = false; break; }
          if (!isMin) continue;
          // lembah harus >= ~10 dB di bawah puncak kiri/kanan; tremolo dan dip artikulasi ringan bukan nada baru
          let lm = 0, rm = 0;
          for (let u = Math.max(q.s, m - 40); u < m; u++) lm = Math.max(lm, env[u]);
          for (let u = m + 1; u < Math.min(q.e, m + 41); u++) rm = Math.max(rm, env[u]);
          if (m - st >= MINLEN && env[m] < VALLEY * Math.min(lm, rm)) { split.push({ s: st, e: m }); st = m; m += MINLEN; }
        }
        split.push({ s: st, e: q.e });
      }
      run = split;
      for (const q of run) {
        const m = trimmedMidi(mid, q.s, q.e);
        if (m > 0) notes.push({ s: q.s, e: q.e, midi: m, target: m });
      }
    }
    i = j;
  }

  // a) ekor yang sudah meluruh > 30 dB dari puncak nada (reverb / release panjang) bukan bagian nada: potong
  for (const nt of notes) {
    let pk = 0; for (let u = nt.s; u < nt.e; u++) if (env[u] > pk) pk = env[u];
    while (nt.e - 1 > nt.s + MINLEN && env[nt.e - 1] < 0.03 * pk) nt.e--;
  }
  // b) potongan bersebelahan, pitch sama, tanpa lembah energi dalam di antaranya = satu nada yang terputus tracker -> gabung
  for (let k = 0; k + 1 < notes.length;) {
    const a = notes[k], b = notes[k + 1];
    if (b.s - a.e <= MERGE_GAP && Math.abs(a.midi - b.midi) < 0.5) {
      let pa = 0, pb = 0, vmin = Infinity;
      for (let u = Math.max(a.s, a.e - 40); u < a.e; u++) pa = Math.max(pa, env[u]);
      for (let u = b.s; u < Math.min(b.e, b.s + 40); u++) pb = Math.max(pb, env[u]);
      for (let u = Math.max(a.s, a.e - 6); u < Math.min(b.e, b.s + 6); u++) vmin = Math.min(vmin, env[u]);
      if (vmin >= VALLEY * Math.min(pa, pb)) {
        const mm = trimmedMidi(mid, a.s, b.e);
        notes.splice(k, 2, { s: a.s, e: b.e, midi: mm > 0 ? mm : a.midi, target: mm > 0 ? mm : a.midi });
        continue;
      }
    }
    k++;
  }
  // b2) scoop / jatuhan: potongan pendek di AWAL atau AKHIR rangkaian yang menempel ke nada jauh lebih panjang dan pitch-nya dekat adalah ornamen
  //     (naik dari bawah, jatuh di ujung), bukan nada sendiri -> diserap ke nada panjang; kontur aslinya tetap terbawa karena render menggeser kurva f0
  const ORN = 18;
  for (let k = 0; k < notes.length;) {
    const a = notes[k], la = a.e - a.s;
    const prev = k > 0 && a.s - notes[k - 1].e <= 3 ? notes[k - 1] : null, next = k + 1 < notes.length && notes[k + 1].s - a.e <= 3 ? notes[k + 1] : null;
    if (la < ORN && !prev && next && next.e - next.s >= 2.5 * la && Math.abs(a.midi - next.midi) < 2) { next.s = a.s; notes.splice(k, 1); continue; }
    if (la < ORN && !next && prev && prev.e - prev.s >= 2.5 * la && Math.abs(a.midi - prev.midi) < 2) { prev.e = a.e; notes.splice(k, 1); continue; }
    k++;
  }
  // b3) vibrato lebar (> +-0.75 semiton) melewati hysteresis dan memecah satu nada jadi potongan zig-zag (naik-turun bergantian, tiap potongan ~setengah siklus).
  //     >= 5 potongan pendek bersambung yang pitch-nya bergantian naik/turun dalam rentang <= 2.4 semiton = satu nada ber-vibrato -> gabung
  const isShort = (nt: Note): boolean => nt.e - nt.s <= 40;
  for (let k = 0; k + 4 < notes.length;) {
    let j = k, lo = notes[k].midi, hi = lo, last = 0;
    while (j + 1 < notes.length) {
      const a = notes[j], b = notes[j + 1], dm = b.midi - a.midi, dir = Math.sign(dm);
      if (b.s - a.e > 3 || !isShort(a) || !isShort(b) || Math.abs(dm) < 0.4 || dir === last) break;
      const nlo = Math.min(lo, b.midi), nhi = Math.max(hi, b.midi);
      if (nhi - nlo > 2.4) break;
      lo = nlo; hi = nhi; last = dir; j++;
    }
    if (j - k + 1 >= 5) {
      const s0 = notes[k].s, e0 = notes[j].e, mm = trimmedMidi(mid, s0, e0);
      notes.splice(k, j - k + 1, { s: s0, e: e0, midi: mm, target: mm });
    } else k++;
  }
  // b4) luncuran lebar & scoop / jatuhan berlapis. Penyanyi jarang pindah nada seketika: ada luncuran 50-200 ms yang menyapu 2-5 semiton, dan tracker memecahnya jadi
  //     beberapa potongan pendek yang masing-masing "dibulatkan" ke semitonnya sendiri -> hasil koreksi berupa TANGGA semiton yang terdengar sebagai slide.
  //     (1) luncuran: rangkaian potongan pendek bersambung di antara dua nada panjang, pitch-nya menyapu dari satu nada ke nada lain -> dihapus; perbatasan nada panjang
  //         ditaruh di titik tengah luncuran (tempat pitch melewati titik tengah kedua nada), jadi pindah nada tepat satu lompatan.
  //     (2) scoop / jatuhan: rangkaian potongan pendek di awal / akhir sebuah rangkaian nada yang mendekati / menjauhi nada panjang -> diserap ke nada panjang itu
  //         (kontur aslinya tetap terbawa karena render mengurangi deviasi f0 terhadap pusat nada).
  const SHORT = Math.max(6, Math.round(0.1 * pt.sr / pt.hop));       // potongan <= ~100 ms = kandidat luncuran / ornamen
  const CHAINMAX = Math.max(10, Math.round(0.24 * pt.sr / pt.hop));   // total rangkaian ornamen <= ~240 ms
  const near = (a: Note, b: Note): boolean => b.s - a.e <= 3;
  // potongan yang MENYAPU (pitch di seperempat awal vs akhir berbeda >= 0.6 semiton) adalah luncuran, bukan nada tetap (grace note): boleh diserap lebih jauh
  const sweep = (f: Note): number => {
    const q = Math.max(1, Math.floor((f.e - f.s) / 4)), a: number[] = [], b: number[] = [];
    for (let u = f.s; u < f.s + q; u++) if (mid[u] > 0) a.push(mid[u]);
    for (let u = f.e - q; u < f.e; u++) if (mid[u] > 0) b.push(mid[u]);
    return a.length && b.length ? median(b) - median(a) : 0;
  };
  const ornOk = (frag: Note[], N: Note, sgn: number): boolean => frag.every(f => Math.abs(f.midi - N.midi) <= (frag.length > 1 ? 4.2 : 2.2)) ||
    (frag.length === 1 && Math.abs(frag[0].midi - N.midi) <= 3.4 && sweep(frag[0]) * sgn >= 0.6);   // sgn = +1 kalau menuju N naik (scoop), -1 kalau turun (jatuhan)
  const LONGMIN = Math.max(SHORT + 1, Math.round(0.13 * pt.sr / pt.hop));   // nada >= ~130 ms dianggap nada sungguhan; potongan yang lebih pendek + menyapu = luncuran / ornamen awal kata
  const isLong = (nt: Note): boolean => nt.e - nt.s >= LONGMIN;
  for (let guard = 0, changed = true; changed && guard < 200; guard++) {
    changed = false;
    // (1) luncuran antara dua nada panjang
    for (let k = 0; k < notes.length && !changed; k++) {
      const A = notes[k]; if (!isLong(A)) continue;
      let j = k + 1; while (j < notes.length && !isLong(notes[j]) && near(notes[j - 1], notes[j])) j++;
      if (j === k + 1 || j >= notes.length || !near(notes[j - 1], notes[j])) continue;
      const B = notes[j], frag = notes.slice(k + 1, j);
      const span = frag[frag.length - 1].e - frag[0].s;
      if (span > CHAINMAX) continue;
      const lo = Math.min(A.midi, B.midi) - 0.6, hi = Math.max(A.midi, B.midi) + 0.6, dir = Math.sign(B.midi - A.midi);
      if (Math.abs(B.midi - A.midi) < 0.6 || !frag.every(f => f.midi >= lo && f.midi <= hi)) continue;
      let mono = true; for (let q = 1; q < frag.length; q++) if ((frag[q].midi - frag[q - 1].midi) * dir < -0.3) mono = false;
      if (!mono) continue;
      const cut = (A.midi + B.midi) / 2; let bnd = -1;
      for (let u = frag[0].s; u < frag[frag.length - 1].e; u++) if (mid[u] > 0 && (mid[u] - cut) * dir >= 0) { bnd = u; break; }
      if (bnd < 0) bnd = Math.round((frag[0].s + frag[frag.length - 1].e) / 2);
      A.e = bnd; B.s = bnd; notes.splice(k + 1, j - k - 1); changed = true;
    }
    if (changed) continue;
    // (1b) lembah / tonjolan antara dua nada panjang yang pitch-nya SAMA: biasanya jembatan di jeda konsonan antar kata (tracker menambal celah dengan
    //      pitch yang turun lalu naik lagi). Potongan itu bukan nada: dibagi dua ke nada kiri dan kanan, jadi sambungan antar kata tetap lurus.
    for (let k = 0; k < notes.length && !changed; k++) {
      const A = notes[k]; if (!isLong(A)) continue;
      let j = k + 1; while (j < notes.length && !isLong(notes[j]) && near(notes[j - 1], notes[j])) j++;
      if (j === k + 1 || j >= notes.length || !near(notes[j - 1], notes[j])) continue;
      const B = notes[j], frag = notes.slice(k + 1, j), a = frag[0].s, b = frag[frag.length - 1].e;
      if (b - a > CHAINMAX || Math.abs(B.midi - A.midi) >= 0.6 || !frag.every(f => Math.abs(f.midi - A.midi) <= 3.4)) continue;
      const mdp = Math.round((a + b) / 2); A.e = mdp; B.s = mdp; notes.splice(k + 1, j - k - 1); changed = true;
    }
    if (changed) continue;
    // (2a) scoop di awal rangkaian: potongan pendek menanjak ke nada panjang
    for (let k = 0; k < notes.length && !changed; k++) {
      if (k > 0 && near(notes[k - 1], notes[k])) continue;
      let j = k; while (j < notes.length && !isLong(notes[j]) && (j === k || near(notes[j - 1], notes[j]))) j++;
      if (j === k || j >= notes.length || !near(notes[j - 1], notes[j])) continue;
      const N = notes[j], frag = notes.slice(k, j), span = N.s - frag[0].s;
      if (span > CHAINMAX || N.e - N.s < 2 * span || !ornOk(frag, N, Math.sign(N.midi - frag[0].midi))) continue;
      N.s = frag[0].s; notes.splice(k, j - k); changed = true;
    }
    if (changed) continue;
    // (2b) jatuhan di akhir rangkaian
    for (let k = notes.length - 1; k >= 0 && !changed; k--) {
      if (k + 1 < notes.length && near(notes[k], notes[k + 1])) continue;
      let j = k; while (j >= 0 && !isLong(notes[j]) && (j === k || near(notes[j], notes[j + 1]))) j--;
      if (j === k || j < 0 || !near(notes[j], notes[j + 1])) continue;
      const N = notes[j], frag = notes.slice(j + 1, k + 1), span = frag[frag.length - 1].e - N.e;
      if (span > CHAINMAX || N.e - N.s < 2 * span || !ornOk(frag, N, Math.sign(frag[0].midi - N.midi))) continue;
      N.e = frag[frag.length - 1].e; notes.splice(j + 1, k - j); changed = true;
    }
  }
  // c) kedip pendek dibuang
  return notes.filter(nt => nt.e - nt.s >= MINNOTE);
}

// ---------- snap ke semiton dengan hysteresis ----------
// Nada yang bersambung dengan nada sebelumnya menahan target lama sampai pitch-nya melewati batas + margin, jadi pitch yang bergetar di
// perbatasan dua semiton tidak membuat target loncat-loncat.
export function snapTargets(notes: Note[], hyst = 0.15, gapFrames = 12): void {
  const order = notes.map((_, i) => i).sort((p, q) => notes[p].s - notes[q].s);
  let prev: Note | null = null;
  for (const idx of order) {
    const nt = notes[idx];
    if (nt.man) { prev = nt; continue; }   // target atur-tangan tidak ditimpa
    let t = Math.round(nt.midi);
    if (prev && nt.s - prev.e <= gapFrames && Math.abs(nt.midi - prev.target) < 0.5 + hyst) t = prev.target;
    nt.target = t; prev = nt;
  }
}

// ---------- render: TD-PSOLA, satu rangkaian per kelompok nada bersambung ----------
function cubic(x: Float32Array, p: number): number {
  const i = Math.floor(p), f = p - i;
  if (i < 1 || i >= x.length - 2) return 0;
  const y0 = x[i - 1], y1 = x[i], y2 = x[i + 1], y3 = x[i + 2];
  return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
}

// titik pitch (epoch): puncak dengan polaritas dominan; kandidat yang jaraknya tidak konsisten dengan periode dibuang,
// sisanya dipilih lewat korelasi lokal dengan siklus sebelumnya, lalu dihaluskan ke posisi pecahan (parabola)
function epochMarks(x: Float32Array, a: number, b: number, F: (t: number) => number, sr: number): number[] {
  const n = x.length;
  let pos = 0, neg = 0;
  for (let t = a; t < b;) {
    const T = Math.max(8, Math.round(sr / F(t))), e = Math.min(b, t + T);
    let mx = 0, mn = 0; for (let j = t; j < e; j++) { if (x[j] > mx) mx = x[j]; if (x[j] < mn) mn = x[j]; }
    pos += mx; neg -= mn; t += T;
  }
  const pol = neg > pos * 1.1 ? -1 : 1;
  const v = (i: number): number => pol * (x[i] ?? 0);
  const frac = (c: number): number => { const y0 = v(c - 1), y1 = v(c), y2 = v(c + 1), den = y0 - 2 * y1 + y2; return den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0; };
  const ncc = (p: number, q: number, L: number): number => {
    let sp = 0, sq = 0, sc = 0;
    for (let u = -L; u <= L; u++) { const A = v(p + u), B = v(q + u); sc += A * B; sp += A * A; sq += B * B; }
    return sc / Math.sqrt(sp * sq + 1e-12);
  };

  const marks: number[] = [];
  let T = sr / F(a), from = Math.max(0, a - Math.round(T)), to = Math.min(n, from + Math.round(T));
  let m = from; for (let j = from; j < to; j++) if (v(j) > v(m)) m = j;
  marks.push(m + frac(m));
  for (let guard = 0; m < b + T && guard < 4e6; guard++) {
    T = sr / F(m);
    const exp = m + T, lo = Math.max(m + 1, Math.ceil(m + 0.75 * T)), hi = Math.min(n - 2, Math.floor(m + 1.25 * T));
    if (lo >= n - 2) break;
    let cand: number[] = [];
    for (let j = lo; j <= hi; j++) if (v(j) > v(j - 1) && v(j) >= v(j + 1)) cand.push(j);
    if (!cand.length) { let p = lo; for (let j = lo; j <= hi; j++) if (v(j) > v(p)) p = j; cand.push(hi >= lo ? p : Math.round(exp)); }
    if (cand.length > 3) cand = cand.sort((p, q) => v(q) - v(p)).slice(0, 3);
    const L = Math.max(4, Math.round(T * 0.5));
    let best = cand[0], bs = -Infinity;
    for (const c of cand) { const sc = ncc(m, c, L) - 0.8 * Math.abs(c - exp) / T; if (sc > bs) { bs = sc; best = c; } }
    if (Math.abs(best - exp) > 0.3 * T) best = Math.min(n - 2, Math.round(exp));   // jarak tidak konsisten dengan periode: pakai posisi yang diharapkan
    if (best <= m) best = Math.min(n - 2, m + Math.max(1, Math.round(T)));
    m = best;
    // penyelarasan halus: geser posisi pecahan supaya bentuk gelombang satu periode di sekitar titik ini cocok dengan periode sebelumnya (korelasi, resolusi 0.1 sample),
    // bukan sekadar puncak + parabola. Puncak tajam / berisik meleset ~0.5-1 sample, dan meleset itu memutar fase harmonik atas antar grain = serak ("burik")
    const prev = marks[marks.length - 1], p0 = m + frac(m);
    const Lr = Math.max(6, Math.round(T * 0.5)), cs = (c: number, d: number): number => { let sc = 0, sp = 0, sq = 0; for (let u = -Lr; u <= Lr; u++) { const A = pol * cubic(x, prev + u), B = pol * cubic(x, c + d + u); sc += A * B; sp += A * A; sq += B * B; } return sc / Math.sqrt(sp * sq + 1e-12); };
    let bd = 0, bv = -2; const vals: number[] = [];
    for (let q = -10; q <= 10; q++) { const d = q * 0.1, v2 = cs(p0, d); vals.push(v2); if (v2 > bv) { bv = v2; bd = q; } }
    let dd = bd * 0.1;
    if (bd > -10 && bd < 10) { const a2 = vals[bd + 9], b2 = vals[bd + 10], c2 = vals[bd + 11], dn = a2 - 2 * b2 + c2; if (dn < 0) dd += 0.1 * Math.max(-0.5, Math.min(0.5, 0.5 * (a2 - c2) / dn)); }
    marks.push(bv > 0.5 ? p0 + dd : p0);
  }
  return marks;
}

// ---------- pemisah drift (lambat) dan vibrato (cepat) ----------
// Rata-rata bergerak selebar tepat SATU periode vibrato menghapus vibrato itu sepenuhnya (sinusoid habis di frekuensi 1/T, di fase mana pun).
// Dua kali berturut-turut (segitiga) supaya sisa akibat laju vibrato yang tidak stabil / periode non-bulat mengecil jadi < 1%.
// Di ujung nada jendela DIGESER ke dalam (panjangnya tetap satu periode penuh), bukan dipotong: pemotongan meninggalkan sisa vibrato di ~setengah periode pertama / terakhir.
function boxClamp(a: Float64Array, L: number): Float64Array {
  const n = a.length, out = new Float64Array(n), pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  const C = (x: number): number => { const i = Math.min(n - 1, Math.max(0, Math.floor(x))); return pre[i] + (Math.min(n, x) - i) * a[i]; };   // jumlah kumulatif, pecahan diinterpolasi
  const w = Math.min(L, n);
  for (let i = 0; i < n; i++) {
    let lo = i + 0.5 - w / 2, hi = i + 0.5 + w / 2;
    if (lo < 0) { hi -= lo; lo = 0; } if (hi > n) { lo -= hi - n; hi = n; }
    out[i] = (C(hi) - C(Math.max(0, lo))) / Math.max(1e-9, hi - Math.max(0, lo));
  }
  return out;
}

// laju vibrato dominan di 3.5..8.5 Hz lewat DFT berjendela Hann pada deviasi pitch; null kalau tidak ada vibrato berarti (< 3 sen) atau nada terlalu pendek
function vibPeriod(dev: Float64Array, fps: number): number | null {
  const n = dev.length;
  if (n < 0.3 * fps) return null;
  let mu = 0; for (let i = 0; i < n; i++) mu += dev[i]; mu /= n;
  let bestA = 0, bestF = 0;
  for (let f = 3.5; f <= 8.5; f += 0.05) {
    let re = 0, im = 0, ws = 0;
    for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n), p = 2 * Math.PI * f * i / fps, r = (dev[i] - mu) * w; re += r * Math.cos(p); im -= r * Math.sin(p); ws += w; }
    const amp = 2 * Math.hypot(re, im) / ws;
    if (amp > bestA) { bestA = amp; bestF = f; }
  }
  return bestA > 0.03 ? fps / bestF : null;
}

function slowPart(dev: Float64Array, fps: number): Float64Array {
  const T = vibPeriod(dev, fps) ?? 0.2 * fps;
  return boxClamp(boxClamp(dev, T), T);
}

// kurva geseran (semiton) satu kelompok nada bersambung: bagian tetap per nada (dihaluskan di zona transisi) + koreksi drift / vibrato per nada.
// Dipakai BERSAMA oleh render() dan tampilan (shiftCurve) supaya garis yang digambar = yang terdengar.
function groupShift(g: Note[], f0: Float32Array, hop: number, sr: number, R: Ctl): { gs: number; sh: Float64Array; ab: Float64Array; aw: Float64Array } | null {
  const gs = g[0].s, ge = g[g.length - 1].e, L = ge - gs, fps = sr / hop;
  if (L < 2) return null;
  const Z = Math.max(1, Math.round(R.transMs / 1000 * sr / hop)) | 1, zh = (Z - 1) / 2;   // lebar zona transisi (frame, ganjil)
  const kern = new Float64Array(Z); { let ks = 0; for (let q = -zh; q <= zh; q++) { kern[q + zh] = 0.5 + 0.5 * Math.cos(Math.PI * q / (zh + 1)); ks += kern[q + zh]; } for (let q = 0; q < Z; q++) kern[q] /= ks; }
  const step = new Float64Array(L), has = new Uint8Array(L), extra = new Float64Array(L), mstep = new Float64Array(L), rhoF = new Float64Array(L).fill(1);

  // zona sambungan di sekitar tiap perbatasan nada bersambung: di sini deviasi pitch asli adalah LUNCURAN antar nada, dan knob Transition
  // menentukan seberapa banyak yang dipertahankan (glide = 1 asli; menuju 0 dibuang sehingga pindah nada ditentukan kernel transisi).
  // Bobot penuh (1) sejauh +-45 ms supaya seluruh luncuran (umumnya 30-100 ms) terhapus, lalu turun cosine sampai +-90 ms
  const Wz = Math.max(Math.round(0.09 * fps), zh + 1), Wp = Math.round(Wz / 2);   // Wz minimal selebar kernel transisi, supaya koreksi di bawah tidak terpotong
  let jw: Float64Array | null = null;
  if (R.glide < 1) {
    jw = new Float64Array(L);
    for (let i = 1; i < g.length; i++) {
      const jc = Math.round((g[i - 1].e + g[i].s) / 2) - gs;
      for (let q = -Wz; q <= Wz; q++) { const f = jc + q, d = Math.abs(q); if (f < 0 || f >= L) continue; const w = d <= Wp ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (d - Wp) / (Wz - Wp)); if (w > jw[f]) jw[f] = w; }
    }
  }

  for (const nt of g) {
    const k = nt.man ? 1 : R.center;   // Center: skala koreksi ke target; nada atur-tangan selalu penuh
    for (let f = nt.s; f < nt.e; f++) { step[f - gs] = k * (nt.target - nt.midi); mstep[f - gs] = nt.midi; has[f - gs] = 1; }
    const dk = (nt.drift ?? 1) * R.variation, vk = (nt.vib ?? 1) * R.variation;   // Variation global dikalikan pengaturan per nada
    for (let f = nt.s; f < nt.e; f++) rhoF[f - gs] = R.glide * dk;
    if (dk !== 1 || vk !== 1 || jw) {
      const len = nt.e - nt.s, dev = new Float64Array(len);
      for (let q = 0; q < len; q++) { const hz = f0[nt.s + q]; dev[q] = hz ? Math.max(-5, Math.min(5, midiOf(hz) - nt.midi)) : (q ? dev[q - 1] : 0); }
      const slow = slowPart(dev, fps);
      for (let q = 0; q < len; q++) {
        const gf = nt.s + q - gs, nrm = (dk - 1) * slow[q] + (vk - 1) * (dev[q] - slow[q]);
        const w = jw ? jw[gf] : 0;
        extra[gf] = w > 0 ? (1 - w) * nrm + w * (R.glide * dk - 1) * dev[q] : nrm;   // di sambungan: seluruh deviasi (luncuran) dikali glide * drift
      }
    }
  }
  for (let f = 1; f < L; f++) if (!has[f]) { step[f] = step[f - 1]; mstep[f] = mstep[f - 1]; }
  const smooth = (a: Float64Array, f: number): number => { let v = 0; for (let q = -zh; q <= zh; q++) v += kern[q + zh] * a[Math.min(L - 1, Math.max(0, f + q))]; return v; };
  const sh = new Float64Array(L);
  for (let f = 0; f < L; f++) {
    sh[f] = smooth(step, f) + extra[f];
    // suku legato / tajam: luncuran asli hanya dipertahankan sebesar rho; sisanya diganti pindah-nada sintetis yang dibentuk kernel transisi,
    // yaitu selisih antara pusat nada yang dihaluskan dan yang tajam (rho = 1 -> suku ini nol, hasil sama seperti sebelumnya)
    if (jw && jw[f] > 0 && has[f]) sh[f] += jw[f] * (1 - rhoF[f]) * (smooth(mstep, f) - mstep[f]);
  }
  // Nada yang variasinya dimatikan total (drift = vibrato = 0) punya pitch hasil yang SUDAH diketahui tanpa tracker: pusat nada (yang dihaluskan di zona transisi).
  // Memakai pitch absolut ini (loop terbuka) menggantikan "f0 tracker dikurangi deviasi tracker" (loop tertutup): di awal kata, frame bergelap-konsonan, frame
  // tanpa pitch yang ditambal interpolasi, atau saat deviasi terpotong batas +-5 semiton, kesalahan tracker tidak lagi ikut terbawa jadi lonjakan.
  const ab = new Float64Array(L), aw = new Float64Array(L);
  for (const nt of g) { if ((nt.drift ?? 1) * R.variation === 0 && (nt.vib ?? 1) * R.variation === 0) for (let f = nt.s; f < nt.e; f++) aw[f - gs] = 1; }
  for (let f = 1; f < L; f++) if (!has[f]) aw[f] = aw[f - 1];
  for (let f = 0; f < L; f++) if (aw[f]) ab[f] = smooth(step, f) + mstep[f] + (jw && jw[f] > 0 ? jw[f] * (1 - rhoF[f]) * (smooth(mstep, f) - mstep[f]) : 0);
  return { gs, sh, ab, aw };
}

// nada yang bersambung (celah <= 3 frame) dirender sebagai satu rangkaian supaya geseran bisa berubah mulus di perbatasan
function groupNotes(notes: Note[]): Note[][] {
  const sorted = notes.slice().sort((p, q) => p.s - q.s), groups: Note[][] = [];
  for (const nt of sorted) { const g = groups[groups.length - 1]; if (g && nt.s - g[g.length - 1].e <= 3) g.push(nt); else groups.push([nt]); }
  return groups;
}

// geseran (semiton) per frame pitch-track, persis seperti yang dipakai render(): pitch hasil di frame f = midi(f0[f]) + hasil[f]. Untuk menggambar garis hasil.
export function shiftCurve(pt: PitchTrack, notes: Note[], transMs = 45, ctl?: Partial<Controls>): Float32Array {
  const out = new Float32Array(pt.f0.length), R = resolveCtl(ctl, transMs);
  for (const g of groupNotes(notes)) { const r = groupShift(g, pt.f0, pt.hop, pt.sr, R); if (r) for (let f = 0; f < r.sh.length; f++) { const h = pt.f0[r.gs + f]; out[r.gs + f] = h > 0 && r.aw[f] > 0 ? (1 - r.aw[f]) * r.sh[f] + r.aw[f] * (r.ab[f] - midiOf(h)) : r.sh[f]; } }
  return out;
}

export function render(x: Float32Array, pt: PitchTrack, notes: Note[], fadeMs = 12, transMs = 45, ctl?: Partial<Controls>): Float32Array {
  const { sr, hop, f0 } = pt, n = x.length, R = resolveCtl(ctl, transMs);
  const fade = Math.max(2, Math.round(sr * fadeMs / 1000)) & ~1, hf = fade / 2;
  const acc = new Float32Array(n), W = new Float32Array(n);
  const ramp = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));   // naik halus 0 -> 1

  for (const g of groupNotes(notes)) {
    const gs = g[0].s, ge = g[g.length - 1].e, L = ge - gs;
    // 1) kurva geseran (dibagi dengan tampilan lewat groupShift)
    const gsh = groupShift(g, f0, hop, sr, R);
    if (!gsh) continue;
    const sh = gsh.sh, ab = gsh.ab, aw = gsh.aw;

    // 2) f0 di grup: frame tanpa pitch diisi interpolasi (log) supaya F(t) selalu ada
    const fg = new Float64Array(L); let any = false;
    for (let f = 0; f < L; f++) { fg[f] = f0[gs + f] || 0; if (fg[f]) any = true; }
    if (!any) continue;
    for (let f = 0; f < L; f++) {
      if (fg[f]) continue;
      let p = f - 1; while (p >= 0 && !fg[p]) p--;
      let q = f + 1; while (q < L && !fg[q]) q++;
      if (p >= 0 && q < L) fg[f] = Math.exp(Math.log(fg[p]) + (Math.log(fg[q]) - Math.log(fg[p])) * (f - p) / (q - p));
      else fg[f] = p >= 0 ? fg[p] : fg[q];
    }
    let peak = 0; for (let f = 0; f < L; f++) peak = Math.max(peak, Math.abs(aw[f] > 0 ? (1 - aw[f]) * sh[f] + aw[f] * (ab[f] - midiOf(fg[f])) : sh[f]));
    if (peak < 0.005) continue;
    const at = (arr: Float64Array, t: number): number => {
      const fp = Math.min(L - 1, Math.max(0, t / hop - gs)), i0 = Math.floor(fp), i1 = Math.min(L - 1, i0 + 1);
      return arr[i0] + (arr[i1] - arr[i0]) * (fp - i0);
    };
    const F = (t: number): number => at(fg, t), S = (t: number): number => at(sh, t), AW = (t: number): number => at(aw, t), AB = (t: number): number => at(ab, t);

    const Ls = Math.round((gs - 0.5) * hop), Le = Math.round((ge - 0.5) * hop);
    const a = Math.max(0, Ls - hf), b = Math.min(n, Le + hf);
    if (b - a < 8) continue;

    // 3) titik pitch analisis
    const marks = epochMarks(x, a, b, F, sr);

    // 4) sintesis: grain Hann 2 periode di sekitar titik analisis terdekat, ditaruh dengan jarak periode baru, posisi pecahan (interpolasi kubik)
    const y = new Float32Array(b - a);
    let ts = a, k = 0;
    while (ts < b) {
      while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
      const mk = marks[k], Ta = sr / F(mk), Ts = sr / hzOf((1 - AW(ts)) * (midiOf(F(ts)) + S(ts)) + AW(ts) * AB(ts)), half = Math.max(2, Math.round(Ta)), gain = Ts / Ta;
      const c = Math.floor(ts), fr = ts - c;
      for (let j = -half; j <= half + 1; j++) {
        const idx = c + j - a; if (idx < 0 || idx >= y.length) continue;
        const dt = j - fr; if (dt <= -half || dt >= half) continue;
        y[idx] += cubic(x, mk + dt) * (0.5 + 0.5 * Math.cos(Math.PI * dt / half)) * gain;
      }
      ts += Ts;
    }

    // 5) campur ke keluaran: bobot naik/turun hanya di ujung kelompok (di dalam kelompok tidak ada perbatasan lagi)
    for (let t = a; t < b; t++) {
      const w = ramp((t - (Ls - hf)) / fade) * ramp(((Le + hf) - t) / fade);
      acc[t] += y[t - a] * w; W[t] += w;
    }
  }

  const out = new Float32Array(n);
  for (let t = 0; t < n; t++) { const w = Math.min(1, W[t]); out[t] = x[t] * (1 - w) + acc[t]; }
  return out;
}

// ---------- ekspor WAV 16-bit mono ----------
export function encodeWav(x: Float32Array, sr: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + x.length * 2), dv = new DataView(buf);
  const str = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + x.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  return buf;
}
