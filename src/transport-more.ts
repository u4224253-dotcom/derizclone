// Tombol titik tiga di card transport (paling kiri, sebelum tombol metronome M): membuka menu kecil di atas tombol.
// Menu memakai gaya yang sama dengan menu pattern DERIZ (.fx-pats). Isi menu diberikan lewat `items` (dibaca tiap menu dibuka);
// selama belum ada isi, menu menampilkan teks kosong. Tutup: klik tombol lagi, klik di luar, atau Esc.

export interface MoreItem { label: string; sub?: string; run(): void }   // sub: keterangan kecil di bawah label (mis. knob yang akan diotomasi)

export function initTransportMore(btn: HTMLButtonElement, items: () => MoreItem[] = () => []): { close(instant?: boolean): void } {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let menu: HTMLElement | null = null;

  const onOutside = (e: PointerEvent): void => { const t = e.target as Node; if (!menu?.contains(t) && !btn.contains(t)) close(); };
  const onResize = (): void => close(true);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    close(); btn.focus({ preventScroll: true });
  };

  function close(instant = false): void {
    const el = menu; if (!el) return;
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (instant || reduce) { el.remove(); return; }
    el.style.pointerEvents = 'none';
    el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9) translateY(4px)' }],
      { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => el.remove();
  }

  function open(): void {
    if (menu) return;
    const el = document.createElement('div');
    el.className = 'fx-pats tmore';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Opsi transport');
    const list = items();
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'fx-pats__empty'; empty.textContent = 'Belum ada opsi';
      el.appendChild(empty);
    }
    for (const it of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.className = 'fx-pats__item';
      const t = document.createElement('span'); t.className = 'fx-pats__name'; t.textContent = it.label;
      if (it.sub) {
        const col = document.createElement('span'); col.className = 'tmore__col';
        const sub = document.createElement('span'); sub.className = 'tmore__sub'; sub.textContent = it.sub;
        col.append(t, sub); b.appendChild(col);
      } else b.appendChild(t);
      b.addEventListener('click', () => { close(true); it.run(); });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;   // card transport ada di bawah layar: menu terbuka ke atas
    el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(r.top - 8 - h, innerHeight - h - 8)) + 'px';
    el.style.transformOrigin = 'bottom left';
    menu = el;
    btn.setAttribute('aria-expanded', 'true');
    el.addEventListener('keydown', e => e.stopPropagation());   // pintasan DAW (Space, panah) tidak ikut jalan
    el.addEventListener('keyup', e => e.stopPropagation());
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => { menu ? close() : open(); });
  return { close };
}
