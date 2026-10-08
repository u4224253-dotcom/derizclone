// Versi DEMO: semua fitur boleh dicoba dan didengar, tapi hasil yang dibawa keluar diberi batas / penanda.
// Build penuh: __DEMO__ = false, seluruh cabang `if (DEMO)` dibuang bundler (kode demo tidak ikut).
// Build demo : vite build --mode demo  -> dist-demo/
export const DEMO: boolean = typeof __DEMO__ !== 'undefined' && __DEMO__;

// Ubah di sini saja (satu tempat). Kosongkan CONTACT_URL kalau belum ada (tombol Hubungi disembunyikan).
export const CONTACT_URL = '';   // contoh: 'https://wa.me/62812xxxxxxx?text=Saya%20tertarik%20versi%20penuh'
export const LIMITS = {
  tracks: 4,        // jumlah track dalam project
  deriz: 2,         // jumlah track DERIZ
  derizPlugins: 4,  // jumlah plugin DERIZ di seluruh project (bawaan track DERIZ + hasil Add dari daftar efek + hasil Duplicate)
  bars: 32,         // panjang timeline (bar)
  audioSec: 30,     // audio yang di-upload ke track Audio clip, detik
  mpcsSec: 15,      // audio yang dimuat ke MPCS, detik (lebih pendek dari audio clip)
  mgcBars: 4,       // panjang progression MGCHORD
  mgcStyles: ['Block', 'Stab', 'Pluck'],   // style MGCHORD yang terbuka
  mgcMidiChords: 2, // jumlah chord yang ikut saat ekspor MIDI MGCHORD
};

export type LockKind = 'track' | 'deriz' | 'derizplug' | 'bars' | 'audio' | 'automation' | 'save' | 'export' | 'mgcstyle' | 'mgcsound' | 'mgcrange' | 'mgcbars' | 'mgcmidi';
const MSG: Record<LockKind, [string, string]> = {
  track: ['Batas track demo', `Versi demo dibatasi ${LIMITS.tracks} track. Versi penuh tanpa batas track.`],
  deriz: ['Batas DERIZ demo', `Versi demo dibatasi ${LIMITS.deriz} DERIZ per project.`],
  derizplug: ['Batas plugin DERIZ demo', `Versi demo dibatasi ${LIMITS.derizPlugins} plugin DERIZ per project (termasuk hasil Add / Duplicate). Versi penuh tanpa batas plugin.`],
  bars: ['Batas panjang demo', `Timeline versi demo dibatasi ${LIMITS.bars} bar.`],
  audio: ['Audio dipotong', `Versi demo memakai ${LIMITS.audioSec} detik pertama dari audio. Versi penuh memuat audio utuh.`],
  automation: ['Automation Clip', 'Automation Clip ada di versi penuh.'],
  save: ['Simpan project', 'Menyimpan dan membuka file project ada di versi penuh. Di demo, project hilang saat halaman ditutup.'],
  export: ['Export audio', 'Export audio (MP3 / WAV) hanya ada di versi penuh. Di demo, kamu bisa membuat dan mendengarkan lagu, tapi tidak bisa mengunduhnya.'],
  mgcstyle: ['Style MGCHORD', 'Style ini ada di versi penuh.'],
  mgcsound: ['Suara MGCHORD', 'Suara ini ada di versi penuh.'],
  mgcrange: ['Rentang keyboard', 'Rentang keyboard lain ada di versi penuh.'],
  mgcbars: ['8 bar MGCHORD', 'Progression 8 bar ada di versi penuh.'],
  mgcmidi: ['Export MIDI demo', `MIDI demo hanya memuat ${LIMITS.mgcMidiChords} chord pertama. Versi penuh: semua chord.`],
};

// penghitung event (opsional): kalau skrip Plausible dipasang di index.html, event dikirim; kalau tidak, tidak terjadi apa-apa
export function demoEvent(name: string, props?: Record<string, string | number>): void {
  try { (window as unknown as { plausible?: (n: string, o?: { props?: Record<string, string | number> }) => void }).plausible?.(name, props ? { props } : undefined); } catch { /* abaikan */ }
}

let ov: HTMLElement | null = null;
function dialog(title: string, body: string, extra = ''): void {
  ov?.remove();
  ov = document.createElement('div'); ov.className = 'demo__ov';
  ov.innerHTML = `<div class="demo__card" role="dialog" aria-modal="true" aria-label="${title}"><h3>${title}</h3><p>${body}</p>${extra}` +
    `<div class="demo__btns">${CONTACT_URL ? `<a class="demo__go" href="${CONTACT_URL}" target="_blank" rel="noopener" data-ev="demo_contact">Hubungi untuk versi penuh</a>` : ''}<button type="button" class="demo__ok">Mengerti</button></div></div>`;
  document.body.appendChild(ov);
  const close = (): void => { ov?.remove(); ov = null; document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.addEventListener('click', e => { const t = e.target as HTMLElement; if (t === ov || t.closest('.demo__ok')) close(); if (t.closest('[data-ev]')) demoEvent('demo_contact'); });
  ov.querySelector<HTMLElement>('.demo__ok')!.focus();
}
let lastAt = 0, lastKind = '';
export function demoNotice(kind: LockKind): void {   // kotak kecil saat menekan fitur terkunci / batas (tidak diulang dalam 1,5 detik)
  const now = Date.now(); if (kind === lastKind && now - lastAt < 1500) return; lastAt = now; lastKind = kind;
  demoEvent('locked_click', { f: kind });
  const [t, b] = MSG[kind]; dialog(t, b);
}

// penanda suara pada hasil yang dibawa keluar: bunyi "bip-bip" pendek tiap 8 detik (kualitas sisanya tidak diubah)
export function demoMark(chs: Float32Array[], sr: number): void {
  const gap = Math.round(8 * sr), dur = Math.round(0.22 * sr);
  for (const x of chs) for (let s = Math.round(1.5 * sr); s < x.length; s += gap) {
    for (let i = 0; i < dur && s + i < x.length; i++) {
      const t = i / sr, env = Math.sin(Math.PI * i / dur), f = i < dur / 2 ? 880 : 660;
      x[s + i] += 0.14 * env * Math.sin(2 * Math.PI * f * t);
    }
  }
}
export const demoMarked = (x: Float32Array, sr: number): Float32Array<ArrayBuffer> => { const y = x.slice(); demoMark([y], sr); return y; };
export const demoMarkedBuf = (b: AudioBuffer): AudioBuffer => {   // salinan AudioBuffer yang diberi penanda
  const o = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(demoMarked(b.getChannelData(c), b.sampleRate) as Float32Array<ArrayBuffer>, c);
  return o;
};
export function demoTrim(b: AudioBuffer, sec: number): AudioBuffer {   // potong audio ke `sec` detik pertama
  const n = Math.round(sec * b.sampleRate); if (b.length <= n) return b;
  const o = new AudioBuffer({ length: n, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(b.getChannelData(c).slice(0, n) as Float32Array<ArrayBuffer>, c);
  return o;
}

// lencana "DEMO" di pojok + jendela info (batas demo, Credits, kontak)
export function demoMount(): void {
  if (!DEMO || document.querySelector('.demo__badge')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'demo__badge'; b.textContent = 'DEMO · info'; b.title = 'Batas versi demo, Credits';
  b.addEventListener('click', () => {
    demoEvent('demo_info');
    dialog('Versi DEMO',
      `Semua fitur bisa dicoba. Yang dibatasi: ${LIMITS.tracks} track, ${LIMITS.derizPlugins} plugin DERIZ, ${LIMITS.bars} bar, audio clip ${LIMITS.audioSec} detik, MPCS ${LIMITS.mpcsSec} detik, tanpa export audio, tanpa simpan project, tanpa Automation Clip.`,
      '<h4>Credits</h4><p class="demo__cr">Piano: Salamander Grand Piano V3 oleh Alexander Holm (CC BY 3.0, creativecommons.org/licenses/by/3.0). Font: Syncopate (SIL OFL). Encoder MP3: lamejs (LGPL).</p>');
  });
  document.body.appendChild(b);
  demoEvent('demo_open');
}
