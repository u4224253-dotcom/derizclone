// Panel efek di sisi kanan layar: buka / tutup dengan animasi. Isinya masih kosong (tempat efek per track menyusul).
// Lebar panel dianimasikan lewat CSS (.fx); selama animasi berjalan, timeline ikut menyesuaikan lewat onFrame.

export interface EffectsPanel {
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

const ANIM_MS = 520;   // sedikit lebih lama dari transisi lebar di CSS (.45s)

export function initEffectsPanel(
  onFrame: (settled: boolean) => void,   // dipanggil tiap frame selama panel bergerak; settled = true di frame terakhir
  onToggle?: () => void                  // dipanggil sekali tiap buka / tutup (mis. menutup menu yang sedang terbuka)
): EffectsPanel {
  const root = document.getElementById('fxPanel')!;
  const btn = document.getElementById('fxToggle') as HTMLButtonElement;
  const clip = root.querySelector<HTMLElement>('.fx__clip')!;
  const mobile = matchMedia('(max-width: 640px)');

  let open = false, token = 0;

  const follow = () => {   // timeline bergeser selama panel beranimasi: ruler & toolbar pattern ikut disesuaikan
    const my = ++token, t0 = performance.now();
    const tick = () => {
      if (my !== token) return;   // ada toggle baru, loop lama berhenti
      const done = performance.now() - t0 >= ANIM_MS;
      onFrame(done);
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const apply = (next: boolean, animate: boolean) => {
    open = next;
    root.classList.toggle('fx--open', open);
    const label = open ? 'Tutup panel efek' : 'Buka panel efek';
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', label);
    btn.title = label;
    // saat tertutup, isi panel tidak boleh bisa difokus / dibaca screen reader
    if (open) { clip.removeAttribute('inert'); clip.removeAttribute('aria-hidden'); }
    else { clip.setAttribute('inert', ''); clip.setAttribute('aria-hidden', 'true'); }
    if (animate) { onToggle?.(); follow(); }
  };

  btn.addEventListener('click', () => apply(!open, true));

  // keadaan awal tanpa animasi: terbuka di layar lebar, tertutup di layar sempit (panel menutupi timeline)
  apply(!mobile.matches, false);
  requestAnimationFrame(() => root.classList.add('fx--ready'));   // transisi baru aktif setelah keadaan awal terpasang

  return { isOpen: () => open, setOpen: v => { if (v !== open) apply(v, true); } };
}
