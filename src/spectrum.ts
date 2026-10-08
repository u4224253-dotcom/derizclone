// SPECTRUM: gelombang suara langsung (scope), dinyalakan dari Pengaturan (menu kanan atas), bukan plugin. Membaca keluaran master (persis yang terdengar), jadi apa pun yang diputar ikut tergambar.
//   Kiri  : riwayat amplitudo yang bergulir (isi solid lavender tanpa outline, ekor pluck meluruh halus)
//   Kanan : gelombang NYATA beberapa siklus terakhir, dikunci ke periode nada (nada rendah = lebar, tinggi = rapat) dan dikunci fase supaya diam di layar
// Semua hitungan ada di spectrum-dsp.ts (murni, ada tesnya: tools/spectrum-test.ts); file ini hanya jendela + menggambar.
// Saklar nyala/mati + pilihan kecepatan ada di Pengaturan (menu-panel.ts). Tampil sebagai strip polos selebar layar yang menempel di dasar (tanpa bingkai / tombol); tidak modal, jadi Space / pintasan DAW tetap jalan.

import { PitchDetector, PitchTracker, TraceBuilder, Envelope, AutoGain, shape, clamp } from './spectrum-dsp';

export interface SpectrumBridge { tap(): AudioNode | null }   // titik ambil audio: keluaran master (guardOut di main.ts)
let bridge: SpectrumBridge | null = null;
export const setSpectrumBridge = (b: SpectrumBridge): void => { bridge = b; };

const FFT = 4096;                 // jendela baca ~85 ms: cukup untuk 2 siklus nada 25 Hz
const SPLIT = 0.5;                // riwayat (kiri) dan scope langsung (kanan) masing-masing separuh lebar
const STEP = 0.5;                 // jarak titik gambar riwayat (px CSS): halus di layar HP beresolusi tinggi
export const SPECTRUM_SPEEDS = [{ k: 'slow', label: 'Lambat', pps: 90 }, { k: 'mid', label: 'Normal', pps: 170 }, { k: 'fast', label: 'Cepat', pps: 320 }];   // px per detik
const SPEEDS = SPECTRUM_SPEEDS;
const SPEED_KEY = 'derizmp3.spectrum.speed', ON_KEY = 'derizmp3.spectrum.on';
const FILL = '#b3a1f7', OUTLINE = '#f4f0ff';   // riwayat = isi solid tanpa outline; scope langsung = garis saja tanpa isi (tanpa gradasi / glow)

let root: HTMLElement | null = null, openFn: (() => void) | null = null, closeFn: (() => void) | null = null;
let speed = 1, on = false;   // kecepatan gulir riwayat (indeks SPEEDS; bawaan Normal) dan status nyala (bawaan MATI), keduanya diingat di browser
try { const k = localStorage.getItem(SPEED_KEY), i = SPEEDS.findIndex(s => s.k === k); if (i >= 0) speed = i; } catch { /* penyimpanan diblokir: bawaan Normal */ }
try { on = localStorage.getItem(ON_KEY) === '1'; } catch { /* penyimpanan diblokir: bawaan mati */ }

export const getSpectrumSpeed = (): string => SPEEDS[speed].k;
export function setSpectrumSpeed(k: string, save = true): void {
  const i = SPEEDS.findIndex(s => s.k === k); if (i < 0) return;
  speed = i;
  if (save) { try { localStorage.setItem(SPEED_KEY, SPEEDS[i].k); } catch { /* abaikan */ } }
}
export const isSpectrumOn = (): boolean => on;
export function setSpectrumOn(v: boolean, save = true): void {
  on = v;
  if (save) { try { localStorage.setItem(ON_KEY, v ? '1' : '0'); } catch { /* abaikan */ } }
  if (v) { if (!root) build(); openFn?.(); } else closeFn?.();
}
// Dipanggil sekali saat aplikasi mulai: kalau tersimpan NYALA, strip muncul setelah gerakan pertama pengguna (AudioContext baru boleh dibuat setelah itu)
export function restoreSpectrum(): void {
  if (!on) return;
  if (navigator.userActivation?.hasBeenActive) { setSpectrumOn(true, false); return; }
  const go = (): void => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (on) setSpectrumOn(true, false); };
  addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
}

function build(): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = 'spec'; el.hidden = true;
  el.innerHTML =
    '<div class="spec__win" role="img" aria-label="SPECTRUM: gelombang suara langsung dari keluaran master">' +
      '<div class="spec__stage"><canvas class="spec__cv" aria-hidden="true"></canvas></div>' +
    '</div>';
  document.body.appendChild(el);
  root = el;

  const win = el.querySelector<HTMLElement>('.spec__win')!;
  const stage = el.querySelector<HTMLElement>('.spec__stage')!;
  const cv = el.querySelector<HTMLCanvasElement>('.spec__cv')!;
  const g = cv.getContext('2d')!;

  // ---------- audio: analyser di keluaran master ----------
  let ctx: BaseAudioContext | null = null, an: AnalyserNode | null = null, mute: GainNode | null = null, tapNode: AudioNode | null = null;
  const buf = new Float32Array(FFT);
  let sr = 48000;
  let env = new Envelope(sr), det = new PitchDetector(FFT), trk = new PitchTracker(), tb = new TraceBuilder(FFT, 64);
  const gainH = new AutoGain(6), gainL = new AutoGain(1.2, 0.02);   // riwayat: turun lambat (6 s); scope: lebih cepat menyesuaikan (1,2 s)
  let trace = new Float32Array(64), prevTrace = new Float32Array(64), traceOk = false;
  let clk = 0, lastClk = 0, carry = 0, lastPitch = 0;

  function connect(): boolean {
    const src = bridge?.tap() ?? null;
    if (!src) return false;
    ctx = src.context;
    if (!an || an.context !== ctx) {
      an = ctx.createAnalyser(); an.fftSize = FFT; an.smoothingTimeConstant = 0;
      mute = ctx.createGain(); mute.gain.value = 0; an.connect(mute); mute.connect(ctx.destination);   // sambungan senyap: beberapa browser baru memproses node yang tersambung ke output
    }
    if (sr !== ctx.sampleRate) { sr = ctx.sampleRate; env = new Envelope(sr); }
    try { src.connect(an); tapNode = src; } catch { return false; }
    return true;
  }
  function disconnect(): void {
    if (tapNode && an) { try { tapNode.disconnect(an); } catch { /* sudah lepas */ } }
    tapNode = null;
  }
  function resetState(): void {
    env.clear(); gainH.reset(); gainL.reset(); trk.reset(); prevTrace.fill(0); trace.fill(0); traceOk = false;
    carry = 0; lastPitch = 0;
    clk = lastClk = ctx ? ctx.currentTime : 0;
  }

  // ---------- ukuran kanvas ----------
  let W = 0, H = 0, dpr = 1, tops = new Float32Array(0), bots = new Float32Array(0);
  function layout(): void {
    dpr = Math.min(3, devicePixelRatio || 1);
    W = Math.max(1, stage.clientWidth); H = Math.max(1, stage.clientHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const xs = Math.round(W * SPLIT), m = clamp(Math.round((W - xs) / 1.5), 48, 400);
    if (trace.length !== m) { trace = new Float32Array(m); prevTrace = new Float32Array(m); tb = new TraceBuilder(FFT, m); traceOk = false; }
    const np = Math.ceil(xs / STEP) + 1;
    if (tops.length !== np) { tops = new Float32Array(np); bots = new Float32Array(np); }
    if (!el.hidden) draw();
  }
  const ro = new ResizeObserver(() => { if (!el.hidden) layout(); });
  ro.observe(stage);

  // ---------- gambar ----------
  function draw(): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const mid = H / 2, amp = H / 2 - 7, xs = Math.round(W * SPLIT), live = W - xs, np = tops.length;
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, Math.round(mid), W, 1);

    // riwayat: posisi kolom ke-i = xs - (frac + i) * pxPerCol; kolom yang sedang terisi ada di x = xs, jadi geseran halus sampai ke sub-piksel
    const pxCol = SPEEDS[speed].pps * env.binSec, frac = env.frac, sc = gainH.scale;
    for (let p = 0; p < np; p++) {
      const x = Math.min(xs, p * STEP), b = (xs - x) / pxCol;
      let v: number;
      if (b < frac) { const u = frac > 0 ? b / frac : 0; v = env.partial + (env.at(0) - env.partial) * u; }
      else v = env.cubic(b - frac);
      tops[p] = shape(v * sc);
    }
    for (let p = 0; p < np; p++) { const a = Math.max(tops[p], 0.004); bots[p] = mid + a * amp; tops[p] = mid - a * amp; }
    // riwayat: isi solid satu warna saja, tanpa outline (sama seperti referensi); tanpa gradasi, inti, atau glow
    g.fillStyle = FILL;
    g.beginPath(); g.moveTo(0, mid);
    for (let p = 0; p < np; p++) g.lineTo(Math.min(xs, p * STEP), tops[p]);
    for (let p = np - 1; p >= 0; p--) g.lineTo(Math.min(xs, p * STEP), bots[p]);
    g.closePath(); g.fill();
    // tepi kiri memudar (gelombang "keluar" dari layar)
    g.save(); g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, 0, Math.min(36, xs * 0.2), 0); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade; g.fillRect(0, 0, Math.min(36, xs * 0.2), H); g.restore();

    // scope langsung: titik-titik trace dari zero-crossing naik, jumlah siklus mengikuti nada
    const m = trace.length;
    if (traceOk && live > 8) {
      const ls = gainL.scale, k = 1 / (m - 1);
      // scope langsung: hanya garis (tanpa isi)
      g.beginPath();
      for (let i = 0; i < m; i++) { const y = mid - clamp(trace[i] * ls, -1, 1) * amp * 0.96; if (i) g.lineTo(xs + i * k * live, y); else g.moveTo(xs, y); }
      g.lineJoin = 'round'; g.lineWidth = 1.5; g.strokeStyle = OUTLINE; g.stroke();
    }
  }

  // ---------- satu frame ----------
  let raf = 0, lastTs = 0;
  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    const dt = clamp((ts - lastTs) / 1000, 0.001, 0.1); lastTs = ts;
    if (an && ctx) {
      an.getFloatTimeDomainData(buf);
      // jam halus: maju mengikuti rAF, dikoreksi pelan ke jam audio (currentTime naik per blok besar, kalau dipakai langsung gulirannya patah-patah)
      if (ctx.state !== 'running') { lastClk = clk = ctx.currentTime; carry = 0; }
      else {
        clk += dt; clk += (ctx.currentTime - clk) * 0.05;
        if (Math.abs(ctx.currentTime - clk) > 0.25) clk = ctx.currentTime;
        const total = Math.max(0, (clk - lastClk) * sr + carry); lastClk = clk;
        const n = Math.min(Math.floor(total), FFT); carry = total - Math.floor(total);
        if (n > 0) env.push(buf, n);
        gainH.update(env.lastPeak, dt);
      }
      if (ts - lastPitch >= 40) { trk.update(det.detect(buf, sr)); lastPitch = ts; }
      const info = tb.build(buf, trk.period, sr, trace, traceOk ? prevTrace : null);
      traceOk = !info.silent;
      gainL.update(info.peak, dt);
      prevTrace.set(trace);
    }
    draw();
  }
  const start = (): void => { cancelAnimationFrame(raf); lastTs = performance.now(); raf = requestAnimationFrame(frame); };
  const stop = (): void => { cancelAnimationFrame(raf); raf = 0; };

  // ---------- posisi: DIKUNCI di dasar layar (CSS: .spec{position:fixed;bottom:0}). Tidak ada hitungan posisi dari elemen lain, jadi tidak bisa pindah / nyangkut.
  // Card transport (z-index 530) tetap menempel di dasar dan berada DI ATAS strip; strip ada di belakangnya, juga di dasar. ----------

  // ---------- buka / tutup (dari saklar di Pengaturan) ----------
  let closing = false;
  closeFn = () => {
    if (el.hidden || closing) return;
    stop(); disconnect();
    const done = (): void => { el.hidden = true; closing = false; };
    if (reduce) { done(); return; }
    closing = true;
    win.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => { done(); el.getAnimations({ subtree: true }).forEach(a => a.cancel()); };
  };
  openFn = () => {
    if (!el.hidden && !closing) return;   // dinyalakan lagi saat animasi tutup masih jalan: batalkan tutupnya dan lanjut
    closing = false;
    el.getAnimations({ subtree: true }).forEach(a => a.cancel());
    el.hidden = false;
    connect(); resetState(); layout(); start();
    if (!reduce) win.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  };
  document.addEventListener('visibilitychange', () => { if (!el.hidden) { if (document.hidden) stop(); else { resetState(); start(); } } });
}
