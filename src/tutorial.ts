// Tutorial: gelembung chat (putih, teks hitam) yang menempel ke tiap menu dan menjelaskan fungsinya satu per satu.
// Tombol pembuka ada di pojok kanan atas (kiri tombol menu). Pertama kali aplikasi dibuka, tutorial menawarkan diri sekali.
// Menambah langkah: tambahkan objek di STEPS (selector `targets` disorot dengan bingkai; kosong = gelembung di tengah layar).
// Langkah yang targetnya tidak tampil (mis. fitur versi penuh yang disembunyikan di demo) dilewati otomatis.

import { DEMO, LIMITS } from './demo';

type Side = 'top' | 'bottom' | 'left' | 'right';   // sisi target tempat gelembung ditaruh
interface Step {
  title: string;
  text: string;
  targets?: string[];                       // selector yang disorot (gabungan beberapa elemen)
  scene?: 'main' | 'track-menu' | 'fx' | 'menu';   // keadaan layar yang disiapkan sebelum langkah tampil
  page?: 'home' | 'settings';               // halaman panel menu (scene 'menu')
  prefer?: Side[];                          // urutan sisi yang dicoba
  skipIf?: () => boolean;
  primary?: string;                         // label tombol utama
}

const SEEN_KEY = 'derizmp3.tutorialSeen';
const T = (n: string): string => `.trkcard-wrap ${n}`;   // elemen di kartu track pertama
const SET = (attr: string): string => `.mp__page[data-page="settings"] .mp__card:has([${attr}])`;

const STEPS: Step[] = [
  { title: 'Halo, selamat datang!', primary: 'Mulai',
    text: 'Ini tutorial singkat Melvox. Aku tunjukkan fungsi tiap menu satu per satu. Kamu bisa menutupnya kapan saja, dan membukanya lagi lewat tombol gelembung chat di pojok kanan atas.' },

  { title: 'Tambahkan track', targets: ['.addtrack'], prefer: ['right', 'top', 'bottom'],
    text: 'Mulai dari sini. Ketuk untuk memilih instrumen track: Audio clip, Supersaw, atau DERIZ.' + (DEMO ? ` Di versi demo dibatasi ${LIMITS.tracks} track.` : '') },
  { title: 'Ikon instrumen', targets: [T('.trkcard__lead')], prefer: ['right', 'bottom'],
    text: 'Ikon di kiri kartu track adalah tombol instrumen. Ketuk untuk menampilkan instrumen track ini.' },
  { title: 'Nama dan saklar track', targets: [T('.trkcard__head')], prefer: ['right', 'bottom'],
    text: 'Baris atas kartu track berisi nama track, saklar nyala/mati (matikan untuk menonaktifkan suara track), dan titik tiga untuk opsi lainnya.' },
  { title: 'Pan', targets: [T('.trkcard__pan')], prefer: ['right', 'bottom'],
    text: 'Putar knob ini untuk menggeser suara ke kiri atau kanan. Ketuk dua kali untuk mengembalikannya ke tengah.' },
  { title: 'Volume track', targets: [T('.trkcard__vol')], prefer: ['right', 'bottom'],
    text: 'Geser untuk mengatur volume track, dari 0 sampai 150%.' },
  { title: 'Mode rekam', targets: [T('.trkcard__arm')], prefer: ['right', 'bottom'],
    text: 'Tombol S adalah Mode rekam untuk track ini. Ketuk untuk menyalakan atau mematikannya.' },
  { title: 'Opsi track', scene: 'track-menu', targets: ['.track-menu'], prefer: ['right', 'left', 'bottom'],
    text: 'Titik tiga membuka opsi track: Ganti nama pattern, Duplicate track (gandakan track beserta isinya), Delete track, dan Color untuk mengganti warna track.' },

  { title: 'Lane dan pattern', targets: ['#lanes .lane'], prefer: ['bottom', 'top'],
    text: 'Ini lane tempat pattern ditaruh. Ketuk area kosong lalu tekan Add untuk membuat pattern. Ketuk pattern untuk memunculkan toolbar: Copy, Delete, Snap, Edit (buka piano roll), dan More. Ketuk dua kali judul pattern untuk mengganti namanya.' },
  { title: 'Penggaris timeline', targets: ['#ruler'], prefer: ['bottom', 'top'],
    text: 'Ketuk atau seret penggaris ini untuk memindahkan playhead ke posisi mana pun di timeline.' },

  { title: 'Kontrol putar', targets: ['.tp__mid'], prefer: ['top', 'bottom'],
    text: 'Mundur (←), Putar/Jeda (Space), dan Maju cepat (→). Tombol keyboard komputer juga bisa dipakai.' },
  { title: 'Pitch project', targets: ['#btnPitch'], prefer: ['top', 'right'],
    text: 'Menggeser nada seluruh project dari −12 sampai +12 semitone. Audio clip di timeline tidak ikut berubah.' },
  { title: 'Metronome dan BPM', targets: ['#btnMetro'], prefer: ['top', 'right'],
    text: 'Tombol M membuka panel metronome: dial BPM (30–300), tombol − dan +, saklar metronome, Tap untuk menentukan tempo dengan mengetuk, dan Count-in (hitung 1 bar sebelum mulai).' },
  { title: 'Opsi transport', targets: ['#btnMore'], prefer: ['top', 'right'],
    text: DEMO ? 'Titik tiga ini berisi opsi tambahan. Fitur Create Automation Clip di dalamnya ada di versi penuh.'
      : 'Titik tiga berisi opsi tambahan. Sentuh sebuah knob lebih dulu, lalu pilih Create Automation Clip untuk mengotomasi knob itu.' },
  { title: 'Undo dan Redo', targets: ['.tp__side--r'], prefer: ['top', 'left'],
    text: 'Urungkan (Ctrl+Z) dan Ulangi (Ctrl+Shift+Z) perubahan terakhirmu.' },
  { title: 'Keyboard virtual', targets: ['#kbdToggle'], prefer: ['top', 'left'],
    text: 'Panah ini membuka dan menutup panel bawah. Di dalamnya ada keyboard virtual: mainkan lewat sentuhan atau keyboard komputer (baris Z–M dan Q–P), dengan tombol oktaf untuk menggeser rentang nada.' },

  { title: 'Panel Effects', scene: 'fx', targets: ['.fx__pages'], prefer: ['bottom', 'left'],
    text: 'Panel di sisi kanan. Tab Plugin berisi instrumen dan alat (DERIZ, Supersaw, MPCS), tab Effect berisi efek seperti Reverb, EQ, Filter, De-esser, dan Delay. Isinya mengikuti track yang sedang dipilih.' },
  { title: 'Tambah plugin atau efek', scene: 'fx', targets: ['#fxAdd'], prefer: ['bottom', 'left'],
    text: 'Tombol + menambahkan plugin atau efek ke track yang dipilih. DERIZ bisa dipasang beberapa kali, lewat tombol + atau Duplicate di titik tiga kartunya.' + (DEMO ? ` Di versi demo maksimal ${LIMITS.derizPlugins} plugin DERIZ.` : '') },

  { title: 'Menu utama', targets: ['#menuBtn'], prefer: ['bottom', 'left'],
    text: 'Tombol di pojok kanan atas ini membuka tiga kategori: Project, Export, dan Pengaturan.' },
  { title: 'Project', scene: 'menu', page: 'home', targets: ['.mp__cat[data-go="project"]'], prefer: ['left', 'bottom'],
    text: DEMO ? 'Menyimpan dan membuka file project ada di versi penuh. Di demo, project hilang saat halaman ditutup.'
      : 'Simpan project dengan tombol SAVE (ketuk: simpan sebagai project baru, tahan: simpan perubahan ke project yang sedang dibuka), atau buka file lewat Buka .json.' },
  { title: 'Export', scene: 'menu', page: 'home', targets: ['.mp__cat[data-go="export"]'], prefer: ['left', 'bottom'],
    text: 'Pilih format MP3 atau WAV, lalu tekan Export Audio. Project diputar dari bar 1 sampai akhir isi timeline sambil direkam, jadi lama export sama dengan durasi lagu. Jangan tutup atau pindah tab.' + (DEMO ? ' Export audio hanya ada di versi penuh; di demo tombol ini menampilkan info saja.' : '') },
  { title: 'Pengaturan: tampilan', scene: 'menu', page: 'settings', targets: [SET('data-theme'), SET('data-wf'), SET('data-wfm')], prefer: ['left', 'bottom'],
    text: 'Theme mengganti warna aplikasi. Waveform & bar color mengatur warna waveform dan bar. Waveform audio clip memilih bentuknya: 1 batang atau 2 batang.' },
  { title: 'Record Mode', scene: 'menu', page: 'settings', targets: [SET('data-rec')], prefer: ['left', 'bottom'],
    text: 'Saat dinyalakan, kamu memilih pattern dan track lain di-blur supaya fokus ke pattern itu.' },
  { title: 'Master Loudness', scene: 'menu', page: 'settings', targets: [SET('data-loud')], prefer: ['left', 'bottom'],
    text: 'Membuat output lebih keras dan padat lewat compressor dan limiter. Nyala secara bawaan.' },
  { title: 'Debug Audio', scene: 'menu', page: 'settings', targets: [SET('data-adbg')], prefer: ['left', 'bottom'], skipIf: () => DEMO,
    text: 'Menampilkan panel statistik beban, nada telat, dan nada terpotong saat Play. Berguna untuk mencari penyebab suara patah-patah.' },
  { title: 'Grid Piano Roll', scene: 'menu', page: 'settings', targets: [SET('data-prb-range')], prefer: ['left', 'top'],
    text: 'Mengatur panjang grid piano roll (jumlah bar) sekaligus note mini yang tampil di pattern. Pakai tombol − dan + atau geser slider-nya.' },
  { title: 'Install aplikasi', scene: 'menu', page: 'settings', targets: ['[data-install-card]'], prefer: ['left', 'top'], skipIf: () => $('[data-install-card]')?.hasAttribute('hidden') ?? true,
    text: 'Pasang Melvox ke layar utama supaya terbuka seperti aplikasi biasa. Kartu ini hanya muncul kalau aplikasi belum terpasang.' },

  { title: 'Piano roll',
    text: 'Buka piano roll lewat tombol Edit di toolbar pattern. Di dalamnya, ketuk atau seret penggaris untuk memindahkan playhead, pakai menu Slide pada note yang dipilih, dan panel Velocity di bawah untuk mengatur kekuatan tiap note.' },
  { title: 'Selesai!', primary: 'Selesai',
    text: 'Sekarang kamu sudah kenal semua menunya. Buka tutorial ini lagi kapan saja lewat tombol gelembung chat di pojok kanan atas.' },
];

const $ = <E extends HTMLElement = HTMLElement>(s: string): E | null => document.querySelector<E>(s);
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number): Promise<void> => (REDUCE ? Promise.resolve() : sleep(ms));

const ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>';

const seen = (): boolean => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const markSeen = (): void => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* abaikan */ } };

// elemen dianggap tampil kalau punya ukuran dan ada di dalam layar (panel yang tertutup digeser keluar layar)
const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden';
};

export function initTutorial(): void {
  if (document.getElementById('tutBtn')) return;

  const launch = document.createElement('button');
  launch.type = 'button'; launch.id = 'tutBtn'; launch.className = 'tut-btn';
  launch.setAttribute('aria-label', 'Buka tutorial'); launch.title = 'Tutorial';
  launch.innerHTML = ICON_CHAT;

  const root = document.createElement('div');
  root.className = 'tut'; root.hidden = true;
  root.innerHTML =
    '<div class="tut__ring" hidden></div>' +
    '<div class="tut__bubble" role="dialog" aria-label="Tutorial" aria-live="polite">' +
      '<i class="tut__tail"></i>' +
      '<div class="tut__body">' +
        '<div class="tut__meta"><span class="tut__count"></span><button type="button" class="tut__x" data-a="close" aria-label="Tutup tutorial">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
        '<h3 class="tut__title"></h3><p class="tut__text"></p>' +
        '<div class="tut__nav"><button type="button" class="tut__btn" data-a="prev">Kembali</button><button type="button" class="tut__btn tut__btn--go" data-a="next">Lanjut</button></div>' +
      '</div></div>';
  document.body.append(launch, root);

  const ring = root.querySelector<HTMLElement>('.tut__ring')!;
  const bubble = root.querySelector<HTMLElement>('.tut__bubble')!;
  const tail = root.querySelector<HTMLElement>('.tut__tail')!;
  const elCount = root.querySelector<HTMLElement>('.tut__count')!;
  const elTitle = root.querySelector<HTMLElement>('.tut__title')!;
  const elText = root.querySelector<HTMLElement>('.tut__text')!;
  const btnPrev = root.querySelector<HTMLButtonElement>('[data-a="prev"]')!;
  const btnNext = root.querySelector<HTMLButtonElement>('[data-a="next"]')!;

  let active = false, idx = 0, token = 0, cur: Step | null = null, raf = 0, viaKeyboard = false;
  window.addEventListener('keydown', () => { viaKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => { viaKeyboard = false; }, true);

  // ---------- menyiapkan layar untuk tiap langkah ----------
  const closeTrackMenu = (): void => { if ($('.track-menu')) $<HTMLButtonElement>('.trkcard__menu[aria-expanded="true"]')?.click(); };
  async function setScene(s: Step): Promise<void> {
    const scene = s.scene ?? 'main', menuBtn = $<HTMLButtonElement>('#menuBtn');
    const menuOpen = !!menuBtn?.classList.contains('is-open');
    if (scene !== 'menu' && menuOpen) { menuBtn!.click(); await wait(380); }
    if (scene !== 'track-menu') closeTrackMenu();
    if (scene === 'fx') {
      const t = $<HTMLButtonElement>('#fxToggle');
      if (t && t.getAttribute('aria-expanded') !== 'true') { t.click(); await wait(560); }
    }
    if (scene === 'track-menu' && !$('.track-menu')) { $<HTMLButtonElement>(T('.trkcard__menu'))?.click(); await wait(260); }
    if (scene === 'menu' && menuBtn) {
      if (!menuOpen) { menuBtn.click(); await wait(440); }
      const want = s.page ?? 'home', now = $('.mp__page:not([hidden])')?.getAttribute('data-page') ?? 'home';
      if (now !== want) { (want === 'home' ? $<HTMLButtonElement>('.mp__back') : $<HTMLButtonElement>(`.mp__cat[data-go="${want}"]`))?.click(); await wait(440); }
    }
  }

  // ---------- posisi gelembung + bingkai ----------
  // area yang benar-benar terlihat: lane / penggaris jauh lebih lebar dari layar, jadi dipotong ke area timeline dan layar
  const shownRect = (e: HTMLElement): { l: number; t: number; r: number; b: number } => {
    const k = e.getBoundingClientRect(), c = e.closest('#timeline')?.getBoundingClientRect();
    return {
      l: Math.max(k.left, c ? c.left : 0, 0), t: Math.max(k.top, c ? c.top : 0, 0),
      r: Math.min(k.right, c ? c.right : innerWidth, innerWidth), b: Math.min(k.bottom, c ? c.bottom : innerHeight, innerHeight),
    };
  };
  const union = (els: HTMLElement[]): DOMRect | null => {
    if (!els.length) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of els) { const k = shownRect(e); l = Math.min(l, k.l); t = Math.min(t, k.t); r = Math.max(r, k.r); b = Math.max(b, k.b); }
    return new DOMRect(l, t, Math.max(r - l, 0), Math.max(b - t, 0));
  };
  const resolve = (s: Step): HTMLElement[] => (s.targets ?? []).map(q => $(q)).filter(visible);
  async function bring(s: Step): Promise<void> {   // target ada tapi di luar layar (mis. kartu paling bawah di panel menu yang bisa di-scroll): gulir sampai terlihat
    let moved = false;
    for (const q of s.targets ?? []) {
      const e = $(q); if (!e) continue;
      const k = e.getBoundingClientRect();
      if (k.width > 1 && k.height > 1 && k.right > 0 && k.left < innerWidth && (k.top < 0 || k.bottom > innerHeight)) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); moved = true; }
    }
    if (moved) await wait(160);
  }

  function place(s: Step, els: HTMLElement[]): void {
    const vw = innerWidth, vh = innerHeight, m = 10, gap = 14;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const r = union(els);
    if (!r) {   // tanpa target: di tengah layar
      ring.hidden = true; tail.style.display = 'none';
      bubble.style.left = Math.round((vw - bw) / 2) + 'px'; bubble.style.top = Math.round((vh - bh) / 2) + 'px';
      bubble.style.setProperty('--ox', '50%'); bubble.style.setProperty('--oy', '50%');
      return;
    }
    const pad = 4;
    ring.hidden = false;
    ring.style.left = r.left - pad + 'px'; ring.style.top = r.top - pad + 'px';
    ring.style.width = r.width + pad * 2 + 'px'; ring.style.height = r.height + pad * 2 + 'px';

    const room: Record<Side, number> = { bottom: vh - r.bottom - gap - m, top: r.top - gap - m, right: vw - r.right - gap - m, left: r.left - gap - m };
    const need = (sd: Side): number => (sd === 'top' || sd === 'bottom' ? bh : bw);
    const order = [...(s.prefer ?? ['bottom', 'top', 'right', 'left']), 'bottom', 'top', 'right', 'left'] as Side[];
    let side = order.find(sd => room[sd] >= need(sd));
    if (!side) side = (['bottom', 'top', 'right', 'left'] as Side[]).reduce((a, b) => (room[b] > room[a] ? b : a));

    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let x = 0, y = 0;
    if (side === 'bottom') { x = cx - bw / 2; y = r.bottom + gap; }
    else if (side === 'top') { x = cx - bw / 2; y = r.top - gap - bh; }
    else if (side === 'right') { x = r.right + gap; y = cy - bh / 2; }
    else { x = r.left - gap - bw; y = cy - bh / 2; }
    x = Math.max(m, Math.min(x, vw - bw - m)); y = Math.max(m, Math.min(y, vh - bh - m));
    bubble.style.left = Math.round(x) + 'px'; bubble.style.top = Math.round(y) + 'px';

    // ekor mengarah ke tengah target (dijepit di dalam sisi gelembung); disembunyikan kalau gelembung menimpa target
    const overlap = x < r.right && x + bw > r.left && y < r.bottom && y + bh > r.top;
    tail.style.display = overlap ? 'none' : '';
    const tx = Math.max(24, Math.min(cx - x, bw - 24)), ty = Math.max(24, Math.min(cy - y, bh - 24));
    tail.style.left = tail.style.top = tail.style.right = tail.style.bottom = '';
    if (side === 'bottom') { tail.style.left = tx - 7 + 'px'; tail.style.top = '-6px'; }
    else if (side === 'top') { tail.style.left = tx - 7 + 'px'; tail.style.bottom = '-6px'; }
    else if (side === 'right') { tail.style.top = ty - 7 + 'px'; tail.style.left = '-6px'; }
    else { tail.style.top = ty - 7 + 'px'; tail.style.right = '-6px'; }
    bubble.style.setProperty('--ox', side === 'right' ? '0%' : side === 'left' ? '100%' : tx + 'px');
    bubble.style.setProperty('--oy', side === 'bottom' ? '0%' : side === 'top' ? '100%' : ty + 'px');
  }
  const reflow = (): void => {   // hitung ulang posisi (layar diputar, panel selesai bergeser, dst.)
    if (!active || !cur) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (active && cur) place(cur, resolve(cur)); });
  };

  // ---------- menampilkan langkah ----------
  const list = (): Step[] => STEPS.filter(s => !s.skipIf?.());
  function paint(s: Step, els: HTMLElement[]): void {
    const all = list(), n = all.indexOf(s) + 1;
    cur = s;
    elCount.textContent = n + ' / ' + all.length;
    elTitle.textContent = s.title; elText.textContent = s.text;
    btnPrev.hidden = n <= 1;
    btnNext.textContent = s.primary ?? (n >= all.length ? 'Selesai' : 'Lanjut');
    bubble.classList.remove('is-pop'); void bubble.offsetWidth;   // ulangi animasi muncul
    place(s, els);
    bubble.classList.add('is-pop');
    if (viaKeyboard) btnNext.focus({ preventScroll: true });   // fokus otomatis hanya untuk pengguna keyboard (tanpa cincin fokus untuk sentuhan / mouse)
    const my = token; setTimeout(() => { if (my === token) reflow(); }, 480);   // jaga-jaga: panel yang masih beranimasi
  }
  async function show(i: number, dir: 1 | -1): Promise<void> {
    const my = ++token;
    while (i >= 0 && i < STEPS.length) {
      const s = STEPS[i];
      if (s.skipIf?.()) { i += dir; continue; }
      await setScene(s);
      if (my !== token) return;
      await bring(s);
      if (my !== token) return;
      const els = resolve(s);
      if (s.targets && !els.length) { i += dir; continue; }   // target tidak tampil: lewati
      idx = i; paint(s, els); return;
    }
    if (i >= STEPS.length) void finish(); else void show(0, 1);
  }

  async function start(): Promise<void> {
    if (active) return;
    active = true; document.body.classList.add('tut-on'); root.hidden = false;
    window.addEventListener('resize', reflow); window.addEventListener('scroll', reflow, true);
    await show(0, 1);
  }
  async function finish(): Promise<void> {
    if (!active) return;
    active = false; cur = null; token++; markSeen();
    root.hidden = true; document.body.classList.remove('tut-on');
    window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true);
    const menuBtn = $<HTMLButtonElement>('#menuBtn');
    closeTrackMenu();
    if (menuBtn?.classList.contains('is-open')) menuBtn.click();
    launch.focus({ preventScroll: true });
  }

  // ---------- event: ditangani di fase capture window supaya ketukan di gelembung tidak menutup menu / panel di belakangnya ----------
  const inside = (e: Event): boolean => e.target instanceof Node && root.contains(e.target);
  for (const t of ['pointerdown', 'mousedown', 'touchstart'] as const) window.addEventListener(t, e => { if (active && inside(e)) e.stopPropagation(); }, true);
  window.addEventListener('click', e => {
    if (!active || !inside(e)) return;
    e.stopPropagation();
    const b = (e.target as Element).closest<HTMLElement>('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'close') void finish();
    else if (a === 'prev') void show(idx - 1, -1);
    else if (a === 'next') { if (idx >= STEPS.length - 1) void finish(); else void show(idx + 1, 1); }
  }, true);
  window.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); void finish(); return; }
    if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) { e.stopPropagation(); e.preventDefault(); if (idx >= STEPS.length - 1) void finish(); else void show(idx + 1, 1); }
    else if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) { e.stopPropagation(); e.preventDefault(); void show(idx - 1, -1); }
    else if ((e.key === ' ' || e.key === 'Enter') && inside(e)) e.stopPropagation();   // Space / Enter pada tombol gelembung tidak boleh ikut memutar DAW
  }, true);
  window.addEventListener('keyup', e => { if (active && e.key === ' ' && inside(e)) e.stopPropagation(); }, true);

  launch.addEventListener('click', () => { void start(); });

  // pertama kali dibuka: tawarkan tutorial sekali (kalau piano roll sedang tidak terbuka)
  if (!seen()) setTimeout(() => { if (!seen() && !active && !$('.pr.is-open')) void start(); }, 1200);
}
