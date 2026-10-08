// Simpan hasil olahan MPCS ke file: WAV 16-bit atau MP3 (mono, sample rate sama dengan audio asli).
// Hasil olahan bisa melewati 0 dBFS setelah pitch digeser; kalau begitu seluruh sinyal diturunkan sedikit (bukan dipotong) supaya tidak pecah.

export type SaveFormat = 'wav' | 'mp3';
const MP3_KBPS = 192;
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const yieldUI = (): Promise<void> => new Promise(res => setTimeout(res, 0));

function toI16(x: Float32Array, a: number, b: number, g: number): Int16Array {
  const o = new Int16Array(b - a);
  for (let i = a; i < b; i++) { const v = Math.max(-1, Math.min(1, x[i] * g)); o[i - a] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return o;
}
function gain(x: Float32Array): number {
  let pk = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  return pk > 1 ? 0.999 / pk : 1;
}

export function encodeWav16Mono(x: Float32Array, sr: number): Blob {
  const n = x.length, g = gain(x), dv = new DataView(new ArrayBuffer(44 + n * 2));
  const tag = (o: number, t: string): void => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, n * 2, true);
  const s = toI16(x, 0, n, g); for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, s[i], true);
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

async function resample(x: Float32Array, from: number, to: number): Promise<Float32Array> {
  const buf = new AudioBuffer({ length: x.length, numberOfChannels: 1, sampleRate: from });
  buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  const off = new OfflineAudioContext(1, Math.ceil(x.length * to / from), to), src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

export async function encodeMp3Mono(x: Float32Array, sr: number, prog?: (p: number) => void): Promise<Blob> {
  if (!MP3_RATES.includes(sr)) { x = await resample(x, sr, 48000); sr = 48000; }
  const g = gain(x);
  const { Mp3Encoder } = await import('@breezystack/lamejs');   // dimuat hanya saat dipakai
  const enc = new Mp3Encoder(1, sr, MP3_KBPS), BLK = 1152 * 16, parts: Uint8Array[] = [];
  for (let i = 0, k = 0; i < x.length; i += BLK, k++) {
    const e = Math.min(x.length, i + BLK), out = enc.encodeBuffer(toI16(x, i, e, g));
    if (out.length) parts.push(out);
    if (k % 8 === 7) { prog?.(e / x.length); await yieldUI(); }
  }
  const end = enc.flush(); if (end.length) parts.push(end);
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

export function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
