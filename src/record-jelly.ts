// Record Mode: card track yang terpilih bisa di-drag ke mana saja dan digoyang.
// Fisikanya spring (kenyal): card mengikuti jari/kursor dengan sedikit tertinggal, miring (rotasi) mengikuti
// arah gerak, melar sedikit searah kecepatan (jelly), lalu dilepas -> memantul balik ke tempat asal.
// Cara pakai: klik + TAHAN card (350ms) -> card terangkat jadi overlay (dipindah ke <body>), lalu bebas dibawa ke mana saja.
// Hanya aktif saat html[data-rec="on"] dan hanya untuk track yang sedang dipilih.

export const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

// spring: k = kekakuan, c = redaman (c kecil -> lebih kenyal / goyang lebih lama)
export const POS_DRAG = { k: 260, c: 21 };    // saat dipegang: ikut pointer, sedikit lag
export const POS_FREE = { k: 150, c: 9 };     // saat dilepas: balik ke asal sambil memantul
export const ROT = { k: 210, c: 10 };         // rotasi: berayun
export const HOLD_MS = 350;                   // tahan segini lama -> card "terangkat" jadi overlay, lalu bebas dibawa ke mana saja
export const HOLD_SLOP = 10;                  // geser lebih dari ini sebelum waktunya = batal (bukan tahan)
export const MAX_TILT = 28;                   // derajat
export const LIFT = 1.06;                     // card membesar saat terangkat

// elemen yang tidak boleh memulai drag (punya interaksi sendiri)
const NO_DRAG = 'input, [role="slider"], .knob, .trkcard__power, .trkcard__arm, .trkcard__menu, [contenteditable="true"], .trkcard-sep';

export function initRecordJelly(headersList: HTMLElement, workspace: HTMLElement): void {
  const root = document.documentElement;
  const recOn = (): boolean => root.dataset.rec === 'on';

  let card: HTMLElement | null = null;       // .trkcard yang sedang bergerak
  let cont: HTMLElement | null = null;       // .trkcard-wrap (tidak ikut bertransform = patokan posisi asli)
  let raf = 0, last = 0;
  let pointerId = -1, held = false, pending = false;
  let x = 0, y = 0, vx = 0, vy = 0;          // offset card dari posisi asal + kecepatan (px, px/s)
  let rot = 0, rv = 0;                       // rotasi (derajat) + kecepatan sudut
  let tx = 0, ty = 0;                        // target posisi saat dipegang
  let p0x = 0, p0y = 0, o0x = 0, o0y = 0;    // titik pointer awal + offset card saat diambil
  let gx = 0, gy = 0;                        // titik pegang relatif ke tengah card (-1..1)
  let nat = { l: 0, t: 0, r: 0, b: 0 };      // kotak card di posisi asal (tanpa transform)
  let suppressClick = false;
  let holdTimer = 0, lx = 0, ly = 0;         // timer tahan + posisi pointer terakhir
  let layer: HTMLElement | null = null;      // pembungkus overlay di <body> (membawa class collapsed supaya tampilan card sama persis)
  let homeNext: Node | null = null;          // sibling setelah card di kandangnya (untuk mengembalikan posisi DOM)
  let lift = 1;

  // ?dbg=1 -> log kecil di layar (untuk cek di HP tanpa devtools)
  let dbgEl: HTMLElement | null = null;
  const dbgLines: string[] = [];
  const dbg = (m: string): void => {
    if (!/[?&]dbg=1/.test(location.search)) return;
    if (!dbgEl) {
      dbgEl = document.createElement('pre');
      dbgEl.style.cssText = 'position:fixed;left:6px;bottom:84px;z-index:9999;margin:0;padding:6px 8px;max-width:70vw;font:10px/1.35 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.75);border-radius:6px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(dbgEl);
    }
    dbgLines.push(m); if (dbgLines.length > 9) dbgLines.shift();
    dbgEl.textContent = dbgLines.join('\n');
  };
  ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu'].forEach(t =>
    document.addEventListener(t, ev => { if (card || t === 'pointerdown') dbg(t + (ev.cancelable === false ? '' : ' ') + ((ev as PointerEvent).pointerType || '') + (card ? ' held=' + held : '')); }, true));

  const selected = (): HTMLElement | null => headersList.querySelector('.trkcard--on');

  function measureNatural(): void {
    if (!card) return;
    const r = card.getBoundingClientRect();
    // rect saat ini = posisi asal + offset (rotasi/scale berpusat di tengah, jadi pusatnya tetap pusat + offset)
    const cx = r.left + r.width / 2 - x, cy = r.top + r.height / 2 - y;
    const w = card.offsetWidth, h = card.offsetHeight;
    nat = { l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 };
  }

  function clampTarget(): void {
    // batas = seluruh layar (bukan cuma .workspace), supaya card bisa dibawa ke mana saja
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 6;
    const minX = m - nat.l, maxX = vw - m - nat.r;
    const minY = m - nat.t, maxY = vh - m - nat.b;
    tx = Math.min(Math.max(tx, Math.min(minX, 0)), Math.max(maxX, 0));
    ty = Math.min(Math.max(ty, Math.min(minY, 0)), Math.max(maxY, 0));
  }

  function start(): void {
    if (!card || !cont) return;
    root.classList.add('is-jelly');
    cont.classList.add('is-jelly');
    cont.classList.add('is-moved');   // matikan animasi masuk (fill-mode both menyisakan transform -> jadi containing block position:fixed & card tetap terpotong)
    card.classList.add('is-jelly');
    card.style.transition = 'none';
    // angkat card keluar dari kandang: position:fixed lolos dari overflow .workspace/.tracklist.
    // Slot di daftar track tetap (tinggi container fix), card dihitung dari posisi asalnya.
    const s = card.style, w = card.offsetWidth, h = card.offsetHeight;   // ukur SEBELUM fixed (height:100% jadi merujuk ke layar)
    s.position = 'fixed'; s.left = nat.l + 'px'; s.top = nat.t + 'px';
    s.width = w + 'px'; s.height = h + 'px';
    s.margin = '0'; s.boxSizing = 'border-box'; s.zIndex = '450';   // di atas semua panel (menu = 480, tombol = 500)
    // pindahkan card ke <body>: tidak ada ancestor (overflow/transform/sticky) yang bisa memotong atau menjebaknya, termasuk di Safari iOS
    const col = cont.style.getPropertyValue('--track-color');
    if (col) s.setProperty('--track-color', col);
    homeNext = card.nextSibling;
    layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none';
    // aturan CSS panel yang dilipat ('.tracklist--collapsed .trkcard__...') bergantung pada ancestor ini
    if (cont.closest('.tracklist--collapsed')) layer.className = 'tracklist--collapsed';
    layer.appendChild(card);
    document.body.appendChild(layer);
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function finish(): void {
    cancelHold();
    cancelAnimationFrame(raf); raf = 0;
    if (card && cont && layer && card.parentNode === layer) cont.insertBefore(card, homeNext && homeNext.parentNode === cont ? homeNext : null);
    if (layer) { layer.remove(); layer = null; }
    homeNext = null;
    if (card) {
      const s = card.style;
      s.removeProperty('--track-color');
      s.transform = ''; s.transition = '';
      s.position = s.left = s.top = s.width = s.height = s.margin = s.boxSizing = s.zIndex = '';
      card.classList.remove('is-jelly');
    }
    if (cont) cont.classList.remove('is-jelly');
    root.classList.remove('is-jelly');
    card = cont = null;
    x = y = vx = vy = rot = rv = 0; lift = 1;
    held = pending = false; pointerId = -1;
  }

  function step(dt: number): void {
    const P = held ? POS_DRAG : POS_FREE;
    const ox = held ? tx : 0, oy = held ? ty : 0;
    // posisi
    vx += (P.k * (ox - x) - P.c * vx) * dt;
    vy += (P.k * (oy - y) - P.c * vy) * dt;
    x += vx * dt; y += vy * dt;
    // rotasi: target miring mengikuti kecepatan horizontal; titik pegang di atas/bawah membalik arah ayunan
    // seperti menarik kartu dari ujungnya. Saat dilepas target 0 -> berayun balik.
    const sign = gy >= 0 ? 1 : -1;
    const tilt = held
      ? Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * 0.014 * sign + vy * 0.01 * gx * -1))
      : 0;
    rv += (ROT.k * (tilt - rot) - ROT.c * rv) * dt;
    rot += rv * dt;
    lift += ((held ? LIFT : 1) - lift) * Math.min(1, dt * 14);
  }

  function paint(): void {
    if (!card) return;
    const sp = Math.hypot(vx, vy);
    const s = Math.min(sp / 2600, 0.2);                 // melar searah gerak, memipih tegak lurus
    const a = Math.atan2(vy, vx) * 180 / Math.PI;
    card.style.transform =
      'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0) rotate(' + rot.toFixed(2) + 'deg) ' +
      'rotate(' + a.toFixed(1) + 'deg) scale(' + ((1 + s) * lift).toFixed(4) + ',' + ((1 - s * 0.6) * lift).toFixed(4) + ') rotate(' + (-a).toFixed(1) + 'deg)';
  }

  function tick(now: number): void {
    raf = 0;
    if (!card) return;
    let dt = Math.min((now - last) / 1000, 1 / 30); last = now;
    for (let i = 0; i < 2; i++) step(dt / 2);          // 2 sub-step supaya spring stabil
    if (held) { measureNatural(); clampTarget(); }
    paint();
    const settled = !held && Math.abs(x) < 0.15 && Math.abs(y) < 0.15 && Math.abs(vx) < 1 && Math.abs(vy) < 1 && Math.abs(rot) < 0.1 && Math.abs(rv) < 1;
    if (settled) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  // klik tahan selesai: card terangkat jadi overlay (lepas dari kandang) dan langsung bisa dibawa kemana saja
  function pickUp(): void {
    if (!pending || !card) return;
    dbg('PICKUP');
    pending = false; held = true; suppressClick = true;
    p0x = lx; p0y = ly; o0x = x; o0y = y; tx = x; ty = y;
    try { navigator.vibrate?.(12); } catch { /* abaikan */ }
    measureNatural(); start();
    if (REDUCE) paint();
  }
  const cancelHold = (): void => { clearTimeout(holdTimer); holdTimer = 0; };

  // ===== input =====
  headersList.addEventListener('pointerdown', e => {
    if (!recOn() || e.button > 0 || pointerId !== -1) return;
    const target = e.target as HTMLElement;
    if (target.closest(NO_DRAG)) return;
    const th = target.closest('.trkcard') as HTMLElement | null;
    const sel = selected();
    if (!th || th !== sel) return;                      // hanya track yang sedang dipilih
    if (card && card !== th) finish();
    card = th; cont = th.closest('.trkcard-wrap') as HTMLElement;
    pointerId = e.pointerId; pending = true; held = false;
    p0x = e.clientX; p0y = e.clientY; o0x = x; o0y = y;
    const r = th.getBoundingClientRect();
    gx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    gy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    lx = e.clientX; ly = e.clientY;
    try { th.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(pickUp, HOLD_MS);   // klik + tahan -> card jadi overlay
  });

  document.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId || !card) return;
    lx = e.clientX; ly = e.clientY;
    if (pending) {
      // masih menunggu tahan: geser terlalu jauh = bukan tahan, batalkan
      if (Math.hypot(lx - p0x, ly - p0y) > HOLD_SLOP) {
        cancelHold(); pending = false;
        try { card.releasePointerCapture(e.pointerId); } catch { /* abaikan */ }
        pointerId = -1; card = cont = null;
      }
      return;
    }
    if (!held) return;
    e.preventDefault();
    tx = o0x + (lx - p0x); ty = o0y + (ly - p0y);
    if (REDUCE) { x = tx; y = ty; vx = vy = rot = rv = 0; clampTarget(); x = tx; y = ty; paint(); }
  });

  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    cancelHold();
    try { card && card.releasePointerCapture(e.pointerId); } catch { /* abaikan */ }
    pointerId = -1;
    if (pending) { pending = false; card = cont = null; return; }   // cuma klik biasa
    held = false;
    // lempar: kecepatan terakhir dipertahankan, jadi card melenting sebelum kembali
    if (REDUCE) { finish(); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    setTimeout(() => { suppressClick = false; }, 0);
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);

  // setelah drag, klik yang menyusul (mis. tombol ikon instrumen -> buka/tutup panel) dibuang
  headersList.addEventListener('click', e => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  // Android/Chrome: tahan lama memicu menu konteks / seleksi teks ~500ms -> pointercancel -> card terlepas & balik sendiri.
  // Listener harus di document (capture): setelah terangkat card sudah di <body>, bukan lagi di headersList.
  document.addEventListener('contextmenu', e => {
    const t = e.target as HTMLElement | null;
    if (card || (recOn() && t && t.closest && t.closest('.trkcard--on'))) e.preventDefault();
  }, true);
  document.addEventListener('selectstart', e => { if (card) e.preventDefault(); }, true);
  document.addEventListener('dragstart', e => { if (card) e.preventDefault(); }, true);
  // jaga-jaga: saat card terangkat, cegah scroll / pull-to-refresh dari gesture yang sama
  document.addEventListener('touchmove', e => { if (held && e.cancelable) e.preventDefault(); }, { passive: false });

  // ganti track / Record Mode dimatikan -> hentikan goyangan
  document.addEventListener('recmodechange', () => { if (!recOn() && card) finish(); });
  new MutationObserver(() => { if (card && !card.classList.contains('trkcard--on')) finish(); })
    .observe(headersList, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
