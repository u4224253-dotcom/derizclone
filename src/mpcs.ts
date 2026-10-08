// MPCS (Manual Pitch Correct Sample): jendela editor pitch manual, bergaya plugin DERIZ (faceplate logam 3D). Tahap 1 (starter):
//   upload audio -> analisis di Worker -> blok nada di piano roll -> seret blok ke atas / bawah (snap semiton) -> knob Glide / Human / Lock -> putar hasil.
// Dibuka lewat tombol + di halaman Plugin pada panel efek (pilih "MPCS"); tidak ada kartunya di daftar efek.
// Inti DSP ada di mpcs-dsp.ts (murni), jalan di mpcs-worker.ts.

import { ACCEPT as AUDIO_ACCEPT, isAudio } from './audio-upload-card';
import { DEFAULT_CONTROLS, shiftCurve, snapTargets, toMono, type Controls, type Note, type PitchTrack } from './mpcs-dsp';
import { encodeWavFloat } from './wav';
import { DEMO, LIMITS, demoTrim, demoMarked, demoNotice } from './demo';
import { encodeMp3Mono, encodeWav16Mono, saveBlob, type SaveFormat } from './mpcs-save';
import { dragWindow } from './win-drag';

const svg = (inner: string, size = 18): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICON = {
  up: svg('<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>', 16),
  play: svg('<path d="M8 5l12 7-12 7z" fill="currentColor" stroke="none"/>', 22),
  pause: svg('<rect x="6" y="5" width="4.5" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2" fill="currentColor" stroke="none"/>', 22),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 12),
  drag: svg('<circle cx="9" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.7" fill="currentColor" stroke="none"/>', 14),
  dl: svg('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>', 13),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 13),
  unfull: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', 13),
  zin: svg('<path d="M5 12h14M12 5v14"/>', 14),
  zout: svg('<path d="M5 12h14"/>', 14),
  zh: svg('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>', 12),
  zv: svg('<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>', 12),
  cut: svg('<circle cx="6" cy="6.5" r="2.6"/><circle cx="6" cy="17.5" r="2.6"/><path d="M8.2 8l11 8.5M8.2 16l11-8.5"/>', 16),
  all: svg('<rect x="4" y="4" width="16" height="16" rx="2.5" stroke-dasharray="3.2 3"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>', 16)
};
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const noteName = (m: number): string => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
const fmtShift = (s: number): string => { const c = Math.round(s * 100); return (c > 0 ? '+' : '') + (Math.abs(c) % 100 === 0 ? c / 100 + ' st' : c + ' ct'); };

// Tiga knob global (Lock = center, Human = variation, Glide = transition; nama kunci di kode tetap center / variation / transition). Markup & kelas sama dengan knob efek (fx-rack.ts) supaya gayanya menyatu dengan DAW.
const knobSvg = '<svg viewBox="0 0 36 36" aria-hidden="true" class="circular-chart">' +
  '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dasharray="75, 100" class="circle-bg" style="transform-origin:18px 18px;transform:rotate(225deg)"></path>' +
  '<path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dashoffset="0" stroke-dasharray="0 100" class="circle accent-on" style="transform:rotate(225deg)"></path>' +
  '<path d="M18 5.142857142857142 a 12.857142857142858 12.857142857142858 0 0 1 0 25.714285714285715 a 12.857142857142858 12.857142857142858 0 0 1 0 -25.714285714285715" fill="var(--background-tinted-press)" stroke="none" class="circle-inner"></path>' +
  '<path d="M18 5.7857142857142865 a 12.214285714285714 12.214285714285714 0 0 1 0 24.428571428571427 a 12.214285714285714 12.214285714285714 0 0 1 0 -24.428571428571427" stroke="var(--background-tinted-base)" fill="none" class="circle-inner-stroke"></path>' +
  '<path d="M 18 7.5 L 18 12" class="knob-pos" style="transform:rotate(-135deg)"></path></svg>';
type KnobKey = keyof Controls;
const KNOBS: Record<KnobKey, { label: string; tip: string; bipolar?: boolean }> = {
  transition: { label: 'Glide', bipolar: true, tip: 'Glide: cara pindah antar nada. 50% = luncuran asli dipertahankan. Ke kiri: makin tajam sampai lompat robotik. Ke kanan: makin legato (luncuran lebar). Klik dua kali = reset' },
  variation: { label: 'Human', tip: 'Human: variasi alami di dalam nada (vibrato dan pitch yang goyang). 100% = asli, 0% = datar di pusat nada. Klik dua kali = reset' },
  center: { label: 'Lock', tip: 'Lock: tarik pitch pusat tiap nada ke semiton terdekat. 0% = pitch asli, 100% = tepat di nada. Klik dua kali = reset' }
};
const KNOB_KEYS: KnobKey[] = ['transition', 'variation', 'center'];   // urutan tampil: Glide, Human, Lock
const knobHtml = (k: KnobKey): string =>
  `<div class="mpcs__knob is-off" title="${KNOBS[k].tip}"><div class="knob fxk"><div class="knob-inner"><div role="slider" tabindex="0" class="knob-input" data-kn="${k}" aria-label="${KNOBS[k].label}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${DEFAULT_CONTROLS[k]}"><div class="knobwheel">${knobSvg}</div></div></div></div>` +
  `<span class="mpcs__lbl">${KNOBS[k].label}</span><output>${Math.round(DEFAULT_CONTROLS[k] * 100)}%</output></div>`;

interface Peaks { mn: Float32Array; mx: Float32Array; norm: number }
interface Session {
  name: string; sr: number; dur: number; pt: PitchTrack; notes: Note[];
  orig: AudioBuffer; out: AudioBuffer | null; lo: number; hi: number; ref: number; pk: Peaks;
}

// Waveform: sample dipecah per kolom pixel, tiap kolom diambil min/max-nya (semua channel digabung), lalu digambar sebagai SATU polygon solid yang menyambung.
// Supaya cepat saat knob diputar / scroll, min/max per blok 64 sample dihitung sekali saat audio dimuat; kolom tinggal menggabungkan blok.
const PK_BLOCK = 64;
function buildPeaks(buf: AudioBuffer): Peaks {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const n = buf.length, nb = Math.max(1, Math.ceil(n / PK_BLOCK));
  const mn = new Float32Array(nb), mx = new Float32Array(nb);
  let peak = 0;
  for (let b = 0; b < nb; b++) {
    let lo = 1, hi = -1; const e = Math.min(n, (b + 1) * PK_BLOCK);
    for (const d of chs) for (let i = b * PK_BLOCK; i < e; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (e <= b * PK_BLOCK) { lo = 0; hi = 0; }
    mn[b] = lo; mx[b] = hi; peak = Math.max(peak, -lo, hi);
  }
  return { mn, mx, norm: peak > 1e-4 ? 1 / peak : 1 };   // dinormalkan ke puncak sample: rekaman pelan tetap kelihatan bentuknya
}
function peakRange(p: Peaks, sr: number, t0: number, t1: number, out: number[]): void {
  const nb = p.mn.length, b0 = Math.floor(t0 * sr / PK_BLOCK);
  if (b0 >= nb || t1 <= 0) { out[0] = 0; out[1] = 0; return; }
  const b1 = Math.min(nb - 1, Math.max(b0, Math.ceil(t1 * sr / PK_BLOCK) - 1));
  let lo = 1, hi = -1;
  for (let b = Math.max(0, b0); b <= b1; b++) { if (p.mn[b] < lo) lo = p.mn[b]; if (p.mx[b] > hi) hi = p.mx[b]; }
  out[0] = lo; out[1] = hi;
}
// satu polygon solid: sisi atas kiri->kanan, lalu sisi bawah kanan->kiri (kolom selalu tersambung, tanpa persegi terpisah)
function fillColumns(c: CanvasRenderingContext2D, x0: number, step: number, tops: Float32Array, bots: Float32Array, n: number): void {
  if (n < 1) return;
  c.beginPath(); c.moveTo(x0, bots[0]);
  for (let i = 0; i < n; i++) c.lineTo(x0 + i * step + step / 2, bots[i]);
  c.lineTo(x0 + n * step, bots[n - 1]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(x0 + i * step + step / 2, tops[i]);
  c.lineTo(x0, tops[0]); c.closePath(); c.fill();
}

let root: HTMLElement | null = null, openFn: (() => void) | null = null;

// Sesi MPCS ikut tersimpan di file project: audio asli (dikirim main.ts sebagai WAV) + hasil edit nada, posisi knob, dan rentang tampilan.
// Analisis pitch (pt) tidak disimpan: dihitung ulang dari audio yang sama saat project dibuka, lalu nada hasil edit dipasang menimpa hasil analisis.
export interface MpcsSaved { name: string; notes: Note[]; kv: Controls; lo: number; hi: number }
let exportFn: (() => { data: MpcsSaved; buf: AudioBuffer } | null) | null = null;
let importFn: ((buf: AudioBuffer | null, saved?: MpcsSaved) => Promise<void>) | null = null;
export const mpcsExport = (): { data: MpcsSaved; buf: AudioBuffer } | null => (exportFn ? exportFn() : null);
export async function mpcsImport(buf: AudioBuffer | null, saved?: MpcsSaved): Promise<void> {   // buf null = kosongkan sesi (project tanpa MPCS)
  if (!root) { if (!buf) return; build(); }
  await importFn?.(buf, saved);
}

// Dibuka dari tombol + di halaman Plugin pada panel efek (fx-rack.ts): pilih "MPCS" di card pilihan.
export function openMpcs(): void {
  if (!root) build();
  openFn?.();
}

function build(): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'mpcs'; el.hidden = true;
  el.innerHTML =
    '<div class="mpcs__back"></div>' +
    '<div class="mpcs__win is-off" role="dialog" aria-modal="true" aria-label="MPCS" tabindex="-1">' +
      `<header class="mpcs__head"><i class="mpcs__led" aria-hidden="true"></i><span class="mpcs__title">MPCS</span><div class="mpcs__lcd"><span class="mpcs__stat" role="status" aria-live="polite"></span></div><button type="button" class="mpcs__dl" aria-label="Download hasil olahan" aria-haspopup="menu" aria-expanded="false" title="Download hasil olahan (WAV / MP3)" disabled>${ICON.dl}</button><button type="button" class="mpcs__full" aria-label="Layar penuh piano roll" aria-pressed="false" title="Piano roll layar penuh (menu tetap di bawah)">${ICON.full}</button><button type="button" class="mpcs__drag" aria-label="Seret hasil olahan ke plugin DERIZ atau timeline" title="Tahan lalu seret: ke plugin DERIZ = jadi sample DERIZ, ke timeline = jadi track audio clip" disabled>${ICON.drag}</button><button type="button" class="mpcs__close" aria-label="Tutup MPCS">${ICON.close}</button><div class="mpcs__dlm" role="menu" aria-label="Format download" hidden><button type="button" role="menuitem" data-f="wav"><b>WAV</b><span>16-bit, tanpa kompresi</span></button><button type="button" role="menuitem" data-f="mp3"><b>MP3</b><span>192 kbps</span></button></div></header>` +
      '<div class="mpcs__mid">' +
      '<canvas class="mpcs__ov" aria-label="Peta posisi sample (ketuk / seret untuk pindah)" hidden></canvas>' +
      '<div class="mpcs__stage">' +
        '<canvas class="mpcs__keys" aria-hidden="true"></canvas>' +
        '<div class="mpcs__scroll"><div class="mpcs__plane"><canvas class="mpcs__cv" role="img" aria-label="Editor pitch"></canvas><i class="mpcs__ph" aria-hidden="true" title="Seret kiri / kanan untuk menaruh titik start"></i></div></div>' +
        `<div class="mpcs__empty"><button type="button" class="mpcs__up" data-a="up">${ICON.up}<span>Upload audio</span></button><p>Pakai vokal atau instrumen satu nada (monofonik) yang bersih tanpa efek.</p></div>` +
        '<div class="mpcs__busy" hidden><i></i></div>' +
        `<div class="mpcs__zoom" role="group" aria-label="Zoom" hidden><span class="mpcs__zg" aria-hidden="true" title="Zoom waktu">${ICON.zh}</span>` +
          `<button type="button" class="mpcs__zb" data-z="hout" aria-label="Zoom out waktu" title="Zoom out waktu (-)">${ICON.zout}</button>` +
          `<button type="button" class="mpcs__zb" data-z="hin" aria-label="Zoom in waktu" title="Zoom in waktu (+)">${ICON.zin}</button>` +
          '<i class="mpcs__zsep" aria-hidden="true"></i>' +
          `<span class="mpcs__zg" aria-hidden="true" title="Zoom tinggi nada">${ICON.zv}</span>` +
          `<button type="button" class="mpcs__zb" data-z="vout" aria-label="Zoom out tinggi nada" title="Zoom out tinggi nada">${ICON.zout}</button>` +
          `<button type="button" class="mpcs__zb" data-z="vin" aria-label="Zoom in tinggi nada" title="Zoom in tinggi nada">${ICON.zin}</button></div>` +
      '</div>' +
      '</div>' +
      '<div class="mpcs__bar">' +
        '<div class="mpcs__ups">' +
          `<button type="button" class="mpcs__up" data-a="up" title="Upload audio">${ICON.up}<span>Upload</span></button>` +
          `<button type="button" class="mpcs__up mpcs__all" data-a="all" aria-pressed="false" title="Pilih semua nada, lalu ketuk satu tuts piano di kiri untuk meratakan semuanya ke nada itu" disabled>${ICON.all}<span>Select all</span></button>` +
          `<button type="button" class="mpcs__up mpcs__cut" data-a="cut" title="Potong nada tepat di posisi playhead (garis putih): satu nada jadi dua, tiap potongan bisa digeser sendiri" disabled>${ICON.cut}<span>Cut</span></button>` +
        '</div>' +
        `<div class="mpcs__knobs">${KNOB_KEYS.map(knobHtml).join('')}</div>` +
        `<button type="button" class="mpcs__play" data-a="play" aria-label="Putar" disabled>${ICON.play}</button>` +
      '</div>' +
      '<div class="mpcs__glass" aria-hidden="true"></div>' +
      `<input type="file" class="mpcs__file" accept="${AUDIO_ACCEPT}" hidden>` +
    '</div>';
  document.body.appendChild(el);
  dragWindow({ root: el, move: el.querySelector<HTMLElement>('.mpcs__win')!, handle: '.mpcs__head' });   // jendela bisa digeser lewat header
  root = el;

  const win = el.querySelector<HTMLElement>('.mpcs__win')!;
  const stat = el.querySelector<HTMLElement>('.mpcs__stat')!;
  const stage = el.querySelector<HTMLElement>('.mpcs__stage')!;
  const scroll = el.querySelector<HTMLElement>('.mpcs__scroll')!;
  const cv = el.querySelector<HTMLCanvasElement>('.mpcs__cv')!;
  const keys = el.querySelector<HTMLCanvasElement>('.mpcs__keys')!;
  const ph = el.querySelector<HTMLElement>('.mpcs__ph')!;
  const empty = el.querySelector<HTMLElement>('.mpcs__empty')!;
  const busy = el.querySelector<HTMLElement>('.mpcs__busy')!;
  const zoomEl = el.querySelector<HTMLElement>('.mpcs__zoom')!;
  const file = el.querySelector<HTMLInputElement>('.mpcs__file')!;
  const btn = (a: string): HTMLButtonElement => el.querySelector<HTMLButtonElement>(`.mpcs__bar [data-a="${a}"]`)!;
  const ov = el.querySelector<HTMLCanvasElement>('.mpcs__ov')!;
  const dragBtn = el.querySelector<HTMLButtonElement>('.mpcs__drag')!;
  const fullBtn = el.querySelector<HTMLButtonElement>('.mpcs__full')!;
  const dlBtn = el.querySelector<HTMLButtonElement>('.mpcs__dl')!;
  const dlMenu = el.querySelector<HTMLElement>('.mpcs__dlm')!;
  const g = cv.getContext('2d')!, gk = keys.getContext('2d')!, go = ov.getContext('2d')!;

  // ---------- knob Center / Variation / Transition ----------
  let kv: Controls = { ...DEFAULT_CONTROLS };
  const knobEl = {} as Record<KnobKey, HTMLElement>;
  KNOB_KEYS.forEach(k => { knobEl[k] = el.querySelector<HTMLElement>(`.mpcs__bar [data-kn="${k}"]`)!; });
  function paintKnob(k: KnobKey): void {
    const e = knobEl[k], v = kv[k], arc = e.querySelector('.circle')!;
    e.querySelector<SVGElement>('.knob-pos')!.style.transform = `rotate(${-135 + v * 270}deg)`;
    if (KNOBS[k].bipolar) { const a = Math.min(v, 0.5) * 75, b = Math.max(v, 0.5) * 75; arc.setAttribute('stroke-dasharray', `0 ${a.toFixed(2)} ${(b - a).toFixed(2)} 100`); }   // arc dari tengah (50% = bawaan), seperti knob pan
    else arc.setAttribute('stroke-dasharray', `${(v * 75).toFixed(2)} 100`);
    const t = Math.round(v * 100) + '%';
    e.setAttribute('aria-valuenow', v.toFixed(3)); e.setAttribute('aria-valuetext', KNOBS[k].label + ' ' + t);
    e.closest('.mpcs__knob')!.querySelector('output')!.textContent = t;
  }
  const paintKnobs = (): void => KNOB_KEYS.forEach(paintKnob);
  const resetKnobs = (): void => { kv = { ...DEFAULT_CONTROLS }; paintKnobs(); };
  let restartT = 0;
  const lazyRestart = (): void => { if (!playing) return; clearTimeout(restartT); restartT = window.setTimeout(() => { if (playing) restartPlay(); }, 140); };   // memutar knob tidak memicu render tiap piksel
  function setKnob(k: KnobKey, v: number): void {
    const nv = Math.max(0, Math.min(1, v)); if (!S || nv === kv[k]) return;
    kv[k] = nv; paintKnob(k); dirty = true; ver++; draw(); info(); lazyRestart();   // draw(): garis oranye ikut berubah persis seperti yang akan terdengar
  }
  KNOB_KEYS.forEach(k => {
    const e = knobEl[k]; let sx = 0, sy = 0, sv = 0, dr = false;
    e.style.touchAction = 'none';
    e.addEventListener('pointerdown', ev => { if (!S) return; dr = true; e.classList.add('is-dragging'); sx = ev.clientX; sy = ev.clientY; sv = kv[k]; e.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    e.addEventListener('pointermove', ev => { if (dr) setKnob(k, sv + ((sy - ev.clientY) + (ev.clientX - sx)) / 150); });   // atas / kanan = naik, sama seperti knob lain
    const end = (): void => { dr = false; e.classList.remove('is-dragging'); };
    e.addEventListener('pointerup', end); e.addEventListener('pointercancel', end);
    e.addEventListener('dblclick', () => setKnob(k, DEFAULT_CONTROLS[k]));
    e.addEventListener('keydown', ev => {
      const st = ev.shiftKey ? 0.1 : 0.02;
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') { setKnob(k, kv[k] + st); ev.preventDefault(); ev.stopPropagation(); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') { setKnob(k, kv[k] - st); ev.preventDefault(); ev.stopPropagation(); }
    });
  });

  let S: Session | null = null, sel = -1, all = false, zy = 1, basePps = 100, pps = 100, W = 0, H = 0, viewH = 0, rowH = 12, dpr = 1;
  let ac: AudioContext | null = null, src: AudioBufferSourceNode | null = null, playing = false, playPos = 0, t0 = 0, raf = 0, mode: 'out' | 'orig' = 'out';
  let dirty = false, rendering = false, ver = 0, worker: Worker | null = null, jobId = 0;
  const jobs = new Map<number, { ok: (m: any) => void; fail: (e: Error) => void }>();   // eslint-disable-line @typescript-eslint/no-explicit-any

  // ---------- worker ----------
  function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./mpcs-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') { stat.textContent = 'Menganalisis ' + Math.round(m.p * 100) + '%'; return; }
      const j = jobs.get(m.id); if (!j) return;
      jobs.delete(m.id);
      if (m.type === 'error') j.fail(new Error(m.msg)); else j.ok(m);
    };
    worker.onerror = () => { jobs.forEach(j => j.fail(new Error('Worker gagal'))); jobs.clear(); };
    return worker;
  }
  const job = (msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<any> =>   // eslint-disable-line @typescript-eslint/no-explicit-any
    new Promise((ok, fail) => { const id = ++jobId; jobs.set(id, { ok, fail }); getWorker().postMessage({ ...msg, id }, transfer); });

  // ---------- tata letak & gambar ----------
  const xOf = (sec: number): number => sec * pps;
  const yOf = (midi: number): number => (S!.hi + 0.5 - midi) * rowH;
  function layout(): void {
    dpr = Math.min(2, devicePixelRatio || 1);
    viewH = stage.clientHeight;
    const rows = S ? S.hi - S.lo + 1 : 1;
    rowH = S ? Math.max(10, Math.max(24, viewH / rows) * zy) : 12;   // baris tidak dipepatkan lagi: kalau rentang nada lebar, kanvas jadi lebih tinggi dan di-scroll
    H = S ? Math.round(rowH * rows) : viewH;
    const viewW = scroll.clientWidth;
    W = S ? Math.max(viewW, Math.ceil(S.dur * pps)) : viewW;
    while (W * dpr > 16000 && pps > 10) { pps /= 1.25; W = Math.max(viewW, Math.ceil(S!.dur * pps)); }
    dpr = Math.max(1, Math.min(dpr, Math.sqrt(14e6 / (W * H))));   // batas luas kanvas supaya aman di HP
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    keys.width = Math.round(44 * dpr); keys.height = Math.round(viewH * dpr); keys.style.width = '44px'; keys.style.height = viewH + 'px';
    ph.style.height = H + 'px'; ph.style.transform = `translateX(${xOf(playPos)}px)`;   // playhead ikut posisi baru setelah zoom
    draw();
  }
  const ro = new ResizeObserver(() => { if (!el.hidden) layout(); });
  ro.observe(stage);

  // Tuts MPCS: gaya "Ivory Capsule" (sama dengan piano roll): rel kiri gelap, tuts putih gading berujung kapsul, tuts hitam ebony berkilap
  // pendek di atasnya; tuts putih mengisi barisnya + setengah baris tuts hitam di sebelahnya. Tuts yang diratakan (lit) menyala pink.
  const capsulePath = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r); c.lineTo(x, y + h); c.closePath();
  };
  function drawKeys(): void {
    gk.setTransform(dpr, 0, 0, dpr, 0, 0); gk.clearRect(0, 0, 44, viewH);
    if (!S) return;
    const s = S, off = scroll.scrollTop, hl = flatAt();   // hl: tuts tempat semua nada sedang diratakan (menyala)
    const RAIL = 5, WL = 44 - RAIL - 1, BL = 28, PINK = '#ff5c9e';
    const pcOf = (m: number): number => ((m % 12) + 12) % 12;
    const yOf = (m: number): number => (s.hi - m) * rowH - off;
    gk.fillStyle = '#13131a'; gk.fillRect(0, 0, 44, viewH);
    const rail = gk.createLinearGradient(0, 0, RAIL, 0); rail.addColorStop(0, '#30303f'); rail.addColorStop(1, '#1a1a23');
    gk.fillStyle = rail; gk.fillRect(0, 0, RAIL, viewH);
    const iv = gk.createLinearGradient(RAIL, 0, RAIL + WL, 0); iv.addColorStop(0, '#ece6da'); iv.addColorStop(0.5, '#fffdf9'); iv.addColorStop(1, '#d6d0c2');
    const eb = gk.createLinearGradient(RAIL, 0, RAIL + BL, 0); eb.addColorStop(0, '#454553'); eb.addColorStop(0.55, '#1b1b23'); eb.addColorStop(1, '#08080c');
    const hinge = gk.createLinearGradient(RAIL, 0, RAIL + 10, 0); hinge.addColorStop(0, 'rgba(0,0,0,.28)'); hinge.addColorStop(1, 'rgba(0,0,0,0)');
    const visible = (y: number): boolean => y < viewH + rowH && y + rowH * 2 > 0;
    // 1) tuts putih
    for (let m = s.lo; m <= s.hi; m++) {
      if (BLACK.has(pcOf(m))) continue;
      const y = yOf(m); if (!visible(y)) continue;
      const up = m + 1 <= s.hi && BLACK.has(pcOf(m + 1)), dn = m - 1 >= s.lo && BLACK.has(pcOf(m - 1));
      const top = y + (up ? -rowH / 2 : 0) + 0.5, bot = y + rowH + (dn ? rowH / 2 : 0) - 0.5, h = bot - top, lit = m === hl;
      const x = RAIL + (lit ? 1 : 0), w = WL - (lit ? 1 : 0), r = Math.min(h / 2, 5);
      gk.save(); if (lit) { gk.shadowColor = 'rgba(255,92,158,.6)'; gk.shadowBlur = 8; }
      capsulePath(gk, x, top, w, h, r); gk.fillStyle = lit ? PINK : iv; gk.fill(); gk.restore();
      gk.save(); capsulePath(gk, x, top, w, h, r); gk.clip();
      const sh = gk.createLinearGradient(0, top, 0, bot); sh.addColorStop(0, lit ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.55)'); sh.addColorStop(0.4, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.1)');
      gk.fillStyle = sh; gk.fillRect(x, top, w, h); gk.fillStyle = hinge; gk.fillRect(x, top, 10, h);
      gk.fillStyle = 'rgba(0,0,0,.18)'; gk.fillRect(x, bot - 1, w, 1);
      gk.restore();
    }
    // 2) tuts hitam
    for (let m = s.lo; m <= s.hi; m++) {
      if (!BLACK.has(pcOf(m))) continue;
      const y = yOf(m) + 1; if (!visible(y)) continue;
      const h = rowH - 2, lit = m === hl, x = RAIL + (lit ? 1 : 0), w = BL - (lit ? 1 : 0), r = Math.min(h / 2.2, 5);
      gk.save(); gk.shadowColor = lit ? 'rgba(255,92,158,.65)' : 'rgba(0,0,0,.55)'; gk.shadowBlur = lit ? 8 : 5; gk.shadowOffsetX = lit ? 0 : 2; gk.shadowOffsetY = lit ? 0 : 1;
      capsulePath(gk, x, y, w, h, r); gk.fillStyle = lit ? PINK : eb; gk.fill(); gk.restore();
      gk.save(); capsulePath(gk, x, y, w, h, r); gk.clip();
      gk.fillStyle = 'rgba(255,255,255,.2)'; gk.fillRect(x + 2, y + 0.5, w - 6, 1);
      const gl = gk.createLinearGradient(x, 0, x + w, 0); gl.addColorStop(0, 'rgba(255,255,255,.16)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      gk.fillStyle = gl; gk.fillRect(x + 1, y + h * 0.2, w - 3, Math.max(1.5, h * 0.2));
      gk.restore();
    }
    // 3) nama nada
    gk.font = '600 9px system-ui,sans-serif'; gk.textBaseline = 'middle'; gk.textAlign = 'left';
    for (let m = s.lo; m <= s.hi; m++) {
      const y = yOf(m), p = pcOf(m), lit = m === hl;
      if (!(rowH >= 13 || p === 0 || lit) || y > viewH || y + rowH < 0) continue;
      gk.fillStyle = lit ? '#fff' : BLACK.has(p) ? '#b6bad8' : '#4a4d6e';
      gk.fillText(noteName(m), RAIL + 4, y + rowH / 2 + 0.5);
    }
    gk.fillStyle = '#2c2c3d'; gk.fillRect(43, 0, 1, viewH);
  }

  // peta seluruh sample: bentuk amplitudo + posisi nada + kotak jendela yang sedang terlihat. Ketuk / seret buat pindah.
  let ovProf: Float32Array | null = null, ovKey = '';
  function drawOv(): void {
    if (!S) { ov.hidden = true; return; }
    ov.hidden = false;
    const w = ov.clientWidth, h = ov.clientHeight; if (!w || !h) return;
    const d = Math.min(2, devicePixelRatio || 1);
    if (ov.width !== Math.round(w * d) || ov.height !== Math.round(h * d)) { ov.width = Math.round(w * d); ov.height = Math.round(h * d); }
    go.setTransform(d, 0, 0, d, 0, 0); go.clearRect(0, 0, w, h);
    const key = S.name + '|' + S.pk.mn.length + '|' + w + '|' + h;
    if (key !== ovKey || !ovProf) {   // atas & bawah polygon per pixel (min/max sample), dihitung ulang hanya kalau ukuran berubah / sample baru
      ovKey = key; ovProf = new Float32Array(w * 2);
      const r = [0, 0], mid = h / 2, amp = h * .45;
      for (let px = 0; px < w; px++) {
        peakRange(S.pk, S.sr, px / w * S.dur, (px + 1) / w * S.dur, r);
        let yt = mid - r[1] * S.pk.norm * amp, yb = mid - r[0] * S.pk.norm * amp;
        if (yb - yt < 1.5) { yt = mid - .75; yb = mid + .75; }
        ovProf[px] = yt; ovProf[w + px] = yb;
      }
    }
    go.fillStyle = 'rgba(214,60,130,.35)';
    fillColumns(go, 0, 1, ovProf.subarray(0, w), ovProf.subarray(w, w * 2), w);
    const rows = S.hi - S.lo + 1, hopSec = S.pt.hop / S.pt.sr;
    go.fillStyle = '#ffc857';
    for (const n of S.notes) go.fillRect(n.s * hopSec / S.dur * w, (S.hi + .5 - n.target) / rows * h - 1.5, Math.max(2, (n.e - n.s) * hopSec / S.dur * w), 3);
    go.fillStyle = '#fff'; go.fillRect(Math.min(w - 1, playPos / S.dur * w), 0, 1.5, h);
    go.strokeStyle = 'rgba(255,255,255,.9)'; go.lineWidth = 1.2; go.fillStyle = 'rgba(255,255,255,.08)';
    const vx = scroll.scrollLeft / W * w, vw = Math.min(w, scroll.clientWidth / W * w), vy = scroll.scrollTop / H * h, vh = Math.min(h, viewH / H * h);
    go.beginPath(); go.roundRect(vx + .5, vy + .5, Math.max(4, vw - 1), Math.max(4, vh - 1), 3); go.fill(); go.stroke();
  }
  const ovGo = (e: PointerEvent): void => {
    if (!S) return;
    const r = ov.getBoundingClientRect(), fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    scroll.scrollLeft = fx * W - scroll.clientWidth / 2; scroll.scrollTop = fy * H - viewH / 2;
  };
  let ovDrag = false;
  ov.addEventListener('pointerdown', e => { ovDrag = true; ov.setPointerCapture(e.pointerId); ovGo(e); });
  ov.addEventListener('pointermove', e => { if (ovDrag) ovGo(e); });
  const ovEnd = (): void => { ovDrag = false; };
  ov.addEventListener('pointerup', ovEnd); ov.addEventListener('pointercancel', ovEnd);
  scroll.addEventListener('scroll', () => { drawKeys(); drawOv(); }, { passive: true });

  function draw(): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    drawKeys(); drawOv();
    if (!S) return;
    const { lo, hi, pt, notes, pk, sr } = S, hopSec = pt.hop / pt.sr;
    const sc = shiftCurve(pt, notes, undefined, kv);   // geseran per frame persis seperti yang dirender (target, knob, drift, vibrato), jadi garis = yang terdengar
    // baris semiton
    for (let m = lo; m <= hi; m++) {
      const y = (hi - m) * rowH, pc = ((m % 12) + 12) % 12;
      g.fillStyle = BLACK.has(pc) ? '#120f14' : '#1b161d'; g.fillRect(0, y, W, rowH);
      if (pc === 0) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, y + rowH - 1, W, 1); }
    }
    // garis detik
    g.font = '9px system-ui,sans-serif'; g.textBaseline = 'top';
    for (let s = 0; s <= S.dur; s++) { const x = Math.round(xOf(s)) + .5; g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, 0, 1, H); g.fillStyle = '#6c6c7c'; g.fillText(s + 's', x + 3, 2); }
    // nada
    notes.forEach((nt, i) => {
      const x0 = xOf((nt.s - .5) * hopSec), x1 = xOf((nt.e - .5) * hopSec), yc = yOf(nt.target);
      const on = i === sel || all;
      if (on) {   // tanpa card pink: hanya garis putih tipis penanda nada terpilih
        g.strokeStyle = '#fff'; g.lineWidth = 1.5;
        g.beginPath(); g.roundRect(x0, yc - rowH * .5, Math.max(4, x1 - x0), rowH, Math.min(5, rowH / 2)); g.stroke();
      }
      // waveform sample asli (min/max per kolom pixel, satu polygon solid) mengikuti garis pitch hasil
      const nF = nt.e - nt.s, cy = new Float32Array(nF); let last = NaN;
      for (let i = 0; i < nF; i++) { const f = nt.s + i; cy[i] = pt.f0[f] ? yOf(69 + 12 * Math.log2(pt.f0[f] / 440) + sc[f]) : NaN; }
      for (let i = 0; i < nF; i++) { if (cy[i] === cy[i]) last = cy[i]; else cy[i] = last; }   // frame tanpa pitch: pakai titik sebelumnya
      for (let i = nF - 1, nx = NaN; i >= 0; i--) { if (cy[i] === cy[i]) nx = cy[i]; else cy[i] = nx; }
      if (nF > 0 && cy[0] === cy[0]) {
        const px = 1 / dpr, xa = Math.max(0, Math.floor(x0 * dpr) / dpr), xb = Math.min(W, x1), n = Math.ceil((xb - xa) / px);
        const tops = new Float32Array(Math.max(0, n)), bots = new Float32Array(Math.max(0, n)), r = [0, 0], half = rowH * .5;
        peakRange(pk, sr, (nt.s - .5) * hopSec, (nt.e - .5) * hopSec, r);
        const lp = Math.max(-r[0], r[1]), norm = lp > 1e-4 ? 1 / lp : 1;   // skala per nada: puncak nada ini = tinggi penuh blok, jadi nada pelan pun memenuhi blok
        for (let i = 0; i < n; i++) {
          const x = xa + i * px;
          peakRange(pk, sr, x / pps, (x + px) / pps, r);
          const fi = Math.max(0, Math.min(nF - 1, x / pps / hopSec - nt.s)), i0 = Math.floor(fi), i1 = Math.min(nF - 1, i0 + 1);
          const m = cy[i0] + (cy[i1] - cy[i0]) * (fi - i0);
          let yt = m - r[1] * norm * half, yb = m - r[0] * norm * half;
          if (yb - yt < 2 * px) { yt = m - px; yb = m + px; }   // minimal 2 pixel supaya bagian senyap tetap terlihat
          tops[i] = yt; bots[i] = yb;
        }
        g.fillStyle = '#e0458a';
        fillColumns(g, xa, px, tops, bots, n);
      }
      if (i > 0 && notes[i - 1].e >= nt.s && x1 - x0 > 6) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(Math.round(x0), yc - rowH * .5, 1, rowH); }   // garis potongan: nada ini menempel tepat di nada sebelumnya
      // pitch asli (redup, hanya kalau digeser) dan pitch hasil (oranye)
      const line = (add: number | Float32Array, style: string, w: number): void => {
        g.strokeStyle = style; g.lineWidth = w; g.beginPath();
        for (let f = nt.s; f < nt.e; f++) { if (!pt.f0[f]) continue; const x = xOf(f * hopSec), y = yOf(69 + 12 * Math.log2(pt.f0[f] / 440) + (typeof add === 'number' ? add : add[f])); f === nt.s ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      };
      let moved = false; for (let f = nt.s; f < nt.e; f++) if (pt.f0[f] && Math.abs(sc[f]) > .01) { moved = true; break; }
      if (moved) line(0, 'rgba(255,255,255,.28)', 1);   // pitch asli (redup) kalau hasilnya berbeda: digeser, drift, atau vibrato diubah
      line(sc, '#ffc857', 1.4);
    });
  }

  // ---------- status ----------
  // Select all: semua nada terpilih; ketuk satu tuts piano di kiri = semua nada diratakan lurus ke tuts itu (diperlakukan seperti nada atur-tangan: koreksi penuh)
  function flatAt(): number {
    if (!all || !S || !S.notes.length) return NaN;
    const t = S.notes[0].target; return S.notes.every(n => n.man && n.target === t) ? t : NaN;
  }
  function paintAll(): void { const b = btn('all'); b.classList.toggle('is-on', all); b.setAttribute('aria-pressed', String(all)); }
  function setAll(on: boolean): void {
    all = on && !!S && S.notes.length > 0; if (all) sel = -1;
    paintAll(); draw(); info();
  }
  // Cut: nada yang sedang dilewati playhead dipecah jadi dua tepat di posisi playhead. Kedua potongan mewarisi pitch asli (midi), target, dan pengaturan nada induknya,
  // jadi suara tidak berubah sampai salah satu potongan digeser. Batas potongan = frame terdekat dari playhead; sisa minimal MIN_CUT frame di tiap sisi.
  const MIN_CUT = 3;
  function cutAtPlayhead(): void {
    if (!S) return;
    const hopSec = S.pt.hop / S.pt.sr, c = Math.round(playPos / hopSec + .5);   // kebalikan dari x = (frame - .5) * hopSec yang dipakai gambar nada
    const i = S.notes.findIndex(n => c - n.s >= MIN_CUT && n.e - c >= MIN_CUT);
    if (i < 0) {
      const near = S.notes.some(n => c > n.s && c < n.e);
      stat.textContent = near ? 'Terlalu dekat ujung nada, geser playhead' : 'Tidak ada nada di playhead';
      window.setTimeout(info, 1800); return;
    }
    const a = S.notes[i], b: Note = { ...a, s: c };
    a.e = c; S.notes.splice(i + 1, 0, b);
    if (all) { all = false; paintAll(); }
    sel = i + 1;   // potongan kanan langsung terpilih, siap digeser
    edit();
  }

  keys.addEventListener('pointerdown', e => {
    if (!S || !all) return;
    e.preventDefault();
    const r = keys.getBoundingClientRect(), m = S.hi - Math.floor((e.clientY - r.top + scroll.scrollTop) / rowH), t = Math.max(S.lo, Math.min(S.hi, m));
    let ch = false;
    for (const n of S.notes) if (n.target !== t || !n.man) { n.target = t; n.man = true; ch = true; }
    if (ch) edit(); else draw();
    info();
  });

  function info(): void {
    if (!S) { stat.textContent = ''; return; }
    if (all) { const t = flatAt(); stat.textContent = t === t ? 'Semua nada rata di ' + noteName(t) : 'Semua nada terpilih: ketuk tuts piano'; return; }
    if (sel >= 0) { const n = S.notes[sel], eff = (n.man ? 1 : kv.center) * (n.target - n.midi); stat.textContent = noteName(n.midi) + (Math.round((n.midi - Math.round(n.midi)) * 100) ? ' ' + fmtShift(n.midi - Math.round(n.midi)) : '') + ' → ' + noteName(n.target) + '  (' + fmtShift(eff) + (n.man ? ', manual' : '') + ')'; }
    else stat.textContent = S.notes.length ? S.notes.length + ' nada terdeteksi' : 'Tidak ada nada terdeteksi';
  }
  function enable(on: boolean): void {
    btn('play').disabled = !on; btn('all').disabled = !on; btn('cut').disabled = !on; zoomEl.hidden = !on; dragBtn.disabled = !on; dlBtn.disabled = !on; if (!on) setDlMenu(false); win.classList.toggle('is-off', !on);
    KNOB_KEYS.forEach(k => { knobEl[k].closest('.mpcs__knob')!.classList.toggle('is-off', !on); });
  }
  function setBusy(on: boolean): void { busy.hidden = !on; }

  // ---------- muat & analisis ----------
  let loadTok = 0;   // muatan yang lebih baru membatalkan yang lama (upload baru / project dibuka saat analisis masih jalan)
  async function loadWith(get: () => Promise<{ buf: AudioBuffer; name: string }>, saved?: MpcsSaved): Promise<void> {
    const my = ++loadTok;
    stopPlay(); enable(false); setBusy(true); empty.hidden = true; stat.textContent = 'Membaca audio';
    try {
      ac ??= new AudioContext();
      let { buf, name } = await get();
      if (my !== loadTok) return;
      if (DEMO && buf.duration > LIMITS.mpcsSec) { buf = demoTrim(buf, LIMITS.mpcsSec); stat.textContent = `Demo: dipakai ${LIMITS.mpcsSec} detik pertama`; }   // DEMO: audio dipotong
      const mono = toMono(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice()));
      stat.textContent = 'Menganalisis 0%';
      const r = await job({ type: 'analyze', x: mono, sr: buf.sampleRate }, [mono.buffer]);
      if (my !== loadTok) return;
      let notes: Note[] = r.notes; const pt: PitchTrack = r.pt;
      if (saved) { notes = saved.notes.map(n => ({ ...n })); kv = { ...DEFAULT_CONTROLS, ...saved.kv }; paintKnobs(); }   // project dibuka: pakai nada & knob hasil edit, bukan hasil analisis mentah
      else { snapTargets(notes); resetKnobs(); }   // target = semiton terdekat (hysteresis); Lock 0% jadi audio belum berubah sampai knob diputar
      let lo = 48, hi = 72;
      if (saved && Number.isFinite(saved.lo) && Number.isFinite(saved.hi)) { lo = saved.lo; hi = saved.hi; }
      else if (notes.length) {
        lo = Math.floor(Math.min(...notes.map(n => Math.min(n.midi, n.target)))) - 3; hi = Math.ceil(Math.max(...notes.map(n => Math.max(n.midi, n.target)))) + 3;
        while (hi - lo < 23) { lo--; hi++; }
        if (hi - lo > 84) { const c = (hi + lo) >> 1; lo = c - 42; hi = c + 42; }
      }
      const sorted = Array.from(pt.rms).sort((a, b) => a - b);
      S = { name, sr: buf.sampleRate, dur: buf.duration, pt, notes, orig: buf, out: null, lo, hi, ref: sorted[Math.floor(sorted.length * .95)] || 0.1, pk: buildPeaks(buf) };
      sel = -1; all = false; paintAll(); dirty = true; playPos = 0; ph.style.transform = 'translateX(0)';
      pps = Math.max(40, Math.min(400, scroll.clientWidth / Math.max(1, buf.duration)));
      scroll.scrollLeft = 0; zy = 1; layout(); basePps = pps; info(); enable(true);
      if (notes.length) { const mt = notes.reduce((a, n) => a + n.target, 0) / notes.length; scroll.scrollTop = Math.max(0, yOf(mt) - viewH / 2); drawKeys(); drawOv(); } else scroll.scrollTop = 0;
    } catch (err) {
      if (my !== loadTok) return;
      S = null; empty.hidden = false; draw(); stat.textContent = 'Gagal memuat audio';
      console.error(err);
    } finally { if (my === loadTok) setBusy(false); }
  }
  async function load(f: File): Promise<void> {
    if (!isAudio(f)) { stat.textContent = 'File bukan audio'; return; }
    await loadWith(async () => ({ buf: await ac!.decodeAudioData(await f.arrayBuffer()), name: f.name.replace(/\.[^.]+$/, '') }));
  }
  exportFn = () => S ? { data: { name: S.name, notes: S.notes.map(n => ({ ...n })), kv: { ...kv }, lo: S.lo, hi: S.hi }, buf: S.orig } : null;
  importFn = async (buf, saved) => {
    if (buf && saved) { await loadWith(async () => ({ buf, name: saved.name || 'Audio' }), saved); return; }
    loadTok++; stopPlay(); S = null; sel = -1; all = false; resetKnobs(); enable(false); setBusy(false); empty.hidden = false; draw(); info();   // project tanpa MPCS: sesi lama dikosongkan
  };

  // ---------- render hasil (di Worker), lalu putar ----------
  async function ensureRendered(): Promise<AudioBuffer | null> {
    if (!S) return null;
    if (!dirty && S.out) return S.out;
    if (rendering) { await new Promise<void>(r => { const t = setInterval(() => { if (!rendering) { clearInterval(t); r(); } }, 40); }); return ensureRendered(); }
    rendering = true; const my = ver;
    try {
      const r = await job({ type: 'render', notes: S.notes, ctl: { ...kv } });
      const out = ac!.createBuffer(1, r.y.length, S.sr); out.copyToChannel(r.y, 0);
      S.out = out; if (my === ver) dirty = false;
    } finally { rendering = false; }
    return dirty ? ensureRendered() : S.out;
  }
  const edit = (): void => { dirty = true; ver++; draw(); info(); if (playing) restartPlay(); };

  function stopPlay(): void {
    if (src) { src.onended = null; try { src.stop(); } catch { /* sudah berhenti */ } src.disconnect(); src = null; }
    if (playing) { playing = false; btn('play').innerHTML = ICON.play; btn('play').setAttribute('aria-label', 'Putar'); btn('play').classList.remove('is-on'); }
    cancelAnimationFrame(raf); raf = 0;
  }
  async function startPlay(): Promise<void> {
    if (!S || !ac) return;
    await ac.resume();
    let b: AudioBuffer | null = S.orig;
    if (mode === 'out') { btn('play').disabled = true; stat.textContent = 'Merender'; try { b = await ensureRendered(); } finally { btn('play').disabled = false; } info(); }
    if (!b || !S) return;
    stopPlay();
    if (playPos >= S.dur - .02) playPos = 0;
    src = ac.createBufferSource(); src.buffer = b; src.connect(ac.destination);
    src.onended = () => { if (playing) { playPos = 0; stopPlay(); moveHead(0); } };
    src.start(0, playPos); t0 = ac.currentTime - playPos; playing = true;
    btn('play').innerHTML = ICON.pause; btn('play').setAttribute('aria-label', 'Jeda'); btn('play').classList.add('is-on');
    const tick = (): void => {
      if (!playing || !ac) return;
      playPos = Math.min(S!.dur, ac.currentTime - t0); moveHead(playPos, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function restartPlay(): void { if (playing) { playPos = Math.max(0, (ac?.currentTime ?? 0) - t0); void startPlay(); } }
  function moveHead(sec: number, follow = false): void {
    const x = xOf(sec); ph.style.transform = `translateX(${x}px)`; drawOv();
    if (follow) { const v = scroll.clientWidth; if (x < scroll.scrollLeft || x > scroll.scrollLeft + v * .9) scroll.scrollLeft = Math.max(0, x - v * .1); }
  }

  // ---------- zoom piano roll ----------
  // Dua sumbu: waktu (pps = piksel per detik) dan tinggi nada (zy = pengali tinggi baris). Titik di bawah jari / kursor / playhead tetap diam saat zoom (jangkar).
  // Cara: tombol di pojok kanan atas, tombol + / - / 0 di keyboard, Ctrl + roda (Ctrl+Shift = tinggi nada, pinch trackpad ikut), cubit dua jari (cubit mendatar = waktu, menegak = tinggi nada).
  const ZSTEP = 1.4;
  function ppsLimits(): [number, number] {
    const fit = Math.max(2, scroll.clientWidth / S!.dur), cap = 16000 / Math.min(2, devicePixelRatio || 1) / S!.dur;   // cap: batas lebar kanvas supaya aman di HP
    const lo = Math.min(fit, cap);
    return [lo, Math.max(lo, Math.min(cap, Math.max(1200, basePps * 4)))];   // terkecil = seluruh sample pas satu layar
  }
  const clampZy = (v: number): number => Math.max(.5, Math.min(3, v));
  const clampPps = (v: number): number => { const [lo, hi] = ppsLimits(); return Math.max(lo, Math.min(hi, v)); };
  function zoomTo(np: number, nz: number, sec: number, row: number, ax: number, ay: number): void {
    pps = clampPps(np); zy = clampZy(nz);
    layout();
    scroll.scrollLeft = sec * pps - ax; scroll.scrollTop = row * rowH - ay;
  }
  let zRaf = 0, zT = 0;
  function zoomNote(): void {
    const h = Math.round(pps / basePps * 100), v = Math.round(zy * 100);
    stat.textContent = 'Zoom ' + h + '%' + (v !== 100 ? ' · Nada ' + v + '%' : '');
    clearTimeout(zT); zT = window.setTimeout(info, 1400);
  }
  const anchorAt = (ax: number, ay: number): { sec: number; row: number } => ({ sec: (scroll.scrollLeft + ax) / pps, row: (scroll.scrollTop + ay) / rowH });
  function zoomBy(fx: number, fy: number): void {   // tombol / keyboard: beranimasi; jangkar = playhead kalau sedang terlihat, kalau tidak tengah layar
    if (!S) return;
    const vw = scroll.clientWidth, phx = xOf(playPos) - scroll.scrollLeft, ax = phx >= 0 && phx <= vw ? phx : vw / 2, ay = viewH / 2, { sec, row } = anchorAt(ax, ay);
    const p0 = pps, z0 = zy, p1 = clampPps(p0 * fx), z1 = clampZy(z0 * fy);
    cancelAnimationFrame(zRaf);
    if (p1 === p0 && z1 === z0) { zoomNote(); return; }
    if (reduce) { zoomTo(p1, z1, sec, row, ax, ay); zoomNote(); return; }
    const t0 = performance.now(), D = 170;
    const step = (now: number): void => {
      const u = Math.min(1, (now - t0) / D), e = 1 - (1 - u) ** 3;
      zoomTo(p0 * (p1 / p0) ** e, z0 * (z1 / z0) ** e, sec, row, ax, ay);
      if (u < 1) zRaf = requestAnimationFrame(step); else zoomNote();
    };
    zRaf = requestAnimationFrame(step);
  }
  const zoomReset = (): void => { if (S) zoomBy(basePps / pps, 1 / zy); };
  zoomEl.addEventListener('click', e => {
    const z = (e.target as Element).closest<HTMLButtonElement>('button[data-z]')?.dataset.z; if (!z) return;
    zoomBy(z === 'hin' ? ZSTEP : z === 'hout' ? 1 / ZSTEP : 1, z === 'vin' ? ZSTEP : z === 'vout' ? 1 / ZSTEP : 1);
  });
  scroll.addEventListener('wheel', e => {   // Ctrl + roda (juga pinch trackpad): langsung, tanpa animasi, jangkar di kursor
    if (!S || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); cancelAnimationFrame(zRaf);
    const d = Math.exp(-(e.deltaY || e.deltaX) * (e.deltaMode === 1 ? .05 : .0025)), r = scroll.getBoundingClientRect(), ax = e.clientX - r.left, ay = e.clientY - r.top, { sec, row } = anchorAt(ax, ay);
    zoomTo(pps * (e.shiftKey ? 1 : d), zy * (e.shiftKey ? d : 1), sec, row, ax, ay); zoomNote();
  }, { passive: false });

  // cubit dua jari di kanvas: jarak mendatar antar jari = waktu, jarak menegak = tinggi nada; titik tengah jari = jangkar (geser dua jari ikut menggeser tampilan)
  const ptrs = new Map<number, { x: number; y: number }>();
  let pinch: { dx: number; dy: number; pps: number; zy: number; sec: number; row: number } | null = null, pRaf = 0;
  const twoPtrs = (): { dx: number; dy: number; mx: number; my: number } => {
    const [a, b] = Array.from(ptrs.values()), r = scroll.getBoundingClientRect();
    return { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  };
  function startPinch(): void {
    cancelAnimationFrame(zRaf); drag = null; pan = null;
    const t = twoPtrs(), { sec, row } = anchorAt(t.mx, t.my);
    pinch = { dx: Math.max(28, t.dx), dy: Math.max(28, t.dy), pps, zy, sec, row };
  }
  function pinchApply(): void {
    pRaf = 0; if (!pinch || ptrs.size < 2) return;
    const t = twoPtrs();
    zoomTo(pinch.pps * Math.max(28, t.dx) / pinch.dx, pinch.zy * Math.max(28, t.dy) / pinch.dy, pinch.sec, pinch.row, t.mx, t.my); zoomNote();
  }

  // ---------- seret playhead ----------
  // Kepala / garis playhead bisa diseret kiri-kanan untuk menaruh titik start (dan titik potong Cut). Titik genggam dijaga supaya garis tidak melompat ke jari;
  // dekat tepi tampilan, area ikut bergulir. Kalau sedang diputar: berhenti selama diseret, lalu lanjut putar dari titik baru saat dilepas.
  let phd: { id: number; off: number; cx: number; was: boolean; raf: number } | null = null;
  function phTick(): void {
    if (!phd || !S) return;
    phd.raf = 0;
    const r = scroll.getBoundingClientRect(), EDGE = 28, dl = phd.cx - r.left, dr = r.right - phd.cx;
    const v = dl < EDGE ? -(EDGE - Math.max(0, dl)) / EDGE * 16 : dr < EDGE ? (EDGE - Math.max(0, dr)) / EDGE * 16 : 0;
    if (v) scroll.scrollLeft += v;
    playPos = Math.max(0, Math.min(S.dur, (phd.cx - r.left + scroll.scrollLeft - phd.off) / pps));
    moveHead(playPos);
    clearTimeout(zT); stat.textContent = 'Start ' + playPos.toFixed(2) + ' s';
    if (v) phd.raf = requestAnimationFrame(phTick);   // terus bergulir selagi jari menahan di tepi
  }
  const phMove = (e: PointerEvent): void => { if (!phd || e.pointerId !== phd.id) return; phd.cx = e.clientX; if (!phd.raf) phd.raf = requestAnimationFrame(phTick); };
  function phEnd(e: PointerEvent): void {
    if (!phd || e.pointerId !== phd.id) return;
    const d = phd; phd = null; cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', phMove); window.removeEventListener('pointerup', phEnd); window.removeEventListener('pointercancel', phEnd);
    ph.classList.remove('is-drag');
    clearTimeout(zT); zT = window.setTimeout(info, 1400);
    if (d.was) void startPlay();
  }
  ph.addEventListener('pointerdown', e => {
    if (!S || phd) return;
    e.preventDefault(); e.stopPropagation();
    const r = scroll.getBoundingClientRect();
    phd = { id: e.pointerId, off: e.clientX - r.left + scroll.scrollLeft - xOf(playPos), cx: e.clientX, was: playing, raf: 0 };
    if (playing) stopPlay();
    ph.classList.add('is-drag');
    window.addEventListener('pointermove', phMove); window.addEventListener('pointerup', phEnd); window.addEventListener('pointercancel', phEnd);
  });

  // ---------- seret blok ----------
  let drag: { i: number; y0: number; base: number; moved: boolean; id: number } | null = null;
  let pan: { x0: number; y0: number; sl: number; st: number; px: number; moved: boolean; id: number } | null = null;
  const hit = (x: number, y: number): number => {
    if (!S) return -1;
    const hopSec = S.pt.hop / S.pt.sr; let best = -1, bd = 1e9;
    S.notes.forEach((n, i) => {
      const x0 = xOf((n.s - .5) * hopSec) - 4, x1 = xOf((n.e - .5) * hopSec) + 4, yc = yOf(n.target), pad = Math.max(rowH * .7, 16);
      if (x < x0 || x > x1 || Math.abs(y - yc) > pad) return;
      const d = Math.abs(y - yc); if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  cv.addEventListener('pointerdown', e => {
    if (!S) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size >= 2) { cv.setPointerCapture(e.pointerId); if (ptrs.size === 2) startPinch(); return; }   // jari kedua = cubit zoom, bukan seret nada
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, i = hit(x, y);
    if (i < 0) { pan = { x0: e.clientX, y0: e.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop, px: x, moved: false, id: e.pointerId }; cv.setPointerCapture(e.pointerId); return; }
    if (all) { all = false; paintAll(); }   // ketuk satu nada = kembali ke pilihan tunggal
    sel = i; drag = { i, y0: e.clientY, base: Math.round(S.notes[i].target), moved: false, id: e.pointerId };
    cv.setPointerCapture(e.pointerId); draw(); info();
  });
  cv.addEventListener('pointermove', e => {
    const pp = ptrs.get(e.pointerId); if (pp) { pp.x = e.clientX; pp.y = e.clientY; }
    if (pinch) { if (!pRaf) pRaf = requestAnimationFrame(pinchApply); return; }
    if (pan && e.pointerId === pan.id) {
      const dx = e.clientX - pan.x0, dy = e.clientY - pan.y0;
      if (!pan.moved && Math.hypot(dx, dy) < 6) return;
      pan.moved = true; scroll.scrollTop = pan.st - dy; scroll.scrollLeft = pan.sl - dx;   // geser dua sumbu lewat JS (kanvas touch-action: none supaya cubit zoom tidak direbut browser)
      return;
    }
    if (!drag || !S || e.pointerId !== drag.id) return;
    const dy = drag.y0 - e.clientY;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    const t = Math.max(S.lo + 1, Math.min(S.hi - 1, drag.base + Math.round(dy / rowH)));
    if (t !== S.notes[drag.i].target || !S.notes[drag.i].man) { S.notes[drag.i].target = t; S.notes[drag.i].man = true; edit(); }   // diseret tangan: dikoreksi penuh, di luar knob Lock
  });
  const endDrag = (e: PointerEvent): void => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (drag && e.pointerId === drag.id) drag = null;
    if (pan && e.pointerId === pan.id) {
      const p = pan; pan = null;
      if (!p.moved && e.type === 'pointerup' && S) { sel = -1; if (all) { all = false; paintAll(); } playPos = Math.max(0, Math.min(S.dur, p.px / pps)); moveHead(playPos); if (playing) restartPlay(); draw(); info(); }   // ketuk kosong = pindah playhead
    }
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

  // ---------- seret hasil olahan ke plugin DERIZ ----------
  // Tahan ikon grip: kartu MPCS disembunyikan, hanya ikon yang melayang mengikuti jari / kursor. Lepas di atas kanvas DERIZ = hasil render masuk jadi sample DERIZ
  // (lewat event 'mpcs-sample' yang ditangkap fx-rack, jalur yang sama dengan upload file). Pakai pointer events buatan sendiri karena drag & drop HTML tidak jalan dengan sentuhan.
  const LIFT = 38;   // di layar sentuh ikon melayang di atas jari supaya tidak tertutup; titik jatuhnya = posisi ikon
  let dg: { id: number; x0: number; y0: number; touch: boolean; ghost: HTMLElement | null; over: HTMLElement | null; res: Promise<AudioBuffer | null> | null; name: string } | null = null;
  const stageAt = (x: number, y: number): HTMLElement | null => {
    for (const n of document.elementsFromPoint(x, y)) { if (n.closest('.mpcs')) continue; return n.closest<HTMLElement>('.deriz__stage') ?? n.closest<HTMLElement>('.workspace'); }   // elemen pertama di bawah MPCS (kartu yang disembunyikan tetap ikut hit-test); kanvas DERIZ = jadi sample, timeline = jadi track audio clip baru
    return null;
  };
  const dgPoint = (e: PointerEvent): { x: number; y: number } => ({ x: e.clientX, y: e.clientY - (dg?.touch ? LIFT : 0) });
  function dgMove(e: PointerEvent): void {
    if (!dg || e.pointerId !== dg.id) return;
    if (!dg.ghost) {
      if (Math.hypot(e.clientX - dg.x0, e.clientY - dg.y0) < 8) return;   // di bawah 8 px = ketukan biasa, kartu belum disembunyikan
      stopPlay();
      const gh = document.createElement('div'); gh.className = 'mpcs__ghost'; gh.innerHTML = ICON.drag; document.body.appendChild(gh);
      dg.ghost = gh; el.classList.add('is-dragout');
      dg.res = ensureRendered().catch(() => null);   // render hasil dimulai sekarang, selesai sebelum dilepas
    }
    e.preventDefault();
    const p = dgPoint(e);
    dg.ghost.style.transform = `translate(${p.x - 20}px,${p.y - 20}px)`;
    const s = stageAt(p.x, p.y);
    if (s !== dg.over) { dg.over?.classList.remove('is-over'); s?.classList.add('is-over'); dg.over = s; dg.ghost.classList.toggle('is-hot', !!s); }
  }
  async function dgEnd(e: PointerEvent): Promise<void> {
    if (!dg || e.pointerId !== dg.id) return;
    const d = dg; dg = null;
    window.removeEventListener('pointermove', dgMove); window.removeEventListener('pointerup', dgEnd); window.removeEventListener('pointercancel', dgEnd);
    if (!d.ghost) { stat.textContent = 'Tahan lalu seret ke DERIZ / timeline'; window.setTimeout(info, 1800); return; }   // ketukan tanpa geser
    d.over?.classList.remove('is-over');
    const p = { x: e.clientX, y: e.clientY - (d.touch ? LIFT : 0) }, target = e.type === 'pointerup' ? stageAt(p.x, p.y) : null;
    if (!target) { d.ghost.remove(); el.classList.remove('is-dragout'); stat.textContent = 'Lepas di atas plugin DERIZ atau timeline'; window.setTimeout(info, 1800); return; }   // jatuh di tempat lain: kartu kembali
    d.ghost.classList.add('is-busy');
    const out = await d.res;
    d.ghost.remove(); el.classList.remove('is-dragout');
    if (!out || !target.isConnected) { stat.textContent = out ? 'Plugin DERIZ sudah tidak ada' : 'Gagal merender'; window.setTimeout(info, 1800); return; }
    const f = new File([encodeWavFloat(DEMO ? demoMarked(out.getChannelData(0), out.sampleRate) : out.getChannelData(0), out.sampleRate)], d.name + '-MPCS.wav', { type: 'audio/wav' });
    if (target.classList.contains('workspace')) document.dispatchEvent(new CustomEvent('mpcs-audioclip', { detail: { file: f, x: p.x } }));   // timeline: main.ts bikin track Audio clip baru, clip diletakkan di bar tempat dilepas
    else target.dispatchEvent(new CustomEvent('mpcs-sample', { bubbles: true, detail: { file: f } }));
    stopPlay(); untilt(); el.hidden = true;   // hasil sudah terpasang (DERIZ / timeline): MPCS ditutup supaya terlihat
  }
  dragBtn.addEventListener('pointerdown', e => {
    if (!S || dragBtn.disabled || dg) return;
    e.preventDefault();
    dg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', ghost: null, over: null, res: null, name: S.name };
    window.addEventListener('pointermove', dgMove, { passive: false }); window.addEventListener('pointerup', dgEnd); window.addEventListener('pointercancel', dgEnd);
  });

  // ---------- tombol ----------
  el.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.mpcs__bar button'); if (!b || b.disabled) return;
    if (b.dataset.a === 'up') file.click(); else if (b.dataset.a === 'all') setAll(!all); else if (b.dataset.a === 'cut') cutAtPlayhead(); else if (b.dataset.a === 'play') { if (playing) stopPlay(); else void startPlay(); }
  });
  empty.querySelector('button')!.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) void load(f); });
  el.addEventListener('dragover', e => e.preventDefault());
  el.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files[0]; if (f) void load(f); });

  // ---------- efek 3D: faceplate miring mengikuti kursor (mouse saja, mati di atas editor / saat drag / reduced-motion), kilau mengikuti arah cahaya ----------
  const untilt = (): void => { win.classList.remove('is-tilting'); win.style.setProperty('--rx', '0deg'); win.style.setProperty('--ry', '0deg'); win.style.setProperty('--mx', '50%'); win.style.setProperty('--my', '0%'); };
  el.addEventListener('pointermove', e => {
    if (reduce || e.pointerType !== 'mouse') return;
    if (e.buttons || (e.target as Element).closest('.mpcs__stage, .mpcs__ov')) { untilt(); return; }
    const r = win.getBoundingClientRect(), px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    win.classList.add('is-tilting');
    win.style.setProperty('--ry', ((px - .5) * 4).toFixed(2) + 'deg'); win.style.setProperty('--rx', ((.5 - py) * 3).toFixed(2) + 'deg');
    win.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); win.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  });
  el.addEventListener('pointerleave', untilt);

  // ---------- download hasil olahan (WAV / MP3): selalu hasil terakhir, termasuk edit & knob yang baru diubah ----------
  let saving = false;
  function setDlMenu(on: boolean): void { dlMenu.hidden = !on; dlBtn.setAttribute('aria-expanded', String(on)); }
  async function saveAs(fmt: SaveFormat): Promise<void> {
    if (DEMO) { demoNotice('export'); return; }   // DEMO: download audio hanya di versi penuh
    if (!S || saving) return;
    saving = true; dlBtn.disabled = true; setBusy(true);
    const name = (S.name || 'Audio').replace(/[^\w\- ]+/g, '_') + '-MPCS.' + fmt;
    try {
      stat.textContent = 'Merender hasil…';
      const out = await ensureRendered();
      if (!out) { stat.textContent = 'Gagal merender'; return; }
      const x = out.getChannelData(0);
      stat.textContent = fmt === 'mp3' ? 'Mengonversi ke MP3…' : 'Menyusun WAV…';
      const blob = fmt === 'mp3' ? await encodeMp3Mono(x, out.sampleRate, p => { stat.textContent = 'Mengonversi ke MP3… ' + Math.round(p * 100) + '%'; }) : encodeWav16Mono(x, out.sampleRate);
      saveBlob(blob, name); stat.textContent = 'Terunduh: ' + fmt.toUpperCase();
    } catch (err) { console.error(err); stat.textContent = 'Gagal menyimpan ' + fmt.toUpperCase(); }
    finally { saving = false; setBusy(false); dlBtn.disabled = !S; window.setTimeout(info, 2200); }
  }
  dlBtn.addEventListener('click', e => { e.stopPropagation(); setDlMenu(!!dlMenu.hidden); });
  dlMenu.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLButtonElement>('button[data-f]'); if (!b) return; setDlMenu(false); void saveAs(b.dataset.f as SaveFormat); });
  el.addEventListener('pointerdown', e => { if (!dlMenu.hidden && !(e.target as Element).closest('.mpcs__dlm, .mpcs__dl')) setDlMenu(false); });   // ketuk di luar menutup menu

  // ---------- layar penuh: hanya piano roll yang melebar ke seluruh layar, header tetap di atas dan bar menu sebaris di bawah ----------
  let full = false;
  function setFull(on: boolean, native = true): void {
    if (on === full) return;
    full = on; el.classList.toggle('is-full', on); untilt();
    fullBtn.setAttribute('aria-pressed', String(on)); fullBtn.innerHTML = on ? ICON.unfull : ICON.full;
    fullBtn.setAttribute('aria-label', on ? 'Keluar layar penuh' : 'Layar penuh piano roll'); fullBtn.title = on ? 'Keluar layar penuh' : 'Piano roll layar penuh (menu tetap di bawah)';
    if (native) {   // layar penuh sungguhan bila browser mengizinkan; kalau tidak, mode CSS tetap memenuhi viewport
      try { if (on) void el.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {}); } catch { /* abaikan */ }
    }
    requestAnimationFrame(layout);
  }
  fullBtn.addEventListener('click', () => setFull(!full));
  document.addEventListener('fullscreenchange', () => { if (full && !document.fullscreenElement && !el.hidden) setFull(false, false); });   // keluar lewat Esc bawaan browser

  // ---------- buka / tutup ----------
  const onKey = (e: KeyboardEvent): void => {
    e.stopPropagation();   // pintasan DAW (Space, tuts keyboard) tidak ikut jalan selagi MPCS terbuka
    if (e.key === 'Escape') { e.preventDefault(); if (!dlMenu.hidden) setDlMenu(false); else if (full) setFull(false); else close(); return; }
    const onBtn = (e.target as Element).closest?.('button');
    if (e.key === ' ' && !onBtn && S) { e.preventDefault(); playing ? stopPlay() : void startPlay(); }
    else if (S && !e.ctrlKey && !e.metaKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(ZSTEP, 1); }
    else if (S && !e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(1 / ZSTEP, 1); }
    else if (S && !e.ctrlKey && !e.metaKey && e.key === '0') { e.preventDefault(); zoomReset(); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && sel >= 0 && S && !(e.target as Element).closest?.('.knob-input')) {
      e.preventDefault(); const n = S.notes[sel], t = Math.max(S.lo + 1, Math.min(S.hi - 1, Math.round(n.target) + (e.key === 'ArrowUp' ? 1 : -1)));
      if (t !== n.target) { n.target = t; n.man = true; edit(); }
    }
  };
  el.addEventListener('keydown', onKey); el.addEventListener('keyup', e => e.stopPropagation());
  el.querySelector('.mpcs__close')!.addEventListener('click', () => close());
  el.querySelector('.mpcs__back')!.addEventListener('pointerdown', () => close());

  function close(): void {
    stopPlay(); untilt(); setDlMenu(false);
    setFull(false);
    const done = (): void => { el.hidden = true; };
    if (reduce) { done(); return; }
    el.querySelector('.mpcs__back')!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    win.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => { done(); el.getAnimations({ subtree: true }).forEach(a => a.cancel()); };
  }
  openFn = () => {
    if (!el.hidden) return;
    el.getAnimations({ subtree: true }).forEach(a => a.cancel());
    el.hidden = false; empty.hidden = !!S;
    layout(); info();
    if (!reduce) win.animate([{ opacity: 0, transform: 'translateY(14px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.3,.64,1)' });
    win.focus({ preventScroll: true });
  };
}
