// Tombol menu di pojok kanan atas (card 3D + bevel) yang membuka panel geser dari kanan, gaya sama dengan panel efek.
// Panel menimpa layar (tidak mendorong timeline). Tutup: klik tombol lagi, klik di luar panel, atau Esc.
// Saat piano roll terbuka tombolnya disembunyikan (CSS) supaya tidak menimpa tombol X piano roll, dan panel ikut menutup.

import { PR_BARS_MIN, PR_BARS_MAX, getPianoRollBars, pianoRollNeededBars, setPianoRollBars } from './piano-roll';
import { runExport, FMT_KEY, type ExportFormat } from './export-audio';
import { setAudioDebug, loadAudioDebug } from './audio-debug';
import { DEMO, demoNotice } from './demo';
import { saveProject, loadProject, deleteProject, listProjects, projectExists, recordToJson, jsonToRecord } from './project-store';
import { installState, promptInstall, onInstallChange } from './pwa';
import { FULL, getProfile, initialOf, loadProfile, onProfile, removeAvatar, saveName, shownName, uploadAvatar } from './account';
import { signOut } from './license';
import { SHOP_CAT, SHOP_PAGE, initShopPage } from './shop-page';
import { SPECTRUM_SPEEDS, isSpectrumOn, setSpectrumOn, getSpectrumSpeed, setSpectrumSpeed } from './spectrum';

// Jembatan ke main.ts (yang memegang data timeline): snapshot dan pemulihan project
export interface ProjectIO {
  snapshot(): { data: unknown; clips: Record<string, Blob> };
  restore(rec: { name: string; savedAt: number; data: unknown; clips: Record<string, Blob> }): Promise<void>;
  toast(msg: string, ms?: number): void;
}
let io: ProjectIO | null = null;
let onIo: (() => void) | null = null;
export function setProjectIO(v: ProjectIO): void { io = v; onIo && onIo(); }

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c] as string));
const fmtDate = (t: number) => new Date(t).toLocaleString('id-ID', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
const IC_DL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const IC_DEL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';

const svgi = (d: string, w = 20): string => '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC_FOLDER = svgi('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
const IC_GEAR = svgi('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>');
const IC_EXPORT = svgi('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>');
const IC_CHEV = svgi('<path d="M9 5l7 7-7 7"/>', 16);
const IC_BACK = svgi('<path d="M15 5l-7 7 7 7"/>', 18);
const AVA = (cls = ''): string => '<span class="mp__ava ' + cls + '" data-ava><img alt="" hidden><b></b></span>';

// Kartu profil di atas daftar kategori + halaman Profil (hanya build full; di build lain string ini kosong)
const PROFILE_CAT = FULL
  ? '<button type="button" class="mp__cat mp__profcat mp__item" style="--i:1" data-go="profile" aria-label="Profil">' + AVA() + '<span class="mp__cat__t"><b data-pname>Akun</b><small data-pmail>Lihat &amp; ubah profil</small></span>' + IC_CHEV + '</button>'
  : '';
const PROFILE_PAGE = FULL
  ? '<section class="mp__page" data-page="profile" aria-label="Profil" hidden>' +
      '<div class="mp__card mp__item mp__pf" style="--i:1">' +
        '<button type="button" class="mp__avabtn" data-pick aria-label="Ganti foto profil">' + AVA('mp__ava--lg') + '<i class="mp__avacam" aria-hidden="true">' + svgi('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 16) + '</i></button>' +
        '<div class="mp__pfbtns"><button type="button" class="mp__imp" data-pick>Ganti foto</button><button type="button" class="mp__imp mp__imp--bad" data-delava hidden>Hapus foto</button></div>' +
        '<input type="file" accept="image/*" data-file hidden>' +
      '</div>' +
      '<div class="mp__card mp__item" style="--i:2">' +
        '<div class="mp__sub"><span>Nama</span></div>' +
        '<input type="text" class="mp__inp" data-nameinp maxlength="40" autocomplete="name" placeholder="Nama kamu" aria-label="Nama">' +
        '<button type="button" class="mp__prim" data-savename>Simpan nama</button>' +
        '<p class="mp__hint mp__pmsg" data-pmsg role="status"></p>' +
      '</div>' +
      '<div class="mp__card mp__item" style="--i:3">' +
        '<div class="mp__sub"><span>Email</span></div><p class="mp__hint" data-pemail style="word-break:break-all"></p>' +
      '</div>' +
      '<div class="mp__card mp__item" style="--i:4">' +
        '<button type="button" class="mp__prim mp__prim--bad" data-signout>Keluar dari akun</button>' +
        '<p class="mp__hint" style="margin-top:8px">Keluar juga mengosongkan salinan offline di perangkat ini. Slot perangkat tidak dibebaskan.</p>' +
      '</div>' +
    '</section>'
  : '';

const ICON_GRID =
  '<svg class="menu-btn__ic menu-btn__ic--grid" viewBox="0 0 24 24" aria-hidden="true">' +
  '<rect x="4" y="4" width="6.5" height="6.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<rect x="13.5" y="4" width="6.5" height="6.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<rect x="4" y="13.5" width="6.5" height="6.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" fill="#9d86ff"/></svg>';
const ICON_CLOSE =
  '<svg class="menu-btn__ic menu-btn__ic--x" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

export interface MenuPanel {
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

export function initMenuPanel(): MenuPanel {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'menuBtn'; btn.className = 'menu-btn';
  btn.setAttribute('aria-controls', 'menuPanel');
  btn.innerHTML = ICON_GRID + ICON_CLOSE;

  const panel = document.createElement('aside');
  panel.id = 'menuPanel'; panel.className = 'mp'; panel.setAttribute('aria-label', 'Menu');
  panel.innerHTML =
    '<div class="mp__panel">' +
      '<header class="mp__head mp__item" style="--i:0"><button type="button" class="mp__back" aria-label="Kembali ke menu" title="Kembali" hidden>' + IC_BACK + '</button><h2 class="mp__title">Menu</h2></header>' +
      '<div class="mp__body">' +
        // halaman utama: daftar kategori
        '<nav class="mp__page" data-page="home" aria-label="Kategori menu">' +
          PROFILE_CAT +
          '<button type="button" class="mp__cat mp__item" style="--i:1" data-go="project">' + IC_FOLDER + '<span class="mp__cat__t"><b>Project</b><small>Simpan &amp; buka project</small></span>' + IC_CHEV + '</button>' +
          '<button type="button" class="mp__cat mp__item" style="--i:2" data-go="export">' + IC_EXPORT + '<span class="mp__cat__t"><b>Export</b><small>Simpan hasil jadi MP3 / WAV</small></span>' + IC_CHEV + '</button>' +
          SHOP_CAT +
          '<button type="button" class="mp__cat mp__item" style="--i:4" data-go="settings">' + IC_GEAR + '<span class="mp__cat__t"><b>Pengaturan</b><small>Preferensi aplikasi</small></span>' + IC_CHEV + '</button>' +
        '</nav>' +
        PROFILE_PAGE +
        // kategori Project
        '<section class="mp__page" data-page="project" aria-label="Project" hidden>' +
          '<div class="mp__card mp__item mp__save" style="--i:1">' +
            '<button type="button" class="mp__savebtn" aria-label="Simpan project">' +
              '<svg class="mp__ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" pathLength="100"/></svg><span>SAVE</span></button>' +
            '<p class="mp__hint">Ketuk: simpan sebagai project baru.<br>Tahan: simpan perubahan ke project yang sedang dibuka.</p>' +
          '</div>' +
          '<div class="mp__card mp__item" style="--i:2">' +
            '<div class="mp__sub"><span>File project</span><button type="button" class="mp__imp" data-impjson>Import project</button></div>' +
            '<ul class="mp__files"></ul><p class="mp__hint mp__empty">Belum ada project tersimpan.</p>' +
            '<input type="file" class="mp__impfile" hidden>' +
          '</div>' +
        '</section>' +
        // kategori Export
        '<section class="mp__page" data-page="export" aria-label="Export" hidden>' +
          '<div class="mp__card mp__item mp__set" style="--i:1">' +
            '<div class="mp__sub"><span>Format file</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Format export">' +
              '<button type="button" class="mp__segbtn" role="radio" data-xfmt="mp3">MP3</button>' +
              '<button type="button" class="mp__segbtn" role="radio" data-xfmt="wav">WAV</button>' +
            '</div>' +
            '<p class="mp__hint mp__xhint"></p>' +
          '</div>' +
          '<div class="mp__card mp__item" style="--i:2">' +
            '<button type="button" class="mp__expbtn">' + IC_EXPORT + '<span>Export Audio</span></button>' +
            '<p class="mp__hint">Memutar project dari bar 1 sampai akhir isi timeline lalu merekamnya, jadi lama export sama dengan durasi lagu. Tab jangan ditutup atau dipindah.</p>' +
          '</div>' +
        '</section>' +
        // kategori Manage Plugin (halaman di shop-page.ts)
        SHOP_PAGE +
        // kategori Pengaturan
        '<section class="mp__page" data-page="settings" aria-label="Pengaturan" hidden>' +
          '<div class=\"mp__card mp__item mp__set\" style=\"--i:0\">' +
            '<div class=\"mp__sub\"><span>Tema UI</span></div>' +
            '<div class=\"mp__seg mp__seg--wrap\" role=\"radiogroup\" aria-label=\"Tema UI\">' +
              '<button type=\"button\" class=\"mp__segbtn\" role=\"radio\" data-uitheme=\"ink\"><i class=\"mp__sw mp__sw--tink\"></i>Ink Rose</button>' +
              '<button type=\"button\" class=\"mp__segbtn\" role=\"radio\" data-uitheme=\"mono\"><i class=\"mp__sw mp__sw--tmono\"></i>Mono Graphite</button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:1">' +
            '<div class="mp__sub"><span>Theme</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Theme">' +
              '<button type="button" class="mp__segbtn" role="radio" data-theme="default"><i class="mp__sw mp__sw--tdefault"></i>Default</button>' +
              '<button type="button" class="mp__segbtn" role="radio" data-theme="jembut"><i class="mp__sw mp__sw--tjembut"></i>Jembut</button>' +
            '</div>' +
          '</div>' +
          // Gaya UI (bentuk sudut): tersembunyi, dibuka dengan menahan judul "Menu" di bagian atas panel
          '<div class="mp__card mp__item mp__set" style="--i:2" data-uistyle-card hidden>' +
            '<div class="mp__sub"><span>Gaya UI</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Gaya UI">' +
              '<button type="button" class="mp__segbtn" role="radio" data-uistyle="soft">Default</button>' +
              '<button type="button" class="mp__segbtn" role="radio" data-uistyle="flat">Flat</button>' +
            '</div>' +
            '<p class="mp__hint">Flat: sudut lancip, tanpa glow, warna terang. Tahap 1: baru di channel mixer.</p>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:2">' +
            '<div class="mp__sub"><span>Waveform &amp; bar color</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Waveform & bar color">' +
              '<button type="button" class="mp__segbtn" role="radio" data-wf="default"><i class="mp__sw mp__sw--default"></i>Default</button>' +
              '<button type="button" class="mp__segbtn" role="radio" data-wf="black"><i class="mp__sw mp__sw--black"></i>Black</button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:3">' +
            '<div class="mp__sub"><span>Waveform audio clip</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Waveform audio clip">' +
              '<button type="button" class="mp__segbtn" role="radio" data-wfm="mono"><i class="mp__sw mp__sw--w1"></i>1 batang</button>' +
              '<button type="button" class="mp__segbtn" role="radio" data-wfm="stereo"><i class="mp__sw mp__sw--w2"></i>2 batang</button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:4">' +
            '<div class="mp__row">' +
              '<span class="mp__row__t"><b>Record Mode</b><small>Pilih pattern: track lain di-blur</small></span>' +
              '<button type="button" class="mp__switch" role="switch" aria-checked="false" aria-label="Record Mode" data-rec><i></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:5">' +
            '<div class="mp__row">' +
              '<span class="mp__row__t"><b>Master Loudness</b><small>Output lebih keras &amp; padat (compressor + limiter)</small></span>' +
              '<button type="button" class="mp__switch" role="switch" aria-checked="true" aria-label="Master Loudness" data-loud><i></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:6">' +
            '<div class="mp__row">' +
              '<span class="mp__row__t"><b>Spectrum</b><small>Gelombang suara langsung di dasar layar</small></span>' +
              '<button type="button" class="mp__switch" role="switch" aria-checked="false" aria-label="Spectrum" data-spec><i></i></button>' +
            '</div>' +
            '<div class="mp__sub" style="margin-top:14px"><span>Kecepatan gulir</span></div>' +
            '<div class="mp__seg" role="radiogroup" aria-label="Kecepatan gulir Spectrum">' +
              SPECTRUM_SPEEDS.map(v => '<button type="button" class="mp__segbtn" role="radio" aria-checked="false" data-specspd="' + v.k + '">' + v.label + '</button>').join('') +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:7">' +
            '<div class="mp__row">' +
              '<span class="mp__row__t"><b>Debug Audio</b><small>Panel statistik beban, nada telat &amp; nada terpotong saat Play (untuk mencari penyebab glitch)</small></span>' +
              '<button type="button" class="mp__switch" role="switch" aria-checked="false" aria-label="Debug Audio" data-adbg><i></i></button>' +
            '</div>' +
          '</div>' +
          '<div class="mp__card mp__item mp__set" style="--i:8">' +
            '<div class="mp__row">' +
              '<span class="mp__row__t"><b>Grid Piano Roll</b><small data-prb-hint>Panjang grid piano roll &amp; note mini di pattern</small></span>' +
              '<span class="mp__val" data-prb-val></span>' +
            '</div>' +
            '<div class="mp__step">' +
              '<button type="button" class="mp__stepbtn" aria-label="Kurangi bar" data-prb-dec>&minus;</button>' +
              '<input type="range" class="mp__range" min="' + PR_BARS_MIN + '" max="' + PR_BARS_MAX + '" step="1" aria-label="Jumlah bar grid piano roll" data-prb-range>' +
              '<button type="button" class="mp__stepbtn" aria-label="Tambah bar" data-prb-inc>+</button>' +
            '</div>' +
          '</div>' +
          // Install aplikasi (PWA): disembunyikan kalau sudah terpasang
          '<div class="mp__card mp__item mp__set" style="--i:9" data-install-card hidden>' +
            '<div class="mp__sub"><span>Install aplikasi</span></div>' +
            '<button type="button" class="mp__expbtn" data-install-btn>' + IC_DL + '<span>Install ke layar utama</span></button>' +
            '<p class="mp__hint" data-install-hint></p>' +
          '</div>' +
          // Credits & lisensi pihak ketiga (wajib tampil di semua build, termasuk versi penuh)
          '<div class="mp__card mp__item mp__set" style="--i:10">' +
            '<div class="mp__sub"><span>Credits &amp; lisensi</span></div>' +
            '<ul class="mp__cr">' +
              '<li><b>Piano</b>: Salamander Grand Piano V3 oleh Alexander Holm, lisensi <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a>. Sample dipakai apa adanya; nadanya digeser pitch-nya saat dimainkan.</li>' +
              '<li><b>Font</b>: Plus Jakarta Sans dan Syncopate, lisensi <a href="https://openfontlicense.org/" target="_blank" rel="noopener noreferrer">SIL Open Font License 1.1</a>.</li>' +
              '<li><b>Encoder MP3</b>: lamejs (@breezystack/lamejs), lisensi <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noopener noreferrer">LGPL-3.0</a>.</li>' +
              '<li><b>Ikon</b>: sebagian ikon dari <a href="https://lucide.dev" target="_blank" rel="noopener noreferrer">Lucide</a>, lisensi ISC, Copyright (c) Lucide Icons and Contributors.' +
                '<details class="mp__lic"><summary>Teks lisensi ISC</summary><p>Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.</p></details></li>' +
            '</ul>' +
          '</div>' +
        '</section>' +
      '</div>' +
    '</div>';

  // ===== Pengaturan: Install aplikasi (PWA, lihat pwa.ts) =====
  const instCard = panel.querySelector<HTMLElement>('[data-install-card]') as HTMLElement;
  const instBtn = panel.querySelector<HTMLButtonElement>('[data-install-btn]') as HTMLButtonElement;
  const instHint = panel.querySelector<HTMLElement>('[data-install-hint]') as HTMLElement;
  const renderInstall = (): void => {
    const st = installState();
    instCard.hidden = st === 'installed';
    instBtn.hidden = st !== 'ready';
    instHint.textContent =
      st === 'ready' ? 'Pasang Melvox seperti aplikasi biasa: ikonnya muncul di beranda dan bisa dibuka tanpa internet.' :
      st === 'ios' ? 'Di iPhone / iPad: ketuk tombol Bagikan (kotak dengan panah ke atas) di Safari, lalu pilih "Tambah ke Layar Utama".' :
      'Buka menu browser (titik tiga), lalu pilih "Install aplikasi" atau "Tambahkan ke layar utama".';
  };
  instBtn.addEventListener('click', () => { void promptInstall().then(renderInstall); });
  onInstallChange(renderInstall);
  renderInstall();

  // ===== Pengaturan: Tema UI (atribut data-ui di <html>; Ink Rose = bawaan, Mono Graphite = abu monokrom) =====
  const UI_KEY = 'derizmp3.ui';
  const uiBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-uitheme]')];
  const setUi = (v: string, save: boolean): void => {
    const val = v === 'mono' ? v : 'ink';
    document.documentElement.dataset.ui = val;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', val === 'mono' ? '#101012' : '#0f0d13');
    uiBtns.forEach(b => { const on = b.dataset.uitheme === val; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    window.dispatchEvent(new CustomEvent('derizmp3:ui'));   // ruler & piano roll (canvas) menggambar ulang dengan warna baru
    if (save) { try { localStorage.setItem(UI_KEY, val); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  };
  uiBtns.forEach(b => b.addEventListener('click', () => setUi(b.dataset.uitheme as string, true)));
  let uiSaved = 'ink';
  try { uiSaved = localStorage.getItem(UI_KEY) || 'ink'; } catch { /* abaikan */ }
  setUi(uiSaved, false);

  // ===== Pengaturan: Theme (atribut data-theme di <html>; gaya tiap theme ada di styles.css) =====
  const THEME_KEY = 'derizmp3.theme';
  const themeBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-theme]')];
  const setTheme = (v: string, save: boolean): void => {
    const val = v === 'jembut' ? 'jembut' : 'default';
    document.documentElement.dataset.theme = val;
    themeBtns.forEach(b => { const on = b.dataset.theme === val; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    if (save) { try { localStorage.setItem(THEME_KEY, val); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  };
  themeBtns.forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme as string, true)));
  let themeSaved = 'default';
  try { themeSaved = localStorage.getItem(THEME_KEY) || 'default'; } catch { /* abaikan */ }
  setTheme(themeSaved, false);

  // ===== Pengaturan: Gaya UI (atribut data-uistyle di <html>: soft = bawaan, flat = sudut lancip) =====
  // Kartu pilihannya tersembunyi. Buka/tutup dengan menahan judul "Menu" di bagian atas panel (status buka disimpan).
  const STYLE_KEY = 'derizmp3.uistyle', STYLE_UNLOCK_KEY = 'derizmp3.uistyle.unlock';
  const styleCard = panel.querySelector<HTMLElement>('[data-uistyle-card]') as HTMLElement;
  const styleBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-uistyle]')];
  const setUiStyle = (v: string, save: boolean): void => {
    const val = v === 'flat' ? 'flat' : 'soft';
    if (val === 'flat') document.documentElement.dataset.uistyle = 'flat'; else delete document.documentElement.dataset.uistyle;
    styleBtns.forEach(b => { const on = b.dataset.uistyle === val; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    window.dispatchEvent(new CustomEvent('derizmp3:ui'));   // ruler (canvas) menggambar ulang dengan warna gaya baru
    if (save) { try { localStorage.setItem(STYLE_KEY, val); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  };
  styleBtns.forEach(b => b.addEventListener('click', () => setUiStyle(b.dataset.uistyle as string, true)));
  let styleSaved = 'soft', styleUnlocked = false;
  try {
    styleSaved = localStorage.getItem(STYLE_KEY) || 'soft'; styleUnlocked = localStorage.getItem(STYLE_UNLOCK_KEY) === '1';
    // cadangan kalau klik-tahan tidak jalan di suatu perangkat: buka aplikasi dengan ?uistyle=buka (atau ?uistyle=tutup untuk menyembunyikan lagi)
    const uq = new URLSearchParams(location.search).get('uistyle');
    if (uq === 'buka' || uq === 'tutup') { styleUnlocked = uq === 'buka'; localStorage.setItem(STYLE_UNLOCK_KEY, styleUnlocked ? '1' : '0'); }
  } catch { /* abaikan */ }
  styleCard.hidden = !styleUnlocked;
  setUiStyle(styleSaved, false);
  // klik-tahan judul di bagian atas panel (± 0,7 detik) = tampilkan / sembunyikan kartu Gaya UI; judul ini bukan tombol, jadi tidak bentrok dengan klik apa pun
  const setGo = panel.querySelector<HTMLElement>('.mp__title') as HTMLElement;
  let styleHoldT = 0, styleHoldX = 0, styleHoldY = 0;
  const styleHoldClear = (): void => { if (styleHoldT) { clearTimeout(styleHoldT); styleHoldT = 0; } };
  setGo.addEventListener('pointerdown', e => {
    styleHoldClear(); styleHoldX = e.clientX; styleHoldY = e.clientY;
    styleHoldT = window.setTimeout(() => {
      styleHoldT = 0;
      styleUnlocked = !styleUnlocked;
      styleCard.hidden = !styleUnlocked;
      try { localStorage.setItem(STYLE_UNLOCK_KEY, styleUnlocked ? '1' : '0'); } catch { /* abaikan */ }
      if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* abaikan */ } }
      io && io.toast(styleUnlocked ? 'Pilihan Gaya UI dibuka di Pengaturan' : 'Pilihan Gaya UI disembunyikan', 1800);
    }, 700);
  });
  setGo.addEventListener('pointermove', e => { if (styleHoldT && Math.hypot(e.clientX - styleHoldX, e.clientY - styleHoldY) > 10) styleHoldClear(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => setGo.addEventListener(ev, styleHoldClear));
  // di Android, tahan lama memicu menu konteks / seleksi teks bawaan browser yang membatalkan pointer (pointercancel) sebelum 0,7 detik; tahan itu dimatikan di judul ini
  setGo.addEventListener('contextmenu', e => e.preventDefault());

  // Tombol rahasia pindah Gaya UI (Default <-> Flat): tak terlihat, di pojok kanan-bawah halaman utama Menu (lihat .mp__uisw di styles.css).
  // Sekali tap langsung ganti gaya, tanpa membuka kartu di Pengaturan. Disembunyikan dari pembaca layar dan tidak ikut urutan Tab.
  const uiSw = document.createElement('button');
  uiSw.type = 'button'; uiSw.className = 'mp__uisw'; uiSw.tabIndex = -1; uiSw.setAttribute('aria-hidden', 'true');
  (panel.querySelector('.mp__panel') as HTMLElement).appendChild(uiSw);
  uiSw.addEventListener('click', () => {
    const next = document.documentElement.dataset.uistyle === 'flat' ? 'soft' : 'flat';
    setUiStyle(next, true);
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch { /* abaikan */ } }
    io && io.toast(next === 'flat' ? 'Gaya UI: Flat' : 'Gaya UI: Default', 1500);
  });

  // ===== Pengaturan: Waveform & bar color (disimpan di browser, diterapkan lewat atribut data-wf di <html>) =====
  const WF_KEY = 'derizmp3.wfColor';
  const wfBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-wf]')];
  const setWf = (v: string, save: boolean): void => {
    const val = v === 'black' ? 'black' : 'default';
    document.documentElement.dataset.wf = val;
    wfBtns.forEach(b => { const on = b.dataset.wf === val; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    if (save) { try { localStorage.setItem(WF_KEY, val); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  };
  wfBtns.forEach(b => b.addEventListener('click', () => setWf(b.dataset.wf as string, true)));
  let wfSaved = 'default';
  try { wfSaved = localStorage.getItem(WF_KEY) || 'default'; } catch { /* abaikan */ }
  setWf(wfSaved, false);

  // ===== Pengaturan: Waveform audio clip (atribut data-wfmode di <html>; audio-engine.ts membaca atribut ini, main.ts menggambar ulang saat event 'wfmodechange') =====
  const WFM_KEY = 'derizmp3.wfMode';
  const wfmBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-wfm]')];
  const setWfm = (v: string, save: boolean): void => {
    const val = v === 'stereo' ? 'stereo' : 'mono';
    document.documentElement.dataset.wfmode = val;
    wfmBtns.forEach(b => { const on = b.dataset.wfm === val; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    if (save) { try { localStorage.setItem(WFM_KEY, val); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
    document.dispatchEvent(new CustomEvent('wfmodechange'));
  };
  wfmBtns.forEach(b => b.addEventListener('click', () => setWfm(b.dataset.wfm as string, true)));
  let wfmSaved = 'mono';
  try { wfmSaved = localStorage.getItem(WFM_KEY) || 'mono'; } catch { /* abaikan */ }
  setWfm(wfmSaved, false);

  // ===== Pengaturan: Record Mode (atribut data-rec di <html>; main.ts mendengarkan event 'recmodechange') =====
  const REC_KEY = 'derizmp3.recMode';
  const recBtn = panel.querySelector('[data-rec]') as HTMLButtonElement;
  const setRec = (on: boolean, save: boolean): void => {
    document.documentElement.dataset.rec = on ? 'on' : 'off';
    recBtn.classList.toggle('is-on', on);
    recBtn.setAttribute('aria-checked', String(on));
    if (save) { try { localStorage.setItem(REC_KEY, on ? '1' : '0'); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
    document.dispatchEvent(new CustomEvent('recmodechange'));
  };
  recBtn.addEventListener('click', () => setRec(recBtn.getAttribute('aria-checked') !== 'true', true));
  let recSaved = false;
  try { recSaved = localStorage.getItem(REC_KEY) === '1'; } catch { /* abaikan */ }
  setRec(recSaved, false);

  // ===== Pengaturan: Master Loudness (atribut data-loud di <html>; main.ts mendengarkan event 'loudchange'). Bawaan NYALA =====
  const LOUD_KEY = 'derizmp3.masterLoud';
  const loudBtn = panel.querySelector('[data-loud]') as HTMLButtonElement;
  const setLoud = (on: boolean, save: boolean): void => {
    document.documentElement.dataset.loud = on ? 'on' : 'off';
    loudBtn.classList.toggle('is-on', on);
    loudBtn.setAttribute('aria-checked', String(on));
    if (save) { try { localStorage.setItem(LOUD_KEY, on ? '1' : '0'); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
    document.dispatchEvent(new CustomEvent('loudchange'));
  };
  loudBtn.addEventListener('click', () => setLoud(loudBtn.getAttribute('aria-checked') !== 'true', true));
  let loudSaved = true;
  try { loudSaved = localStorage.getItem(LOUD_KEY) !== '0'; } catch { /* abaikan */ }
  setLoud(loudSaved, false);

  // ===== Pengaturan: Spectrum (strip gelombang di dasar layar, spectrum.ts). Saklar nyala/mati + kecepatan gulir; bawaan MATI =====
  const specBtn = panel.querySelector('[data-spec]') as HTMLButtonElement;
  const specSpd = [...panel.querySelectorAll<HTMLButtonElement>('[data-specspd]')];
  const syncSpec = (): void => {
    const on = isSpectrumOn(), k = getSpectrumSpeed();
    specBtn.classList.toggle('is-on', on); specBtn.setAttribute('aria-checked', String(on));
    specSpd.forEach(b => { const sel = b.dataset.specspd === k; b.classList.toggle('is-on', sel); b.setAttribute('aria-checked', String(sel)); });
  };
  specBtn.addEventListener('click', () => { setSpectrumOn(!isSpectrumOn()); syncSpec(); });
  specSpd.forEach(b => b.addEventListener('click', () => { setSpectrumSpeed(b.dataset.specspd as string); syncSpec(); }));
  syncSpec();

  // ===== Pengaturan: Grid Piano Roll (4..50 bar, bawaan 15). piano-roll.ts menyimpan nilainya dan mengabari main.ts lewat event 'prbarschange' =====
  const prbRange = panel.querySelector('[data-prb-range]') as HTMLInputElement;
  const prbVal = panel.querySelector('[data-prb-val]') as HTMLElement;
  const prbHint = panel.querySelector('[data-prb-hint]') as HTMLElement;
  const prbDec = panel.querySelector('[data-prb-dec]') as HTMLButtonElement, prbInc = panel.querySelector('[data-prb-inc]') as HTMLButtonElement;
  const PRB_HINT = prbHint.textContent || '';
  const prbShow = (): void => {
    const v = getPianoRollBars(), need = pianoRollNeededBars();
    prbRange.value = String(v); prbVal.textContent = v + ' bar';
    prbHint.textContent = need > PR_BARS_MIN ? PRB_HINT + ' (minimal ' + need + ' bar: ada nada sampai bar ' + need + ')' : PRB_HINT;
    prbDec.disabled = v <= Math.max(PR_BARS_MIN, need);
    prbInc.disabled = v >= PR_BARS_MAX;
  };
  const prbSet = (n: number): void => { setPianoRollBars(n, true); prbShow(); };   // nilai dijepit ke nada terjauh; tampilan ikut nilai yang dipakai
  prbRange.addEventListener('input', () => prbSet(+prbRange.value));
  prbDec.addEventListener('click', () => prbSet(getPianoRollBars() - 1));
  prbInc.addEventListener('click', () => prbSet(getPianoRollBars() + 1));
  document.addEventListener('prbarschange', prbShow);   // grid melebar sendiri saat project berisi nada yang lebih jauh
  prbShow();

  // ===== Pengaturan: Debug Audio (panel statistik mengambang; bawaan MATI, kerja tambahan nol saat mati) =====
  const adbgBtn = panel.querySelector('[data-adbg]') as HTMLButtonElement;
  const setAdbg = (on: boolean, save: boolean): void => {
    adbgBtn.classList.toggle('is-on', on);
    adbgBtn.setAttribute('aria-checked', String(on));
    setAudioDebug(on, save);
  };
  adbgBtn.addEventListener('click', () => setAdbg(adbgBtn.getAttribute('aria-checked') !== 'true', true));
  setAdbg(loadAudioDebug(), false);
  if (DEMO) { setAdbg(false, false); adbgBtn.closest<HTMLElement>('.mp__item')?.setAttribute('hidden', ''); }   // DEMO: Debug Audio disembunyikan

  // ===== Export: pilihan format (disimpan di browser) + tombol Export Audio =====
  const xfBtns = [...panel.querySelectorAll<HTMLButtonElement>('[data-xfmt]')];
  const xHint = panel.querySelector('.mp__xhint') as HTMLElement;
  const XHINTS: Record<string, string> = {mp3: 'MP3 192 kbps, ukuran kecil, cocok untuk dibagikan.', wav: 'WAV 16-bit stereo tanpa kompresi, kualitas penuh, ukuran besar.'};
  let xfmt: ExportFormat = 'mp3';
  const setXfmt = (v: string, save: boolean): void => {
    xfmt = v === 'wav' ? 'wav' : 'mp3';
    xfBtns.forEach(b => { const on = b.dataset.xfmt === xfmt; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    xHint.textContent = XHINTS[xfmt];
    if (save) { try { localStorage.setItem(FMT_KEY, xfmt); } catch { /* penyimpanan diblokir: tetap berlaku sampai halaman ditutup */ } }
  };
  xfBtns.forEach(b => b.addEventListener('click', () => setXfmt(b.dataset.xfmt as string, true)));
  let xfSaved = 'mp3';
  try { xfSaved = localStorage.getItem(FMT_KEY) || 'mp3'; } catch { /* abaikan */ }
  setXfmt(xfSaved, false);
  panel.querySelector('.mp__expbtn')!.addEventListener('click', () => {
    if (DEMO) { demoNotice('export'); return; }   // DEMO: export audio hanya di versi penuh
    apply(false, true);   // panel menutup supaya overlay progres terlihat
    setTimeout(() => { void runExport(xfmt, curName); }, 260);
  });

  // ===== Halaman kategori (home / project / export / settings) =====
  initShopPage(panel);
  const TITLES: Record<string, string> = {home: 'Menu', project: 'Project', export: 'Export', shop: 'Manage Plugin', settings: 'Pengaturan', profile: 'Profil'};
  const pages = [...panel.querySelectorAll<HTMLElement>('.mp__page')];
  const titleEl = panel.querySelector('.mp__title') as HTMLElement;
  const backBtn = panel.querySelector('.mp__back') as HTMLButtonElement;
  const bodyEl = panel.querySelector('.mp__body') as HTMLElement;
  let view = 'home';
  let refreshProjects: () => void = () => { /* diisi setelah daftar project dibuat */ };
  const go = (v: string): void => {
    if (v === view) return;
    view = v;
    if (v === 'project') refreshProjects();   // selalu baca ulang daftar project saat halaman Project dibuka
    pages.forEach(pg => { pg.hidden = pg.dataset.page !== v; });
    titleEl.textContent = TITLES[v] || 'Menu';
    backBtn.hidden = v === 'home';
    bodyEl.scrollTop = 0;
    const cur = pages.find(pg => pg.dataset.page === v);
    if (cur) { cur.classList.remove('is-in'); void cur.offsetWidth; cur.classList.add('is-in'); }
  };
  panel.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
    if (t) go(t.dataset.go as string);
  });
  backBtn.addEventListener('click', () => go('home'));

  // ===== Profil (nama + foto, hanya build full) =====
  if (FULL) {
    const q = <T extends HTMLElement>(s: string): T => panel.querySelector(s) as T;
    const nameInp = q<HTMLInputElement>('[data-nameinp]'), msg = q<HTMLElement>('[data-pmsg]'), fileIn = q<HTMLInputElement>('[data-file]');
    const say = (t: string, bad = false): void => { msg.textContent = t; msg.style.color = bad ? '#ff7a8a' : ''; };
    const paint = (): void => {
      const p = getProfile();
      panel.querySelectorAll<HTMLElement>('[data-ava]').forEach(a => {
        const img = a.querySelector('img') as HTMLImageElement, ini = a.querySelector('b') as HTMLElement;
        ini.textContent = initialOf(p);
        if (p?.avatar) { if (img.getAttribute('src') !== p.avatar) img.src = p.avatar; img.hidden = false; ini.hidden = true; }
        else { img.hidden = true; img.removeAttribute('src'); ini.hidden = false; }
        img.onerror = () => { img.hidden = true; ini.hidden = false; };   // offline / foto gagal dimuat: tampil inisial
      });
      q('[data-pname]').textContent = shownName(p);
      q('[data-pmail]').textContent = p?.email || 'Lihat & ubah profil';
      q('[data-pemail]').textContent = p?.email || '-';
      q<HTMLElement>('[data-delava]').hidden = !p?.avatar;
      if (document.activeElement !== nameInp) nameInp.value = p?.name || '';
    };
    onProfile(paint); paint(); void loadProfile();

    panel.addEventListener('click', async e => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-pick]')) { fileIn.click(); return; }
      if (t.closest('[data-delava]')) { say('Menghapus foto...'); const er = await removeAvatar(); say(er || 'Foto dihapus.', !!er); return; }
      const sv = t.closest('[data-savename]') as HTMLButtonElement | null;
      if (sv) { sv.disabled = true; say('Menyimpan...'); const er = await saveName(nameInp.value); say(er || 'Nama disimpan.', !!er); sv.disabled = false; return; }
      const so = t.closest('[data-signout]') as HTMLButtonElement | null;
      if (so && confirm('Keluar dari akun di perangkat ini?')) { so.disabled = true; await signOut(); }
    });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0]; fileIn.value = '';
      if (!f) return;
      say('Mengunggah foto...'); const er = await uploadAvatar(f); say(er || 'Foto diperbarui.', !!er);
    });
    nameInp.addEventListener('keydown', e => { if (e.key === 'Enter') (q('[data-savename]') as HTMLButtonElement).click(); });
  }

  let open = false;

  const apply = (next: boolean, animate: boolean): void => {
    open = next;
    panel.classList.toggle('mp--open', open);
    btn.classList.toggle('is-open', open);
    const label = open ? 'Tutup menu' : 'Buka menu';
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', label); btn.title = label;
    // saat tertutup, isi panel tidak boleh bisa difokus / dibaca screen reader
    if (open) { panel.removeAttribute('inert'); panel.removeAttribute('aria-hidden'); }
    else { panel.setAttribute('inert', ''); panel.setAttribute('aria-hidden', 'true'); }
    if (!open) setTimeout(() => { if (!open) go('home'); }, 480);   // kembali ke daftar kategori setelah panel selesai meluncur keluar
    void animate;
  };

  btn.addEventListener('click', () => apply(!open, true));
  document.addEventListener('shop:open', () => { apply(true, true); go('shop'); });   // dari pemberitahuan "plugin belum dimiliki" (entitlements.ts)

  document.addEventListener('pointerdown', e => {
    if (!open) return;
    const t = e.target as Node;
    if (panel.contains(t) || btn.contains(t) || (t as HTMLElement).closest?.('.svov')) return;
    apply(false, true);
  });
  document.addEventListener('keydown', e => {
    if (!open || e.key !== 'Escape') return;
    if (view !== 'home') { go('home'); return; }
    apply(false, true); btn.focus();
  });

  // piano roll terbuka -> panel menutup (tombolnya sendiri disembunyikan lewat CSS)
  const stage = document.querySelector('.stage');
  if (stage) {
    new MutationObserver(() => { if (open && document.querySelector('.pr.is-open')) apply(false, true); })
      .observe(stage, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }


  // ===== Simpan / buka project =====
  let curName = '';
  const filesEl = panel.querySelector('.mp__files') as HTMLUListElement;
  const emptyEl = panel.querySelector('.mp__empty') as HTMLElement;
  const say = (m: string, ms?: number) => io ? io.toast(m, ms) : undefined;

  // Daftar dibaca ulang tiap halaman Project dibuka (bukan cuma sekali saat app mulai). Gagal baca = daftar lama dipertahankan +
  // tombol "Coba lagi" (dan coba otomatis beberapa kali), bukan langsung dianggap kosong.
  const EMPTY_TXT = 'Belum ada project tersimpan.';
  let refSeq = 0, refRetry = 0, refTimer = 0;
  const refresh = async (): Promise<void> => {
    const my = ++refSeq;
    clearTimeout(refTimer);
    let items: Array<{name: string; savedAt: number}>;
    try { items = await listProjects(); }
    catch (err) {
      console.error(err);
      if (my !== refSeq) return;
      if (refRetry < 3) { refRetry++; refTimer = window.setTimeout(() => { void refresh(); }, 1200 * refRetry); }
      if (!filesEl.children.length) {
        emptyEl.hidden = false;
        emptyEl.innerHTML = 'Daftar project belum bisa dibaca dari penyimpanan browser. <button type="button" class="mp__imp" data-retry>Coba lagi</button>';
      }
      return;
    }
    if (my !== refSeq) return;   // ada pembacaan yang lebih baru: abaikan hasil lama
    refRetry = 0;
    emptyEl.textContent = EMPTY_TXT;
    emptyEl.hidden = items.length > 0;
    filesEl.innerHTML = items.map((p, i) =>
      '<li class="mp__file" data-n="' + esc(p.name) + '" style="--i:' + i + '">' +
        '<button type="button" class="mp__open" data-act="open"><b>' + esc(p.name) + '</b><small>' + (p.savedAt ? fmtDate(p.savedAt) : '') + '</small></button>' +
        '<button type="button" class="mp__ico" data-act="dl" aria-label="Unduh .json" title="Unduh .json">' + IC_DL + '</button>' +
        '<button type="button" class="mp__ico" data-act="del" aria-label="Hapus project" title="Hapus">' + IC_DEL + '</button>' +
      '</li>').join('');
  };
  emptyEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-retry]')) { refRetry = 0; void refresh(); } });
  refreshProjects = () => { refRetry = 0; void refresh(); };
  onIo = () => { void refresh(); };
  void refresh();

  // overlay nama file project
  const ov = document.createElement('div');
  ov.className = 'svov'; ov.hidden = true;
  ov.innerHTML =
    '<div class="svov__back"></div>' +
    '<div class="svov__card" role="dialog" aria-modal="true" aria-label="Simpan project">' +
      '<h3 class="svov__title">Simpan project</h3>' +
      '<label class="svov__lbl" for="svName">Nama file project</label>' +
      '<input id="svName" class="svov__in" type="text" maxlength="60" autocomplete="off" spellcheck="false">' +
      '<p class="svov__note" aria-live="polite"></p>' +
      '<div class="svov__row"><button type="button" class="svov__btn" data-a="cancel">Batal</button>' +
      '<button type="button" class="svov__btn svov__btn--ok" data-a="ok">Simpan</button></div>' +
    '</div>';
  document.body.appendChild(ov);
  const inp = ov.querySelector('.svov__in') as HTMLInputElement;
  const note = ov.querySelector('.svov__note') as HTMLElement;
  const okBtn = ov.querySelector('[data-a="ok"]') as HTMLButtonElement;
  let busy = false;

  const closeOv = (): void => { ov.hidden = true; busy = false; };
  const openOv = async (): Promise<void> => {
    if (DEMO) { demoNotice('save'); return; }   // DEMO: simpan project hanya di versi penuh
    if (!io) { say('Project belum siap, coba lagi sebentar'); return; }
    if (!curName) {
      let n = 1; const taken = new Set((await listProjects().catch(() => [])).map(p => p.name));
      while (taken.has('Project ' + n)) n++;
      curName = 'Project ' + n;
    }
    inp.value = curName; note.textContent = ''; okBtn.textContent = 'Simpan'; okBtn.disabled = false;
    ov.hidden = false; inp.focus(); inp.select();
    void checkExists();
  };
  const checkExists = async (): Promise<void> => {
    const n = inp.value.trim();
    const ex = n ? await projectExists(n).catch(() => false) : false;
    okBtn.textContent = ex ? 'Timpa' : 'Simpan';
    note.textContent = ex ? 'Nama ini sudah ada, file lama akan ditimpa.' : '';
  };
  const doSave = async (): Promise<void> => {
    const name = inp.value.trim().replace(/\s+/g, ' ');
    if (!name) { note.textContent = 'Nama file tidak boleh kosong.'; inp.focus(); return; }
    if (busy || !io) return;
    busy = true; okBtn.disabled = true; note.textContent = 'Menyimpan…';
    try {
      const snap = io.snapshot();
      await saveProject({name, savedAt: Date.now(), data: snap.data, clips: snap.clips});
      const back = await loadProject(name);   // baca ulang: pastikan benar-benar tersimpan
      if (!back) throw new Error('verifikasi gagal');
      curName = name;
      note.textContent = '✓ Tersimpan: ' + name;
      ov.classList.add('is-done');
      await refresh();
      setTimeout(() => { ov.classList.remove('is-done'); closeOv(); }, 900);
    } catch (err) {
      console.error(err);
      note.textContent = 'Gagal menyimpan (penyimpanan browser penuh atau diblokir).';
      busy = false; okBtn.disabled = false;
    }
  };
  // Tahan SAVE: timpa project yang sedang dibuka dengan perubahan terbaru (tanpa buat project baru).
  // Kalau belum ada project aktif, tahan = sama seperti ketuk (minta nama project baru).
  const HOLD_MS = 700;
  const saveBtn = panel.querySelector('.mp__savebtn') as HTMLButtonElement;
  let holdT = 0, held = false, quickBusy = false;
  const quickSave = async (): Promise<void> => {
    if (DEMO) { demoNotice('save'); return; }
    if (!io) { say('Project belum siap, coba lagi sebentar'); return; }
    if (!curName || !(await projectExists(curName).catch(() => false))) { void openOv(); return; }
    if (quickBusy) return;
    quickBusy = true;
    try {
      const snap = io.snapshot();
      await saveProject({name: curName, savedAt: Date.now(), data: snap.data, clips: snap.clips});
      if (!(await loadProject(curName))) throw new Error('verifikasi gagal');
      await refresh();
      say('✓ Perubahan tersimpan: ' + curName);
      saveBtn.classList.add('is-saved'); setTimeout(() => saveBtn.classList.remove('is-saved'), 900);
    } catch (err) { console.error(err); say('Gagal menyimpan (penyimpanan browser penuh atau diblokir).'); }
    quickBusy = false;
  };
  const cancelHold = (): void => { clearTimeout(holdT); saveBtn.classList.remove('is-holding'); };
  saveBtn.style.setProperty('--hold', HOLD_MS + 'ms');
  saveBtn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    held = false; cancelHold();
    saveBtn.classList.add('is-holding');
    holdT = window.setTimeout(() => {
      held = true; saveBtn.classList.remove('is-holding');
      if (navigator.vibrate) navigator.vibrate(30);
      void quickSave();
    }, HOLD_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => saveBtn.addEventListener(t, cancelHold));
  saveBtn.addEventListener('contextmenu', e => e.preventDefault());   // tahan di HP jangan memunculkan menu konteks
  saveBtn.addEventListener('click', () => {
    if (held) { held = false; return; }   // klik setelah tahan sudah ditangani quickSave
    void openOv();
  });
  ov.querySelector('.svov__back')!.addEventListener('pointerdown', () => { if (!busy) closeOv(); });
  ov.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-a]')?.getAttribute('data-a');
    if (a === 'cancel') closeOv(); else if (a === 'ok') void doSave();
  });
  inp.addEventListener('input', () => { void checkExists(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void doSave(); }
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) closeOv(); }
  });
  document.addEventListener('keydown', e => { if (!ov.hidden && e.key === 'Escape') { e.stopPropagation(); if (!busy) closeOv(); } }, true);

  // daftar file: buka / unduh / hapus
  const download = (name: string, text: string): void => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
    a.download = name.replace(/[^\w\- ]+/g, '_') + '.derizmp3.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  filesEl.addEventListener('click', async e => {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    const li = btn && btn.closest('.mp__file') as HTMLElement | null;
    if (!btn || !li) return;
    if (!io) { say('Project belum siap, coba lagi sebentar'); refreshProjects(); return; }
    const name = li.dataset.n as string, act = btn.dataset.act;
    try {
      if (act === 'open') {
        say('Membuka ' + name + '…', 0);
        const rec = await loadProject(name);
        if (!rec) { say('File tidak ditemukan'); return; }
        await io.restore(rec); curName = name;
        say('Project dibuka: ' + name); apply(false, true);
      } else if (act === 'dl') {
        const rec = await loadProject(name); if (rec) download(name, await recordToJson(rec));
      } else if (act === 'del') {
        if (btn.dataset.sure !== '1') {   // ketuk dua kali: pertama minta konfirmasi
          btn.dataset.sure = '1'; btn.classList.add('is-sure'); btn.title = 'Ketuk lagi untuk hapus';
          setTimeout(() => { btn.dataset.sure = ''; btn.classList.remove('is-sure'); btn.title = 'Hapus'; }, 2500);
          return;
        }
        await deleteProject(name); if (curName === name) curName = ''; await refresh();
      }
    } catch (err) { console.error(err); say('Gagal memproses file project'); }
  });
  const impFile = panel.querySelector('.mp__impfile') as HTMLInputElement;
  panel.querySelector('[data-impjson]')!.addEventListener('click', () => { if (DEMO) { demoNotice('save'); return; } impFile.click(); });
  impFile.addEventListener('change', async () => {
    const f = impFile.files && impFile.files[0]; impFile.value = '';
    if (!f || !io) return;
    try {
      const rec = await jsonToRecord(await f.text());
      await saveProject(rec); await refresh();
      await io.restore(rec); curName = rec.name;
      say('Project dibuka: ' + rec.name); apply(false, true);
    } catch (err) { console.error(err); say('Gagal membuka file: ' + (err instanceof Error ? err.message : 'tidak valid')); }
  });

  apply(false, false);
  document.body.append(panel, btn);
  requestAnimationFrame(() => panel.classList.add('mp--ready'));   // transisi baru aktif setelah keadaan awal terpasang

  return { isOpen: () => open, setOpen: v => { if (v !== open) apply(v, true); } };
}
