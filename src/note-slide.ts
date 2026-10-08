// Slide note (meluncur): nada bertanda `sl` tidak dibunyikan ulang, tapi nada sebelumnya meluncur ke tinggi nada ini.
// Sumbernya = nada dengan awal terdekat SEBELUM nada slide yang masih berbunyi (atau tepat bersambung) saat slide mulai.
export interface SlideNote { p: number; s: number; l: number; sl?: boolean }
const EPS = 1e-6;
export const GLIDE_MAX = 1;   // lama luncuran maksimum (ketukan); nada lebih pendek = luncuran selama panjang nadanya
export const glideBeats = (n: { l: number }): number => Math.min(n.l, GLIDE_MAX);

export function slideSource<T extends SlideNote>(notes: T[], n: T): T | null {
  if (!n.sl) return null;
  let best: T | null = null;
  for (const o of notes) {
    if (o === n || o.s >= n.s - EPS) continue;        // harus mulai lebih dulu
    if (o.s + o.l < n.s - EPS) continue;              // sudah selesai sebelum slide mulai (ada jeda): tidak bersambung
    if (!best || o.s > best.s + EPS || (Math.abs(o.s - best.s) <= EPS && Math.abs(o.p - n.p) < Math.abs(best.p - n.p))) best = o;
  }
  return best;
}
