// Menutup menu bawaan browser (klik kanan di desktop, tekan-tahan di HP) di seluruh aplikasi, supaya tidak mengganggu
// tuts piano DERIZ, piano roll, dan tombol-tombol yang memakai tekan-tahan. Kolom teks tetap boleh punya menu (salin / tempel).
// Hanya mencegah menu bawaan: handler contextmenu milik fitur lain (mis. hapus titik automation) tetap jalan.

const EDITABLE = 'input:not([type="range"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable=""], [contenteditable="true"]';

document.addEventListener('contextmenu', (e: Event) => {
  const t = e.target as Element | null;
  if (t && t.closest && t.closest(EDITABLE)) return;
  e.preventDefault();
});

// gambar / ikon tidak ikut tertarik (drag ghost) saat ditahan
document.addEventListener('dragstart', (e: DragEvent) => {
  const t = e.target as Element | null;
  if (t && t.tagName === 'IMG') e.preventDefault();
});
