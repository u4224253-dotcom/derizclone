// Isi panel efek: tombol "+" bulat putih (di atas saat kosong, pindah ke bawah setelah ada efek), card gelap (gaya card track)
// untuk memilih efek, dan satu card per efek. Parameter diatur dengan knob seperti knob pan di channel mixer.
// Efek disimpan per track (kunci = id track); panel selalu menampilkan efek milik track yang sedang dipilih.
// Selain efek (Reverb, Equalizer, Filter) ada plugin instrumen (Supersaw): kartunya otomatis muncul di paling atas saat track synth dibuat,
// memakai knob + slider vertikal, dan tidak bisa dihapus / tidak muncul di daftar pilihan efek.
// Efek / plugin baru cukup ditambah ke EFFECTS (nama, parameter) dan ke applyAudio().
// DERIZ: plugin sampler dengan canvas audio (spektrogram, zoom) + upload file; nada (tuts + Pitch) dan kecepatan (Speed) terpisah (deriz-synth.ts).

import { setReverb, setEq, setFilter, setDeesser, setDelay, delayLevels, reverbSeconds, reverbPreSec, reverbToneHz, reverbLowHz, eqDb, EQ_BANDS, eqHz, eqFreqV, eqQ, eqQV, EQ_RANGE_DB, eqSpectrum, EQ_FFT_BINS, filterMode, filterHz, deesserHz, deesserThr, deesserMaxDb, decodeStandalone, trackInput } from './audio-engine';
import { DerizSynth } from './deriz-synth';
import { ivkKey } from './ivory-keys';
import { dbgSched, dbgSent, dbgSpec } from './audio-debug';
import { openMpcs } from './mpcs';
import { openCute } from './cute';
import { openDrums, DRUMS_HIDDEN } from './drums';

// MGCHORD gratis dan tampil di daftar plugin saat tombol "+" ditekan di tab Plugin (tekan-tahan "+" ~1,5 detik tetap jadi jalan pintas).
import { openMgchord } from './mgchord';
import { dragWindow } from './win-drag';
import { DEMO, LIMITS, demoNotice } from './demo';
import { isAudio, ACCEPT as AUDIO_ACCEPT } from './audio-upload-card';
import { setSupersaw, setDrums, detuneCents, cutoffHz, attackSec, decaySec, releaseSec } from './synth-engine';
import { velGain } from './velocity';
import { getMasterPitch, onMasterPitch } from './master-pitch';
import type { DelayParams } from './delay-fx';
import { EQ_COLORS, bandOf, bandVals, hitNode, hzAt, dbAt, paintEqCanvas, eqReadout, specActive, type EqSpec } from './eq-ui';
import { DELAY_PARAMS, delayHtml, paintDk, paintDelayUi, paintMeter, linkedPartner } from './delay-ui';

type FxType = 'reverb' | 'eq' | 'filter' | 'deesser' | 'delay' | 'supersaw' | 'deriz' | 'mpcs' | 'cute' | 'mgchord' | 'drums';
// DERIZ: audio yang di-upload ke canvas plugin (buffer disimpan untuk tahap berikutnya; peaks + max khusus untuk menggambar waveform)
interface DerizData { name: string; dur: number; buf: AudioBuffer; start: number; zoom: number; view: number; spec: Spec | null; busy?: number; }   // start: posisi garis start, 0..1 dari durasi; zoom >= 1: jendela terlihat = [view, view + 1/zoom] dari durasi; spec: spektrogram (null selagi dianalisis, busy = persen)
// Spektrogram: frames x ROWS nilai dB (0..255 = -100..0 dBFS), baris 0 = frekuensi terendah (skala log); lut = palet warna yang disesuaikan dengan level puncak
interface Spec { frames: number; hop: number; fmin: number; fmax: number; d: Uint8Array; lut: Uint32Array }   // cols: cache min/max per kolom pixel device (dihitung ulang hanya kalau lebar canvas berubah)   // start: posisi garis start, 0..1 dari durasi
interface Fx { id: number; type: FxType; on: boolean; min: boolean; tab?: number; v: Record<string, number>; deriz?: DerizData; tok?: number; }
interface Param { key: string; label: string; hint?: string; def: number; fmt: (v: number) => string; bipolar?: boolean; slider?: boolean; tab?: string; fmtFx?: (v: number, all: Record<string, number>) => string; steps?: number | ((all: Record<string, number>) => number); dk?: boolean; }   // fmtFx: format yang bergantung parameter lain; steps: posisi diskrit (0 = kontinu); dk: knob gaya Delay   // tab: nama kategori (plugin dengan tab)   // bipolar: arc dari tengah (seperti knob pan); slider: slider vertikal, bukan knob
interface EffectDef { type: FxType; name: string; params: Param[]; synth?: boolean; }   // synth: plugin instrumen (otomatis ada di track synth)

const svg = (inner: string, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICON_PAT = svg('<rect x="3" y="4.5" width="10" height="3.6" rx="1.3" fill="currentColor" stroke="none"/><rect x="8" y="10.2" width="13" height="3.6" rx="1.3" fill="currentColor" stroke="none"/><rect x="4.5" y="15.9" width="8.5" height="3.6" rx="1.3" fill="currentColor" stroke="none"/>', 18);   // blok nada ala piano roll: tombol masuk ke pattern
const ICON_OPEN = svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', 16);   // buka MPCS
const ICON_MORE = svg('<circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none"/>', 18);

const fmtDb = (v: number): string => { const d = Math.round(eqDb(v) * 10) / 10; return (d > 0 ? '+' : '') + d.toFixed(1) + ' dB'; };

const pct = (v: number): string => Math.round(v * 100) + '%';
const fmtSec = (s: number): string => (s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s');
const fmtHz = (hz: number): string => (hz >= 1000 ? (hz / 1000).toFixed(1) + ' kHz' : Math.round(hz) + ' Hz');
const fmtCut = (v: number): string => { const m = filterMode(v); return m === 'off' ? 'Off' : (m === 'lp' ? 'LP ' : 'HP ') + fmtHz(filterHz(v)); };   // knob Cutoff: kiri low-pass, kanan high-pass, tengah mati

const derizVol = (v: number | undefined): number => (v ?? 0.8) * 1.125;   // knob Volume: default 80% = penguatan 0.9 (sama seperti sebelumnya), 100% = 1.125
const derizPitch = (v: number | undefined): number => Math.round(((v ?? 0.5) - 0.5) * 24);   // knob Pitch: tengah = 0, kiri -12, kanan +12 semitone (bulat)
const derizSpeed = (v: number): number => 2 ** ((v - 0.5) * 2);   // knob Speed: tengah = 1×, kiri 0.5×, kanan 2× (kecepatan sample saja; nada tidak ikut berubah, diatur tuts + Pitch)

const EFFECTS: EffectDef[] = [
  {
    type: 'reverb', name: 'Reverb',
    params: [
      { key: 'mix', label: 'Mix', hint: 'Mix (campuran reverb)', def: 0.3, fmt: v => Math.round(v * 100) + '%' },
      { key: 'size', label: 'Size', hint: 'Size (lama gema)', def: 0.4, fmt: v => reverbSeconds(v).toFixed(1) + ' s' },
      { key: 'pre', label: 'Pre-Delay', hint: 'Pre-Delay (jeda sebelum gema)', def: 0, fmt: v => Math.round(reverbPreSec(v) * 1000) + ' ms' },
      { key: 'tone', label: 'Tone', hint: 'Tone (gelap / terang gema)', def: 1, fmt: v => fmtHz(reverbToneHz(v)) },
      { key: 'low', label: 'Low Cut', hint: 'Low Cut (buang bass gema)', def: 0, fmt: v => fmtHz(reverbLowHz(v)) }
    ]
  },
  {
    type: 'eq', name: 'Equalizer',   // 5 band (gain + frekuensi + Q) dan Output; kartunya punya grafik respons sendiri (eq-ui.ts)
    params: [
      ...EQ_BANDS.flatMap((b): Param[] => [
        { key: b.key, label: b.name + ' Gain', hint: b.name + ' (gain)', def: 0.5, bipolar: true, fmt: fmtDb },
        { key: b.key + 'F', label: b.name + ' Freq', hint: b.name + ' (frekuensi)', def: eqFreqV(b, b.def), fmt: v => fmtHz(eqHz(b, v)) },
        ...(b.q ? [{ key: b.key + 'Q', label: b.name + ' Q', hint: b.name + ' (lebar band)', def: eqQV(b.defQ), fmt: (v: number) => 'Q ' + eqQ(v).toFixed(2) }] : [])
      ]),
      { key: 'out', label: 'Output', hint: 'Output (level akhir EQ)', def: 0.5, bipolar: true, fmt: fmtDb }
    ]
  },
  {
    type: 'filter', name: 'Filter',
    params: [
      { key: 'cutoff', label: 'Cutoff', hint: 'Cutoff (kiri low-pass, kanan high-pass)', def: 0.5, bipolar: true, fmt: fmtCut },
      { key: 'reso', label: 'Reso', def: 0, fmt: pct }
    ]
  },
  {
    type: 'deesser', name: 'De-esser',
    params: [
      { key: 'freq', label: 'Freq', hint: 'Freq (batas bawah daerah desis)', def: 0.58, fmt: v => fmtHz(deesserHz(v)) },
      { key: 'thresh', label: 'Thresh', hint: 'Thresh (desis di atas level ini diredam)', def: 0.56, fmt: v => Math.round(deesserThr(v)) + ' dB' },
      { key: 'amount', label: 'Amount', hint: 'Amount (peredaman maksimum)', def: 0.5, fmt: v => v < 0.005 ? 'Off' : '\u2212' + Math.round(deesserMaxDb(v)) + ' dB' }
    ]
  },
  { type: 'delay', name: 'Delay', params: DELAY_PARAMS },   // Delay stereo (delay-fx.ts) dengan panel sendiri (delay-ui.ts), dibuka di tengah layar seperti DERIZ
  { type: 'deriz', name: 'DERIZ', params: [
    { key: 'speed', label: 'Speed', hint: 'Speed (kecepatan putar)', def: 0.5, bipolar: true, fmt: v => derizSpeed(v).toFixed(2) + '×' },
    { key: 'pitch', label: 'Pitch', hint: 'Pitch (nada, semitone)', def: 0.5, bipolar: true, fmt: v => { const n = derizPitch(v); return (n > 0 ? '+' : '') + n + ' st'; } },
    { key: 'volume', label: 'Volume', hint: 'Volume (level suara)', def: 0.8, fmt: pct }
  ], synth: true },   // plugin DERIZ: spektrogram + upload + knob; satu bawaan track DERIZ (dari "+ Tambahkan track"), sisanya bisa ditambah dari daftar efek (banyak DERIZ per track)
  { type: 'mpcs', name: 'MPCS', params: [], synth: true },
  { type: 'cute', name: 'CUTE', params: [], synth: true },   // plugin CUTE: pemotong audio; kartu ringkas, jendelanya terpisah (cute.ts)
  { type: 'mgchord', name: 'MGCHORD', params: [], synth: true },   // plugin MGCHORD: pembuat chord progression; kartu ringkas, editornya jendela terpisah (mgchord.ts)   // plugin MPCS: kartu ringkas di panel; editornya jendela terpisah (mpcs.ts), dibuka lewat kartu ini
  {   // plugin Drums: step sequencer di jendela terpisah (drums.ts); suara disintesis (drums-audio.ts). Pattern track ini dibunyikan sebagai hit drum
    type: 'drums', name: 'Drums', synth: true,
    params: [
      { key: 'level', label: 'Level', def: 0.8, slider: true, fmt: pct },
      { key: 'tune', label: 'Tune', def: 0.5, fmt: v => (v >= 0.5 ? '+' : '') + ((v - 0.5) * 12).toFixed(1) + ' st' },
      { key: 'decay', label: 'Decay', def: 0.5, fmt: v => (0.4 * Math.pow(6.25, v)).toFixed(2) + 'x' }
    ]
  },
  {
    type: 'supersaw', name: 'Supersaw', synth: true,
    params: [
      { key: 'detune', label: 'Detune', tab: 'OSC', def: 0.45, fmt: v => Math.round(detuneCents(v)) + ' ct' },
      { key: 'mix', label: 'Mix', tab: 'OSC', def: 0.6, fmt: pct },
      { key: 'level', label: 'Level', tab: 'OSC', def: 0.8, slider: true, fmt: pct },
      { key: 'cutoff', label: 'Cutoff', tab: 'FILTER', def: 0.78, fmt: v => fmtHz(cutoffHz(v)) },
      { key: 'reso', label: 'Reso', tab: 'FILTER', def: 0.15, slider: true, fmt: pct },
      { key: 'attack', label: 'Atk', tab: 'ENV', def: 0.05, slider: true, fmt: v => fmtSec(attackSec(v)) },
      { key: 'decay', label: 'Dec', tab: 'ENV', def: 0.4, slider: true, fmt: v => fmtSec(decaySec(v)) },
      { key: 'sustain', label: 'Sus', tab: 'ENV', def: 0.7, slider: true, fmt: pct },
      { key: 'release', label: 'Rel', tab: 'ENV', def: 0.35, slider: true, fmt: v => fmtSec(releaseSec(v)) }
    ]
  }
];
const defOf = (t: FxType) => EFFECTS.find(e => e.type === t)!;
const derizCount = (): number => { let n = 0; for (const r of racks.values()) for (const f of r) if (f.type === 'deriz') n++; return n; };   // jumlah plugin DERIZ di semua track (dipakai batas demo)
const derizNo = (id: number): number => { for (const r of racks.values()) { const k = r.filter(f => f.type === 'deriz').findIndex(f => f.id === id); if (k >= 0) return k + 1; } return 1; };   // urutan DERIZ di track-nya (1 = bawaan)

const racks = new Map<string, Fx[]>();   // id track -> efek miliknya
const plainOwner = new Map<string, number>();   // id track -> id DERIZ pemilik nada berkunci polos di pattern track itu (DERIZ pertama yang dibuat; -1 = sudah dihapus, tidak diwariskan)
let cur: string | null = null, seq = 0;

function applyAudio(track: string): void {
  const rack = racks.get(track) ?? [];
  const r = rack.find(f => f.type === 'reverb'), e = rack.find(f => f.type === 'eq'), fl = rack.find(f => f.type === 'filter'), ds = rack.find(f => f.type === 'deesser'), dl = rack.find(f => f.type === 'delay'), s = rack.find(f => f.type === 'supersaw'), dr = rack.find(f => f.type === 'drums');
  setReverb(track, r ? { on: r.on, mix: r.v.mix, size: r.v.size, pre: r.v.pre, tone: r.v.tone, low: r.v.low } : null);
  setEq(track, e ? { on: e.on, v: e.v } : null);
  setFilter(track, fl ? { on: fl.on, cutoff: fl.v.cutoff, reso: fl.v.reso } : null);
  setDeesser(track, ds ? { on: ds.on, freq: ds.v.freq, thresh: ds.v.thresh, amount: ds.v.amount } : null);
  setDelay(track, dl ? { on: dl.on, ...(dl.v as Omit<DelayParams, 'on'>) } : null);
  setDrums(track, dr ? { on: dr.on, level: dr.v.level, tune: dr.v.tune, decay: dr.v.decay, pads: Object.fromEntries(Object.entries(dr.v).filter(([k]) => k.startsWith('pad_')).map(([k, x]) => [k.slice(4), x])) } : null);
  setSupersaw(track, s ? { on: s.on, detune: s.v.detune, mix: s.v.mix, level: s.v.level, cutoff: s.v.cutoff, reso: s.v.reso, attack: s.v.attack, decay: s.v.decay, sustain: s.v.sustain, release: s.v.release } : null);
}

// ---------- knob (struktur & kelas sama dengan knob pan di channel mixer, tapi satu arah: 0 → 1) ----------
const KNOB_SWEEP = 270, ARC_LEN = 75, DRAG_PX = 90;   // sapuan 270° = 75 satuan dari keliling 100; DRAG_PX = jarak drag (px) untuk menempuh 0 → 1
const knobSvg = `<svg viewBox="0 0 36 36" aria-hidden="true" class="circular-chart">` +
  `<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dasharray="75, 100" class="circle-bg" style="transform-origin:18px 18px;transform:rotate(225deg)"></path>` +
  `<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dashoffset="0" stroke-dasharray="0 100" class="circle accent-on" style="transform:rotate(225deg)"></path>` +
  `<path d="M18 5.142857142857142 a 12.857142857142858 12.857142857142858 0 0 1 0 25.714285714285715 a 12.857142857142858 12.857142857142858 0 0 1 0 -25.714285714285715" fill="var(--background-tinted-press)" stroke="none" class="circle-inner"></path>` +
  `<path d="M18 5.7857142857142865 a 12.214285714285714 12.214285714285714 0 0 1 0 24.428571428571427 a 12.214285714285714 12.214285714285714 0 0 1 0 -24.428571428571427" stroke="var(--background-tinted-base)" fill="none" class="circle-inner-stroke"></path>` +
  `<path d="M 18 7.5 L 18 12" class="knob-pos" style="transform:rotate(-135deg)"></path></svg>`;

function paintKnob(el: HTMLElement, v: number, p: Param, name: string): void {
  (el.querySelector('.knob-pos') as SVGElement).style.transform = `rotate(${-KNOB_SWEEP / 2 + v * KNOB_SWEEP}deg)`;
  const arc = el.querySelector('.circle')!;
  if (p.bipolar) {   // arc dari tengah: ke kiri atau ke kanan, seperti knob pan
    const a = Math.min(v, 0.5) * ARC_LEN, b = Math.max(v, 0.5) * ARC_LEN;
    arc.setAttribute('stroke-dasharray', `0 ${a.toFixed(2)} ${(b - a).toFixed(2)} 100`);
  } else arc.setAttribute('stroke-dasharray', `${(v * ARC_LEN).toFixed(2)} 100`);
  el.setAttribute('aria-valuenow', v.toFixed(3));
  el.setAttribute('aria-valuetext', `${name} ${p.label} ${p.fmt(v)}`);
}

// slider vertikal: isi & posisi pegangan dikendalikan lewat variabel CSS --v (0..1)
function paintSlider(el: HTMLElement, v: number, p: Param, name: string): void {
  el.style.setProperty('--v', v.toFixed(3));
  el.setAttribute('aria-valuenow', v.toFixed(3));
  el.setAttribute('aria-valuetext', `${name} ${p.label} ${p.fmt(v)}`);
}
const paintCtl = (el: HTMLElement, v: number, p: Param, name: string, all?: Record<string, number>): void => (p.dk ? paintDk(el, v, p, all ?? {}) : (p.slider ? paintSlider : paintKnob)(el, v, p, name));
const CTL = '.knob-input, .vsl, .dk';   // knob, slider vertikal, atau knob Delay
const fmtOf = (fx: Fx, p: Param, v: number): string => (p.fmtFx ? p.fmtFx(v, fx.v) : p.fmt(v));
const snapVal = (fx: Fx, p: Param, n: number): number => { const k = typeof p.steps === 'function' ? p.steps(fx.v) : p.steps ?? 0; return k > 1 ? Math.round(n * (k - 1)) / (k - 1) : n; };   // posisi diskrit (Analog, mode)

const cellHtml = (d: EffectDef, fx: Fx, p: Param): string => p.slider
  ? `<div class="fxc__cell"><div role="slider" tabindex="0" class="vsl" data-k="${p.key}" aria-orientation="vertical" aria-label="${d.name} ${p.label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${fx.v[p.key]}">` +
    `<span class="vsl__fill"></span><span class="vsl__thumb"></span></div><span class="fxc__label">${p.label}</span></div>`
  : `<div class="fxc__cell"><div class="knob fxk"><div class="knob-inner">` +
    `<div role="slider" tabindex="0" class="knob-input" data-k="${p.key}" aria-label="${d.name} ${p.label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${fx.v[p.key]}">` +
    `<div class="knobwheel">${knobSvg}</div></div></div></div><span class="fxc__label">${p.label}</span></div>`;

// ---------- DERIZ: canvas audio ----------
const ICON_UP = svg('<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>', 16);
const ICON_POP = svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', 16);   // buka DERIZ di tengah layar
const ICON_X = svg('<path d="M6 6l12 12M18 6L6 18"/>', 16);
const esc = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmtPos = (s: number): string => { const q = Math.round(Math.max(0, s) * 10), m = Math.floor(q / 600), r = (q % 600) / 10; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); };   // m:ss.d
const posText = (z: DerizData | undefined): string => (z ? (z.busy !== undefined ? '' : 'Start ' + fmtPos(z.start * z.dur)) : 'Belum ada audio')   // selagi dimuat / dianalisis: tanpa teks, animasi ada di dalam canvas;
const visS = (z: DerizData): number => (z.start - z.view) * z.zoom;   // posisi garis start dalam jendela yang terlihat (bisa di luar 0..1 saat di-zoom)
const DERIZ_PAD = 6;   // jarak kiri/kanan canvas: garis start di 0 / 1 dan ujung waveform sejajar, pegangan tidak terpotong

// Tinggi isi sama dengan card knob (Reverb / EQ): canvas 72 px (= tinggi knob) + satu baris label, dalam wadah .fxc__knobs yang sama.
const dKnob = (fx: Fx, key: string): string => cellHtml(defOf('deriz'), fx, defOf('deriz').params.find(p => p.key === key)!);   // satu knob DERIZ berdasarkan key
function derizHtml(fx: Fx): string {
  const z = fx.deriz;
  return `<div class="fxc__knobs deriz"><div class="fxc__cell deriz__cell"><div class="deriz__row">` +
    `<div class="deriz__knobs">${dKnob(fx, 'speed')}${dKnob(fx, 'pitch')}</div>` +
    `<div class="deriz__stage${z ? ' has-audio' : ''}${z && z.busy !== undefined ? ' is-busy' : ''}" style="--s:${z ? visS(z).toFixed(4) : 0}"><canvas class="deriz__canvas" role="img" aria-label="Spektrogram audio DERIZ"></canvas>` +
    `<div class="deriz__start" role="slider" tabindex="0" aria-label="Garis start" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${z ? z.start.toFixed(4) : 0}" aria-valuetext="${posText(z)}"></div>` +
    `<button type="button" class="deriz__up">${ICON_UP}<span>Upload audio</span></button><i class="deriz__scan" aria-hidden="true"></i><i class="deriz__glass" aria-hidden="true"></i></div>` +
    `<div class="deriz__vol">${dKnob(fx, 'volume')}</div>` +
    `<div class="deriz__nav${z && z.zoom > 1.001 ? '' : ' is-idle'}" aria-hidden="true"><i class="deriz__thumb"${z ? ` style="left:${(z.view * 100).toFixed(3)}%;width:${(100 / z.zoom).toFixed(3)}%"` : ''}></i></div>` +
    `<button type="button" class="deriz__swap"${z ? '' : ' hidden'}>Ganti</button></div>` +
    `<div class="deriz__kb"><div class="ivk deriz__keys"><div class="ivk__keys"></div></div></div>` +
    `<input type="file" class="deriz__file" accept="${AUDIO_ACCEPT}" hidden></div></div>`;
}

const setBusy = (stage: HTMLElement, on: boolean): void => { stage.classList.toggle('is-busy', on); stage.setAttribute('aria-busy', String(on)); };   // animasi pemuatan di dalam canvas

function updateZoomUi(card: HTMLElement, z: DerizData | undefined): void {
  const stage = card.querySelector<HTMLElement>('.deriz__stage')!;
  stage.style.setProperty('--s', z ? visS(z).toFixed(4) : '0');
  card.querySelector('.deriz__nav')?.classList.toggle('is-idle', !z || z.zoom <= 1.001);   // bar di bawah canvas: aktif hanya saat di-zoom
  const th = card.querySelector<HTMLElement>('.deriz__thumb');
  if (th) { th.style.left = (z ? z.view * 100 : 0).toFixed(3) + '%'; th.style.width = (z ? 100 / z.zoom : 100).toFixed(3) + '%'; }
}

function updateDerizUi(card: HTMLElement, fx: Fx): void {
  const z = fx.deriz;
  card.querySelector('.deriz__stage')!.classList.toggle('has-audio', !!z);
  card.querySelector('.deriz__stage')!.classList.remove('is-loading');
  setBusy(card.querySelector<HTMLElement>('.deriz__stage')!, !!z && z.busy !== undefined);
  updateZoomUi(card, z);
  card.querySelector<HTMLElement>('.deriz__swap')!.hidden = !z;
}

// ---------- spektrogram: STFT (jendela Hann, FFT radix-2; dua frame nyata dikemas satu FFT kompleks), frekuensi skala log ----------
const SPEC_ROWS = 288, SPEC_FMIN = 30, SPEC_RANGE = 72;   // jumlah baris, frekuensi terendah (Hz), rentang dB yang diwarnai di bawah puncak
const PALETTE: [number, number[]][] = [[0, [2, 4, 10]], [.3, [8, 40, 70]], [.6, [40, 170, 205]], [.85, [190, 240, 255]], [1, [255, 255, 255]]];   // hitam -> biru -> cyan -> putih

function makeLut(topV: number): Uint32Array {
  const lut = new Uint32Array(256), top = topV / 2.55 - 100;
  for (let v = 0; v < 256; v++) {
    const t = Math.pow(Math.max(0, Math.min(1, (v / 2.55 - 100 - (top - SPEC_RANGE)) / SPEC_RANGE)), 1.15);
    let k = 1; while (k < PALETTE.length - 1 && PALETTE[k][0] < t) k++;
    const [t0, c0] = PALETTE[k - 1], [t1, c1] = PALETTE[k], u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const ch = (i: number): number => Math.round(c0[i] + (c1[i] - c0[i]) * u);
    lut[v] = (255 << 24) | (ch(2) << 16) | (ch(1) << 8) | ch(0);   // RGBA little-endian
  }
  return lut;
}

// Analisis spektrogram hanya tampilan, tapi berat (FFT ribuan frame per sample). Saat Play ditahan (holdSpec dari transport) supaya main thread
// dan CPU HP dipakai untuk suara; dilanjutkan setelah Stop. Irisan kerja 6 ms (dulu 12 ms) supaya render dan penjadwal tidak tertahan lama.
let specHold = false;
export function holdSpec(v: boolean): void { specHold = v; }
// Analisis di latar (diselingi yield supaya UI tidak macet). alive() false = dibatalkan -> null.
async function computeSpec(buf: AudioBuffer, onProgress: (pct: number) => void, alive: () => boolean): Promise<Spec | null> {
  const len = buf.length, sr = buf.sampleRate, hop = Math.max(256, Math.ceil(len / 12000)), frames = Math.floor(len / hop) + 1;
  const N = frames <= 4000 ? 4096 : 2048, half = N / 2, R = SPEC_ROWS;
  const fmax = Math.min(20000, sr / 2 * 0.99), binHz = sr / N;
  // tabel FFT + jendela Hann
  const rev = new Uint16Array(N), cs = new Float32Array(half), sn = new Float32Array(half), win = new Float32Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N); }
  for (let k = 0; k < half; k++) { cs[k] = Math.cos(2 * Math.PI * k / N); sn[k] = Math.sin(2 * Math.PI * k / N); }
  // pemetaan baris (log) -> bin: rentang sempit diinterpolasi, rentang lebar diambil nilai maksimumnya
  const ratio = fmax / SPEC_FMIN, posOf = (r: number): number => SPEC_FMIN * Math.pow(ratio, r / (R - 1)) / binHz;
  const rLo = new Int32Array(R), rHi = new Int32Array(R), rFr = new Float32Array(R);
  for (let r = 0; r < R; r++) {
    const e0 = posOf(r - .5), e1 = posOf(r + .5), c = posOf(r);
    if (e1 - e0 < 1) { rLo[r] = Math.min(half - 1, Math.floor(c)); rFr[r] = c - rLo[r]; rHi[r] = -1; }
    else { rLo[r] = Math.max(0, Math.floor(e0)); rHi[r] = Math.min(half, Math.ceil(e1)); }
  }
  const d = new Uint8Array(frames * R), hist = new Float64Array(256), re = new Float32Array(N), im = new Float32Array(N);
  const m1 = new Float32Array(half + 1), m2 = new Float32Array(half + 1), norm = 1 / ((N / 4) * (N / 4)), nch = buf.numberOfChannels;
  const chans: Float32Array[] = []; for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
  const fill = (f: number, out: Float32Array): void => {
    const st = f * hop - half;
    for (let n = 0; n < N; n++) {
      const i = st + n; let v = 0;
      if (i >= 0 && i < len) { for (let c = 0; c < nch; c++) v += chans[c][i]; v /= nch; }
      out[n] = v * win[n];
    }
  };
  const x1 = new Float32Array(N), x2 = new Float32Array(N);
  const rows = (m: Float32Array, f: number): void => {
    for (let r = 0; r < R; r++) {
      let v: number;
      if (rHi[r] < 0) v = m[rLo[r]] * (1 - rFr[r]) + m[rLo[r] + 1] * rFr[r];
      else { v = 0; for (let i = rLo[r]; i < rHi[r]; i++) if (m[i] > v) v = m[i]; }
      const q = Math.max(0, Math.min(255, Math.round((10 * Math.log10(v * norm + 1e-12) + 100) * 2.55)));
      d[f * R + r] = q; hist[q]++;
    }
  };
  let t0 = performance.now();
  for (let f = 0; f < frames; f += 2) {
    const two = f + 1 < frames;
    fill(f, x1); if (two) fill(f + 1, x2); else x2.fill(0);
    for (let i = 0; i < N; i++) { re[rev[i]] = x1[i]; im[rev[i]] = x2[i]; }
    for (let size = 2; size <= N; size <<= 1) {
      const h = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < h; j++, k += step) {
        const a = i + j, b = a + h, tr = re[b] * cs[k] + im[b] * sn[k], ti = im[b] * cs[k] - re[b] * sn[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let k = 0; k <= half; k++) {   // pisahkan dua spektrum nyata dari satu FFT kompleks
      const kk = (N - k) % N, ar = (re[k] + re[kk]) / 2, ai = (im[k] - im[kk]) / 2, br = (im[k] + im[kk]) / 2, bi = -(re[k] - re[kk]) / 2;
      m1[k] = ar * ar + ai * ai; m2[k] = br * br + bi * bi;
    }
    rows(m1, f); if (two) rows(m2, f + 1);
    if (performance.now() - t0 > 6) {
      onProgress(Math.min(99, Math.round(100 * f / frames)));
      dbgSpec(performance.now() - t0, specHold);
      while (specHold && alive()) await new Promise<void>(r => setTimeout(r, 250));   // sedang Play: tunggu
      await new Promise<void>(r => setTimeout(r, 0));
      if (!alive()) return null;
      t0 = performance.now();
    }
  }
  let acc = 0, top = 255; const lim = frames * R * 0.0005;   // puncak = persentil 99,95 supaya satu klik keras tidak meredupkan semuanya
  for (; top > 0; top--) { acc += hist[top]; if (acc >= lim) break; }
  return { frames, hop, fmin: SPEC_FMIN, fmax, d, lut: makeLut(top) };
}

function paintDeriz(card: HTMLElement, fx: Fx): void {
  const cv = card.querySelector<HTMLCanvasElement>('.deriz__canvas');
  if (!cv) return;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const gl = Math.max(1, Math.round(dpr)), z = fx.deriz, sp = z?.spec;
  if (!z || !sp) {   // belum ada audio / masih dianalisis: grid layar kosong
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 1; i < 8; i++) g.fillRect(Math.round(W * i / 8), 0, gl, H);
    g.fillRect(0, Math.round(H * .25), W, gl); g.fillRect(0, Math.round(H * .75), W, gl);
    const cl = g.createLinearGradient(0, 0, W, 0);
    cl.addColorStop(0, 'rgba(255,255,255,0)'); cl.addColorStop(.5, 'rgba(255,255,255,.26)'); cl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cl; g.fillRect(0, Math.round(H / 2 - gl / 2), W, gl);
    return;
  }
  const pad = Math.round(DERIZ_PAD * dpr), cols = Math.max(1, W - pad * 2), R = SPEC_ROWS, d = sp.d, lut = sp.lut;
  const img = g.createImageData(cols, H), px = new Uint32Array(img.data.buffer);
  const s0 = z.view * z.buf.length, span = z.buf.length / z.zoom, vec = new Float32Array(R);
  const rA = new Int32Array(H), rT = new Float32Array(H);   // baris layar -> baris spektrogram (0 = frekuensi terendah, di bawah)
  for (let y = 0; y < H; y++) { const rp = Math.max(0, Math.min(R - 1, (1 - (y + .5) / H) * (R - 1))); rA[y] = Math.min(R - 2, Math.floor(rp)); rT[y] = rp - rA[y]; }
  for (let x = 0; x < cols; x++) {
    const p0 = (s0 + x / cols * span) / sp.hop, p1 = (s0 + (x + 1) / cols * span) / sp.hop;
    if (p1 - p0 > 1) {   // zoom out: banyak frame per kolom -> ambil yang paling keras (transien tidak hilang)
      const a = Math.max(0, Math.min(sp.frames - 1, Math.floor(p0))), b = Math.max(a, Math.min(sp.frames - 1, Math.ceil(p1)));
      vec.fill(0);
      for (let f = a; f <= b; f++) for (let r = 0, o = f * R; r < R; r++) if (d[o + r] > vec[r]) vec[r] = d[o + r];
    } else {   // zoom in: interpolasi linear antar dua frame
      const p = Math.max(0, Math.min(sp.frames - 1, (p0 + p1) / 2)), fa = Math.min(sp.frames - 1, Math.floor(p)), fb = Math.min(sp.frames - 1, fa + 1), ft = p - fa;
      for (let r = 0; r < R; r++) vec[r] = d[fa * R + r] * (1 - ft) + d[fb * R + r] * ft;
    }
    for (let y = 0; y < H; y++) { const a = rA[y], v = vec[a] * (1 - rT[y]) + vec[a + 1] * rT[y]; px[y * cols + x] = lut[v | 0]; }
  }
  g.putImageData(img, pad, 0);
  // sumbu frekuensi (100 Hz, 1 kHz, 10 kHz)
  g.font = `${Math.round(9 * dpr)}px system-ui, sans-serif`; g.textBaseline = 'bottom';
  for (const [f, label] of [[100, '100'], [1000, '1k'], [10000, '10k']] as [number, string][]) {
    if (f <= sp.fmin || f >= sp.fmax) continue;
    const y = Math.round((1 - Math.log(f / sp.fmin) / Math.log(sp.fmax / sp.fmin)) * H);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(pad, y, cols, gl);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillText(label, pad + 4 * dpr, y - 2 * dpr);
  }
}

const tabNames = (d: EffectDef): string[] => [...new Set(d.params.map(p => p.tab).filter((t): t is string => !!t))];

type FxPage = 'plugin' | 'effect';   // halaman panel: Plugin (VST / instrumen: DERIZ, Supersaw) dan Effect (Reverb, EQ, Filter, dll.)
const pageOf = (type: FxType): FxPage => (defOf(type).synth ? 'plugin' : 'effect');

// ---------- Equalizer: grafik + pilih band + knob band terpilih (Freq / Gain / Q) + Output ----------
function eqCell(d: EffectDef, fx: Fx, p: Param, cap: string): string {
  return `<div class="fxc__cell"><div class="knob fxk"><div class="knob-inner">` +
    `<div role="slider" tabindex="0" class="knob-input" data-k="${p.key}" aria-label="${d.name} ${p.label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${fx.v[p.key]}">` +
    `<div class="knobwheel">${knobSvg}</div></div></div></div><span class="fxc__label">${cap}</span><span class="eq__val" data-v="${p.key}"></span></div>`;
}
function eqKnobsHtml(d: EffectDef, fx: Fx): string {
  const b = EQ_BANDS[bandOf(fx)], par = (k: string): Param => d.params.find(x => x.key === k)!;
  return eqCell(d, fx, par(b.key + 'F'), 'Freq') + eqCell(d, fx, par(b.key), 'Gain') +
    (b.q ? eqCell(d, fx, par(b.key + 'Q'), 'Q') : `<div class="fxc__cell eq__noq" aria-hidden="true"><div class="knob fxk"></div><span class="fxc__label">Q</span><span class="eq__val">&nbsp;</span></div>`) +
    eqCell(d, fx, par('out'), 'Output');
}
function eqHtml(fx: Fx, d: EffectDef): string {
  const sel = bandOf(fx);
  // satu panel: grafik di atas, bar band + knob di bawah, semuanya di dalam kartu
  return `<div class="eq"><div class="eq__graph"><canvas class="eq__cv" role="img" aria-label="Grafik respons Equalizer dengan spektrum audio: seret titik untuk mengatur frekuensi dan gain"></canvas>` +
    `<div class="eq__bar" style="--c:${EQ_COLORS[sel]}">` +
    `<div class="eq__bands" role="tablist" aria-label="Band Equalizer">${EQ_BANDS.map((b, i) =>
      `<button type="button" role="tab" class="eq__band" data-band="${i}" aria-selected="${i === sel}" style="--c:${EQ_COLORS[i]}"><i aria-hidden="true"></i>${b.short}</button>`).join('')}</div>` +
    `<div class="fxc__knobs eq__knobs">${eqKnobsHtml(d, fx)}</div></div></div></div>`;
}
// spektrum hidup di belakang kurva: dibaca tiap frame oleh loop di initFxRack (specKick menyalakannya)
let specNow: EqSpec | null = null;
let specKick: () => void = () => { /* diisi initFxRack */ };
function paintEqSpec(card: HTMLElement, fx: Fx): void {   // hanya canvas (dipakai tiap frame)
  const cv = card.querySelector<HTMLCanvasElement>('.eq__cv'); if (cv) paintEqCanvas(cv, fx.v, fx.on, bandOf(fx), specNow);
}
function paintEq(card: HTMLElement, fx: Fx): void {
  const cv = card.querySelector<HTMLCanvasElement>('.eq__cv'); if (!cv) return;
  const sel = bandOf(fx), d = defOf('eq');
  paintEqCanvas(cv, fx.v, fx.on, sel, specNow);
  const rd = card.querySelector('.eq__read'); if (rd) rd.textContent = eqReadout(fx.v, sel);
  card.querySelectorAll<HTMLElement>('.eq__band').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.band! === sel)));
  card.querySelector<HTMLElement>('.eq__bar')?.style.setProperty('--c', EQ_COLORS[sel]);
  card.querySelectorAll<HTMLElement>('.eq__val[data-v]').forEach(e => { const p = d.params.find(x => x.key === e.dataset.v); if (p) e.textContent = p.fmt(fx.v[p.key]); });
  specKick();
}

// ---------- Reverb: unit ala "tape" (panel hitam dengan dua reel + kurva gema di atas, panel putih dengan knob Mix besar di bawah) ----------
const RV_REEL = (cx: number): string => `<g class="rv__reel"><circle cx="${cx}" cy="32" r="22"/><circle cx="${cx}" cy="32" r="5"/>` +
  [0, 120, 240].map(a => { const r = a * Math.PI / 180, x1 = cx + Math.sin(r) * 7, y1 = 32 - Math.cos(r) * 7, x2 = cx + Math.sin(r) * 19, y2 = 32 - Math.cos(r) * 19; return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join('') + `</g>`;
function rvKnob(d: EffectDef, fx: Fx, key: string, cap: string, cls: string): string {
  const p = d.params.find(x => x.key === key)!;
  return `<div class="fxc__cell rv__cell ${cls}"><div class="knob fxk"><div class="knob-inner">` +
    `<div role="slider" tabindex="0" class="knob-input" data-k="${p.key}" aria-label="${d.name} ${p.label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${fx.v[p.key]}">` +
    `<div class="knobwheel">${knobSvg}</div></div></div></div><span class="fxc__label">${cap}</span><span class="rv__val" data-v="${p.key}"></span></div>`;
}
function reverbHtml(fx: Fx, d: EffectDef): string {
  return `<div class="rv"><div class="rv__unit"><div class="rv__top"><svg viewBox="0 0 240 64" aria-hidden="true">` +
    `<path class="rv__tape" d="M60 54 Q60 61 67 61 H173 Q180 61 180 54"/>${RV_REEL(60)}${RV_REEL(180)}<path class="rv__dec" d=""/></svg></div>` +
    `<div class="rv__main"><span class="rv__wm" aria-hidden="true">REVERB</span>` +
    rvKnob(d, fx, 'pre', 'Pre', 'rv__small') + rvKnob(d, fx, 'size', 'Size', 'rv__small') + rvKnob(d, fx, 'mix', 'Mix', 'rv__big') +
    rvKnob(d, fx, 'tone', 'Tone', 'rv__small') + rvKnob(d, fx, 'low', 'Low Cut', 'rv__small') + `</div></div></div>`;
}
function paintRv(card: HTMLElement, fx: Fx): void {
  const d = defOf('reverb');
  card.querySelectorAll<HTMLElement>('.rv__val[data-v]').forEach(e => { const p = d.params.find(x => x.key === e.dataset.v); if (p) e.textContent = p.fmt(fx.v[p.key]); });
  const path = card.querySelector<SVGPathElement>('.rv__dec'); if (!path) return;
  // kurva gema: amplitudo meluruh eksponensial selama RT60 (jendela 5 detik), digambar simetris di antara dua reel
  const rt = reverbSeconds(fx.v.size), pre = Math.max(0, Math.min(1, fx.v.pre ?? 0)), N = 32, x0 = 90 + pre * 14, W = 60 - pre * 14, top: string[] = [], bot: string[] = [];
  for (let i = 0; i <= N; i++) { const t = i / N, a = Math.exp(-6.9 * (t * 5) / rt), x = (x0 + t * W).toFixed(1); top.push(`${x} ${(32 - 17 * a).toFixed(1)}`); bot.unshift(`${x} ${(32 + 17 * a).toFixed(1)}`); }
  path.setAttribute('d', 'M' + top.join(' L') + ' L' + bot.join(' L') + ' Z');
  path.style.opacity = String(0.4 + 0.6 * Math.max(0, Math.min(1, fx.v.mix)));
}

function cardHtml(fx: Fx, i: number): string {
  if (fx.type === 'mgchord') {   // MGCHORD: kartu ringkas (judul + buka + titik tiga); isinya ada di jendela MGCHORD
    return `<section class="fxc fxc--mgchord" data-fx="${fx.id}" data-kind="plugin" style="--i:${i}" aria-label="MGCHORD">` +
      `<header class="fxc__head"><i class="fxc__led" aria-hidden="true"></i><h3 class="fxc__name"><button type="button" class="fxc__title fxc__mg" title="Buka MGCHORD">MGCHORD</button></h3>` +
      `<button type="button" class="fxc__open fxc__mg" aria-label="Buka MGCHORD" title="Buka MGCHORD">${ICON_OPEN}</button>` +
      `<button type="button" class="fxc__more" aria-haspopup="menu" aria-expanded="false" aria-label="Opsi MGCHORD" title="Opsi">${ICON_MORE}</button></header></section>`;
  }
  if (fx.type === 'mpcs') {   // MPCS: kartu ringkas (judul + buka + titik tiga); isinya ada di jendela MPCS
    return `<section class="fxc fxc--mpcs" data-fx="${fx.id}" data-kind="plugin" style="--i:${i}" aria-label="MPCS">` +
      `<header class="fxc__head"><i class="fxc__led" aria-hidden="true"></i><h3 class="fxc__name"><button type="button" class="fxc__title fxc__mp" title="Buka MPCS">MPCS</button></h3>` +
      `<button type="button" class="fxc__open fxc__mp" aria-label="Buka MPCS" title="Buka MPCS">${ICON_OPEN}</button>` +
      `<button type="button" class="fxc__more" aria-haspopup="menu" aria-expanded="false" aria-label="Opsi MPCS" title="Opsi">${ICON_MORE}</button></header></section>`;
  }
  if (fx.type === 'cute') {   // CUTE: kartu ringkas (judul + buka + titik tiga); isinya ada di jendela CUTE
    return `<section class="fxc fxc--cute" data-fx="${fx.id}" data-kind="plugin" style="--i:${i}" aria-label="CUTE">` +
      `<header class="fxc__head"><i class="fxc__led" aria-hidden="true"></i><h3 class="fxc__name"><button type="button" class="fxc__title fxc__cu" title="Buka CUTE">CUTE</button></h3>` +
      `<button type="button" class="fxc__open fxc__cu" aria-label="Buka CUTE" title="Buka CUTE">${ICON_OPEN}</button>` +
      `<button type="button" class="fxc__more" aria-haspopup="menu" aria-expanded="false" aria-label="Opsi CUTE" title="Opsi">${ICON_MORE}</button></header></section>`;
  }
  if (fx.type === 'delay') {   // kartu ringkas di panel; panel penuh (.dly) baru tampil saat kartu dibuka di overlay
    return `<section class="fxc fxc--delay${fx.on ? '' : ' is-off'}${fx.min ? ' is-min' : ''}" data-fx="${fx.id}" data-kind="effect" style="--i:${i}" aria-label="Delay">` +
      `<header class="fxc__head"><h3 class="fxc__name"><button type="button" class="fxc__title" aria-expanded="${!fx.min}" title="Klik untuk minimize / maximize">Delay</button></h3>` +
      `<button type="button" class="fxc__pwr" role="switch" aria-checked="${fx.on}" aria-label="Delay nyala / mati" title="Nyala / mati"></button>` +
      `<button type="button" class="fxc__pop" aria-label="Buka Delay di tengah layar" title="Buka di tengah layar">${ICON_POP}</button>` +
      `<button type="button" class="fxc__close" aria-label="Tutup Delay" title="Tutup (Esc)">${ICON_X}</button>` +
      `<button type="button" class="fxc__more" aria-haspopup="menu" aria-expanded="false" aria-label="Opsi Delay" title="Opsi">${ICON_MORE}</button></header>` +
      `<div class="fxc__collapse"><div class="fxc__body">${delayHtml()}</div></div></section>`;
  }
  const d = { ...defOf(fx.type) }; if (fx.type === 'deriz') { const no = derizNo(fx.id); if (no > 1) d.name += ' ' + no; }
  const tabs = tabNames(d), cur = Math.min(fx.tab ?? 0, Math.max(0, tabs.length - 1));
  // plugin dengan kategori: tab di baris judul (tinggi card tetap sama dengan Reverb / EQ), tiap tab punya panel kontrolnya sendiri
  const tabBar = tabs.length
    ? `<div class="fxc__tabs" role="tablist" aria-label="Kategori ${d.name}">` +
      tabs.map((t, k) => `<button type="button" role="tab" class="fxc__tab" data-tab="${k}" aria-selected="${k === cur}">${t}</button>`).join('') + `</div>`
    : '';
  const body = fx.type === 'deriz' ? derizHtml(fx) : fx.type === 'eq' ? eqHtml(fx, d) : fx.type === 'reverb' ? reverbHtml(fx, d) : tabs.length
    ? tabs.map((t, k) => `<div class="fxc__knobs fxc__panel" role="tabpanel" data-tab="${k}"${k === cur ? '' : ' hidden'}>${d.params.filter(p => p.tab === t).map(p => cellHtml(d, fx, p)).join('')}</div>`).join('')
    : `<div class="fxc__knobs">${d.params.map(p => cellHtml(d, fx, p)).join('')}</div>`;
  return `<section class="fxc${fx.on ? '' : ' is-off'}${fx.min ? ' is-min' : ''}${tabs.length ? ' has-tabs' : ''}${fx.type === 'deriz' ? ' fxc--deriz' : ''}${fx.type === 'eq' ? ' fxc--eq' : ''}${fx.type === 'reverb' ? ' fxc--rv' : ''}" data-fx="${fx.id}" data-kind="${pageOf(fx.type)}" style="--i:${i}" aria-label="${d.name}">` +
    `<header class="fxc__head"><h3 class="fxc__name"><button type="button" class="fxc__title" aria-expanded="${!fx.min}" title="Klik untuk minimize / maximize">${d.name}</button></h3>${tabBar}` +
    (fx.type === 'drums' ? `<button type="button" class="fxc__open fxc__dr" aria-label="Buka step sequencer Drums" title="Buka step sequencer Drums">${ICON_OPEN}</button>` : '') +
    (fx.type === 'deriz' ? `<button type="button" class="fxc__pat" aria-haspopup="menu" aria-expanded="false" aria-label="Pattern: tarik ke piano roll, atau klik untuk memilih pattern" title="Tarik & lepas ke piano roll (atau klik untuk pilih pattern)">${ICON_PAT}</button>` : '') +
    `<button type="button" class="fxc__pwr" role="switch" aria-checked="${fx.on}" aria-label="${d.name} nyala / mati" title="Nyala / mati"></button>` +
    (fx.type === 'deriz' || fx.type === 'eq' || fx.type === 'reverb' ? `<button type="button" class="fxc__pop" aria-label="Buka ${d.name} di tengah layar" title="Maximize (buka di tengah layar)">${ICON_POP}</button><button type="button" class="fxc__close" aria-label="Tutup ${d.name}" title="Tutup (Esc)">${ICON_X}</button>` : '') +
    (d.synth && fx.type !== 'deriz' && fx.type !== 'drums' ? '' : `<button type="button" class="fxc__more" aria-haspopup="menu" aria-expanded="false" aria-label="Opsi ${d.name}" title="Opsi">${ICON_MORE}</button>`) + `</header>` +
    `<div class="fxc__collapse"><div class="fxc__body">${body}</div></div></section>`;
}

// Keadaan satu DERIZ untuk disimpan / dibuka di file project (audio ikut: buf)
export interface DerizSaved { on: boolean; v: Record<string, number>; z?: { name: string; start: number; zoom: number; view: number; buf: AudioBuffer } }

// Parameter efek yang bisa diotomasi (knob / slider): dipakai Automation Clip
export interface AutoTarget { track: string; fxId: number; key: string; fxName: string; label: string }
export interface AutoParamInfo { fxName: string; label: string; def: number; bipolar: boolean; fmt(v: number): string }
// Keadaan satu efek non-DERIZ (Reverb, EQ, Filter, Supersaw) untuk file project
export interface FxSaved { type: string; on: boolean; v: Record<string, number>; min?: boolean; tab?: number; at?: number }   // min: kartu diminimize; tab: tab Supersaw yang terbuka; at: urutan kartu di track (DERIZ ikut dihitung)

export interface FxRack {
  onTouch(cb: (t: AutoTarget) => void): void;   // dipanggil tiap pengguna memutar knob / slider (bukan saat automation berjalan)
  lastTouched(): AutoTarget | null;             // knob terakhir yang diputar pengguna, null kalau efeknya sudah dihapus
  paramInfo(track: string, fxId: number, key: string): AutoParamInfo | null;   // null = efek / parameter tidak ada
  getParam(track: string, fxId: number, key: string): number | undefined;
  setParam(track: string, fxId: number, key: string, v: number): void;   // nilai dari automation: suara + knob ikut bergerak (diabaikan selagi knob itu sedang dipegang)
  fxRef(track: string, fxId: number): { type: string; i: number } | null;   // identitas efek yang stabil antar sesi: jenis + urutan di antara efek sejenis
  fxFind(track: string, type: string, i: number): number | undefined;
  fxExport(track: string): FxSaved[];
  fxImport(track: string, list: FxSaved[]): void;
  show(track: string | null): void;   // tampilkan efek milik track ini (null = tidak ada track terpilih)
  drop(track: string): void;          // track dihapus: buang efeknya
  addInstrument(track: string, type: 'supersaw' | 'deriz' | 'drums'): void;   // track synth baru: pasang plugin instrumennya (kartu di paling atas)
  closePicker(instant?: boolean): void;
  drumsPads(track: string): Record<string, number> | null;   // volume per alat plugin Drums di track ini (kunci = id alat); null = track tanpa Drums
  setDrumsPad(track: string, id: string, v: number): void;   // atur volume satu alat (0..1); ikut tersimpan di project
  hasDeriz(track: string): boolean;   // track punya plugin DERIZ yang menyala dan sudah berisi audio
  derizPlay(track: string, midi: number, when: number, dur: number, glides?: Array<{ when: number; to: number; dur: number }>, fxId?: number, vel?: number): void;   // nada terjadwal dari piano roll (when = waktu AudioContext); fxId kosong = DERIZ pertama yang menyala
  derizSchedule(list: Array<{ track: string; midi: number; when: number; dur: number; glides?: Array<{ when: number; to: number; dur: number }>; fxId?: number; vel?: number }>): void;   // seluruh nada DERIZ satu Play dikirim sekali ke worklet (jam audio yang menjalankan); garis play dibuat lewat derizHeadPump
  derizHeadPump(ahead: number): void;   // buat garis play untuk nada yang mulai sebelum waktu AudioContext `ahead` (tidak ada elemen DOM untuk nada yang masih jauh)
  derizOn(track: string, midi: number, fxId?: number): number;   // nada langsung (keyboard di bawah piano roll); mengembalikan id untuk derizOff
  derizOwnsPlain(track: string, fxId: number): boolean;   // DERIZ ini pemilik nada kunci polos di pattern track tsb
  derizCount(): number;                       // jumlah plugin DERIZ di semua track (batas demo)
  derizIds(track: string): number[];        // semua DERIZ di track ini, urut kartu (yang pertama = bawaan track)
  derizAll(): Array<{ id: number; track: string }>;   // semua DERIZ yang menyala dan sudah berisi audio, di semua track
  derizTrackOf(fxId: number): string | undefined;
  addDeriz(track: string): void;   // tambah DERIZ di bawah yang sudah ada di track ini (dipakai saat membuka project; tanpa jendela otomatis)
  derizExport(track: string): DerizSaved[];   // keadaan semua DERIZ di track ini (urut kartu): nyala/mati, knob, audio + garis start + zoom
  derizImport(track: string, i: number, st: DerizSaved): void;   // pasang keadaan ke DERIZ ke-i di track ini (DERIZ-nya harus sudah ada)
  derizLabel(fxId: number): string;           // "DERIZ", "DERIZ 2", ...
  derizOff(id: number): void;
  derizStop(): void;   // lepas semua nada DERIZ dan batalkan yang terjadwal
  derizWarm(): boolean;   // siapkan semua sampler DERIZ sebelum play; true = ada yang harus dibuat dari nol (beri jeda awal lebih panjang)
}

export interface AudioHost { ctx: AudioContext; dest: AudioNode }

// Jembatan ke timeline: DERIZ menampilkan daftar pattern aktif dan masuk ke salah satunya (piano roll untuk DERIZ ini di pattern itu)
export interface PatternRow { title: string; trackName: string; color: string; bar: number; notes: number; ref: unknown }   // notes: jumlah nada milik DERIZ ini di pattern tsb; ref: pegangan milik timeline
export interface PatternBridge {
  list(fxId: number): PatternRow[];           // semua pattern instrumen di timeline, urut dari atas ke bawah lalu kiri ke kanan (notes = nada milik DERIZ fxId)
  open(row: PatternRow, fxId: number): void;  // masuk ke pattern: buka piano roll untuk DERIZ ini
  drop(fxId: number): boolean;                // DERIZ di-drag & drop ke piano roll yang sedang terbuka: piano roll langsung jadi milik DERIZ ini (false = tidak ada piano roll terbuka)
  removed(fxId: number, track: string, ownedPlain: boolean): void;   // DERIZ dihapus: buang nadanya dari semua pattern (ownedPlain: ikut buang nada kunci polos di pattern track-nya)
}

export function initFxRack(host: () => AudioHost, patterns?: PatternBridge): FxRack {
  const addBtn = document.getElementById('fxAdd') as HTMLButtonElement;
  const list = document.getElementById('fxList')!;
  const bodyEl = addBtn.closest('.fx__body') as HTMLElement;
  const topEl = addBtn.closest('.fx__top') as HTMLElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // DERIZ overlay (jendela di tengah layar): kartu yang sama dipindah ke sini, jadi semua handler di bawah didaftarkan ke panel DAN overlay
  const ov = document.createElement('div');
  ov.className = 'derizov'; ov.hidden = true;
  ov.innerHTML = '<div class="derizov__back"></div><div class="derizov__win" role="dialog" aria-modal="true" aria-label="DERIZ" tabindex="-1">' +
    '<div class="derizov__slot"></div></div>';
  document.body.appendChild(ov);
  const ovWin = ov.querySelector<HTMLElement>('.derizov__win')!, ovSlot = ov.querySelector<HTMLElement>('.derizov__slot')!;
  dragWindow({ root: ov, move: ovWin, handle: '.fxc__head' });   // jendela DERIZ / EQ / Reverb / Delay bisa digeser lewat header
  function onRoots<K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: boolean | AddEventListenerOptions): void {
    list.addEventListener(type, fn as EventListener, opt); ov.addEventListener(type, fn as EventListener, opt);
  }
  const cardById = (id: number | string): HTMLElement | null => document.querySelector<HTMLElement>(`.fxc[data-fx="${id}"]`);

  const fxs = () => (cur ? racks.get(cur) ?? [] : []);
  const find = (el: Element | null) => {
    const id = el?.closest<HTMLElement>('.fxc')?.dataset.fx;
    return fxs().find(f => String(f.id) === id);
  };

  // canvas DERIZ digambar ulang saat ukurannya berubah (panel efek dibuka / ditutup, layar diputar)
  const ro = new ResizeObserver(es => es.forEach(en => {
    const card = (en.target as Element).closest<HTMLElement>('.fxc'), fx = card && find(card);
    if (card && fx) { if (fx.type === 'eq') paintEq(card, fx); else paintDeriz(card, fx); }
  }));
  const watch = (card: Element): void => { const cv = card.querySelector('.deriz__canvas, .eq__cv'); if (cv) ro.observe(cv); };

  // ---------- DERIZ: overlay di tengah layar. Kartu aslinya dipindah ke jendela (satu instance, state tetap sinkron); di panel tinggal placeholder ----------
  let ovOpen: { card: HTMLElement; ph: HTMLElement; opener: HTMLElement | null } | null = null;
  let autoOpen: { track: string; id: number } | null = null;   // DERIZ baru ditambahkan: dibuka otomatis begitu track-nya terpilih
  const onOvKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    closeOverlay();
  };
  const clearOvAnim = (): void => ov.getAnimations({ subtree: true }).forEach(an => an.cancel());
  function openOverlay(card: HTMLElement): void {
    if (ovOpen?.card === card) return;
    const fx = find(card); if (!fx || (fx.type !== 'deriz' && fx.type !== 'delay' && fx.type !== 'eq' && fx.type !== 'reverb')) return;
    if (ovOpen) closeOverlay(true);
    clearOvAnim();   // animasi tutup sebelumnya (fill: forwards) jangan menahan opacity 0 di buka berikutnya
    closePicker(true); closeMenu(true); hideTip();
    const ph = document.createElement('div');
    ph.className = 'fxc-ph'; ph.dataset.fx = String(fx.id); ph.dataset.kind = fx.type === 'eq' || fx.type === 'reverb' ? 'effect' : 'plugin';
    ph.innerHTML = `<span>${defOf(fx.type).name} terbuka di tengah layar</span><button type="button" class="fxc-ph__btn">Kembalikan</button>`;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card.replaceWith(ph);
    fx.min = false; card.classList.remove('is-min');   // di overlay selalu terbuka penuh
    card.querySelector('.fxc__title')?.setAttribute('aria-expanded', 'true');
    ovSlot.replaceChildren(card);
    ovWin.classList.toggle('is-delay', fx.type === 'delay'); ovWin.classList.toggle('is-eq', fx.type === 'eq'); ovWin.classList.toggle('is-rv', fx.type === 'reverb'); ovWin.setAttribute('aria-label', defOf(fx.type).name);
    ov.hidden = false;
    ovOpen = { card, ph, opener };
    document.addEventListener('keydown', onOvKey, true);
    if (!reduce) {
      ov.querySelector('.derizov__back')!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      ovWin.animate([{ opacity: 0, transform: 'translateY(14px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.3,.64,1)' });
    }
    ovWin.focus({ preventScroll: true });
    if (fx.type === 'delay') { paintAll(card, fx); if (!meterRaf) meterRaf = requestAnimationFrame(meterTick); return; }
    if (fx.type === 'reverb') { paintAll(card, fx); return; }
    if (fx.type === 'eq') { paintAll(card, fx); requestAnimationFrame(() => { if (card.isConnected) paintEq(card, fx); }); return; }   // ukuran canvas baru pasti setelah jendela tampil
    buildKb(card);
    paintDeriz(card, fx);
  }
  // meter output Delay: dibaca tiap frame selama jendela Delay terbuka
  let meterRaf = 0;
  const meterTick = (t: number): void => {
    meterRaf = 0;
    const o = ovOpen, fx = o && find(o.card); if (!o || !fx || fx.type !== 'delay' || !cur) return;
    paintMeter(o.card, delayLevels(cur), t);
    meterRaf = requestAnimationFrame(meterTick);
  };
  // discard = daftar efek sedang diganti / track dihapus: kartu tidak perlu dikembalikan ke panel
  function closeOverlay(instant = false, discard = false): void {
    const o = ovOpen; if (!o) return;
    kbReleaseAll();
    cancelAnimationFrame(meterRaf); meterRaf = 0;
    const fid = find(o.card)?.id;
    if (fid !== undefined) window.setTimeout(() => { const e = synths.get(fid); if (e && !ovOpen) { synths.delete(fid); void e.p.then(x => x.dispose(), () => { /* gagal dibuat */ }); } }, 800);   // lepas worklet setelah ekor suara habis
    ovOpen = null;
    document.removeEventListener('keydown', onOvKey, true);
    hideTip();
    const finish = (): void => {
      if (!ovOpen) { ov.hidden = true; clearOvAnim(); }   // kalau sudah dibuka lagi selagi animasi tutup jalan, jangan disembunyikan
      if (discard || !o.ph.isConnected) { o.card.querySelectorAll('canvas').forEach(c => ro.unobserve(c)); o.card.remove(); o.ph.remove(); return; }
      o.ph.replaceWith(o.card);
      const fx = find(o.card); if (fx?.type === 'deriz') paintDeriz(o.card, fx); else if (fx?.type === 'eq') paintEq(o.card, fx);
      if (o.opener?.isConnected) o.opener.focus({ preventScroll: true });
    };
    if (instant || reduce) { finish(); return; }
    ov.querySelector('.derizov__back')!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
    ovWin.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.95)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = finish;
  }
  ov.addEventListener('click', e => {
    const t = e.target as Element;
    if (t.classList.contains('derizov__back') || t.closest('.fxc__close')) closeOverlay();
  });
  ov.addEventListener('keydown', e => e.stopPropagation());   // pintasan DAW (Space, panah) tidak ikut jalan selama overlay terbuka
  ov.addEventListener('keyup', e => e.stopPropagation());
  onRoots('click', e => { if ((e.target as Element).closest('.fxc-ph__btn')) closeOverlay(); });

  // ---------- DERIZ: keyboard di bawah plugin (gaya keyboard bawah). Sampler: audio yang di-upload dimainkan dengan pitch sesuai tuts, mulai dari garis start; C4 = nada asli ----------
  const KROOT = 60, KBASE = 48, KOCT = 3, NW = 7 * KOCT, WPC = [0, 2, 4, 5, 7, 9, 11], BLK = [0, 1, 3, 4, 5];   // tetap 3 oktaf: C3 sampai B5 (21 tuts putih), tanpa ganti oktaf; BLK: tuts putih (C D F G A) yang punya tuts hitam di kanannya
  const KMAP: Record<string, number> = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14, '1': 15, q: 16, w: 17, '3': 18, e: 19, '4': 20, r: 21, '5': 22, t: 23, y: 24, '7': 25, u: 26, '8': 27, i: 28, o: 29, '0': 30, p: 31 };
  const kbVoices = new Map<number, { id: number }>();   // tuts yang sedang ditahan -> id nada di worklet
  const synths = new Map<number, { ctx: AudioContext; p: Promise<DerizSynth>; s?: DerizSynth }>();   // satu sampler worklet per plugin DERIZ (dibuat saat overlay dibuka)
  let kbSeq = 0;
  const kbPtr = new Map<number, number>(), kbKeysDown = new Map<string, number>();
  const kbCard = (): HTMLElement | null => ovOpen?.card ?? null;
  const kbKeyEl = (m: number): HTMLElement | null => kbCard()?.querySelector<HTMLElement>(`.deriz__keys [data-midi="${m}"]`) ?? null;
  function buildKb(card: HTMLElement): void {
    const keys = card.querySelector<HTMLElement>('.deriz__keys .ivk__keys'); if (!keys || keys.childElementCount) return;
    const w = 100 / NW;   // lebar satu tuts putih (%): keyboard selalu pas selebar kartu
    let h = '';
    for (let i = 0; i < NW; i++) {
      const m = KBASE + Math.floor(i / 7) * 12 + WPC[i % 7];
      h += ivkKey(m, `left:${(i * w).toFixed(4)}%;width:calc(${w.toFixed(4)}% - 1px)`);
    }
    for (let i = 0; i < NW - 1; i++) {
      if (!BLK.includes(i % 7)) continue;
      const m = KBASE + Math.floor(i / 7) * 12 + WPC[i % 7] + 1;
      h += ivkKey(m, `left:calc(${((i + 1) * w).toFixed(4)}% - ${(w * 0.31).toFixed(4)}%);width:${(w * 0.62).toFixed(4)}%`);
    }
    keys.innerHTML = h;
  }
  // Sampler (AudioWorklet, lihat deriz-synth.ts): tuts hanya mengubah NADA; kecepatan sample hanya diatur knob Speed.
  function derizSynth(fx: Fx, ctx: AudioContext): Promise<DerizSynth> {
    let e = synths.get(fx.id);
    if (!e || e.ctx !== ctx) {
      void e?.p.then(x => x.dispose(), () => { /* gagal dibuat */ });
      const made = { ctx, p: DerizSynth.create(ctx) } as { ctx: AudioContext; p: Promise<DerizSynth>; s?: DerizSynth };
      made.p.then(x => { made.s = x; }, () => { if (synths.get(fx.id) === made) synths.delete(fx.id); });
      synths.set(fx.id, made); e = made;
    }
    return e.p;
  }
  const derizArgs = (fx: Fx): [number, number, number] => [derizSpeed(fx.v.speed), derizPitch(fx.v.pitch) + getMasterPitch(), derizVol(fx.v.volume)];   // + Pitch Project (card transport)
  function kbOn(m: number): void {
    const fx = ovOpen ? find(ovOpen.card) : undefined, z = fx?.deriz;
    if (!fx || !z || !fx.on || !cur || kbVoices.has(m)) return;
    const { ctx, dest } = host(); if (ctx.state === 'suspended') void ctx.resume();
    const id = ++kbSeq, track = cur;
    kbVoices.set(m, { id });
    derizSynth(fx, ctx).then(s => {
      const z2 = fx.deriz;
      if (kbVoices.get(m)?.id !== id || !z2) return;   // sudah dilepas selagi sampler disiapkan
      s.routeTo(trackInput(ctx, dest, track)); s.setBuffer(z2.buf);
      const [sp, pi, vo] = derizArgs(fx);
      s.noteOn(id, m - KROOT, Math.floor(Math.min(z2.start * z2.dur, Math.max(0, z2.dur - 0.01)) * z2.buf.sampleRate), sp, pi, vo);
      headBegin(id, fx, ctx, ctx.currentTime);
    }).catch(err => console.error(err));
  }
  // ---------- DERIZ dari piano roll: nada terjadwal (playback) dan nada langsung (keyboard), tanpa overlay ----------
  const derizOf = (track: string, fxId?: number): Fx | undefined => racks.get(track)?.find(f => f.type === 'deriz' && f.on && f.deriz && (fxId === undefined || f.id === fxId));
  const derizStart = (z: DerizData): number => Math.floor(Math.min(z.start * z.dur, Math.max(0, z.dur - 0.01)) * z.buf.sampleRate);
  const liveRel = new Set<number>();   // nada langsung yang dilepas sebelum sampler siap
  // ---------- DERIZ: garis play di canvas. Garis start tetap di tempatnya; tiap nada yang bunyi menggambar satu garis play yang berjalan dari garis start ----------
  // Posisi sumber maju sebesar Speed x waktu nyata (tuts / Pitch tidak memengaruhi, sama seperti di worklet). Garis berhenti saat tuts dilepas
  // (atau nada di piano roll selesai), atau saat sample habis, lalu memudar. Akor = beberapa garis sekaligus.
  interface PlayHead { fx: Fx; ctx: AudioContext; t0: number; tEnd: number; pos: number; last: number; el: HTMLElement | null }   // pos: 0..1 dari durasi audio; t0 / tEnd: waktu AudioContext
  const heads = new Map<number, PlayHead>();
  let headRaf = 0;
  const headTime = (ctx: AudioContext): number => ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);   // garis mengikuti yang terdengar, bukan yang dijadwalkan
  function headBegin(id: number, fx: Fx, ctx: AudioContext, at: number, tEnd = Infinity): void {
    const z = fx.deriz; if (!z) return;
    heads.set(id, { fx, ctx, t0: at, tEnd, pos: Math.min(z.start * z.dur, Math.max(0, z.dur - 0.01)) / z.dur, last: at, el: null });
    if (!headRaf) headRaf = requestAnimationFrame(headTick);
  }
  const headEnd = (id: number): void => { const h = heads.get(id); if (h) h.tEnd = Math.min(h.tEnd, h.ctx.currentTime); };
  function headFinish(h: PlayHead): void {
    const el = h.el; if (!el) return;
    el.classList.add('is-end'); window.setTimeout(() => el.remove(), 450);
  }
  function headTick(): void {
    headRaf = 0;
    for (const [id, h] of heads) {
      const z = h.fx.deriz, now = headTime(h.ctx);
      if (!z) { headFinish(h); heads.delete(id); continue; }
      const t = Math.min(now, h.tEnd);
      if (t > h.last) { h.pos = Math.min(1, h.pos + (t - h.last) * derizSpeed(h.fx.v.speed) / z.dur); h.last = t; }   // Speed dibaca tiap frame: knob diputar saat nada ditahan ikut terasa
      const stage = cardById(h.fx.id)?.querySelector<HTMLElement>('.deriz__stage') ?? null;   // kartu bisa di panel atau di overlay; kalau tidak terlihat, posisi tetap dihitung
      if (stage && (!h.el || h.el.parentElement !== stage)) {
        h.el?.remove();
        const el = document.createElement('i'); el.className = 'deriz__play is-off'; el.setAttribute('aria-hidden', 'true');
        stage.appendChild(el); h.el = el;
      }
      if (h.el) {
        const p = (h.pos - z.view) * z.zoom;   // posisi di jendela yang terlihat (sama dengan garis start)
        h.el.style.setProperty('--p', p.toFixed(4));
        h.el.classList.toggle('is-off', now < h.t0 || p < -0.002 || p > 1.002);
      }
      if (now >= h.tEnd || h.pos >= 1) { headFinish(h); heads.delete(id); }
    }
    if (heads.size) headRaf = requestAnimationFrame(headTick);
  }
  function derizPlay(track: string, midi: number, when: number, dur: number, glides?: Array<{ when: number; to: number; dur: number }>, fxId?: number, vel?: number): void {
    const fx = derizOf(track, fxId); if (!fx) return;
    const { ctx, dest } = host(), id = ++kbSeq;
    dbgSched(when - ctx.currentTime);   // statistik Debug Audio: sisa waktu sebelum nada ini mulai (tidak berefek kalau debug mati)
    const tw = performance.now();
    derizSynth(fx, ctx).then(s => {
      const z = fx.deriz; if (!z) return;
      s.routeTo(trackInput(ctx, dest, track)); s.setBuffer(z.buf);
      dbgSent(performance.now() - tw, ctx.currentTime - when);
      const [sp, pi, vo] = derizArgs(fx), at = Math.max(when, ctx.currentTime);
      s.noteOn(id, midi - KROOT, derizStart(z), sp, pi, vo, at, velGain(vel));
      if (glides) for (const g of glides) s.glide(id, g.to - KROOT, Math.max(g.when, at), g.dur);
      s.noteOff(id, at + Math.max(0.01, dur));
      headBegin(id, fx, ctx, at, at + Math.max(0.01, dur));
    }).catch(err => console.error(err));
  }
  // Jadwal lengkap: satu pesan per DERIZ per Play. Dulu tiap nada dikirim sendiri tiap 25 ms dan pesannya bisa nyangkut (sampai detik) di jalan ke worklet.
  let schedGen = 0, headQ: Array<{ id: number; fx: Fx; ctx: AudioContext; at: number; end: number }> = [], headI = 0;
  function derizSchedule(list: Array<{ track: string; midi: number; when: number; dur: number; glides?: Array<{ when: number; to: number; dur: number }>; fxId?: number; vel?: number }>): void {
    const gen = ++schedGen, { ctx, dest } = host();
    const groups = new Map<number, { fx: Fx; track: string; items: typeof list }>();
    for (const n of list) {
      const fx = derizOf(n.track, n.fxId); if (!fx) continue;
      let g = groups.get(fx.id); if (!g) groups.set(fx.id, g = { fx, track: n.track, items: [] });
      g.items.push(n); dbgSched(n.when - ctx.currentTime);
    }
    for (const g of groups.values()) {
      const tw = performance.now(), fx = g.fx;
      derizSynth(fx, ctx).then(s => {
        const z = fx.deriz; if (!z || gen !== schedGen) return;   // Play sudah dihentikan / dijadwal ulang selagi sampler disiapkan
        s.routeTo(trackInput(ctx, dest, g.track)); s.setBuffer(z.buf);
        dbgSent(performance.now() - tw, ctx.currentTime - g.items[0].when);
        const [sp, pi, vo] = derizArgs(fx), st = derizStart(z);
        const notes = g.items.map(n => {
          const id = ++kbSeq, dur = Math.max(0.01, n.dur);
          headQ.push({ id, fx, ctx, at: n.when, end: n.when + dur });
          return { id, semis: n.midi - KROOT, start: st, speed: sp, pitch: pi, vol: vo, at: n.when, dur, vel: velGain(n.vel),
            glides: n.glides?.map(x => ({ semis: x.to - KROOT, at: Math.max(x.when, n.when), dur: x.dur })) };
        });
        headQ.sort((a, b) => a.at - b.at);
        s.schedule(notes);
      }).catch(err => console.error(err));
    }
  }
  function derizHeadPump(ahead: number): void {
    while (headI < headQ.length && headQ[headI].at <= ahead) { const h = headQ[headI++]; headBegin(h.id, h.fx, h.ctx, h.at, h.end); }
  }
  function derizOn(track: string, midi: number, fxId?: number): number {
    const fx = derizOf(track, fxId); if (!fx) return 0;
    const { ctx, dest } = host(), id = ++kbSeq;
    derizSynth(fx, ctx).then(s => {
      if (liveRel.delete(id)) return;   // sudah dilepas selagi sampler disiapkan
      const z = fx.deriz; if (!z) return;
      s.routeTo(trackInput(ctx, dest, track)); s.setBuffer(z.buf);
      const [sp, pi, vo] = derizArgs(fx);
      s.noteOn(id, midi - KROOT, derizStart(z), sp, pi, vo);
      headBegin(id, fx, ctx, ctx.currentTime);
    }).catch(err => console.error(err));
    return id;
  }
  function derizOff(id: number): void {
    if (!id) return;
    headEnd(id);
    liveRel.add(id);
    let sent = false;
    for (const e of synths.values()) if (e.s) { e.s.noteOff(id); sent = true; }
    if (sent) liveRel.delete(id);
  }
  function derizStop(): void {
    schedGen++; headQ = []; headI = 0;
    for (const e of synths.values()) e.s?.releaseAll();
    liveRel.clear();
    for (const [id, h] of heads) { if (h.t0 > h.ctx.currentTime) { heads.delete(id); h.el?.remove(); } else h.tEnd = Math.min(h.tEnd, h.ctx.currentTime); }   // yang belum mulai dibatalkan, yang jalan berhenti di tempat
  }
  // Siapkan sampler (worklet + sample) SEBELUM nada pertama diputar. Membuat worklet dan mengirim sample butuh puluhan ms per plugin; kalau baru
  // dikerjakan saat nada pertama, nada itu terlambat dan thread audio tersendat tepat di awal play. true = ada yang disiapkan dari nol.
  const trackOfFx = (id: number): string | undefined => { for (const [t, r] of racks) if (r.some(f => f.id === id)) return t; return undefined; };
  function warmFx(fx: Fx, track: string): boolean {
    const z = fx.deriz; if (!z || !fx.on) return false;
    const { ctx, dest } = host(), e = synths.get(fx.id);
    const cold = !e || e.ctx !== ctx || !e.s || !e.s.hasBuffer(z.buf);
    if (cold) derizSynth(fx, ctx).then(s => {
      const z2 = fx.deriz; if (!z2) return;
      s.routeTo(trackInput(ctx, dest, track)); s.setBuffer(z2.buf);
    }, () => { /* gagal dibuat */ });
    return cold;
  }
  function derizWarm(): boolean {
    let cold = false;
    for (const [track, r] of racks) for (const fx of r) if (fx.type === 'deriz' && warmFx(fx, track)) cold = true;
    return cold;
  }
  function kbParams(fx: Fx): void {   // knob Speed / Pitch / Volume diputar saat nada ditahan: ikut berubah mulus
    const s = synths.get(fx.id)?.s; if (s) s.params(...derizArgs(fx));
  }
  onMasterPitch(() => {   // Pitch Project diputar: semua sampler DERIZ yang sudah siap menerima nilai baru (nada yang sedang bunyi ikut bergeser)
    for (const [id, e] of synths) {
      if (!e.s) continue;
      for (const r of racks.values()) { const fx = r.find(f => f.id === id); if (fx) { e.s.params(...derizArgs(fx)); break; } }
    }
  });
  function kbOff(m: number): void {
    const v = kbVoices.get(m); if (!v) return;
    kbVoices.delete(m);
    headEnd(v.id);
    for (const e of synths.values()) e.s?.noteOff(v.id);
  }
  const kbPress = (m: number): void => { kbOn(m); const k = kbKeyEl(m); if (k) k.classList.add('is-down'); };
  const kbRelease = (m: number): void => { kbOff(m); const k = kbKeyEl(m); if (k) k.classList.remove('is-down'); };
  function kbReleaseAll(): void {
    [...kbVoices.keys()].forEach(kbRelease);
    kbCard()?.querySelectorAll('.deriz__keys .is-down').forEach(k => k.classList.remove('is-down'));
    kbPtr.clear(); kbKeysDown.clear();
  }
  const kbKeyAt = (x: number, y: number): HTMLElement | null => document.elementFromPoint(x, y)?.closest<HTMLElement>('.deriz__keys .ivk__w, .deriz__keys .ivk__b') ?? null;
  ov.addEventListener('pointerdown', e => {
    const k = (e.target as Element).closest<HTMLElement>('.deriz__keys .ivk__w, .deriz__keys .ivk__b'); if (!k || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); k.closest<HTMLElement>('.deriz__keys')!.setPointerCapture(e.pointerId);
    const m = +k.dataset.midi!; kbPtr.set(e.pointerId, m); kbPress(m);
  });
  ov.addEventListener('pointermove', e => {
    const cur0 = kbPtr.get(e.pointerId); if (cur0 === undefined) return;
    const k = kbKeyAt(e.clientX, e.clientY); if (!k) return;
    const m = +k.dataset.midi!; if (m !== cur0) { kbRelease(cur0); kbPtr.set(e.pointerId, m); kbPress(m); }
  });
  const kbUp = (e: PointerEvent): void => { const m = kbPtr.get(e.pointerId); if (m !== undefined) { kbPtr.delete(e.pointerId); kbRelease(m); } };
  ov.addEventListener('pointerup', kbUp); ov.addEventListener('pointercancel', kbUp);
  // tombol komputer (susunan sama dengan keyboard bawah); selama overlay terbuka, keyboard bawah tidak ikut bunyi
  document.addEventListener('keydown', e => {
    if (!ovOpen || e.ctrlKey || e.metaKey || e.altKey || (e.target as Element)?.matches?.('textarea, input:not([type="range"])')) return;
    const k = e.key.toLowerCase(); if (!(k in KMAP)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat || kbKeysDown.has(k)) return;
    const m = KBASE + KMAP[k]; kbKeysDown.set(k, m); kbPress(m);
  }, true);
  document.addEventListener('keyup', e => { const k = e.key.toLowerCase(), m = kbKeysDown.get(k); if (m !== undefined) { kbKeysDown.delete(k); kbRelease(m); } });
  window.addEventListener('blur', kbReleaseAll);

  // Tombol "+": di atas saat belum ada efek, pindah ke bawah daftar setelah ada efek (dengan animasi geser halus)
  // ---------- dua halaman: Plugin | Effect (tab kiri-kanan langsung terlihat, bukan di dalam tombol / menu) ----------
  const pagesEl = document.getElementById('fxPages')!;
  const pageBtns = [...pagesEl.querySelectorAll<HTMLButtonElement>('.fx__page')];
  let page: FxPage = 'plugin';
  const ADD_LABEL: Record<FxPage, string> = { plugin: 'Tambah plugin', effect: 'Tambah efek' };
  function syncPage(): void {
    list.dataset.page = page; pagesEl.dataset.page = page;
    pageBtns.forEach(b => { const on = b.dataset.page === page; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    addBtn.setAttribute('aria-label', ADD_LABEL[page]); addBtn.title = ADD_LABEL[page];
  }
  function setPage(next: FxPage, focus = false): void {
    if (next === page) return;
    closePicker(true); closeMenu(true); hideTip();
    page = next; syncPage();
    layout(false);   // tombol + ikut posisi halaman ini (tengah kalau kosong, di bawah kartu kalau sudah ada isi)
    if (focus) pageBtns.find(b => b.dataset.page === page)?.focus({ preventScroll: true });
  }
  pagesEl.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLButtonElement>('.fx__page'); if (b) setPage(b.dataset.page as FxPage); });
  pagesEl.addEventListener('keydown', e => {
    e.stopPropagation();   // panah / Space di sini tidak boleh memicu pintasan DAW (mundur, putar)
    if (e.key === 'ArrowLeft' || e.key === 'Home') { e.preventDefault(); setPage('plugin', true); }
    else if (e.key === 'ArrowRight' || e.key === 'End') { e.preventDefault(); setPage('effect', true); }
  });
  pagesEl.addEventListener('keyup', e => e.stopPropagation());
  syncPage();

  function layout(animate: boolean): void {
    const has = fxs().some(f => pageOf(f.type) === page);
    if (bodyEl.classList.contains('has-fx') === has) return;
    const first = topEl.getBoundingClientRect().top;
    bodyEl.classList.toggle('has-fx', has);
    if (!animate || reduce) return;
    const dy = first - topEl.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) topEl.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.34,1.3,.64,1)' });
  }

  // ---------- tooltip putih saat knob diputar (kelas & gaya sama dengan tooltip knob pan) ----------
  const tip = document.createElement('div');
  tip.className = 'pan-tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  let tipTimer = 0;
  const hideTip = () => { tip.hidden = true; };
  const showTip = (knob: HTMLElement, text: string, ms = 0) => {
    tip.textContent = text; tip.hidden = false;
    const r = knob.getBoundingClientRect(), w = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w.width / 2, innerWidth - w.width - 8)) + 'px';
    tip.style.top = (r.top - w.height - 8 < 8 ? r.bottom + 8 : r.top - w.height - 8) + 'px';
    clearTimeout(tipTimer);
    if (ms) tipTimer = window.setTimeout(hideTip, ms);
  };

  // ---------- card pilihan efek, muncul di dekat tombol + ----------
  let pick: HTMLElement | null = null;

  const closePicker = (instant = false) => {
    const el = pick; if (!el) return;
    pick = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onResize, true);
    addBtn.setAttribute('aria-expanded', 'false');
    if (instant || reduce) { el.remove(); return; }
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9) translateY(-4px)' }],
      { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => el.remove();
  };
  const onOutside = (e: PointerEvent) => { const t = e.target as Node; if (!pick?.contains(t) && !addBtn.contains(t)) closePicker(); };
  const onResize = () => closePicker(true);
  const onKey = (e: KeyboardEvent) => {   // Esc menutup card pilihan dari mana pun fokusnya
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    closePicker(); addBtn.focus({ preventScroll: true });
  };

  const openPicker = () => {
    if (pick || !cur) return;
    closeMenu(true);
    const have = new Set(fxs().map(f => f.type));
    // halaman Plugin: hanya DERIZ (boleh banyak; Supersaw otomatis ada di track synth). Halaman Effect: Reverb, EQ, Filter, dll.
    // halaman Plugin: DERIZ (boleh banyak) dan MPCS (satu per track; Supersaw otomatis ada di track synth). Halaman Effect: Reverb, EQ, Filter, dll.
    const choices = EFFECTS.filter(d => page === 'plugin' ? d.type === 'deriz' || d.type === 'mpcs' || d.type === 'cute' || d.type === 'mgchord' || (d.type === 'drums' && !DRUMS_HIDDEN) : !d.synth);   // MGCHORD gratis: langsung ada di daftar tombol +
    const el = document.createElement('div');
    el.className = 'fx-pick';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', page === 'plugin' ? 'Pilih plugin' : 'Pilih efek');
    el.innerHTML = choices.map((d, k) => {
      const used = d.type !== 'deriz' && have.has(d.type);
      return `<button type="button" role="menuitem" class="fx-pick__item" data-type="${d.type}" style="--i:${k}"${used ? ' disabled title="Sudah ditambahkan"' : ''}>` +
        `<span>${d.name}</span></button>`;
    }).join('');
    document.body.appendChild(el);
    const r = addBtn.getBoundingClientRect(), w = Math.min(220, innerWidth - 16), h = el.offsetHeight;
    el.style.width = w + 'px';
    el.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    // buka ke bawah tombol; kalau tidak muat (tombol sekarang di bagian bawah), buka ke atas
    const below = r.bottom + 10, above = r.top - 10 - h;
    el.style.top = Math.max(8, below + h > innerHeight - 8 && above >= 8 ? above : Math.min(below, innerHeight - h - 8)) + 'px';
    el.style.transformOrigin = below + h > innerHeight - 8 && above >= 8 ? 'bottom center' : 'top center';
    pick = el;
    addBtn.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLButtonElement>('.fx-pick__item');
      if (!b || b.disabled) return;
      const t = b.dataset.type as FxType;
      addEffect(t);
      closePicker(t === 'mpcs' || t === 'cute' || t === 'mgchord' || t === 'drums');
      if (t !== 'mpcs' && t !== 'cute' && t !== 'mgchord' && t !== 'drums') addBtn.focus({ preventScroll: true });   // MPCS: fokus pindah ke jendelanya
    });
    el.addEventListener('keydown', e => e.stopPropagation());   // pintasan DAW (Space, panah) tidak ikut jalan
    el.addEventListener('keyup', e => e.stopPropagation());
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    el.querySelector<HTMLButtonElement>('.fx-pick__item:not(:disabled)')?.focus({ preventScroll: true });
  };

  // Rahasia: tekan-tahan "+" di tab Plugin (~1,5 detik) langsung menambahkan MGCHORD (atau membukanya kalau sudah ada); tidak ada petunjuk di layar.
  let holdT = 0, held = false;
  const holdStop = () => { clearTimeout(holdT); holdT = 0; };
  addBtn.addEventListener('pointerdown', () => {
    held = false; holdStop();
    if (page !== 'plugin' || !cur || addBtn.disabled) return;
    holdT = window.setTimeout(() => {
      held = true; holdT = 0; closePicker();
      if (fxs().some(f => f.type === 'mgchord')) openMg(); else addEffect('mgchord');
    }, 1500);
  });
  addBtn.addEventListener('pointerup', holdStop);
  addBtn.addEventListener('pointerleave', holdStop);
  addBtn.addEventListener('pointercancel', holdStop);
  addBtn.addEventListener('contextmenu', e => { if (held || holdT) e.preventDefault(); });   // cegah menu tahan-lama bawaan browser HP
  addBtn.addEventListener('click', () => { if (held) { held = false; return; } pick ? closePicker() : openPicker(); });

  // ---------- menu titik tiga (Delete) ----------
  let menu: HTMLElement | null = null, menuBtn: HTMLButtonElement | null = null;

  function closeMenu(instant = false): void {
    const el = menu; if (!el) return;
    menu = null;
    menuBtn?.setAttribute('aria-expanded', 'false'); menuBtn = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('resize', onMenuResize);
    window.removeEventListener('scroll', onMenuResize, true);
    if (instant || reduce) { el.remove(); return; }
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9) translateY(-4px)' }],
      { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => el.remove();
  }
  const onMenuOutside = (e: PointerEvent) => { const t = e.target as Node; if (!menu?.contains(t) && !menuBtn?.contains(t)) closeMenu(); };
  const onMenuResize = () => closeMenu(true);
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const b = menuBtn; closeMenu(); b?.focus({ preventScroll: true });
  };

  function openMenu(btn: HTMLButtonElement, card: HTMLElement): void {
    closePicker(true); closeMenu(true);
    const el = document.createElement('div');
    el.className = 'track-menu fx-menu';
    el.setAttribute('role', 'menu');
    const isDeriz = find(card)?.type === 'deriz';
    el.innerHTML = (isDeriz ? '<button type="button" role="menuitem" class="track-menu__item" data-act="dup">Duplicate</button>' : '') +
      '<button type="button" role="menuitem" class="track-menu__item track-menu__item--danger" data-act="del">Delete</button>';
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
    el.style.transformOrigin = 'top right';
    menu = el; menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    el.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-act]'); if (!b) return;
      closeMenu(true);
      if (b.dataset.act === 'dup') duplicateDeriz(card); else removeEffect(card);
    });
    el.addEventListener('keydown', e => e.stopPropagation());
    el.addEventListener('keyup', e => e.stopPropagation());
    document.addEventListener('pointerdown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('resize', onMenuResize);
    window.addEventListener('scroll', onMenuResize, true);
    el.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
  }

  // ---------- DERIZ: menu pattern (tombol titik tiga di kiri indikator nyala/mati) ----------
  function openPatMenu(btn: HTMLButtonElement): void {
    if (!patterns || !cur) return;
    const fx = find(btn); if (!fx) return;
    const fxId = fx.id;
    closePicker(true); closeMenu(true); hideTip();
    const rows = patterns.list(fxId);
    const el = document.createElement('div');
    el.className = 'fx-pats';
    el.setAttribute('role', 'menu');
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'fx-pats__empty'; empty.textContent = 'Belum ada pattern';
      el.appendChild(empty);
    }
    for (const row of rows) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'fx-pats__item';
      b.setAttribute('aria-label', row.title + ', ' + row.trackName + ', bar ' + row.bar);   // detail hanya untuk pembaca layar, tidak tampil
      const dot = document.createElement('i'); dot.className = 'fx-pats__dot'; dot.style.setProperty('--c', row.color);
      const t = document.createElement('span'); t.className = 'fx-pats__name'; t.textContent = row.title;
      b.append(dot, t);
      b.addEventListener('click', () => { closeMenu(true); closeOverlay(true); patterns.open(row, fxId); });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
    el.style.transformOrigin = 'top left';
    menu = el; menuBtn = btn;
    btn.setAttribute('aria-expanded', 'true');
    el.addEventListener('keydown', e => e.stopPropagation());
    el.addEventListener('keyup', e => e.stopPropagation());
    document.addEventListener('pointerdown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('resize', onMenuResize);
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  // ---------- kartu efek ----------
  const paintAll = (card: HTMLElement, fx: Fx) => {
    const d = defOf(fx.type);
    if (fx.type === 'delay') paintDelayUi(card, fx.v);   // dulu: LCD menentukan knob mana yang dipegang angkanya
    card.querySelectorAll<HTMLElement>(CTL).forEach(k => {
      const p = d.params.find(x => x.key === k.dataset.k)!;
      paintCtl(k, fx.v[p.key], p, d.name, fx.v);
    });
    if (fx.type === 'eq') paintEq(card, fx);
    if (fx.type === 'reverb') paintRv(card, fx);
  };

  const openMg = (): void => { openMgchord(); };
  function addEffect(type: FxType): void {
    if (!cur) return;
    if (DEMO && type === 'deriz' && derizCount() >= LIMITS.derizPlugins) { demoNotice('derizplug'); return; }   // DEMO: batas jumlah plugin DERIZ
    const d = defOf(type), v: Record<string, number> = {};
    d.params.forEach(p => { v[p.key] = p.def; });
    const fx: Fx = { id: ++seq, type, on: true, min: false, v };
    if (type === 'deriz') { if (!plainOwner.has(cur)) plainOwner.set(cur, fx.id); autoOpen = { track: cur, id: fx.id }; }   // langsung terbuka di tengah layar seperti DERIZ bawaan
    if (type === 'delay') autoOpen = { track: cur, id: fx.id };   // Delay juga: panelnya terlalu besar untuk kolom efek
    racks.set(cur, [...fxs(), fx]);
    applyAudio(cur);
    list.insertAdjacentHTML('beforeend', cardHtml(fx, 0));
    const card = list.lastElementChild as HTMLElement;
    paintAll(card, fx);
    watch(card);
    layout(true);
    card.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    openAuto();
    if (type === 'mpcs') openMpcs();   // langsung terbuka, seperti DERIZ
    if (type === 'cute') openCute();
    if (type === 'mgchord') openMgchord();
    if (type === 'drums') openDrums();
  }

  function openAuto(): void {
    const a = autoOpen; if (!a || a.track !== cur) return;
    autoOpen = null;
    requestAnimationFrame(() => { const c = cardById(a.id); if (c?.isConnected && a.track === cur) openOverlay(c); });
  }

  // plugin instrumen (mis. Supersaw): ditambahkan otomatis saat track synth dibuat, selalu di paling atas, hanya satu per track
  function addInstrument(trackId: string | number, type: FxType): void {
    const track = String(trackId);   // id track dari dataset selalu string; kunci Map harus sama
    const rack = racks.get(track) ?? [];
    if (rack.some(f => f.type === type)) return;
    const d = defOf(type), v: Record<string, number> = {};
    d.params.forEach(p => { v[p.key] = p.def; });
    const fx: Fx = { id: ++seq, type, on: true, min: false, v };
    racks.set(track, [fx, ...rack]);
    if (type === 'deriz' && !plainOwner.has(track)) plainOwner.set(track, fx.id);
    applyAudio(track);
    if (type === 'deriz') autoOpen = { track, id: fx.id };   // DERIZ langsung muncul di tengah layar (overlay), bukan hanya di panel efek
    if (track !== cur) return;   // track lain belum dipilih: kartu digambar & overlay dibuka saat show()
    list.insertAdjacentHTML('afterbegin', cardHtml(fx, 0));
    paintAll(list.firstElementChild as HTMLElement, fx);
    layout(true);
    openAuto();
  }

  // nomor pada judul kartu DERIZ mengikuti urutan di track (DERIZ, DERIZ 2, ...): perbarui setelah tambah / duplikat / hapus
  function refreshDerizNames(): void {
    list.querySelectorAll<HTMLElement>('.fxc--deriz').forEach(c => {
      const fx = find(c); if (!fx) return;
      const no = derizNo(fx.id), name = no > 1 ? 'DERIZ ' + no : 'DERIZ';
      const t = c.querySelector<HTMLElement>('.fxc__title'); if (t) t.textContent = name;
      c.setAttribute('aria-label', name);
    });
  }

  // Duplicate: DERIZ baru tepat di bawah aslinya dengan setelan knob + audio yang sama; nada di pattern tidak ikut disalin
  function duplicateDeriz(card: HTMLElement): void {
    const src = find(card); if (!src || src.type !== 'deriz' || !cur) return;
    if (DEMO && derizCount() >= LIMITS.derizPlugins) { demoNotice('derizplug'); return; }   // DEMO: batas jumlah plugin DERIZ
    hideTip();
    const fx: Fx = { id: ++seq, type: 'deriz', on: src.on, min: false, v: { ...src.v } };
    if (src.deriz) fx.deriz = { ...src.deriz, busy: undefined };   // buffer & spektrogram dipakai bersama (tidak diubah), posisi start / zoom salinan sendiri
    const rack = fxs(), k = rack.indexOf(src);
    racks.set(cur, [...rack.slice(0, k + 1), fx, ...rack.slice(k + 1)]);
    const html = cardHtml(fx, k + 1);
    const ph = list.querySelector<HTMLElement>(`.fxc-ph[data-fx="${src.id}"]`);   // aslinya sedang terbuka di overlay: sisipkan setelah placeholder-nya
    (ph ?? card).insertAdjacentHTML('afterend', html);
    const nc = ((ph ?? card).nextElementSibling) as HTMLElement;
    paintAll(nc, fx); watch(nc);
    layout(true);
    refreshDerizNames();
    paintDeriz(nc, fx);
    nc.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  function removeEffect(card: HTMLElement): void {
    const fx = find(card); if (!fx || !cur || (defOf(fx.type).synth && fx.type !== 'deriz' && fx.type !== 'mpcs' && fx.type !== 'cute' && fx.type !== 'mgchord' && fx.type !== 'drums')) return;
    hideTip();
    if (fx.type === 'deriz') {   // lepas sampler-nya dan buang nadanya di semua pattern
      const e = synths.get(fx.id); if (e) { synths.delete(fx.id); void e.p.then(x => x.dispose(), () => { /* gagal dibuat */ }); }
      const owned = plainOwner.get(cur) === fx.id;
      if (owned) plainOwner.set(cur, -1);
      patterns?.removed(fx.id, cur, owned);
    }
    racks.set(cur, fxs().filter(f => f !== fx));
    applyAudio(cur);
    if (pick) closePicker(true);
    const done = () => { card.querySelectorAll('canvas').forEach(c => ro.unobserve(c)); card.remove(); layout(true); refreshDerizNames(); };
    if (reduce) { done(); return; }
    const h = card.offsetHeight, mb = parseFloat(getComputedStyle(card).marginBottom) || 0;
    card.style.overflow = 'hidden'; card.style.pointerEvents = 'none';
    card.animate([
      { height: h + 'px', marginBottom: mb + 'px', opacity: 1, transform: 'translateX(0) scale(1)' },
      { opacity: 0, transform: 'translateX(36px) scale(.94)', offset: .5 },
      { height: '0px', marginBottom: '0px', opacity: 0, transform: 'translateX(36px) scale(.94)' }
    ], { duration: 380, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = done;
  }

  // ---------- knob: drag (atas/kanan = naik), panah keyboard, dobel klik = reset ke nilai awal ----------
  let drag: { el: HTMLElement; fx: Fx; p: Param; sx: number; sy: number; sv: number; box: DOMRect | null } | null = null;
  const sliderVal = (box: DOMRect, y: number): number => 1 - (y - box.top - 7) / Math.max(1, box.height - 14);   // 7 px = setengah tinggi pegangan
  const ctx = (el: HTMLElement) => {
    const fx = find(el); if (!fx) return null;
    const p = defOf(fx.type).params.find(x => x.key === el.dataset.k)!;
    return { fx, p };
  };
  let touched: AutoTarget | null = null, touchCb: ((t: AutoTarget) => void) | null = null;
  const nameOf = (fx: Fx): string => { const n = defOf(fx.type).name; if (fx.type !== 'deriz') return n; const no = derizNo(fx.id); return no > 1 ? n + ' ' + no : n; };
  // Delay: Link menggeser pasangan filter, LCD / label ikut diperbarui
  function delaySync(fx: Fx, p: Param, before: number, v: number): void {
    const card = cardById(fx.id); if (!card) return;
    const lk = linkedPartner(fx.v, p.key, before, v);
    if (lk) {
      fx.v[lk.key] = lk.val;
      const q = defOf('delay').params.find(x => x.key === lk.key)!, e = card.querySelector<HTMLElement>(`[data-k="${lk.key}"]`);
      if (e) paintCtl(e, lk.val, q, 'Delay', fx.v);
    }
    paintDelayUi(card, fx.v);
  }
  const setVal = (el: HTMLElement, fx: Fx, p: Param, n: number) => {
    const before = fx.v[p.key];
    const v = snapVal(fx, p, Math.max(0, Math.min(1, n)));
    fx.v[p.key] = v;
    if (cur) { touched = { track: cur, fxId: fx.id, key: p.key, fxName: nameOf(fx), label: p.label }; touchCb?.(touched); }   // knob ini jadi calon Automation Clip
    paintCtl(el, v, p, defOf(fx.type).name, fx.v);
    if (fx.type === 'delay') delaySync(fx, p, before, v);
    if (fx.type === 'eq') { const c = el.closest<HTMLElement>('.fxc'); if (c) paintEq(c, fx); }
    if (fx.type === 'reverb') { const c = el.closest<HTMLElement>('.fxc'); if (c) paintRv(c, fx); }
    if (cur) applyAudio(cur);
    if (fx.type === 'deriz') kbParams(fx);
    if (!tip.hidden) showTip(el, fmtOf(fx, p, v));
  };

  // tooltip hover (mouse): nama knob + nilai sekarang, untuk knob yang punya hint
  onRoots('pointerover', e => {
    if (e.pointerType !== 'mouse' || drag) return;
    const el = (e.target as Element).closest<HTMLElement>(CTL); if (!el || el.contains(e.relatedTarget as Node | null)) return;
    const c = ctx(el); if (!c?.p.hint) return;
    showTip(el, c.p.hint + ': ' + fmtOf(c.fx, c.p, c.fx.v[c.p.key]));
  });
  onRoots('pointerout', e => {
    if (drag) return;
    const el = (e.target as Element).closest<HTMLElement>(CTL); if (!el || el.contains(e.relatedTarget as Node | null)) return;
    hideTip();
  });
  onRoots('pointerdown', e => {
    const el = (e.target as Element).closest<HTMLElement>(CTL); if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const c = ctx(el); if (!c) return;
    drag = { el, fx: c.fx, p: c.p, sx: e.clientX, sy: e.clientY, sv: c.fx.v[c.p.key], box: c.p.slider ? el.getBoundingClientRect() : null };
    el.classList.add('is-dragging'); el.setPointerCapture(e.pointerId); e.preventDefault();
    el.focus({ preventScroll: true });
    if (drag.box) setVal(el, c.fx, c.p, sliderVal(drag.box, e.clientY));   // slider: pegangan langsung lompat ke titik yang disentuh
    showTip(el, fmtOf(c.fx, c.p, c.fx.v[c.p.key]));
  });
  onRoots('pointermove', e => {
    if (!drag) return;
    if (drag.box) { setVal(drag.el, drag.fx, drag.p, sliderVal(drag.box, e.clientY)); return; }
    setVal(drag.el, drag.fx, drag.p, drag.sv + ((drag.sy - e.clientY) + (e.clientX - drag.sx)) / DRAG_PX);
  });
  const endDrag = () => { if (!drag) return; drag.el.classList.remove('is-dragging'); drag = null; hideTip(); };
  onRoots('pointerup', endDrag);
  onRoots('pointercancel', endDrag);
  onRoots('lostpointercapture', endDrag);

  // ---------- drag & drop DERIZ ke piano roll: tarik ikon pattern / judul DERIZ, lepas di atas piano roll = langsung masuk ke piano roll ----------
  // Tidak perlu lagi memilih pattern lewat menu: piano roll yang sedang terbuka otomatis jadi milik DERIZ yang dilepas.
  const PD_MOVE = 6;   // px: di bawah ini dianggap klik biasa (menu pattern / minimize tetap jalan)
  let pd: { fxId: number; sx: number; sy: number; on: boolean; ghost: HTMLElement | null; pid: number } | null = null;
  let pdSuppressClick = false;
  const overRoll = (x: number, y: number) => !!document.elementFromPoint(x, y)?.closest('#pianoRoll');
  function pdStart(): void {
    if (!pd) return;
    pd.on = true;
    closeMenu(true); hideTip();
    const g = document.createElement('div');
    g.className = 'pd-ghost'; g.textContent = 'DERIZ';
    document.body.appendChild(g);
    pd.ghost = g;
    ov.classList.add('is-pdrag');   // jendela DERIZ di tengah layar jangan menghalangi piano roll di belakangnya
    document.body.classList.add('is-pdragging');
  }
  function pdMove(e: PointerEvent): void {
    if (!pd || e.pointerId !== pd.pid) return;
    if (!pd.on) { if (Math.hypot(e.clientX - pd.sx, e.clientY - pd.sy) < PD_MOVE) return; pdStart(); }
    if (pd.ghost) pd.ghost.style.transform = `translate(${e.clientX + 12}px,${e.clientY + 12}px)`;
    document.getElementById('pianoRoll')?.classList.toggle('is-drop', overRoll(e.clientX, e.clientY));
  }
  function pdEnd(e: PointerEvent): void {
    if (!pd || e.pointerId !== pd.pid) return;
    const s = pd; pd = null;
    document.removeEventListener('pointermove', pdMove, true);
    document.removeEventListener('pointerup', pdEnd, true);
    document.removeEventListener('pointercancel', pdEnd, true);
    if (!s.on) return;   // hanya klik: biarkan click handler biasa
    pdSuppressClick = true; setTimeout(() => { pdSuppressClick = false; }, 0);
    s.ghost?.remove();
    ov.classList.remove('is-pdrag');
    document.body.classList.remove('is-pdragging');
    document.getElementById('pianoRoll')?.classList.remove('is-drop');
    if (e.type === 'pointerup' && patterns && overRoll(e.clientX, e.clientY) && patterns.drop(s.fxId)) closeOverlay(true);   // lepas di piano roll: masuk, jendela DERIZ ditutup
  }
  onRoots('pointerdown', e => {
    const t = e.target as Element;
    if (e.button !== 0 || pd || !patterns) return;
    const h = t.closest<HTMLElement>('.fxc--deriz .fxc__pat, .fxc--deriz .fxc__title'); if (!h) return;
    const fx = find(h); if (!fx || fx.type !== 'deriz') return;
    pd = { fxId: fx.id, sx: e.clientX, sy: e.clientY, on: false, ghost: null, pid: e.pointerId };
    document.addEventListener('pointermove', pdMove, true);
    document.addEventListener('pointerup', pdEnd, true);
    document.addEventListener('pointercancel', pdEnd, true);
  });
  onRoots('dblclick', e => {
    const el = (e.target as Element).closest<HTMLElement>(CTL); if (!el) return;
    const c = ctx(el); if (!c) return;
    showTip(el, fmtOf(c.fx, c.p, c.p.def), 900); setVal(el, c.fx, c.p, c.p.def);
  });
  onRoots('keydown', e => {
    const el = (e.target as Element).closest<HTMLElement>(CTL); if (!el) return;
    const up = e.key === 'ArrowUp' || e.key === 'ArrowRight', down = e.key === 'ArrowDown' || e.key === 'ArrowLeft';
    if (!up && !down) return;
    const c = ctx(el); if (!c) return;
    e.preventDefault(); e.stopPropagation();   // panah tidak ikut memicu mundur / maju milik DAW
    const k = typeof c.p.steps === 'function' ? c.p.steps(c.fx.v) : c.p.steps ?? 0, d = k > 1 ? 1 / (k - 1) : 0.02;   // posisi diskrit: satu langkah
    setVal(el, c.fx, c.p, Math.round((c.fx.v[c.p.key] + (up ? d : -d)) * 1000) / 1000);
    showTip(el, fmtOf(c.fx, c.p, c.fx.v[c.p.key]), 900);
  });
  onRoots('blur', e => { if ((e.target as Element).matches?.(CTL) && !drag) hideTip(); }, true);

  // ---------- Equalizer: pilih band, seret node di grafik (x = frekuensi, y = gain), roda mouse = Q ----------
  const eqKnob = (card: HTMLElement, fx: Fx, key: string, n: number): void => {   // atur satu parameter lewat jalur yang sama dengan knob (automation, suara, tampilan ikut)
    const el = card.querySelector<HTMLElement>(`[data-k="${key}"]`), p = defOf('eq').params.find(x => x.key === key);
    if (el && p) setVal(el, fx, p, n);
  };
  function eqSelect(card: HTMLElement, fx: Fx, i: number): void {
    if (bandOf(fx) === i && card.querySelector('.eq__knobs [data-k]')) { fx.tab = i; return; }
    fx.tab = i; hideTip();
    const kn = card.querySelector<HTMLElement>('.eq__knobs'); if (kn) kn.innerHTML = eqKnobsHtml(defOf('eq'), fx);
    paintAll(card, fx);
  }
  let eqDrag: { card: HTMLElement; fx: Fx; cv: HTMLCanvasElement; i: number } | null = null;
  const eqXY = (cv: HTMLElement, e: PointerEvent | MouseEvent): { x: number; y: number; w: number; h: number } => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
  onRoots('pointerdown', e => {
    const cv = (e.target as Element).closest<HTMLCanvasElement>('.eq__cv'); if (!cv || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const card = cv.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx) return;
    const { x, y, w, h } = eqXY(cv, e), i = hitNode(fx.v, w, h, x, y, bandOf(fx));
    if (i < 0) return;
    eqSelect(card, fx, i);
    eqDrag = { card, fx, cv, i }; cv.setPointerCapture(e.pointerId); e.preventDefault();
    paintEq(card, fx);
  });
  onRoots('pointermove', e => {
    if (!eqDrag) return;
    const { card, fx, cv, i } = eqDrag, b = EQ_BANDS[i], { x, y, w, h } = eqXY(cv, e);
    eqKnob(card, fx, b.key + 'F', eqFreqV(b, hzAt(x, w)));
    eqKnob(card, fx, b.key, 0.5 + dbAt(y, h) / (2 * EQ_RANGE_DB));
  });
  const eqEnd = (): void => { eqDrag = null; };
  onRoots('pointerup', eqEnd); onRoots('pointercancel', eqEnd); onRoots('lostpointercapture', eqEnd);
  onRoots('dblclick', e => {   // dobel klik node = kembalikan band itu ke default (gain 0 dB, frekuensi & Q awal)
    const cv = (e.target as Element).closest<HTMLCanvasElement>('.eq__cv'); if (!cv) return;
    const card = cv.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx) return;
    const { x, y, w, h } = eqXY(cv, e), i = hitNode(fx.v, w, h, x, y, bandOf(fx)); if (i < 0) return;
    const b = EQ_BANDS[i]; eqSelect(card, fx, i);
    eqKnob(card, fx, b.key, 0.5); eqKnob(card, fx, b.key + 'F', eqFreqV(b, b.def)); if (b.q) eqKnob(card, fx, b.key + 'Q', eqQV(b.defQ));
  });
  onRoots('wheel', e => {
    const cv = (e.target as Element).closest<HTMLCanvasElement>('.eq__cv'); if (!cv) return;
    const card = cv.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx) return;
    const b = EQ_BANDS[bandOf(fx)]; if (!b.q) return;
    e.preventDefault();
    const k = b.key + 'Q'; eqKnob(card, fx, k, (fx.v[k] ?? eqQV(b.defQ)) - Math.sign(e.deltaY) * 0.04);
  }, { passive: false });
  onRoots('click', e => {
    const bt = (e.target as Element).closest<HTMLButtonElement>('.eq__band'); if (!bt) return;
    const card = bt.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx) return;
    eqSelect(card, fx, +bt.dataset.band!); paintEq(card, fx);
  });

  // ---------- Equalizer: spektrum hidup. Satu loop rAF selama ada kartu EQ yang terlihat (di panel atau overlay); berhenti sendiri kalau tidak ada ----------
  const specBuf = new Float32Array(EQ_FFT_BINS);
  let specRaf = 0, specLive = true;
  const specTick = (): void => {
    specRaf = 0;
    if (!cur || document.hidden) return;
    const vis = [...document.querySelectorAll<HTMLElement>('.fxc--eq:not(.is-min)')].filter(c => c.querySelector<HTMLElement>('.eq__cv')?.offsetParent);
    if (!vis.length) { specNow = null; return; }   // tidak ada yang terlihat: berhenti (paintEq menyalakan lagi lewat specKick)
    const sp = eqSpectrum(cur, specBuf), live = !!sp && specActive({ db: specBuf, sr: sp.sr });
    if (live || specLive) {   // senyap & sudah digambar senyap: lewati (hemat baterai)
      specNow = live && sp ? { db: specBuf, sr: sp.sr } : null;
      for (const c of vis) { const fx = find(c); if (fx) paintEqSpec(c, fx); }
    }
    specLive = live;
    specRaf = requestAnimationFrame(specTick);
  };
  specKick = (): void => { specLive = true; if (!specRaf) specRaf = requestAnimationFrame(specTick); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) specKick(); });

  // ---------- DERIZ: upload audio ke canvas (tombol, "Ganti", atau drag & drop file) ----------
  async function loadDeriz(card: HTMLElement, file: File): Promise<void> {
    const fx = find(card); if (!fx) return;
    const stage = card.querySelector<HTMLElement>('.deriz__stage')!;
    const warn = (msg: string): void => {   // pesan singkat (tooltip di atas layar), lalu kembali ke keadaan semula
      setBusy(stage, false); stage.classList.remove('is-loading', 'is-shake'); void stage.offsetWidth; stage.classList.add('is-shake');
      showTip(stage, msg, 2400);
      window.setTimeout(() => { if (card.isConnected) updateDerizUi(card, fx); }, 2400);
    };
    if (!isAudio(file)) { warn('Bukan file audio'); return; }
    const my = fx.tok = (fx.tok ?? 0) + 1;   // upload yang lebih baru membatalkan yang lama
    stage.classList.add('is-loading'); setBusy(stage, true);
    try {
      const buf = await decodeStandalone(file);
      if (my !== fx.tok) return;
      fx.deriz = { name: file.name, dur: buf.duration, buf, start: 0, zoom: 1, view: 0, spec: null, busy: 0 };
    } catch (err) {
      console.error(err);
      if (my === fx.tok) warn('File tidak bisa dibaca');
      return;
    }
    const live = cardById(fx.id);   // kartu bisa saja sudah dihapus / track diganti selama decode
    if (!live) return;
    updateDerizUi(live, fx); paintDeriz(live, fx);
    { const tk = trackOfFx(fx.id); if (tk !== undefined) warmFx(fx, tk); }   // sampler disiapkan sekarang (bukan saat nada pertama)
    // analisis spektrogram di latar (animasi di canvas tetap jalan), hasilnya digambar begitu selesai
    const z = fx.deriz, cardOf = (): HTMLElement | null => cardById(fx.id);
    if (!z) return;
    const spec = await computeSpec(z.buf, pct => { z.busy = pct; }, () => fx.deriz === z && fx.tok === my);
    if (!spec || fx.deriz !== z) return;
    z.spec = spec; z.busy = undefined;
    const c2 = cardOf(); if (c2) { updateDerizUi(c2, fx); paintDeriz(c2, fx); }
  }
  onRoots('change', e => {
    const inp = e.target as HTMLInputElement;
    if (!inp.matches?.('.deriz__file')) return;
    const card = inp.closest<HTMLElement>('.fxc'), f = inp.files?.[0];
    inp.value = '';
    if (card && f) void loadDeriz(card, f);
  });
  const dropZone = (e: Event) => (e.target as Element).closest<HTMLElement>('.deriz__stage');
  onRoots('dragover', e => { const z = dropZone(e); if (!z) return; e.preventDefault(); z.classList.add('is-over'); });
  onRoots('dragleave', e => { dropZone(e)?.classList.remove('is-over'); });
  onRoots('drop', e => {
    const z = dropZone(e); if (!z) return;
    e.preventDefault(); z.classList.remove('is-over');
    const card = z.closest<HTMLElement>('.fxc'), f = e.dataTransfer?.files?.[0];
    if (card && f) void loadDeriz(card, f);
  });

  // sample dari MPCS: ikon grip di MPCS dilepas di atas kanvas DERIZ ini (event dari mpcs.ts), masuk lewat jalur yang sama dengan upload file
  const onMpcsSample = ((e: CustomEvent<{ file: File }>) => {
    const card = (e.target as Element).closest<HTMLElement>('.fxc'), f = e.detail?.file;
    if (card && f) void loadDeriz(card, f);
  }) as EventListener;
  list.addEventListener('mpcs-sample', onMpcsSample); ov.addEventListener('mpcs-sample', onMpcsSample);

  // ---------- DERIZ: garis start. Drag garisnya (atau tap / klik di mana saja pada canvas untuk memindahkan), panah keyboard menggeser, dobel klik = kembali ke 0 ----------
  const winAt = (stage: HTMLElement, x: number): number => {   // posisi x dalam jendela yang terlihat, 0..1
    const r = stage.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left - DERIZ_PAD) / Math.max(1, r.width - DERIZ_PAD * 2)));
  };
  const fracAt = (stage: HTMLElement, x: number, z: DerizData): number => Math.max(0, Math.min(1, z.view + winAt(stage, x) / z.zoom));   // posisi global 0..1 dari durasi
  const setStart = (card: HTMLElement, fx: Fx, f: number, tipMs = -1): void => {   // tipMs: -1 tanpa tooltip, 0 tooltip menetap, >0 hilang otomatis
    const z = fx.deriz; if (!z) return;
    z.start = Math.max(0, Math.min(1, f));
    const mk = card.querySelector<HTMLElement>('.deriz__start')!;
    updateZoomUi(card, z);
    mk.setAttribute('aria-valuenow', z.start.toFixed(4)); mk.setAttribute('aria-valuetext', posText(z));
    if (tipMs >= 0) showTip(mk, fmtPos(z.start * z.dur), tipMs);
  };
  let sd: { stage: HTMLElement; card: HTMLElement; fx: Fx; sx: number; off: number; drag: boolean } | null = null;
  onRoots('pointerdown', e => {
    const stage = (e.target as Element).closest<HTMLElement>('.deriz__stage.has-audio'); if (!stage || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, e.clientX);
      if (touches.size === 2) { startPinch(stage); return; }   // dua jari = cubit untuk zoom
    }
    const card = stage.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx?.deriz) return;
    const lineX = stage.getBoundingClientRect().left + DERIZ_PAD + visS(fx.deriz) * (stage.clientWidth - DERIZ_PAD * 2);
    const near = Math.abs(e.clientX - lineX) <= 18;
    // mouse: langsung pindah + drag. Sentuh: hanya drag kalau menyentuh garisnya; sentuhan lain = tap (dihitung saat dilepas) supaya scroll panel tidak menggeser garis
    sd = { stage, card, fx, sx: e.clientX, off: near ? lineX - e.clientX : 0, drag: near || e.pointerType === 'mouse' };
    stage.setPointerCapture(e.pointerId); stage.classList.add('is-dragging');
    card.querySelector<HTMLElement>('.deriz__start')!.focus({ preventScroll: true });
    if (sd.drag) { setStart(card, fx, fracAt(stage, e.clientX + sd.off, fx.deriz), 0); e.preventDefault(); }
  });
  onRoots('pointermove', e => {
    if (sd?.drag) setStart(sd.card, sd.fx, fracAt(sd.stage, e.clientX + sd.off, sd.fx.deriz!), 0);
  });
  const endStart = (e: PointerEvent): void => {
    if (!sd) return;
    const s = sd; sd = null;
    s.stage.classList.remove('is-dragging'); hideTip();
    if (e.type === 'pointerup' && !s.drag && Math.abs(e.clientX - s.sx) < 8) setStart(s.card, s.fx, fracAt(s.stage, e.clientX, s.fx.deriz!), 900);   // tap
  };
  onRoots('pointerup', endStart);
  onRoots('pointercancel', endStart);
  onRoots('dblclick', e => {
    const stage = (e.target as Element).closest<HTMLElement>('.deriz__stage.has-audio'); if (!stage) return;
    const card = stage.closest<HTMLElement>('.fxc'), fx = card && find(card);
    if (card && fx?.deriz) setStart(card, fx, 0, 900);
  });
  onRoots('keydown', e => {
    const mk = (e.target as Element).closest<HTMLElement>('.deriz__start'); if (!mk) return;
    const card = mk.closest<HTMLElement>('.fxc'), fx = card && find(card), z = fx?.deriz; if (!card || !fx || !z) return;
    const step = (e.shiftKey ? 0.05 : 0.01) / z.zoom;
    let f: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') f = z.start + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') f = z.start - step;
    else if (e.key === 'Home') f = 0; else if (e.key === 'End') f = 1;
    if (f === null) return;
    e.preventDefault(); e.stopPropagation();   // panah tidak ikut memicu mundur / maju milik DAW
    setStart(card, fx, f, 900);
  });

  // ---------- DERIZ: zoom canvas. Tombol + / - / reset, Ctrl+scroll (juga cubit di trackpad), cubit dua jari, bar navigasi di bawah untuk geser ----------
  const maxZoom = (z: DerizData): number => (z.spec ? Math.max(1, Math.min(2000, z.spec.frames / 10)) : 1);   // jendela terkecil kira-kira 10 frame analisis (lebih kecil dari itu tidak ada detail baru)
  const setView = (card: HTMLElement, fx: Fx, zoom: number, ga: number, wa: number): void => {   // ga: titik global yang dijaga tetap di posisi jendela wa (0..1)
    const z = fx.deriz; if (!z) return;
    z.zoom = Math.max(1, Math.min(maxZoom(z), zoom));
    z.view = Math.max(0, Math.min(1 - 1 / z.zoom, ga - wa / z.zoom));
    updateZoomUi(card, z); paintDeriz(card, fx);
  };
  const touches = new Map<number, number>();
  let pinch: { card: HTMLElement; fx: Fx; stage: HTMLElement; d0: number; z0: number; ga: number } | null = null;
  const startPinch = (stage: HTMLElement): void => {
    if (sd) { sd.stage.classList.remove('is-dragging'); sd = null; hideTip(); }
    const card = stage.closest<HTMLElement>('.fxc'), fx = card && find(card), z = fx?.deriz; if (!card || !fx || !z) return;
    const [x1, x2] = [...touches.values()];
    pinch = { card, fx, stage, d0: Math.max(24, Math.abs(x1 - x2)), z0: z.zoom, ga: fracAt(stage, (x1 + x2) / 2, z) };
  };
  onRoots('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, e.clientX);
    if (!pinch || touches.size < 2) return;
    const [x1, x2] = [...touches.values()];
    setView(pinch.card, pinch.fx, pinch.z0 * Math.max(1, Math.abs(x1 - x2)) / pinch.d0, pinch.ga, winAt(pinch.stage, (x1 + x2) / 2));   // titik di antara dua jari tetap di bawah jari
  });
  const endTouch = (e: PointerEvent): void => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  onRoots('pointerup', endTouch); onRoots('pointercancel', endTouch);
  onRoots('wheel', e => {
    const stage = (e.target as Element).closest<HTMLElement>('.deriz__stage.has-audio'); if (!stage) return;
    const card = stage.closest<HTMLElement>('.fxc'), fx = card && find(card), z = fx?.deriz; if (!card || !fx || !z) return;
    if (e.ctrlKey || e.metaKey) {   // Ctrl / Cmd + scroll, atau cubit di trackpad: zoom ke arah kursor
      e.preventDefault();
      const wa = winAt(stage, e.clientX);
      setView(card, fx, z.zoom * Math.exp(-e.deltaY * 0.004), z.view + wa / z.zoom, wa);
    } else if (z.zoom > 1.001 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {   // Shift + scroll / geser horizontal: geser jendela
      e.preventDefault();
      setView(card, fx, z.zoom, z.view + ((e.deltaX || e.deltaY) / Math.max(1, stage.clientWidth)) / z.zoom * 1 + 0.5 / z.zoom, .5);
    }
  }, { passive: false });
  let nd: { card: HTMLElement; fx: Fx; nav: HTMLElement } | null = null;   // geser lewat bar navigasi (mouse / sentuh)
  const navTo = (x: number): void => {
    if (!nd) return;
    const r = nd.nav.getBoundingClientRect();
    setView(nd.card, nd.fx, nd.fx.deriz!.zoom, Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width))), .5);
  };
  onRoots('pointerdown', e => {
    const nav = (e.target as Element).closest<HTMLElement>('.deriz__nav'); if (!nav || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const card = nav.closest<HTMLElement>('.fxc'), fx = card && find(card); if (!card || !fx?.deriz) return;
    if (nav.classList.contains('is-idle')) return;   // belum di-zoom: tidak ada yang digeser
    nd = { card, fx, nav }; nav.classList.add('is-dragging'); nav.setPointerCapture(e.pointerId); e.preventDefault(); navTo(e.clientX);
  });
  onRoots('pointermove', e => { if (nd) navTo(e.clientX); });
  const endNav = (): void => { nd?.nav.classList.remove('is-dragging'); nd = null; };
  onRoots('pointerup', endNav); onRoots('pointercancel', endNav);

  function setOpt(card: HTMLElement, ob: HTMLButtonElement): void {
    const fx = find(card); if (!fx || fx.type !== 'delay' || !cur) return;
    const key = ob.dataset.opt!, p = defOf('delay').params.find(x => x.key === key)!;
    const val = ob.dataset.toggle ? ((fx.v[key] ?? 0) >= 0.5 ? 0 : 1) : +ob.dataset.val!;
    fx.v[key] = val;
    touched = { track: cur, fxId: fx.id, key, fxName: nameOf(fx), label: p.label }; touchCb?.(touched);
    if (key === 'sync') {   // pindah antara note dan ms: waktu menyesuaikan ke posisi note terdekat
      const tp = defOf('delay').params.find(x => x.key === 'time')!, tv = snapVal(fx, tp, fx.v.time);
      fx.v.time = tv;
      const e = card.querySelector<HTMLElement>('[data-k="time"]'); if (e) paintCtl(e, tv, tp, 'Delay', fx.v);
    }
    paintAll(card, fx);
    applyAudio(cur);
  }

  // ---------- DERIZ + CUTE: card miring 3D mengikuti kursor + kilau mengikuti arah cahaya (mouse saja; mati saat reduced-motion / drag garis start) ----------
  const untilt = (c: HTMLElement): void => { c.classList.remove('is-tilting'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); c.style.setProperty('--mx', '50%'); c.style.setProperty('--my', '0%'); };
  onRoots('pointermove', e => {
    if (reduce || e.pointerType !== 'mouse' || sd) return;
    const card = (e.target as Element).closest<HTMLElement>('.fxc--deriz, .fxc--cute');
    document.querySelectorAll<HTMLElement>('.fxc--deriz.is-tilting, .fxc--cute.is-tilting').forEach(c => { if (c !== card) untilt(c); });
    if (!card || card.closest('.derizov')) return;   // di overlay tidak miring (mengganggu saat main keyboard)
    const r = card.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    card.classList.add('is-tilting');
    card.style.setProperty('--ry', ((px - .5) * 7).toFixed(2) + 'deg'); card.style.setProperty('--rx', ((.5 - py) * 5).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  });
  onRoots('pointerleave', () => document.querySelectorAll<HTMLElement>('.fxc--deriz.is-tilting, .fxc--cute.is-tilting').forEach(untilt));

  onRoots('click', e => {
    const t = e.target as Element, card = t.closest<HTMLElement>('.fxc');
    if (!card || t.matches('.deriz__file')) return;
    if (pdSuppressClick) { pdSuppressClick = false; return; }   // klik susulan setelah drag ke piano roll: bukan klik sungguhan
    const ob = t.closest<HTMLButtonElement>('.dly__opt'); if (ob) { setOpt(card, ob); return; }   // tombol mode Delay (Ø, Ping Pong, Dual, sumber tempo, Link)
    if (t.closest('.dly__sum')) { openOverlay(card); return; }
    if (t.closest('.fxc__mp')) { openMpcs(); return; }
    if (t.closest('.fxc__cu')) { openCute(); return; }
    if (t.closest('.fxc__mg')) { openMg(); return; }
    if (t.closest('.fxc__dr')) { openDrums(); return; }
    if (t.closest('.fxc__pop')) { if (ovOpen?.card === card) closeOverlay(); else openOverlay(card); return; }
    if (t.closest('.deriz__up, .deriz__swap')) { card.querySelector<HTMLInputElement>('.deriz__file')!.click(); return; }
    const pat = t.closest<HTMLButtonElement>('.fxc__pat');
    if (pat) { menu && menuBtn === pat ? closeMenu() : openPatMenu(pat); return; }
    const more = t.closest<HTMLButtonElement>('.fxc__more');
    if (more) { menu && menuBtn === more ? closeMenu() : openMenu(more, card); return; }
    const tabBtn = t.closest<HTMLButtonElement>('.fxc__tab');   // ganti kategori plugin
    if (tabBtn) {
      const fx = find(card); if (!fx) return;
      fx.tab = +tabBtn.dataset.tab!;
      hideTip();
      card.querySelectorAll<HTMLElement>('.fxc__tab').forEach(b => b.setAttribute('aria-selected', String(b === tabBtn)));
      card.querySelectorAll<HTMLElement>('.fxc__panel').forEach(pn => { pn.hidden = pn.dataset.tab !== tabBtn.dataset.tab; });
      return;
    }
    const pwr = t.closest<HTMLButtonElement>('.fxc__pwr');
    if (pwr) {
      const fx = find(card); if (!fx || !cur) return;
      fx.on = !fx.on;
      card.classList.toggle('is-off', !fx.on);
      pwr.setAttribute('aria-checked', String(fx.on));
      if (fx.type === 'eq') paintEq(card, fx);
      applyAudio(cur);
      return;
    }
    const title = t.closest<HTMLButtonElement>('.fxc__title');   // klik nama efek: minimize / maximize
    if (title) {
      const fx = find(card); if (!fx) return;
      fx.min = !fx.min;
      hideTip();
      card.classList.toggle('is-min', fx.min);
      title.setAttribute('aria-expanded', String(!fx.min));
    }
  });
  // Space / Enter pada tombol di panel ini jangan ikut memicu play / pause milik DAW
  const guard = (e: KeyboardEvent) => { if ((e.key === ' ' || e.code === 'Space') && (e.target as Element).closest?.('button')) e.stopPropagation(); };
  document.getElementById('fxBody')!.addEventListener('keydown', guard);
  document.getElementById('fxBody')!.addEventListener('keyup', guard);

  // ---------- simpan / buka project: keadaan DERIZ (audio sample, garis start, zoom, knob) ----------
  function addDeriz(trackId: string | number): void {
    const track = String(trackId), d = defOf('deriz'), v: Record<string, number> = {};
    d.params.forEach(p => { v[p.key] = p.def; });
    const fx: Fx = { id: ++seq, type: 'deriz', on: true, min: false, v };
    racks.set(track, [...(racks.get(track) ?? []), fx]);
    if (!plainOwner.has(track)) plainOwner.set(track, fx.id);
    applyAudio(track);
    if (cur === track) api.show(track);
  }
  function derizExport(track: string): DerizSaved[] {
    return (racks.get(track) ?? []).filter(f => f.type === 'deriz').map(f => {
      const o: DerizSaved = { on: f.on, v: { ...f.v } };
      if (f.deriz) o.z = { name: f.deriz.name, start: f.deriz.start, zoom: f.deriz.zoom, view: f.deriz.view, buf: f.deriz.buf };
      return o;
    });
  }
  function derizImport(track: string, i: number, st: DerizSaved): void {
    const fx = (racks.get(track) ?? []).filter(f => f.type === 'deriz')[i]; if (!fx) return;
    fx.on = st.on; fx.v = { ...fx.v, ...st.v };
    autoOpen = null;   // membuka project: jangan memunculkan jendela DERIZ otomatis
    if (st.z) {
      const my = fx.tok = (fx.tok ?? 0) + 1;
      const z: DerizData = { name: st.z.name, dur: st.z.buf.duration, buf: st.z.buf, start: st.z.start, zoom: st.z.zoom, view: st.z.view, spec: null, busy: 0 };
      fx.deriz = z;
      void computeSpec(z.buf, pct => { z.busy = pct; }, () => fx.deriz === z && fx.tok === my).then(spec => {
        if (!spec || fx.deriz !== z) return;
        z.spec = spec; z.busy = undefined;
        const c = cardById(fx.id); if (c) { updateDerizUi(c, fx); paintDeriz(c, fx); }
      });
    }
    applyAudio(track);
    if (cur === track) api.show(track);   // kartu track ini sedang tampil: gambar ulang dengan keadaan baru
  }

  // ---------- Automation Clip: baca / tulis parameter dari luar panel ----------
  const fxOf = (track: string, fxId: number): Fx | undefined => (racks.get(track) ?? []).find(f => f.id === fxId);
  const paramOf = (fx: Fx, key: string): Param | undefined => defOf(fx.type).params.find(x => x.key === key);
  function paramInfo(track: string, fxId: number, key: string): AutoParamInfo | null {
    const fx = fxOf(track, fxId), p = fx && paramOf(fx, key); if (!fx || !p) return null;
    return { fxName: nameOf(fx), label: p.label, def: p.def, bipolar: !!p.bipolar, fmt: v => fmtOf(fx, p, v) };
  }
  function setParam(track: string, fxId: number, key: string, n: number): void {
    const fx = fxOf(track, fxId), p = fx && paramOf(fx, key); if (!fx || !p) return;
    if (drag && drag.fx === fx && drag.p === p) return;   // pengguna sedang memegang knob ini: jangan direbut
    const v = snapVal(fx, p, Math.max(0, Math.min(1, n)));
    if (Math.abs((fx.v[key] ?? 0) - v) < 1e-4) return;
    const before = fx.v[key];
    fx.v[key] = v;
    const el = cardById(fx.id)?.querySelector<HTMLElement>(`[data-k="${key}"]`);
    if (el) paintCtl(el, v, p, defOf(fx.type).name, fx.v);
    if (fx.type === 'delay') delaySync(fx, p, before, v);
    if (fx.type === 'eq') { const c = cardById(fx.id); if (c) paintEq(c, fx); }
    if (fx.type === 'reverb') { const c = cardById(fx.id); if (c) paintRv(c, fx); }
    applyAudio(track);
    if (fx.type === 'deriz') kbParams(fx);
  }
  const fxRef = (track: string, fxId: number): { type: string; i: number } | null => {
    const rack = racks.get(track) ?? [], fx = rack.find(f => f.id === fxId); if (!fx) return null;
    return { type: fx.type, i: rack.filter(f => f.type === fx.type).findIndex(f => f.id === fxId) };
  };
  const fxFind = (track: string, type: string, i: number): number | undefined => (racks.get(track) ?? []).filter(f => f.type === type)[i]?.id;
  const fxExport = (track: string): FxSaved[] => (racks.get(track) ?? []).flatMap((f, at) => f.type === 'deriz' ? [] : [{ type: f.type, on: f.on, v: { ...f.v }, at, ...(f.min ? { min: true } : {}), ...(f.tab ? { tab: f.tab } : {}) }]);
  function fxImport(track: string, list: FxSaved[]): void {   // dipanggil saat membuka project (track-nya sudah dibuat; Supersaw bawaan track sudah ada)
    const cnt = new Map<string, number>(), placed = new Map<Fx, number | undefined>();
    for (const st of list) {
      const type = st.type as FxType, d = EFFECTS.find(e => e.type === type); if (!d || type === 'deriz') continue;
      const k = cnt.get(type) ?? 0; cnt.set(type, k + 1);
      let fx = (racks.get(track) ?? []).filter(f => f.type === type)[k];
      if (!fx) {
        if (d.synth && type !== 'mpcs' && type !== 'cute' && type !== 'mgchord' && type !== 'drums') continue;   // plugin instrumen hanya ada kalau track-nya memang jenis itu (MPCS boleh dipasang di track mana pun)
        const v: Record<string, number> = {}; d.params.forEach(q => { v[q.key] = q.def; });
        fx = { id: ++seq, type, on: true, min: false, v };
        racks.set(track, [...(racks.get(track) ?? []), fx]);
      }
      fx.on = st.on !== false; fx.v = { ...fx.v, ...st.v };
      fx.min = !!st.min; if (typeof st.tab === 'number') fx.tab = st.tab;
      placed.set(fx, st.at);
    }
    // urutan kartu seperti saat disimpan: efek menempati posisi `at`-nya, sisa posisi diisi kartu lain (DERIZ dll.) sesuai urutan sekarang
    const rack = racks.get(track) ?? [];
    if (placed.size && rack.length) {
      const out: (Fx | undefined)[] = new Array(rack.length).fill(undefined);
      for (const [f, at] of placed) if (typeof at === 'number' && at >= 0 && at < out.length && !out[at]) out[at] = f;
      const rest = rack.filter(f => !out.includes(f));
      racks.set(track, out.map(f => f ?? rest.shift()!));
    }
    applyAudio(track);
    if (cur === track) api.show(track);
  }

  const api: FxRack = {
    onTouch: cb => { touchCb = cb; },
    lastTouched: () => (touched && fxOf(touched.track, touched.fxId) ? touched : null),
    paramInfo, getParam: (track, fxId, key) => fxOf(track, fxId)?.v[key], setParam, fxRef, fxFind, fxExport, fxImport,
    show(track) {
      closePicker(true); closeMenu(true); hideTip(); drag = null; closeOverlay(true, true); ro.disconnect();
      cur = track;
      addBtn.disabled = !track;
      list.replaceChildren();
      if (!track) { layout(false); return; }
      applyAudio(track);
      list.innerHTML = fxs().map((f, i) => cardHtml(f, i)).join('');
      list.querySelectorAll<HTMLElement>('.fxc').forEach(c => { const f = find(c); if (f) paintAll(c, f); watch(c); });
      layout(false);
      openAuto();
    },
    drop(track) {
      for (const f of racks.get(track) ?? []) if (f.type === 'deriz') patterns?.removed(f.id, track, false);
      racks.delete(track); plainOwner.delete(track);
      if (autoOpen?.track === track) autoOpen = null;
      setReverb(track, null); setEq(track, null); setFilter(track, null); setSupersaw(track, null);
      if (cur === track) { closePicker(true); closeMenu(true); hideTip(); closeOverlay(true, true); ro.disconnect(); cur = null; addBtn.disabled = true; list.replaceChildren(); layout(false); }
    },
    addInstrument,
    drumsPads(track: string): Record<string, number> | null {
      const fx = (racks.get(track) ?? []).find(f => f.type === 'drums'); if (!fx) return null;
      return Object.fromEntries(Object.entries(fx.v).filter(([k]) => k.startsWith('pad_')).map(([k, x]) => [k.slice(4), x]));
    },
    setDrumsPad(track: string, id: string, v: number): void {
      const fx = (racks.get(track) ?? []).find(f => f.type === 'drums'); if (!fx) return;
      fx.v['pad_' + id] = Math.max(0, Math.min(1, v)); applyAudio(track);
    },
    closePicker,
    hasDeriz: track => !!derizOf(track),
    derizPlay, derizSchedule, derizHeadPump, derizOn, derizOff, derizStop, derizWarm,
    derizOwnsPlain: (track, fxId) => plainOwner.get(track) === fxId,
    derizCount,
    derizIds: track => (racks.get(track) ?? []).filter(f => f.type === 'deriz').map(f => f.id),
    derizAll: () => [...racks.entries()].flatMap(([track, r]) => r.filter(f => f.type === 'deriz' && f.on && f.deriz).map(f => ({ id: f.id, track }))),
    derizTrackOf: fxId => { for (const [track, r] of racks) if (r.some(f => f.id === fxId)) return track; return undefined; },
    addDeriz, derizExport, derizImport,
    derizLabel: fxId => { const n = derizNo(fxId); return n > 1 ? 'DERIZ ' + n : 'DERIZ'; }
  };
  return api;
}
