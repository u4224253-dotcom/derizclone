// Worker MPCS: analisis pitch dan render ulang dikerjakan di luar thread utama supaya UI dan audio DAW tidak tersendat.
import { analyze, render, type Controls, type Note, type PitchTrack } from './mpcs-dsp';

interface Scope { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null }
const ctx = self as unknown as Scope;

let src: Float32Array | null = null, track: PitchTrack | null = null;

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'analyze') {
      src = m.x as Float32Array;
      const r = analyze(src, m.sr, p => ctx.postMessage({ type: 'progress', p }));
      track = r.pt;
      ctx.postMessage({ type: 'analyzed', id: m.id, pt: r.pt, notes: r.notes });
    } else if (m.type === 'render') {
      if (!src || !track) throw new Error('Belum ada audio');
      const y = render(src, track, m.notes as Note[], undefined, undefined, m.ctl as Controls);   // m.ctl: knob Center / Variation / Transition
      ctx.postMessage({ type: 'rendered', id: m.id, y }, [y.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: m.id, msg: String((err as Error).message || err) });
  }
};
