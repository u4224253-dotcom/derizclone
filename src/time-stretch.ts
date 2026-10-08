// Time-stretch tanpa mengubah pitch (WSOLA: Waveform Similarity Overlap-Add), murni DSP tanpa DOM supaya bisa dites di Node.
// factor = durasi hasil / durasi asli (mis. vokal 126 BPM -> project 130 BPM: factor = 126/130 = 0.969, hasil sedikit lebih pendek).
// Semua channel memakai posisi potong yang sama (dicari dari campuran mono), jadi gambar stereo tidak bergeser.

export const STRETCH_MIN = 0.5, STRETCH_MAX = 2;

export function timeStretch(chs: Float32Array[], sr: number, factor: number, onProgress?: (p: number) => void): Float32Array[] {
  const n = chs[0].length, outLen = Math.max(1, Math.round(n * factor));
  if (Math.abs(factor - 1) < 1e-6 || n < 4096) return chs.map(c => resample(c, outLen));
  const Hs = Math.max(64, Math.round(sr * 0.0125)), N = 2 * Hs;           // frame 25 ms, loncat sintesis 12,5 ms (overlap 50%)
  const Ha = Hs / factor;                                                  // loncat analisis (sampel masukan per frame keluaran)
  const D = 4, delta = Math.round(sr * 0.015), dd = Math.ceil(delta / D);  // pencarian +-15 ms (kasar di sampel / 4, lalu dihaluskan)
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);   // Hann periodik: overlap 50% berjumlah 1

  const mono = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) mono[i] += c[i] / chs.length;
  const m = Math.floor(n / D), dec = new Float32Array(m);                  // versi sampel / 4 (rata-rata 4 sampel) untuk pencarian kasar
  for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < D; j++) s += mono[i * D + j]; dec[i] = s / D; }

  const out = chs.map(() => new Float32Array(outLen + N));
  const wsum = new Float32Array(outLen + N);
  const frames = Math.ceil(outLen / Hs) + 1, Nd = Math.floor(N / D);
  let prev = 0;                                                            // posisi masukan frame sebelumnya
  for (let f = 0; f < frames; f++) {
    let pos = Math.round(f * Ha);
    if (f > 0) {                                                           // cari geser terbaik: mirip dengan lanjutan alami frame sebelumnya
      const tgt = Math.floor((prev + Hs) / D), lo = Math.floor(pos / D);
      let best = -Infinity, bj = 0;
      for (let j = -dd; j <= dd; j++) {
        const a = lo + j;
        if (a < 0 || a + Nd > m || tgt + Nd > m) continue;
        let xc = 0, e = 1e-9;
        for (let i = 0; i < Nd; i++) { const v = dec[a + i]; xc += v * dec[tgt + i]; e += v * v; }
        const sc = xc / Math.sqrt(e);                                      // korelasi ternormalisasi (energi target konstan)
        if (sc > best) { best = sc; bj = j; }
      }
      pos = (lo + bj) * D;
      const t0 = prev + Hs; let b2 = -Infinity, bk = 0;                    // penghalusan di resolusi penuh (+-D sampel)
      for (let k = -D; k <= D; k++) {
        const a = pos + k;
        if (a < 0 || a + N > n || t0 + N > n) continue;
        let xc = 0, e = 1e-9;
        for (let i = 0; i < N; i += 2) { const v = mono[a + i]; xc += v * mono[t0 + i]; e += v * v; }
        const sc = xc / Math.sqrt(e);
        if (sc > b2) { b2 = sc; bk = k; }
      }
      pos += bk;
    }
    pos = Math.max(0, Math.min(pos, n - 1));
    prev = pos;
    const o = f * Hs;
    if (o >= outLen) break;
    for (let i = 0; i < N; i++) {
      const w = win[i], si = pos + i;
      if (si < n) for (let c = 0; c < chs.length; c++) out[c][o + i] += chs[c][si] * w;
      wsum[o + i] += si < n ? w : 0;
    }
    if (onProgress && (f & 63) === 0) onProgress(Math.min(1, o / outLen));
  }
  return out.map(y => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = wsum[i] > 1e-3 ? y[i] / Math.max(wsum[i], 0.5) : 0;   // tepi: bagi jumlah window (bukan loncat volume)
    const fo = Math.min(outLen, Math.round(sr * 0.003));                   // ujung hasil: window terpotong habisnya masukan, redam 3 ms supaya tidak klik
    for (let i = 0; i < fo; i++) r[outLen - 1 - i] *= i / fo;
    return r;
  });
}

function resample(c: Float32Array, len: number): Float32Array {   // jalan pintas (factor 1 / audio sangat pendek): pemetaan linear
  const r = new Float32Array(len), k = c.length / len;
  for (let i = 0; i < len; i++) { const p = i * k, a = Math.floor(p), f = p - a; r[i] = (c[a] ?? 0) * (1 - f) + (c[Math.min(a + 1, c.length - 1)] ?? 0) * f; }
  return r;
}
