// Encoder WAV mono 32-bit float (format 3, IEEE float). Dipakai MPCS untuk mengirim hasil olahan ke plugin DERIZ sebagai file:
// float supaya puncak yang melewati 0 dBFS tidak terpotong, dan tetap bisa di-decode oleh decodeAudioData seperti file upload biasa.
export function encodeWavFloat(x: Float32Array, sr: number): ArrayBuffer {
  const n = x.length, dataBytes = n * 4, fmtLen = 18, factLen = 4;
  const total = 12 + (8 + fmtLen) + (8 + factLen) + (8 + dataBytes);
  const ab = new ArrayBuffer(total), dv = new DataView(ab);
  let o = 0;
  const tag = (t: string): void => { for (let i = 0; i < 4; i++) dv.setUint8(o++, t.charCodeAt(i)); };
  const u16 = (v: number): void => { dv.setUint16(o, v, true); o += 2; };
  const u32 = (v: number): void => { dv.setUint32(o, v, true); o += 4; };
  tag('RIFF'); u32(total - 8); tag('WAVE');
  tag('fmt '); u32(fmtLen); u16(3); u16(1); u32(sr); u32(sr * 4); u16(4); u16(32); u16(0);   // format 3 = float, 1 channel, blockAlign 4, 32 bit, cbSize 0
  tag('fact'); u32(factLen); u32(n);
  tag('data'); u32(dataBytes);
  for (let i = 0; i < n; i++) { dv.setFloat32(o, x[i], true); o += 4; }
  return ab;
}

// Encoder WAV multi-channel 32-bit float (format 3). Dipakai CUTE untuk mengirim potongan seleksi (mono / stereo, channel dipertahankan) ke DERIZ / timeline.
export function encodeWavFloatMulti(chs: Float32Array[], sr: number): ArrayBuffer {
  const nc = Math.max(1, chs.length), n = chs.length ? chs[0].length : 0, dataBytes = n * nc * 4, fmtLen = 18, factLen = 4;
  const total = 12 + (8 + fmtLen) + (8 + factLen) + (8 + dataBytes);
  const ab = new ArrayBuffer(total), dv = new DataView(ab);
  let o = 0;
  const tag = (t: string): void => { for (let i = 0; i < 4; i++) dv.setUint8(o++, t.charCodeAt(i)); };
  const u16 = (v: number): void => { dv.setUint16(o, v, true); o += 2; };
  const u32 = (v: number): void => { dv.setUint32(o, v, true); o += 4; };
  tag('RIFF'); u32(total - 8); tag('WAVE');
  tag('fmt '); u32(fmtLen); u16(3); u16(nc); u32(sr); u32(sr * 4 * nc); u16(4 * nc); u16(32); u16(0);
  tag('fact'); u32(factLen); u32(n);
  tag('data'); u32(dataBytes);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { dv.setFloat32(o, chs[c][i], true); o += 4; }
  return ab;
}
