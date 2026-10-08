// MGCHORD: pembuat chord progression. Jendela plugin (dibuka dari halaman Plugin di panel efek, seperti MPCS), tampilan panel biru:
//   header (preset + SAVE) -> Key / Length / Sound (Piano / Pad / Pluck) + tombol bulat besar (acak progression) + undo / redo
//   -> penggaris bar + blok chord (Fm, Cm7, ...) -> piano roll gelap dengan pasak oranye di batas chord -> Play / Drag & Drop MIDI / unduh.
// SAVE mengirim nada ke pattern yang sedang dipilih di timeline; Drag & Drop MIDI / tombol unduh menghasilkan file .mid.
// Inti teori ada di mgchord-theory.ts (murni, dites lewat tools/mgchord-test.ts).

import { DEMO, LIMITS, demoNotice } from './demo';
import { dragWindow } from './win-drag';
import { createMaster, loadPiano, voiceTone, VOICES, type Voice } from './mgchord-audio';
import {
  NOTE_NAMES, PRESETS, SCALES, STYLES, STYLE_INFO,
  BASE_MIDI, buildNotes, chordAt, defaultVoicing, slotChord, midiName, randomProgression, slotsOf, toMidi, totalBeats, voice,
  type OutNote, type PlayStyle, type Rhythm, type Settings, type Slot, type Voicing,
} from './mgchord-theory';

// Jembatan ke main.ts: tempo project + kirim nada ke pattern terpilih (mengembalikan pesan kalau gagal, null kalau berhasil)
export interface MgBridge {
  bpm(): number;
  send(notes: { p: number; s: number; l: number; v: number }[], beats: number): string | null;
  /** Nada dilepas di atas sebuah track (lane) di timeline: bikin pattern baru di bar tempat dilepas. ok=false = tidak ada pattern yang dibuat (msg = alasannya). */
  drop(notes: { p: number; s: number; l: number; v: number }[], beats: number, lane: HTMLElement, clientX: number): { ok: boolean; msg: string };
}
let bridge: MgBridge | null = null;
export const setMgchordBridge = (b: MgBridge): void => { bridge = b; };

interface Saved { st: Settings; vc: Voicing; rh: Rhythm; slots: Slot[]; sel: number; preset: number; bars: number }   // bars = panjang timeline (4 / 8); slots = chord yang sudah ditambahkan (awalnya kosong)
export type MgchordSaved = Saved;
const initial = (): Saved => {
  return {
    st: { root: 0, scale: 'Minor', octave: 0, chordType: 'Diatonic 9th' }, vc: defaultVoicing(),
    rh: { style: 'Block', rate: 0.5, strum: 0.12 }, slots: [], sel: -1, preset: -1, bars: 4,   // piano roll kosong sampai tuts keyboard diklik
  };
};
let S: Saved = initial();
let root: HTMLElement | null = null;
let openFn: (() => void) | null = null, refreshFn: (() => void) | null = null;

export const mgchordExport = (): MgchordSaved | null => (root ? JSON.parse(JSON.stringify(S)) : null);
export function mgchordImport(saved?: MgchordSaved | null): void {   // dipanggil saat membuka project (null = kembali ke bawaan)
  const base = initial();
  if (saved && saved.st && Array.isArray(saved.slots)) {
    S = { ...base, ...saved, st: { ...base.st, ...saved.st }, vc: { ...base.vc, ...saved.vc }, rh: { ...base.rh, ...saved.rh } };
    S.vc = base.vc;   // chord selalu 3 batang (root - terts - kuint)
    if (!STYLES.includes(S.rh.style)) S.rh.style = base.rh.style;   // style tidak dikenal (project lama / diedit) -> Block
    S.bars = Math.max(4, Math.round(+saved.bars || 0), Math.ceil(totalBeats(S.slots) / 4));   // project lama tanpa 'bars': ikut panjang progression-nya
    S.sel = S.slots.length ? Math.min(Math.max(0, S.sel | 0), S.slots.length - 1) : -1;
  } else S = base;
  refreshFn?.();
}
export function openMgchord(): void { if (!root) build(); openFn?.(); }

const svg = (inner: string, size = 16): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICON = {
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>', 30),
  playS: svg('<path d="M8 5l12 7-12 7z" fill="currentColor" stroke="none"/>', 11),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>', 26),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3.5" stroke-width="1.8"/><circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.4" fill="currentColor" stroke="none"/>', 84),
  dl: svg('<path d="M12 4v12M6.5 11l5.5 5.5 5.5-5.5M5 20h14"/>', 22),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 14),
  prev: svg('<path d="M15 5l-7 7 7 7" fill="currentColor"/>', 12),
  next: svg('<path d="M9 5l7 7-7 7" fill="currentColor"/>', 12),
  undo: svg('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>', 14),
  trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>', 14),
  redo: svg('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>', 14),
  drag: svg('<circle cx="9" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.7" fill="currentColor" stroke="none"/>', 16),
  grip: svg('<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>', 12),
  move: svg('<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" stroke-width="2"/>', 18),
};
const LAMP = '<svg viewBox="0 0 44 26" width="44" height="26" aria-hidden="true"><path d="M22 12c-4-4 4-6 0-10" fill="none" stroke="#9db9ff" stroke-width="2.4" stroke-linecap="round"/><path d="M38 14c5-1 6-6 3-9" fill="none" stroke="#f2b632" stroke-width="3" stroke-linecap="round"/><path d="M3 21c0-5 8-8 19-8h5c8 0 12 3 12 8z" fill="#f2b632" stroke="#c98a10" stroke-width="1.5"/></svg>';
const mod = (n: number, m: number): number => ((n % m) + m) % m;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const MAX_BEATS = 64;                      // 16 bar
const BLACK_PC = new Set([1, 3, 6, 8, 10]);
const KB_WHITES = [0, 2, 4, 5, 7, 9, 11, 12], KB_BLACKS = [1, 3, 6, 8, 10];   // tuts keyboard sebagai jarak dari nada C paling bawah (satu oktaf + C di atasnya)
const RANGES = [0, 1, 2, 3];   // pilihan rentang keyboard = Settings.octave: 0 = C3-C4 (chord mulai di C3), 1 = C4-C5, 2 = C5-C6, 3 = C6-C7
const kbLo = (): number => BASE_MIDI + clamp(S.st.octave, 0, 3) * 12;   // nada MIDI C paling bawah keyboard yang sedang dipilih
const rangeLabel = (oct: number): string => `C${3 + clamp(oct, 0, 3)}–C${4 + clamp(oct, 0, 3)}`;
const kbMarkup = (lo: number): string => {   // keyboard card VERTIKAL: C paling bawah di bawah, naik satu oktaf ke atas. Tuts putih menumpuk ke atas, tuts hitam pendek menempel di sisi kiri dan berpusat di batas tuts putih
  const wp = 100 / KB_WHITES.length;
  return KB_WHITES.map((o, i) => `<button type="button" class="mgc__wk" data-p="${lo + o}" aria-label="${midiName(lo + o)}" style="top:${(KB_WHITES.length - 1 - i) * wp}%"><span>${midiName(lo + o)}</span></button>`).join('') +
    KB_BLACKS.map(o => `<button type="button" class="mgc__bk" data-p="${lo + o}" aria-label="${midiName(lo + o)}" style="top:calc(${100 - KB_WHITES.filter(w => w < o).length * wp}% - ${wp * 0.3235}%)"><span>${midiName(lo + o)}</span></button>`).join('');
};
const KW = 0;                            // tidak ada kolom tuts di piano roll (tampilan sama dengan video promo)


// ---------- suara preview: piano + mixing (mgchord-audio.ts), AudioContext sendiri ----------
let actx: AudioContext | null = null, out: GainNode | null = null, an: AnalyserNode | null = null;
function ac(): AudioContext {
  if (!actx) {
    const A = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    actx = new A({ latencyHint: 'interactive' });
    const master = createMaster(actx); out = master.input;   // low-cut -> EQ -> compressor -> limiter -> soft-clip (+ reverb ruang kecil)
    an = actx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0; master.tap.connect(an);   // tap untuk waveform real-time
    const base = import.meta.env.BASE_URL + 'samples/piano/';   // sample piano asli (21 file, ~1,4 MB); sebelum selesai dimuat dipakai synth cadangan
    void loadPiano(actx, f => fetch(base + f + '.mp3').then(r => { if (!r.ok) throw new Error(f); return r.arrayBuffer(); }));
  }
  if (actx.state === 'suspended') void actx.resume();
  return actx;
}
let sound: Voice = 'piano';   // suara preview yang dipilih di menu samping: Piano / Pad / Pluck
const tone = (c: BaseAudioContext, dest: AudioNode, midi: number, when: number, dur: number, vel: number): void => voiceTone(c, dest, sound, midi, when, dur, vel);

function build(): void {
  const el = document.createElement('div');
  el.className = 'mgc'; el.hidden = true;
  const presetOpts = '<option value="-1">New progression</option>' + PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  el.innerHTML =
    '<div class="mgc__back"></div>' +
    '<div class="mgc__wrap">' +
    '<div class="mgc__win" role="dialog" aria-modal="true" aria-label="MGCHORD" tabindex="-1">' +
      '<header class="mgc__head">' +
        `<span class="mgc__logo">MGCHORD${LAMP}</span>` +
        '<div class="mgc__prog">' +
          (PRESETS.length ? `<label class="mgc__pn"><span class="mgc__pname"></span><select data-k="preset" aria-label="Pilih progression">${presetOpts}</select></label>` : '<div class="mgc__pn mgc__pn--none"><span class="mgc__pname"></span></div>') +
          '<button type="button" class="mgc__save" data-a="save" title="Kirim nada ke pattern yang dipilih di timeline">Save</button>' +
        '</div>' +
        '<span class="mgc__pow">Melvox</span>' +
        `<button type="button" class="mgc__x" data-a="close" aria-label="Tutup" title="Tutup (Esc)">${ICON.close}</button>` +
      '</header>' +
      '<div class="mgc__body">' +
      '<div class="mgc__ctrl">' +
        '<div class="mgc__cd" data-dd="style"><button type="button" class="mgc__cdb" aria-haspopup="listbox" aria-expanded="false" aria-label="Style susunan nada"><span></span></button></div>' +
        '<div class="mgc__sg" role="group" aria-label="Chord mayor atau minor"><button type="button" data-a="scale" data-s="Major">Major</button><button type="button" data-a="scale" data-s="Minor">Minor</button></div>' +
        '<div class="mgc__cd" data-dd="sound"><button type="button" class="mgc__cdb" aria-haspopup="listbox" aria-expanded="false" aria-label="Pilih suara preview"><span></span></button></div>' +
        '<button type="button" class="mgc__bars" data-a="len" data-s="8" title="Panjang progression: 4 / 8 bar">4 Bars</button>' +
        `<div class="mgc__ur"><button type="button" data-a="undo" aria-label="Undo">${ICON.undo}</button><button type="button" data-a="redo" aria-label="Redo">${ICON.redo}</button><button type="button" data-a="clear" aria-label="Kosongkan progression" title="Kosongkan semua chord">${ICON.trash}</button></div>` +
        `<button type="button" class="mgc__big" data-a="dice" aria-label="Acak progression" title="Acak progression"><i>${ICON.dice}</i></button>` +
      '</div>' +
      '<canvas class="mgc__spec" aria-hidden="true"></canvas>' +
      '<div class="mgc__ruler"><div class="mgc__marks"></div></div>' +
      '<div class="mgc__lane" role="listbox" aria-label="Chord progression"></div>' +
      '<div class="mgc__roll"><canvas class="mgc__cv" role="img" aria-label="Piano roll hasil chord"></canvas></div>' +
      '<div class="mgc__foot">' +
        `<button type="button" class="mgc__go" data-a="play" aria-label="Putar preview" title="Putar / henti preview (Spasi)">${ICON.play}</button>` +
        `<button type="button" class="mgc__drag" aria-label="Seret hasil ke track di timeline" title="Tahan lalu seret ke track di timeline: hasil chord jadi pattern baru di bar tempat dilepas">${ICON.drag}</button>` +
        `<button type="button" class="mgc__dl" data-a="midi" aria-label="Download MIDI" title="Download MIDI">${ICON.dl}</button>` +
        '<div class="mgc__dnd" draggable="true" role="button" tabindex="0" data-a="midi" title="Seret ke DAW atau klik untuk unduh .mid"><span>Drag &amp; Drop MIDI&nbsp;&nbsp;/&nbsp;&nbsp;Download .mid</span></div>' +
        '<span class="mgc__bpm"></span>' +
      '</div>' +
      '</div>' +
    '</div>' +
    `<aside class="mgc__kbd" aria-label="Keyboard"><div class="mgc__kbt"><div class="mgc__cd" data-dd="range"><button type="button" class="mgc__cdb" aria-haspopup="listbox" aria-expanded="false" aria-label="Pilih rentang keyboard"><span></span></button></div></div><div class="mgc__kb" role="group">${kbMarkup(kbLo())}</div></aside>` +
    '</div>';
  document.body.appendChild(el);
  dragWindow({ root: el, move: el.querySelector<HTMLElement>('.mgc__wrap')!, handle: '.mgc__head' });   // jendela bisa digeser lewat header
  root = el;

  const win = el.querySelector<HTMLElement>('.mgc__win')!;
  const $ = <T extends HTMLElement>(q: string): T => el.querySelector<T>(q)!;
  const lane = $('.mgc__lane'), marks = $('.mgc__marks'), cv = $<HTMLCanvasElement>('.mgc__cv'), g = cv.getContext('2d')!;
  let notes: OutNote[] = [], playing = false, phBeat = -1, raf = 0, prevFocus: Element | null = null;
  let hist: string[] = [], hi = -1;

  // ---------- waveform real-time, berjalan terus (menggulung ke kiri) ----------
  // Algoritma kick-waveform-demo: sample dibagi per kolom, tiap kolom diambil min/max-nya, digambar sebagai SATU poligon terisi menyambung (rata, tanpa garis tengah, pixel-snapped).
  // Bedanya: sumbernya analyser (suara yang sedang bunyi), tiap kolom = COL sample (zoom) dan kolom baru terus ditambahkan di kanan, jadi gambarnya mengalir.
  const spec = $<HTMLCanvasElement>('.mgc__spec'), sg = spec.getContext('2d')!;
  const COL = 128;   // sample per kolom (~3 ms). Makin kecil = makin zoom / makin cepat menggulung
  let tbuf = new Float32Array(0), specRaf = 0, agc = 0, lastT = 0, lastSrc = 0, cMn = 1, cMx = -1, cCnt = 0;
  let colMn: number[] = [], colMx: number[] = [];   // riwayat kolom (nilai mentah -1..1), paling baru di ujung kanan
  const pushCol = (mn: number, mx: number): void => { colMn.push(mn); colMx.push(mx); };
  const feed = (): void => {   // ambil sample yang baru bunyi sejak frame lalu dari analyser, ubah jadi kolom min/max
    const SR = actx ? actx.sampleRate : 44100, now = actx ? actx.currentTime : performance.now() / 1000;
    if (!lastT || (actx ? 1 : 0) !== lastSrc) { lastT = now; lastSrc = actx ? 1 : 0; }   // jam analyser dan jam cadangan tidak boleh tercampur
    let n = Math.round((now - lastT) * SR); lastT = now;
    if (n <= 0) return;
    if (an && actx && actx.state === 'running') {
      if (tbuf.length !== an.fftSize) tbuf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(tbuf);
      n = Math.min(n, tbuf.length);
      for (let i = tbuf.length - n; i < tbuf.length; i++) {
        const v = tbuf[i]; if (v < cMn) cMn = v; if (v > cMx) cMx = v;
        if (++cCnt >= COL) { pushCol(cMn, cMx); cMn = 1; cMx = -1; cCnt = 0; }
      }
    } else {   // belum ada audio: kolom senyap tetap mengalir
      for (cCnt += n; cCnt >= COL; cCnt -= COL) pushCol(0, 0);
    }
  };
  const drawSpec = (): void => {
    const r = spec.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (r.width < 20 || r.height < 10) return;
    const w = Math.floor(r.width * dpr), h = Math.floor(r.height * dpr);
    if (spec.width !== w || spec.height !== h) { spec.width = w; spec.height = h; }
    feed();
    const mid = h / 2, barW = Math.max(1, Math.round(dpr)), numCols = Math.ceil(w / barW);
    if (colMn.length > numCols) { colMn = colMn.slice(-numCols); colMx = colMx.slice(-numCols); }
    while (colMn.length < numCols) { colMn.unshift(0); colMx.unshift(0); }
    let peak = 0; for (let i = 0; i < numCols; i++) peak = Math.max(peak, Math.abs(colMn[i]), Math.abs(colMx[i]));
    agc = Math.max(agc * 0.993, peak);   // auto-gain: gelombang selalu memenuhi panel (zoom amplitudo)
    const gain = agc > 0.003 ? Math.min(14, 1 / agc) : 1;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.imageSmoothingEnabled = false; sg.clearRect(0, 0, w, h);
    const tops = new Array<number>(numCols), bottoms = new Array<number>(numCols);
    for (let col = 0; col < numCols; col++) {
      let yTop = mid - clamp(colMx[col] * gain, -1, 1) * mid * 0.92, yBottom = mid - clamp(colMn[col] * gain, -1, 1) * mid * 0.92;
      if (Math.abs(yBottom - yTop) < 2) { yTop = mid - 1; yBottom = mid + 1; }   // minimal 2 px supaya garis tetap terlihat saat senyap
      tops[col] = yTop; bottoms[col] = yBottom;
    }
    sg.fillStyle = '#bcd2ff'; sg.shadowColor = 'rgba(190,215,255,.9)'; sg.shadowBlur = 8 * dpr; sg.beginPath(); sg.moveTo(0, bottoms[0]);
    for (let col = 0; col < numCols; col++) sg.lineTo(col * barW + barW / 2, bottoms[col]);
    sg.lineTo(numCols * barW, bottoms[numCols - 1]);
    for (let col = numCols - 1; col >= 0; col--) sg.lineTo(col * barW + barW / 2, tops[col]);
    sg.lineTo(0, tops[0]); sg.closePath(); sg.fill(); sg.shadowBlur = 0;
  };
  const specLoop = (): void => { if (el.hidden) { specRaf = 0; lastT = 0; return; } drawSpec(); specRaf = requestAnimationFrame(specLoop); };

  // ---------- riwayat undo / redo ----------
  const commit = (): void => {
    const j = JSON.stringify(S); if (hist[hi] === j) return;
    hist = hist.slice(0, hi + 1); hist.push(j); if (hist.length > 60) hist.shift(); hi = hist.length - 1;
  };
  const restore = (): void => { S = JSON.parse(hist[hi]); renderAll(); };

  // ---------- render ----------
  const span = (): number => Math.max(4, S.bars * 4, totalBeats(S.slots));   // panjang timeline (ketukan): tetap walau chord belum penuh / kosong
  const selChord = () => (S.sel >= 0 && S.slots[S.sel] ? slotChord(S.st, S.slots[S.sel]) : null);
  const keyEls = new Map<number, HTMLElement>();
  el.querySelectorAll<HTMLElement>('[data-p]').forEach(k => keyEls.set(+k.dataset.p!, k));
  const fold = (p: number): number => { const lo = kbLo(); let q = p; while (q < lo) q += 12; while (q > lo + 12) q -= 12; return q; };
  let kbBase = kbLo();   // C paling bawah keyboard yang sedang digambar; berubah kalau rentang diganti (dropdown, undo / redo, atau buka project)
  function syncKb(): void {
    const lo = kbLo(), kb = $('.mgc__kb'); kb.setAttribute('aria-label', `Tuts ${rangeLabel(S.st.octave).replace('–', ' sampai ')}`);
    if (lo === kbBase && keyEls.size) return;
    kbBase = lo; kb.innerHTML = kbMarkup(lo); keyEls.clear(); kb.querySelectorAll<HTMLElement>('[data-p]').forEach(k => keyEls.set(+k.dataset.p!, k));
  }
  function renderKeys(): void {   // tuts yang termasuk chord terpilih menyala
    const sc = selChord(), lit = new Set(sc ? voice(sc, S.vc).map(n => fold(n.p)) : []);
    keyEls.forEach((k, p) => k.classList.toggle('is-lit', lit.has(p)));
  }
  function recompute(): void { notes = buildNotes(S.st, S.slots, S.vc, S.rh); }
  function renderLane(): void {
    const tot = span(), bars = Math.ceil(tot / 4);
    lane.innerHTML = S.slots.length ? S.slots.map((sl, i) =>
      `<div role="option" tabindex="0" class="mgc__ch${i === S.sel ? ' is-sel' : ''}" data-i="${i}" aria-selected="${i === S.sel}" style="flex:0 0 calc(${(sl.beats / tot) * 100}% - 2px)">` +
      `<span class="mgc__h" data-a="deg-" role="button" tabindex="0" aria-label="Chord turun setengah nada" title="Chord turun setengah nada">${ICON.grip}</span><b>${slotChord(S.st, sl).name}</b>` +
      `<span class="mgc__h" data-a="deg+" role="button" tabindex="0" aria-label="Chord naik setengah nada" title="Chord naik setengah nada">${ICON.grip}</span></div>`).join('')
      : '<div class="mgc__empty">Klik tuts keyboard di kanan untuk menambah chord</div>';
    marks.innerHTML = Array.from({ length: bars }, (_, b) => `<i style="left:${(b * 4 / tot) * 100}%">${b + 1}</i>`).join('');
    renderKeys();
  }
  // ---------- dropdown custom (bukan select bawaan browser): daftar pilihan muncul sebagai panel biru, bisa dioperasikan dengan panah / Enter / Esc ----------
  type DdKey = 'style' | 'scale' | 'sound' | 'range';
  const DD: Record<DdKey, { v: string; t: string; d?: string }[]> = {
    style: STYLES.map(v => ({ v, t: STYLE_INFO[v].label, d: STYLE_INFO[v].desc })),   // 10 style susunan nada (tabelnya ada di mgchord-theory.ts)
    scale: [{ v: 'Major', t: 'Major' }, { v: 'Minor', t: 'Minor' }],   // hanya dua pilihan: mayor dan minor
    sound: VOICES.map(v => ({ v: v.id, t: v.label })),
    range: RANGES.map(o => ({ v: String(o), t: rangeLabel(o), d: `Keyboard ${rangeLabel(o)}: chord dan piano roll ikut pindah ke oktaf ini` })),   // rentang keyboard: menggeser register chord (dan piano roll) per oktaf   // suara preview: Piano / Pad / Pluck (mgchord-audio.ts)
  };
  const ddValue = (k: DdKey): string => (k === 'style' ? S.rh.style : k === 'sound' ? sound : k === 'range' ? String(clamp(S.st.octave, 0, 3)) : S.st.scale);
  const ddLabels = (): void => {
    (Object.keys(DD) as DdKey[]).forEach(k => {
      const o = DD[k].find(x => x.v === ddValue(k)), sp = el.querySelector<HTMLElement>(`[data-dd="${k}"] .mgc__cdb span`);
      if (sp) sp.textContent = o?.t ?? ddValue(k);
      const bt = sp?.parentElement; if (bt) bt.title = k === 'style' ? (o?.d ?? 'Style susunan nada') : k === 'sound' ? 'Suara preview' : k === 'range' ? 'Rentang keyboard (oktaf chord)' : 'Chord mayor atau minor';
    });
  };
  const pop = document.createElement('div'); pop.className = 'mgc__pop'; pop.setAttribute('role', 'listbox'); pop.hidden = true; el.appendChild(pop);
  let popFor: DdKey | null = null, popBtn: HTMLElement | null = null;
  const closePop = (refocus = false): void => {
    if (pop.hidden) return;
    pop.hidden = true; popBtn?.setAttribute('aria-expanded', 'false');
    if (refocus) popBtn?.focus({ preventScroll: true });
    popFor = null; popBtn = null;
  };
  const openPop = (btn: HTMLElement): void => {
    const k = btn.closest<HTMLElement>('[data-dd]')!.dataset.dd as DdKey;
    if (popFor === k && !pop.hidden) { closePop(); return; }
    closePop();
    popFor = k; popBtn = btn; btn.setAttribute('aria-expanded', 'true');
    const cur = ddValue(k);
    pop.innerHTML = DD[k].map(o => `<div role="option" tabindex="-1" class="mgc__po${o.v === cur ? ' is-on' : ''}" data-v="${o.v}"${o.d ? ` title="${o.d}"` : ''} aria-selected="${o.v === cur}">${o.t}${lockMark(k, o.v)}</div>`).join('');
    pop.hidden = false;
    const r = btn.getBoundingClientRect(), vh = window.innerHeight, below = vh - r.bottom - 8, above = r.top - 8, up = below < 120 && above > below;
    pop.style.minWidth = Math.max(r.width, 64) + 'px'; pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4)) + 'px';
    pop.style.maxHeight = Math.max(80, Math.min(260, up ? above : below)) + 'px';
    if (up) { pop.style.top = ''; pop.style.bottom = (vh - r.top + 4) + 'px'; } else { pop.style.bottom = ''; pop.style.top = (r.bottom + 4) + 'px'; }
    (pop.querySelector<HTMLElement>('.is-on') ?? pop.firstElementChild as HTMLElement | null)?.focus({ preventScroll: false });
  };
  const lockMark = (k: DdKey, v: string): string => DEMO && ((k === 'style' && !LIMITS.mgcStyles.includes(v)) || (k === 'sound' && v !== 'piano') || (k === 'range' && +v !== 0)) ? ' 🔒' : '';
  const pickPop = (o: HTMLElement): void => {
    const k = popFor; if (!k) return; const v = o.dataset.v!;
    closePop(true);
    if (DEMO && ((k === 'style' && !LIMITS.mgcStyles.includes(v)) || (k === 'sound' && v !== 'piano') || (k === 'range' && +v !== 0))) { demoNotice(k === 'style' ? 'mgcstyle' : k === 'sound' ? 'mgcsound' : 'mgcrange'); return; }   // DEMO: pilihan terkunci
    if (k === 'range') { S.st.octave = +v; changed(); playChord(S.sel); return; }   // register chord pindah oktaf: keyboard digambar ulang, piano roll ikut, lalu contoh bunyi
    if (k === 'sound') { sound = v as Voice; renderControls(); playChord(S.sel); return; }   // suara preview saja: tidak mengubah progression, jadi tidak perlu commit
    if (k === 'style') S.rh.style = v as PlayStyle; else S.st.scale = v;
    changed(); popNotes(0, span(), 0); playChord(S.sel);   // contoh bunyi (satu bar, sesuai style): chord terpilih, atau C kalau masih kosong
  };
  pop.addEventListener('click', e => { const o = (e.target as HTMLElement).closest<HTMLElement>('.mgc__po'); if (o) pickPop(o); });
  pop.addEventListener('keydown', e => {
    e.stopPropagation();
    const items = [...pop.querySelectorAll<HTMLElement>('.mgc__po')], i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Enter' || e.key === ' ') { if (i >= 0) pickPop(items[i]); }
    else if (e.key === 'Escape' || e.key === 'Tab') closePop(true);
    else return;
    e.preventDefault();
  });
  pop.addEventListener('keyup', e => e.stopPropagation());
  el.addEventListener('pointerdown', e => { const t = e.target as HTMLElement; if (!pop.hidden && !t.closest('.mgc__pop') && !t.closest('.mgc__cdb')) closePop(); });
  window.addEventListener('resize', () => closePop());
  el.querySelectorAll<HTMLElement>('.mgc__cdb').forEach(b => {
    b.addEventListener('click', () => openPop(b));
    b.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); openPop(b); } });
  });

  function renderControls(): void {
    syncKb(); ddLabels();
    const ps = el.querySelector<HTMLSelectElement>('select[data-k="preset"]'); if (ps) ps.value = String(S.preset);
    $('.mgc__pname').textContent = S.preset >= 0 && PRESETS[S.preset] ? PRESETS[S.preset].name : 'New progression';
    const lb = $('[data-a="len"]'); lb.textContent = `${S.bars} Bars`; lb.dataset.s = String(S.bars === 4 ? 8 : 4);   // satu tombol: ketuk untuk pindah 4 <-> 8 bar
    el.querySelectorAll<HTMLElement>('[data-a="scale"]').forEach(b => b.classList.toggle('is-on', b.dataset.s === S.st.scale));
    $('.mgc__bpm').textContent = `${Math.round(bridge ? bridge.bpm() : 120)} BPM • ${NOTE_NAMES[S.st.root]} ${S.st.scale}`;
  }

  // ---------- animasi (dari video promo Remotion): hanya tampilan, tidak mengubah data / bunyi ----------
  const calm = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let popFrom = 0, popTo = 0, popAt = 0, popRaf = 0;   // nada piano roll di rentang ketukan [popFrom, popTo) muncul bertahap mulai popAt (ms)
  const POP_DUR = 260, POP_STEP = 55;
  const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const popNotes = (from: number, to: number, delay: number): void => {
    if (calm()) return;
    popFrom = from; popTo = to; popAt = performance.now() + delay;
    if (popRaf) return;
    const tick = (): void => {
      popRaf = 0; if (el.hidden) return;
      if (!playing) drawRoll();   // saat play, loop play sudah menggambar ulang
      if (performance.now() < popAt + POP_DUR + POP_STEP * 8) popRaf = requestAnimationFrame(tick);
    };
    popRaf = requestAnimationFrame(tick);
  };
  const flyChip = (from: HTMLElement, name: string, idx: number): void => {   // chip chord terbang dari tuts ke blok chord, blok lalu muncul 3D + menyala
    const blk = lane.querySelector<HTMLElement>(`.mgc__ch[data-i="${idx}"]`);
    if (!blk || calm() || !blk.animate) return;
    const a = from.getBoundingClientRect(), b = blk.getBoundingClientRect(), root = el.getBoundingClientRect();
    const x0 = a.left + a.width / 2 - root.left, y0 = a.top + a.height / 2 - root.top, x1 = b.left + b.width / 2 - root.left, y1 = b.top + b.height / 2 - root.top;
    const chip = document.createElement('div'); chip.className = 'mgc__chip'; chip.textContent = name; el.appendChild(chip);
    const FLY = 360, mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 36;
    const t = (x: number, y: number, sc: number): string => `translate(${x}px,${y}px) translate(-50%,-50%) scale(${sc})`;
    chip.animate([{ transform: t(x0, y0, .55), opacity: 0 }, { transform: t(mx, my, 1.05), opacity: 1, offset: .5 }, { transform: t(x1, y1, 1), opacity: 1, offset: .9 }, { transform: t(x1, y1, 1), opacity: 0 }],
      { duration: FLY, easing: 'cubic-bezier(.3,.7,.4,1)' }).onfinish = () => chip.remove();
    blk.animate([
      { filter: 'blur(7px)', transform: 'perspective(520px) rotateX(80deg) scale(.85)', opacity: 0, boxShadow: '0 0 0 rgba(255,255,255,0)' },
      { filter: 'blur(0)', transform: 'perspective(520px) rotateX(0) scale(1)', opacity: 1, boxShadow: '0 0 22px rgba(255,255,255,.9)', offset: .6 },
      { filter: 'blur(0)', transform: 'none', opacity: 1 }], { duration: 420, delay: FLY - 80, easing: 'ease-out', fill: 'backwards' });
  };

  // Piano roll terang (sama dengan video promo): latar #f6f9ff, baris tuts hitam samar, garis ketukan biru, nada gradasi biru (emas saat dimainkan), pasak oranye menggantung di batas chord
  function drawRoll(): void {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, W = Math.floor(r.width), H = Math.floor(r.height);
    if (W < 20 || H < 20) return;
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) { cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gh = H, tot = span(), x0 = KW, pw = W - KW, ppb = pw / tot;
    let lo = 127, hi2 = 0; for (const n of notes) { lo = Math.min(lo, n.p); hi2 = Math.max(hi2, n.p); }
    if (hi2 < lo) { lo = kbLo(); hi2 = lo + 24; }   // belum ada nada: tampilkan rentang keyboard yang dipilih
    lo -= 2; hi2 += 2; while (hi2 - lo < (gh < 120 ? 14 : 22)) { lo--; hi2++; }
    const rows = hi2 - lo + 1, rh = gh / rows, yOf = (p: number): number => (hi2 - p) * rh;
    g.fillStyle = '#f6f9ff'; g.fillRect(0, 0, W, H);
    for (let p = lo; p <= hi2; p++) {
      if (BLACK_PC.has(p % 12)) { g.fillStyle = 'rgba(63,111,216,.06)'; g.fillRect(x0, yOf(p), pw, rh); }
      if (p % 12 === 0) { g.fillStyle = 'rgba(63,111,216,.2)'; g.fillRect(x0, yOf(p) + rh - 1, pw, 1); }
    }
    let t = 0;
    S.slots.forEach((sl, i) => { if (i === S.sel) { g.fillStyle = 'rgba(63,111,216,.07)'; g.fillRect(x0 + t * ppb, 0, sl.beats * ppb, gh); } t += sl.beats; });
    for (let b = 0; b <= tot; b++) {   // garis per ketukan; garis bar lebih tebal
      const bar = b % 4 === 0, x = Math.round(x0 + b * ppb);
      g.fillStyle = bar ? 'rgba(63,111,216,.22)' : 'rgba(63,111,216,.08)'; g.fillRect(bar ? x - 1 : x, 0, bar ? 2 : 1, gh);
    }
    const nowMs = performance.now(); let pi = 0;
    for (const n of notes) {
      let x = x0 + n.s * ppb + 1, w = Math.max(5, n.l * ppb - 4), y = yOf(n.p) + 1, h = Math.max(2, rh - 2.5), born = 1;
      if (n.s >= popFrom && n.s < popTo && nowMs < popAt + POP_DUR + POP_STEP * 8) { born = easeOut((nowMs - popAt - Math.min(pi, 8) * POP_STEP) / POP_DUR); pi++; }   // muncul: turun dari atas + melebar + fade
      if (born < 1) { w *= Math.max(0.02, born); y -= (1 - born) * 18; }
      const act = phBeat >= 0 && phBeat >= n.s && phBeat < n.s + n.l;
      const glow = act ? Math.exp(-(phBeat - n.s) * 2.2) : 0;   // menyala kuat di awal nada lalu meredup, nada ikut sedikit membesar
      if (act) { const grow = h * 0.3 * glow; y -= grow / 2; h += grow; }
      const gr = g.createLinearGradient(0, y, 0, y + h);
      if (act) { gr.addColorStop(0, '#ffd77f'); gr.addColorStop(1, '#f2b632'); } else { gr.addColorStop(0, '#6f9cf5'); gr.addColorStop(1, '#3f6fd8'); }
      g.globalAlpha = (0.7 + 0.3 * n.v) * (0.55 + 0.45 * born); g.fillStyle = gr;
      g.shadowColor = act ? 'rgba(242,182,50,.9)' : 'rgba(63,111,216,.3)'; g.shadowBlur = act ? 8 + 14 * glow : 6; g.shadowOffsetY = act ? 0 : 2;
      g.beginPath(); g.roundRect(x, y, w, h, Math.min(3, rh / 2)); g.fill();
    }
    g.globalAlpha = 1; g.shadowBlur = 0; g.shadowOffsetY = 0;
    t = 0;
    for (const sl of S.slots) {   // pasak oranye di batas chord (bukan di awal progression)
      if (t > 0) { const x = Math.round(x0 + t * ppb); g.fillStyle = '#f2b632'; g.beginPath(); g.roundRect(x - 6, 0, 12, Math.min(26, H * 0.2), [0, 0, 6, 6]); g.fill(); }
      t += sl.beats;
    }
    if (!notes.length) { g.fillStyle = 'rgba(63,111,216,.55)'; g.font = '700 12px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Piano roll kosong — klik tuts keyboard di kanan', x0 + pw / 2, gh / 2); g.textAlign = 'start'; }
    if (phBeat >= 0) {
      const x = x0 + phBeat * ppb, tx = Math.max(x0, x - 130), tg = g.createLinearGradient(x - 130, 0, x, 0);
      tg.addColorStop(0, 'rgba(63,111,216,0)'); tg.addColorStop(1, 'rgba(63,111,216,.2)');
      g.fillStyle = tg; g.fillRect(tx, 0, x - tx, gh);
      g.fillStyle = '#3f6fd8'; g.shadowColor = 'rgba(63,111,216,.8)'; g.shadowBlur = 14; g.fillRect(x - 1.5, 0, 3, gh); g.shadowBlur = 0;
    }
  }
  const renderAll = (): void => { recompute(); renderControls(); renderLane(); drawRoll(); };
  refreshFn = () => { S.sel = S.slots.length ? clamp(S.sel, 0, S.slots.length - 1) : -1; if (!el.hidden) { renderAll(); } commit(); };
  const matchesPreset = (): boolean => { const p = PRESETS[S.preset]; return !!p && p.scale === S.st.scale && p.slots.length === S.slots.length && p.slots.every((d, i) => d === S.slots[i].deg && S.slots[i].beats === 4); };
  const changed = (): void => { S.preset = S.preset >= 0 && matchesPreset() ? S.preset : -1; renderAll(); commit(); };

  // ---------- preview ----------
  let bus: GainNode | null = null, t0 = 0, spb = 0.5, sched = 0, timer = 0;
  const quality = (): 'Major' | 'Minor' => (S.st.scale === 'Minor' ? 'Minor' : 'Major');   // pilihan dropdown Chord = mutu chord untuk tuts berikutnya
  const playChord = (i: number): void => {
    const c = ac(), t = c.currentTime + 0.02, spb = 60 / (bridge ? bridge.bpm() : 120);
    const sl: Slot = S.slots[i] ?? { deg: 0, beats: 4, root: 0, q: quality() };   // belum ada chord: dengarkan contoh C
    const b = c.createGain(); b.connect(out!);
    buildNotes(S.st, [sl], S.vc, S.rh).filter(n => n.s < 4).forEach(n => tone(c, b, n.p, t + n.s * spb, Math.min(n.l * spb, 1.8), n.v));   // satu bar pertama dengan pola style terpilih
    setTimeout(() => b.disconnect(), (4 * spb + 2.5) * 1000);
  };
  const setPlayUi = (on: boolean): void => {
    el.querySelectorAll<HTMLElement>('.mgc__go').forEach(b => { b.innerHTML = on ? ICON.stop : ICON.play; b.classList.toggle('is-on', on); });
    el.querySelectorAll<HTMLElement>('.mgc__mini').forEach(b => { b.innerHTML = on ? svg('<rect x="5" y="5" width="14" height="14" fill="currentColor" stroke="none"/>', 11) : ICON.playS; });
  };
  const startPlay = (): void => {
    const c = ac(); spb = 60 / (bridge ? bridge.bpm() : 120);
    bus = c.createGain(); bus.connect(out!); t0 = c.currentTime + 0.06; sched = 0; playing = true; setPlayUi(true);
    const pump = (): void => {
      const tot = span(), until = (c.currentTime + 0.25 - t0) / spb;
      for (let pass = Math.floor(sched / tot); pass <= Math.floor(until / tot); pass++) {
        for (const n of notes) {
          const s = pass * tot + n.s;
          if (s >= sched - 1e-9 && s < until) tone(c, bus!, n.p, t0 + s * spb, n.l * spb, n.v);
        }
      }
      sched = Math.max(sched, until);
    };
    pump(); timer = window.setInterval(pump, 50);
    const frame = (): void => {
      if (!playing) return;
      phBeat = ((ac().currentTime - t0) / spb) % span(); if (phBeat < 0) phBeat = 0;
      drawRoll(); raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };
  const stopPlay = (): void => {
    if (!playing) return;
    playing = false; clearInterval(timer); cancelAnimationFrame(raf); phBeat = -1;
    if (bus && actx) { bus.gain.setTargetAtTime(0, actx.currentTime, 0.03); const b = bus; setTimeout(() => b.disconnect(), 400); }
    bus = null; setPlayUi(false); drawRoll();
  };

  // ---------- aksi ----------
  const idxOf = (b: HTMLElement): number => +(b.closest<HTMLElement>('.mgc__ch')?.dataset.i ?? S.sel);
  const fitBars = (bars: number): void => {   // 4 / 8 bar: ubah panjang timeline; chord yang melewati batas baru dipotong
    S.bars = bars; const want = bars * 4, res: Slot[] = [];
    for (let t = 0; res.length < S.slots.length && t < want; ) { const b = Math.min(S.slots[res.length].beats, want - t); res.push({ ...S.slots[res.length], beats: b }); t += b; }   // (perbaikan: dulu t (ketukan) dibandingkan dengan jumlah chord, jadi ganti 4 <-> 8 bar menghapus chord, dan root / q chord ikut hilang)
    S.slots = res; S.sel = res.length ? Math.min(Math.max(S.sel, 0), res.length - 1) : -1;
  };
  const stepDeg = (b: HTMLElement, d: number): void => {   // chord naik / turun setengah nada (triad); chord diatonik lama: ganti derajat
    S.sel = idxOf(b); const sl = S.slots[S.sel];
    if (sl.root !== undefined) sl.root = mod(sl.root + d, 12); else sl.deg = mod(sl.deg + d, 7);
    changed(); playChord(S.sel);
  };
  const actions: Record<string, (b: HTMLElement) => void> = {
    close: () => close(),
    play: () => { if (playing) stopPlay(); else if (!notes.length) toastMsg('Belum ada chord — klik tuts keyboard di kanan'); else startPlay(); },
    pprev: () => { if (PRESETS.length) loadPreset(S.preset < 0 ? PRESETS.length - 1 : mod(S.preset - 1, PRESETS.length)); },
    pnext: () => { if (PRESETS.length) loadPreset(S.preset < 0 ? 0 : mod(S.preset + 1, PRESETS.length)); },
    'deg-': b => stepDeg(b, -1),
    'deg+': b => stepDeg(b, 1),
    len: b => { if (DEMO && +b.dataset.s! > LIMITS.mgcBars) { demoNotice('mgcbars'); return; } fitBars(+b.dataset.s!); changed(); },   // DEMO: hanya 4 bar
    scale: b => { S.st.scale = b.dataset.s!; changed(); playChord(S.sel); },
    clear: () => { if (!S.slots.length) return; stopPlay(); S.slots = []; S.sel = -1; S.preset = -1; changed(); },
    del: () => { if (S.sel < 0 || !S.slots[S.sel]) return; S.slots.splice(S.sel, 1); S.sel = S.slots.length ? Math.min(S.sel, S.slots.length - 1) : -1; changed(); },
    dice: () => { S.slots = randomProgression(clamp(S.bars * 4, 8, MAX_BEATS)).map(sl => { const sc = SCALES[quality()], r = sc[sl.deg], m3 = mod(sc[(sl.deg + 2) % 7] - r, 12); return { deg: sl.deg, beats: sl.beats, root: mod(r, 12), q: m3 === 4 ? 'Major' as const : 'Minor' as const }; }); S.sel = 0; S.preset = -1; changed(); playChord(0); },
    undo: () => { if (hi > 0) { hi--; restore(); } },
    redo: () => { if (hi < hist.length - 1) { hi++; restore(); } },
    midi: () => { if (!notes.length) { toastMsg('Belum ada chord untuk diunduh'); return; } const bpm = bridge ? bridge.bpm() : 120; if (DEMO) demoNotice('mgcmidi'); download(toMidi(midiNotes(), bpm), midiFile()); toastMsg('MIDI diunduh'); },
    save: () => {
      if (!notes.length) { toastMsg('Belum ada chord — klik tuts keyboard di kanan'); return; }
      const msg = bridge ? bridge.send(notes.map(n => ({ p: n.p, s: n.s, l: n.l, v: n.v })), span()) : 'Plugin belum tersambung ke timeline';
      toastMsg(msg ?? 'Nada dikirim ke pattern');
    },
  };
  function loadPreset(i: number): void {
    const p = PRESETS[i], bars = S.bars; S.preset = i; S.st.scale = p.scale; S.slots = slotsOf(p); S.sel = 0;
    S.bars = Math.max(4, Math.ceil(totalBeats(S.slots) / 4)); if (bars === 8) fitBars(8);
    renderAll(); commit(); playChord(0);
  }
  const midiNotes = (): OutNote[] => { if (!DEMO) return notes; const cap = totalBeats(S.slots.slice(0, LIMITS.mgcMidiChords)); return notes.filter(n => n.s < cap); };   // DEMO: MIDI hanya memuat chord pertama
  const midiFile = (): string => 'mgchord-' + (S.slots[0] ? slotChord(S.st, S.slots[0]).name : 'chords').replace('#', 's') + '.mid';
  const toastMsg = (m: string): void => {
    const t = document.createElement('div'); t.className = 'mgc__toast'; t.setAttribute('role', 'status'); t.textContent = m; win.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };
  const download = (data: Uint8Array, name: string): void => {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'audio/midi' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  el.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-a]'); if (b && actions[b.dataset.a!]) { actions[b.dataset.a!](b); return; }
    const ch = t.closest<HTMLElement>('.mgc__ch'); if (ch) { S.sel = +ch.dataset.i!; renderLane(); drawRoll(); playChord(S.sel); return; }
    if (t.closest('.mgc__back')) close();
  });
  el.addEventListener('change', e => {
    const s = e.target as HTMLSelectElement; if (!s.dataset.k) return;
    if (s.dataset.k === 'preset') { if (+s.value >= 0) loadPreset(+s.value); else { S.preset = -1; renderAll(); commit(); } }
  });
  // seret file .mid langsung ke DAW / folder (Chrome / Edge)
  $('.mgc__dnd').addEventListener('dragstart', e => {
    const url = URL.createObjectURL(new Blob([toMidi(midiNotes(), bridge ? bridge.bpm() : 120) as BlobPart], { type: 'audio/midi' }));
    e.dataTransfer?.setData('DownloadURL', `audio/midi:${midiFile()}:${url}`); setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  // ---------- seret hasil ke playlist ----------
  // Tahan ikon grip di kiri tombol X: jendela plugin menghilang, hanya ikon yang melayang mengikuti jari / kursor. Lepas di atas sebuah track di timeline =
  // hasil progression jadi pattern baru di bar tempat dilepas (lewat bridge.drop di main.ts). Pakai pointer events sendiri karena drag & drop HTML tidak jalan dengan sentuhan.
  const LIFT = 38;   // di layar sentuh ikon melayang di atas jari supaya tidak tertutup; titik jatuhnya = posisi ikon
  let dg: { id: number; x0: number; y0: number; touch: boolean; ghost: HTMLElement | null; over: HTMLElement | null } | null = null;
  const laneAt = (x: number, y: number): HTMLElement | null => {
    for (const n of document.elementsFromPoint(x, y)) {   // elemen pertama di bawah plugin (jendela yang disembunyikan tetap ikut hit-test, jadi dilewati); garis playhead juga dilewati
      if (n.closest('.mgc') || n.classList.contains('playhead')) continue;
      return n.closest<HTMLElement>('.lane');
    }
    return null;
  };
  const dgPoint = (e: PointerEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY - (dg?.touch ? LIFT : 0) });
  function dgMove(e: PointerEvent): void {
    if (!dg || e.pointerId !== dg.id) return;
    if (!dg.ghost) {
      if (Math.hypot(e.clientX - dg.x0, e.clientY - dg.y0) < 8) return;   // di bawah 8 px = ketukan biasa, jendela belum disembunyikan
      stopPlay(); closePop();
      const gh = document.createElement('div'); gh.className = 'mgc__ghost'; gh.innerHTML = ICON.drag; document.body.appendChild(gh);
      dg.ghost = gh; el.classList.add('is-dragout');
    }
    e.preventDefault();
    const p = dgPoint(e); dg.ghost.style.transform = `translate(${p.x - 20}px,${p.y - 20}px)`;
    const l = laneAt(p.x, p.y);
    if (l !== dg.over) { dg.over?.classList.remove('is-over'); l?.classList.add('is-over'); dg.over = l; dg.ghost.classList.toggle('is-hot', !!l); }
  }
  function dgEnd(e: PointerEvent): void {
    if (!dg || e.pointerId !== dg.id) return;
    const d = dg; dg = null;
    window.removeEventListener('pointermove', dgMove); window.removeEventListener('pointerup', dgEnd); window.removeEventListener('pointercancel', dgEnd);
    if (!d.ghost) { toastMsg('Tahan lalu seret ke track di timeline'); return; }   // ketukan tanpa geser
    d.over?.classList.remove('is-over'); d.ghost.remove(); el.classList.remove('is-dragout');
    const p = { x: e.clientX, y: e.clientY - (d.touch ? LIFT : 0) }, lane = e.type === 'pointerup' ? laneAt(p.x, p.y) : null;
    if (!lane) { toastMsg('Lepas di atas sebuah track di timeline'); return; }   // jatuh di tempat lain: jendela kembali
    const r = bridge ? bridge.drop(notes.map(n => ({ p: n.p, s: n.s, l: n.l, v: n.v })), span(), lane, p.x) : { ok: false, msg: 'Plugin belum tersambung ke timeline' };
    if (r.ok) close(); else toastMsg(r.msg);   // pattern sudah terpasang: plugin ditutup supaya hasilnya kelihatan (pesan sukses ditampilkan timeline)
  }
  $('.mgc__drag').addEventListener('pointerdown', e => {
    if (dg) return;
    e.preventDefault();
    if (!notes.length) { toastMsg('Belum ada chord — klik tuts keyboard di kanan'); return; }
    dg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', ghost: null, over: null };
    window.addEventListener('pointermove', dgMove, { passive: false }); window.addEventListener('pointerup', dgEnd); window.addEventListener('pointercancel', dgEnd);
  });
  // keyboard C5..C6: tekan = bunyi (lewat bus preview, jadi ikut tampil di waveform)
  const kbd = $('.mgc__kb');
  const playNote = (p: number): void => { const c = ac(), bb = c.createGain(); bb.connect(out!); tone(c, bb, p, c.currentTime + 0.01, 0.9, 0.8); setTimeout(() => bb.disconnect(), 2200); };
  const playKey = (k: HTMLElement): void => {   // klik tuts = tambah chord 3 batang (mayor / minor sesuai dropdown Chord) di nada itu, ke ujung progression; bunyinya hanya SATU nada (tuts yang ditekan), bukan pola style, supaya tidak bertabrakan dengan preview
    const pc = mod(+k.dataset.p!, 12), q = quality(), left = S.bars * 4 - totalBeats(S.slots);
    playNote(+k.dataset.p!);
    if (left <= 0) {
      toastMsg(`Progression penuh (${S.bars} bar) — pilih 8 bars atau hapus chord`); return;
    }
    const start = totalBeats(S.slots);
    S.slots.push({ deg: 0, beats: Math.min(4, left), root: pc, q }); S.sel = S.slots.length - 1; S.preset = -1; changed();
    flyChip(k, slotChord(S.st, S.slots[S.sel]).name, S.sel); popNotes(start, start + Math.min(4, left), 300);
  };
  const releaseKeys = (): void => keyEls.forEach(k => k.classList.remove('pressed'));
  kbd.addEventListener('pointerdown', e => { const k = (e.target as HTMLElement).closest<HTMLElement>('[data-p]'); if (!k) return; k.classList.add('pressed'); playKey(k); e.preventDefault(); });
  kbd.addEventListener('click', e => { const k = (e.target as HTMLElement).closest<HTMLElement>('[data-p]'); if (k && e.detail === 0) { k.classList.add('pressed'); playKey(k); setTimeout(releaseKeys, 150); } });   // aktivasi lewat keyboard fisik (Enter / Spasi)
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => kbd.addEventListener(ev, releaseKeys));
  $('.mgc__kbd').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { close(); e.preventDefault(); } });   // pintasan DAW tidak ikut jalan
  $('.mgc__kbd').addEventListener('keyup', e => e.stopPropagation());
  // klik di piano roll = pilih chord di posisi itu
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left - KW; if (x < 0) return;
    const beat = x / ((r.width - KW) / totalBeats(S.slots)); let t = 0;
    for (let i = 0; i < S.slots.length; i++) { t += S.slots[i].beats; if (beat < t) { S.sel = i; renderLane(); drawRoll(); playChord(i); return; } }
  });
  win.addEventListener('keydown', e => {
    e.stopPropagation();   // pintasan DAW (Spasi, panah) tidak ikut jalan selagi jendela terbuka
    const t = e.target as HTMLElement;
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && t.matches('.mgc__ch')) { S.sel = +t.dataset.i!; actions.del(win); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && t.matches('.mgc__ch, .mgc__h, .mgc__dnd')) { t.click(); e.preventDefault(); }
    else if (e.key === ' ' && !t.matches('button, select')) { actions.play(win); e.preventDefault(); }
  });
  win.addEventListener('keyup', e => e.stopPropagation());
  new ResizeObserver(() => { if (!el.hidden) drawRoll(); }).observe(cv);

  function close(): void {
    closePop(); stopPlay(); el.hidden = true; document.body.classList.remove('mgc-open');
    if (prevFocus instanceof HTMLElement && prevFocus.isConnected) prevFocus.focus({ preventScroll: true });
  }
  openFn = () => {
    prevFocus = document.activeElement; el.hidden = false; document.body.classList.add('mgc-open');
    ac();   // buat AudioContext + mulai muat sample piano sejak jendela dibuka (klik pembuka = gestur pengguna), supaya chord pertama sudah piano asli
    renderAll(); commit(); win.focus({ preventScroll: true }); requestAnimationFrame(drawRoll);
    if (!specRaf) specRaf = requestAnimationFrame(specLoop);
  };
}
