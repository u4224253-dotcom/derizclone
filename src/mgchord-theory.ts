// MGCHORD: inti teori musik (murni, tanpa DOM): skala, chord, voicing, progression, dan ekspor MIDI.
// Dipakai oleh mgchord.ts (UI) dan bisa dites langsung dengan node (tools/mgchord-test.ts).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Skala 7 nada (interval dari tonika, semitone)
export const SCALES: Record<string, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
};
export const SCALE_NAMES = Object.keys(SCALES);

// Jenis chord: interval dari root (semitone) + akhiran nama. Tiga pertama = diatonis (ikut skala), sisanya kualitas tetap di tiap derajat.
export interface ChordType { name: string; iv?: number[]; suffix?: string; stack?: number }   // stack: jumlah nada diatonis (3 = triad, 4 = 7th, 5 = 9th)
export const CHORD_TYPES: ChordType[] = [
  { name: 'Diatonic', stack: 3 },
  { name: 'Diatonic 7th', stack: 4 },
  { name: 'Diatonic 9th', stack: 5 },
  { name: 'Major', iv: [0, 4, 7], suffix: '' },
  { name: 'Minor', iv: [0, 3, 7], suffix: 'm' },
  { name: 'Major7', iv: [0, 4, 7, 11], suffix: 'maj7' },
  { name: 'Minor7', iv: [0, 3, 7, 10], suffix: 'm7' },
  { name: 'Dominant7', iv: [0, 4, 7, 10], suffix: '7' },
  { name: 'Major9', iv: [0, 4, 7, 11, 14], suffix: 'maj9' },
  { name: 'Minor9', iv: [0, 3, 7, 10, 14], suffix: 'm9' },
  { name: 'Dominant9', iv: [0, 4, 7, 10, 14], suffix: '9' },
  { name: 'Add9', iv: [0, 4, 7, 14], suffix: 'add9' },
  { name: 'Sus2', iv: [0, 2, 7], suffix: 'sus2' },
  { name: 'Sus4', iv: [0, 5, 7], suffix: 'sus4' },
  { name: 'Major6', iv: [0, 4, 7, 9], suffix: '6' },
  { name: 'Dim', iv: [0, 3, 6], suffix: 'dim' },
  { name: 'Aug', iv: [0, 4, 8], suffix: 'aug' },
];
export const CHORD_TYPE_NAMES = CHORD_TYPES.map(c => c.name);

// Penamaan kualitas dari himpunan interval (dipakai chord diatonis)
const QUALITY: Record<string, string> = {
  '0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim', '0,4,8': 'aug',
  '0,4,7,11': 'maj7', '0,4,7,10': '7', '0,3,7,10': 'm7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7', '0,3,7,11': 'mMaj7', '0,4,8,11': 'maj7#5', '0,4,8,10': '7#5',
  '0,4,7,11,14': 'maj9', '0,4,7,10,14': '9', '0,3,7,10,14': 'm9', '0,3,6,10,13': 'm7b5b9', '0,3,6,10,14': 'm7b5(9)', '0,3,7,11,14': 'mMaj9', '0,3,6,9,14': 'dim7(9)', '0,4,8,11,14': 'maj9#5', '0,4,8,10,14': '9#5',
  '0,4,7,11,13': 'maj7b9', '0,4,7,10,13': '7b9', '0,3,7,10,13': 'm7b9',
};

export interface Chord { root: number; iv: number[]; name: string }   // root: MIDI absolut; iv: interval dari root (naik)

export interface Settings {
  root: number;          // 0..11 (C = 0)
  scale: string;         // kunci SCALES
  octave: number;        // 0..3: 0 = chord mulai di C3 (bawaan), tiap +1 naik satu oktaf; dipilih lewat dropdown rentang keyboard (C3-C4 .. C6-C7)
  chordType: string;     // nama di CHORD_TYPES
}

export const BASE_MIDI = 48;   // C3: root chord pada Octave 0

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const typeOf = (name: string): ChordType => CHORD_TYPES.find(c => c.name === name) ?? CHORD_TYPES[0];

/** Chord untuk derajat `deg` (0..6) pada skala terpilih. */
export function chordAt(s: Settings, deg: number): Chord {
  const sc = SCALES[s.scale] ?? SCALES.Major, d = mod(deg, 7), t = typeOf(s.chordType);
  const rootPc = mod(s.root + sc[d], 12);
  const rootMidi = BASE_MIDI + s.octave * 12 + mod(rootPc - BASE_MIDI, 12);   // root selalu di C3..B3 (+ oktaf)
  let iv: number[], name: string;
  if (t.stack) {   // diatonis: tumpuk terts pada skala
    const raw: number[] = [];
    for (let k = 0; k < t.stack; k++) { const idx = d + 2 * k; raw.push(sc[idx % 7] + 12 * Math.floor(idx / 7)); }
    iv = raw.map(x => x - raw[0]);
    name = NOTE_NAMES[rootPc] + (QUALITY[iv.join(',')] ?? '');
  } else {
    iv = t.iv!.slice();
    name = NOTE_NAMES[rootPc] + (t.suffix ?? '');
  }
  return { root: rootMidi, iv, name };
}

export interface Voicing {
  invert: number;            // 0..3
  on: boolean[];             // 5 voice menyala / mati
  shift: number[];           // 5 voice: -12 / 0 / +12
  vel: number[];             // 5 voice: velocity 0..1
}
export const VOICES = 5;
// 3 batang saja: root - terts - kuint
export const defaultVoicing = (): Voicing => ({ invert: 0, on: [true, true, true, false, false], shift: [0, 0, 0, 0, 0], vel: [0.52, 0.72, 0.18, 0.66, 0.74] });

export interface VNote { p: number; v: number }   // nada hasil voicing (MIDI + velocity 0..1), urut dari voice 1

/** Voicing: inversi, lalu voice i mengambil nada chord ke-i (berputar + naik oktaf kalau voice lebih banyak dari nada chord). */
export function voice(c: Chord, vc: Voicing): VNote[] {
  let tones = c.iv.map(i => c.root + i);
  for (let k = 0; k < Math.min(vc.invert, tones.length - 1); k++) { tones = [...tones.slice(1), tones[0] + 12]; }
  const out: VNote[] = [];
  for (let i = 0; i < VOICES; i++) {
    if (!vc.on[i]) continue;
    const p = tones[i % tones.length] + 12 * Math.floor(i / tones.length) + vc.shift[i];
    out.push({ p: Math.max(12, Math.min(120, p)), v: Math.max(0.05, Math.min(1, vc.vel[i])) });
  }
  return out;
}

// ---------- progression ----------
export interface Slot { deg: number; beats: number; root?: number; q?: 'Major' | 'Minor' }   // root + q (kalau ada) = triad langsung dari tuts keyboard; kalau tidak, chord diatonik derajat deg
export interface Preset { name: string; scale: 'Major' | 'Minor'; slots: number[] }   // slots: derajat 0..6, tiap slot 1 bar
export const PRESETS: Preset[] = [];   // dikosongkan dulu: progression dibuat sendiri lewat keyboard di kanan (contoh lama ada di riwayat git)
export const slotsOf = (p: Preset): Slot[] => p.slots.map(deg => ({ deg, beats: 4 }));

// Transisi harmoni fungsional sederhana untuk generator acak
const NEXT: number[][] = [[3, 4, 5, 1, 2, 6], [4, 6, 0], [5, 3, 1], [4, 0, 1, 6], [0, 5, 3], [3, 1, 4, 2], [0, 2, 5]];
export function randomProgression(totalBeats: number, rnd: () => number = Math.random): Slot[] {
  const out: Slot[] = [];
  let left = totalBeats, deg = 0;
  const lens = [4, 4, 4, 2, 2, 8];
  while (left > 0) {
    let b = lens[Math.floor(rnd() * lens.length)];
    if (b > left) b = left;
    out.push({ deg, beats: b }); left -= b;
    const opts = NEXT[deg]; deg = opts[Math.floor(rnd() * opts.length)];
  }
  if (out.length > 1 && rnd() < 0.7) out[out.length - 1].deg = [4, 6, 0, 3][Math.floor(rnd() * 4)];   // akhir kalimat: biasanya menggantung / resolusi
  return out;
}

// ---------- gaya main (style): susunan nada per bar ----------
// Block = semua nada chord bunyi bersamaan. Style lain = TABEL pola satu bar (4 ketukan) di PATTERNS di bawah, diulang tiap bar selama chord berjalan.
// Pola buatan sendiri: nada dipetik jarang + sinkop (ketukan 0, 0.5, 1, 1.5, 3), tersebar di dua oktaf, ditahan sampai akhir bar, velocity naik turun.
export type PlayStyle = 'Block' | 'Stab' | 'Pluck' | 'Pad Run' | 'Turun' | 'Tangga' | 'Tresillo' | 'Dholak' | 'Tisra' | 'Pad Pluck' | 'Bell' | 'Roll';
export const STYLES: PlayStyle[] = ['Block', 'Stab', 'Pluck', 'Pad Run', 'Turun', 'Tangga', 'Tresillo', 'Dholak', 'Tisra', 'Pad Pluck', 'Bell', 'Roll'];
export const STYLE_INFO: Record<PlayStyle, { label: string; desc: string }> = {
  Block: { label: 'Block', desc: 'Polos: semua nada chord ditahan sepanjang chord (disapu sangat halus supaya natural)' },
  Stab: { label: 'Stab', desc: 'Pukulan chord utuh pendek (1/16) di tiap offbeat: ketukan 0.5, 1.5, 2.5, 3.5' },
  Pluck: { label: 'Pluck', desc: 'Petikan sinkop: akar, kuint, oktaf, terts atas, oktaf (ketukan 0, 0.5, 1, 1.5, 3), ditahan sampai akhir bar' },
  'Pad Run': { label: 'Pad Run', desc: 'Lanjutan Pluck: akar + kuint ditahan, lalu lari nada naik-turun di dua ketukan terakhir' },
  Turun: { label: 'Turun', desc: 'Kebalikan Pluck: mulai dari nada tinggi, turun ke akar, ditahan sampai akhir bar' },
  Tangga: { label: 'Tangga', desc: 'Nada naik bertahap (1/8) dan menumpuk ditahan, seperti tangga' },
  Tresillo: { label: 'Tresillo', desc: 'Tiga pukulan chord utuh sinkopasi 3 + 3 + 2 (ketukan 0, 1.5, 3)' },
  Dholak: { label: 'Dholak', desc: 'Petikan pendek sinkopasi ala ketukan dholak, enam pukulan per bar' },
  Tisra: { label: 'Tisra', desc: 'Petikan triplet (tiga per ketukan) naik-turun, aksen di tiap ketukan' },
  'Pad Pluck': { label: 'Pad Pluck', desc: 'Akar + kuint ditahan sebagai pad, petikan tinggi pendek masuk di paruh kedua bar' },
  Bell: { label: 'Bell', desc: 'Akar ditahan, petikan tinggi pendek seperti lonceng di tiap offbeat' },
  Roll: { label: 'Roll', desc: 'Roll cepat 1/16 naik empat nada lalu satu nada tinggi, diulang di paruh kedua bar' },
};
export interface Rhythm { style: PlayStyle; rate: number; strum: number }   // rate / strum: sisa format lama (tidak dipakai lagi), tetap ada supaya project lama terbuka

export interface OutNote { p: number; s: number; l: number; v: number; slot: number }   // s / l dalam ketukan dari awal progression; slot = indeks chord asal

// Satu nada dalam pola satu bar: at = ketukan (0..4), i = urutan nada chord dari bawah (0 akar, 1 terts, 2 kuint, 3 akar +1 oktaf, 4 terts +1 oktaf, 5 kuint +1 oktaf, 6 akar +2 oktaf, ...),
// len = panjang (ketukan; angka besar = ditahan sampai akhir bar, otomatis dipotong di akhir bar / chord), v = velocity 0..1 (mutlak, tidak ikut voicing).
// Contoh: chord F#m + Pluck = F#4 C#5 F#5 A5 F#5, C minor + Stab = C4 D#4 G4 (sesuai pola).
interface Ev { at: number; i: number; len: number; v: number }
const H = 4;   // ditahan sampai akhir bar
const P = (rows: [number, number, number, number][]): Ev[] => rows.map(([at, i, len, v]) => ({ at, i, len, v }));   // [at, i, len, v]
const stack = (at: number, idx: number[], len: number, v: number[]): [number, number, number, number][] => idx.map((i, k) => [at, i, len, v[k]]);
const T3 = [3, 5, 6, 7, 6, 5, 3, 5, 6, 7, 6, 5, 4, 5, 6, 8, 6, 5];
// Build demo: hanya Block / Stab / Pluck yang punya pola (samakan dengan LIMITS.mgcStyles di demo.ts). Pola style lain TIDAK ikut di bundel demo
// (`DEMO ? {} : {...}` dilipat bundler jadi `{}`). Di build penuh dan di Node (tes) __DEMO__ tidak ada / false, jadi semua pola ada.
const DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;
const PATTERNS_OPEN: Partial<Record<PlayStyle, Ev[]>> = {
  Stab: P([0.5, 1.5, 2.5, 3.5].flatMap(at => stack(at, [3, 4, 5], 0.25, [0.8, 0.8, 0.8]))),   // C minor = C4 D#4 G4 dipukul serentak di offbeat, 1/16, velocity ~0.8
  Pluck: P([[0, 3, H, 0.8], [0.5, 5, H, 0.5], [1, 6, H, 0.72], [1.5, 7, H, 0.36], [3, 6, H, 0.46]]),
};
const PATTERNS_FULL: Partial<Record<PlayStyle, Ev[]>> = DEMO ? {} : {
  'Pad Run': P([[0, 3, H, 0.5], [0, 7, 2.25, 0.2], [0.5, 5, H, 0.55], [0.5, 6, H, 0.45], [2, 5, H, 0.68], [2.5, 7, H, 0.8], [3, 8, H, 0.5], [3.5, 7, H, 0.4]]),
  Turun: P([[0, 7, H, 0.7], [0.5, 6, H, 0.55], [1, 5, H, 0.65], [1.5, 4, H, 0.4], [3, 3, H, 0.55]]),
  Tangga: P([[0, 3, H, 0.7], [0.5, 4, H, 0.4], [1, 5, H, 0.55], [1.5, 6, H, 0.35], [2, 7, H, 0.65], [2.5, 8, H, 0.4], [3, 6, H, 0.5]]),
  Tresillo: P([...stack(0, [3, 5, 6], 1.5, [0.75, 0.55, 0.6]), ...stack(1.5, [4, 6, 7], 1.5, [0.6, 0.5, 0.55]), ...stack(3, [3, 5, 6], 1, [0.7, 0.5, 0.55])]),
  Dholak: P([[0, 3, 0.5, 0.8], [0.5, 6, 1, 0.45], [1.5, 5, 0.5, 0.6], [2, 6, 1, 0.7], [3, 4, 0.5, 0.5], [3.5, 5, 0.5, 0.4]]),
  Tisra: P(T3.slice(0, 12).map((i, k): [number, number, number, number] => [k / 3, i, 0.3, k % 3 === 0 ? 0.7 : 0.4])),
  'Pad Pluck': P([[0, 3, H, 0.5], [0, 5, H, 0.4], [1.5, 7, 0.5, 0.7], [2, 8, 0.5, 0.55], [3, 7, 0.5, 0.65], [3.5, 6, 0.5, 0.45]]),
  Bell: P([[0, 3, H, 0.6], [0.5, 6, 0.5, 0.45], [1.5, 7, 0.5, 0.55], [2.5, 6, 0.5, 0.5], [3.5, 8, 0.5, 0.6]]),
  Roll: P([[0, 3, 0.25, 0.5], [0.25, 5, 0.25, 0.4], [0.5, 6, 0.25, 0.5], [0.75, 7, 0.25, 0.6], [1, 8, 1, 0.75], [2, 3, 0.25, 0.5], [2.25, 5, 0.25, 0.4], [2.5, 6, 0.25, 0.5], [2.75, 7, 0.25, 0.6], [3, 8, 1, 0.7]]),
};
export const PATTERNS: Partial<Record<PlayStyle, Ev[]>> = { ...PATTERNS_OPEN, ...PATTERNS_FULL };
const lim = (p: number): number => Math.max(12, Math.min(120, p)), vlim = (v: number): number => Math.max(0.05, Math.min(1, v));

// Humanize bawaan (semua style, supaya strum / petikan terasa natural): velocity tiap nada sedikit berbeda (+-HUMAN_VEL, acak TETAP berdasarkan posisi + nada,
// jadi hasilnya sama setiap kali dihitung / diputar / diekspor) dan nada yang bunyi bersamaan disapu naik dari bawah, STAGGER ketukan per nada.
const HUMAN_VEL = 0.1, STAGGER = 0.02;
const jit = (a: number, b: number): number => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };   // 0..1, deterministik
const human = (v: number, s: number, p: number): number => vlim(v * (1 + (jit(s * 7.31, p) - 0.5) * 2 * HUMAN_VEL));

function patternNotes(ev: Ev[], vn: VNote[], t: number, beats: number, si: number, out: OutNote[]): void {
  const sorted = [...vn].sort((a, b) => a.p - b.p), n = sorted.length;
  for (let b0 = 0; b0 < beats - 1e-9; b0 += 4) {   // pola satu bar diulang sampai chord habis
    const end = Math.min(beats, b0 + 4), seen = new Map<number, number>();   // nada tidak melewati akhir bar maupun akhir chord; seen = berapa nada sudah bunyi di ketukan yang sama
    for (const e of ev) {
      const k = seen.get(e.at) ?? 0; seen.set(e.at, k + 1);
      const s = b0 + e.at + Math.min(k * STAGGER, 0.2); if (s >= end - 1e-9) continue;
      const p = lim(sorted[e.i % n].p + 12 * Math.floor(e.i / n));
      out.push({ p, s: t + s, l: Math.min(e.len - k * STAGGER, end - s), v: human(e.v, t + s, p), slot: si });
    }
  }
}

export function buildNotes(st: Settings, slots: Slot[], vc: Voicing, rh: Rhythm): OutNote[] {
  const out: OutNote[] = [];
  let t = 0;
  slots.forEach((sl, si) => {
    const vn = voice(slotChord(st, sl), vc), pat = PATTERNS[rh.style];
    if (vn.length) {
      if (pat) patternNotes(pat, vn, t, sl.beats, si, out);
      else [...vn].sort((a, b) => a.p - b.p).forEach((n, k) => { const d = Math.min(k * STAGGER, sl.beats / 4); out.push({ p: n.p, s: t + d, l: sl.beats - d, v: human(n.v, t + d, n.p), slot: si }); });   // Block (dan nama style yang tidak dikenal): chord utuh, disapu halus
    }
    t += sl.beats;
  });
  return out;
}

/** Triad mayor / minor di nada `rootPc` (0..11): C mayor = C E G, C minor = C D# G. Root di oktaf C3 + `octave` * 12 (octave 0 = C3, sama dengan rentang keyboard plugin). */
export const triadAt = (rootPc: number, q: 'Major' | 'Minor', octave = 0): Chord => {
  const pc = mod(rootPc, 12);
  return { root: BASE_MIDI + octave * 12 + pc, iv: q === 'Minor' ? [0, 3, 7] : [0, 4, 7], name: NOTE_NAMES[pc] + (q === 'Minor' ? 'm' : '') };
};
export const slotChord = (st: Settings, sl: Slot): Chord => (sl.root !== undefined ? triadAt(sl.root, sl.q ?? 'Major', st.octave) : chordAt(st, sl.deg));

export const totalBeats = (slots: Slot[]): number => slots.reduce((a, s) => a + s.beats, 0);

// ---------- ekspor MIDI (SMF type 0, 480 ppq) ----------
export function toMidi(notes: OutNote[], bpm: number): Uint8Array {
  const PPQ = 480, ev: { t: number; b: number[] }[] = [];
  for (const n of notes) {
    const s = Math.round(n.s * PPQ), e = Math.max(s + 1, Math.round((n.s + n.l) * PPQ)), vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
    ev.push({ t: s, b: [0x90, n.p, vel] }, { t: e, b: [0x80, n.p, 0] });
  }
  ev.sort((a, b) => a.t - b.t || (a.b[0] === 0x80 ? -1 : 1) - (b.b[0] === 0x80 ? -1 : 1));
  const vlq = (v: number): number[] => { const o = [v & 0x7f]; while ((v >>= 7) > 0) o.unshift((v & 0x7f) | 0x80); return o; };
  const us = Math.round(60000000 / Math.max(20, Math.min(400, bpm)));
  const trk: number[] = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  let last = 0;
  for (const e of ev) { trk.push(...vlq(e.t - last), ...e.b); last = e.t; }
  trk.push(0, 0xff, 0x2f, 0);
  const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const hdr = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  return Uint8Array.from([...hdr, 0x4d, 0x54, 0x72, 0x6b, ...u32(trk.length), ...trk]);
}

export const midiName = (m: number): string => NOTE_NAMES[mod(m, 12)] + (Math.floor(m / 12) - 1);
