// Jendela plugin (DERIZ / EQ / Reverb / Delay, MPCS, MGCHORD, CUTE) bisa digeser lewat header-nya dan selalu ditahan di dalam layar.
// Pakai properti CSS `translate` (terpisah dari `transform`) supaya tidak bentrok dengan animasi buka / tutup dan efek miring 3D.
// Posisi kembali ke tengah setiap kali jendela ditutup (root diberi atribut hidden).
const MARGIN = 6;   // jarak minimum jendela ke tepi layar (px)
const SKIP = 'button:not(.fxc__title), input, select, textarea, a, canvas, label, [role="slider"], [contenteditable]';   // kontrol di header tetap berfungsi normal

export function dragWindow(o: { root: HTMLElement; move: HTMLElement; handle: string }): void {
  const { root, move, handle } = o;
  let tx = 0, ty = 0;
  let st: { id: number; x: number; y: number; tx0: number; ty0: number; r: DOMRect; on: boolean; el: HTMLElement } | null = null;
  const put = (): void => { move.style.translate = tx || ty ? `${Math.round(tx)}px ${Math.round(ty)}px` : ''; };
  // sumbu yang jendelanya tidak muat (mis. layar penuh) dikunci; selain itu delta dibatasi supaya tepi jendela tetap di dalam layar
  const lim = (d: number, lo: number, hi: number): number => (lo > hi ? 0 : Math.max(lo, Math.min(hi, d)));
  // layar berubah ukuran / diputar: tarik balik jendela yang tergeser ke luar
  const fit = (): void => {
    if (!tx && !ty) return;
    const r = move.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r.left < MARGIN) tx += MARGIN - r.left; else if (r.right > vw - MARGIN) tx -= r.right - (vw - MARGIN);
    if (r.top < MARGIN) ty += MARGIN - r.top; else if (r.bottom > vh - MARGIN) ty -= r.bottom - (vh - MARGIN);
    put();
  };
  root.addEventListener('pointerdown', e => {
    if (e.button > 0 || st) return;
    const t = e.target as Element, h = t.closest<HTMLElement>(handle);
    if (!h || !root.contains(h) || t.closest(SKIP)) return;
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, tx0: tx, ty0: ty, r: move.getBoundingClientRect(), on: false, el: h };
  });
  root.addEventListener('pointermove', e => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.on) {   // geser kecil dianggap klik biasa (mis. klik nama plugin)
      if (Math.hypot(dx, dy) < 5) return;
      st.on = true; move.classList.add('is-winmove');
      try { st.el.setPointerCapture(e.pointerId); } catch { /* elemen sudah lepas */ }
    }
    const vw = document.documentElement.clientWidth, vh = window.innerHeight, r = st.r;
    tx = st.tx0 + lim(dx, MARGIN - r.left, vw - MARGIN - r.right);
    ty = st.ty0 + lim(dy, MARGIN - r.top, vh - MARGIN - r.bottom);
    put(); e.preventDefault();
  });
  const end = (e: PointerEvent): void => {
    if (!st || e.pointerId !== st.id) return;
    const moved = st.on; st = null; move.classList.remove('is-winmove');
    if (!moved) return;
    const eat = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };   // lepas setelah geser: jangan dihitung sebagai klik
    window.addEventListener('click', eat, true);
    setTimeout(() => window.removeEventListener('click', eat, true), 60);
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  new MutationObserver(() => { if (root.hidden) { tx = ty = 0; st = null; move.classList.remove('is-winmove'); put(); } }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', fit); window.addEventListener('orientationchange', fit);
}
