// Panel metronome: lingkaran besar berisi dial BPM (tarik / panah keyboard), angka BPM yang bisa diketik,
// tombol -/+, saklar metronome, tap tempo, dan count-in. Semua nilai dibaca / ditulis lewat MetroApi (logika ada di main.ts).

export const BPM_MIN = 30, BPM_MAX = 300;

export interface MetroApi {
  getBpm(): number;
  setBpm(bpm: number): void;
  isOn(): boolean;
  setOn(on: boolean): void;
  isCountIn(): boolean;
  setCountIn(on: boolean): void;
}
export interface MetroPanel {
  sync(): void;            // segarkan tampilan dari MetroApi
  beat(i: number): void;   // nyalakan titik ketukan ke-i (0-3), -1 = semua mati
  flash(): void;           // kedip kecil di tombol M
}

const START = 135, SWEEP = 270, R = 122, C = 150;   // dial 270 derajat, celah di bawah
const polar = (deg: number): [number, number] => { const a = deg * Math.PI / 180; return [C + R * Math.cos(a), C + R * Math.sin(a)]; };
const [x0, y0] = polar(START), [x1, y1] = polar(START + SWEEP);
const ARC = `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const frac = (bpm: number) => (clamp(bpm, BPM_MIN, BPM_MAX) - BPM_MIN) / (BPM_MAX - BPM_MIN);

const ICON_METRO = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 3h6l3.2 17H5.8L9 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 16L16.5 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15.3" cy="9.4" r="1.5" fill="currentColor"/></svg>';

export function initMetronomePanel(btn: HTMLButtonElement, api: MetroApi): MetroPanel {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let panel: HTMLElement | null = null;
  let ui: { ring: SVGElement; fill: SVGPathElement; knob: SVGCircleElement; input: HTMLInputElement; toggle: HTMLButtonElement;
            count: HTMLButtonElement; dots: HTMLElement[] } | null = null;
  let taps: number[] = [];

  const setBpm = (v: number) => { api.setBpm(clamp(Math.round(v), BPM_MIN, BPM_MAX)); sync(); };

  function syncButton(): void {
    btn.classList.toggle('is-on', api.isOn());
    btn.setAttribute('aria-label', `Metronome dan BPM, ${api.getBpm()} BPM, ${api.isOn() ? 'aktif' : 'mati'}`);
  }
  function sync(): void {
    syncButton();
    if (!ui) return;
    const bpm = api.getBpm(), f = frac(bpm), [kx, ky] = polar(START + f * SWEEP);
    ui.fill.style.strokeDasharray = `${(f * 100).toFixed(2)} 100`;
    ui.knob.setAttribute('cx', kx.toFixed(2)); ui.knob.setAttribute('cy', ky.toFixed(2));
    ui.ring.setAttribute('aria-valuenow', String(bpm)); ui.ring.setAttribute('aria-valuetext', bpm + ' BPM');
    if (document.activeElement !== ui.input) ui.input.value = String(bpm);
    ui.toggle.setAttribute('aria-pressed', String(api.isOn()));
    ui.toggle.classList.toggle('is-on', api.isOn());
    ui.count.setAttribute('aria-pressed', String(api.isCountIn()));
    ui.count.classList.toggle('is-on', api.isCountIn());
  }

  function close(instant = false): void {
    const p = panel; if (!p) return;
    panel = ui = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    btn.setAttribute('aria-expanded', 'false');
    if (instant || reduce) { p.remove(); return; }
    p.style.pointerEvents = 'none';
    p.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.86)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => p.remove();
  }
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (panel && !panel.contains(t) && !btn.contains(t)) close();
  };
  const onResize = () => close(true);

  function place(p: HTMLElement): void {
    const r = btn.getBoundingClientRect(), w = p.offsetWidth;
    const left = clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, innerWidth - w - 8));
    p.style.left = left + 'px';
    p.style.top = Math.max(8, r.top - w - 10) + 'px';
    p.style.transformOrigin = (r.left + r.width / 2 - left) + 'px 100%';
  }

  function open(): void {
    if (panel) return;
    const p = document.createElement('div');
    p.className = 'metro-panel';
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Metronome dan BPM');
    p.innerHTML =
      `<svg class="metro-ring" viewBox="0 0 300 300" role="slider" tabindex="0" aria-label="BPM" aria-valuemin="${BPM_MIN}" aria-valuemax="${BPM_MAX}">` +
        `<path class="metro-track" d="${ARC}"/><path class="metro-fill" d="${ARC}" pathLength="100"/><circle class="metro-knob" r="13"/></svg>` +
      `<div class="metro-dots" aria-hidden="true"><i></i><i></i><i></i><i></i></div>` +
      `<input class="metro-bpm" type="number" inputmode="numeric" min="${BPM_MIN}" max="${BPM_MAX}" step="1" aria-label="BPM project">` +
      `<div class="metro-unit">BPM</div>` +
      `<div class="metro-row">` +
        `<button type="button" class="metro-step" data-d="-1" aria-label="Kurangi BPM">&minus;</button>` +
        `<button type="button" class="metro-toggle" aria-label="Metronome" title="Metronome nyala / mati">${ICON_METRO}</button>` +
        `<button type="button" class="metro-step" data-d="1" aria-label="Tambah BPM">+</button></div>` +
      `<div class="metro-chips"><button type="button" class="metro-chip" data-act="tap" title="Ketuk berulang untuk menentukan tempo">Tap</button>` +
        `<button type="button" class="metro-chip" data-act="count" title="Hitung 1 bar sebelum mulai">Count-in</button></div>`;
    document.body.appendChild(p);
    panel = p;
    ui = {
      ring: p.querySelector<SVGElement>('.metro-ring')!, fill: p.querySelector<SVGPathElement>('.metro-fill')!,
      knob: p.querySelector<SVGCircleElement>('.metro-knob')!, input: p.querySelector<HTMLInputElement>('.metro-bpm')!,
      toggle: p.querySelector<HTMLButtonElement>('.metro-toggle')!, count: p.querySelector<HTMLButtonElement>('[data-act="count"]')!,
      dots: [...p.querySelectorAll<HTMLElement>('.metro-dots i')],
    };
    const { ring, input, toggle, count } = ui;

    // dial: tarik di cincin
    const fromPointer = (e: PointerEvent) => {
      const r = ring.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      let a = (Math.atan2(dy, dx) * 180 / Math.PI - START + 720) % 360;
      if (a > SWEEP) a = a < SWEEP + (360 - SWEEP) / 2 ? SWEEP : 0;   // di celah bawah: tempel ke ujung terdekat
      setBpm(BPM_MIN + a / SWEEP * (BPM_MAX - BPM_MIN));
    };
    let dragging = false;
    ring.addEventListener('pointerdown', e => {
      const r = ring.getBoundingClientRect(), d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / (r.width / 300);
      if (d < 92 || e.button > 0) return;   // bagian tengah milik kontrol lain
      dragging = true; ring.setPointerCapture(e.pointerId); ring.focus({ preventScroll: true }); fromPointer(e); e.preventDefault();
    });
    ring.addEventListener('pointermove', e => { if (dragging) fromPointer(e); });
    const endDrag = () => { dragging = false; };
    ring.addEventListener('pointerup', endDrag); ring.addEventListener('pointercancel', endDrag);
    ring.addEventListener('keydown', e => {
      const big = e.shiftKey ? 10 : 1, b = api.getBpm();
      const m: Record<string, number> = { ArrowUp: big, ArrowRight: big, ArrowDown: -big, ArrowLeft: -big, PageUp: 10, PageDown: -10 };
      if (e.key in m) { e.preventDefault(); setBpm(b + m[e.key]); }
      else if (e.key === 'Home') { e.preventDefault(); setBpm(BPM_MIN); }
      else if (e.key === 'End') { e.preventDefault(); setBpm(BPM_MAX); }
    });

    // angka BPM: ketik lalu Enter / pindah fokus
    input.addEventListener('focus', () => input.select());
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) setBpm(v);
      input.value = String(api.getBpm());
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ring.focus({ preventScroll: true }); } });

    // -/+ : tahan untuk terus bergeser
    p.querySelectorAll<HTMLButtonElement>('.metro-step').forEach(b => {
      const d = +b.dataset.d!; let to = 0, iv = 0;
      const stop = () => { clearTimeout(to); clearInterval(iv); to = iv = 0; };
      b.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        setBpm(api.getBpm() + d); stop();
        to = window.setTimeout(() => { iv = window.setInterval(() => setBpm(api.getBpm() + d), 70); }, 380);
      });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev => b.addEventListener(ev, stop));
      b.addEventListener('click', e => { if (e.detail === 0) setBpm(api.getBpm() + d); });   // lewat keyboard
    });

    toggle.addEventListener('click', () => { api.setOn(!api.isOn()); sync(); });
    count.addEventListener('click', () => { api.setCountIn(!api.isCountIn()); sync(); });
    p.querySelector<HTMLButtonElement>('[data-act="tap"]')!.addEventListener('click', e => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now); if (taps.length > 6) taps.shift();
      if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
      const t = e.currentTarget as HTMLElement; t.classList.remove('is-tap'); void t.offsetWidth; t.classList.add('is-tap');
    });

    // pintasan DAW (Space, panah, dll.) tidak ikut jalan saat panel terbuka; Esc menutup
    p.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus({ preventScroll: true }); }
    });
    p.addEventListener('keyup', e => e.stopPropagation());

    place(p); sync();
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onResize);
    ring.focus({ preventScroll: true });
  }

  btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => (panel ? close() : open()));
  syncButton();

  return {
    sync,
    beat(i: number) { ui?.dots.forEach((d, k) => d.classList.toggle('on', k === i)); },
    flash() { if (reduce) return; btn.classList.remove('is-beat'); void btn.offsetWidth; btn.classList.add('is-beat'); },
  };
}
