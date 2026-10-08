// Halaman "Manage Plugin" di Menu (kategori sejajar Project / Export / Pengaturan).
// Plugin gratis / bawaan = status "Terpasang". Plugin berbayar (entitlements.ts PAID, sekarang MGCHORD) di build full: "Dimiliki" kalau
// token plugin sudah ditebus. Alur: tombol "Beli" + konfirmasi -> server membuat token otomatis (dikunci ke akun ini) dan masuk dashboard admin
// -> status "Menunggu token dari admin" -> pembeli meminta token ke admin -> "Tebus token" (hanya akun yang memesan yang bisa menebus).
// Dua tab: "Plugin saya" (bawaan/gratis + berbayar yang sudah dimiliki) dan "Shop" (berbayar yang belum dimiliki: Beli / Tebus token).
// Plugin pindah dari Shop ke Plugin saya begitu tokennya ditebus. Tampilan memakai kelas menu yang sama (mp__seg/mp__segbtn, mp__card), lihat blok ".shop" di styles.css.

import { FULL } from './account';
import { buyPlugin, isPaid, isPending, onEntitlements, owns, redeemPlugin } from './entitlements';

type ShopKind = 'instrument' | 'effect';
interface ShopItem { id: string; name: string; kind: ShopKind; desc: string; img: string; ar: string }

const CATALOG: ShopItem[] = [
  { id: 'deriz', name: 'DERIZ', kind: 'instrument', desc: 'Sampler: upload audio, mainkan dari keyboard atau piano roll, atur Speed, Pitch, dan Volume.', img: 'deriz', ar: '720/465' },
  { id: 'mpcs', name: 'MPCS', kind: 'instrument', desc: 'Manual Pitch Correct Sample: edit pitch sample dengan blok nada, seret naik atau turun.', img: 'mpcs', ar: '720/400' },
  { id: 'mgchord', name: 'MGCHORD', kind: 'instrument', desc: 'Pembuat chord progression: pilih Key, Length, Sound, dan Style strum.', img: 'mgchord', ar: '720/419' },
  { id: 'supersaw', name: 'Supersaw', kind: 'instrument', desc: 'Synth supersaw dengan Detune, Mix, filter, dan envelope.', img: 'supersaw', ar: '720/467' },
  { id: 'reverb', name: 'Reverb', kind: 'effect', desc: 'Gema ruang: Mix, Size, Pre-Delay, Tone, dan Low Cut.', img: 'reverb', ar: '1/1' },
  { id: 'equalizer', name: 'Equalizer', kind: 'effect', desc: 'EQ 5 band dengan grafik respons dan level Output.', img: 'equalizer', ar: '4/5' },
  { id: 'filter', name: 'Filter', kind: 'effect', desc: 'Low-pass dan high-pass dalam satu knob Cutoff, plus Reso.', img: 'filter', ar: '720/467' },
  { id: 'deesser', name: 'De-esser', kind: 'effect', desc: 'Meredam desis (sibilance) pada vokal: Freq, Thresh, Amount.', img: 'deesser', ar: '720/467' },
  { id: 'delay', name: 'Delay', kind: 'effect', desc: 'Delay stereo dengan panel sendiri.', img: 'delay', ar: '720/436' },
];

// Harga tampil di kartu (isi kalau mau menampilkan harga, mis. { mgchord: 'Rp 49.000' }); kosong = tanpa harga.
const PRICE: Record<string, string> = {};
// Tautan "Beli token" (mis. https://wa.me/62812xxxxxxx?text=Mau%20beli%20MGCHORD). Diisi lewat env build VITE_SHOP_CONTACT_URL; kosong = tombol disembunyikan.
const CONTACT = String(import.meta.env.VITE_SHOP_CONTACT_URL || '');
const SAFE_CONTACT = /^https:\/\//.test(CONTACT) ? CONTACT : '';

const KIND_LABEL: Record<ShopKind, string> = { instrument: 'Instrumen', effect: 'Efek' };
const esc = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// Gambar tiap plugin = screenshot tampilan aslinya (public/shop/<img>.webp)
const IMG_BASE = import.meta.env.BASE_URL + 'shop/';

const IC_SHOP ='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>';
const IC_CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

// Tombol kategori di halaman utama Menu
export const SHOP_CAT =
  '<button type="button" class="mp__cat mp__item" style="--i:3" data-go="shop">' + IC_SHOP +
  '<span class="mp__cat__t"><b>Manage Plugin</b><small>Plugin saya &amp; Shop</small></span>' + IC_CHEV + '</button>';

// Halaman Manage Plugin (data-page="shop", memakai sistem halaman Menu: ada tombol kembali)
export const SHOP_PAGE =
  '<section class="mp__page shop" data-page="shop" aria-label="Manage Plugin" hidden>' +
    '<div class="mp__seg mp__item" style="--i:1" role="radiogroup" aria-label="Bagian plugin">' +
      '<button type="button" class="mp__segbtn is-on" role="radio" aria-checked="true" data-shopt="mine">Plugin saya<span class="shop__n" data-n="mine"></span></button>' +
      '<button type="button" class="mp__segbtn" role="radio" aria-checked="false" data-shopt="shop">Shop<span class="shop__n" data-n="shop"></span></button>' +
    '</div>' +
    '<div class="mp__seg shop__kinds mp__item" style="--i:2" role="radiogroup" aria-label="Jenis plugin">' +
      '<button type="button" class="mp__segbtn is-on" role="radio" aria-checked="true" data-shopf="all">Semua</button>' +
      '<button type="button" class="mp__segbtn" role="radio" aria-checked="false" data-shopf="instrument">Instrumen</button>' +
      '<button type="button" class="mp__segbtn" role="radio" aria-checked="false" data-shopf="effect">Efek</button>' +
    '</div>' +
    '<ul class="shop__list mp__item" style="--i:3">' +
      CATALOG.map(p =>
        '<li class="shop__item mp__card" data-kind="' + p.kind + '" data-plugin="' + p.id + '">' +
          '<div class="shop__art" style="aspect-ratio:' + p.ar + '"><img src="' + IMG_BASE + p.img + '.webp" alt="Tampilan plugin ' + esc(p.name) + '" loading="lazy" decoding="async"></div>' +
          '<div class="shop__top"><b class="shop__name">' + esc(p.name) + '</b><span class="shop__tag">' + KIND_LABEL[p.kind] + '</span></div>' +
          '<p class="shop__desc">' + esc(p.desc) + '</p>' +
          (FULL && isPaid(p.id) ? '<div class="shop__act" data-act="' + p.id + '"></div>' : '<span class="shop__state"><i aria-hidden="true"></i>Terpasang</span>') +
        '</li>').join('') +
    '</ul>' +
    '<p class="mp__hint shop__empty" hidden></p>' +
  '</section>';

// Tab Plugin saya / Shop + filter Semua / Instrumen / Efek (hanya menyembunyikan kartu; tidak menyimpan apa pun).
// Plugin "saya" = bawaan/gratis atau berbayar yang sudah ditebus; sisanya (berbayar, belum dimiliki) ada di Shop.
const isMine = (id: string): boolean => !(FULL && isPaid(id)) || owns(id);

export function initShopPage(panel: HTMLElement): void {
  const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[data-shopt]')];
  const chips = [...panel.querySelectorAll<HTMLButtonElement>('[data-shopf]')];
  const items = [...panel.querySelectorAll<HTMLElement>('.shop__item')];
  const empty = panel.querySelector<HTMLElement>('.shop__empty')!;
  let tab = 'mine', kind = 'all';
  const apply = (): void => {
    tabs.forEach(c => { const on = c.dataset.shopt === tab; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    chips.forEach(c => { const on = c.dataset.shopf === kind; c.classList.toggle('is-on', on); c.setAttribute('aria-checked', String(on)); });
    const n = { mine: 0, shop: 0 };
    let shown = 0;
    items.forEach(it => {
      const mine = isMine(it.dataset.plugin as string);
      n[mine ? 'mine' : 'shop']++;
      const show = (tab === 'mine') === mine && (kind === 'all' || it.dataset.kind === kind);
      it.hidden = !show; if (show) shown++;
    });
    panel.querySelectorAll<HTMLElement>('[data-n]').forEach(el => { el.textContent = String(n[el.dataset.n as 'mine' | 'shop']); });
    empty.hidden = shown > 0;
    if (shown === 0) empty.textContent = tab === 'shop'
      ? (FULL ? 'Semua plugin berbayar sudah kamu miliki. Yang baru akan muncul di Shop.' : 'Belum ada plugin yang dijual. Yang baru akan muncul di Shop.')
      : 'Belum ada plugin di jenis ini.';
  };
  tabs.forEach(c => c.addEventListener('click', () => { tab = c.dataset.shopt as string; apply(); }));
  chips.forEach(c => c.addEventListener('click', () => { kind = c.dataset.shopf as string; apply(); }));
  if (FULL) initPaid(panel);
  onEntitlements(apply);   // setelah token ditebus, kartu pindah dari Shop ke Plugin saya
  apply();
}

// ---- Plugin berbayar: status Dimiliki / tombol Beli + Tebus ----
function initPaid(panel: HTMLElement): void {
  const paint = (): void => panel.querySelectorAll<HTMLElement>('.shop__act').forEach(el => {
    const id = el.dataset.act as string, name = CATALOG.find(c => c.id === id)?.name || id;
    if (owns(id)) { el.innerHTML = '<span class="shop__state"><i aria-hidden="true"></i>Dimiliki</span>'; return; }
    const price = PRICE[id] ? '<b class="shop__price">' + esc(PRICE[id]) + '</b>' : '<span class="shop__price shop__price--lock">Berbayar</span>';
    if (isPending(id)) {
      el.innerHTML = '<span class="shop__state shop__state--wait"><i aria-hidden="true"></i>Menunggu token dari admin</span>' +
        (SAFE_CONTACT ? '<a class="plg__btn plg__btn--ghost" href="' + esc(SAFE_CONTACT) + '" target="_blank" rel="noopener noreferrer" aria-label="Hubungi admin untuk token ' + esc(name) + '">Hubungi admin</a>' : '') +
        '<button type="button" class="plg__btn" data-redeem="' + id + '">Tebus token</button>';
      return;
    }
    el.innerHTML = price + '<button type="button" class="plg__btn" data-buy="' + id + '" aria-label="Beli ' + esc(name) + '">Beli</button>' +
      '<button type="button" class="plg__btn plg__btn--ghost" data-redeem="' + id + '">Tebus token</button>';
  });
  paint();
  onEntitlements(paint);
  panel.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const bu = t.closest<HTMLButtonElement>('[data-buy]');
    if (bu) { openBuy(bu.dataset.buy as string); return; }
    const b = t.closest<HTMLButtonElement>('[data-redeem]');
    if (b) openRedeem(b.dataset.redeem as string);
  });
}

// Konfirmasi Beli -> pesanan dibuat (token otomatis, dikunci ke akun ini). Token TIDAK ditampilkan ke pembeli: diminta ke admin.
function openBuy(id: string): void {
  if (document.getElementById('plg-buy')) return;
  const name = CATALOG.find(c => c.id === id)?.name || id;
  const d = document.createElement('div');
  d.id = 'plg-buy'; d.className = 'svov'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Beli ' + name);
  d.innerHTML = '<div class="svov__back"></div><div class="svov__card"><h3 class="svov__title">Beli ' + esc(name) + '?</h3>' +
    '<p class="plg__txt">Pesanan dibuat dan token otomatis dibuatkan untuk akun ini. Token itu hanya bisa dipakai di akun ini. Minta tokennya ke admin, lalu tebus di sini.</p>' +
    '<p class="plg__err" role="alert"></p>' +
    '<div class="plg__row"><button type="button" class="plg__btn plg__btn--ghost" data-x="close">Batal</button><button type="button" class="plg__btn" data-x="ok">Ya, beli</button></div></div>';
  const err = d.querySelector<HTMLElement>('.plg__err')!, ok = d.querySelector<HTMLButtonElement>('[data-x="ok"]')!;
  const close = (): void => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  d.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('svov__back') || t.dataset.x === 'close') { close(); return; }
    if (t.dataset.x !== 'ok' || ok.disabled) return;
    err.textContent = ''; ok.disabled = true; ok.textContent = 'Memproses…';
    const r = await buyPlugin(id);
    if (r.ok) {
      d.querySelector('.svov__card')!.innerHTML = '<h3 class="svov__title">Pesanan ' + esc(name) + ' dibuat</h3><p class="plg__txt">Token sudah masuk ke admin. Minta tokennya ke admin, lalu tekan Tebus token di kartu ' + esc(name) + '.</p>' +
        '<div class="plg__row">' + (SAFE_CONTACT ? '<a class="plg__btn plg__btn--ghost" href="' + esc(SAFE_CONTACT) + '" target="_blank" rel="noopener noreferrer">Hubungi admin</a>' : '') + '<button type="button" class="plg__btn" data-x="close">Selesai</button></div>';
      return;
    }
    err.textContent = r.error; ok.disabled = false; ok.textContent = 'Ya, beli';
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(d);
  ok.focus();
}

function openRedeem(id: string): void {
  if (document.getElementById('plg-redeem')) return;
  const name = CATALOG.find(c => c.id === id)?.name || id;
  const d = document.createElement('div');
  d.id = 'plg-redeem'; d.className = 'svov'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Tebus token ' + name);
  d.innerHTML = '<div class="svov__back"></div><form class="svov__card" autocomplete="off"><h3 class="svov__title">Tebus token ' + esc(name) + '</h3>' +
    '<p class="plg__txt">Tempel token plugin dari admin. Token hasil pesanan hanya berlaku di akun yang memesan.</p>' +
    '<input class="plg__in" name="t" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="64" placeholder="PLG-XXXX-XXXX-XXXX-XXXX" aria-label="Token plugin" required>' +
    '<p class="plg__err" role="alert"></p>' +
    '<div class="plg__row"><button type="button" class="plg__btn plg__btn--ghost" data-x="close">Batal</button><button type="submit" class="plg__btn">Tebus</button></div></form>';
  const input = d.querySelector<HTMLInputElement>('.plg__in')!, err = d.querySelector<HTMLElement>('.plg__err')!, go = d.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const close = (): void => { d.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  d.addEventListener('click', e => { const t = e.target as HTMLElement; if (t.classList.contains('svov__back') || t.dataset.x === 'close') close(); });
  d.querySelector('form')!.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = ''; go.disabled = true; go.textContent = 'Memeriksa…';
    const r = await redeemPlugin(input.value.trim());
    if (r.ok) { d.querySelector('.svov__card')!.innerHTML = '<h3 class="svov__title">' + esc(name) + ' aktif</h3><p class="plg__txt">Plugin sudah bisa dipakai. Tambahkan lewat tab Plugin (tombol +).</p><div class="plg__row"><button type="button" class="plg__btn" data-x="close">Selesai</button></div>'; return; }
    err.textContent = r.error; go.disabled = false; go.textContent = 'Tebus'; input.focus(); input.select();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(d);
  input.focus();
}
