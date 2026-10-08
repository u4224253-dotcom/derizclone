// CUTE: plugin pemotong audio.
//   canvas waveform + seleksi (seret untuk memilih, seret tepi untuk mengubah), Play / Pause, drag and drop file audio, dan tombol tutup.
//   Tahap 2: ikon grip di header = seret hasil seleksi (atau seluruh audio kalau tidak ada seleksi) ke plugin DERIZ (jadi sample) atau ke timeline (jadi track Audio clip).
// Kartunya ada di halaman Plugin pada panel efek (fx-rack.ts); jendelanya dibuka dari kartu itu. Gaya: saudara DERIZ (faceplate miring 3D, layar kaca, LED) tapi bahan "enamel teal" bertepi bevel tebal, judul timbul, tombol cembung.

import { ACCEPT as AUDIO_ACCEPT, isAudio } from './audio-upload-card';
import { encodeWavFloatMulti } from './wav';
import { dragWindow } from './win-drag';

const svg = (inner: string, size = 18): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICON = {
  up: svg('<path d="M12 16V5M7 10l5-5 5 5M5 19h14"/>', 22),
  play: svg('<path d="M8 5l12 7-12 7z" fill="currentColor" stroke="none"/>', 22),
  pause: svg('<rect x="6" y="5" width="4.5" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2" fill="currentColor" stroke="none"/>', 22),
  zout: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6"/>', 18),
  zin: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6M11 8v6"/>', 18),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 12),
  drag: svg('<circle cx="9" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.7" fill="currentColor" stroke="none"/>', 14)
};

interface Peaks { mn: Float32Array; mx: Float32Array; norm: number }
interface Session { name: string; dur: number; buf: AudioBuffer; pk: Peaks }
interface Sel { a: number; b: number }   // detik, a < b

// min / max per bucket (semua channel digabung), dihitung sekali saat audio dimuat; dinormalkan ke puncak supaya rekaman pelan tetap terlihat bentuknya
function buildPeaks(buf: AudioBuffer): Peaks {
  const n = buf.length, nb = Math.max(1, Math.min(n, 8192)), per = n / nb;
  const chs = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const mn = new Float32Array(nb), mx = new Float32Array(nb);
  let peak = 0;
  for (let b = 0; b < nb; b++) {
    const s = Math.floor(b * per), e = Math.max(s + 1, Math.floor((b + 1) * per)), st = Math.max(1, Math.floor((e - s) / 64));
    let lo = 1, hi = -1;
    for (const d of chs) for (let i = s; i < e && i < n; i += st) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo > hi) { lo = 0; hi = 0; }
    mn[b] = lo; mx[b] = hi; peak = Math.max(peak, -lo, hi);
  }
  return { mn, mx, norm: peak > 1e-4 ? 1 / peak : 1 };
}

const fmt = (t: number): string => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
};
const niceStep = (raw: number): number => {   // jarak garis grid waktu yang enak dibaca (1, 2, 5 x 10^n detik)
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-3)))), r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
};

let root: HTMLElement | null = null, openFn: (() => void) | null = null;

// Dibuka dari kartu CUTE di panel efek (fx-rack.ts)
export function openCute(): void {
  if (!root) build();
  openFn?.();
}

function build(): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'cute'; el.hidden = true;
  el.innerHTML =
    '<div class="cute__back"></div>' +
    '<div class="cute__win is-off" role="dialog" aria-modal="true" aria-label="CUTE" tabindex="-1">' +
      `<header class="cute__head"><i class="cute__led" aria-hidden="true"></i><span class="cute__title">CUTE</span><div class="cute__lcd"><span class="cute__stat" role="status" aria-live="polite"></span></div>` +
        `<button type="button" class="cute__drag" aria-label="Seret hasil ke timeline" title="Seret hasil ke timeline (segera hadir)" disabled>${ICON.drag}</button>` +
        `<button type="button" class="cute__close" aria-label="Tutup CUTE">${ICON.close}</button></header>` +
      '<div class="cute__mid"><div class="cute__stage">' +
        '<canvas class="cute__cv" role="img" aria-label="Waveform audio. Seret untuk memilih bagian"></canvas>' +
        `<button type="button" class="cute__drop">${ICON.up}<span>Drop audio di sini</span><small>atau ketuk untuk memilih file</small></button>` +
      '</div></div>' +
      `<div class="cute__bar"><button type="button" class="cute__zbtn" data-z="out" aria-label="Zoom out" title="Zoom out (-)" disabled>${ICON.zout}</button><button type="button" class="cute__play" aria-label="Putar" disabled>${ICON.play}</button><button type="button" class="cute__zbtn" data-z="in" aria-label="Zoom in" title="Zoom in (+)" disabled>${ICON.zin}</button></div>` +
      '<div class="cute__glass" aria-hidden="true"></div>' +
      `<input type="file" class="cute__file" accept="${AUDIO_ACCEPT}" hidden>` +
    '</div>';
  document.body.appendChild(el);
  dragWindow({ root: el, move: el.querySelector<HTMLElement>('.cute__win')!, handle: '.cute__head' });   // jendela bisa digeser lewat header
  root = el;

  const win = el.querySelector<HTMLElement>('.cute__win')!;
  const stat = el.querySelector<HTMLElement>('.cute__stat')!;
  const stage = el.querySelector<HTMLElement>('.cute__stage')!;
  const cv = el.querySelector<HTMLCanvasElement>('.cute__cv')!;
  const drop = el.querySelector<HTMLButtonElement>('.cute__drop')!;
  const playBtn = el.querySelector<HTMLButtonElement>('.cute__play')!;
  const dragBtn = el.querySelector<HTMLButtonElement>('.cute__drag')!;
  const zOut = el.querySelector<HTMLButtonElement>('[data-z="out"]')!, zIn = el.querySelector<HTMLButtonElement>('[data-z="in"]')!;
  const file = el.querySelector<HTMLInputElement>('.cute__file')!;
  const g = cv.getContext('2d')!;

  let S: Session | null = null, sel: Sel | null = null, W = 0, H = 0, dpr = 1;
  let ac: AudioContext | null = null, src: AudioBufferSourceNode | null = null, playing = false, playPos = 0, t0 = 0, endAt = 0, raf = 0;
  let loadTok = 0, statT = 0;
  let vs = 0, ve = 0, viewRaf = 0;   // jendela tampilan (detik): bagian audio yang terlihat di canvas; zoom = mengecilkan rentang ini

  // ---------- efek 3D: jendela miring tipis mengikuti kursor (mouse saja, mati di atas canvas / saat drag / reduced-motion), kilau mengikuti arah cahaya ----------
  const untilt = (): void => { win.classList.remove('is-tilting'); win.style.setProperty('--rx', '0deg'); win.style.setProperty('--ry', '0deg'); win.style.setProperty('--mx', '50%'); win.style.setProperty('--my', '0%'); };
  el.addEventListener('pointermove', e => {
    if (reduce || e.pointerType !== 'mouse') return;
    if (e.buttons || (e.target as Element).closest('.cute__stage')) { untilt(); return; }
    const r = win.getBoundingClientRect(), px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    win.classList.add('is-tilting');
    win.style.setProperty('--ry', ((px - .5) * 5).toFixed(2) + 'deg'); win.style.setProperty('--rx', ((.5 - py) * 4).toFixed(2) + 'deg');
    win.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); win.style.setProperty('--my', (py * 100).toFixed(1) + '%');
  });
  el.addEventListener('pointerleave', untilt);

  // ---------- status (layar LCD) ----------
  const info = (): void => {
    if (!S) { stat.textContent = 'Belum ada audio'; return; }
    stat.textContent = sel ? fmt(sel.a) + ' – ' + fmt(sel.b) + '  (' + (sel.b - sel.a).toFixed(2) + ' s)' : S.name + ' · ' + fmt(S.dur);
  };
  const flash = (msg: string): void => { stat.textContent = msg; clearTimeout(statT); statT = window.setTimeout(info, 2200); };

  // ---------- gambar ----------
  const xOf = (t: number): number => (S ? ((t - vs) / (ve - vs)) * W : 0);
  const tOf = (x: number): number => (S ? Math.max(0, Math.min(S.dur, vs + (x / W) * (ve - vs))) : 0);

  // ---------- zoom & geser tampilan ----------
  const minSpan = (): number => (S ? Math.min(S.dur, 0.02) : 0);   // zoom terdalam: 20 ms selebar canvas
  const clampView = (a: number, b: number): [number, number] => {
    if (!S) return [0, 0];
    const sp = Math.max(minSpan(), Math.min(S.dur, b - a)), na = Math.max(0, Math.min(S.dur - sp, a));
    return [na, na + sp];
  };
  const syncZ = (): void => {
    const on = !!S, sp = ve - vs;
    zOut.disabled = !on || sp >= (S ? S.dur : 0) - 1e-6; zIn.disabled = !on || sp <= minSpan() + 1e-6;
  };
  function setView(a: number, b: number): void { [vs, ve] = clampView(a, b); syncZ(); draw(); }
  function tweenView(a: number, b: number): void {   // zoom lewat tombol / pintasan: transisi halus ~180 ms
    cancelAnimationFrame(viewRaf);
    [a, b] = clampView(a, b);
    if (reduce) { setView(a, b); return; }
    const a0 = vs, b0 = ve, tt = performance.now();
    const step = (now: number): void => { const u = Math.min(1, (now - tt) / 180), k = 1 - Math.pow(1 - u, 3); setView(a0 + (a - a0) * k, b0 + (b - b0) * k); if (u < 1) viewRaf = requestAnimationFrame(step); };
    viewRaf = requestAnimationFrame(step);
  }
  const zoomAt = (fx: number, k: number, smooth: boolean): void => {   // fx: posisi 0..1 di canvas yang dijaga diam; k: rentang baru / lama
    if (!S) return;
    const sp0 = ve - vs, sp = Math.max(minSpan(), Math.min(S.dur, sp0 * k)), tc = vs + fx * sp0, a = tc - fx * sp;
    if (smooth) tweenView(a, a + sp); else { cancelAnimationFrame(viewRaf); setView(a, a + sp); }
  };
  const zoomStep = (k: number): void => {
    if (!S) return;
    zoomAt(.5, k, true);
    const z = S.dur / Math.max(minSpan(), Math.min(S.dur, (ve - vs) * k)); flash('Zoom ' + (z < 10 ? z.toFixed(1) : Math.round(z)) + '×');
  };
  zOut.addEventListener('click', () => zoomStep(2)); zIn.addEventListener('click', () => zoomStep(.5));

  function layout(): void {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(1, stage.clientWidth); H = Math.max(1, stage.clientHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    draw();
  }
  const ro = new ResizeObserver(() => { if (!el.hidden) layout(); });
  ro.observe(stage);

  function draw(): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!S) return;
    const mid = H / 2, amp = H / 2 - 8;
    // grid waktu
    const span = ve - vs, step = niceStep(span / Math.max(2, W / 90)), dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9));
    g.font = '600 9px system-ui,sans-serif'; g.textBaseline = 'bottom';
    for (let i = Math.ceil(vs / step - 1e-9); i * step <= ve + 1e-6; i++) {
      const t = i * step, x = Math.round(xOf(t)) + .5, f = fmt(t);
      g.fillStyle = 'rgba(148,170,210,.1)'; g.fillRect(x - .5, 0, 1, H);
      g.fillStyle = 'rgba(138,154,181,.8)'; g.fillText(t >= 60 ? f.slice(0, f.length - (dec ? 3 - dec : 4)) : t.toFixed(dec) + 's', x + 4, H - 3 - (span < S.dur - 1e-6 ? 5 : 0));
    }
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(0, Math.round(mid), W, 1);
    // waveform: satu polygon solid (sisi atas kiri->kanan, sisi bawah kanan->kiri)
    const { mn, mx, norm } = S.pk, nb = mn.length, cols = Math.max(1, Math.floor(W)), sr = S.buf.sampleRate, ns = S.buf.length;
    const fine = (span / cols) * sr < (ns / nb) * 1.5;   // tampilan sudah lebih rapat dari bucket puncak: baca langsung dari sampel supaya tetap tajam saat di-zoom
    const ab = S.buf, chs = fine ? Array.from({ length: ab.numberOfChannels }, (_, c) => ab.getChannelData(c)) : null;
    const tops = new Float32Array(cols), bots = new Float32Array(cols);
    for (let x = 0; x < cols; x++) {
      let lo = 1, hi = -1;
      if (chs) {
        const s0 = Math.max(0, Math.floor((vs + (x / cols) * span) * sr)), e0 = Math.min(ns, Math.max(s0 + 1, Math.ceil((vs + ((x + 1) / cols) * span) * sr))), st = Math.max(1, Math.floor((e0 - s0) / 32));
        for (const d of chs) for (let i = s0; i < e0; i += st) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (lo > hi) { lo = 0; hi = 0; }
      } else {
        const f0 = ((vs + (x / cols) * span) / S.dur) * nb, f1 = ((vs + ((x + 1) / cols) * span) / S.dur) * nb;
        const b0 = Math.min(nb - 1, Math.max(0, Math.floor(f0))), b1 = Math.min(nb - 1, Math.max(b0, Math.ceil(f1) - 1));
        for (let b = b0; b <= b1; b++) { if (mn[b] < lo) lo = mn[b]; if (mx[b] > hi) hi = mx[b]; }
      }
      tops[x] = mid - Math.max(hi * norm, 0.004) * amp; bots[x] = mid - Math.min(lo * norm, -0.004) * amp;
    }
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#9af5e6'); grad.addColorStop(.5, '#5eead4'); grad.addColorStop(1, '#9af5e6');
    g.fillStyle = grad; g.globalAlpha = sel ? .62 : 1;
    g.beginPath(); g.moveTo(0, bots[0]);
    for (let x = 0; x < cols; x++) g.lineTo(x + .5, bots[x]);
    for (let x = cols - 1; x >= 0; x--) g.lineTo(x + .5, tops[x]);
    g.closePath(); g.fill(); g.globalAlpha = 1;
    // seleksi: bagian terpilih menyala, tepi putih dengan pegangan kecil
    if (sel) {
      const x1 = xOf(sel.a), x2 = xOf(sel.b);
      g.fillStyle = 'rgba(94,234,212,.16)'; g.fillRect(x1, 0, x2 - x1, H);
      g.save(); g.beginPath(); g.rect(x1, 0, x2 - x1, H); g.clip(); g.fillStyle = grad; g.globalAlpha = .55;
      g.beginPath(); g.moveTo(0, bots[0]);
      for (let x = 0; x < cols; x++) g.lineTo(x + .5, bots[x]);
      for (let x = cols - 1; x >= 0; x--) g.lineTo(x + .5, tops[x]);
      g.closePath(); g.fill(); g.restore();
      g.fillStyle = '#5eead4'; g.fillRect(x1 - 1, 0, 2, H); g.fillRect(x2 - 1, 0, 2, H);
      for (const x of [x1, x2]) { g.beginPath(); g.roundRect(x - 4, mid - 12, 8, 24, 3); g.fill(); }
    }
    // playhead
    const px = Math.round(xOf(playPos));
    if (px >= -6 && px <= W + 6) {
      g.fillStyle = '#fff'; g.shadowColor = 'rgba(255,255,255,.6)'; g.shadowBlur = 4; g.fillRect(px - 1, 0, 2, H); g.shadowBlur = 0;
      g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.closePath(); g.fill();
    }
    // bilah geser (hanya saat di-zoom): posisi + lebar jendela tampilan terhadap seluruh audio
    if (span < S.dur - 1e-6) {
      const tw = Math.max(24, (span / S.dur) * W), tx = (vs / S.dur) * W;
      g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.roundRect(0, H - 6, W, 3, 1.5); g.fill();
      g.fillStyle = 'rgba(154,245,230,.7)'; g.beginPath(); g.roundRect(Math.min(W - tw, tx), H - 7, tw, 5, 2.5); g.fill();
    }
  }

  // ---------- seleksi di canvas ----------
  type Drag = { kind: 'new'; anchor: number; x0: number } | { kind: 'edge'; fixed: number } | { kind: 'pan' };
  let drag: Drag | null = null;
  const EDGE = 11;   // px: jarak sentuh ke tepi seleksi untuk mengubah ukurannya
  const localX = (e: PointerEvent): number => e.clientX - cv.getBoundingClientRect().left;
  const nearEdge = (x: number): 'a' | 'b' | null => {
    if (!sel) return null;
    const da = Math.abs(x - xOf(sel.a)), db = Math.abs(x - xOf(sel.b));
    if (Math.min(da, db) > EDGE) return null;
    return da <= db ? 'a' : 'b';
  };
  cv.style.touchAction = 'none';
  const SB_H = 14;   // px: tinggi area bilah geser di dasar canvas
  const pts = new Map<number, number>();   // jari / pointer yang sedang menyentuh canvas (id -> x), untuk pinch zoom
  let pinch: { d0: number; tc: number; sp: number } | null = null, selBackup: Sel | null = null, panGrab = 0;
  const panTo = (x: number): void => { if (!S) return; const sp = ve - vs; setView((x / W) * S.dur, (x / W) * S.dur + sp); };
  cv.addEventListener('pointerdown', e => {
    if (!S) return;
    const x = localX(e);
    pts.set(e.pointerId, x); cv.setPointerCapture(e.pointerId); e.preventDefault();
    if (pts.size === 2) {   // dua jari: pinch untuk zoom sekaligus geser; seleksi yang baru dimulai dibatalkan
      if (drag) { sel = selBackup; drag = null; }
      const [a, b] = [...pts.values()];
      pinch = { d0: Math.max(10, Math.abs(a - b)), tc: tOf((a + b) / 2), sp: ve - vs };
      cancelAnimationFrame(viewRaf); draw(); info(); return;
    }
    if (pts.size > 2) return;
    cancelAnimationFrame(viewRaf);
    if (ve - vs < S.dur - 1e-6 && e.clientY - cv.getBoundingClientRect().top > H - SB_H) {   // bilah geser di dasar
      const tw = Math.max(24, ((ve - vs) / S.dur) * W), tx = (vs / S.dur) * W;
      panGrab = x >= tx && x <= tx + tw ? x - tx : tw / 2;
      drag = { kind: 'pan' }; panTo(x - panGrab); return;
    }
    const edge = nearEdge(x);
    if (playing) pausePlay();   // memilih bagian baru menghentikan putar (posisi tetap)
    selBackup = sel;
    if (edge && sel) drag = { kind: 'edge', fixed: edge === 'a' ? sel.b : sel.a };
    else drag = { kind: 'new', anchor: tOf(x), x0: x };
  });
  cv.addEventListener('pointermove', e => {
    if (!S) return;
    const x = localX(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, x);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.max(10, Math.abs(a - b)), sp = Math.max(minSpan(), Math.min(S.dur, (pinch.sp * pinch.d0) / d)), na = pinch.tc - (((a + b) / 2) / W) * sp;
      setView(na, na + sp); return;
    }
    if (!drag) { cv.style.cursor = nearEdge(x) ? 'ew-resize' : 'crosshair'; return; }
    if (drag.kind === 'pan') { panTo(x - panGrab); return; }
    const t = tOf(x);
    if (drag.kind === 'new') { if (Math.abs(x - drag.x0) < 4 && !sel) return; sel = { a: Math.min(drag.anchor, t), b: Math.max(drag.anchor, t) }; }
    else sel = { a: Math.min(drag.fixed, t), b: Math.max(drag.fixed, t) };
    draw(); info();
  });
  const endDrag = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }   // jari yang tersisa setelah pinch tidak memulai seleksi
    if (!drag || !S) { drag = null; return; }
    const d = drag; drag = null;
    if (d.kind === 'pan') return;
    if (d.kind === 'new' && Math.abs(localX(e) - d.x0) < 4) { sel = null; playPos = d.anchor; }   // ketukan biasa: hapus seleksi dan taruh titik start di situ
    else if (sel && sel.b - sel.a < 0.01) { sel = null; }   // terlalu pendek: dianggap batal
    if (sel) playPos = Math.max(sel.a, Math.min(sel.b, playPos < sel.a || playPos > sel.b ? sel.a : playPos));
    draw(); info();
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  // roda mouse / trackpad: gulir = zoom di sekitar kursor; Shift atau gulir mendatar = geser kiri-kanan; Ctrl (pinch trackpad) = zoom lebih cepat
  cv.addEventListener('wheel', e => {
    if (!S) return;
    e.preventDefault(); cancelAnimationFrame(viewRaf);
    const sp = ve - vs, px = e.deltaMode === 1 ? 16 : 1;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (((e.deltaX || e.deltaY) * px) / W) * sp; setView(vs + d, ve + d); return; }
    zoomAt((e.clientX - cv.getBoundingClientRect().left) / W, Math.exp(e.deltaY * px * (e.ctrlKey ? 0.006 : 0.002)), false);
  }, { passive: false });

  // ---------- putar / jeda (seleksi kalau ada, kalau tidak seluruh audio) ----------
  const setPlayUi = (on: boolean): void => {
    playBtn.classList.toggle('is-on', on); win.classList.toggle('is-off', !on);
    playBtn.innerHTML = on ? ICON.pause : ICON.play; playBtn.setAttribute('aria-label', on ? 'Jeda' : 'Putar');
  };
  function stopSource(): void {
    if (src) { src.onended = null; try { src.stop(); } catch { /* sudah berhenti */ } src.disconnect(); src = null; }
    cancelAnimationFrame(raf);
  }
  async function startPlay(): Promise<void> {
    if (!S || playing) return;
    ac ??= new AudioContext();
    if (ac.state === 'suspended') await ac.resume().catch(() => { /* abaikan */ });
    const lo = sel ? sel.a : 0, hi = sel ? sel.b : S.dur;
    let from = playPos; if (from < lo || from >= hi - 0.005) from = lo;
    playPos = from; endAt = hi;
    src = ac.createBufferSource(); src.buffer = S.buf; src.connect(ac.destination);
    t0 = ac.currentTime - from;
    src.onended = () => { if (!playing) return; stopSource(); playing = false; playPos = lo; setPlayUi(false); draw(); };
    src.start(0, from, hi - from);
    playing = true; setPlayUi(true);
    const tick = (): void => { if (!playing || !ac) return; playPos = Math.min(endAt, ac.currentTime - t0); if (S && ve - vs < S.dur - 1e-6 && (playPos > ve || playPos < vs)) { const sp = ve - vs; [vs, ve] = clampView(playPos - sp * .1, playPos - sp * .1 + sp); }   // sedang di-zoom: tampilan ikut pindah saat playhead keluar layar
      draw(); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  function pausePlay(): void {
    if (!playing || !ac) return;
    playPos = Math.min(endAt, ac.currentTime - t0);
    playing = false; stopSource(); setPlayUi(false); draw();
  }
  const stopPlay = (): void => { if (playing) pausePlay(); };
  playBtn.addEventListener('click', () => { if (playing) pausePlay(); else void startPlay(); });

  // ---------- muat audio: tombol / drag and drop ----------
  async function load(f: File): Promise<void> {
    if (!isAudio(f)) { drop.classList.remove('is-shake'); void drop.offsetWidth; drop.classList.add('is-shake'); flash('Bukan file audio'); return; }
    const tok = ++loadTok;
    stat.textContent = 'Memuat audio…';
    try {
      ac ??= new AudioContext();
      const buf = await ac.decodeAudioData(await f.arrayBuffer());
      if (tok !== loadTok) return;
      stopPlay(); stopSource();
      S = { name: f.name.replace(/\.[^.]+$/, ''), dur: buf.duration, buf, pk: buildPeaks(buf) };
      sel = null; playPos = 0; playing = false; setPlayUi(false); vs = 0; ve = S.dur; pts.clear(); pinch = null; syncZ();
      playBtn.disabled = false; dragBtn.disabled = false; drop.hidden = true;
      cv.style.cursor = 'crosshair';
      layout(); info();
    } catch (err) { console.error(err); if (tok === loadTok) flash('Gagal membaca audio'); }
  }
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) void load(f); });
  el.addEventListener('dragover', e => { e.preventDefault(); win.classList.add('is-drop'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget as Node | null)) win.classList.remove('is-drop'); });
  el.addEventListener('drop', e => { e.preventDefault(); win.classList.remove('is-drop'); const f = e.dataTransfer?.files[0]; if (f) void load(f); });

  // ---------- seret hasil seleksi ke plugin DERIZ / timeline ----------
  // Sama seperti MPCS: tahan ikon grip, jendela CUTE disembunyikan, hanya ikon yang melayang. Lepas di atas kanvas DERIZ = potongan jadi sample DERIZ;
  // lepas di atas timeline = jadi track Audio clip baru. Keduanya lewat event yang sama dengan MPCS ('mpcs-sample' / 'mpcs-audioclip', ditangkap fx-rack.ts / main.ts).
  const LIFT = 38;   // di layar sentuh ikon melayang di atas jari supaya tidak tertutup; titik jatuhnya = posisi ikon
  const FADE = 0.003;   // detik: fade pendek di tepi potongan supaya tidak ada klik saat memotong di tengah gelombang
  let dg: { id: number; x0: number; y0: number; touch: boolean; ghost: HTMLElement | null; over: HTMLElement | null; file: File | null } | null = null;

  // potongan seleksi (atau seluruh audio kalau tidak ada seleksi) -> file WAV float, semua channel dipertahankan
  function makeCut(): File | null {
    if (!S) return null;
    const b = S.buf, sr = b.sampleRate, n = b.length;
    const i0 = sel ? Math.max(0, Math.min(n - 1, Math.round(sel.a * sr))) : 0;
    const i1 = sel ? Math.max(i0 + 1, Math.min(n, Math.round(sel.b * sr))) : n;
    const len = i1 - i0, fade = sel ? Math.min(Math.floor(FADE * sr), len >> 1) : 0;
    const chs: Float32Array[] = [];
    for (let c = 0; c < b.numberOfChannels; c++) {
      const out = b.getChannelData(c).slice(i0, i1);
      for (let k = 0; k < fade; k++) { const g2 = k / fade; out[k] *= g2; out[len - 1 - k] *= g2; }
      chs.push(out);
    }
    return new File([encodeWavFloatMulti(chs, sr)], S.name + (sel ? '-CUTE' : '') + '.wav', { type: 'audio/wav' });
  }
  const stageAt = (x: number, y: number): HTMLElement | null => {
    for (const n of document.elementsFromPoint(x, y)) { if (n.closest('.cute')) continue; return n.closest<HTMLElement>('.deriz__stage') ?? n.closest<HTMLElement>('.workspace'); }   // elemen pertama di bawah CUTE: kanvas DERIZ = jadi sample, timeline = jadi track audio clip baru
    return null;
  };
  function dgMove(e: PointerEvent): void {
    if (!dg || e.pointerId !== dg.id) return;
    if (!dg.ghost) {
      if (Math.hypot(e.clientX - dg.x0, e.clientY - dg.y0) < 8) return;   // di bawah 8 px = ketukan biasa, jendela belum disembunyikan
      stopPlay();
      const gh = document.createElement('div'); gh.className = 'cute__ghost'; gh.innerHTML = ICON.drag; document.body.appendChild(gh);
      dg.ghost = gh; el.classList.add('is-dragout');
      dg.file = makeCut();
    }
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY - (dg.touch ? LIFT : 0) };
    dg.ghost.style.transform = `translate(${p.x - 20}px,${p.y - 20}px)`;
    const s = stageAt(p.x, p.y);
    if (s !== dg.over) { dg.over?.classList.remove('is-over'); s?.classList.add('is-over'); dg.over = s; dg.ghost.classList.toggle('is-hot', !!s); }
  }
  function dgEnd(e: PointerEvent): void {
    if (!dg || e.pointerId !== dg.id) return;
    const d = dg; dg = null;
    window.removeEventListener('pointermove', dgMove); window.removeEventListener('pointerup', dgEnd); window.removeEventListener('pointercancel', dgEnd);
    if (!d.ghost) { flash('Tahan lalu seret ke DERIZ / timeline'); return; }   // ketukan tanpa geser
    d.over?.classList.remove('is-over');
    const p = { x: e.clientX, y: e.clientY - (d.touch ? LIFT : 0) }, target = e.type === 'pointerup' ? stageAt(p.x, p.y) : null;
    d.ghost.remove(); el.classList.remove('is-dragout');
    if (!target) { flash('Lepas di atas plugin DERIZ atau timeline'); return; }   // jatuh di tempat lain: jendela kembali
    if (!d.file || !target.isConnected) { flash(d.file ? 'Plugin DERIZ sudah tidak ada' : 'Gagal memotong'); return; }
    if (target.classList.contains('workspace')) document.dispatchEvent(new CustomEvent('mpcs-audioclip', { detail: { file: d.file, x: p.x } }));   // timeline: main.ts bikin track Audio clip baru, clip diletakkan di bar tempat dilepas
    else target.dispatchEvent(new CustomEvent('mpcs-sample', { bubbles: true, detail: { file: d.file } }));
    stopPlay(); el.hidden = true;   // hasil sudah terpasang: CUTE ditutup supaya terlihat
  }
  dragBtn.addEventListener('pointerdown', e => {
    if (!S || dragBtn.disabled || dg) return;
    e.preventDefault();
    dg = { id: e.pointerId, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', ghost: null, over: null, file: null };
    window.addEventListener('pointermove', dgMove, { passive: false }); window.addEventListener('pointerup', dgEnd); window.addEventListener('pointercancel', dgEnd);
  });

  // ---------- buka / tutup ----------
  el.addEventListener('keydown', e => {
    e.stopPropagation();   // pintasan DAW (Space, tuts keyboard) tidak ikut jalan selagi CUTE terbuka
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.key === '+' || e.key === '=') && S) { e.preventDefault(); zoomStep(.5); return; }
    if ((e.key === '-' || e.key === '_') && S) { e.preventDefault(); zoomStep(2); return; }
    if (e.key === ' ' && !(e.target as Element).closest?.('button') && S) { e.preventDefault(); if (playing) pausePlay(); else void startPlay(); }
  });
  el.addEventListener('keyup', e => e.stopPropagation());
  el.querySelector('.cute__close')!.addEventListener('click', () => close());
  el.querySelector('.cute__back')!.addEventListener('pointerdown', () => close());

  function close(): void {
    stopPlay();
    const done = (): void => { el.hidden = true; };
    if (reduce) { done(); return; }
    el.querySelector('.cute__back')!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    win.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => { done(); el.getAnimations({ subtree: true }).forEach(a => a.cancel()); };
  }
  openFn = () => {
    if (!el.hidden) return;
    el.getAnimations({ subtree: true }).forEach(a => a.cancel());
    el.hidden = false; drop.hidden = !!S;
    layout(); info();
    if (!reduce) win.animate([{ opacity: 0, transform: 'translateY(14px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.3,.64,1)' });
    win.focus({ preventScroll: true });
  };
}
