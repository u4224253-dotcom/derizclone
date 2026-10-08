// Kepemilikan plugin berbayar (Manage Plugin, versi full). Server menyimpan token plugin yang sudah ditebus (/api/shop).
// Di build demo / dev semua plugin dianggap terbuka (fungsi owns() selalu true), perilaku lama tidak berubah.
// CATATAN: ini gembok di sisi aplikasi (UI). Kodenya masih ada di bundle; pemisahan chunk berotorisasi adalah tahap berikutnya.
import { FULL } from './account';

export const PAID: readonly string[] = [];   // kosong: MGCHORD sekarang gratis (harus sama dengan server/plugins.ts)
const KEY = 'mx_plg';
const GRACE_MS = 7 * 24 * 3600 * 1000;      // salinan lokal boleh dipakai offline paling lama 7 hari sejak dikonfirmasi server

let owned = new Set<string>();
let pending = new Set<string>();   // sudah dipesan (Beli), menunggu token dari admin
let at = 0;
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());

if (FULL) {
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null') as { owned: string[]; at: number } | null; if (j) { owned = new Set(j.owned); at = j.at; } } catch { /* abaikan */ }
}
const keep = (): void => { try { localStorage.setItem(KEY, JSON.stringify({ owned: [...owned], at })); } catch { /* abaikan */ } };

export const isPaid = (id: string): boolean => (PAID as readonly string[]).includes(id);
export const owns = (id: string): boolean => !FULL || !isPaid(id) || (owned.has(id) && Date.now() - at < GRACE_MS);
export const isPending = (id: string): boolean => FULL && !owned.has(id) && pending.has(id);
export const onEntitlements = (f: () => void): void => { subs.add(f); };

export async function loadEntitlements(): Promise<void> {
  if (!FULL) return;
  try {
    const r = await fetch('/api/shop', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) { const j = (await r.json()) as { owned: string[]; pending?: string[] }; owned = new Set(j.owned); pending = new Set(j.pending || []); at = Date.now(); keep(); emit(); }
  } catch { /* offline: pakai salinan terakhir */ }
}
if (FULL) {
  void loadEntitlements();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void loadEntitlements(); });
}

// Tebus token plugin. Mengembalikan { ok: true, plugin } atau { ok: false, error }.
export async function redeemPlugin(token: string): Promise<{ ok: true; plugin: string } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/shop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redeem', token }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; plugin?: string; owned?: string[]; pending?: string[] };
    if (!r.ok || !j.plugin) return { ok: false, error: j.error || 'Gagal (' + r.status + ')' };
    owned = new Set(j.owned || [j.plugin]); pending = new Set(j.pending || []); at = Date.now(); keep(); emit();
    return { ok: true, plugin: j.plugin };
  } catch { return { ok: false, error: 'Tidak bisa terhubung ke server.' }; }
}

// Pesan plugin (tombol Beli + konfirmasi). Server membuat token otomatis dan mengunci ke akun ini; token masuk dashboard admin,
// pembeli memintanya ke admin lalu menebusnya di akun yang sama. Token tidak pernah dikirim ke pembeli.
export async function buyPlugin(plugin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/shop', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'buy', plugin }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean; pending?: string[]; owned?: string[] };
    if (!r.ok || !j.ok) return { ok: false, error: j.error || 'Gagal (' + r.status + ')' };
    pending = new Set(j.pending || [plugin]); if (j.owned) owned = new Set(j.owned); at = Date.now(); keep(); emit();
    return { ok: true };
  } catch { return { ok: false, error: 'Tidak bisa terhubung ke server.' }; }
}

// Minta Menu membuka halaman Manage Plugin (didengarkan menu-panel).
export const openShop = (): void => { document.dispatchEvent(new CustomEvent('shop:open')); };

// Pemberitahuan kecil: plugin belum dimiliki -> tawarkan ke Shop.
export function lockedNotice(name: string): void {
  if (document.getElementById('plg-lock')) return;
  const d = document.createElement('div');
  d.id = 'plg-lock'; d.className = 'svov'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', name + ' belum dimiliki');
  d.innerHTML = '<div class="svov__back"></div><div class="svov__card"><h3 class="svov__title">' + name + ' belum dimiliki</h3>' +
    '<p class="plg__txt">Plugin ini dijual terpisah. Buka Manage Plugin untuk membeli atau menebus token.</p>' +
    '<div class="plg__row"><button type="button" class="plg__btn plg__btn--ghost" data-x="close">Tutup</button><button type="button" class="plg__btn" data-x="shop">Buka Shop</button></div></div>';
  const close = (): void => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  d.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('svov__back') || t.dataset.x === 'close') close();
    else if (t.dataset.x === 'shop') { close(); openShop(); }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(d);
  d.querySelector<HTMLButtonElement>('[data-x="shop"]')?.focus();
}
