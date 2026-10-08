// Piano roll: editor nada berbasis canvas (belum ada suara, sesuai tahap ini).
// Fitur: pasang / geser / ubah panjang / hapus nada, pilih banyak (marquee), snap, undo,
// zoom horizontal & vertikal (tombol, Ctrl+scroll, Alt+scroll, pinch 2 jari), geser (scroll / tool tangan / 2 jari).
// Nada disimpan di memori per pattern (kunci `id`), jadi tetap ada saat piano roll ditutup lalu dibuka lagi.

export interface PianoRollOpts {
  id?: string;        // kunci pattern supaya nada tersimpan per pattern
  track: string;
  pattern: string;
  color?: string;
  ghosts?: Ghost[];   // nada milik instrumen lain di pattern yang sama: ditampilkan meredup; tidak bisa diedit, tapi ditahan = pindah ke VST pemiliknya (lewat open)
  keepView?: boolean; // dipanggil saat pindah antar VST: pertahankan zoom, scroll & tool, jangan reset tampilan
}
export interface Ghost { key: string; color: string; open?: () => void; }   // open: membuka piano roll untuk VST pemilik nada ini

interface Note { id: number; p: number; s: number; l: number; sl?: boolean; v?: number; }   // p: MIDI, s/l: dalam ketukan, v: velocity 0..1 (kosong = 1)
interface State { notes: Note[]; nextId: number; }
export interface NoteData { p: number; s: number; l: number; sl?: boolean; v?: number; }   // bentuk nada yang disimpan / dimainkan
type Tool = 'draw' | 'select' | 'erase' | 'pan';

import { VEL_MIN, velOf, velAlpha } from './velocity';
import { uiTheme, syncTrackColors } from './ui-theme';
const P_MIN = 24, P_MAX = 108, ROWS = P_MAX - P_MIN + 1;   // C1..C8
const KEY_W = 64, RULER_H = 32, BEATS_PER_BAR = 4;
// Panjang grid (bar) bisa diatur di Pengaturan: 4..50, bawaan 15. Disimpan di browser; tidak pernah lebih pendek dari nada terjauh.
export const PR_BARS_MIN = 4, PR_BARS_MAX = 50, PR_BARS_DEFAULT = 15, PR_BARS_KEY = 'derizmp3.prBars';
let BARS = (() => { try { const n = parseInt(localStorage.getItem(PR_BARS_KEY) || '', 10); return Number.isFinite(n) ? Math.min(PR_BARS_MAX, Math.max(PR_BARS_MIN, n)) : PR_BARS_DEFAULT; } catch { return PR_BARS_DEFAULT; } })();
const PPB_MIN = 8, PPB_MAX = 480, ROW_MIN = 10, ROW_MAX = 40;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

const isBlack = (p: number) => BLACK.has(p % 12);
const pname = (p: number) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const ic = (d: string) =>
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ICON = {
  close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  chev: ic('<path d="M9 6l6 6-6 6"/>'),
  more: ic('<circle cx="5" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.9" fill="currentColor" stroke="none"/>'),
  draw: ic('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/>'),
  select: ic('<path d="M5 3l14 7-6 2-2 6z"/>'),
  erase: ic('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  pan: ic('<path d="M9 11V5a1.5 1.5 0 013 0v5m0-1a1.5 1.5 0 013 0v2m0-1a1.5 1.5 0 013 0v5a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L9 15"/>'),
  undo: ic('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>'),
  redo: ic('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>'),
  minus: ic('<path d="M5 12h14"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
};

const states = new Map<string, State>();
let root: HTMLElement | null = null;
let onClose: (() => void) | null = null;
let closeMenu: () => void = () => {};
let menuOpen: () => boolean = () => false;

// elemen
let sc!: HTMLElement, space!: HTMLElement, gc!: HTMLCanvasElement, bgc!: HTMLCanvasElement, gclip!: HTMLElement, kc!: HTMLCanvasElement, rc!: HTMLCanvasElement;
let phDom!: HTMLElement, phBeat = -1;   // playhead: posisi dalam ketukan relatif ke awal pattern (<0 = tersembunyi)
let btnUndo!: HTMLButtonElement, btnRedo!: HTMLButtonElement, selBar!: HTMLElement, btnPaste!: HTMLButtonElement, btnSlide!: HTMLButtonElement;

// state editor
let st: State = {notes: [], nextId: 1};
let curKey = '';
let total = BARS * BEATS_PER_BAR;
let ppb = 64, rowH = 18;
let tool: Tool = 'draw';
let snapOn = true;   // tombol Snap (lampu indikator): nyala = note menempel ke garis grid yang terlihat
let color = '#3fbf5f';   // warna yang dipakai sekarang untuk semua nada = noteColor (pilihan di Color) kalau ada, kalau tidak warna track
let noteColor: string | null = null;   // pilihan warna global dari menu Color: berlaku untuk SEMUA nada di piano roll (nada yang diedit, nada instrumen lain / ghost, dan pattern lain yang dibuka nanti). null = ikut warna track
let trackColor = '';                   // warna track pattern yang sedang dibuka (dipakai kalau noteColor kosong)
let ghostSrc: Ghost[] = [];
let selected = new Set<number>();
let undoStack: string[] = [];
let redoStack: string[] = [];
let lastLen = 1;     // panjang nada baru = panjang nada terakhir yang dibuat / di-resize / DIKLIK
let lastSlide = false;   // nada baru ikut berstatus slide kalau nada terakhir yang dibuat / diklik / di-toggle adalah slide
let lastVel = 1;     // velocity nada baru = velocity terakhir yang diatur di panel Velocity atau milik nada yang DIKLIK
let velOpen = false; // panel Velocity (di bawah grid) terbuka / tertutup; tetap sama selama aplikasi hidup
let velPanel!: HTMLElement, velBtn!: HTMLButtonElement, vc!: HTMLCanvasElement;
let hoverP = -1;
let raf = 0;

const handleR = () => clamp(rowH * 0.3, 4, 7);   // jari-jari bulatan handle
const HANDLE_GAP = 3;                            // jarak ujung note ke tepi luar bulatan (bulatan sepenuhnya di luar note)
const handleCX = (n: Note) => (n.s + n.l) * ppb + Math.max(0, 3 - n.l * ppb) + handleR() + HANDLE_GAP;   // titik tengah bulatan (koordinat konten)
const EDGE_PAD = 44;                             // ruang ekstra di kanan grid supaya bulatan note di ujung tetap kelihatan & bisa dipegang

// animasi bulatan: muncul (pop) saat note dibuat, hilang saat note dihapus, membesar sedikit saat ditarik
const REDUCE = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const T_IN = 240, T_OUT = 170, T_PRESS = 130, PRESS_K = 0.35;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
let born = new Map<number, number>();                     // id -> waktu mulai muncul
let ghosts: Array<{n: Note; t0: number; h: boolean}> = [];            // note yang baru dihapus (diputar keluar dulu)
let lastDrawn = new Map<number, Note>();
let lastSel = new Set<number>();                          // note yang terpilih pada gambar terakhir (bulatan handle hanya untuk note terpilih)
let rel: {id: number; t0: number} | null = null;          // bulatan baru dilepas -> kembali ke ukuran normal
function resetAnim() { born.clear(); ghosts = []; rel = null; lastSel = new Set(selected); lastDrawn = new Map(st.notes.map(n => [n.id, {...n}])); }
const snapshot = () => JSON.stringify(st.notes);
// langkah snap = garis grid paling halus yang sedang tampil (ikut zoom), jadi note menempel ke semua garis grid
const gridStep = () => { let s = LEVELS[0][0]; for (const [st] of LEVELS) if (st * ppb >= 11) s = st; return s; };
const unit = () => (snapOn ? gridStep() : 1 / 16);
const snapRound = (b: number) => { if (!snapOn) return b; const s = gridStep(); return Math.round(b / s) * s; };
const snapFloor = (b: number) => { if (!snapOn) return b; const s = gridStep(); return Math.floor(b / s + 1e-9) * s; };

// ---------- gambar ----------
function fit(c: HTMLCanvasElement, w: number, h: number, cap = 8) {
  const dpr = Math.min(window.devicePixelRatio || 1, cap);   // cap: canvas grid yang lebar dibatasi (jumlah pixel di HP 3x turun ~55%)
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// garis vertikal bertingkat: bar > ketukan > 1/2 > 1/4 > 1/8
// Latar: warna semula. Garis grid & penggaris bukan putih lagi, tapi biru-ungu lembut (satu rona dengan latar) supaya tidak bertabrakan dengan nada.
let GRID = '166,140,206';   // rgb dasar garis grid
const gl = (a: number): string => 'rgba(' + GRID + ',' + a + ')';
const PR = {
  bg: '#0f0d13', rowWhite: '#1b1722', rowBlack: '#15121b', beyond: '#0f0d13', hover: gl(0.07),
  rowLine: gl(0.07), octLine: gl(0.3),
  ruler: '#19151f', rulerLine: '#2a2233', rulerText: '#e6dcf5', rulerTick1: '#8f7fb0', rulerTick2: '#5e5280', rulerTick3: '#3d3358', dim: '#8f7fb0'
};
const LEVELS: Array<[number, number]> = [[4, 0.34], [1, 0.17], [0.5, 0.1], [0.25, 0.07], [0.125, 0.05]];
const LEVEL_FILL = LEVELS.map(l => gl(l[1]));
// Tema UI: Ink Rose (bawaan) / Mono Graphite. Warna canvas diganti di tempat, lalu digambar ulang lewat event dari menu.
const UI_PR = {
  ink:  { g: '166,140,206', bg: '#0f0d13', rowWhite: '#1b1722', rowBlack: '#15121b', ruler: '#19151f', rulerLine: '#2a2233', rulerText: '#e6dcf5', t1: '#8f7fb0', t2: '#5e5280', t3: '#3d3358' },
  mono: { g: '200,200,212', bg: '#101012', rowWhite: '#1b1b1f', rowBlack: '#151517', ruler: '#18181b', rulerLine: '#2d2d33', rulerText: '#e5e5ea', t1: '#8a8a9a', t2: '#5c5c68', t3: '#3c3c46' }
};
function applyUiPalette(): void {
  const u = UI_PR[uiTheme()];
  GRID = u.g;
  Object.assign(PR, { bg: u.bg, beyond: u.bg, rowWhite: u.rowWhite, rowBlack: u.rowBlack, hover: gl(0.07), rowLine: gl(0.07), octLine: gl(0.3),
    ruler: u.ruler, rulerLine: u.rulerLine, rulerText: u.rulerText, rulerTick1: u.t1, rulerTick2: u.t2, rulerTick3: u.t3, dim: u.t1 });
  LEVELS.forEach((l, i) => { LEVEL_FILL[i] = gl(l[1]); });
}
applyUiPalette();
window.addEventListener('derizmp3:ui', () => { applyUiPalette(); schedule(); });
const soft = (hex: string, a: number): string => { const k = hexRgb(hex); return 'rgba(' + k[0] + ',' + k[1] + ',' + k[2] + ',' + a + ')'; };

// Warna nada: pastel (campuran warna track + putih) dengan garis tepi gelap & teks gelap
const hexRgb = (h: string): number[] => { const m = h.replace('#', ''), f = m.length === 3 ? m.split('').map(x => x + x).join('') : m, n = parseInt(f, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixRgb = (a: number[], b: number[], t: number): string => 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')';
let noteTh = { c: '', fill: '', sel: '', text: '' };
function noteTheme() {
  if (noteTh.c !== color) {
    const k = hexRgb(color), W = [255, 255, 255], B = [0, 0, 0];
    noteTh = { c: color, fill: mixRgb(k, W, 0.3), sel: mixRgb(k, W, 0.72), text: mixRgb(k, B, 0.78) };
  }
  return noteTh;
}
function eachVLine(sx: number, vw: number, fn: (x: number, beat: number, level: number) => void) {
  for (let li = 0; li < LEVELS.length; li++) {
    const step = LEVELS[li][0];
    if (step * ppb < 11) continue;
    const prev = li > 0 ? LEVELS[li - 1][0] : 0;
    const k0 = Math.max(0, Math.floor(sx / (step * ppb))), k1 = Math.min(Math.floor(total / step), Math.ceil((sx + vw) / (step * ppb)));
    for (let k = k0; k <= k1; k++) {
      const beat = k * step;
      if (prev && Math.abs(beat / prev - Math.round(beat / prev)) < 1e-6) continue;   // sudah digambar level di atasnya
      fn(Math.round(beat * ppb - sx) + 0.5, beat, li);
    }
  }
}

// Tepi nada dirapatkan ke pixel perangkat (bukan pecahan): tepi tajam, tidak buram / bergerigi. Tanpa garis tepi.
function noteRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = c.getTransform().a || 1, q = (v: number) => Math.round(v * k) / k;
  const x0 = q(x), y0 = q(y), x1 = Math.max(x0 + 1 / k, q(x + w)), y1 = Math.max(y0 + 1 / k, q(y + h));
  c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
}
function drawNoteBody(c: CanvasRenderingContext2D, n: Note, sx: number, sy: number, sel: boolean) {
  const x = n.s * ppb - sx, w = Math.max(3, n.l * ppb), y = (P_MAX - n.p) * rowH - sy;
  const th = noteTheme();
  const a0 = c.globalAlpha;   // a0 = transparansi dasar (mis. animasi hapus); velocity hanya menipiskan badan nada, label tetap jelas
  c.globalAlpha = a0 * velAlpha(n.v);
  c.fillStyle = sel ? th.sel : th.fill; noteRect(c, x + 0.5, y + 1, w - 1, rowH - 2, 2); c.fill();   // terpilih = lebih terang
  c.globalAlpha = a0;
  if (n.sl) {   // slide: lebih terang + tanda panah miring di kiri
    c.fillStyle = 'rgba(255,255,255,.3)'; noteRect(c, x + 0.5, y + 1, w - 1, rowH - 2, 2); c.fill();
    if (w > 18 && rowH >= 12) { c.strokeStyle = th.text; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + 5, y + rowH - 5); c.lineTo(x + 12, y + 5); c.stroke(); }
  }
  if (w > (n.sl ? 44 : 30) && rowH >= 14) { c.fillStyle = th.text; c.fillText(pname(n.p), Math.round(x + (n.sl ? 17 : 5)), Math.round(y + rowH / 2 + 0.5)); }
}
// bulatan putih di LUAR ujung kanan note (tidak menyentuh badan note); k = skala animasi
function drawHandle(c: CanvasRenderingContext2D, n: Note, sx: number, sy: number, k: number) {
  const r = handleR() * k; if (r < 0.4) return;
  const cx = handleCX(n) - sx, cy = (P_MAX - n.p + 0.5) * rowH - sy;
  c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.arc(cx, cy + 0.5, r + k, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
}

// Canvas grid sengaja LEBIH BESAR dari layar (overscan): geser kecil cukup menggeser canvas lewat CSS transform tanpa gambar ulang.
const OV_X = 0.4, OV_Y = 0.3;
let drawn = {ppb: 0, rowH: 0, ox: 0, oy: 0, w: 0, h: 0, vw: 0, vh: 0};   // apa yang sedang ada di canvas: konten mulai di (ox,oy), ukuran w x h, untuk layar vw x vh
let gridDirty = true;   // true = isi grid berubah (note, hover, animasi, ukuran); false = hanya posisi scroll
const gridXf = (v: string) => { gc.style.transform = v; bgc.style.transform = v; };   // lapis latar & lapis nada selalu bergerak bersama
function placeGrid(l: number, t: number) {
  const d = drawn; if (!d.ppb) return;
  const kx = ppb / d.ppb, ky = rowH / d.rowH;
  gridXf('translate(' + (d.ox * kx - l) + 'px,' + (d.oy * ky - t) + 'px) scale(' + kx + ',' + ky + ')');
}
function gridCovers(l: number, t: number) {
  const d = drawn;
  return d.ppb === ppb && d.rowH === rowH && d.vw === sc.clientWidth && d.vh === sc.clientHeight && l >= d.ox && l + d.vw <= d.ox + d.w && t >= d.oy && t + d.vh <= d.oy + d.h;
}
let bgSig = '', prevSl = 0, prevSt = 0;   // bgSig: tanda isi lapis latar terakhir (sama = tidak digambar ulang); prevSl/prevSt: scroll saat gambar terakhir (untuk arah gerak)
function drawGrid(zoomOnly = false) {
  // zoomOnly: frame ini hanya zoom, note tidak berubah -> lewati deteksi note baru / hilang
  const vw0 = sc.clientWidth, vh0 = sc.clientHeight, sl = sc.scrollLeft, stp = sc.scrollTop;
  const dense = (window.devicePixelRatio || 1) > 2;   // layar rapat (HP 3x): canvas digambar tajam di 3x, overscan dikecilkan supaya jumlah pixel tetap wajar
  let vw: number, vh: number, sx: number, sy: number;
  if (gridCovers(sl, stp)) { sx = drawn.ox; sy = drawn.oy; vw = drawn.w; vh = drawn.h; }   // canvas yang ada masih menutupi layar: pakai lagi (lapis latar tidak perlu digambar ulang)
  else {
    // margin overscan: total tetap sama (ukuran canvas tidak bertambah), tapi 3/4-nya ditaruh di sisi arah geser, jadi geser panjang jarang memicu gambar ulang
    const tx = Math.round(vw0 * 2 * (dense ? 0.25 : OV_X)), ty = Math.round(vh0 * 2 * (dense ? 0.2 : OV_Y));
    const dx = sl - prevSl, dy = stp - prevSt, fx = dx > 0 ? 0.25 : dx < 0 ? 0.75 : 0.5, fy = dy > 0 ? 0.25 : dy < 0 ? 0.75 : 0.5;
    const mxL = Math.round(tx * fx), myT = Math.round(ty * fy);
    vw = vw0 + tx; vh = vh0 + ty;                         // ukuran canvas (vw/vh di bawah = ukuran canvas)
    sx = Math.max(0, sl - mxL); sy = Math.max(0, stp - myT);   // konten di pojok kiri-atas canvas
  }
  prevSl = sl; prevSt = stp;
  gclip.style.width = vw0 + 'px'; gclip.style.height = vh0 + 'px';
  const dprNow = window.devicePixelRatio || 1;
  const bsig = ppb + '|' + rowH + '|' + sx + '|' + sy + '|' + vw + '|' + vh + '|' + hoverP + '|' + color + '|' + dprNow;
  const xr = Math.min(vw, total * ppb - sx);
  if (bsig !== bgSig) {   // LAPIS LATAR: baris, garis grid, garis akhir pattern. Hanya digambar kalau zoom / posisi canvas / hover / warna berubah (bukan tiap frame drag)
    bgSig = bsig;
    const b = fit(bgc, vw, vh, 3);
    b.fillStyle = PR.beyond; b.fillRect(0, 0, vw, vh);
    const r0 = Math.max(0, Math.floor(sy / rowH)), r1 = Math.min(ROWS - 1, Math.floor((sy + vh) / rowH));
    if (xr > 0) {
      for (let r = r0; r <= r1; r++) {
        const p = P_MAX - r, y = r * rowH - sy;
        b.fillStyle = isBlack(p) ? PR.rowBlack : PR.rowWhite; b.fillRect(0, y, xr, rowH);
        if (p === hoverP) { b.fillStyle = PR.hover; b.fillRect(0, y, xr, rowH); }
        b.fillStyle = p % 12 === 0 ? PR.octLine : PR.rowLine;
        b.fillRect(0, Math.round(y + rowH) - 1, xr, 1);
      }
      eachVLine(sx, vw, (x, _b, li) => { b.fillStyle = LEVEL_FILL[li]; b.fillRect(x - 0.5, 0, 1, vh); });
      // garis akhir pattern
      const ex = Math.round(total * ppb - sx);
      if (ex >= 0 && ex <= vw) { b.fillStyle = soft(color, 0.55); b.fillRect(ex - 1, 0, 2, vh); }
    }
  }
  // LAPIS NADA: transparan, digambar ulang tiap perubahan (murah: hanya clear + nada)
  const c = fit(gc, vw, vh, 3);
  c.clearRect(0, 0, vw, vh);
  // nada
  const now = performance.now(); let animating = false;
  if (!REDUCE && !zoomOnly) {                   // deteksi note baru / hilang sejak gambar terakhir (mencakup undo, hapus, erase)
    let fresh = false;
    for (const n of st.notes) if (!lastDrawn.has(n.id) || (selected.has(n.id) && !lastSel.has(n.id))) { born.set(n.id, now); if (!lastDrawn.has(n.id)) fresh = true; }   // baru dibuat / baru dipilih -> bulatan pop
    if (fresh || lastDrawn.size !== st.notes.length) {   // jumlah sama dan tidak ada id baru = tidak ada yang hilang: Set id tidak perlu dibuat (kasus drag)
      const cur = new Set(st.notes.map(n => n.id));
      for (const [id, n] of lastDrawn) if (!cur.has(id)) ghosts.push({n, t0: now, h: lastSel.has(id)});
    }
  }
  if (!zoomOnly) {   // perbarui "gambar terakhir" di tempat (tanpa membuat Map / salinan baru tiap frame)
    if (lastDrawn.size !== st.notes.length || st.notes.some(n => !lastDrawn.has(n.id))) lastDrawn = new Map(st.notes.map(n => [n.id, {...n}]));
    else for (const n of st.notes) { const o = lastDrawn.get(n.id)!; o.p = n.p; o.s = n.s; o.l = n.l; o.sl = n.sl; o.v = n.v; }
    let same = lastSel.size === selected.size; if (same) for (const id of selected) if (!lastSel.has(id)) { same = false; break; }
    if (!same) lastSel = new Set(selected);
  }
  const fs = Math.min(11, rowH - 4);
  c.font = '600 ' + fs + 'px system-ui,sans-serif'; c.textBaseline = 'middle';
  const visible = (n: Note) => {
    const x = n.s * ppb - sx, w = Math.max(3, n.l * ppb), y = (P_MAX - n.p) * rowH - sy;
    return !(x + w + 2 * handleR() + 8 < 0 || x > vw || y + rowH < 0 || y > vh);
  };
  for (const gs of ghostSrc) {   // nada instrumen lain: di belakang nada yang sedang diedit, warna meredup
    const gst = states.get(gs.key); if (!gst || !gst.notes.length) continue;
    c.fillStyle = noteColor || gs.color; c.globalAlpha = .3;   // nada instrumen lain: ikut warna pilihan (tetap redup)
    for (const n of gst.notes) {
      if (!visible(n)) continue;
      const x = n.s * ppb - sx, w = Math.max(3, n.l * ppb), y = (P_MAX - n.p) * rowH - sy;
      noteRect(c, x + 0.5, y + 1, w - 1, rowH - 2, 2); c.fill();
    }
    c.globalAlpha = 1;
  }
  for (const n of st.notes) if (visible(n)) drawNoteBody(c, n, sx, sy, selected.has(n.id));
  // (garis jalur luncuran slide dari nada sumber ke nada slide sengaja tidak digambar; bunyi luncurannya tetap, lihat note-slide.ts)
  for (const n of st.notes) {
    if (!selected.has(n.id) || !visible(n)) continue;   // bulatan panjang/pendek hanya di note yang dipilih
    let k = 1;
    const b0 = born.get(n.id);
    if (b0 !== undefined) { const t = (now - b0) / T_IN; if (t >= 1) born.delete(n.id); else { k *= easeOutBack(Math.max(0, t)); animating = true; } }
    if (g && g.kind === 'resize' && g.anchor && g.anchor.id === n.id) { const t = Math.min(1, (now - g.t0) / T_PRESS); k *= 1 + PRESS_K * easeOut(t); if (t < 1) animating = true; }
    else if (rel && rel.id === n.id) { const t = (now - rel.t0) / T_PRESS; if (t >= 1) rel = null; else { k *= 1 + PRESS_K * (1 - easeOut(t)); animating = true; } }
    drawHandle(c, n, sx, sy, k);
  }
  for (let i = ghosts.length - 1; i >= 0; i--) {   // note yang dihapus: memudar, bulatan mengecil
    const gh = ghosts[i], t = (now - gh.t0) / T_OUT;
    if (t >= 1) { ghosts.splice(i, 1); continue; }
    animating = true;
    if (!visible(gh.n)) continue;
    c.globalAlpha = 1 - t; drawNoteBody(c, gh.n, sx, sy, false); if (gh.h) drawHandle(c, gh.n, sx, sy, 1 - easeOut(t)); c.globalAlpha = 1;
  }
  if (animating) schedule();
  drawn = {ppb, rowH, ox: sx, oy: sy, w: vw, h: vh, vw: vw0, vh: vh0}; placeGrid(sl, stp);
  // marquee
  if (g && g.kind === 'marquee') {
    const a = g.x0 - sx, b = g.y0 - sy, w = g.x - g.x0, h = g.y - g.y0;
    c.fillStyle = 'rgba(154,160,255,.14)'; c.strokeStyle = '#9aa0ff'; c.lineWidth = 1.5;   // kotak seleksi biru-ungu lembut, serona dengan grid
    c.beginPath(); c.roundRect(a + 0.5, b + 0.5, w, h, 4); c.fill(); c.stroke();
  }
}

let keysSig = '', rulerSig = '';   // tanda masukan gambar terakhir: kalau sama, tidak digambar ulang (mis. pinch horizontal tidak menyentuh keys)
// ===== Keyboard piano roll: desain "Ivory Capsule" =====
// Rel kiri gelap (tempat tuts masuk ke badan piano) + tuts putih gading berujung kapsul + tuts hitam ebony berkilap.
// Tuts tertekan: masuk 2px ke kanan, terisi warna track dengan cahaya lembut. Tiap C diberi penanda warna track di rel kiri.
// Tuts bisa dimainkan langsung: tekan / seret di keyboard = bunyi nada (lewat handler preview yang sama dengan grid).
const KEY_RAIL = 7;                       // lebar rel kiri
const KB = {
  body: '#13131a', railA: '#30303f', railB: '#1a1a23',
  ivA: '#ece6da', ivB: '#fffdf9', ivC: '#d6d0c2',          // putih gading: pangkal, tengah, ujung
  ebA: '#454553', ebB: '#1b1b23', ebC: '#08080c',           // ebony: pangkal, tengah, ujung
  label: '#6f7396', labelC: '#3c3f60'
};
const keyWL = () => KEY_W - 2 - KEY_RAIL;                   // panjang tuts putih
const keyBL = () => keyWL() * (showNoteNames ? 0.5 : 0.6);  // panjang tuts hitam (nama nada tampil: dipendekkan supaya label tidak tertutup)
const lumOf = (hex: string): number => { const k = hexRgb(hex); return (0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2]) / 255; };
function capsule(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {   // kiri lurus, kanan membulat penuh
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r); c.lineTo(x, y + h); c.closePath();
}
// Isi tuts hanya bergantung pada rowH / nama nada / warna / hover, bukan pada posisi geser. Seluruh deret (C1..C8) digambar SATU KALI
// ke bitmap offscreen, lalu tiap frame geser / zoom cukup di-blit (drawImage); bayangan per tuts tidak dihitung ulang tiap frame.
let keyStrip: HTMLCanvasElement | null = null, keyStripSig = '', keyStripRow = 0, keyStripDpr = 1;
const KEY_MAX_PX = 16000;   // batas aman tinggi canvas di HP; kalau lewat, digambar langsung
function paintKeys(c: CanvasRenderingContext2D, dpr: number, sy: number, vh: number, hover: number) {
  const WL = keyWL(), BL = keyBL(), rgb = hexRgb(color), onColorDark = lumOf(color) > 0.6;
  const pressA = mixRgb(rgb, [0, 0, 0], 0.22), pressB = color, pressC = mixRgb(rgb, [255, 255, 255], 0.28);
  c.fillStyle = KB.body; c.fillRect(0, 0, KEY_W, vh);
  const r0 = Math.max(0, Math.floor(sy / rowH) - 1), r1 = Math.min(ROWS - 1, Math.floor((sy + vh) / rowH) + 1);
  // rel kiri
  const rail = c.createLinearGradient(0, 0, KEY_RAIL, 0); rail.addColorStop(0, KB.railA); rail.addColorStop(1, KB.railB);
  c.fillStyle = rail; c.fillRect(0, 0, KEY_RAIL, vh);
  c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(0, 0, 1, vh);
  c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(KEY_RAIL - 1, 0, 1, vh);

  const ivory = c.createLinearGradient(KEY_RAIL, 0, KEY_RAIL + WL, 0);
  ivory.addColorStop(0, KB.ivA); ivory.addColorStop(0.5, KB.ivB); ivory.addColorStop(1, KB.ivC);
  const ebony = c.createLinearGradient(KEY_RAIL, 0, KEY_RAIL + BL, 0);
  ebony.addColorStop(0, KB.ebA); ebony.addColorStop(0.55, KB.ebB); ebony.addColorStop(1, KB.ebC);
  const pressW = c.createLinearGradient(KEY_RAIL, 0, KEY_RAIL + WL, 0);
  pressW.addColorStop(0, pressA); pressW.addColorStop(0.5, pressB); pressW.addColorStop(1, pressC);
  const pressK = c.createLinearGradient(KEY_RAIL, 0, KEY_RAIL + BL, 0);
  pressK.addColorStop(0, pressA); pressK.addColorStop(1, pressB);
  const hinge = c.createLinearGradient(KEY_RAIL, 0, KEY_RAIL + 12, 0); hinge.addColorStop(0, 'rgba(0,0,0,.30)'); hinge.addColorStop(1, 'rgba(0,0,0,0)');

  // 1) tuts putih: tiap tuts mengisi barisnya + setengah baris tuts hitam di atas / bawahnya, jarak 1,5px antar tuts
  for (let r = r0; r <= r1; r++) {
    const p = P_MAX - r; if (isBlack(p)) continue;
    const y = r * rowH - sy, top = y + (isBlack(p + 1) ? -rowH / 2 : 0) + 0.75, bot = y + rowH + (isBlack(p - 1) ? rowH / 2 : 0) - 0.75;
    const h = bot - top, dn = p === hover, x = KEY_RAIL + (dn ? 2 : 0), w = WL - (dn ? 2 : 0), rr = Math.min(h / 2, 7);
    c.save();
    if (dn) { c.shadowColor = soft(color, 0.55); c.shadowBlur = 10 * dpr; }
    capsule(c, x, top, w, h, rr); c.fillStyle = dn ? pressW : ivory; c.fill();
    c.restore();
    c.save(); capsule(c, x, top, w, h, rr); c.clip();
    const sheen = c.createLinearGradient(0, top, 0, bot);   // kilau atas -> bayangan bawah
    sheen.addColorStop(0, dn ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.6)'); sheen.addColorStop(0.4, 'rgba(255,255,255,0)'); sheen.addColorStop(1, 'rgba(0,0,0,.11)');
    c.fillStyle = sheen; c.fillRect(x, top, w, h);
    c.fillStyle = hinge; c.fillRect(x, top, 12, h);
    c.fillStyle = dn ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.9)'; c.fillRect(x, top, w, dn ? 2 : 1);   // sisi atas: tertekan = bayangan masuk
    c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x, bot - 1, w, 1);
    c.restore();
    c.save(); capsule(c, x + 0.5, top + 0.5, w - 1, h - 1, rr); c.strokeStyle = 'rgba(0,0,0,.14)'; c.lineWidth = 1; c.stroke(); c.restore();
    if (p % 12 === 0) { c.fillStyle = dn ? '#fff' : color; c.beginPath(); c.roundRect(1.5, top + 2, 3, Math.max(2, h - 4), 1.5); c.fill(); }   // penanda C di rel kiri
  }
  // 2) tuts hitam: ebony berkilap, bayangan jatuh ke kanan
  for (let r = r0; r <= r1; r++) {
    const p = P_MAX - r; if (!isBlack(p)) continue;
    const y = r * rowH - sy + 1, h = rowH - 2, dn = p === hover, x = KEY_RAIL + (dn ? 2 : 0), w = BL - (dn ? 2 : 0), rr = Math.min(h / 2.2, 6);
    c.save();
    c.shadowColor = dn ? soft(color, 0.6) : 'rgba(0,0,0,.55)'; c.shadowBlur = (dn ? 9 : 6) * dpr; c.shadowOffsetX = dn ? 0 : 2.5 * dpr; c.shadowOffsetY = dn ? 0 : 1.5 * dpr;
    capsule(c, x, y, w, h, rr); c.fillStyle = dn ? pressK : ebony; c.fill();
    c.restore();
    c.save(); capsule(c, x, y, w, h, rr); c.clip();
    c.fillStyle = dn ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.2)'; c.fillRect(x + 2, y + 0.5, w - 6, 1);   // garis kilau atas
    const gloss = c.createLinearGradient(x, 0, x + w, 0); gloss.addColorStop(0, 'rgba(255,255,255,.17)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gloss; c.fillRect(x + 1, y + h * 0.2, w - 3, Math.max(1.5, h * 0.2));                          // pita kilap
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(x + w - 2, y, 1, h);                                        // pantulan ujung
    c.restore();
  }
  // 3) nama nada (tiap C, tuts yang disentuh, atau semua kalau Note Key aktif)
  c.textBaseline = 'middle'; c.textAlign = 'right';
  for (let r = r0; r <= r1; r++) {
    const p = P_MAX - r, isC = p % 12 === 0, y = r * rowH - sy;
    if (!(isC || p === hover || (showNoteNames && rowH >= 11))) continue;
    c.font = (isC ? '700 10px' : '600 9px') + ' system-ui,sans-serif';
    c.fillStyle = p === hover && !isBlack(p) ? (onColorDark ? '#16161d' : '#fff') : isC ? KB.labelC : KB.label;
    c.fillText(pname(p), KEY_W - 7, y + rowH / 2 + 0.5);
  }
  c.textAlign = 'start';
  c.fillStyle = PR.rulerLine; c.fillRect(KEY_W - 1, 0, 1, vh);   // garis temu dengan grid
}

// Interaksi keyboard: tekan / seret = bunyikan nada (glissando), lepas = berhenti. Mouse tanpa klik hanya menyorot tuts + baris grid-nya.
let keyPtr = -1;   // id pointer yang sedang menekan (-1 = tidak ada)
function keyAt(e: PointerEvent): number {
  const r = kc.getBoundingClientRect(), x = e.clientX - r.left - KEY_RAIL, f = (e.clientY - r.top + curT()) / rowH, row = Math.floor(f);
  if (row < 0 || row >= ROWS) return -1;
  const p = P_MAX - row;
  if (!isBlack(p) || x < keyBL()) return p;   // area tuts hitam, atau baris tuts putih
  const q = f - row < 0.5 ? p + 1 : p - 1;     // bagian putih di sebelah tuts hitam: setengah atas milik tuts putih di atasnya, setengah bawah milik yang di bawahnya
  return q >= P_MIN && q <= P_MAX ? q : p;
}
const setKeyHover = (p: number) => { if (p !== hoverP) { hoverP = p; schedule(); } };
function onKeyDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault(); keyPtr = e.pointerId;
  try { kc.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
  const p = keyAt(e); setKeyHover(p); if (p >= 0) pvPlay(p, true);
}
function onKeyMove(e: PointerEvent) {
  if (keyPtr !== -1 && keyPtr !== e.pointerId) return;
  const p = keyAt(e); setKeyHover(p);
  if (keyPtr !== -1 && p >= 0) pvPlay(p, true);
}
function onKeyUp(e: PointerEvent) {
  if (keyPtr !== e.pointerId) return;
  keyPtr = -1; pvStop(); setKeyHover(e.pointerType === 'mouse' && e.type === 'pointerup' ? keyAt(e) : -1);
}
function onKeyLeave() { if (keyPtr === -1) setKeyHover(-1); }

function drawKeys(preview = false) {
  const vh = sc.clientHeight, sy = curT(), dprRaw = window.devicePixelRatio || 1, dpr = Math.min(dprRaw, 8);
  const sig = sy + '|' + rowH + '|' + vh + '|' + hoverP + '|' + showNoteNames + '|' + color + '|' + dprRaw + '|' + (preview ? 'p' : '');
  if (sig === keysSig) return; keysSig = sig;
  const stripH = ROWS * rowH, cacheOk = hoverP === -1 && Math.round(stripH * dpr) <= KEY_MAX_PX;
  const ssig = rowH + '|' + showNoteNames + '|' + color + '|' + dprRaw;
  if (cacheOk && (!keyStrip || (keyStripSig !== ssig && !preview))) {   // bangun (ulang) bitmap deret tuts; saat preview zoom dipakai bitmap lama (diskalakan) dulu
    if (!keyStrip) keyStrip = document.createElement('canvas');
    const sc2 = fit(keyStrip, KEY_W, stripH, 8);
    sc2.clearRect(0, 0, KEY_W, stripH);
    paintKeys(sc2, dpr, 0, stripH, -1);
    keyStripSig = ssig; keyStripRow = rowH; keyStripDpr = dpr;
  }
  const c = fit(kc, KEY_W, vh);
  if (cacheOk && keyStrip) {
    const k = rowH / keyStripRow;                    // preview zoom: bitmap lama diskalakan vertikal (seperti grid); setelah zoom selesai k = 1 dan tajam
    const srcY = Math.round(sy / k * keyStripDpr), srcH = Math.min(Math.round(vh / k * keyStripDpr), keyStrip.height - srcY);
    c.clearRect(0, 0, KEY_W, vh);
    if (srcH > 0) c.drawImage(keyStrip, 0, srcY, keyStrip.width, srcH, 0, 0, KEY_W, srcH * k / keyStripDpr);
    return;
  }
  paintKeys(c, dpr, sy, vh, hoverP);
}

function drawRuler() {
  const vw = sc.clientWidth, sx = curL();
  const sig = sx + '|' + ppb + '|' + vw + '|' + color + '|' + (window.devicePixelRatio || 1);
  if (sig === rulerSig) return; rulerSig = sig;
  const c = fit(rc, vw, RULER_H);
  c.fillStyle = PR.ruler; c.fillRect(0, 0, vw, RULER_H);
  c.font = '11px system-ui,sans-serif'; c.textBaseline = 'top';
  eachVLine(sx, vw, (x, beat, li) => {
    if (li === 0) { c.fillStyle = PR.rulerTick1; c.fillRect(x - 0.5, 4, 1, RULER_H - 4); if (beat < total) { c.fillStyle = PR.rulerText; c.fillText(String(1 + beat / BEATS_PER_BAR), x + 5, 5); } }
    else if (li === 1) { c.fillStyle = PR.rulerTick2; c.fillRect(x - 0.5, RULER_H - 12, 1, 12); if (ppb >= 64) { c.fillStyle = PR.dim; c.fillText(String(Math.round(beat % BEATS_PER_BAR) + 1), x + 4, 14); } }
    else { c.fillStyle = PR.rulerTick3; c.fillRect(x - 0.5, RULER_H - 6, 1, 6); }
  });
  const ex = Math.round(total * ppb - sx);
  if (ex >= 0 && ex <= vw) { c.fillStyle = soft(color, 0.55); c.fillRect(ex - 1, 0, 2, RULER_H); }
  c.fillStyle = PR.rulerLine; c.fillRect(0, RULER_H - 1, vw, 1);
}

// ---------- panel Velocity: satu batang per nada, sejajar dengan awal nada di grid (ikut zoom & geser) ----------
// Tinggi batang = velocity (0..1). Seret batang untuk mengubah; seret melintasi beberapa batang = melukis velocity.
// Batang nada terpilih diseret bersama (selisihnya sama). Hasilnya: nada di grid makin transparan, suaranya makin pelan.
const VEL_PAD_T = 10, VEL_PAD_B = 8, VEL_HIT = 11;
interface VelGesture { id: number; mode: 'paint' | 'delta'; anchor: number; v0: number; orig: Map<number, number>; lastX: number; lastV: number; pushed: boolean; }
let vg: VelGesture | null = null;
const velUse = (h: number) => Math.max(1, h - VEL_PAD_T - VEL_PAD_B);
const velY = (v: number, h: number) => VEL_PAD_T + (1 - velOf(v)) * velUse(h);
const velFromY = (y: number, h: number) => clamp(1 - (y - VEL_PAD_T) / velUse(h), VEL_MIN, 1);
const velX = (n: Note, sx: number) => KEY_W + n.s * ppb - sx;
const pct = (v: number) => Math.round(velOf(v) * 100) + '%';
function drawVel() {
  if (!velOpen || !vc) return;
  const body = vc.parentElement!, w = body.clientWidth, h = body.clientHeight;
  if (w < 2 || h < 2) return;
  const sx = curL(), c = fit(vc, w, h, 2);
  c.fillStyle = PR.bg; c.fillRect(0, 0, w, h);
  // kolom kiri (selebar tuts piano): skala 100 / 50 / 0
  c.fillStyle = PR.ruler; c.fillRect(0, 0, KEY_W, h);
  c.font = '600 10px system-ui,sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right'; c.fillStyle = PR.dim;
  for (const t of [1, 0.5, 0]) c.fillText(String(Math.round(t * 100)), KEY_W - 8, Math.min(h - 7, Math.max(7, velY(t, h))));
  c.textAlign = 'start';
  c.fillStyle = PR.rulerLine; c.fillRect(KEY_W - 1, 0, 1, h);
  // area batang
  c.save(); c.beginPath(); c.rect(KEY_W - 7, 0, w - KEY_W + 7, h); c.clip();   // sedikit melewati tepi kiri: kepala batang nada di awal pattern tidak terpotong
  eachVLine(sx, w - KEY_W, (x, _b, li) => { c.fillStyle = LEVEL_FILL[li]; c.fillRect(KEY_W + x - 0.5, 0, 1, h); });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) { c.fillStyle = t === 0.5 || t === 0 || t === 1 ? gl(0.22) : gl(0.09); c.fillRect(KEY_W, Math.round(velY(t, h)), w - KEY_W, 1); }
  const ex = Math.round(KEY_W + total * ppb - sx);
  if (ex >= KEY_W && ex <= w) { c.fillStyle = color; c.fillRect(ex - 1, 0, 2, h); }
  const base = h - VEL_PAD_B;
  for (const pass of [false, true]) {   // nada terpilih digambar terakhir (di atas)
    for (const n of st.notes) {
      if (selected.has(n.id) !== pass) continue;
      const x = Math.round(velX(n, sx)); if (x < KEY_W - 8 || x > w + 8) continue;
      const y = Math.round(velY(velOf(n.v), h));
      c.fillStyle = color; c.fillRect(x - 1, y, 3, Math.max(1, base - y));   // batang
      c.beginPath(); c.arc(x + 0.5, y, pass ? 5.5 : 4.5, 0, Math.PI * 2); c.fill();   // kepala batang
      if (pass) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); }
    }
  }
  if (vg) {   // angka persen di samping batang yang sedang diseret
    const an = st.notes.find(n => n.id === vg!.anchor);
    if (an) {
      const x = velX(an, sx), v = velOf(an.v), txt = pct(v), left = x > w - 56;
      c.font = '600 11px system-ui,sans-serif'; c.textBaseline = 'middle'; c.textAlign = left ? 'right' : 'left';
      c.fillStyle = '#fff'; c.fillText(txt, left ? x - 11 : x + 11, Math.min(h - 8, Math.max(8, velY(v, h))));
      c.textAlign = 'start';
    }
  }
  c.restore();
}
// batang yang dipegang di titik (px, py): dalam jarak VEL_HIT horizontal; kalau bertumpuk (akor) pilih yang kepalanya paling dekat dengan jari
function velHit(px: number, py: number, h: number): Note | null {
  const sx = curL(); let best: Note | null = null, bd = 1e9;
  for (const n of st.notes) {
    const dx = Math.abs(velX(n, sx) - px); if (dx > VEL_HIT) continue;
    const d = dx * 0.25 + Math.abs(velY(velOf(n.v), h) - py);
    if (d <= bd) { bd = d; best = n; }
  }
  return best;
}
function velXY(e: PointerEvent) { const r = vc.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top, h: r.height}; }
function velSet(n: Note, v: number) { if (v >= 1) delete n.v; else n.v = Math.round(v * 1000) / 1000; }
function onVelDown(e: PointerEvent) {
  if ((e.pointerType === 'mouse' && e.button !== 0) || vg) return;
  const {x, y, h} = velXY(e), hit = velHit(x, y, h); if (!hit) return;
  e.preventDefault(); vc.setPointerCapture(e.pointerId);
  const multi = selected.has(hit.id) && selected.size > 1;
  vg = {id: e.pointerId, mode: multi ? 'delta' : 'paint', anchor: hit.id, v0: velOf(hit.v),
    orig: new Map(st.notes.filter(n => multi ? selected.has(n.id) : n.id === hit.id).map(n => [n.id, velOf(n.v)])), lastX: x, lastV: velFromY(y, h), pushed: false};
  velApply(x, y, h);
}
function velApply(x: number, y: number, h: number) {
  const gs = vg; if (!gs) return;
  const v = velFromY(y, h);
  if (!gs.pushed) { pushUndo(); gs.pushed = true; }
  if (gs.mode === 'delta') {
    const d = v - gs.v0;
    for (const n of st.notes) { const o = gs.orig.get(n.id); if (o !== undefined) velSet(n, clamp(o + d, VEL_MIN, 1)); }
  } else {   // melukis: batang yang dipegang + semua batang yang dilewati sejak titik terakhir (nilainya diinterpolasi, gerakan cepat tidak melewatkan batang)
    const sx = curL(), a = Math.min(gs.lastX, x), b = Math.max(gs.lastX, x), span = x - gs.lastX;
    const an = st.notes.find(n => n.id === gs.anchor), ax = an ? velX(an, sx) : -1e9;
    for (const n of st.notes) {
      const nx = velX(n, sx);
      const holding = n === an && Math.abs(x - nx) <= VEL_HIT;   // batang yang dipegang mengikuti jari selama jari masih di dekatnya
      const swept = nx >= a && nx <= b && (n === an || Math.abs(nx - ax) >= 1);   // batang lain di tumpukan yang sama dengan batang yang dipegang tidak ikut berubah
      if (!holding && !swept) continue;
      const t = swept && Math.abs(span) >= 1 ? clamp((nx - gs.lastX) / span, 0, 1) : 1;
      velSet(n, clamp(gs.lastV + (v - gs.lastV) * t, VEL_MIN, 1));
    }
    gs.lastX = x; gs.lastV = v;
  }
  lastVel = velOf(st.notes.find(n => n.id === gs.anchor)?.v);
  schedule();
}
function onVelMove(e: PointerEvent) { if (!vg || e.pointerId !== vg.id) return; const {x, y, h} = velXY(e); velApply(x, y, h); }
function onVelUp(e: PointerEvent) {
  if (!vg || e.pointerId !== vg.id) return;
  vg = null; schedule();   // schedule: menggambar ulang + memberi tahu perubahan (mini-notes di pattern ikut berubah)
}
function setVelOpen(open: boolean) {
  velOpen = open;
  velPanel.classList.toggle('is-open', open); velBtn.classList.toggle('is-open', open);
  velBtn.setAttribute('aria-expanded', String(open));
  velBtn.title = open ? 'Tutup panel Velocity' : 'Buka panel Velocity';
  if (open) requestAnimationFrame(() => { drawVel(); schedule(); });   // tinggi grid berubah (ResizeObserver menggambar ulang grid)
}

// ---------- menu bulat di atas / bawah note terpilih (gaya sama dengan menu pattern di timeline) ----------
let selBarOn = false;
let barOff = false;   // true setelah note selesai di-DRAG (pindah / ubah panjang): menu tidak muncul; baru muncul lagi kalau note di-KLIK
function flashBtn(act: string) {
  const b = selBar.querySelector<HTMLElement>('[data-sel="' + act + '"]'); if (!b || REDUCE) return;
  b.animate([{transform: 'scale(1)'}, {transform: 'scale(1.18)'}, {transform: 'scale(1)'}], {duration: 240, easing: 'ease-out'});
}
function shakeSelBar() { selBar.classList.remove('is-shake'); void selBar.offsetWidth; selBar.classList.add('is-shake'); }
function placeSelBar() {
  if (!selBar) return;
  const dragging = !!g && g.kind !== 'pan' && g.kind !== 'tapdraw';   // saat menyeret / seleksi kotak, menu disembunyikan dulu
  const sel = selected.size && !dragging && !barOff ? st.notes.filter(n => selected.has(n.id)) : [];
  if (!sel.length) { selBar.hidden = true; selBarOn = false; return; }
  const vw = sc.clientWidth, vh = sc.clientHeight, sx = sc.scrollLeft, sy = sc.scrollTop;
  const x0 = Math.min(...sel.map(n => n.s)) * ppb - sx, x1 = Math.max(...sel.map(n => n.s + n.l)) * ppb - sx;
  const y0 = (P_MAX - Math.max(...sel.map(n => n.p))) * rowH - sy, y1 = (P_MAX - Math.min(...sel.map(n => n.p)) + 1) * rowH - sy;
  if (x1 < 0 || x0 > vw || y1 < 0 || y0 > vh) { selBar.hidden = true; selBarOn = false; return; }   // seluruh pilihan di luar layar
  btnSlide.classList.toggle('is-on', sel.every(n => n.sl));   // tombol menyala kalau semua nada terpilih sudah slide
  const wasHidden = selBar.hidden; selBar.hidden = false;
  const bw = selBar.offsetWidth, bh = selBar.offsetHeight || 46;
  const ix0 = Math.max(x0, 0), ix1 = Math.min(x1, vw);
  const left = clamp((ix0 + ix1) / 2 - bw / 2, 6, Math.max(6, vw - bw - 6));
  let top = y0 - bh - 8;                                   // di atas note; kalau tidak muat, pindah ke bawah
  if (top < 4) top = y1 + 8;
  top = clamp(top, 4, Math.max(4, vh - bh - 4));
  selBar.style.left = KEY_W + left + 'px'; selBar.style.top = RULER_H + top + 'px';
  if (wasHidden || !selBarOn) { selBar.classList.remove('is-open'); void selBar.offsetWidth; if (!REDUCE) selBar.classList.add('is-open'); }
  selBarOn = true;
}

// ---------- playhead (garis + kepala di penggaris, ikut posisi playhead timeline) ----------
// Saat lagu main, playhead digerakkan animasi CSS (jalan di compositor / GPU), BUKAN per frame lewat JavaScript: kalau main thread
// sibuk (banyak nada dibunyikan sekaligus) gerakan playhead tetap mulus. JS hanya membuat ulang animasi saat zoom / geser berubah.
let phMo: {beat0: number; perSec: number; t0: number} | null = null, phAnim: Animation | null = null, phSig = '', phTimer = 0;
const phVis = (v: boolean) => { phDom.style.visibility = v ? 'visible' : 'hidden'; };
function phStop() { if (phAnim) { phAnim.onfinish = null; phAnim.cancel(); phAnim = null; } window.clearTimeout(phTimer); phTimer = 0; }
function placePlayhead() {
  if (!phDom) return;
  const L = curL();
  if (phMo) {
    const sig = ppb + '|' + L;
    if (sig === phSig) return;                       // animasi sudah benar untuk zoom / posisi geser ini
    phSig = sig; phStop();
    const m = phMo, now = performance.now(), waitMs = Math.max(0, m.t0 - now);
    const b0 = waitMs > 0 ? m.beat0 : m.beat0 + (now - m.t0) / 1000 * m.perSec;   // posisi (ketukan) saat ini dari jam transport
    if (b0 > total) { phVis(false); return; }
    if (b0 < 0) {                                    // playhead masih di sebelum pattern ini: muncul begitu masuk
      phVis(false);
      phTimer = window.setTimeout(() => { phSig = ''; placePlayhead(); }, waitMs + (-b0 / m.perSec) * 1000 + 1);
      return;
    }
    const x0 = b0 * ppb - L, x1 = total * ppb - L, durMs = (total - b0) / m.perSec * 1000;
    phVis(true); phDom.style.translate = x0 + 'px 0';
    if (durMs <= 0) return;
    phAnim = phDom.animate([{translate: x0 + 'px 0'}, {translate: x1 + 'px 0'}], {duration: durMs, delay: waitMs, easing: 'linear', fill: 'none'});
    phAnim.onfinish = () => { phAnim = null; phVis(false); };
    return;
  }
  phStop();
  const x = phBeat * ppb - L;
  const vis = phBeat >= 0 && phBeat <= total && x >= -5 && x <= sc.clientWidth + 5;
  phVis(vis);
  if (vis) phDom.style.translate = x + 'px 0';
}
// motion (opsional): playhead sedang berjalan dari `beats` dengan kecepatan perSec ketukan/detik, mulai setelah `delay` detik (count-in)
export function setPianoRollPlayhead(beats: number, motion?: {perSec: number; delay: number}) {
  phBeat = beats;
  phMo = motion ? {beat0: beats, perSec: motion.perSec, t0: performance.now() + motion.delay * 1000} : null;
  phSig = '';
  if (root && !root.hidden) placePlayhead();
}

// ---------- sinkron ke timeline: isi note ditampilkan mini di dalam pattern ----------
let onChange: ((id: string) => void) | null = null, notified = '';
export const setPianoRollChangeHandler = (fn: (id: string) => void) => { onChange = fn; };

// ---------- preview suara: nada berbunyi lewat instrumen pemilik piano roll (DERIZ / Supersaw) saat ditambah atau digeser ----------
// main.ts yang tahu instrumen mana yang sedang diedit; piano roll hanya memberi tahu nada (MIDI) mana yang harus bunyi / dilepas.
export interface PianoRollPreview { on(midi: number): void; off(midi: number): void; }
let pv: PianoRollPreview | null = null, pvMidi = -1, pvTimer = 0;
const PV_TAP_MS = 380;   // tap / panah keyboard: bunyi singkat lalu dilepas sendiri (tidak ada jari yang menahan)
export const setPianoRollPreviewHandler = (h: PianoRollPreview | null) => { pv = h; };
function pvStop() {
  window.clearTimeout(pvTimer); pvTimer = 0;
  if (pvMidi >= 0) { const m = pvMidi; pvMidi = -1; pv?.off(m); }
}
// hold = true: bunyi sampai pvStop() (jari / mouse masih menahan); pitch sama tidak dibunyikan ulang. false: bunyi singkat lalu lepas sendiri.
function pvPlay(m: number, hold = true) {
  if (!pv) return;
  if (hold && m === pvMidi) return;
  pvStop();   // geser naik / turun: nada sebelumnya dilepas, nada di baris baru langsung bunyi
  pvMidi = m; pv.on(m);
  if (!hold) pvTimer = window.setTimeout(pvStop, PV_TAP_MS);
}
// Tap / seret di penggaris (atas) = pindahkan playhead ke posisi itu. beats = ketukan dari awal pattern; final = jari/klik dilepas.
let onSeek: ((beats: number, final: boolean) => void) | null = null;
export const setPianoRollSeekHandler = (fn: (beats: number, final: boolean) => void) => { onSeek = fn; };
let seekId = -1;
function seekAt(e: PointerEvent, final: boolean) {
  if (!onSeek) return;
  const x = e.clientX - rc.getBoundingClientRect().left;
  onSeek(clamp((curL() + x) / ppb, 0, total), final);
}
function onRulerDown(e: PointerEvent) {
  if (seekId !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
  seekId = e.pointerId; rc.setPointerCapture(e.pointerId); seekAt(e, false);
}
function onRulerMove(e: PointerEvent) { if (e.pointerId === seekId) seekAt(e, false); }
function onRulerUp(e: PointerEvent) { if (e.pointerId !== seekId) return; seekId = -1; seekAt(e, true); }
function notifyChange() {
  if (!onChange || !curKey) return;
  const sn = curKey + snapshot();
  if (sn !== notified) { notified = sn; onChange(curKey); }
}
export let PR_BEATS = total;   // lebar grid piano roll (ketukan); live binding, ikut berubah kalau panjang grid diganti
export const getPianoRollBars = (): number => BARS;
// jumlah bar minimal supaya semua nada (semua pattern) tetap di dalam grid
export function pianoRollNeededBars(): number {
  let m = 0;
  for (const x of states.values()) for (const n of x.notes) m = Math.max(m, n.s + n.l);
  for (const n of st.notes) m = Math.max(m, n.s + n.l);
  return Math.max(PR_BARS_MIN, Math.ceil(m / BEATS_PER_BAR - 1e-9));
}
function applyBars(v: number): boolean {
  if (v === BARS) return false;
  BARS = v; total = BARS * BEATS_PER_BAR; PR_BEATS = total;
  if (root && !root.hidden) { applySize(); schedule(); }   // piano roll sedang terbuka: ukuran ruang scroll + gambar ikut
  document.dispatchEvent(new CustomEvent('prbarschange'));  // main.ts menggambar ulang note mini di semua pattern; menu Pengaturan menyamakan tampilannya
  return true;
}
// dari Pengaturan: mengembalikan nilai yang benar-benar dipakai (dijepit ke 4..50 dan ke nada terjauh)
export function setPianoRollBars(n: number, save = true): number {
  const v = clamp(Math.round(n) || PR_BARS_DEFAULT, Math.min(PR_BARS_MAX, Math.max(PR_BARS_MIN, pianoRollNeededBars())), PR_BARS_MAX);
  if (save) { try { localStorage.setItem(PR_BARS_KEY, String(v)); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  applyBars(v);
  return v;
}
// sl / v hanya ikut kalau bukan nilai awal (velocity 1 = tidak disimpan), jadi data project lama tetap sama
const extras = (n: {sl?: boolean; v?: number}) => ({...(n.sl ? {sl: true} : {}), ...(n.v !== undefined && n.v < 1 ? {v: Math.round(velOf(n.v) * 1000) / 1000} : {})});
export function getPianoRollNotes(id: string): NoteData[] {
  const x = states.get(id);
  return x ? x.notes.map(n => ({p: n.p, s: n.s, l: n.l, ...extras(n)})) : [];
}
// isi nada satu kunci dari data yang disimpan (memuat project)
export function setPianoRollNotes(id: string, notes: NoteData[]) {
  const st: State = {notes: [], nextId: 1};
  for (const n of notes) st.notes.push({id: st.nextId++, p: n.p, s: n.s, l: n.l, ...extras(n)});
  states.set(id, st);
  const need = pianoRollNeededBars(); if (need > BARS) applyBars(Math.min(PR_BARS_MAX, need));   // project berisi nada lebih jauh dari grid pengaturan ini: grid melebar sementara (pengaturan tersimpan tidak berubah), nada tidak pernah tersembunyi
  onChange && onChange(id);
}
// salin nada dari satu pattern ke pattern lain (rentang ketukan [fromBeat, toBeat), digeser supaya mulai dari 0)
export function copyPianoRollNotes(from: string, to: string, fromBeat = 0, toBeat = Infinity) {
  const src = states.get(from); if (!src) return;
  const dst: State = {notes: [], nextId: 1};
  for (const n of src.notes) {
    const a = Math.max(n.s, fromBeat), b = Math.min(n.s + n.l, toBeat);
    if (b > a + 1e-9) dst.notes.push({id: dst.nextId++, p: n.p, s: a - fromBeat, l: b - a, ...extras(n)});
  }
  states.set(to, dst);
}
// nada milik DERIZ lain di pattern yang sama disimpan dengan kunci "<id pattern>@<id track DERIZ>"; daftar kunci tambahan itu untuk id ini
export function clearPianoRollNotes(id: string) { if (states.delete(id)) onChange && onChange(id); }   // kosongkan nada satu kunci (mis. pemilik kunci polos dihapus)
export function dropPianoRollNotesOf(suffix: string) {   // buang semua nada berkunci "<pattern>@<suffix>" dan kabarkan perubahannya
  for (const k of [...states.keys()]) if (k.endsWith('@' + suffix)) { states.delete(k); onChange && onChange(k); }
}
export const pianoRollExtraKeys = (id: string): string[] => [...states.keys()].filter(k => k.startsWith(id + '@') && states.get(k)!.notes.length);
export function trimPianoRollNotes(id: string, toBeat: number) {   // buang / potong nada yang melewati toBeat
  const x = states.get(id); if (!x) return;
  x.notes = x.notes.filter(n => n.s < toBeat - 1e-9).map(n => ({...n, l: Math.min(n.l, toBeat - n.s)}));
}
export function shiftPianoRollNotes(id: string, delta: number) {   // geser semua nada sebesar delta ketukan (awal pattern berpindah); yang jatuh sebelum ketukan 0 dipotong / dibuang
  const x = states.get(id); if (!x) return;
  x.notes = x.notes.map(n => ({...n, s: n.s + delta})).filter(n => n.s + n.l > 1e-9).map(n => n.s < 0 ? {...n, l: n.l + n.s, s: 0} : n);
}

// Zoom (pinch 2 jari / wheel) bisa memicu ratusan event per detik. Dulu tiap event menulis lebar ruang scroll + scrollLeft + scrollTop
// langsung (beberapa layout paksa per event). Sekarang event hanya mencatat target; DOM ditulis SEKALI per frame di redraw().
let zoomPend: {l: number; t: number} | null = null, zoomFrame = false;
const curL = () => (zoomPend ? zoomPend.l : sc.scrollLeft), curT = () => (zoomPend ? zoomPend.t : sc.scrollTop);   // posisi scroll efektif (termasuk zoom yang belum ditulis)
function flushZoom() {
  if (!zoomPend) return;
  const z = zoomPend; zoomPend = null;
  applySize(); sc.scrollLeft = z.l; sc.scrollTop = z.t;
}
// Saat zoom, grid TIDAK digambar ulang: gambar terakhir hanya diskalakan GPU lewat CSS transform (hampir gratis).
// Begitu zoom berhenti ZOOM_IDLE ms (atau jari lepas), layout ditulis sekali dan grid digambar ulang tajam.
const ZOOM_IDLE = 120;
let zoomEndT = 0;
function commitZoom() {
  zoomEndT = 0;
  if (!zoomPend) return;
  if (pinch) { zoomEndT = window.setTimeout(commitZoom, ZOOM_IDLE); return; }   // jari masih menempel
  const z = zoomPend, panOnly = drawn.ppb === ppb && drawn.rowH === rowH && gridCovers(z.l, z.t);   // geser saja, zoom tidak berubah
  flushZoom();
  if (panOnly) { scheduleScroll(); return; }   // isi canvas masih benar: cukup tulis posisi scroll, grid tidak digambar ulang
  zoomFrame = true; schedule();
}
function redraw() {
  if (zoomPend) {
    const z = zoomPend;
    if (!pinch && drawn.ppb === ppb && drawn.rowH === rowH && !gridCovers(z.l, z.t)) {   // geser sudah melewati overscan: gambar ulang sekarang
      window.clearTimeout(zoomEndT); zoomEndT = 0; flushZoom(); zoomFrame = true; gridDirty = true;
    } else {
      placeGrid(z.l, z.t); drawKeys(true); drawRuler(); drawVel(); placePlayhead();
      if (selBar && !selBar.hidden) { selBar.hidden = true; selBarOn = false; }
      window.clearTimeout(zoomEndT); zoomEndT = window.setTimeout(commitZoom, ZOOM_IDLE);
      return;
    }
  }
  if (!gridDirty && gridCovers(sc.scrollLeft, sc.scrollTop)) {   // hanya scroll biasa & masih di dalam canvas: geser saja
    placeGrid(sc.scrollLeft, sc.scrollTop); drawKeys(); drawRuler(); drawVel(); placeSelBar(); placePlayhead();
    return;
  }
  gridDirty = false;
  const zo = zoomFrame; zoomFrame = false;
  drawGrid(zo); drawKeys(); drawRuler(); drawVel(); placeSelBar(); placePlayhead();
  // notifyChange membuat JSON seluruh note: di frame zoom ditunda (note tidak berubah), supaya tidak ikut membebani gesture
  if (zo || g) { window.clearTimeout(notifyT); notifyT = window.setTimeout(notifyChange, 250); } else notifyChange();   // selama drag / zoom tidak ada JSON + render ulang pratinjau pattern tiap frame; jari lepas = langsung
}

let notifyT = 0;
function schedule() { gridDirty = true; scheduleScroll(); }
function scheduleScroll() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); }   // scroll murni: isi grid tidak berubah
// geser (sentuh / tool tangan): posisi disimpan di zoomPend, canvas digeser lewat transform; layout baru ditulis saat berhenti
function panTo(l: number, t: number) {
  const maxL = Math.max(0, total * ppb + EDGE_PAD - sc.clientWidth), maxT = Math.max(0, ROWS * rowH - sc.clientHeight);
  zoomPend = {l: clamp(l, 0, maxL), t: clamp(t, 0, maxT)};
  scheduleScroll();
}

// ---------- ukuran & zoom ----------
function applySize() {
  space.style.width = total * ppb + EDGE_PAD + 'px';
  space.style.height = ROWS * rowH + 'px';
}
function setZoomAt(nppb: number, nrow: number, vx: number, vy: number, beatAt: number, rowAt: number) {
  ppb = clamp(nppb, PPB_MIN, PPB_MAX); rowH = clamp(nrow, ROW_MIN, ROW_MAX);
  zoomPend = {l: Math.max(0, beatAt * ppb - vx), t: Math.max(0, rowAt * rowH - vy)}; zoomFrame = true;
  schedule();
}
function zoomBy(fx: number, fy: number) {
  const vw = sc.clientWidth, vh = sc.clientHeight;
  setZoomAt(ppb * fx, rowH * fy, vw / 2, vh / 2, (curL() + vw / 2) / ppb, (curT() + vh / 2) / rowH);
  commitZoom();   // tombol / keyboard: satu langkah, tidak perlu preview
}

// ---------- operasi data ----------
function pushUndo(s?: string) {
  undoStack.push(s ?? snapshot());
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateUI();
}
function undo() {
  const s = undoStack.pop(); if (s === undefined) return;
  redoStack.push(snapshot());
  st.notes = JSON.parse(s) as Note[];
  selected = new Set([...selected].filter(id => st.notes.some(n => n.id === id)));
  updateUI(); schedule();
}
function redo() {
  const s = redoStack.pop(); if (s === undefined) return;
  undoStack.push(snapshot());
  st.notes = JSON.parse(s) as Note[];
  selected = new Set([...selected].filter(id => st.notes.some(n => n.id === id)));
  updateUI(); schedule();
}
function deleteSelected() {
  if (!selected.size) return;
  pushUndo();
  st.notes = st.notes.filter(n => !selected.has(n.id));
  selected.clear(); updateUI(); schedule();
}
// salin / tempel nada (clipboard dibagi antar pattern; posisi disimpan relatif ke nada paling kiri)
let clip: NoteData[] = [];
function copySelected() {
  if (!selected.size) return;
  const sel = st.notes.filter(n => selected.has(n.id)), s0 = Math.min(...sel.map(n => n.s));
  clip = sel.map(n => ({p: n.p, s: n.s - s0, l: n.l, ...extras(n)}));
  updateUI(); flashBtn('copy');
}
function pasteNotes() {
  if (!clip.length) return;
  const span = Math.max(...clip.map(c => c.s + c.l));
  if (span > total) return shakeSelBar();
  const sel = st.notes.filter(n => selected.has(n.id));
  // ada pilihan: tempel tepat di kanan pilihan; tidak ada: di awal area yang terlihat
  let at = sel.length ? snapRound(Math.max(...sel.map(n => n.s + n.l))) : snapFloor(sc.scrollLeft / ppb);
  if (at + span > total + 1e-9) { if (sel.length) return shakeSelBar(); at = total - span; }
  pushUndo();
  const made = clip.map(c => ({id: st.nextId++, p: c.p, s: at + c.s, l: c.l, ...extras(c)}));
  st.notes.push(...made);
  selected = new Set(made.map(n => n.id));
  updateUI(); schedule();
  sc.scrollLeft = clamp(sc.scrollLeft, Math.max(0, (at + span) * ppb - sc.clientWidth + 60), at * ppb);   // pastikan hasil tempel terlihat
}
function toggleSlide() {   // semua nada terpilih: kalau sudah slide semua -> matikan, selain itu -> nyalakan
  if (!selected.size) return;
  const sel = st.notes.filter(n => selected.has(n.id)), all = sel.every(n => n.sl);
  pushUndo();
  for (const n of sel) { if (all) delete n.sl; else n.sl = true; }
  lastSlide = !all;   // nada baru mengikuti pilihan terakhir: slide dinyalakan -> nada baru slide, dimatikan -> biasa
  updateUI(); schedule(); flashBtn('slide');
}
function selectAll() { selected = new Set(st.notes.map(n => n.id)); updateUI(); schedule(); }
function nudge(dB: number, dP: number) {
  if (!selected.size) return;
  const sel = st.notes.filter(n => selected.has(n.id));
  const minS = Math.min(...sel.map(n => n.s)), maxE = Math.max(...sel.map(n => n.s + n.l));
  const minP = Math.min(...sel.map(n => n.p)), maxP = Math.max(...sel.map(n => n.p));
  dB = clamp(dB, -minS, total - maxE); dP = clamp(dP, P_MIN - minP, P_MAX - maxP);
  if (!dB && !dP) return;
  pushUndo();
  for (const n of sel) { n.s += dB; n.p += dP; }
  if (dP) pvPlay(sel[0].p, false);   // panah atas / bawah: dengarkan nada di baris barunya
  schedule();
}

function updateUI() {
  if (!root) return;
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
  if (btnPaste) btnPaste.disabled = clip.length === 0;
}

// ---------- interaksi pointer ----------
interface Gesture {
  kind: 'new' | 'move' | 'resize' | 'marquee' | 'erase' | 'pan' | 'tapdraw';
  id: number;                 // pointerId
  x0: number; y0: number;     // posisi awal (koordinat konten)
  x: number; y: number;       // posisi sekarang (koordinat konten)
  snap0: string; pushed: boolean; changed: boolean;
  anchor?: Note; orig?: Note[]; base?: Set<number>;
  sl: number; stp: number;    // scroll awal (untuk pan)
  cx: number; cy: number;     // posisi client awal (untuk pan)
  t0: number;                 // waktu mulai (animasi bulatan)
  desel?: boolean;            // tap di area kosong saat ada seleksi: hanya lepas seleksi, jangan pasang nada
  touch?: boolean; moved?: boolean; timer?: number;   // tahan di area kosong (timer) lalu seret = blok / marquee
  refs?: Array<Note | undefined>; bnd?: {minS: number; maxE: number; minP: number; maxP: number}; lastA?: number; lastB?: number;   // cache drag: nada hidup per orig, batas seleksi, dan nilai terakhir yang diterapkan (dilewati kalau sama)
  gh?: Ghost;                 // tap awal jatuh di nada VST lain: kalau ditahan sampai HOLD_MS, pindah ke VST itu
}
let g: Gesture | null = null;
const ptrs = new Map<number, {x: number; y: number}>();
let pinch: {d0x: number; d0y: number; ppb0: number; row0: number; beat0: number; rowPos0: number} | null = null;

function localXY(e: {clientX: number; clientY: number}) {
  const r = sc.getBoundingClientRect();
  return {x: e.clientX - r.left + curL(), y: e.clientY - r.top + curT()};
}
function hit(cx: number, cy: number): {n: Note} | null {
  const row = Math.floor(cy / rowH), p = P_MAX - row;
  for (let i = st.notes.length - 1; i >= 0; i--) {
    const n = st.notes[i];
    if (n.p !== p) continue;
    const x0 = n.s * ppb, x1 = (n.s + n.l) * ppb;
    if (cx >= x0 && cx <= x1) return {n};
  }
  return null;
}
// nada VST lain (ghost) di titik ini; yang digambar paling atas (terakhir) menang. Hanya ghost yang punya open() yang bisa dituju.
function hitGhost(cx: number, cy: number): Ghost | null {
  const p = P_MAX - Math.floor(cy / rowH);
  for (let i = ghostSrc.length - 1; i >= 0; i--) {
    const gs = ghostSrc[i], gst = states.get(gs.key);
    if (!gs.open || !gst) continue;
    for (let j = gst.notes.length - 1; j >= 0; j--) {
      const n = gst.notes[j];
      if (n.p === p && cx >= n.s * ppb && cx <= n.s * ppb + Math.max(3, n.l * ppb)) return gs;
    }
  }
  return null;
}
function hitHandle(cx: number, cy: number): Note | null {
  let best: Note | null = null, bd = 1e9;
  for (const n of st.notes) {
    if (!selected.has(n.id)) continue;   // hanya note terpilih yang punya bulatan
    const ex = handleCX(n), ey = (P_MAX - n.p + 0.5) * rowH, endX = n.s * ppb + Math.max(3, n.l * ppb);
    if (cx < endX || cx > ex + 16 || Math.abs(cy - ey) > Math.max(rowH / 2, 11)) continue;   // tidak pernah masuk ke badan note
    const d = Math.hypot(cx - ex, cy - ey);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function commit() { if (g && !g.pushed) { pushUndo(g.snap0); g.pushed = true; } }

function cancelGesture() {
  pvStop();
  if (g) clearTimeout(g.timer);
  if (g && g.pushed) { st.notes = JSON.parse(g.snap0) as Note[]; undoStack.pop(); }
  g = null; updateUI(); schedule();
}

function onDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
  ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  gc.setPointerCapture(e.pointerId);
  barOff = false;   // sentuhan baru: klik note = menu muncul lagi
  if (ptrs.size === 2) {                       // pinch: batalkan apa pun yang sedang digambar
    if (g) cancelGesture();
    const [a, b] = [...ptrs.values()];
    const r = sc.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    pinch = {d0x: Math.abs(a.x - b.x), d0y: Math.abs(a.y - b.y), ppb0: ppb, row0: rowH, beat0: (curL() + mx) / ppb, rowPos0: (curT() + my) / rowH};
    return;
  }
  if (ptrs.size > 2 || pinch) return;

  const {x, y} = localXY(e);
  const base: Gesture = {kind: 'pan', id: e.pointerId, x0: x, y0: y, x, y, snap0: snapshot(), pushed: false, changed: false, sl: curL(), stp: curT(), cx: e.clientX, cy: e.clientY, t0: performance.now()};
  const t: Tool = e.button === 1 ? 'pan' : tool;

  if (t === 'pan') { g = base; gc.style.cursor = 'grabbing'; return; }
  const h = hit(x, y);

  if (t === 'erase') {
    g = {...base, kind: 'erase'};
    if (h) { commit(); st.notes = st.notes.filter(n => n !== h.n); selected.delete(h.n.id); g.changed = true; updateUI(); schedule(); }
    return;
  }
  const hh = hitHandle(x, y);
  if (hh) {                                     // tarik bulatan putih: ubah panjang
    if (!selected.has(hh.id)) selected = new Set([hh.id]);
    g = {...base, kind: 'resize', anchor: {...hh}, orig: st.notes.filter(n => selected.has(n.id)).map(n => ({...n}))};
    updateUI(); schedule(); return;
  }
  if (h) {                                      // klik di nada: pilih + pindah
    if (e.shiftKey && t === 'select') {
      if (selected.has(h.n.id)) selected.delete(h.n.id); else { selected.add(h.n.id); rememberNote(h.n); }
      updateUI(); schedule(); return;
    }
    if (!selected.has(h.n.id)) { if (!e.shiftKey) selected.clear(); selected.add(h.n.id); }
    rememberNote(h.n);   // klik nada: nada berikutnya meniru panjang, slide, dan velocity nada ini
    g = {...base, kind: 'move', anchor: {...h.n}, orig: st.notes.filter(n => selected.has(n.id)).map(n => ({...n}))};
    pvPlay(h.n.p);   // pegang nada = langsung terdengar; digeser naik / turun, suaranya ikut pindah baris
    updateUI(); schedule(); return;
  }
  if (t === 'select') {                         // area kosong: marquee
    g = {...base, kind: 'marquee', base: e.shiftKey ? new Set(selected) : new Set()};
    if (!e.shiftKey) selected.clear();
    updateUI(); schedule(); return;
  }
  // draw di area kosong: tap/klik = pasang nada; seret = nada panjang (mouse) / scroll (sentuh); TAHAN lalu seret = blok nada (marquee)
  const touch = e.pointerType === 'touch', desel = selected.size > 0;
  if (desel && !touch) { selected.clear(); updateUI(); schedule(); }   // ada seleksi: klik kosong cuma melepas seleksi dulu
  g = {...base, kind: 'tapdraw', desel, touch, gh: hitGhost(x, y) || undefined};
  g.timer = window.setTimeout(holdMarquee, HOLD_MS);
}
const HOLD_MS = 320;
function holdMarquee() {
  if (!g || g.kind !== 'tapdraw' || g.moved) return;
  if (g.gh) {                                   // tahan di nada VST lain: pindah ke VST itu (zoom & scroll tetap)
    const open = g.gh.open!;
    g = null; ptrs.clear(); updateUI(); schedule();
    if (navigator.vibrate) navigator.vibrate(12);
    open();
    return;
  }
  g.timer = undefined; g.kind = 'marquee'; g.base = new Set(); selected.clear();
  if (navigator.vibrate) navigator.vibrate(12);
  updateUI(); schedule();
}

function rememberNote(n: Note) {   // contoh: klik nada 2 blok + slide + velocity 50% -> nada baru yang dipasang juga 2 blok + slide + velocity 50%
  if (n.l >= unit()) lastLen = n.l;
  lastSlide = !!n.sl;
  lastVel = velOf(n.v);
}

function addNoteAt(x: number, y: number): Note | null {
  const p = P_MAX - Math.floor(y / rowH);
  if (p < P_MIN || p > P_MAX || x < 0 || x >= total * ppb) return null;
  const s = clamp(snapFloor(x / ppb), 0, total - unit());
  const l = Math.min(lastLen, total - s);
  if (l <= 0) return null;
  pushUndo();
  const n: Note = {id: st.nextId++, p, s, l, ...(lastSlide ? {sl: true} : {}), ...(lastVel < 1 ? {v: lastVel} : {})};   // nada baru memakai velocity terakhir yang diatur di panel
  st.notes.push(n);   // note baru tidak langsung terpilih; baru terpilih kalau diklik lagi
  return n;
}

function onMove(e: PointerEvent) {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const r = sc.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    const nppb = pinch.d0x > 40 ? pinch.ppb0 * dx / pinch.d0x : pinch.ppb0;
    const nrow = pinch.d0y > 40 ? pinch.row0 * dy / pinch.d0y : pinch.row0;
    setZoomAt(nppb, nrow, mx, my, pinch.beat0, pinch.rowPos0);
    return;
  }
  const {x, y} = localXY(e);
  if (!g || g.id !== e.pointerId) {            // hover (mouse)
    const p = P_MAX - Math.floor(y / rowH);
    const np = p >= P_MIN && p <= P_MAX ? p : -1;
    if (np !== hoverP) { hoverP = np; schedule(); }
    const h = hit(x, y), onHandle = (tool === 'draw' || tool === 'select') && !!hitHandle(x, y);
    gc.style.cursor = tool === 'pan' ? 'grab' : tool === 'erase' ? (h ? 'pointer' : 'default') : onHandle ? 'ew-resize' : h ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    return;
  }
  g.x = x; g.y = y;
  if ((g.kind === 'move' || g.kind === 'resize') && !g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > (e.pointerType === 'touch' ? 8 : 5)) g.moved = true;   // sudah digeser = drag, bukan klik
  if (g.kind === 'tapdraw' && !g.moved && Math.hypot(e.clientX - g.cx, e.clientY - g.cy) > (g.touch ? 8 : 5)) {
    g.moved = true; clearTimeout(g.timer); g.timer = undefined;       // gerak sebelum ditahan: bukan blok
    if (g.touch) g.kind = 'pan';                                      // sentuh: scroll
    else if (!g.desel) {                                              // mouse / pen: pasang nada, seret ke kanan = nada panjang
      selected.clear();
      const n = addNoteAt(g.x0, g.y0);
      if (n) { g.kind = 'new'; g.anchor = n; g.changed = true; pvPlay(n.p); updateUI(); schedule(); }
    }
  }
  switch (g.kind) {
    case 'pan':
      panTo(g.sl - (e.clientX - g.cx), g.stp - (e.clientY - g.cy)); break;
    case 'new': {
      const n = g.anchor!;
      if (Math.abs(x - g.x0) > 3) {
        const end = clamp(snapRound(x / ppb), n.s + unit(), total);
        const nl = Math.max(unit(), end - n.s);
        if (nl !== n.l) { n.l = nl; schedule(); }   // snap: gambar ulang hanya saat melewati garis grid berikutnya
      }
      break;
    }
    case 'move': {
      const a0 = g.orig!.find(o => o.id === g!.anchor!.id)!;
      let dB = snapRound(a0.s + (x - g.x0) / ppb) - a0.s;
      let dP = -Math.round((y - g.y0) / rowH);
      if (!g.bnd) g.bnd = {minS: Math.min(...g.orig!.map(o => o.s)), maxE: Math.max(...g.orig!.map(o => o.s + o.l)), minP: Math.min(...g.orig!.map(o => o.p)), maxP: Math.max(...g.orig!.map(o => o.p))};
      const b = g.bnd;
      dB = clamp(dB, -b.minS, total - b.maxE); dP = clamp(dP, P_MIN - b.minP, P_MAX - b.maxP);
      if (dB === g.lastA && dP === g.lastB) break;   // masih di kotak snap yang sama: tidak ada yang berubah, tidak perlu gambar ulang
      g.lastA = dB; g.lastB = dP;
      if (!g.changed && (dB || dP)) { commit(); g.changed = true; }
      if (!g.refs) g.refs = g.orig!.map(o => st.notes.find(q => q.id === o.id));   // sekali per gesture, bukan find() per nada per gerakan
      g.orig!.forEach((o, i) => { const n = g!.refs![i]; if (n) { n.s = o.s + dB; n.p = o.p + dP; } });
      if (g.moved) pvPlay(a0.p + dP);   // geser naik / turun: nada di baris yang baru langsung bunyi (geser kanan / kiri saja tidak membunyikan ulang)
      schedule(); break;
    }
    case 'resize': {
      const a0 = g.anchor!, end0 = a0.s + a0.l;
      const dL = snapRound(end0 + (x - g.x0) / ppb) - end0;
      if (dL === g.lastA) break;                     // sama dengan frame sebelumnya: lewati
      g.lastA = dL;
      if (!g.changed && dL) { commit(); g.changed = true; }
      if (!g.refs) g.refs = g.orig!.map(o => st.notes.find(q => q.id === o.id));
      g.orig!.forEach((o, i) => { const n = g!.refs![i]; if (n) n.l = clamp(o.l + dL, unit(), total - o.s); });
      schedule(); break;
    }
    case 'marquee': {
      const x0 = Math.min(g.x0, x), x1 = Math.max(g.x0, x), y0 = Math.min(g.y0, y), y1 = Math.max(g.y0, y);
      const sel = new Set(g.base);
      for (const n of st.notes) {
        const nx0 = n.s * ppb, nx1 = (n.s + n.l) * ppb, ny0 = (P_MAX - n.p) * rowH, ny1 = ny0 + rowH;
        if (nx1 >= x0 && nx0 <= x1 && ny1 >= y0 && ny0 <= y1) sel.add(n.id);
      }
      selected = sel; updateUI(); schedule(); break;
    }
    case 'erase': {
      const h = hit(x, y);
      if (h) { commit(); st.notes = st.notes.filter(n => n !== h.n); selected.delete(h.n.id); g.changed = true; updateUI(); schedule(); }
      break;
    }
  }
}

function onUp(e: PointerEvent) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) { const was = !!pinch; pinch = null; if (was && zoomPend) { window.clearTimeout(zoomEndT); commitZoom(); } }
  if (g && g.id === e.pointerId) {
    clearTimeout(g.timer);
    pvStop();   // jari / mouse dilepas: nada yang sedang ditahan ikut dilepas
    if (g.kind === 'tapdraw' && !g.moved && e.type === 'pointerup') {
      if (g.desel) { selected.clear(); }          // ada seleksi: tap kosong cuma melepas seleksi
      else {
        selected.clear();
        const n = addNoteAt(g.x0, g.y0);
        if (n) { lastLen = n.l; pvPlay(n.p, false); }   // tap = pasang nada: bunyi singkat
      }
    }
    if ((g.kind === 'move' || g.kind === 'resize') && g.moved) barOff = true;   // habis drag note: jangan tampilkan menu
    if (g.kind === 'resize') rel = {id: g.anchor!.id, t0: performance.now()};
    if (g.kind === 'new' || g.kind === 'resize') {
      const id = g.anchor!.id, n = st.notes.find(q => q.id === id);
      if (n && n.l >= unit()) lastLen = n.l;
    }
    g = null;
    updateUI(); schedule();
    gc.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
  }
}

function onWheel(e: WheelEvent) {
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return;     // scroll biasa dibiarkan native
  e.preventDefault();
  const r = sc.getBoundingClientRect(), vx = e.clientX - r.left, vy = e.clientY - r.top;
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.006));
  const beat = (curL() + vx) / ppb, rowPos = (curT() + vy) / rowH;
  if (e.altKey) setZoomAt(ppb, rowH * f, vx, vy, beat, rowPos); else setZoomAt(ppb * f, rowH, vx, vy, beat, rowPos);
}

// ---------- bangun UI ----------
function setTool(t: Tool) {
  tool = t;
  root!.querySelectorAll<HTMLElement>('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  gc.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
}

// ---------- menu pengaturan (titik tiga): card berlapis seperti menu track di mixer ----------
// card 1: View + Note Key  ->  klik View: card 2 (Color + Style)  ->  klik Color: card 3 (pilihan warna)
let showNoteNames = false;   // Note Key: tampilkan nama semua nada (C, C#, D, D#, ...) di keyboard kiri; mati = hanya C
const PR_COLORS = ['#5b3de8', '#2f7bff', '#14b8a6', '#3fbf5f', '#ff9f1c', '#ff4d8d', '#ef4444', '#facc15'];   // sama dengan pilihan warna track di mixer
syncTrackColors(PR_COLORS); window.addEventListener('derizmp3:ui', () => syncTrackColors(PR_COLORS));   // set warna mengikuti Tema UI (sama dengan COLORS di main.ts)
const CHEV = '<svg class="track-menu__chev ico-ln" viewBox="0 0 24 24" width="14" height="14" stroke-width="2.4" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const mico = (d: string) => '<svg class="pr__mico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const MICO = {
  view: mico('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  keys: mico('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 4v16"/>'),
  style: mico('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/>'),
};

function buildSettingsMenu(el: HTMLElement) {
  const more = el.querySelector<HTMLButtonElement>('.pr__more')!;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cards: HTMLElement[] = [];   // [card utama, card View, card warna]

  const fade = (c: HTMLElement) => {
    if (reduce()) { c.remove(); return; }
    c.style.pointerEvents = 'none';
    c.animate([{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.9) translateY(-4px)'}],
      {duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards'}).onfinish = () => c.remove();
  };
  const dropFrom = (level: number) => {
    cards.splice(level).forEach(fade);
    const items = cards.map(c => c.querySelector<HTMLElement>('[aria-expanded]'));
    items.forEach((it, i) => it && it.setAttribute('aria-expanded', String(i < cards.length - 1)));
  };
  const closeAll = () => { cards.splice(0).forEach(fade); more.setAttribute('aria-expanded', 'false'); };

  const makeCard = (extra: string, html: string) => {
    const c = document.createElement('div');
    c.className = 'track-menu pr-menu ' + extra; c.setAttribute('role', 'menu'); c.innerHTML = html;
    document.body.appendChild(c); cards.push(c);
    return c;
  };
  // card di sebelah kanan card induk (kalau tidak muat: kiri; kalau layar sempit: bertumpuk di atas induk)
  const placeSub = (c: HTMLElement, parent: HTMLElement, item: HTMLElement) => {
    const mr = parent.getBoundingClientRect(), ir = item.getBoundingClientRect(), w = c.offsetWidth, h = c.offsetHeight;
    let left = mr.right + 4, top = ir.top - 6, origin = 'left top';
    if (left + w > innerWidth - 8) {
      if (mr.left - w - 4 >= 8) { left = mr.left - w - 4; origin = 'right top'; }
      else { left = Math.max(8, Math.min(mr.left, innerWidth - w - 8)); top = mr.bottom + 6; }   // layar sempit: card ditumpuk ke bawah
    }
    c.style.left = left + 'px';
    c.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + 'px';
    c.style.transformOrigin = origin;
  };

  const openColors = (parent: HTMLElement, item: HTMLElement) => {
    const c = makeCard('track-menu--colors',
      '<div class="track-menu__swatches">' +
      PR_COLORS.map((col, i) => '<button type="button" class="track-menu__swatch" data-c="' + col + '" style="background:' + col + ';--i:' + i + '" aria-label="Warna ' + col + '"></button>').join('') +
      '</div>');
    placeSub(c, parent, item);
    item.setAttribute('aria-expanded', 'true');
    c.addEventListener('click', e => {
      const sw = (e.target as HTMLElement).closest<HTMLElement>('.track-menu__swatch');
      if (!sw) return;
      noteColor = sw.dataset.c!; color = noteColor;   // berlaku global: nada aktif, nada instrumen lain, dan pattern lain
      root!.style.setProperty('--pr-color', color);
      schedule();
      closeAll();
    });
  };

  const openView = (parent: HTMLElement, item: HTMLElement) => {
    const c = makeCard('',
      '<button type="button" role="menuitem" class="track-menu__item" data-act="color" aria-expanded="false">' +
        '<span class="track-menu__dot" style="background:' + color + '"></span><span>Color</span>' + CHEV + '</button>' +
      '<button type="button" role="menuitem" class="track-menu__item" data-act="style">' + MICO.style + '<span>Style</span></button>');
    placeSub(c, parent, item);
    item.setAttribute('aria-expanded', 'true');
    c.addEventListener('click', e => {
      const it = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!it || it.dataset.act !== 'color') return;   // Style: tampilan saja
      if (cards.length > 2) dropFrom(2); else openColors(c, it);
    });
  };

  const openMain = () => {
    const c = makeCard('',
      '<button type="button" role="menuitem" class="track-menu__item" data-act="view" aria-expanded="false">' + MICO.view + '<span>View</span>' + CHEV + '</button>' +
      '<button type="button" role="menuitemcheckbox" class="track-menu__item pr__mtoggle" data-act="notekey" aria-checked="' + showNoteNames + '">' + MICO.keys + '<span>Note Key</span><i class="pr__sw" aria-hidden="true"></i></button>');
    const r = more.getBoundingClientRect();
    c.style.left = Math.max(8, Math.min(r.left, innerWidth - c.offsetWidth - 8)) + 'px';
    c.style.top = (r.bottom + 8) + 'px';
    c.style.transformOrigin = 'left top';
    more.setAttribute('aria-expanded', 'true');
    c.addEventListener('click', e => {
      const it = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!it) return;
      if (it.dataset.act === 'view') { if (cards.length > 1) dropFrom(1); else openView(c, it); }
      else if (it.dataset.act === 'notekey') {
        showNoteNames = !showNoteNames;
        it.setAttribute('aria-checked', String(showNoteNames));
        schedule();   // gambar ulang keyboard kiri
      }
    });
  };

  more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  more.addEventListener('click', () => { if (cards.length) closeAll(); else openMain(); });

  // klik di luar menu: tutup semua card (klik di area canvas tidak ikut menggambar nada)
  document.addEventListener('pointerdown', e => {
    if (!cards.length) return;
    const t = e.target as Node;
    if (cards.some(c => c.contains(t)) || more.contains(t)) return;
    closeAll();
    if (el.querySelector('.pr__main')!.contains(t)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  closeMenu = closeAll;
  menuOpen = () => cards.length > 0;
}

function build(): HTMLElement {
  const el = document.createElement('section');
  el.id = 'pianoRoll'; el.className = 'pr'; el.setAttribute('aria-label', 'Piano roll'); el.hidden = true;
  const btn = (attr: string, label: string, svg: string, extra = '') =>
    '<button type="button" class="pr__btn ' + extra + '" ' + attr + ' title="' + label + '" aria-label="' + label + '">' + svg + '</button>';
  el.innerHTML =
    '<div class="pr__bar">' +
      '<button type="button" class="pr__btn pr__more" aria-label="Menu lainnya" title="Lainnya">' + ICON.more + '</button>' +
      '<button type="button" class="pr__snap" aria-pressed="true" aria-label="Snap ke grid" title="Snap ke grid: nyala / mati"><i class="pr__led" aria-hidden="true"></i><span>Snap</span></button>' +
      '<div class="pr__grp">' +
        btn('data-act="undo"', 'Urungkan (Ctrl+Z)', ICON.undo) +
        btn('data-act="redo"', 'Ulangi (Ctrl+Shift+Z / Ctrl+Y)', ICON.redo) +
      '</div>' +
      '<div class="pr__grp pr__grp--close">' +
        '<button type="button" class="pr__btn pr__back" aria-label="Tutup piano roll" title="Tutup (Esc)">' + ICON.close + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="pr__main">' +
      '<div class="pr__corner"></div>' +
      '<canvas class="pr__ruler" aria-hidden="true"></canvas>' +
      '<canvas class="pr__keys" aria-hidden="true"></canvas>' +
      '<div class="pr__scroll"><div class="pr__space"></div><div class="pr__clip"><canvas class="pr__gridbg" aria-hidden="true"></canvas><canvas class="pr__grid" role="img" aria-label="Grid nada"></canvas></div></div>' +
      '<div class="pr__phclip" aria-hidden="true"><div class="pr__ph"><svg width="9" height="20" viewBox="0 0 9 20"><path d="M4.5 8.8 8.3 14 4.5 19.2.7 14z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor"/></svg><i></i></div></div>' +
    '</div>' +
    '<div class="pr__vel">' +
      '<div class="pr__velbody" id="prVelBody"><canvas class="pr__velc" role="img" aria-label="Velocity tiap nada: seret batang untuk mengubah"></canvas></div>' +
    '</div>' +
    '<button type="button" class="pr__velbtn" aria-expanded="false" aria-controls="prVelBody" aria-label="Panel Velocity" title="Buka panel Velocity">' + ICON.chev + '</button>';

  sc = el.querySelector<HTMLElement>('.pr__scroll')!;
  space = el.querySelector<HTMLElement>('.pr__space')!;
  gc = el.querySelector<HTMLCanvasElement>('.pr__grid')!;
  bgc = el.querySelector<HTMLCanvasElement>('.pr__gridbg')!;
  gclip = el.querySelector<HTMLElement>('.pr__clip')!;
  kc = el.querySelector<HTMLCanvasElement>('.pr__keys')!;
  rc = el.querySelector<HTMLCanvasElement>('.pr__ruler')!;
  btnUndo = el.querySelector<HTMLButtonElement>('[data-act="undo"]')!;
  btnRedo = el.querySelector<HTMLButtonElement>('[data-act="redo"]')!;

  // panel Velocity (buka / tutup di bawah grid)
  velPanel = el.querySelector<HTMLElement>('.pr__vel')!;
  velBtn = el.querySelector<HTMLButtonElement>('.pr__velbtn')!;
  vc = el.querySelector<HTMLCanvasElement>('.pr__velc')!;
  velBtn.addEventListener('click', () => setVelOpen(!velOpen));
  vc.addEventListener('pointerdown', onVelDown);
  vc.addEventListener('pointermove', onVelMove);
  vc.addEventListener('pointerup', onVelUp);
  vc.addEventListener('pointercancel', onVelUp);
  vc.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(() => { if (velOpen && root && !root.hidden) drawVel(); }).observe(velPanel);
  setVelOpen(velOpen);

  // menu bulat Copy / Delete / Paste yang muncul di dekat note terpilih
  phDom = el.querySelector<HTMLElement>('.pr__ph')!;
  selBar = el.querySelector<HTMLElement>('.pr__main')!.appendChild(document.createElement('div'));
  selBar.className = 'pat-bar pr__sel'; selBar.hidden = true; selBar.setAttribute('role', 'toolbar'); selBar.setAttribute('aria-label', 'Aksi nada');
  ([['copy', 'Copy', 'Salin nada (Ctrl+C)', copySelected], ['del', 'Delete', 'Hapus nada (Del)', deleteSelected], ['paste', 'Paste', 'Tempel nada (Ctrl+V)', pasteNotes], ['slide', 'Slide', 'Slide: nada sebelumnya meluncur ke nada ini', toggleSlide]] as const)
    .forEach(([act, txt, label, fn], i) => {
      const b = document.createElement('button');
      b.className = 'pat-btn'; b.type = 'button'; b.dataset.sel = act; b.textContent = txt;
      b.setAttribute('aria-label', label); b.title = label; b.style.setProperty('--i', String(i));
      b.addEventListener('click', fn);
      selBar.appendChild(b);
    });
  btnPaste = selBar.querySelector<HTMLButtonElement>('[data-sel="paste"]')!;
  btnSlide = selBar.querySelector<HTMLButtonElement>('[data-sel="slide"]')!;
  btnPaste.disabled = clip.length === 0;

  const snapBtn = el.querySelector<HTMLButtonElement>('.pr__snap')!;
  snapBtn.addEventListener('click', () => { snapOn = !snapOn; snapBtn.setAttribute('aria-pressed', String(snapOn)); });
  const acts: Record<string, () => void> = {
    undo, redo,
  };
  el.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act!]()));

  rc.addEventListener('pointerdown', onRulerDown);
  rc.addEventListener('pointermove', onRulerMove);
  rc.addEventListener('pointerup', onRulerUp);
  rc.addEventListener('pointercancel', onRulerUp);
  gc.addEventListener('pointerdown', onDown);
  gc.addEventListener('pointermove', onMove);
  gc.addEventListener('pointerup', onUp);
  gc.addEventListener('pointercancel', onUp);
  gc.addEventListener('pointerleave', () => { if (hoverP !== -1 && !g) { hoverP = -1; schedule(); } });
  kc.addEventListener('pointerdown', onKeyDown);
  kc.addEventListener('pointermove', onKeyMove);
  kc.addEventListener('pointerup', onKeyUp);
  kc.addEventListener('pointercancel', onKeyUp);
  kc.addEventListener('pointerleave', onKeyLeave);
  kc.addEventListener('contextmenu', e => e.preventDefault());
  gc.addEventListener('wheel', onWheel, {passive: false});
  gc.addEventListener('contextmenu', e => e.preventDefault());
  sc.addEventListener('scroll', scheduleScroll, {passive: true});
  new ResizeObserver(() => { if (root && !root.hidden) schedule(); }).observe(sc);

  el.querySelector('.pr__back')!.addEventListener('click', closePianoRoll);
  buildSettingsMenu(el);
  return el;
}

export function openPianoRoll(opts: PianoRollOpts, host: HTMLElement = document.querySelector('.stage') as HTMLElement) {
  if (!root) { root = build(); host.appendChild(root); }
  const key = opts.id || opts.track + '/' + opts.pattern;
  if (key !== curKey) { undoStack = []; redoStack = []; selected = new Set(); }
  pvStop();   // pindah pattern / VST: lepas nada preview yang masih bunyi
  curKey = key;
  st = states.get(key) || {notes: [], nextId: 1};
  states.set(key, st);

  trackColor = opts.color || '';
  color = noteColor || trackColor || '#3fbf5f';
  ghostSrc = opts.ghosts || [];
  root.style.setProperty('--pr-color', color);
  root.setAttribute('aria-label', opts.track + ' – ' + opts.pattern);

  const keep = !!opts.keepView && isPianoRollOpen();   // pindah antar VST saat piano roll sudah terbuka: tampilan tidak direset
  const kl = keep ? curL() : 0, kt = keep ? curT() : 0;
  root.hidden = false; void root.offsetWidth; root.classList.add('is-open');
  const vw = sc.clientWidth, vh = sc.clientHeight;
  if (!keep) { ppb = clamp(Math.floor(vw / total), 32, 96); rowH = 18; }
  applySize();
  if (keep) { sc.scrollLeft = kl; sc.scrollTop = kt; }
  else {
    const seen = st.notes.length ? st.notes : ghostSrc.flatMap(gs => states.get(gs.key)?.notes ?? []);   // belum ada nada sendiri: pusatkan ke nada instrumen lain
    const mid = seen.length ? seen.reduce((a, n) => a + n.p, 0) / seen.length : 62;   // mulai di sekitar C4
    sc.scrollLeft = 0; sc.scrollTop = Math.max(0, (P_MAX - mid) * rowH - vh / 2);
  }
  resetAnim(); selBarOn = false; selBar.hidden = true; vg = null;
  phSig = ''; keysSig = rulerSig = ''; zoomPend = null; zoomFrame = false; window.clearTimeout(zoomEndT); gridXf(''); drawn.ppb = 0; bgSig = ''; gridDirty = true;
  if (!keep) setTool('draw');
  updateUI(); redraw();
}

export function closePianoRoll() {
  if (!root || root.hidden) return;
  closeMenu(); pvStop();
  window.clearTimeout(notifyT); notifyChange();   // kirim perubahan yang masih tertunda (debounce selama drag)
  const r = root; r.classList.remove('is-open'); g = null; vg = null; ptrs.clear(); pinch = null; phStop(); phSig = ''; window.clearTimeout(zoomEndT); zoomPend = null; gridXf('');
  setTimeout(() => { if (!r.classList.contains('is-open')) r.hidden = true; }, 200);
  onClose && onClose();
}
export const getNoteColor = (): string | null => noteColor;
export function setNoteColor(c: string | null) {   // dipakai saat project dimuat; piano roll yang sedang terbuka langsung ikut
  noteColor = c || null;
  if (!isPianoRollOpen()) return;
  color = noteColor || trackColor || '#3fbf5f';
  root!.style.setProperty('--pr-color', color);
  schedule();
}
export const isPianoRollOpen = () => !!root && !root.hidden && root.classList.contains('is-open');
export const setPianoRollCloseHandler = (fn: () => void) => { onClose = fn; };

document.addEventListener('keydown', e => {
  if (!isPianoRollOpen()) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (k === 'Escape') { if (menuOpen()) closeMenu(); else closePianoRoll(); return; }
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copySelected(); return; }
  if (mod && k.toLowerCase() === 'v') { e.preventDefault(); pasteNotes(); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  if (mod) return;
  if (k === 'ArrowUp') { e.preventDefault(); nudge(0, e.shiftKey ? 12 : 1); }
  else if (k === 'ArrowDown') { e.preventDefault(); nudge(0, e.shiftKey ? -12 : -1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); nudge(-unit(), 0); }
  else if (k === 'ArrowRight') { e.preventDefault(); nudge(unit(), 0); }
  else if (k === '=' || k === '+') zoomBy(1.4, 1);
  else if (k === '-') zoomBy(1 / 1.4, 1);
  else if (k.toLowerCase() === 'b') setTool('draw');
  else if (k.toLowerCase() === 'v') setTool('select');
  else if (k.toLowerCase() === 'e') setTool('erase');
  else if (k.toLowerCase() === 'h') setTool('pan');
});
