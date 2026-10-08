// Plugin Drums: step sequencer untuk menyusun pola drum di pattern yang dipilih di timeline.
// Satu baris per alat (Kick, Snare, Clap, ...), 16 step per bar (1 step = 1/16). Ketuk / seret di grid untuk menambah atau menghapus hit;
// perubahan langsung ditulis ke nada pattern (piano roll), jadi pola bisa disalin, dipanjangkan, dan disimpan bersama project seperti pattern biasa.
// Kartunya ada di halaman Plugin pada panel efek (fx-rack.ts); jendelanya dibuka dari kartu itu.

import { DRUM_KIT, PAD_DEF } from './drums-audio';

export interface DrumNote { p: number; s: number; l: number; v?: number }
export interface DrumsView { notes: DrumNote[]; beats: number; label: string }
export interface DrumsBridge {
  /** Pattern yang sedang dipilih; string = alasan kenapa belum bisa dipakai. */
  get(): DrumsView | string;
  /** Tulis nada ke pattern yang sedang dipilih (menggantikan semua nada). */
  set(notes: DrumNote[]): void;
  /** Tambah satu bar di akhir pattern kalau ada ruang; false = tidak muat. */
  grow(): boolean;
  /** Bunyikan satu hit (audisi). */
  hit(midi: number): void;
  /** Volume per alat (kunci = id alat, 0..1) milik track pattern yang dipilih. */
  pads(): Record<string, number>;
  setPad(id: string, v: number): void;
  /** Transport: sedang play? / play-pause. */
  playing(): boolean;
  toggle(): void;
}
let bridge: DrumsBridge | null = null;
/** Drums disembunyikan sementara: tidak muncul di menu "Tambahkan track" dan di tombol + panel efek. Kode dan project lama yang sudah punya track Drums tetap jalan. Ubah ke false untuk menampilkannya lagi. */
export const DRUMS_HIDDEN = true;
export const setDrumsBridge = (b: DrumsBridge): void => { bridge = b; };

const STEP = 0.25;                 // beat per step (1/16)
const PER_BAR = 16;
const MAX_BARS = 8;
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let root: HTMLElement | null = null, openFn: (() => void) | null = null, refreshFn: (() => void) | null = null;

export function openDrums(): void { if (!root) build(); openFn?.(); }
export function drumsRefresh(): void { if (root && !root.hidden) refreshFn?.(); }
export function drumsSyncPlay(): void { /* play / pause dikontrol dari card transport di bawah; tidak ada tombol play di jendela */ }

function build(): void {
  const el = document.createElement('div');
  el.className = 'drm'; el.hidden = true;
  el.innerHTML =
    '<div class="drm__win" role="dialog" aria-label="Drums" tabindex="-1">' +
      `<header class="drm__head"><span class="drm__title">DRUMS</span><i class="drm__led" aria-hidden="true"></i><span class="drm__stat" role="status" aria-live="polite"></span>` +
        `<button type="button" class="drm__btn" data-x="grow" title="Tambah 1 bar di akhir pattern">+ Bar</button>` +
        `<button type="button" class="drm__btn" data-x="clear" title="Hapus semua hit di pattern ini">Clear</button>` +
        `<button type="button" class="drm__close" aria-label="Tutup Drums">${ICON_CLOSE}</button></header>` +
      '<div class="drm__body"><div class="drm__labels"></div><div class="drm__scroll"><div class="drm__grid" role="grid" aria-label="Step sequencer drum"></div></div></div>' +
      '<p class="drm__msg" hidden></p>' +
    '</div>';
  document.body.appendChild(el);
  root = el;

  const win = el.querySelector<HTMLElement>('.drm__win')!;
  const stat = el.querySelector<HTMLElement>('.drm__stat')!;
  const labels = el.querySelector<HTMLElement>('.drm__labels')!;
  const grid = el.querySelector<HTMLElement>('.drm__grid')!;
  const msg = el.querySelector<HTMLElement>('.drm__msg')!;
  const body = el.querySelector<HTMLElement>('.drm__body')!;
  win.style.setProperty('--n', String(DRUM_KIT.length));

  // full screen, tapi batas bawahnya tepat di atas card transport (play / pause); card itu tetap bisa dipakai untuk mengontrol Drums
  const dock = document.getElementById('dockCard');
  const fit = (): void => {
    const h = window.innerHeight, r = dock ? dock.getBoundingClientRect() : null;
    const top = r && r.height > 0 && r.top < h ? r.top : h;
    el.style.setProperty('--drm-b', Math.max(0, Math.round(h - top)) + 'px');
  };
  window.addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  if (dock && 'ResizeObserver' in window) { const ro = new ResizeObserver(fit); ro.observe(dock); ro.observe(document.body); const kb = document.getElementById('kbd'); if (kb) ro.observe(kb); }   // tinggi keyboard / card berubah (diseret atau panel ditutup): batas bawah ikut

  labels.innerHTML = DRUM_KIT.map(d => `<div class="drm__lab"><button type="button" class="drm__name" data-m="${d.midi}" title="Dengarkan ${d.name}">${d.name}</button>` +
    `<input type="range" class="drm__vol" min="0" max="100" step="1" value="${Math.round(PAD_DEF * 100)}" style="--p:${Math.round(PAD_DEF * 100)}%" data-id="${d.id}" aria-label="Volume ${d.name}" title="Volume ${d.name}"></div>`).join('');
  let bars = 0, view: DrumsView | null = null;

  // ---------- gambar grid dari nada pattern ----------
  const paint = (): void => {
    const v = bridge ? bridge.get() : 'Belum tersambung ke timeline';
    if (typeof v === 'string') { view = null; body.hidden = true; msg.hidden = false; msg.textContent = v; stat.textContent = ''; return; }
    view = v; body.hidden = false; msg.hidden = true;
    const nb = Math.max(1, Math.min(MAX_BARS, Math.ceil(v.beats / 4 - 1e-6)));
    stat.textContent = v.label + ' · ' + nb + ' bar';
    const on = new Set<string>();
    for (const n of v.notes) { const k = Math.round(n.s / STEP); if (Math.abs(k * STEP - n.s) < 1e-3) on.add(n.p + ':' + k); }
    if (nb !== bars || grid.childElementCount !== DRUM_KIT.length) {   // jumlah bar berubah: bangun ulang kerangkanya
      bars = nb;
      grid.style.setProperty('--steps', String(nb * PER_BAR));
      grid.innerHTML = DRUM_KIT.map(d => {
        let r = `<div class="drm__row" role="row" data-m="${d.midi}">`;
        for (let k = 0; k < nb * PER_BAR; k++) r += `<button type="button" class="drm__c${k % 16 === 0 ? ' is-bar' : ''}${(k >> 2) % 2 ? ' is-alt' : ''}" role="gridcell" data-k="${k}" aria-label="${d.name} step ${k + 1}" aria-pressed="false"></button>`;
        return r + '</div>';
      }).join('');
    }
    const pads = bridge ? bridge.pads() : {};
    labels.querySelectorAll<HTMLInputElement>('.drm__vol').forEach(r => { r.value = String(Math.round((pads[r.dataset.id!] ?? PAD_DEF) * 100)); r.style.setProperty('--p', r.value + '%'); });
    grid.querySelectorAll<HTMLElement>('.drm__row').forEach(row => {
      const m = +row.dataset.m!;
      row.querySelectorAll<HTMLElement>('.drm__c').forEach(c => {
        const a = on.has(m + ':' + c.dataset.k);
        if (c.classList.contains('is-on') !== a) { c.classList.toggle('is-on', a); c.setAttribute('aria-pressed', String(a)); }
      });
    });
  };
  refreshFn = paint;

  // ---------- ketuk / seret untuk menambah atau menghapus hit ----------
  const setStep = (m: number, k: number, want: boolean): void => {
    if (!view || !bridge) return;
    const s = k * STEP;
    if (s >= view.beats - 1e-6) return;
    const has = view.notes.some(n => n.p === m && Math.abs(n.s - s) < 1e-3);
    if (has === want) return;
    const notes = want ? [...view.notes, { p: m, s, l: STEP }] : view.notes.filter(n => !(n.p === m && Math.abs(n.s - s) < 1e-3));
    bridge.set(notes);
    view = { ...view, notes };
    const c = grid.querySelector<HTMLElement>(`.drm__row[data-m="${m}"] .drm__c[data-k="${k}"]`);
    if (c) { c.classList.toggle('is-on', want); c.setAttribute('aria-pressed', String(want)); }
    if (want) bridge.hit(m);
  };
  const cellAt = (x: number, y: number): HTMLElement | null => {
    const c = document.elementFromPoint(x, y)?.closest<HTMLElement>('.drm__c');
    return c && grid.contains(c) ? c : null;
  };
  let paintTo: boolean | null = null, pid = -1, last: HTMLElement | null = null;
  grid.addEventListener('pointerdown', e => {
    const c = (e.target as Element).closest<HTMLElement>('.drm__c'); if (!c || e.button > 0) return;
    e.preventDefault();
    paintTo = !c.classList.contains('is-on'); pid = e.pointerId; last = c;
    setStep(+(c.parentElement as HTMLElement).dataset.m!, +c.dataset.k!, paintTo);
    try { grid.setPointerCapture(e.pointerId); } catch { /* sudah lepas */ }
  });
  grid.addEventListener('pointermove', e => {
    if (paintTo === null || e.pointerId !== pid) return;
    const c = cellAt(e.clientX, e.clientY); if (!c || c === last) return;
    last = c; setStep(+(c.parentElement as HTMLElement).dataset.m!, +c.dataset.k!, paintTo);
  });
  const end = (e: PointerEvent): void => { if (e.pointerId === pid) { paintTo = null; pid = -1; last = null; } };
  grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
  grid.addEventListener('keydown', e => {   // Enter / Spasi di sel (akses keyboard)
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = (e.target as Element).closest<HTMLElement>('.drm__c'); if (!c) return;
    e.preventDefault(); setStep(+(c.parentElement as HTMLElement).dataset.m!, +c.dataset.k!, !c.classList.contains('is-on'));
  });
  labels.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLElement>('.drm__name'); if (b && bridge) bridge.hit(+b.dataset.m!); });
  labels.addEventListener('input', e => { const r = e.target as HTMLInputElement; if (r.classList.contains('drm__vol') && bridge) { r.style.setProperty('--p', r.value + '%'); bridge.setPad(r.dataset.id!, +r.value / 100); } });
  labels.addEventListener('change', e => { const r = e.target as HTMLInputElement; if (r.classList.contains('drm__vol') && bridge) { const m = DRUM_KIT.find(d => d.id === r.dataset.id)?.midi; if (m !== undefined) bridge.hit(m); } });   // lepas slider: dengarkan hasilnya

  el.querySelector<HTMLElement>('[data-x="clear"]')!.addEventListener('click', () => {
    if (!view || !bridge) return;
    const kit = new Set(DRUM_KIT.map(d => d.midi)), notes = view.notes.filter(n => !kit.has(n.p));   // nada lain (di luar kit) dibiarkan
    bridge.set(notes); paint();
  });
  el.querySelector<HTMLElement>('[data-x="grow"]')!.addEventListener('click', () => {
    if (!bridge) return;
    if (!bridge.grow()) { stat.textContent = 'Tidak ada ruang kosong di sebelah kanan pattern'; setTimeout(paint, 1800); return; }
    paint();
  });

  // ---------- buka / tutup ----------
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => { el.hidden = true; document.removeEventListener('keydown', onKey, true); };
  el.querySelector('.drm__close')!.addEventListener('click', close);
  el.addEventListener('keydown', e => e.stopPropagation()); el.addEventListener('keyup', e => e.stopPropagation());   // pintasan DAW (Space, panah) tidak ikut jalan
  openFn = (): void => {
    if (!el.hidden) { win.focus({ preventScroll: true }); return; }
    el.hidden = false; fit(); paint();
    document.addEventListener('keydown', onKey, true);
    win.focus({ preventScroll: true });
  };
}
