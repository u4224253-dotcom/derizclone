// Record Mode: card pattern (kotak berwarna di timeline) bisa diangkat, dibawa bebas ke mana saja, dan digoyang (rotasi saja, tanpa melar).
// Cara pakai: klik + TAHAN pattern (350ms, jangan geser) -> terangkat jadi overlay -> bawa ke mana saja -> lepas -> memantul balik.
// Geser cepat tanpa menahan tetap memindah pattern kiri-kanan seperti biasa (logika di main.ts).
// Playhead utama disembunyikan selama itu dan dipindah jadi garis mini di dalam salinan (tinggi = pattern), jalan sesuai alur.
// Yang digoyang adalah SALINAN visual (clone) di <body>; pattern aslinya tetap di lane tapi disembunyikan (muncul lagi saat salinan mendarat),
// sehingga data, jadwal audio, dan riwayat undo tidak tersentuh.
// Zoom pattern: selagi pattern terangkat, jari kedua (cubit dua jari, atau Ctrl+scroll / pinch trackpad) memperbesar / memperkecil SALINAN itu saja;
// zoom timeline dimatikan selama itu (main.ts melewati logika zoomnya saat html.is-pat-jelly). Dilepas -> ukuran memantul balik ke 1 bersama posisinya.
import { POS_DRAG, POS_FREE, ROT, HOLD_MS, HOLD_SLOP, MAX_TILT, LIFT, REDUCE } from './record-jelly';

const SC_MIN = 0.4, SC_MAX = 3;   // batas ukuran salinan pattern saat di-zoom (1 = ukuran asli)
const clampSc = (v: number): number => Math.max(SC_MIN, Math.min(SC_MAX, v));

export function initPatternJelly(lanesEl: HTMLElement): void {
  const root = document.documentElement;
  const recOn = (): boolean => root.dataset.rec === 'on';

  let src: HTMLElement | null = null;     // pattern asli (di lane)
  let card: HTMLElement | null = null;    // salinan yang bergerak
  let layer: HTMLElement | null = null;
  let raf = 0, last = 0, holdTimer = 0;
  let pointerId = -1, held = false, pending = false, suppressClick = false;
  let x = 0, y = 0, vx = 0, vy = 0, rot = 0, rv = 0, lift = 1;
  let sc = 1, scT = 1;                                  // ukuran salinan (zoom pattern): sc = yang tampil, scT = target
  let pinch: { d: number; s: number } | null = null;    // cubitan dua jari yang sedang berjalan: jarak awal + ukuran awal
  let pinchUsed = false;                                // ada zoom selama pattern terangkat -> klik sisa jari kedua diabaikan
  let suppressUntil = 0;
  const pts = new Map<number, { x: number; y: number }>();   // semua jari / pointer yang sedang menyentuh layar
  let tx = 0, ty = 0, p0x = 0, p0y = 0, lx = 0, ly = 0;
  let gx = 0, gy = 0;
  let nat = { l: 0, t: 0, r: 0, b: 0 };
  let phLine: HTMLElement | null = null;  // garis playhead mini di dalam salinan (panjang = tinggi pattern)
  const phEl = document.getElementById('playhead') as HTMLElement | null;

  function measureNatural(): void {
    if (!card) return;
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
    const w = card.offsetWidth * sc, h = card.offsetHeight * sc;   // ukuran tampil (sudah terskala), supaya card besar tidak keluar layar
    nat = { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 };
  }
  function clampTarget(): void {
    const vw = root.clientWidth, vh = window.innerHeight, m = 6;
    tx = Math.min(Math.max(tx, Math.min(m - nat.l, 0)), Math.max(vw - m - nat.r, 0));
    ty = Math.min(Math.max(ty, Math.min(m - nat.t, 0)), Math.max(vh - m - nat.b, 0));
  }


  // posisi playhead utama (px, koordinat lanes) dibaca dari style yang sedang berjalan (ikut animasi WAAPI-nya)
  function playheadX(): number {
    if (!phEl) return NaN;
    const m = /^(-?[\d.]+)px/.exec(getComputedStyle(phEl).translate);
    return m ? parseFloat(m[1]) : 0;
  }
  // playhead dipindah ke salinan: muncul hanya saat playhead melewati rentang pattern, lalu jalan sesuai alur
  function updatePlayheadLine(): void {
    if (!phLine || !src) return;
    const px = playheadX(), l = parseFloat(src.style.left) || 0, w = parseFloat(src.style.width) || 0;
    const rel = px - l;
    if (!(rel >= 0 && rel <= w)) { phLine.style.display = 'none'; return; }
    phLine.style.display = 'block';
    phLine.style.transform = 'translateX(' + rel.toFixed(2) + 'px)';
  }

  function start(): void {
    if (!src) return;
    const r = src.getBoundingClientRect();
    card = src.cloneNode(true) as HTMLElement;
    card.style.setProperty('--bar', getComputedStyle(src).getPropertyValue('--bar'));   // --bar kini di #lanes; kartu di body tidak mewarisinya
    card.querySelectorAll('.pattern__handle').forEach(h => h.remove());
    card.classList.remove('is-selected', 'is-dragging', 'is-settling');
    card.classList.add('is-jelly');
    const s = card.style;
    s.animation = 'none'; s.transition = 'none';
    s.position = 'fixed'; s.left = r.left + 'px'; s.top = r.top + 'px';
    s.width = r.width + 'px'; s.height = r.height + 'px';
    s.margin = '0'; s.zIndex = '450'; s.pointerEvents = 'none';
    s.transformOrigin = 'center center';
    phLine = document.createElement('div');
    phLine.className = 'pattern__ph';
    phLine.style.color = phEl ? getComputedStyle(phEl).color : '#e8e8ee';
    card.appendChild(phLine);
    const lane = src.parentElement as HTMLElement;
    const col = lane.style.getPropertyValue('--track-color');
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none';
    if (col) layer.style.setProperty('--track-color', col);
    layer.appendChild(card);
    document.body.appendChild(layer);
    src.classList.add('is-jelly-src');
    root.classList.add('is-pat-jelly');   // playhead utama disembunyikan (CSS), diganti garis di salinan
    updatePlayheadLine();
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function finish(): void {
    clearTimeout(holdTimer); holdTimer = 0;
    cancelAnimationFrame(raf); raf = 0;
    if (layer) { layer.remove(); layer = null; }
    if (src) src.classList.remove('is-jelly-src');
    root.classList.remove('is-pat-jelly');
    src = card = phLine = null;
    x = y = vx = vy = rot = rv = 0; lift = 1; sc = scT = 1; pinch = null; pinchUsed = false;
    held = pending = false; pointerId = -1;
  }

  function step(dt: number): void {
    const P = held ? POS_DRAG : POS_FREE;
    const ox = held ? tx : 0, oy = held ? ty : 0;
    vx += (P.k * (ox - x) - P.c * vx) * dt;
    vy += (P.k * (oy - y) - P.c * vy) * dt;
    x += vx * dt; y += vy * dt;
    const sign = gy >= 0 ? 1 : -1;
    const tilt = held ? Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * 0.014 * sign + vy * 0.01 * gx * -1)) : 0;
    rv += (ROT.k * (tilt - rot) - ROT.c * rv) * dt;
    rot += rv * dt;
    lift += ((held ? LIFT : 1) - lift) * Math.min(1, dt * 14);
    sc += (scT - sc) * Math.min(1, dt * 16);
  }

  function paint(): void {
    if (!card) return;
    // hanya posisi + rotasi (goyang miring), tanpa melar/memipih; scale hanya efek "terangkat"
    card.style.transform =
      'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0) rotate(' + rot.toFixed(2) + 'deg) scale(' + (lift * sc).toFixed(4) + ')';
  }

  function tick(now: number): void {
    raf = 0;
    if (!card) return;
    const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let i = 0; i < 2; i++) step(dt / 2);
    if (held) { measureNatural(); clampTarget(); }
    paint(); updatePlayheadLine();
    if (!held && Math.abs(x) < 0.15 && Math.abs(y) < 0.15 && Math.abs(vx) < 1 && Math.abs(vy) < 1 && Math.abs(rot) < 0.1 && Math.abs(rv) < 1 && Math.abs(sc - 1) < 0.004) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  function pickUp(): void {
    if (!pending || !src) return;
    pending = false; held = true; suppressClick = true;
    p0x = lx; p0y = ly; tx = x; ty = y;
    try { navigator.vibrate?.(12); } catch { /* abaikan */ }
    start(); measureNatural();
    if (REDUCE) paint();
  }

  lanesEl.addEventListener('pointerdown', e => {
    if (!recOn() || e.button > 0 || pointerId !== -1 || pts.size > 1) return;   // jari kedua = zoom (timeline / pattern), bukan tahan baru
    const t = e.target as HTMLElement;
    const el = t.closest('.pattern') as HTMLElement | null;
    if (!el || t.closest('.pattern__handle') || t.isContentEditable) return;
    if (card) finish();
    src = el; pointerId = e.pointerId; pending = true; held = false;
    p0x = lx = e.clientX; p0y = ly = e.clientY;
    const r = el.getBoundingClientRect();
    gx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    gy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(pickUp, HOLD_MS);
  });

  // ---- jari kedua: sebelum pattern terangkat = zoom timeline biasa (batalkan tahan); sesudah terangkat = zoom pattern ----
  const otherPt = (): { x: number; y: number } | undefined => { for (const [id, q] of pts) if (id !== pointerId) return q; };
  const pinchDist = (): number => {
    const a = pts.get(pointerId), b = otherPt();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  document.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerId === pointerId || pts.size < 2) return;
    if (pending) { clearTimeout(holdTimer); holdTimer = 0; pending = false; pointerId = -1; src = null; return; }   // dua jari sebelum terangkat: biarkan zoom timeline
    if (held && !pinch) { const d = pinchDist(); if (d > 12) { pinch = { d, s: scT }; pinchUsed = true; } }
  }, true);
  const dropPt = (e: PointerEvent): void => {
    pts.delete(e.pointerId);
    if (held && e.pointerId !== pointerId) suppressUntil = performance.now() + 500;   // jari kedua diangkat: klik yang menyusul jangan memilih pattern / membuka kartu Add
    if (pts.size < 2) pinch = null;
  };
  document.addEventListener('pointerup', dropPt, true);
  document.addEventListener('pointercancel', dropPt, true);
  window.addEventListener('blur', () => { pts.clear(); pinch = null; });
  document.addEventListener('click', e => {
    if (performance.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  // Ctrl+scroll / pinch trackpad (desktop) selagi pattern terangkat: zoom pattern, bukan timeline
  document.addEventListener('wheel', e => {
    if (!held || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); e.stopPropagation();
    const dy = Math.max(-24, Math.min(24, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    scT = clampSc(scT * Math.exp(-dy * 0.008)); pinchUsed = true;
    if (REDUCE) { sc = scT; paint(); }
  }, { capture: true, passive: false });

  document.addEventListener('pointermove', e => {
    const q = pts.get(e.pointerId); if (q) { q.x = e.clientX; q.y = e.clientY; }
    if (pinch && held) {   // cubit: jarak dua jari / jarak awal = ukuran pattern
      const d = pinchDist();
      if (d > 0) { scT = clampSc(pinch.s * d / pinch.d); if (REDUCE) { sc = scT; paint(); } }
    }
    if (e.pointerId !== pointerId || !src) return;
    lx = e.clientX; ly = e.clientY;
    if (pending) {
      // geser sebelum waktunya (atau pattern sudah mulai digeser kiri-kanan oleh main.ts) = bukan tahan
      if (Math.hypot(lx - p0x, ly - p0y) > Math.min(HOLD_SLOP, 4) || src.classList.contains('is-dragging')) {
        clearTimeout(holdTimer); holdTimer = 0; pending = false; pointerId = -1; src = null;
      }
      return;
    }
    if (!held) return;
    e.preventDefault();
    tx = (lx - p0x); ty = (ly - p0y);
    if (REDUCE) { clampTarget(); x = tx; y = ty; vx = vy = rot = rv = 0; paint(); }
  });

  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    clearTimeout(holdTimer); holdTimer = 0;
    pointerId = -1;
    if (pending) { pending = false; src = null; return; }
    held = false; pinch = null; scT = 1;   // dilepas: ukuran ikut memantul balik ke 1
    if (pinchUsed) suppressUntil = performance.now() + 500;
    if (REDUCE) { finish(); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    setTimeout(() => { suppressClick = false; }, 0);
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  lanesEl.addEventListener('click', e => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  document.addEventListener('contextmenu', e => {
    const t = e.target as HTMLElement | null;
    if (card || (recOn() && t && t.closest && t.closest('.pattern'))) e.preventDefault();
  }, true);
  document.addEventListener('selectstart', e => { if (card) e.preventDefault(); }, true);
  document.addEventListener('touchmove', e => { if (held && e.cancelable) e.preventDefault(); }, { passive: false });

  document.addEventListener('recmodechange', () => { if (!recOn() && card) finish(); });
  // pattern asli dihapus / diganti (undo, hapus) saat sedang goyang -> hentikan
  new MutationObserver(() => { if (src && !src.isConnected) finish(); }).observe(lanesEl, { childList: true, subtree: true });
}
