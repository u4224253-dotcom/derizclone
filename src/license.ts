// Pemeriksa lisensi sisi aplikasi (hanya build full: `vite build --mode full`; di build lain seluruh isi fungsi dibuang bundler).
// Gerbang SEBENARNYA ada di server (middleware.ts). Pemeriksa ini menutup celah PWA: aplikasi yang sudah ter-cache untuk offline
// tetap harus "lapor" ke server secara berkala, dan lisensi yang dicabut langsung dikeluarkan.
const GRACE_MS = 7 * 24 * 3600 * 1000;   // boleh offline paling lama 7 hari sejak verifikasi online terakhir
const EVERY_MS = 30 * 60 * 1000;         // cek ulang tiap 30 menit selama aplikasi terbuka
const KEY = 'mx_last_ok';

const lastOk = (): number => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const markOk = (): void => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* abaikan */ } };

async function wipeAndLeave(): Promise<void> {
  try { for (const k of await caches.keys()) if (k.startsWith('derizmp3-')) await caches.delete(k); } catch { /* abaikan */ }
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { /* abaikan */ }
  try { localStorage.removeItem(KEY); } catch { /* abaikan */ }
  location.replace('/login');
}

function offlineWall(): void {
  if (document.getElementById('lic-wall')) return;
  const d = document.createElement('div'); d.id = 'lic-wall';
  d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#16161c;color:#e8e8f0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font:14px/1.5 system-ui,sans-serif';
  d.innerHTML = '<div><h2 style="margin:0 0 8px">Verifikasi lisensi diperlukan</h2><p style="margin:0 0 16px;color:#8a8a9a">Sudah lebih dari 7 hari aplikasi tidak terhubung ke internet. Sambungkan internet, lalu muat ulang.</p><button style="padding:10px 18px;border:0;border-radius:12px;background:#a66cff;color:#14101f;font:inherit;font-weight:700;cursor:pointer">Muat ulang</button></div>';
  d.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}

async function check(): Promise<void> {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { await wipeAndLeave(); return; }
    if (r.ok) { markOk(); document.getElementById('lic-wall')?.remove(); return; }
  } catch { /* offline / server tak terjangkau: jatuh ke masa tenggang di bawah */ }
  if (Date.now() - lastOk() > GRACE_MS) offlineWall();
}

// Keluar dari akun ini: hapus sesi di server, kosongkan cache aplikasi, kembali ke halaman login.
export async function signOut(): Promise<void> {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* tetap lanjut: cache dihapus di bawah */ }
  try { localStorage.removeItem('mx_prof'); } catch { /* abaikan */ }
  await wipeAndLeave();
}

export function startLicenseGuard(): void {
  if (typeof __FULL__ === 'undefined' || !__FULL__) return;
  void check();
  setInterval(() => void check(), EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
}
