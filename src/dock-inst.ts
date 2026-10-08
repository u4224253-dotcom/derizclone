// Kartu instrumen di panel bawah (hanya tampil di Gaya UI Flat): ikon + nama track yang sedang terpilih.
// Hanya membaca DOM card track (.trkcard--on); tidak mengubah logika pemilihan track.
const list = document.querySelector('.headers-list');
const ico = document.getElementById('dockInstIco');
const instName = document.getElementById('dockInstName');

const sync = (): void => {
  if (!list || !ico || !instName) return;
  const on = list.querySelector('.trkcard--on') ?? list.querySelector('.trkcard');
  if (!on) { instName.textContent = '–'; ico.innerHTML = ''; return; }
  const src = on.querySelector('.trkcard__inst .ico');
  const nm = on.querySelector('.trkcard__title-btn span')?.textContent?.trim();
  const html = src ? src.innerHTML : '';
  if (ico.innerHTML !== html) ico.innerHTML = html;
  const label = nm || 'Track';
  if (instName.textContent !== label) instName.textContent = label;
  const c = (on as HTMLElement).style.getPropertyValue('--track-color') || getComputedStyle(on).getPropertyValue('--track-color');
  if (c) ico.style.setProperty('--inst-color', c.trim());
};

if (list) {
  new MutationObserver(sync).observe(list, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
}
sync();

// ---------- Tombol alat & loop (Gaya Flat): hanya status tampilan + event; logika editor boleh mendengarkannya ----------
// 'dock-tool' detail {tool: 'select' | 'draw' | 'cut'};  'dock-loop' detail {on: boolean}
const tools = Array.from(document.querySelectorAll<HTMLButtonElement>('.tool-btn'));
tools.forEach(b => b.addEventListener('click', () => {
  tools.forEach(o => { const on = o === b; o.classList.toggle('is-on', on); o.setAttribute('aria-pressed', String(on)); });
  document.dispatchEvent(new CustomEvent('dock-tool', { detail: { tool: b.dataset.tool } }));
}));
const loopBtn = document.getElementById('btnLoop');
loopBtn?.addEventListener('click', () => {
  const on = loopBtn.getAttribute('aria-pressed') !== 'true';
  loopBtn.setAttribute('aria-pressed', String(on)); loopBtn.classList.toggle('is-on', on);
  document.dispatchEvent(new CustomEvent('dock-loop', { detail: { on } }));
});

// ---------- Tombol mixer: membuka / menutup panel efek (sama dengan panah di tepi panel efek) ----------
document.getElementById('btnMixer')?.addEventListener('click', () => document.getElementById('fxToggle')?.click());

// ---------- Meter master (kiri / kanan) dari keluaran akhir yang sama dengan yang terdengar ----------
const FLOOR_DB = -54, FALL = 1.3;
export function initDockMeter(tap: () => AudioNode | null): void {
  const bl = document.getElementById('dockMeterL'), br = document.getElementById('dockMeterR');
  if (!bl || !br) return;
  let an: [AnalyserNode, AnalyserNode] | null = null, src: AudioNode | null = null;
  const buf = new Float32Array(512);
  const v = [0, 0];
  let last = performance.now();
  const norm = (x: number): number => x <= 1e-5 ? 0 : Math.max(0, Math.min(1, 1 - 20 * Math.log10(x) / FLOOR_DB));
  const peak = (a: AnalyserNode): number => { a.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const x = Math.abs(buf[i]); if (x > m) m = x; } return m; };
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (document.hidden || document.documentElement.dataset.uistyle !== 'flat') return;
    const node = tap();
    if (node && node !== src) {
      try {
        const ctx = node.context, sp = ctx.createChannelSplitter(2);
        const a = ctx.createAnalyser(), b = ctx.createAnalyser(); a.fftSize = b.fftSize = 512;
        node.connect(sp); sp.connect(a, 0); sp.connect(b, 1);
        an = [a, b]; src = node;
      } catch { an = null; }
    }
    [bl, br].forEach((el, i) => {
      const lin = an ? peak(an[i]) : 0;
      v[i] = Math.max(norm(lin), v[i] - FALL * dt);
      if (v[i] < 0.002) v[i] = 0;
      el.style.clipPath = `inset(0 ${((1 - v[i]) * 100).toFixed(1)}% 0 0)`;
    });
  };
  requestAnimationFrame(frame);
}
