// Meter level stereo di card track (channel mixer): dua batang LED bersegmen (kiri & kanan) dengan glow dan peak hold.
// Level dibaca tiap frame dari audio-engine, diubah ke dB (-54..0), attack cepat dan turun perlahan seperti meter DAW.
// Meter hanya digambar saat channel mixer terbuka (saat ditutup, meter disembunyikan lewat CSS dan tidak dihitung).

import { trackLevels } from './audio-engine';

const NSEG = 14;                      // harus sama dengan --n di CSS .trackmeter
const FLOOR_DB = -54;                 // di bawah ini dianggap kosong
const FALL_PER_SEC = 1.3;             // kecepatan turun batang (skala 0..1 per detik)
const PEAK_HOLD_MS = 900, PEAK_FALL_PER_SEC = 0.7;
const toNorm = (lin: number): number => lin <= 1e-5 ? 0 : Math.max(0, Math.min(1, 1 - 20 * Math.log10(lin) / FLOOR_DB));
const seg = (v: number): number => Math.ceil(v * NSEG - 1e-6);   // 0..NSEG segmen menyala

interface Ch { v: number; pk: number; pkAt: number; s: number; ps: number; hot: number; }   // nilai halus, puncak, segmen tampil
const mkCh = (): Ch => ({ v: 0, pk: 0, pkAt: 0, s: -1, ps: -1, hot: -1 });

export function initTrackMeters(): void {
  const state = new Map<string, [Ch, Ch]>();
  const tlist = document.querySelector('.tracklist') as HTMLElement | null;
  let last = performance.now();

  const step = (c: Ch, lin: number, now: number, dt: number) => {
    c.v = Math.max(toNorm(lin), c.v - FALL_PER_SEC * dt);
    if (c.v < 0.002) c.v = 0;
    if (c.v >= c.pk) { c.pk = c.v; c.pkAt = now; }
    else if (now - c.pkAt > PEAK_HOLD_MS) c.pk = Math.max(c.v, c.pk - PEAK_FALL_PER_SEC * dt);
  };

  const paint = (bar: HTMLElement, c: Ch) => {
    const s = seg(c.v), ps = seg(c.pk), hot = c.v > 0.9 ? 3 : c.v > 0.72 ? 2 : 1;
    if (s !== c.s) {
      c.s = s;
      (bar.children[0] as HTMLElement).style.clipPath = `inset(${((1 - s / NSEG) * 100).toFixed(2)}% 0 0 0)`;
    }
    if (ps !== c.ps) {
      c.ps = ps;
      (bar.children[1] as HTMLElement).style.clipPath = ps <= 0 ? 'inset(100% 0 0 0)'
        : `inset(${((1 - ps / NSEG) * 100).toFixed(2)}% 0 ${(((ps - 1) / NSEG) * 100).toFixed(2)}% 0)`;
    }
    if (hot !== c.hot) { c.hot = hot; bar.dataset.l = String(hot); }
  };

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (document.hidden || tlist?.classList.contains('tracklist--collapsed')) return;   // tersembunyi: tidak perlu dihitung
    document.querySelectorAll<HTMLElement>('.trkcard-wrap').forEach(el => {
      const id = el.dataset.track!, bars = el.querySelectorAll<HTMLElement>('.trackmeter__bar');
      if (bars.length < 2) return;
      let st = state.get(id);
      if (!st) { st = [mkCh(), mkCh()]; state.set(id, st); }
      const [pl, pr] = trackLevels(id);
      step(st[0], pl, now, dt); step(st[1], pr, now, dt);
      paint(bars[0], st[0]); paint(bars[1], st[1]);
    });
  };
  requestAnimationFrame(frame);
}
