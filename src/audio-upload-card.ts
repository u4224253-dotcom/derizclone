// Card upload audio: muncul di tempat menu "Tambahkan track" setelah memilih "Audio clip".
// Isinya hanya satu tombol putih "Upload audio". File yang dipilih disimpan di trackAudioFiles
// (kunci = id track) supaya tahap berikutnya (decode, waveform, playback) tinggal membacanya.

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|m4a|aac|flac|opus|weba|webm)$/i;
export const ACCEPT = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus';

export const trackAudioFiles = new Map<number, File>();

export interface UploadAnchor {
  left: number;        // posisi menu tambah track yang baru saja ditutup
  top: number;
  bottom: number;
  width: number;
  fromBottom: boolean; // menu tadi terbuka ke atas tombol (menempel di bawah)
}

let current: { close: (instant?: boolean) => void } | null = null;

export const isAudio = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);

const ICON_UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 19h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function openAudioUploadCard(trackId: number, anchor: UploadAnchor, onPick?: (file: File) => void): void {
  if (current) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const card = document.createElement('div');
  card.className = 'upl-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Upload audio');
  card.innerHTML = `<button type="button" class="upl-btn">${ICON_UP}<span>Upload audio</span></button>` +
    `<input type="file" class="upl-input" accept="${ACCEPT}" hidden>`;
  const btn = card.querySelector<HTMLButtonElement>('.upl-btn')!;
  const input = card.querySelector<HTMLInputElement>('.upl-input')!;

  let closed = false;
  const close = (instant = false) => {
    if (closed) return;
    closed = true; current = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    const finish = () => { card.remove(); prevFocus?.isConnected && prevFocus.focus({ preventScroll: true }); };
    if (instant || reduce) { finish(); return; }
    card.style.pointerEvents = 'none';
    card.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9) translateY(-4px)' }],
      { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }
    ).onfinish = finish;
  };
  const onOutside = (e: PointerEvent) => { if (!card.contains(e.target as Node)) close(); };
  const onResize = () => close(true);
  current = { close };

  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    if (!isAudio(f)) {   // bukan file audio: tombol bergetar, pilih ulang
      input.value = '';
      btn.classList.remove('is-shake'); void btn.offsetWidth; btn.classList.add('is-shake');
      return;
    }
    trackAudioFiles.set(trackId, f);
    close();
    onPick?.(f);
  });
  // pintasan DAW (Space, panah, dll.) tidak boleh ikut jalan saat card terbuka; Esc menutup
  card.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  card.addEventListener('keyup', e => e.stopPropagation());

  // posisi: persis di tempat menu tadi (ke atas atau ke bawah tombol "Tambahkan track")
  document.body.appendChild(card);
  const w = Math.min(anchor.width || 230, innerWidth - 16), h = card.offsetHeight;
  card.style.width = w + 'px';
  card.style.left = Math.max(8, Math.min(anchor.left, innerWidth - w - 8)) + 'px';
  const top = anchor.fromBottom ? anchor.bottom - h : anchor.top;
  card.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + 'px';
  card.style.transformOrigin = anchor.fromBottom ? 'left bottom' : 'left top';

  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', onResize);
  btn.focus({ preventScroll: true });
}
