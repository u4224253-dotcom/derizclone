// Tombol "Landscape": layar penuh + kunci orientasi mendatar (Chrome Android). Ketuk lagi untuk keluar.
// screen.orientation.lock() hanya jalan saat layar penuh dan dari sentuhan pengguna, jadi keduanya dipanggil dari satu klik.
// Di browser yang tidak mendukung (mis. iPhone Safari) tombol disembunyikan.

const ICON_ENTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_EXIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v3a1 1 0 0 1-1 1H4M20 8h-3a1 1 0 0 1-1-1V4M16 20v-3a1 1 0 0 1 1-1h3M4 16h3a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function initLandscape(): void {
  const root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) return;
  const ori = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'landscape-btn';
  const sync = (): void => {
    const on = !!document.fullscreenElement;
    btn.innerHTML = on ? ICON_EXIT : ICON_ENTER;
    btn.title = btn.ariaLabel = on ? 'Keluar layar penuh' : 'Layar penuh + putar landscape';
  };
  sync();

  btn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await root.requestFullscreen({ navigationUI: 'hide' });
      try { await ori.lock?.('landscape'); } catch { /* tidak didukung: tetap layar penuh */ }
    } catch (err) { console.warn('Layar penuh gagal:', err); }
  });

  document.addEventListener('fullscreenchange', () => {
    sync();
    if (!document.fullscreenElement) { try { ori.unlock?.(); } catch { /* abaikan */ } }
  });

  document.body.appendChild(btn);
}
