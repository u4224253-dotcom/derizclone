// Keyboard horizontal "Ivory Capsule": markup tuts dibangun di sini (posisi dihitung kode, bukan HTML salinan).
// Dipakai keyboard dock bawah (main.ts) dan keyboard mini plugin DERIZ (fx-rack.ts). Tampilan ada di blok ".ivk" di styles.css.
// Kelas: .ivk (wadah) > .ivk__scroll > .ivk__keys > .ivk__w (putih) / .ivk__b (hitam); tuts ditekan = .is-down.

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_PC = new Set([1, 3, 6, 8, 10]);
const pc = (m: number): number => ((m % 12) + 12) % 12;

export const ivkIsBlack = (m: number): boolean => BLACK_PC.has(pc(m));
export const ivkName = (m: number): string => PC_NAMES[pc(m)] + (Math.floor(m / 12) - 1);   // 60 -> C4 (middle C)

// Satu tuts. caps: kotak huruf tombol komputer di dalam tuts (diisi ivkSetCaps). Nama nada hanya tampil di tuts C.
export function ivkKey(m: number, style: string, caps = false): string {
  const black = ivkIsBlack(m), isC = !black && pc(m) === 0;
  return `<button type="button" class="${black ? 'ivk__b' : 'ivk__w' + (isC ? ' is-c' : '')}" data-midi="${m}" aria-label="${ivkName(m)}" tabindex="-1" style="${style}">` +
    (caps ? '<i class="ivk__cap"></i>' : '') + (isC ? `<b class="ivk__lbl">${ivkName(m)}</b>` : '') + '</button>';
}

// Keyboard dock: dari MIDI lo sampai hi (A-1 .. C7), posisi dalam px. Tuts putih selebar 66px berjarak 68px, tuts hitam 44px di batas tuts putih.
export const IVK_PITCH = 68, IVK_WHITE = 66, IVK_BLACK = 44;
export function ivkDock(lo = 9, hi = 96): { html: string; width: number; c0: number } {
  let html = '', whites = 0, c0 = 0;
  for (let m = lo; m <= hi; m++) {
    if (ivkIsBlack(m)) { html += ivkKey(m, `left:${whites * IVK_PITCH - IVK_BLACK / 2}px`, true); continue; }
    if (m === 12) c0 = whites * IVK_PITCH;
    html += ivkKey(m, `left:${whites * IVK_PITCH}px`, true); whites++;
  }
  return { html, width: whites * IVK_PITCH - (IVK_PITCH - IVK_WHITE), c0 };
}

// Isi huruf tombol komputer di tiap tuts sesuai oktaf dasar yang sedang aktif (map: tombol -> semitone dari C dasar).
export function ivkSetCaps(root: ParentNode, base: number, map: Record<string, number>): void {
  const rev = new Map<number, string>();
  for (const k of Object.keys(map)) rev.set(map[k], k.toUpperCase());
  root.querySelectorAll<HTMLElement>('[data-midi]').forEach(el => {
    const cap = rev.get(+el.dataset.midi! - base) ?? '';
    const i = el.querySelector('.ivk__cap'); if (i && i.textContent !== cap) i.textContent = cap;
    if (cap) el.setAttribute('aria-keyshortcuts', cap.toLowerCase()); else el.removeAttribute('aria-keyshortcuts');
  });
}
