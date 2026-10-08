// Pitch Project: satu knob di card transport (paling kiri) yang menggeser nada SEMUA isi project yang berplugin (DERIZ + Supersaw).
// Audio clip di timeline TIDAK ikut (audio-engine.play() tidak membaca nilai ini). Satuan semitone dengan ketelitian 0,01 (100 cents), -12..+12, 0 = normal; langkah tombol / roda / panah 0,1, Shift = 1 semitone.
// Mesin suara berlangganan lewat onMasterPitch: DERIZ menambahkannya ke knob Pitch-nya, Supersaw ke detune osilatornya (nada yang sedang bunyi ikut bergeser).

export const PITCH_MIN = -12, PITCH_MAX = 12;

let st = 0;
const subs = new Set<(v: number) => void>();
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const getMasterPitch = (): number => st;
export function setMasterPitch(v: number): void {
  const n = Math.round(clamp(v, PITCH_MIN, PITCH_MAX) * 100) / 100;   // ketelitian 0,01 semitone
  if (n === st) return;
  st = n;
  subs.forEach(f => f(n));
}
export function onMasterPitch(cb: (v: number) => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

// ---------- panel knob ----------
const START = 135, SWEEP = 270, R = 50, C = 70;   // busur 270 derajat, celah di bawah; 0 semitone tepat di atas (jam 12)
const polar = (deg: number, r = R): [number, number] => { const a = deg * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
const angleOf = (v: number): number => START + (v - PITCH_MIN) / (PITCH_MAX - PITCH_MIN) * SWEEP;
const f2 = (n: number): string => n.toFixed(2);
const [tx0, ty0] = polar(START), [tx1, ty1] = polar(START + SWEEP);
const TRACK = `M${f2(tx0)} ${f2(ty0)}A${R} ${R} 0 1 1 ${f2(tx1)} ${f2(ty1)}`;
const num = (v: number): string => Math.abs(v).toFixed(2).replace('.', ',');   // 0,10 / 3,00 (format Indonesia)
const label = (v: number): string => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + num(v);

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.6"/><path d="M12 12L15.4 7.6"/><path d="M12 2.4v1.8M4.4 5.2l1.3 1.2M19.6 5.2l-1.3 1.2"/></svg>';

export function initPitchPanel(btn: HTMLButtonElement): { sync(): void } {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let panel: HTMLElement | null = null;
  let ui: { ring: SVGElement; fill: SVGPathElement; dot: SVGCircleElement; ptr: SVGLineElement; val: HTMLElement; reset: HTMLButtonElement } | null = null;

  btn.innerHTML = ICON;
  btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');

  function sync(): void {
    const v = st;
    btn.classList.toggle('is-on', v !== 0);
    btn.setAttribute('aria-label', `Pitch project, ${v === 0 ? 'normal' : label(v) + ' semitone'}`);
    btn.title = v === 0 ? 'Pitch project' : `Pitch project ${label(v)} st`;
    if (!ui) return;
    const a = angleOf(v), a0 = angleOf(0), [kx, ky] = polar(a), [px, py] = polar(a, 27), [sx, sy] = polar(a0);
    ui.fill.setAttribute('d', v === 0 ? '' : `M${f2(sx)} ${f2(sy)}A${R} ${R} 0 0 ${v > 0 ? 1 : 0} ${f2(kx)} ${f2(ky)}`);
    ui.dot.setAttribute('cx', f2(kx)); ui.dot.setAttribute('cy', f2(ky));
    ui.ptr.setAttribute('x2', f2(px)); ui.ptr.setAttribute('y2', f2(py));
    ui.ring.setAttribute('aria-valuenow', String(v)); ui.ring.setAttribute('aria-valuestep', '0.1'); ui.ring.setAttribute('aria-valuetext', label(v) + ' semitone');
    ui.val.textContent = label(v);
    ui.reset.disabled = v === 0;
  }
  const unsub = onMasterPitch(sync);   // juga terpanggil saat project dibuka
  void unsub;

  function close(instant = false): void {
    const p = panel; if (!p) return;
    panel = ui = null;
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onResize);
    btn.setAttribute('aria-expanded', 'false');
    if (instant || reduce) { p.remove(); return; }
    p.style.pointerEvents = 'none';
    p.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.88)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).onfinish = () => p.remove();
  }
  const onOutside = (e: PointerEvent): void => { const t = e.target as Node; if (panel && !panel.contains(t) && !btn.contains(t)) close(); };
  const onResize = (): void => close(true);

  function place(p: HTMLElement): void {
    const r = btn.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    const left = clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, innerWidth - w - 8));
    p.style.left = left + 'px';
    p.style.top = Math.max(8, r.top - h - 10) + 'px';
    p.style.transformOrigin = (r.left + r.width / 2 - left) + 'px 100%';
  }

  function open(): void {
    if (panel) return;
    const p = document.createElement('div');
    p.className = 'pitch-panel';
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Pitch project');
    p.innerHTML =
      `<div class="pitch-title">Pitch Project</div>` +
      `<svg class="pitch-ring" viewBox="0 0 140 140" role="slider" tabindex="0" aria-label="Pitch project" aria-valuemin="${PITCH_MIN}" aria-valuemax="${PITCH_MAX}">` +
        `<path class="pitch-track" d="${TRACK}"/><path class="pitch-fill"/>` +
        `<circle class="pitch-body" cx="${C}" cy="${C}" r="34"/><line class="pitch-ptr" x1="${C}" y1="${C}" x2="${C}" y2="${C - 27}"/>` +
        `<circle class="pitch-dot" r="6.5"/></svg>` +
      `<div class="pitch-val" aria-hidden="true">0,00</div><div class="pitch-unit">SEMITONE</div>` +
      `<div class="pitch-row"><button type="button" class="pitch-step" data-d="-0.1" aria-label="Turun 0,1 semitone">&minus;</button>` +
        `<button type="button" class="pitch-reset" aria-label="Reset pitch project">Reset</button>` +
        `<button type="button" class="pitch-step" data-d="0.1" aria-label="Naik 0,1 semitone">+</button></div>` +
      `<div class="pitch-row pitch-row2"><button type="button" class="pitch-step pitch-step1" data-d="-1" aria-label="Turun satu semitone">&minus;1</button>` +
        `<button type="button" class="pitch-step pitch-step1" data-d="1" aria-label="Naik satu semitone">+1</button></div>` +
      `<div class="pitch-note">Semua plugin (DERIZ, Supersaw) ikut. Audio clip tidak.</div>`;
    document.body.appendChild(p);
    panel = p;
    ui = {
      ring: p.querySelector<SVGElement>('.pitch-ring')!, fill: p.querySelector<SVGPathElement>('.pitch-fill')!,
      dot: p.querySelector<SVGCircleElement>('.pitch-dot')!, ptr: p.querySelector<SVGLineElement>('.pitch-ptr')!,
      val: p.querySelector<HTMLElement>('.pitch-val')!, reset: p.querySelector<HTMLButtonElement>('.pitch-reset')!,
    };
    const { ring, reset } = ui;

    // knob: tarik ke atas / kanan = naik, ke bawah / kiri = turun (2 px per 0,1 semitone); roda mouse dan panah keyboard juga bisa (Shift = 1 semitone)
    let drag: { x: number; y: number; v: number } | null = null;
    ring.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      drag = { x: e.clientX, y: e.clientY, v: st }; ring.setPointerCapture(e.pointerId); ring.focus({ preventScroll: true }); e.preventDefault();
    });
    ring.addEventListener('pointermove', e => { if (drag) setMasterPitch(Math.round((drag.v + ((drag.y - e.clientY) + (e.clientX - drag.x)) / 20) * 10) / 10); });
    const end = (): void => { drag = null; };
    ring.addEventListener('pointerup', end); ring.addEventListener('pointercancel', end);
    ring.addEventListener('dblclick', () => setMasterPitch(0));
    ring.addEventListener('wheel', e => { e.preventDefault(); const dy = e.deltaY || e.deltaX; setMasterPitch(st + (dy < 0 ? 1 : -1) * (e.shiftKey ? 1 : 0.1)); }, { passive: false });
    ring.addEventListener('keydown', e => {
      const m: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 12, PageDown: -12 };
      if (e.key in m) { e.preventDefault(); const big = e.key.startsWith('Page') || e.shiftKey; setMasterPitch(st + m[e.key] * (big ? 1 : 0.1)); }
      else if (e.key === 'Home') { e.preventDefault(); setMasterPitch(PITCH_MIN); }
      else if (e.key === 'End') { e.preventDefault(); setMasterPitch(PITCH_MAX); }
      else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterPitch(0); }
    });

    reset.addEventListener('click', () => setMasterPitch(0));
    p.querySelectorAll<HTMLButtonElement>('.pitch-step').forEach(b => {
      const d = +b.dataset.d!; let to = 0, iv = 0;
      const stop = (): void => { clearTimeout(to); clearInterval(iv); to = iv = 0; };
      b.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        setMasterPitch(st + d); stop();
        to = window.setTimeout(() => { iv = window.setInterval(() => setMasterPitch(st + d), 110); }, 380);
      });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev => b.addEventListener(ev, stop));
      b.addEventListener('click', e => { if (e.detail === 0) setMasterPitch(st + d); });   // lewat keyboard
    });

    // pintasan DAW (Space, panah) tidak ikut jalan saat panel terbuka; Esc menutup
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

  btn.addEventListener('click', () => (panel ? close() : open()));
  sync();
  return { sync };
}
