// Profil pembeli (versi full): nama + foto dari /api/profile dan /api/avatar. Di build lain semua fungsi ini tidak dipakai (dibuang bundler).
export interface Profile { email: string; name: string | null; avatar: string | null }
export const FULL: boolean = typeof __FULL__ !== 'undefined' && __FULL__;

const KEY = 'mx_prof';   // salinan terakhir, supaya nama tetap tampil saat offline
let prof: Profile | null = null;
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());
const keep = (): void => { try { localStorage.setItem(KEY, JSON.stringify(prof)); } catch { /* abaikan */ } };
if (FULL) { try { prof = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { prof = null; } }   // di build demo tidak menyentuh localStorage sama sekali

export const getProfile = (): Profile | null => prof;
export function onProfile(f: () => void): void { subs.add(f); }
export const shownName = (p: Profile | null): string => (p ? p.name || p.email.split('@')[0] || 'Akun' : 'Akun');
export const initialOf = (p: Profile | null): string => (shownName(p).trim().charAt(0) || '?').toUpperCase();
export const forgetProfile = (): void => { prof = null; try { localStorage.removeItem(KEY); } catch { /* abaikan */ } };

const errOf = async (r: Response): Promise<string> => { try { return ((await r.json()) as { error?: string }).error || 'Gagal (' + r.status + ')'; } catch { return 'Gagal (' + r.status + ')'; } };

export async function loadProfile(): Promise<void> {
  if (!FULL) return;
  try {
    const r = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) { prof = (await r.json()) as Profile; keep(); emit(); }
  } catch { /* offline: tetap pakai salinan terakhir */ }
}

// Mengembalikan pesan galat, atau null kalau berhasil.
export async function saveName(name: string): Promise<string | null> {
  try {
    const r = await fetch('/api/profile', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!r.ok) return await errOf(r);
    const j = (await r.json()) as { name: string | null };
    if (prof) { prof.name = j.name; keep(); emit(); }
    return null;
  } catch { return 'Tidak bisa terhubung ke server.'; }
}

// Foto dipotong persegi di tengah, diperkecil 256x256, jadi JPEG (puluhan KB) sebelum diunggah.
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const S = 256, side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);   // PNG transparan -> latar putih (JPEG tidak punya alfa)
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  bmp.close?.();
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
}

export async function uploadAvatar(file: File): Promise<string | null> {
  if (!/^image\//.test(file.type)) return 'File harus berupa gambar.';
  let blob: Blob;
  try { blob = await toJpeg(file); } catch { return 'Gambar tidak bisa dibaca. Coba foto lain (JPG / PNG / WebP).'; }
  try {
    const r = await fetch('/api/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (!r.ok) return await errOf(r);
    const j = (await r.json()) as { avatar: string };
    if (prof) { prof.avatar = j.avatar; keep(); emit(); }
    return null;
  } catch { return 'Tidak bisa terhubung ke server.'; }
}

export async function removeAvatar(): Promise<string | null> {
  try {
    const r = await fetch('/api/avatar', { method: 'DELETE', credentials: 'same-origin' });
    if (!r.ok) return await errOf(r);
    if (prof) { prof.avatar = null; keep(); emit(); }
    return null;
  } catch { return 'Tidak bisa terhubung ke server.'; }
}
