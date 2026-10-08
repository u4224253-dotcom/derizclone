// Pindah urutan track: klik-TAHAN icon channel mixer (icon instrumen di card track), lalu geser ke atas / bawah.
// Berlaku di semua mode (termasuk Record Mode). Card track dan lane-nya di timeline ikut pindah bersamaan,
// track lain bergeser membuka ruang, dan saat dilepas urutan DOM diganti (jadi tersimpan di project juga).
//
// - Tahan ~0,4 detik tanpa banyak bergeser -> masuk mode pindah (getar singkat di HP, icon membesar).
// - Geser sebelum waktu tahan habis -> dianggap gerakan biasa (batal), klik biasa tetap membuka/menutup panel.
// - Dekat tepi atas / bawah area scroll -> otomatis scroll supaya bisa pindah ke track yang jauh.

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;

const HOLD_MS = 380;        // lama tahan sebelum mode pindah aktif
const CANCEL_PX = 9;        // geser lebih dari ini sebelum waktu tahan habis = batal
const EDGE_PX = 60;         // jarak dari tepi area scroll yang memicu auto-scroll
const MAX_SCROLL = 16;      // kecepatan auto-scroll maksimum (px per frame)
const SETTLE_MS = 240;      // animasi card mendarat ke slot barunya
const SHIFT_MS = 220;       // animasi track lain bergeser

interface Row { c: HTMLElement; l: HTMLElement | null; h: number; }

export function initTrackReorder(
  headersList: HTMLElement,
  lanesEl: HTMLElement,
  scroller: HTMLElement,
  onChange?: () => void,
): void {
  const root = document.documentElement;
  let pid = -1;                          // pointer yang sedang dipantau
  let timer = 0;                         // timer tahan
  let btn: HTMLElement | null = null;    // tombol icon yang ditekan
  let active = false;                    // true = sudah masuk mode pindah
  let suppressClick = false;
  let sx = 0, sy = 0, curY = 0, scrollStart = 0;
  let rows: Row[] = [];
  let from = 0, to = 0, raf = 0;

  const laneOf = (c: HTMLElement): HTMLElement | null =>
    lanesEl.querySelector('.lane[data-track="' + c.dataset.track + '"]');
  const hoverClass = 'is-reorder-ready';

  function setShift(r: Row, px: number): void {
    const v = '0 ' + px + 'px';
    r.c.style.translate = v;
    if (r.l) r.l.style.translate = v;
  }

  function begin(): void {
    timer = 0;
    if (!btn) return;
    const cont = btn.closest('.trkcard-wrap') as HTMLElement | null;
    if (!cont) return;
    rows = ([...headersList.children] as HTMLElement[])
      .filter(el => el.classList.contains('trkcard-wrap'))
      .map(c => ({ c, l: laneOf(c), h: c.getBoundingClientRect().height }));
    from = to = rows.findIndex(r => r.c === cont);
    if (from < 0) { cancel(); return; }
    active = true; suppressClick = true;
    scrollStart = scroller.scrollTop;
    root.classList.add('is-reorder');
    btn.classList.add(hoverClass);
    rows.forEach((r, i) => {
      if (i === from) {
        r.c.classList.add('is-reordering'); r.l && r.l.classList.add('is-reordering');
        r.c.style.transition = 'none'; if (r.l) r.l.style.transition = 'none';
      } else if (!REDUCE) {
        const t = 'translate ' + SHIFT_MS + 'ms cubic-bezier(.2,.8,.2,1)';
        r.c.style.transition = t; if (r.l) r.l.style.transition = t;
      }
    });
    try { navigator.vibrate?.(12); } catch { /* abaikan */ }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function update(): void {
    if (!active) return;
    const me = rows[from];
    const above = rows.slice(0, from).reduce((s, r) => s + r.h, 0);
    const below = rows.slice(from + 1).reduce((s, r) => s + r.h, 0);
    const dy = Math.max(-above, Math.min(below, (curY - sy) + (scroller.scrollTop - scrollStart)));
    setShift(me, dy);
    // slot tujuan: hitung berapa track lain yang titik tengahnya ada di atas tengah card yang diseret
    const center = above + dy + me.h / 2;
    let acc = 0, count = 0;
    rows.forEach((r, i) => {
      if (i === from) return;
      if (acc + r.h / 2 < center) count++;
      acc += r.h;
    });
    if (count !== to) {
      to = count;
      try { navigator.vibrate?.(6); } catch { /* abaikan */ }
    }
    rows.forEach((r, i) => {
      if (i === from) return;
      let s = 0;
      if (i > from && i <= to) s = -me.h;          // track di bawah yang dilewati -> naik
      else if (i < from && i >= to) s = me.h;      // track di atas yang dilewati -> turun
      setShift(r, s);
    });
  }

  // auto-scroll saat card diseret dekat tepi atas / bawah
  function loop(): void {
    raf = 0;
    if (!active) return;
    const r = scroller.getBoundingClientRect();
    let v = 0;
    if (curY < r.top + EDGE_PX) v = -Math.min(1, (r.top + EDGE_PX - curY) / EDGE_PX) * MAX_SCROLL;
    else if (curY > r.bottom - EDGE_PX) v = Math.min(1, (curY - (r.bottom - EDGE_PX)) / EDGE_PX) * MAX_SCROLL;
    if (v) { scroller.scrollTop += v; update(); }
    raf = requestAnimationFrame(loop);
  }

  function clearAll(): void {
    rows.forEach(r => {
      for (const el of [r.c, r.l]) {
        if (!el) continue;
        el.style.transition = 'none'; el.style.translate = '';
        el.classList.remove('is-reordering');
      }
    });
  }

  function finish(): void {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const me = rows[from];
    const beforeC = me.c.getBoundingClientRect().top, beforeL = me.l ? me.l.getBoundingClientRect().top : 0;
    const moved = to !== from;
    // dua item "jangkar" sebelum DOM diubah: item yang akan ada tepat setelah card yang dipindah
    const others = rows.filter((_, i) => i !== from);
    const ref = others[to] || null;   // null = jadi yang paling bawah
    if (moved) {
      me.c.classList.add('is-moved');   // cegah animasi masuk CSS terulang karena elemen dipasang ulang
      headersList.insertBefore(me.c, ref ? ref.c : null);
      if (me.l) lanesEl.insertBefore(me.l, ref && ref.l ? ref.l : lanesEl.querySelector('.playhead'));
    }
    // yang lain sudah ada di slot akhirnya (lewat translate), jadi lepas translate tanpa animasi
    const keep = me;
    rows.forEach(r => { if (r !== keep) for (const el of [r.c, r.l]) if (el) { el.style.transition = 'none'; el.style.translate = ''; } });
    keep.c.style.translate = ''; if (keep.l) keep.l.style.translate = '';
    // card yang diseret meluncur dari posisi lepasnya ke slot barunya
    const afterC = me.c.getBoundingClientRect().top, afterL = me.l ? me.l.getBoundingClientRect().top : 0;
    const done = (): void => {
      for (const el of [me.c, me.l]) if (el) { el.classList.remove('is-reordering'); el.style.transition = ''; }
    };
    if (REDUCE || (!beforeC && !afterC)) done();
    else {
      const o = { duration: SETTLE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' };
      me.c.animate([{ translate: '0 ' + (beforeC - afterC) + 'px' }, { translate: '0 0px' }], o).onfinish = done;
      if (me.l) me.l.animate([{ translate: '0 ' + (beforeL - afterL) + 'px' }, { translate: '0 0px' }], o);
    }
    requestAnimationFrame(() => rows.forEach(r => { if (r !== me) for (const el of [r.c, r.l]) if (el) el.style.transition = ''; }));
    root.classList.remove('is-reorder');
    if (btn) btn.classList.remove(hoverClass);
    if (moved) onChange?.();
    rows = [];
  }

  function cancel(): void {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (active) { active = false; clearAll(); rows.forEach(r => { for (const el of [r.c, r.l]) if (el) el.style.transition = ''; }); root.classList.remove('is-reorder'); rows = []; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (btn) { btn.classList.remove(hoverClass); try { btn.releasePointerCapture(pid); } catch { /* abaikan */ } }
    pid = -1; btn = null;
  }

  headersList.addEventListener('pointerdown', e => {
    if (e.button > 0 || pid !== -1) return;
    const b = (e.target as HTMLElement).closest('.trkcard__lead') as HTMLElement | null;
    if (!b) return;
    // Record Mode: card yang sedang dipilih dikuasai drag bebas (record-jelly.ts), jadi tahan icon tidak memicu pindah urutan
    if (root.dataset.rec === 'on' && b.closest('.trkcard--on')) return;
    btn = b; pid = e.pointerId; sx = e.clientX; sy = curY = e.clientY;
    suppressClick = false;
    try { b.setPointerCapture(e.pointerId); } catch { /* abaikan */ }
    timer = window.setTimeout(begin, HOLD_MS);
  });

  headersList.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return;
    curY = e.clientY;
    if (!active) {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > CANCEL_PX) {
        suppressClick = true;     // sudah digeser sebelum waktunya: bukan klik, bukan tahan
        cancel();
      }
      return;
    }
    e.preventDefault();
    update();
  });

  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pid) return;
    if (active) {
      try { btn && btn.releasePointerCapture(pid); } catch { /* abaikan */ }
      finish();
      pid = -1; btn = null;
      setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    cancel();   // klik biasa / dibatalkan
  };
  headersList.addEventListener('pointerup', release);
  headersList.addEventListener('pointercancel', release);

  // setelah tahan + geser (atau tahan saja), klik yang menyusul -> jangan buka/tutup panel track
  headersList.addEventListener('click', e => {
    if (!suppressClick) return;
    if ((e.target as HTMLElement).closest('.trkcard__lead')) {
      e.stopPropagation(); e.preventDefault();
    }
    suppressClick = false;
  }, true);

  // tahan lama di HP memunculkan menu konteks / seleksi: matikan hanya untuk tombol icon
  headersList.addEventListener('contextmenu', e => {
    if ((e.target as HTMLElement).closest('.trkcard__lead')) e.preventDefault();
  });

  // jaga-jaga: tab disembunyikan / Esc saat mode pindah aktif -> batalkan tanpa memindah
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) { to = from; cancelDrag(); } });
  function cancelDrag(): void {
    // lepas seperti biasa tapi tanpa perpindahan (to == from)
    finish();
    pid = -1; btn = null;
    setTimeout(() => { suppressClick = false; }, 0);
  }
}
