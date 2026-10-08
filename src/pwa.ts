// PWA: pendaftaran service worker + status / aksi "Install ke layar utama".
// Listener beforeinstallprompt dipasang saat modul ini dimuat (paling awal) supaya event-nya tidak terlewat.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// installed = sudah terpasang / dibuka dari layar utama; ready = tombol Install siap dipakai;
// ios = Safari iOS (harus manual lewat Share); manual = browser belum menawarkan install, pakai menu browser
export type InstallState = 'installed' | 'ready' | 'ios' | 'manual';

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((f) => f());

const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();   // simpan dulu, ditampilkan saat tombol Install ditekan
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

export function installState(): InstallState {
  if (isStandalone()) return 'installed';
  if (deferred) return 'ready';
  return isIOS() ? 'ios' : 'manual';
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null;   // event hanya boleh dipakai sekali
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notify();
  return outcome;
}

export function onInstallChange(cb: () => void): void { listeners.add(cb); }

// Service worker hanya didaftarkan pada hasil build (npm run build / preview), bukan saat npm run dev.
export function registerSW(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => { /* gagal daftar: aplikasi tetap jalan online seperti biasa */ });
  });
}
