// Velocity nada (0..1): 1 = penuh (nilai awal). Dipakai bersama oleh piano roll (tampilan) dan mesin suara (volume).
export const VEL_MIN = 0.05;   // batas bawah di panel: nada tetap terdengar & batangnya tetap bisa dipegang
const ALPHA_MIN = 0.28;        // nada velocity terendah tetap kelihatan di grid

const c01 = (v: number): number => Math.min(1, Math.max(0, v));
export const velOf = (v: number | undefined): number => (v === undefined ? 1 : c01(v));
// tampilan: velocity 1 = nada pekat, makin kecil makin transparan
export const velAlpha = (v: number | undefined): number => ALPHA_MIN + (1 - ALPHA_MIN) * velOf(v);
// suara: penguatan kuadrat (0.5 = -12 dB), kurva yang sama seperti velocity MIDI; 1 = tidak mengubah volume
export const velGain = (v: number | undefined): number => velOf(v) * velOf(v);
