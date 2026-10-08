// Export audio: merekam keluaran master (persis yang terdengar: semua track, efek, plugin, otomasi) selama project diputar dari bar 1
// sampai akhir isi timeline + ekor (reverb / release), lalu dikemas jadi WAV 16-bit atau MP3 dan diunduh.
// Direkam secara real-time karena seluruh mesin suara (DERIZ, Supersaw, rak efek, MPCS) hidup di AudioContext yang sedang berjalan.
// Selama merekam, layar dikunci oleh overlay dan tab harus tetap terbuka (browser menahan penjadwal nada di tab latar).

export type ExportFormat = 'mp3' | 'wav';

// Jembatan ke main.ts (yang memegang transport dan isi timeline)
export interface ExportIO {
  ctx(): AudioContext;
  tap(): AudioNode | null;     // keluaran master setelah pengaman clipping (sama dengan yang sampai ke speaker)
  contentSec(): number;        // panjang isi timeline dalam detik (0 = kosong)
  begin(): number;             // putar dari bar 1 tanpa metronome / count-in; mengembalikan waktu mulai (detik, jam AudioContext)
  isPlaying(): boolean;
  nowSec(): number;            // detik sejak mulai
  end(): void;                 // hentikan putar dan kembalikan posisi playhead + metronome seperti semula
  toast(msg: string, ms?: number): void;
}
import { DEMO, demoNotice } from './demo';
let io: ExportIO | null = null;
export function setExportIO(v: ExportIO): void { io = v; }

const TAIL_SEC = 2.5;             // ekor setelah isi berakhir (reverb, delay, release synth)
const MP3_KBPS = 192;
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const SILENCE = 0.0005;           // ~ -66 dBFS: ambang "sunyi" untuk memangkas ekor yang sudah habis
const KEEP_AFTER = 0.15;          // sisakan 150 ms setelah suara terakhir

export const FMT_KEY = 'derizmp3.exportFmt';
let busy = false;
export const isExporting = (): boolean => busy;

// ---------- perekam (AudioWorklet): mengumpulkan sampel master per blok 2048 frame ----------
const WORKLET_SRC = `
class Rec extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.n = 0; this.l = new Float32Array(2048); this.r = new Float32Array(2048); this.f0 = 0;
    this.port.onmessage = e => { if (e.data === 'stop') { this.flush(); this.on = false; } }; }
  flush() { if (!this.n) return; const l = this.l.slice(0, this.n), r = this.r.slice(0, this.n); this.port.postMessage({f: this.f0, l, r}, [l.buffer, r.buffer]); this.n = 0; }
  process(inputs) {
    if (!this.on) return false;
    const i = inputs[0]; if (!i || !i.length) return true;
    const a = i[0], b = i[1] || i[0], len = a.length;
    if (this.n === 0) this.f0 = currentFrame;
    this.l.set(a, this.n); this.r.set(b, this.n); this.n += len;
    if (this.n + len > 2048) this.flush();
    return true;
  }
}
registerProcessor('derizmp3-rec', Rec);`;
const loaded = new WeakSet<BaseAudioContext>();
async function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], {type: 'application/javascript'}));
  try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
  loaded.add(ctx);
}

// ---------- encoder ----------
function encodeWav16(l: Float32Array, r: Float32Array, sr: number): Blob {
  const n = l.length, dv = new DataView(new ArrayBuffer(44 + n * 4));
  const tag = (o: number, t: string): void => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const a = Math.max(-1, Math.min(1, l[i])), b = Math.max(-1, Math.min(1, r[i]));
    dv.setInt16(o, a < 0 ? a * 0x8000 : a * 0x7fff, true); dv.setInt16(o + 2, b < 0 ? b * 0x8000 : b * 0x7fff, true); o += 4;
  }
  return new Blob([dv.buffer], {type: 'audio/wav'});
}

// sample rate di luar daftar MP3 (mis. 96 kHz): diubah ke 48 kHz lewat OfflineAudioContext
async function resampleTo(l: Float32Array, r: Float32Array, from: number, to: number): Promise<[Float32Array, Float32Array]> {
  const buf = new AudioBuffer({length: l.length, numberOfChannels: 2, sampleRate: from});
  buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0); buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
  const off = new OfflineAudioContext(2, Math.ceil(l.length * to / from), to), src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

const toI16 = (x: Float32Array, a: number, b: number): Int16Array => {
  const o = new Int16Array(b - a);
  for (let i = a; i < b; i++) { const v = Math.max(-1, Math.min(1, x[i])); o[i - a] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return o;
};
const yieldUI = (): Promise<void> => new Promise(res => setTimeout(res, 0));

async function encodeMp3(l: Float32Array, r: Float32Array, sr: number, prog: (p: number) => void): Promise<Blob> {
  if (!MP3_RATES.includes(sr)) { [l, r] = await resampleTo(l, r, sr, 48000); sr = 48000; }
  const { Mp3Encoder } = await import('@breezystack/lamejs');   // dimuat hanya saat dipakai
  const enc = new Mp3Encoder(2, sr, MP3_KBPS), BLK = 1152 * 16, parts: Uint8Array[] = [];
  for (let i = 0, k = 0; i < l.length; i += BLK, k++) {
    const e = Math.min(l.length, i + BLK), out = enc.encodeBuffer(toI16(l, i, e), toI16(r, i, e));
    if (out.length) parts.push(out);
    if (k % 8 === 7) { prog(e / l.length); await yieldUI(); }
  }
  const end = enc.flush(); if (end.length) parts.push(end);
  return new Blob(parts as BlobPart[], {type: 'audio/mpeg'});
}

// ---------- overlay progres ----------
const fmtT = (s: number): string => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function makeOverlay(fmt: ExportFormat, onCancel: () => void) {
  const el = document.createElement('div');
  el.className = 'xpo';
  el.innerHTML =
    '<div class="xpo__card" role="dialog" aria-modal="true" aria-label="Export audio">' +
      '<h3 class="xpo__title">Mengekspor ' + fmt.toUpperCase() + '…</h3>' +
      '<div class="xpo__bar"><i></i></div>' +
      '<p class="xpo__time" aria-live="polite"></p>' +
      '<p class="xpo__hint">Audio direkam saat project diputar. Biarkan tab ini tetap terbuka.</p>' +
      '<button type="button" class="xpo__cancel">Batal</button>' +
    '</div>';
  document.body.appendChild(el);
  const bar = el.querySelector('.xpo__bar i') as HTMLElement, time = el.querySelector('.xpo__time') as HTMLElement, title = el.querySelector('.xpo__title') as HTMLElement;
  const cancel = el.querySelector('.xpo__cancel') as HTMLButtonElement;
  cancel.addEventListener('click', onCancel);
  cancel.focus();
  return {
    set(p: number, txt: string): void { bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)) + ')'; time.textContent = txt; },
    phase(t: string): void { title.textContent = t; },
    lock(): void { cancel.hidden = true; },
    remove(): void { el.remove(); },
  };
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- alur export ----------
export async function runExport(fmt: ExportFormat, baseName: string): Promise<void> {
  if (DEMO) { demoNotice('export'); return; }   // DEMO: export audio hanya di versi penuh
  if (busy) return;
  if (!io) { alert('Export belum siap, coba lagi sebentar.'); return; }
  const dur = io.contentSec();
  if (dur <= 0.05) { io.toast('Timeline masih kosong, tidak ada yang bisa diekspor'); return; }
  const ctx = io.ctx();
  if (!ctx.audioWorklet) { io.toast('Browser ini belum mendukung export audio'); return; }
  busy = true;
  document.documentElement.dataset.exporting = '1';

  let aborted = '', recNode: AudioWorkletNode | null = null, mute: GainNode | null = null, timer = 0, wake: { release(): Promise<void> } | null = null;
  const chunks: Array<{f: number; l: Float32Array; r: Float32Array}> = [];
  let tapNode: AudioNode | null = null;
  const ui = makeOverlay(fmt, () => { aborted = 'Export dibatalkan'; });

  // selama merekam: semua tombol keyboard diblokir (supaya Space / panah / Home tidak mengganggu), kecuali Esc = batal
  const onKey = (e: KeyboardEvent): void => {
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.key === 'Escape') aborted = aborted || 'Export dibatalkan';
  };
  const onVis = (): void => { if (document.hidden) aborted = aborted || 'Export dibatalkan: tab disembunyikan (penjadwal suara berhenti di tab latar)'; };
  window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true);
  document.addEventListener('visibilitychange', onVis);

  const cleanup = (): void => {
    clearInterval(timer);
    try { recNode?.port.postMessage('stop'); } catch { /* sudah berhenti */ }
    setTimeout(() => { try { if (tapNode && recNode) tapNode.disconnect(recNode); recNode?.disconnect(); mute?.disconnect(); } catch { /* abaikan */ } }, 300);
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    wake?.release().catch(() => { /* abaikan */ });
    delete document.documentElement.dataset.exporting;
  };

  try {
    const tap = io.tap();
    if (!tap) throw new Error('keluaran master belum siap');
    tapNode = tap;
    await ensureWorklet(ctx);
    try { wake = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* tidak wajib */ }
    recNode = new AudioWorkletNode(ctx, 'derizmp3-rec', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit'});
    recNode.port.onmessage = e => chunks.push(e.data);
    mute = ctx.createGain(); mute.gain.value = 0;                      // sambungan senyap supaya node diproses di semua browser
    tap.connect(recNode); recNode.connect(mute); mute.connect(ctx.destination);

    const startCtx = io.begin(), sr = ctx.sampleRate, total = dur + TAIL_SEC;
    let phase: 'play' | 'tail' = 'play';
    // tunggu sampai waktu rekam selesai (isi + ekor), atau dibatalkan
    await new Promise<void>(resolve => {
      timer = window.setInterval(() => {
        const t = io!.nowSec();
        if (!aborted && phase === 'play' && !io!.isPlaying() && t < dur - 0.25) aborted = 'Export dibatalkan: pemutaran dihentikan';
        if (aborted || t >= total) { resolve(); return; }
        if (phase === 'play' && t >= dur) { phase = 'tail'; io!.end(); ui.phase('Menangkap ekor suara…'); }   // isi selesai: sumber dihentikan, efek tetap berbunyi sampai ekor habis
        ui.set(t / total, fmtT(Math.max(0, t)) + ' / ' + fmtT(total));
      }, 100);
    });
    clearInterval(timer);
    io.end();                                                          // aman dipanggil dua kali; juga mengembalikan keadaan transport kalau dibatalkan
    if (aborted) throw new Error(aborted);

    // ambil sampel: dari frame startCtx sampai total detik
    recNode.port.postMessage('stop'); await new Promise(r => setTimeout(r, 120));
    chunks.sort((a, b) => a.f - b.f);
    const f0 = Math.round(startCtx * sr), len = Math.round(total * sr);
    let L = new Float32Array(len), R = new Float32Array(len);
    for (const c of chunks) {
      const cl = c.l, cr = c.r, off = c.f - f0;
      for (let i = 0; i < cl.length; i++) { const j = off + i; if (j >= 0 && j < len) { L[j] = cl[i]; R[j] = cr[i]; } }
    }
    // pangkas ekor sunyi, tapi jangan lebih pendek dari isi timeline
    let last = len - 1; while (last > 0 && Math.abs(L[last]) < SILENCE && Math.abs(R[last]) < SILENCE) last--;
    const end = Math.min(len, Math.max(Math.round(dur * sr), last + 1 + Math.round(KEEP_AFTER * sr)));
    L = L.subarray(0, end); R = R.subarray(0, end);
    const fade = Math.min(end, Math.round(0.01 * sr));                 // fade-out 10 ms: tidak ada "klik" di titik potong
    for (let i = 0; i < fade; i++) { const g = i / fade; L[end - 1 - i] *= g; R[end - 1 - i] *= g; }

    ui.lock(); ui.phase(fmt === 'mp3' ? 'Mengonversi ke MP3…' : 'Menyusun file WAV…'); ui.set(0, '');
    await yieldUI();
    const blob = fmt === 'mp3' ? await encodeMp3(L, R, sr, p => ui.set(p, Math.round(p * 100) + '%')) : encodeWav16(L, R, sr);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    download(blob, (baseName || 'derizmp3').replace(/[^\w\- ]+/g, '_') + '-' + stamp + '.' + fmt);
    io.toast('✓ Export ' + fmt.toUpperCase() + ' selesai (' + (blob.size / 1048576).toFixed(1) + ' MB)', 4200);
  } catch (err) {
    io.end();
    const msg = (err as Error).message || 'Export gagal';
    if (!aborted) console.error(err);
    io.toast(aborted ? msg : 'Export gagal: ' + msg, 4200);
  } finally {
    cleanup(); ui.remove(); busy = false;
  }
}
