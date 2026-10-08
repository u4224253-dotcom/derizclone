// Bunyi klik metronome (WebAudio). Klik dijadwalkan pada waktu AudioContext yang tepat oleh scheduler di main.ts,
// jadi tetap presisi walau tab sibuk. Semua klik yang belum bunyi bisa dibatalkan (ganti BPM / metronome dimatikan).

interface Click { osc: OscillatorNode; g: GainNode; when: number; }
const live = new Set<Click>();
let out: GainNode | null = null;

export function click(ctx: AudioContext, when: number, accent: boolean): void {
  if (!out || out.context !== ctx) { out = ctx.createGain(); out.gain.value = .9; out.connect(ctx.destination); }
  const t = Math.max(when, ctx.currentTime), osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1568 : 1047;      // ketukan 1 lebih tinggi
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 1 : .7, t + .002);
  g.gain.exponentialRampToValueAtTime(.0001, t + .05);
  osc.connect(g); g.connect(out);
  osc.start(t); osc.stop(t + .06);
  const c: Click = { osc, g, when: t };
  live.add(c);
  osc.onended = () => { live.delete(c); osc.disconnect(); g.disconnect(); };
}

// all=false: batalkan hanya klik yang belum bunyi; all=true: hentikan semuanya (pause)
export function cancel(ctx: AudioContext | null, all = false): void {
  if (!ctx) return;
  live.forEach(c => {
    if (all || c.when > ctx.currentTime + .002) {
      live.delete(c);
      c.osc.onended = null;
      try { c.osc.stop(); } catch { /* sudah berhenti */ }
      c.osc.disconnect(); c.g.disconnect();
    }
  });
}
