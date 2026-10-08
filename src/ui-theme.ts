// Tema UI (atribut data-ui di <html>): 'ink' = Ink Rose (bawaan), 'mono' = Mono Graphite.
// Warna CSS ada di styles.css; file ini hanya untuk bagian yang digambar lewat canvas / diisi dari JS.
export type UiTheme = 'ink' | 'mono';

export const uiTheme = (): UiTheme => {
  const v = document.documentElement.dataset.ui;
  return v === 'mono' ? v : 'ink';
};

const INK = ['#ff5c9e', '#a66cff', '#5b8ff3', '#2dd4bf', '#3fbf5f', '#f2b632', '#ff8a4c', '#ef4444'];
// warna track baru / menu warna per tema
export const TRACK_COLORS: Record<UiTheme, string[]> = {
  ink: INK,
  mono: INK
};

// Gaya UI Flat (atribut data-uistyle="flat"): warna pattern / track diambil dari palet gambar referensi (sama dengan --flat-pal-* di flat-ui.css)
export const isFlat = (): boolean => document.documentElement.dataset.uistyle === 'flat';
//                              oranye     teal       ungu       pink       biru       merah      kuning     mauve
export const FLAT_TRACK_COLORS = ['#f19c39', '#3a7e78', '#c156d7', '#ce458d', '#84a0ce', '#f9695b', '#f5c262', '#a3738c'];
// warna bawaan tiap instrumen saat Flat aktif (nama instrumen -> warna palet)
const FLAT_INST: Record<string, string> = { 'Audio clip': '#3a7e78', 'Supersaw': '#c156d7', 'DERIZ': '#84a0ce', 'Drums': '#f19c39' };
export const instColor = (name: string, base: string): string => (isFlat() && FLAT_INST[name]) || base;

// isi array warna di tempat (referensi lama tetap valid); track yang sudah ada tidak berubah warnanya
export const syncTrackColors = (target: string[]): void => { target.splice(0, target.length, ...(isFlat() ? FLAT_TRACK_COLORS : TRACK_COLORS[uiTheme()])); };
