// Efek Delay stereo (WebAudio biasa, tanpa worklet), dipasang di jalur efek track antara Filter dan Reverb.
//
// Jalur: input -> dry ----------------------------------------------> out
//        input -> [Ping Pong: gabung mono -> dlL] atau [Dual: L -> dlL, R -> dlR]
//        tiap sisi: delay -> HiPass -> LoPass -> saturasi (limiter lembut / Analog) -> tap
//        tap -> feedback -> (Dual: kembali ke sisi sendiri | Ping Pong: menyeberang ke sisi lain)
//        tap -> (Ø: balik fase) -> wet -> out
// LFO sinus memodulasi waktu delay (Depth = lebar, Rate = kecepatan, sampai rentang audio). Out = penguatan akhir (dry + wet).
// Semua parameter 0..1 (disimpan di knob); fungsi di bawah mengubahnya ke satuan nyata dan dipakai juga oleh panel (label / LCD).

export interface DelayParams {
  on: boolean; time: number; feedback: number; depth: number; rate: number; hp: number; lp: number;
  dw: number; out: number; analog: number; stereo: number; phl: number; phr: number; sync: number; bpm: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const MAXD = 12;   // detik: 2 bar pada 40 BPM

// ---------- waktu ----------
export interface NoteStep { beats: number; num: number; den: number; suf: '' | 'T' | 'D'; label: string }
export const NOTE_STEPS: NoteStep[] = (() => {
  const a: NoteStep[] = [];
  for (const den of [64, 32, 16, 8, 4, 2, 1]) {
    for (const suf of ['T', '', 'D'] as const) {
      const base = 4 / den;   // ketukan (seperempat = 1)
      a.push({ beats: suf === 'T' ? base * 2 / 3 : suf === 'D' ? base * 1.5 : base, num: 1, den, suf, label: '1/' + den + suf });
    }
  }
  a.push({ beats: 8, num: 2, den: 1, suf: '', label: '2Bar' });
  return a.sort((x, y) => x.beats - y.beats);
})();
export const NOTE_COUNT = NOTE_STEPS.length;
export const noteIndex = (v: number): number => Math.round(clamp01(v) * (NOTE_COUNT - 1));
export const noteValueAt = (i: number): number => i / (NOTE_COUNT - 1);
export const DEFAULT_NOTE = noteValueAt(NOTE_STEPS.findIndex(n => n.label === '1/8'));
export const BPM_LO = 40, BPM_HI = 300;
export const bpmOf = (v: number): number => Math.round(BPM_LO + clamp01(v) * (BPM_HI - BPM_LO));
export const bpmValue = (bpm: number): number => clamp01((bpm - BPM_LO) / (BPM_HI - BPM_LO));
export const syncMode = (v: number): 0 | 1 | 2 => Math.round(clamp01(v) * 2) as 0 | 1 | 2;   // 0 = BPM (manual), 1 = HOST (BPM project), 2 = MS
export const msOf = (v: number): number => 5 * Math.pow(400, clamp01(v));   // 5 ms .. 2000 ms

let hostBpm = 120;
const units = new Set<() => void>();
export const getHostBpm = (): number => hostBpm;
export function setHostBpm(b: number): void {   // BPM project berubah: delay mode HOST ikut
  if (!(b > 0) || b === hostBpm) return;
  hostBpm = b; units.forEach(f => f());
}

export function delaySeconds(p: Pick<DelayParams, 'time' | 'sync' | 'bpm'>): number {
  const m = syncMode(p.sync);
  if (m === 2) return msOf(p.time) / 1000;
  const bpm = m === 1 ? hostBpm : bpmOf(p.bpm);
  return Math.min(MAXD, NOTE_STEPS[noteIndex(p.time)].beats * 60 / bpm);
}

// ---------- satuan lain ----------
export const feedbackPct = (v: number): number => Math.round(clamp01(v) * 200);   // 0 .. 200 % (di atas 100 % bergema terus, dijaga limiter)
export const hpHz = (v: number): number => 20 * Math.pow(1000, clamp01(v));        // 20 Hz .. 20 kHz
export const lpHz = (v: number): number => 100 * Math.pow(200, clamp01(v));        // 100 Hz .. 20 kHz
export const rateHz = (v: number): number => 0.1 * Math.pow(60000, clamp01(v));    // 0,1 Hz .. 6 kHz
export const depthSec = (v: number): number => clamp01(v) * 0.008;                 // sampai +-8 ms
export const outDb = (v: number): number => (clamp01(v) - 0.5) * 36;               // -18 .. +18 dB
export const analogLevel = (v: number): number => Math.round(clamp01(v) * 4);      // 0 = Off, 1..4
const ANALOG_DRIVE = [0, 1.2, 1.8, 2.6, 3.8], ANALOG_CAP = [20000, 14000, 9000, 6000, 4200];   // drive saturasi, dan batas atas LoPass tambahan (rekaman pita menggelapkan ulangan)

function curve(level: number): Float32Array<ArrayBuffer> {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1, ax = Math.abs(x);
    if (level === 0) c[i] = ax < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((ax - 0.8) / 0.2));   // limiter lembut: bersih di bawah 0,8, hanya menjaga feedback > 100 %
    else { const d = ANALOG_DRIVE[level]; c[i] = Math.tanh(d * x) / d; }
  }
  return c;
}

export interface DelayUnit {
  input: AudioNode; output: AudioNode;
  update(p: DelayParams): void;
  levels(): [number, number];   // puncak output [kiri, kanan], linear
  dispose(): void;
}

export function createDelay(ctx: BaseAudioContext): DelayUnit {
  const g = (v = 1): GainNode => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const input = g(); input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2); input.connect(split);

  // umpan: Ping Pong (L + R digabung ke dlL) atau Dual (tiap sisi ke delay-nya sendiri); nol saat efek mati
  const sumL = g(0.5), sumR = g(0.5), ppFeed = g(1), duL = g(0), duR = g(0);
  split.connect(sumL, 0); split.connect(sumR, 1); sumL.connect(ppFeed); sumR.connect(ppFeed);
  split.connect(duL, 0); split.connect(duR, 1);

  const dl = [ctx.createDelay(MAXD + 0.1), ctx.createDelay(MAXD + 0.1)];
  const hp = [0, 1].map(() => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.Q.value = 0.707; return f; });
  const lp = [0, 1].map(() => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.707; return f; });
  const sat = [0, 1].map(() => { const s = ctx.createWaveShaper(); s.curve = curve(0); s.oversample = '2x'; return s; });
  const tap = [g(), g()], fb = [g(0), g(0)];
  ppFeed.connect(dl[0]); duL.connect(dl[0]); duR.connect(dl[1]);
  for (let i = 0; i < 2; i++) { dl[i].connect(hp[i]); hp[i].connect(lp[i]); lp[i].connect(sat[i]); sat[i].connect(tap[i]); tap[i].connect(fb[i]); }
  const self = [g(0), g(0)], cross = [g(1), g(1)];   // self: sisi sendiri (Dual); cross: ke sisi lain (Ping Pong)
  fb[0].connect(self[0]); self[0].connect(dl[0]); fb[0].connect(cross[0]); cross[0].connect(dl[1]);
  fb[1].connect(self[1]); self[1].connect(dl[1]); fb[1].connect(cross[1]); cross[1].connect(dl[0]);

  // LFO -> waktu delay
  const lfo = ctx.createOscillator(), lfoGain = g(0); lfo.type = 'sine'; lfo.frequency.value = 1;
  lfo.connect(lfoGain); lfoGain.connect(dl[0].delayTime); lfoGain.connect(dl[1].delayTime); lfo.start();

  // keluaran: dry + wet (Ø = balik fase) -> Out -> meter
  const dry = g(1), ph = [g(1), g(1)], wet = [g(0), g(0)], merge = ctx.createChannelMerger(2);
  const mix = g(); mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
  input.connect(dry); dry.connect(mix);
  for (let i = 0; i < 2; i++) { tap[i].connect(ph[i]); ph[i].connect(wet[i]); wet[i].connect(merge, 0, i); }
  merge.connect(mix);
  const outG = g(1), tail = g(1); mix.connect(outG); outG.connect(tail);
  const ms = ctx.createChannelSplitter(2), an = [ctx.createAnalyser(), ctx.createAnalyser()], mute = g(0);
  an.forEach(a => { a.fftSize = 1024; a.smoothingTimeConstant = 0; });
  outG.connect(ms); ms.connect(an[0], 0); ms.connect(an[1], 1); an[0].connect(mute); an[1].connect(mute); mute.connect(ctx.destination);   // sambungan senyap: supaya analyser tetap diproses
  const bufs = [new Float32Array(an[0].fftSize), new Float32Array(an[1].fftSize)];

  let last: DelayParams | null = null, level = 0;
  function apply(): void {
    const p = last; if (!p) return;
    const now = ctx.currentTime, on = p.on, pp = syncStereo(p.stereo);
    const T = (n: AudioParam, v: number, tc = 0.02): void => { n.setTargetAtTime(v, now, tc); };
    const sec = delaySeconds(p);
    T(dl[0].delayTime, sec, 0.05); T(dl[1].delayTime, sec, 0.05);
    T(ppFeed.gain, on && pp ? 1 : 0); T(duL.gain, on && !pp ? 1 : 0); T(duR.gain, on && !pp ? 1 : 0);
    T(self[0].gain, pp ? 0 : 1); T(self[1].gain, pp ? 0 : 1); T(cross[0].gain, pp ? 1 : 0); T(cross[1].gain, pp ? 1 : 0);
    const f = on ? clamp01(p.feedback) * 2 : 0;
    T(fb[0].gain, f); T(fb[1].gain, f);
    const lv = analogLevel(p.analog), cap = ANALOG_CAP[lv];
    for (let i = 0; i < 2; i++) { T(hp[i].frequency, hpHz(p.hp)); T(lp[i].frequency, Math.min(lpHz(p.lp), cap)); }
    if (lv !== level) { level = lv; sat.forEach(s => { s.curve = curve(lv); }); }
    T(lfo.frequency, rateHz(p.rate)); T(lfoGain.gain, depthSec(p.depth));
    const m = clamp01(p.dw);
    T(dry.gain, on ? Math.cos(m * Math.PI / 2) : 1); T(wet[0].gain, on ? Math.sin(m * Math.PI / 2) : 0); T(wet[1].gain, on ? Math.sin(m * Math.PI / 2) : 0);
    T(ph[0].gain, p.phl >= 0.5 ? -1 : 1); T(ph[1].gain, p.phr >= 0.5 ? -1 : 1);
    T(outG.gain, Math.pow(10, outDb(p.out) / 20));
  }
  const recalc = (): void => apply();
  units.add(recalc);

  const peak = (a: AnalyserNode, b: Float32Array<ArrayBuffer>): number => { a.getFloatTimeDomainData(b); let m = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > m) m = v; } return m; };
  return {
    input, output: tail,
    update(p) { last = { ...p }; apply(); },
    levels: () => [peak(an[0], bufs[0] as Float32Array<ArrayBuffer>), peak(an[1], bufs[1] as Float32Array<ArrayBuffer>)],
    dispose() {
      units.delete(recalc);
      try { lfo.stop(); } catch { /* sudah berhenti */ }
      [input, split, sumL, sumR, ppFeed, duL, duR, ...dl, ...hp, ...lp, ...sat, ...tap, ...fb, ...self, ...cross, lfo, lfoGain, dry, ...ph, ...wet, merge, mix, outG, tail, ms, ...an, mute].forEach(n => n.disconnect());
    },
  };
}

export const syncStereo = (v: number): boolean => clamp01(v) < 0.5;   // true = Ping Pong, false = Dual
