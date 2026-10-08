// De-esser (pereda desis "S"): split-band, jalan di AudioWorklet, dipasang sebagai efek track (audio clip vokal, DERIZ, dll.).
//
// Algoritma:
//   1. Sinyal dibelah di frekuensi Freq dengan crossover Linkwitz-Riley 4 (dua Butterworth seri): LOW (di bawah Freq) tidak disentuh,
//      HIGH (di atas Freq) adalah daerah desis. LOW + HIGH = sinyal asli (magnitudo datar, hanya fase all-pass), jadi tanpa reduksi suara tidak berubah.
//   2. Detektor membaca level puncak band HIGH (kiri/kanan digabung, ambil yang terbesar) lewat envelope follower: attack 0,4 ms, release 30 ms.
//   3. Level di atas Thresh dikompres (rasio 10:1, soft knee 6 dB), dibatasi sampai Amount (maks. 20 dB). Gain reduction dihaluskan lagi
//      (attack 1 ms, release 20 ms) lalu dipakai HANYA ke band HIGH, dengan gain yang sama di kiri dan kanan (posisi stereo tidak goyang).
//      Vokal yang tidak berdesis tidak melewati Thresh, jadi band HIGH (udara / kilau) tetap utuh.
//   4. Tanpa lookahead, jadi tidak ada latensi tambahan terhadap track lain.
//
// Pesan ke prosesor: { t: 'p', fc (Hz), thr (dB), max (dB reduksi maks.), on }.

const WORKLET_SRC = `
class DeEsser extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};   // nilai awal ikut dibawa saat node dibuat: blok audio pertama sudah memakai setelan yang benar
    this.fc = this.tfc = o.fc || 6500; this.thr = o.thr !== undefined ? o.thr : -32; this.max = o.max !== undefined ? o.max : 10; this.on = o.on !== false;
    this.env = 0; this.gr = 0;
    this.z = [new Float64Array(8), new Float64Array(8)];   // per channel: lp1, lp2, hp1, hp2 (2 state masing-masing)
    this.c = new Float64Array(10);                         // koefisien: LP (0-4), HP (5-9) = b0 b1 b2 a1 a2
    this.aA = 1 - Math.exp(-1 / (0.0004 * sampleRate)); this.aR = 1 - Math.exp(-1 / (0.03 * sampleRate));
    this.gA = 1 - Math.exp(-1 / (0.001 * sampleRate));  this.gR = 1 - Math.exp(-1 / (0.02 * sampleRate));
    this.coef(this.fc);
    this.port.onmessage = e => {
      const m = e.data;
      if (m.t === 'p') { this.tfc = m.fc; this.thr = m.thr; this.max = m.max; this.on = m.on; }
    };
  }
  coef(fc) {
    const w = 2 * Math.PI * Math.min(fc, sampleRate * 0.45) / sampleRate, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al, c = this.c;
    c[0] = (1 - cs) / 2 / a0; c[1] = (1 - cs) / a0; c[2] = c[0]; c[3] = -2 * cs / a0; c[4] = (1 - al) / a0;
    c[5] = (1 + cs) / 2 / a0; c[6] = -(1 + cs) / a0; c[7] = c[5]; c[8] = c[3]; c[9] = c[4];
  }
  f(o, z, k, x) {   // satu biquad (transposed direct form II); o = offset koefisien, k = indeks state
    const c = this.c, y = c[o] * x + z[k];
    z[k] = c[o + 1] * x - c[o + 3] * y + z[k + 1];
    z[k + 1] = c[o + 2] * x - c[o + 4] * y;
    return y;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length || !inp || !inp.length) return true;
    const L = inp[0], R = inp[1] || inp[0], oL = out[0], oR = out[1] || out[0], n = oL.length, zl = this.z[0], zr = this.z[1];
    if (Math.abs(this.tfc - this.fc) > 0.5) { this.fc += (this.tfc - this.fc) * 0.3; this.coef(this.fc); }   // Freq diputar: geser mulus, tanpa loncatan koefisien
    const thr = this.thr, cap = this.on ? this.max : 0;
    let env = this.env, gr = this.gr;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = R[i];
      const loL = this.f(0, zl, 2, this.f(0, zl, 0, xl)), hiL = this.f(5, zl, 6, this.f(5, zl, 4, xl));
      const loR = this.f(0, zr, 2, this.f(0, zr, 0, xr)), hiR = this.f(5, zr, 6, this.f(5, zr, 4, xr));
      const a = Math.abs(hiL), b = Math.abs(hiR), d = a > b ? a : b;
      env += (d - env) * (d > env ? this.aA : this.aR);
      const over = 8.685889638 * Math.log(env + 1e-9) - thr;   // dB di atas threshold
      let red = over >= 3 ? 0.9 * over : over > -3 ? 0.9 * (over + 3) * (over + 3) / 12 : 0;   // rasio 10:1, soft knee 6 dB
      if (red > cap) red = cap;
      gr += (red - gr) * (red > gr ? this.gA : this.gR);
      const g = Math.exp(-gr * 0.11512925465);
      oL[i] = loL + hiL * g; oR[i] = loR + hiR * g;
    }
    this.env = env; this.gr = gr;
    return true;
  }
}
registerProcessor('deriz-deesser', DeEsser);
`;

export const DEESSER_SRC = WORKLET_SRC;   // dipakai tes di tools/

const loaded = new WeakSet<BaseAudioContext>();
const loading = new WeakMap<BaseAudioContext, Promise<void>>();

export const deesserLoaded = (ctx: BaseAudioContext): boolean => loaded.has(ctx);

export function loadDeesser(ctx: BaseAudioContext): Promise<void> {
  let p = loading.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }));
    p = ctx.audioWorklet.addModule(url).then(() => { loaded.add(ctx); }).finally(() => URL.revokeObjectURL(url));
    p.catch(() => loading.delete(ctx));   // gagal: boleh dicoba lagi
    loading.set(ctx, p);
  }
  return p;
}

export interface DeesserMsg { fc: number; thr: number; max: number; on: boolean }

export function createDeesser(ctx: BaseAudioContext, init?: DeesserMsg): AudioWorkletNode {
  return new AudioWorkletNode(ctx, 'deriz-deesser', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: init });
}
