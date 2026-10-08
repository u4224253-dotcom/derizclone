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

// isi array warna di tempat (referensi lama tetap valid); track yang sudah ada tidak berubah warnanya
export const syncTrackColors = (target: string[]): void => { target.splice(0, target.length, ...TRACK_COLORS[uiTheme()]); };
